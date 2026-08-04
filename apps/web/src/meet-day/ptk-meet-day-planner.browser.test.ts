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
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
  PtkDisclosure,
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ToggleGroupChangeDetail,
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
  CHECKLIST_HEADING,
  COACH_MODE,
  COLOUR_CHOICES,
  CONVERT_ANSWER,
  KEEP_ANSWER,
  MEET_IS_RUNNING_NOTE,
  ROSTER_NEEDS_A_FEDERATION,
  SOLO_MODE,
  START_MEET_NEEDS_A_PLAN,
} from './copy.js';
import {
  CONFIRM_FIELD,
  CONVERT_FIELD,
  CUSTOM_ITEM_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FORMAT_FIELD,
  LIFTER_NAME_FIELD,
  MODE_FIELD,
  OTHER_WEIGHT_FIELD,
  PREP_NOTES_FIELD,
  REMOVE_CUSTOM_ITEM_FIELD,
  ROSTER_COLOUR_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { CUSTOM_ITEM_MAX, PREP_NOTES_MAX } from './prep.js';
import { PROBABILITY_WORDS, PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import { BOARD_OPEN_EVENT, type BoardOpenDetail } from './ptk-coach-board.js';
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

/*
 * -----------------------------------------------------------------------------
 * §22's preparation fold.
 *
 * A DOM READ CANNOT DISTINGUISH "RECORDED" FROM "DROPPED"
 *
 * This is the trap the whole block below is arranged around, so it is stated
 * once here rather than eleven times. Lit commits a property binding only when
 * the *bound value* changes between renders. If the root drops a setup answer,
 * `this.prep` never changes, nothing re-renders, and the native input keeps the
 * text the lifter just typed -- so typing into a box and reading it back is
 * vacuous under exactly the mutation it looks like it is testing. The same goes
 * for clicking a tile and reading its `checked`.
 *
 * The observables that do work are the ones computed *from* `prep`: a refusal
 * ({@link refusalUnder}), the checklist's progress line ({@link progressText}),
 * and whether a custom row is on the list at all. For the three tile groups
 * there is no such observable -- `appliesWhen` keys the rack row off the format
 * rather than off `squatStart`, so none of the three feeds the checklist -- and
 * the only honest route is a mode round trip, which destroys and rebuilds
 * `ptk-meet-prep` so its first render binds the state's own answer.
 * -----------------------------------------------------------------------------
 */

/**
 * §22's fold, which the root draws itself.
 *
 * Scoped to the root's own shadow root rather than searched at depth: the
 * checklist inside it draws a second `ptk-disclosure` for §22.2's removals, and
 * a deep search would find whichever came first in tree order and go on
 * "finding the fold" after this one stopped being rendered.
 */
function prepFold(element: PtkMeetDayPlanner): PtkDisclosure | null {
  const found = element.shadowRoot?.querySelector('ptk-disclosure') ?? null;
  return found instanceof PtkDisclosure ? found : null;
}

/**
 * Opens the fold by setting `open`, never by pressing the summary.
 *
 * `<details>` fires `toggle` asynchronously, so a press leaves the test reading
 * the state before the one it asked for -- the §13.6 rule, arriving again.
 */
async function openPrep(element: PtkMeetDayPlanner): Promise<PtkMeetDayPlanner> {
  const fold = prepFold(element);
  if (fold === null) throw new Error('No preparation fold to open.');
  fold.open = true;
  await settled(element);
  return element;
}

/** The refusal under one field, or the empty string when it is not refusing. */
function refusalUnder(element: PtkMeetDayPlanner, field: string): string {
  return deepControl(element, field).shadowRoot?.querySelector('.error')?.textContent.trim() ?? '';
}

/** What one text box holds, read off the native control rather than the host. */
function boxValue(element: PtkMeetDayPlanner, field: string): string {
  const inner = deepControl(element, field).shadowRoot?.querySelector('input, textarea');
  if (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement) return inner.value;
  throw new Error(`No text box for "${field}".`);
}

/** {@link typeDeep} for a `ptk-text-area`, which holds no `input` to type into. */
async function typeAreaDeep(
  element: PtkMeetDayPlanner,
  field: string,
  text: string,
): Promise<void> {
  const area = deepControl(element, field).shadowRoot?.querySelector('textarea');
  if (!(area instanceof HTMLTextAreaElement)) throw new Error(`No text area for "${field}".`);
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settled(element);
}

/** {@link choose}, at any depth. */
async function chooseDeep(element: PtkMeetDayPlanner, field: string, value: string): Promise<void> {
  const radio = [...(deepControl(element, field).shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}" for "${field}".`);
  radio.click();
  await settled(element);
}

/** Which tile a group is showing as chosen. */
function chosenUnder(element: PtkMeetDayPlanner, field: string): string | null {
  const chosen = [
    ...(deepControl(element, field).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.checked);
  return chosen?.value ?? null;
}

/** One checklist group, addressed by the attribute the root reads it back by. */
function checklistGroup(element: PtkMeetDayPlanner, group: string): Element {
  const [found] = deepControls(element, `[data-group="${group}"]`);
  if (found === undefined) throw new Error(`No "${group}" group on the checklist.`);
  return found;
}

/** Every row a group is offering, in the order it offers them. */
function rowValues(element: PtkMeetDayPlanner, group: string): string[] {
  return [...(checklistGroup(element, group).shadowRoot?.querySelectorAll('input') ?? [])].map(
    (input) => input.value,
  );
}

/** Ticks or unticks one row, by clicking its box the way a thumb does. */
async function tickRow(element: PtkMeetDayPlanner, group: string, itemId: string): Promise<void> {
  const box = [
    ...(checklistGroup(element, group).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === itemId);
  if (box === undefined) throw new Error(`No "${itemId}" row under "${group}".`);
  box.click();
  await settled(element);
}

/** The checklist's own count of what is ticked, which is derived from `prep`. */
function progressText(element: PtkMeetDayPlanner): string {
  const [checklist] = deepControls(element, '.progress');
  return checklist?.textContent.trim() ?? '';
}

/** Presses Add, beside the box a row is named in. */
async function pressAdd(element: PtkMeetDayPlanner): Promise<void> {
  const [add] = deepControls(element, '.add ptk-button');
  if (add === undefined) throw new Error('No way to add a row.');
  await press(element, add);
}

/** Opens the removal fold and presses the button for one row. */
async function removeRow(element: PtkMeetDayPlanner, label: string): Promise<void> {
  // Named by what it holds, because both folds on this screen are the same
  // element and the removals one is not the one `prepFold` returns.
  const [fold] = deepControls(element, 'ptk-disclosure:has(.removals)');
  if (!(fold instanceof PtkDisclosure)) throw new Error('No removal fold.');
  // The same rule as `openPrep`: `<details>` toggles asynchronously.
  fold.open = true;
  await settled(element);

  const button = deepControls(element, `[data-field="${REMOVE_CUSTOM_ITEM_FIELD}"]`).find((row) =>
    row.textContent.includes(label),
  );
  if (button === undefined) throw new Error(`No way to remove "${label}".`);
  await press(element, button);
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

  /**
   * §6.1's other branch, from the root (§21).
   *
   * The board and the roster each have their own browser test and neither can
   * fail for any of the reasons here. What is only wrong at this level is the
   * wiring between the two: which screen is showing, whether the first press of
   * Add is what creates the meet document, whether a per-lifter answer reaches
   * the entry it was tagged for, and whether the clock is running -- the coach
   * path watches it from the first lifter onwards, unlike the solo path, because
   * every row on the board is a countdown.
   */
  describe('coach mode', () => {
    /** The planning screen, with §6.1 answered "Manage multiple lifters". */
    async function coachMode(options: Options = {}): Promise<PtkMeetDayPlanner> {
      const element = await mount(options);
      await choose(element, MODE_FIELD, COACH_MODE);
      return element;
    }

    /** The same, with a rule book to create a meet against. */
    async function coachChosen(options: Options = {}): Promise<PtkMeetDayPlanner> {
      const element = await coachMode(options);
      await choose(element, FEDERATION_FIELD, (options.profiles ?? PROFILE_FIXTURES)[0]?.id ?? '');
      return element;
    }

    function board(element: PtkMeetDayPlanner): Element | null {
      return element.shadowRoot?.querySelector('ptk-coach-board') ?? null;
    }

    function roster(element: PtkMeetDayPlanner): Element | null {
      return element.shadowRoot?.querySelector('ptk-coach-roster') ?? null;
    }

    /** Types a name into the roster and presses its Add button. */
    async function addLifter(element: PtkMeetDayPlanner, name: string): Promise<void> {
      if (name !== '') await type(element, ROSTER_NAME_FIELD, name);
      const host = roster(element)?.shadowRoot?.querySelector('.add ptk-button');
      if (host === null || host === undefined) throw new Error('No way to add a lifter.');
      await press(element, host);
    }

    /** A board with one lifter on it, which is the smallest running meet. */
    async function running(options: Options = {}): Promise<PtkMeetDayPlanner> {
      const element = await coachChosen(options);
      await addLifter(element, LIFTER_NAME);
      // Positive control for everything below: the press really did create a
      // document. Without it an assertion about a row passes against a screen
      // that refused the add and drew no board at all.
      if (board(element) === null) throw new Error('No board was drawn.');
      return element;
    }

    /** The native input behind the roster's name field, two shadow roots down. */
    function rosterNameBox(element: PtkMeetDayPlanner): HTMLInputElement {
      const input = control(element, ROSTER_NAME_FIELD).shadowRoot?.querySelector('input');
      if (!(input instanceof HTMLInputElement)) throw new Error('No name box on the roster.');
      return input;
    }

    /** One row's name and identifier, which is the only place both are printed. */
    function whoText(element: PtkMeetDayPlanner): string {
      return board(element)?.shadowRoot?.querySelector('.who')?.textContent.trim() ?? '';
    }

    it('opens on §6.1 and takes the branch away once either meet is running', async () => {
      // Both halves of the guard in one test, because the solo half is the one
      // nothing else here reaches: a live meet hides the chooser for the same
      // reason a board does, and a version that only checked `coach` would leave
      // a lifter mid-meet one tap from a screen with no way back to it.
      const element = await mount();
      expect(controls(element, `[data-field="${MODE_FIELD}"]`)).toHaveLength(1);

      const solo = await planned();
      await startMeet(solo);

      expect(controls(solo, `[data-field="${MODE_FIELD}"]`)).toEqual([]);
    });

    it('offers nowhere to add a lifter before there is a rule book', async () => {
      // The roster is on screen from the first paint saying which question to
      // answer, rather than appearing when the federation is chosen: a control
      // materialising under a thumb is the same failure the start panel avoids
      // on the solo path.
      const element = await coachMode();

      expect(roster(element)).not.toBeNull();
      expect(controls(element, `[data-field="${ROSTER_NAME_FIELD}"]`)).toEqual([]);
      expect(deepText(element)).toContain(ROSTER_NEEDS_A_FEDERATION);
    });

    it('creates the meet on the first lifter, and takes the setup questions away', async () => {
      // `createMeetDocument` takes the rules and the meet type once and they are
      // fixed from then on, which is what `ROSTER_STARTS_THE_MEET` promises
      // before the press. A federation tile still on screen and still
      // highlighting would be that promise broken in silence.
      const element = await coachChosen();
      expect(element.shadowRoot?.querySelector('ptk-planner-setup')).not.toBeNull();
      expect(board(element)).toBeNull();

      await addLifter(element, LIFTER_NAME);

      expect(board(element)).not.toBeNull();
      expect(deepText(element)).toContain(LIFTER_NAME);
      expect(element.shadowRoot?.querySelector('ptk-planner-setup')).toBeNull();
      expect(controls(element, `[data-field="${FEDERATION_FIELD}"]`)).toEqual([]);
      // The unit question survives on its own, because it is about how every
      // figure on the board is read rather than about what the meet is.
      expect(controls(element, `[data-field="${UNIT_FIELD}"]`)).toHaveLength(1);
      // And the box is empty for the next name. A coach adds a flight one after
      // another, so a box that kept the last name means clearing it by hand
      // eight times -- or adding Quintero twice, which the rules allow.
      expect(rosterNameBox(element).value).toBe('');
    });

    it('adds the second lifter to the meet the first one started', async () => {
      // The press that starts the meet and the press that adds to it are the
      // same press, so the run has to be reused once it exists. Building a fresh
      // document each time passes every single-lifter assertion in this file
      // while wiping the board on every add -- a coach types eight names and
      // reads one row, with no error anywhere to explain it.
      const element = await running();

      await addLifter(element, 'Okonkwo');

      expect(board(element)?.shadowRoot?.querySelectorAll('article.row')).toHaveLength(2);
      expect(deepText(element)).toContain(LIFTER_NAME);
      expect(deepText(element)).toContain('Okonkwo');
    });

    it('reports a blank name rather than starting a meet nobody is in', async () => {
      // The Add button is deliberately not disabled (a press on the `ptk-button`
      // host's own padding runs the listener whatever the inner control's
      // state), so this path is reachable with a real thumb. What must not
      // happen is the half-started meet: `#startCoachMeet` builds a document,
      // `add-lifter` refuses, and keeping that document would fix the federation
      // and the meet type on a press that added nobody.
      const element = await coachChosen();

      await addLifter(element, '');

      expect(deepText(element)).toContain('A meet needs a lifter name');
      expect(board(element)).toBeNull();
      // Still answerable: the federation was not fixed by a press that failed.
      expect(controls(element, `[data-field="${FEDERATION_FIELD}"]`)).toHaveLength(1);
    });

    it('puts an identifier on the row of the lifter it was typed for', async () => {
      // §21's distinctive identifier, through `#patchEntry` and out again in
      // `buildBoardView`. Blank, the domain falls back to the row's position, so
      // the two readings of this row are genuinely different sentences.
      const element = await running();
      const before = whoText(element);

      await type(element, ROSTER_IDENTIFIER_FIELD, '14');

      expect(whoText(element)).toContain('14');
      expect(whoText(element)).not.toBe(before);
    });

    it('puts a chosen colour on the board as well as on the roster', async () => {
      // The swatch is the only thing on the board that a colour produces, and it
      // is drawn from the entry -- so its absence beforehand and presence after
      // is the round trip through `#patchEntry` and `buildBoardView`, which no
      // element test can see.
      const element = await running();
      expect(board(element)?.shadowRoot?.querySelector('.swatch')).toBeNull();

      const chosen = COLOUR_CHOICES[1];
      if (chosen === undefined) throw new Error('No colour to choose.');
      await choose(element, ROSTER_COLOUR_FIELD, chosen.value);

      expect(board(element)?.shadowRoot?.querySelector('.swatch')).not.toBeNull();
      // §21 again: never the sole cue, so the roster still says it in words.
      expect(deepText(roster(element) ?? element)).toContain(chosen.label.toLowerCase());
    });

    it('opens one lifter on their own platform screen, and comes back', async () => {
      // §21.1's one tap. The board goes away rather than sitting behind the
      // screen: they are two screens, and a coach scrolling past a live screen
      // to reach the board they were just on is the §11 layout undone.
      const element = await running();
      const open = board(element)?.shadowRoot?.querySelector('ptk-button.open');
      if (open === null || open === undefined) throw new Error('No way to open a lifter.');

      await press(element, open);

      expect(liveScreen(element)).not.toBeNull();
      expect(board(element)).toBeNull();
      expect(roster(element)).toBeNull();

      await press(element, button(element, 'ptk-button.back'));

      expect(board(element)).not.toBeNull();
      expect(liveScreen(element)).toBeNull();
    });

    it('will not open a lifter the meet document has never heard of', async () => {
      // The board re-sorts on the countdowns four times a second, so the row
      // under a thumb at the start of a press is not necessarily the row under
      // it at the end (§13.6). An id that no longer names anybody would open a
      // screen `buildLiveView` answers null for, which renders as a meet that
      // is over -- on a coach's phone, mid-flight, for a lifter who is fine.
      const element = await running();

      const forged = document.createElement('div');
      element.append(forged);
      teardown.push(() => {
        forged.remove();
      });
      forged.dispatchEvent(
        new CustomEvent<BoardOpenDetail>(BOARD_OPEN_EVENT, {
          detail: { lifterId: 'nobody' },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(board(element)).not.toBeNull();
      expect(liveScreen(element)).toBeNull();
    });

    it('will not switch branch out from under a running meet', async () => {
      // `#renderMode` takes the control away once either meet exists, so this is
      // unreachable by a tap -- and the listener is on the host, so a composed
      // choice event tagged `mode` from anywhere else lands on it. Nothing is
      // destroyed by the switch: both runs are still in memory. What is
      // destroyed is the coach's way back to them, because the branch that
      // renders it is the one that just went away.
      const element = await running();
      expect(controls(element, `[data-field="${MODE_FIELD}"]`)).toEqual([]);

      const forged = document.createElement('div');
      forged.dataset['field'] = MODE_FIELD;
      element.append(forged);
      teardown.push(() => {
        forged.remove();
      });
      forged.dispatchEvent(
        new CustomEvent<ChoiceChangeDetail>(CHOICE_CHANGE_EVENT, {
          detail: { value: SOLO_MODE },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(board(element)).not.toBeNull();
    });

    it('asks what to do with figures typed before the branch was switched', async () => {
      // The conversion question is rendered on the coach path as well as on the
      // planning screens because it is about the session's figures rather than
      // about a screen. A device that planned a solo meet and then switched
      // still has typed weights, and a question raised with nowhere to appear
      // would sit unanswered until the lifter went back and found it waiting.
      const element = await mountChosen();
      await type(element, EXPECTED_MAXIMUM_FIELD, '200', 'squat');

      await choose(element, MODE_FIELD, COACH_MODE);
      await choose(element, UNIT_FIELD, 'lb');

      expect(deepText(element)).toContain('were typed in kilograms');
    });

    it('watches the clock from the first lifter onwards, including on a lifter', async () => {
      // Unlike the solo path, which stops the clock behind the planning screens.
      // The board *is* the countdown -- every row carries one and the ladder
      // re-sorts on them -- so the only state with nothing moving is the one
      // before there is a document at all.
      const clock = manualClock(FIXED_INSTANT);
      const element = await coachChosen({ clock });
      expect(clock.watchers).toBe(0);

      await addLifter(element, LIFTER_NAME);
      expect(clock.watchers).toBe(1);

      const open = board(element)?.shadowRoot?.querySelector('ptk-button.open');
      if (open === null || open === undefined) throw new Error('No way to open a lifter.');
      await press(element, open);
      // One lifter's own screen is a live screen too, so it keeps counting.
      expect(clock.watchers).toBe(1);

      await press(element, button(element, 'ptk-button.back'));
      expect(clock.watchers).toBe(1);
    });

    it('has no accessibility violations with the board on screen', async () => {
      const element = await running();

      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the board and the roster on screen', async () => {
      // Two screens' worth of content on one route: §21's rows and their
      // controls above §21's roster and its folds, at 320 pixels (§5.7). §27
      // forbids sideways scrolling on an urgent workflow outright, and a coach
      // reading a board between flights is the definition of one.
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await running({ within: frame });

      expect(board(element)).not.toBeNull();
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });

  describe('the preparation fold (§22)', () => {
    it('is on the solo planning screen and on neither of the other two', async () => {
      // The placement §22 asks for, stated as the two screens it is *not* on.
      // A fold that followed the lifter into live mode would be the thing §22
      // exists to prevent -- a packing list beside a sixty-second countdown --
      // and one on the coach board would be one lifter's rack heights presented
      // as the room's. §22.1 is one lifter's own settings; a per-lifter copy is
      // task #52.
      const solo = await mountChosen();
      expect(prepFold(solo)).not.toBeNull();

      await choose(solo, MODE_FIELD, COACH_MODE);
      expect(prepFold(solo)).toBeNull();

      const running = await planned();
      await startMeet(running);
      // The positive control for the third assertion: a meet that failed to
      // start leaves the planning screen up, where the fold is *supposed* to be
      // absent for no reason at all, and the assertion below passes on that.
      expect(liveScreen(running)).not.toBeNull();
      expect(prepFold(running)).toBeNull();
    });

    it('opens shut, because none of it is urgent', async () => {
      const element = await mountChosen();

      expect(prepFold(element)?.open).toBe(false);
    });

    it('records a typed setup answer under the key its control carries', async () => {
      // The round trip that only the root can be wrong about. §22.1 names its
      // fields by their `LifterSetup` key rather than by a constant per box, so
      // fourteen of the sixteen reach `#onText`'s `default` -- the branch that
      // used to be a bare return.
      //
      // Asserted through the refusal rather than by reading the box back. The
      // box holds what was typed whether or not anything recorded it: nothing
      // re-renders when the state does not change, so the obvious assertion
      // passes against a root that drops every answer. The refusal is computed
      // from `prep` and can only appear if the answer arrived.
      const element = await openPrep(await mountChosen());
      expect(refusalUnder(element, 'weighInTime')).toBe('');

      await typeDeep(element, 'weighInTime', 'early doors');

      expect(refusalUnder(element, 'weighInTime')).not.toBe('');
      // The control: one field refusing is the requirement, sixteen refusing is
      // a form that argues with a lifter who has answered one question.
      expect(refusalUnder(element, 'liftingStartTime')).toBe('');
    });

    it('records a chosen setup tile, converted rather than stored as its text', async () => {
      // Three of the sixteen answers are closed vocabularies, and a computed
      // object key is checked by nothing -- TypeScript accepts a raw string
      // against `Partial<LifterSetup>` for any key of it -- so the conversion in
      // `withSetupAnswer` is what stands between a tile and §2.4's silent
      // coercion.
      //
      // Read back after a trip through the coach branch, which is the only way
      // to read it at all: a radio a lifter clicked stays visually checked
      // whether or not anything recorded it, and no re-render can un-click it.
      // Switching branch destroys the planning tree, so coming back builds a
      // `ptk-meet-prep` whose first render is the state's own answer.
      const element = await mountChosen();
      await openPrep(element);
      await chooseDeep(element, 'squatStart', 'monolift');

      await choose(element, MODE_FIELD, COACH_MODE);
      await choose(element, MODE_FIELD, SOLO_MODE);
      await openPrep(element);

      expect(chosenUnder(element, 'squatStart')).toBe('monolift');
    });

    it('records a note through the text-area event, which is a different event', async () => {
      // §22.1's two prose boxes and §22.2's notes report `ptk-text-change`, not
      // `ptk-text-field-change`. A root wired to only the field event loses the
      // commands a lifter wrote out in full, and loses them silently -- the box
      // goes on showing them until something else repaints.
      const element = await openPrep(await mountChosen());
      expect(refusalUnder(element, PREP_NOTES_FIELD)).toBe('');

      await typeAreaDeep(element, PREP_NOTES_FIELD, 'x'.repeat(PREP_NOTES_MAX + 1));

      expect(refusalUnder(element, PREP_NOTES_FIELD)).not.toBe('');
    });

    it('ticks a checklist row, and counts it', async () => {
      const element = await openPrep(await mountChosen());
      expect(progressText(element)).toContain('0 of');

      await tickRow(element, 'bring', 'belt');

      expect(progressText(element)).toContain('1 of');
    });

    it('unticks one group without clearing another', async () => {
      // The reason `withCheckedRows` takes the rows it is allowed to touch as
      // well as the ones that are ticked. A toggle group reports its *whole*
      // selection, so "nothing under Do at the venue" and "nothing anywhere" are
      // the same empty array arriving at the root; without the scope, unticking
      // the last row of one group clears the whole bag.
      const element = await openPrep(await mountChosen());
      await tickRow(element, 'bring', 'belt');
      await tickRow(element, 'do', 'weigh-in');
      expect(progressText(element)).toContain('2 of');

      await tickRow(element, 'do', 'weigh-in');

      expect(progressText(element)).toContain('1 of');
    });

    it('adds a row of the lifter own, and empties the box that named it', async () => {
      // Clearing the box is the root's job and nothing else can do it: the
      // element reports the text with the press and holds no state. A box left
      // full is the next row pre-filled with the last one, which `addCustomItem`
      // then refuses as a duplicate.
      const element = await openPrep(await mountChosen());
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Mouthguard');
      await pressAdd(element);

      expect(deepText(element)).toContain('Mouthguard');
      expect(boxValue(element, CUSTOM_ITEM_FIELD)).toBe('');
    });

    it('keeps the text where the lifter typed it when the row is refused', async () => {
      // Shortening beats retyping, and the refusal sentence says to shorten it.
      const tooLong = 'x'.repeat(CUSTOM_ITEM_MAX + 1);
      const element = await openPrep(await mountChosen());
      await typeDeep(element, CUSTOM_ITEM_FIELD, tooLong);
      await pressAdd(element);

      expect(refusalUnder(element, CUSTOM_ITEM_FIELD)).not.toBe('');
      expect(boxValue(element, CUSTOM_ITEM_FIELD)).toBe(tooLong);
    });

    it('takes the refusal down as soon as the text it was about changes', async () => {
      // The §13.11 shape, third time in this file: a sentence that outlives the
      // thing it was about. The positive control is the refusal being up first,
      // because a root that never refuses passes the second half on its own.
      const element = await openPrep(await mountChosen());
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'x'.repeat(CUSTOM_ITEM_MAX + 1));
      await pressAdd(element);
      expect(refusalUnder(element, CUSTOM_ITEM_FIELD)).not.toBe('');

      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Mouthguard');

      expect(refusalUnder(element, CUSTOM_ITEM_FIELD)).toBe('');
    });

    it('removes a row somebody added, and only that row', async () => {
      const element = await openPrep(await mountChosen());
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Mouthguard');
      await pressAdd(element);
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Spare singlet');
      await pressAdd(element);

      await removeRow(element, 'Mouthguard');

      expect(deepText(element)).not.toContain('Mouthguard');
      expect(deepText(element)).toContain('Spare singlet');
    });

    it('ignores a setup answer from a control this tool never rendered', async () => {
      // §13.6, §13.11 and §13.13's guard lesson, arriving where it costs most:
      // the `default` branch of `#onText` now writes rather than returning, so
      // the only thing keeping it from accepting any tagged event on the host is
      // `isSetupField`. The test that bites is a foreign composed event, not a
      // second control -- and the positive control is a real field going in
      // through the same handler afterwards.
      const element = await openPrep(await mountChosen());
      const forged = document.createElement('div');
      forged.dataset['field'] = 'weighInTime-ish';
      element.append(forged);
      teardown.push(() => {
        forged.remove();
      });

      forged.dispatchEvent(
        new CustomEvent<TextFieldChangeDetail>(TEXT_FIELD_CHANGE_EVENT, {
          detail: { value: 'early doors' },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);
      expect(refusalUnder(element, 'weighInTime')).toBe('');

      await typeDeep(element, 'weighInTime', 'early doors');
      expect(refusalUnder(element, 'weighInTime')).not.toBe('');
    });

    it('ignores a tick reported for a group with no rows on this meet', async () => {
      // The other half of the same guard, on the other attribute. `#tickChecklist`
      // re-derives the rows rather than trusting the report, so a group name that
      // reaches no rows -- a stale control, or a forged event -- writes nothing
      // instead of clearing the tool's idea of a group it cannot see.
      const element = await openPrep(await mountChosen());
      await tickRow(element, 'bring', 'belt');
      expect(progressText(element)).toContain('1 of');

      const forged = document.createElement('div');
      forged.dataset['group'] = 'own';
      element.append(forged);
      teardown.push(() => {
        forged.remove();
      });
      forged.dispatchEvent(
        new CustomEvent<ToggleGroupChangeDetail>(TOGGLE_GROUP_CHANGE_EVENT, {
          detail: { value: 'belt', selected: false, values: [] },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(progressText(element)).toContain('1 of');
    });

    it('reads the group off the nearest element carrying it, not off the one that fired', async () => {
      // `attributeOf` walks the composed path, and the walk is what a mutation
      // found unexercised: both of its callers read an attribute that today sits
      // on the element the event is dispatched from, so a version stopping at the
      // first `HTMLElement` passed the whole suite. `#liftOf` is the same loop
      // over `data-lift`, which `ptk-plan-method` *does* put on a wrapper -- so
      // the shape below is not hypothetical, it is the shape the other two walks
      // are already in, and the day a group heading owns the attribute this is
      // the difference between a tick landing and nothing happening.
      //
      // Nested the wrong way round on purpose: an outer `do` around an inner
      // `bring`, fired from a leaf inside both. Only the nearest one has "belt"
      // among its rows, so a walk that ran to the end of the path would scope the
      // write to the four `do` rows, find "belt" in none of them, and leave the
      // count where it started -- which is also what stopping too early does.
      const element = await openPrep(await mountChosen());
      expect(progressText(element)).toContain('0 of');

      const outer = document.createElement('div');
      outer.dataset['group'] = 'do';
      const inner = document.createElement('div');
      inner.dataset['group'] = 'bring';
      const leaf = document.createElement('span');
      inner.append(leaf);
      outer.append(inner);
      element.append(outer);
      teardown.push(() => {
        outer.remove();
      });
      leaf.dispatchEvent(
        new CustomEvent<ToggleGroupChangeDetail>(TOGGLE_GROUP_CHANGE_EVENT, {
          detail: { value: 'belt', selected: true, values: ['belt'] },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(progressText(element)).toContain('1 of');
    });

    it('keeps every answer out of the store the setup answers go to', async () => {
      // §13.4's line, and the reason none of this goes through `#setSession`. A
      // rack height belongs to a venue and a lot number to one Saturday; saved,
      // they would greet a lifter at their second meet as though they were
      // theirs, which is worse than a blank form because it is wrong rather than
      // empty. Persisting a whole meet is task #52 and comes with its own
      // consent question.
      // Read off the storage rather than off the six known keys: the claim is
      // that none of this is written *anywhere*, and a `MEET_DAY_PREFERENCES`
      // lookup can only ever confirm that the answers did not land in the six
      // slots that were never going to hold them.
      const storage = memoryPreferenceStorage();
      const element = await openPrep(
        await mountChosen({ settings: createPreferenceStore(storage) }),
      );
      await typeDeep(element, 'squatRackHeight', 'rack fourteen');
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Mouthguard');
      await pressAdd(element);
      await tickRow(element, 'bring', 'belt');
      // The control: the setup answers that *are* settings still get written, so
      // this cannot pass against a tool that stores nothing at all.
      await choose(element, UNIT_FIELD, 'lb');

      // Joined rather than compared entry by entry: what is being asserted is
      // that three strings are nowhere on the device, and the store encodes each
      // value as JSON, so a key holding `"lb"` is not the string `lb`.
      const written = storage.keys().map((key) => storage.read(key) ?? '');
      expect(written.join(' ')).toContain('lb');
      expect(written.join(' ')).not.toContain('rack fourteen');
      expect(written.join(' ')).not.toContain('Mouthguard');
      expect(written.join(' ')).not.toContain('belt');
    });

    it('asks the checklist about the meet the lifter answered for', async () => {
      // The context is rebuilt from the session on every render rather than
      // held, so a corrected format reaches the list. Bench-only contests no
      // deadlift, and the socks are one of the four rows the change withdraws.
      const element = await openPrep(await mountChosen());
      expect(rowValues(element, 'bring')).toContain('deadlift-socks');

      await choose(element, FORMAT_FIELD, 'bench-only');

      expect(rowValues(element, 'bring')).not.toContain('deadlift-socks');
      // The control: the list did not simply empty.
      expect(rowValues(element, 'bring')).toContain('bench-shoes');
    });

    it('has no accessibility violations with the fold open', async () => {
      const element = await openPrep(await mountChosen());
      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the fold open', async () => {
      // Sixteen labelled boxes and twenty-three tick rows, at 320 pixels (§5.7),
      // under everything else this screen already draws.
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await openPrep(await mountChosen({ within: frame }));
      await typeDeep(element, CUSTOM_ITEM_FIELD, 'Spare singlet for the second session');
      await pressAdd(element);

      expect(deepText(element)).toContain(CHECKLIST_HEADING);
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
