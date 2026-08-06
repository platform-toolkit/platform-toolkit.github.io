// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, driven the way a lifter drives it, in a real browser.
 *
 * Every other suite in this package proves a function against a fixture. This one
 * proves the wiring: four custom elements in four shadow roots, joined by composed
 * events and a repository, and nothing else. Tool 5 is the reason it exists -- every
 * fixture in that tool's directory drove the *document*, so nothing drove the *tool*
 * until a root-level test played a whole meet through the elements, and the first time
 * one did it found three of nine attempts with no control to move them onto the
 * platform. Each of those elements passed its own tests.
 *
 * WHY THE DATA-LOSS JOURNEY USES A REAL DATABASE
 *
 * Section 18.9 is an acceptance test written in prose: a completed set that showed
 * **Saved on this device** must still be there after an immediate refresh. The
 * in-memory store reports `durable: false`, which is an honest answer and the wrong one
 * to make that promise against -- `#persist` returns early for a non-durable
 * repository, so a suite built on it would assert its way through a journey in which
 * nothing was ever written. So the journey below opens IndexedDB, ticks a set, throws
 * the element and its connection away, and opens the database again from nothing.
 * Anything less proves that a property was set.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 *
 * No arithmetic. `session.test.ts` owns what `completeSet` does to a set and
 * `summary.test.ts` owns how a workout is counted; repeating either here would be the
 * same claim made twice, once through eight layers of DOM. What is asserted is that a
 * tap in one shadow root changes what another shadow root prints and what the database
 * holds afterwards -- the failure no unit test in this package can see, and the one
 * that leaves every control on the screen visibly responding and nothing recorded.
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// screen renders with no padding, no gaps and no tap-target floor -- a layout that never
// ships, and one that would pass and fail for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import { formatWeight } from '@platform-toolkit/domain';
import axe from 'axe-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_EXERCISES, findExercise } from '../core/catalog.js';
import { AT_LATER, AT_START, ON_DAY } from '../core/context.fixture.js';
import { createHandoff } from '../core/handoff.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
  type SessionContext,
} from '../core/session.js';
import type { HandoffSource } from '../handoff.js';
import { indexedDbLogbookStore } from '../storage/indexed-db.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository, defaultSettings } from '../storage/repository.js';
import type {
  CalendarDay,
  EquipmentSnapshot,
  ExerciseOption,
  HandoffExercise,
  Instant,
  LogbookId,
  WarmupHandoff,
} from '../types.js';

import {
  ACTIVE_NOTES,
  BUILDER_NOTES,
  DONE_NOTES,
  FINISH_DISPOSITIONS,
  HANDOFF_NOTES,
  HISTORY_NOTES,
  HOME_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  UNIT_LABELS,
} from './copy.js';
import {
  BACKUP_EXPORTED_EVENT,
  SET_COMPLETED_EVENT,
  WORKOUT_COMPLETED_EVENT,
  WORKOUT_SAVED_EVENT,
  WORKOUT_STARTED_EVENT,
} from './events.js';
import { NOT_SET } from './format.js';
import { defineTrainingLogbook } from './index.js';
import { planProblem } from './plan.js';
import { WORKOUT_CHANGED_EVENT } from './ptk-active-workout.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';

/** The lifter's own day. Invented, and the same one the core fixtures use. */
const TODAY: CalendarDay = ON_DAY;

const VERSION = '0.0.0-test';

/** The unit an untouched logbook is in, and therefore what these screens print. */
const UNIT = 'lb';

/**
 * The clock the element and the repository both read.
 *
 * Mutable, because a duration assertion is otherwise a test that waits twenty real
 * minutes or a test that does not assert on a duration.
 */
let clock: Instant = AT_START;

const teardown: (() => void | Promise<void>)[] = [];

/** A database per case. Sharing one would make the suite order-dependent. */
let databases = 0;

beforeAll(() => {
  defineTrainingLogbook();
});

beforeEach(() => {
  clock = AT_START;
});

afterEach(async () => {
  for (const dispose of teardown.splice(0).reverse()) {
    await dispose();
  }
});

/**
 * A real IndexedDB store, under a name nothing else in the run uses.
 *
 * The name comes back as well as the store, because the data-loss journey has to open
 * the same database a second time after throwing the first connection away. A shared
 * name would also leave a connection open across cases, so an upgrade in a later one
 * would land on `onblocked`.
 */
async function durableStore(): Promise<{ store: LogbookStore; databaseName: string }> {
  databases += 1;
  const databaseName = `ptk-logbook-element-test-${String(databases)}`;
  const store = await indexedDbLogbookStore({ databaseName });
  if (store === null) {
    throw new Error('This browser gave the test no IndexedDB, so section 18.9 is untestable.');
  }
  teardown.push(() => {
    store.close();
    indexedDB.deleteDatabase(databaseName);
  });
  return { store, databaseName };
}

/** The same database again, as a page that has just been reloaded would find it. */
async function reopen(databaseName: string): Promise<LogbookStore> {
  const store = await indexedDbLogbookStore({ databaseName });
  if (store === null) throw new Error('The database that existed a moment ago is gone.');
  teardown.push(() => {
    store.close();
  });
  return store;
}

async function mount(store: LogbookStore, handoff?: HandoffSource): Promise<PtkTrainingLogbook> {
  const element = document.createElement('ptk-training-logbook');
  let next = 0;
  element.repository = createRepository(store, {
    now: () => clock,
    applicationVersion: VERSION,
  });
  element.handoff = handoff ?? null;
  element.today = TODAY;
  element.now = (): Instant => clock;
  // Sequential rather than random: a failing assertion naming `id-4` can be traced to
  // the fourth object the run created, and one naming a UUID cannot.
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
  // load -- and a test that skipped this would drive a screen still showing an empty
  // logbook and a resumable workout that had not arrived yet.
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(shadow(element).querySelector('.save')).not.toBeNull();
  });
  return element;
}

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/**
 * Everything the tool has drawn, across every shadow root under it.
 *
 * `textContent` on the host would return the light DOM, which for this element is
 * empty -- the whole tool is inside shadow roots, so a naive read asserts on nothing
 * and passes.
 */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  visit(shadow(element));
  return parts.join(' ');
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

/** The one control carrying an action, or a failure naming the action nobody drew. */
function control(root: DocumentFragment | HTMLElement, action: string): HTMLElement {
  const first = deepAll(root, `[data-action="${action}"]`)[0];
  if (first === undefined) throw new Error(`Nothing on this screen does "${action}".`);
  return first;
}

/** The native button inside a `ptk-button`, which is the thing a thumb hits. */
function nativeButton(host: HTMLElement): HTMLButtonElement {
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  return button;
}

/**
 * Presses a control and waits for the screen to settle.
 *
 * The inner `<button>` and not the host: a click dispatched at the host is dispatched
 * by the test rather than by the platform, so it sails straight past a `disabled`
 * control and asserts against a screen the lifter could not have produced.
 */
async function press(
  element: PtkTrainingLogbook,
  action: string,
  within: DocumentFragment | HTMLElement = shadow(element),
): Promise<void> {
  nativeButton(control(within, action)).click();
  await settle(element);
}

/**
 * Waits for the tool to stop saying it is mid-save.
 *
 * Every write is started from an event handler and awaited nowhere the test can see,
 * so `updateComplete` resolves on the render *before* the database answers. The storage
 * line is the tool's own report of that write, which makes waiting for it to leave
 * "Saving" exactly the thing section 18.9 is about, and not a sleep.
 */
async function settle(element: PtkTrainingLogbook): Promise<void> {
  await element.updateComplete;
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(saveLine(element)).not.toBe(SAVE_STATES.unsaved);
  });
}

/** What the storage line says, with the template's own whitespace taken off. */
function saveLine(element: PtkTrainingLogbook): string {
  return (shadow(element).querySelector('.save')?.textContent ?? '').trim();
}

/** The number field inside the wrapper carrying a field name. */
function field(root: DocumentFragment | HTMLElement, name: string): HTMLElement {
  const wrapper = deepAll(root, `[data-field="${name}"]`)[0];
  if (wrapper === undefined) throw new Error(`This screen has no "${name}" field.`);
  // Two steps rather than one compound selector: a compound `querySelector` types as
  // `Element` and would need the cast section 2.4 forbids.
  const found = wrapper.querySelector('ptk-number-field');
  if (found === null) throw new Error(`The "${name}" wrapper holds no number field.`);
  return found;
}

/** Types into a number field the way a keyboard does. */
async function type(element: PtkTrainingLogbook, host: HTMLElement, value: string): Promise<void> {
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error(`<${host.localName}> has no box to type in.`);
  input.value = value;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`, so a
  // test dispatching only `change` moves nothing and then asserts against the screen it
  // started with.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(element);
}

/** Answers a radio-backed control by clicking a tile, which is how a lifter answers. */
async function choose(element: PtkTrainingLogbook, tag: string, value: string): Promise<void> {
  const group = deepAll(shadow(element), tag)[0];
  if (group === undefined) throw new Error(`No <${tag}> on this screen.`);
  const radio = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === value,
  );
  if (radio === undefined) throw new Error(`No "${value}" to choose in <${tag}>.`);
  radio.click();
  await settle(element);
}

/** The logging screen's set rows, in the order they are shown. */
function setRows(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(element), 'li[data-set]');
}

function setRow(element: PtkTrainingLogbook, index: number): HTMLElement {
  const row = setRows(element)[index];
  if (row === undefined) throw new Error(`There is no set ${String(index + 1)} on this screen.`);
  return row;
}

/** Whether a row is showing an Undo, which is what a done set looks like. */
function isDone(row: HTMLElement): boolean {
  return deepAll(row, '[data-action="undo"]').length > 0;
}

/**
 * Plans a squat session at an invented 100 and starts it, through the controls.
 *
 * Through the controls and not by setting a property: the path between the builder's
 * shadow root and the logging screen's is what this whole suite is for, and a harness
 * that assembled a session itself would skip the only thing under test.
 */
async function planASquatSession(element: PtkTrainingLogbook): Promise<void> {
  await press(element, 'start-workout');
  await press(element, 'add-primary'); // The first of section 6.1's four is the squat.
  await type(element, field(shadow(element), 'weight'), '100');
  await press(element, 'start');
}

/*
 * ---------------------------------------------------------------------------
 * A record left by the warm-up calculator. Section 4.3.
 * ---------------------------------------------------------------------------
 */

/**
 * The night before, in kilograms, on a rack nothing defaults to.
 *
 * Both halves are chosen so that a wrong answer cannot pass by resembling a
 * right one: the stamp is on a different calendar day from {@link TODAY}, so a
 * session filed from the record's own instant is visibly not the lifter's day,
 * and the tool's untouched unit is pounds, so a weight printed in kilograms can
 * only have come from the record's rack.
 */
const HANDED_OVER_AT: Instant = '2026-03-09T22:00:00.000Z';

/** Every plate and bar here is invented. Section 5.1. */
function aGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 0, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: true },
      { weight: 5, pairs: null, fullDiameter: false },
      { weight: 2.5, pairs: null, fullDiameter: false },
    ],
  };
}

function anExercise(overrides: Partial<HandoffExercise> = {}): HandoffExercise {
  return {
    exerciseId: 'squat',
    bar: null,
    workingWeight: 100,
    workingSets: 3,
    workingReps: 5,
    adjustments: [],
    ...overrides,
  };
}

function aRecord(
  exercises: readonly HandoffExercise[] = [anExercise()],
  equipment: EquipmentSnapshot = aGym(),
): WarmupHandoff {
  return createHandoff({ equipment, exercises }, HANDED_OVER_AT);
}

/**
 * A reader over one record, counting what the element asked it.
 *
 * The counts are the point of the fake. `peek` goes to storage and parses a
 * document, so the number of times it is called is the difference between a
 * property read once and a render path that re-reads on every keystroke -- and
 * the latter would also answer differently halfway through a session, because
 * another tab can write the key at any moment.
 *
 * It forgets on `clear`, like the real one, so a case that discards an offer and
 * looks again finds nothing rather than finding the record still there.
 */
function aSource(record: WarmupHandoff | null): {
  source: HandoffSource;
  calls: { peeks: number; clears: number };
} {
  const calls = { peeks: 0, clears: 0 };
  let held = record;
  return {
    calls,
    source: {
      peek: () => {
        calls.peeks += 1;
        return held;
      },
      clear: () => {
        calls.clears += 1;
        held = null;
      },
    },
  };
}

/** The lines of the offer card, which is one per lift that would actually land. */
function offerRows(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(element), '.offer li');
}

/*
 * ---------------------------------------------------------------------------
 * A history to read back. Section 7.8.
 * ---------------------------------------------------------------------------
 */

/**
 * The day the seeded session was trained on, and the instant it was written at.
 *
 * A different day from {@link TODAY}, so a line printing the day of the session
 * the lifter is *in* cannot pass as the day of the one they are being reminded of.
 */
const LAST_TIME_DAY: CalendarDay = '2026-03-03';
const LAST_TIME_AT: Instant = '2026-03-03T17:00:00.000Z';

/** What it was lifted for. Invented, and not the 100 every live session here plans. */
const LAST_TIME_WEIGHT = 225;

function catalogExercise(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such catalogue exercise: ${id}`);
  return found;
}

/**
 * A finished session, written straight into the store.
 *
 * Through the store rather than through the controls, for the same reason the rack
 * two cases above is: what is under test is the read on the way back out, and a
 * history assembled by planning and ticking thirty sets would put the builder, the
 * clock and the finish flow between the numbers and the assertion. The session is
 * still built by the core rather than typed out, so it cannot hold a shape
 * `startWorkout` would never produce.
 */
async function seedHistory(store: LogbookStore, exercise: ExerciseOption): Promise<void> {
  let next = 0;
  // Its own prefix rather than the shared `id-N` counter: `mount` hands the element a
  // sequence starting at one as well, and a seeded workout sharing an identifier with
  // the live one is overwritten by that session's first save -- leaving a case that
  // proves the tool says nothing about a history the test deleted.
  const context: SessionContext = {
    at: LAST_TIME_AT,
    nextId: (): LogbookId => {
      next += 1;
      return `last-${String(next)}`;
    },
  };
  let session = createWorkout(context, { localDate: LAST_TIME_DAY });
  session = addExercise(session, context, {
    exerciseId: exercise.id,
    displayName: exercise.name,
    loading: exercise.loading,
    plan: Array.from({ length: 3 }, () => ({
      kind: 'working' as const,
      performance: performance(
        { kind: 'implement', weight: { amount: LAST_TIME_WEIGHT, unit: UNIT } },
        5,
      ),
    })),
  });
  session = startWorkout(session, context);
  // Ticked rather than left planned: only a performed working set of a completed
  // session is a previous performance, and a seeded plan nobody did would leave this
  // whole block asserting that the tool correctly says nothing.
  for (const set of session.exercises.flatMap((exercised) => exercised.sets)) {
    session = completeSet(session, set.id, context);
  }
  await store.writeWorkout(finishWorkout(session, 'leave', context), { kind: 'unchanged' });
}

/**
 * A store that counts the read section 7.8 costs, and the boot read it hides behind.
 *
 * `scanWorkouts` is the subject: `lastPerformance` reaches the history through that
 * method alone, so the count is exactly the number of times the tool went looking for
 * what a lift was last done for.
 *
 * `readProfiles` is the sync point for the other one. Going home restarts the whole
 * boot read, which lands asynchronously and assigns `active` from what it found -- so
 * a session planned before it lands is wiped by an answer taken before it existed.
 * Profiles are read last, after those assignments, which makes this counter the only
 * observable "the boot read is over" the tool offers.
 */
function counting(store: LogbookStore): {
  store: LogbookStore;
  calls: { scans: number; profiles: number };
} {
  const calls = { scans: 0, profiles: 0 };
  return {
    calls,
    store: {
      ...store,
      scanWorkouts: (visit) => {
        calls.scans += 1;
        return store.scanWorkouts(visit);
      },
      readProfiles: () => {
        calls.profiles += 1;
        return store.readProfiles();
      },
    },
  };
}

/** Section 7.8's line, wherever the logging screen has drawn one. */
function previousLines(root: DocumentFragment | HTMLElement): HTMLElement[] {
  return deepAll(root, 'p.previous');
}

/** One card per exercise on the logging screen, in the order they are shown. */
function exerciseCard(element: PtkTrainingLogbook, index: number): HTMLElement {
  const card = deepAll(shadow(element), 'section.exercise')[index];
  if (card === undefined) throw new Error(`There is no exercise ${String(index + 1)} on screen.`);
  return card;
}

/**
 * The line, once the read behind it has landed.
 *
 * `settle` waits for the write the tool reports on and says nothing whatever about
 * this read, which is started in `willUpdate` and awaited nowhere a test can see. It
 * is also the sync point every assertion about an *absent* line needs: waiting for
 * the one line that should be there is the only honest way to know the reads for
 * that session are done.
 */
async function previousLine(element: PtkTrainingLogbook): Promise<string> {
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(previousLines(shadow(element)).length).toBeGreaterThan(0);
  });
  const line = previousLines(shadow(element))[0];
  if (line === undefined) throw new Error('This screen says nothing about last time.');
  return line.textContent.replace(/\s+/g, ' ').trim();
}

/** Adds one of section 6.1's four by name, rather than whichever tile comes first. */
async function addPrimary(element: PtkTrainingLogbook, exerciseId: string): Promise<void> {
  const tile = deepAll(shadow(element), `[data-exercise="${exerciseId}"]`)[0];
  if (tile === undefined) throw new Error(`The builder offers no one-tap "${exerciseId}".`);
  nativeButton(tile).click();
  await settle(element);
}

const SQUAT = catalogExercise('squat');

describe('the training logbook', () => {
  it('opens on a logbook with nothing in it, and says so rather than showing a blank', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    const text = readAll(element);
    expect(text).toContain(HOME_NOTES.historyEmpty);
    // Said before a lifter has a year of training to lose, not after. Section 10.1.
    expect(text).toContain(HOME_NOTES.localOnly);
    expect(saveLine(element)).toBe(SAVE_STATES.saved);
  });

  it('plans a session through the controls and lands on the logging screen', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    await planASquatSession(element);

    // Three rows, because a squat is planned as three sets of five and one tap on the
    // primary button is meant to bring all of that with it. Section 6.1.
    expect(setRows(element).length).toBe(3);
    expect(readAll(element)).toContain(`100 ${UNIT} x 5`);
  });

  /**
   * Section 18.9, as close to the words as a test can get.
   *
   * The element and its database connection are both destroyed between the write and
   * the read, so nothing in the second half can be answered from anything this test is
   * still holding. "Immediate refresh" is the first of the six situations that section
   * lists and the one the other five are variations of: every one comes down to a fresh
   * page having to find the write.
   */
  it('keeps a set that showed Saved on this device across a refresh', async () => {
    const { store, databaseName } = await durableStore();
    const first = await mount(store);
    await planASquatSession(first);

    await press(first, 'complete', setRow(first, 0));

    expect(isDone(setRow(first, 0))).toBe(true);
    expect(saveLine(first)).toBe(SAVE_STATES.saved);

    // The refresh.
    first.remove();
    store.close();

    const second = await mount(await reopen(databaseName));
    expect(readAll(second)).toContain(HOME_NOTES.resumeNote);

    await press(second, 'resume-workout');
    expect(isDone(setRow(second, 0))).toBe(true);
    expect(readAll(second)).toContain(`100 ${UNIT} x 5`);
  });

  it('records the plan as the result on one tap, and takes it back on the next', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await planASquatSession(element);

    await press(element, 'complete', setRow(element, 0));
    expect(isDone(setRow(element, 0))).toBe(true);
    // Nothing on the row says it differs from the plan, because it does not. That is
    // the whole of the one-tap path: the plan becomes the record, unedited.
    expect(readAll(element)).not.toContain(ACTIVE_NOTES.edited);

    await press(element, 'undo', setRow(element, 0));
    expect(isDone(setRow(element, 0))).toBe(false);
  });

  it('records something different from the plan, and marks the row as different', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await planASquatSession(element);

    await press(element, 'edit', setRow(element, 0));
    // Only the reps are retyped. The weight box is seeded with what was planned, so a
    // lifter correcting five to four does not retype a number they did not change.
    await type(element, field(setRow(element, 0), 'done-reps'), '4');
    await press(element, 'save-edit', setRow(element, 0));

    expect(isDone(setRow(element, 0))).toBe(true);
    const text = readAll(element);
    expect(text).toContain(`100 ${UNIT} x 4`);
    // Without this the row reads as a mistake. Section 14.3.
    expect(text).toContain(ACTIVE_NOTES.edited);
  });

  it('will not finish with sets outstanding until the lifter says what became of them', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await planASquatSession(element);
    await press(element, 'complete', setRow(element, 0));

    await press(element, 'finish');

    // Section 7.12 step 2, enforced by the control rather than by a note beside it.
    // Neither answer is preselected, so this button cannot be pressed by somebody who
    // has not read the question.
    expect(nativeButton(control(shadow(element), 'finish-confirm')).disabled).toBe(true);

    await choose(element, 'ptk-choice-group', 'skip');
    expect(nativeButton(control(shadow(element), 'finish-confirm')).disabled).toBe(false);
    expect(readAll(element)).toContain(FINISH_DISPOSITIONS.skip);
  });

  it('finishes a workout, times it, and lists it in the history', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await planASquatSession(element);
    await press(element, 'complete', setRow(element, 0));

    // Twenty invented minutes later. Moved rather than waited for: a duration asserted
    // against a real clock is a test that fails once a month.
    clock = AT_LATER;
    await press(element, 'finish');
    await choose(element, 'ptk-choice-group', 'skip');
    await press(element, 'finish-confirm');

    const done = readAll(element);
    expect(done).toContain(DONE_NOTES.heading);
    expect(done).toContain(DONE_NOTES.durationLabel);
    expect(done).toContain('20 min');

    await press(element, 'home');
    const home = readAll(element);
    expect(home).not.toContain(HOME_NOTES.historyEmpty);
    expect(home).toContain('Squat');
    expect(home).toContain(HISTORY_NOTES.setsLabel);
    // The finished session is no longer offered to carry on with.
    expect(home).not.toContain(HOME_NOTES.resumeNote);
  });

  it('remembers the unit the next session is typed in', async () => {
    const { store, databaseName } = await durableStore();
    const first = await mount(store);

    await choose(first, 'ptk-segmented', 'kg');
    // Awaited through the storage the setting actually went to, and not through the
    // control: a segmented that only moved its own property would satisfy any
    // assertion made against the screen it is on, and lose the answer at the refresh.
    await vi.waitFor(async () => {
      expect((await store.readSettings())?.displayUnit).toBe('kg');
    });

    first.remove();
    store.close();

    const second = await mount(await reopen(databaseName));
    await press(second, 'start-workout');
    await press(second, 'add-primary');

    // Beside the weight box, which is the only place a lifter can read what the number
    // they are about to type will mean.
    const text = readAll(second);
    expect(text).toContain(BUILDER_NOTES.weightLabel);
    expect(text).toContain('kg');
    expect(text).not.toContain(UNIT_LABELS.lb);
  });

  it('refuses to start a workout with nothing in it', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await press(element, 'start-workout');

    // Disabled and explained. A start button that produced an empty session would drop
    // a lifter on a logging screen with nothing to tick and no way back that is not
    // finishing a workout they never did.
    expect(nativeButton(control(shadow(element), 'start')).disabled).toBe(true);
    expect(readAll(element)).toContain(BUILDER_NOTES.startNeedsExercise);
  });

  it('reports every unreadable number at once rather than one press at a time', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await press(element, 'start-workout');
    await press(element, 'add-primary');

    await type(element, field(shadow(element), 'sets'), 'x');
    await type(element, field(shadow(element), 'reps'), '0');
    await press(element, 'start');

    // Section 5.5 seen from a form: two complaints from one press, each under the box
    // it is about, and still on the builder rather than on a logging screen.
    const text = readAll(element);
    expect(text).toContain(BUILDER_NOTES.heading);
    expect(text).toContain(planProblem({ row: 0, field: 'sets', code: 'unreadable' }));
    expect(text).toContain(planProblem({ row: 0, field: 'reps', code: 'not-positive' }));
    expect(deepAll(shadow(element), '.error').length).toBe(2);
  });

  /**
   * Section 4.3, from the receiving end.
   *
   * What is under test here is not the landing -- `core/handoff.test.ts` owns the
   * ramp and the validation -- but the four decisions the element makes around it:
   * when to draw the offer, what the offer is allowed to promise, what a press
   * does to the record, and what a landing is allowed to overwrite. Each of those
   * is invisible to a core test, and three of the four are only wrong at a rack.
   */
  describe('a session handed over by the warm-up calculator', () => {
    it('offers the session at the top of the home screen, naming what it would log', async () => {
      const { store } = await durableStore();
      const { source } = aSource(aRecord());
      const element = await mount(store, source);

      const text = readAll(element);
      expect(text).toContain(HANDOFF_NOTES.heading);
      expect(text).toContain(HANDOFF_NOTES.intro);
      expect(text).toContain('Squat');
      // Three by five at a hundred, in the record's own unit and not the tool's.
      expect(text).toContain('3 x 5');
      expect(text).toContain(formatWeight({ amount: 100, unit: 'kg' }));
    });

    it('draws nothing at all on a page that supplied no reader', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      expect(readAll(element)).not.toContain(HANDOFF_NOTES.heading);
    });

    /**
     * The card promises exactly what pressing it produces.
     *
     * A record can name a lift added to the catalogue after this page was built --
     * a tab left open across a deploy, or an embedded calculator on somebody
     * else's page. A card counting the record's own entries would offer two lifts
     * and log one, and the lifter would find out at the rack with the bar loaded.
     */
    it('lists only the lifts this build can actually land', async () => {
      const { store } = await durableStore();
      const { source } = aSource(
        aRecord([anExercise(), anExercise({ exerciseId: 'a-lift-this-build-has-never-heard-of' })]),
      );
      const element = await mount(store, source);

      expect(offerRows(element).length).toBe(1);

      await press(element, 'start-handoff');
      expect((await store.readWorkouts())[0]?.exercises.length).toBe(1);
    });

    /**
     * A record worth nothing is forgotten rather than drawn as an empty card.
     *
     * Forgotten and not merely refused: the lifter cannot act on it, and a record
     * silently declined on every visit is a key that never clears itself until the
     * hour is up.
     */
    it('forgets a record naming nothing it knows, rather than offering an empty card', async () => {
      const { store } = await durableStore();
      const { source, calls } = aSource(aRecord([anExercise({ exerciseId: 'not-a-lift' })]));
      const element = await mount(store, source);

      expect(readAll(element)).not.toContain(HANDOFF_NOTES.heading);
      expect(calls.clears).toBe(1);
    });

    /**
     * Read when the reader arrives, and never during a render.
     *
     * `peek` parses a document out of storage, so a render path that did it would
     * do it on every keystroke of a session -- and, worse, could answer
     * differently mid-session, because the key is writable by anything else on the
     * origin.
     */
    it('asks the reader once, not on every repaint', async () => {
      const { store } = await durableStore();
      const { source, calls } = aSource(aRecord());
      const element = await mount(store, source);
      expect(calls.peeks).toBe(1);

      await choose(element, 'ptk-segmented', 'kg');
      await press(element, 'backup');
      await vi.waitFor(async () => {
        await element.updateComplete;
        expect(readAll(element)).toContain(HOME_NOTES.backupDone);
      });

      expect(calls.peeks).toBe(1);
    });

    it('lands the session on the logging screen, with a ramp under the working sets', async () => {
      const { store } = await durableStore();
      const { source, calls } = aSource(aRecord());
      const element = await mount(store, source);

      await press(element, 'start-handoff');

      // The three working sets the lifter chose, and warm-ups this build worked
      // out. Section 8.1: the ramp is not carried in the record, so any row above
      // the working sets can only have come from this build's own engine.
      expect(setRows(element).length).toBeGreaterThan(3);
      expect(readAll(element)).toContain(`100 kg x 5`);
      expect(saveLine(element)).toBe(SAVE_STATES.saved);

      // Written once and forgotten. A record left behind is one the tool offers
      // again on the next visit, to a lifter who has already answered it.
      expect(calls.clears).toBe(1);
      expect((await store.readWorkouts()).length).toBe(1);
    });

    /**
     * The lifter's day, not the record's stamp.
     *
     * The stamp is an instant written by another page, possibly in a time zone
     * this device has since left, and the day a session is filed under is the day
     * the lifter is training -- which for a session set up the night before is a
     * different answer from the one the button was pressed on.
     */
    it('files the session under the day the lifter is training, not the day it was handed over', async () => {
      const { store } = await durableStore();
      const { source } = aSource(aRecord());
      const element = await mount(store, source);

      await press(element, 'start-handoff');

      expect((await store.readWorkouts())[0]?.localDate).toBe(TODAY);
      // The assertion above only means anything while these two differ.
      expect(TODAY).not.toBe(HANDED_OVER_AT.slice(0, 10));
    });

    it('discards the record without starting anything', async () => {
      const { store } = await durableStore();
      const { source, calls } = aSource(aRecord());
      const element = await mount(store, source);

      await press(element, 'discard-handoff');

      expect(readAll(element)).not.toContain(HANDOFF_NOTES.heading);
      expect(calls.clears).toBe(1);
      // Still on the home screen, with nothing started and nothing written.
      expect(readAll(element)).toContain(HOME_NOTES.historyEmpty);
      expect((await store.readWorkouts()).length).toBe(0);
    });

    /**
     * Nothing lands over a workout in progress.
     *
     * Start is absent rather than disabled, because there is nothing for it to do
     * -- landing here would replace training a lifter has done with training they
     * have not, and no confirmation makes that worth offering at a rack. Discard
     * stays, because the record expiring on its own in an hour is not an answer to
     * somebody looking at the card now.
     */
    it('will not land over a workout already in progress, and says why', async () => {
      const { store, databaseName } = await durableStore();
      const first = await mount(store);
      await planASquatSession(first);

      // The record arrives on the next visit rather than mid-session, because that is
      // the only way to reach the home screen with a workout open: Milestone 1 has no
      // route off the logging screen except finishing, so a lifter meeting this card
      // has closed the tab between warming up and coming back.
      first.remove();
      store.close();
      const reopened = await reopen(databaseName);
      const { source, calls } = aSource(aRecord());
      const element = await mount(reopened, source);

      const text = readAll(element);
      expect(text).toContain(HOME_NOTES.resumeNote);
      expect(text).toContain(HANDOFF_NOTES.heading);
      expect(text).toContain(HANDOFF_NOTES.busy);
      expect(deepAll(shadow(element), '[data-action="start-handoff"]').length).toBe(0);

      await press(element, 'discard-handoff');
      expect(calls.clears).toBe(1);
      // The workout the lifter was in the middle of is untouched by the refusal: one
      // session in the database, still the squat they planned, not the record's.
      const kept = await reopened.readWorkouts();
      expect(kept.length).toBe(1);
      expect(kept[0]?.exercises.length).toBe(1);
      await press(element, 'resume-workout');
      expect(readAll(element)).toContain(`100 ${UNIT} x 5`);
    });

    /**
     * A lift with no ramp under it reads as a fault unless the screen says
     * otherwise.
     *
     * The working sets still land, because those are the lifter's own numbers and
     * losing the session over a warm-up would be the wrong trade. Named rather
     * than counted: the sentence somebody needs at a rack is which lift.
     */
    it('lands a lift the engine will not ramp, and names it on the logging screen', async () => {
      const { store } = await durableStore();
      // Zero is inside what the record format allows and outside what the engine
      // will plan for, which is the one way a lift with a ramp available arrives
      // without one. The lift still travels; only the warm-up does not.
      const { source } = aSource(
        aRecord([anExercise(), anExercise({ exerciseId: 'bench-press', workingWeight: 0 })]),
      );
      const element = await mount(store, source);

      await press(element, 'start-handoff');

      const text = readAll(element);
      expect(text).toContain(HANDOFF_NOTES.unrampedLead);
      expect(text).toContain('Bench Press');
      expect(text).toContain(HANDOFF_NOTES.unrampedNote);
      expect((await store.readWorkouts())[0]?.exercises.length).toBe(2);
    });

    /**
     * The rack is adopted only where this device has none.
     *
     * A lifter who set one up on the equipment screen chose it here, and a record
     * arriving from another tab must not overwrite it: the calculator's rack is
     * where they warmed up, which is not a statement about where the logbook
     * thinks they train. Where there is none, the record is strictly better than
     * nothing -- it is the only rack this device has been told about.
     */
    it('adopts the record rack on a device that has never chosen one', async () => {
      const { store } = await durableStore();
      const { source } = aSource(aRecord());
      const element = await mount(store, source);
      expect((await store.readSettings())?.equipment ?? null).toBeNull();

      await press(element, 'start-handoff');

      await vi.waitFor(async () => {
        expect((await store.readSettings())?.equipment).toStrictEqual(aGym());
      });
    });

    it('leaves a rack the lifter set up here alone', async () => {
      const { store } = await durableStore();
      const mine: EquipmentSnapshot = {
        ...aGym(),
        // An invented pound rack, so nothing about the outcome is ambiguous.
        barWeight: { amount: 45, unit: 'lb' },
        plateUnit: 'lb',
        plates: [{ weight: 45, pairs: null, fullDiameter: true }],
      };
      // Written before the mount, so the element boots holding it. Set through the
      // store rather than the equipment screen because what is under test is the
      // guard on a rack that is already there, not how it got there.
      await store.writeSettings({ ...defaultSettings(), equipment: mine });
      const element = await mount(store, aSource(aRecord()).source);

      await press(element, 'start-handoff');

      await settle(element);
      expect((await store.readSettings())?.equipment).toStrictEqual(mine);
    });
  });

  /**
   * Section 7.8, end to end.
   *
   * The leaf suite drives `previous` as a property, which proves what the line looks
   * like and nothing about where it comes from. Everything under test here is between
   * a completed session in IndexedDB and that property: the repository's walk, the
   * root's state, and the one guard that decides how often the walk happens.
   */
  describe('what each lift was last done for', () => {
    it('puts the last session on the logging screen of the next one', async () => {
      const { store } = await durableStore();
      await seedHistory(store, SQUAT);
      const element = await mount(store);

      await planASquatSession(element);

      const line = await previousLine(element);
      expect(line).toContain(ACTIVE_NOTES.lastTime);
      expect(line).toContain(LAST_TIME_DAY);
      expect(line).toContain(formatWeight({ amount: LAST_TIME_WEIGHT, unit: UNIT }));
      // Last session's numbers and not this one's. The live plan is 100, so a line
      // rendered from the session on screen would read as a history nobody has.
      expect(line).not.toContain('100');
    });

    it('says nothing at all under a lift with no completed history', async () => {
      const { store } = await durableStore();
      await seedHistory(store, SQUAT);
      const element = await mount(store);

      await press(element, 'start-workout');
      await addPrimary(element, 'squat');
      await addPrimary(element, 'bench-press');
      await press(element, 'start');

      // The squat's line is the sync point: once it is there, the read for this
      // session has finished and the bench press's silence is an answer rather than
      // a screen that has not caught up.
      await previousLine(element);
      expect(previousLines(shadow(element))).toHaveLength(1);
      expect(previousLines(exerciseCard(element, 1))).toHaveLength(0);
    });

    /**
     * The guard on the read, which is the only reason `#previousKey` exists.
     *
     * `willUpdate` runs on every tick of every set, and the walk behind this line
     * reads the history out of the database. Without the key it would run again for
     * each of a session's forty taps -- section 9.3's bounded read undone on the one
     * screen a lifter holds between sets, and undone invisibly, because the answer
     * would be identical every time.
     */
    it('does not read the history again when a set is ticked', async () => {
      const { store } = await durableStore();
      await seedHistory(store, SQUAT);
      const { store: counted, calls } = counting(store);
      const element = await mount(counted);
      await planASquatSession(element);
      await previousLine(element);

      const before = calls.scans;
      // Or the assertion below holds against a tool that never read anything.
      expect(before).toBeGreaterThan(0);

      await press(element, 'complete', setRow(element, 0));
      expect(isDone(setRow(element, 0))).toBe(true);
      expect(saveLine(element)).toBe(SAVE_STATES.saved);

      expect(calls.scans).toBe(before);
    });

    it('reads it again for the next session, which the last one is now part of', async () => {
      const { store } = await durableStore();
      const { store: counted, calls } = counting(store);
      const element = await mount(counted);

      // Nothing is seeded: the first session is the history the second one reads,
      // which is the case the session id is in the key for. Keyed on the lifts alone,
      // a lifter squatting twice in a day would be shown nothing the second time.
      await planASquatSession(element);
      expect(previousLines(shadow(element))).toHaveLength(0);
      const before = calls.scans;

      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');
      const booted = calls.profiles;
      await press(element, 'home');
      // Going home restarts the boot read, and nothing on screen reports it. Planning
      // the next session while it is still in flight loses that session to an answer
      // read before it existed -- which is a race in the test and not in the tool, a
      // lifter needing four taps to get where this arrives in four milliseconds.
      await vi.waitFor(() => {
        expect(calls.profiles).toBeGreaterThan(booted);
      });

      await planASquatSession(element);

      expect(calls.scans).toBeGreaterThan(before);
      const line = await previousLine(element);
      expect(line).toContain(TODAY);
      expect(line).toContain(formatWeight({ amount: 100, unit: UNIT }));
    });
  });

  describe('when the browser will not store anything', () => {
    it('says so before the first set is logged, and still logs it', async () => {
      const element = await mount(memoryLogbookStore());

      // Not a fault and not hidden. A supported mode a lifter is not told about is a
      // data-loss trap, so the tool says what to do about it in the same breath.
      expect(saveLine(element)).toContain(SAVE_STATES.unavailable);
      expect(readAll(element)).toContain(SAVE_STATE_NOTES.unavailable ?? '');

      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      expect(isDone(setRow(element, 0))).toBe(true);
      // And it never claims the write it did not make.
      expect(saveLine(element)).not.toContain(SAVE_STATES.saved);
    });
  });

  describe('the events a host can listen for', () => {
    /** Every event of one name that reached the page, with its detail. */
    function record(name: string): unknown[] {
      const seen: unknown[] = [];
      const listener = (event: Event): void => {
        seen.push(event instanceof CustomEvent ? event.detail : null);
      };
      document.body.addEventListener(name, listener);
      teardown.push(() => {
        document.body.removeEventListener(name, listener);
      });
      return seen;
    }

    it('announces the session as it happens, naming it by identifier only', async () => {
      const started = record(WORKOUT_STARTED_EVENT);
      const completed = record(SET_COMPLETED_EVENT);
      const saved = record(WORKOUT_SAVED_EVENT);
      const finished = record(WORKOUT_COMPLETED_EVENT);

      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');

      expect(started.length).toBe(1);
      expect(completed.length).toBe(1);
      expect(finished.length).toBe(1);
      expect(saved.length).toBeGreaterThan(0);

      // Section 12.5: these stay local browser events and carry no training in them.
      // Identifiers and counts only -- no weight, no rep count, no exercise name -- so
      // a page embedding this tool learns that a workout happened and nothing whatever
      // about what was lifted.
      const payload = JSON.stringify([...started, ...completed, ...saved, ...finished]);
      expect(payload).not.toContain('Squat');
      expect(payload).not.toContain('100');
      expect(payload).not.toContain(UNIT);
    });

    /**
     * The internal channel does not escape the tool.
     *
     * `ptk-workout-changed` carries the whole session, because the logging screen has
     * to hand the root something to store. It is `composed` because that is the only
     * way out of a shadow root -- and unless the root stops it there, every set a
     * lifter logs is readable by one listener on the embedding page. Section 2.5 and
     * section 12.5 land on the same answer: the tool is the boundary, so the element
     * that is the boundary has to enforce it.
     */
    it('keeps the session inside the tool', async () => {
      const changed = record(WORKOUT_CHANGED_EVENT);

      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      expect(changed).toEqual([]);
    });

    it('says how much a backup held, and nothing about what is in it', async () => {
      const exported = record(BACKUP_EXPORTED_EVENT);

      const { store } = await durableStore();
      const element = await mount(store);
      await press(element, 'backup');

      await vi.waitFor(() => {
        expect(exported.length).toBe(1);
      });
      expect(exported[0]).toStrictEqual({ workoutCount: 0 });
      // Pressed once, said once. Without this a lifter presses it again to find out
      // whether the first press did anything.
      await vi.waitFor(async () => {
        await element.updateComplete;
        expect(readAll(element)).toContain(HOME_NOTES.backupDone);
      });
    });
  });

  describe('what it never says', () => {
    /**
     * The words that would turn a record into advice.
     *
     * Sections 15.3 and 16.1. A logbook that calls a session good is making a claim
     * about work it did not see, and one that calls a set missed has renamed a lifter's
     * own decision a failure. The rule is enforced by vocabulary or not at all, so it
     * is asserted against the rendered screens rather than against `copy.ts` -- a
     * sentence composed at render time counts too.
     */
    const FORBIDDEN = [
      'great',
      'good',
      'well done',
      'nice',
      'easy',
      'hard',
      'ahead',
      'behind',
      'on track',
      'missed',
      'failed',
      'personal best',
    ];

    /**
     * Takes the exercise names out before the words are looked for.
     *
     * The builder's picker lists the whole catalogue, and the catalogue contains a Good
     * Morning -- a real barbell movement, named that since long before this tool. The
     * rule is about the vocabulary the tool writes, not about the vocabulary of the
     * sport it is written for, so the exercise names are subtracted rather than the
     * word dropped: `good` is the single most valuable entry in the list, because it is
     * the one word a logbook drifts towards on its own.
     */
    function withoutExerciseNames(text: string): string {
      return CATALOG_EXERCISES.reduce(
        (remaining, exercise) => remaining.split(exercise.name.toLowerCase()).join(' '),
        text,
      );
    }

    it('does not grade the session on any screen of it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      const screens: string[] = [readAll(element)];
      await press(element, 'start-workout');
      screens.push(readAll(element));
      await press(element, 'add-primary');
      await press(element, 'start');
      screens.push(readAll(element));
      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      screens.push(readAll(element));
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');
      screens.push(readAll(element));
      await press(element, 'home');
      screens.push(readAll(element));

      const everything = withoutExerciseNames(screens.join(' ').toLowerCase());
      for (const word of FORBIDDEN) {
        expect(everything).not.toContain(word);
      }
    });

    it('shows a set planned with no weight as reps rather than as nothing', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await press(element, 'start-workout');
      await press(element, 'add-primary');
      // Section 7.4 allows a plan with no weight in it, and the builder says so.
      await press(element, 'start');

      const text = readAll(element);
      expect(text).toContain('5 reps');
      expect(text).not.toContain(NOT_SET);
    });
  });

  describe('accessibility', () => {
    const RULES = {
      // Disabled for the reason every suite in this collection disables it: the element
      // is measured outside the page's own background, so the contrast engine compares
      // a token against whatever the harness painted behind it.
      rules: { 'color-contrast': { enabled: false } },
    } as const;

    it('has no violations on the home screen', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      const results = await axe.run(element, RULES);
      expect(results.violations).toEqual([]);
    });

    it('has no violations on the builder', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await press(element, 'start-workout');
      await press(element, 'add-primary');

      const results = await axe.run(element, RULES);
      expect(results.violations).toEqual([]);
    });

    it('has no violations while logging, with an editor and the finish panel open', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await press(element, 'edit', setRow(element, 0));
      await press(element, 'finish');

      const results = await axe.run(element, RULES);
      expect(results.violations).toEqual([]);
    });

    it('gives every repeated control a name that says which set it acts on', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      // Three "Done" buttons are not three names. A screen reader moving by control
      // hears the exercise and the position, which is what a sighted lifter reads off
      // the row above the button.
      const names = setRows(element).map((row) =>
        nativeButton(control(row, 'complete')).getAttribute('aria-label'),
      );
      expect(names.length).toBe(3);
      expect(new Set(names).size).toBe(names.length);
      expect(names[0]).toContain('Squat');
    });
  });
});
