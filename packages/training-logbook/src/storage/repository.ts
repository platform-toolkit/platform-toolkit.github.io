// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The repository a consumer supplies and the logbook element consumes.
 *
 * Section 12.4, and section 15's rule that storage sits behind an adapter the host
 * provides rather than a database the package reaches for. The public shell hands
 * it IndexedDB; a native host hands it something else; a test hands it a `Map`.
 * Nothing above this line knows which.
 *
 * WHAT THIS ADDS OVER THE PORT BENEATH IT
 *
 * Ordering, filtering, summarising, default settings, and the backup envelope.
 * All of it is the same regardless of where bytes live, so it is written once here
 * and tested once, against the in-memory store.
 *
 * WHERE VALIDATION HAPPENS, AND WHY NOT HERE
 *
 * Two layers below this one validate and this one does not, which is deliberate
 * rather than an omission. `../core/backup.ts` validates a restore file because a
 * lifter chose it off a disk. `./indexed-db.ts` validates what it reads because a
 * record can outlive the build that wrote it. By the time a value reaches this
 * file it has passed whichever of those applies, and a third check here would only
 * ever fire on a bug in the two below -- turning a defect into a lifter locked out
 * of their own history.
 */

import { createBackup, type LogbookSnapshot, type TrainingLogbookBackup } from '../core/backup.js';
import { searchPreviousPerformance, type PreviousPerformance } from '../core/previous.js';
import {
  searchExerciseHistory,
  type ExerciseHistory,
  type ExerciseHistoryOptions,
} from '../core/records.js';
import { byMostRecent, summarize, type WorkoutSummary } from '../core/summary.js';
import { SCHEMA_VERSION } from '../core/session.js';
import type {
  CalendarDay,
  CustomExercise,
  EquipmentProfile,
  Instant,
  LogbookId,
  LogbookSettings,
  WorkoutSession,
  WorkoutStatus,
} from '../types.js';

import type { LogbookStore } from './port.js';

/**
 * What a lifter gets before they have chosen anything.
 *
 * Pounds, matching the warm-up calculator's default, because a lifter who moves
 * between two tools in this collection and sees two different units has been told
 * something is wrong when nothing is. Section 4.1 asks the unit question on first
 * use anyway, so this is the value in force for the few seconds before they answer
 * -- not a guess this tool intends to stand behind.
 *
 * Effort is off. Section 7.10: RPE and RIR are an opt-in, and a logging screen that
 * demands a number a lifter does not use is three taps of friction per set.
 */
export function defaultSettings(): LogbookSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    displayUnit: 'lb',
    effort: 'none',
    restTimer: { enabled: false, defaultSeconds: 180, perExerciseSeconds: {} },
    equipment: null,
    acceptedTerms: {},
    lastBackupAt: null,
  };
}

/** Which slice of the history to read. Every field is optional and narrows. */
export interface WorkoutHistoryQuery {
  /** Inclusive. A `YYYY-MM-DD` day, compared as a string; see `../types.ts`. */
  readonly from?: CalendarDay;
  /** Inclusive. */
  readonly to?: CalendarDay;
  readonly status?: WorkoutStatus;
  /** At most this many rows, taken after ordering. */
  readonly limit?: number;
}

/**
 * The contract a host implements to give the logbook somewhere to live.
 *
 * Section 12.4. Every method is async even where an implementation could answer
 * without waiting, so that swapping IndexedDB for something slower is a change of
 * one line of composition rather than a change to every caller -- the same rule,
 * for the same reason, as the `DataSource` seam in `packages/data-access`.
 */
export interface TrainingLogbookRepository {
  loadSettings(): Promise<LogbookSettings>;
  saveSettings(settings: LogbookSettings): Promise<void>;

  loadActiveWorkout(): Promise<WorkoutSession | null>;
  /** Saves the workout in progress and points the active marker at it. */
  saveActiveWorkout(workout: WorkoutSession): Promise<void>;
  /** Saves a finished workout and clears the active marker, in one transaction. */
  completeWorkout(workout: WorkoutSession): Promise<void>;

  listWorkouts(query?: WorkoutHistoryQuery): Promise<readonly WorkoutSummary[]>;
  getWorkout(id: LogbookId): Promise<WorkoutSession | null>;
  /**
   * What each of these exercises was last performed for. Section 7.8, LOG-011.
   *
   * Keyed by `exerciseId` and never by display name, which is snapshotted per session
   * and so differs between two records of the same lift. An exercise with nothing to
   * report is **absent** from the map rather than present with an empty list.
   *
   * Bounded: it walks the history newest day first and stops as soon as every id is
   * answered, so a lifter with three years of sessions pays for the recent ones.
   */
  lastPerformance(
    exerciseIds: readonly string[],
  ): Promise<ReadonlyMap<string, PreviousPerformance>>;
  /**
   * One exercise read back across its whole history. Sections 5.5 and 9.2.
   *
   * The one read here that does **not** stop early, and the only one that may not: a
   * marker saying "the most you have ever lifted" is a claim about all of it, and a
   * walk cut short would answer a narrower question under the same word. What is
   * bounded is what comes back -- full detail for the newest `limit` sessions and a
   * handful of numbers from every session before them -- so the answer's size does not
   * grow with the history even though the time does. Section 9.3.
   *
   * `exerciseId` and never a display name, for `lastPerformance`'s reason.
   */
  exerciseHistory(exerciseId: string, options?: ExerciseHistoryOptions): Promise<ExerciseHistory>;
  /** Saves a workout without touching the active marker. Editing history. */
  saveWorkout(workout: WorkoutSession): Promise<void>;
  deleteWorkout(id: LogbookId): Promise<void>;

  listExercises(): Promise<readonly CustomExercise[]>;
  saveExercise(exercise: CustomExercise): Promise<void>;
  deleteExercise(id: LogbookId): Promise<void>;

  listEquipmentProfiles(): Promise<readonly EquipmentProfile[]>;
  saveEquipmentProfile(profile: EquipmentProfile): Promise<void>;
  deleteEquipmentProfile(id: LogbookId): Promise<void>;

  exportSnapshot(): Promise<TrainingLogbookBackup>;
  replaceFromBackup(backup: TrainingLogbookBackup): Promise<void>;
  clearAll(): Promise<void>;

  /** Whether what is written here survives the tab closing. */
  readonly durable: boolean;
}

/** What a repository needs that a store cannot supply. */
export interface RepositoryOptions {
  /** The current instant. Injected for the same reason the core takes one. */
  readonly now: () => Instant;
  /** The build stamped into a backup, for a human reading the file. */
  readonly applicationVersion: string;
}

function withinQuery(workout: WorkoutSession, query: WorkoutHistoryQuery): boolean {
  if (query.from !== undefined && workout.localDate < query.from) return false;
  if (query.to !== undefined && workout.localDate > query.to) return false;
  if (query.status !== undefined && workout.status !== query.status) return false;
  return true;
}

/**
 * Builds the repository over a store.
 *
 * Not a class. There is no state here beyond the two arguments, and a closure makes
 * the store unreachable from outside -- which matters because the store's contract
 * has invariants (the active pointer moves with the workout) that a caller holding
 * both objects could step around without noticing.
 */
export function createRepository(
  store: LogbookStore,
  options: RepositoryOptions,
): TrainingLogbookRepository {
  async function readSnapshot(): Promise<LogbookSnapshot> {
    // Read in parallel: five independent reads, and on a cold IndexedDB each one
    // is a transaction. Serialised, a lifter with a year of training watches the
    // export button do nothing for a noticeable moment.
    const [settings, activeId, workouts, exerciseDefinitions, equipmentProfiles] =
      await Promise.all([
        store.readSettings(),
        store.readActiveId(),
        store.readWorkouts(),
        store.readExercises(),
        store.readProfiles(),
      ]);

    return {
      settings: settings ?? defaultSettings(),
      equipmentProfiles,
      exerciseDefinitions,
      // Filtered out of `workouts` rather than stored twice. A backup that carried
      // the active session in both places would restore it twice, and the second
      // copy would be a finished-looking workout nobody did.
      activeWorkout: workouts.find((workout) => workout.id === activeId) ?? null,
      workouts: workouts.filter((workout) => workout.id !== activeId),
    };
  }

  return {
    durable: store.durable,

    async loadSettings() {
      return (await store.readSettings()) ?? defaultSettings();
    },

    async saveSettings(settings) {
      await store.writeSettings(settings);
    },

    async loadActiveWorkout() {
      const id = await store.readActiveId();
      if (id === null) return null;
      return store.readWorkout(id);
    },

    async saveActiveWorkout(workout) {
      await store.writeWorkout(workout, { kind: 'set' });
    },

    async completeWorkout(workout) {
      await store.writeWorkout(workout, { kind: 'cleared' });
    },

    async listWorkouts(query = {}) {
      const workouts = await store.readWorkouts();
      const rows = workouts
        .filter((workout) => withinQuery(workout, query))
        .map(summarize)
        .sort(byMostRecent);
      // Sliced after ordering, never before. A limit applied to whatever the
      // database iterated first would give a lifter "your last ten workouts" made
      // of ten arbitrary ones, which reads as correct and is not.
      return query.limit === undefined ? rows : rows.slice(0, Math.max(0, query.limit));
    },

    async getWorkout(id) {
      return store.readWorkout(id);
    },

    async lastPerformance(exerciseIds) {
      // Short-circuited before touching the store. `scanWorkouts` opens a
      // transaction and the search would refuse the first session anyway, so the
      // empty case is a database read with a guaranteed empty answer -- and it is
      // the ordinary case, because the screen calls this for a session that has no
      // exercises in it yet.
      if (exerciseIds.length === 0) return new Map();
      const search = searchPreviousPerformance(exerciseIds);
      await store.scanWorkouts((workout) => (search.consider(workout) ? 'continue' : 'stop'));
      return search.found();
    },

    async exerciseHistory(exerciseId, options = {}) {
      const search = searchExerciseHistory(exerciseId, options);
      // Always `continue`, unlike every other scan in this file. The reason is in the
      // interface above, and the constant is here so that a future edit has to delete
      // a word rather than change a comparison.
      await store.scanWorkouts((workout) => {
        search.consider(workout);
        return 'continue';
      });
      return search.history();
    },

    async saveWorkout(workout) {
      await store.writeWorkout(workout, { kind: 'unchanged' });
    },

    async deleteWorkout(id) {
      await store.deleteWorkout(id);
    },

    async listExercises() {
      return store.readExercises();
    },

    async saveExercise(exercise) {
      await store.writeExercise(exercise);
    },

    async deleteExercise(id) {
      await store.deleteExercise(id);
    },

    async listEquipmentProfiles() {
      return store.readProfiles();
    },

    async saveEquipmentProfile(profile) {
      await store.writeProfile(profile);
    },

    async deleteEquipmentProfile(id) {
      await store.deleteProfile(id);
    },

    async exportSnapshot() {
      return createBackup(await readSnapshot(), {
        exportedAt: options.now(),
        applicationVersion: options.applicationVersion,
      });
    },

    async replaceFromBackup(backup) {
      await store.replaceAll(backup.data);
    },

    async clearAll() {
      await store.clearAll();
    },
  };
}
