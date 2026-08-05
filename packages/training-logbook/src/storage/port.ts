// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The narrow seam between "what the logbook does with stored data" and "where the
 * bytes actually live".
 *
 * WHY THERE IS A PORT UNDER THE REPOSITORY
 *
 * {@link TrainingLogbookRepository} in `./repository.ts` is what a consumer sees,
 * and most of what it does is not storage: filtering a history query, summarising
 * a workout into a history row, assembling a backup envelope. None of that changes
 * with the backing store, and none of it should have to be written twice or tested
 * twice. So the repository is built once over this port, and a backing store only
 * has to be right about reading and writing.
 *
 * That split is what makes the IndexedDB adapter testable at all. Its genuinely
 * hard behaviours -- a transaction that auto-commits the moment the microtask
 * queue drains, a private-browsing context that refuses to open a database, a
 * second tab holding an upgrade open -- are exactly the ones a fake gets wrong, so
 * they are proven in a real browser. Everything else is proven in Node against the
 * in-memory store, where a test can be about the rule rather than about the
 * database.
 *
 * TWO OPERATIONS ARE ATOMIC BY CONTRACT AND NOT BY CONVENTION
 *
 * {@link LogbookStore.writeWorkout} moves the active pointer in the same breath as
 * it writes the workout, and {@link LogbookStore.replaceAll} rewrites everything at
 * once. Both are single methods rather than sequences a caller composes, because
 * the interesting failure is a phone dying between two writes: a workout marked
 * finished with the active pointer still aimed at it reopens as a live session
 * whose sets are all already ticked, and a half-applied restore is section 10.7's
 * tenth step -- "preserve the prior database if any step fails" -- broken in the
 * one place it was written for.
 */

import type {
  CustomExercise,
  EquipmentProfile,
  LogbookId,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';

import type { LogbookSnapshot } from '../core/backup.js';

/** What a write should do to the pointer naming the workout in progress. */
export type ActiveWorkoutPointer =
  /** Leave it where it is. Editing a finished workout must not resume it. */
  | { readonly kind: 'unchanged' }
  /** Aim it at the workout being written. */
  | { readonly kind: 'set' }
  /**
   * Clear it, whatever it named.
   *
   * Unconditional rather than "clear it if it named this workout", because the
   * conditional form needs a read between two writes and an IndexedDB transaction
   * does not survive the `await` that would take. Only `completeWorkout` asks for
   * it, and finishing a session ends whichever session was live.
   */
  | { readonly kind: 'cleared' };

/**
 * Somewhere to keep one lifter's training on one device.
 *
 * Every method may reject. Nothing here converts a storage failure into a quiet
 * default, because unlike a remembered bar weight (see `packages/preferences`),
 * a workout that silently failed to save is training a lifter did and cannot see
 * -- the one outcome this tool exists to prevent.
 */
export interface LogbookStore {
  /**
   * Which backing this is.
   *
   * Exposed because a screen has to be able to say "this device is not keeping
   * your training" out loud. A memory store is a supported mode, and a supported
   * mode a lifter is not told about is a data-loss trap.
   */
  readonly durable: boolean;

  readSettings(): Promise<LogbookSettings | null>;
  writeSettings(settings: LogbookSettings): Promise<void>;

  /** The identifier of the workout in progress, if there is one. */
  readActiveId(): Promise<LogbookId | null>;

  readWorkout(id: LogbookId): Promise<WorkoutSession | null>;
  /** Every stored workout, in no guaranteed order. Ordering is the repository's job. */
  readWorkouts(): Promise<readonly WorkoutSession[]>;
  /** Writes the workout and moves the active pointer, in one transaction. */
  writeWorkout(workout: WorkoutSession, active: ActiveWorkoutPointer): Promise<void>;
  /**
   * Deletes a workout, clearing the active pointer if it named that workout.
   *
   * The pointer clearing is part of the contract rather than the caller's problem:
   * a dangling pointer makes `loadActiveWorkout` answer `null` for a session the
   * lifter can see nothing wrong with, and the next `saveActiveWorkout` resurrects
   * a workout they deleted.
   */
  deleteWorkout(id: LogbookId): Promise<void>;

  readExercises(): Promise<readonly CustomExercise[]>;
  writeExercise(exercise: CustomExercise): Promise<void>;
  deleteExercise(id: LogbookId): Promise<void>;

  readProfiles(): Promise<readonly EquipmentProfile[]>;
  writeProfile(profile: EquipmentProfile): Promise<void>;
  deleteProfile(id: LogbookId): Promise<void>;

  /** Replaces everything with the given snapshot, atomically. Section 10.7 step 8. */
  replaceAll(snapshot: LogbookSnapshot): Promise<void>;
  /** Removes everything, atomically. Section 10.6. */
  clearAll(): Promise<void>;

  /** Releases the backing. Calling it twice is not an error. */
  close(): void;
}
