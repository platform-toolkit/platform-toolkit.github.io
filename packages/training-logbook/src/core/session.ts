// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Every change a lifter can make to a workout, as a function from one workout to
 * the next.
 *
 * PURE, AND WHAT THAT COSTS
 *
 * Nothing here reads a clock, generates an identifier, or touches storage. A
 * workout is a value; a tap is a function; persistence is somebody else's
 * problem. That is section 12.3, and it is also what makes section 18.2 --
 * "test interruption after every meaningful action" -- something a test can
 * actually do, because the state after an action is a value a test can hold.
 *
 * The cost is {@link SessionContext}, which every mutating function takes. The
 * two things a logbook cannot avoid needing are the current moment and a fresh
 * identifier, and both are injected rather than read. `at` is a value and not a
 * function on purpose: one operation gets one instant, so a workout created with
 * three exercises has one `createdAt` rather than three timestamps a few
 * microseconds apart that a later reader would mistake for a sequence.
 *
 * PLANNED IS NEVER OVERWRITTEN
 *
 * Section 7.2, and the single invariant this file exists to hold. No function
 * here writes to `planned` except the ones that are explicitly editing a plan
 * ({@link planSet}, {@link addSet}, {@link duplicateSet}), and none of those is
 * reachable from completing a set. A lifter who wrote 225 x 5 and got 225 x 4
 * keeps both numbers for ever.
 *
 * ONE COMPLETION FUNCTION, NOT TWO
 *
 * {@link completeSet} covers both journeys the requirements describe, and it
 * covers them with `performed ?? planned` rather than with a branch:
 *
 *   - The planned set nobody edited. `performed` is `null`, so the plan is
 *     copied. That is section 7.5's one-tap completion, exactly.
 *   - The set whose actual result the lifter typed first, which is what logging
 *     as you go looks like. `performed` is already there and is kept.
 *
 * A second "complete as planned" function would have to decide what to do with
 * the second case, and every answer to that is worse than not asking.
 */

import type {
  CalendarDay,
  Effort,
  Instant,
  LogbookId,
  SetKind,
  SetLoad,
  SetPerformance,
  WarmupSnapshot,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutSource,
} from '../types.js';

/**
 * The schema version this package writes.
 *
 * Bumped whenever the persisted shape changes in a way a reader has to know
 * about. Section 19.2: every schema is versioned and compatibility is explicitly
 * experimental until it is declared stable, so this number is going to move.
 */
export const SCHEMA_VERSION = 1;

/**
 * The two things a pure function cannot produce for itself.
 *
 * Supplied by the caller for every operation. See the header for why `at` is a
 * value while `nextId` is a function.
 */
export interface SessionContext {
  /** A fresh opaque identifier. Called once per object created. */
  readonly nextId: () => LogbookId;
  /** The moment this operation happens. */
  readonly at: Instant;
}

/** What a new workout starts life as. */
export interface NewWorkoutOptions {
  /** The lifter's own calendar day. Never derived from `at`; see `types.ts`. */
  readonly localDate: CalendarDay;
  readonly title?: string | null;
  readonly source?: WorkoutSource;
}

/** An empty draft with no exercises in it. */
export function createWorkout(context: SessionContext, options: NewWorkoutOptions): WorkoutSession {
  return {
    id: context.nextId(),
    schemaVersion: SCHEMA_VERSION,
    status: 'draft',
    localDate: options.localDate,
    startedAt: null,
    completedAt: null,
    title: options.title ?? null,
    note: null,
    exercises: [],
    createdAt: context.at,
    updatedAt: context.at,
    source: options.source ?? 'manual',
  };
}

/** An empty performance: the shape a set asks for before anything is known. */
export function emptyPerformance(): SetPerformance {
  return { load: { kind: 'none' }, repetitions: null, effort: null };
}

/** A performance with a load and a rep count. */
export function performance(
  load: SetLoad,
  repetitions: number | null,
  effort: Effort | null = null,
): SetPerformance {
  return { load, repetitions, effort };
}

function touch(session: WorkoutSession, at: Instant): WorkoutSession {
  return { ...session, updatedAt: at };
}

function mapExercises(
  session: WorkoutSession,
  at: Instant,
  map: (exercise: WorkoutExercise) => WorkoutExercise,
): WorkoutSession {
  return touch({ ...session, exercises: session.exercises.map(map) }, at);
}

function mapSet(
  session: WorkoutSession,
  setId: LogbookId,
  at: Instant,
  map: (set: WorkoutSet) => WorkoutSet,
): WorkoutSession {
  return mapExercises(session, at, (exercise) => {
    if (!exercise.sets.some((set) => set.id === setId)) return exercise;
    return { ...exercise, sets: exercise.sets.map((set) => (set.id === setId ? map(set) : set)) };
  });
}

/** One exercise and the set inside it, or `null` where nothing answers to the id. */
export function findSet(
  session: WorkoutSession,
  setId: LogbookId,
): { readonly exercise: WorkoutExercise; readonly set: WorkoutSet } | null {
  for (const exercise of session.exercises) {
    const set = exercise.sets.find((candidate) => candidate.id === setId);
    if (set !== undefined) return { exercise, set };
  }
  return null;
}

/** One exercise by id, or `null`. */
export function findWorkoutExercise(
  session: WorkoutSession,
  exerciseId: LogbookId,
): WorkoutExercise | null {
  return session.exercises.find((exercise) => exercise.id === exerciseId) ?? null;
}

/** What an exercise is being added as. */
export interface NewExerciseOptions {
  /** Catalogue or custom exercise identifier. */
  readonly exerciseId: string;
  /** The name as it reads today. Snapshotted; see `types.ts`. */
  readonly displayName: string;
  readonly loading: WorkoutExercise['loading'];
  /** The sets to plan. Each becomes a `planned` set with no performance. */
  readonly plan?: readonly PlannedSet[];
}

/** One set to write into a plan. */
export interface PlannedSet {
  readonly kind: SetKind;
  readonly performance: SetPerformance;
}

function buildSet(context: SessionContext, planned: PlannedSet): WorkoutSet {
  return {
    id: context.nextId(),
    kind: planned.kind,
    planned: planned.performance,
    performed: null,
    status: 'planned',
    completedAt: null,
    note: null,
  };
}

/** Adds an exercise to the end of the workout. */
export function addExercise(
  session: WorkoutSession,
  context: SessionContext,
  options: NewExerciseOptions,
): WorkoutSession {
  const exercise: WorkoutExercise = {
    id: context.nextId(),
    exerciseId: options.exerciseId,
    displayName: options.displayName,
    loading: options.loading,
    warmup: null,
    note: null,
    sets: (options.plan ?? []).map((planned) => buildSet(context, planned)),
  };
  return touch({ ...session, exercises: [...session.exercises, exercise] }, context.at);
}

/** Takes an exercise out of the workout, with every set in it. */
export function removeExercise(
  session: WorkoutSession,
  exerciseId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  const exercises = session.exercises.filter((exercise) => exercise.id !== exerciseId);
  return touch({ ...session, exercises }, context.at);
}

/**
 * Moves an exercise one place up or down.
 *
 * One place at a time rather than an index, because that is the affordance a
 * phone can offer without a drag handle -- and a drag handle beside a completion
 * control is section 14.3's warning about sweaty taps landing on the wrong thing.
 * Moving past either end is a no-op rather than a wrap: a list that jumped from
 * the top to the bottom would look like a deletion.
 */
export function moveExercise(
  session: WorkoutSession,
  exerciseId: LogbookId,
  direction: 'up' | 'down',
  context: SessionContext,
): WorkoutSession {
  const from = session.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (from === -1) return session;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= session.exercises.length) return session;

  const exercises = [...session.exercises];
  const moving = exercises[from];
  const displaced = exercises[to];
  // `noUncheckedIndexedAccess` makes both reads `| undefined`. Both indexes were
  // just bounds-checked, so this cannot happen -- but the check is cheaper than
  // the cast section 2.4 forbids.
  if (moving === undefined || displaced === undefined) return session;
  exercises[to] = moving;
  exercises[from] = displaced;
  return touch({ ...session, exercises }, context.at);
}

/** Attaches a generated warm-up to an exercise, replacing any previous one. */
export function attachWarmup(
  session: WorkoutSession,
  exerciseId: LogbookId,
  warmup: WarmupSnapshot,
  context: SessionContext,
): WorkoutSession {
  return mapExercises(session, context.at, (exercise) =>
    exercise.id === exerciseId ? { ...exercise, warmup } : exercise,
  );
}

/** Adds a set to the end of an exercise. */
export function addSet(
  session: WorkoutSession,
  exerciseId: LogbookId,
  planned: PlannedSet,
  context: SessionContext,
): WorkoutSession {
  return mapExercises(session, context.at, (exercise) =>
    exercise.id === exerciseId
      ? { ...exercise, sets: [...exercise.sets, buildSet(context, planned)] }
      : exercise,
  );
}

/**
 * Copies a set and puts the copy straight after it.
 *
 * The *plan* is copied and the result is not. Section 4.4 says it of repeating a
 * whole workout and the same rule holds one row down: a duplicated set is
 * something the lifter is about to do, and starting it already ticked would put
 * a lift in their history that nobody performed.
 */
export function duplicateSet(
  session: WorkoutSession,
  setId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  return mapExercises(session, context.at, (exercise) => {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index === -1) return exercise;
    const original = exercise.sets[index];
    if (original === undefined) return exercise;

    const copy: WorkoutSet = {
      id: context.nextId(),
      kind: original.kind,
      planned: original.planned ?? original.performed,
      performed: null,
      status: 'planned',
      completedAt: null,
      note: null,
    };
    const sets = [...exercise.sets];
    sets.splice(index + 1, 0, copy);
    return { ...exercise, sets };
  });
}

/** Takes a set out of its exercise. */
export function removeSet(
  session: WorkoutSession,
  setId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  return mapExercises(session, context.at, (exercise) => {
    if (!exercise.sets.some((set) => set.id === setId)) return exercise;
    return { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) };
  });
}

/** Rewrites what a set is *meant* to be. Never touches what was performed. */
export function planSet(
  session: WorkoutSession,
  setId: LogbookId,
  planned: SetPerformance,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({ ...set, planned }));
}

/**
 * Marks a set done. Section 7.5.
 *
 * `performed ?? planned` is the whole of the one-tap behaviour; see the header
 * for why there is no second function for the edited case. Note that this does
 * not overwrite a performance the lifter already typed -- tapping the check
 * after entering 225 x 4 records 225 x 4, not the 225 x 5 that was planned.
 */
export function completeSet(
  session: WorkoutSession,
  setId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({
    ...set,
    performed: set.performed ?? set.planned,
    status: 'complete',
    completedAt: context.at,
  }));
}

/**
 * Writes what actually happened, and completes the set if it was still planned.
 *
 * Editing a set that was already complete leaves it complete and leaves its
 * `completedAt` alone: the lifter is correcting the record of something they did
 * at ten past six, not doing it again now.
 */
export function recordSet(
  session: WorkoutSession,
  setId: LogbookId,
  performed: SetPerformance,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => {
    if (set.status === 'planned') {
      return { ...set, performed, status: 'complete', completedAt: context.at };
    }
    return { ...set, performed };
  });
}

/**
 * Records a set that was attempted and not finished. Section 7.4.
 *
 * The reps are kept, because "I got three of five" is the fact worth having and
 * a failure recorded as an absence loses it. Nothing here draws a conclusion from
 * it -- section 15.3 and LOG-026: this tool does not translate a missed set into
 * advice.
 */
export function markSetIncomplete(
  session: WorkoutSession,
  setId: LogbookId,
  performed: SetPerformance | null,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({
    ...set,
    performed: performed ?? set.performed,
    status: 'incomplete',
    completedAt: context.at,
  }));
}

/**
 * Marks a set deliberately not done.
 *
 * `performed` is cleared, because a skipped set was not performed and leaving a
 * copied plan in the result would put weight a lifter never touched into their
 * history. Section 15.3: skipping is not a failure, and nothing in this package
 * scores it.
 */
export function skipSet(
  session: WorkoutSession,
  setId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({
    ...set,
    performed: null,
    status: 'skipped',
    completedAt: null,
  }));
}

/**
 * Puts a set back to planned. Section 14.3's obvious undo.
 *
 * The performance goes with it. Undo means "I tapped that by mistake", and a set
 * left holding a copied plan after being un-completed would show as untouched
 * while carrying a result.
 */
export function undoSet(
  session: WorkoutSession,
  setId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({
    ...set,
    performed: null,
    status: 'planned',
    completedAt: null,
  }));
}

/** Sets or clears the one workout-level note. Section 7.9. */
export function setWorkoutNote(
  session: WorkoutSession,
  note: string | null,
  context: SessionContext,
): WorkoutSession {
  return touch({ ...session, note }, context.at);
}

/** Sets or clears an exercise's note. */
export function setExerciseNote(
  session: WorkoutSession,
  exerciseId: LogbookId,
  note: string | null,
  context: SessionContext,
): WorkoutSession {
  return mapExercises(session, context.at, (exercise) =>
    exercise.id === exerciseId ? { ...exercise, note } : exercise,
  );
}

/** Sets or clears a set's note. */
export function setSetNote(
  session: WorkoutSession,
  setId: LogbookId,
  note: string | null,
  context: SessionContext,
): WorkoutSession {
  return mapSet(session, setId, context.at, (set) => ({ ...set, note }));
}

/** Retitles the workout. */
export function setWorkoutTitle(
  session: WorkoutSession,
  title: string | null,
  context: SessionContext,
): WorkoutSession {
  return touch({ ...session, title }, context.at);
}

/**
 * Moves a draft to active and stamps when it began.
 *
 * A workout that is already active is returned unchanged rather than
 * re-stamped. The elapsed time on the active screen is read from `startedAt`,
 * and a second call -- a double tap, a resumed page that re-ran its start-up --
 * would silently reset a lifter's session clock to zero.
 */
export function startWorkout(session: WorkoutSession, context: SessionContext): WorkoutSession {
  if (session.status !== 'draft') return session;
  return touch({ ...session, status: 'active', startedAt: context.at }, context.at);
}

/** Every set still waiting to be done: the list section 7.12 shows before finishing. */
export function outstandingSets(session: WorkoutSession): readonly WorkoutSet[] {
  return session.exercises.flatMap((exercise) =>
    exercise.sets.filter((set) => set.status === 'planned'),
  );
}

/** What to do with the sets that were never ticked. Section 7.12 step 2. */
export type FinishDisposition =
  /** Leave them planned. The history then says they were written down and not done. */
  | 'leave'
  /** Mark them skipped, which is the honest reading of "I finished without them". */
  | 'skip';

/**
 * Ends the workout and freezes it.
 *
 * The disposition is required rather than defaulted, because the two answers say
 * different things about a lifter's session and neither is safe to assume. It is
 * the caller's job to have asked -- section 7.12 makes the question a step in the
 * finish flow, not a preference.
 */
export function finishWorkout(
  session: WorkoutSession,
  disposition: FinishDisposition,
  context: SessionContext,
): WorkoutSession {
  const finished =
    disposition === 'skip'
      ? mapExercises(session, context.at, (exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) =>
            set.status === 'planned'
              ? { ...set, performed: null, status: 'skipped' as const, completedAt: null }
              : set,
          ),
        }))
      : session;

  return touch({ ...finished, status: 'completed', completedAt: context.at }, context.at);
}

/**
 * Throws the workout away without deleting it.
 *
 * `discarded` rather than a deletion, so the repository can clear the
 * active-workout pointer and still hold the record long enough for the write to
 * be verified. What happens to a discarded workout after that is the
 * repository's decision and not this file's.
 */
export function discardWorkout(session: WorkoutSession, context: SessionContext): WorkoutSession {
  return touch({ ...session, status: 'discarded' }, context.at);
}

/**
 * A new draft with the same plan and none of the results. Section 4.4, LOG-003.
 *
 * Everything that says *what happened* is dropped: performed values, statuses,
 * completion times, the workout note and the set notes. What survives is the
 * plan -- the exercises, their order, their sets, and the weights and reps that
 * were written down. Exercise notes survive too, because "belt on from the third
 * set" is a note about how the exercise is done rather than about that Tuesday.
 *
 * The warm-up snapshot does not survive, and that is the subtle one. A snapshot
 * records the plates in a particular gym on a particular day against a particular
 * version of the engine (section 8.4). Carrying it into a new session would
 * present last month's plate maths as this morning's, and the fix is cheap:
 * generate again from the working prescription that did survive.
 */
export function repeatWorkout(
  session: WorkoutSession,
  context: SessionContext,
  options: NewWorkoutOptions,
): WorkoutSession {
  const base = createWorkout(context, { ...options, source: options.source ?? 'repeated-workout' });
  const exercises: readonly WorkoutExercise[] = session.exercises.map((exercise) => ({
    id: context.nextId(),
    exerciseId: exercise.exerciseId,
    displayName: exercise.displayName,
    loading: exercise.loading,
    warmup: null,
    note: exercise.note,
    sets: exercise.sets.map((set) => ({
      id: context.nextId(),
      kind: set.kind,
      // The plan, or -- for a set logged freeform last time, which had no plan --
      // what was performed. Copying the result forward as a *plan* is the honest
      // reading: it is what the lifter is proposing to do again.
      planned: set.planned ?? set.performed,
      performed: null,
      status: 'planned' as const,
      completedAt: null,
      note: null,
    })),
  }));
  return { ...base, exercises, title: options.title ?? session.title };
}
