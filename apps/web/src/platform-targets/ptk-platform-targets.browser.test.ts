import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { PtkChoiceGroup, PtkSelect } from '@platform-toolkit/ui';
// The tap-target and 320 px measurements at the bottom read spacing tokens, and
// a declaration referencing an undefined custom property is dropped -- so
// without the stylesheet they measure a layout that is not the shipped one.
import '@platform-toolkit/ui/tokens.css';
import { afterEach, describe, expect, it } from 'vitest';

import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import './ptk-platform-targets.js';
import {
  SELECTION_APPLIED_EVENT,
  type PtkTargetCategories,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import type { PtkTargetContext } from './ptk-target-context.js';
import type { PtkTargetReport } from './ptk-target-report.js';
import { ANSWERED, CATALOG, CLASSIFICATIONS } from './records-fixture.js';
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
      'Choose sex category, equipment, tested status, and a weight class to show USPA targets.',
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
    summary(element).shadowRoot?.querySelector('button')?.click();
    await element.updateComplete;

    expect(heading(element)).toBe('Edit context');
    expect(showing(element)).toEqual({ questions: true, context: false, report: false });
  });

  it('offers a way out of the editor that the first run does not', async () => {
    const first = await mount({ settings: emptyStore() });
    expect(first.shadowRoot?.querySelector('ptk-button[data-action="cancel"]')).toBeNull();
    expect(() => action(first, 'cancel')).toThrow();

    const returning = await mount({ settings: returningStore() });
    summary(returning).shadowRoot?.querySelector('button')?.click();
    await returning.updateComplete;
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
    summary(element).shadowRoot?.querySelector('button')?.click();
    await element.updateComplete;

    await pick(element, 'weightClass', 'f-52');
    await press(element, 'cancel');
    expect(showing(element).report).toBe(true);
    expect(report(element).selection.weightClass).toBe('f-56');

    summary(element).shadowRoot?.querySelector('button')?.click();
    await element.updateComplete;
    expect(picker(element, 'weightClass').value).toBe('f-56');
  });

  it('redraws the report for an applied edit', async () => {
    const element = await mount({ settings: returningStore() });
    summary(element).shadowRoot?.querySelector('button')?.click();
    await element.updateComplete;

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
    const panel = root(element).querySelector('ptk-target-lifts');
    const input = panel?.shadowRoot
      ?.querySelector('ptk-number-field[data-lift="squat"]')
      ?.shadowRoot?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('No squat field to type into.');
    input.value = '120';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await element.updateComplete;

    expect(report(element).entries.fields.squat.text).toBe('120');
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
