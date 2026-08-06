// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The derived reads, and in particular the one that justifies a four-member
 * status union: whether a set was completed as planned is a comparison, not a
 * stored flag.
 */

import { describe, expect, it } from 'vitest';

import type { SetLoad, WorkoutSession } from '../types.js';

import { AT_LATER, AT_START, ON_DAY, contextSeries, testContext } from './context.fixture.js';
import {
  addExercise,
  addSet,
  completeSet,
  createWorkout,
  finishWorkout,
  markSetIncomplete,
  performance,
  recordSet,
  setExerciseNote,
  setSetNote,
  setWorkoutNote,
  skipSet,
  startWorkout,
} from './session.js';
import {
  byMostRecent,
  isWorkingSet,
  loadWeight,
  setWasEdited,
  summarize,
  workoutDurationMillis,
  workoutProgress,
} from './summary.js';

function kilograms(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

/** A draft with three planned working sets on one exercise. */
function threeSetWorkout(): WorkoutSession {
  const context = testContext();
  const draft = createWorkout(context, { localDate: ON_DAY, title: 'Squat day' });
  return addExercise(draft, context, {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: Array.from({ length: 3 }, () => ({
      kind: 'working' as const,
      performance: performance(kilograms(100), 5),
    })),
  });
}

function setIds(session: WorkoutSession): readonly string[] {
  return session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id));
}

function setAt(
  session: WorkoutSession,
  index: number,
): WorkoutSession['exercises'][number]['sets'][number] {
  const set = session.exercises.flatMap((exercise) => exercise.sets)[index];
  if (set === undefined) throw new Error(`no set at ${String(index)}`);
  return set;
}

describe('loadWeight', () => {
  it('answers null only for the kind that carries no weight', () => {
    expect(loadWeight({ kind: 'none' })).toBeNull();
    expect(loadWeight(kilograms(100))).toEqual({ amount: 100, unit: 'kg' });
    expect(loadWeight({ kind: 'added', weight: { amount: 20, unit: 'kg' } })).toEqual({
      amount: 20,
      unit: 'kg',
    });
    expect(loadWeight({ kind: 'assisted', weight: { amount: 20, unit: 'kg' } })).toEqual({
      amount: 20,
      unit: 'kg',
    });
  });
});

describe('setWasEdited', () => {
  it('is false for a set completed exactly as planned', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const completed = completeSet(session, id ?? '', testContext(AT_LATER));

    expect(setWasEdited(setAt(completed, 0))).toBe(false);
  });

  it('is true when the reps differ', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const short = recordSet(session, id ?? '', performance(kilograms(100), 4), testContext());

    expect(setWasEdited(setAt(short, 0))).toBe(true);
  });

  it('is true when the weight differs', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const heavier = recordSet(session, id ?? '', performance(kilograms(102.5), 5), testContext());

    expect(setWasEdited(setAt(heavier, 0))).toBe(true);
  });

  it('is true when the unit differs, even where the mass does not', () => {
    // 100 kg and 220.46 lb are the same mass and are not the same entry. Section
    // 11.4: a number a lifter typed is never silently reinterpreted.
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const retyped = recordSet(
      session,
      id ?? '',
      performance({ kind: 'implement', weight: { amount: 100, unit: 'lb' } }, 5),
      testContext(),
    );

    expect(setWasEdited(setAt(retyped, 0))).toBe(true);
  });

  it('is true when the load kind differs at the same number', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const assisted = recordSet(
      session,
      id ?? '',
      performance({ kind: 'assisted', weight: { amount: 100, unit: 'kg' } }, 5),
      testContext(),
    );

    expect(setWasEdited(setAt(assisted, 0))).toBe(true);
  });

  it('is false when only the effort differs', () => {
    // Section 7.10: nothing plans an effort -- the ramp writes null into every
    // rung and the builder has no field for one. A recorded effort therefore
    // always differs from a planned nothing, so counting it here would put
    // "Different from the plan" under every set a lifter rated.
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const rated = recordSet(
      session,
      id ?? '',
      performance(kilograms(100), 5, { scale: 'rpe', value: 8 }),
      testContext(),
    );

    expect(setWasEdited(setAt(rated, 0))).toBe(false);
  });

  it('is false even where the two efforts are on opposite scales', () => {
    // RPE 8 is close to failure and RIR 8 is eight reps clear of it, so this is
    // the widest an effort field can differ -- and it is still not an edit,
    // because a plan carrying an effort at all is a state nothing here writes.
    // Where the scales do have to be told apart is `formatEffort`, which labels
    // a stored effort from the effort itself and never from today's setting.
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const planned = recordSet(
      session,
      id ?? '',
      performance(kilograms(100), 5, { scale: 'rpe', value: 8 }),
      testContext(),
    );
    const rewritten: WorkoutSession = {
      ...planned,
      exercises: planned.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) =>
          set.id === id
            ? { ...set, planned: performance(kilograms(100), 5, { scale: 'rir', value: 8 }) }
            : set,
        ),
      })),
    };

    expect(setWasEdited(setAt(rewritten, 0))).toBe(false);
  });

  it('is false where one half of the comparison is missing', () => {
    const session = threeSetWorkout();

    expect(setWasEdited(setAt(session, 0))).toBe(false);
  });
});

describe('isWorkingSet', () => {
  it('counts working, backoff and AMRAP and not warm-ups or accessories', () => {
    const session = threeSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const context = testContext();
    let extended = session;
    for (const kind of ['warmup', 'backoff', 'amrap', 'accessory'] as const) {
      extended = addSet(
        extended,
        exerciseId,
        { kind, performance: performance(kilograms(60), 5) },
        context,
      );
    }
    const kinds = extended.exercises.flatMap((exercise) =>
      exercise.sets.filter(isWorkingSet).map((set) => set.kind),
    );

    expect(new Set(kinds)).toEqual(new Set(['working', 'backoff', 'amrap']));
  });
});

describe('workoutProgress', () => {
  it('counts every set by what became of it', () => {
    const at = contextSeries();
    const session = threeSetWorkout();
    const [first, second] = setIds(session);
    const done = completeSet(session, first ?? '', at(AT_LATER));
    const mixed = skipSet(done, second ?? '', at(AT_LATER));

    expect(workoutProgress(mixed)).toEqual({
      completed: 1,
      incomplete: 0,
      skipped: 1,
      remaining: 1,
      total: 3,
    });
  });

  it('counts an incomplete set on its own line', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const short = markSetIncomplete(session, id ?? '', null, testContext(AT_LATER));

    expect(workoutProgress(short)).toMatchObject({ incomplete: 1, remaining: 2, total: 3 });
  });

  it('is all zeroes for a workout with nothing in it', () => {
    expect(workoutProgress(createWorkout(testContext(), { localDate: ON_DAY }))).toEqual({
      completed: 0,
      incomplete: 0,
      skipped: 0,
      remaining: 0,
      total: 0,
    });
  });
});

describe('workoutDurationMillis', () => {
  it('measures from the start to the finish', () => {
    const at = contextSeries();
    const started = startWorkout(threeSetWorkout(), at(AT_START));
    const finished = finishWorkout(started, 'leave', at(AT_LATER));

    expect(workoutDurationMillis(finished)).toBe(20 * 60 * 1000);
  });

  it('is null before it has started or finished', () => {
    const session = threeSetWorkout();

    expect(workoutDurationMillis(session)).toBeNull();
    expect(workoutDurationMillis(startWorkout(session, testContext()))).toBeNull();
  });

  it('is null for a stamp this runtime cannot read', () => {
    // A restored backup written by another tool is where one arrives.
    const session: WorkoutSession = {
      ...threeSetWorkout(),
      startedAt: 'the morning',
      completedAt: AT_LATER,
    };

    expect(workoutDurationMillis(session)).toBeNull();
  });

  it('is null rather than negative when the clock moved backwards', () => {
    const session: WorkoutSession = {
      ...threeSetWorkout(),
      startedAt: AT_LATER,
      completedAt: AT_START,
    };

    expect(workoutDurationMillis(session)).toBeNull();
  });

  it('is zero for a session that started and finished on the same instant', () => {
    const session: WorkoutSession = {
      ...threeSetWorkout(),
      startedAt: AT_START,
      completedAt: AT_START,
    };

    expect(workoutDurationMillis(session)).toBe(0);
  });
});

describe('summarize', () => {
  it('names the exercises that carried working sets', () => {
    const context = testContext();
    let session = threeSetWorkout();
    session = addExercise(session, context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'warmup', performance: performance({ kind: 'none' }, 5) }],
    });

    expect(summarize(session).exerciseNames).toEqual(['Squat']);
  });

  it('falls back to every exercise where none carried working sets', () => {
    const context = testContext();
    const session = addExercise(createWorkout(context, { localDate: ON_DAY }), context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'accessory', performance: performance({ kind: 'none' }, 8) }],
    });

    expect(summarize(session).exerciseNames).toEqual(['Chin-Up']);
  });

  it('counts completed working sets and not completed warm-ups', () => {
    const at = contextSeries();
    let session = threeSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    session = addSet(
      session,
      exerciseId,
      { kind: 'warmup', performance: performance(kilograms(60), 5) },
      at(AT_START),
    );
    for (const id of setIds(session)) {
      session = completeSet(session, id, at(AT_LATER));
    }

    expect(summarize(session).completedWorkingSets).toBe(3);
    expect(summarize(session).progress.completed).toBe(4);
  });

  it('reports a note anywhere in the workout', () => {
    const session = threeSetWorkout();
    const [id] = setIds(session);
    const exerciseId = session.exercises[0]?.id ?? '';

    expect(summarize(session).hasNotes).toBe(false);
    expect(summarize(setWorkoutNote(session, 'Rough', testContext())).hasNotes).toBe(true);
    expect(summarize(setSetNote(session, id ?? '', 'Belt', testContext())).hasNotes).toBe(true);
    // The exercise half of `hasNote` had no case of its own, and a workout note
    // or a set note answers true whatever that half does.
    expect(summarize(setExerciseNote(session, exerciseId, 'Belt on', testContext())).hasNotes).toBe(
      true,
    );
  });

  it('stops reporting notes once they are cleared', () => {
    // The mark comes off again. A note typed and then deleted leaves an empty
    // box, and the row that kept saying "has notes" over nothing was the defect
    // the setters trim for.
    const at = contextSeries();
    let session = threeSetWorkout();
    const [id] = setIds(session);
    const exerciseId = session.exercises[0]?.id ?? '';
    session = setWorkoutNote(session, 'Rough', at(AT_START));
    session = setExerciseNote(session, exerciseId, 'Belt on', at(AT_START));
    session = setSetNote(session, id ?? '', 'Belt', at(AT_START));
    expect(summarize(session).hasNotes).toBe(true);

    session = setWorkoutNote(session, null, at(AT_LATER));
    session = setExerciseNote(session, exerciseId, '', at(AT_LATER));
    session = setSetNote(session, id ?? '', '   ', at(AT_LATER));

    expect(summarize(session).hasNotes).toBe(false);
  });

  it('carries the identity a history row needs', () => {
    const session = threeSetWorkout();
    const summary = summarize(session);

    expect(summary).toMatchObject({
      id: session.id,
      localDate: ON_DAY,
      status: 'draft',
      title: 'Squat day',
      durationMillis: null,
      updatedAt: session.updatedAt,
    });
  });
});

describe('byMostRecent', () => {
  it('puts the newest day first', () => {
    const older = summarize({ ...threeSetWorkout(), localDate: '2026-03-09' });
    const newer = summarize({ ...threeSetWorkout(), localDate: '2026-03-11' });

    expect([older, newer].sort(byMostRecent).map((row) => row.localDate)).toEqual([
      '2026-03-11',
      '2026-03-09',
    ]);
  });

  it('breaks a tie within a day on which was touched most recently', () => {
    // Two workouts on one day is ordinary -- a morning squat session and an
    // evening bench session -- and without this the order is whatever storage
    // happened to return.
    const morning = summarize({ ...threeSetWorkout(), updatedAt: AT_START });
    const evening = summarize({ ...threeSetWorkout(), updatedAt: AT_LATER });

    expect([morning, evening].sort(byMostRecent).map((row) => row.updatedAt)).toEqual([
      AT_LATER,
      AT_START,
    ]);
  });

  it('is zero for two rows with the same day and the same stamp', () => {
    const row = summarize(threeSetWorkout());

    expect(byMostRecent(row, row)).toBe(0);
  });
});
