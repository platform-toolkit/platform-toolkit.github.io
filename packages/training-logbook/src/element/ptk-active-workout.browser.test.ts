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
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// diagram renders with no plate colours and the accessibility pass measures a screen
// that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { findExercise } from '../core/catalog.js';
import { AT_START, ON_DAY, contextSeries } from '../core/context.fixture.js';
import { addExercise, createWorkout, performance, startWorkout } from '../core/session.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository, defaultSettings } from '../storage/repository.js';
import type {
  CalendarDay,
  EquipmentSnapshot,
  ExerciseOption,
  Instant,
  LogbookId,
  WorkoutSession,
} from '../types.js';

import { LOADING_NOTES, SAVE_STATES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import type { PtkActiveWorkout } from './ptk-active-workout.js';
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

interface MountOptions {
  readonly session: WorkoutSession;
  readonly equipment?: EquipmentSnapshot | null;
  readonly unit?: 'kg' | 'lb';
}

async function mount(options: MountOptions): Promise<PtkActiveWorkout> {
  const element = document.createElement('ptk-active-workout');
  element.session = options.session;
  element.equipment = options.equipment ?? null;
  element.unit = options.unit ?? 'lb';
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

/** Every sentence under a diagram, in row order. */
function notes(element: Element): string[] {
  return deepAll(shadow(element), '.loading-note').map((note) => note.textContent.trim());
}

const SQUAT = catalogExercise('squat');
const CHIN_UP = catalogExercise('chin-up');

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

describe('the rack the tool hands down', () => {
  it('reaches the logging screen from the settings the repository loaded', async () => {
    const element = await mountTool(aPoundGym());

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
    const element = await mountTool(null);

    await press(element, 'start-workout');
    await press(element, 'add-primary');
    await type(element, '135');
    await press(element, 'start');

    expect(deepAll(shadow(element), 'ptk-plate-stack')).toHaveLength(0);
  });
});

/**
 * The whole tool over a store that keeps a session and reports itself durable.
 *
 * Durable so the save line settles on a phrase `settle()` can wait for, and in memory
 * rather than IndexedDB because nothing in this file is a claim about persistence --
 * `ptk-training-logbook.browser.test.ts` makes those, against a real database.
 */
async function mountTool(equipment: EquipmentSnapshot | null): Promise<PtkTrainingLogbook> {
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

/** Types into the builder's weight box the way a keyboard does. */
async function type(element: PtkTrainingLogbook, value: string): Promise<void> {
  const wrapper = deepAll(shadow(element), '[data-field="weight"]')[0];
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
