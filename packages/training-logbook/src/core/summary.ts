// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading a workout: progress, duration, and the one-line version a history list
 * shows.
 *
 * DERIVED, NEVER STORED
 *
 * Everything here is a function of a {@link WorkoutSession} and nothing here is
 * written back into one. That is deliberate and it is the reason `SetStatus` has
 * four members rather than section 7.4's five: whether a set was completed *as
 * planned* or *with an edited result* is a comparison between two fields that are
 * already there, and a stored flag would be a third copy of the same fact -- one
 * that the first edit to forget it would leave lying.
 *
 * The same argument applies to a summary. Section 9.3 permits cached derived
 * records for performance, and if one is ever built it must be rebuildable from
 * canonical history; keeping the only definition of "summary" a pure function is
 * what makes that rebuild a call rather than a reimplementation.
 */

import type { Weight } from '@platform-toolkit/domain';

import type {
  SetLoad,
  SetPerformance,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

/** Whether the result differs from what was written down. */
export function setWasEdited(set: WorkoutSet): boolean {
  const { planned, performed } = set;
  if (planned === null || performed === null) return false;
  return !samePerformance(planned, performed);
}

/**
 * Effort is deliberately not compared.
 *
 * Section 7.10: an effort is entered and never generated, so nothing anywhere
 * plans one -- `warmup.ts` writes `null` into every rung it produces and the
 * builder has no field for it. A recorded RPE therefore always differs from a
 * planned nothing, and comparing the two would put the "Edited" line under every
 * set a lifter said how hard it felt. An effort is not a departure from the plan;
 * it is a fact about the set that only exists once the set is done.
 */
function samePerformance(a: SetPerformance, b: SetPerformance): boolean {
  if (a.repetitions !== b.repetitions) return false;
  return sameLoad(a.load, b.load);
}

/** The weight a load carries, or `null` for the kind that carries none. */
export function loadWeight(load: SetLoad): Weight | null {
  return load.kind === 'none' ? null : load.weight;
}

function sameLoad(a: SetLoad, b: SetLoad): boolean {
  if (a.kind !== b.kind) return false;
  const left = loadWeight(a);
  const right = loadWeight(b);
  if (left === null || right === null) return left === right;
  // Compared in the unit it was entered in, not converted. 100 kg and 220.46 lb
  // are the same mass and are not the same entry, and section 11.4 says a number
  // is never silently reinterpreted.
  return left.amount === right.amount && left.unit === right.unit;
}

/** Whether a set counts towards "did the work": working, backoff, or AMRAP. */
export function isWorkingSet(set: WorkoutSet): boolean {
  return set.kind === 'working' || set.kind === 'backoff' || set.kind === 'amrap';
}

/** How far through a workout the lifter is. */
export interface WorkoutProgress {
  /** Sets ticked off, whether as planned or edited. */
  readonly completed: number;
  /** Sets attempted and not finished. */
  readonly incomplete: number;
  /** Sets deliberately not done. */
  readonly skipped: number;
  /** Sets still waiting. */
  readonly remaining: number;
  /** Every set in the workout. */
  readonly total: number;
}

/** Counts the sets of a workout by what became of them. */
export function workoutProgress(session: WorkoutSession): WorkoutProgress {
  let completed = 0;
  let incomplete = 0;
  let skipped = 0;
  let remaining = 0;

  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      switch (set.status) {
        case 'complete':
          completed += 1;
          break;
        case 'incomplete':
          incomplete += 1;
          break;
        case 'skipped':
          skipped += 1;
          break;
        case 'planned':
          remaining += 1;
          break;
      }
    }
  }

  return {
    completed,
    incomplete,
    skipped,
    remaining,
    total: completed + incomplete + skipped + remaining,
  };
}

/**
 * How long the session took, in whole milliseconds, or `null`.
 *
 * `null` covers three cases that are all the same answer on a screen: it has not
 * started, it has not finished, or one of the stamps is not a date this runtime
 * can read -- which a restored backup from another tool could hand over. A
 * negative span is `null` too. A clock that moved backwards mid-session (a phone
 * picking up network time, a manual correction) would otherwise print a negative
 * duration, and "one hour twelve" is worth showing while "minus three minutes" is
 * not.
 */
export function workoutDurationMillis(session: WorkoutSession): number | null {
  const { startedAt, completedAt } = session;
  if (startedAt === null || completedAt === null) return null;
  const from = Date.parse(startedAt);
  const to = Date.parse(completedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const span = to - from;
  return span >= 0 ? span : null;
}

/** The exercises worth naming in a one-line history row. */
function majorExercises(session: WorkoutSession): readonly string[] {
  const named = session.exercises
    .filter((exercise) => exercise.sets.some(isWorkingSet))
    .map((exercise) => exercise.displayName);
  // An exercise with no working sets at all -- warm-ups only, or a session that
  // was abandoned early -- still happened, and a row naming nothing reads as an
  // empty workout. Falling back to every exercise is more honest than a blank.
  return named.length > 0 ? named : session.exercises.map((exercise) => exercise.displayName);
}

function hasNote(exercise: WorkoutExercise): boolean {
  return exercise.note !== null || exercise.sets.some((set) => set.note !== null);
}

/** One row of the history list. Section 5.4. */
export interface WorkoutSummary {
  readonly id: WorkoutSession['id'];
  readonly localDate: WorkoutSession['localDate'];
  readonly status: WorkoutSession['status'];
  readonly title: string | null;
  readonly exerciseNames: readonly string[];
  /** Whole milliseconds, or `null` where it cannot be known. */
  readonly durationMillis: number | null;
  /** Completed working, backoff and AMRAP sets. Warm-ups are not the work. */
  readonly completedWorkingSets: number;
  readonly progress: WorkoutProgress;
  /** Whether there is a note anywhere in it, so a row can show one mark. */
  readonly hasNotes: boolean;
  readonly updatedAt: WorkoutSession['updatedAt'];
}

/** The one-line version of a workout. */
export function summarize(session: WorkoutSession): WorkoutSummary {
  const completedWorkingSets = session.exercises.reduce(
    (count, exercise) =>
      count + exercise.sets.filter((set) => isWorkingSet(set) && set.status === 'complete').length,
    0,
  );

  return {
    id: session.id,
    localDate: session.localDate,
    status: session.status,
    title: session.title,
    exerciseNames: majorExercises(session),
    durationMillis: workoutDurationMillis(session),
    completedWorkingSets,
    progress: workoutProgress(session),
    hasNotes: session.note !== null || session.exercises.some(hasNote),
    updatedAt: session.updatedAt,
  };
}

/**
 * History order: newest day first, and within a day the one touched most
 * recently.
 *
 * The tie-break is not decoration. Two workouts on the same calendar day is
 * ordinary -- a morning squat session and an evening bench session -- and a sort
 * on the day alone leaves their order to whatever the storage layer happened to
 * return, which changes between browsers and between a fresh database and a
 * restored one.
 */
export function byMostRecent(a: WorkoutSummary, b: WorkoutSummary): number {
  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? 1 : -1;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return 0;
}
