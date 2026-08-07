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
import { formatWeight, type Weight } from '@platform-toolkit/domain';
import { SEGMENTED_CHANGE_EVENT, type SegmentedChangeDetail } from '@platform-toolkit/ui';
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
import { rampLastExercise } from '../core/warmup.js';
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
  WorkoutExercise,
  WorkoutSession,
} from '../types.js';

import {
  ACTIVE_NOTES,
  BUILDER_NOTES,
  DETAIL_NOTES,
  DONE_NOTES,
  EDIT_NOTES,
  EFFORT_FIELD_LABELS,
  EFFORT_SETTING_NOTES,
  FINISH_DISPOSITIONS,
  HANDOFF_NOTES,
  HISTORY_NOTES,
  HOME_NOTES,
  RECORDS_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  UNIT_LABELS,
} from './copy.js';
import {
  DONE_EFFORT_FIELD,
  EFFORT_SETTING_FIELD,
  UNIT_SETTING_FIELD,
  WORKOUT_NOTE_KEY,
  exerciseNoteKey,
} from './dataset.js';
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

/**
 * Every event of one name that reached the page, with its detail.
 *
 * At the top rather than inside the block about events, because a repeat is also
 * announced and the alternative was the same eleven lines twice.
 */
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

const SQUAT = catalogExercise('squat');

/*
 * ---------------------------------------------------------------------------
 * A finished session to do again. Section 4.4.
 * ---------------------------------------------------------------------------
 */

/** The lift the seeded session deliberately leaves unramped, though it could be. */
const BENCH = catalogExercise('bench-press');

/**
 * The day the repeated session was trained on, and the instant it was written.
 *
 * Its own day, and neither {@link TODAY} nor {@link LAST_TIME_DAY}: the copy has to be
 * dated today, and a source sharing a day with the answer could not show that.
 */
const REPEATED_DAY: CalendarDay = '2026-02-24';
const REPEATED_AT: Instant = '2026-02-24T17:00:00.000Z';

/**
 * What that session was planned for. Every figure invented, per section 5.1.
 *
 * In kilograms, because the rack it was ramped against is, and the lifter is standing at
 * a pound rack today. A warm-up rung that comes back in kilograms was therefore copied
 * rather than regenerated, which is the one thing the repeat must not do.
 */
const REPEATED_WEIGHT = 110;
const REPEATED_SETS = 3;
const REPEATED_REPS = 5;

/** Free text a lifter typed, which the copy keeps. */
const REPEATED_TITLE = 'Invented Tuesday, heavy';

/** The rack in front of the lifter now. Invented, and in the other unit. Section 5.1. */
function aPoundRack(): EquipmentSnapshot {
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

/** Puts a rack in settings, which is the one a repeated session is ramped against. */
async function useRack(store: LogbookStore, equipment: EquipmentSnapshot): Promise<void> {
  await store.writeSettings({ ...defaultSettings(), equipment });
}

/**
 * A finished session in the store, ramped on the squat and not on the bench press.
 *
 * Both lifts can be ramped, so the only difference between them is whether one *was* --
 * which is exactly the fact the copy has to reproduce. Pairing a ramped lift against one
 * the catalogue refuses would pass against a tool that never looked at the source.
 *
 * Written through the store and built by the core, for the reasons `seedHistory` is, and
 * returned whole because every assertion in this section is a comparison against it.
 */
async function seedRepeatable(store: LogbookStore): Promise<WorkoutSession> {
  let next = 0;
  // Its own prefix again: `mount` hands the element `id-N` and `seedHistory` owns
  // `last-N`, and a seeded workout sharing an identifier with a live one is overwritten
  // by that session's first save.
  const context: SessionContext = {
    at: REPEATED_AT,
    nextId: (): LogbookId => {
      next += 1;
      return `did-${String(next)}`;
    },
  };
  let session = createWorkout(context, { localDate: REPEATED_DAY, title: REPEATED_TITLE });
  for (const exercise of [SQUAT, BENCH]) {
    session = addExercise(session, context, {
      exerciseId: exercise.id,
      displayName: exercise.name,
      loading: exercise.loading,
      plan: Array.from({ length: REPEATED_SETS }, () => ({
        kind: 'working' as const,
        performance: performance(
          { kind: 'implement', weight: { amount: REPEATED_WEIGHT, unit: 'kg' } },
          REPEATED_REPS,
        ),
      })),
    });
    if (exercise.id !== SQUAT.id) continue;
    const ramped = rampLastExercise(
      session,
      exercise,
      {
        equipment: aGym(),
        workingWeight: REPEATED_WEIGHT,
        workingSets: REPEATED_SETS,
        workingReps: REPEATED_REPS,
      },
      context,
    );
    // Loudly, and not by carrying on: every warm-up assertion below would otherwise be
    // made against a source that had no ramp on it, and all of them would pass.
    if (!ramped.ok) throw new Error('The session to be repeated was supposed to be ramped.');
    session = ramped.session;
  }
  session = startWorkout(session, context);
  for (const set of session.exercises.flatMap((exercised) => exercised.sets)) {
    session = completeSet(session, set.id, context);
  }
  const finished = finishWorkout(session, 'leave', context);
  await store.writeWorkout(finished, { kind: 'unchanged' });
  return finished;
}

/**
 * The home screen's row for one workout, once the read behind it has landed.
 *
 * By identifier and not by position. A session in progress is listed alongside the
 * finished ones and sorts above them, so the first row is not the seeded one on every
 * journey here -- and a case that pressed Repeat on the wrong row would still pass.
 */
async function historyRow(element: PtkTrainingLogbook, id: LogbookId): Promise<HTMLElement> {
  const selector = `li[data-workout="${id}"]`;
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(deepAll(shadow(element), selector)).toHaveLength(1);
  });
  const row = deepAll(shadow(element), selector)[0];
  if (row === undefined) throw new Error(`The home screen is not listing ${id}.`);
  return row;
}

/** What one history row says. Not `readAll`, which wants an element with a shadow root. */
function rowText(row: HTMLElement): string {
  return row.textContent.replace(/\s+/gu, ' ').trim();
}

/**
 * Presses Repeat on a row and waits for the copy to be on screen.
 *
 * `settle` on its own would return against the home screen it clicked: the press begins
 * with a read of the whole stored session and writes nothing until that read comes back,
 * so the storage line says Saved for the entire journey. The set rows are the first
 * thing that exists only on the far side of it.
 */
async function repeat(element: PtkTrainingLogbook, row: HTMLElement): Promise<void> {
  nativeButton(control(row, 'repeat-workout')).click();
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(setRows(element).length).toBeGreaterThan(0);
  });
  await settle(element);
}

/**
 * Presses Open on a row and waits for the workout to be on screen.
 *
 * Waits on the detail element rather than on `setRows`, which the home screen has none
 * of and the detail screen has plenty: the read behind the press is asynchronous, and a
 * helper that returned as soon as the click landed would assert against the home screen
 * it left. `settle` alone would do the same -- nothing is written by opening a workout,
 * so the storage line says Saved for the whole journey.
 */
async function open(element: PtkTrainingLogbook, row: HTMLElement): Promise<HTMLElement> {
  nativeButton(control(row, 'open-workout')).click();
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(deepAll(shadow(element), 'ptk-workout-detail')).toHaveLength(1);
  });
  const screen = deepAll(shadow(element), 'ptk-workout-detail')[0];
  if (screen === undefined) throw new Error('The workout did not open.');
  return screen;
}

/**
 * Presses the History control on a lift and waits for what it reads to be on screen.
 *
 * Takes the root it should press within, because both screens that offer the way in
 * draw one control per lift and the interesting cases are about *which* lift was
 * pressed. Waits on the element for `open`'s reason: the read behind the press is a walk
 * of the whole history, and the storage line says Saved throughout, so `settle` alone
 * would return against the screen the press left.
 */
async function openHistory(
  element: PtkTrainingLogbook,
  within: DocumentFragment | HTMLElement,
): Promise<HTMLElement> {
  nativeButton(control(within, 'open-exercise-history')).click();
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(deepAll(shadow(element), 'ptk-exercise-history')).toHaveLength(1);
  });
  const screen = deepAll(shadow(element), 'ptk-exercise-history')[0];
  if (screen === undefined) throw new Error('The history did not open.');
  return screen;
}

/**
 * Opens a workout from the history and presses Change, landing on the logging screen.
 *
 * Two presses and not one, because that is the journey: section 5.4's edit is reached
 * through the workout it is about, and a helper that set the screen directly would skip
 * the handover of the session already read for the detail screen.
 */
async function edit(element: PtkTrainingLogbook, id: LogbookId): Promise<void> {
  await open(element, await historyRow(element, id));
  await press(element, 'edit-workout');
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(deepAll(shadow(element), 'ptk-active-workout')).toHaveLength(1);
  });
  await settle(element);
}

/**
 * A working row of the first lift, by position among the working rows.
 *
 * Not `setRow`, which counts the warm-up rows above them. A seeded session here is
 * ramped, so its first row is a 20 kg bar -- correcting that one proves the wiring and
 * nothing a lifter would recognise, and removing it moves no number on the history row.
 */
function workingRow(element: PtkTrainingLogbook, index: number): HTMLElement {
  const row = deepAll(shadow(element), 'li[data-set][data-kind="working"]')[index];
  if (row === undefined) throw new Error(`There is no working set ${String(index + 1)} here.`);
  return row;
}

/** Opens the editor on a working row, retypes the reps, and saves -- the correction path. */
async function correctReps(
  element: PtkTrainingLogbook,
  index: number,
  reps: string,
): Promise<void> {
  await press(element, 'edit', workingRow(element, index));
  await type(element, field(workingRow(element, index), 'done-reps'), reps);
  await press(element, 'save-edit', workingRow(element, index));
}

/** What the first working set of a lift was actually done for, out of a stored session. */
function performedReps(session: WorkoutSession, index: number): number | null {
  const working = exerciseAt(session, 0).sets.filter((set) => set.kind === 'working');
  const set = working[index];
  if (set === undefined) throw new Error(`This lift has no working set ${String(index + 1)}.`);
  return set.performed?.repetitions ?? null;
}

/** How many rows one lift of a stored session has. */
function setCount(session: WorkoutSession, index: number): number {
  return exerciseAt(session, index).sets.length;
}

/**
 * The session the tool is now in, read back out of storage rather than off the element.
 *
 * The session is private state, which is the honest constraint to assert under: what a
 * lifter keeps is what the database holds, and a property read would pass against a copy
 * that was never written down.
 */
async function activeWorkout(store: LogbookStore): Promise<WorkoutSession> {
  const id = await store.readActiveId();
  if (id === null) throw new Error('Nothing is marked as the workout in progress.');
  const session = await store.readWorkout(id);
  if (session === null) throw new Error(`The active pointer names ${id}, which is not stored.`);
  return session;
}

/** One exercise by position, which is the order a repeat preserves. */
function exerciseAt(session: WorkoutSession, index: number): WorkoutExercise {
  const exercise = session.exercises[index];
  if (exercise === undefined) throw new Error(`This session has no exercise ${String(index + 1)}.`);
  return exercise;
}

/**
 * What one exercise is planned to lift, by kind, in the order it is written down.
 *
 * Weights rather than formatted strings, because the unit is half the assertion: a rung
 * regenerated against today's rack carries today's plate unit, and a formatter would fold
 * that into prose to be matched with a substring.
 */
function plannedLoads(exercise: WorkoutExercise, kind: 'warmup' | 'working'): Weight[] {
  return exercise.sets
    .filter((set) => set.kind === kind)
    .map((set) => {
      const load = set.planned?.load;
      if (load?.kind !== 'implement') {
        throw new Error(`A ${kind} set of "${exercise.displayName}" with nothing on the bar.`);
      }
      return load.weight;
    });
}

/**
 * A store whose sessions cannot be read back one at a time.
 *
 * Safe to boot against, which is the whole reason it is written this way: the repository
 * reads the active pointer first and only reaches a session where there is one, and there
 * is none in the case this is for. The home screen's list comes from `readWorkouts`, so
 * the row is drawn as usual and the failure arrives on the press -- which is the order a
 * lifter meets a record that has gone bad under them.
 */
function unreadable(store: LogbookStore): LogbookStore {
  return {
    ...store,
    readWorkout: () => Promise.reject(new Error('this record cannot be read')),
  };
}

/**
 * A store whose bounded read fails, which is the one above's sibling and not the same
 * thing.
 *
 * An exercise's history is `scanWorkouts` and never `readWorkout`, so {@link unreadable}
 * leaves it working perfectly -- a case that used it would open a full history and prove
 * nothing about the failure it named. Boot survives this for the reason boot survives
 * that one: nothing is scanned until a lifter presses something.
 */
function unscannable(store: LogbookStore): LogbookStore {
  return {
    ...store,
    scanWorkouts: () => Promise.reject(new Error('the history cannot be walked')),
  };
}

/*
 * ---------------------------------------------------------------------------
 * What the lifter wrote down. Section 7.9.
 * ---------------------------------------------------------------------------
 */

/**
 * Two sentences a lifter typed. Invented, per section 5.1, and deliberately
 * unalike -- an assertion that a note reached storage means nothing if the note
 * about the session and the note about the lift could be mistaken for each other.
 */
const WORKOUT_NOTE = 'Invented: whole session felt slow, bar path fine';
const EXERCISE_NOTE = 'Invented: left knee tracking in on the second rep';

/** The quiet control that opens one note, named by the key it acts on. */
function noteControl(element: PtkTrainingLogbook, key: string): HTMLElement {
  const found = deepAll(shadow(element), `[data-action="note"][data-note="${key}"]`)[0];
  if (found === undefined) throw new Error(`Nothing on this screen opens the "${key}" note.`);
  return found;
}

/**
 * The box a keyboard actually reaches.
 *
 * Two steps, because the box is a `ptk-text-area` and the thing that takes a
 * keystroke is the `<textarea>` inside its own shadow root -- and it is that
 * element the component reads `event.target` off. An event dispatched at the host
 * carries a value the box never held and is dropped, which would leave every case
 * below asserting against a screen nobody typed into.
 */
function noteField(element: PtkTrainingLogbook, key: string): HTMLTextAreaElement {
  const box = deepAll(shadow(element), `ptk-text-area[data-note="${key}"]`)[0];
  if (box === undefined) throw new Error(`The "${key}" note box is not open.`);
  const field = shadow(box).querySelector('textarea');
  if (field === null) throw new Error(`The "${key}" note box has nothing to type in.`);
  return field;
}

/** Presses a note's own button, which opens the box or closes it again. */
async function pressNote(element: PtkTrainingLogbook, key: string): Promise<void> {
  nativeButton(noteControl(element, key)).click();
  await settle(element);
}

/**
 * Types into an open box, and stops there.
 *
 * Nothing about storage is awaited, because nothing about storage has happened: the
 * write is half a second behind the last keystroke, so a case asserting on the
 * database here would be asserting on the length of section 10.2's debounce.
 */
async function typeNote(element: PtkTrainingLogbook, key: string, text: string): Promise<void> {
  const field = noteField(element, key);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(element);
}

/** Leaves the box, which is what writes it without waiting the debounce out. */
async function leaveNote(element: PtkTrainingLogbook, key: string): Promise<void> {
  const leaving = new FocusEvent('focusout', { bubbles: true, composed: true });
  noteField(element, key).dispatchEvent(leaving);
  await settle(element);
}

/** Opens a note, types it and moves on -- the whole of what a lifter does. */
async function writeNote(element: PtkTrainingLogbook, key: string, text: string): Promise<void> {
  await pressNote(element, key);
  await typeNote(element, key, text);
  await leaveNote(element, key);
}

/**
 * Every note the screen is showing back as the lifter's own words.
 *
 * The line and not a mark: a closed note is printed, so this is what a lifter reads
 * without opening anything, and it is rendered from the session the root hands back
 * down rather than from anything the logging screen kept.
 */
function writtenNotes(element: PtkTrainingLogbook): string[] {
  return deepAll(shadow(element), 'p.written').map((line) => line.textContent.trim());
}

/** The row of one exercise in the stored session, by position. */
function noteKeyFor(session: WorkoutSession, index: number): string {
  return exerciseNoteKey(exerciseAt(session, index).id);
}

/*
 * ---------------------------------------------------------------------------
 * How effort is entered, if at all. Section 7.10.
 * ---------------------------------------------------------------------------
 */

/**
 * One of the home screen's two settings controls, named by the field it writes.
 *
 * By `data-field` and never by position, for the reason {@link historyRow} takes an
 * identifier: both controls are a `ptk-segmented` in the same section, so
 * `deepAll(...)[0]` names whichever one the template happens to draw first. The two
 * settings are independent, so a case that pressed the wrong one would move a
 * setting, see the screen respond, and assert its way to a pass.
 */
function settingControl(element: PtkTrainingLogbook, name: string): HTMLElement {
  const wrapper = deepAll(shadow(element), `[data-field="${name}"]`)[0];
  if (wrapper === undefined) throw new Error(`This screen has no "${name}" control.`);
  // Two steps rather than one compound selector, as `field` above does: a compound
  // `querySelector` types as `Element` and would need the cast section 2.4 forbids.
  const found = wrapper.querySelector('ptk-segmented');
  if (found === null) throw new Error(`The "${name}" wrapper holds no segmented control.`);
  return found;
}

/** Every answer a settings control offers, in the order a thumb meets them. */
function settingSegments(element: PtkTrainingLogbook, name: string): HTMLInputElement[] {
  return [...shadow(settingControl(element, name)).querySelectorAll('input')];
}

/** Which segment is showing as chosen, or `null` where none is. */
function chosenSetting(element: PtkTrainingLogbook, name: string): string | null {
  return settingSegments(element, name).find((segment) => segment.checked)?.value ?? null;
}

/** Answers one settings control by pressing a segment, which is how a lifter answers. */
async function chooseSetting(
  element: PtkTrainingLogbook,
  name: string,
  value: string,
): Promise<void> {
  const segment = settingSegments(element, name).find((candidate) => candidate.value === value);
  if (segment === undefined) throw new Error(`The "${name}" control does not offer "${value}".`);
  segment.click();
  await settle(element);
}

/**
 * The same event a segment sends, dispatched by a consumer instead of by a thumb.
 *
 * The only way to reach the root's own no-op guard. `ptk-segmented` drops a repeat
 * of the value it is already showing, and a click on a checked radio fires no
 * `change` at all, so the guard inside `#onSetting` exists for the case section 15
 * makes ordinary: a page that has imported the event name and reports a setting
 * itself. Left untested, the guard could go and every journey here would still pass.
 */
async function reportSetting(
  element: PtkTrainingLogbook,
  name: string,
  value: string,
): Promise<void> {
  settingControl(element, name).dispatchEvent(
    new CustomEvent<SegmentedChangeDetail>(SEGMENTED_CHANGE_EVENT, {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(element);
}

/**
 * A store that counts what the settings cost in writes.
 *
 * The count is the only observable a no-op has. Both handlers refuse the answer
 * already stored, and a handler that wrote it anyway would leave the screen, the
 * database and every assertion about either one exactly as they are -- while
 * spending a transaction on every glance at the control, and flashing the storage
 * line on a screen that changed nothing.
 */
function countingSettings(store: LogbookStore): {
  store: LogbookStore;
  calls: { writes: number };
} {
  const calls = { writes: 0 };
  return {
    calls,
    store: {
      ...store,
      writeSettings: (settings) => {
        calls.writes += 1;
        return store.writeSettings(settings);
      },
    },
  };
}

/** The editor's effort box, wherever the logging screen has drawn one. */
function effortBoxes(root: DocumentFragment | HTMLElement): HTMLElement[] {
  return deepAll(root, `[data-field="${DONE_EFFORT_FIELD}"]`);
}

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
    // The count and its label together, and the singular one: exactly one set was
    // ticked off above. The bare label would read the same against "1 working sets",
    // which is what the row said before the plural rule was written.
    expect(home.replace(/\s+/g, ' ')).toContain(`1 ${HISTORY_NOTES.setsLabelOne}`);
    // The finished session is no longer offered to carry on with.
    expect(home).not.toContain(HOME_NOTES.resumeNote);
  });

  it('remembers the unit the next session is typed in', async () => {
    const { store, databaseName } = await durableStore();
    const first = await mount(store);

    // Named rather than "the first segmented on the screen", which the home screen
    // stopped having exactly one of when the exercise library grew a unit control.
    await chooseSetting(first, UNIT_SETTING_FIELD, 'kg');
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

      await chooseSetting(element, UNIT_SETTING_FIELD, 'kg');
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

  /**
   * Section 4.4 and LOG-003, driven from the row a lifter actually presses.
   *
   * Every case here runs on the durable store rather than the memory one. Two of them
   * are about what is *left* in storage -- that the source was not touched, and that the
   * copy was written -- and `#persist` returns early where the repository is not durable,
   * so on the memory store both would assert nothing and pass.
   */
  describe('doing a workout again', () => {
    it('starts a new session today, holding the plan and none of the results', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await repeat(element, await historyRow(element, source.id));

      const copy = await activeWorkout(store);
      // A new session, and not the old one reopened for editing. Without this the rest
      // of the case would hold against a tool that handed a lifter their own history to
      // write over.
      expect(copy.id).not.toBe(source.id);
      expect(copy.localDate).toBe(TODAY);
      expect(copy.status).toBe('active');
      expect(copy.title).toBe(REPEATED_TITLE);

      // The same lifts, in the same order, for the same working sets.
      expect(copy.exercises.map((exercise) => exercise.exerciseId)).toEqual(
        source.exercises.map((exercise) => exercise.exerciseId),
      );
      for (const index of [0, 1]) {
        expect(plannedLoads(exerciseAt(copy, index), 'working')).toEqual(
          plannedLoads(exerciseAt(source, index), 'working'),
        );
      }

      // And nothing performed. Every set of the source was ticked off, so a copy that
      // carried results across would open as a session the lifter had already done.
      const sets = copy.exercises.flatMap((exercise) => exercise.sets);
      expect(sets.length).toBeGreaterThan(0);
      expect(sets.every((set) => set.performed === null)).toBe(true);
      expect(sets.every((set) => set.status === 'planned')).toBe(true);
      expect(sets.every((set) => set.completedAt === null)).toBe(true);
      // On screen as well as in storage: not one row opens showing an Undo.
      expect(setRows(element)).toHaveLength(sets.length);
      expect(setRows(element).some((row) => isDone(row))).toBe(false);
    });

    it('leaves the workout it copied exactly as it was', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await repeat(element, await historyRow(element, source.id));

      // Field for field, `updatedAt` included. Repeating is a read, and a source that
      // came back with a new stamp on it is a history the tool edited in order to start
      // a session -- which is the one thing the list on the home screen promises it
      // cannot do.
      expect(await store.readWorkout(source.id)).toEqual(source);
      expect(source.status).toBe('completed');
      // Two records now, not one amended: the source and the copy.
      const stored = await store.readWorkouts();
      expect(stored.map((workout) => workout.id).sort()).toEqual(
        [source.id, (await activeWorkout(store)).id].sort(),
      );
    });

    it('builds the ramp again against the rack in front of the lifter', async () => {
      const { store } = await durableStore();
      await useRack(store, aPoundRack());
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await repeat(element, await historyRow(element, source.id));

      const copy = await activeWorkout(store);
      const copied = exerciseAt(copy, 0);
      const before = exerciseAt(source, 0);

      // Regenerated and not carried across. The source was ramped on a kilogram rack and
      // this lifter is standing at a pound one, so a copied ladder would name plates that
      // are not in the room and name them in the wrong unit.
      expect(plannedLoads(copied, 'warmup').length).toBeGreaterThan(0);
      expect(new Set(plannedLoads(copied, 'warmup').map((weight) => weight.unit))).toEqual(
        new Set(['lb']),
      );
      expect(new Set(plannedLoads(before, 'warmup').map((weight) => weight.unit))).toEqual(
        new Set(['kg']),
      );
      expect(plannedLoads(copied, 'warmup')).not.toEqual(plannedLoads(before, 'warmup'));
      // And the frozen record says which rack it was built for, which is what section
      // 8.4 stores a snapshot for at all.
      expect(copied.warmup?.equipment).toEqual(aPoundRack());

      // Loadable, which is the point of regenerating rather than copying: a rung the
      // plates cannot build draws a sentence where the diagram goes, and this rack is
      // the only one the diagram is drawn from.
      const rungs = deepAll(shadow(element), 'li[data-set][data-kind="warmup"]');
      expect(rungs).toHaveLength(plannedLoads(copied, 'warmup').length);
      expect(rungs.flatMap((rung) => deepAll(rung, 'p.refusal'))).toHaveLength(0);
      // The empty bar draws no plate faces and every rung above it does, so this counts
      // ladders that reached the rack rather than rows that reached the screen.
      expect(rungs.flatMap((rung) => deepAll(rung, '[role="img"]')).length).toBeGreaterThan(0);
    });

    it('gives no ramp to a lift that had none, though it could have one', async () => {
      const { store } = await durableStore();
      await useRack(store, aPoundRack());
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await repeat(element, await historyRow(element, source.id));

      const copy = await activeWorkout(store);
      // The bench press is ramp-capable and was not ramped, so the answer can only have
      // come from reading the source. The squat beside it proves the rack was there and
      // the engine was willing, which is what makes this a pairing and not a silence.
      expect(exerciseAt(source, 1).warmup).toBeNull();
      expect(exerciseAt(copy, 1).warmup).toBeNull();
      expect(plannedLoads(exerciseAt(copy, 1), 'warmup')).toEqual([]);
      expect(plannedLoads(exerciseAt(copy, 0), 'warmup').length).toBeGreaterThan(0);
    });

    it('announces the copy once, by the identifier it wrote', async () => {
      const started = record(WORKOUT_STARTED_EVENT);

      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await repeat(element, await historyRow(element, source.id));

      // Once, and about the copy. Section 12.5: an identifier and nothing else, so a
      // page embedding this tool learns that a session started and nothing about it.
      const copy = await activeWorkout(store);
      expect(started).toEqual([{ workoutId: copy.id }]);
      expect(copy.id).not.toBe(source.id);
    });

    it('offers no row to repeat while a session is open', async () => {
      const { store, databaseName } = await durableStore();
      const source = await seedRepeatable(store);
      const first = await mount(store);
      await planASquatSession(first);
      const open = await store.readActiveId();

      // The refresh is not decoration. Nothing on the logging screen goes back, so
      // reopening the tool mid-session is the only way to stand on the home screen with
      // a workout still in progress -- which is the state the buttons come out for.
      first.remove();
      store.close();
      const reopened = await reopen(databaseName);
      const element = await mount(reopened);

      expect(readAll(element)).toContain(HOME_NOTES.resumeNote);
      await historyRow(element, source.id);
      // Omitted rather than disabled, and explained once above the list instead of eight
      // silent dead ends inside it.
      expect(deepAll(shadow(element), '[data-action="repeat-workout"]')).toHaveLength(0);
      expect(readAll(element)).toContain(HISTORY_NOTES.repeatBusy);

      // With nothing to press, nothing moved: the session waiting to be resumed is the
      // one that was there, and the row nobody could copy is unchanged.
      expect(await reopened.readActiveId()).toBe(open);
      expect(await reopened.readWorkout(source.id)).toEqual(source);
    });

    it('says so and stays put when the workout cannot be read back', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(unreadable(store));

      const row = await historyRow(element, source.id);
      // Not `repeat`: there is no logging screen coming, and waiting for one would time
      // out rather than report the sentence this case is about.
      nativeButton(control(row, 'repeat-workout')).click();
      await vi.waitFor(async () => {
        await element.updateComplete;
        expect(readAll(element)).toContain(HOME_NOTES.repeatFailed);
      });

      // Still on the home screen, with the row that would not open still on it. A tool
      // that navigated and then apologised would have taken the lifter away from the
      // only thing they could try again.
      expect(setRows(element)).toHaveLength(0);
      expect(deepAll(shadow(element), '[data-action="start-workout"]')).toHaveLength(1);
      expect(readAll(element)).not.toContain(HOME_NOTES.resumeNote);
      // And nothing was started or written. The sentence says the workout is still
      // saved, so it had better be.
      expect(await store.readActiveId()).toBeNull();
      expect(await store.readWorkouts()).toHaveLength(1);
    });
  });

  /**
   * Section 5.4, from the row to the record.
   *
   * The leaf suites either side of this one prove that a row dispatches an identifier
   * and that a detail screen draws a session it is handed. Neither can see the read in
   * between, which is the whole of this journey: the identifier off a press has to reach
   * `getWorkout`, and what comes back has to be the workout that was pressed rather than
   * the one the tool happened to have in hand.
   *
   * On the durable store, because a read is only interesting where something was
   * written down first.
   */
  describe('reading a workout back', () => {
    it('opens the workout that was pressed, with what was actually lifted on it', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);

      const screen = await open(element, await historyRow(element, source.id));

      const said = readAll(screen);
      expect(said).toContain(REPEATED_TITLE);
      expect(said).toContain(REPEATED_DAY);
      // Every set of the source, not a summary of them: the summary on the row it was
      // opened from already had the count, and the sets are the reason to press it.
      expect(deepAll(shadow(screen), 'li[data-set]')).toHaveLength(
        source.exercises.flatMap((exercise) => exercise.sets).length,
      );
      expect(said).toContain(formatWeight({ amount: REPEATED_WEIGHT, unit: 'kg' }));
      // Read and not started. A press that quietly began a session would look almost
      // right -- a screenful of the same sets -- and would be the tool writing to a
      // history it was asked to show.
      expect(await store.readActiveId()).toBeNull();
      expect(await store.readWorkout(source.id)).toEqual(source);
    });

    it('goes back to the home screen with the history still on it', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await open(element, await historyRow(element, source.id));

      nativeButton(control(shadow(element), 'home')).click();
      await settle(element);

      // The row is back, which means the history was read again rather than kept: going
      // home is the one route in this tool that reloads it, and a detail screen that
      // returned to a stale list would be the first place that showed.
      await historyRow(element, source.id);
      expect(deepAll(shadow(element), 'ptk-workout-detail')).toHaveLength(0);
      expect(deepAll(shadow(element), '[data-action="start-workout"]')).toHaveLength(1);
    });

    it('says the workout could not be read, instead of drawing an empty one', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(unreadable(store));

      const screen = await open(element, await historyRow(element, source.id));

      // The screen changes even though the read failed. A press that appeared to do
      // nothing gets pressed again, and the second press fails the same way.
      expect(readAll(screen)).toContain(DETAIL_NOTES.unreadable);
      // And it does not read as "you did nothing that day", which is the other sentence
      // this screen has and the wrong one here.
      expect(readAll(screen)).not.toContain(DETAIL_NOTES.empty);
    });

    it('opens a past workout while a session is in progress', async () => {
      const { store, databaseName } = await durableStore();
      const source = await seedRepeatable(store);
      const first = await mount(store);
      await planASquatSession(first);
      const openSession = await store.readActiveId();

      // The refresh for the reason the repeat case above needs one: nothing on the
      // logging screen goes back, so reopening the tool is the only way to stand on the
      // home screen with a workout still in progress.
      first.remove();
      store.close();
      const reopened = await reopen(databaseName);
      const element = await mount(reopened);
      expect(readAll(element)).toContain(HOME_NOTES.resumeNote);

      const screen = await open(element, await historyRow(element, source.id));

      // Reading last week cannot disturb this week. The Repeats are withdrawn while a
      // session is open and Open is not, because only one of those two starts anything.
      expect(readAll(screen)).toContain(REPEATED_TITLE);
      expect(await reopened.readActiveId()).toBe(openSession);

      // And the session is still waiting when the lifter comes back out.
      nativeButton(control(shadow(element), 'home')).click();
      await settle(element);
      expect(readAll(element)).toContain(HOME_NOTES.resumeNote);
      expect(await reopened.readActiveId()).toBe(openSession);
    });
  });

  /**
   * Section 5.5, from a lift on a screen to that lift across every session.
   *
   * Two screens open this one and the leaf suites prove each of them dispatches a
   * catalogue identifier. What neither can see is the half in between: the identifier
   * has to reach a scan of the whole history, the scan has to answer about the lift that
   * was pressed, and -- the part with nothing else guarding it -- the way back has to
   * return to whichever of the two screens asked. A lifter who looked something up
   * mid-session and was put on the home screen for it has lost their place at the rack,
   * which is the one thing this screen must not cost.
   *
   * On the durable store, because a history is only interesting where sessions were
   * written down first.
   */
  describe('reading a lift back', () => {
    it('reads the lift that was pressed, across the sessions it appears in', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      const workout = await open(element, await historyRow(element, source.id));

      const screen = await openHistory(element, shadow(workout));

      expect(shadow(screen).querySelector('h2')?.textContent.trim()).toBe(SQUAT.name);
      const said = readAll(screen);
      expect(said).toContain(REPEATED_DAY);
      expect(said).toContain(formatWeight({ amount: REPEATED_WEIGHT, unit: 'kg' }));
      // Read and nothing else. The screen it was opened from is a record, and a press
      // that touched it would be the tool editing a history it was asked to explain.
      expect(await store.readWorkout(source.id)).toEqual(source);
    });

    it('reads the second lift on the screen when that is the one pressed', async () => {
      // The identifier has to survive the whole trip. A root that reached for the first
      // lift of the session, or for the one the detail screen happened to draw first,
      // passes the case above and fails here.
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      const workout = await open(element, await historyRow(element, source.id));
      const bench = deepAll(shadow(workout), 'li[data-exercise]')[1];
      if (bench === undefined) throw new Error('The workout is drawing fewer than two lifts.');

      const screen = await openHistory(element, bench);

      expect(shadow(screen).querySelector('h2')?.textContent.trim()).toBe(BENCH.name);
    });

    it('goes back to the workout it was opened from, and not to the home screen', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      const workout = await open(element, await historyRow(element, source.id));
      await openHistory(element, shadow(workout));

      nativeButton(control(shadow(element), 'records-back')).click();
      await settle(element);

      expect(deepAll(shadow(element), 'ptk-exercise-history')).toHaveLength(0);
      expect(deepAll(shadow(element), 'ptk-workout-detail')).toHaveLength(1);
      expect(readAll(element)).toContain(REPEATED_TITLE);
    });

    it('gives a lifter their session back after they look something up', async () => {
      // The reason the origin is remembered at all. Section 5.5 puts the way in on the
      // logging screen, so this is the ordinary use -- what did I do this for last time,
      // asked between two sets -- and Back landing anywhere but here ends the workout as
      // far as the lifter standing at the rack is concerned.
      const { store } = await durableStore();
      await seedRepeatable(store);
      const element = await mount(store);
      await planASquatSession(element);
      const openSession = await store.readActiveId();

      const screen = await openHistory(element, shadow(element));

      // The session on screen is planned and not performed, so it contributes nothing
      // to its own history: the number here can only have come out of storage.
      expect(readAll(screen)).toContain(formatWeight({ amount: REPEATED_WEIGHT, unit: 'kg' }));

      nativeButton(control(shadow(element), 'records-back')).click();
      await settle(element);

      expect(deepAll(shadow(element), 'ptk-active-workout')).toHaveLength(1);
      expect(deepAll(shadow(element), '[data-action="start-workout"]')).toHaveLength(0);
      expect(await store.readActiveId()).toBe(openSession);
    });

    it('says the history could not be read, instead of drawing a lift with nothing in it', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(unscannable(store));
      const workout = await open(element, await historyRow(element, source.id));

      const screen = await openHistory(element, shadow(workout));

      // The screen changes even though the read failed, `#open`'s rule and `#open`'s
      // reason: a press that appears to do nothing gets pressed again.
      expect(readAll(screen)).toContain(RECORDS_NOTES.unreadable);
      // And it must not read as "you have never done this", which is the other sentence
      // this screen has and a lie about a lift that is on the page behind it.
      expect(readAll(screen)).not.toContain(RECORDS_NOTES.empty);
    });
  });

  /**
   * Section 5.4's edit, from a workout in the history back onto the screen that logged it.
   *
   * The leaf suites can see that the logging screen suppresses its finish flow when it is
   * told the session is already recorded, and `repository.test.ts` can see that
   * `saveWorkout` leaves the active pointer alone. What only a journey can see is the
   * join: a correction made through the same controls a live session uses has to land in
   * the history record, not in a new one and not in the workout in progress, and the
   * screen behind it has to agree with storage afterwards.
   *
   * On the durable store, for the reason the repeat and note journeys are: `#persist`
   * returns early where the repository is not durable, so these would pass against a
   * journey in which nothing was written at all.
   */
  describe('correcting a workout in the history', () => {
    it('writes the correction to the workout it was opened from', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await edit(element, source.id);

      await correctReps(element, 0, '4');

      const stored = await store.readWorkout(source.id);
      if (stored === null) throw new Error('The workout being corrected has gone.');
      expect(performedReps(stored, 0)).toBe(4);
      // The same identifier and the same day. A correction that wrote a second record,
      // or re-dated this one to today, would leave a lifter with two Tuesdays.
      expect(stored.id).toBe(source.id);
      expect(stored.localDate).toBe(REPEATED_DAY);
    });

    it('leaves the tool with no workout in progress', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await edit(element, source.id);

      await correctReps(element, 0, '4');

      // The one thing `saveWorkout` exists for. `saveActiveWorkout` would have made a
      // session from February the workout the tool offers to carry on with, which is
      // the failure a lifter would find at the rack a week later.
      expect(await store.readActiveId()).toBeNull();
    });

    it('offers no way to finish a workout that is already finished', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);

      await edit(element, source.id);

      // Section 0.4. The rest of the screen is deliberately identical, so the absence
      // of this one control is the whole of what `past` means.
      expect(deepAll(shadow(element), '[data-action="finish"]')).toHaveLength(0);
      expect(setRows(element).length).toBeGreaterThan(0);
    });

    it('shows the correction on the screen it goes back to', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await edit(element, source.id);
      await correctReps(element, 0, '4');

      await press(element, 'edit-done');

      await vi.waitFor(async () => {
        await element.updateComplete;
        expect(deepAll(shadow(element), 'ptk-workout-detail')).toHaveLength(1);
      });
      const said = readAll(element);
      // The weight as well as the reps. This session was recorded in kilograms and is
      // being read back by a lifter set to pounds, which is the case that used to come
      // out of the editor relabelled -- correcting the reps must not touch the bar.
      expect(said).toContain(`${formatWeight({ amount: REPEATED_WEIGHT, unit: 'kg' })} x 4`);
      // The planned line under it, which is the detail screen saying the row was
      // corrected rather than logged that way.
      expect(said).toContain(DETAIL_NOTES.plannedLabel);
    });

    it('changes the shape of a lift in the record, and not only on the screen', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const before = setCount(source, 0);
      const element = await mount(store);
      await edit(element, source.id);

      await press(element, 'edit', workingRow(element, 0));
      await press(element, 'remove-set', workingRow(element, 0));

      // The other half of the wiring: section 7.7's changes leave the screen as an
      // event the root applies, and the root has to apply them to the session being
      // corrected rather than to whatever it last had in progress.
      const stored = await store.readWorkout(source.id);
      if (stored === null) throw new Error('The workout being corrected has gone.');
      expect(setCount(stored, 0)).toBe(before - 1);
    });

    it('brings the history list up to date with what was corrected', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      const listed = rowText(await historyRow(element, source.id));
      await edit(element, source.id);
      await press(element, 'edit', workingRow(element, 0));
      await press(element, 'remove-set', workingRow(element, 0));
      await press(element, 'edit-done');

      await press(element, 'home');

      // The completed-set count is a summary field and a removed working row moves it.
      // A list left as it was would disagree with the workout one press behind it.
      expect(listed).toContain(`${String(REPEATED_SETS * 2)} ${HISTORY_NOTES.setsLabel}`);
      await vi.waitFor(async () => {
        expect(rowText(await historyRow(element, source.id))).toContain(
          `${String(REPEATED_SETS * 2 - 1)} ${HISTORY_NOTES.setsLabel}`,
        );
      });
    });

    it('does not announce a corrected set as a set just done', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      const completed = record(SET_COMPLETED_EVENT);
      await edit(element, source.id);

      await press(element, 'undo', setRow(element, 0));
      await press(element, 'complete', setRow(element, 0));

      // Section 12.5's event says a set was just done, and section 8's rest timer is
      // the consumer of it. Ticking a row on a session from February did not do a set,
      // and a timer starting for one is the tool getting the lifter's day wrong.
      expect(completed).toEqual([]);
      expect(isDone(setRow(element, 0))).toBe(true);
    });

    it('goes back to the workout being corrected after a lift is read back', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await edit(element, source.id);

      await openHistory(element, shadow(element));
      await press(element, 'records-back');

      // The way in from a live session and the way in from a corrected one are the same
      // control on the same element, so the return has to be told apart by where it was
      // pressed. Landing on the home screen here would throw away the correction in
      // progress as surely as it would throw away a lifter's place at the rack.
      expect(deepAll(shadow(element), 'ptk-exercise-history')).toHaveLength(0);
      expect(deepAll(shadow(element), 'ptk-active-workout')).toHaveLength(1);
      expect(readAll(element)).toContain(EDIT_NOTES.note);
    });
  });

  /**
   * Section 7.9, from the box to the database.
   *
   * The leaf suite proves what a note box does to a session held in a property, and
   * `session.test.ts` proves what the setters do to a session. Neither can see the
   * only thing that matters at a rack: whether the words a lifter typed are still
   * there tomorrow. Nothing here is pressed to save -- the write is a debounce, a
   * blur and a fold into every other edit -- so every one of these journeys ends at
   * storage, read back through the repository rather than off the element.
   *
   * On the durable store for the reason the repeat cases above are: `#persist`
   * returns early where the repository is not durable, so the same cases on the
   * memory store would assert their way through a journey in which nothing was
   * written and pass.
   */
  describe('a note a lifter wrote', () => {
    it("puts the workout's own note in storage, and not only on the screen", async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await writeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);

      expect((await activeWorkout(store)).note).toBe(WORKOUT_NOTE);

      // And read back to the lifter once the box is closed. The logging screen
      // renders the session the root hands back down, so a root that took the event
      // and dropped the session would still show the box that was typed into and
      // nothing under it -- with the words in the database either way.
      await pressNote(element, WORKOUT_NOTE_KEY);
      expect(writtenNotes(element)).toEqual([WORKOUT_NOTE]);
    });

    it('files a note about one lift against that row, and leaves the session alone', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      // The row in this session, which is what the key names. Keyed on the catalogue
      // identifier instead, a session with squats in it twice would show one note
      // under both -- and `noteControl` would not find this button at all.
      const key = noteKeyFor(await activeWorkout(store), 0);

      await writeNote(element, key, EXERCISE_NOTE);

      const stored = await activeWorkout(store);
      expect(exerciseAt(stored, 0).note).toBe(EXERCISE_NOTE);
      // The two controls are one line apart on screen, and a note filed under the
      // wrong one is invisible until somebody goes looking for it.
      expect(stored.note).toBeNull();
    });

    it('writes an emptied note back as nothing at all', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await writeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      expect((await activeWorkout(store)).note).toBe(WORKOUT_NOTE);

      // Whitespace rather than the empty string: a box one backspace short of empty
      // is the same intention, and stored as it arrives it leaves a history row
      // marked as carrying a note with nothing behind it to read.
      await typeNote(element, WORKOUT_NOTE_KEY, '   ');
      await leaveNote(element, WORKOUT_NOTE_KEY);

      expect((await activeWorkout(store)).note).toBeNull();
      await pressNote(element, WORKOUT_NOTE_KEY);
      expect(writtenNotes(element)).toEqual([]);
    });

    /**
     * Closing a box is not how its contents are lost, and neither is opening
     * another one.
     *
     * Section 7.9 puts no Save anywhere near a note, so the only events between a
     * lifter's last keystroke and their next tap are a blur and a click -- and the
     * browser is free to deliver those in either order. Here there is no blur at
     * all, which is the harder half: the press has to write the box it is closing,
     * and the press that moves to another lift's note has to write the first before
     * it adopts the second, or one draft is written into the other's note.
     */
    it('keeps both notes when each box is closed by a press and never left', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      const key = noteKeyFor(await activeWorkout(store), 0);

      await pressNote(element, WORKOUT_NOTE_KEY);
      await typeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      // Straight to the other note's button, mid-draft.
      await pressNote(element, key);
      await typeNote(element, key, EXERCISE_NOTE);
      await pressNote(element, key);

      const stored = await activeWorkout(store);
      expect(stored.note).toBe(WORKOUT_NOTE);
      expect(exerciseAt(stored, 0).note).toBe(EXERCISE_NOTE);
    });

    /**
     * A note half typed when the next set is ticked survives the tick.
     *
     * The same ordering problem as above, met on the control this whole screen
     * exists for. A lifter finishes a set, starts writing about it and taps Done
     * with the box still open -- and the set's own write is what goes to storage,
     * carrying whichever session the screen handed over. Built from the property
     * without the draft folded in, that write is a note deleted by a tap on Done.
     */
    it('keeps a note being typed when the set beside it is ticked off', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await pressNote(element, WORKOUT_NOTE_KEY);
      await typeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      await press(element, 'complete', setRow(element, 0));

      const stored = await activeWorkout(store);
      expect(stored.note).toBe(WORKOUT_NOTE);
      // Both, and not one at the price of the other: a tick that quietly dropped
      // the note would pass an assertion made only about the note's absence.
      expect(isDone(setRow(element, 0))).toBe(true);
      expect(exerciseAt(stored, 0).sets[0]?.status).toBe('complete');
    });

    /**
     * Section 7.12.4, and the case with nowhere else to be caught.
     *
     * The finish panel draws its own box, open, with no button to press first -- so
     * the last note of a session is routinely typed and then confirmed, with no blur
     * and no debounce between the two. Finish dispatches the finished session and no
     * other, so a draft still sitting in the box at that moment exists nowhere else
     * in the program and is gone with the screen.
     */
    it('keeps a note typed into the finish panel and never left', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));
      const id = (await activeWorkout(store)).id;

      await press(element, 'finish');
      // Answered before the note is typed, so that the last thing to happen to the
      // box is the keystroke. A press after it could plausibly blur the field, and
      // this case would then prove the blur path a second time instead.
      await choose(element, 'ptk-choice-group', 'skip');
      await typeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      await press(element, 'finish-confirm');

      const stored = await store.readWorkout(id);
      expect(stored?.status).toBe('completed');
      expect(stored?.note).toBe(WORKOUT_NOTE);
      // Finished as well as noted: a session left open would be resumable, and the
      // assertion above would hold against a note the lifter has to finish again to
      // keep.
      expect(await store.readActiveId()).toBeNull();
    });

    /**
     * The only trace a note left before this sub-task, and the only one on a screen
     * that is not showing the session.
     *
     * The mark and not the words: the history list is one line per workout and a
     * lifter's paragraph about their Tuesday does not go on it. `summary.test.ts`
     * owns which of the three kinds of note counts; what is asserted here is that
     * the count reaches a row at all, which is a walk from the box through storage
     * and back out through `listWorkouts`.
     */
    it('marks the row in the history of a session with a note in it', async () => {
      const { store } = await durableStore();
      // A finished session with nothing written on it, to pair against. Without it
      // this case passes against a row that says "Has notes" about every workout.
      const plain = await seedRepeatable(store);
      const element = await mount(store);
      await planASquatSession(element);
      const noted = (await activeWorkout(store)).id;

      await writeNote(element, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');
      await press(element, 'home');

      const row = await historyRow(element, noted);
      expect(row.textContent).toContain(HISTORY_NOTES.hasNotes);
      expect(row.textContent).not.toContain(WORKOUT_NOTE);
      expect((await historyRow(element, plain.id)).textContent).not.toContain(
        HISTORY_NOTES.hasNotes,
      );
    });

    /**
     * Section 18.9's promise, made about a note rather than about a set.
     *
     * The element and its database connection are both thrown away, so the lines on
     * the second screen can only have come from the disk. Both notes at once,
     * because they are stored in different places -- one on the session, one on a
     * row of it -- and a resume that read back only the first would look right.
     */
    it('shows both stored notes back on the logging screen after a refresh', async () => {
      const { store, databaseName } = await durableStore();
      const first = await mount(store);
      await planASquatSession(first);
      const key = noteKeyFor(await activeWorkout(store), 0);

      await writeNote(first, WORKOUT_NOTE_KEY, WORKOUT_NOTE);
      await writeNote(first, key, EXERCISE_NOTE);

      // The refresh.
      first.remove();
      store.close();

      const second = await mount(await reopen(databaseName));
      await press(second, 'resume-workout');

      // The lift's note above its sets, the session's at the foot, in that order.
      expect(writtenNotes(second)).toEqual([EXERCISE_NOTE, WORKOUT_NOTE]);
      // Closed. A session reopened with its boxes up would hide the first lift
      // behind two text areas nobody asked for.
      expect(deepAll(shadow(second), 'ptk-text-area[data-note]')).toHaveLength(0);
    });
  });

  /**
   * Section 7.10, from the control to the box it governs.
   *
   * The setting half of it, and only that half: `ptk-active-workout.browser.test.ts`
   * owns what the editor's effort box does to a set, on which scale, and what happens
   * to an effort recorded on the other one. What is under test here is the pair of
   * facts no leaf suite can see -- that the answer is written down rather than held
   * on a control, and that the two settings controls in one section, sending one
   * event carrying one string, do not write each other's field.
   *
   * On the durable store throughout, for the reason the repeat and note cases are:
   * `#persist` returns early where the repository is not durable, so a case that
   * asserted on stored settings over the memory store would assert nothing and pass.
   */
  describe('how effort is entered', () => {
    it('opens on Off for a lifter who has never answered it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      // Section 7.10's first-use default, read off the control rather than off the
      // settings: a scale chosen on the lifter's behalf puts a box in the editor
      // that nothing on the logging screen explains the arrival of.
      expect(chosenSetting(element, EFFORT_SETTING_FIELD)).toBe('none');
      // Off first, and all three offered. A control opening on Off because Off is
      // the only answer it draws would satisfy the line above.
      expect(
        settingSegments(element, EFFORT_SETTING_FIELD).map((segment) => segment.value),
      ).toEqual(['none', 'rpe', 'rir']);
      // And nothing was written to get there. The default belongs to the repository,
      // not to a settings row the tool saved over an empty database on first boot.
      expect((await store.readSettings())?.effort ?? null).toBeNull();
    });

    it('writes the chosen scale down, and opens on it after a refresh', async () => {
      const { store, databaseName } = await durableStore();
      const first = await mount(store);

      await chooseSetting(first, EFFORT_SETTING_FIELD, 'rpe');

      // Awaited through the storage the setting actually went to, and not through the
      // control: a segmented that only moved its own property satisfies every
      // assertion made against the screen it is on, and loses the answer at the
      // refresh -- which for a preference is where it is next read.
      await vi.waitFor(async () => {
        expect((await store.readSettings())?.effort).toBe('rpe');
      });

      // The refresh.
      first.remove();
      store.close();

      const second = await mount(await reopen(databaseName));
      expect(chosenSetting(second, EFFORT_SETTING_FIELD)).toBe('rpe');
    });

    /**
     * The two controls do not write each other's field.
     *
     * This pair is the whole reason `#onSetting` routes on `data-field`. Both
     * controls are a `ptk-segmented`, both send `SEGMENTED_CHANGE_EVENT` carrying
     * nothing but a string, and one listener on the root hears both -- so the only
     * thing standing between a lifter choosing RIR and their logbook switching to
     * kilograms is which key the handler reads. Asserting on the setting that was
     * chosen cannot see any of that; asserting on the one that was not is what can.
     */
    it('leaves the unit alone when an effort scale is chosen', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      expect(chosenSetting(element, UNIT_SETTING_FIELD)).toBe(UNIT);

      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rir');

      await vi.waitFor(async () => {
        expect((await store.readSettings())?.effort).toBe('rir');
      });
      expect((await store.readSettings())?.displayUnit).toBe(UNIT);
      expect(chosenSetting(element, UNIT_SETTING_FIELD)).toBe(UNIT);
    });

    it('leaves the effort scale alone when the unit is chosen', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseSetting(element, UNIT_SETTING_FIELD, 'kg');

      await vi.waitFor(async () => {
        expect((await store.readSettings())?.displayUnit).toBe('kg');
      });
      // Off, and not merely unchanged on screen. A unit press that switched effort on
      // would put a third box in the editor of every session afterwards, and the
      // lifter's only clue would be the box.
      expect((await store.readSettings())?.effort).toBe('none');
      expect(chosenSetting(element, EFFORT_SETTING_FIELD)).toBe('none');
    });

    it('writes nothing when the answer already on screen is chosen again', async () => {
      const { store } = await durableStore();
      const { store: counted, calls } = countingSettings(store);
      const element = await mount(counted);
      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rpe');
      await vi.waitFor(async () => {
        expect((await store.readSettings())?.effort).toBe('rpe');
      });

      const before = calls.writes;
      // Or the assertion below holds against a tool that never wrote anything.
      expect(before).toBeGreaterThan(0);

      // The segment already chosen, pressed again -- which is what checking what the
      // setting says looks like from the tool's side.
      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rpe');
      // And reported by a consumer, which is the only way past the control's own
      // deduplication and therefore the only way to the guard in `#onSetting`. Both
      // branches, because both keep one and they are separate lines.
      await reportSetting(element, EFFORT_SETTING_FIELD, 'rpe');
      await reportSetting(element, UNIT_SETTING_FIELD, UNIT);

      expect(calls.writes).toBe(before);
      expect(chosenSetting(element, EFFORT_SETTING_FIELD)).toBe('rpe');
      expect(chosenSetting(element, UNIT_SETTING_FIELD)).toBe(UNIT);
    });

    it('explains the scale that was chosen, and only that one', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      const off = readAll(element);
      expect(off).toContain(EFFORT_SETTING_NOTES.none);
      expect(off).not.toContain(EFFORT_SETTING_NOTES.rpe);
      expect(off).not.toContain(EFFORT_SETTING_NOTES.rir);

      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rir');

      const rir = readAll(element);
      expect(rir).toContain(EFFORT_SETTING_NOTES.rir);
      // Section 7.10: never both scales at once. Three sentences under the control
      // read as a glossary, which is how somebody comes away believing the tool
      // records both -- and it would pass an assertion made only about the chosen
      // one, since the chosen one would be in there too.
      expect(rir).not.toContain(EFFORT_SETTING_NOTES.rpe);
      expect(rir).not.toContain(EFFORT_SETTING_NOTES.none);
      // The sentence about what switching off does is not one of the three and stays
      // whatever is chosen. Without it, turning effort off reads as deleting the
      // efforts already recorded.
      expect(rir).toContain(HOME_NOTES.effortNote);
    });

    /**
     * The answer given on the home screen reaches the screen it is about.
     *
     * The binding and nothing below it: what the box does to a set, and what it does
     * with an effort recorded on the other scale, are the other suite's. What only a
     * root-mounted case can see is that the editor was built from the stored setting
     * -- a dropped `.effort` binding leaves an editor with no effort box, which is
     * also exactly what the tool correctly draws for the lifter in the next case.
     */
    it('puts an effort box in the editor once a scale is chosen', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rpe');
      await planASquatSession(element);
      await press(element, 'edit', setRow(element, 0));

      expect(effortBoxes(setRow(element, 0))).toHaveLength(1);
      // Named on the scale that was chosen. A box labelled for the other one is a
      // number stored against the wrong meaning, in the direction that makes an easy
      // set read as a brutal one.
      const text = readAll(element);
      expect(text).toContain(EFFORT_FIELD_LABELS.rpe);
      expect(text).not.toContain(EFFORT_FIELD_LABELS.rir);
    });

    it('draws no effort box while effort is off', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await press(element, 'edit', setRow(element, 0));

      expect(effortBoxes(setRow(element, 0))).toHaveLength(0);
      // The reps box is the pairing: without it this case passes against an editor
      // that failed to open at all, which is the same absence for a different reason.
      expect(field(setRow(element, 0), 'done-reps')).not.toBeNull();
      const text = readAll(element);
      expect(text).not.toContain(EFFORT_FIELD_LABELS.rpe);
      expect(text).not.toContain(EFFORT_FIELD_LABELS.rir);
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

    /**
     * Nor does a preference, which had been the one handler that let its event out.
     *
     * A `ptk-segmented` change is `composed` like everything else in `packages/ui`,
     * and the two settings controls are the only ones the root itself listens to --
     * so until `#onSetting` stopped it, `{value: 'rpe'}` and `{value: 'kg'}` were
     * arriving at whatever the embedding page has bound to `document`. Neither is
     * training and section 12.5 is arguably untouched by either, which is exactly
     * why it survived: the boundary is worth keeping as a boundary rather than as a
     * judgement made one event at a time about which leak matters. A preference is
     * still application state, and section 2.5 grants a framing page none of it.
     *
     * Both controls, because they are two calls to the same handler and a guard that
     * covered one of them would look right in the diff.
     */
    it('keeps a setting inside the tool', async () => {
      const changed = record(SEGMENTED_CHANGE_EVENT);

      const { store } = await durableStore();
      const element = await mount(store);
      await chooseSetting(element, EFFORT_SETTING_FIELD, 'rpe');
      await chooseSetting(element, UNIT_SETTING_FIELD, 'kg');

      // The settings themselves, so this cannot pass against two presses that missed.
      expect(chosenSetting(element, EFFORT_SETTING_FIELD)).toBe('rpe');
      expect(chosenSetting(element, UNIT_SETTING_FIELD)).toBe('kg');
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

      // Both scales, and before the walk rather than instead of it.
      //
      // The three sentences under the effort control are the only copy anywhere in
      // the tool whose whole job is to describe difficulty, and section 7.10 puts
      // exactly one of them on screen at a time. So a walk that never chooses a
      // scale reads the "no effort box" sentence at every stage and pronounces the
      // vocabulary clean, having never seen two thirds of the copy most likely to
      // fail this. That is not hypothetical: the RPE and RIR sentences said "is
      // harder" until this case was widened, and `hard` is on the list below.
      for (const scale of ['rpe', 'rir'] as const) {
        await chooseSetting(element, EFFORT_SETTING_FIELD, scale);
        screens.push(readAll(element));
      }

      await press(element, 'start-workout');
      screens.push(readAll(element));
      await press(element, 'add-primary');
      await press(element, 'start');
      screens.push(readAll(element));
      // Opened rather than only ticked off, because the effort box and its hint are
      // drawn only here -- and the setting is left on RIR, so what the walk reads
      // from this point on is the screen a lifter recording effort actually sees.
      await press(element, 'edit', setRow(element, 0));
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
