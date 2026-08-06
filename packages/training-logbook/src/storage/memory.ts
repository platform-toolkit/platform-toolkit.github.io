// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A logbook store that keeps everything in memory.
 *
 * NOT A TEST DOUBLE
 *
 * Tests use it, but that is not why it exists. It exists because
 * {@link indexedDbLogbookStore} can legitimately answer "no" -- private browsing,
 * a managed device, a third-party frame whose storage the browser partitions away
 * -- and the alternative to this is a tool that shows a blank screen in exactly
 * those cases. A lifter who opens the logbook in a private window should be able
 * to log a session; they should simply be told, out loud, that it will not be here
 * tomorrow. {@link LogbookStore.durable} is how they get told.
 *
 * That is the same argument `packages/preferences` makes for
 * `memoryPreferenceStorage`, with one difference that matters: losing a remembered
 * bar weight costs a lifter a tap, and losing a logged session costs them training
 * they did. So the honesty requirement is stricter here, not looser -- a screen
 * built on this store must say so before the first set is logged, not after.
 *
 * WHY IT CLONES
 *
 * Every read returns a structured clone. The IndexedDB store does, because that is
 * what the database does, and a store that handed back its own live objects would
 * let a caller mutate the "database" by editing something it read -- a bug that
 * would pass every test written against this store and fail against the real one.
 */

import type {
  CustomExercise,
  EquipmentProfile,
  LogbookId,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';
import type { LogbookSnapshot } from '../core/backup.js';

import type { ActiveWorkoutPointer, LogbookStore } from './port.js';

/**
 * A deep copy, matching what a real database hands back.
 *
 * `structuredClone` rather than a JSON round trip: it is the algorithm IndexedDB
 * itself uses, so the two stores agree about what survives a write -- including
 * that `undefined` does not become `null` and that a cycle throws rather than
 * silently producing something else.
 */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Newest calendar day first, and deliberately nothing beyond that.
 *
 * Not `byMostRecent` from `../core/summary.js`, which breaks a same-day tie on
 * `updatedAt`. The port promises the day and only the day, because an index on
 * `localDate` is all the IndexedDB store can walk. Sorting further here would be
 * free in memory and would teach a caller to rely on an order the durable store
 * cannot give -- passing every Node test and coming apart on a phone, which is the
 * one failure a second implementation of a port exists to prevent.
 */
function byLocalDateDescending(a: WorkoutSession, b: WorkoutSession): number {
  if (a.localDate === b.localDate) return 0;
  return a.localDate < b.localDate ? 1 : -1;
}

/** Builds an in-memory store. Everything in it is gone when the page is. */
export function memoryLogbookStore(): LogbookStore {
  let settings: LogbookSettings | null = null;
  let activeId: LogbookId | null = null;
  const workouts = new Map<LogbookId, WorkoutSession>();
  const exercises = new Map<LogbookId, CustomExercise>();
  const profiles = new Map<LogbookId, EquipmentProfile>();

  function applyPointer(workout: WorkoutSession, active: ActiveWorkoutPointer): void {
    if (active.kind === 'set') activeId = workout.id;
    // Unconditional, and it matches what the IndexedDB store can do in one
    // transaction: clearing only when the pointer already named this workout would
    // need a read between two writes, and an `await` there ends the transaction.
    // The semantics are the same in practice -- `cleared` is only ever asked for by
    // `completeWorkout`, and finishing a session ends whatever session was live.
    if (active.kind === 'cleared') activeId = null;
  }

  return {
    durable: false,

    readSettings: () => Promise.resolve(settings === null ? null : copy(settings)),
    writeSettings: (next) => {
      settings = copy(next);
      return Promise.resolve();
    },

    readActiveId: () => Promise.resolve(activeId),

    readWorkout: (id) => {
      const found = workouts.get(id);
      return Promise.resolve(found === undefined ? null : copy(found));
    },
    readWorkouts: () => Promise.resolve([...workouts.values()].map(copy)),
    scanWorkouts: (visit) => {
      // Copied and ordered in full before the first visit, rather than iterated
      // live. The visitor is the caller's code and may write, and a `Map` edited
      // mid-iteration re-visits a moved entry -- where the cursor this stands in
      // for is reading a transaction's own snapshot and cannot.
      const ordered = [...workouts.values()].map(copy).sort(byLocalDateDescending);
      for (const workout of ordered) {
        if (visit(workout) === 'stop') break;
      }
      return Promise.resolve();
    },
    writeWorkout: (workout, active) => {
      workouts.set(workout.id, copy(workout));
      applyPointer(workout, active);
      return Promise.resolve();
    },
    deleteWorkout: (id) => {
      workouts.delete(id);
      if (activeId === id) activeId = null;
      return Promise.resolve();
    },

    readExercises: () => Promise.resolve([...exercises.values()].map(copy)),
    writeExercise: (exercise) => {
      exercises.set(exercise.id, copy(exercise));
      return Promise.resolve();
    },
    deleteExercise: (id) => {
      exercises.delete(id);
      return Promise.resolve();
    },

    readProfiles: () => Promise.resolve([...profiles.values()].map(copy)),
    writeProfile: (profile) => {
      profiles.set(profile.id, copy(profile));
      return Promise.resolve();
    },
    deleteProfile: (id) => {
      profiles.delete(id);
      return Promise.resolve();
    },

    replaceAll: (snapshot: LogbookSnapshot) => {
      workouts.clear();
      exercises.clear();
      profiles.clear();
      settings = copy(snapshot.settings);
      for (const workout of snapshot.workouts) workouts.set(workout.id, copy(workout));
      for (const exercise of snapshot.exerciseDefinitions) {
        exercises.set(exercise.id, copy(exercise));
      }
      for (const profile of snapshot.equipmentProfiles) profiles.set(profile.id, copy(profile));
      // The active workout is stored alongside the rest and named by the pointer,
      // not kept in a second place. A backup holds it separately because a file
      // has no pointer; a database does.
      if (snapshot.activeWorkout === null) {
        activeId = null;
      } else {
        workouts.set(snapshot.activeWorkout.id, copy(snapshot.activeWorkout));
        activeId = snapshot.activeWorkout.id;
      }
      return Promise.resolve();
    },

    clearAll: () => {
      settings = null;
      activeId = null;
      workouts.clear();
      exercises.clear();
      profiles.clear();
      return Promise.resolve();
    },

    close: () => {
      // Nothing to release. Declared so a caller never has to know which store it
      // was handed in order to shut it down.
    },
  };
}
