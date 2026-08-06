// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The lifecycle, and the one invariant the whole package is built around: a plan
 * is never overwritten by a result.
 *
 * Section 18.2 asks for "interruption after every meaningful action" to be
 * testable, and that is what the purity buys -- every case below is a value
 * handed to a function and the value that comes back, with no setup, no teardown
 * and nothing to interrupt.
 */

import { describe, expect, it } from 'vitest';

import type {
  EquipmentSnapshot,
  SetLoad,
  SetPerformance,
  WarmupSnapshot,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { AT_LATER, AT_START, ON_DAY, contextSeries, testContext } from './context.fixture.js';
import {
  SCHEMA_VERSION,
  addExercise,
  addSet,
  attachWarmup,
  completeSet,
  createWorkout,
  discardWorkout,
  duplicateSet,
  emptyPerformance,
  findSet,
  findWorkoutExercise,
  finishWorkout,
  insertSets,
  markSetIncomplete,
  moveExercise,
  outstandingSets,
  performance,
  planSet,
  recordSet,
  removeExercise,
  removeSet,
  repeatWorkout,
  setExerciseNote,
  setSetNote,
  setWorkoutNote,
  setWorkoutTitle,
  skipSet,
  startWorkout,
  undoSet,
  type PlannedSet,
  type SessionContext,
} from './session.js';
import { applyWarmup, warmupChange } from './warmup.js';

/** Invented weights. Round numbers so an assertion reads at a glance. */
function kilograms(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

function squatPlan(): SetPerformance {
  return performance(kilograms(100), 5);
}

/** A draft with one exercise of two planned working sets. */
function twoSetWorkout(): WorkoutSession {
  const context = testContext();
  const draft = createWorkout(context, { localDate: ON_DAY });
  return addExercise(draft, context, {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: [
      { kind: 'working', performance: squatPlan() },
      { kind: 'working', performance: squatPlan() },
    ],
  });
}

function firstSet(session: WorkoutSession): WorkoutSet {
  const exercise = session.exercises[0];
  if (exercise === undefined) throw new Error('no exercises');
  const set = exercise.sets[0];
  if (set === undefined) throw new Error('no sets');
  return set;
}

function setById(session: WorkoutSession, setId: string): WorkoutSet {
  const found = findSet(session, setId);
  if (found === null) throw new Error(`no set ${setId}`);
  return found.set;
}

/** An invented rack, in kilograms so the plans in this file read in the rack's own unit. */
function aGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 5, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: true },
      { weight: 5, pairs: null, fullDiameter: false },
      { weight: 2.5, pairs: null, fullDiameter: false },
    ],
  };
}

/**
 * A snapshot off the engine rather than one written by hand.
 *
 * Nothing below reads its contents; what is wanted is any non-null one, so that
 * a case about an identifier stays about the identifier rather than passing on
 * `attachWarmup`'s null-to-null guard. Inventing a snapshot would mean inventing
 * a ramp, and no warm-up number in this package is written outside the engine.
 */
function aWarmupSnapshot(): WarmupSnapshot {
  const context = testContext();
  const session = twoSetWorkout();
  const change = warmupChange(
    session,
    session.exercises[0]?.id ?? '',
    {
      family: 'squat-press',
      equipment: aGym(),
      workingWeight: 100,
      workingSets: 2,
      workingReps: 5,
    },
    context,
  );
  if (change?.ok !== true) throw new Error('the fixture produced no ramp');
  return change.change.snapshot;
}

describe('createWorkout', () => {
  it('starts a draft that has not begun', () => {
    const session = createWorkout(testContext(), { localDate: ON_DAY });

    expect(session).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      status: 'draft',
      localDate: ON_DAY,
      startedAt: null,
      completedAt: null,
      title: null,
      note: null,
      exercises: [],
      createdAt: AT_START,
      updatedAt: AT_START,
      source: 'manual',
    });
  });

  it('keeps the title and source it was given', () => {
    const session = createWorkout(testContext(), {
      localDate: ON_DAY,
      title: 'Squat day',
      source: 'warmup-calculator-handoff',
    });

    expect(session.title).toBe('Squat day');
    expect(session.source).toBe('warmup-calculator-handoff');
  });

  it('takes its calendar day from the caller and never from the instant', () => {
    // The instant is the tenth of March in UTC and the ninth in California. A
    // session logged on the ninth files itself under the ninth; deriving the day
    // from `at` would file it under the tenth and put an evening session on the
    // wrong page of the history.
    const session = createWorkout(testContext('2026-03-10T04:00:00.000Z'), {
      localDate: '2026-03-09',
    });

    expect(session.localDate).toBe('2026-03-09');
  });
});

describe('addExercise', () => {
  it('appends the exercise with its planned sets, none of them performed', () => {
    const session = twoSetWorkout();
    const exercise = session.exercises[0];

    expect(session.exercises).toHaveLength(1);
    expect(exercise).toMatchObject({ exerciseId: 'squat', displayName: 'Squat', warmup: null });
    expect(exercise?.sets).toHaveLength(2);
    expect(exercise?.sets.every((set) => set.status === 'planned')).toBe(true);
    expect(exercise?.sets.every((set) => set.performed === null)).toBe(true);
  });

  it('gives every set its own identifier', () => {
    const session = twoSetWorkout();
    const ids = session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('adds an exercise with no sets at all', () => {
    const context = testContext();
    const session = addExercise(createWorkout(context, { localDate: ON_DAY }), context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
    });

    expect(session.exercises[0]?.sets).toEqual([]);
  });

  it('stamps the workout as touched', () => {
    const at = contextSeries();
    const draft = createWorkout(at(AT_START), { localDate: ON_DAY });
    const session = addExercise(draft, at(AT_LATER), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
    });

    expect(session.createdAt).toBe(AT_START);
    expect(session.updatedAt).toBe(AT_LATER);
  });
});

describe('removeExercise', () => {
  it('takes the exercise and its sets out', () => {
    const session = twoSetWorkout();
    const id = session.exercises[0]?.id ?? '';

    expect(removeExercise(session, id, testContext(AT_LATER)).exercises).toEqual([]);
  });

  it('leaves an unknown identifier alone', () => {
    const session = twoSetWorkout();

    expect(removeExercise(session, 'nothing', testContext(AT_LATER)).exercises).toHaveLength(1);
  });
});

describe('moveExercise', () => {
  function threeExercises(): WorkoutSession {
    const context = testContext();
    let session = createWorkout(context, { localDate: ON_DAY });
    for (const name of ['Squat', 'Bench Press', 'Deadlift']) {
      session = addExercise(session, context, {
        exerciseId: name.toLowerCase(),
        displayName: name,
        loading: 'barbell-total-weight',
      });
    }
    return session;
  }

  function names(session: WorkoutSession): readonly string[] {
    return session.exercises.map((exercise) => exercise.displayName);
  }

  it('swaps an exercise with the one above it', () => {
    const session = threeExercises();
    const id = session.exercises[1]?.id ?? '';

    expect(names(moveExercise(session, id, 'up', testContext()))).toEqual([
      'Bench Press',
      'Squat',
      'Deadlift',
    ]);
  });

  it('swaps an exercise with the one below it', () => {
    const session = threeExercises();
    const id = session.exercises[1]?.id ?? '';

    expect(names(moveExercise(session, id, 'down', testContext()))).toEqual([
      'Squat',
      'Deadlift',
      'Bench Press',
    ]);
  });

  it('does nothing at the top, rather than wrapping to the bottom', () => {
    const session = threeExercises();
    const id = session.exercises[0]?.id ?? '';
    const moved = moveExercise(session, id, 'up', testContext(AT_LATER));

    expect(names(moved)).toEqual(['Squat', 'Bench Press', 'Deadlift']);
    // Returned unchanged, not merely reordered-to-the-same-thing: a no-op that
    // still stamped `updatedAt` would make a tap on a disabled-looking control
    // move the workout to the top of the history.
    expect(moved).toBe(session);
  });

  it('does nothing at the bottom', () => {
    const session = threeExercises();
    const id = session.exercises[2]?.id ?? '';

    expect(moveExercise(session, id, 'down', testContext())).toBe(session);
  });

  it('does nothing for an unknown identifier', () => {
    const session = threeExercises();

    expect(moveExercise(session, 'nothing', 'up', testContext())).toBe(session);
  });
});

describe('completeSet', () => {
  it('copies the plan into the result when nothing was typed', () => {
    const session = twoSetWorkout();
    const completed = completeSet(session, firstSet(session).id, testContext(AT_LATER));
    const set = firstSet(completed);

    expect(set.status).toBe('complete');
    expect(set.performed).toEqual(squatPlan());
    expect(set.completedAt).toBe(AT_LATER);
  });

  it('keeps the result the lifter typed rather than the plan', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const actual = performance(kilograms(100), 4);
    const recorded = recordSet(session, id, actual, testContext(AT_LATER));
    const completed = completeSet(recorded, id, testContext(AT_LATER));

    expect(setById(completed, id).performed).toEqual(actual);
  });

  it('never writes to the plan', () => {
    const session = twoSetWorkout();
    const completed = completeSet(session, firstSet(session).id, testContext(AT_LATER));

    expect(firstSet(completed).planned).toEqual(squatPlan());
  });

  it('leaves the other sets alone', () => {
    const session = twoSetWorkout();
    const completed = completeSet(session, firstSet(session).id, testContext(AT_LATER));

    expect(completed.exercises[0]?.sets[1]?.status).toBe('planned');
  });

  it('completes a set that had no plan at all', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const added = addSet(
      session,
      exerciseId,
      { kind: 'accessory', performance: emptyPerformance() },
      testContext(AT_LATER),
    );
    const set = added.exercises[0]?.sets[2];
    if (set === undefined) throw new Error('no added set');
    const completed = completeSet(added, set.id, testContext(AT_LATER));

    expect(setById(completed, set.id).performed).toEqual(emptyPerformance());
  });
});

describe('recordSet', () => {
  it('completes a planned set and stamps it', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const recorded = recordSet(session, id, performance(kilograms(100), 3), testContext(AT_LATER));

    expect(setById(recorded, id)).toMatchObject({ status: 'complete', completedAt: AT_LATER });
  });

  it('editing a completed set keeps the moment it was completed', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const completed = completeSet(session, id, testContext(AT_START));
    const corrected = recordSet(
      completed,
      id,
      performance(kilograms(100), 4),
      testContext(AT_LATER),
    );

    // The lifter is correcting the record of something they did at five, not
    // doing it again at twenty past.
    expect(setById(corrected, id).completedAt).toBe(AT_START);
    expect(setById(corrected, id).performed?.repetitions).toBe(4);
  });

  it('editing a skipped set does not silently complete it', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const skipped = skipSet(session, id, testContext(AT_LATER));
    const edited = recordSet(skipped, id, performance(kilograms(100), 2), testContext(AT_LATER));

    expect(setById(edited, id).status).toBe('skipped');
  });
});

describe('markSetIncomplete', () => {
  it('keeps the reps that were made', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const short = markSetIncomplete(
      session,
      id,
      performance(kilograms(100), 3),
      testContext(AT_LATER),
    );

    expect(setById(short, id)).toMatchObject({ status: 'incomplete' });
    expect(setById(short, id).performed?.repetitions).toBe(3);
    expect(setById(short, id).planned?.repetitions).toBe(5);
  });

  it('keeps a result already recorded when none is supplied', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const recorded = recordSet(session, id, performance(kilograms(100), 2), testContext(AT_START));
    const short = markSetIncomplete(recorded, id, null, testContext(AT_LATER));

    expect(setById(short, id).performed?.repetitions).toBe(2);
  });
});

describe('skipSet', () => {
  it('clears the result so no weight nobody lifted reaches the history', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const completed = completeSet(session, id, testContext(AT_START));
    const skipped = skipSet(completed, id, testContext(AT_LATER));

    expect(setById(skipped, id)).toMatchObject({
      status: 'skipped',
      performed: null,
      completedAt: null,
    });
  });
});

describe('undoSet', () => {
  it('puts the set back to planned with nothing performed', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const completed = completeSet(session, id, testContext(AT_START));
    const undone = undoSet(completed, id, testContext(AT_LATER));

    expect(setById(undone, id)).toMatchObject({
      status: 'planned',
      performed: null,
      completedAt: null,
    });
    expect(setById(undone, id).planned).toEqual(squatPlan());
  });
});

describe('planSet', () => {
  it('rewrites the plan and leaves the result alone', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const completed = completeSet(session, id, testContext(AT_START));
    const replanned = planSet(completed, id, performance(kilograms(105), 5), testContext(AT_LATER));

    expect(setById(replanned, id).planned?.load).toEqual(kilograms(105));
    expect(setById(replanned, id).performed).toEqual(squatPlan());
  });
});

describe('addSet and duplicateSet', () => {
  it('adds a set to the end of one exercise', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const added = addSet(
      session,
      exerciseId,
      { kind: 'backoff', performance: performance(kilograms(80), 8) },
      testContext(AT_LATER),
    );

    expect(added.exercises[0]?.sets).toHaveLength(3);
    expect(added.exercises[0]?.sets[2]?.kind).toBe('backoff');
  });

  it('duplicates the plan and not the result, straight after the original', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const completed = completeSet(session, id, testContext(AT_START));
    const copied = duplicateSet(completed, id, testContext(AT_LATER));
    const copy = copied.exercises[0]?.sets[1];

    expect(copied.exercises[0]?.sets).toHaveLength(3);
    expect(copy).toMatchObject({ status: 'planned', performed: null, completedAt: null });
    expect(copy?.planned).toEqual(squatPlan());
    expect(copy?.id).not.toBe(id);
  });

  it('duplicating a set logged with no plan carries the result forward as the plan', () => {
    const at = contextSeries();
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    session = addExercise(session, at(AT_START), {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'accessory', performance: emptyPerformance() }],
    });
    const id = firstSet(session).id;
    const logged = recordSet(session, id, performance({ kind: 'none' }, 12), at(AT_LATER));
    const stripped: WorkoutSession = {
      ...logged,
      exercises: logged.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set, planned: null })),
      })),
    };

    const copied = duplicateSet(stripped, id, at(AT_LATER));

    expect(copied.exercises[0]?.sets[1]?.planned?.repetitions).toBe(12);
  });

  it('removes a set without touching its neighbours', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const trimmed = removeSet(session, id, testContext(AT_LATER));

    expect(trimmed.exercises[0]?.sets).toHaveLength(1);
    expect(findSet(trimmed, id)).toBeNull();
  });
});

describe('insertSets', () => {
  it('puts several sets at a position without disturbing what is there', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const before = session.exercises[0]?.sets.map((set) => set.id);
    const inserted = insertSets(
      session,
      exerciseId,
      1,
      [
        { kind: 'warmup', performance: performance(kilograms(40), 5) },
        { kind: 'warmup', performance: performance(kilograms(60), 3) },
      ],
      testContext(AT_LATER),
    );
    const sets = inserted.exercises[0]?.sets ?? [];

    expect(sets.map((set) => set.kind)).toEqual(['working', 'warmup', 'warmup', 'working']);
    expect([sets[0]?.id, sets[3]?.id]).toEqual(before);
  });

  it('reads an index outside the list as one of its two ends', () => {
    // A negative index is the one that has to be clamped rather than passed
    // through: `slice` would read it from the far end, so a caller off by one
    // below zero would land the sets one from the *back* of the list -- a warm-up
    // ramp inserted between the last two working sets. Past the end there is
    // nothing to get wrong, and it is asserted so that stays true.
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const planned = [{ kind: 'backoff' as const, performance: performance(kilograms(70), 8) }];

    expect(
      insertSets(session, exerciseId, 99, planned, testContext()).exercises[0]?.sets.map(
        (set) => set.kind,
      ),
    ).toEqual(['working', 'working', 'backoff']);
    expect(
      insertSets(session, exerciseId, -1, planned, testContext()).exercises[0]?.sets.map(
        (set) => set.kind,
      ),
    ).toEqual(['backoff', 'working', 'working']);
  });

  it('leaves the session alone when there is nothing to insert', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';

    expect(insertSets(session, exerciseId, 0, [], testContext(AT_LATER))).toBe(session);
  });
});

/**
 * Every operation that takes an identifier, handed one nothing in the session
 * answers to.
 *
 * `toBe` rather than `toEqual`, and that is the whole of the block. These used to
 * walk the exercises, match nothing and stamp `updatedAt` regardless --
 * `summarize` sorts the history on `updatedAt`, so a tap on a control for a set
 * another tab had just removed moved the workout back to the top of the list
 * having changed nothing in it. Every value assertion in this file passes against
 * that, which is why none of them caught it.
 */
describe('an operation aimed at an identifier nothing answers to', () => {
  const GONE = 'id-nothing';

  it('leaves the session alone, by identity, for every set operation', () => {
    const session = twoSetWorkout();

    expect(completeSet(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(recordSet(session, GONE, performance(kilograms(100), 3), testContext(AT_LATER))).toBe(
      session,
    );
    expect(markSetIncomplete(session, GONE, null, testContext(AT_LATER))).toBe(session);
    expect(skipSet(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(undoSet(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(planSet(session, GONE, squatPlan(), testContext(AT_LATER))).toBe(session);
    expect(duplicateSet(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(removeSet(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(setSetNote(session, GONE, 'Cut it short', testContext(AT_LATER))).toBe(session);
  });

  it('leaves the session alone, by identity, for every exercise operation', () => {
    const session = twoSetWorkout();
    const planned: PlannedSet = { kind: 'backoff', performance: performance(kilograms(80), 8) };

    expect(addSet(session, GONE, planned, testContext(AT_LATER))).toBe(session);
    expect(insertSets(session, GONE, 0, [planned], testContext(AT_LATER))).toBe(session);
    expect(attachWarmup(session, GONE, aWarmupSnapshot(), testContext(AT_LATER))).toBe(session);
    expect(removeExercise(session, GONE, testContext(AT_LATER))).toBe(session);
    expect(moveExercise(session, GONE, 'up', testContext(AT_LATER))).toBe(session);
    expect(setExerciseNote(session, GONE, 'Belt on', testContext(AT_LATER))).toBe(session);
  });

  it('spends no identifier on an exercise that is gone', () => {
    // The guard has to sit in front of `buildSet` and not behind it. An
    // identifier burnt on a set nobody kept is invisible in the session it was
    // not written to, and turns up later as a hole in the sequence a repository
    // is handing out -- which is only ever read as a lost record.
    const at = contextSeries();
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    session = addExercise(session, at(AT_START), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: [{ kind: 'working', performance: squatPlan() }],
    });
    const exerciseId = session.exercises[0]?.id ?? '';
    const planned: PlannedSet = { kind: 'backoff', performance: squatPlan() };
    addSet(session, GONE, planned, at(AT_LATER));
    const added = addSet(session, exerciseId, planned, at(AT_LATER));

    // The session, the exercise and its one planned set took `id-1` to `id-3`.
    expect(added.exercises[0]?.sets[1]?.id).toBe('id-4');
  });
});

describe('an operation repeated on a set that is already in that state', () => {
  it('skipping a set that is already skipped changes nothing at all', () => {
    // Skipping writes three fields and none of them is a moment, so a second tap
    // has nothing left to say -- and saying it anyway would move the workout up
    // the history for a lifter pressing a control that already looks pressed.
    const at = contextSeries();
    const first = twoSetWorkout();
    const session = skipSet(first, firstSet(first).id, at(AT_START));

    expect(skipSet(session, firstSet(session).id, at(AT_LATER))).toBe(session);
  });

  it('undoing a set that was never done changes nothing at all', () => {
    const session = twoSetWorkout();

    expect(undoSet(session, firstSet(session).id, testContext(AT_LATER))).toBe(session);
  });

  it('taking a warm-up off an exercise that has none changes nothing at all', () => {
    // `clearWarmup` reaches this with `null` every time it is called, so an
    // exercise that never had a ramp is the ordinary case and not a corner.
    const session = twoSetWorkout();

    expect(attachWarmup(session, session.exercises[0]?.id ?? '', null, testContext(AT_LATER))).toBe(
      session,
    );
  });

  it('completing a set that is already complete is a new answer to when', () => {
    // Deliberately not guarded, unlike the three above. A completion writes the
    // moment it happened, so a second tap says something the first did not.
    // `recordSet` is the path that keeps the original moment, because correcting
    // the record of a lift is not doing it again -- and it still does.
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const done = completeSet(session, id, testContext(AT_START));
    const again = completeSet(done, id, testContext(AT_LATER));

    expect(again).not.toBe(done);
    expect(setById(again, id).completedAt).toBe(AT_LATER);
    expect(again.updatedAt).toBe(AT_LATER);
  });
});

describe('notes', () => {
  /**
   * Two exercises of two sets each, so a note written to the wrong one has
   * somewhere to show up. A mapping bug over a single-exercise fixture is
   * indistinguishable from the correct answer.
   */
  function twoExerciseWorkout(): WorkoutSession {
    const at = contextSeries();
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    for (const displayName of ['Squat', 'Bench Press']) {
      session = addExercise(session, at(AT_START), {
        exerciseId: displayName.toLowerCase(),
        displayName,
        loading: 'barbell-total-weight',
        plan: [
          { kind: 'working', performance: squatPlan() },
          { kind: 'working', performance: squatPlan() },
        ],
      });
    }
    return session;
  }

  function exerciseNotes(session: WorkoutSession): readonly (string | null)[] {
    return session.exercises.map((exercise) => exercise.note);
  }

  function setNotes(session: WorkoutSession): readonly (string | null)[] {
    return session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.note));
  }

  it('sets and clears a workout note', () => {
    const session = setWorkoutNote(twoSetWorkout(), 'Felt heavy', testContext(AT_LATER));

    expect(session.note).toBe('Felt heavy');
    expect(setWorkoutNote(session, null, testContext(AT_LATER)).note).toBeNull();
  });

  it('sets and clears an exercise note', () => {
    const session = twoSetWorkout();
    const id = session.exercises[0]?.id ?? '';
    const noted = setExerciseNote(session, id, 'Belt from set two', testContext());

    expect(noted.exercises[0]?.note).toBe('Belt from set two');
    expect(setExerciseNote(noted, id, null, testContext(AT_LATER)).exercises[0]?.note).toBeNull();
  });

  it('sets and clears a set note', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const noted = setSetNote(session, id, 'Knee wrap slipped', testContext());

    expect(noted.exercises[0]?.sets[0]?.note).toBe('Knee wrap slipped');
    expect(
      setSetNote(noted, id, null, testContext(AT_LATER)).exercises[0]?.sets[0]?.note,
    ).toBeNull();
  });

  it('stamps the workout when a note actually changes', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;

    expect(session.updatedAt).toBe(AT_START);
    expect(setWorkoutNote(session, 'Rough', testContext(AT_LATER)).updatedAt).toBe(AT_LATER);
    expect(setExerciseNote(session, exerciseId, 'Belt on', testContext(AT_LATER)).updatedAt).toBe(
      AT_LATER,
    );
    expect(setSetNote(session, setId, 'Cut it short', testContext(AT_LATER)).updatedAt).toBe(
      AT_LATER,
    );
  });

  it('writing the note that is already there changes nothing at all', () => {
    // A note box debounces and fires with the text it already holds. Returning a
    // new session would persist it, re-render the screen, and move the workout to
    // the top of the history for a keystroke nobody made.
    const at = contextSeries();
    let session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;
    session = setWorkoutNote(session, 'Rough', at(AT_START));
    session = setExerciseNote(session, exerciseId, 'Belt on', at(AT_START));
    session = setSetNote(session, setId, 'Cut it short', at(AT_START));

    expect(setWorkoutNote(session, 'Rough', at(AT_LATER))).toBe(session);
    expect(setExerciseNote(session, exerciseId, 'Belt on', at(AT_LATER))).toBe(session);
    expect(setSetNote(session, setId, 'Cut it short', at(AT_LATER))).toBe(session);
    expect(session.updatedAt).toBe(AT_START);
  });

  it('reads the same words with whitespace round them as the same note', () => {
    // The comparison is against the trimmed value. Against the raw argument, a
    // box that hands back its text with a trailing space -- which is what a
    // lifter typing mid-sentence produces -- would write on every keystroke.
    const session = setWorkoutNote(twoSetWorkout(), 'Rough', testContext(AT_START));

    expect(setWorkoutNote(session, '  Rough  ', testContext(AT_LATER))).toBe(session);
  });

  it('clearing a note that is already clear changes nothing', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;

    expect(setWorkoutNote(session, null, testContext(AT_LATER))).toBe(session);
    expect(setExerciseNote(session, exerciseId, null, testContext(AT_LATER))).toBe(session);
    expect(setSetNote(session, setId, null, testContext(AT_LATER))).toBe(session);
  });

  it('leaves the session alone for an identifier nothing answers to', () => {
    const session = twoSetWorkout();

    expect(setExerciseNote(session, 'nothing', 'Belt on', testContext(AT_LATER))).toBe(session);
    expect(setSetNote(session, 'nothing', 'Cut it short', testContext(AT_LATER))).toBe(session);
  });

  it('stores an emptied box as no note rather than as an empty one', () => {
    // `hasNote` in `summary.ts` asks whether the note is non-null, so an empty
    // string stored as typed leaves a permanent "has notes" mark on the history
    // row with nothing behind it. Spaces alone are the same box.
    const at = contextSeries();
    let session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;
    session = setWorkoutNote(session, 'Rough', at(AT_START));
    session = setExerciseNote(session, exerciseId, 'Belt on', at(AT_START));
    session = setSetNote(session, setId, 'Cut it short', at(AT_START));

    expect(setWorkoutNote(session, '', at(AT_LATER)).note).toBeNull();
    expect(setWorkoutNote(session, '   ', at(AT_LATER)).note).toBeNull();
    expect(setExerciseNote(session, exerciseId, '', at(AT_LATER)).exercises[0]?.note).toBeNull();
    expect(setExerciseNote(session, exerciseId, '   ', at(AT_LATER)).exercises[0]?.note).toBeNull();
    expect(setSetNote(session, setId, '', at(AT_LATER)).exercises[0]?.sets[0]?.note).toBeNull();
    expect(setSetNote(session, setId, '   ', at(AT_LATER)).exercises[0]?.sets[0]?.note).toBeNull();
  });

  it('emptying a box that held nothing is not a change', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;

    expect(setWorkoutNote(session, '', testContext(AT_LATER))).toBe(session);
    expect(setExerciseNote(session, exerciseId, '  ', testContext(AT_LATER))).toBe(session);
    expect(setSetNote(session, setId, '', testContext(AT_LATER))).toBe(session);
  });

  it('stores a note without the whitespace round it', () => {
    const session = twoSetWorkout();
    const exerciseId = session.exercises[0]?.id ?? '';
    const setId = firstSet(session).id;

    expect(setWorkoutNote(session, '  Felt heavy  ', testContext(AT_LATER)).note).toBe(
      'Felt heavy',
    );
    expect(
      setExerciseNote(session, exerciseId, ' Belt from set two ', testContext(AT_LATER))
        .exercises[0]?.note,
    ).toBe('Belt from set two');
    expect(
      setSetNote(session, setId, '\n Knee wrap slipped \n', testContext(AT_LATER)).exercises[0]
        ?.sets[0]?.note,
    ).toBe('Knee wrap slipped');
  });

  it('notes one exercise without touching the other', () => {
    const session = twoExerciseWorkout();
    const id = session.exercises[1]?.id ?? '';

    expect(exerciseNotes(setExerciseNote(session, id, 'Paused', testContext(AT_LATER)))).toEqual([
      null,
      'Paused',
    ]);
  });

  it('notes one set without touching the other three', () => {
    const session = twoExerciseWorkout();
    const id = session.exercises[1]?.sets[0]?.id ?? '';

    expect(setNotes(setSetNote(session, id, 'Elbow flared', testContext(AT_LATER)))).toEqual([
      null,
      null,
      'Elbow flared',
      null,
    ]);
  });

  it('retitles the workout', () => {
    expect(setWorkoutTitle(twoSetWorkout(), 'Heavy squat', testContext()).title).toBe(
      'Heavy squat',
    );
  });

  it('stores an emptied title box as no title rather than as an empty one', () => {
    // `summarize` puts the title straight on the history row, so a stored `''`
    // heads a row with a blank and two spaces heads it with two spaces. The same
    // three defects the note setters above stopped having, one field over.
    const session = setWorkoutTitle(twoSetWorkout(), 'Heavy squat', testContext(AT_START));

    expect(setWorkoutTitle(session, '', testContext(AT_LATER)).title).toBeNull();
    expect(setWorkoutTitle(session, '   ', testContext(AT_LATER)).title).toBeNull();
    expect(setWorkoutTitle(session, '  Squat day  ', testContext(AT_LATER)).title).toBe(
      'Squat day',
    );
  });

  it('writing the title that is already there changes nothing at all', () => {
    const session = setWorkoutTitle(twoSetWorkout(), 'Heavy squat', testContext(AT_START));

    expect(setWorkoutTitle(session, 'Heavy squat', testContext(AT_LATER))).toBe(session);
    expect(setWorkoutTitle(session, '  Heavy squat  ', testContext(AT_LATER))).toBe(session);
    expect(session.updatedAt).toBe(AT_START);
  });

  it('clearing a title that is already clear changes nothing', () => {
    const session = twoSetWorkout();

    expect(setWorkoutTitle(session, null, testContext(AT_LATER))).toBe(session);
    expect(setWorkoutTitle(session, '  ', testContext(AT_LATER))).toBe(session);
  });
});

describe('startWorkout', () => {
  it('moves a draft to active and stamps when it began', () => {
    const started = startWorkout(twoSetWorkout(), testContext(AT_LATER));

    expect(started).toMatchObject({ status: 'active', startedAt: AT_LATER });
  });

  it('a second call does not reset the session clock', () => {
    const started = startWorkout(twoSetWorkout(), testContext(AT_START));
    const again = startWorkout(started, testContext(AT_LATER));

    expect(again.startedAt).toBe(AT_START);
    expect(again).toBe(started);
  });
});

describe('finishWorkout', () => {
  it('lists the sets still waiting', () => {
    const session = twoSetWorkout();
    const completed = completeSet(session, firstSet(session).id, testContext(AT_LATER));

    expect(outstandingSets(completed)).toHaveLength(1);
  });

  it('leaving the outstanding sets keeps them planned', () => {
    const finished = finishWorkout(twoSetWorkout(), 'leave', testContext(AT_LATER));

    expect(finished.status).toBe('completed');
    expect(finished.completedAt).toBe(AT_LATER);
    expect(finished.exercises[0]?.sets.every((set) => set.status === 'planned')).toBe(true);
  });

  it('skipping the outstanding sets marks exactly those', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const partly = completeSet(session, id, testContext(AT_START));
    const finished = finishWorkout(partly, 'skip', testContext(AT_LATER));

    expect(finished.exercises[0]?.sets.map((set) => set.status)).toEqual(['complete', 'skipped']);
  });

  it('skipping does not disturb a completed set', () => {
    const session = twoSetWorkout();
    const id = firstSet(session).id;
    const partly = completeSet(session, id, testContext(AT_START));
    const finished = finishWorkout(partly, 'skip', testContext(AT_LATER));

    expect(setById(finished, id).completedAt).toBe(AT_START);
    expect(setById(finished, id).performed).toEqual(squatPlan());
  });
});

describe('discardWorkout', () => {
  it('marks the workout discarded without deleting anything', () => {
    const discarded = discardWorkout(twoSetWorkout(), testContext(AT_LATER));

    expect(discarded.status).toBe('discarded');
    expect(discarded.exercises).toHaveLength(1);
  });
});

describe('repeatWorkout', () => {
  /**
   * A finished workout, built from a caller-supplied generator.
   *
   * The generator is a parameter rather than a fresh one per call because that is
   * how a repository uses this package: one identifier source for the whole
   * device. A test that gave the copy its own counter would hand out `id-1` twice
   * and then blame `repeatWorkout` for it.
   */
  function finishedWorkout(
    at: (instant: string) => SessionContext = contextSeries(),
  ): WorkoutSession {
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    session = addExercise(session, at(AT_START), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: [
        { kind: 'working', performance: squatPlan() },
        { kind: 'working', performance: squatPlan() },
      ],
    });
    session = setWorkoutNote(session, 'Rough day', at(AT_START));
    const exerciseId = session.exercises[0]?.id ?? '';
    session = setExerciseNote(session, exerciseId, 'Belt on', at(AT_START));
    const id = firstSet(session).id;
    session = setSetNote(session, id, 'Cut it short', at(AT_START));
    session = completeSet(session, id, at(AT_START));
    return finishWorkout(session, 'skip', at(AT_LATER));
  }

  /** Invented working weights, rising so the order they come back in can be read off. */
  const RISING_PLAN: readonly PlannedSet[] = [
    { kind: 'working', performance: performance(kilograms(100), 5) },
    { kind: 'working', performance: performance(kilograms(105), 3) },
    { kind: 'working', performance: performance(kilograms(110), 1) },
  ];

  /**
   * A finished workout with a real generated ramp above its working sets.
   *
   * Through the engine rather than written by hand, because the snapshot and the
   * `warmup` rows are two halves of one fact and a fixture that invented either
   * could hold them out of step -- which is the very state being asserted against.
   * It also makes the assertion below able to fail: `addExercise` leaves `warmup`
   * null, so a source built without this generates a passing test either way.
   */
  function rampedWorkout(
    at: (instant: string) => SessionContext = contextSeries(),
  ): WorkoutSession {
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    session = addExercise(session, at(AT_START), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: RISING_PLAN,
    });
    const exerciseId = session.exercises[0]?.id ?? '';
    const change = warmupChange(
      session,
      exerciseId,
      {
        family: 'squat-press',
        equipment: aGym(),
        // The plan's own invented opener, as the bare number in the rack's unit
        // that `WarmupInput` takes.
        workingWeight: 100,
        workingSets: 3,
        workingReps: 5,
      },
      at(AT_START),
    );
    if (change?.ok !== true) throw new Error('the fixture produced no ramp');
    session = applyWarmup(session, exerciseId, change.change, at(AT_START));
    return finishWorkout(session, 'skip', at(AT_LATER));
  }

  function kinds(session: WorkoutSession): readonly string[] {
    return session.exercises.flatMap((exercise) => exercise.sets.map((set) => set.kind));
  }

  it('keeps the plan and drops every result', () => {
    const repeated = repeatWorkout(finishedWorkout(), testContext(AT_LATER), {
      localDate: '2026-03-17',
    });
    const sets = repeated.exercises.flatMap((exercise) => exercise.sets);

    expect(repeated.status).toBe('draft');
    expect(repeated.localDate).toBe('2026-03-17');
    expect(repeated.source).toBe('repeated-workout');
    expect(sets).toHaveLength(2);
    expect(sets.every((set) => set.status === 'planned')).toBe(true);
    expect(sets.every((set) => set.performed === null)).toBe(true);
    expect(sets.every((set) => set.completedAt === null)).toBe(true);
    expect(sets.every((set) => set.planned?.repetitions === 5)).toBe(true);
  });

  it('drops the workout note and the set notes and keeps the exercise note', () => {
    const repeated = repeatWorkout(finishedWorkout(), testContext(AT_LATER), { localDate: ON_DAY });

    expect(repeated.note).toBeNull();
    expect(repeated.exercises[0]?.note).toBe('Belt on');
    expect(repeated.exercises[0]?.sets.every((set) => set.note === null)).toBe(true);
  });

  it('drops the warm-up snapshot so last month s plates are not shown as today s', () => {
    const source = rampedWorkout();
    expect(source.exercises[0]?.warmup).not.toBeNull();

    const repeated = repeatWorkout(source, testContext(AT_LATER), { localDate: ON_DAY });

    expect(repeated.exercises[0]?.warmup).toBeNull();
  });

  it('drops the warm-up rows the snapshot produced along with it', () => {
    // A rung with no snapshot behind it is searched against today's rack, so the
    // row would carry last month's total over this morning's plates -- and where
    // the rack has changed, over no plates at all. No snapshot, no rows.
    const source = rampedWorkout();
    expect(kinds(source)).toContain('warmup');

    const repeated = repeatWorkout(source, testContext(AT_LATER), { localDate: ON_DAY });
    const sets = repeated.exercises.flatMap((exercise) => exercise.sets);

    expect(kinds(repeated)).toEqual(['working', 'working', 'working']);
    expect(sets.map((set) => set.planned)).toEqual(RISING_PLAN.map((entry) => entry.performance));
  });

  it('takes nothing else out of the order the sets were in', () => {
    // The ramp sits above the working sets, so dropping it takes rows out of the
    // front of the list rather than off the end.
    const source = rampedWorkout();
    expect(source.exercises[0]?.sets[0]?.kind).toBe('warmup');

    const repeated = repeatWorkout(source, testContext(AT_LATER), { localDate: ON_DAY });

    expect(repeated.exercises[0]?.sets.map((set) => set.planned?.load)).toEqual([
      kilograms(100),
      kilograms(105),
      kilograms(110),
    ]);
  });

  it('gives every copied object a new identifier', () => {
    const at = contextSeries();
    const source = finishedWorkout(at);
    const repeated = repeatWorkout(source, at(AT_LATER), { localDate: ON_DAY });
    const sourceIds = new Set([
      source.id,
      ...source.exercises.flatMap((exercise) => [
        exercise.id,
        ...exercise.sets.map((set) => set.id),
      ]),
    ]);
    const repeatedIds = [
      repeated.id,
      ...repeated.exercises.flatMap((exercise) => [
        exercise.id,
        ...exercise.sets.map((set) => set.id),
      ]),
    ];

    expect(repeatedIds.some((id) => sourceIds.has(id))).toBe(false);
    expect(new Set(repeatedIds).size).toBe(repeatedIds.length);
  });

  it('carries the previous title forward unless a new one is given', () => {
    const titled = setWorkoutTitle(finishedWorkout(), 'Squat day', testContext());

    expect(repeatWorkout(titled, testContext(), { localDate: ON_DAY }).title).toBe('Squat day');
    expect(
      repeatWorkout(titled, testContext(), { localDate: ON_DAY, title: 'Squat day 2' }).title,
    ).toBe('Squat day 2');
  });
});

describe('findWorkoutExercise', () => {
  it('finds an exercise and answers null for an unknown one', () => {
    const session = twoSetWorkout();
    const id = session.exercises[0]?.id ?? '';

    expect(findWorkoutExercise(session, id)?.displayName).toBe('Squat');
    expect(findWorkoutExercise(session, 'nothing')).toBeNull();
  });
});
