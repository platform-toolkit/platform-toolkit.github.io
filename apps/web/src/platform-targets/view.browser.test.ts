// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  DataSourceError,
  type DataSource,
  type RecordSetQuery,
} from '@platform-toolkit/data-access';
import type {
  CategoryCatalog,
  ClassificationBook,
  DataMeta,
  RecordBook,
} from '@platform-toolkit/data-contracts';
import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import type { PtkChoiceGroup, PtkSegmented, PtkSelect } from '@platform-toolkit/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import type { Connection } from './freshness.js';
import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import { BOOK, CATALOG, CLASSIFICATIONS, DATA_META, STATE_BOOK } from './records-fixture.js';
import type { SelectionField } from './selection.js';
import { createPlatformTargetsView } from './view.js';

/**
 * The transport, end to end, in a real browser.
 *
 * Everything below `view.ts` takes what it draws as a property, so this is the
 * only suite where a read and a screen meet. What it is really testing is the
 * three-way join between the questions, the reads they trigger, and the report
 * that renders whatever has arrived -- and every failure mode here is one where
 * each half is individually correct: a partition read for the category the
 * lifter just left, a book filed under a key nothing looks up, a report one
 * answer behind the questions above it.
 *
 * TWO KINDS OF CONTROL, AND THE HELPERS HAVE TO KNOW WHICH
 *
 * Sex, equipment and drug-tested status are radio tiles; weight class,
 * comparison class, division and region are selects. A select cannot be clicked
 * into a value -- the visitor's interaction opens a platform picker no test can
 * reach -- so `pick` sets the value and fires `change`, which is what that
 * picker does on the way out. Using the wrong helper throws by name rather than
 * silently answering nothing; keep both throwing.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
  vi.restoreAllMocks();
});

/** Not a real federation: the point is that the view asks for what it was given. */
const FEDERATION_ID = 'example-federation';

interface Stubs {
  readonly catalog?: () => Promise<CategoryCatalog | null>;
  readonly classifications?: () => Promise<ClassificationBook | null>;
  readonly records?: (query: RecordSetQuery) => Promise<RecordBook | null>;
  readonly meta?: () => Promise<DataMeta>;
}

/** What a source was asked for, in the order it was asked. */
interface Asked {
  readonly federations: string[];
  readonly classificationPartitions: string[];
  readonly recordPartitions: string[];
}

/**
 * A source that records what it was asked for.
 *
 * Conversion charts, meet rules and the athlete archive are not read by this
 * view, so those methods answer emptily rather than throwing: a stub that threw
 * would turn "nothing asks for this" into a failure the day something does,
 * which is a worse way to find out. The archive answers as a build that
 * published none, which is what this tool's data set is.
 */
function sourceThat(stubs: Stubs = {}): DataSource & Asked {
  const federations: string[] = [];
  const classificationPartitions: string[] = [];
  const recordPartitions: string[] = [];
  const {
    catalog = () => Promise.resolve(CATALOG),
    classifications = () => Promise.resolve(CLASSIFICATIONS),
    records = () => Promise.resolve(null),
    meta = () => Promise.resolve(DATA_META),
  } = stubs;

  return {
    kind: 'static',
    federations,
    classificationPartitions,
    recordPartitions,
    getDataMeta: () => meta(),
    getCategoryCatalog: (federationId: string) => {
      federations.push(federationId);
      return catalog();
    },
    getRecords: (query) => {
      // The book identifier is recorded with the axes rather than asserted
      // separately: a view that asked the right partition of the wrong book
      // reads as a federation publishing no records, which is a real answer.
      recordPartitions.push(
        `${query.bookId} ${query.levelId} ${query.regionId ?? '-'} ${query.sex} ${query.equipmentId}`,
      );
      return records(query);
    },
    getConversionChart: () => Promise.resolve(null),
    getMeetRuleProfiles: () => Promise.resolve(null),
    getQualifyingMeets: () => Promise.resolve(null),
    getAthleteMirror: () => Promise.resolve(null),
    findAthletes: () => Promise.resolve({ outcome: 'found', matches: [] }),
    getClassifications: (query) => {
      classificationPartitions.push(`${query.federationId} ${query.sex} ${query.equipmentId}`);
      return classifications();
    },
  };
}

/**
 * The view, with somewhere to remember a context that is not this device.
 *
 * Memory rather than the default: every test in this file shares one page, and a
 * store that outlived one of them would make the next test's first visit a
 * returning one -- a suite that passes or fails on the order it happens to run
 * in. The one test that cares what the *default* is says so, and cleans up.
 */
function mount(
  source: DataSource,
  settings: PreferenceStore = createPreferenceStore(memoryPreferenceStorage()),
): PtkPlatformTargets {
  const element = createPlatformTargetsView({ source, settings, federationId: FEDERATION_ID });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

/**
 * One of the tool's three panels, by tag.
 *
 * Throws rather than answering null, because every caller goes on to read text
 * out of it: a missing panel would otherwise be indistinguishable from a panel
 * that rendered nothing, and the second is a state this tool has on purpose.
 */
function panel(element: PtkPlatformTargets, tag: string): ShadowRoot {
  const found = element.shadowRoot?.querySelector(tag)?.shadowRoot;
  if (found === null || found === undefined) {
    throw new Error(`"${tag}" has not rendered.`);
  }
  return found;
}

function categories(element: PtkPlatformTargets): ShadowRoot {
  return panel(element, 'ptk-target-categories');
}

function report(element: PtkPlatformTargets): ShadowRoot {
  return panel(element, 'ptk-target-report');
}

function lifts(element: PtkPlatformTargets): ShadowRoot {
  return panel(element, 'ptk-target-lifts');
}

/** Answers one tile question the way a visitor does: by clicking the radio. */
async function choose(
  element: PtkPlatformTargets,
  field: SelectionField,
  value: string,
): Promise<void> {
  const group = categories(element).querySelector<PtkChoiceGroup>(
    `ptk-choice-group[data-field="${field}"]`,
  );
  if (group === null) {
    throw new Error(`No choice group rendered for "${field}".`);
  }
  const radios = group.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" in the "${field}" group.`);
}

/** Answers a picker, or clears it back to its placeholder by passing `null`. */
async function pick(
  element: PtkPlatformTargets,
  field: SelectionField,
  value: string | null,
): Promise<void> {
  const found = categories(element).querySelector<PtkSelect>(`ptk-select[data-field="${field}"]`);
  if (found === null) {
    throw new Error(`No select rendered for "${field}".`);
  }
  const select = found.shadowRoot?.querySelector('select');
  if (select === null || select === undefined) {
    throw new Error(`The "${field}" select has no options to open.`);
  }
  const wanted = value ?? '';
  if (![...select.options].some((option) => option.value === wanted)) {
    throw new Error(`No option "${wanted}" in the "${field}" select.`);
  }
  select.value = wanted;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

/** Types into one of the optional lift fields, the way a lifter does. */
async function typeLift(element: PtkPlatformTargets, lift: string, text: string): Promise<void> {
  const field = lifts(element).querySelector(`ptk-number-field[data-lift="${lift}"]`);
  const input = field?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`The "${lift}" field rendered no input.`);
  }
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/**
 * Moves one of the report's two bars, the way a thumb does.
 *
 * A third control family, alongside `choose` and `pick`, and it throws by name
 * for the same reason both of those do: a helper that quietly fell back to
 * another family is how a suite starts answering nothing and reporting a pass.
 * A segment binds its value as a *property*, so it has to be found by the text a
 * lifter reads rather than by an attribute selector.
 */
async function moveBar(element: PtkPlatformTargets, control: string, label: string): Promise<void> {
  const bar = report(element).querySelector<PtkSegmented>(
    `ptk-segmented[data-control="${control}"]`,
  );
  if (bar === null) {
    throw new Error(`No "${control}" bar in the report.`);
  }
  await bar.updateComplete;
  const segments = [...(bar.shadowRoot?.querySelectorAll('label.segment') ?? [])];
  const found = segments.find((segment) => segment.textContent.trim() === label);
  const input = found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(
      `No "${control}" segment labelled "${label}". Found: ${segments
        .map((segment) => segment.textContent.trim())
        .join(', ')}.`,
    );
  }
  input.click();
  await bar.updateComplete;
  await element.updateComplete;
}

async function questionsDrawn(element: PtkPlatformTargets): Promise<void> {
  await vi.waitFor(() => {
    expect(categories(element).querySelectorAll('ptk-choice-group').length).toBe(3);
  });
}

/**
 * The four required answers and nothing optional.
 *
 * Sex first, because the weight-class picker has no options until it is
 * answered. Answering is not applying: nothing is read until {@link showTargets}
 * commits the context, which is the whole of what the batch buys.
 */
async function answerRequired(element: PtkPlatformTargets): Promise<void> {
  await questionsDrawn(element);
  await choose(element, 'sex', 'female');
  await choose(element, 'equipment', 'raw');
  await choose(element, 'tested', 'tested');
  await pick(element, 'weightClass', 'f-56');
}

/**
 * Presses the action that commits the answered context.
 *
 * The native button inside the shared control, because that is where a press
 * actually lands and the questions element reads the pressed target out of
 * `composedPath()`.
 */
async function showTargets(element: PtkPlatformTargets): Promise<void> {
  const button = categories(element)
    .querySelector('ptk-button[data-action="apply"]')
    ?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('No action to show the targets with.');
  }
  if (button.disabled) {
    throw new Error('The action is still disabled: something required is unanswered.');
  }
  button.click();
  await element.updateComplete;
}

/** Answers the four required questions and commits them, which most tests want. */
async function answerAndShow(element: PtkPlatformTargets): Promise<void> {
  await answerRequired(element);
  await showTargets(element);
}

/**
 * Changes the committed context the way a lifter does after the first visit.
 *
 * Through the summary and the editor rather than by reaching into the element,
 * because the transport's whole contract is with the *applied* event and the
 * editor is the only thing that fires it twice. A test that set a property
 * instead would leave the second-visit path -- the one where a lifter switches
 * to single-ply and every partition has to be re-read -- unexercised.
 */
async function reviseContext(
  element: PtkPlatformTargets,
  change: () => Promise<void>,
): Promise<void> {
  const summary = element.shadowRoot
    ?.querySelector('ptk-target-context')
    ?.shadowRoot?.querySelector('button');
  if (!(summary instanceof HTMLButtonElement)) {
    throw new Error('No context summary to open the editor from.');
  }
  summary.click();
  await element.updateComplete;
  await change();
  await showTargets(element);
}

/** How the report names each partition it is holding, in the order it shows them. */
function partitionLabels(element: PtkPlatformTargets): string[] {
  return [...element.recordReads.values()].map((read) => read.partition.label);
}

/**
 * One partition's read, by the label the report shows for it.
 *
 * The count rather than the book's label: every book this fixture builds carries
 * the same label, so an assertion on it would pass with the state partition's
 * book filed under the national key -- which is the mix-up this suite exists to
 * catch.
 */
function readFor(
  element: PtkPlatformTargets,
  label: string,
): { status: string; records: number | null } {
  for (const read of element.recordReads.values()) {
    if (read.partition.label === label) {
      return { status: read.status, records: read.book?.records.length ?? null };
    }
  }
  throw new Error(`The report is holding no read for "${label}".`);
}

/** The whole of what the footer is saying, however deeply it is nested. */
function footerLine(element: PtkPlatformTargets): string {
  return deepText(panel(element, 'ptk-target-freshness')).trim();
}

/**
 * What the tool's persistent live region is holding.
 *
 * Read off the node rather than off a property, because the thing being tested
 * is that the sentence reached the region -- a `#announcement()` that computed
 * the right string and rendered it somewhere else would satisfy any assertion
 * made against the element.
 */
function announced(element: PtkPlatformTargets): string {
  return element.shadowRoot?.querySelector('.announcer')?.textContent.trim() ?? '';
}

/**
 * The device gained or lost its network.
 *
 * Dispatched on `window`, not on the element: the transport listens there,
 * because a tool being moved around in the DOM must not stop noticing the
 * network, and host pages really do move a frame's contents. The two event
 * names are the two `Connection` values, which is a coincidence worth leaning
 * on only because both lists are closed and both live in `freshness.ts`.
 */
async function connectionBecomes(element: PtkPlatformTargets, state: Connection): Promise<void> {
  window.dispatchEvent(new Event(state));
  await element.updateComplete;
}

/**
 * Presses the footer's own retry.
 *
 * The native button inside the shared control, for the same reason
 * {@link showTargets} reaches for one: that is where the press lands, and the
 * event it raises is composed on its way out to the transport.
 */
async function retryFromFooter(element: PtkPlatformTargets): Promise<void> {
  const button = panel(element, 'ptk-target-freshness')
    .querySelector('ptk-button.retry')
    ?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('The footer is offering no way to try again.');
  }
  button.click();
  await element.updateComplete;
}

describe('createPlatformTargetsView', () => {
  it('returns something with a height before the read finishes', async () => {
    // The embed route posts its height to the parent as soon as it can. An
    // element that renders nothing until the catalogue lands reports zero and
    // then jumps, which is worse for the embedding page than a stable box.
    const element = mount(sourceThat({ catalog: () => new Promise(() => undefined) }));

    await element.updateComplete;
    expect(deepText(categories(element))).toContain('Loading');
  });

  it('shows every question once the catalogue arrives', async () => {
    const element = mount(sourceThat());

    await questionsDrawn(element);
    // Three tiles and four pickers. The count is asserted rather than the
    // fields, because the fields have their own suite -- what this holds is that
    // the composition root hands the catalogue down far enough to draw them.
    expect(categories(element).querySelectorAll('ptk-select').length).toBe(4);
  });

  it('shows a field for every lift, folded out of the way', async () => {
    const element = mount(sourceThat());
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(lifts(element).querySelectorAll('ptk-number-field').length).toBe(4);
    });
  });

  /**
   * The first visit is the questions and nothing else.
   *
   * Not a report with a placeholder in it: an empty panel under an unanswered
   * form gives a lifter two things to read before either says anything, and the
   * report's own reason for existing is that it does not reflow while the
   * context is being edited (§14.4 stage 2). Asserted as the element being
   * absent rather than as text, because a hidden report still costs the layout.
   */
  it('draws no report at all until the context is applied', async () => {
    const element = mount(sourceThat());
    await answerRequired(element);

    expect(element.shadowRoot?.querySelector('ptk-target-report')).toBeNull();

    await showTargets(element);
    expect(deepText(report(element))).toContain('Targets');
  });

  /**
   * The remembered context has to survive the page, which means the store has to
   * come from *here*.
   *
   * Every other test of the restore injects a store, so all of them held while
   * the composition root passed none and the element kept its
   * `createPreferenceStore(null)` default -- the supported no-storage mode, which
   * reads fallbacks and reports `unavailable` on every write. The tool was
   * correct, the storage was correct, and the deployed site forgot everything.
   * This is the one assertion in the tool that a wire is connected rather than
   * that either end works, so it deliberately mounts with no store and looks at
   * the device.
   */
  it('remembers an applied context on the device, with no store handed to it', async () => {
    const before = new Set(Object.keys(globalThis.localStorage));
    teardown.push(() => {
      for (const key of Object.keys(globalThis.localStorage)) {
        if (!before.has(key)) globalThis.localStorage.removeItem(key);
      }
    });

    const element = createPlatformTargetsView({
      source: sourceThat(),
      federationId: FEDERATION_ID,
    });
    document.body.append(element);
    teardown.push(() => {
      element.remove();
    });
    await answerAndShow(element);

    const written = Object.keys(globalThis.localStorage).filter((key) => !before.has(key));
    expect(written).toContain('ptk.platform-targets.context');
  });

  it('asks for the federation the page declared, and no other', () => {
    // A federation the code has never heard of, so a view that fell back to a
    // constant would fail here rather than pass by coincidence -- which is the
    // whole reason the option is required instead of defaulted.
    const source = sourceThat();
    mount(source);
    expect(source.federations).toEqual([FEDERATION_ID]);
  });

  it('treats an unpublished federation as an answer, not as a failure', async () => {
    // Telling a reader to reload a page that will never load is worse than
    // saying plainly that nothing is published for them yet.
    const element = mount(sourceThat({ catalog: () => Promise.resolve(null) }));

    await vi.waitFor(() => {
      expect(deepText(categories(element))).toContain('have not been published');
    });
  });

  it('says the read failed, and says nothing more than the reason', async () => {
    // Not swallowed -- a page that silently shows "loading" forever is the worst
    // of the options. Not the error object either: its cause is whatever the
    // transport threw, and a console expands a cause chain, which is where a
    // request URL would appear.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const element = mount(
      sourceThat({
        catalog: () => Promise.reject(new DataSourceError('categories-example', 'http', 404)),
      }),
    );

    await vi.waitFor(() => {
      expect(deepText(categories(element))).toContain('could not be loaded');
    });
    expect(reported).toHaveBeenCalledWith(
      'Platform Targets could not load the category catalogue: http.',
    );
  });

  it('reports an unrecognised failure without letting its text through', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(
      sourceThat({
        catalog: () => Promise.reject(new Error('https://data.example.invalid/secret')),
      }),
    );

    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledWith(
        'Platform Targets could not load the category catalogue: unexpected.',
      );
    });
  });
});

describe('loading the standards for a category', () => {
  it('reads nothing until the context is applied', async () => {
    // Sex and equipment choose the artifact, but answering them is not asking
    // for it. Reading on each tap is what the batched editor exists to stop:
    // seven questions answered one at a time would issue a request per keystroke
    // for a category the lifter is still in the middle of describing.
    const source = sourceThat();
    const element = mount(source);
    await answerRequired(element);

    expect(source.classificationPartitions).toEqual([]);

    await showTargets(element);
    expect(source.classificationPartitions).toEqual([`${FEDERATION_ID} female raw`]);
  });

  it('does not read again for an answer that cannot change the partition', async () => {
    // One shard holds every lift, weight class and division for a sex and
    // equipment category. Re-reading for an answer inside it would issue a
    // request for a file already in hand.
    const source = sourceThat();
    const element = mount(source);
    await answerAndShow(element);
    await reviseContext(element, async () => {
      await pick(element, 'division', 'masters-1');
      await pick(element, 'comparisonWeightClass', 'f-52');
    });

    expect(source.classificationPartitions).toEqual([`${FEDERATION_ID} female raw`]);
  });

  it('reads the other partition when the equipment category changes', async () => {
    const source = sourceThat();
    const element = mount(source);
    await answerAndShow(element);

    await reviseContext(element, () => choose(element, 'equipment', 'single-ply'));

    expect(source.classificationPartitions).toEqual([
      `${FEDERATION_ID} female raw`,
      `${FEDERATION_ID} female single-ply`,
    ]);
  });

  it('reads the other partition when the sex category changes', async () => {
    const source = sourceThat();
    const element = mount(source);
    await answerAndShow(element);

    await reviseContext(element, async () => {
      await choose(element, 'sex', 'male');
      // And a class off the other ladder, because the one answered above is not
      // on it. The editor refuses to apply an incomplete context, which is the
      // same guard that keeps a lifter off a report drawn for half a category.
      await pick(element, 'weightClass', 'm-83');
    });

    expect(source.classificationPartitions).toEqual([
      `${FEDERATION_ID} female raw`,
      `${FEDERATION_ID} male raw`,
    ]);
  });

  it('draws the classification ladder once the standards have arrived', async () => {
    const element = mount(sourceThat());
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(deepText(report(element))).toContain('Class I');
    });
  });

  it('marks a rung the lifter has already passed', async () => {
    // The lift entry is a separate panel that reports outward; the report is
    // handed the figures by the composition root. Nothing else in the tool
    // proves those two are wired to each other.
    const element = mount(sourceThat());
    await answerAndShow(element);
    await vi.waitFor(() => {
      expect(deepText(report(element))).toContain('Class III');
    });

    await typeLift(element, 'squat', '125');

    await vi.waitFor(() => {
      expect(deepText(report(element))).toContain('Reached');
    });
  });

  it('says the standards failed to load without naming what it asked for', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const element = mount(
      sourceThat({
        classifications: () =>
          Promise.reject(new DataSourceError('classifications-example-female-raw', 'http', 404)),
      }),
    );
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(deepText(report(element))).toContain(
        'The published classification standards could not be loaded.',
      );
    });
    expect(reported).toHaveBeenCalledWith(
      'Platform Targets could not load the classification standards: http.',
    );
  });

  it('treats a category with no published standards as an answer', async () => {
    // Real today: several published divisions have no standards at all. A
    // failure notice would send someone to reload a page that will never change,
    // so the report simply has no classification rungs to draw and says nothing
    // about it.
    const element = mount(sourceThat({ classifications: () => Promise.resolve(null) }));
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(element.standardsStatus).toBe('ready');
    });
    expect(deepText(report(element))).not.toContain('could not be loaded');
  });

  it('never lets a slow read for an abandoned category win', async () => {
    // Two partitions in flight can settle out of order. The loser would paint
    // the panel with standards for the equipment category the lifter just left
    // -- a plausible table, tens of kilograms out, with nothing to indicate it.
    const settle: ((book: ClassificationBook | null) => void)[] = [];
    const element = mount(
      sourceThat({
        classifications: () =>
          new Promise<ClassificationBook | null>((resolve) => {
            settle.push(resolve);
          }),
      }),
    );
    await answerAndShow(element);
    await reviseContext(element, () => choose(element, 'equipment', 'single-ply'));

    const [first, second] = settle;
    if (first === undefined || second === undefined) {
      throw new Error('Expected two reads to be in flight.');
    }
    // The second partition answers first, then the abandoned first one answers.
    second({ ...CLASSIFICATIONS, label: 'Single-ply standards' });
    first({ ...CLASSIFICATIONS, label: 'Raw standards' });

    await vi.waitFor(() => {
      expect(element.book?.label).toBe('Single-ply standards');
    });
    expect(element.book?.label).toBe('Single-ply standards');
  });
});

describe('loading the records for a report', () => {
  it('reads every level the report always shows, and asks for the federation book', async () => {
    const source = sourceThat();
    const element = mount(source);
    await answerRequired(element);

    expect(source.recordPartitions).toEqual([]);

    await showTargets(element);
    // National only. The state level is subdivided, and a subdivided level
    // produces no partition until a region is chosen -- asking for its records
    // without one would read an artifact nobody publishes.
    expect(source.recordPartitions).toEqual([`${FEDERATION_ID} national - female raw`]);
    expect(partitionLabels(element)).toEqual(['National']);
  });

  it('adds a state to the report without re-reading the levels already held', async () => {
    // Requirement 3: picking a state adds its records, it does not swap them in.
    const source = sourceThat();
    const element = mount(source);
    await answerAndShow(element);

    await reviseContext(element, () => pick(element, 'region', 'north-example'));

    expect(source.recordPartitions).toEqual([
      `${FEDERATION_ID} national - female raw`,
      `${FEDERATION_ID} state north-example female raw`,
    ]);
    // In the order the report lists them, which is the catalogue's own level
    // order and not the order the reads were issued in.
    expect(partitionLabels(element)).toEqual(['North Example State', 'National']);
  });

  it('drops a partition when the state is cleared', async () => {
    const source = sourceThat();
    const element = mount(source);
    await answerRequired(element);
    await pick(element, 'region', 'north-example');
    await showTargets(element);

    await reviseContext(element, () => pick(element, 'region', null));

    expect(partitionLabels(element)).toEqual(['National']);
    // And it is not re-read on the way back, because clearing a state does not
    // touch the artifact the national records live in.
    expect(source.recordPartitions).toHaveLength(2);
  });

  it('re-reads every partition when the equipment category changes', async () => {
    // The key the report files a book under is (level, region), but the artifact
    // is chosen by four axes. A cache keyed on the two the report *names* would
    // leave a lifter switching to single-ply looking at their raw records under
    // an unchanged heading.
    const source = sourceThat();
    const element = mount(source);
    await answerAndShow(element);
    await reviseContext(element, () => pick(element, 'region', 'north-example'));

    await reviseContext(element, () => choose(element, 'equipment', 'single-ply'));

    expect(source.recordPartitions).toEqual([
      `${FEDERATION_ID} national - female raw`,
      `${FEDERATION_ID} state north-example female raw`,
      `${FEDERATION_ID} state north-example female single-ply`,
      `${FEDERATION_ID} national - female single-ply`,
    ]);
  });

  it('never lets a read for a partition the report has dropped come back', async () => {
    const settle: ((book: RecordBook | null) => void)[] = [];
    const element = mount(
      sourceThat({
        records: () =>
          new Promise<RecordBook | null>((resolve) => {
            settle.push(resolve);
          }),
      }),
    );
    await answerAndShow(element);
    await reviseContext(element, () => pick(element, 'region', 'north-example'));
    await reviseContext(element, () => pick(element, 'region', null));

    const [national, north] = settle;
    if (national === undefined || north === undefined) {
      throw new Error('Expected two reads to be in flight.');
    }
    north(STATE_BOOK);
    national(BOOK);

    await vi.waitFor(() => {
      expect(readFor(element, 'National').status).toBe('ready');
    });
    expect(partitionLabels(element)).toEqual(['National']);
  });

  it('surfaces one failed partition without losing the one that succeeded', async () => {
    // The two reads are independent on purpose. Awaiting them together would
    // hold the whole report behind the slowest, and collapsing their statuses
    // would make a failed state read look like a federation that keeps no state
    // records -- which is a real answer nobody investigates.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = sourceThat({
      records: (query) =>
        query.levelId === 'state'
          ? Promise.reject(new DataSourceError('records-example-state', 'network'))
          : Promise.resolve(BOOK),
    });
    const element = mount(source);
    await answerRequired(element);
    await pick(element, 'region', 'north-example');
    await showTargets(element);

    await vi.waitFor(() => {
      expect(readFor(element, 'North Example State').status).toBe('failed');
    });
    expect(readFor(element, 'National').records).toBe(BOOK.records.length);
    expect(deepText(report(element))).toContain(
      'The North Example State records could not be loaded.',
    );
    expect(reported).toHaveBeenCalledWith('Platform Targets could not load the records: network.');
  });

  /**
   * The far end of the wiring: a book read over the seam, filed under a
   * partition key, laid out by `report.ts` and printed in a cell.
   *
   * Records are the second half of the report and a bar away, so the assertion
   * has to move the bar — which is the point. Reaching into the element's state
   * to jump there would leave the one control every visitor uses to see a record
   * unexercised in the assembled page, and it is the control that most recently
   * changed.
   */
  it('draws a record the lifter could take, from the partition it arrived in', async () => {
    const element = mount(sourceThat({ records: () => Promise.resolve(BOOK) }));
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(readFor(element, 'National').status).toBe('ready');
    });
    await moveBar(element, 'target-type', 'Records');

    const shown = deepText(report(element));
    expect(shown).toContain('National records');
    expect(shown).toContain('145 kg');
    // The cell holds the record. The weights that take it are behind it, so a
    // reader who has not opened one cannot mistake an attempt for the record.
    expect(shown).not.toContain('147.5 kg');
  });
});

/**
 * How old the figures are, and what happens when the network is not there.
 *
 * The state this tool is most often read in is the one hardest to arrange: a
 * phone at a rack with one bar, showing a copy the service worker saved on
 * Friday for a record that moved on Saturday. Nothing on the screen can tell
 * those apart, which is why the footer exists -- and why every assertion here is
 * on the sentence a lifter reads rather than on the state behind it.
 *
 * The three states divide on two questions and not one: whether the device has a
 * network, and whether anything was ever saved. Offline with a copy is a caution;
 * offline with none is the whole answer the screen has.
 */
describe('saying how current the figures are', () => {
  it('says when the figures on screen were last verified', async () => {
    const element = mount(sourceThat());
    await answerAndShow(element);

    await vi.waitFor(() => {
      expect(footerLine(element)).toContain('Last verified July 28, 2026.');
    });
    // The *oldest* retrieval across the index's sources. The records in this
    // fixture were retrieved two days later, and printing that date would let
    // the fastest source vouch for the slowest -- the exact misreading the
    // per-source shape exists to prevent.
    expect(footerLine(element)).not.toContain('July 30');
    // Said on screen and not out loud. It is true on every visit and changes
    // nothing a reader would do, and a region that speaks on every load is one
    // they have learned to ignore before the visit where it matters.
    expect(announced(element)).toBe('');
  });

  it('labels the report as a saved copy when the device goes offline', async () => {
    const element = mount(sourceThat());
    await answerAndShow(element);
    await vi.waitFor(() => {
      expect(footerLine(element)).toContain('Last verified');
    });

    await connectionBecomes(element, 'offline');

    expect(element.connection).toBe('offline');
    const line = 'Offline · Showing data last verified July 28, 2026.';
    expect(footerLine(element)).toContain(line);
    // And announced, because this is one of the two things a lifter cannot see
    // happening. The sentence is the same one on screen, from the same function,
    // so the two cannot come to disagree.
    expect(announced(element)).toBe(line);
  });

  it('says nothing has been saved yet when the index has never been read', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const element = mount(
      sourceThat({ meta: () => Promise.reject(new DataSourceError('data-meta', 'network')) }),
    );
    await vi.waitFor(() => {
      expect(element.dataMetaStatus).toBe('failed');
    });

    await connectionBecomes(element, 'offline');

    // The catalogue and the index are separate reads, so the federation's name
    // arrives on its own schedule -- and the sentence has to be right before it
    // does, which is why `categoryPhrase` has a form without one.
    await vi.waitFor(() => {
      expect(footerLine(element)).toContain('Example Federation');
    });
    expect(footerLine(element)).toContain(
      'Targets have not been saved on this device yet. Reconnect once to load this Example Federation category.',
    );
    // The reason code and nothing else. A `DataSourceError` has nowhere to put a
    // URL, but its cause is whatever the transport threw and a console expands a
    // cause chain -- which is where a request URL would otherwise surface.
    expect(reported).toHaveBeenCalledWith(
      'Platform Targets could not load the published index: network.',
    );
  });

  it('reads the index again when the footer is pressed, and only once at a time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending: (() => void)[] = [];
    let attempts = 0;
    const element = mount(
      sourceThat({
        meta: () => {
          attempts += 1;
          if (attempts === 1) {
            return Promise.reject(new DataSourceError('data-meta', 'network'));
          }
          return new Promise<DataMeta>((resolve) => {
            pending.push(() => {
              resolve(DATA_META);
            });
          });
        },
      }),
    );
    await vi.waitFor(() => {
      expect(element.dataMetaStatus).toBe('failed');
    });
    await connectionBecomes(element, 'offline');
    await vi.waitFor(() => {
      expect(footerLine(element)).toContain('Try again');
    });

    await retryFromFooter(element);
    expect(attempts).toBe(2);

    // A second press while that read is still in flight must issue nothing --
    // and the guard cannot be the status, because the status deliberately stays
    // `failed` for the length of the retry. The failed sentence is the only
    // thing on the screen in this state, and clearing it for a read that will
    // usually fail again in milliseconds is a line that flashes rather than a
    // state that changed. So the button is still there to press, and the
    // in-flight guard has to be its own.
    await retryFromFooter(element);
    expect(attempts).toBe(2);

    const finish = pending[0];
    if (finish === undefined) {
      throw new Error('Expected the second read to be in flight.');
    }
    finish();
    await vi.waitFor(() => {
      expect(element.dataMetaStatus).toBe('ready');
    });
  });

  it('re-reads only the partition that failed when the network comes back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let stateFails = true;
    const source = sourceThat({
      records: (query) => {
        if (query.levelId !== 'state') {
          return Promise.resolve(BOOK);
        }
        return stateFails
          ? Promise.reject(new DataSourceError('records-example-state', 'network'))
          : Promise.resolve(STATE_BOOK);
      },
    });
    const element = mount(source);
    await answerRequired(element);
    await pick(element, 'region', 'north-example');
    await showTargets(element);
    await vi.waitFor(() => {
      expect(readFor(element, 'North Example State').status).toBe('failed');
    });

    stateFails = false;
    await connectionBecomes(element, 'offline');
    await connectionBecomes(element, 'online');

    await vi.waitFor(() => {
      expect(readFor(element, 'North Example State').status).toBe('ready');
    });
    expect(readFor(element, 'North Example State').records).toBe(STATE_BOOK.records.length);
    // And the level that already answered was left alone. The published index is
    // held for the lifetime of the source so that one screen shows one build, so
    // re-reading a healthy partition can only return the same content-addressed
    // artifact -- at the cost of replacing figures a lifter is reading with
    // "Updating…" on the connection that made them want the button.
    expect(source.recordPartitions.filter((asked) => asked.includes(' national '))).toHaveLength(1);
  });

  it('leaves a partition failed, and holding nothing, when the retry fails too', async () => {
    // The guard against reintroducing a "this book may have been superseded"
    // state. There is no such outcome and there is nowhere for one to come from:
    // a read is only ever issued for a partition holding no book, so a second
    // failure has nothing to keep. Whether what is on screen is the newest
    // publication is a question about the whole of `meta.json`, and the footer
    // above is where it is asked.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = sourceThat({
      records: (query) =>
        query.levelId === 'state'
          ? Promise.reject(new DataSourceError('records-example-state', 'network'))
          : Promise.resolve(BOOK),
    });
    const element = mount(source);
    await answerRequired(element);
    await pick(element, 'region', 'north-example');
    await showTargets(element);
    await vi.waitFor(() => {
      expect(readFor(element, 'North Example State').status).toBe('failed');
    });
    const asked = source.recordPartitions.length;

    await connectionBecomes(element, 'offline');
    await connectionBecomes(element, 'online');

    await vi.waitFor(() => {
      expect(source.recordPartitions.length).toBe(asked + 1);
    });
    await vi.waitFor(() => {
      expect(readFor(element, 'North Example State').status).toBe('failed');
    });
    expect(readFor(element, 'North Example State').records).toBeNull();
    // The one that worked is still drawn, which is the whole reason the reads
    // are separate.
    expect(readFor(element, 'National').records).toBe(BOOK.records.length);
  });

  it('seeds the connection from the browser rather than assuming online', async () => {
    // A tool opened from the home screen in a basement has never had a network,
    // so there is no `offline` event to hear -- the seed is the only thing that
    // makes that visit say anything true. Restored by `vi.restoreAllMocks`.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const element = mount(sourceThat());

    expect(element.connection).toBe('offline');
    await element.updateComplete;
  });
});
