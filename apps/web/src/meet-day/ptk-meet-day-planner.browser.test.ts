// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The root, and the four things only the root can be wrong about.
 *
 * Every element below it has its own browser test, and none of those can fail
 * for any of the reasons here. What this file covers is the wiring between them:
 *
 * 1. **Routing.** Every answer in this tool leaves a shared component's own
 *    shadow tree as a composed event, and the root identifies it by walking
 *    `event.composedPath()` for `data-field` and `data-lift`. A root that read
 *    `event.target` would see itself, with an empty dataset -- controls that
 *    visibly respond while nothing is recorded (§5.8). That failure is invisible
 *    to a component test, because inside a component the target is the control.
 * 2. **The transport seam.** `FEDERATION_CHANGE_EVENT` is how the chosen
 *    federation reaches `view.ts`, which is the only file in the tool that knows
 *    a network exists. It carries the identifier rather than leaving the listener
 *    to read the property back, and a test that asserted only that it fired would
 *    pass against the version that races.
 * 3. **The five plan-slot answers**, of which exactly one is a fault. A screen
 *    that greeted a still-running read with a warning would open by reporting a
 *    problem that resolves itself in a hundred millisecond.
 * 4. **The unit change**, which is the one interaction that touches every figure
 *    on screen at once and is the reason `typedIn` exists.
 *
 * Every session here is reached by pressing something, not by assignment. The
 * root's `session` is private on purpose, and driving it is the only way to prove
 * the path a lifter takes rather than the path a test can reach.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import type { MeetAction } from '@platform-toolkit/domain';
import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { manualClock, type ManualClock } from '../clock.js';
import { deepText } from '../testing/deep-text.js';
import {
  CONVERT_ANSWER,
  KEEP_ANSWER,
  MEET_IS_RUNNING_NOTE,
  START_MEET_NEEDS_A_PLAN,
} from './copy.js';
import {
  CONFIRM_FIELD,
  CONVERT_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FORMAT_FIELD,
  LIFTER_NAME_FIELD,
  OTHER_WEIGHT_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { PROBABILITY_WORDS, PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import { UNDO_REQUEST_EVENT, type UndoRequestDetail } from './ptk-live-screen.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import {
  FEDERATION_CHANGE_EVENT,
  type FederationChangeDetail,
  type PtkMeetDayPlanner,
} from './ptk-meet-day-planner.js';
import './ptk-meet-day-planner.js';
import { MEET_DAY_PREFERENCES, loadSession, saveSession } from './session.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly settings?: PreferenceStore;
  readonly profiles?: readonly MeetRuleProfile[];
  readonly status?: ProfilesStatus;
  readonly within?: HTMLElement;
  readonly clock?: ManualClock;
}

/**
 * A fixed instant, so nothing on these screens depends on when the suite runs.
 *
 * Every mount gets a manual clock whether or not the test names one. The live
 * screen repaints off the seam four times a second, so a root left on the real
 * clock would redraw underneath an assertion for no reason the test can see --
 * and the failure would be intermittent, which is the worst kind to inherit.
 */
const FIXED_INSTANT = 1_000_000_000_000;

/** A store with no browser behind it, so no test can reach the real device. */
function device(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

async function mount(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = document.createElement('ptk-meet-day-planner');
  element.settings = options.settings ?? device();
  element.profiles = options.profiles ?? PROFILE_FIXTURES;
  element.status = options.status ?? 'ready';
  element.clock = options.clock ?? manualClock(FIXED_INSTANT);
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * A mounted root with a federation already chosen, by pressing the tile.
 *
 * Not by seeding the store: `saveSession` deliberately does not persist the
 * federation (a federation is a fact about one meet, not a preference), so
 * pressing it is not one way in among several -- it is the only one.
 */
async function mountChosen(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = await mount(options);
  await choose(element, FEDERATION_FIELD, (options.profiles ?? PROFILE_FIXTURES)[0]?.id ?? '');
  return element;
}

/** Every element in the tool, across all four child shadow trees. */
function controls(element: PtkMeetDayPlanner, selector: string): Element[] {
  const roots = [
    element.shadowRoot,
    ...[...(element.shadowRoot?.querySelectorAll('*') ?? [])].map((child) => child.shadowRoot),
  ];
  return roots.flatMap((root) => [...(root?.querySelectorAll(selector) ?? [])]);
}

/**
 * The one control answering a field, wherever in the tool it lives.
 *
 * Searched across the children rather than named by child, because which element
 * owns a question is this tool's business and not this test's: the confirmation
 * moved from the plan screen to the method element while it was being written,
 * and every test naming its owner would have failed for no reason.
 */
function control(element: PtkMeetDayPlanner, field: string, lift?: string): Element {
  const selector =
    lift === undefined ? `[data-field="${field}"]` : `[data-field="${field}"][data-lift="${lift}"]`;
  const found = controls(element, selector);
  if (found.length !== 1) {
    throw new Error(`Expected one control for "${field}", found ${String(found.length)}.`);
  }
  // Checked rather than asserted: `found[0]` is `Element | undefined` under
  // `noUncheckedIndexedAccess`, and the length check above does not narrow it.
  const first = found[0];
  if (first === undefined) throw new Error(`No control for "${field}".`);
  return first;
}

/** Answers a question by clicking the radio, the way a lifter does. */
async function choose(
  element: PtkMeetDayPlanner,
  field: string,
  value: string,
  lift?: string,
): Promise<void> {
  const radio = [
    ...(control(element, field, lift).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === value);
  if (radio === undefined) throw new Error(`No option "${value}" for "${field}".`);
  radio.click();
  await element.updateComplete;
}

/** Types into a number field, keystroke and all. */
async function type(
  element: PtkMeetDayPlanner,
  field: string,
  text: string,
  lift?: string,
): Promise<void> {
  await enter(element, control(element, field, lift), text);
}

/** The same, into a field that is not one of the root's own children. */
async function typeDeep(element: PtkMeetDayPlanner, field: string, text: string): Promise<void> {
  await enter(element, deepControl(element, field), text);
}

async function enter(element: PtkMeetDayPlanner, host: Element, text: string): Promise<void> {
  const input = host.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input inside ${host.localName}.`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settled(element);
}

/**
 * Every element in the tool, at any shadow depth.
 *
 * `controls` reaches the root's own children and stops, which is the whole tool
 * while a plan is being drawn. Live mode is three deep -- the root holds
 * `ptk-live-screen`, which holds §13's choices, which hold the field a weight is
 * typed into -- so anything reached through the platform needs this instead.
 */
function deepControls(element: PtkMeetDayPlanner, selector: string): Element[] {
  const found: Element[] = [];
  const walk = (root: ShadowRoot): void => {
    found.push(...root.querySelectorAll(selector));
    for (const child of root.querySelectorAll('*')) {
      if (child.shadowRoot !== null) walk(child.shadowRoot);
    }
  };
  if (element.shadowRoot !== null) walk(element.shadowRoot);
  return found;
}

/** {@link control}, at any depth. Throws unless exactly one matches. */
function deepControl(element: PtkMeetDayPlanner, field: string): Element {
  const found = deepControls(element, `[data-field="${field}"]`);
  if (found.length !== 1) {
    throw new Error(`Expected one control for "${field}", found ${String(found.length)}.`);
  }
  const first = found[0];
  if (first === undefined) throw new Error(`No control for "${field}".`);
  return first;
}

/**
 * Presses the native control inside a `ptk-button`, the way a thumb does.
 *
 * Deliberately the inner button rather than the host: a press on the host's own
 * padding runs the listener whatever the inner control's disabled state, which
 * is a real failure worth its own test and not the way to drive every other one.
 */
async function press(element: PtkMeetDayPlanner, host: Element): Promise<void> {
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No button in ${host.localName}.`);
  button.click();
  await settled(element);
}

/**
 * Twice, because a child created during this commit settles on the next one.
 *
 * The root awaits its own shadow children (§5.8) and each of those awaits
 * theirs, so one await covers a tree that already exists. Starting the meet
 * *creates* `ptk-live-screen`, and its children are created inside its first
 * commit -- so the first await resolves before the choices below it have text.
 */
async function settled(element: PtkMeetDayPlanner): Promise<void> {
  await element.updateComplete;
  await element.updateComplete;
}

/** Ticks or unticks the confirmation for one lift. */
async function confirm(element: PtkMeetDayPlanner, lift: string): Promise<void> {
  const box = [
    ...(control(element, CONFIRM_FIELD, lift).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === CONFIRM_VALUE);
  if (box === undefined) throw new Error(`No confirmation for "${lift}".`);
  box.click();
  await element.updateComplete;
}

/**
 * The plan screen, which is present whenever there is a rule book to plan under.
 *
 * Its presence is not the same question as whether a plan has been drawn: the
 * screen is what says "nothing planned yet" and "planned from 200 kg once you
 * agree to it above", so it appears the moment a federation is chosen. Use
 * {@link attemptLists} for the other question.
 */
function planScreen(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-plan-screen') ?? null;
}

/**
 * How many lifts have three attempts on screen.
 *
 * The one unambiguous signal that §7's gate opened. Counted rather than asked as
 * a boolean because the gate is per lift, and a change that let one lift through
 * on another lift's agreement would satisfy any yes-or-no assertion.
 */
function attemptLists(element: PtkMeetDayPlanner): number {
  return planScreen(element)?.shadowRoot?.querySelectorAll('ol.attempts').length ?? 0;
}

/** Records federation changes as the transport sees them, off `document.body`. */
function watchFederation(): FederationChangeDetail[] {
  const seen: FederationChangeDetail[] = [];
  const listener = (event: CustomEvent<FederationChangeDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(FEDERATION_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(FEDERATION_CHANGE_EVENT, listener);
  });
  return seen;
}

/** A federation the domain refuses, published exactly as a real read would be. */
const REFUSED_PROFILE: MeetRuleProfile = {
  ...MEET_PROFILE_FIXTURE,
  // A step after "declared-tie", which is the answer given when nothing further
  // separates two lifters -- so everything after it is unreachable and the list
  // says two different things about how a tie resolves. Structural rather than
  // numeric, so it stays refused if an increment is ever revised.
  tieBreak: ['declared-tie', 'lighter-bodyweight'],
};

/** The name typed at the start panel. Distinctive so a store can be searched. */
const LIFTER_NAME = 'Quintero';

/** A mounted root with a plan on screen: three lifts, agreed, nine attempts. */
async function planned(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = await mountChosen(options);
  for (const lift of ['squat', 'bench', 'deadlift']) {
    await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
    await confirm(element, lift);
  }
  // Positive control for every live test below: there is a plan to start from.
  // Without it a broken §7 gate would leave the start panel saying "agree a
  // maximum", and every assertion about the platform would fail for that reason
  // rather than for its own.
  if (attemptLists(element) !== 3) throw new Error('No plan was drawn.');
  return element;
}

/** Names the lifter and presses the one control that puts the plan on a board. */
async function startMeet(element: PtkMeetDayPlanner): Promise<void> {
  await type(element, LIFTER_NAME_FIELD, LIFTER_NAME);
  const button = element.shadowRoot?.querySelector('.start ptk-button');
  if (button === null || button === undefined) throw new Error('No way to start the meet.');
  await press(element, button);
}

function liveScreen(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-live-screen') ?? null;
}

/** A `ptk-button` the root or the live screen draws itself, named by its owner. */
function button(owner: Element | null, selector: string): Element {
  const found = owner?.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) throw new Error(`No "${selector}" to press.`);
  return found;
}

/**
 * The opener as the plan screen prints it.
 *
 * Read off the screen rather than computed, because the claim under test is
 * that live mode runs on the weights the plan drew (§13.10) -- and a second
 * computation here would be free to agree with a second computation there.
 */
function openerText(element: PtkMeetDayPlanner): string {
  const weight = planScreen(element)?.shadowRoot?.querySelector(
    'li.attempt[data-attempt="1"] .weight',
  );
  const text = weight?.textContent.trim() ?? '';
  if (text === '') throw new Error('No opener on the plan screen.');
  return text;
}

/** Presses §13's "use this weight", beside the field a weight is typed into. */
async function useTypedWeight(element: PtkMeetDayPlanner): Promise<void> {
  const [submit] = deepControls(element, '.other ptk-button');
  if (submit === undefined) throw new Error('No way to use a typed weight.');
  await press(element, submit);
}

/** Presses the first offered card, whichever slot it sits in. */
async function chooseOffered(element: PtkMeetDayPlanner): Promise<void> {
  const [card] = deepControls(element, 'ptk-button[data-slot]');
  if (card === undefined) throw new Error('No choice card on the live screen.');
  await press(element, card);
}

/** An undo request for something the screen is not offering to take back. */
async function requestStaleUndo(element: PtkMeetDayPlanner): Promise<void> {
  const action: MeetAction = {
    kind: 'record-result',
    attemptId: 'an-attempt-that-is-not-there',
    result: { outcome: 'passed' },
  };
  const detail: UndoRequestDetail = { action };
  element.dispatchEvent(
    new CustomEvent<UndoRequestDetail>(UNDO_REQUEST_EVENT, {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
  await settled(element);
}

describe('ptk-meet-day-planner', () => {
  it('routes an answer by its tag on the composed path, not by the event target', async () => {
    // The §5.8 canary, and the one failure that makes every control on the screen
    // respond while nothing at all is recorded. `event.target` here is this host,
    // whose dataset is empty; the field is only visible on the path.
    const element = await mount();

    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);

    expect(deepText(element)).toContain('Bars load to 0.5 kg multiples');
  });

  it('tells the transport which federation was chosen, by identifier', async () => {
    // The identifier travels in the event rather than being read back off this
    // element: a listener reading the property would be reading it after a Lit
    // update it cannot await, and the chart it fetched would belong to whichever
    // federation happened to be current by then.
    const element = await mount();
    const seen = watchFederation();

    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);

    expect(seen).toEqual([{ federationId: MEET_PROFILE_FIXTURE.id }]);
  });

  it('remembers the answers that belong to a device, and not the federation', async () => {
    const settings = device();
    const element = await mountChosen({ settings });

    await choose(element, UNIT_FIELD, 'lb');

    // The unit outlives the tab. The federation must not: a device that
    // remembered it would open the lifter's next meet planning against their
    // last one's rule book, which is invisible until three attempts come out on
    // the wrong increment.
    expect(settings.read(MEET_DAY_PREFERENCES.unit)).toBe('lb');
    expect(loadSession(settings).setup.federationId).toBe('');
  });

  it('restores a remembered device when the store is handed in', async () => {
    const settings = device();
    saveSession(settings, plannerSession({ unit: 'lb', format: 'push-pull' }));

    const element = await mount({ settings });

    // Push/pull, so the squat is not contested and asks for nothing.
    expect(controls(element, `[data-lift="bench"]`).length).toBeGreaterThan(0);
    expect(controls(element, `[data-lift="squat"]`)).toEqual([]);
  });

  it('re-restores when the store is replaced after the first render', async () => {
    // `willUpdate` and not `connectedCallback`: `view.ts` hands the store in
    // after mount, and restoring only on connect shows defaults over a device
    // that remembers something else -- on some visits and not others.
    const element = await mount();
    expect(control(element, FORMAT_FIELD).getAttribute('data-field')).toBe(FORMAT_FIELD);

    const remembering = device();
    saveSession(remembering, plannerSession({ format: 'bench-only' }));
    element.settings = remembering;
    await element.updateComplete;

    expect(controls(element, `[data-lift="bench"]`).length).toBeGreaterThan(0);
    expect(controls(element, `[data-lift="deadlift"]`)).toEqual([]);
  });

  it('drops an answer tagged with a lift the format does not contest', async () => {
    // Such a tag cannot have come from a control this tool rendered, so the guard
    // is against the tool contradicting itself rather than against a hostile
    // page. Asserting the figure is off screen would prove nothing -- a bench-only
    // screen shows no deadlift either way. What the guard actually buys only
    // becomes visible on the *next* answer: a lifter who corrects the format and
    // finds a weight they never typed sitting in the deadlift.
    const settings = device();
    saveSession(settings, plannerSession({ format: 'bench-only' }));
    const element = await mountChosen({ settings });

    const forged = document.createElement('div');
    forged.dataset['field'] = EXPECTED_MAXIMUM_FIELD;
    forged.dataset['lift'] = 'deadlift';
    element.append(forged);
    teardown.push(() => {
      forged.remove();
    });
    forged.dispatchEvent(
      new CustomEvent<NumberFieldChangeDetail>(NUMBER_FIELD_CHANGE_EVENT, {
        detail: { value: '250' },
        bubbles: true,
        composed: true,
      }),
    );
    await element.updateComplete;

    await choose(element, FORMAT_FIELD, 'full-power');

    const deadlift = control(element, EXPECTED_MAXIMUM_FIELD, 'deadlift').shadowRoot?.querySelector(
      'input',
    );
    // Positive control: the field the assertion is about is on screen and
    // readable. Without it a selector that stopped matching would read as a
    // dropped answer.
    expect(deadlift).not.toBeNull();
    expect(deadlift?.value).toBe('');
  });

  describe('the plan slot', () => {
    it('says where the plan will appear while the rule books load', async () => {
      const element = await mount({ status: 'loading', profiles: [] });
      expect(deepText(element)).toContain('once the rule books have loaded');
      // Not an error tone. It resolves itself in a hundred milliseconds, and a
      // screen that opens by reporting it has told the lifter off for arriving.
      expect(element.shadowRoot?.querySelector('ptk-notice[tone="error"]')).toBeNull();
    });

    it('says what a failed read costs', async () => {
      const element = await mount({ status: 'failed', profiles: [] });
      expect(deepText(element)).toContain('nothing to check an attempt against');
    });

    it('does not offer a retry for an empty corpus', async () => {
      // Nothing went wrong and a reload will not change it, so a retry would send
      // a lifter round a loop that cannot end.
      const element = await mount({ status: 'ready', profiles: [] });
      expect(deepText(element)).toContain('no plan can be drawn');
      expect(deepText(element)).not.toContain('Reload');
    });

    it('names the one thing standing between the lifter and a plan', async () => {
      const element = await mount();
      expect(deepText(element)).toContain('Choose a federation above');
      expect(planScreen(element)).toBeNull();
    });

    it('calls a refused rule book an error and points at what helps', async () => {
      // The only one of the five that is a fault, so the only one in an error
      // tone. The refusal's reasons are not on screen: they name somebody else's
      // published content, and a lifter cannot act on them.
      const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      teardown.push(() => {
        problems.mockRestore();
      });

      const element = await mountChosen({ profiles: [REFUSED_PROFILE] });

      expect(element.shadowRoot?.querySelector('ptk-notice[tone="error"]')).not.toBeNull();
      expect(deepText(element)).toContain('Choosing another federation above');
      expect(deepText(element)).not.toContain('tie-break');
      expect(problems).toHaveBeenCalled();
    });

    it('reports a refusal once rather than on every keystroke', async () => {
      // The rules cache is here for the logging rather than for the arithmetic:
      // `render` runs on every keystroke, and a refusal reported a thousand times
      // is a refusal nobody can find.
      const problems = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      teardown.push(() => {
        problems.mockRestore();
      });

      const element = await mountChosen({ profiles: [REFUSED_PROFILE] });
      const afterChoosing = problems.mock.calls.length;
      // Positive control: the refusal was reported at all, so the assertion
      // below is about a count that started above zero.
      expect(afterChoosing).toBeGreaterThan(0);

      await choose(element, UNIT_FIELD, 'lb');
      await choose(element, UNIT_FIELD, 'kg');

      expect(problems.mock.calls.length).toBe(afterChoosing);
    });

    it('draws no attempts until the maximum has been agreed to', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      // A figure on screen is not an agreement. §7 gates the attempts on one, and
      // the tool will not draw three off a number nobody underwrote -- so the
      // screen is there, saying what it is waiting for, with nothing on it.
      expect(planScreen(element)).not.toBeNull();
      expect(attemptLists(element)).toBe(0);
      expect(deepText(element)).toContain('once you agree to it above');

      await confirm(element, 'squat');

      // One lift, not three: the gate is per lift, and agreeing to a squat says
      // nothing about a bench.
      expect(attemptLists(element)).toBe(1);
    });
  });

  describe('changing the unit with figures on screen', () => {
    it('asks nothing when there is nothing to reinterpret', async () => {
      // Unconditional, this would be a box on the first tap of every session --
      // tool 2's finding (§10.2), and the reason `hasTypedWeights` exists.
      const element = await mountChosen();

      await choose(element, UNIT_FIELD, 'lb');

      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('asks what to do with the digits already typed', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');

      expect(deepText(element)).toContain('were typed in kilograms');
    });

    it('leaves the digits alone until the question is answered', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');

      // The "keep" reading is the one that costs nothing to undo, so it is what
      // standing still means. Converting on the way past would rewrite a figure
      // the lifter never asked to change.
      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).toBe('200');
    });

    it('converts the digits when that is the answer', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await choose(element, UNIT_FIELD, 'lb');

      await choose(element, CONVERT_FIELD, CONVERT_ANSWER);

      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).not.toBe('200');
      expect(Number(input?.value)).toBeGreaterThan(400);
      // Answered, so the question goes away rather than sitting there answered.
      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('keeps the digits when that is the answer, and still stops asking', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await choose(element, UNIT_FIELD, 'lb');

      await choose(element, CONVERT_FIELD, KEEP_ANSWER);

      const input = control(element, EXPECTED_MAXIMUM_FIELD, 'squat').shadowRoot?.querySelector(
        'input',
      );
      expect(input?.value).toBe('200');
      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('drops the question when the unit comes back to the one typed in', async () => {
      // `typedIn` holds the original unit rather than the previous one, so a
      // lifter who flicks kg to lb and back finds the question gone rather than
      // reversed -- the digits never moved, and by then they are being read in
      // the unit they were typed in again.
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, UNIT_FIELD, 'lb');
      await choose(element, UNIT_FIELD, 'kg');

      expect(controls(element, `[data-field="${CONVERT_FIELD}"]`)).toEqual([]);
    });

    it('withdraws an agreement, because the figure now means something else', async () => {
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'bench');
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'deadlift');
      for (const lift of ['squat', 'bench', 'deadlift']) await confirm(element, lift);
      // Positive control: there was an agreement to withdraw. Without this the
      // assertion below passes against a tool that never drew a plan at all.
      expect(attemptLists(element)).toBe(3);

      await choose(element, UNIT_FIELD, 'lb');

      // Every one of them, not just the lift that was touched: the unit is one
      // answer over the whole screen, and 200 means something else now.
      expect(attemptLists(element)).toBe(0);
      expect(deepText(element)).toContain('have been un-ticked');
    });
  });

  it('withdraws an agreement when the figure under it is retyped', async () => {
    // The same rule arriving from the other direction, and the one §7 exists
    // for: a plan on screen must belong to a maximum the lifter agreed to, and
    // editing the maximum is exactly how that stops being true.
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }
    expect(attemptLists(element)).toBe(3);

    await type(element, EXPECTED_MAXIMUM_FIELD, '210', 'squat');

    // Only the squat: the other two maximums did not move, and withdrawing an
    // agreement the lifter still holds would be its own kind of wrong.
    expect(attemptLists(element)).toBe(2);
  });

  /**
   * The join between the plan and the platform (§13.10), from the root.
   *
   * Everything under here has its own browser test and none of those can fail
   * for any of these reasons: the seeding is pure and tested without a browser,
   * the live screen is handed a finished view, and the choices element reports a
   * press without applying it. What is only wrong here is the wiring -- which
   * screen is showing, what live mode was started against, where a refusal is
   * put, and whether the clock is running.
   */
  describe('live mode', () => {
    it('offers no way to start a meet until there is a plan to start', async () => {
      // The start panel is on screen from the first paint, saying why it is not
      // a control yet. The alternative -- appearing when the plan does -- is a
      // button materialising under a thumb that was aiming at the last
      // confirmation, on the one screen where a mis-tap starts the day.
      const element = await mountChosen();

      expect(deepText(element)).toContain(START_MEET_NEEDS_A_PLAN);
      expect(controls(element, `[data-field="${LIFTER_NAME_FIELD}"]`)).toEqual([]);

      for (const lift of ['squat', 'bench', 'deadlift']) {
        await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
        await confirm(element, lift);
      }

      expect(controls(element, `[data-field="${LIFTER_NAME_FIELD}"]`)).toHaveLength(1);
      expect(deepText(element)).not.toContain(START_MEET_NEEDS_A_PLAN);
    });

    it('will not start on a plan the lifter has stopped agreeing to', async () => {
      // The gate is `view.complete`, not "a plan was drawn once". Retyping a
      // maximum withdraws the tick under it, and a meet seeded from that state
      // opens asking for a weight on a lift the lifter thought they had planned.
      const element = await planned();
      expect(controls(element, `[data-field="${LIFTER_NAME_FIELD}"]`)).toHaveLength(1);

      await type(element, EXPECTED_MAXIMUM_FIELD, '210', 'squat');

      expect(controls(element, `[data-field="${LIFTER_NAME_FIELD}"]`)).toEqual([]);
      expect(deepText(element)).toContain(START_MEET_NEEDS_A_PLAN);
    });

    it('does not take a name from a text field that is not the name field', async () => {
      // The listener is on the host, so every composed text-field change in the
      // tree lands on it -- and the lifter's name is the one field on these
      // screens that decides which athlete a weight is submitted for (§14).
      // Found by mutation: dropping the field guard passed the whole suite,
      // because the name field is today the only `ptk-text-field` here. The
      // event that bites is therefore a foreign one dispatched at the host,
      // which is the §13.6 shape -- a filter over a control the element draws
      // exactly one of looks unreachable until something else composes into it.
      const element = await planned();
      const start = button(element, '.start ptk-button');
      // Positive control: blank is what keeps the control shut, so the
      // assertion below means something only if it starts out shut.
      expect(start.shadowRoot?.querySelector('button')?.disabled).toBe(true);

      const detail: TextFieldChangeDetail = { value: 'Somebody Else' };
      element.dispatchEvent(
        new CustomEvent<TextFieldChangeDetail>(TEXT_FIELD_CHANGE_EVENT, {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(start.shadowRoot?.querySelector('button')?.disabled).toBe(true);
    });

    it('puts the weights the plan drew on the board, and swaps the screen', async () => {
      const element = await planned();
      const opener = openerText(element);

      await startMeet(element);

      // One screen or the other, never both: the planning questions are still
      // answerable while a meet runs, but not underneath it.
      expect(liveScreen(element)).not.toBeNull();
      expect(planScreen(element)).toBeNull();
      expect(deepText(element)).toContain(LIFTER_NAME);
      expect(deepText(element)).toContain(opener);
    });

    it('keeps the lifter name out of the store the setup answers go to', async () => {
      // §13.4's line, at the one field that tests it: the setup answers are
      // settings on a device and a lifter's own facts are not. A name written
      // here would come back on the next visitor to a shared phone, beside the
      // weights of whoever used it last.
      const storage = memoryPreferenceStorage();
      const settings = createPreferenceStore(storage);
      const element = await planned({ settings });

      await startMeet(element);
      expect(deepText(element)).toContain(LIFTER_NAME);

      await press(element, button(element, 'ptk-button.back'));
      await choose(element, UNIT_FIELD, 'lb');

      const written = storage
        .keys()
        .map((key) => `${key} ${storage.read(key) ?? ''}`)
        .join(' ');
      // Positive control: the store is live and reachable from this screen, so
      // the absence below is a decision rather than a store nobody wrote to.
      expect(written).toContain('lb');
      expect(written).not.toContain(LIFTER_NAME);
    });

    it('leaves the meet running behind the planning screens, and comes back', async () => {
      const element = await planned();
      await startMeet(element);

      await press(element, button(element, 'ptk-button.back'));

      expect(planScreen(element)).not.toBeNull();
      expect(liveScreen(element)).toBeNull();
      expect(deepText(element)).toContain(MEET_IS_RUNNING_NOTE);
      // No second start: a meet is already on the board, and the control that
      // would replace it is the one thing this screen must not offer.
      expect(controls(element, `[data-field="${LIFTER_NAME_FIELD}"]`)).toEqual([]);

      await press(element, button(element, '.running ptk-button'));

      expect(liveScreen(element)).not.toBeNull();
    });

    it('does not re-run the meet under an answer changed after it started', async () => {
      // What `MEET_IS_RUNNING_NOTE` promises, asserted rather than written. The
      // worst version of getting this wrong is not the weights: it is the rule
      // book, and a lifter who taps a different federation at the expeditor's
      // table having the back half of their meet checked against rules the
      // front half never was. The weights are the visible half of the same fact.
      const element = await planned();
      const opener = openerText(element);
      await startMeet(element);

      await press(element, button(element, 'ptk-button.back'));
      await type(element, EXPECTED_MAXIMUM_FIELD, '260', 'squat');
      // Positive control: the planning side really did move. Without it the
      // assertion below passes against a screen where nothing changed at all.
      expect(attemptLists(element)).toBe(2);

      await press(element, button(element, '.running ptk-button'));

      expect(deepText(element)).toContain(opener);
    });

    it('answers an illegal typed weight under the field it was typed into', async () => {
      // Two channels, and the split is the point: a refusal is answerable -- the
      // lifter types a different weight -- so it belongs under the field, where
      // they are already looking. A notice at the top of the screen is a
      // sentence about a control that is now below the fold.
      const element = await planned();
      await startMeet(element);

      await typeDeep(element, OTHER_WEIGHT_FIELD, '180.25');
      await useTypedWeight(element);

      // Pinned to a fragment rather than to `refusalSentence`, per §13.8: an
      // assertion whose expected value comes from the module under test is
      // vacuous under exactly the mutation it was written to catch.
      expect(deepText(element)).toContain('The bar cannot be loaded to this weight');
      expect(deepText(element)).toContain('Choose the next attempt');
    });

    it('takes a legal typed weight and moves the screen on', async () => {
      // The control for the refusal above. Same field, same press, one
      // half-kilogram apart -- so a screen that refused everything, or one that
      // accepted everything, fails exactly one of the two.
      const element = await planned();
      await startMeet(element);

      await typeDeep(element, OTHER_WEIGHT_FIELD, '180.5');
      await useTypedWeight(element);

      expect(deepText(element)).not.toContain('The bar cannot be loaded to this weight');
      expect(deepText(element)).toContain('Take the weight to the table');
    });

    it('takes the refusal down once the weight it was about is accepted', async () => {
      // Found by mutation: dropping `#clearFeedback` from the accepted path
      // passed the whole suite, because the two tests above each start from a
      // clean screen and never retype. That is the sequence the comment on
      // `#clearFeedback` describes and the worst of the bugs available here --
      // the lifter corrects the weight, the table takes it, and the red
      // sentence under the field still says the rules do not allow it.
      const element = await planned();
      await startMeet(element);

      await typeDeep(element, OTHER_WEIGHT_FIELD, '180.25');
      await useTypedWeight(element);
      // Positive control: the refusal has to be on screen before its absence
      // below can mean anything.
      expect(deepText(element)).toContain('The bar cannot be loaded to this weight');

      await typeDeep(element, OTHER_WEIGHT_FIELD, '180.5');
      await useTypedWeight(element);

      expect(deepText(element)).not.toContain('The bar cannot be loaded to this weight');
      expect(deepText(element)).toContain('Take the weight to the table');
    });

    it('undoes the last action, and only the action the screen offered', async () => {
      const element = await planned();
      await startMeet(element);
      // The timeline is restarted at the seed, so the ten actions that put the
      // plan on the board are not offered back one weight at a time (§13.10).
      expect(deepText(element)).toContain('Nothing to undo yet.');
      expect(deepText(element)).toContain('Choose the next attempt');

      await chooseOffered(element);
      expect(deepText(element)).toContain('Take the weight to the table');

      // Declined in silence: the screen has already repainted with a new label,
      // and an error about a press that did nothing describes a race the lifter
      // cannot see. Without the identity check this reaches `undo` and reports
      // a problem instead.
      await requestStaleUndo(element);
      expect(deepText(element)).toContain('Take the weight to the table');

      await press(element, button(liveScreen(element), 'ptk-button'));

      expect(deepText(element)).toContain('Choose the next attempt');
    });

    it('watches the clock only while the platform is on screen', async () => {
      // The countdown is derived from `now` and repaints off the seam, so a
      // clock left attached behind the planning screens is a redraw of a screen
      // nobody is looking at, four times a second, for the rest of the session.
      // The other direction is worse: a clock never attached is a countdown that
      // reads the same second all minute.
      const clock = manualClock(FIXED_INSTANT);
      const element = await planned({ clock });
      expect(clock.watchers).toBe(0);

      await startMeet(element);
      expect(clock.watchers).toBe(1);

      await press(element, button(element, 'ptk-button.back'));
      expect(clock.watchers).toBe(0);

      await press(element, button(element, '.running ptk-button'));
      expect(clock.watchers).toBe(1);
    });

    it('has no accessibility violations with the platform on screen', async () => {
      const element = await planned();
      await startMeet(element);

      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the platform on screen', async () => {
      // The densest screen in the collection: §11's header, §13's cards and
      // §14's panel, in 320 pixels (§5.7), which is where it is actually read.
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await planned({ within: frame });
      await startMeet(element);

      expect(liveScreen(element)).not.toBeNull();
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });

  it('says nothing anywhere about how likely an attempt is', async () => {
    // §10.2 across the whole assembled screen rather than one element at a time:
    // each child asserts this for its own text, and none of them can see the
    // sentence the root writes into the plan slot.
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    const text = deepText(element).toLowerCase();
    // Positive control: there is a plan to read. An element that rendered nothing
    // contains no banned word either.
    expect(text).toContain('attempt');
    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('has no accessibility violations with the whole tool on screen', async () => {
    const element = await mountChosen();
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with a plan drawn', async () => {
    // The widest state of the widest tool in the collection: §6's eight goal
    // tiles, §7's per-lift fields, §8's disclosure and nine attempt cards, in 320
    // pixels (§5.7). The page-level check covers the gutter around it; this
    // covers the tool.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mountChosen({ within: frame });
    for (const lift of ['squat', 'bench', 'deadlift']) {
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
      await confirm(element, lift);
    }

    expect(planScreen(element)).not.toBeNull();
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
