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
import { printRule } from '../testing/print-rules.js';
import {
  CHECKLIST_HEADING,
  COACH_MODE,
  COLOUR_CHOICES,
  CONVERT_ANSWER,
  HANDLER_PACK_NO_HANDLERS,
  KEEP_ANSWER,
  MEET_IS_RUNNING_NOTE,
  RECORD_NEEDS_A_FIGURE,
  RECORD_RESTORED,
  ROSTER_NEEDS_A_FEDERATION,
  SOLO_MODE,
  START_MEET_NEEDS_A_PLAN,
  SUMMARY_LIFTS_HEADING,
  WARMUP_NEEDS_AN_OPENER,
} from './copy.js';
import {
  CONFIRM_FIELD,
  CONVERT_FIELD,
  CUSTOM_ITEM_FIELD,
  EFFORT_FIELD,
  EQUIPMENT_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FORMAT_FIELD,
  LIFTER_NAME_FIELD,
  MEET_NAME_FIELD,
  MODE_FIELD,
  OTHER_WEIGHT_FIELD,
  OUTCOME_FIELD,
  PREP_NOTES_FIELD,
  RECORD_SUBJECT_ATTRIBUTE,
  RECORD_SUBJECT_FIELD,
  REMOVE_CUSTOM_ITEM_FIELD,
  ROSTER_COLOUR_FIELD,
  ROSTER_HANDLER_ADD_FIELD,
  ROSTER_HANDLER_DUTIES_FIELD,
  ROSTER_HANDLER_NAME_FIELD,
  ROSTER_HANDLER_REMOVE_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  ROSTER_RACK_FIELD,
  UNIT_FIELD,
  WARMUP_LIFT_FIELD,
  WARMUP_SUBJECT_FIELD,
} from './fields.js';
import { aShelf, aShelfOfHistory } from './library-fixture.js';
import { writeMeetFile } from './meet-file.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { type MeetStore, noMeetStore, sessionMeets, storedMeets } from './meet-store.js';
import { CUSTOM_ITEM_MAX, PREP_NOTES_MAX } from './prep.js';
import { PROBABILITY_WORDS, PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import { BOARD_OPEN_EVENT, type BoardOpenDetail } from './ptk-coach-board.js';
import { UNDO_REQUEST_EVENT, type UndoRequestDetail } from './ptk-live-screen.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import {
  FEDERATION_CHANGE_EVENT,
  type FederationChangeDetail,
  PtkMeetDayPlanner,
} from './ptk-meet-day-planner.js';
import './ptk-meet-day-planner.js';
import { MEET_RECORD_CHANGE_EVENT, type MeetRecordChangeDetail } from './ptk-meet-record.js';
import { MEET_WARMUP_CHANGE_EVENT, type MeetWarmupChangeDetail } from './ptk-meet-warmup.js';
import { EMPTY_RECORD_STATE, withRecord } from './records.js';
import {
  EMPTY_LIBRARY,
  EMPTY_SAVED_STATE,
  type MeetLibrary,
  type SavedHistory,
  activeMeet,
  createMeet,
} from './saved-meet.js';
import { MEET_DAY_PREFERENCES, loadSession, saveSession } from './session.js';
import { EMPTY_WARMUP_STATE, withProgress } from './warmup.js';

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
  readonly store?: MeetStore;
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
  // §24 withdraws itself entirely under `noMeetStore`, so this default is what
  // puts every other test in this file on the embed's side of that branch --
  // the shelf is out of the way unless a test asks for it, and no test can
  // reach the device the suite is running on.
  element.store = options.store ?? noMeetStore();
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

/**
 * §7's question answered and agreed for all three lifts.
 *
 * Separate from `planned` so that a test needing to answer something *before*
 * the maximums has somewhere to put it. `withUnit` withdraws every confirmation
 * (see `#chooseUnit`), so a unit answered after this runs takes the plan back
 * off the screen rather than restating it -- and a test that wants a plan in
 * pounds has to answer the unit first.
 */
async function agreeThreeMaximums(element: PtkMeetDayPlanner): Promise<void> {
  for (const lift of ['squat', 'bench', 'deadlift']) {
    await type(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
    await confirm(element, lift);
  }
  // Positive control for every live test below: there is a plan to start from.
  // Without it a broken §7 gate would leave the start panel saying "agree a
  // maximum", and every assertion about the platform would fail for that reason
  // rather than for its own.
  if (attemptLists(element) !== 3) throw new Error('No plan was drawn.');
}

/** A mounted root with a plan on screen: three lifts, agreed, nine attempts. */
async function planned(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = await mountChosen(options);
  await agreeThreeMaximums(element);
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

/** Presses §14.1's "Mark handed in", which is what puts an attempt on the bar. */
async function markHandedIn(element: PtkMeetDayPlanner): Promise<void> {
  const [mark] = deepControls(element, 'section.panel > ptk-button');
  if (mark === undefined) throw new Error('No submission panel to mark.');
  await press(element, mark);
}

/**
 * §12's card, answered as a good lift and recorded.
 *
 * Two taps rather than one: a good lift is the outcome that asks a follow-up,
 * and Record stays disabled until the effort tile is answered. The Record
 * control carries no class of its own, so it is addressed as the one button
 * `ptk-attempt-result` draws directly inside its card -- `div.card >`, not
 * `.card`, because §13's choices render each of theirs inside an `li.card`.
 */
async function recordGoodLift(element: PtkMeetDayPlanner): Promise<void> {
  await chooseDeep(element, OUTCOME_FIELD, 'good');
  await chooseDeep(element, EFFORT_FIELD, 'solid');
  const [record] = deepControls(element, 'div.card > ptk-button');
  if (record === undefined) throw new Error('No way to record the attempt.');
  await press(element, record);
}

/**
 * Nine attempts made, which is the only way to reach §26 through the screens.
 *
 * Nine and not three: `recordResult` resolves the attempt it names and nothing
 * else, including for a pass, so a three-lift meet is over after the ninth
 * result and not before. The loop is written as a count rather than as "until
 * the summary appears" so that a wiring fault which finishes the meet early is
 * a failure here rather than a shorter loop nobody notices.
 *
 * The throw at the end is the positive control every assertion below leans on,
 * the same one `planned()` carries: without it a root that never swapped the
 * screen would leave every summary assertion failing for the wrong reason.
 */
async function finishTheMeet(element: PtkMeetDayPlanner): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS_IN_A_MEET; attempt += 1) {
    await chooseOffered(element);
    await markHandedIn(element);
    await recordGoodLift(element);
  }
  if (summaryScreen(element) === null) throw new Error('The meet did not finish.');
}

/** Three lifts, three attempts each. */
const ATTEMPTS_IN_A_MEET = 9;

/** §26's page, which replaces the platform screen rather than joining it. */
function summaryScreen(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-meet-summary') ?? null;
}

/** §9.4's panel, which sits under the summary on the lifter's own device. */
function calibrationPanel(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-meet-calibration') ?? null;
}

/** One line off the panel, so an assertion cannot be met by a sibling saying something similar. */
function panelText(element: PtkMeetDayPlanner, selector: string): string {
  const found = calibrationPanel(element)?.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) throw new Error(`The panel has no ${selector}.`);
  return found.textContent.trim();
}

/** One line off the summary, scoped for the reason `panelText` is. */
function summaryText(element: PtkMeetDayPlanner, selector: string): string {
  const found = summaryScreen(element)?.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) throw new Error(`The summary has no ${selector}.`);
  return found.textContent.trim();
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
 *
 * Scoped to `.prep` as well, and that class is why §13.14 put it there. §20's
 * warm-up fold now renders *above* this one, so a bare `ptk-disclosure` returns
 * the warm-up. Nothing failed when it did: Chromium lays out the contents of a
 * shut `<details>`, so `deepControls` kept finding the prep controls and the
 * whole suite stayed green while `openPrep` opened the wrong fold -- the same
 * hazard `apps/web/CLAUDE.md` records against proving a `clickAfter` by
 * measurement, arriving here as a silently broken helper.
 */
function prepFold(element: PtkMeetDayPlanner): PtkDisclosure | null {
  const found = element.shadowRoot?.querySelector('ptk-disclosure.prep') ?? null;
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

/** §24.2's shelf, which is absent rather than empty where nothing is kept. */
function shelf(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('ptk-meet-library') ?? null;
}

/** §24.1's invitation, which withdraws the moment a meet is open. */
function naming(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('section.naming') ?? null;
}

/** The line that replaces it, saying where the changes are going. */
function openLine(element: PtkMeetDayPlanner): string | null {
  return element.shadowRoot?.querySelector('p.naming')?.textContent.trim() ?? null;
}

/** What each meet on the shelf is called, in the order they are listed. */
function shelfNames(element: PtkMeetDayPlanner): string[] {
  const rows = shelf(element)?.shadowRoot?.querySelectorAll('li.meet h4') ?? [];
  return [...rows].map((row) => row.textContent.trim());
}

/**
 * The one sentence the planner put on the shelf, and not the other two.
 *
 * The shelf renders three notices from three different facts -- what this
 * browser does with a write, how many meets this build cannot open, and whatever
 * the root last said -- and only the last of those is this file's business.
 * `role="status"` is what distinguishes it in the markup as well as to a reader.
 */
function shelfMessage(element: PtkMeetDayPlanner): string {
  const notice = shelf(element)?.shadowRoot?.querySelector('ptk-notice[role="status"] p');
  return notice?.textContent.trim() ?? '';
}

/** §24.3's warning, which is the first notice on the shelf and always there. */
function storageSentence(element: PtkMeetDayPlanner): string {
  return shelf(element)?.shadowRoot?.querySelector('ptk-notice p')?.textContent.trim() ?? '';
}

/**
 * Waits for a write, which nothing on screen is waiting for.
 *
 * `#writeLibrary` chains onto a private promise so two saves cannot overtake
 * each other, and no render awaits the result -- so `updateComplete` says
 * nothing about whether the shelf reached the store. A macrotask is the honest
 * wait: every link in that chain is a microtask over a store that answers
 * synchronously, and a test counting microtasks would pass until somebody added
 * a link and then fail somewhere else entirely.
 */
async function afterStorage(element: PtkMeetDayPlanner): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await settled(element);
}

/** What is actually on the device, rather than what the screen believes. */
async function stored(store: MeetStore): Promise<MeetLibrary> {
  return (await store.load()).library;
}

/** A mounted root that has already read whatever the store was holding. */
async function mountShelved(options: Options = {}): Promise<PtkMeetDayPlanner> {
  const element = await mount({ store: sessionMeets(), ...options });
  await afterStorage(element);
  return element;
}

/** Names the meet and presses §24.1's one control, the way a thumb does. */
async function nameMeet(element: PtkMeetDayPlanner, name: string): Promise<void> {
  if (name !== '') await type(element, MEET_NAME_FIELD, name);
  const block = naming(element);
  if (block === null) throw new Error('There is nothing on screen to name a meet with.');
  const control = block.querySelector('ptk-button');
  if (control === null) throw new Error('The naming block has no control.');
  await press(element, control);
  await afterStorage(element);
}

/** §24.4's preview, which stands between a chosen file and the shelf. */
function importing(element: PtkMeetDayPlanner): Element | null {
  return element.shadowRoot?.querySelector('section.importing') ?? null;
}

/**
 * How many macrotasks `chooseFile` will give a file read before it gives up.
 *
 * Generous on purpose: the cost of a high number is nothing at all on a machine
 * that reads the file promptly, since the loop returns on the first poll that
 * sees an answer, while the cost of a low one is a test that fails on a busy
 * runner and names the wrong thing when it does.
 */
const FILE_READ_POLLS = 100;

/**
 * Hands a file to the shelf's own picker, rather than forging what it reports.
 *
 * The input is visually clipped and reached through a button beside it, which
 * is the one control in this tool a test could skip without noticing: a shelf
 * whose picker was wired to nothing would pass a forged-event test exactly as
 * the working one does.
 */
async function chooseFile(element: PtkMeetDayPlanner, file: File): Promise<void> {
  const input = shelf(element)?.shadowRoot?.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('The shelf has no file picker.');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Polled rather than waited out, because `#readImport` awaits `file.text()`
  // and a file read does not settle on the macrotask queue -- it is its own task
  // source, and how long it takes is the machine's business rather than this
  // element's. `afterStorage`'s single macrotask happened to be enough on this
  // laptop and on the runner for months, and then was not: CI failed on
  // `expect(importing(element)).not.toBeNull()` with the panel simply not open
  // yet, in a test that had nothing to do with the change under it. Cost a red
  // deploy of a green commit.
  //
  // The condition takes either outcome, because every path through
  // `#readImport` ends in exactly one of them: a panel, or a refusal on the
  // shelf. Waiting only for the panel would turn a genuine refusal into a
  // timeout and report a slow read as a missing sentence.
  for (let poll = 0; poll < FILE_READ_POLLS; poll += 1) {
    await afterStorage(element);
    if (importing(element) !== null || shelfMessage(element) !== '') return;
  }
  throw new Error('The chosen file was never read.');
}

/** Presses the first of the preview's two answers. */
async function confirmImport(element: PtkMeetDayPlanner): Promise<void> {
  const panel = importing(element);
  if (panel === null) throw new Error('There is no import waiting to be confirmed.');
  const control = panel.querySelector('ptk-button');
  if (control === null) throw new Error('The preview panel has no answers on it.');
  await press(element, control);
  await afterStorage(element);
}

/** Presses one of the shelf's own footer controls. */
async function pressShelf(element: PtkMeetDayPlanner, command: string): Promise<void> {
  const host = shelf(element)?.shadowRoot?.querySelector(`ptk-button[data-command="${command}"]`);
  if (host === null || host === undefined) throw new Error(`No "${command}" control on the shelf.`);
  await press(element, host);
  await afterStorage(element);
}

/**
 * A saved meet, built by the transitions rather than written out as a literal.
 *
 * The same reason `library-fixture.ts` gives: a literal can hold a shelf whose
 * counter is behind its own identifiers, or an archived meet that is also the
 * open one, and a test asserting the screen copes with one proves the screen
 * copes with something that cannot arrive.
 */
function savedShelf(patch: {
  readonly name: string;
  readonly rulesProfileId: string;
  readonly rulebookRevision: string;
}): MeetLibrary {
  const change = createMeet(EMPTY_LIBRARY, {
    name: patch.name,
    now: FIXED_INSTANT,
    rulesProfileId: patch.rulesProfileId,
    rulebookRevision: patch.rulebookRevision,
    // The federation the saved session names, always -- `#restoreReport` is
    // silent unless it matches the meet's own, so a fixture that left this at
    // `EMPTY_SESSION` would report nothing whatever the revision said.
    state: { ...EMPTY_SAVED_STATE, session: plannerSession() },
  });
  if (!change.ok) throw new Error(`The fixture meet was refused: ${change.reason}.`);
  return change.library;
}

/** A page-lifetime store already holding a shelf, the way a reload finds one. */
async function heldShelf(library: MeetLibrary): Promise<MeetStore> {
  const store = sessionMeets();
  await store.save(library);
  return store;
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
   * §26, from the root (the only place it can be reached from).
   *
   * `ptk-meet-summary` has its own browser test and `summary.ts` its own unit
   * suite, and neither can fail for any of the reasons here. What is only wrong
   * at this level is which screen the finished meet lands on, which plan it is
   * compared against, and whether the last action is still undoable once the
   * control that used to offer that has gone off the page with the platform.
   */
  describe('the finished meet (§26)', () => {
    it('puts the summary up in place of the platform, never beside it', async () => {
      // The replacement is the requirement, not a layout preference.
      // `ptk-live-screen` prints the banked and projected totals
      // unconditionally -- `meetOver` silences only the called attempt and the
      // next-attempt line -- so a summary rendered beside it puts two totals on
      // one page under two headings, which is precisely the failure §17 is
      // written about. Asserting the summary is present is the half that would
      // pass either way; the null live screen is the half that is the rule.
      const element = await planned();
      await startMeet(element);
      // Positive control: the platform is what is on screen before the ninth
      // result, so its absence below is the swap rather than a screen that
      // never appeared.
      expect(liveScreen(element)).not.toBeNull();

      await finishTheMeet(element);

      expect(liveScreen(element)).toBeNull();
      expect(deepText(element)).toContain(SUMMARY_LIFTS_HEADING);
      expect(deepText(element)).toContain(LIFTER_NAME);
    });

    it('compares the day against the plan the meet was started from', async () => {
      // The frozen `LiveRun.view`, which is `MEET_IS_RUNNING_NOTE`'s promise
      // arriving one screen later than §13.11 tested it. The planning screens
      // stay answerable behind live mode, so a lifter can edit the plan after
      // the meet has started -- and the summary is where reading the edited one
      // costs the most: every "above the plan" line on the page would be
      // measuring the edit rather than the decision, after the fact, to
      // somebody with no way to check it against anything.
      const element = await planned();
      const planned200 = openerText(element);
      await startMeet(element);

      await press(element, button(element, 'ptk-button.back'));
      await type(element, EXPECTED_MAXIMUM_FIELD, '260', 'squat');
      await confirm(element, 'squat');
      const planned260 = openerText(element);
      // Positive control: the two plans really are two plans. Without it the
      // assertions below pass against an edit that changed nothing.
      expect(planned260).not.toBe(planned200);
      await press(element, button(element, '.running ptk-button'));

      await finishTheMeet(element);

      expect(deepText(element)).toContain(`Planned ${planned200}`);
      expect(deepText(element)).not.toContain(`Planned ${planned260}`);
    });

    it('keeps the last action undoable once the platform screen has gone', async () => {
      // §13.9 is not "the live screen has an undo button", it is that every
      // action stays undoable -- and the action most likely to need taking back
      // is the last one, recorded against the wrong outcome, by which time the
      // screen carrying the control has been replaced by this one. The label is
      // pinned to a fragment rather than to `undoLabel`, per §13.8.
      const element = await planned();
      await startMeet(element);
      await finishTheMeet(element);

      expect(deepText(element)).toContain('Undo recording');

      await press(element, button(element, 'ptk-button.undo'));

      // Back on the platform, because a meet with an unrecorded ninth attempt
      // is not over. The summary going away is the observable half of that.
      expect(summaryScreen(element)).toBeNull();
      expect(liveScreen(element)).not.toBeNull();
    });

    it('has no accessibility violations with the day summarised', async () => {
      const element = await planned();
      await startMeet(element);
      await finishTheMeet(element);

      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the day summarised', async () => {
      // The longest page in the tool -- eight sections, up to nine facts per
      // attempt row -- and the one most likely to be read on a phone in a car
      // park afterwards (§5.7).
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await planned({ within: frame });
      await startMeet(element);
      await finishTheMeet(element);

      expect(summaryScreen(element)).not.toBeNull();
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    /**
     * §9.4's entry as it reaches the disk, rather than as the screen draws it.
     *
     * Read off the store and not off the element, because what a later
     * calibration reads is the saved meet: an entry the root held in memory and
     * never wrote would satisfy any assertion made against the screen and be
     * gone by the next visit, which is the one failure this wiring can have.
     */
    async function savedHistory(store: MeetStore): Promise<SavedHistory | null> {
      const meet = activeMeet(await stored(store));
      if (meet === null) throw new Error('No meet is open on the shelf.');
      return meet.state.history;
    }

    it('files the day into the saved meet, and not one attempt sooner', async () => {
      // Both halves are the requirement. An entry filed early is a lifter still
      // owed a deadlift recorded as having bombed one, and an entry never filed
      // is a season of meets that calibration cannot see -- and neither shows
      // on any screen, because nothing in the tool renders §9.4 yet.
      const store = sessionMeets();
      const element = await planned({ store });
      // Answered rather than left alone: `historyEquipmentFor` reports
      // 'unstated' for a session nobody answered, which is also exactly what a
      // wiring fault that never read the session would produce.
      await choose(element, EQUIPMENT_FIELD, 'wraps');
      // Required, and not scene-setting: naming the meet is what opens one on
      // the shelf, and without an open meet `updated()` saves nothing at all.
      await nameMeet(element, 'A meet with a history');
      await startMeet(element);
      await afterStorage(element);

      // Positive control: the meet is on the shelf and being written to
      // throughout, so the null is the day not being over rather than nothing
      // reaching the store.
      expect(await savedHistory(store)).toBeNull();

      await finishTheMeet(element);
      await afterStorage(element);

      const history = await savedHistory(store);
      expect(history?.equipment).toBe('wraps');
      expect(history?.lifts.map((lift) => lift.lift)).toStrictEqual(['squat', 'bench', 'deadlift']);
      expect(history?.lifts.flatMap((lift) => lift.attempts.map((made) => made.outcome))).toEqual(
        Array.from({ length: ATTEMPTS_IN_A_MEET }, () => 'good'),
      );
      // 200 is the figure this test typed into every lift, pinned rather than
      // read back off the summary: an entry whose planned maximum came from the
      // same builder that filled the rest of it agrees with itself whatever it
      // holds, and this is the one number a jump is later measured against.
      expect(history?.lifts.map((lift) => lift.plannedMaximumKilograms)).toStrictEqual([
        200, 200, 200,
      ]);
    });

    it('puts §9.4 under the day and not over it, with nothing to read at a first meet', async () => {
      // Two rules in one screen, and the empty one is the screen every lifter
      // sees at their first meet. Order first: the page is about the day that
      // has just been contested, and a panel of medians from earlier meets
      // above the total answers a question nobody asked yet.
      const element = await planned();
      await startMeet(element);
      await finishTheMeet(element);

      const sections = [
        ...(element.shadowRoot?.querySelectorAll('ptk-meet-summary, ptk-meet-calibration') ?? []),
      ];
      expect(sections.map((section) => section.localName)).toEqual([
        'ptk-meet-summary',
        'ptk-meet-calibration',
      ]);

      // And the panel is drawn empty rather than withheld. `noMeetStore()` is
      // this mount's default, so there is no shelf behind the day at all --
      // which is exactly the state a first meet produces, and the state where a
      // withheld panel and a broken one look identical.
      expect(panelText(element, '.read')).toContain('No earlier');
    });

    it('reads the shelf, leaves the meet on screen out of it, and scopes it to the answered equipment', async () => {
      // The three things `#shelfCalibration` decides, and none of them shows on
      // any other screen. The shelf is three archived meets carrying §9.4
      // entries -- two raw, one under wraps -- so a raw lifter finishing a
      // fourth should read two: three raw histories on the device, minus their
      // own, with the wrapped one reported as left out rather than folded in.
      const store = await heldShelf(aShelfOfHistory());
      const element = await planned({ store });
      // The shelf is read once on connection and nothing on screen waits for
      // it, so the answers below have to follow the load rather than race it.
      await afterStorage(element);
      await choose(element, EQUIPMENT_FIELD, 'raw');
      await nameMeet(element, 'The fourth meet');
      await startMeet(element);
      await finishTheMeet(element);
      await afterStorage(element);

      // The positive control, and the whole reason "2" means anything. Four
      // meets on the device carry a history and three of those are raw, so the
      // panel reading two is the meet on screen being excluded -- not a shelf
      // that only ever held two, which is what this assertion would catch.
      const histories = (await stored(store)).meets
        .map((meet) => meet.state.history)
        .filter((history) => history !== null);
      expect(histories).toHaveLength(4);
      expect(histories.filter((history) => history.equipment === 'raw')).toHaveLength(3);

      expect(panelText(element, '.read')).toContain('From 2 earlier meets');
      // The scope, which is the half that proves the answered equipment was
      // read at all: a wiring that hard-coded a scope would count the same two
      // raw meets and say nothing about the third.
      expect(panelText(element, '.out-of-scope')).toContain('1 meet was');
    });

    it('draws both halves of the finished page in the unit the lifter answered', async () => {
      // Two bindings off one expression, and before this test nothing reached
      // either: `#renderFinished` hands `session.setup.unit` to the summary and
      // to §9.4's panel, and nothing type-checks a lit-html binding. Both
      // defaults are kilograms, so a dropped binding is invisible to every
      // other test in this file -- all of which leave the unit alone. What it
      // costs is a lifter who answered pounds reading the total of their own
      // day, and the medians of every day before it, as kilograms; every figure
      // on both halves is a weight, so there is nothing else on the page to
      // tell them otherwise.
      //
      // The shelf is here for the panel's sake rather than the summary's: with
      // no history the lifts section prints a sentence and carries no weight at
      // all, and an assertion about a unit needs a figure to read it off.
      const element = await mountChosen({ store: await heldShelf(aShelfOfHistory()) });
      await afterStorage(element);
      // Before the maximums, deliberately -- see `agreeThreeMaximums`.
      await choose(element, UNIT_FIELD, 'lb');
      await agreeThreeMaximums(element);
      await choose(element, EQUIPMENT_FIELD, 'raw');
      await startMeet(element);
      await finishTheMeet(element);

      // Hand-computed rather than converted here: the squat jumped 150 to 160
      // to 170 in both raw meets on the shelf, so the median successful jump is
      // 10 kg, which is 22.0462 lb at two places. A second call to the tool's
      // own converter would agree with a broken binding.
      expect(panelText(element, '.successful-jump .value')).toBe('22.05 lb');

      // The summary's own half, which is a different binding on the same line.
      // Pinned as a fragment plus the absence of the other unit rather than as
      // a figure: the total is three attempts off a plan built from a 200 lb
      // maximum, so a literal here would be measuring §9.1's rounding.
      const total = summaryText(element, '.total .figure');
      expect(total).toContain(' lb');
      expect(total).not.toContain('kg');
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

    /**
     * One of a handler's three controls, keyed by position within the row.
     *
     * `controls` rather than a walk of every shadow root: the roster is a direct
     * child of this element's shadow root, so its controls are one level down
     * and already reachable. No `data-lifter` in the selector, because every
     * test below has exactly one lifter -- and the throw on a count other than
     * one is what would catch a second row appearing under a later change,
     * rather than the helper quietly reading the first of two.
     */
    function handlerControl(element: PtkMeetDayPlanner, field: string, index: number): Element {
      const selector = `[data-field="${field}"][data-handler="${String(index)}"]`;
      const found = controls(element, selector);
      const only = found[0];
      if (found.length !== 1 || only === undefined) {
        throw new Error(
          `Expected one "${field}" for handler ${String(index)}, found ${String(found.length)}.`,
        );
      }
      return only;
    }

    /** Presses "Add a handler" on the roster's one row. */
    async function addHandler(element: PtkMeetDayPlanner): Promise<void> {
      const host = controls(element, `[data-field="${ROSTER_HANDLER_ADD_FIELD}"]`)[0];
      if (host === undefined) throw new Error('No way to add a handler.');
      await press(element, host);
    }

    /** Types into one handler's name box. */
    async function nameHandler(
      element: PtkMeetDayPlanner,
      index: number,
      name: string,
    ): Promise<void> {
      await enter(element, handlerControl(element, ROSTER_HANDLER_NAME_FIELD, index), name);
    }

    /** Ticks one responsibility on one handler, the way a coach does. */
    async function tickDuty(
      element: PtkMeetDayPlanner,
      index: number,
      value: string,
    ): Promise<void> {
      const host = handlerControl(element, ROSTER_HANDLER_DUTIES_FIELD, index);
      const box = [...(host.shadowRoot?.querySelectorAll('input') ?? [])].find(
        (input) => input.value === value,
      );
      if (box === undefined) throw new Error(`No responsibility "${value}" to tick.`);
      box.click();
      await settled(element);
    }

    /** Presses one handler's own remove button. */
    async function removeHandler(element: PtkMeetDayPlanner, index: number): Promise<void> {
      await press(element, handlerControl(element, ROSTER_HANDLER_REMOVE_FIELD, index));
    }

    /**
     * One roster row's summary line, read off the fold's attribute.
     *
     * The attribute rather than the row's text, because the two answer different
     * questions and only this one is derived from the record. A row holds the
     * rack box itself -- bound to `.value`, so it keeps what was typed whether or
     * not the report came back (§13.14) -- and it holds a "Handlers" heading and
     * an "Add a handler" button, so any assertion that a row does *not* mention a
     * handler is satisfied by the control that adds one. `rosterSummary` omits
     * the bar and the count when they are unset, which is what makes the two
     * readings genuinely different sentences.
     */
    function rosterSummaryOf(element: PtkMeetDayPlanner, position: number): string | null {
      const fold = roster(element)?.shadowRoot?.querySelectorAll('ul > li')[position];
      const summary = fold?.querySelector('ptk-disclosure');
      if (summary === null || summary === undefined) {
        throw new Error(`No fold on roster row ${String(position)}.`);
      }
      return summary.getAttribute('summary');
    }

    /**
     * §21.3's handlers as the board prints them.
     *
     * Scoped past `.facts`, which the row already uses for the attempts-left and
     * banked-total list three lines above -- §13.12's `.weight` lesson on a
     * second class. The handler block is the only `div.stack` in a row carrying
     * an `<h4>`.
     */
    function boardHandlerLines(element: PtkMeetDayPlanner): string[] {
      const lines =
        board(element)?.shadowRoot?.querySelectorAll(
          'article.row div.stack:has(> h4) > ul.facts > li',
        ) ?? [];
      return [...lines].map((line) => line.textContent.trim());
    }

    /** §23.2's printed roster, which names the handlers and not their duties. */
    function packHandlersText(element: PtkMeetDayPlanner): string {
      const sheet = element.shadowRoot?.querySelector('ptk-handler-pack');
      const names = sheet?.shadowRoot?.querySelector('.lifter .handlers');
      if (names === null || names === undefined) throw new Error('No handler line on the sheet.');
      return names.textContent.trim();
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

    it('keeps a handler with no name on the roster and off the board', async () => {
      // §21.3's blank row, which is the cost `ROSTER_HANDLER_ADD_EVENT` records
      // paying: a coach presses Add and goes to ask somebody their surname, so
      // the row has to survive being empty. `namedHandlers` in the domain is what
      // keeps it off the board and off §23.2's sheet in the meantime, and both of
      // those are the places a nameless line would be read aloud.
      const element = await running();
      expect(boardHandlerLines(element)).toEqual([]);
      const before = rosterSummaryOf(element, 0);

      await addHandler(element);

      expect(boardHandlerLines(element)).toEqual([]);
      expect(packHandlersText(element)).toBe(HANDLER_PACK_NO_HANDLERS);
      // The control the press was for. Without this the two assertions above are
      // also satisfied by a press that did nothing at all, which is the same
      // screen from the outside -- and by the root dropping the report, which is
      // what the summary line is derived from and the name box is not (§13.14).
      expect(rosterSummaryOf(element, 0)).not.toBe(before);
    });

    it('carries a named handler and what they cover onto the board', async () => {
      // The whole round trip: `#onHandlerAdd` appends, `#patchHandler` names,
      // `asResponsibilities` narrows the tick list, `namedHandlers` lets it
      // through and `handlerLine` writes it out. No element test can see it --
      // the roster reports and the board reads, and nothing between them is on
      // either element.
      const element = await running();
      await addHandler(element);
      await nameHandler(element, 0, 'Rae');

      expect(boardHandlerLines(element)).toHaveLength(1);
      expect(boardHandlerLines(element)[0]).toContain('Rae');
      const named = boardHandlerLines(element)[0];

      await tickDuty(element, 0, 'platform-escort');

      // Pinned to the literal as well as to the difference, per §13.8: an
      // assertion reading `handlerResponsibilityLabel` back would move with the
      // code it is meant to be holding still.
      expect(boardHandlerLines(element)[0]).not.toBe(named);
      expect(boardHandlerLines(element)[0]).toContain('the walk out');
      // §23.2 prints who, never what they cover, so the sheet is a second reader
      // of the same record and not a copy of the line above.
      expect(packHandlersText(element)).toContain('Rae');
    });

    it('removes the handler the press named, not the last one added', async () => {
      // `#onHandlerRemove` splices by the index on the button, which is the one
      // place in this tool that identifies a thing by position -- so the failure
      // it has to be tested against is the off-by-one that takes the wrong
      // person off. Two named handlers, because removing the only one leaves an
      // empty list either way.
      const element = await running();
      await addHandler(element);
      await nameHandler(element, 0, 'Rae');
      await addHandler(element);
      await nameHandler(element, 1, 'Devi');
      expect(boardHandlerLines(element)).toHaveLength(2);

      await removeHandler(element, 0);

      expect(boardHandlerLines(element)).toHaveLength(1);
      expect(boardHandlerLines(element)[0]).toContain('Devi');
    });

    it("puts §21.4's shared bar on the row's summary line", async () => {
      // The rack is the one per-lifter answer with nothing downstream of it yet
      // -- `ptk-coach-board`'s panel needs `view.racks`, which needs the warm-up
      // screen (#81) -- so the summary line is the only thing derived from the
      // record rather than bound to the box the coach typed in (§13.14).
      const element = await running();
      const before = rosterSummaryOf(element, 0);

      await type(element, ROSTER_RACK_FIELD, '1');

      expect(rosterSummaryOf(element, 0)).not.toBe(before);
      expect(rosterSummaryOf(element, 0)).toContain('bar 1');
    });

    it('keeps the handlers and the bar in what §24 saves', async () => {
      // Read off the store rather than off the screen, because `savedEntry`
      // builds its object key by key and omits anything undefined: a field left
      // out of it is a coach reopening tomorrow's meet with their handlers gone,
      // and every on-screen assertion above still passes.
      //
      // Named first, deliberately. `#save` needs an open meet id, so a handler
      // typed before the meet is named is only written by the save the naming
      // itself triggers -- which would pass here and prove nothing about the
      // per-change saves that carry the rest of the day.
      const store = sessionMeets();
      const element = await running({ store });
      await nameMeet(element, 'Saturday');

      await addHandler(element);
      await nameHandler(element, 0, 'Rae');
      await type(element, ROSTER_RACK_FIELD, '1');
      await afterStorage(element);

      const entry = (await stored(store)).meets[0]?.state.entries[0];
      expect(entry?.handlers?.map((handler) => handler.name)).toEqual(['Rae']);
      expect(entry?.rackId).toBe('1');
    });

    it('opens one lifter on their own platform screen, and comes back', async () => {
      // §21.1's one tap. The board goes away rather than sitting behind the
      // screen: they are two screens, and a coach scrolling past a live screen
      // to reach the board they were just on is the §11 layout undone.
      const element = await running();

      await openLifter(element);

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

      await openLifter(element);
      // One lifter's own screen is a live screen too, so it keeps counting.
      expect(clock.watchers).toBe(1);

      await press(element, button(element, 'ptk-button.back'));
      expect(clock.watchers).toBe(1);
    });

    it('draws §23.2 only once there is a lifter to print, and draws them shut', async () => {
      // The roster is built from the board, so before the first Add there is
      // nothing to print -- and an empty sheet under a heading saying "Printable
      // roster" is worse than no section, because a coach who prints it finds
      // out at the expeditor's table. Both halves, because a section that never
      // appears at all satisfies the first assertion perfectly.
      const element = await coachChosen();
      expect(element.shadowRoot?.querySelector('ptk-handler-pack')).toBeNull();

      await addLifter(element, LIFTER_NAME);
      const sheet = element.shadowRoot?.querySelector('ptk-handler-pack');
      if (sheet === null || sheet === undefined) throw new Error('No roster sheet on the board.');

      expect(sheet.hasAttribute('data-shut')).toBe(true);
      // Rendered rather than merely present: the sheet is in the DOM from the
      // first paint whatever the toggle says, which is the whole reason the
      // print rule can reach it. A template branch here would print blank.
      expect(sheet.shadowRoot?.querySelectorAll('.lifter')).toHaveLength(1);
      expect(sheet.shadowRoot?.textContent).toContain(LIFTER_NAME);
    });

    /** The board's one lifter, opened on their own platform screen. */
    async function openLifter(element: PtkMeetDayPlanner): Promise<void> {
      const open = board(element)?.shadowRoot?.querySelector('ptk-button.open');
      if (open === null || open === undefined) throw new Error('No way to open a lifter.');
      await press(element, open);
    }

    /**
     * One board lifter driven to the ninth result, on weights typed by hand.
     *
     * Not `finishTheMeet`: that presses the first offered card, and there are no
     * cards here. §13's choices are built from a planning maximum, and the coach
     * path has none for anybody -- the plan on this device belongs to whoever is
     * holding it, not to the athlete on the board -- so the free-entry field is
     * the whole of the weight entry on this screen and the loop is the proof
     * that it is enough on its own.
     *
     * Three whole kilograms per lift, rising by five. The fixture bar takes half
     * kilograms with a one-kilogram minimum progression (§5.1), so every figure
     * is legal for a reason the profile supplies rather than for one this file
     * assumes.
     */
    async function finishOneLifter(element: PtkMeetDayPlanner): Promise<void> {
      for (let attempt = 0; attempt < ATTEMPTS_IN_A_MEET; attempt += 1) {
        await typeDeep(element, OTHER_WEIGHT_FIELD, String(100 + (attempt % 3) * 5));
        await useTypedWeight(element);
        await markHandedIn(element);
        await recordGoodLift(element);
      }
      if (summaryScreen(element) === null) throw new Error('The lifter did not finish.');
    }

    it('summarises a board lifter with no plan to compare the day against', async () => {
      // §26 on the coach path, and the absence is the requirement rather than a
      // gap. The summary is built with `EMPTY_VIEW`, no targets and `'unstated'`
      // equipment for the same reason the coach live view is built with
      // `NO_PLANNING_AT_ALL`: the plan on this phone is the coach's own, and
      // printing it as "Planned 182 kg" beside somebody else's attempt is the
      // tool inventing a decision the athlete never made -- read afterwards, by
      // a coach with no way to tell whose figure it was.
      //
      // The rows are counted first because that is what stops this passing
      // against a summary that rendered nothing at all, which is the other way
      // to have no planned line on the page.
      const element = await running();
      await openLifter(element);

      await finishOneLifter(element);

      const summary = summaryScreen(element);
      expect(summary?.shadowRoot?.querySelectorAll('.attempt')).toHaveLength(ATTEMPTS_IN_A_MEET);
      expect(summary?.shadowRoot?.querySelectorAll('.planned')).toHaveLength(0);
      // The other half of the same fact: "how far above the plan" has no plan to
      // be above, and a zero there would read as every attempt landing exactly
      // on a figure nobody wrote down.
      expect(summary?.shadowRoot?.querySelectorAll('.against-plan')).toHaveLength(0);
    });

    it('reads no shelf beside a board lifter, because the shelf is not theirs', async () => {
      // The one place §9.4 must not appear, and for the same reason the coach
      // summary carries no planned line: the shelf is this coach's device, so a
      // panel of medians beside somebody else's finished meet would compare an
      // athlete against a history that is not theirs. That is worse than no
      // panel, because every figure in it would look like a fact about the
      // lifter on screen.
      //
      // A store is handed in deliberately -- with the default `noMeetStore()`
      // there is no shelf to read and the absence below would be free.
      const element = await running({ store: await heldShelf(aShelfOfHistory()) });
      await afterStorage(element);
      await openLifter(element);

      await finishOneLifter(element);

      // The positive control: the day is summarised, so the missing panel is
      // the decision rather than a screen that never finished.
      expect(summaryScreen(element)).not.toBeNull();
      expect(calibrationPanel(element)).toBeNull();
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

  describe('the warm-up fold (§20)', () => {
    /**
     * §20's fold, addressed by its own class for the reason §22's is.
     *
     * This one renders *above* the preparation fold, so a bare
     * `ptk-disclosure` selector silently moved `prepFold` onto the warm-up
     * the day this shipped -- and what it opened was also a real fold, which
     * is why the suite went on passing.
     */
    function warmupFold(element: PtkMeetDayPlanner): PtkDisclosure | null {
      const found = element.shadowRoot?.querySelector('ptk-disclosure.warmup') ?? null;
      return found instanceof PtkDisclosure ? found : null;
    }

    /** Opens it by setting `open`, never by pressing the summary (§13.6). */
    async function openWarmup(element: PtkMeetDayPlanner): Promise<PtkMeetDayPlanner> {
      const fold = warmupFold(element);
      if (fold === null) throw new Error('No warm-up fold to open.');
      fold.open = true;
      await settled(element);
      return element;
    }

    /**
     * The picker's options, as the bare `PlatformLift` each tile carries.
     *
     * `warmupLiftChoices` uses the lift id as the option value, so this needs
     * no copy constant -- and reading the value rather than the label keeps
     * the assertion about which lifts are contested rather than about how
     * they happen to be spelled.
     */
    function warmupLiftOptions(element: PtkMeetDayPlanner): string[] {
      const radios = deepControl(element, WARMUP_LIFT_FIELD).shadowRoot?.querySelectorAll('input');
      return [...(radios ?? [])].map((radio) => radio.value);
    }

    /** Which lift the fold is showing, read off the wrapper the root tags. */
    function warmupSubject(element: PtkMeetDayPlanner): string {
      const wrapper = element.shadowRoot?.querySelector('[data-warmup-subject]');
      if (!(wrapper instanceof HTMLElement)) throw new Error('No warm-up subject on screen.');
      return wrapper.dataset[WARMUP_SUBJECT_FIELD] ?? '';
    }

    /** The warm-up itself, which is what a report has to come out of. */
    function warmupElement(element: PtkMeetDayPlanner): Element {
      const found = element.shadowRoot?.querySelector('ptk-meet-warmup') ?? null;
      if (found === null) throw new Error('No warm-up on screen.');
      return found;
    }

    /**
     * The ramp, read out of the warm-up's own shadow tree.
     *
     * `deepText` is the wrong instrument for anything a child also says
     * (§13.9's `.pounds` lesson): the plan above this fold prints kilogram
     * figures too, so a whole-element read is satisfied by the screen the
     * fold is sitting on rather than by the fold.
     */
    function timelineRows(element: PtkMeetDayPlanner): string[] {
      const rows = warmupElement(element).shadowRoot?.querySelectorAll('ol.timeline > li .what');
      return [...(rows ?? [])].map((row) => row.textContent.trim());
    }

    /**
     * One rung's weight box, addressed by its index into the ramp.
     *
     * `deepControl` cannot reach these: there is one per set, so the field name
     * matches several controls and it throws. The index is what distinguishes
     * them and is also the thing under test, so it is spelled out here rather
     * than taking the first match.
     */
    function setBox(element: PtkMeetDayPlanner, index: number): Element {
      const found = deepControls(
        element,
        `[data-field="set-weight"][data-index="${String(index)}"]`,
      );
      const first = found[0];
      if (found.length !== 1 || first === undefined) {
        throw new Error(
          `Expected one set-weight box at ${String(index)}, found ${String(found.length)}.`,
        );
      }
      return first;
    }

    /**
     * The ramp index of the first rung a weight can be typed onto.
     *
     * Asked rather than assumed to be zero: `data-index` counts the *whole*
     * ramp, and every ramp opens with bar-only sets, which `isAdjustable`
     * refuses a weight box (there is nothing to adjust -- the weight is the
     * implement). So the first box on screen is never rung zero, and a test
     * addressing zero finds nothing on a screen that rendered perfectly.
     */
    function firstSetIndex(element: PtkMeetDayPlanner): number {
      const first = deepControls(element, '[data-field="set-weight"]')[0];
      if (!(first instanceof HTMLElement)) throw new Error('No adjustable rung on the ramp.');
      const index = Number(first.dataset['index']);
      if (!Number.isInteger(index)) throw new Error(`A set box carries no index: ${first.id}.`);
      return index;
    }

    /** What a box holds, read off the native control rather than off the host. */
    function innerValue(host: Element): string {
      const inner = host.shadowRoot?.querySelector('input');
      if (!(inner instanceof HTMLInputElement)) throw new Error(`No box inside ${host.localName}.`);
      return inner.value;
    }

    /** A report of the shape `ptk-meet-warmup` dispatches, with one answer in it. */
    function aReport(): CustomEvent<MeetWarmupChangeDetail> {
      return new CustomEvent<MeetWarmupChangeDetail>(MEET_WARMUP_CHANGE_EVENT, {
        detail: { state: withProgress(EMPTY_WARMUP_STATE, { flightSize: '7' }) },
        bubbles: true,
        composed: true,
      });
    }

    it('draws no warm-up until there is a rule book behind it', async () => {
      // The ramp is planned against `attemptsPerLift`, which has no honest
      // source without a profile -- so the fold waits for the federation
      // rather than guessing three.
      const element = await mount();

      expect(warmupFold(element)).toBeNull();
      // The control: the screen is drawn, and §22's fold is already on it.
      expect(prepFold(element)).not.toBeNull();
    });

    it('offers one tile per contested lift, in platform order', async () => {
      const element = await mountChosen();

      expect(warmupLiftOptions(element)).toEqual(['squat', 'bench', 'deadlift']);

      await choose(element, FORMAT_FIELD, 'bench-only');

      expect(warmupLiftOptions(element)).toEqual(['bench']);
      expect(warmupSubject(element)).toBe('bench');
    });

    it('keeps a per-set answer on the lift it was typed on', async () => {
      // `withWarmupFor`'s asymmetry, asserted from the screen: a set answer is
      // an index into the ramp in front of the lifter, and the squat ramp and
      // the bench ramp are different lengths off different openers -- so
      // carrying one across writes a weight nobody typed onto a set nobody has
      // seen. The box is read rather than the record because the record is
      // private; it bites both ways, since a report that never landed leaves
      // the typed figure in the box too (§13.14).
      const element = await openWarmup(await planned());
      const rung = firstSetIndex(element);
      await enter(element, setBox(element, rung), '60');

      await chooseDeep(element, WARMUP_LIFT_FIELD, 'bench');

      expect(warmupSubject(element)).toBe('bench');
      // The same rung of the bench ramp, so an answer carried across would be
      // on screen and not merely on record. Pinned rather than assumed: if the
      // two ramps started their weighted sets at different indices the box
      // below would be a different rung and the assertion would be vacuous.
      expect(firstSetIndex(element)).toBe(rung);
      expect(innerValue(setBox(element, rung))).toBe('');

      await chooseDeep(element, WARMUP_LIFT_FIELD, 'squat');

      expect(innerValue(setBox(element, rung))).toBe('60');
    });

    it('carries a preference about the room across every lift', async () => {
      // The other half of the same asymmetry, and the half a lifter would
      // notice: there is one warm-up room and one mind about how many sets to
      // take in it, so a screen that asked three times would be asking a
      // question it already had the answer to two taps away.
      //
      // Asserted on the ramp rather than on the box the figure was typed into.
      // A preference box is bound by attribute and the field writes its own
      // value on input, so reading it back cannot tell a recorded answer from a
      // dropped one -- the trimmed bench ramp can (§13.14).
      const element = await openWarmup(await planned());
      await chooseDeep(element, WARMUP_LIFT_FIELD, 'bench');
      const before = timelineRows(element).length;

      await chooseDeep(element, WARMUP_LIFT_FIELD, 'squat');
      await typeDeep(element, 'maximumSets', '2');
      await chooseDeep(element, WARMUP_LIFT_FIELD, 'bench');

      expect(before).toBeGreaterThan(0);
      expect(timelineRows(element).length).toBeLessThan(before);
    });

    it('takes a report only from a fold that names a lift', async () => {
      // The lift is read off the composed path rather than off `warmupLift`,
      // because the two disagree for as long as it takes a format change to
      // reach the picker -- §13.14's walk, arriving on a wrapper again.
      const element = await openWarmup(await planned());

      element.dispatchEvent(aReport());
      await settled(element);

      expect(boxValue(element, 'flightSize')).toBe('');

      // The control: the same report, out of the element that sits under the
      // wrapper carrying the lift. Nothing else about it differs.
      warmupElement(element).dispatchEvent(aReport());
      await settled(element);

      expect(boxValue(element, 'flightSize')).toBe('7');
    });

    it('refuses a lift the format does not contest', async () => {
      const element = await openWarmup(await planned());
      await chooseDeep(element, WARMUP_LIFT_FIELD, 'bench');
      await choose(element, FORMAT_FIELD, 'deadlift-only');

      // One tile is on the picker, so this is an answer nothing on screen
      // could have produced -- which is what a control rebuilt under a
      // format change looks like from here if it reports on the way out.
      const forged = document.createElement('div');
      forged.dataset['field'] = WARMUP_LIFT_FIELD;
      element.append(forged);
      teardown.push(() => {
        forged.remove();
      });
      const name = async (value: string): Promise<void> => {
        forged.dispatchEvent(
          new CustomEvent<ChoiceChangeDetail>(CHOICE_CHANGE_EVENT, {
            detail: { value },
            bubbles: true,
            composed: true,
          }),
        );
        await settled(element);
      };

      await name('squat');
      await choose(element, FORMAT_FIELD, 'full-power');

      // Where the lifter left it. The render clamps an uncontested lift back
      // onto the first one, so this is only visible once squat is contested
      // again -- which is why the format goes back before the assertion.
      expect(warmupSubject(element)).toBe('bench');

      // The control: the same forged report, naming a lift that is contested.
      await name('deadlift');

      expect(warmupSubject(element)).toBe('deadlift');
    });

    it('asks for an opener until the plan has one, then draws the ramp', async () => {
      const element = await openWarmup(await mountChosen());

      expect(deepText(element)).toContain(WARMUP_NEEDS_AN_OPENER);
      expect(timelineRows(element)).toEqual([]);

      await agreeThreeMaximums(element);

      expect(timelineRows(element).length).toBeGreaterThan(0);
      expect(deepText(element)).not.toContain(WARMUP_NEEDS_AN_OPENER);
    });

    it('ramps to the opener of the lift the picker names', async () => {
      // Three maximums far enough apart that the ramps cannot coincide.
      // `agreeThreeMaximums` agrees the same figure for all three, and this
      // assertion passes against a fold ignoring the picker under that.
      const element = await mountChosen();
      for (const [lift, maximum] of [
        ['squat', '260'],
        ['bench', '100'],
        ['deadlift', '300'],
      ] as const) {
        await type(element, EXPECTED_MAXIMUM_FIELD, maximum, lift);
        await confirm(element, lift);
      }
      await openWarmup(element);

      const squat = timelineRows(element);
      await chooseDeep(element, WARMUP_LIFT_FIELD, 'bench');
      const bench = timelineRows(element);

      expect(squat.length).toBeGreaterThan(0);
      expect(bench).not.toEqual(squat);
    });

    it("saves §20's answers with the meet and brings them back", async () => {
      // §13.18's order lesson, arriving on the field it was written about:
      // `#save` returns immediately while there is no open meet id, so an
      // answer typed before the meet is named is written only by the save that
      // naming itself performs -- and a test that names last therefore passes
      // against a root that performs no per-change save at all. The name goes
      // first, and the store is read at two instants either side of one answer.
      //
      // Read off the store rather than off the screen for §13.14's reason: the
      // box is bound to a property, so it keeps what was typed whether or not
      // the answer reached the record. The second mount is the other half of
      // that -- a build that has only ever seen the store, which is what a
      // lifter opening the tool the next morning is.
      const store = sessionMeets();
      const element = await planned({ store });
      await nameMeet(element, 'Winter Open');
      await openWarmup(element);
      const rung = firstSetIndex(element);

      const before = await stored(store);
      expect(before.meets[0]?.state.warmup).toBeNull();

      await enter(element, setBox(element, rung), '62.5');
      await afterStorage(element);

      const after = await stored(store);
      expect(after.meets[0]?.state.warmup?.states.squat.weights).toEqual([
        { index: rung, text: '62.5' },
      ]);

      const reopened = await mountShelved({ store });
      await openWarmup(reopened);
      expect(innerValue(setBox(reopened, rung))).toBe('62.5');
    });

    /**
     * §23.1's rungs, read out of the sheet rather than off the whole element.
     *
     * The fold's timeline and the sheet's ramp are two renderings of the same
     * answers by two different elements, so a whole-element read is satisfied
     * by the fold sitting three sections above it -- §13.9's `.pounds` lesson,
     * on a screen that now draws the same ramp twice.
     */
    function sheetRungs(element: PtkMeetDayPlanner): number {
      const sheet = element.shadowRoot?.querySelector('ptk-meet-pack');
      if (sheet === null || sheet === undefined) throw new Error('No printable sheet on screen.');
      return sheet.shadowRoot?.querySelectorAll('li.rung').length ?? 0;
    }

    it("counts §23.1's printed ramp off the answers given on this screen", async () => {
      // The only observable the `warmups` argument to `buildMeetPack` has
      // anywhere. `pack.test.ts` and the sheet's own browser tests each build a
      // `PackRequest` by hand, so a planner handing the builder nobody's answers
      // still prints a wholly plausible sheet -- default room, default rest, no
      // advisories -- and passes every assertion in both files. §13.19's M9,
      // arriving on the field it was written about.
      const element = await openWarmup(await planned());
      const before = sheetRungs(element);

      // A preference rather than a per-set weight, because a preference fans out
      // to every lift (`withWarmupFor`): all three ramps shorten at once, so a
      // sheet that read one lift's answers onto all three cannot pass this by
      // reading the wrong lift.
      await typeDeep(element, 'maximumSets', '2');

      expect(before).toBeGreaterThan(3);
      expect(sheetRungs(element)).toBeLessThan(before);
    });

    it('has no accessibility violations with the fold open', async () => {
      const element = await openWarmup(await planned());
      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the fold open', async () => {
      // Twelve numbered boxes, a room, a set of preferences and the ramp
      // itself, at 320 pixels (§5.7), under everything else this screen
      // already draws.
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await openWarmup(await planned({ within: frame }));

      expect(timelineRows(element).length).toBeGreaterThan(0);
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    /**
     * §20 on the coach path, where the fold hangs under one board lifter.
     *
     * The three helpers below are re-declared rather than shared with the
     * `coach mode` describe: they are private to that block, and hoisting them
     * to module scope would put the board's vocabulary in front of every test
     * in the file for the sake of four. What is genuinely different here is
     * `openNamed`, which the coach block has no equivalent of because it never
     * runs two lifters at once.
     */
    describe('on the coach path', () => {
      const SQUATTER = 'Okonkwo';
      const PRESSER = 'Vasquez';

      function coachBoardOf(element: PtkMeetDayPlanner): Element | null {
        return element.shadowRoot?.querySelector('ptk-coach-board') ?? null;
      }

      async function addNamed(element: PtkMeetDayPlanner, name: string): Promise<void> {
        await type(element, ROSTER_NAME_FIELD, name);
        const add = element.shadowRoot
          ?.querySelector('ptk-coach-roster')
          ?.shadowRoot?.querySelector('.add ptk-button');
        if (add === null || add === undefined) throw new Error('No way to add a lifter.');
        await press(element, add);
      }

      /** A running board carrying one row per name. */
      async function coachBoardWith(
        names: readonly string[],
        options: Options = {},
      ): Promise<PtkMeetDayPlanner> {
        const element = await mount(options);
        await choose(element, MODE_FIELD, COACH_MODE);
        await choose(
          element,
          FEDERATION_FIELD,
          (options.profiles ?? PROFILE_FIXTURES)[0]?.id ?? '',
        );
        for (const name of names) {
          await addNamed(element, name);
        }
        // The positive control `running()` carries, for the same reason: without
        // it an assertion about the fold passes against a screen that refused
        // every add and drew no board at all.
        if (coachBoardOf(element) === null) throw new Error('No board was drawn.');
        return element;
      }

      /**
       * Opens one lifter, addressed by name and never by index.
       *
       * The board is ranked on §21's urgency ladder and re-sorts as the clock
       * moves, so `rows[0]` is whoever is most urgent at the instant it is read
       * -- which is exactly the thing these tests change. An index would keep
       * passing while opening the wrong athlete.
       *
       * The name is read off the row's own `.who`, never off the row's whole
       * `textContent`. §21.2's clash advisory names *the other lifter* inside
       * the row it warns -- so once two board lifters have warm-up timelines
       * that collide, every row contains every clashing name and a
       * `textContent` match opens whichever row sorted first. That version of
       * this helper produced a convincing false positive: it looked exactly
       * like a per-lifter warm-up leak, because opening "the second lifter"
       * kept landing on the first.
       */
      async function openNamed(element: PtkMeetDayPlanner, name: string): Promise<void> {
        const rows = [
          ...(coachBoardOf(element)?.shadowRoot?.querySelectorAll('article.row') ?? []),
        ];
        const row = rows.find((candidate) =>
          (candidate.querySelector('.who')?.textContent ?? '').includes(name),
        );
        if (row === undefined) throw new Error(`No board row for "${name}".`);
        const open = row.querySelector('ptk-button.open');
        if (open === null) throw new Error(`No way to open "${name}".`);
        await press(element, open);
      }

      /** Back to the board, which destroys the open lifter's whole template. */
      async function backToBoard(element: PtkMeetDayPlanner): Promise<void> {
        await press(element, button(element, 'ptk-button.back'));
      }

      /**
       * A weight on the open lifter's first attempt, which is their opener.
       *
       * Typed rather than chosen off a card: a board lifter has no plan behind
       * them, so §13's choices offer nothing and the free-entry field is the
       * whole of the weight entry on this screen (§13.17).
       */
      async function declareOpener(element: PtkMeetDayPlanner, weight: string): Promise<void> {
        await typeDeep(element, OTHER_WEIGHT_FIELD, weight);
        await useTypedWeight(element);
      }

      /** The one board row's countdown, which is what the memo is visible through. */
      function boardCountdown(element: PtkMeetDayPlanner): string {
        const clock = coachBoardOf(element)?.shadowRoot?.querySelector('article.row p.clock');
        return clock?.textContent.trim() ?? '';
      }

      /**
       * §23.2's roster, which the coach path hangs under the board.
       *
       * Not the `packSheet` helper in the printable-sheets block below: that one
       * reads `ptk-meet-pack`, §23.1's one-lifter sheet, which belongs to the
       * solo plan path and is never on screen here. It throws rather than
       * answering null so that the empty-lead assertion below has a positive
       * control built into it -- "no lead lines" is also what a roster that
       * failed to render says (§13.17).
       */
      function rosterSheet(element: PtkMeetDayPlanner): Element {
        const found = element.shadowRoot?.querySelector('ptk-handler-pack');
        if (found === null || found === undefined) throw new Error('No roster on screen.');
        return found;
      }

      /** One line per lifter with a ramp; the sheet prints none for the rest. */
      function rosterLeads(element: PtkMeetDayPlanner): readonly string[] {
        return [...(rosterSheet(element).shadowRoot?.querySelectorAll('.warmup-lead') ?? [])].map(
          (line) => line.textContent.trim(),
        );
      }

      it('asks a board lifter for an opener before it draws a ramp', async () => {
        const element = await coachBoardWith([SQUATTER]);
        await openNamed(element, SQUATTER);
        await openWarmup(element);

        expect(deepText(element)).toContain(WARMUP_NEEDS_AN_OPENER);
        expect(timelineRows(element)).toEqual([]);

        await declareOpener(element, '100');

        expect(timelineRows(element).length).toBeGreaterThan(0);
      });

      it('files a warm-up answer under the lifter it was typed for', async () => {
        // The fan-out `withWarmupFor` performs across the three lifts stops at
        // the lifter: a room, a set of preferences and a progress report are
        // facts about one athlete's morning, and carrying them onto the next
        // row would trim somebody else's ramp while they were looking at it.
        const element = await coachBoardWith([SQUATTER, PRESSER]);
        for (const name of [SQUATTER, PRESSER]) {
          await openNamed(element, name);
          await declareOpener(element, '100');
          await backToBoard(element);
        }

        // Read the second lifter's ramp *before* anything is typed about the
        // first, rather than assuming the two coincide because the openers do.
        // They do not: the two are in different places in the flight, so the
        // platform estimate hands them schedules of different lengths, and a
        // test asserting one against the other measures that difference instead
        // of the leak it was written for.
        await openNamed(element, PRESSER);
        await openWarmup(element);
        const untouched = timelineRows(element).length;
        await backToBoard(element);

        await openNamed(element, SQUATTER);
        await openWarmup(element);
        const full = timelineRows(element).length;
        await typeDeep(element, 'maximumSets', '2');
        const trimmed = timelineRows(element).length;
        await backToBoard(element);

        await openNamed(element, PRESSER);
        await openWarmup(element);

        expect(untouched).toBeGreaterThan(0);
        expect(trimmed).toBeLessThan(full);
        expect(timelineRows(element)).toHaveLength(untouched);
      });

      it('writes nothing when a report arrives with nobody open', async () => {
        // The board is up, so `openLifterId` is null and there is no entry to
        // file the answer under. What this covers is the *fallback* -- a
        // handler that answers "nobody open" with the first lifter on the board
        // hands the next lifter opened a flight size nobody typed for them, and
        // that mutation fails here. It is deliberately not a test of the early
        // return itself: `withWarmupForLifter` takes a `string`, so deleting
        // that line is `error TS2345` and the compiler is what holds it -- the
        // same answer §13.14 gives for `#writeSetupAnswer`'s key guard.
        const element = await coachBoardWith([SQUATTER]);
        const forged = document.createElement('div');
        forged.dataset[WARMUP_SUBJECT_FIELD] = 'squat';
        element.append(forged);
        teardown.push(() => {
          forged.remove();
        });

        forged.dispatchEvent(aReport());
        await settled(element);

        await openNamed(element, SQUATTER);
        await openWarmup(element);

        expect(boxValue(element, 'flightSize')).toBe('');

        // The control: the same report, out of the fold now that somebody is
        // open. Without it this passes against a root that files nothing ever.
        warmupElement(element).dispatchEvent(aReport());
        await settled(element);

        expect(boxValue(element, 'flightSize')).toBe('7');
      });

      it('ages the board countdown rather than restamping the schedule', async () => {
        // The memo behind `entry.warmup` is a correctness requirement and not a
        // saving. `buildMeetWarmup` stamps `now` as the schedule's `builtAt` and
        // `timelineWindows` reports `startsInSeconds - elapsedSeconds`, so a
        // rebuild on every paint moves the origin forward exactly as fast as the
        // clock: every row on §21's board would report the same seconds for the
        // whole morning, and the board is ranked on that figure.
        const clock = manualClock(FIXED_INSTANT);
        const element = await coachBoardWith([SQUATTER], { clock });
        await openNamed(element, SQUATTER);
        await declareOpener(element, '100');
        await backToBoard(element);

        const before = boardCountdown(element);
        clock.advance(60_000);
        await settled(element);

        expect(before).not.toBe('');
        expect(boardCountdown(element)).not.toBe(before);
      });

      /**
       * §23.2's warm-up line, from the one place that decides which lift the
       * ramps are for.
       *
       * `board.ts` and `pack.ts` both cover the lead as a value, and neither can
       * reach this: they build a `BoardContext` by hand, and `warmupLift` on it
       * is chosen by nothing but `#renderCoach`. Pinning that argument to
       * `undefined` survived the whole browser suite -- the wiring had no
       * observable anywhere. What goes missing is the *lift*, not the figures: a
       * `MeetWarmupSchedule` cannot say which lift it was built for (squat and
       * bench share one warm-up family), so a board handed no lift refuses to
       * name a lead at all and the line disappears from every row of the sheet.
       *
       * The state before the opener is the control §13.17 asks for rather than a
       * second test, and it is a real state rather than a contrivance: the ramp
       * needs only a declared opener, never §20's fold, because `#boardEntries`
       * builds a schedule for every lifter on every paint off a default warm-up
       * state and `warmupSubject` is null exactly until a weight is on the first
       * attempt.
       */
      it('prints the board lifter’s warm-up lead on §23.2’s roster', async () => {
        const element = await coachBoardWith([SQUATTER]);

        expect(rosterLeads(element)).toEqual([]);

        await openNamed(element, SQUATTER);
        await declareOpener(element, '100');
        await backToBoard(element);

        // Pinned to the lift and not to the sentence: the minutes are the ramp's
        // and move with any change to it, and the lift is the fact this wiring
        // is the only carrier of.
        expect(rosterLeads(element)).toEqual([expect.stringContaining('Squat')]);
      });

      it("saves a board lifter's warm-up answers under their own id", async () => {
        // §13.19's M9 shape, on the one field of the three that has no on-screen
        // observable at all. `#savedWarmup` writes the solo ramps, the picker's
        // lift and the board's answers as one object, so a `byLifter` dropped at
        // that seam is invisible to every DOM assertion in this file -- the fold
        // on screen goes on showing what was typed either way (§13.14) -- and
        // shows up as a coach reopening tomorrow's meet with one lifter's whole
        // morning missing.
        //
        // The meet is named first for §13.18's reason, and the shelf is reachable
        // here at all because `#renderShelf` is called from `#renderCoach` too.
        const store = sessionMeets();
        const element = await coachBoardWith([SQUATTER, PRESSER], { store });
        await nameMeet(element, 'Regional Open');
        await openNamed(element, PRESSER);
        await declareOpener(element, '100');
        await openWarmup(element);
        await enter(element, setBox(element, firstSetIndex(element)), '62.5');
        await afterStorage(element);

        const saved = (await stored(store)).meets[0]?.state.warmup;
        expect(saved?.byLifter).toHaveLength(1);
        // The control, and the half that says the two paths are filed apart
        // rather than one being written over the other: nobody has answered
        // anything on the solo ramps, so they are still the empty ones.
        expect(saved?.states.squat.weights).toEqual([]);
      });
    });
  });

  describe('the record fold (§19)', () => {
    /**
     * §19's fold, addressed by its own class for the reason §20's and §22's are.
     *
     * Qualified with the tag as well, because `ptk-meet-record` uses `.record`
     * as its own wrapper class one shadow root down. That is not a collision
     * here -- `element.shadowRoot.querySelector` does not pierce -- but the
     * `check:narrow` selector added for this fold is run by Playwright, whose
     * CSS engine does pierce, and a bare `.record` there matches both.
     */
    function recordFold(element: PtkMeetDayPlanner): PtkDisclosure | null {
      const found = element.shadowRoot?.querySelector('ptk-disclosure.record') ?? null;
      return found instanceof PtkDisclosure ? found : null;
    }

    /** Opens it by setting `open`, never by pressing the summary (§13.6). */
    async function openRecord(element: PtkMeetDayPlanner): Promise<PtkMeetDayPlanner> {
      const fold = recordFold(element);
      if (fold === null) throw new Error('No record fold to open.');
      fold.open = true;
      await settled(element);
      return element;
    }

    /**
     * The picker's options, as the bare `RecordSubject` each tile carries.
     *
     * `recordSubjectChoices` uses the subject id as the option value, so this
     * needs no copy constant, and the assertion stays about which records this
     * meet can be attempted at rather than about how they are spelled.
     */
    function recordSubjectOptions(element: PtkMeetDayPlanner): string[] {
      const radios = deepControl(element, RECORD_SUBJECT_FIELD).shadowRoot?.querySelectorAll(
        'input',
      );
      return [...(radios ?? [])].map((radio) => radio.value);
    }

    /** Which record the fold is showing, read off the wrapper the root tags. */
    function recordSubjectShown(element: PtkMeetDayPlanner): string {
      const wrapper = element.shadowRoot?.querySelector('[data-record-subject]');
      if (!(wrapper instanceof HTMLElement)) throw new Error('No record subject on screen.');
      return wrapper.dataset[RECORD_SUBJECT_ATTRIBUTE] ?? '';
    }

    /** The record element itself, which is what a report has to come out of. */
    function recordElement(element: PtkMeetDayPlanner): Element {
      const found = element.shadowRoot?.querySelector('ptk-meet-record') ?? null;
      if (found === null) throw new Error('No record on screen.');
      return found;
    }

    /**
     * The two routes, read out of the record element's own shadow tree.
     *
     * `deepText` is the wrong instrument for anything a sibling also says
     * (§13.9's `.pounds` lesson): the plan above this fold prints kilogram
     * figures on every attempt, so a whole-element read is satisfied by the
     * screen the fold sits on rather than by the fold.
     *
     * **This is the observable every assertion below uses, and not the box the
     * figure was typed into.** Reading a box back cannot distinguish "the root
     * recorded it" from "the root dropped it and Lit never re-rendered over the
     * native input" -- the trap written up at the head of this file.
     */
    function routeTexts(element: PtkMeetDayPlanner): string[] {
      const routes = recordElement(element).shadowRoot?.querySelectorAll('.record-route');
      return [...(routes ?? [])].map((route) => route.textContent.trim());
    }

    /** Everything the fold is saying, which is where a refusal lives. */
    function answerText(element: PtkMeetDayPlanner): string {
      return recordElement(element).shadowRoot?.textContent.trim() ?? '';
    }

    /**
     * Types into the record box, named by the literal its element keeps private.
     *
     * `ptk-meet-record` does not export its five `data-field` names and should
     * not: they are answered inside that element and the root never reads one.
     * Its own browser test spells the same literal for the same reason.
     */
    async function typeRecord(element: PtkMeetDayPlanner, text: string): Promise<void> {
      await typeDeep(element, 'record-kilograms', text);
    }

    /** A report of the shape `ptk-meet-record` dispatches, with one answer in it. */
    function aRecordReport(): CustomEvent<MeetRecordChangeDetail> {
      return new CustomEvent<MeetRecordChangeDetail>(MEET_RECORD_CHANGE_EVENT, {
        detail: { state: withRecord(EMPTY_RECORD_STATE, { kilograms: '200' }) },
        bubbles: true,
        composed: true,
      });
    }

    /**
     * What the competition route names off a 200 kg record under the fixture.
     *
     * Derived rather than magic: the fixture profile has no fourth attempt, so
     * `marginRulesFrom` falls back to the bar multiple, 0.5. Nothing has been
     * lifted on the plan screen, so the lightest legal attempt at or above
     * 200.5 is 200.5 itself.
     */
    const OFF_THE_BAT = '200.5 kg';

    /**
     * The same arithmetic off a second record, typed against a second subject.
     *
     * A different figure on purpose, and on a subject that is not the first tile
     * in the picker. Both halves matter: a root that filed every answer under
     * the same subject is invisible to a test that only ever types against the
     * one the fold opens on, and a root that filed the right subject with the
     * wrong figure is invisible to a test where both records read the same.
     */
    const OFF_A_SECOND_RECORD = '250.5 kg';

    it('draws no record fold until there is a rule book behind it', async () => {
      // Every margin here belongs to a rule book -- the fourth-attempt excess,
      // the bar multiple, the submission clock -- so with none read there is no
      // lighter answer to fall back on, there is none at all.
      const element = await mount();

      expect(recordFold(element)).toBeNull();
      // The control: the screen is drawn, and §22's fold is already on it.
      expect(prepFold(element)).not.toBeNull();
    });

    it('offers one tile per contested lift plus the total', async () => {
      // The total is the one subject that is not a lift, and it is offered at
      // every format -- a bench-only meet still has a total, and it is the
      // bench.
      const element = await mountChosen();

      expect(recordSubjectOptions(element)).toEqual(['squat', 'bench', 'deadlift', 'total']);

      await choose(element, FORMAT_FIELD, 'bench-only');

      expect(recordSubjectOptions(element)).toEqual(['bench', 'total']);
      // And the fold moved with it rather than showing a record at a lift this
      // meet does not contest.
      expect(recordSubjectShown(element)).toBe('bench');
    });

    it('takes a report only from a fold that names a subject', async () => {
      // The wrapper `<div>` carries the subject and the element does not, which
      // is what makes the walk up the composed path exercisable at all (§13.14).
      // A root that answered "no subject" with the picked one would file an
      // answer that arrived from anywhere.
      const element = await openRecord(await mountChosen());

      element.dispatchEvent(aRecordReport());
      await settled(element);

      expect(routeTexts(element)).toEqual([]);
      expect(answerText(element)).toContain(RECORD_NEEDS_A_FIGURE);

      // The control: the same report, out of the fold. Without it this passes
      // against a root that files nothing ever.
      recordElement(element).dispatchEvent(aRecordReport());
      await settled(element);

      expect(routeTexts(element)[0]).toContain(OFF_THE_BAT);
    });

    it('keeps a typed record on the subject it was typed against', async () => {
      // Three records at one meet is the ordinary case for a lifter chasing a
      // total: the squat and the deadlift records are different figures, and a
      // fold that carried one onto the other would put a weight on the bar that
      // belongs to somebody else's list.
      const element = await openRecord(await mountChosen());
      await typeRecord(element, '200');

      await choose(element, RECORD_SUBJECT_FIELD, 'bench');

      expect(recordSubjectShown(element)).toBe('bench');
      expect(answerText(element)).toContain(RECORD_NEEDS_A_FIGURE);

      await choose(element, RECORD_SUBJECT_FIELD, 'squat');

      expect(routeTexts(element)[0]).toContain(OFF_THE_BAT);

      // And a second record, typed while the fold is showing a subject that is
      // not the one it opened on. Without this half the walk in
      // `#recordSubjectOf` can be replaced by "the first subject this format
      // contests" and every assertion above still passes -- squat is that
      // subject, so a root that ignores the wrapper entirely looks correct right
      // up until a lifter types their deadlift record and reads it back on the
      // squat. The deadlift because it is last of the three lifts, so an
      // off-by-one in either direction lands somewhere visible.
      await choose(element, RECORD_SUBJECT_FIELD, 'deadlift');
      await typeRecord(element, '250');

      expect(routeTexts(element)[0]).toContain(OFF_A_SECOND_RECORD);

      await choose(element, RECORD_SUBJECT_FIELD, 'squat');

      expect(routeTexts(element)[0]).toContain(OFF_THE_BAT);
    });

    /**
     * A picked subject that is no subject at all, which only a forged report can
     * produce and which the fold cannot survive quietly.
     *
     * `recordSubjectIn` answers an unrecognised subject with the *first* one the
     * format contests, so the failure this pins is not a crash or a blank: the
     * fold slides back onto the squat and looks exactly like a coach who chose
     * the squat. On a screen whose entire job is to say which record is being
     * planned, an answer that quietly becomes a different question is the worst
     * of the three things that could happen.
     *
     * Dispatched rather than clicked because there is nothing to click -- the
     * picker offers this meet's subjects and nothing else, which is the point.
     * The event goes out of the picker itself so that `fieldOf` finds the
     * `data-field` it needs; a report from anywhere else is already covered by
     * "takes a report only from a fold that names a subject" above.
     */
    it('ignores a subject report that names nothing this tool knows', async () => {
      const element = await openRecord(await mountChosen());
      await choose(element, RECORD_SUBJECT_FIELD, 'deadlift');

      deepControl(element, RECORD_SUBJECT_FIELD).dispatchEvent(
        new CustomEvent<ChoiceChangeDetail>(CHOICE_CHANGE_EVENT, {
          detail: { value: 'front-squat' },
          bubbles: true,
          composed: true,
        }),
      );
      await settled(element);

      expect(recordSubjectShown(element)).toBe('deadlift');
    });

    it('has no accessibility violations with the fold open', async () => {
      const element = await openRecord(await planned());
      await typeRecord(element, '200');

      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });

    it('fits a phone-width column with the fold open', async () => {
      const frame = document.createElement('div');
      frame.style.width = '320px';
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = await openRecord(await planned({ within: frame }));
      await typeRecord(element, '200');

      // The positive control: two route blocks really are on screen, so the
      // measurement below is of the widest state this fold has and not of a
      // refusal sentence.
      expect(routeTexts(element)).toHaveLength(2);
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    it("saves §19's answers with the meet and brings them back", async () => {
      // §13.20's shape one fold down, with one thing in it that fold did not
      // have: the picker's position is saved only where there is an answer to
      // save it with, so the two reads of the store either side of the typing
      // are asserting different things. The first is that a coach who moved the
      // picker and typed nothing wrote no record at all -- had it written an
      // empty `SavedRecords`, `#markRestored` would flag four untouched boxes on
      // the next open -- and the second is that the position came along once
      // there was.
      //
      // The name goes first for §13.18's reason: `#save` returns while there is
      // no open meet id, so an answer typed before the meet is named is written
      // only by the save naming itself performs, and a test that names last
      // passes against a root that performs no per-change save at all.
      //
      // The deadlift because it is neither the subject the fold opens on nor the
      // first the format contests -- the same axis §13.22 paid for twice, here
      // on the way to the disk.
      const store = sessionMeets();
      const element = await planned({ store });
      await nameMeet(element, 'Winter Open');
      await openRecord(element);
      await choose(element, RECORD_SUBJECT_FIELD, 'deadlift');

      const before = await stored(store);
      expect(before.meets[0]?.state.records).toBeNull();

      await typeRecord(element, '250');
      await afterStorage(element);

      const after = await stored(store);
      expect(after.meets[0]?.state.records?.states.deadlift.kilograms).toBe('250');
      expect(after.meets[0]?.state.records?.subject).toBe('deadlift');

      // A build that has only ever seen the store, which is what a lifter
      // opening the tool on the Saturday morning is. Read through the route
      // rather than off the box for the reason `routeTexts` gives.
      const reopened = await mountShelved({ store });
      await openRecord(reopened);

      expect(recordSubjectShown(reopened)).toBe('deadlift');
      expect(routeTexts(reopened)[0]).toContain(OFF_A_SECOND_RECORD);

      // And the picker follows on its own from here, with nothing else typed.
      // The first read above says the position is not worth a `SavedRecords` of
      // its own; this one says that once there is one, moving the picker rewrites
      // it -- which is `#snapshot` carrying `recordSubject`. Without that field a
      // coach who typed the deadlift record and then moved the fold onto the
      // bench to read it would reopen tomorrow on the deadlift, which is a
      // question they have already answered.
      await choose(element, RECORD_SUBJECT_FIELD, 'bench');
      await afterStorage(element);

      expect((await stored(store)).meets[0]?.state.records?.subject).toBe('bench');
    });

    it('says a restored record was saved earlier, and stops saying it once it is retyped', async () => {
      // What §24 saving these answers is paid for with. The caveat is the whole
      // of the reversal argued in `SavedRecords`, so all three of its edges are
      // here: it is absent on a fold nobody typed into, present on the one
      // somebody did, and gone the moment the figure it is about is replaced.
      //
      // **The deadlift control is the half that costs the sentence its meaning
      // if it goes wrong.** `RecordStates` is total over the four subjects, so
      // this restored meet carries four states and three of them are empty
      // boxes. A `#markRestored` that skipped `isBlankRecord` would put the
      // caveat over every one of them, on every meet anybody ever reopens.
      //
      // **The retype is the half a boolean would fail.** A single flag cleared
      // on the first keystroke passes the first two assertions and the last one
      // too; what it cannot do is keep the caveat on the other three folds while
      // one is being retyped, which is why the identity check exists and why the
      // squat is checked again after the deadlift has been looked at.
      const store = sessionMeets();
      const element = await planned({ store });
      await nameMeet(element, 'Winter Open');
      await openRecord(element);
      await typeRecord(element, '200');
      await afterStorage(element);

      // Nothing is said about a figure somebody has just typed. Without this the
      // assertions below pass against a fold that carries the caveat always.
      expect(answerText(element)).not.toContain(RECORD_RESTORED);

      const reopened = await mountShelved({ store });
      await openRecord(reopened);

      expect(answerText(reopened)).toContain(RECORD_RESTORED);
      expect(routeTexts(reopened)[0]).toContain(OFF_THE_BAT);

      await choose(reopened, RECORD_SUBJECT_FIELD, 'deadlift');

      expect(recordSubjectShown(reopened)).toBe('deadlift');
      expect(answerText(reopened)).not.toContain(RECORD_RESTORED);

      await choose(reopened, RECORD_SUBJECT_FIELD, 'squat');

      expect(answerText(reopened)).toContain(RECORD_RESTORED);

      await typeRecord(reopened, '205');

      expect(answerText(reopened)).not.toContain(RECORD_RESTORED);
      // The control on the retype: the fold is still answering, so the sentence
      // went away because the figure was replaced rather than because the whole
      // fold stopped rendering.
      expect(routeTexts(reopened)[0]).toContain('205.5 kg');
    });

    describe('on the coach path', () => {
      const SQUATTER = 'Okonkwo';
      const PRESSER = 'Vasquez';

      function coachBoardOf(element: PtkMeetDayPlanner): Element | null {
        return element.shadowRoot?.querySelector('ptk-coach-board') ?? null;
      }

      async function addNamed(element: PtkMeetDayPlanner, name: string): Promise<void> {
        await type(element, ROSTER_NAME_FIELD, name);
        const add = element.shadowRoot
          ?.querySelector('ptk-coach-roster')
          ?.shadowRoot?.querySelector('.add ptk-button');
        if (add === null || add === undefined) throw new Error('No way to add a lifter.');
        await press(element, add);
      }

      /** A running board carrying one row per name. */
      async function coachBoardWith(
        names: readonly string[],
        options: Options = {},
      ): Promise<PtkMeetDayPlanner> {
        const element = await mount(options);
        await choose(element, MODE_FIELD, COACH_MODE);
        await choose(element, FEDERATION_FIELD, PROFILE_FIXTURES[0]?.id ?? '');
        for (const name of names) {
          await addNamed(element, name);
        }
        // The positive control `running()` carries: without it an assertion
        // about the fold passes against a screen that refused every add.
        if (coachBoardOf(element) === null) throw new Error('No board was drawn.');
        return element;
      }

      /** Opens one lifter, addressed by name off `.who` and never by index. */
      async function openNamed(element: PtkMeetDayPlanner, name: string): Promise<void> {
        const rows = [
          ...(coachBoardOf(element)?.shadowRoot?.querySelectorAll('article.row') ?? []),
        ];
        const row = rows.find((candidate) =>
          (candidate.querySelector('.who')?.textContent ?? '').includes(name),
        );
        if (row === undefined) throw new Error(`No board row for "${name}".`);
        const open = row.querySelector('ptk-button.open');
        if (open === null) throw new Error(`No way to open "${name}".`);
        await press(element, open);
      }

      /** Back to the board, which destroys the open lifter's whole template. */
      async function backToBoard(element: PtkMeetDayPlanner): Promise<void> {
        await press(element, button(element, 'ptk-button.back'));
      }

      /** A weight on the open lifter's first attempt, typed because they have no plan. */
      async function declareOpener(element: PtkMeetDayPlanner, weight: string): Promise<void> {
        await typeDeep(element, OTHER_WEIGHT_FIELD, weight);
        await useTypedWeight(element);
      }

      it('files a record answer under the lifter it was typed for', async () => {
        // Two lifters on one board are two record lists. A fan-out that stopped
        // at the subject rather than at the lifter would hand the next athlete
        // opened a figure off somebody else's federation list, and the weight it
        // put on the bar would be wrong by exactly the difference between them.
        const element = await coachBoardWith([SQUATTER, PRESSER]);

        await openNamed(element, SQUATTER);
        await openRecord(element);
        await typeRecord(element, '200');
        const typedFor = routeTexts(element)[0] ?? '';
        await backToBoard(element);

        await openNamed(element, PRESSER);
        await openRecord(element);

        expect(typedFor).toContain(OFF_THE_BAT);
        expect(routeTexts(element)).toEqual([]);
        expect(answerText(element)).toContain(RECORD_NEEDS_A_FIGURE);
      });

      it('writes nothing when a report arrives with nobody open', async () => {
        // The board is up, so `openLifterId` is null and there is no entry to
        // file the answer under. What this covers is the *fallback*: a handler
        // that answered "nobody open" with the first lifter on the board would
        // hand the next lifter opened a record nobody typed for them. It is
        // deliberately not a test of the early return itself --
        // `withRecordForLifter` takes a `string`, so deleting that line is a
        // compile error, which is the answer §13.14 gives for the same shape.
        const element = await coachBoardWith([SQUATTER]);
        const forged = document.createElement('div');
        forged.dataset[RECORD_SUBJECT_ATTRIBUTE] = 'squat';
        element.append(forged);
        teardown.push(() => {
          forged.remove();
        });

        forged.dispatchEvent(aRecordReport());
        await settled(element);

        await openNamed(element, SQUATTER);
        await openRecord(element);

        expect(routeTexts(element)).toEqual([]);

        // The control: the same report, out of the fold now that somebody is
        // open. Without it this passes against a root that files nothing ever.
        recordElement(element).dispatchEvent(aRecordReport());
        await settled(element);

        expect(routeTexts(element)[0]).toContain(OFF_THE_BAT);
      });

      /**
       * The one thing only the root can be wrong about, and the reason this
       * block exists at all.
       *
       * `taken` is `[]` on the plan screen and `takenOn(lifter, lift)` on the
       * platform, and nothing inside `ptk-meet-record` or `records.ts` can tell
       * which it was handed -- both are a valid `readonly TakenAttempt[]`. A
       * root that passed `[]` on both paths draws a screen that is correct all
       * morning and wrong the moment somebody lifts: it would go on offering the
       * record at 200.5 kg to a lifter who has already put 220 on the bar, which
       * the rules forbid, and the lifter would find that out at the table.
       *
       * A *declared* opener is not enough to prove it. `takenOn` skips anything
       * unresolved, so the weight has to be handed in and given a result before
       * it reaches the plan -- which is also why this test presses three things
       * rather than one.
       *
       * **Two lifters, and the one that lifts is the second.** With one on the
       * board, or with the first of two, `#renderCoachRecord`'s lookup by id can
       * be replaced by "the first lifter on the roster" and this still passes --
       * mutation-checked, and it is the same planner-wiring survivor this
       * directory has now recorded four times. A board is a list precisely
       * because a coach runs several athletes, and the attempts the record is
       * planned against have to be the open athlete's rather than whoever is at
       * the top of the roster.
       */
      it('plans a record against the attempts a board lifter has already taken', async () => {
        const element = await coachBoardWith([PRESSER, SQUATTER]);
        await openNamed(element, SQUATTER);
        await openRecord(element);
        await typeRecord(element, '200');
        const beforeLifting = routeTexts(element)[0] ?? '';

        await declareOpener(element, '220');
        await markHandedIn(element);
        await recordGoodLift(element);

        const afterAGoodOpener = routeTexts(element)[0] ?? '';

        expect(beforeLifting).toContain(OFF_THE_BAT);
        // 221 and not 200.5: the profile's minimum progression is one kilogram,
        // so the lightest attempt the rules now allow is a kilogram over the 220
        // that was good -- and it clears the record by rather more than the
        // margin, which is the honest answer and not a rounding of it.
        expect(afterAGoodOpener).toContain('221 kg');
        expect(afterAGoodOpener).not.toContain('200.5');
      });

      it("saves a board lifter's record answers under their own id", async () => {
        // §13.19's M9 shape, on the fold's second field with no on-screen
        // observable. `#savedRecords` writes the solo states, the picker's
        // subject and the board's answers as one object, so a `byLifter` dropped
        // at that seam is invisible to every DOM assertion in this block -- the
        // fold on screen goes on showing what was typed either way (§13.14) --
        // and shows up as a coach reopening the meet on the Saturday morning
        // with four athletes' record lists gone.
        //
        // Two lifters and the one that answers is the second, because a board
        // with one on it cannot tell "the lifter that is open" from "the first
        // lifter on the roster".
        const store = sessionMeets();
        const element = await coachBoardWith([PRESSER, SQUATTER], { store });
        await nameMeet(element, 'Regional Open');
        await openNamed(element, SQUATTER);
        await openRecord(element);
        await typeRecord(element, '200');
        await afterStorage(element);

        const saved = (await stored(store)).meets[0]?.state.records;
        expect(saved?.byLifter).toHaveLength(1);
        // The control, and the half that says the two paths are filed apart
        // rather than one being written over the other: nobody has answered
        // anything on the solo fold, so its squat is still the empty one.
        expect(saved?.states.squat.kilograms).toBe('');
      });

      it("brings each board lifter's records back onto their own row", async () => {
        // The other half of the M9 above and the case `SavedRecords` is
        // actually written for: four athletes, four subjects each, typed on the
        // Thursday with the federation's list open and read at the rack on the
        // Saturday. `#restore` reads `byLifter` back into `coachRecords`, and a
        // restore that dropped it saves the coach's evening and hands it back
        // empty -- which every solo assertion in this block passes right
        // through, because the solo states restore from a different field.
        //
        // The second lifter answers, again, so "the lifter that is open" cannot
        // be satisfied by "the first on the roster" on the way back either.
        const store = sessionMeets();
        const element = await coachBoardWith([PRESSER, SQUATTER], { store });
        await nameMeet(element, 'Regional Open');
        await openNamed(element, SQUATTER);
        await openRecord(element);
        await typeRecord(element, '200');
        // Back to the board before the meet is put down, because `#restore`
        // brings the open lifter back too: left on the athlete's screen, the
        // reopen would land on a template with no board on it and the lookup
        // below would have nothing to be wrong about.
        await backToBoard(element);
        await afterStorage(element);

        const reopened = await mountShelved({ store });
        await openNamed(reopened, SQUATTER);
        await openRecord(reopened);

        expect(routeTexts(reopened)[0]).toContain(OFF_THE_BAT);
        expect(answerText(reopened)).toContain(RECORD_RESTORED);

        // The control, and the reason the caveat is asked per state object
        // rather than once per restore: the athlete nobody answered for has
        // nothing to be stale, so their fold says nothing about where it came
        // from and offers no route.
        await backToBoard(reopened);
        await openNamed(reopened, PRESSER);
        await openRecord(reopened);

        expect(routeTexts(reopened)).toEqual([]);
        expect(answerText(reopened)).not.toContain(RECORD_RESTORED);
      });

      it('files nothing in the saved meet for a report that arrives with nobody open', async () => {
        // The other side of "writes nothing when a report arrives with nobody
        // open" above, and the reason that one had to wait for this task. Until
        // §19's answers were saved, a record filed under a fabricated lifter id
        // rendered nowhere and `#onRecordChange`'s `openLifterId ?? null` was an
        // unkillable mutation survivor -- the documented one §13.22 left behind.
        // Now the same fabricated id is a `byLifter` entry written into the
        // lifter's own document and carried to every device it is exported to,
        // for an athlete who is not on the roster.
        //
        // The assertion is on the *whole* field rather than on the length of the
        // list: `#savedRecords` answers `null` where nothing has been typed on
        // either path, so a handler that invented an id writes a record where
        // there should be no record at all.
        const store = sessionMeets();
        const element = await coachBoardWith([SQUATTER], { store });
        await nameMeet(element, 'Regional Open');

        const forged = document.createElement('div');
        forged.dataset[RECORD_SUBJECT_ATTRIBUTE] = 'squat';
        element.append(forged);
        teardown.push(() => {
          forged.remove();
        });

        forged.dispatchEvent(aRecordReport());
        await afterStorage(element);

        expect((await stored(store)).meets[0]?.state.records).toBeNull();

        // The control: the same report from the same node once somebody is open.
        // Without it this passes against a root that saves no record ever.
        await openNamed(element, SQUATTER);
        await openRecord(element);
        recordElement(element).dispatchEvent(aRecordReport());
        await afterStorage(element);

        expect((await stored(store)).meets[0]?.state.records?.byLifter).toHaveLength(1);
      });
    });
  });

  describe('the printable sheets (§23)', () => {
    /**
     * The sheet itself, which is a child of this element and not of a fold.
     *
     * Read off the root's own shadow root rather than through {@link controls},
     * because where it sits in that tree is the thing under test: a sheet
     * nested inside a `ptk-disclosure` would be unreachable from the print
     * block, which is the arrangement `#renderPack`'s header rules out.
     */
    function packSheet(element: PtkMeetDayPlanner): Element {
      const found = element.shadowRoot?.querySelector('ptk-meet-pack');
      if (found === null || found === undefined) throw new Error('No printable sheet on screen.');
      return found;
    }

    /** The one control that opens and shuts it. */
    function packToggle(element: PtkMeetDayPlanner): Element {
      const found = element.shadowRoot?.querySelector('section.pack ptk-button');
      if (found === null || found === undefined) throw new Error('No way to show the sheet.');
      return found;
    }

    it('wraps the screen only where a sheet is rendered beside it', async () => {
      // The wrapper exists to be blanked on paper, so drawing one with nothing
      // to put in its place is a lifter pressing Print and getting an empty
      // page. Both states, because a root that never wraps anything satisfies
      // the first half and prints the screens over the sheet.
      const bare = await mount();
      expect(bare.shadowRoot?.querySelector('ptk-meet-pack')).toBeNull();
      expect(bare.shadowRoot?.querySelector('.screen')).toBeNull();

      const element = await mountChosen();
      const wrapper = element.shadowRoot?.querySelector('.screen');
      if (wrapper === null || wrapper === undefined) throw new Error('The screen is not wrapped.');
      expect(printRule(PtkMeetDayPlanner.styles, '.screen').getPropertyValue('display')).toBe(
        'none',
      );
      // And on screen the wrapper generates no box at all, so every child goes
      // on laying out against the host exactly as it did before §23 existed.
      // A `div` here would put a block between the host's grid and its rows.
      expect(getComputedStyle(wrapper).display).toBe('contents');
    });

    it('renders the whole sheet before anybody presses Show', async () => {
      // The claim `PACK_PRINT_NOTE` makes to the lifter: print works whether or
      // not the sheet was ever on screen. A template branch behind the toggle
      // would satisfy every other assertion in this block and hand a blank page
      // to everyone who never pressed it -- and paper is where that is found.
      const element = await mountChosen();
      const sheet = packSheet(element);

      expect(sheet.hasAttribute('data-shut')).toBe(true);
      expect(sheet.shadowRoot?.querySelectorAll('section.lift')).toHaveLength(3);
      expect(getComputedStyle(sheet).display).toBe('none');
    });

    it('opens the sheet and renames the control that opened it', async () => {
      const element = await mountChosen();
      const toggle = packToggle(element);
      const shut = toggle.textContent.trim();

      await press(element, toggle);
      const open = toggle.textContent.trim();
      expect(packSheet(element).hasAttribute('data-shut')).toBe(false);

      // Asserted as a difference plus one pinned fragment rather than against
      // `PACK_SHOW_LABEL` and `PACK_HIDE_LABEL`, per §13.8: an expected value
      // computed by the module under test moves with the code. A control that
      // never renames itself is a lifter pressing Show twice and hiding the
      // sheet they just asked for.
      expect(open).not.toBe(shut);
      expect(shut).toContain('Show');
      expect(open).toContain('Hide');

      await press(element, toggle);
      expect(packSheet(element).hasAttribute('data-shut')).toBe(true);
    });

    it('prints a sheet the lifter left shut, which is the only reason data-shut is not hidden', async () => {
      // The one promise that lives nowhere but here. `ptk-meet-pack` owns its
      // own paper half and `check:narrow` presses the toggle, so a rule that
      // printed only what was on screen would break no other test in the
      // repository -- and the failure is a blank page in a gym bag.
      const element = await mountChosen();
      expect(packSheet(element).hasAttribute('data-shut')).toBe(true);

      // Named with the whole comma-separated selector because that is what the
      // CSSOM calls a grouped rule; matching one half would be the substring
      // search `print-rules.ts` exists to avoid.
      expect(
        printRule(
          PtkMeetDayPlanner.styles,
          'ptk-meet-pack[data-shut], ptk-handler-pack[data-shut]',
        ).getPropertyValue('display'),
      ).toBe('block');
    });

    it('leaves the screen chrome off the paper, heading and toggle alike', async () => {
      const element = await mountChosen();
      const section = element.shadowRoot?.querySelector('section.pack');

      // The DOM half names all three: `printRule` proves the rule exists and
      // sets what it claims, and cannot see whether anything matches it.
      expect(section?.querySelector('h2')).not.toBeNull();
      expect(section?.querySelectorAll('.note').length).toBeGreaterThan(0);
      expect(section?.querySelector('ptk-button')).not.toBeNull();
      expect(
        printRule(
          PtkMeetDayPlanner.styles,
          '.pack h2, .pack .note, .pack ptk-button',
        ).getPropertyValue('display'),
      ).toBe('none');
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

/**
 * §24, which is the only part of this tool that outlives the tab it ran in.
 *
 * Four things here can only be wrong at the root, and none of them can fail in
 * `meet-store.test.ts` or in `ptk-meet-library`'s own suite:
 *
 * 1. **The withdrawal.** One guard decides whether the embed gets §24 at all,
 *    and every other test in this file runs on the withdrawn side of it by
 *    construction -- `mount` defaults to `noMeetStore`, so the shelf is absent
 *    from seventy-odd screens that never mention it.
 * 2. **The one press that starts saving.** `meetName` is element-local and the
 *    meet is created inside the handler, so the transition from the invitation
 *    to the line saying where changes go cannot be seeded. It has to be driven.
 * 3. **Every later change reaching the store with nobody pressing anything.**
 *    That is `updated()` calling `#save`, and it is observable only by reading
 *    the store back -- the screen shows the same thing either way.
 * 4. **What comes back.** A restore puts a session on screen that nobody
 *    answered, and reports drift in the rule book underneath it.
 */
describe('the meet shelf', () => {
  it('renders neither the shelf nor a way to start saving where nothing is kept', async () => {
    // The embed (§2.5). Save, Export, Import and Delete everything would each
    // refuse, so none of them is on screen -- and the screen behind them is
    // untouched, which is what the prep fold is doing here.
    const element = await mount();

    expect(shelf(element)).toBeNull();
    expect(naming(element)).toBeNull();
    expect(prepFold(element)).not.toBeNull();
  });

  it('renders both halves of it where the page will keep a meet', async () => {
    const element = await mountShelved();

    expect(shelf(element)).not.toBeNull();
    expect(naming(element)).not.toBeNull();
  });

  it('says a different thing about a device shelf and a shelf that lasts the tab', async () => {
    // The whole reason `MeetPersistence` is three values rather than a boolean:
    // one of the two says the meet is only on this device, the other says it is
    // gone when the tab closes, and a lifter acts differently on each. Asserted
    // as a difference first, because both sentences live in `copy.ts` and an
    // assertion against the constant moves with it (§13.8).
    const device = await mountShelved({ store: storedMeets(memoryPreferenceStorage()) });
    const page = await mountShelved({ store: sessionMeets() });

    expect(storageSentence(device)).not.toBe(storageSentence(page));
    expect(storageSentence(device)).toContain('only in this browser');
    expect(storageSentence(page)).toContain('Nothing is being saved');
    expect(shelf(device)?.hasAttribute('durable')).toBe(true);
    expect(shelf(page)?.hasAttribute('durable')).toBe(false);
  });

  it('puts the named meet on the shelf and withdraws the invitation', async () => {
    const element = await mountShelved();

    await nameMeet(element, 'Winter Open');

    // The row first: a create that opened a meet and filed nothing would still
    // swap the block for the line, and the line is the half a reader trusts.
    expect(shelfNames(element)).toEqual(['Winter Open']);
    expect(naming(element)).toBeNull();
    expect(openLine(element)).toContain('Winter Open');
  });

  it('refuses a meet with no name, on the control that is deliberately not disabled', async () => {
    // `#onCreateMeet` does not guard on a blank name, on purpose: `readMeetName`
    // refuses with a sentence the screen can say, and a disabled Start with no
    // explanation beside it is the version a lifter cannot get past.
    const element = await mountShelved();

    await nameMeet(element, '');

    expect(shelfNames(element)).toEqual([]);
    expect(shelfMessage(element)).toContain('name');

    // The control, on the same screen, still works -- so the refusal above is
    // the name being refused and not the press going nowhere.
    await nameMeet(element, 'Spring Classic');
    expect(shelfNames(element)).toEqual(['Spring Classic']);
    expect(shelfMessage(element)).toBe('');
  });

  it('writes every later change into the store with nobody pressing anything', async () => {
    // §24.1's promise, and the only assertion in this file that has to go
    // through the store: the screen shows the typed figure whether or not it
    // was ever filed, because the field holds what was typed into it.
    const store = sessionMeets();
    const element = await mountShelved({ store });
    await choose(element, FEDERATION_FIELD, MEET_PROFILE_FIXTURE.id);
    await nameMeet(element, 'Summer Nationals');

    const before = await stored(store);
    expect(before.meets[0]?.state.session.figures.squat.expectedMaximum).toBe('');

    await type(element, EXPECTED_MAXIMUM_FIELD, '182.5', 'squat');
    await afterStorage(element);

    const after = await stored(store);
    expect(after.meets[0]?.state.session.figures.squat.expectedMaximum).toBe('182.5');
  });

  it('brings a saved meet back onto the screen with nobody answering anything', async () => {
    const store = await heldShelf(
      savedShelf({
        name: 'Autumn Qualifier',
        rulesProfileId: MEET_PROFILE_FIXTURE.id,
        rulebookRevision: MEET_PROFILE_FIXTURE.source.revision,
      }),
    );

    const element = await mountShelved({ store });

    // The plan screen appears when a federation is chosen and not before, so its
    // presence here is the saved session having been adopted -- there is no tile
    // press anywhere in this test.
    expect(planScreen(element)).not.toBeNull();
    expect(openLine(element)).toContain('Autumn Qualifier');
    expect(shelfMessage(element)).toBe('');

    // The control: mounted against an empty shelf, the same element asks for a
    // federation instead.
    expect(planScreen(await mountShelved())).toBeNull();
  });

  it('reports a rule book that moved under a saved meet, and only that meet', async () => {
    const moved = await heldShelf(
      savedShelf({
        name: 'Winter Open',
        rulesProfileId: MEET_PROFILE_FIXTURE.id,
        rulebookRevision: 'an-earlier-revision',
      }),
    );
    const element = await mountShelved({ store: moved });

    expect(shelfMessage(element)).toContain('earlier revision of that rule book');
    // The attempts are still there. A report that also emptied the screen would
    // be the tool deciding the plan is unsafe, which §24 does not do.
    expect(planScreen(element)).not.toBeNull();

    // A meet planned under a federation the session no longer names says
    // nothing, however far the revision has moved -- there is nothing to check
    // it against, and a warning about a rule book nobody is planning under is
    // one the lifter cannot act on.
    const elsewhere = await heldShelf(
      savedShelf({
        name: 'Winter Open',
        rulesProfileId: 'a-federation-nobody-chose',
        rulebookRevision: 'an-earlier-revision',
      }),
    );
    expect(shelfMessage(await mountShelved({ store: elsewhere }))).toBe('');
  });

  it('empties the shelf, brings the invitation back, and leaves the plan alone', async () => {
    // The documented decision: Delete everything is about the filing cabinet and
    // not about the meet on screen. A lifter who clears the shelf mid-plan and
    // watched their attempts go with it has lost the thing they came for.
    const store = sessionMeets();
    const element = await planned({ store });
    await afterStorage(element);
    await nameMeet(element, 'Summer Nationals');
    expect(shelfNames(element)).toEqual(['Summer Nationals']);

    await pressShelf(element, 'arm-all');
    await pressShelf(element, 'delete-all');

    expect(shelfNames(element)).toEqual([]);
    expect((await stored(store)).meets).toEqual([]);
    expect(naming(element)).not.toBeNull();
    expect(attemptLists(element)).toBe(3);
  });

  it('adds the meets in a chosen file in two presses, and opens none of them', async () => {
    const element = await mountShelved();
    const file = new File([writeMeetFile(aShelf().meets, FIXED_INSTANT)], 'meets.json', {
      type: 'application/json',
    });

    await chooseFile(element, file);

    // The preview is a gate rather than a report: nothing has been added yet.
    expect(importing(element)).not.toBeNull();
    expect(shelfNames(element)).toEqual([]);

    await confirmImport(element);

    expect(importing(element)).toBeNull();
    expect(shelfNames(element).sort()).toEqual([
      'Autumn Qualifier',
      'Spring Classic',
      'Summer Nationals',
      'Winter Open',
    ]);
    // Adding a meet is not opening it. An import that opened one would replace
    // whatever is on screen with somebody else's session, which on a phone
    // handed over at a meet is the whole of the damage.
    expect(naming(element)).not.toBeNull();
    expect(openLine(element)).toBeNull();
  });

  it('exports the whole shelf, including the meets already finished', async () => {
    const store = await heldShelf(aShelf());
    const element = await mountShelved({ store });
    const blobs: Blob[] = [];
    // The handler clicks a detached anchor, so the click has to be caught rather
    // than watched: left alone it asks the browser running this suite for a
    // download, which is not a thing a test should be starting.
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
      if (source instanceof Blob) blobs.push(source);
      return 'blob:stub';
    });
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    teardown.push(() => {
      created.mockRestore();
      revoked.mockRestore();
      clicked.mockRestore();
    });

    await pressShelf(element, 'export');

    const anchor: unknown = clicked.mock.contexts[0];
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('Nothing was clicked.');
    expect(anchor.download).toMatch(/^meet-day-\d{4}-\d{2}-\d{2}\.json$/u);

    const written = blobs[0];
    if (written === undefined) throw new Error('Nothing was written to export.');
    const text = await written.text();
    // All four, not the two that are still resumable and not the open one: a
    // backup that quietly left out the finished meets is discovered when
    // somebody goes looking for last season's numbers.
    for (const name of ['Winter Open', 'Spring Classic', 'Summer Nationals', 'Autumn Qualifier']) {
      expect(text).toContain(name);
    }
  });
});
