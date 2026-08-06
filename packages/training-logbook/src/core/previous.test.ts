// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The cross-session read, and the rule that makes it more than a filter: a
 * calendar day is finished before the search is.
 *
 * The weights below are invented and none of them means anything. What every case
 * turns on is which numbers come back and in which order, so they are spaced far
 * enough apart that a wrong set is a wrong number rather than a near miss.
 */

import { describe, expect, it } from 'vitest';

import type { SetLoad, WorkoutSession, WorkoutSet } from '../types.js';

import { AT_LATER, AT_START, ON_DAY, contextSeries } from './context.fixture.js';
import {
  previousPerformanceIn,
  searchPreviousPerformance,
  type PreviousPerformance,
} from './previous.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  markSetIncomplete,
  performance,
  skipSet,
  startWorkout,
  type PlannedSet,
} from './session.js';
import { loadWeight } from './summary.js';

function kilograms(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

function working(amount: number): PlannedSet {
  return { kind: 'working', performance: performance(kilograms(amount), 5) };
}

/** One exercise's plan: what it is, and the sets under it. */
interface Block {
  readonly exerciseId: string;
  readonly sets: readonly PlannedSet[];
}

function allSets(session: WorkoutSession): readonly WorkoutSet[] {
  return session.exercises.flatMap((exercise) => exercise.sets);
}

/** A finished session with every set ticked off exactly as planned. */
function completed(
  blocks: readonly Block[],
  overrides: Partial<WorkoutSession> = {},
): WorkoutSession {
  const at = contextSeries();
  let session = createWorkout(at(AT_START), { localDate: ON_DAY });
  for (const block of blocks) {
    session = addExercise(session, at(AT_START), {
      exerciseId: block.exerciseId,
      displayName: block.exerciseId,
      loading: 'barbell-total-weight',
      plan: block.sets,
    });
  }
  session = startWorkout(session, at(AT_START));
  for (const set of allSets(session)) session = completeSet(session, set.id, at(AT_LATER));
  return { ...finishWorkout(session, 'leave', at(AT_LATER)), ...overrides };
}

/** The weight of each set that came back, in order. */
function amounts(entry: PreviousPerformance | undefined): readonly (number | null)[] {
  return (entry?.sets ?? []).map((set) => loadWeight(set.load)?.amount ?? null);
}

describe('previousPerformanceIn', () => {
  it('reports the performed working sets in the order they were done', () => {
    const session = completed([
      { exerciseId: 'squat', sets: [working(100), working(105), working(110)] },
    ]);
    const found = previousPerformanceIn(session, new Set(['squat']));

    expect(amounts(found.get('squat'))).toEqual([100, 105, 110]);
    expect(found.get('squat')).toMatchObject({ exerciseId: 'squat', localDate: ON_DAY });
  });

  it('contributes nothing from a session that was never completed', () => {
    const session = completed([{ exerciseId: 'squat', sets: [working(100)] }]);

    for (const status of ['draft', 'active', 'discarded'] as const) {
      expect(previousPerformanceIn({ ...session, status }, new Set(['squat'])).size).toBe(0);
    }
  });

  it('leaves out warm-ups, accessories, and every set that was not completed', () => {
    const at = contextSeries();
    let session = createWorkout(at(AT_START), { localDate: ON_DAY });
    session = addExercise(session, at(AT_START), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: [
        { kind: 'warmup', performance: performance(kilograms(60), 5) },
        working(100),
        { kind: 'backoff', performance: performance(kilograms(90), 8) },
        { kind: 'amrap', performance: performance(kilograms(95), 12) },
        { kind: 'accessory', performance: performance(kilograms(50), 10) },
        working(101),
        working(102),
        working(103),
      ],
    });
    session = startWorkout(session, at(AT_START));
    const [warmup, top, backoff, amrap, accessory, skipped, unfinished] = allSets(session).map(
      (set) => set.id,
    );
    for (const id of [warmup, top, backoff, amrap, accessory]) {
      session = completeSet(session, id ?? '', at(AT_LATER));
    }
    session = skipSet(session, skipped ?? '', at(AT_LATER));
    session = markSetIncomplete(
      session,
      unfinished ?? '',
      performance(kilograms(102), 3),
      at(AT_LATER),
    );
    // `leave` rather than `skip`, so the eighth set stays planned and the planned
    // case is exercised alongside the other three.
    const done = finishWorkout(session, 'leave', at(AT_LATER));

    expect(amounts(previousPerformanceIn(done, new Set(['squat'])).get('squat'))).toEqual([
      100, 90, 95,
    ]);
  });

  it('leaves out a completed set that carries no result', () => {
    // Unreachable through this package's own operations, since `completeSet`
    // copies the plan across. A restored backup written by something else can
    // hold one, and it would draw a row with no numbers on it.
    const session = completed([{ exerciseId: 'squat', sets: [working(100)] }]);
    const stripped: WorkoutSession = {
      ...session,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({ ...set, performed: null })),
      })),
    };

    expect(previousPerformanceIn(stripped, new Set(['squat'])).size).toBe(0);
  });

  it('has no entry at all for an exercise that contributed nothing', () => {
    const session = completed([
      { exerciseId: 'squat', sets: [working(100)] },
      {
        exerciseId: 'bench-press',
        sets: [{ kind: 'warmup', performance: performance(kilograms(40), 5) }],
      },
    ]);
    const found = previousPerformanceIn(session, new Set(['squat', 'bench-press']));

    expect(found.has('bench-press')).toBe(false);
    expect([...found.keys()]).toEqual(['squat']);
  });

  it('concatenates an exercise the session lists twice', () => {
    const session = completed([
      { exerciseId: 'squat', sets: [working(100), working(105)] },
      { exerciseId: 'bench-press', sets: [working(80)] },
      { exerciseId: 'squat', sets: [working(85)] },
    ]);

    expect(amounts(previousPerformanceIn(session, new Set(['squat'])).get('squat'))).toEqual([
      100, 105, 85,
    ]);
  });

  it('reads only the exercises that were asked for', () => {
    const session = completed([
      { exerciseId: 'squat', sets: [working(100)] },
      { exerciseId: 'deadlift', sets: [working(180)] },
    ]);

    expect([...previousPerformanceIn(session, new Set(['squat'])).keys()]).toEqual(['squat']);
  });
});

describe('searchPreviousPerformance', () => {
  const WANTED = ['squat', 'bench-press'];

  it('asks for more while an exercise is still unanswered', () => {
    const search = searchPreviousPerformance(WANTED);

    expect(search.consider(completed([{ exerciseId: 'squat', sets: [working(100)] }]))).toBe(true);
    expect([...search.found().keys()]).toEqual(['squat']);
  });

  it('keeps the newest answer and lets no older session overwrite it', () => {
    const search = searchPreviousPerformance(['squat']);
    search.consider(
      completed([{ exerciseId: 'squat', sets: [working(110)] }], { localDate: '2026-03-10' }),
    );
    search.consider(
      completed([{ exerciseId: 'squat', sets: [working(100)] }], { localDate: '2026-03-03' }),
    );

    expect(amounts(search.found().get('squat'))).toEqual([110]);
    expect(search.found().get('squat')?.localDate).toBe('2026-03-10');
  });

  it('holds its answer when the history arrives out of order', () => {
    // The guarantee is one coherent day, not the best day available. A caller
    // that feeds an older session first gets an older answer -- what it cannot
    // get is a card built from two days at once.
    const search = searchPreviousPerformance(['squat']);
    search.consider(
      completed([{ exerciseId: 'squat', sets: [working(100)] }], { localDate: '2026-03-03' }),
    );
    search.consider(
      completed([{ exerciseId: 'squat', sets: [working(120)] }], { localDate: '2026-03-10' }),
    );

    expect(amounts(search.found().get('squat'))).toEqual([100]);
  });

  it('prefers the session touched most recently when two share a day', () => {
    const morning = completed([{ exerciseId: 'squat', sets: [working(100)] }], {
      updatedAt: AT_START,
    });
    const evening = completed([{ exerciseId: 'squat', sets: [working(140)] }], {
      updatedAt: AT_LATER,
    });
    const search = searchPreviousPerformance(['squat']);

    // Still true after the answer arrives: the day it came from is not read yet.
    expect(search.consider(morning)).toBe(true);
    expect(search.consider(evening)).toBe(true);
    expect(amounts(search.found().get('squat'))).toEqual([140]);
  });

  it('does not let the earlier of two sessions on a day take the answer back', () => {
    const morning = completed([{ exerciseId: 'squat', sets: [working(100)] }], {
      updatedAt: AT_START,
    });
    const evening = completed([{ exerciseId: 'squat', sets: [working(140)] }], {
      updatedAt: AT_LATER,
    });
    const search = searchPreviousPerformance(['squat']);
    search.consider(evening);
    search.consider(morning);

    expect(amounts(search.found().get('squat'))).toEqual([140]);
  });

  it('stops once everything is answered and the day is done', () => {
    const search = searchPreviousPerformance(WANTED);

    expect(
      search.consider(
        completed([{ exerciseId: 'squat', sets: [working(110)] }], { localDate: '2026-03-10' }),
      ),
    ).toBe(true);
    expect(
      search.consider(
        completed([{ exerciseId: 'bench-press', sets: [working(80)] }], {
          localDate: '2026-03-08',
        }),
      ),
    ).toBe(true);
    expect(
      search.consider(
        completed([{ exerciseId: 'squat', sets: [working(90)] }], {
          localDate: '2026-03-08',
          updatedAt: AT_LATER,
        }),
      ),
    ).toBe(true);
    expect(
      search.consider(
        completed([{ exerciseId: 'squat', sets: [working(70)] }], { localDate: '2026-03-01' }),
      ),
    ).toBe(false);
    // The third session shares a day with the answer that finished the search and
    // not with the squat answer, which came from a later day and stands.
    expect(amounts(search.found().get('squat'))).toEqual([110]);
  });

  it('stops immediately when nothing was asked for', () => {
    const search = searchPreviousPerformance([]);

    expect(search.consider(completed([{ exerciseId: 'squat', sets: [working(100)] }]))).toBe(false);
    expect(search.found().size).toBe(0);
  });

  it('answers with a snapshot rather than a view that goes on changing', () => {
    const search = searchPreviousPerformance(WANTED);
    search.consider(completed([{ exerciseId: 'squat', sets: [working(100)] }]));
    const early = search.found();
    search.consider(
      completed([{ exerciseId: 'bench-press', sets: [working(80)] }], { localDate: '2026-03-08' }),
    );

    expect([...early.keys()]).toEqual(['squat']);
  });
});
