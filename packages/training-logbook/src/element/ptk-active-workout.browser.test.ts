// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The plate diagram under a set row, in a real browser.
 *
 * `core/loading.test.ts` already pins what the plates are. What is left is everything
 * between that answer and a lifter's eyes, and every one of those failures is silent:
 * a diagram drawn in the wrong unit, a diagram drawn under a chin-up, a diagram drawn
 * from a gym nobody chose, a "nothing to move" line under all five sets across, and --
 * the one no leaf test can see -- a root that computes all of it and forgets to hand
 * the rack down.
 *
 * WHY THE LAST CASE MOUNTS THE WHOLE TOOL
 *
 * `.equipment=${this.settings.equipment}` on one line of `ptk-training-logbook` is the
 * entire wiring, and dropping it type-checks, lints, renders, and passes every test
 * above. The tool would simply never draw plates for anybody -- which is exactly what
 * it correctly does before a lifter has chosen a rack, so there is nothing about the
 * screen that looks wrong. Only a case that goes through the equipment the repository
 * loaded can tell the two apart.
 *
 * Every weight, plate and bar here is invented (section 5.1). The pound rack has no
 * 2.5s on purpose: it makes an unbuildable weight easy to ask for and hard to reach by
 * accident.
 *
 * SECTION 7.8'S LINE IS THE FILE'S SECOND SUBJECT
 *
 * `previous` is the other thing this screen is handed and never works out for itself,
 * and it fails the same silent way the rack does: an exercise with no history is meant
 * to draw nothing, so a line that always renders looks exactly like a correct screen
 * to anybody whose logbook is empty. The block below therefore asserts on the absence
 * as a count of elements rather than as a run of empty text.
 *
 * SECTION 7.9'S NOTES ARE THE THIRD
 *
 * A note surface has three states and two of them are silence: nothing where none
 * has been written, one muted line where one has, a box while it is being typed.
 * Those first two are indistinguishable in text, so that block counts elements for
 * the same reason the one above it does.
 *
 * What counting cannot reach is the ordering. Nothing is pressed to keep a note --
 * it is written half a second after the last keystroke and at once on leaving the
 * box -- so the tap that ends the typing can arrive before the write. Every case
 * there that presses something while a box still holds unwritten words is about
 * that race, and each one asserts on the single session handed up rather than on
 * two events arriving in a hopeful order.
 *
 * SECTION 7.10'S EFFORT IS THE FOURTH
 *
 * One setting decides whether a third box is drawn in the editor, and the whole of
 * the difficulty is that it governs the *entry* and not the record. A number already
 * on a set keeps its own scale and stays on screen with the setting off, so most of
 * the ways this can go wrong look like a lifter who simply never rated that set --
 * an effort silently dropped by an unrelated rep correction, an RIR read back as an
 * RPE, a stored rating deleted by a box the tool itself opened empty. The block
 * below drives every one of those through the editor's own controls and then asserts
 * on the `Effort` the session came back holding, scale included, because the scale
 * is the half a rendered string agrees about while being wrong.
 *
 * SECTION 7.7'S FOUR CHANGES ARE THE FIFTH
 *
 * Every case in that block drives the whole tool, and not for the usual reason. The
 * screen cannot apply any of the four: two of them mint an identifier and the screen
 * has no identifier source, so all four leave as one event and the root works out what
 * they mean. A case against the element alone could assert only that a press fired an
 * event, which is an assertion that stays green while the tool does nothing.
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// diagram renders with no plate colours and the accessibility pass measures a screen
// that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { findExercise } from '../core/catalog.js';
import { AT_START, ON_DAY, contextSeries } from '../core/context.fixture.js';
import type { PreviousPerformance } from '../core/previous.js';
import {
  addExercise,
  createWorkout,
  performance,
  startWorkout,
  type SessionContext,
} from '../core/session.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository, defaultSettings } from '../storage/repository.js';
import type {
  CalendarDay,
  Effort,
  EffortSetting,
  EquipmentSnapshot,
  ExerciseOption,
  Instant,
  LogbookId,
  LogbookSettings,
  SetLoad,
  SetPerformance,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import {
  ACTIVE_NOTES,
  EFFORT_FIELD_HINTS,
  EFFORT_FIELD_LABELS,
  EFFORT_LABELS,
  LOADING_NOTES,
  SAVE_STATES,
} from './copy.js';
import {
  DONE_EFFORT_FIELD,
  DONE_REPS_FIELD,
  DONE_WEIGHT_FIELD,
  WORKOUT_NOTE_KEY,
  exerciseNoteKey,
} from './dataset.js';
import { NOT_SET, formatSetRun } from './format.js';
import { defineTrainingLogbook } from './index.js';
import {
  SET_PLAN_EVENT,
  WORKOUT_CHANGED_EVENT,
  WORKOUT_FINISHED_EVENT,
  type PtkActiveWorkout,
  type SetPlanChange,
  type SetPlanChangedDetail,
  type WorkoutChangedDetail,
  type WorkoutFinishedDetail,
} from './ptk-active-workout.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';

const TODAY: CalendarDay = ON_DAY;
const VERSION = '0.0.0-test';

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineTrainingLogbook();
});

afterEach(() => {
  for (const dispose of teardown.splice(0).reverse()) dispose();
});

/**
 * A pound rack nobody's defaults pick, so nothing can pass by resembling one.
 *
 * The gap between 5 and nothing is the point: with no 2.5s the bar builds 95 and 105
 * and cannot build 100, which is the case section 8.3 is about.
 */
function aPoundGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 45, unit: 'lb' },
    collarWeight: { amount: 0, unit: 'lb' },
    plateUnit: 'lb',
    plates: [
      { weight: 45, pairs: null, fullDiameter: true },
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: false },
      { weight: 5, pairs: null, fullDiameter: false },
    ],
  };
}

/** A kilogram rack, for the one case that is about which unit the diagram is in. */
function aKilogramGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 0, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 15, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: false },
      { weight: 5, pairs: null, fullDiameter: false },
    ],
  };
}

function catalogExercise(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such catalogue exercise: ${id}`);
  return found;
}

/**
 * A started session of one exercise, one set per weight given.
 *
 * Built by the core rather than typed out, for `story.fixture.ts`'s reason: a session
 * written by hand is free to hold a shape `startWorkout` would never produce, and those
 * are exactly the rows a reviewer would stop on.
 */
function aSession(
  exercise: ExerciseOption,
  weights: readonly (number | null)[],
  unit: 'kg' | 'lb' = 'lb',
): WorkoutSession {
  const at = contextSeries();
  let session = createWorkout(at(AT_START), { localDate: ON_DAY, title: 'Squat day' });
  session = addExercise(session, at(AT_START), {
    exerciseId: exercise.id,
    displayName: exercise.name,
    loading: exercise.loading,
    plan: weights.map((amount) => ({
      kind: 'working' as const,
      performance: performance(
        amount === null ? { kind: 'none' } : { kind: 'implement', weight: { amount, unit } },
        5,
      ),
    })),
  });
  return startWorkout(session, at(AT_START));
}

/** Two lifts in one started session, one set each, so a line can be shown to be absent. */
function aPairedSession(first: ExerciseOption, second: ExerciseOption): WorkoutSession {
  const at = contextSeries();
  let session = createWorkout(at(AT_START), { localDate: ON_DAY, title: 'Squat day' });
  for (const exercise of [first, second]) {
    session = addExercise(session, at(AT_START), {
      exerciseId: exercise.id,
      displayName: exercise.name,
      loading: exercise.loading,
      plan: [{ kind: 'working' as const, performance: performance({ kind: 'none' }, 5) }],
    });
  }
  return startWorkout(session, at(AT_START));
}

interface MountOptions {
  readonly session: WorkoutSession;
  readonly equipment?: EquipmentSnapshot | null;
  readonly unit?: 'kg' | 'lb';
  readonly previous?: ReadonlyMap<string, PreviousPerformance>;
  /** Section 7.10's setting. `none` is what a logbook is in on day one. */
  readonly effort?: EffortSetting;
}

async function mount(options: MountOptions): Promise<PtkActiveWorkout> {
  const element = document.createElement('ptk-active-workout');
  element.session = options.session;
  element.equipment = options.equipment ?? null;
  element.unit = options.unit ?? 'lb';
  element.previous = options.previous ?? new Map();
  element.effort = options.effort ?? 'none';
  element.now = (): Instant => AT_START;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** Everything matching a selector, at any shadow depth below a root. */
function deepAll(root: DocumentFragment | HTMLElement, selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: DocumentFragment | HTMLElement): void => {
    for (const child of node.querySelectorAll('*')) {
      if (child instanceof HTMLElement && child.matches(selector)) found.push(child);
      if (child.shadowRoot !== null) visit(child.shadowRoot);
    }
  };
  visit(root);
  return found;
}

/**
 * What each diagram says it is showing, in row order.
 *
 * The `aria-label` and not the plate faces, because it is the one string carrying both
 * the numbers and the unit -- and it is what a lifter using a screen reader is told,
 * which makes an assertion on it an assertion about the whole answer rather than about
 * a run of digits with no meaning attached.
 */
function diagrams(element: Element): string[] {
  return deepAll(shadow(element), 'ptk-plate-stack')
    .map((stack) => shadow(stack).querySelector('[role="img"]')?.getAttribute('aria-label') ?? '')
    .filter((label) => label !== '');
}

/** How many rows say the bar goes on empty. */
function barOnlyRows(element: Element): string[] {
  return deepAll(shadow(element), 'ptk-plate-stack').flatMap((stack) => {
    const text = shadow(stack).querySelector('.bar-only')?.textContent.trim() ?? '';
    return text === '' ? [] : [text];
  });
}

/**
 * Every sentence under a diagram, in row order.
 *
 * `.loading-note` and not "every paragraph in the row": section 7.8's line is a
 * paragraph in the same card, and a selector loose enough to collect both would make
 * every assertion in this file's first half depend on a history it never sets.
 */
function notes(element: Element): string[] {
  return deepAll(shadow(element), '.loading-note').map((note) => note.textContent.trim());
}

/** Section 7.8's line, wherever it has been drawn below the given root. */
function previousLines(root: DocumentFragment | HTMLElement): HTMLElement[] {
  return deepAll(root, 'p.previous');
}

/** The first of them, or a failure rather than an assertion made against nothing. */
function previousLine(root: DocumentFragment | HTMLElement): HTMLElement {
  const first = previousLines(root)[0];
  if (first === undefined) throw new Error('This screen says nothing about last time.');
  return first;
}

/** One card per exercise, in the order the session holds them. */
function exerciseCards(element: Element): HTMLElement[] {
  return deepAll(shadow(element), 'section.exercise');
}

/** The card at a position, or a failure naming the exercise nobody drew. */
function exerciseCard(element: Element, index: number): HTMLElement {
  const card = exerciseCards(element)[index];
  if (card === undefined) throw new Error(`There is no exercise ${String(index + 1)} on screen.`);
  return card;
}

/** A rendered paragraph as one line, with the template's own indentation taken out. */
function oneLine(node: HTMLElement): string {
  return node.textContent.replace(/\s+/g, ' ').trim();
}

/** The set rows, in the order they are shown. */
function setRows(element: Element): HTMLElement[] {
  return deepAll(shadow(element), 'li[data-set]');
}

function setRow(element: Element, index: number): HTMLElement {
  const row = setRows(element)[index];
  if (row === undefined) throw new Error(`There is no set ${String(index + 1)} on this screen.`);
  return row;
}

/** Presses a control inside a row, the inner button rather than the host. */
async function tap(element: PtkActiveWorkout, row: HTMLElement, action: string): Promise<void> {
  const host = deepAll(row, `[data-action="${action}"]`)[0];
  if (host === undefined) throw new Error(`This row has no "${action}" control.`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`The "${action}" control has no button in it.`);
  button.click();
  await element.updateComplete;
}

const SQUAT = catalogExercise('squat');
const CHIN_UP = catalogExercise('chin-up');
const BENCH = catalogExercise('bench-press');

/**
 * The day the history entries below were done on. Invented, and a week before
 * {@link TODAY} -- a line that printed the session's own date would otherwise read
 * as correct on every screen in this file.
 */
const LAST_TIME_DAY: CalendarDay = '2026-03-03';

/** One recorded set at a weight. Every number invented, section 5.1. */
function lifted(amount: number, reps: number): SetPerformance {
  return performance({ kind: 'implement', weight: { amount, unit: 'lb' } }, reps);
}

function lastTime(exercise: ExerciseOption, sets: readonly SetPerformance[]): PreviousPerformance {
  return { exerciseId: exercise.id, localDate: LAST_TIME_DAY, sets };
}

/** The map the root hands down, keyed the way the element looks entries up. */
function previousMap(...entries: readonly PreviousPerformance[]): Map<string, PreviousPerformance> {
  return new Map(entries.map((entry) => [entry.exerciseId, entry]));
}

/** Three sets across, with the last one short. What a real entry looks like. */
const SQUAT_LAST_TIME: readonly SetPerformance[] = [lifted(225, 5), lifted(225, 5), lifted(225, 4)];

describe('the plates under a set row', () => {
  it('draws nothing at all until a rack has been chosen', async () => {
    // The state a logbook is in on day one. `settings.equipment` is null until a lifter
    // opens the equipment screen and answers it, and drawing the catalogue default here
    // would put a diagram of somebody else's gym under every set of a real session.
    const element = await mount({ session: aSession(SQUAT, [135, 185]), equipment: null });

    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
    expect(notes(element)).toEqual([]);
  });

  it('draws the plates for each set once there is a rack', async () => {
    const element = await mount({
      session: aSession(SQUAT, [135, 185]),
      equipment: aPoundGym(),
    });

    expect(diagrams(element)).toEqual(['Per side: 45 lb', 'Per side: 45 lb, 25 lb']);
  });

  it('says the bar goes on empty rather than drawing a blank row', async () => {
    const element = await mount({ session: aSession(SQUAT, [45]), equipment: aPoundGym() });

    expect(barOnlyRows(element)).toEqual([LOADING_NOTES.barOnly]);
    expect(diagrams(element)).toEqual([]);
  });

  it('draws no plates under an exercise that takes none', async () => {
    // A chin-up with a rack set. The failure this catches is a card that explains, under
    // every row of a bodyweight session, that there are no plates on a bar nobody is
    // using.
    const element = await mount({
      session: aSession(CHIN_UP, [null, null]),
      equipment: aPoundGym(),
    });

    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
    expect(notes(element)).toEqual([]);
  });

  it('draws no plates under a set with no weight typed into it yet', async () => {
    const element = await mount({ session: aSession(SQUAT, [null]), equipment: aPoundGym() });

    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
  });
});

describe('what the row says to move', () => {
  it('names what goes on an empty bar, and then only what changes', async () => {
    const element = await mount({
      session: aSession(SQUAT, [135, 185]),
      equipment: aPoundGym(),
    });

    expect(notes(element)).toEqual(['Add 45 lb per side', 'Add 25 lb per side']);
  });

  it('says nothing at all between two sets at the same weight', async () => {
    // Five sets across is the commonest session there is. A line under each of the last
    // four confirming that nothing has changed is four lines to read at a bar, and it is
    // how a lifter learns to stop reading the one that matters.
    const element = await mount({
      session: aSession(SQUAT, [135, 135, 135]),
      equipment: aPoundGym(),
    });

    expect(notes(element)).toEqual(['Add 45 lb per side']);
    expect(diagrams(element)).toHaveLength(3);
  });

  it('names both plates when a set takes some off and puts others on', async () => {
    // 155 is 55 a side, which the rack makes as 45 + 10; 185 is 70, which it makes as
    // 45 + 25. The 10 comes off and the 25 goes on, and a line saying only "add 25"
    // would leave a lifter with 195 on the bar.
    const element = await mount({
      session: aSession(SQUAT, [155, 185]),
      equipment: aPoundGym(),
    });

    expect(notes(element)[1]).toBe('Take off 10 lb, add 25 lb per side');
  });
});

describe('a weight the rack cannot build', () => {
  it('says so and names what it can build either side', async () => {
    // 100 lb is 27.5 a side and this rack's smallest plate is a 5. Section 8.3 warns and
    // does not block: the weight the lifter entered stays exactly as they entered it,
    // and nothing here rounds it to a number the bar happens to make.
    const element = await mount({ session: aSession(SQUAT, [100]), equipment: aPoundGym() });

    expect(notes(element)).toEqual([
      `${LOADING_NOTES.notLoadable} ${LOADING_NOTES.nearestTwo} 95 lb and 105 lb.`,
    ]);
    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
  });

  it('names one neighbour where there is only one', async () => {
    // Lighter than the bar. There is nothing below it to name, and "the nearest are 45
    // lb" is the kind of small wrongness that makes a lifter stop trusting the number
    // beside it.
    const element = await mount({ session: aSession(SQUAT, [30]), equipment: aPoundGym() });

    expect(notes(element)).toEqual([
      `${LOADING_NOTES.notLoadable} ${LOADING_NOTES.nearestOne} 45 lb.`,
    ]);
  });
});

describe('the unit the diagram is in', () => {
  it('is the rack, never what the lifter reads in', async () => {
    // A kilogram gym read in pounds is ordinary, and it is the whole reason these are two
    // settings. Passing `unit` here instead of `equipment.plateUnit` would label 25 kg
    // plates "25 lb" -- wrong by a factor nobody notices until the bar comes off the rack.
    const element = await mount({
      session: aSession(SQUAT, [100], 'kg'),
      equipment: aKilogramGym(),
      unit: 'lb',
    });

    expect(diagrams(element)).toEqual(['Per side: 25 kg, 15 kg']);
    expect(notes(element)).toEqual(['Add 25 kg + 15 kg per side']);
  });

  it('redraws when the lifter switches to another gym mid-session', async () => {
    // The plates are cached against the session and the rack together, because the search
    // behind them is a subset-sum and this screen re-renders on every keystroke in the
    // weight box. Keying that cache on the session alone would pass every test above and
    // then show a lifter who walked into another room the plates from the last one.
    const element = await mount({ session: aSession(SQUAT, [135]), equipment: aPoundGym() });
    expect(diagrams(element)).toEqual(['Per side: 45 lb']);

    element.equipment = { ...aPoundGym(), barWeight: { amount: 35, unit: 'lb' } };
    await element.updateComplete;

    expect(diagrams(element)).toEqual(['Per side: 45 lb, 5 lb']);
  });
});

describe('the diagram in the page', () => {
  it('has no accessibility violations', async () => {
    const element = await mount({
      session: aSession(SQUAT, [135, 100]),
      equipment: aPoundGym(),
    });

    // Contrast is off for the same reason as everywhere else in this package: the plate
    // colours are the domain's, checked where they are defined, and axe measures them
    // here against whatever background the test page happens to have.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('what the lift was last done for', () => {
  it('prints the day it was done and the numbers it was done for', async () => {
    const element = await mount({
      session: aSession(SQUAT, [225]),
      previous: previousMap(lastTime(SQUAT, SQUAT_LAST_TIME)),
    });

    expect(previousLines(shadow(element))).toHaveLength(1);
    // The date is asserted as the stored `YYYY-MM-DD` and not as anything a `Date`
    // would print: this is a day the lifter trained on, and reformatting it through a
    // zone is how it becomes the day before for everybody west of Greenwich.
    //
    // The run is composed rather than typed out because `format.test.ts` owns the
    // shorthand; the weight below is typed out, because it is this fixture's own
    // number and the point is that it survived the trip.
    const line = oneLine(previousLine(shadow(element)));
    expect(line).toBe(
      `${ACTIVE_NOTES.lastTime} ${LAST_TIME_DAY}: ${formatSetRun(SQUAT_LAST_TIME)}`,
    );
    expect(line).toContain('225 lb');
  });

  it('draws no line at all under an exercise with nothing to show', async () => {
    // A map with somebody else's answer in it rather than an empty one, so the
    // absence is about the lookup and not about there being no history anywhere.
    const element = await mount({
      session: aSession(SQUAT, [225]),
      previous: previousMap(lastTime(BENCH, SQUAT_LAST_TIME)),
    });

    // Counted, not read. Section 7.8 asks for nothing rather than an empty panel, and
    // an empty panel has empty text -- so an assertion on the text passes against the
    // one screen this case exists to catch.
    expect(previousLines(exerciseCard(element, 0))).toHaveLength(0);
    expect(previousLines(shadow(element))).toHaveLength(0);
  });

  it('draws it under the lift with a history and under no other', async () => {
    const element = await mount({
      session: aPairedSession(SQUAT, BENCH),
      // The second lift, so a line hard-wired to the first card cannot pass.
      previous: previousMap(lastTime(BENCH, SQUAT_LAST_TIME)),
    });

    expect(previousLines(shadow(element))).toHaveLength(1);
    expect(previousLines(exerciseCard(element, 0))).toHaveLength(0);
    expect(previousLines(exerciseCard(element, 1))).toHaveLength(1);
  });

  it('sits between the exercise and its sets, where a lifter reads it first', async () => {
    const element = await mount({
      session: aSession(SQUAT, [225]),
      previous: previousMap(lastTime(SQUAT, SQUAT_LAST_TIME)),
    });

    // On the order of the elements and not on the order of the text. A card that
    // rendered the line under the last set would read correctly in `textContent` and
    // put it off the bottom of a phone, which is the whole of the placement decision.
    const card = exerciseCard(element, 0);
    const children = [...card.children];
    const heading = card.querySelector('h3');
    const list = card.querySelector('ul');
    if (heading === null || list === null) throw new Error('This card has no heading or no sets.');
    const line = previousLine(card);

    expect(children.indexOf(heading)).toBeLessThan(children.indexOf(line));
    expect(children.indexOf(line)).toBeLessThan(children.indexOf(list));
  });

  it('stays exactly as it is when a set is ticked', async () => {
    const element = await mount({
      session: aSession(SQUAT, [225, 225]),
      previous: previousMap(lastTime(SQUAT, SQUAT_LAST_TIME)),
    });
    // The root's part of the one-tap flow, played here: the screen hands up a whole
    // next session and renders the one it is given back. Without this the property
    // never changes and the case proves nothing about a re-render.
    element.addEventListener(WORKOUT_CHANGED_EVENT, (event) => {
      element.session = event.detail.session;
    });
    const before = oneLine(previousLine(shadow(element)));

    await tap(element, setRow(element, 0), 'complete');

    // The tick landed, or the assertions below are about a screen nothing happened to.
    expect(deepAll(setRow(element, 0), '[data-action="undo"]')).toHaveLength(1);
    expect(previousLines(shadow(element))).toHaveLength(1);
    expect(oneLine(previousLine(shadow(element)))).toBe(before);
  });
});

/**
 * One lift twice in one session -- two rows sharing a catalogue identifier.
 *
 * The whole reason a note key names `WorkoutExercise.id` and not `exerciseId`. Every
 * other fixture in this file holds each lift once, and on those two the identifiers
 * are indistinguishable: a key built from the catalogue round-trips, writes to the
 * right place, and only shows itself on a session with squats in it twice, where it
 * puts the note about the second one on both.
 */
function aTwiceSession(exercise: ExerciseOption): WorkoutSession {
  const at = contextSeries();
  let session = createWorkout(at(AT_START), { localDate: ON_DAY, title: 'Squat day' });
  for (const amount of [135, 185]) {
    session = addExercise(session, at(AT_START), {
      exerciseId: exercise.id,
      displayName: exercise.name,
      loading: exercise.loading,
      plan: [
        {
          kind: 'working' as const,
          performance: performance({ kind: 'implement', weight: { amount, unit: 'lb' } }, 5),
        },
      ],
    });
  }
  return startWorkout(session, at(AT_START));
}

/** Every quiet control that reveals a note, in the order they are drawn. */
function noteControls(element: Element): HTMLElement[] {
  return deepAll(shadow(element), 'ptk-button[data-action="note"]');
}

/** Which note each of them acts on. */
function noteKeys(element: Element): (string | undefined)[] {
  return noteControls(element).map((host) => host.dataset['note']);
}

/** What each of them says about whether its box is open. */
function expandedStates(element: Element): (string | null)[] {
  return noteControls(element).map(
    (host) => shadow(host).querySelector('button')?.getAttribute('aria-expanded') ?? null,
  );
}

/** What a screen reader is told each of them is for. */
function accessibleNames(element: Element): (string | null)[] {
  return noteControls(element).map(
    (host) => shadow(host).querySelector('button')?.getAttribute('aria-label') ?? null,
  );
}

/** Every open note box, or only the ones for one key. */
function noteBoxes(element: Element, key?: string): HTMLElement[] {
  const selector =
    key === undefined ? 'ptk-text-area[data-note]' : `ptk-text-area[data-note="${key}"]`;
  return deepAll(shadow(element), selector);
}

/** The box for a key, or a failure rather than an assertion made against nothing. */
function noteBox(element: Element, key: string): HTMLElement {
  const box = noteBoxes(element, key)[0];
  if (box === undefined) throw new Error(`The note box for "${key}" is not open.`);
  return box;
}

/**
 * The fuller name a box is announced by, or `null` where it has none.
 *
 * Read off the inner `textarea` rather than the host, because that is the node a
 * screen reader lands on. `null` where the attribute is absent, which is a
 * different thing from an empty one: an empty `aria-label` on a labelled field is
 * a violation, so the absence is the assertion worth making.
 */
function spokenName(element: Element, key: string): string | null {
  return noteField(element, key).getAttribute('aria-label');
}

/** The field inside it, which is what a keyboard actually reaches. */
function noteField(element: Element, key: string): HTMLTextAreaElement {
  const field = shadow(noteBox(element, key)).querySelector('textarea');
  if (field === null) throw new Error(`The note box for "${key}" has no field in it.`);
  return field;
}

/**
 * The lifter's own words read back, wherever they have been drawn.
 *
 * Untrimmed. A note typed as a list was meant as one and the template keeps the
 * newlines, so trimming here would write an assertion that passes against a screen
 * throwing them away.
 */
function writtenNotes(root: DocumentFragment | HTMLElement): string[] {
  return deepAll(root, 'p.written').map((line) => line.textContent);
}

/**
 * Presses a control belonging to the screen rather than to one set row.
 *
 * `tap` above reaches into a row, which is where every control this file pressed
 * before notes arrived lives. Finish and the session's own note button sit at the
 * foot of the screen and belong to no row.
 */
async function tapScreen(element: PtkActiveWorkout, selector: string): Promise<void> {
  const host = deepAll(shadow(element), selector)[0];
  if (host === undefined) throw new Error(`This screen has no ${selector}.`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`${selector} has no button in it.`);
  button.click();
  await element.updateComplete;
}

/** Presses the quiet control that reveals one note. */
async function tapNote(element: PtkActiveWorkout, key: string): Promise<void> {
  await tapScreen(element, `ptk-button[data-action="note"][data-note="${key}"]`);
}

/**
 * Types into a note box the way a keyboard does.
 *
 * `input` on the inner textarea, because that is what `ptk-text-area` listens for.
 * A test dispatching the element's own change event would prove the screen reads an
 * event nothing fires.
 */
async function typeNote(element: PtkActiveWorkout, key: string, text: string): Promise<void> {
  const field = noteField(element, key);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Leaves the box, which writes it at once rather than half a second later. */
async function leaveNote(element: PtkActiveWorkout, key: string): Promise<void> {
  noteField(element, key).dispatchEvent(
    new FocusEvent('focusout', { bubbles: true, composed: true }),
  );
  await element.updateComplete;
}

/**
 * Section 10.2's debounce, waited out for real.
 *
 * No fake timers: nothing in this suite installs any, and `NOTE_DELAY_MILLIS` is
 * deliberately not a property -- a knob a test turns down to zero is a knob no test
 * exercises at the value that ships. 700 ms is the 500 ms delay with room for a
 * loaded runner, and it is paid twice in this file rather than once per case.
 */
async function waitOutTheDebounce(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 700);
  });
}

/** Every session the screen hands up, in order. */
function changes(element: PtkActiveWorkout): WorkoutChangedDetail[] {
  const seen: WorkoutChangedDetail[] = [];
  element.addEventListener(WORKOUT_CHANGED_EVENT, (event) => {
    seen.push(event.detail);
  });
  return seen;
}

/** The one event the finish flow ends in. */
function finishes(element: PtkActiveWorkout): WorkoutFinishedDetail[] {
  const seen: WorkoutFinishedDetail[] = [];
  element.addEventListener(WORKOUT_FINISHED_EVENT, (event) => {
    seen.push(event.detail);
  });
  return seen;
}

/**
 * The root's half of the loop, for the cases that then assert on the screen.
 *
 * This element is controlled: it renders from the session the parent sets back, so
 * without this the property never moves and a DOM assertion after an edit is an
 * assertion about the screen the test started with. The cases about the *event* do
 * not call it, on purpose -- a stale property is exactly what makes a second,
 * duplicate write visible.
 */
function playRoot(element: PtkActiveWorkout): void {
  element.addEventListener(WORKOUT_CHANGED_EVENT, (event) => {
    element.session = event.detail.session;
  });
}

/** The session on screen now, after the root above has played one back. */
function currentSession(element: PtkActiveWorkout): WorkoutSession {
  const session = element.session;
  if (session === null) throw new Error('This screen has no session on it.');
  return session;
}

function exerciseAt(session: WorkoutSession, index: number): WorkoutExercise {
  const exercise = session.exercises[index];
  if (exercise === undefined) throw new Error(`There is no exercise ${String(index + 1)}.`);
  return exercise;
}

/** The key naming one row's note -- built from the row's id, like the template's. */
function noteKeyFor(session: WorkoutSession, index: number): string {
  return exerciseNoteKey(exerciseAt(session, index).id);
}

/** What one row of a handed-up session carries as its note. */
function rowNote(session: WorkoutSession, index: number): string | null {
  return exerciseAt(session, index).note;
}

/** One set of one row, by position in the fixture. */
function setAt(session: WorkoutSession, exercise: number, index: number): WorkoutSet {
  const set = exerciseAt(session, exercise).sets[index];
  if (set === undefined) throw new Error(`There is no set ${String(index + 1)} in that exercise.`);
  return set;
}

/** The single session handed up, named so a miscount fails where it happened. */
function only(seen: readonly WorkoutChangedDetail[]): WorkoutChangedDetail {
  const [first] = seen;
  if (first === undefined || seen.length !== 1) {
    throw new Error(`Expected exactly one change, got ${String(seen.length)}.`);
  }
  return first;
}

/** Invented, and long enough that a trimmed copy is visibly a different string. */
const NOTE_TEXT = 'felt heavy off the floor';
const SESSION_NOTE = 'short on sleep, belt on from the second set';

describe('the notes on a session', () => {
  it('says nothing at all until something is written', async () => {
    const session = aPairedSession(SQUAT, BENCH);
    const element = await mount({ session });

    // Counted rather than read, for section 7.8's reason two blocks up: a surface
    // that always rendered would be empty, and empty text reads as absence.
    expect(writtenNotes(shadow(element))).toEqual([]);
    expect(noteBoxes(element)).toHaveLength(0);
    // One control per lift and one for the session, keyed as exact strings. A key
    // built from the catalogue identifier passes every other assertion in this
    // block except the one about a session holding a lift twice.
    expect(noteKeys(element)).toEqual([
      noteKeyFor(session, 0),
      noteKeyFor(session, 1),
      WORKOUT_NOTE_KEY,
    ]);
  });

  it('names each control for the lift it belongs to', async () => {
    const element = await mount({ session: aPairedSession(SQUAT, BENCH) });

    // "Note" three times over is not a name, and the session's own control has to
    // be told apart from the lift it sits under rather than reading as a note
    // about it.
    expect(accessibleNames(element)).toEqual([
      `${ACTIVE_NOTES.note}, ${SQUAT.name}`,
      `${ACTIVE_NOTES.note}, ${BENCH.name}`,
      ACTIVE_NOTES.workoutNote,
    ]);
    expect(new Set(accessibleNames(element)).size).toBe(3);
  });

  it('names an open box for its lift, and lets the workout box speak its label', async () => {
    const session = aPairedSession(SQUAT, BENCH);
    const element = await mount({ session });

    await tapNote(element, noteKeyFor(session, 1));

    // The eye gets the short word under a heading that already says which lift it
    // is; the ear gets the lift named, because a session with eight lifts draws
    // eight boxes and "Note" tells a visitor tabbing into the fifth nothing.
    expect(noteBox(element, noteKeyFor(session, 1)).getAttribute('label')).toBe(ACTIVE_NOTES.note);
    expect(spokenName(element, noteKeyFor(session, 1))).toBe(`${ACTIVE_NOTES.note}, ${BENCH.name}`);

    await tapNote(element, WORKOUT_NOTE_KEY);

    // Already named for what it is. A second name repeating the visible one is
    // the label read twice, so there is deliberately no attribute at all.
    expect(noteBox(element, WORKOUT_NOTE_KEY).getAttribute('label')).toBe(ACTIVE_NOTES.workoutNote);
    expect(spokenName(element, WORKOUT_NOTE_KEY)).toBeNull();
  });

  it('opens one box on the lift whose control was pressed', async () => {
    const session = aPairedSession(SQUAT, BENCH);
    const element = await mount({ session });

    await tapNote(element, noteKeyFor(session, 1));

    expect(noteBoxes(element)).toHaveLength(1);
    expect(noteBoxes(element, noteKeyFor(session, 1))).toHaveLength(1);
    expect(noteBox(element, noteKeyFor(session, 1)).getAttribute('label')).toBe(ACTIVE_NOTES.note);
    // A control that reveals something has to say whether it already has.
    expect(expandedStates(element)).toEqual(['false', 'true', 'false']);
  });

  it('closes it again when the same control is pressed twice', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });

    await tapNote(element, noteKeyFor(session, 0));
    await tapNote(element, noteKeyFor(session, 0));

    expect(noteBoxes(element)).toHaveLength(0);
    expect(expandedStates(element)).toEqual(['false', 'false']);
  });

  it('closes the first box when a second is opened, and keeps what was in it', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);

    await tapNote(element, noteKeyFor(session, 0));
    await typeNote(element, noteKeyFor(session, 0), NOTE_TEXT);
    // The other control, pressed with the first box still holding unwritten words
    // and with nothing having taken the focus off it. One box at a time is the
    // rule; closing one being how its contents are lost is the bug.
    await tapNote(element, WORKOUT_NOTE_KEY);

    expect(noteBoxes(element)).toHaveLength(1);
    expect(noteBoxes(element, WORKOUT_NOTE_KEY)).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(rowNote(only(seen).session, 0)).toBe(NOTE_TEXT);
  });

  it('writes what was typed when the box is left, once and trimmed', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);

    await tapNote(element, noteKeyFor(session, 0));
    await typeNote(element, noteKeyFor(session, 0), `  ${NOTE_TEXT}  `);
    await leaveNote(element, noteKeyFor(session, 0));
    // The debounce is cancelled by that write and not merely beaten to it. The
    // root is deliberately not playing anything back here, so a timer still
    // queued writes a second time and the count below is what sees it.
    await waitOutTheDebounce();

    expect(seen).toHaveLength(1);
    expect(only(seen).completedSetId).toBeNull();
    expect(rowNote(only(seen).session, 0)).toBe(NOTE_TEXT);
  });

  it('says nothing when the words have not moved', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);
    playRoot(element);

    const key = noteKeyFor(session, 0);
    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await leaveNote(element, key);
    expect(seen).toHaveLength(1);

    // The same note with a space on the end. The core normalises before it
    // compares and hands back the session it was given; the identity check on
    // this screen is what stops that becoming a write, a storage round trip and
    // a re-render for a keystroke that was undone.
    await typeNote(element, key, `${NOTE_TEXT} `);
    await leaveNote(element, key);

    expect(seen).toHaveLength(1);
  });

  it('shows a written note as one line, and re-opens the box on it', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    playRoot(element);
    const key = noteKeyFor(session, 0);

    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await leaveNote(element, key);
    await tapNote(element, key);

    expect(noteBoxes(element)).toHaveLength(0);
    expect(writtenNotes(shadow(element))).toEqual([NOTE_TEXT]);

    // Re-opened on what is stored rather than on an empty box, or the next blur
    // deletes a note by writing nothing over it.
    await tapNote(element, key);
    expect(noteField(element, key).value).toBe(NOTE_TEXT);
  });

  it('stores nothing for a note emptied out, and the line goes with it', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    playRoot(element);
    const key = noteKeyFor(session, 0);

    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await leaveNote(element, key);
    // Whitespace and not the empty string: the core stores both as null, and a
    // box a lifter has spacebarred out is the one that actually happens.
    await typeNote(element, key, '   ');
    await leaveNote(element, key);
    await tapNote(element, key);

    expect(rowNote(currentSession(element), 0)).toBeNull();
    expect(writtenNotes(shadow(element))).toEqual([]);
  });

  it('lands on the row that was pressed when the session holds the lift twice', async () => {
    const session = aTwiceSession(SQUAT);
    const element = await mount({ session });
    const seen = changes(element);
    playRoot(element);
    const key = noteKeyFor(session, 1);

    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await leaveNote(element, key);
    await tapNote(element, key);

    expect(seen).toHaveLength(1);
    expect(rowNote(only(seen).session, 0)).toBeNull();
    expect(rowNote(only(seen).session, 1)).toBe(NOTE_TEXT);
    // And on screen under the second card and under no other. Both rows carry the
    // same heading, so where the line is drawn is the only thing distinguishing a
    // note that landed on one row from a note that landed on both.
    expect(writtenNotes(exerciseCard(element, 0))).toEqual([]);
    expect(writtenNotes(exerciseCard(element, 1))).toEqual([NOTE_TEXT]);
  });

  it('writes the session note from the control at the foot', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);

    await tapNote(element, WORKOUT_NOTE_KEY);
    await typeNote(element, WORKOUT_NOTE_KEY, SESSION_NOTE);
    await leaveNote(element, WORKOUT_NOTE_KEY);

    expect(seen).toHaveLength(1);
    expect(only(seen).session.note).toBe(SESSION_NOTE);
    // On the session and not on the lift it happens to be drawn below.
    expect(rowNote(only(seen).session, 0)).toBeNull();
  });

  it('writes half a second after the last keystroke with nothing pressed', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);

    await tapNote(element, WORKOUT_NOTE_KEY);
    await typeNote(element, WORKOUT_NOTE_KEY, SESSION_NOTE);
    // A phone put down mid-note is the case: nothing is pressed, nothing is
    // blurred, and section 10.2 says it is kept anyway.
    expect(seen).toHaveLength(0);

    await waitOutTheDebounce();

    expect(seen).toHaveLength(1);
    expect(only(seen).session.note).toBe(SESSION_NOTE);
  });

  it('keeps a note typed in the same breath as a set was ticked', async () => {
    const session = aSession(SQUAT, [135, 185]);
    const element = await mount({ session });
    const seen = changes(element);
    const key = noteKeyFor(session, 0);

    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    // Neither blurred nor waited out. A lifter types a note about the set they
    // have just done and presses Done on it, both inside half a second, and the
    // one session that reaches storage has to carry the tick *and* the words.
    await tap(element, setRow(element, 0), 'complete');

    expect(seen).toHaveLength(1);
    expect(only(seen).completedSetId).toBe(setAt(session, 0, 0).id);
    expect(rowNote(only(seen).session, 0)).toBe(NOTE_TEXT);
    expect(setAt(only(seen).session, 0, 0).status).toBe('complete');
  });

  it('keeps a note typed in the same breath as a set was unticked', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    playRoot(element);
    await tap(element, setRow(element, 0), 'complete');
    const seen = changes(element);
    const key = noteKeyFor(session, 0);

    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await tap(element, setRow(element, 0), 'undo');

    expect(seen).toHaveLength(1);
    expect(rowNote(only(seen).session, 0)).toBe(NOTE_TEXT);
    expect(setAt(only(seen).session, 0, 0).status).toBe('planned');
  });

  it('keeps a note typed in the same breath as an edit was saved', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    const seen = changes(element);
    const key = noteKeyFor(session, 0);

    await tap(element, setRow(element, 0), 'edit');
    await tapNote(element, key);
    await typeNote(element, key, NOTE_TEXT);
    await tap(element, setRow(element, 0), 'save-edit');

    expect(seen).toHaveLength(1);
    expect(rowNote(only(seen).session, 0)).toBe(NOTE_TEXT);
    expect(setAt(only(seen).session, 0, 0).performed).not.toBeNull();
  });

  it('carries an unwritten note into the finish panel, and draws one box for it', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });

    await tapNote(element, WORKOUT_NOTE_KEY);
    await typeNote(element, WORKOUT_NOTE_KEY, SESSION_NOTE);
    await tapScreen(element, 'ptk-button[data-action="finish"]');

    // One box for this note and not two. The surface at the foot and its control
    // are both withdrawn while the panel is up, which is the only thing keeping
    // the same note from being open in two places with two different drafts in it.
    expect(noteBoxes(element, WORKOUT_NOTE_KEY)).toHaveLength(1);
    expect(noteKeys(element)).toEqual([noteKeyFor(session, 0)]);
    expect(noteField(element, WORKOUT_NOTE_KEY).value).toBe(SESSION_NOTE);
    expect(noteBox(element, WORKOUT_NOTE_KEY).getAttribute('label')).toBe(ACTIVE_NOTES.workoutNote);
  });

  it('carries a note still in the box into the finished session', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session });
    playRoot(element);
    await tap(element, setRow(element, 0), 'complete');
    const finished = finishes(element);

    await tapScreen(element, 'ptk-button[data-action="finish"]');
    const seen = changes(element);
    await typeNote(element, WORKOUT_NOTE_KEY, SESSION_NOTE);
    expect(seen).toEqual([]);
    // Confirmed with the words still in the box. This event is the only carrier
    // of the finished session, so a draft dropped here exists nowhere else --
    // it is the one place the fold is required rather than merely safe.
    await tapScreen(element, 'ptk-button[data-action="finish-confirm"]');

    expect(finished).toHaveLength(1);
    expect(finished[0]?.session.note).toBe(SESSION_NOTE);
    expect(finished[0]?.session.status).toBe('completed');
  });

  it('has no accessibility violations with a box open', async () => {
    const session = aSession(SQUAT, [135]);
    const element = await mount({ session, equipment: aPoundGym() });
    await tapNote(element, noteKeyFor(session, 0));
    await typeNote(element, noteKeyFor(session, 0), NOTE_TEXT);

    // Contrast off for this file's usual reason, and the box open because a
    // labelled control nobody has revealed is a control axe never sees.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

/**
 * The editor's boxes on one row, named by the field each of them routes to.
 *
 * Read as a list rather than probed one at a time, because the case that matters
 * is an absence: an assertion that the effort box is missing passes just as well
 * against an editor that failed to draw anything at all.
 */
function editorFields(row: HTMLElement): (string | undefined)[] {
  return deepAll(row, '[data-field]').map((wrapper) => wrapper.dataset['field']);
}

/** One of them, or a failure rather than an assertion made against nothing. */
function editorField(root: DocumentFragment | HTMLElement, field: string): HTMLElement {
  const wrapper = deepAll(root, `[data-field="${field}"]`)[0];
  if (wrapper === undefined) throw new Error(`The editor has no "${field}" box.`);
  return wrapper;
}

function numberField(root: DocumentFragment | HTMLElement, field: string): HTMLElement {
  const host = editorField(root, field).querySelector('ptk-number-field');
  if (host === null) throw new Error(`The "${field}" box holds no field.`);
  return host;
}

/** The box a keyboard actually reaches. */
function numberBox(root: DocumentFragment | HTMLElement, field: string): HTMLInputElement {
  const input = shadow(numberField(root, field)).querySelector('input');
  if (input === null) throw new Error(`The "${field}" field has no input in it.`);
  return input;
}

/** What the eye reads above a box, off the rendered label and not the attribute. */
function fieldLabel(root: DocumentFragment | HTMLElement, field: string): string {
  return shadow(numberField(root, field)).querySelector('label')?.textContent.trim() ?? '';
}

/** The standing note under it, or the empty string where none is drawn. */
function fieldHint(root: DocumentFragment | HTMLElement, field: string): string {
  return shadow(numberField(root, field)).querySelector('.hint')?.textContent.trim() ?? '';
}

/**
 * Types into one of the editor's boxes the way a keyboard does.
 *
 * `input` on the inner element, for `type`'s reason at the foot of this file:
 * every field in `packages/ui` reports on `@input`, so a test dispatching the
 * element's own change event proves the screen reads an event nothing fires.
 */
async function typeInto(
  element: PtkActiveWorkout,
  row: HTMLElement,
  field: string,
  text: string,
): Promise<void> {
  const input = numberBox(row, field);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

/** Every effort drawn on a row, in row order, exactly as a lifter reads it. */
function rowEfforts(element: Element): string[] {
  return deepAll(shadow(element), 'span.set-effort').map((span) => span.textContent.trim());
}

/** Every "different from the plan" line on screen. */
function statusLines(element: Element): string[] {
  return deepAll(shadow(element), 'p.status').map((line) => line.textContent.trim());
}

/** What one set of a handed-back session actually holds, scale and all. */
function storedEffort(session: WorkoutSession, exercise: number, index: number): Effort | null {
  return setAt(session, exercise, index).performed?.effort ?? null;
}

/**
 * A session whose *plan* carries a rating, which nothing in this tool writes.
 *
 * Built by hand through `performance`'s third argument rather than by any screen,
 * because there is no screen that produces one -- an effort is entered against a
 * set that was done. It exists so the three places that read `performed` alone can
 * be told apart from the three that would read `performed ?? planned`, which agree
 * with them on every session a lifter can currently reach.
 */
function aPlannedRating(exercise: ExerciseOption, effort: Effort): WorkoutSession {
  const at = contextSeries();
  let session = createWorkout(at(AT_START), { localDate: ON_DAY, title: 'Squat day' });
  session = addExercise(session, at(AT_START), {
    exerciseId: exercise.id,
    displayName: exercise.name,
    loading: exercise.loading,
    plan: [
      {
        kind: 'working' as const,
        performance: performance(
          { kind: 'implement', weight: { amount: 135, unit: 'lb' } },
          5,
          effort,
        ),
      },
    ],
  });
  return startWorkout(session, at(AT_START));
}

describe('the effort a set was rated at', () => {
  it('draws no box for it until a lifter asks for one', async () => {
    // The state a logbook is in on day one, section 7.10. The other two boxes are
    // asserted with it because an editor that drew nothing at all would satisfy an
    // assertion about the third one on its own.
    const element = await mount({ session: aSession(SQUAT, [135]) });

    await tap(element, setRow(element, 0), 'edit');

    expect(editorFields(setRow(element, 0))).toEqual([DONE_WEIGHT_FIELD, DONE_REPS_FIELD]);
  });

  it('draws it labelled and explained for whichever scale was chosen', async () => {
    const rpe = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    await tap(rpe, setRow(rpe, 0), 'edit');
    const rir = await mount({ session: aSession(SQUAT, [135]), effort: 'rir' });
    await tap(rir, setRow(rir, 0), 'edit');

    expect(editorFields(setRow(rpe, 0))).toEqual([
      DONE_WEIGHT_FIELD,
      DONE_REPS_FIELD,
      DONE_EFFORT_FIELD,
    ]);
    // The two scales run in opposite directions -- a hard 10 is an RPE and an easy
    // one is nine reps left in the tank -- so a box labelled with the wrong one of
    // them collects a number that means very nearly the reverse of what it says.
    expect(fieldLabel(setRow(rpe, 0), DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_LABELS.rpe);
    expect(fieldLabel(setRow(rir, 0), DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_LABELS.rir);
    expect(EFFORT_FIELD_LABELS.rpe).not.toBe(EFFORT_FIELD_LABELS.rir);

    // Section 17: the scale is explained where it is asked for, or the box is a
    // number with no units offered to somebody who has met neither acronym.
    expect(fieldHint(setRow(rpe, 0), DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_HINTS.rpe);
    expect(fieldHint(setRow(rir, 0), DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_HINTS.rir);
  });

  it('records what was typed, on the scale the box was labelled with', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    const seen = changes(element);

    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    // The scale is asserted with the number because the two are one fact. An 8
    // stored without it, or stored under the other one, is a set that reads as
    // brutal where it was easy.
    expect(storedEffort(only(seen).session, 0, 0)).toEqual({ scale: 'rpe', value: 8 });
  });

  it('shows the effort on the row it was recorded against', async () => {
    const element = await mount({ session: aSession(SQUAT, [135, 185]), effort: 'rpe' });
    playRoot(element);

    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    // One row and not both, so a rating drawn from the exercise rather than from
    // the set cannot pass. Composed from the label constant rather than typed out,
    // because `format.test.ts` owns the shorthand.
    expect(rowEfforts(element)).toEqual([`${EFFORT_LABELS.rpe} 8`]);
  });

  it('keeps showing it after effort entry is switched off', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    element.effort = 'none';
    await element.updateComplete;

    // The whole of the display/entry split. Turning the setting off withdraws the
    // box a number is entered in; a history that vanished with it would be the
    // worse bug by far, and it is one a lifter would find weeks later.
    expect(rowEfforts(element)).toEqual([`${EFFORT_LABELS.rpe} 8`]);
    await tap(element, setRow(element, 0), 'edit');
    expect(editorFields(setRow(element, 0))).toEqual([DONE_WEIGHT_FIELD, DONE_REPS_FIELD]);
  });

  it('records no effort at all for a set ticked off in one tap', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);

    await tap(element, setRow(element, 0), 'complete');

    // An effort is entered and never generated. The one-tap path copies the plan
    // into `performed`, and nothing plans an effort -- so a set ticked off says
    // nothing about how it felt, and must not appear to.
    expect(storedEffort(currentSession(element), 0, 0)).toBeNull();
    expect(rowEfforts(element)).toEqual([]);
  });

  it('re-opens the box on the effort already recorded', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    await tap(element, setRow(element, 0), 'edit');

    // Seeded, for the same reason the weight box is: an empty box a lifter does
    // not refill is how a correction to the reps deletes the rating beside them.
    expect(numberBox(setRow(element, 0), DONE_EFFORT_FIELD).value).toBe('8');
  });

  it('opens the box empty where the rating was made on the other scale', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '3');
    await tap(element, setRow(element, 0), 'save-edit');

    element.effort = 'rir';
    await element.updateComplete;
    await tap(element, setRow(element, 0), 'edit');

    // 3 is a plausible reading on both scales and means opposite things on them,
    // so seeding across is not a small inaccuracy -- it offers an RPE 3 back for
    // saving as an RIR 3. The row still says which one it was.
    expect(numberBox(setRow(element, 0), DONE_EFFORT_FIELD).value).toBe('');
    expect(rowEfforts(element)).toEqual([`${EFFORT_LABELS.rpe} 3`]);
  });

  it('clears the rating when its own box is emptied', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '');
    await tap(element, setRow(element, 0), 'save-edit');

    // There is no other control for taking a mistyped effort back, so emptying
    // the box has to be one -- and the line on the row has to go with it.
    expect(storedEffort(currentSession(element), 0, 0)).toBeNull();
    expect(rowEfforts(element)).toEqual([]);
  });

  it('does not clear a rating made on the other scale from a box it opened empty', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');
    await tap(element, setRow(element, 0), 'save-edit');

    // Switched, then an ordinary correction with the effort box left exactly as
    // the tool opened it. That emptiness is the tool's own doing -- the case
    // above put it there deliberately -- so reading it as "take the rating back"
    // would delete a number the lifter was never shown and never touched.
    element.effort = 'rir';
    await element.updateComplete;
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_REPS_FIELD, '4');
    await tap(element, setRow(element, 0), 'save-edit');

    expect(storedEffort(currentSession(element), 0, 0)).toEqual({ scale: 'rpe', value: 8 });
    expect(setAt(currentSession(element), 0, 0).performed?.repetitions).toBe(4);
    expect(rowEfforts(element)).toEqual([`${EFFORT_LABELS.rpe} 8`]);
  });

  it('leaves a rating alone when a rep count is corrected with the setting off', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '9');
    await tap(element, setRow(element, 0), 'save-edit');

    element.effort = 'none';
    await element.updateComplete;
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_REPS_FIELD, '4');
    await tap(element, setRow(element, 0), 'save-edit');

    // No box was drawn, so nothing was said. Somebody who logs a year in RPE and
    // then switches the setting off must not lose a rating per set, one set at a
    // time, every time they fix a rep count.
    expect(storedEffort(currentSession(element), 0, 0)).toEqual({ scale: 'rpe', value: 9 });
    expect(setAt(currentSession(element), 0, 0).performed?.repetitions).toBe(4);
  });

  it('keeps a half point and a nought exactly as they were typed', async () => {
    const element = await mount({ session: aSession(SQUAT, [135, 185]), effort: 'rpe' });
    playRoot(element);

    // 8.5 is the commonest thing anybody writes on the RPE scale, and a reader
    // borrowed from the rep box would refuse it for not being an integer.
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8.5');
    await tap(element, setRow(element, 0), 'save-edit');

    // RIR 0 is the entry the scale exists for -- nothing left in the tank -- and
    // it is the one a truthiness check silently drops.
    element.effort = 'rir';
    await element.updateComplete;
    await tap(element, setRow(element, 1), 'edit');
    await typeInto(element, setRow(element, 1), DONE_EFFORT_FIELD, '0');
    await tap(element, setRow(element, 1), 'save-edit');

    expect(storedEffort(currentSession(element), 0, 0)).toEqual({ scale: 'rpe', value: 8.5 });
    expect(storedEffort(currentSession(element), 0, 1)).toEqual({ scale: 'rir', value: 0 });
    expect(rowEfforts(element)).toEqual([`${EFFORT_LABELS.rpe} 8.5`, `${EFFORT_LABELS.rir} 0`]);
  });

  it('says nothing about the plan where the only thing added was a rating', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    playRoot(element);

    // The editor opens seeded, so saving without touching the weight or the reps
    // records the set exactly as planned. Nothing plans an effort, so comparing
    // one would put "Different from the plan" under every set a lifter rated --
    // which is the line's meaning worn away until nobody reads the one that counts.
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '9');
    await tap(element, setRow(element, 0), 'save-edit');

    expect(storedEffort(currentSession(element), 0, 0)).toEqual({ scale: 'rpe', value: 9 });
    expect(statusLines(element)).toEqual([]);

    // And the line is still drawn by something, or the absence above is an
    // assertion about a selector nothing ever matches.
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_REPS_FIELD, '4');
    await tap(element, setRow(element, 0), 'save-edit');

    expect(statusLines(element)).toEqual([ACTIVE_NOTES.edited]);
  });

  it('reads a rating off what was done and never off the plan', async () => {
    // The plan fallback the two boxes above the effort one are seeded through is
    // right for a weight and wrong for this: a rating belongs to a set that was
    // done. It reaches the same answer on every session a lifter can reach today,
    // because nothing plans an effort -- so this fixture plans one, which is the
    // only way the two rules are distinguishable at all.
    const session = aPlannedRating(SQUAT, { scale: 'rpe', value: 8 });
    const element = await mount({ session, effort: 'rpe' });

    expect(rowEfforts(element)).toEqual([]);
    await tap(element, setRow(element, 0), 'edit');
    expect(numberBox(setRow(element, 0), DONE_EFFORT_FIELD).value).toBe('');

    // And with no box drawn at all, where the save carries the stored rating
    // through untouched. The stored rating of a set nobody has done is nothing.
    const off = await mount({ session, effort: 'none' });
    const seen = changes(off);
    await tap(off, setRow(off, 0), 'edit');
    await tap(off, setRow(off, 0), 'save-edit');

    expect(storedEffort(only(seen).session, 0, 0)).toBeNull();
  });

  it('has no accessibility violations with the effort box open', async () => {
    const element = await mount({ session: aSession(SQUAT, [135]), effort: 'rpe' });
    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_EFFORT_FIELD, '8');

    // Contrast off for this file's usual reason. The box open because a field
    // nobody revealed is a field axe never sees, and this one carries both a
    // label and a hint it has to be described by.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

/**
 * The editor is a group of fields, and a group of fields wants a name.
 *
 * Deliberately not the answer task #20 gave `ptk-text-area`. There, eight boxes
 * labelled "Note" were on one screen at once and each one had to say which lift it
 * belonged to, because the ambiguity was real. Here only one editor is ever open, so
 * nothing is ambiguous -- what is missing is orientation, for somebody who tabbed
 * into "Weight lifted" from a list of forty rows and cannot see which row opened. A
 * name on the group answers that once, on entry, and leaves all three fields'
 * accessible names equal to their visible labels.
 */
describe('the editor a set opens', () => {
  /** The editor's own container, which is what a group name has to sit on. */
  function editorGroup(row: HTMLElement): HTMLElement {
    const group = deepAll(row, '[role="group"]')[0];
    if (group === undefined) throw new Error('This row has no editor group.');
    return group;
  }

  it('names itself for the set it belongs to, and leaves each field its own label', async () => {
    const element = await mount({ session: aSession(SQUAT, [135, 135, 135]), effort: 'rpe' });

    await tap(element, setRow(element, 1), 'edit');
    const row = setRow(element, 1);

    // The second set of three and not the first: a name built off the row's lift
    // alone, or off a position hardcoded to one, passes on set one either way.
    expect(editorGroup(row).getAttribute('aria-label')).toBe(`${SQUAT.name} set 2`);
    // One group on the screen and not one per row. The closed rows draw no editor,
    // so three groups would mean three open editors -- which is the other way this
    // could be wrong and looks identical from inside the row.
    expect(deepAll(shadow(element), '[role="group"]')).toHaveLength(1);
    // And the fields say what they hold, unqualified. Each one's accessible name
    // staying word for word its visible label is what keeps WCAG 2.5.3 satisfied
    // without anybody having to think about it again.
    expect(editorFields(row)).toEqual([DONE_WEIGHT_FIELD, DONE_REPS_FIELD, DONE_EFFORT_FIELD]);
    expect(fieldLabel(row, DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_LABELS.rpe);
  });
});

describe('the weight box on a set recorded in the other unit', () => {
  /** Invented (section 5.1), and kg-round so the pound reading is visibly not it. */
  const RECORDED_KG = 100;
  /** The same weight in pounds at the display precision, which is what the box shows. */
  const SHOWN_LB = 220.46;

  function storedLoad(session: WorkoutSession, index: number): SetLoad | null {
    return setAt(session, 0, index).performed?.load ?? null;
  }

  it('opens the box on the stored weight converted, not on the number relabelled', async () => {
    const element = await mount({ session: aSession(SQUAT, [RECORDED_KG], 'kg'), unit: 'lb' });

    await tap(element, setRow(element, 0), 'edit');

    // Section 11.4's split: recorded weights read in the unit they were typed in, and
    // only the entry boxes are in the reading unit. This box is labelled lb, so a
    // "100" in it is a hundred pounds -- less than half the bar this set was done at.
    expect(numberBox(setRow(element, 0), DONE_WEIGHT_FIELD).value).toBe(String(SHOWN_LB));
  });

  it('keeps the weight exactly as recorded when only the reps are corrected', async () => {
    const element = await mount({ session: aSession(SQUAT, [RECORDED_KG], 'kg'), unit: 'lb' });
    const seen = changes(element);

    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_REPS_FIELD, '4');
    await tap(element, setRow(element, 0), 'save-edit');

    // Neither 220.46 lb, which is this weight rounded, nor 100 lb, which is not this
    // weight at all. A box still holding the number it was opened with is not an
    // entry, and correcting a rep count must leave the bar alone.
    expect(storedLoad(only(seen).session, 0)).toEqual({
      kind: 'implement',
      weight: { amount: RECORDED_KG, unit: 'kg' },
    });
  });

  it('takes a retyped weight in the unit the box is labelled with', async () => {
    const element = await mount({ session: aSession(SQUAT, [RECORDED_KG], 'kg'), unit: 'lb' });
    const seen = changes(element);

    await tap(element, setRow(element, 0), 'edit');
    await typeInto(element, setRow(element, 0), DONE_WEIGHT_FIELD, '225');
    await tap(element, setRow(element, 0), 'save-edit');

    // The other half of it. A number typed into a box marked lb is pounds, and
    // storing it as kilograms would be the same bug pointing the other way.
    expect(storedLoad(only(seen).session, 0)).toEqual({
      kind: 'implement',
      weight: { amount: 225, unit: 'lb' },
    });
  });
});

describe('the rack the tool hands down', () => {
  it('reaches the logging screen from the settings the repository loaded', async () => {
    const element = await mountTool({ equipment: aPoundGym() });

    await press(element, 'start-workout');
    await press(element, 'add-primary'); // The first of section 6.1's four is the squat.
    await type(element, '135');
    await press(element, 'start');

    // The builder plans three sets by default, so three rows and one instruction: the
    // bar is loaded once and stays that way.
    expect(diagrams(element)).toEqual(['Per side: 45 lb', 'Per side: 45 lb', 'Per side: 45 lb']);
    expect(notes(element)).toEqual(['Add 45 lb per side']);
  });

  it('draws nothing where the lifter has never chosen one', async () => {
    // The same journey with `equipment` left at its default. Both halves are needed: the
    // first proves the binding exists, and without this one a binding hard-wired to a
    // rack the tool invented would pass it.
    const element = await mountTool({ equipment: null });

    await press(element, 'start-workout');
    await press(element, 'add-primary');
    await type(element, '135');
    await press(element, 'start');

    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
  });
});

/**
 * Section 7.10's setting, over the same wiring and for the same reason as the rack.
 *
 * `.effort=${this.settings.effort}` on one line of `ptk-training-logbook` is the whole
 * of it, and dropping it type-checks, lints, renders and passes every case above --
 * the editor would simply never ask anybody for an effort, which is exactly what it
 * correctly does for a lifter who has left the setting alone. Only a journey that goes
 * through the settings the repository loaded can tell those two apart, so this is a
 * pair rather than a case: the second half is what stops a binding hard-wired to a
 * scale the tool picked for itself from passing the first.
 */
describe('the effort setting the tool hands down', () => {
  it('reaches the editor from the settings the repository loaded', async () => {
    const element = await mountTool({ effort: 'rir' });

    await press(element, 'start-workout');
    await press(element, 'add-primary');
    await type(element, '135');
    await press(element, 'start');
    await press(element, 'edit');

    const row = setRow(element, 0);
    expect(editorFields(row)).toEqual([DONE_WEIGHT_FIELD, DONE_REPS_FIELD, DONE_EFFORT_FIELD]);
    // Named for the scale the settings hold and not for the other one, or the
    // binding could be reading any of the three answers and still draw a box.
    expect(fieldLabel(row, DONE_EFFORT_FIELD)).toBe(EFFORT_FIELD_LABELS.rir);
  });

  it('asks for no effort where the lifter has never switched it on', async () => {
    const element = await mountTool({});

    await press(element, 'start-workout');
    await press(element, 'add-primary');
    await type(element, '135');
    await press(element, 'start');
    await press(element, 'edit');

    expect(editorFields(setRow(element, 0))).toEqual([DONE_WEIGHT_FIELD, DONE_REPS_FIELD]);
  });
});

describe('changing the sets in a live session', () => {
  it('adds a row at the foot of the lift, planned like the one it lands after', async () => {
    const element = await aStartedWorkout();

    await pressIn(element, exerciseCard(element, 0), addSetControl());

    // Four rows and not three, and the fourth reading what the third reads. `addSet`
    // appends, so "like the row it lands after" and "like the last row" are the same
    // sentence here -- which is what makes Add mean "one more of these".
    expect(rowPlans(element)).toEqual([SQUAT_PLAN, SQUAT_PLAN, SQUAT_PLAN, SQUAT_PLAN]);
    expect(rowKinds(element)).toEqual(['working', 'working', 'working', 'working']);
  });

  it('adds an empty working row to a lift whose rows have all gone', async () => {
    const element = await aStartedWorkout();

    for (const _ of [0, 1, 2]) await removeFirstRow(element);
    expect(setRows(element).length).toBe(0);
    await pressIn(element, exerciseCard(element, 0), addSetControl());

    // Reachable, and the branch has nothing to copy from. A working set because that
    // is the kind every other path plans, and an empty one because an empty row is
    // still a row to tick -- the numbers go in through the editor that is already there.
    expect(rowKinds(element)).toEqual(['working']);
    expect(rowPlans(element)).toEqual([NOT_SET]);
  });

  it('takes the kind of the row it lands after, and not always a working set', async () => {
    // Seeded rather than built, because nothing on the builder puts a back-off last:
    // ramps are inserted above the working sets, so every session that screen makes has
    // a working set at the tail and a copier hard-coded to `working` would pass anyway.
    const store = await aStore({});
    await store.writeWorkout(aBackoffSession(), { kind: 'set' });
    const element = await mountToolOver(store);

    await press(element, 'resume-workout');
    expect(rowKinds(element)).toEqual(['working', 'backoff']);
    await pressIn(element, exerciseCard(element, 0), addSetControl());

    expect(rowKinds(element)).toEqual(['working', 'backoff', 'backoff']);
    expect(rowPlans(element)).toEqual([TOP_PLAN, BACKOFF_PLAN, BACKOFF_PLAN]);
  });

  it('plans an added row from the plan and not from what was done', async () => {
    const element = await aStartedWorkout();
    // The last row done short of what it asked for, which is the only session where
    // the two answers differ -- everywhere else the plan and the performance agree
    // and a copier reading either one looks correct.
    await pressIn(element, setRow(element, 2), controlFor('complete'));
    await openEditorOn(element, 2);
    await correctWeight(element, 2, '125');

    await pressIn(element, exerciseCard(element, 0), addSetControl());

    // `duplicateSet`'s rule, so that the two controls agree. Copying what the row
    // *shows* would make the button beside it copy something else, which is worse
    // than either answer on its own.
    expect(rowPlans(element)).toEqual([SQUAT_PLAN, SQUAT_PLAN, '125 lb x 5', SQUAT_PLAN]);
  });

  it('adds to the lift whose button was pressed', async () => {
    const element = await aPairOfLifts();

    await pressIn(element, exerciseCard(element, 1), addSetControl());

    // One card grew and the other did not. With one lift on screen a handler ignoring
    // its `data-exercise` and appending to the first lift it finds is indistinguishable
    // from a correct one.
    expect(exerciseCards(element).map((card) => deepAll(card, 'li[data-set]').length)).toEqual([
      3, 4,
    ]);
  });

  it('puts a duplicate straight after the row it copied, and leaves it to be done', async () => {
    const element = await aStartedWorkout();
    await press(element, 'complete');

    await openEditorOn(element, 0);
    await pressIn(element, setRow(element, 0), controlFor('duplicate-set'));

    // Beside the row it came from rather than at the end, which is the difference
    // between Add and Duplicate and the only thing on screen that tells them apart.
    expect(setRows(element).length).toBe(4);
    expect(doneRows(element)).toEqual([true, false, false, false]);
  });

  it('marks a row skipped and says so, and undo puts it back', async () => {
    const element = await aStartedWorkout();

    await openEditorOn(element, 0);
    await pressIn(element, setRow(element, 0), controlFor('skip-set'));

    // The word matters more than the state. A skipped row is `done`, carries Undo and
    // shows the plan, so without this line it is the same row as one that was ticked.
    expect(statusLines(element)).toEqual([ACTIVE_NOTES.skipped]);
    expect(doneRows(element)).toEqual([true, false, false]);

    await pressIn(element, setRow(element, 0), controlFor('undo'));

    expect(statusLines(element)).toEqual([]);
    expect(doneRows(element)).toEqual([false, false, false]);
  });

  it('offers no skip on a row that has already been answered', async () => {
    const element = await aStartedWorkout();
    await press(element, 'complete');

    await openEditorOn(element, 0);

    // Skipping a set already ticked would throw away what the lifter did in order to
    // say they did not do it. The other two stay, because a row done at the wrong
    // weight is still a row worth copying or taking out.
    expect(structureControls(setRow(element, 0))).toEqual(['duplicate-set', 'remove-set']);
    expect(structureControls(setRow(element, 1))).toEqual([]);
  });

  it('takes a row out', async () => {
    const element = await aStartedWorkout();

    await openEditorOn(element, 1);
    await pressIn(element, setRow(element, 1), controlFor('remove-set'));

    expect(setRows(element).length).toBe(2);
  });

  it('closes the editor on skip and on remove, and leaves it open on duplicate', async () => {
    const element = await aStartedWorkout();

    await openEditorOn(element, 0);
    await pressIn(element, setRow(element, 0), controlFor('duplicate-set'));
    // Still on the row it was on: that row is there and is still being corrected.
    expect(openEditor(element)).toBe(0);

    await pressIn(element, setRow(element, 0), controlFor('skip-set'));
    // Left open, Save would be ready to put back the performance the skip just cleared.
    expect(openEditor(element)).toBe(-1);

    await openEditorOn(element, 1);
    await pressIn(element, setRow(element, 1), controlFor('remove-set'));
    expect(openEditor(element)).toBe(-1);
  });

  it('keeps a note still in its box when a row is taken out', async () => {
    const store = await aStore({});
    const element = await mountToolOver(store);
    await startTheWorkout(element);
    const key = exerciseNoteKey(exerciseAt(await written(store), 0).id);

    await pressIn(element, shadow(element), `ptk-button[data-action="note"][data-note="${key}"]`);
    await draftNote(element, key, 'Belt on from here');
    await openEditorOn(element, 2);
    await pressIn(element, setRow(element, 2), controlFor('remove-set'));

    // Asserted against the database and not the screen, because the box keeps its own
    // draft and would read back correctly even from a session that lost it. The change
    // is applied to whatever the root is holding, so a note not written before the
    // event goes is a note the change overwrites.
    const kept = await written(store);
    expect(exerciseAt(kept, 0).sets.length).toBe(2);
    expect(exerciseAt(kept, 0).note).toBe('Belt on from here');
  });

  it('writes nothing for a change naming a row or a lift that is not there', async () => {
    const { store, writes } = counted(await aStore({}));
    const element = await mountToolOver(store);
    await startTheWorkout(element);
    const before = await written(store);
    const soFar = writes();

    for (const change of [
      { kind: 'duplicate' as const, setId: 'no-such-set' },
      { kind: 'skip' as const, setId: 'no-such-set' },
      { kind: 'remove' as const, setId: 'no-such-set' },
      { kind: 'add' as const, exerciseId: 'no-such-lift' },
    ]) {
      askFor(element, change);
    }
    await settle(element);

    // Counted rather than compared, because a miss that rebuilt the session would
    // write bytes identical to the ones already there and no assertion on content
    // could see it. What it would cost is four writes and an `updatedAt` a shade
    // newer -- which moves the workout to the top of the history for nothing.
    expect(writes()).toBe(soFar);
    expect(await written(store)).toEqual(before);
    expect(setRows(element).length).toBe(3);
  });

  it('has no accessibility violations with the structure controls open', async () => {
    const element = await aStartedWorkout();
    await openEditorOn(element, 0);

    // Contrast off for this file's usual reason. Open, because three quiet buttons
    // behind a disclosure are three buttons axe never reaches -- and each of them has
    // to name the row it acts on, since five rows of "Remove this set" are five
    // identical names.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

/**
 * The three working sets the builder makes from one weight, as they read on screen.
 *
 * Written out rather than composed from the formatter's own pieces, so that a change
 * to how a set is worded fails here instead of agreeing with itself.
 */
const SQUAT_PLAN = '135 lb x 5';

/** {@link aBackoffSession}'s two rows. Invented numbers, section 5.1. */
const TOP_PLAN = '225 lb x 5';
const BACKOFF_PLAN = '185 lb x 8';

/** The shortest road to a live session: one lift, three working sets, nothing done. */
async function aStartedWorkout(): Promise<PtkTrainingLogbook> {
  const element = await mountTool({});
  await startTheWorkout(element);
  return element;
}

/** The builder journey, which several cases below start from a store of their own. */
async function startTheWorkout(element: PtkTrainingLogbook): Promise<void> {
  await press(element, 'start-workout');
  await press(element, 'add-primary');
  await type(element, '135');
  await press(element, 'start');
}

/** Two lifts, so that "which card was pressed" is a question with a wrong answer. */
async function aPairOfLifts(): Promise<PtkTrainingLogbook> {
  const element = await mountTool({});
  await press(element, 'start-workout');
  await press(element, 'add-primary');
  await type(element, '135');
  await pressIn(
    element,
    shadow(element),
    `[data-action="add-primary"][data-exercise="${BENCH.id}"]`,
  );
  await typeWeight(element, 1, '95');
  await press(element, 'start');
  return element;
}

/**
 * A session with a back-off last, built by hand through the core.
 *
 * Its own identifier prefix on purpose. {@link mountToolOver} counts from `id-1` and
 * goes on counting after this session is loaded, so a seed sharing that sequence would
 * hand a duplicated set the identifier of a row already on screen.
 */
function aBackoffSession(): WorkoutSession {
  let next = 0;
  const nextId = (): LogbookId => {
    next += 1;
    return `seed-${String(next)}`;
  };
  const at = (instant: Instant): SessionContext => ({ nextId, at: instant });
  let session = createWorkout(at(AT_START), { localDate: ON_DAY, title: 'Squat day' });
  session = addExercise(session, at(AT_START), {
    exerciseId: SQUAT.id,
    displayName: SQUAT.name,
    loading: SQUAT.loading,
    plan: [
      { kind: 'working' as const, performance: lifted(225, 5) },
      { kind: 'backoff' as const, performance: lifted(185, 8) },
    ],
  });
  return startWorkout(session, at(AT_START));
}

/** Opens the editor on one row, which is where three of the four controls live. */
async function openEditorOn(element: PtkTrainingLogbook, index: number): Promise<void> {
  await pressIn(element, setRow(element, index), controlFor('edit'));
}

/** Opens the first row's editor and takes that row out. */
async function removeFirstRow(element: PtkTrainingLogbook): Promise<void> {
  await openEditorOn(element, 0);
  await pressIn(element, setRow(element, 0), controlFor('remove-set'));
}

/** Corrects one row's weight through the editor already open on it, and saves. */
async function correctWeight(
  element: PtkTrainingLogbook,
  index: number,
  value: string,
): Promise<void> {
  const input = numberBox(setRow(element, index), DONE_WEIGHT_FIELD);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
  await pressIn(element, setRow(element, index), controlFor('save-edit'));
}

function controlFor(action: string): string {
  return `[data-action="${action}"]`;
}

/** Add is the one control of the four that belongs to the lift rather than to a row. */
function addSetControl(): string {
  return controlFor('add-set');
}

/** What each row says it is planned as, in row order. */
function rowPlans(element: Element): string[] {
  return deepAll(shadow(element), 'span.set-plan').map((span) => span.textContent.trim());
}

/**
 * The kind of each row, off the attribute rather than off the word beside it.
 *
 * `data-kind` is the machine-readable half of the same answer and it is what a copier
 * that ignored the row it landed after would get wrong -- the word would be wrong too,
 * but through one more layer of lookup table.
 */
function rowKinds(element: Element): (string | null)[] {
  return setRows(element).map((row) => row.getAttribute('data-kind'));
}

/** Which rows have been answered, ticked or skipped alike. */
function doneRows(element: Element): boolean[] {
  return setRows(element).map((row) => row.classList.contains('done'));
}

/** Which of section 7.7's three the editor on a row is offering. */
function structureControls(row: HTMLElement): string[] {
  return deepAll(row, '.structure [data-action]').map(
    (host) => host.getAttribute('data-action') ?? '',
  );
}

/** The row whose editor is open, or -1 where none is. */
function openEditor(element: Element): number {
  return setRows(element).findIndex((row) => row.querySelector('.editor') !== null);
}

/**
 * Types a note and stops there, inside the debounce.
 *
 * Deliberately no {@link settle}: waiting for the save line would wait out the delay
 * and write the note, which is the one thing the case using this needs not to happen.
 */
async function draftNote(element: PtkTrainingLogbook, key: string, text: string): Promise<void> {
  const field = noteField(element, key);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** The same store, keeping a tally of how many times a workout went into it. */
function counted(store: LogbookStore): { store: LogbookStore; writes: () => number } {
  let writes = 0;
  return {
    store: {
      ...store,
      writeWorkout: async (workout, active): Promise<void> => {
        writes += 1;
        await store.writeWorkout(workout, active);
      },
    },
    writes: () => writes,
  };
}

/**
 * Asks the root for a change the way a consumer could, rather than the way a press does.
 *
 * The event is public (section 12.3), so nothing stops a page dispatching one naming a
 * row that has already gone. Straight at the root because that is where the listener
 * is; going through a control could only ever name a row that is on screen.
 */
function askFor(element: PtkTrainingLogbook, change: SetPlanChange): void {
  element.dispatchEvent(
    new CustomEvent<SetPlanChangedDetail>(SET_PLAN_EVENT, { detail: { change } }),
  );
}

/** The one session in a database, or a failure rather than an assertion against nothing. */
async function written(store: LogbookStore): Promise<WorkoutSession> {
  const first = (await store.readWorkouts())[0];
  if (first === undefined) throw new Error('Nothing has been written to this database.');
  return first;
}

/**
 * The whole tool over a store that keeps a session and reports itself durable.
 *
 * Durable so the save line settles on a phrase `settle()` can wait for, and in memory
 * rather than IndexedDB because nothing in this file is a claim about persistence --
 * `ptk-training-logbook.browser.test.ts` makes those, against a real database.
 */
async function mountTool(settings: Partial<LogbookSettings>): Promise<PtkTrainingLogbook> {
  return mountToolOver(await aStore(settings));
}

/** That store on its own, for the two cases that seed it or read it back. */
async function aStore(settings: Partial<LogbookSettings>): Promise<LogbookStore> {
  const store: LogbookStore = { ...memoryLogbookStore(), durable: true };
  await store.writeSettings({ ...defaultSettings(), ...settings });
  return store;
}

async function mountToolOver(store: LogbookStore): Promise<PtkTrainingLogbook> {
  const element = document.createElement('ptk-training-logbook');
  let next = 0;
  element.repository = createRepository(store, {
    now: () => AT_START,
    applicationVersion: VERSION,
  });
  element.today = TODAY;
  element.now = (): Instant => AT_START;
  element.nextId = (): LogbookId => {
    next += 1;
    return `id-${String(next)}`;
  };
  element.applicationVersion = VERSION;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });

  // The first read is asynchronous and `updateComplete` says nothing about it. The
  // storage line is what that read sets, so waiting for the line is waiting for the load.
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(shadow(element).querySelector('.save')).not.toBeNull();
  });
  return element;
}

async function press(element: PtkTrainingLogbook, action: string): Promise<void> {
  const control = deepAll(shadow(element), `[data-action="${action}"]`)[0];
  if (control === undefined) throw new Error(`This screen has no "${action}" control.`);
  const button = shadow(control).querySelector('button');
  if (button === null) throw new Error(`The "${action}" control has no button in it.`);
  button.click();
  await settle(element);
}

/**
 * The same press, aimed at one part of the screen.
 *
 * {@link press} takes the first control with a name anywhere on the tool, which is
 * right while every name is unique. Section 7.7 puts an Add under every lift and three
 * more controls in every open editor, so most of the cases below have to say which one.
 */
async function pressIn(
  element: PtkTrainingLogbook,
  root: DocumentFragment | HTMLElement,
  selector: string,
): Promise<void> {
  const host = deepAll(root, selector)[0];
  if (host === undefined) throw new Error(`There is no ${selector} here.`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`${selector} has no button in it.`);
  button.click();
  await settle(element);
}

/** Types into the builder's weight box the way a keyboard does. */
async function type(element: PtkTrainingLogbook, value: string): Promise<void> {
  await typeWeight(element, 0, value);
}

/** The same, where more than one lift is on the builder and the row matters. */
async function typeWeight(
  element: PtkTrainingLogbook,
  index: number,
  value: string,
): Promise<void> {
  const wrapper = deepAll(shadow(element), '[data-field="weight"]')[index];
  if (wrapper === undefined) throw new Error('This screen has no weight field.');
  const input = wrapper.querySelector('ptk-number-field')?.shadowRoot?.querySelector('input');
  if (input === undefined || input === null) throw new Error('The weight field has no box.');
  input.value = value;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`, so a test
  // dispatching only `change` moves nothing and then asserts against the screen it
  // started with.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(element);
}

async function settle(element: PtkTrainingLogbook): Promise<void> {
  await element.updateComplete;
  await vi.waitFor(async () => {
    await element.updateComplete;
    const line = (shadow(element).querySelector('.save')?.textContent ?? '').trim();
    expect(line).not.toBe(SAVE_STATES.unsaved);
  });
}
