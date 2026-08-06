// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The warm-up tick on the planning screen, in a real browser.
 *
 * `plan.test.ts` already pins what `readPlan` does with a ticked row, and
 * `core/warmup.test.ts` owns the ramp itself. What is left is everything between those
 * two answers and a lifter's thumb, and all of it fails quietly: a tick offered where
 * no ramp could be built, a tick withheld from a lift that has one, a refusal painted
 * on the wrong box, a note explaining a control that is on the screen -- and, the one
 * no leaf test can see, a root that reads the rack and forgets to hand it down.
 *
 * WHY THE LAST TWO CASES MOUNT THE WHOLE TOOL
 *
 * `.equipment=${this.settings.equipment}` on one line of `ptk-training-logbook`'s build
 * screen is the entire wiring, and dropping it type-checks, lints, renders and passes
 * every case above. The tool would simply never offer a warm-up to anybody -- which is
 * exactly what it correctly does before a lifter has chosen a rack, so nothing about
 * the screen looks wrong. Only a case that goes through the equipment the repository
 * loaded can tell the two apart, and only the pair can: the first proves the binding
 * exists, and the second, with the rack left null, proves it is not hard-wired to a
 * gym the tool invented. `ptk-active-workout.browser.test.ts` ends the same way, for
 * the same line one screen over.
 *
 * Every weight, bar and plate here is invented (section 5.1).
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// controls render with no tap-target floor and the accessibility pass measures a screen
// that never ships.
import '@platform-toolkit/ui/tokens.css';
import type { WeightUnit } from '@platform-toolkit/domain';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AT_START, ON_DAY } from '../core/context.fixture.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository, defaultSettings } from '../storage/repository.js';
import type {
  CalendarDay,
  EquipmentSnapshot,
  Instant,
  LogbookId,
  WorkoutSession,
} from '../types.js';

import { BUILDER_NOTES, SAVE_STATES, SET_KINDS } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import { planProblem } from './plan.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';
import {
  WORKOUT_PLANNED_EVENT,
  type PtkWorkoutBuilder,
  type WorkoutPlannedDetail,
} from './ptk-workout-builder.js';

const TODAY: CalendarDay = ON_DAY;
const VERSION = '0.0.0-test';

/** The invented top set every case here works up to, in the tool's own unit. */
const WORKING_WEIGHT = '135';

/**
 * A movement with a weight box and no ramp behind it.
 *
 * A machine rather than a chin-up on purpose. `canGenerateWarmup` is two conditions,
 * and a bodyweight movement fails both -- so a screen that had quietly dropped the
 * loading half of the test would still withhold the tick from a chin-up and look
 * right. A lat pulldown has a weight to work up to and no bar to work up on.
 */
const UNRAMPED_EXERCISE = 'lat-pulldown';

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
 * Loadable in fives from an empty bar, which is all the ramp asks of it: what these
 * cases are about is whether a rack reaches the screen at all, and a rack that could
 * not build the rungs would fail them for a reason `core/warmup.test.ts` owns.
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
      { weight: 2.5, pairs: null, fullDiameter: false },
    ],
  };
}

interface MountOptions {
  readonly equipment?: EquipmentSnapshot | null;
  readonly unit?: WeightUnit;
}

async function mount(options: MountOptions = {}): Promise<PtkWorkoutBuilder> {
  const element = document.createElement('ptk-workout-builder');
  element.today = TODAY;
  element.unit = options.unit ?? 'lb';
  element.equipment = options.equipment ?? null;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  // The element's own promise, which it overrides to await the fields inside it. A
  // test reading a control off the host's default promise reads it before it exists.
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

function one(root: DocumentFragment | HTMLElement, selector: string): HTMLElement {
  const found = deepAll(root, selector)[0];
  if (found === undefined) throw new Error(`Nothing on this screen matches "${selector}".`);
  return found;
}

/**
 * Presses a control the way a thumb does.
 *
 * The inner `<button>` and not the host: a click dispatched at the host is dispatched
 * by the test rather than by the platform, so it sails straight past a `disabled`
 * control and asserts against a screen the lifter could not have produced.
 */
function click(host: HTMLElement): void {
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  button.click();
}

async function press(element: PtkWorkoutBuilder, action: string): Promise<void> {
  click(one(shadow(element), `[data-action="${action}"]`));
  await element.updateComplete;
}

/** Adds one of section 6.1's four with a single tap, as the screen intends. */
async function addPrimary(element: PtkWorkoutBuilder, id: string): Promise<void> {
  click(one(shadow(element), `[data-action="add-primary"][data-exercise="${id}"]`));
  await element.updateComplete;
}

/** Adds anything else, through the picker and its explicit Add button. */
async function addFromPicker(element: PtkWorkoutBuilder, id: string): Promise<void> {
  const host = one(shadow(element), 'ptk-select');
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error('The picker has no list to choose from.');
  select.value = id;
  // `change` and not `input`: a native select reports on change, which is the event
  // `ptk-select` listens for. See the note in `packages/ui/CLAUDE.md` about driving
  // a picker and a tile group with the same helper.
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
  await press(element, 'add-picked');
}

/** The planned rows, in the order they are shown. */
function rows(element: PtkWorkoutBuilder): HTMLElement[] {
  return deepAll(shadow(element), 'li[data-row]');
}

function row(element: PtkWorkoutBuilder, index: number): HTMLElement {
  const found = rows(element)[index];
  if (found === undefined) throw new Error(`There is no row ${String(index + 1)} on this screen.`);
  return found;
}

/** Every warm-up tick on the screen, whichever row it is on. */
function ticks(element: PtkWorkoutBuilder): HTMLElement[] {
  return deepAll(shadow(element), 'div[data-field="warmup"]');
}

/**
 * Ticks the warm-up box on a row.
 *
 * Reached through `[data-value="warmup"]`, which `ptk-toggle-group` writes onto the
 * option's label precisely because the value is a property and no selector can see it.
 * The alternative is the option's position, in a group that is one long today.
 */
async function tickWarmup(element: PtkWorkoutBuilder, index: number): Promise<void> {
  const option = one(row(element, index), '[data-value="warmup"]');
  const box = option.querySelector('input');
  if (box === null) throw new Error('The warm-up tick has no box to tick.');
  box.click();
  await element.updateComplete;
}

/** The number field inside a row's wrapper for one named field. */
function field(within: HTMLElement, name: string): HTMLElement {
  const wrapper = one(within, `[data-field="${name}"]`);
  // Two steps rather than one compound selector: a compound `querySelector` types as
  // `Element` and would need the cast section 2.4 forbids.
  const found = wrapper.querySelector('ptk-number-field');
  if (found === null) throw new Error(`The "${name}" wrapper holds no number field.`);
  return found;
}

/** Types into a number field the way a keyboard does. */
async function type(element: PtkWorkoutBuilder, host: HTMLElement, value: string): Promise<void> {
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error(`<${host.localName}> has no box to type in.`);
  input.value = value;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`, so a
  // test dispatching only `change` moves nothing and then asserts against the screen
  // it started with.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

/** Every sentence the screen is saying, exactly as it says it. */
function notes(element: PtkWorkoutBuilder): string[] {
  return [...shadow(element).querySelectorAll('p.note')].map((note) => note.textContent.trim());
}

/** Every plan the screen has handed up, in the order it handed them up. */
function planned(element: PtkWorkoutBuilder): WorkoutPlannedDetail[] {
  const seen: WorkoutPlannedDetail[] = [];
  element.addEventListener(WORKOUT_PLANNED_EVENT, (event) => {
    seen.push(event.detail);
  });
  return seen;
}

describe('the warm-up tick on a plan row', () => {
  it('is not drawn before a rack has been chosen, even for a barbell lift', async () => {
    // The state a logbook is in on day one: `settings.equipment` stays null until a
    // lifter answers the equipment section. A ramp is plates on a bar, so a tick here
    // would be a control that reads as available and composes nothing.
    const element = await mount({ equipment: null });
    await addPrimary(element, 'squat');

    expect(ticks(element)).toHaveLength(0);
  });

  it('is not drawn for a movement the calculator has no ramp for, rack or no rack', async () => {
    const element = await mount({ equipment: aPoundGym() });
    await addFromPicker(element, UNRAMPED_EXERCISE);

    // The weight box is there, which is what makes this worth a case of its own: the
    // row looks exactly like a barbell row minus the one control.
    expect(field(row(element, 0), 'weight')).not.toBeNull();
    expect(ticks(element)).toHaveLength(0);
  });

  it('is drawn with both, and a ticked row asks for a ramp when the plan is read', async () => {
    const element = await mount({ equipment: aPoundGym() });
    const plans = planned(element);
    await addPrimary(element, 'squat');
    await type(element, field(row(element, 0), 'weight'), WORKING_WEIGHT);

    expect(ticks(element)).toHaveLength(1);

    // Read once untouched and once ticked, from the same screen. Without the first
    // read this passes against a builder that asks for a ramp on every row.
    await press(element, 'start');
    await tickWarmup(element, 0);
    await press(element, 'start');

    expect(plans.map((plan) => plan.exercises[0]?.warmup)).toEqual([false, true]);
    expect(plans[1]?.exercises[0]?.weight).toStrictEqual({ amount: 135, unit: 'lb' });
  });
});

describe('a warm-up asked for with no weight to work up to', () => {
  it('refuses the plan and says so under the empty box', async () => {
    // The weight box is optional everywhere else, which is the whole reason this is
    // refused rather than ignored: a ramp has nothing to work up to, and a session
    // that started anyway would drop the warm-up silently, one screen later.
    const element = await mount({ equipment: aPoundGym() });
    const plans = planned(element);
    await addPrimary(element, 'squat');
    await tickWarmup(element, 0);

    await press(element, 'start');

    expect(plans).toHaveLength(0);
    // Against the weight field and not against the tick. The box is the thing to fill
    // in, and a lifter who wanted the ramp does not want to be talked out of it.
    expect(field(row(element, 0), 'weight').getAttribute('error')).toBe(
      planProblem({ row: 0, field: 'weight', code: 'warmup-needs-weight' }),
    );
  });

  it('lets the plan through once the weight is filled in', async () => {
    const element = await mount({ equipment: aPoundGym() });
    const plans = planned(element);
    await addPrimary(element, 'squat');
    await tickWarmup(element, 0);
    await press(element, 'start');

    await type(element, field(row(element, 0), 'weight'), WORKING_WEIGHT);

    // The complaint goes on the edit rather than on the next press, so the message is
    // not still sitting under a box that has just been answered.
    expect(field(row(element, 0), 'weight').getAttribute('error')).toBe('');

    await press(element, 'start');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.exercises[0]?.warmup).toBe(true);
  });
});

/**
 * One sentence for the screen, never one per row.
 *
 * A lifter with no rack would otherwise read the same line under every barbell lift
 * they add, and eight copies of a sentence is how a note stops being read.
 */
describe('why the tick is missing', () => {
  it('says nothing at all before an exercise has been added', async () => {
    const element = await mount({ equipment: null });

    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNeedsRack);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNotEveryLift);
  });

  it('names the rack, and the screen that sets one up, when that is what is missing', async () => {
    const element = await mount({ equipment: null });
    await addPrimary(element, 'squat');

    expect(notes(element)).toContain(BUILDER_NOTES.warmupNeedsRack);
  });

  it('names the rack rather than the lift on a mixed list with no rack', async () => {
    // Ordered so the sentence naming an action comes first. Being told that a lat
    // pulldown has no ramp is true and gets a lifter with no rack nowhere.
    const element = await mount({ equipment: null });
    await addPrimary(element, 'squat');
    await addFromPicker(element, UNRAMPED_EXERCISE);

    expect(notes(element)).toContain(BUILDER_NOTES.warmupNeedsRack);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNotEveryLift);
  });

  it('names the lift, not the rack, where no row could be ramped anyway', async () => {
    const element = await mount({ equipment: null });
    await addFromPicker(element, UNRAMPED_EXERCISE);

    // Sending this lifter to the equipment screen would buy them nothing: a rack
    // changes nothing about a machine.
    expect(notes(element)).toContain(BUILDER_NOTES.warmupNotEveryLift);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNeedsRack);
  });

  it('names the lift once a rack exists and only some rows can use it', async () => {
    const element = await mount({ equipment: aPoundGym() });
    await addPrimary(element, 'squat');
    await addFromPicker(element, UNRAMPED_EXERCISE);

    expect(ticks(element)).toHaveLength(1);
    expect(notes(element)).toContain(BUILDER_NOTES.warmupNotEveryLift);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNeedsRack);
  });

  it('says nothing where every row has the tick', async () => {
    // The tick and its own description are the whole explanation then, and a note
    // repeating them is a sentence that trains a lifter to skip the next one.
    const element = await mount({ equipment: aPoundGym() });
    await addPrimary(element, 'squat');
    await addPrimary(element, 'bench-press');

    expect(ticks(element)).toHaveLength(2);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNeedsRack);
    expect(notes(element)).not.toContain(BUILDER_NOTES.warmupNotEveryLift);
  });
});

describe('the tick in the page', () => {
  it('has no accessibility violations', async () => {
    const element = await mount({ equipment: aPoundGym() });
    await addPrimary(element, 'squat');
    await tickWarmup(element, 0);

    // Contrast is off for the same reason as everywhere else in this package: the
    // element is measured outside the page's own background, so the engine compares a
    // token against whatever the harness painted behind it.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('the rack the tool hands down', () => {
  it('reaches the planning screen from the settings the repository loaded', async () => {
    const { element, store } = await mountTool(aPoundGym());

    await pressTool(element, 'start-workout');
    await pressTool(element, 'add-primary'); // The first of section 6.1's four is the squat.
    await typeTool(element, WORKING_WEIGHT);
    await tickTool(element);
    await pressTool(element, 'start');

    // Rows above the working sets, in the tool's own vocabulary. Section 8.1: nothing
    // the lifter typed produces these, so they can only have come from the engine the
    // rack was handed to.
    expect(warmupRows(element).length).toBeGreaterThan(0);
    expect(warmupSetsOf(await started(store))).not.toHaveLength(0);
  });

  it('offers nothing where the lifter has never chosen a rack', async () => {
    // The same journey with `equipment` left at its default. Both halves are needed:
    // the first proves the binding exists, and without this one a binding hard-wired
    // to a rack the tool invented would pass it.
    const { element, store } = await mountTool(null);

    await pressTool(element, 'start-workout');
    await pressTool(element, 'add-primary');
    await typeTool(element, WORKING_WEIGHT);

    expect(deepAll(shadow(element), '[data-value="warmup"]')).toHaveLength(0);

    await pressTool(element, 'start');

    expect(warmupRows(element)).toHaveLength(0);
    expect(warmupSetsOf(await started(store))).toHaveLength(0);
  });
});

/**
 * The whole tool over a store that keeps a session and reports itself durable.
 *
 * Durable so the save line settles on a phrase `settleTool()` can wait for, and in
 * memory rather than IndexedDB because nothing in this file is a claim about
 * persistence -- `ptk-training-logbook.browser.test.ts` makes those, against a real
 * database. Its own store per case, or one case's workout leaks into the next.
 */
async function mountTool(
  equipment: EquipmentSnapshot | null,
): Promise<{ element: PtkTrainingLogbook; store: LogbookStore }> {
  const store: LogbookStore = { ...memoryLogbookStore(), durable: true };
  await store.writeSettings({ ...defaultSettings(), equipment });

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
  // storage line is what that read sets, so waiting for the line is waiting for the
  // load -- and a builder driven before it would be a builder with no rack yet.
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(shadow(element).querySelector('.save')).not.toBeNull();
  });
  return { element, store };
}

async function pressTool(element: PtkTrainingLogbook, action: string): Promise<void> {
  click(one(shadow(element), `[data-action="${action}"]`));
  await settleTool(element);
}

/** Types into the builder's weight box the way a keyboard does. */
async function typeTool(element: PtkTrainingLogbook, value: string): Promise<void> {
  const wrapper = one(shadow(element), '[data-field="weight"]');
  const host = wrapper.querySelector('ptk-number-field');
  if (host === null) throw new Error('The weight field holds no number field.');
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error('The weight field has no box to type in.');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settleTool(element);
}

async function tickTool(element: PtkTrainingLogbook): Promise<void> {
  const option = one(shadow(element), '[data-value="warmup"]');
  const box = option.querySelector('input');
  if (box === null) throw new Error('The warm-up tick has no box to tick.');
  box.click();
  await settleTool(element);
}

async function settleTool(element: PtkTrainingLogbook): Promise<void> {
  await element.updateComplete;
  await vi.waitFor(async () => {
    await element.updateComplete;
    const line = (shadow(element).querySelector('.save')?.textContent ?? '').trim();
    expect(line).not.toBe(SAVE_STATES.unsaved);
  });
}

/** The set rows the logging screen labels as warm-ups. */
function warmupRows(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(element), '.set-kind').filter(
    (label) => label.textContent.trim() === SET_KINDS.warmup,
  );
}

/** The session the tool wrote, which is the only one a fresh store holds. */
async function started(store: LogbookStore): Promise<WorkoutSession> {
  const [session] = await store.readWorkouts();
  if (session === undefined) throw new Error('The tool wrote no session at all.');
  return session;
}

function warmupSetsOf(session: WorkoutSession): readonly unknown[] {
  return session.exercises.flatMap((exercise) =>
    exercise.sets.filter((set) => set.kind === 'warmup'),
  );
}
