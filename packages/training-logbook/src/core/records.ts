// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One exercise, read back across every session it appears in. Sections 5.5 and 9.2.
 *
 * The pure half, built the same way `./previous.ts` is: nothing here opens a store,
 * a caller walks its own history and hands each session over one at a time, and the
 * answer is a function of values. What is different is that this walk cannot stop
 * early -- "the most you have ever lifted" is a claim about the whole history, and a
 * search that stopped at ten sessions would be quietly answering a different question
 * under the same word.
 *
 * WHAT IS BOUNDED IS THE DETAIL, NOT THE WALK
 *
 * Section 9.3's objection to `readWorkouts` is that it pulls whole records into one
 * array before the caller has said how many it wants. This keeps a handful of numbers
 * per session and full detail for only the newest {@link DEFAULT_SESSION_LIMIT} of
 * them, so the memory a three-year history costs is the same as a three-week one. The
 * time is not, and that is the price of an honest marker; it is paid once, on a screen
 * a lifter deliberately opened, rather than on every render of the logging screen the
 * way `lastPerformance` would be.
 *
 * WHAT A MARKER IS, AND WHAT IT IS NOT
 *
 * Section 9.2 lists three and this file computes exactly those three: the heaviest
 * completed set, the most repetitions at a given weight, and the most weight for a
 * given number of repetitions. **There is no estimated one-rep max here and there must
 * never be one.** An e1RM is a model of a lift that did not happen, and section 15.3
 * puts a number nobody performed out of this package's reach -- `packages/domain` has
 * `one-rep-max.ts` and this package deliberately imports none of it.
 *
 * A marker is a statement of fact about a set that is on the screen, in the same
 * register as the weight beside it. It is not a congratulation, it does not compare
 * this session against the last one, and nothing anywhere counts how many of them a
 * lifter has.
 *
 * THE FIVE EXCLUSIONS
 *
 * Section 9.2 names them and {@link countsTowardsMarkers} is the whole of it: a set
 * with no repetitions recorded or zero of them, a set that was skipped, a warm-up, a
 * set whose numbers cannot be read as numbers, and a comparison that would cross
 * {@link SetLoad}'s kind. The last is the one that matters most and is structural
 * rather than a filter -- every group below is keyed on the kind, so 20 kg hung off a
 * body and 20 kg taken off one can never land in the same maximum.
 *
 * The exclusions apply to the markers and **not** to the list. A skipped set and a set
 * that made three of five are both things that happened, and a history that hid them
 * would be editing the record to make the marks look better.
 *
 * A MAXIMUM OVER ONE SET IS NOT A MAXIMUM
 *
 * Two of the three markers are maxima within a group -- the sets at one weight, and the
 * sets of one repetition count -- and a group holding a single set has a largest element
 * for the same reason any one-element set does, which is not a fact about a history. A
 * lifter who rarely repeats a weight would otherwise open this screen and find every row
 * marked, which is the failure the tie rule below exists to prevent, arriving by a
 * different door. So those two are withheld until a group has seen a second set.
 *
 * `heaviest` is deliberately exempt: it is one mark per load kind across the whole
 * history rather than one per group, it cannot multiply, and the heaviest thing a lifter
 * has ever picked up is a claim worth making on the day they first pick it up.
 */

import { weightIn } from '@platform-toolkit/domain';

import type {
  CalendarDay,
  LogbookId,
  SetKind,
  SetLoad,
  SetLoadKind,
  SetPerformance,
  SetStatus,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { isWorkingSet } from './summary.js';

/** How many sessions are kept in full where the caller does not say. */
export const DEFAULT_SESSION_LIMIT = 20;

/**
 * The three things section 9.2 allows a set to be marked as.
 *
 * `most-load-for-reps` is deliberately not called a rep record on the screen or here:
 * the phrase invites the extrapolation the header rules out, and what this actually
 * says is narrower and true -- of every set of exactly this many repetitions, this is
 * the one with the most weight on it.
 *
 * The two group markers appear only where there is a group to be the maximum of; see
 * the header.
 */
export type ExerciseMarker = 'heaviest' | 'most-reps-at-load' | 'most-load-for-reps';

/** One performed set of the exercise, as it happened. */
export interface ExerciseSetEntry {
  readonly id: LogbookId;
  readonly kind: SetKind;
  readonly status: SetStatus;
  /** What was done. A set with nothing performed is not listed at all. */
  readonly performed: SetPerformance;
  readonly note: string | null;
  /** Empty for all but a few sets in a history. */
  readonly markers: readonly ExerciseMarker[];
}

/** One session's worth of the exercise. */
export interface ExerciseSessionEntry {
  readonly workoutId: LogbookId;
  readonly localDate: CalendarDay;
  readonly title: string | null;
  /**
   * The name as it read on that day.
   *
   * Per session rather than once for the history, because `displayName` is
   * snapshotted onto a workout when it is planned and a renamed custom exercise
   * therefore reads differently in old sessions -- which is the point of
   * snapshotting it, and a screen that showed today's name over last year's session
   * would be undoing that.
   */
  readonly displayName: string;
  /** The note on the exercise that day, not on the workout. */
  readonly note: string | null;
  /** Performed sets, in the order they were done. Never empty. */
  readonly sets: readonly ExerciseSetEntry[];
}

/** A marker's subject, for a screen that wants to state it even when the set is off the list. */
export interface ExerciseBest {
  readonly localDate: CalendarDay;
  readonly performance: SetPerformance;
}

/** Everything one exercise's history has to say. Section 5.5. */
export interface ExerciseHistory {
  readonly exerciseId: string;
  /** The most recent name it was recorded under, or `null` where it has never been done. */
  readonly displayName: string | null;
  /** Newest first, at most the limit. */
  readonly sessions: readonly ExerciseSessionEntry[];
  /** Whether sessions were left out of {@link sessions} by the limit. */
  readonly truncated: boolean;
  /**
   * The heaviest completed set, one entry per load kind that has one.
   *
   * A list rather than a single answer because the kinds are not comparable: a
   * weighted chin-up and an assisted one are the same movement and opposite facts, so
   * there is no single heaviest between them and inventing one would be the error
   * section 6.2's four load shapes exist to prevent. Nearly every history has zero
   * entries or one.
   */
  readonly heaviest: readonly ExerciseBest[];
}

/** A walk through a history that answers about one exercise. */
export interface ExerciseHistorySearch {
  /** Feed the next session, newest day first. */
  readonly consider: (session: WorkoutSession) => void;
  /** What the walk has found. Safe to call part-way through. */
  readonly history: () => ExerciseHistory;
}

/** How much of the history to keep in full. */
export interface ExerciseHistoryOptions {
  /** Sessions kept with their sets. Markers are folded over every session regardless. */
  readonly limit?: number;
}

/**
 * Whether a set may contribute to a marker. Section 9.2's five exclusions.
 *
 * `status === 'complete'` is what excludes a skipped set, and it excludes an
 * incomplete one too. That is the brief's own word -- "heaviest *completed* set" --
 * and it is the same test `previousPerformanceIn` applies for the same reason: a set
 * the lifter has said they did not finish is not a claim about what they can do. The
 * row stays on the screen with its numbers; only the mark is withheld.
 *
 * A repetition count of zero is excluded separately from one that was never entered.
 * They are different facts (see `SetPerformance.repetitions`) and neither is a set
 * anything can be read off, but a max over a group containing a `null` would be a
 * comparison against nothing.
 */
function countsTowardsMarkers(set: WorkoutSet): Countable | null {
  if (set.status !== 'complete') return null;
  if (!isWorkingSet(set)) return null;
  const performed = set.performed;
  if (performed === null) return null;
  const reps = performed.repetitions;
  if (reps === null || !Number.isFinite(reps) || reps <= 0) return null;
  const key = loadKey(performed.load);
  if (key === null) return null;
  return { performed, reps, key };
}

/** A set that survived every exclusion, with the three things a fold needs off it. */
interface Countable {
  readonly performed: SetPerformance;
  readonly reps: number;
  readonly key: string;
}

/**
 * A load's exact identity, or `null` where it cannot be read.
 *
 * **Exact, and never converted.** Two sets are at "the same weight" only if the same
 * number was typed in the same unit: 100 kg and 220.46 lb are one mass and two
 * entries, and grouping them together would make "most reps at this weight" depend on
 * a rounding decision. `sameLoad` in `./summary.ts` draws the line in the same place.
 *
 * The kind is in the key, which is what stops an assisted 20 kg and an added 20 kg
 * from sharing a group.
 */
function loadKey(load: SetLoad): string | null {
  if (load.kind === 'none') return 'none';
  const { amount, unit } = load.weight;
  if (!Number.isFinite(amount)) return null;
  return `${load.kind}|${String(amount)}|${unit}`;
}

/**
 * How heavy a load is, for ordering only, or `null` where there is nothing to order.
 *
 * Converted, unlike {@link loadKey}, and the difference is deliberate. Ordering is a
 * question with an answer across units -- 102.5 kg is more than 225 lb -- while
 * equality across them is an artefact of where the conversion was rounded. Nothing
 * converted here is ever displayed: the marker points at a set and the set prints the
 * numbers it was recorded with.
 */
function heaviness(load: SetLoad): number | null {
  return load.kind === 'none' ? null : weightIn(load.weight, 'kg');
}

/** The set currently holding a maximum. */
interface Holder {
  readonly setId: LogbookId;
  readonly value: number;
  readonly best: ExerciseBest;
  /** Sets that have landed in this group, holder included. See {@link MIN_GROUP}. */
  readonly seen: number;
}

/** How many sets a group needs before its largest element means anything. */
const MIN_GROUP = 2;

/**
 * Collects one exercise's history from a newest-first walk.
 *
 * WHY A TIE GOES TO THE OLDER SET
 *
 * Straight sets are the ordinary case -- three at 100 kg for 5 -- and all three of
 * them are jointly the heaviest, jointly the most repetitions at that weight and
 * jointly the most weight for that many. Marking all three marks every row in the
 * history and the marker stops meaning anything; marking the newest says a lifter set
 * a record this morning by repeating what they did in March. So the mark goes to the
 * first set that reached the number, which is what a record is, and the useful
 * consequence is that a genuinely new one appears on today's row and nowhere else.
 *
 * That is what the reversal in {@link fold} is for: sessions arrive newest first, so
 * walking each session's sets backwards makes the whole traversal strictly
 * reverse-chronological, and "keep the last one seen at this value" is then "keep the
 * oldest". Written as `>=` rather than `>` for exactly that reason -- the greater-than
 * a reviewer expects would keep the newest and quietly invert the rule.
 *
 * WHY A DAY IS BUFFERED
 *
 * `LogbookStore.scanWorkouts` orders by `localDate` and says nothing about two
 * sessions on one day, so a tie between a morning session and an evening one would
 * otherwise be settled by whichever the database returned first -- an answer that
 * differs between browsers and between a fresh database and a restored one. Each day
 * is therefore collected and sorted on `updatedAt` before it is folded, which is the
 * same tie `byMostRecent` breaks and the same one `searchPreviousPerformance` takes a
 * whole day to break. The buffer holds one day.
 */
export function searchExerciseHistory(
  exerciseId: string,
  options: ExerciseHistoryOptions = {},
): ExerciseHistorySearch {
  const limit = Math.max(0, options.limit ?? DEFAULT_SESSION_LIMIT);

  /** A session entry with its markers not yet stitched in; see {@link history}. */
  const kept: {
    readonly entry: Omit<ExerciseSessionEntry, 'sets'>;
    readonly sets: readonly Omit<ExerciseSetEntry, 'markers'>[];
  }[] = [];
  let truncated = false;
  let displayName: string | null = null;

  const heaviest = new Map<SetLoadKind, Holder>();
  const repsAtLoad = new Map<string, Holder>();
  const loadForReps = new Map<string, Holder>();

  let buffered: WorkoutSession[] = [];
  let bufferedDay: CalendarDay | null = null;

  /**
   * Offers a set to a group.
   *
   * `>=` and not `>`, which is the whole of the tie rule; see the header. The count is
   * kept on whichever holder survives, so a loser still enlarges the group it lost in.
   */
  const claim = <Key>(holders: Map<Key, Holder>, key: Key, candidate: Holder): void => {
    const held = holders.get(key);
    if (held === undefined) {
      holders.set(key, candidate);
      return;
    }
    const seen = held.seen + 1;
    holders.set(key, candidate.value >= held.value ? { ...candidate, seen } : { ...held, seen });
  };

  const fold = (localDate: CalendarDay, sets: readonly WorkoutSet[]): void => {
    // Backwards, so the whole walk is reverse-chronological. See the header.
    for (let index = sets.length - 1; index >= 0; index -= 1) {
      const set = sets[index];
      if (set === undefined) continue;
      const countable = countsTowardsMarkers(set);
      if (countable === null) continue;

      const { performed, reps, key } = countable;
      const best: ExerciseBest = { localDate, performance: performed };
      const weight = heaviness(performed.load);
      if (weight !== null) {
        const kind = performed.load.kind;
        const heaviestSoFar: Holder = { setId: set.id, value: weight, best, seen: 1 };
        claim(heaviest, kind, heaviestSoFar);
        claim(loadForReps, `${kind}|${String(reps)}`, heaviestSoFar);
      }
      claim(repsAtLoad, key, { setId: set.id, value: reps, best, seen: 1 });
    }
  };

  const take = (session: WorkoutSession): void => {
    // Only a finished session. A draft holds a plan, an active one is the workout on
    // the screen, and a discarded one is a session the lifter threw away -- the same
    // three reasons `previousPerformanceIn` gives.
    if (session.status !== 'completed') return;

    const blocks = session.exercises.filter((exercise) => exercise.exerciseId === exerciseId);
    if (blocks.length === 0) return;

    // One exercise listed twice in a session -- squats at the front and back-offs at
    // the end -- is one exercise's work in two blocks, in the order they were done.
    const sets = blocks.flatMap((block) => block.sets);
    displayName ??= blocks[0]?.displayName ?? null;
    fold(session.localDate, sets);

    // A set with nothing performed has nothing to show. `flatMap` rather than a
    // filter and a cast: the narrowing is what proves `performed` is there, and a
    // fallback performance invented here would be a row of numbers nobody lifted.
    const shown = sets.flatMap((set) =>
      set.performed === null
        ? []
        : [
            {
              id: set.id,
              kind: set.kind,
              status: set.status,
              performed: set.performed,
              note: set.note,
            },
          ],
    );
    if (shown.length === 0) return;
    if (kept.length >= limit) {
      truncated = true;
      return;
    }

    kept.push({
      entry: {
        workoutId: session.id,
        localDate: session.localDate,
        title: session.title,
        displayName: blocks[0]?.displayName ?? exerciseId,
        // The note on this exercise that day. Where the lift appears twice, the
        // blocks' notes are joined rather than one of them dropped: both were
        // written about this movement in this session.
        note: joinNotes(blocks.map((block) => block.note)),
      },
      sets: shown,
    });
  };

  const flush = (): void => {
    const day = [...buffered].sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return 0;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
    for (const session of day) take(session);
    buffered = [];
    bufferedDay = null;
  };

  const consider = (session: WorkoutSession): void => {
    if (bufferedDay !== null && session.localDate !== bufferedDay) flush();
    bufferedDay = session.localDate;
    buffered.push(session);
  };

  const history = (): ExerciseHistory => {
    if (buffered.length > 0) flush();

    const marks = new Map<LogbookId, ExerciseMarker[]>();
    const mark = (setId: LogbookId, marker: ExerciseMarker): void => {
      const existing = marks.get(setId);
      if (existing === undefined) marks.set(setId, [marker]);
      else existing.push(marker);
    };

    const heaviestIds = new Set([...heaviest.values()].map((holder) => holder.setId));
    for (const setId of heaviestIds) mark(setId, 'heaviest');
    for (const holder of repsAtLoad.values()) {
      if (holder.seen < MIN_GROUP) continue;
      mark(holder.setId, 'most-reps-at-load');
    }
    for (const holder of loadForReps.values()) {
      if (holder.seen < MIN_GROUP) continue;
      // The heaviest set is trivially the heaviest at its own repetition count, and
      // saying both is saying one thing twice on a row that already carries three
      // numbers.
      if (heaviestIds.has(holder.setId)) continue;
      mark(holder.setId, 'most-load-for-reps');
    }

    return {
      exerciseId,
      displayName,
      truncated,
      heaviest: [...heaviest.values()].map((holder) => holder.best),
      sessions: kept.map(({ entry, sets }) => ({
        ...entry,
        sets: sets.map((set) => ({ ...set, markers: marks.get(set.id) ?? [] })),
      })),
    };
  };

  return { consider, history };
}

/** Two notes about the same lift in one session, or the one there is, or none. */
function joinNotes(notes: readonly (string | null)[]): string | null {
  const written = notes.filter((note): note is string => note !== null);
  return written.length === 0 ? null : written.join('\n');
}
