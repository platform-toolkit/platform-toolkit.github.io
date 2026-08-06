// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The IndexedDB adapter, against a real IndexedDB.
 *
 * Only the behaviours that a fake would get wrong are here; everything the
 * repository layers on top is proven in Node in `./repository.test.ts`. What a fake
 * gets wrong is exactly the thing this adapter is built around -- a transaction
 * commits when the microtask queue drains, so a two-part write is atomic only if
 * both requests were issued before anything was awaited. A fake with its own
 * transaction model answers that question with its own answer.
 *
 * Every case gets its own database name. Sharing one would make the suite
 * order-dependent, and worse, would leave a connection open across cases so an
 * upgrade in a later one lands on `onblocked` -- which this adapter deliberately
 * rejects rather than papering over.
 */

import { defaultInventory } from '@platform-toolkit/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { AT_LATER, AT_START, ON_DAY, contextSeries } from '../core/context.fixture.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
} from '../core/session.js';
import type {
  CustomExercise,
  EquipmentProfile,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  LogbookStorageError,
  indexedDbLogbookStore,
  openLogbookStore,
} from './indexed-db.js';
import type { LogbookStore } from './port.js';
import { defaultSettings } from './repository.js';

const SETTINGS: LogbookSettings = { ...defaultSettings(), displayUnit: 'kg' };

/** A finished squat session. Invented numbers; see section 5.1. */
function finished(localDate = ON_DAY, at = contextSeries()): WorkoutSession {
  let workout = createWorkout(at(AT_START), { localDate, title: 'Squat day' });
  workout = addExercise(workout, at(AT_START), {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: [
      {
        kind: 'working',
        performance: performance({ kind: 'implement', weight: { amount: 100, unit: 'kg' } }, 5),
      },
    ],
  });
  workout = startWorkout(workout, at(AT_START));
  const setId = workout.exercises[0]?.sets[0]?.id ?? '';
  workout = completeSet(workout, setId, at(AT_LATER));
  return finishWorkout(workout, 'skip', at(AT_LATER));
}

function exercise(id: string): CustomExercise {
  return {
    id,
    name: 'Cable Row',
    loading: 'machine-or-cable-weight',
    warmupFamily: null,
    defaultUnit: null,
    createdAt: AT_START,
    updatedAt: AT_START,
  };
}

function profile(id: string): EquipmentProfile {
  return {
    id,
    name: 'Garage',
    equipment: {
      barWeight: { amount: 20, unit: 'kg' },
      collarWeight: { amount: 2.5, unit: 'kg' },
      plateUnit: 'kg',
      plates: defaultInventory('kg'),
    },
    createdAt: AT_START,
    updatedAt: AT_START,
  };
}

let counter = 0;
const open: LogbookStore[] = [];
const created: string[] = [];

/** A database name nothing else in this file touches, registered for teardown. */
function freshName(): string {
  counter += 1;
  const name = `${DATABASE_NAME}-test-${String(counter)}`;
  created.push(name);
  return name;
}

/** A database nothing else in this file touches. */
async function freshStore(): Promise<{ readonly store: LogbookStore; readonly name: string }> {
  const name = freshName();
  const store = await openLogbookStore({ databaseName: name });
  open.push(store);
  return { store, name };
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    // Resolves on every outcome including `onblocked`. This is teardown, and a
    // rejected cleanup would report itself as a failure of whichever case ran next.
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      resolve();
    };
    request.onblocked = () => {
      resolve();
    };
  });
}

/**
 * Writes a record the adapter did not write.
 *
 * A second connection at the same version, so no upgrade is triggered. This is the
 * only way to produce the case the adapter's `decode` exists for: a record left by a
 * build that is not this one.
 */
function putRaw(name: string, storeName: string, value: unknown, key?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onerror = () => {
      reject(new Error('could not open the test database'));
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, 'readwrite');
      const target = transaction.objectStore(storeName);
      // Branching rather than passing `undefined` through: a store with an in-line
      // key path throws `DataError` when a key is supplied at all, and whether an
      // explicit `undefined` counts as supplied is an implementation detail.
      if (key === undefined) target.put(value);
      else target.put(value, key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('could not write the test record'));
      };
    };
  });
}

/**
 * A database exactly as version 1 of this adapter left it.
 *
 * The store names and the key paths are written out here rather than imported,
 * and that is the point of the fixture: version 1's schema is frozen history, so
 * reading it from today's constants would make it follow whatever the adapter is
 * changed to next and the upgrade would then be tested against itself.
 */
function createVersion1(name: string, workouts: readonly WorkoutSession[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const storeName of ['workouts', 'exercises', 'profiles']) {
        database.createObjectStore(storeName, { keyPath: 'id' });
      }
      database.createObjectStore('state');
    };
    request.onerror = () => {
      reject(new Error('could not create the version 1 test database'));
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('workouts', 'readwrite');
      const target = transaction.objectStore('workouts');
      for (const workout of workouts) target.put(workout);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(new Error('could not seed the version 1 test database'));
      };
    };
  });
}

/**
 * Asks the database itself, rather than inferring the index from a read working.
 *
 * Opened with no version, which is the whole reason this is not `putRaw`. Naming
 * {@link DATABASE_VERSION} against a version 1 database triggers an upgrade with
 * no `onupgradeneeded` of its own -- so the observation would bump the database to
 * version 2 without an index, and the upgrade under test would then never run.
 */
function hasLocalDateIndex(name: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => {
      reject(new Error('could not open the test database'));
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('workouts', 'readonly');
      const found = transaction.objectStore('workouts').indexNames.contains('by-local-date');
      database.close();
      resolve(found);
    };
  });
}

/** Runs a scan to exhaustion and collects the days it visited, in order. */
async function scanDays(store: LogbookStore): Promise<readonly string[]> {
  const days: string[] = [];
  await store.scanWorkouts((workout) => {
    days.push(workout.localDate);
    return 'continue';
  });
  return days;
}

afterEach(async () => {
  for (const store of open) store.close();
  open.length = 0;
  for (const name of created) await deleteDatabase(name);
  created.length = 0;
});

/** An `IDBFactory` that refuses everything, the way a denied context does. */
function refusingFactory(): IDBFactory {
  const refuse = (): never => {
    throw new DOMException('the user denied permission', 'SecurityError');
  };
  return {
    open: refuse,
    deleteDatabase: refuse,
    cmp: () => 0,
    databases: () => Promise.resolve([]),
  };
}

describe('opening', () => {
  it('gives a durable store in a browser that has a database', async () => {
    const { store } = await freshStore();

    expect(store.durable).toBe(true);
  });

  it('starts empty, and empty is not the same as broken', async () => {
    const { store } = await freshStore();

    expect(await store.readSettings()).toBeNull();
    expect(await store.readActiveId()).toBeNull();
    expect(await store.readWorkouts()).toEqual([]);
  });

  it('falls back to memory where the browser refuses the database outright', async () => {
    // Private browsing and a managed device both look like this from in here: the
    // factory throws on use rather than being absent. A caller must still get a
    // store, and must be able to see that it is not keeping anything.
    const store = await openLogbookStore({ factory: refusingFactory() });

    expect(store.durable).toBe(false);
    expect(await store.readWorkouts()).toEqual([]);
  });

  it('answers null rather than a store when asked without the fallback', async () => {
    expect(await indexedDbLogbookStore({ factory: refusingFactory() })).toBeNull();
  });
});

describe('round trips', () => {
  it('keeps settings', async () => {
    const { store } = await freshStore();
    await store.writeSettings(SETTINGS);

    expect(await store.readSettings()).toEqual(SETTINGS);
  });

  it('keeps a workout and reads it back both ways', async () => {
    const { store } = await freshStore();
    const workout = finished();
    await store.writeWorkout(workout, { kind: 'unchanged' });

    expect(await store.readWorkout(workout.id)).toEqual(workout);
    expect(await store.readWorkouts()).toEqual([workout]);
  });

  it('answers null for a workout that is not there', async () => {
    const { store } = await freshStore();

    expect(await store.readWorkout('never-written')).toBeNull();
  });

  it('keeps custom exercises and equipment profiles', async () => {
    const { store } = await freshStore();
    await store.writeExercise(exercise('cable-row'));
    await store.writeProfile(profile('home'));

    expect(await store.readExercises()).toEqual([exercise('cable-row')]);
    expect(await store.readProfiles()).toEqual([profile('home')]);

    await store.deleteExercise('cable-row');
    await store.deleteProfile('home');

    expect(await store.readExercises()).toEqual([]);
    expect(await store.readProfiles()).toEqual([]);
  });

  it('hands back a fresh object every read, because the value is deserialised', async () => {
    const { store } = await freshStore();
    const workout = finished();
    await store.writeWorkout(workout, { kind: 'unchanged' });

    const first = await store.readWorkout(workout.id);
    const second = await store.readWorkout(workout.id);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).not.toBe(workout);
  });
});

describe('scanning history newest first', () => {
  it('visits the newest calendar day first', async () => {
    const { store } = await freshStore();
    const at = contextSeries();
    // Written in an order that is neither the answer nor its reverse. Identifiers
    // count up, so insertion order *is* primary-key order, and a scan that read
    // the store rather than the index would hand back exactly this sequence.
    await store.writeWorkout(finished('2026-01-05', at), { kind: 'unchanged' });
    await store.writeWorkout(finished('2026-03-11', at), { kind: 'unchanged' });
    await store.writeWorkout(finished('2026-02-14', at), { kind: 'unchanged' });

    expect(await scanDays(store)).toEqual(['2026-03-11', '2026-02-14', '2026-01-05']);
  });

  it('stops where the visitor says, without reading the rest', async () => {
    // The count is the assertion. Section 9.3 is about what a bounded query costs
    // with thousands of workouts behind it, and a scan that walked to the end and
    // discarded the tail would satisfy every assertion about the values.
    const { store } = await freshStore();
    const at = contextSeries();
    await store.writeWorkout(finished('2026-01-05', at), { kind: 'unchanged' });
    await store.writeWorkout(finished('2026-03-11', at), { kind: 'unchanged' });
    await store.writeWorkout(finished('2026-02-14', at), { kind: 'unchanged' });

    const seen: string[] = [];
    await store.scanWorkouts((workout) => {
      seen.push(workout.localDate);
      return seen.length === 2 ? 'stop' : 'continue';
    });

    expect(seen).toEqual(['2026-03-11', '2026-02-14']);
  });

  it('resolves when the visitor stops on the very first record', async () => {
    // The cursor is never advanced at all here, so the transaction commits with
    // nothing outstanding. An implementation that resolved from the exhaustion
    // branch alone would leave this promise pending for ever.
    const { store } = await freshStore();
    await store.writeWorkout(finished(), { kind: 'unchanged' });

    let visited = 0;
    await store.scanWorkouts(() => {
      visited += 1;
      return 'stop';
    });

    expect(visited).toBe(1);
  });

  it('resolves without visiting anything over an empty store', async () => {
    const { store } = await freshStore();

    let visited = 0;
    await store.scanWorkouts(() => {
      visited += 1;
      return 'continue';
    });

    expect(visited).toBe(0);
  });

  it('visits both of a day, in an order the port does not promise', async () => {
    // Asserted as a count and a set rather than a sequence, on purpose. The index
    // key is the day, so two workouts sharing one have no order the adapter can
    // promise, and a test that pinned today's happens to be the specification the
    // port explicitly declines to give.
    const { store } = await freshStore();
    const at = contextSeries();
    const morning = finished('2026-03-11', at);
    const evening = finished('2026-03-11', at);
    await store.writeWorkout(morning, { kind: 'unchanged' });
    await store.writeWorkout(evening, { kind: 'unchanged' });
    await store.writeWorkout(finished('2026-02-14', at), { kind: 'unchanged' });

    const ids: string[] = [];
    await store.scanWorkouts((workout) => {
      ids.push(workout.id);
      return 'continue';
    });

    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2).sort()).toEqual([morning.id, evening.id].sort());
    expect(await scanDays(store)).toEqual(['2026-03-11', '2026-03-11', '2026-02-14']);
  });

  it('throws on a record this build does not understand, like every other read', async () => {
    const { store, name } = await freshStore();
    await store.writeWorkout(finished(), { kind: 'unchanged' });
    await putRaw(name, 'workouts', { id: 'from-another-build', localDate: '2026-04-01' });

    await expect(scanDays(store)).rejects.toThrow(LogbookStorageError);
  });
});

describe('upgrading a database written by version 1', () => {
  it('gains the index and keeps every workout', async () => {
    // The case that matters most: version 1 shipped, so a real phone is holding a
    // database with the workouts store and no index on it. `createStores` is
    // idempotent, which means the store already existing is the path where nothing
    // creates it and nothing would hang the index on it either -- so the index has
    // to be reached through the upgrade transaction, and this is what proves it was.
    const name = freshName();
    const at = contextSeries();
    const january = finished('2026-01-05', at);
    const march = finished('2026-03-11', at);
    await createVersion1(name, [january, march]);

    expect(await hasLocalDateIndex(name)).toBe(false);

    const store = await openLogbookStore({ databaseName: name });
    open.push(store);

    expect(await hasLocalDateIndex(name)).toBe(true);
    expect(await store.readWorkout(january.id)).toEqual(january);
    expect(await scanDays(store)).toEqual(['2026-03-11', '2026-01-05']);
  });

  it('leaves a fresh version 2 database indistinguishable from an upgraded one', async () => {
    const { store: fresh, name: freshDatabase } = await freshStore();
    const upgraded = freshName();
    await createVersion1(upgraded, []);
    const store = await openLogbookStore({ databaseName: upgraded });
    open.push(store);

    expect(await hasLocalDateIndex(freshDatabase)).toBe(true);
    expect(await hasLocalDateIndex(upgraded)).toBe(true);
    expect(fresh.durable).toBe(store.durable);
  });
});

describe('the active pointer moves with the workout', () => {
  it('lands both halves of a save', async () => {
    // The transaction covers two object stores. If the workout `put` were awaited
    // before the pointer `put`, the transaction would have committed in between and
    // the pointer would still be where it was.
    const { store } = await freshStore();
    const workout = finished();
    await store.writeWorkout(workout, { kind: 'set' });

    expect(await store.readActiveId()).toBe(workout.id);
    expect(await store.readWorkout(workout.id)).toEqual(workout);
  });

  it('clears the pointer and keeps the workout, in one transaction', async () => {
    const { store } = await freshStore();
    const workout = finished();
    await store.writeWorkout(workout, { kind: 'set' });
    await store.writeWorkout(workout, { kind: 'cleared' });

    expect(await store.readActiveId()).toBeNull();
    expect(await store.readWorkout(workout.id)).toEqual(workout);
  });

  it('leaves the pointer alone when the save is an edit to history', async () => {
    const { store } = await freshStore();
    const at = contextSeries();
    const live = finished('2026-03-11', at);
    const old = finished('2026-02-14', at);
    await store.writeWorkout(live, { kind: 'set' });
    await store.writeWorkout(old, { kind: 'unchanged' });

    expect(await store.readActiveId()).toBe(live.id);
  });

  it('clears a pointer that named the workout being deleted', async () => {
    // The read of the pointer and the two writes are one transaction, chained
    // through `onsuccess` rather than through an `await`. An `await` there would
    // reach a committed transaction and leave the pointer naming a workout that no
    // longer exists.
    const { store } = await freshStore();
    const workout = finished();
    await store.writeWorkout(workout, { kind: 'set' });
    await store.deleteWorkout(workout.id);

    expect(await store.readActiveId()).toBeNull();
    expect(await store.readWorkout(workout.id)).toBeNull();
  });

  it('leaves a pointer that named a different workout', async () => {
    const { store } = await freshStore();
    const at = contextSeries();
    const live = finished('2026-03-11', at);
    const old = finished('2026-02-14', at);
    await store.writeWorkout(live, { kind: 'set' });
    await store.writeWorkout(old, { kind: 'unchanged' });
    await store.deleteWorkout(old.id);

    expect(await store.readActiveId()).toBe(live.id);
    expect(await store.readWorkout(live.id)).toEqual(live);
  });
});

describe('replaceAll', () => {
  it('replaces rather than merges, across all four stores', async () => {
    const { store } = await freshStore();
    const before = contextSeries();
    await store.writeSettings(SETTINGS);
    await store.writeWorkout(finished('2026-01-01', before), { kind: 'set' });
    await store.writeExercise(exercise('cable-row'));
    await store.writeProfile(profile('home'));

    const after = contextSeries();
    const restored = finished('2026-03-11', after);
    await store.replaceAll({
      settings: defaultSettings(),
      equipmentProfiles: [],
      exerciseDefinitions: [],
      activeWorkout: null,
      workouts: [restored],
    });

    expect(await store.readWorkouts()).toEqual([restored]);
    expect(await store.readExercises()).toEqual([]);
    expect(await store.readProfiles()).toEqual([]);
    expect(await store.readActiveId()).toBeNull();
    expect(await store.readSettings()).toEqual(defaultSettings());
  });

  it('files the restored unfinished session once, with the pointer on it', async () => {
    const { store } = await freshStore();
    const active = finished();
    await store.replaceAll({
      settings: SETTINGS,
      equipmentProfiles: [],
      exerciseDefinitions: [],
      activeWorkout: active,
      workouts: [],
    });

    expect(await store.readActiveId()).toBe(active.id);
    expect(await store.readWorkouts()).toEqual([active]);
  });
});

describe('clearAll', () => {
  it('empties every store', async () => {
    const { store } = await freshStore();
    await store.writeSettings(SETTINGS);
    await store.writeWorkout(finished(), { kind: 'set' });
    await store.writeExercise(exercise('cable-row'));
    await store.writeProfile(profile('home'));

    await store.clearAll();

    expect(await store.readSettings()).toBeNull();
    expect(await store.readActiveId()).toBeNull();
    expect(await store.readWorkouts()).toEqual([]);
    expect(await store.readExercises()).toEqual([]);
    expect(await store.readProfiles()).toEqual([]);
  });
});

describe('a record this build does not understand', () => {
  it('throws rather than being skipped, on a single read', async () => {
    // Skipping would make a lifter's history quietly shorter, and section 10.4 says
    // the backup is authoritative -- so an export built on a silent skip would write
    // the loss into the only durable copy there is.
    const { store, name } = await freshStore();
    await putRaw(name, 'workouts', { id: 'from-another-build', shape: 'unknown' });

    await expect(store.readWorkout('from-another-build')).rejects.toThrow(LogbookStorageError);
  });

  it('throws on a list read too, rather than returning the readable ones', async () => {
    const { store, name } = await freshStore();
    await store.writeWorkout(finished(), { kind: 'unchanged' });
    await putRaw(name, 'workouts', { id: 'from-another-build', shape: 'unknown' });

    await expect(store.readWorkouts()).rejects.toThrow(LogbookStorageError);
  });

  it('says which store and which key, and nothing about the value', async () => {
    // Section 2.3. An error is what gets pasted into a bug report, and a training
    // log is a person's own numbers. The key is admitted because this package
    // generated it and it means nothing anywhere else.
    const { store, name } = await freshStore();
    await putRaw(name, 'workouts', { id: 'from-another-build', title: 'Wednesday squats' });

    const error = await store.readWorkout('from-another-build').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(LogbookStorageError);
    if (!(error instanceof LogbookStorageError)) throw new Error('expected a storage error');
    expect(error.reason).toBe('corrupt-record');
    expect(error.store).toBe('workouts');
    expect(error.key).toBe('from-another-build');
    expect(error.message).not.toContain('Wednesday squats');
  });

  it('throws for settings that are not settings', async () => {
    const { store, name } = await freshStore();
    await putRaw(name, 'state', { displayUnit: 'stone' }, 'settings');

    await expect(store.readSettings()).rejects.toThrow(LogbookStorageError);
  });

  it('throws for an active pointer that is not an identifier', async () => {
    // The pointer is a bare string rather than a record, so the schemas do not
    // cover it and it needs its own guard. Without one, `readActiveId` would answer
    // a number and `readWorkout` would look up a workout under it.
    const { store, name } = await freshStore();
    await putRaw(name, 'state', 42, 'active-workout-id');

    await expect(store.readActiveId()).rejects.toThrow(LogbookStorageError);
  });
});

describe('after close', () => {
  it('fails loudly rather than accepting a write that goes nowhere', async () => {
    // `close` is called when another tab needs a version this one is holding. A
    // write afterwards has to be an error: silently succeeding would tell the
    // caller a set was logged when nothing was written.
    const { store } = await freshStore();
    store.close();

    await expect(store.writeWorkout(finished(), { kind: 'set' })).rejects.toThrow();
  });
});
