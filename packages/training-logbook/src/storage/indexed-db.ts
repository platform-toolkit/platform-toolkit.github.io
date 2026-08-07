// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The IndexedDB backing for the logbook.
 *
 * THE ONE RULE THAT GOVERNS EVERY FUNCTION HERE
 *
 * An IndexedDB transaction commits the moment the microtask queue drains with no
 * request outstanding. `await` drains the microtask queue. So `await`ing between
 * two requests of the same transaction ends the transaction, and the second
 * request throws `TransactionInactiveError` -- or worse, the first half of a
 * two-part write is already committed. Every multi-request transaction below
 * therefore issues *all* of its requests synchronously, or chains the later ones
 * inside an earlier one's `onsuccess`, and awaits only the transaction's
 * completion at the very end. There is no `await` inside a transaction in this
 * file, and there must never be one.
 *
 * WHY READS ARE VALIDATED WHEN THE REPOSITORY'S ARE NOT
 *
 * Two reasons, and the smaller one is that `IDBObjectStore.get` is typed `any`, so
 * something has to narrow it and a cast would be section 2.4's broad typing wearing
 * a hat. The larger one is that this is the only place a value can arrive from a
 * build that is not this one -- an older version of the tool left on a phone, a
 * partially-applied migration, a database another origin's script wrote to. A
 * record that fails to validate therefore **throws** rather than being skipped:
 * dropping it would make a lifter's history quietly shorter, and section 10.4 says
 * the backup is authoritative, so an export that silently omitted a workout would
 * write the loss into the only durable copy.
 *
 * STORAGE CAN SIMPLY NOT BE THERE
 *
 * Private browsing, a managed device, and a third-party frame whose storage the
 * browser partitions away are all normal. {@link indexedDbLogbookStore} answers
 * `null` for all of them and {@link openLogbookStore} falls back to memory, so a
 * caller never branches -- it reads `durable` and tells the lifter the truth.
 */

import * as v from 'valibot';

import {
  CustomExerciseSchema,
  EquipmentProfileSchema,
  LogbookSettingsSchema,
  WorkoutSessionSchema,
} from '../core/schema.js';
import type { LogbookSnapshot } from '../core/backup.js';
import type {
  CustomExercise,
  EquipmentProfile,
  LogbookId,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';

import { memoryLogbookStore } from './memory.js';
import type { ActiveWorkoutPointer, LogbookStore } from './port.js';

/** The database this package owns. Namespaced, because an origin hosts nine tools. */
export const DATABASE_NAME = 'platform-toolkit-training-logbook';

/**
 * The database version.
 *
 * Section 11.6's third number, and not the same as the package version or the
 * backup's `schemaVersion`. It changes when the *stores and indexes* change, which
 * is a different event from the persisted shape changing and rarer than either.
 *
 * Version 2 added {@link BY_LOCAL_DATE} to the workouts store. No record changed
 * shape, which is exactly why the number had to move anyway: an index is not
 * visible in a record, so a build reading a version 1 database would find the
 * store it expected and no index to scan.
 */
export const DATABASE_VERSION = 2;

const WORKOUTS = 'workouts';
const EXERCISES = 'exercises';
const PROFILES = 'profiles';
const STATE = 'state';

/** The workouts index behind {@link LogbookStore.scanWorkouts}. Section 9.3. */
const BY_LOCAL_DATE = 'by-local-date';

const SETTINGS_KEY = 'settings';
const ACTIVE_KEY = 'active-workout-id';

/** Why a storage operation failed. Coarse on purpose; see the note on the class. */
export type StorageFailure =
  /** The browser refused the database outright. */
  | 'unavailable'
  /** A read or write was rejected or the transaction aborted. */
  | 'operation-failed'
  /** A stored record does not match the shape this build understands. */
  | 'corrupt-record';

/**
 * A storage failure.
 *
 * Carries a reason and the store it happened in, and has nowhere to put a value --
 * the same construction as `DataSourceError` in `packages/data-access`, for the same
 * reason. An error is the thing that ends up in a bug report, and a training log is
 * full of a person's own numbers. The record key is admitted because it is an opaque
 * local identifier this package generated and means nothing anywhere else.
 */
export class LogbookStorageError extends Error {
  readonly reason: StorageFailure;
  readonly store: string | null;
  readonly key: string | null;

  constructor(reason: StorageFailure, store: string | null = null, key: string | null = null) {
    super(`training logbook storage ${reason}${store === null ? '' : ` in ${store}`}`);
    this.name = 'LogbookStorageError';
    this.reason = reason;
    this.store = store;
    this.key = key;
  }
}

/**
 * Awaits one request's value, as `unknown`.
 *
 * Generic in the request and narrow in the answer. `IDBRequest<T>` is invariant --
 * its event handlers are typed on `this` -- so a plain `IDBRequest<unknown>`
 * parameter rejects the `IDBRequest<any[]>` that `getAll` returns. Widening the
 * *result* here instead is what forces every caller through the schemas below,
 * rather than letting the DOM library's `any` leak into the rest of the file.
 */
function requestValue<T>(request: IDBRequest<T>, store: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const value: unknown = request.result;
      resolve(value);
    };
    request.onerror = () => {
      reject(new LogbookStorageError('operation-failed', store));
    };
  });
}

/** Awaits a transaction's commit, which is the only proof a write actually landed. */
function transactionDone(transaction: IDBTransaction, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(new LogbookStorageError('operation-failed', store));
    };
    transaction.onabort = () => {
      reject(new LogbookStorageError('operation-failed', store));
    };
  });
}

/** Narrows a stored record, or throws. See the header for why it is not skipped. */
function decode<T>(
  schema: v.GenericSchema<T>,
  value: unknown,
  store: string,
  key: string | null,
): T {
  if (!v.is(schema, value)) {
    throw new LogbookStorageError('corrupt-record', store, key);
  }
  return value;
}

/**
 * Narrows a whole store's contents.
 *
 * The `Array.isArray` guard cannot be made to fire from a real database -- `getAll`
 * answers an array or nothing -- and a mutation that deletes it passes every test.
 * It is held by the compiler rather than by a test: `requestValue` widens to
 * `unknown` on purpose, so without the guard the `.map` below is a TS2571 and the
 * only alternative is the cast section 2.4 forbids. Deleting it is not removing dead
 * code, it is removing the narrowing that makes the line beneath it legal.
 */
function decodeAll<T>(schema: v.GenericSchema<T>, values: unknown, store: string): readonly T[] {
  if (!Array.isArray(values)) {
    throw new LogbookStorageError('corrupt-record', store, null);
  }
  return values.map((value, index) => decode(schema, value, store, String(index)));
}

/**
 * The whole of `onupgradeneeded`, for every version a phone might be holding.
 *
 * It takes the *request* rather than the database because an index cannot be
 * reached from the database at all. Every step below is written idempotently, so
 * on an upgrade from version 1 the workouts store already exists,
 * `createObjectStore` is never called, and there is no returned store to hang the
 * index on. `request.transaction` is the versionchange transaction, and it is the
 * only handle to a store that was created by an earlier version. A fresh version 2
 * database and an upgraded version 1 one therefore come out identical, which is
 * the property the whole function is arranged around -- the alternative is a
 * migration ladder whose rungs are only ever exercised by the lifter it breaks.
 */
function createStores(request: IDBOpenDBRequest): void {
  const database = request.result;

  // `keyPath: 'id'` rather than out-of-line keys, so a record and its identity
  // cannot disagree -- an out-of-line key lets a workout be filed under one id
  // while carrying another, and the two only diverge under a bug nobody sees.
  for (const name of [WORKOUTS, EXERCISES, PROFILES]) {
    if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, { keyPath: 'id' });
    }
  }
  // Settings and the active-workout pointer, both singletons, in one store. A
  // store per singleton would buy nothing and cost a transaction scope every time
  // the two have to move together.
  if (!database.objectStoreNames.contains(STATE)) {
    database.createObjectStore(STATE);
  }

  // Unreachable: the property is null only outside a version change, and this
  // function runs from `onupgradeneeded` and nowhere else. Thrown rather than
  // cast, because a cast would also silence the day someone calls this from
  // somewhere it is not true, and an upgrade that quietly skipped the index would
  // leave `scanWorkouts` failing on one lifter's phone and nowhere in testing.
  const upgrade = request.transaction;
  if (upgrade === null) throw new LogbookStorageError('operation-failed', WORKOUTS);

  const workouts = upgrade.objectStore(WORKOUTS);
  // Not unique: several workouts share a calendar day, which is the ordinary case
  // rather than the edge one.
  if (!workouts.indexNames.contains(BY_LOCAL_DATE)) {
    workouts.createIndex(BY_LOCAL_DATE, 'localDate');
  }
}

/** How to open the database. Both fields exist so a test can drive a real one. */
export interface OpenDatabaseOptions {
  /** Defaults to {@link DATABASE_NAME}. A test uses a unique one per case. */
  readonly databaseName?: string;
  /** Defaults to `globalThis.indexedDB`. */
  readonly factory?: IDBFactory;
}

/**
 * Opens the database, or answers `null` where the browser will not give one.
 *
 * The property read is inside the try for the same reason `packages/preferences`
 * puts `localStorage` inside one: a denied global throws on access, before any
 * method is called, so a guard written as `if (typeof indexedDB === 'undefined')`
 * throws while evaluating its own condition.
 */
async function openDatabase(options: OpenDatabaseOptions): Promise<IDBDatabase | null> {
  let factory: IDBFactory;
  try {
    factory = options.factory ?? globalThis.indexedDB;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the DOM library declares `indexedDB` as always present, every non-browser host disagrees, and this package is meant to be importable from Node
    if (factory === undefined) return null;
  } catch {
    // Not swallowed: "there is no database here" is the answer this function
    // exists to give, and it is returned. Nothing in the exception is worth
    // reporting -- browsers throw a SecurityError for "you may not do this at
    // all", so even the name would mislead a reader into looking for a fault.
    return null;
  }

  try {
    return await new Promise<IDBDatabase | null>((resolve, reject) => {
      const request = factory.open(options.databaseName ?? DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        createStores(request);
      };
      request.onsuccess = () => {
        const database = request.result;
        // Another tab wants a version this one is holding open. Closing lets it
        // proceed; refusing would leave the other tab hung on `onblocked` for as
        // long as this one stays open, which on a phone is until it is killed.
        database.onversionchange = () => {
          database.close();
        };
        resolve(database);
      };
      request.onerror = () => {
        resolve(null);
      };
      request.onblocked = () => {
        // An older version is held open elsewhere and will not close. Falling back
        // to memory is wrong here and would be silent data loss, so this rejects
        // and the caller decides.
        reject(new LogbookStorageError('unavailable'));
      };
    });
  } catch (cause) {
    // A blocked upgrade is not an absent database, and only an absent one may become
    // `null`. `null` is this function's single way of saying the browser will not give
    // this origin a database at all -- private browsing, a managed device, a
    // partitioned frame -- which is permanent, and which sends `openLogbookStore` to
    // memory on purpose. `onblocked` is the opposite situation: the records are here
    // and another connection is holding the old version open, so the remedy is closing
    // a tab rather than accepting that nothing will be kept. Letting it land here
    // erased exactly the distinction the handler above rejects in order to preserve,
    // and it did so silently -- the caller was handed an empty memory store and told
    // only that this device is not durable.
    if (cause instanceof LogbookStorageError) throw cause;
    return null;
  }
}

/**
 * An IndexedDB-backed store, or `null` where the browser has no database to give.
 *
 * Private browsing, a managed device and a partitioned third-party frame all land
 * on `null`, and all three are ordinary rather than exceptional. Use
 * {@link openLogbookStore} unless the caller genuinely wants to handle the absence
 * itself.
 *
 * Throws {@link LogbookStorageError} with reason `unavailable` where the database
 * exists but an older connection is holding it open. That is not an absence and must
 * not be answered as one: a caller that reads `null` as "this browser has no database"
 * will do something permanent about a condition that is fixed by closing a tab.
 */
export async function indexedDbLogbookStore(
  options: OpenDatabaseOptions = {},
): Promise<LogbookStore | null> {
  const database = await openDatabase(options);
  if (database === null) return null;
  return storeOver(database);
}

/**
 * A store that always exists: IndexedDB where there is one, memory otherwise.
 *
 * The caller does not branch. It reads {@link LogbookStore.durable} and tells the
 * lifter whether this device is keeping their training, which is the only decision
 * that actually differs between the two.
 *
 * The one thing it does not absorb is a blocked upgrade, which propagates. Memory is
 * the right answer for a device that will never have a database and the wrong one for
 * a database that is a closed tab away, and the difference is invisible from here --
 * so it is the caller's, as the `onblocked` handler says.
 */
export async function openLogbookStore(options: OpenDatabaseOptions = {}): Promise<LogbookStore> {
  const store = await indexedDbLogbookStore(options);
  return store ?? memoryLogbookStore();
}

function storeOver(database: IDBDatabase): LogbookStore {
  async function readAll<T>(name: string, schema: v.GenericSchema<T>): Promise<readonly T[]> {
    const transaction = database.transaction(name, 'readonly');
    const values = await requestValue(transaction.objectStore(name).getAll(), name);
    return decodeAll(schema, values, name);
  }

  async function readOne<T>(
    name: string,
    key: string,
    schema: v.GenericSchema<T>,
  ): Promise<T | null> {
    const transaction = database.transaction(name, 'readonly');
    const value = await requestValue(transaction.objectStore(name).get(key), name);
    return value === undefined ? null : decode(schema, value, name, key);
  }

  async function writeOne(name: string, record: unknown): Promise<void> {
    const transaction = database.transaction(name, 'readwrite');
    transaction.objectStore(name).put(record);
    await transactionDone(transaction, name);
  }

  async function deleteOne(name: string, key: string): Promise<void> {
    const transaction = database.transaction(name, 'readwrite');
    transaction.objectStore(name).delete(key);
    await transactionDone(transaction, name);
  }

  return {
    durable: true,

    readSettings: () => readOne(STATE, SETTINGS_KEY, LogbookSettingsSchema),

    writeSettings: async (settings: LogbookSettings) => {
      const transaction = database.transaction(STATE, 'readwrite');
      transaction.objectStore(STATE).put(settings, SETTINGS_KEY);
      await transactionDone(transaction, STATE);
    },

    readActiveId: async () => {
      const transaction = database.transaction(STATE, 'readonly');
      const value = await requestValue(transaction.objectStore(STATE).get(ACTIVE_KEY), STATE);
      if (value === undefined) return null;
      if (typeof value !== 'string') {
        throw new LogbookStorageError('corrupt-record', STATE, ACTIVE_KEY);
      }
      return value;
    },

    readWorkout: (id: LogbookId) => readOne(WORKOUTS, id, WorkoutSessionSchema),
    readWorkouts: () => readAll(WORKOUTS, WorkoutSessionSchema),

    scanWorkouts: (visit) =>
      // A `new Promise` rather than the `async` shape the rest of this file uses,
      // and that is the header's rule holding: each step of the walk is issued from
      // the previous request's own success handler, so the transaction stays alive.
      // An `async` loop awaiting each `onsuccess` would drain the microtask queue
      // between rungs, commit the transaction under the cursor, and fail on the
      // second record of a history long enough to matter.
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(WORKOUTS, 'readonly');
        const request = transaction
          .objectStore(WORKOUTS)
          .index(BY_LOCAL_DATE)
          // `prev` over an index on `localDate` is newest day first. Section 9.3's
          // whole point: the records after the visitor stops are never read, never
          // deserialised, and never cost the lifter anything.
          .openCursor(null, 'prev');

        request.onsuccess = () => {
          const cursor = request.result;
          // Exhausted, and an empty store arrives here on the first callback.
          if (cursor === null) {
            resolve();
            return;
          }

          const value: unknown = cursor.value;
          // `primaryKey` is an `IDBValidKey`; this store's key path is `id`, which
          // is a string. Narrowed rather than stringified, because the only way a
          // non-string arrives is a record this build did not write -- and that is
          // what the error about to be thrown already says.
          const key = typeof cursor.primaryKey === 'string' ? cursor.primaryKey : null;
          let workout: WorkoutSession;
          try {
            workout = decode(WorkoutSessionSchema, value, WORKOUTS, key);
          } catch {
            // Rejected rather than allowed to propagate. A throw out of an
            // IndexedDB event handler aborts the transaction and surfaces as an
            // unhandled error on the window -- the caller's scan would hang rather
            // than fail. The error is rebuilt rather than re-raised because the
            // caught value is `unknown` and narrowing it back would be less honest
            // than restating the one thing `decode` throws.
            reject(new LogbookStorageError('corrupt-record', WORKOUTS, key));
            return;
          }

          if (visit(workout) === 'stop') {
            resolve();
            return;
          }
          cursor.continue();
        };

        request.onerror = () => {
          reject(new LogbookStorageError('operation-failed', WORKOUTS));
        };
      }),

    writeWorkout: async (workout: WorkoutSession, active: ActiveWorkoutPointer) => {
      const transaction = database.transaction([WORKOUTS, STATE], 'readwrite');
      transaction.objectStore(WORKOUTS).put(workout);
      // Both requests issued before anything is awaited. Awaiting the first would
      // commit the transaction and leave the pointer where it was -- a workout
      // saved as finished with the session still marked live.
      if (active.kind === 'set') transaction.objectStore(STATE).put(workout.id, ACTIVE_KEY);
      if (active.kind === 'cleared') transaction.objectStore(STATE).delete(ACTIVE_KEY);
      await transactionDone(transaction, WORKOUTS);
    },

    deleteWorkout: async (id: LogbookId) => {
      const transaction = database.transaction([WORKOUTS, STATE], 'readwrite');
      const state = transaction.objectStore(STATE);
      const current = state.get(ACTIVE_KEY);
      // Chained inside `onsuccess` rather than after an `await`. A request issued
      // from a request's own success handler keeps the transaction alive; one
      // issued after an `await` arrives at a transaction that has already
      // committed, and the pointer is then left naming a workout that is gone.
      current.onsuccess = () => {
        const value: unknown = current.result;
        if (value === id) state.delete(ACTIVE_KEY);
      };
      transaction.objectStore(WORKOUTS).delete(id);
      await transactionDone(transaction, WORKOUTS);
    },

    readExercises: () => readAll(EXERCISES, CustomExerciseSchema),
    writeExercise: (exercise: CustomExercise) => writeOne(EXERCISES, exercise),
    deleteExercise: (id: LogbookId) => deleteOne(EXERCISES, id),

    readProfiles: () => readAll(PROFILES, EquipmentProfileSchema),
    writeProfile: (profile: EquipmentProfile) => writeOne(PROFILES, profile),
    deleteProfile: (id: LogbookId) => deleteOne(PROFILES, id),

    replaceAll: async (snapshot: LogbookSnapshot) => {
      // One transaction over all four stores. Section 10.7's eighth and tenth
      // steps in one construct: either the whole restore lands or the database is
      // exactly as it was, and there is no window in which a lifter holds half of
      // one backup and half of another.
      const transaction = database.transaction([WORKOUTS, EXERCISES, PROFILES, STATE], 'readwrite');
      const workouts = transaction.objectStore(WORKOUTS);
      const exercises = transaction.objectStore(EXERCISES);
      const profiles = transaction.objectStore(PROFILES);
      const state = transaction.objectStore(STATE);

      workouts.clear();
      exercises.clear();
      profiles.clear();
      state.clear();

      state.put(snapshot.settings, SETTINGS_KEY);
      for (const workout of snapshot.workouts) workouts.put(workout);
      for (const exercise of snapshot.exerciseDefinitions) exercises.put(exercise);
      for (const profile of snapshot.equipmentProfiles) profiles.put(profile);
      if (snapshot.activeWorkout !== null) {
        workouts.put(snapshot.activeWorkout);
        state.put(snapshot.activeWorkout.id, ACTIVE_KEY);
      }

      await transactionDone(transaction, WORKOUTS);
    },

    clearAll: async () => {
      const transaction = database.transaction([WORKOUTS, EXERCISES, PROFILES, STATE], 'readwrite');
      transaction.objectStore(WORKOUTS).clear();
      transaction.objectStore(EXERCISES).clear();
      transaction.objectStore(PROFILES).clear();
      transaction.objectStore(STATE).clear();
      await transactionDone(transaction, WORKOUTS);
    },

    close: () => {
      database.close();
    },
  };
}
