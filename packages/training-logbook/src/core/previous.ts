// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What an exercise was lifted for last time. Section 7.8, LOG-011.
 *
 * The pure half of it. Nothing here opens a store and nothing here decides which
 * sessions exist: a caller walks its own history newest first and hands each
 * session over one at a time, which keeps the answer a function of values and
 * keeps the paging rules in the half of the package that knows a database is
 * there.
 *
 * THE LAST ONE, NEVER THE BEST ONE
 *
 * "Previous performance" on a training screen reads as a personal record, and that
 * is the wrong reading here. Sections 15.3 and 16.1: this package records and does
 * not score, so no two performances are ever compared in this file and none ever
 * may be. What comes back is the most recent comparable set of numbers, with the
 * day they were done, for a lifter to draw their own conclusion from.
 *
 * WHY A COLLECTOR AND NOT A FUNCTION OVER A HISTORY
 *
 * `previousPerformance(history, wanted)` is the shorter signature, and it makes
 * every caller load a whole logbook to answer a question about four exercises. A
 * history has no upper bound and the target device is a phone.
 * {@link searchPreviousPerformance} inverts it: the caller reads a page, asks
 * after each session whether another page is worth fetching, and stops when the
 * answer is no.
 */

import type { CalendarDay, Instant, SetPerformance, WorkoutSession } from '../types.js';

import { isWorkingSet } from './summary.js';

/** The most recent comparable performed result for one exercise. Section 7.8. */
export interface PreviousPerformance {
  readonly exerciseId: string;
  /** The day it was done, for the caller to render. */
  readonly localDate: CalendarDay;
  /** The performed working sets, in the order they were done. Never empty. */
  readonly sets: readonly SetPerformance[];
}

/**
 * What one session contributes towards the exercises asked for.
 *
 * Only a completed session contributes anything. A draft holds a plan and not a
 * result; an active one is the session on the screen, and offering this morning's
 * second set as "last time" beside the third is the tool answering a question
 * nobody asked; a discarded one is a session the lifter threw away.
 *
 * An exercise with nothing to show is absent rather than present and empty. The
 * two are one length check apart and only one of them can be rendered without a
 * guard, so a caller that forgets the guard gets a missing key it already has to
 * handle rather than a card reading "last time: nothing".
 */
export function previousPerformanceIn(
  session: WorkoutSession,
  wanted: ReadonlySet<string>,
): ReadonlyMap<string, PreviousPerformance> {
  const found = new Map<string, PreviousPerformance>();
  if (session.status !== 'completed') return found;

  for (const exercise of session.exercises) {
    if (!wanted.has(exercise.exerciseId)) continue;

    const sets: SetPerformance[] = [];
    for (const set of exercise.sets) {
      const { performed } = set;
      if (performed === null) continue;
      if (!isWorkingSet(set) || set.status !== 'complete') continue;
      sets.push(performed);
    }
    if (sets.length === 0) continue;

    // One exercise listed twice -- squats at the front of the session and again
    // as back-offs at the end -- is one exercise's work in two blocks, and taking
    // only the second block would drop the heavy half of it.
    const earlier = found.get(exercise.exerciseId);
    found.set(exercise.exerciseId, {
      exerciseId: exercise.exerciseId,
      localDate: session.localDate,
      sets: earlier === undefined ? sets : [...earlier.sets, ...sets],
    });
  }
  return found;
}

/** A walk through a history that knows when it has read enough of it. */
export interface PreviousPerformanceSearch {
  /** Feed the next session, newest first. Returns whether more sessions are still worth reading. */
  readonly consider: (session: WorkoutSession) => boolean;
  /** What has been found so far. */
  readonly found: () => ReadonlyMap<string, PreviousPerformance>;
}

/** An answer and the stamp of the session it came from, for the same-day tie. */
interface Held {
  readonly entry: PreviousPerformance;
  readonly updatedAt: Instant;
}

/**
 * Collects each wanted exercise's previous performance from a newest-first walk.
 *
 * WHY IT DOES NOT STOP ON THE LAST ANSWER
 *
 * Two sessions on one calendar day are ordinary -- a morning squat and an evening
 * bench -- and storage orders by day. Stopping the instant the last exercise is
 * answered would therefore report whichever of that day's sessions the store
 * happened to return first, which is a result that changes between browsers and
 * between a fresh database and a restored one. So once everything is answered the
 * search keeps accepting sessions for as long as their `localDate` is the day the
 * last answer came from, and within that day the greater `updatedAt` wins.
 *
 * The caller's ordering is trusted for that tie and for nothing else. An exercise
 * that already has an answer is never overwritten from another day, so a history
 * handed over out of order yields an answer that is merely older than it could
 * have been rather than one assembled from two different days.
 *
 * Both fields are compared as plain strings. `localDate` is `YYYY-MM-DD` and sorts
 * correctly that way, and `updatedAt` is compared exactly as `byMostRecent` in
 * `summary.ts` compares it -- a tie is two sessions written by the one device, so
 * the two stamps are in the one offset.
 */
export function searchPreviousPerformance(wanted: Iterable<string>): PreviousPerformanceSearch {
  const asked = new Set(wanted);
  const outstanding = new Set(asked);
  const answers = new Map<string, Held>();
  let completedOn: CalendarDay | null = null;

  const consider = (session: WorkoutSession): boolean => {
    // Nothing was asked for, so nothing can answer it and the first session read
    // is already one too many.
    if (asked.size === 0) return false;

    for (const [exerciseId, entry] of previousPerformanceIn(session, asked)) {
      const held = answers.get(exerciseId);
      if (held === undefined) {
        answers.set(exerciseId, { entry, updatedAt: session.updatedAt });
        outstanding.delete(exerciseId);
      } else if (entry.localDate === held.entry.localDate && session.updatedAt > held.updatedAt) {
        answers.set(exerciseId, { entry, updatedAt: session.updatedAt });
      }
    }

    if (outstanding.size > 0) return true;
    completedOn ??= session.localDate;
    return session.localDate === completedOn;
  };

  return {
    consider,
    // A copy, so that a caller reading it part-way through a walk is not left
    // holding a map that keeps changing underneath it.
    found: (): ReadonlyMap<string, PreviousPerformance> =>
      new Map([...answers].map(([exerciseId, held]) => [exerciseId, held.entry])),
  };
}
