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

import {
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  readBackup,
  serializeBackup,
  type RestoreProblemCode,
  type TrainingLogbookBackup,
} from '../core/backup.js';
import { calendarDayOf } from '../core/calendar.js';
import { PRIMARY_EXERCISES, findExercise } from '../core/catalog.js';
import { AT_LATER, AT_START, ON_DAY } from '../core/context.fixture.js';
import { createCustomExercise } from '../core/catalog.js';
import { createProfile } from '../core/equipment.js';
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
import type { StorageDurability, StoragePersistence } from '../storage/persistence.js';
import type { LogbookStore } from '../storage/port.js';
import {
  createRepository,
  defaultSettings,
  type TrainingLogbookRepository,
} from '../storage/repository.js';
import type {
  CalendarDay,
  CustomExercise,
  EquipmentProfile,
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
  PERSIST_NOTES,
  RECORDS_NOTES,
  DELETE_NOTES,
  RESTORE_NOTES,
  RESTORE_REFUSALS,
  REST_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  SCREEN_NOTES,
  UNIT_LABELS,
} from './copy.js';
import {
  DONE_EFFORT_FIELD,
  EFFORT_SETTING_FIELD,
  REST_DURATION_FIELD,
  REST_LIFT_DURATION_FIELD,
  REST_SETTING_FIELD,
  UNIT_SETTING_FIELD,
  WORKOUT_NOTE_KEY,
  exerciseNoteKey,
} from './dataset.js';
import {
  BACKUP_EXPORTED_EVENT,
  BACKUP_RESTORED_EVENT,
  LOCAL_DATA_CLEARED_EVENT,
  SET_COMPLETED_EVENT,
  WORKOUT_COMPLETED_EVENT,
  WORKOUT_SAVED_EVENT,
  WORKOUT_STARTED_EVENT,
} from './events.js';
import { NOT_SET } from './format.js';
import { defineTrainingLogbook } from './index.js';
import { STORAGE_WAIT } from './storage.fixture.js';
import { planProblem } from './plan.js';
import { WORKOUT_CHANGED_EVENT } from './ptk-active-workout.js';
import type { PtkRestTimer } from './ptk-rest-timer.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';
import { FORBIDDEN, withoutExerciseNames } from './vocabulary.fixture.js';

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

async function mount(
  store: LogbookStore,
  handoff?: HandoffSource,
  persistence?: StoragePersistence,
): Promise<PtkTrainingLogbook> {
  const element = document.createElement('ptk-training-logbook');
  let next = 0;
  element.repository = createRepository(store, {
    now: () => clock,
    applicationVersion: VERSION,
  });
  element.handoff = handoff ?? null;
  element.persistence = persistence ?? null;
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
  }, STORAGE_WAIT);
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

/*
 * ---------------------------------------------------------------------------
 * Where focus is. Nothing else in this repository asks, so this is the pattern.
 * ---------------------------------------------------------------------------
 */

/**
 * The node that really has focus, walked down through every shadow root.
 *
 * `document.activeElement` stops at the outermost host, so with the whole tool inside
 * shadow roots it answers `<ptk-training-logbook>` whatever is focused -- an assertion
 * against it passes for every control on the screen and so distinguishes none of them.
 * Each root answers the same question for its own tree, and the walk down is what turns
 * that into a control.
 */
function deepActiveElement(): Element | null {
  let node: Element | null = document.activeElement;
  for (;;) {
    const inner = node?.shadowRoot?.activeElement ?? null;
    if (inner === null) return node;
    node = inner;
  }
}

/**
 * The `data-action` of the focused control, read off whichever ancestor carries it.
 *
 * The name is on the host and focus is on the `<button>` inside its shadow root, so the
 * walk back up has to step over the boundary the same way the walk down stepped into
 * it. Asserting a control by its action rather than by its position is what stops a
 * case from passing because a row happens to draw its buttons in the order assumed.
 */
function focusedAction(): string | null {
  let node: Node | null = deepActiveElement();
  while (node !== null) {
    if (node instanceof HTMLElement) {
      const action = node.dataset['action'];
      if (action !== undefined) return action;
    }
    const parent: Node | null = node.parentNode;
    node = parent instanceof ShadowRoot ? parent.host : parent;
  }
  return null;
}

/** The accessible name of the focused node: its `aria-label`, else the text in it. */
function focusedName(): string {
  const node = deepActiveElement();
  if (node === null) return '';
  return (node.getAttribute('aria-label') ?? node.textContent).trim();
}

/**
 * Presses a control the way a pointer does, with focus landing on it first.
 *
 * `press` dispatches a click and nothing else, which is the right default for every
 * other case here and the wrong one for these: a real press focuses the control, and
 * the whole of what these cases are about is what happens to that focus when the
 * control is replaced. Without the focus call the row's restoration is asked to move
 * focus that was never there, which it declines to do -- correctly, and the case would
 * be measuring the decline.
 */
async function pressWithFocus(
  element: PtkTrainingLogbook,
  action: string,
  within: DocumentFragment | HTMLElement,
): Promise<void> {
  const button = nativeButton(control(within, action));
  button.focus();
  button.click();
  await settle(element);
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
  }, STORAGE_WAIT);
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
 * is none in the case this is for. The home screen's list is a walk and not a series of
 * key reads, so the row is drawn as usual and the failure arrives on the press -- which is
 * the order a lifter meets a record that has gone bad under them.
 */
function unreadable(store: LogbookStore): LogbookStore {
  return {
    ...store,
    readWorkout: () => Promise.reject(new Error('this record cannot be read')),
  };
}

/**
 * A store whose walk over the history can be broken partway through a case, which is the
 * one above's sibling and not the same thing.
 *
 * An exercise's history is `scanWorkouts` and never `readWorkout`, so {@link unreadable}
 * leaves it working perfectly -- a case that used it would open a full history and prove
 * nothing about the failure it named.
 *
 * Broken on demand rather than from the start, because boot is a walk now: the home
 * list is `listWorkouts`, which stops at the tenth row instead of reading everything but
 * is still a scan. A store that refused every scan could not be mounted, so a case built
 * on one would be measuring the boot path and not the screen it names. Breaking it after
 * the element is up is also the truer story, and the same one {@link unreadable} tells --
 * a record goes bad under a lifter who already has the tool open.
 */
function unscannable(store: LogbookStore): { store: LogbookStore; breakTheWalk: () => void } {
  let broken = false;
  return {
    store: {
      ...store,
      scanWorkouts: (visit) =>
        broken
          ? Promise.reject(new Error('the history cannot be walked'))
          : store.scanWorkouts(visit),
    },
    breakTheWalk: () => {
      broken = true;
    },
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

/*
 * ---------------------------------------------------------------------------
 * The rest between sets. Section 7.11.
 * ---------------------------------------------------------------------------
 */

/**
 * The timer element, which the root draws above every screen and not inside one.
 *
 * Reached through `querySelector` rather than `deepAll` because everything below waits
 * on its `updateComplete`, and that needs the element's own type. It is a child of the
 * root's shadow root, so one hop finds it.
 */
function restTimer(element: PtkTrainingLogbook): PtkRestTimer {
  const found = shadow(element).querySelector('ptk-rest-timer');
  if (found === null) throw new Error('The tool is drawing no rest timer at all.');
  return found;
}

/**
 * The rest on screen, or `null` where there is none -- once the timer has caught up.
 *
 * The await is the whole reason this is a function rather than a selector. The root
 * owns the timer and assigns it down a property, so the child's render is scheduled by
 * the root's and `settle` returns one update too early: every assertion here would
 * otherwise be made against the rest as it was before the press.
 */
async function restBand(element: PtkTrainingLogbook): Promise<HTMLElement | null> {
  const timer = restTimer(element);
  await timer.updateComplete;
  return deepAll(shadow(timer), '.rest')[0] ?? null;
}

/** What the timer reads, in the digits a sighted lifter sees. */
async function restDigits(element: PtkTrainingLogbook): Promise<string> {
  const band = await restBand(element);
  if (band === null) throw new Error('There is no rest on screen.');
  const shown = band.querySelector('.clock span[aria-hidden="true"]');
  if (shown === null) throw new Error('The rest timer is drawing no clock.');
  return shown.textContent.trim();
}

/** Presses one of the timer's own controls. */
async function pressRest(element: PtkTrainingLogbook, action: string): Promise<void> {
  const band = await restBand(element);
  if (band === null) throw new Error(`There is no rest on screen to ${action}.`);
  nativeButton(control(band, action)).click();
  await settle(element);
}

/**
 * Moves the clock the tool reads, and repaints the timer.
 *
 * Through `visibilitychange`, which is a path the timer really has and really needs.
 * Waiting for its own 250ms interval would put the wall clock into every case below and
 * three real minutes into the one about a rest running out, and a case that slept would
 * be asserting the sampling rate rather than the arithmetic.
 */
async function waitOut(element: PtkTrainingLogbook, seconds: number): Promise<void> {
  clock = new Date(Date.parse(clock) + seconds * 1000).toISOString();
  document.dispatchEvent(new Event('visibilitychange'));
  await restTimer(element).updateComplete;
}

/** The duration picker, which the settings section draws only where the timer is on. */
function restDurationPickers(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(element), `[data-field="${REST_DURATION_FIELD}"] ptk-select`);
}

/** Answers the duration picker the way the platform's own list does. */
async function chooseRestDuration(element: PtkTrainingLogbook, seconds: number): Promise<void> {
  const host = restDurationPickers(element)[0];
  if (host === undefined) throw new Error('The rest duration picker is not on screen.');
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error('The duration picker has not rendered.');
  select.value = String(seconds);
  // `change` and not `input`: a native select reports on change, which is also the one
  // event `ptk-select` listens for.
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(element);
}

/**
 * The squat, which is what `planASquatSession` puts in the session.
 *
 * Read from the catalogue rather than written out, because the name below is compared
 * against a label the tool builds from the same place -- a literal here would pass a
 * test that no longer describes the screen the day somebody rewords the entry.
 */
function theSquat(): { readonly id: string; readonly name: string } {
  const found = PRIMARY_EXERCISES[0];
  if (found === undefined) throw new Error('The catalogue has no primary lifts.');
  return { id: found.id, name: found.name };
}

/** The picker on the band, which is offered only for a rest the root can name. */
function liftRestPickers(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(
    shadow(restTimer(element)),
    `[data-field="${REST_LIFT_DURATION_FIELD}"] ptk-select`,
  );
}

/** Answers the band's picker the way the platform's own list does. */
async function chooseLiftRest(element: PtkTrainingLogbook, seconds: number): Promise<void> {
  await restBand(element);
  const host = liftRestPickers(element)[0];
  if (host === undefined) throw new Error('The band is offering no duration for this lift.');
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error('The band picker has not rendered.');
  select.value = String(seconds);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(element);
  await restTimer(element).updateComplete;
}

/** Switches the timer on and waits for the answer to reach storage. */
async function useRestTimer(element: PtkTrainingLogbook, store: LogbookStore): Promise<void> {
  await chooseSetting(element, REST_SETTING_FIELD, 'on');
  await vi.waitFor(async () => {
    expect((await store.readSettings())?.restTimer.enabled).toBe(true);
  });
}

/*
 * ---------------------------------------------------------------------------
 * Backups, and the file picker that reads one back. Section 10.7.
 * ---------------------------------------------------------------------------
 */

/** The title on the seeded session in progress. Its own, so it cannot be confused. */
const ACTIVE_TITLE = 'Invented Thursday, part way through';

/**
 * A session in progress in the store, as a page closed mid-workout would leave one.
 *
 * Its own identifier prefix, for `seedRepeatable`'s reason: a seeded workout sharing an
 * identifier with a live one is overwritten by that session's first save.
 */
async function seedActive(store: LogbookStore): Promise<WorkoutSession> {
  let next = 0;
  const context: SessionContext = {
    at: AT_START,
    nextId: (): LogbookId => {
      next += 1;
      return `mid-${String(next)}`;
    },
  };
  let session = createWorkout(context, { localDate: TODAY, title: ACTIVE_TITLE });
  session = addExercise(session, context, {
    exerciseId: SQUAT.id,
    displayName: SQUAT.name,
    loading: SQUAT.loading,
    plan: [
      {
        kind: 'working',
        performance: performance(
          { kind: 'implement', weight: { amount: REPEATED_WEIGHT, unit: 'kg' } },
          REPEATED_REPS,
        ),
      },
    ],
  });
  session = startWorkout(session, context);
  await store.writeWorkout(session, { kind: 'set' });
  return session;
}

/**
 * A backup document, written by the same code the download button uses.
 *
 * Built out of a real store and a real repository rather than out of a literal: what
 * the restore path has to accept is whatever the export path writes, and a hand-written
 * fixture is a second opinion about that which drifts the first time either moves.
 */
async function aBackup(
  seed?: (store: LogbookStore) => Promise<unknown>,
): Promise<TrainingLogbookBackup> {
  const store = memoryLogbookStore();
  await seed?.(store);
  const repository = createRepository(store, {
    now: () => clock,
    applicationVersion: VERSION,
  });
  return repository.exportSnapshot();
}

/** Whatever puts one kind of thing on a device. */
type Seeder = (store: LogbookStore) => Promise<unknown>;

/** A saved rack, so a device can hold something that is not a workout. Section 5.1. */
function aProfile(): EquipmentProfile {
  return createProfile('The garage', aGym(), {
    at: AT_START,
    nextId: (): LogbookId => 'rack-1',
  });
}

/**
 * The number the delete screen printed under one of its labels.
 *
 * Read out of the definition list by position rather than by searching the rendered
 * text, because a count of 1 against a whole screen is a substring of the year in
 * every timestamp on it -- an assertion on `readAll` would pass with the number
 * missing entirely.
 */
function deletionCount(element: PtkTrainingLogbook, label: string): string | null {
  for (const pair of deepAll(shadow(element), '.facts > div')) {
    if (pair.querySelector('dt')?.textContent.trim() === label) {
      return pair.querySelector('dd')?.textContent.trim() ?? null;
    }
  }
  return null;
}

/** A movement the lifter invented, so a device can hold one. */
function anInventedExercise(): CustomExercise {
  return createCustomExercise(
    {
      name: 'Belt squat, the one at the garage',
      loading: 'machine-or-cable-weight',
      warmupFamily: null,
      defaultUnit: null,
    },
    { at: AT_START, nextId: (): LogbookId => 'mine-1' },
  );
}

function fileOf(text: string): File {
  return new File([text], 'backup.json', { type: 'application/json' });
}

/** The same document, as a thing a lifter picked off their disk. */
async function aBackupFile(seed?: (store: LogbookStore) => Promise<unknown>): Promise<File> {
  return fileOf(serializeBackup(await aBackup(seed)));
}

/** The clipped input the Restore button stands in for. Only on the home screen. */
function fileInput(element: PtkTrainingLogbook): HTMLInputElement {
  const input = shadow(element).querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('This screen is drawing no file input.');
  }
  return input;
}

/**
 * Hands the tool a file the way the picker does.
 *
 * Through a `DataTransfer`, because `files` cannot be assigned any other way, and the
 * `change` is dispatched at the input rather than at the host because that is where the
 * handler is bound and `currentTarget` is what it reads.
 */
async function chooseFile(element: PtkTrainingLogbook, file: File): Promise<void> {
  const input = fileInput(element);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

/**
 * Waits for a sentence to reach the screen.
 *
 * Polled, and not counted in macrotasks: reading a file settles on its own task source
 * in its own time, and a fixed number of ticks is the kind of thing that holds on one
 * machine for months and then does not.
 */
async function waitForText(element: PtkTrainingLogbook, text: string): Promise<void> {
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(readAll(element)).toContain(text);
  }, STORAGE_WAIT);
}

/**
 * Mounts a swapped repository under a tool that is already up.
 *
 * Section 10.7's steps 8 and 10 are about a write that does not land, and neither
 * IndexedDB nor the memory store can be told to fail on demand -- so the failure goes in
 * at the seam the element actually calls. Assigning `repository` reloads, which is why
 * this settles before it returns.
 */
async function withRepository(
  element: PtkTrainingLogbook,
  swap: (repository: TrainingLogbookRepository) => TrainingLogbookRepository,
): Promise<void> {
  const repository = element.repository;
  if (repository === null) throw new Error('This tool was mounted without a repository.');
  element.repository = swap(repository);
  await settle(element);
}

/**
 * A browser that answers the two storage questions, and counts them.
 *
 * Both answers are supplied separately because the pair is what half of these cases
 * are about: a browser that has not committed and then grants the request draws a
 * different screen from one that has not committed and refuses it, and the element
 * cannot tell them apart from the state it starts in.
 */
interface FakePersistence extends StoragePersistence {
  /** Every promise handed out, so a case can wait for the element to have taken it in. */
  readonly given: Promise<unknown>[];
  readonly calls: { reads: number; asks: number };
}

function persistencePort(now: StorageDurability, answer: StorageDurability = now): FakePersistence {
  const given: Promise<unknown>[] = [];
  const calls = { reads: 0, asks: 0 };
  const hand = (value: StorageDurability): Promise<StorageDurability> => {
    const promise = Promise.resolve(value);
    given.push(promise);
    return promise;
  };
  return {
    given,
    calls,
    durability: (): Promise<StorageDurability> => {
      calls.reads += 1;
      return hand(now);
    },
    request: (): Promise<StorageDurability> => {
      calls.asks += 1;
      return hand(answer);
    },
  };
}

/**
 * Waits for the element to have taken in everything the port handed it.
 *
 * The offer's *absence* is what four of these cases assert, and a negative cannot be
 * polled for -- so the wait has to be on the port's side rather than on the screen.
 * Awaiting the same promises the element awaited is enough, and is not a sleep: the
 * element registered its continuations on those promises before this did, so by the
 * time it resumes the state is assigned and the render already requested.
 */
async function quiet(element: PtkTrainingLogbook, port: FakePersistence): Promise<void> {
  await Promise.all(port.given);
  await element.updateComplete;
}

/** The tool over a device whose browser will answer, with the first answer already in. */
async function mountKeeping(
  store: LogbookStore,
  port: FakePersistence,
): Promise<PtkTrainingLogbook> {
  const element = await mount(store, undefined, port);
  await quiet(element, port);
  return element;
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
  /**
   * The property a host is most likely to forget, and the one nothing refuses.
   *
   * `today` is structurally a string, so an unset host is not a type error, not a
   * validation failure and not a visible fault -- it is every session filed under
   * the empty day and every export named after nothing. There is no way to notice
   * from inside the tool, which is what makes it worth a case of its own now that
   * mounting this element directly is a supported thing to do.
   */
  describe('a host that never said what day it is', () => {
    it('files the session under the real day rather than under nothing', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      // Exactly what never setting the property leaves behind. Set after the mount
      // rather than by a second fixture, because the day is resolved at each use and
      // not once at construction -- the two arrangements are the same arrangement.
      element.today = '';
      await settle(element);

      await planASquatSession(element);
      await settle(element);

      const [stored] = await store.readWorkouts();
      expect(stored?.localDate).toBe(calendarDayOf(clock));
    });
  });

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
      const walk = unscannable(store);
      const element = await mount(walk.store);
      const workout = await open(element, await historyRow(element, source.id));
      // Only now, so the history the lifter opened this from is the real one.
      walk.breakTheWalk();

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

  describe('the rest between sets', () => {
    it('offers no duration until the timer is switched on', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      // Off for a lifter who has never answered it, and the picker absent rather than
      // greyed out -- root 0.4 forbids a disabled control standing in for a feature,
      // and a picker that changes nothing is the same thing with a better excuse.
      expect(chosenSetting(element, REST_SETTING_FIELD)).toBe('off');
      expect(restDurationPickers(element)).toHaveLength(0);
      // And the section says what the timer does not do. A lifter who expects a buzz
      // in their pocket finds out at the rack.
      expect(readAll(element)).toContain(REST_NOTES.settingNote);

      await useRestTimer(element, store);
      expect(restDurationPickers(element)).toHaveLength(1);
    });

    it('draws no rest at all for a lifter who has the timer off', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await press(element, 'complete', setRow(element, 0));

      // The set was done, so the absence below is the setting and not a tick that
      // failed to land.
      expect(isDone(setRow(element, 0))).toBe(true);
      expect(await restBand(element)).toBeNull();
    });

    it('starts the rest the moment a set is ticked off', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);

      await press(element, 'complete', setRow(element, 0));

      expect(await restDigits(element)).toBe('3:00');
      await waitOut(element, 61);
      expect(await restDigits(element)).toBe('1:59');
    });

    it('rests for as long as the lifter asked, and remembers it', async () => {
      const { store, databaseName } = await durableStore();
      const first = await mount(store);
      await useRestTimer(first, store);

      await chooseRestDuration(first, 90);
      await vi.waitFor(async () => {
        expect((await store.readSettings())?.restTimer.defaultSeconds).toBe(90);
      });

      // The refresh. A duration that only moved the control's own property satisfies
      // every assertion made against the screen it is on and is gone by the next
      // session, which for a preference is the first time it is read.
      first.remove();
      store.close();
      const second = await mount(await reopen(databaseName));
      await planASquatSession(second);
      await press(second, 'complete', setRow(second, 0));

      expect(await restDigits(second)).toBe('1:30');
    });

    it('says the rest is up rather than counting past it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await waitOut(element, 200);

      expect(await restDigits(element)).toBe('0:00');
      expect(readAll(element)).toContain(REST_NOTES.up);
    });

    it('keeps the rest running while the lifter reads a lift back', async () => {
      // The reason the timer is the root's state and is drawn above the screen switch
      // rather than inside the logging screen. Looking last week's numbers up between
      // sets is one of the reasons the logbook is out at the rack at all, and a rest
      // that ended because somebody checked is a rest the tool lost.
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));
      await waitOut(element, 30);

      await openHistory(element, shadow(element));

      expect(deepAll(shadow(element), 'ptk-active-workout')).toHaveLength(0);
      expect(await restDigits(element)).toBe('2:30');
    });

    it('takes thirty seconds off and puts them back', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await pressRest(element, 'shorten');
      expect(await restDigits(element)).toBe('2:30');
      await pressRest(element, 'extend');
      expect(await restDigits(element)).toBe('3:00');
    });

    it('holds a paused rest still while the clock runs on', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await pressRest(element, 'pause');
      await waitOut(element, 120);
      expect(await restDigits(element)).toBe('3:00');

      // And it picks up where it stopped rather than from the top: a resume that
      // restarted the rest would cost two minutes nobody asked for, on the one screen
      // where the number is the whole point.
      await pressRest(element, 'resume');
      await waitOut(element, 60);
      expect(await restDigits(element)).toBe('2:00');
    });

    it('takes the rest away when the lifter says they are done resting', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await pressRest(element, 'dismiss');

      expect(await restBand(element)).toBeNull();
      // Including this lift's duration picker, which goes with the band it is printed
      // on rather than becoming a setting stranded on the logging screen.
      expect(liftRestPickers(element)).toHaveLength(0);
      // The set stays done. Dismissing a rest is not taking back the set that began it,
      // and the two controls sit one card apart.
      expect(isDone(setRow(element, 0))).toBe(true);
    });

    it('stops timing when the workout is finished', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');

      // A countdown left on the summary screen is a rest between the last set and
      // nothing.
      expect(await restBand(element)).toBeNull();
    });

    it('does not time a correction to a workout in the history', async () => {
      const { store } = await durableStore();
      const source = await seedRepeatable(store);
      const element = await mount(store);
      await useRestTimer(element, store);
      await edit(element, source.id);

      // Untick and tick again, because everything in a finished session is already
      // done. Section 12.5's event says a set was *just done*, the timer hangs off that
      // event, and ticking a row on a session from February did not do a set.
      await press(element, 'undo', workingRow(element, 0));
      await press(element, 'complete', workingRow(element, 0));

      expect(isDone(workingRow(element, 0))).toBe(true);
      expect(await restBand(element)).toBeNull();
    });

    it('offers the lift its own rest, named after the lift and not after the setting', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);

      // Nothing before a set is done, because there is no rest and so no lift to store
      // one against -- and a picker under no countdown is a setting hiding on whichever
      // screen the lifter happened to leave open.
      expect(liftRestPickers(element)).toHaveLength(0);

      await press(element, 'complete', setRow(element, 0));

      const picker = liftRestPickers(element)[0];
      if (picker === undefined) throw new Error('The band is offering no duration.');
      // The lift in the visible label. The settings screen's picker reads "Rest for",
      // and two identically worded controls that change different things is the whole
      // reason this one says which.
      expect(picker.getAttribute('label')).toBe(REST_NOTES.liftDurationLabel(theSquat().name));
      expect(readAll(element)).toContain(REST_NOTES.liftDurationNote);
    });

    it('keeps a length chosen on the band for that lift and for no other', async () => {
      const { store, databaseName } = await durableStore();
      const first = await mount(store);
      await useRestTimer(first, store);
      await planASquatSession(first);
      await press(first, 'complete', setRow(first, 0));
      await waitOut(first, 60);

      await chooseLiftRest(first, 300);

      // Retimed rather than restarted. The lifter has already stood there for a minute
      // and choosing five is not a way of asking for that minute back -- which is what
      // Start again is for, one button to the left.
      expect(await restDigits(first)).toBe('4:00');
      await vi.waitFor(async () => {
        expect((await store.readSettings())?.restTimer.perExerciseSeconds).toStrictEqual({
          [theSquat().id]: 300,
        });
      });
      // And the default is untouched, which is the difference between this picker and
      // the one on the home screen.
      expect((await store.readSettings())?.restTimer.defaultSeconds).toBe(180);

      // The refresh. A preference is first read in the next session, so one that only
      // moved a property is a preference nobody ever had.
      first.remove();
      store.close();
      const second = await mount(await reopen(databaseName));
      // Back into the same session, and the next set of it. The rest itself is
      // deliberately not persisted -- a countdown read back tomorrow would be describing
      // a rest that ended yesterday -- so this is the stored length being read for the
      // first time rather than the timer surviving.
      await press(second, 'resume-workout');
      await press(second, 'complete', setRow(second, 1));

      expect(await restDigits(second)).toBe('5:00');
    });

    it('puts the lift back on the default rather than storing a copy of it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await useRestTimer(element, store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      await chooseLiftRest(element, 300);
      await chooseLiftRest(element, 180);

      // Empty and not `{ squat: 180 }`. A stored copy follows the default until the day
      // it moves and then quietly stops, with the picker still reading the number the
      // lifter chose.
      await vi.waitFor(async () => {
        expect((await store.readSettings())?.restTimer.perExerciseSeconds).toStrictEqual({});
      });
      expect(await restDigits(element)).toBe('3:00');
    });

    /*
     * There is deliberately no case for switching the timer off mid-rest. A rest
     * exists only during a live session and the settings are on the home screen, which
     * a live session has no way to -- and `reportSetting` cannot stand in for the
     * press, because `#onSetting` routes on a `data-field` that is only in the event's
     * path when the control itself is on screen. The guard in the root says as much.
     */
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

  describe('reading a backup back in', () => {
    /**
     * The button, and not the input, is what a lifter can see.
     *
     * The click is cancelled inside the listener on purpose: an uncancelled one on a
     * file input opens a native picker, which is a window no test can close.
     */
    it('opens the picker from the button standing in for the input', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      let clicks = 0;
      fileInput(element).addEventListener('click', (event: Event) => {
        clicks += 1;
        event.preventDefault();
      });

      await press(element, 'restore-pick');

      expect(clicks).toBe(1);
    });

    it('shows what the file holds, and writes nothing until it is confirmed', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);

      const text = readAll(element);
      expect(text).toContain(RESTORE_NOTES.warning);
      // The span and a session title, which are the two things a lifter recognises a
      // file by. Counts alone describe a great many files.
      expect(text).toContain(RESTORE_NOTES.span(REPEATED_DAY, REPEATED_DAY));
      expect(text).toContain(REPEATED_TITLE);
      // And the device is untouched, which is the whole reason there is a screen
      // between the picker and the write.
      expect(await store.readWorkouts()).toEqual([]);
    });

    it('leaves the device alone when the lifter keeps what is here', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);
      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);

      await press(element, 'restore-cancel');

      expect(readAll(element)).toContain(HOME_NOTES.restore);
      expect(readAll(element)).not.toContain(RESTORE_NOTES.heading);
      expect(await store.readWorkouts()).toEqual([]);
    });

    it('forgets a file it has read, so the same one can be chosen again', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseFile(element, fileOf('this is a sentence, not a document'));
      await waitForText(element, RESTORE_REFUSALS['not-json']);

      // A refusal leaves the lifter on the screen they picked from, still holding the
      // input that read the file -- unlike a restore, which replaces that whole screen
      // and the input with it. The picker fires `change` only when its value changes,
      // so an input still holding the file says nothing at all when the lifter mends
      // the file and picks it again, and the second attempt looks like a tool that
      // broke.
      expect(fileInput(element).files?.length ?? 0).toBe(0);
    });

    it('replaces everything, and says so only once the write has been read back', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);
      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);

      await press(element, 'restore-confirm');
      await waitForText(element, RESTORE_NOTES.done);

      const stored = await store.readWorkouts();
      expect(stored.length).toBe(1);
      expect(stored[0]?.title).toBe(REPEATED_TITLE);
      // On screen as well as in the database: a restore that wrote and reloaded
      // nothing would report a success the lifter cannot see any sign of.
      expect(readAll(element)).toContain(REPEATED_TITLE);
    });

    it('names the workout in progress as part of what gets replaced', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      await seedActive(store);
      const element = await mount(store);

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);

      // Section 0.4: the control is offered during a session rather than hidden. What
      // it would cost is named instead, which is the same answer the delete screen
      // gives to the same question one heading further down.
      expect(readAll(element)).toContain(RESTORE_NOTES.activeWarning);
      expect(readAll(element)).not.toContain(RESTORE_NOTES.fileHasActive);
    });

    it('says when the session a lifter would carry on with is the one in the file', async () => {
      const file = await aBackupFile(seedActive);
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);

      const text = readAll(element);
      expect(text).toContain(RESTORE_NOTES.fileHasActive);
      // A backup carrying only an unfinished session holds no workouts, and saying so
      // is the difference between a restore a lifter meant and one that empties the
      // history without warning.
      expect(text).toContain(RESTORE_NOTES.noWorkouts);
      expect(text).not.toContain(RESTORE_NOTES.activeWarning);
    });

    it('refuses a file that is not one of its backups, a sentence for each way', async () => {
      const backup = await aBackup();
      const { store } = await durableStore();
      const element = await mount(store);

      const refusals: readonly { readonly file: File; readonly code: RestoreProblemCode }[] = [
        { file: fileOf('a'.repeat(MAX_BACKUP_BYTES + 1)), code: 'too-large' },
        { file: fileOf('this is a sentence, not a document'), code: 'not-json' },
        {
          file: fileOf(JSON.stringify({ notes: 'training, but not from here' })),
          code: 'not-a-backup',
        },
        {
          file: fileOf(JSON.stringify({ ...backup, schemaVersion: BACKUP_SCHEMA_VERSION + 1 })),
          code: 'newer-schema-version',
        },
        {
          file: fileOf(JSON.stringify({ ...backup, data: { ...backup.data, settings: {} } })),
          code: 'invalid-data',
        },
      ];

      // One element down the whole list rather than one each, because the second half
      // of this is that the previous refusal is gone rather than stacked above the new
      // one -- and a fresh element every time could not show that.
      for (const { file, code } of refusals) {
        await chooseFile(element, file);
        await waitForText(element, RESTORE_REFUSALS[code]);

        expect(readAll(element)).not.toContain(RESTORE_NOTES.heading);
        for (const other of refusals) {
          if (other.code === code) continue;
          expect(readAll(element)).not.toContain(RESTORE_REFUSALS[other.code]);
        }
      }

      expect(await store.readWorkouts()).toEqual([]);
    });

    /**
     * Where it stopped, and never what it found there.
     *
     * Section 2.3: an error string is the kind of thing that gets pasted into a bug
     * report, so the diagnostic is a path and has nowhere to put a lifter's numbers.
     */
    it('says where in the file it stopped, once, however many fields are wrong', async () => {
      const backup = await aBackup();
      const text = JSON.stringify({ ...backup, data: { ...backup.data, settings: {} } });
      const refused = readBackup(text, text.length);
      if (refused.ok) throw new Error('A backup with no settings in it was meant to be refused.');
      const path = refused.problems[0]?.path;
      if (path === undefined || path === null) {
        throw new Error('An invalid document was meant to come back with a path.');
      }

      const { store } = await durableStore();
      const element = await mount(store);
      await chooseFile(element, fileOf(text));
      await waitForText(element, RESTORE_NOTES.path(path));

      // One sentence and not one per field. A file a version out of step can fail on
      // every set it holds, and four hundred identical sentences is not a report.
      expect(deepAll(shadow(element), 'p.trouble').length).toBe(1);
    });

    it('says nothing on the device was changed when the write does not land', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);
      await withRepository(element, (repository) => ({
        ...repository,
        replaceFromBackup: () => Promise.reject(new Error('the disk said no')),
      }));

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);
      await press(element, 'restore-confirm');

      await waitForText(element, RESTORE_NOTES.writeProblem);
      expect(readAll(element)).not.toContain(RESTORE_NOTES.done);
      expect(await store.readWorkouts()).toEqual([]);
    });

    /**
     * A write that reports success and did not happen.
     *
     * The store that throws is handled above. This is the other failure, and the one
     * the read-back exists for: a restore half of which landed leaves a lifter holding
     * a device they believe is their training and is not, and the only useful thing to
     * say about it is to take a backup now, before anything else touches it.
     */
    it('tells the lifter to back up now when what came back is not what went in', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);
      await withRepository(element, (repository) => ({
        ...repository,
        replaceFromBackup: () => Promise.resolve(),
      }));

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);
      await press(element, 'restore-confirm');

      await waitForText(element, RESTORE_NOTES.verifyProblem);
      expect(readAll(element)).not.toContain(RESTORE_NOTES.done);
    });
  });

  describe('clearing everything off the device', () => {
    it('counts what is here before anything is destroyed', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      await useRack(store, aPoundRack());
      const element = await mount(store);

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      const text = readAll(element);
      expect(text).toContain(DELETE_NOTES.warning);
      expect(text).toContain(DELETE_NOTES.span(REPEATED_DAY, REPEATED_DAY));
      // Counted, and not merely mentioned. The number is the whole content of the
      // question, and a screen that showed the warning with a zero beside it would be
      // asking a lifter to confirm the destruction of nothing.
      expect(text).toContain(DELETE_NOTES.workoutsLabel);
      expect(deletionCount(element, DELETE_NOTES.workoutsLabel)).toBe('1');
      // Nothing has gone yet, which is why there is a screen here at all.
      expect((await store.readWorkouts()).length).toBe(1);
    });

    it('names a session in progress as part of what goes', async () => {
      const { store } = await durableStore();
      await seedActive(store);
      const element = await mount(store);

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      expect(readAll(element)).toContain(DELETE_NOTES.activeWarning);
    });

    it('says there is nothing here rather than counting to zero three times', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      expect(readAll(element)).toContain(DELETE_NOTES.nothingHere);
    });

    /**
     * A device with no sessions on it and a gym saved is not an empty device.
     *
     * Setting up a rack is the work a lifter does before their first session, and it is
     * the one thing on a device that a beginner would be most surprised to lose. A
     * screen keyed on the workout count alone would tell them there was nothing here.
     */
    it('does not call a device empty when the only thing on it is a saved gym', async () => {
      const { store } = await durableStore();
      await store.writeProfile(aProfile());
      const element = await mount(store);

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      expect(readAll(element)).not.toContain(DELETE_NOTES.nothingHere);
      expect(deletionCount(element, DELETE_NOTES.racksLabel)).toBe('1');
    });

    it('leaves everything alone when the lifter keeps it', async () => {
      const { store } = await durableStore();
      const seeded = await seedRepeatable(store);
      const element = await mount(store);
      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      await press(element, 'delete-cancel');

      expect(readAll(element)).not.toContain(DELETE_NOTES.heading);
      expect((await store.readWorkouts()).map((workout) => workout.id)).toEqual([seeded.id]);
    });

    it('empties the device, and says so only once the read back came up empty', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      await useRack(store, aPoundRack());
      const element = await mount(store);
      // Taken first, the way a lifter who read the offer would. The note it leaves has
      // to go with the logbook it described: left up, it says a backup was downloaded
      // of training that no longer exists.
      await press(element, 'backup');
      await waitForText(element, HOME_NOTES.backupDone);
      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);

      await press(element, 'delete-confirm');
      await waitForText(element, DELETE_NOTES.done);

      expect(await store.readWorkouts()).toEqual([]);
      expect(await store.readProfiles()).toEqual([]);
      // On screen as well as in the database. A delete that emptied storage and left
      // the history drawn is a lifter looking at training they have been told is gone.
      expect(readAll(element)).not.toContain(REPEATED_TITLE);
      expect(readAll(element)).not.toContain(HOME_NOTES.backupDone);
    });

    /**
     * The record the warm-up calculator left behind goes too.
     *
     * It lives in `localStorage` rather than in IndexedDB, so `clearAll` cannot reach
     * it -- and it holds lift names and working weights. A delete that emptied four
     * object stores and left a warm-up ladder in a fifth place would be the most
     * convincing possible way to fail section 10.8.
     */
    it('forgets the warm-up handed over from the other tool', async () => {
      const { store } = await durableStore();
      const { source, calls } = aSource(aRecord());
      const element = await mount(store, source);
      await waitForText(element, HANDOFF_NOTES.heading);

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);
      await press(element, 'delete-confirm');
      await waitForText(element, DELETE_NOTES.done);

      expect(calls.clears).toBe(1);
      expect(readAll(element)).not.toContain(HANDOFF_NOTES.heading);
    });

    /**
     * The write landed and the device cannot be read.
     *
     * A different sentence from the one above, and the difference is the whole point:
     * that one knows nothing was destroyed, this one knows something was and cannot say
     * what. Reporting the first here would tell a lifter their training is safe on a
     * device that has just been cleared.
     *
     * The first read is let through, because that is the one the confirmation screen is
     * built from and a lifter who never saw the screen never pressed anything.
     */
    it('will not say what is left when the device cannot be read afterwards', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const element = await mount(store);
      let reads = 0;
      await withRepository(element, (repository) => ({
        ...repository,
        exportSnapshot: () => {
          reads += 1;
          return reads === 1
            ? repository.exportSnapshot()
            : Promise.reject(new Error('the disk said no'));
        },
      }));

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);
      await press(element, 'delete-confirm');

      await waitForText(element, DELETE_NOTES.verifyProblem);
      expect(readAll(element)).not.toContain(DELETE_NOTES.problem);
      expect(readAll(element)).not.toContain(DELETE_NOTES.done);
    });

    it('says everything is still here when the write does not land', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const element = await mount(store);
      await withRepository(element, (repository) => ({
        ...repository,
        clearAll: () => Promise.reject(new Error('the disk said no')),
      }));

      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);
      await press(element, 'delete-confirm');

      await waitForText(element, DELETE_NOTES.problem);
      expect(readAll(element)).not.toContain(DELETE_NOTES.done);
      expect((await store.readWorkouts()).length).toBe(1);
    });

    /**
     * The read-back looks at all four things, and one device per thing proves it.
     *
     * A store that clears the sessions and leaves the rest behind is what a partial
     * delete actually looks like -- `clearAll` on the IndexedDB store is one
     * transaction across four object stores, but a host may hand in its own, and the
     * three that are not the finished sessions hold a lifter's own exercise names, the
     * gyms they train at, and the workout they are in the middle of.
     *
     * A device seeded with all four at once would not show this. Each check would be
     * covered by whichever of its neighbours also fired, so dropping any one of them
     * would leave every case still passing -- which is exactly what the first version
     * of this did, and what mutating the four conjuncts one at a time found.
     */
    const survivors: readonly { readonly what: string; readonly seed: Seeder }[] = [
      { what: 'a finished session', seed: seedRepeatable },
      { what: 'the session in progress', seed: seedActive },
      { what: 'a saved gym', seed: (store) => store.writeProfile(aProfile()) },
      {
        what: 'a movement the lifter invented',
        seed: (store) => store.writeExercise(anInventedExercise()),
      },
    ];

    for (const { what, seed } of survivors) {
      it(`does not call a device clean when ${what} is still on it`, async () => {
        const { store } = await durableStore();
        await seed(store);
        const element = await mount(store);
        await withRepository(element, (repository) => ({
          ...repository,
          clearAll: () => Promise.resolve(),
        }));

        await press(element, 'delete-pick');
        await waitForText(element, DELETE_NOTES.heading);
        await press(element, 'delete-confirm');

        await waitForText(element, DELETE_NOTES.verifyProblem);
        expect(readAll(element)).not.toContain(DELETE_NOTES.done);
      });
    }
  });

  describe('keeping this on the device', () => {
    it('offers nothing while there is nothing here to keep', async () => {
      const { store } = await durableStore();
      const port = persistencePort('best-effort');
      const element = await mountKeeping(store, port);

      expect(readAll(element)).not.toContain(PERSIST_NOTES.heading);
      // Reading is free and silent, so it happens on a bare device too. What must not
      // happen is the offer -- asking a browser to hold on to nothing, and telling
      // somebody who has typed nothing that they are about to lose it.
      expect(port.calls.reads).toBe(1);
    });

    /**
     * Three of the four things that count, and one device per thing proves it.
     *
     * Same shape and same reason as the delete read-back above: a device holding all
     * of them at once cannot show a broken conjunct, because each is covered by
     * whichever of its neighbours also fires. Two of the three are work a lifter does
     * *before* their first finished session -- setting up a gym, inventing a movement
     * -- and a check keyed on finished sessions alone would tell both of those people
     * there was nothing here worth keeping.
     *
     * The fourth conjunct, `active`, is deliberately not here and cannot be reached
     * from this screen. A session in progress is in the history list as well, because
     * that list is not filtered by status (#97), and the logging screen has no way
     * back to the home one -- so a device seeded with one would pass through
     * `history` while appearing to prove `active`, which is the exact failure the
     * one-device-per-conjunct rule exists to stop. Why the conjunct stays anyway is on
     * `#hasSomethingToKeep`. Do not add a case here claiming to cover it.
     */
    const keepable: readonly { readonly what: string; readonly seed: Seeder }[] = [
      { what: 'a finished session', seed: seedRepeatable },
      { what: 'a saved gym', seed: (store) => store.writeProfile(aProfile()) },
      {
        what: 'a movement the lifter invented',
        seed: (store) => store.writeExercise(anInventedExercise()),
      },
    ];

    for (const { what, seed } of keepable) {
      it(`offers to keep a device holding ${what}`, async () => {
        const { store } = await durableStore();
        await seed(store);
        const element = await mountKeeping(store, persistencePort('best-effort'));

        await waitForText(element, PERSIST_NOTES.heading);
        expect(readAll(element)).toContain(PERSIST_NOTES.atRisk);
      });
    }

    it('offers nothing when the host handed over no way to ask', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const element = await mount(store);
      await settle(element);

      // The device is not empty, so the first case's guard is not what is being
      // measured here -- this is the embed, which gets no port on purpose.
      expect(readAll(element)).toContain(REPEATED_TITLE);
      expect(readAll(element)).not.toContain(PERSIST_NOTES.heading);
    });

    it('offers nothing while the browser has said nothing', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const port = persistencePort('unknown');
      const element = await mountKeeping(store, port);

      expect(port.calls.reads).toBe(1);
      expect(readAll(element)).toContain(REPEATED_TITLE);
      expect(readAll(element)).not.toContain(PERSIST_NOTES.heading);
    });

    it('asks the browser for nothing until the lifter presses', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const port = persistencePort('best-effort', 'persisted');
      const element = await mountKeeping(store, port);
      await waitForText(element, PERSIST_NOTES.heading);

      // Section 10.3 is as much about when as about what. Firefox puts a permission
      // prompt behind the request, so a load-time ask is a dialog in front of somebody
      // who has not yet decided they want this -- and the refusal it earns is the one
      // answer that does not soften with time.
      expect(port.calls.asks).toBe(0);

      await press(element, 'persist-ask');
      await quiet(element, port);

      expect(port.calls.asks).toBe(1);
      const text = readAll(element);
      expect(text).toContain(PERSIST_NOTES.persisted);
      expect(text).not.toContain(PERSIST_NOTES.atRisk);
    });

    it('states an agreement already in place rather than offering to ask for it', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const port = persistencePort('persisted');
      const element = await mountKeeping(store, port);
      await waitForText(element, PERSIST_NOTES.heading);

      const text = readAll(element);
      expect(text).toContain(PERSIST_NOTES.persisted);
      expect(text).not.toContain(PERSIST_NOTES.atRisk);
      expect(text).not.toContain(PERSIST_NOTES.action);
      expect(port.calls.asks).toBe(0);
    });

    it('reports a decline as the browser deciding, and leaves the offer up', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const port = persistencePort('best-effort');
      const element = await mountKeeping(store, port);
      await waitForText(element, PERSIST_NOTES.heading);

      await press(element, 'persist-ask');
      await quiet(element, port);

      const text = readAll(element);
      expect(text).toContain(PERSIST_NOTES.declined);
      expect(text).not.toContain(PERSIST_NOTES.noAnswer);
      // Chromium decides from its own engagement heuristics, so the same press in a
      // month is a different question. Taking the control away would turn one no into
      // a permanent one on the strength of a decision the browser did not make.
      expect(text).toContain(PERSIST_NOTES.action);
    });

    it('says nothing changed when the browser gives no answer at all', async () => {
      const { store } = await durableStore();
      await seedRepeatable(store);
      const port = persistencePort('best-effort', 'unknown');
      const element = await mountKeeping(store, port);
      await waitForText(element, PERSIST_NOTES.heading);

      await press(element, 'persist-ask');
      await quiet(element, port);

      // A rejected request is not a refusal, and the screen must not read as though
      // somebody said no. The offer stays where it was, and so does the answer.
      const text = readAll(element);
      expect(text).toContain(PERSIST_NOTES.noAnswer);
      expect(text).not.toContain(PERSIST_NOTES.declined);
      expect(text).toContain(PERSIST_NOTES.atRisk);
    });

    /** Both branches end in the same sentence, because both leave the same thing true. */
    for (const [what, now] of [
      ['may still be cleared', 'best-effort'],
      ['has been agreed to', 'persisted'],
    ] as const) {
      it(`says a downloaded backup is the only other copy when storage ${what}`, async () => {
        const { store } = await durableStore();
        await seedRepeatable(store);
        const element = await mountKeeping(store, persistencePort(now));

        await waitForText(element, PERSIST_NOTES.heading);
        expect(readAll(element)).toContain(PERSIST_NOTES.stillClearable);
      });
    }
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

    it('fires nothing at all for the readable copy', async () => {
      // Section 12.5's list is closed at seven, and this download is not one of them.
      // A `training-markdown-exported` added here because the backup next to it has one
      // would be a public event invented by symmetry rather than asked for, and a public
      // event is the one thing in this element that cannot be taken back.
      const exported = record(BACKUP_EXPORTED_EVENT);

      const { store } = await durableStore();
      const element = await mount(store);
      await press(element, 'markdown');

      await vi.waitFor(async () => {
        await element.updateComplete;
        expect(readAll(element)).toContain(HOME_NOTES.markdownDone);
      });
      expect(exported).toEqual([]);
    });

    it('says how much a restored backup held, and nothing about what was in it', async () => {
      const restored = record(BACKUP_RESTORED_EVENT);

      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);
      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);
      await press(element, 'restore-confirm');

      await vi.waitFor(() => {
        expect(restored.length).toBe(1);
      });
      expect(restored[0]).toStrictEqual({ workoutCount: 1 });
      // Section 12.5 again, and it matters more here than anywhere: this is the one
      // event fired with a whole logbook in hand.
      const payload = JSON.stringify(restored);
      expect(payload).not.toContain(REPEATED_TITLE);
      expect(payload).not.toContain(SQUAT.name);
    });

    it('announces a cleared device with the count of what was destroyed', async () => {
      const cleared = record(LOCAL_DATA_CLEARED_EVENT);

      const { store } = await durableStore();
      await seedRepeatable(store);
      const element = await mount(store);
      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);
      await press(element, 'delete-confirm');

      await vi.waitFor(() => {
        expect(cleared.length).toBe(1);
      });
      // What went, not what is left -- which is always zero and would say nothing.
      expect(cleared[0]).toStrictEqual({ workoutCount: 1 });
      const payload = JSON.stringify(cleared);
      expect(payload).not.toContain(REPEATED_TITLE);
      expect(payload).not.toContain(SQUAT.name);
    });
  });

  describe('what it never says', () => {
    // The list and the subtraction live in `vocabulary.fixture.ts`, because section
    // 10.5's Markdown document is a second thing this tool writes and has to pass the
    // same test. The walk below is what is specific to the screens: a stage this test
    // does not reach is copy nothing checks.
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

  /*
   * -------------------------------------------------------------------------
   * What is said without the screen changing. Section 33's second half.
   * -------------------------------------------------------------------------
   */
  /*
   * -------------------------------------------------------------------------
   * The outline a framed copy has to carry on its own. Axe cannot see this:
   * `page-has-heading-one` and the landmark rules are document-scoped, and the
   * axe cases here run at element scope.
   * -------------------------------------------------------------------------
   */
  describe('heading outline', () => {
    it('carries its own top-level heading, for the route with no page around it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      const headings = shadow(element).querySelectorAll('h1');
      expect(headings).toHaveLength(1);
      expect(headings[0]?.textContent).toBe(SCREEN_NOTES.title);
    });

    it('clips that heading rather than hiding it', async () => {
      // The distinction the whole thing turns on: `display: none` takes the text out
      // of the accessibility tree along with the pixels, and the text is the entire
      // point -- the standalone page draws a title of its own, so this one exists for
      // the framed route and for a reader moving by heading.
      const { store } = await durableStore();
      const element = await mount(store);
      const heading = shadow(element).querySelector('h1');
      if (!(heading instanceof HTMLElement)) throw new Error('The tool drew no heading.');

      const drawn = getComputedStyle(heading);
      expect(drawn.display).not.toBe('none');
      expect(drawn.visibility).toBe('visible');
      expect(heading.getBoundingClientRect().width).toBeLessThan(2);
    });

    it('wraps whichever screen is up in a region that says which one it is', async () => {
      // A named `section` is a landmark, which is what gives a framed copy something
      // to jump to. The name moving with the screen is the same fact focus management
      // needs, so the two are one attribute rather than two.
      const { store } = await durableStore();
      const element = await mount(store);
      const region = shadow(element).querySelector('.screen');
      if (!(region instanceof HTMLElement)) throw new Error('The tool drew no screen region.');

      expect(region.tagName).toBe('SECTION');
      expect(region.getAttribute('aria-label')).toBe(SCREEN_NOTES.home);

      await press(element, 'start-workout');

      expect(shadow(element).querySelector('.screen')?.getAttribute('aria-label')).toBe(
        BUILDER_NOTES.heading,
      );
    });

    it('drops it when the page around it already says the same thing', async () => {
      // The standalone route draws a visible `<h1>` of its own, and two of them is the
      // outline saying it twice. Only the host knows which route this is, so the host
      // says -- and unset draws the heading, because a bare mount with none is worse
      // than a page with two.
      const { store } = await durableStore();
      const element = await mount(store);
      element.pageTitled = true;
      await element.updateComplete;

      expect(shadow(element).querySelectorAll('h1')).toHaveLength(0);
      // The screen region is what a reader jumps to instead, so it has to survive.
      expect(shadow(element).querySelector('.screen')?.getAttribute('aria-label')).toBe(
        SCREEN_NOTES.home,
      );
    });
  });

  describe('live regions', () => {
    /** The one region matching a selector, or a failure naming the region nobody drew. */
    function liveRegion(element: PtkTrainingLogbook, selector: string): HTMLElement {
      const found = shadow(element).querySelectorAll(selector);
      if (found.length !== 1) {
        throw new Error(`Expected one "${selector}" region, found ${String(found.length)}.`);
      }
      const region = found[0];
      if (!(region instanceof HTMLElement)) throw new Error(`"${selector}" is not an element.`);
      return region;
    }

    /**
     * The storage line is one node for the life of the tool.
     *
     * It has to be. A live region created at the moment its sentence appears is
     * announced by roughly half the engines and reliably by none -- the paragraph is
     * allowed to come and go, the region around it is not. That is also why the region
     * sits in `render()` above the screen rather than inside each of the nine: a node
     * redrawn by every screen change is a node that was created with its sentence.
     */
    it('says how storage stands through one region that outlives every screen', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      const storage = liveRegion(element, '.storage');

      expect(storage.getAttribute('role')).toBe('status');
      expect(saveLine(element)).toBe(SAVE_STATES.saved);

      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));

      expect(liveRegion(element, '.storage')).toBe(storage);
      expect(saveLine(element)).toBe(SAVE_STATES.saved);
    });

    /**
     * Two of the four storage states interrupt and two do not.
     *
     * This line changes twice on every set ticked off. A region that reads "Saving.
     * Saved on this device." over the top of whatever else is being spoken, three times
     * a minute for an hour, is a region that gets the tool turned off -- so ordinary
     * saving is polite, and only the two states that mean a lifter has to do something
     * about it are allowed to cut in.
     */
    it('interrupts only for the storage states a lifter has to act on', async () => {
      const { store } = await durableStore();
      const saving = await mount(store);
      expect(liveRegion(saving, '.storage').getAttribute('aria-live')).toBe('polite');

      const memory = await mount(memoryLogbookStore());
      expect(saveLine(memory)).toContain(SAVE_STATES.unavailable);
      expect(liveRegion(memory, '.storage').getAttribute('aria-live')).toBe('assertive');
    });

    /**
     * A refusal is the one outcome that changes nothing but its own paragraph.
     *
     * Choosing a file the validator will not accept leaves the lifter on the screen
     * they were already on, with no screen change to carry the news -- which makes this
     * the case the pre-existing region exists for, rather than an illustration of it.
     */
    it('puts a refused backup file into a region that was already in the document', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      const alerts = liveRegion(element, '.outcome.trouble');
      expect(alerts.getAttribute('role')).toBe('alert');
      expect(alerts.textContent.trim()).toBe('');

      await chooseFile(element, fileOf('this is a sentence, not a document'));
      await waitForText(element, RESTORE_REFUSALS['not-json']);

      expect(liveRegion(element, '.outcome.trouble')).toBe(alerts);
      expect(alerts.querySelectorAll('p.trouble')).toHaveLength(1);
    });

    /**
     * The split that matters most, because both sentences follow the same press.
     *
     * A restore that landed is polite: the home screen it lands on is the evidence. A
     * restore whose read-back disagreed is the one thing in this tool a lifter must not
     * miss -- they are holding a device they believe is their training and it is not,
     * and the only useful answer is to take a backup before anything else touches it.
     */
    it('reads a restore that landed politely and one that did not assertively', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store: good } = await durableStore();
      const landed = await mount(good);

      await chooseFile(landed, file);
      await waitForText(landed, RESTORE_NOTES.heading);
      await press(landed, 'restore-confirm');
      await waitForText(landed, RESTORE_NOTES.done);

      const polite = liveRegion(landed, '.outcome.landed');
      expect(polite.getAttribute('role')).toBe('status');
      expect(polite.textContent).toContain(RESTORE_NOTES.done);

      const { store: bad } = await durableStore();
      const wrong = await mount(bad);
      await withRepository(wrong, (repository) => ({
        ...repository,
        replaceFromBackup: () => Promise.resolve(),
      }));

      await chooseFile(wrong, file);
      await waitForText(wrong, RESTORE_NOTES.heading);
      await press(wrong, 'restore-confirm');
      await waitForText(wrong, RESTORE_NOTES.verifyProblem);

      // `alert` and not a `status` carrying `aria-live="assertive"`: the storage line
      // is spelled that way because its one node has to say both, and this region only
      // ever says the one thing.
      const interrupting = liveRegion(wrong, '.outcome.trouble');
      expect(interrupting.getAttribute('role')).toBe('alert');
      expect(interrupting.textContent).toContain(RESTORE_NOTES.verifyProblem);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Where focus goes. Nothing else in this repository asserts on it yet.
   * -------------------------------------------------------------------------
   */
  describe('focus', () => {
    /** The region the root draws around whichever screen is up. */
    function screenRegion(element: PtkTrainingLogbook): HTMLElement {
      const region = shadow(element).querySelector('.screen');
      if (!(region instanceof HTMLElement)) throw new Error('The tool drew no screen region.');
      return region;
    }

    /**
     * A tool mounted into a page it does not own must not move the reader.
     *
     * The whole of the rule below is that a screen *change* takes focus, and a first
     * paint is not one. Without the distinction an embed a quarter of the way down
     * somebody's article jumps the page to itself on load.
     */
    it('takes no focus at all when it is first drawn', async () => {
      const { store } = await durableStore();
      await mount(store);

      expect(deepActiveElement()).toBe(document.body);
    });

    it('lands focus on the screen a press opened, and names it', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await press(element, 'start-workout');

      expect(deepActiveElement()).toBe(screenRegion(element));
      expect(focusedName()).toBe(BUILDER_NOTES.heading);
    });

    it('follows the screen through starting, finishing and going home', async () => {
      const { store } = await durableStore();
      const element = await mount(store);

      await planASquatSession(element);
      expect(focusedName()).toBe(SCREEN_NOTES.active);

      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');
      expect(deepActiveElement()).toBe(screenRegion(element));
      expect(focusedName()).toBe(DONE_NOTES.heading);

      await press(element, 'home');
      expect(focusedName()).toBe(SCREEN_NOTES.home);
    });

    /**
     * Section 5.5's two ways in, from the side that costs a lifter their place.
     *
     * Back is the half worth asserting: a reader sent to a records screen and then
     * returned to the top of the document has been moved twice and told once.
     */
    it('lands on the records screen and comes back to the one it was opened from', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await openHistory(element, exerciseCard(element, 0));
      expect(focusedName()).toBe(RECORDS_NOTES.heading);

      await press(element, 'records-back');
      expect(focusedName()).toBe(SCREEN_NOTES.active);
    });

    it('lands on the correction editor and back on the workout it corrects', async () => {
      const { store } = await durableStore();
      const seeded = await seedRepeatable(store);
      const element = await mount(store);

      await edit(element, seeded.id);
      expect(focusedName()).toBe(SCREEN_NOTES.edit);

      await press(element, 'edit-done');
      expect(focusedName()).toBe(DETAIL_NOTES.heading);
    });

    /**
     * The subtle one, and the reason section 33 was raised.
     *
     * Done and Undo are two different `ptk-button` instances, so ticking a set off
     * destroys the node the thumb is on and the platform drops focus on the document.
     * At the rack that is once per set, all session: the next tab starts at the top of
     * the page and a reader is told nothing happened.
     */
    it('keeps the thumb on the row when a set is ticked off, and again when it is undone', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);

      await pressWithFocus(element, 'complete', setRow(element, 0));

      expect(isDone(setRow(element, 0))).toBe(true);
      expect(focusedAction()).toBe('undo');
      // The name says which set, so a reader landing on it knows where they are and
      // not merely that something is now focusable.
      expect(focusedName()).toContain('Squat');

      await pressWithFocus(element, 'undo', setRow(element, 0));

      expect(isDone(setRow(element, 0))).toBe(false);
      expect(focusedAction()).toBe('complete');
    });

    /**
     * Keeping focus is not the same as taking it.
     *
     * A press made with focus somewhere else -- a pointer on an engine that does not
     * focus a button on click, a consumer driving the tool -- must leave the reader
     * where they were. Planning a session has just put focus on the screen region, so
     * this is that case with nothing contrived about it.
     */
    it('does not take focus from a lifter who was reading something else', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      const region = screenRegion(element);
      expect(deepActiveElement()).toBe(region);

      await press(element, 'complete', setRow(element, 0));

      expect(isDone(setRow(element, 0))).toBe(true);
      expect(deepActiveElement()).toBe(region);
    });
  });

  describe('accessibility', () => {
    const RULES = {
      // Disabled for the reason every suite in this collection disables it: the element
      // is measured outside the page's own background, so the contrast engine compares
      // a token against whatever the harness painted behind it.
      //
      // `target-size` is off by default in axe-core and is switched on here on purpose.
      // It is WCAG 2.5.8 and it is the one rule that measures what this tool is for:
      // a control pressed with a thumb, between sets, by somebody who is out of breath.
      // `scripts/check-narrow-layout.mjs` measures a box; this measures overlap and
      // spacing too, which is the half a box cannot answer.
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: true } },
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
      // An empty violations list is also what a rule that never ran produces, and
      // `target-size` is off by default -- so a configuration key silently renamed
      // upstream would leave every case here green while measuring nothing. This is
      // the busiest screen the tool draws, so it is the one asked to prove otherwise.
      const measured = results.passes.find((rule) => rule.id === 'target-size');
      expect(measured?.nodes.length ?? 0).toBeGreaterThan(0);
    });

    it('has no violations on either screen that asks before an irreversible press', async () => {
      const file = await aBackupFile(seedRepeatable);
      const { store } = await durableStore();
      const element = await mount(store);

      await chooseFile(element, file);
      await waitForText(element, RESTORE_NOTES.heading);
      expect((await axe.run(element, RULES)).violations).toEqual([]);

      await press(element, 'restore-cancel');
      await press(element, 'delete-pick');
      await waitForText(element, DELETE_NOTES.heading);
      expect((await axe.run(element, RULES)).violations).toEqual([]);
    });

    it('has no violations on the screen a finished session lands on', async () => {
      const { store } = await durableStore();
      const element = await mount(store);
      await planASquatSession(element);
      await press(element, 'complete', setRow(element, 0));
      await press(element, 'finish');
      await choose(element, 'ptk-choice-group', 'skip');
      await press(element, 'finish-confirm');

      expect(readAll(element)).toContain(DONE_NOTES.heading);
      expect((await axe.run(element, RULES)).violations).toEqual([]);
    });

    it('has no violations on a workout read back, or on the records screen behind it', async () => {
      const { store } = await durableStore();
      const seeded = await seedRepeatable(store);
      const element = await mount(store);

      const detail = await open(element, await historyRow(element, seeded.id));
      expect((await axe.run(element, RULES)).violations).toEqual([]);

      await openHistory(element, shadow(detail));
      expect(readAll(element)).toContain(RECORDS_NOTES.back);
      expect((await axe.run(element, RULES)).violations).toEqual([]);
    });

    it('has no violations while a finished session is being corrected', async () => {
      const { store } = await durableStore();
      const seeded = await seedRepeatable(store);
      const element = await mount(store);

      await edit(element, seeded.id);
      await press(element, 'edit', workingRow(element, 0));

      expect((await axe.run(element, RULES)).violations).toEqual([]);
    });

    /**
     * Both libraries, with a row in each.
     *
     * The home screen case above draws them empty, which is the state with no controls
     * in it -- so it says nothing about the ones a saved gym and an invented movement
     * put on the screen. Those are the small quiet buttons this tool has most of.
     */
    it('has no violations with a saved gym and a movement the lifter invented', async () => {
      const { store } = await durableStore();
      await store.writeProfile(aProfile());
      await store.writeExercise(anInventedExercise());
      const element = await mount(store);
      await waitForText(element, 'The garage');

      expect((await axe.run(element, RULES)).violations).toEqual([]);
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
