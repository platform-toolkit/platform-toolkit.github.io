import type { DataMeta } from '@platform-toolkit/data-contracts';
import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { PtkChoiceGroup, PtkSelect } from '@platform-toolkit/ui';
// The tap-target and 320 px measurements at the bottom read spacing tokens, and
// a declaration referencing an undefined custom property is dropped -- so
// without the stylesheet they measure a layout that is not the shipped one.
import '@platform-toolkit/ui/tokens.css';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import type { Connection, DataMetaStatus } from './freshness.js';
import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import './ptk-platform-targets.js';
import {
  SELECTION_APPLIED_EVENT,
  type PtkTargetCategories,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import type { PtkTargetContext } from './ptk-target-context.js';
import type { PtkTargetFreshness } from './ptk-target-freshness.js';
import type { PtkTargetGoals } from './ptk-target-goals.js';
import type { PtkTargetReport } from './ptk-target-report.js';
import { ANSWERED, CATALOG, CLASSIFICATIONS, DATA_META } from './records-fixture.js';
import type { CategorySelection, SelectionField } from './selection.js';
import { saveContext, saveView } from './session.js';

/**
 * The three phases, assembled.
 *
 * Everything below is about what happens *between* the children, because that is
 * all this element owns: the questions produce a context, the report consumes
 * it, and the two are never on screen together. Each child is tested alone
 * elsewhere and nothing here re-checks a figure or a label they already pin.
 *
 * The two claims that only exist at this level are the ones the 2026-08-02
 * review turned on. A returning visit has to open on the report rather than on a
 * form somebody filled in last week -- and the editor must not have a long
 * report behind it to reflow, which is asserted here as the report element not
 * being rendered at all rather than as a measurement of anything.
 *
 * Stage 3 added a third: the goal list. It is owned here and shown in two
 * places, so the panel a lifter commits in and the tray listing the commitment
 * are the two ends of a wire nothing below this element can test.
 *
 * The catalogue is invented (§5.1). Nothing that ships imports it.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface MountOptions {
  readonly settings?: PtkPlatformTargets['settings'];
  readonly catalog?: PtkPlatformTargets['catalog'];
}

/** A store with nothing in it yet, backed by memory rather than by the device. */
function emptyStore(): PtkPlatformTargets['settings'] {
  // Memory rather than `localStorage`: these tests share a page, and a store
  // that outlived one of them would make a later "first visit" a returning one
  // -- passing or failing on test order.
  return createPreferenceStore(memoryPreferenceStorage());
}

async function mount(options: MountOptions = {}): Promise<PtkPlatformTargets> {
  const element = document.createElement('ptk-platform-targets');
  element.catalog = options.catalog === undefined ? CATALOG : options.catalog;
  element.catalogStatus = 'ready';
  element.book = CLASSIFICATIONS;
  element.standardsStatus = 'ready';
  if (options.settings !== undefined) {
    element.settings = options.settings;
  }
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function root(element: PtkPlatformTargets): ShadowRoot {
  const { shadowRoot } = element;
  if (shadowRoot === null) throw new Error('The tool has no shadow root.');
  return shadowRoot;
}

function heading(element: PtkPlatformTargets): string {
  return root(element).querySelector('h2')?.textContent.trim() ?? '';
}

/** Which phase is on screen, read the way a lifter would tell. */
function showing(element: PtkPlatformTargets): {
  questions: boolean;
  context: boolean;
  report: boolean;
} {
  return {
    questions: root(element).querySelector('ptk-target-categories') !== null,
    context: root(element).querySelector('ptk-target-context') !== null,
    report: root(element).querySelector('ptk-target-report') !== null,
  };
}

function questions(element: PtkPlatformTargets): PtkTargetCategories {
  const found = root(element).querySelector('ptk-target-categories');
  if (found === null) throw new Error('The questions are not on screen.');
  return found;
}

function summary(element: PtkPlatformTargets): PtkTargetContext {
  const found = root(element).querySelector('ptk-target-context');
  if (found === null) throw new Error('The context summary is not on screen.');
  return found;
}

function report(element: PtkPlatformTargets): PtkTargetReport {
  const found = root(element).querySelector('ptk-target-report');
  if (found === null) throw new Error('The report is not on screen.');
  return found;
}

function group(element: PtkPlatformTargets, field: SelectionField): PtkChoiceGroup {
  const found = questions(element).shadowRoot?.querySelector(
    `ptk-choice-group[data-field="${field}"]`,
  );
  if (!(found instanceof PtkChoiceGroup)) throw new Error(`No choice group for "${field}".`);
  return found;
}

function picker(element: PtkPlatformTargets, field: SelectionField): PtkSelect {
  const found = questions(element).shadowRoot?.querySelector(`ptk-select[data-field="${field}"]`);
  if (!(found instanceof PtkSelect)) throw new Error(`No select for "${field}".`);
  return found;
}

/** Clicks an option the way a visitor would: on the radio itself. */
async function choose(
  element: PtkPlatformTargets,
  field: SelectionField,
  value: string,
): Promise<void> {
  const radios = group(element, field).shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" in the "${field}" group.`);
}

/**
 * Answers a picker.
 *
 * The value is set and `change` is fired, which is what the platform picker a
 * phone shows does on its way out; a select cannot be clicked into a value from
 * here. Firing `input` instead passes on Chromium and misses everything on an
 * engine that emits only one of the two.
 */
async function pick(
  element: PtkPlatformTargets,
  field: SelectionField,
  value: string | null,
): Promise<void> {
  const select = picker(element, field).shadowRoot?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`The "${field}" select has no options to open.`);
  }
  select.value = value ?? '';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

/** The native button inside one of the two actions, which is where a press lands. */
function action(element: PtkPlatformTargets, name: 'apply' | 'cancel'): HTMLButtonElement {
  const host = questions(element).shadowRoot?.querySelector(`ptk-button[data-action="${name}"]`);
  if (host === null || host === undefined) throw new Error(`No "${name}" action on screen.`);
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement))
    throw new Error(`The "${name}" action is not a button.`);
  return button;
}

async function press(element: PtkPlatformTargets, name: 'apply' | 'cancel'): Promise<void> {
  action(element, name).click();
  await element.updateComplete;
}

/** The summary, which is both the way into the editor and the way back out. */
function summaryButton(element: PtkPlatformTargets): HTMLButtonElement {
  const found = summary(element).shadowRoot?.querySelector('button');
  // Thrown rather than chained past: this is the control every editor test
  // presses, and a missing one would otherwise leave each of them asserting
  // that a screen nobody opened is still the screen it was.
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error('The context summary rendered no button.');
  }
  return found;
}

async function openEditor(element: PtkPlatformTargets): Promise<void> {
  summaryButton(element).click();
  await element.updateComplete;
}

/** The four required answers, entered the way a first visit enters them. */
async function answerEverythingRequired(element: PtkPlatformTargets): Promise<void> {
  await choose(element, 'sex', 'female');
  await choose(element, 'equipment', 'raw');
  await choose(element, 'tested', 'tested');
  await pick(element, 'weightClass', 'f-56');
}

/** Records every applied context that leaves the element. */
function watchApplied(): SelectionChangeDetail[] {
  const seen: SelectionChangeDetail[] = [];
  const listener = (event: CustomEvent<SelectionChangeDetail>): void => {
    seen.push(event.detail);
  };
  // On the body: the transport listens outside this element, so the claim is
  // that the event crossed the shadow boundary rather than that it was fired.
  document.body.addEventListener(SELECTION_APPLIED_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(SELECTION_APPLIED_EVENT, listener);
  });
  return seen;
}

/** A store that already holds a context, as a device that has been here before. */
function returningStore(selection: CategorySelection = ANSWERED): PtkPlatformTargets['settings'] {
  const store = emptyStore();
  // Written through the tool's own writers rather than poked in, so a change to
  // the storage shape fails here as well as in `session.test.ts`.
  saveContext(store, selection);
  return store;
}

function tray(element: PtkPlatformTargets): PtkTargetGoals {
  const found = root(element).querySelector('ptk-target-goals');
  if (found === null) throw new Error('The goal tray is not on screen.');
  return found;
}

function trayRoot(element: PtkPlatformTargets): ShadowRoot {
  const { shadowRoot } = tray(element);
  if (shadowRoot === null) throw new Error('The goal tray has no shadow root.');
  return shadowRoot;
}

/**
 * One name per saved goal, read off the control that would forget it.
 *
 * The tray's own text is a paragraph per row and would need reassembling to
 * compare; the remove button's accessible name is the whole of what the tool
 * calls that goal, in one string, built by the same `describeGoal` the panel
 * used. Comparing the two ends of the wire is the point of this file.
 */
function saved(element: PtkPlatformTargets): string[] {
  return [...trayRoot(element).querySelectorAll('.remove')].map(
    (control) => control.getAttribute('aria-label') ?? '',
  );
}

function trayButton(element: PtkPlatformTargets, selector: string): HTMLButtonElement {
  const found = trayRoot(element).querySelector(selector);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`The tray has no "${selector}".`);
  return found;
}

/** What the report's live region currently says. */
function status(element: PtkPlatformTargets): string {
  return report(element).shadowRoot?.querySelector('.goal-status')?.textContent.trim() ?? '';
}

/** Every cell the matrix is currently marking as committed to. */
function flagged(element: PtkPlatformTargets): string[] {
  const flags = report(element).shadowRoot?.querySelectorAll('.flag') ?? [];
  // Filtered rather than selected on: `reached` and `next` draw a flag of their
  // own in the same slot, so a bare count would rise the moment somebody types
  // a weight and would say nothing about goals at all.
  return [...flags].map((flag) => flag.textContent.trim()).filter((label) => label === 'Goal');
}

const SAVE_PREFIX = 'Set as goal: ';

/**
 * Commits to the first published figure in the report, and answers what the
 * tool calls it.
 *
 * Two presses, because that is the flow the review specifies: a value cell
 * opens, and the panel it opens is where the commitment is made. The name comes
 * off the button rather than being written out here — the panel and the tray
 * both build it with `describeGoal`, so taking it from one end is what makes an
 * assertion about the other end mean anything.
 */
async function saveFirstGoal(element: PtkPlatformTargets): Promise<string> {
  const panel = report(element);
  const cell = panel.shadowRoot?.querySelector('button.cell-button');
  if (!(cell instanceof HTMLButtonElement)) throw new Error('No target cell on screen.');
  cell.click();
  await element.updateComplete;

  const button = goalAction(element);
  const name = button.getAttribute('aria-label') ?? '';
  if (!name.startsWith(SAVE_PREFIX)) throw new Error(`Unexpected goal button name: "${name}".`);
  button.click();
  await element.updateComplete;
  return name.slice(SAVE_PREFIX.length);
}

/** The commit control in whichever panel is open. */
function goalAction(element: PtkPlatformTargets): HTMLButtonElement {
  const found = report(element).shadowRoot?.querySelector('button.goal-button');
  if (!(found instanceof HTMLButtonElement)) throw new Error('The open panel offers no goal.');
  return found;
}

/** Files the first saved goal under a horizon, from inside the select's own root. */
async function fileUnder(element: PtkPlatformTargets, value: string): Promise<void> {
  const select = trayRoot(element).querySelector('ptk-select');
  if (!(select instanceof PtkSelect)) throw new Error('The tray has no horizon control.');
  const control = select.shadowRoot?.querySelector('select');
  if (!(control instanceof HTMLSelectElement)) {
    throw new Error('The horizon control rendered no select.');
  }
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Whether the optional lift entry is unfolded. */
function liftsOpen(element: PtkPlatformTargets): boolean {
  const details = root(element)
    .querySelector('ptk-target-lifts')
    ?.shadowRoot?.querySelector('ptk-disclosure')
    ?.shadowRoot?.querySelector('details');
  if (!(details instanceof HTMLDetailsElement)) throw new Error('The lift entry has no fold.');
  return details.open;
}

/** Types a squat, which is the lift the report opens on. */
async function typeSquat(element: PtkPlatformTargets, text: string): Promise<void> {
  const input = root(element)
    .querySelector('ptk-target-lifts')
    ?.shadowRoot?.querySelector('ptk-number-field[data-lift="squat"]')
    ?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No squat field to type into.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** The provenance footer, which is outside the phase switch and so always mounted. */
function footer(element: PtkPlatformTargets): PtkTargetFreshness {
  const found = root(element).querySelector('ptk-target-freshness');
  if (found === null) throw new Error('The freshness footer is not mounted.');
  return found;
}

/** What the footer says, or `''` when it has decided there is nothing true to say. */
function footerLine(element: PtkPlatformTargets): string {
  return footer(element).shadowRoot?.querySelector('.line')?.textContent.trim() ?? '';
}

function announcer(element: PtkPlatformTargets): Element {
  const found = root(element).querySelector('.announcer');
  if (found === null) throw new Error('The tool has no live region.');
  return found;
}

function announced(element: PtkPlatformTargets): string {
  return announcer(element).textContent.trim();
}

/**
 * The tool's own children in document order.
 *
 * Only the two ends are ever asserted on. The review fixes both -- the live
 * region first so it exists before anything it will announce, the provenance
 * footnote last because it answers a question a reader asks after reading a
 * number -- and everything between them is the phase switch, which the tests
 * above already own.
 */
function order(element: PtkPlatformTargets): string[] {
  return [...root(element).children].map((child) =>
    child.classList.contains('announcer') ? 'announcer' : child.localName,
  );
}

interface TransportState {
  readonly connection?: Connection;
  readonly meta?: DataMeta | null;
  readonly metaStatus?: DataMetaStatus;
}

/**
 * Sets what the transport knows, which {@link mount} deliberately leaves alone.
 *
 * `mount` seeds a catalogue and a book because every test above needs them; it
 * seeds none of these, so those tests all run with no index, a loading status and
 * an assumed connection -- the state in which the footer says nothing at all.
 * That is why adding a footer to every screen broke none of them.
 */
async function transport(element: PtkPlatformTargets, state: TransportState): Promise<void> {
  if (state.connection !== undefined) {
    element.connection = state.connection;
  }
  if (state.meta !== undefined) {
    element.dataMeta = state.meta;
  }
  if (state.metaStatus !== undefined) {
    element.dataMetaStatus = state.metaStatus;
  }
  await element.updateComplete;
}

describe('ptk-platform-targets', () => {
  /**
   * A first visit is the setup screen and nothing else.
   *
   * Not a report with an empty state under a form: the review's finding was that
   * a page opening as an unanswered questionnaire *plus* a placeholder gives a
   * lifter two things to read before either says anything.
   */
  it('opens a first visit on the questions alone', async () => {
    const element = await mount({ settings: emptyStore() });
    expect(heading(element)).toBe('Set up your targets');
    expect(showing(element)).toEqual({ questions: true, context: false, report: false });
  });

  it('names the four answers it needs before it can show anything', async () => {
    const element = await mount({ settings: emptyStore() });
    const lead = root(element).querySelector('.lead')?.textContent.trim() ?? '';
    expect(lead).toBe(
      // The federation's own name, from the catalogue. Never a literal in code
      // (§5.1) -- and this assertion is what proves that, since the fixture's
      // label is deliberately not the federation the site actually publishes.
      'Choose sex category, equipment, tested status, and a weight class to show Example Federation targets.',
    );
  });

  it('shows the report once the required answers are applied', async () => {
    const element = await mount({ settings: emptyStore() });
    await answerEverythingRequired(element);
    await press(element, 'apply');

    expect(showing(element)).toEqual({ questions: false, context: true, report: true });
    expect(report(element).selection.weightClass).toBe('f-56');
  });

  /**
   * Answering is not applying. The whole point of the batch is that a lifter
   * changing their class and their division makes one move rather than two
   * reflows of a long report, and a screen that swapped itself out as soon as
   * the fourth answer landed would take the other three controls away mid-edit.
   */
  it('stays on the questions until the action is pressed', async () => {
    const element = await mount({ settings: emptyStore() });
    await answerEverythingRequired(element);
    expect(showing(element).report).toBe(false);
  });

  /**
   * Focus follows, because the button that was pressed no longer exists. Left
   * where it was it falls back to the document body, and a keyboard user's next
   * Tab starts again from the top of the page -- past everything they just asked
   * to see.
   */
  it('moves focus to the result heading after the action', async () => {
    const element = await mount({ settings: emptyStore() });
    await answerEverythingRequired(element);
    await press(element, 'apply');

    const target = report(element);
    expect(target.shadowRoot?.activeElement).toBe(target.shadowRoot?.querySelector('h2'));
  });

  it('tells the page about the applied context, once', async () => {
    const element = await mount({ settings: emptyStore() });
    const seen = watchApplied();
    await answerEverythingRequired(element);
    await press(element, 'apply');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.ready).toBe(true);
    expect(seen[0]?.selection.weightClass).toBe('f-56');
    // The partitions ride along: the transport reads them off this event rather
    // than resolving the selection a second time.
    expect(seen[0]?.partitions.map((partition) => partition.levelId)).toContain('national');
  });

  /**
   * The editor has no report behind it.
   *
   * The review is explicit that a long report must not reflow after every tap in
   * the context editor, and the usual fix -- render it and hide it -- keeps the
   * layout cost and adds a second copy of the screen for a reader to walk. This
   * is the assertion that makes the guarantee structural: there is nothing to
   * reflow because there is nothing there.
   */
  it('takes the report off the screen while the context is being edited', async () => {
    const element = await mount({ settings: returningStore() });
    await openEditor(element);

    expect(heading(element)).toBe('Edit context');
    expect(showing(element)).toEqual({ questions: true, context: false, report: false });
  });

  /**
   * The same hazard as the apply press, on the transition nobody thinks about:
   * opening the editor removes the summary that was pressed to open it, so focus
   * falls to the document body and a keyboard user's next Tab starts at the top
   * of the page -- with nothing announced to say the screen changed under them.
   */
  it('moves focus to the editor heading when the context is opened', async () => {
    const element = await mount({ settings: returningStore() });
    await openEditor(element);

    const target = root(element).querySelector('section h2');
    // Asserted to exist before it is compared against. Both sides of the
    // comparison below are nullable, so a renamed heading would make the whole
    // claim `null === null` -- a test that passes by measuring neither the
    // heading nor where focus went.
    expect(target).not.toBeNull();
    expect(root(element).activeElement).toBe(target);
  });

  it('offers a way out of the editor that the first run does not', async () => {
    const first = await mount({ settings: emptyStore() });
    expect(first.shadowRoot?.querySelector('ptk-button[data-action="cancel"]')).toBeNull();
    expect(() => action(first, 'cancel')).toThrow();

    const returning = await mount({ settings: returningStore() });
    await openEditor(returning);
    expect(action(returning, 'cancel').isConnected).toBe(true);
  });

  /**
   * An abandoned edit changes nothing, including the answers the editor opens
   * with next time. The questions element is discarded on cancel but the seed it
   * was handed is not, so without resetting it a lifter who backed out half way
   * through would find their abandoned draft waiting for them.
   */
  it('discards an abandoned edit, and does not reopen on it', async () => {
    const element = await mount({ settings: returningStore() });
    await openEditor(element);

    await pick(element, 'weightClass', 'f-52');
    await press(element, 'cancel');
    expect(showing(element).report).toBe(true);
    expect(report(element).selection.weightClass).toBe('f-56');

    await openEditor(element);
    expect(picker(element, 'weightClass').value).toBe('f-56');
  });

  /**
   * And an abandoned edit returns focus to the control it was started from,
   * which is the one transition of the three that does *not* go to the report.
   * Nothing changed, so the report heading would announce a fresh result for an
   * edit the lifter backed out of; the invoker is the only landing place that
   * says "you are where you were".
   */
  it('returns focus to the summary when the edit is abandoned', async () => {
    const element = await mount({ settings: returningStore() });
    await openEditor(element);
    await press(element, 'cancel');

    // Two assertions because focus inside a shadow tree is reported at every
    // level: the root points at the host, and only the host's own root says
    // which of its controls has it.
    expect(root(element).activeElement).toBe(summary(element));
    expect(summary(element).shadowRoot?.activeElement).toBe(summaryButton(element));
  });

  it('redraws the report for an applied edit', async () => {
    const element = await mount({ settings: returningStore() });
    await openEditor(element);

    await pick(element, 'division', 'masters-1');
    await press(element, 'apply');
    expect(report(element).selection.division).toBe('masters-1');
  });

  /**
   * The returning visit, which is the whole difference between a tool consulted
   * at a rack and a form filled in at one.
   */
  it('opens a returning visit on the report, with no setup screen in between', async () => {
    const element = await mount({ settings: returningStore() });
    expect(showing(element)).toEqual({ questions: false, context: true, report: true });
    expect(report(element).selection.weightClass).toBe('f-56');
  });

  it('announces a restored context so the data behind it is read', async () => {
    // A visit that only *rendered* its remembered context would show a report
    // with no data behind it and no request in flight -- which on screen is a
    // federation that publishes nothing.
    const seen = watchApplied();
    await mount({ settings: returningStore() });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.selection.weightClass).toBe('f-56');
  });

  it('does not steal focus on a visit that merely loaded', async () => {
    // Moving focus is right after a press and wrong after a page load: focus
    // belongs at the top of the document, and taking it is how a reader misses
    // the heading and the context above the report.
    const element = await mount({ settings: returningStore() });
    expect(report(element).shadowRoot?.activeElement).toBeNull();
  });

  it('announces the restored context once, not on every later update', async () => {
    const seen = watchApplied();
    const element = await mount({ settings: returningStore() });
    element.standardsStatus = 'loading';
    await element.updateComplete;
    element.standardsStatus = 'ready';
    await element.updateComplete;
    expect(seen).toHaveLength(1);
  });

  /**
   * A remembered answer this federation no longer offers does not open a report.
   *
   * The restore is promoted by the *resolver*, never by the stored value alone:
   * a renamed weight class would otherwise open a returning lifter straight into
   * a report drawn for a category that does not exist.
   */
  it('falls back to the setup screen when the remembered class is gone', async () => {
    const element = await mount({
      settings: returningStore({ ...ANSWERED, weightClass: 'f-nonexistent' }),
    });
    expect(heading(element)).toBe('Set up your targets');
    // Seeded with what survived, so the lifter re-picks one answer rather than
    // all four.
    expect(group(element, 'sex').value).toBe('female');
    expect(picker(element, 'weightClass').value).toBeNull();
  });

  it('remembers an applied context for the next visit', async () => {
    const store = emptyStore();
    const first = await mount({ settings: store });
    await answerEverythingRequired(first);
    await pick(first, 'division', 'masters-1');
    await press(first, 'apply');

    const second = await mount({ settings: store });
    expect(showing(second).report).toBe(true);
    expect(report(second).selection.division).toBe('masters-1');
  });

  /**
   * And remembers where the two bars were left, which is the other half of a
   * returning visit: a lifter who came back to check the bench press records is
   * not asking to start at the squat's classifications again.
   */
  it('opens the bars where the last visit left them', async () => {
    const store = returningStore();
    saveView(store, 'bench', 'records');
    const element = await mount({ settings: store });
    expect(report(element).initialLift).toBe('bench');
    expect(report(element).initialTargetType).toBe('records');
  });

  it('does not remember a draft, only an applied context', async () => {
    // Storing on every tap would leave a half-edited category behind for the
    // next visit to restore, from an edit the lifter closed without applying.
    const store = emptyStore();
    const element = await mount({ settings: store });
    await answerEverythingRequired(element);

    const next = await mount({ settings: store });
    expect(showing(next).report).toBe(false);
  });

  /**
   * The lift entries reach the report and stop there. They are the panel's own
   * state -- mirrored downward, never written back -- because a round trip would
   * make a keystroke depend on this element being mounted, and the panel is
   * mounted alone in half its tests.
   */
  it('mirrors the entered lifts into the report', async () => {
    const element = await mount({ settings: returningStore() });
    await typeSquat(element, '120');
    expect(report(element).entries.fields.squat.text).toBe('120');
  });

  /**
   * The goal list is owned here and shown in two places, which is the whole
   * reason it is owned here: the panel a lifter commits in and the tray listing
   * the commitment are siblings, and either keeping its own copy is two lists
   * that agree until one of them is wrong. Everything below is a claim about the
   * wire between them, never about what either end draws.
   */
  it('lists a goal committed to in the report, under the name the report used', async () => {
    const element = await mount({ settings: returningStore() });
    const spoken = await saveFirstGoal(element);
    expect(saved(element)).toEqual([`Remove goal: ${spoken}`]);
  });

  /**
   * The report holds keys rather than goals, so the tray and the matrix cannot
   * disagree about what is saved without one of them being handed the wrong set.
   */
  it('marks the figure in the matrix it was committed to from', async () => {
    const element = await mount({ settings: returningStore() });
    expect(flagged(element)).toEqual([]);
    await saveFirstGoal(element);
    expect(flagged(element)).toEqual(['Goal']);
  });

  /**
   * A press that changes the list says so, because the tray is below the fold on
   * a phone and the flag in the cell is the only other evidence. Announced by
   * the report rather than by the tray: the tray does not exist until the first
   * goal is in it, and a live region created in the same update as its own text
   * is not announced at all.
   */
  it('says what happened to the list, in one place, for both ends', async () => {
    const element = await mount({ settings: returningStore() });
    const spoken = await saveFirstGoal(element);
    expect(status(element)).toBe(`Saved goal: ${spoken}.`);

    trayButton(element, '.remove').click();
    await element.updateComplete;
    expect(status(element)).toBe(`Removed goal: ${spoken}.`);
  });

  it('takes a commitment back from the panel it was made in', async () => {
    const element = await mount({ settings: returningStore() });
    await saveFirstGoal(element);
    goalAction(element).click();
    await element.updateComplete;

    expect(saved(element)).toEqual([]);
    expect(flagged(element)).toEqual([]);
  });

  it('takes a commitment back from the tray, and clears the flag with it', async () => {
    const element = await mount({ settings: returningStore() });
    await saveFirstGoal(element);
    trayButton(element, '.remove').click();
    await element.updateComplete;

    expect(saved(element)).toEqual([]);
    expect(flagged(element)).toEqual([]);
  });

  /**
   * A goal a lifter set at a rack and lost on the walk back to the platform is
   * worse than no goal feature. Written on the press, not on unload.
   */
  it('remembers a goal for the next visit', async () => {
    const store = returningStore();
    const first = await mount({ settings: store });
    const spoken = await saveFirstGoal(first);

    const second = await mount({ settings: store });
    expect(saved(second)).toEqual([`Remove goal: ${spoken}`]);
  });

  it('forgets one that was removed', async () => {
    const store = returningStore();
    const first = await mount({ settings: store });
    await saveFirstGoal(first);
    trayButton(first, '.remove').click();
    await first.updateComplete;

    const second = await mount({ settings: store });
    expect(saved(second)).toEqual([]);
  });

  /**
   * Filing a goal is the one goal action a lifter does several times in a row,
   * and the select they just used already shows the answer — so it is written
   * and not announced. Asserting the sentence is *unchanged* rather than empty:
   * a message cleared on every tag change would take the save announcement away
   * before a screen reader reached it.
   */
  it('remembers a horizon without announcing it', async () => {
    const store = returningStore();
    const first = await mount({ settings: store });
    const spoken = await saveFirstGoal(first);
    await fileUnder(first, 'next-meet');
    expect(status(first)).toBe(`Saved goal: ${spoken}.`);

    const second = await mount({ settings: store });
    const select = trayRoot(second).querySelector('ptk-select');
    expect(select instanceof PtkSelect ? select.value : null).toBe('next-meet');
  });

  /**
   * The tray's secondary action reaches a sibling, so the root is what connects
   * them — the tray cannot open a panel it is not inside of, and an element that
   * reached across to one could not be mounted alone.
   */
  it('opens the lift entry when a saved goal asks for a figure to compare', async () => {
    const element = await mount({ settings: returningStore() });
    await saveFirstGoal(element);
    expect(liftsOpen(element)).toBe(false);

    trayButton(element, '.add-lifts').click();
    await element.updateComplete;
    expect(liftsOpen(element)).toBe(true);
  });

  /**
   * The other half of that: what gets typed into the panel has to reach the tray,
   * or the action above opens a form that changes nothing. The arithmetic itself
   * is `goals.ts`; what is asserted here is that both figures arrived.
   */
  it('mirrors the entered lifts into the tray, which is what makes the gap appear', async () => {
    const element = await mount({ settings: returningStore() });
    await saveFirstGoal(element);
    expect(deepText(tray(element))).not.toContain('Current best');

    await typeSquat(element, '120');
    expect(deepText(tray(element))).toContain('Current best 120 kg');
  });

  /*
   * How current the figures are, and how that is said.
   *
   * Two surfaces, both deliberately outside the phase switch, and everything
   * below is a claim that only exists at this level. `freshness.ts` decides the
   * words and is tested alone; `ptk-target-freshness` draws them and is tested
   * alone; `view.browser.test.ts` owns the wire from the network to these
   * properties. What is left over -- and it is the part a reader actually
   * experiences -- is *where on the page* each of them is, and on which screens.
   */

  /**
   * The state the footer exists for is only reachable on the setup screen.
   *
   * A lifter who installed the tool from a hotel lobby and then walked into a
   * basement gym never gets past the questions: nothing is cached, so no report
   * can be drawn, so a footer rendered only with the report would be silent in
   * precisely the one situation where this line is the entire answer. Asserted
   * here rather than in the footer's own tests because the footer cannot know
   * which screen it is under.
   */
  it('explains an empty cache on the setup screen, where that state lives', async () => {
    const element = await mount({ settings: emptyStore() });
    await transport(element, { connection: 'offline', metaStatus: 'failed' });

    expect(showing(element)).toEqual({ questions: true, context: false, report: false });
    expect(footerLine(element)).toBe(
      // The federation's own name again, from the catalogue and never a literal
      // (§5.1) -- and the sentence has to survive the catalogue being unread,
      // which is the case `categoryPhrase` exists for.
      'Targets have not been saved on this device yet. Reconnect once to load this Example Federation category.',
    );
  });

  /**
   * On the setup screen there are no figures, so there is no date to put on them.
   *
   * This is the assertion behind `showingData`, and it is worth making with the
   * index read *successfully* and the device offline -- the one combination where
   * a careless implementation has everything it needs to print a reassuring
   * "showing your saved copy" over a screen that is showing nothing.
   */
  it('does not date a screen that has no figures on it yet', async () => {
    const element = await mount({ settings: emptyStore() });
    await transport(element, { connection: 'offline', meta: DATA_META, metaStatus: 'ready' });
    expect(footerLine(element)).toBe('');

    await answerEverythingRequired(element);
    await press(element, 'apply');
    expect(footerLine(element)).toBe('Offline · Showing data last verified July 28, 2026.');
  });

  /**
   * The editor is the same case seen from the other side: a returning lifter who
   * opens it has read a dated report a second ago, and the report is gone while
   * they edit. The line goes with it rather than hanging under a form, because a
   * date under a form is a date on the answers being typed.
   */
  it('goes quiet while the context is being edited, without leaving the page', async () => {
    const element = await mount({ settings: returningStore() });
    await transport(element, { meta: DATA_META, metaStatus: 'ready' });
    expect(footerLine(element)).toBe('Last verified July 28, 2026.');

    const before = footer(element);
    await openEditor(element);

    expect(heading(element)).toBe('Edit context');
    expect(footerLine(element)).toBe('');
    expect(footer(element)).toBe(before);
  });

  /** First and last on every screen, which is the order the review fixes. */
  it('puts the live region first and the provenance line last, on both screens', async () => {
    const element = await mount({ settings: emptyStore() });
    expect(order(element).at(0)).toBe('announcer');
    expect(order(element).at(-1)).toBe('ptk-target-freshness');

    await answerEverythingRequired(element);
    await press(element, 'apply');
    expect(order(element).at(0)).toBe('announcer');
    // Below the goal tray *and* below the optional lift entry: a provenance
    // footnote with a data-entry fold under it is a page that visibly continues
    // past its own end the moment somebody opens the fold.
    expect(order(element).at(-1)).toBe('ptk-target-freshness');
  });

  /**
   * One region for the life of the page, not one per phase.
   *
   * A live region is announced by comparing what it holds now against what it
   * held before. A region created in the same render as its first text has
   * nothing to be compared against and is unreliably announced -- and every phase
   * change here replaces the whole screen, so a region rendered inside the switch
   * would be a brand new region on every announcement it ever made.
   */
  it('keeps one live region across a phase change', async () => {
    const element = await mount({ settings: emptyStore() });
    const region = announcer(element);
    expect(region.getAttribute('role')).toBe('status');

    await answerEverythingRequired(element);
    await press(element, 'apply');
    expect(announcer(element)).toBe(region);
    expect(region.isConnected).toBe(true);
  });

  /**
   * The ordinary case says nothing.
   *
   * "Last verified …" is true on every visit and changes nothing about what a
   * reader should do. A region that speaks on every load is a region a reader
   * learns to ignore before the one time it matters -- so the footnote is
   * written and the announcement withheld.
   */
  it('writes the ordinary date without announcing it', async () => {
    const element = await mount({ settings: returningStore() });
    await transport(element, { meta: DATA_META, metaStatus: 'ready' });

    expect(footerLine(element)).toBe('Last verified July 28, 2026.');
    expect(announced(element)).toBe('');
  });

  /**
   * When it does speak, it speaks the words on the screen.
   *
   * Both come from one `readFreshness` call in this element, which is the only
   * reason they cannot drift; a second call, or a remembered string, would let a
   * reader hear one sentence and find another. Asserting the equality rather than
   * the literal on both sides is what would catch that.
   */
  it('announces exactly what the footer says, when there is something to say', async () => {
    const element = await mount({ settings: returningStore() });
    await transport(element, { connection: 'offline', meta: DATA_META, metaStatus: 'ready' });

    expect(footerLine(element)).toBe('Offline · Showing data last verified July 28, 2026.');
    expect(announced(element)).toBe(footerLine(element));
  });

  it('holds together in a 320 pixel column, on both screens', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mount({ settings: emptyStore() });
    frame.append(element);
    await element.updateComplete;
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);

    await answerEverythingRequired(element);
    await press(element, 'apply');
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
