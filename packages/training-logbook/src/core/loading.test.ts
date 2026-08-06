// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Three claims, in the order section 8.6 makes them.
 *
 * That the plates under a row are the plates for the weight on that row -- the
 * performed one where there is one, never a rounded one. That a weight the rack
 * cannot build says so and names what it can build either side, rather than
 * quietly becoming a weight it can. And that a stored plan's plates win over a
 * fresh search, which is section 8.4's freeze seen from the screen: the totals
 * would look right either way, and only the plates would have silently become
 * another gym's answer.
 *
 * The plate arithmetic itself is `packages/domain`'s and is tested there. What is
 * tested here is which loading a row gets and what the row above it makes of it.
 */

import { describe, expect, it } from 'vitest';

import type { EquipmentSnapshot, WarmupSnapshot, WorkoutSession } from '../types.js';

import { ON_DAY, testContext } from './context.fixture.js';
import { DEFAULT_EQUIPMENT } from './equipment.js';
import { sessionLoadings, type SetLoading } from './loading.js';
import {
  addExercise,
  addSet,
  attachWarmup,
  createWorkout,
  markSetIncomplete,
  performance,
  recordSet,
  skipSet,
  type PlannedSet,
  type SessionContext,
} from './session.js';
import { applyWarmup, warmupChange, type WarmupInput } from './warmup.js';

/** A barbell total in pounds, planned and not yet done. */
function at(pounds: number): PlannedSet {
  return {
    kind: 'working',
    performance: performance({ kind: 'implement', weight: { amount: pounds, unit: 'lb' } }, 5),
  };
}

/** A rack that is nobody's default, so nothing can pass by resembling one. */
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

/** One barbell exercise whose sets are the weights given, in order. */
function aWorkout(context: SessionContext, ...plan: readonly PlannedSet[]): WorkoutSession {
  const draft = createWorkout(context, { localDate: ON_DAY });
  return addExercise(draft, context, {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan,
  });
}

function onlyExercise(session: WorkoutSession) {
  const exercise = session.exercises[0];
  if (exercise === undefined) throw new Error('the fixture lost its exercise');
  return exercise;
}

/** Every set's answer, in the order the card renders them. */
function answers(
  session: WorkoutSession,
  equipment: EquipmentSnapshot = DEFAULT_EQUIPMENT,
): readonly SetLoading[] {
  const loadings = sessionLoadings(session, equipment);
  return session.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => {
      const answer = loadings.get(set.id);
      if (answer === undefined) throw new Error(`no answer for ${set.id}`);
      return answer;
    }),
  );
}

/** One set's answer, for a session built with a single set. */
function only(session: WorkoutSession, equipment?: EquipmentSnapshot): SetLoading {
  const [first, ...rest] = answers(session, equipment);
  if (first === undefined || rest.length > 0) throw new Error('expected exactly one set');
  return first;
}

function perSide(answer: SetLoading): readonly number[] {
  if (answer.kind !== 'loaded') throw new Error(`expected plates, got ${answer.kind}`);
  return answer.loading.perSide;
}

/** What the row says to move, as two lists, or `null` for "nothing". */
function change(answer: SetLoading): readonly (readonly number[])[] | null {
  if (answer.kind !== 'loaded') throw new Error(`expected plates, got ${answer.kind}`);
  return answer.change === null ? null : [answer.change.removed, answer.change.added];
}

describe('which sets get plates at all', () => {
  it('answers for every set in the session, so a missing key is a caller mistake', () => {
    const context = testContext();
    const session = aWorkout(context, at(135), at(225), at(225));
    expect(sessionLoadings(session, DEFAULT_EQUIPMENT).size).toBe(3);
  });

  it('draws nothing for an exercise that is not loaded with plates', () => {
    // The rack has nothing to say about a chin-up, and a bar drawn beside one
    // would be the card inventing equipment the lifter did not use.
    const context = testContext();
    const draft = createWorkout(context, { localDate: ON_DAY });
    const session = addExercise(draft, context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-up',
      loading: 'bodyweight',
      plan: [{ kind: 'working', performance: performance({ kind: 'none' }, 8) }],
    });
    expect(only(session)).toEqual({ kind: 'none' });
  });

  it('draws nothing for a weight that is not on a bar', () => {
    // The one a missing-weight fixture cannot prove. A cable stack at 100 lb is a
    // number and a load, and everything a barbell set needs to reach the search --
    // so the only thing keeping plates off a lat pulldown is the loading model,
    // and a card drawing two 25s under one would be inventing the room.
    const context = testContext();
    const draft = createWorkout(context, { localDate: ON_DAY });
    const session = addExercise(draft, context, {
      exerciseId: 'lat-pulldown',
      displayName: 'Lat Pulldown',
      loading: 'machine-or-cable-weight',
      plan: [
        {
          kind: 'accessory',
          performance: performance({ kind: 'implement', weight: { amount: 100, unit: 'lb' } }, 10),
        },
      ],
    });
    expect(only(session)).toEqual({ kind: 'none' });
  });

  it('draws nothing for a barbell set with no weight on it yet', () => {
    const context = testContext();
    const session = aWorkout(context, {
      kind: 'working',
      performance: performance({ kind: 'none' }, 5),
    });
    expect(only(session)).toEqual({ kind: 'none' });
  });
});

describe('splitting a total into plates', () => {
  it('puts the bar and collars under the plates rather than beside them', () => {
    const context = testContext();
    const answer = only(aWorkout(context, at(225)));
    expect(perSide(answer)).toEqual([45, 45]);
    if (answer.kind !== 'loaded') throw new Error('expected plates');
    expect(answer.loading.total).toBe(225);
  });

  it('reports a weight the rack cannot build instead of rounding it away', () => {
    // 90.55 a side is not a multiple of the smallest plate in the default
    // inventory. Section 8.6: show the nearest, never move the number.
    const context = testContext();
    const answer = only(aWorkout(context, at(226.1)));
    if (answer.kind !== 'not-loadable') throw new Error('expected an unbuildable weight');
    expect(answer.below?.total).toBe(226);
    expect(answer.above?.total).toBe(226.5);
  });

  it('names no neighbour above when the plates run out', () => {
    const context = testContext();
    const rack: EquipmentSnapshot = {
      ...aGym(),
      plates: [{ weight: 25, pairs: 1, fullDiameter: true }],
    };
    const session = aWorkout(context, {
      kind: 'working',
      performance: performance({ kind: 'implement', weight: { amount: 100, unit: 'kg' } }, 5),
    });
    const answer = only(session, rack);
    if (answer.kind !== 'not-loadable') throw new Error('expected an unbuildable weight');
    expect(answer.below?.total).toBe(75);
    expect(answer.above).toBeNull();
  });

  it('names no neighbour below a weight lighter than the bar', () => {
    // A typo, usually. The card says the rack cannot make it and shows the bar
    // as the lightest thing it can, rather than starting the lifter at 45.
    const context = testContext();
    const answer = only(aWorkout(context, at(10)));
    if (answer.kind !== 'not-loadable') throw new Error('expected an unbuildable weight');
    expect(answer.below).toBeNull();
    expect(answer.above?.total).toBe(45);
  });

  it('converts a pound entry onto a kilogram rack rather than refusing it', () => {
    // Section 11.4 expects mixed units. 45 lb is 20.41 kg, which this rack cannot
    // build -- and saying so is the honest answer, not an error.
    const context = testContext();
    const answer = only(aWorkout(context, at(45)), aGym());
    if (answer.kind !== 'not-loadable') throw new Error('expected an unbuildable weight');
    expect(answer.below).toBeNull();
    expect(answer.above?.total).toBe(25);
  });
});

describe('what to move between two rows', () => {
  it('says nothing has to move for a row that is the bar on its own', () => {
    const context = testContext();
    const session = aWorkout(context, {
      kind: 'warmup',
      performance: performance({ kind: 'implement', weight: { amount: 45, unit: 'lb' } }, 5),
    });
    expect(change(only(session))).toBeNull();
  });

  it('counts the first loaded row from the empty bar', () => {
    const context = testContext();
    expect(change(only(aWorkout(context, at(225))))).toEqual([[], [45, 45]]);
  });

  it('says only what changed between two rows', () => {
    const context = testContext();
    const [, second] = answers(aWorkout(context, at(135), at(225)));
    if (second === undefined) throw new Error('expected a second row');
    expect(change(second)).toEqual([[], [45]]);
  });

  it('says what comes off as well as what goes on', () => {
    const context = testContext();
    const [, second] = answers(aWorkout(context, at(140), at(175)));
    if (second === undefined) throw new Error('expected a second row');
    expect(change(second)).toEqual([[2.5], [10, 10]]);
  });

  it('repeats nothing between two rows at the same weight', () => {
    const context = testContext();
    const [, second] = answers(aWorkout(context, at(225), at(225)));
    if (second === undefined) throw new Error('expected a second row');
    expect(change(second)).toBeNull();
  });

  it('starts each exercise again from the bar', () => {
    // Two exercises could share a bar and could as easily be at opposite ends of
    // the gym. Carrying the chain across would tell somebody to take plates off a
    // bar they have not walked to.
    const context = testContext();
    const first = aWorkout(context, at(225));
    const session = addExercise(first, context, {
      exerciseId: 'bench-press',
      displayName: 'Bench Press',
      loading: 'barbell-total-weight',
      plan: [at(135)],
    });
    const [, bench] = answers(session);
    if (bench === undefined) throw new Error('expected a second exercise');
    expect(change(bench)).toEqual([[], [45]]);
  });

  it('follows the weight performed rather than the weight planned', () => {
    const context = testContext();
    const planned = aWorkout(context, at(225));
    const set = onlyExercise(planned).sets[0];
    if (set === undefined) throw new Error('the fixture lost its set');
    const done = recordSet(
      planned,
      set.id,
      performance({ kind: 'implement', weight: { amount: 135, unit: 'lb' } }, 5),
      context,
    );
    expect(perSide(only(done))).toEqual([45]);
  });
});

describe('a row the lifter did not do', () => {
  it('leaves a skipped row out of what the next row says to move', () => {
    // The plates on a skipped row never went on the bar, so counting from it
    // would tell somebody to take off a plate that is not there -- an instruction
    // they can follow and be wrong about.
    const context = testContext();
    const planned = aWorkout(context, at(135), at(225), at(135));
    const middle = onlyExercise(planned).sets[1];
    if (middle === undefined) throw new Error('the fixture lost its set');
    const [, , third] = answers(skipSet(planned, middle.id, context));
    if (third === undefined) throw new Error('expected a third row');
    expect(change(third)).toBeNull();
  });

  it('still draws the plates for the skipped row itself', () => {
    const context = testContext();
    const planned = aWorkout(context, at(135), at(225));
    const second = onlyExercise(planned).sets[1];
    if (second === undefined) throw new Error('the fixture lost its set');
    const [, answer] = answers(skipSet(planned, second.id, context));
    if (answer === undefined) throw new Error('expected a second row');
    expect(perSide(answer)).toEqual([45, 45]);
  });

  it('keeps a row that was attempted and missed in the chain', () => {
    // Missing a lift means the bar was loaded. The plates are on it either way,
    // and the next row is a difference from where they actually are.
    const context = testContext();
    const planned = aWorkout(context, at(135), at(225), at(225));
    const middle = onlyExercise(planned).sets[1];
    if (middle === undefined) throw new Error('the fixture lost its set');
    const [, , third] = answers(markSetIncomplete(planned, middle.id, null, context));
    if (third === undefined) throw new Error('expected a third row');
    expect(change(third)).toBeNull();
  });
});

describe('a stored plan beats a fresh search', () => {
  /** A squat at 225 with the calculator's ramp written into it. */
  function aRampedWorkout(context: SessionContext, equipment = DEFAULT_EQUIPMENT): WorkoutSession {
    const session = aWorkout(context, at(225));
    const exercise = onlyExercise(session);
    const input: WarmupInput = {
      family: 'squat-press',
      equipment,
      workingWeight: 225,
      workingSets: 1,
      workingReps: 5,
    };
    const result = warmupChange(session, exercise.id, input, context);
    if (result?.ok !== true) throw new Error('the fixture produced no ramp');
    return applyWarmup(session, exercise.id, result.change, context);
  }

  /**
   * The same session with one rung's plates rewritten to an odd but equal split.
   *
   * Odd on purpose: a fresh search would never answer `[15, 15]` for a rung a
   * single 30 makes, so the assertion can only pass if the stored plan was read.
   */
  function withRewrittenRung(session: WorkoutSession, context: SessionContext): WorkoutSession {
    const exercise = onlyExercise(session);
    const snapshot = exercise.warmup;
    if (snapshot === null) throw new Error('the fixture lost its ramp');
    const warmups = snapshot.plan.warmups.map((warmup) =>
      warmup.loading.total === 105
        ? { ...warmup, loading: { total: 105, perSide: [15, 15] } }
        : warmup,
    );
    const rewritten: WarmupSnapshot = {
      ...snapshot,
      plan: { ...snapshot.plan, warmups },
    };
    return attachWarmup(session, exercise.id, rewritten, context);
  }

  it('reads a warm-up rung off the plan that produced it', () => {
    const context = testContext();
    const session = withRewrittenRung(aRampedWorkout(context), context);
    const rung = answers(session).find(
      (answer) => answer.kind === 'loaded' && answer.loading.total === 105,
    );
    if (rung === undefined) throw new Error('the fixture lost its rung');
    expect(perSide(rung)).toEqual([15, 15]);
  });

  it('sets the whole stored table aside when the rack has changed', () => {
    // A snapshot generated against another gym is not stale, it is about a
    // different bar. Reading one rung off it and searching for the next would put
    // two rooms' plates on one card.
    const context = testContext();
    const session = withRewrittenRung(aRampedWorkout(context), context);
    const moved: EquipmentSnapshot = {
      ...DEFAULT_EQUIPMENT,
      barWeight: { amount: 35, unit: 'lb' },
    };
    const rung = answers(session, moved).find(
      (answer) => answer.kind === 'loaded' && answer.loading.total === 105,
    );
    if (rung === undefined) throw new Error('the fixture lost its rung');
    expect(perSide(rung)).toEqual([25, 10]);
  });

  it('does not lend a rung its plates to a weight that merely rounds to it', () => {
    // A total is a key here, and a key that quantised to the pound would hand this
    // set the rung's stored plates -- 15 and 15 for a weight the rack cannot build
    // at all. Quarter-pound plates are why the key is hundredths: 105.4 and 105 are
    // four plate steps apart, not the same row.
    const context = testContext();
    const ramped = withRewrittenRung(aRampedWorkout(context), context);
    const session = addSet(ramped, onlyExercise(ramped).id, at(105.4), context);
    const added = onlyExercise(session).sets.at(-1);
    if (added === undefined) throw new Error('the fixture lost its set');
    const answer = sessionLoadings(session, DEFAULT_EQUIPMENT).get(added.id);
    expect(answer?.kind).toBe('not-loadable');
  });

  it("reads the working set's neighbours off the plan rather than searching again", () => {
    // Same freeze as a rung, and the same reason: a later engine could name a
    // different pair either side of an unbuildable number, and a finished session
    // must keep the pair it was shown. `[90.75]` is one plate no rack sells, so it
    // can only have come off the plan.
    const context = testContext();
    const session = withRewrittenNeighbour(anUnbuildableWorkout(context), context);

    const working = answers(session).at(-1);
    if (working?.kind !== 'not-loadable') {
      throw new Error('expected an unbuildable working set');
    }
    expect(working.below?.total).toBe(226);
    expect(working.above?.perSide).toEqual([90.75]);
  });

  /** A squat at a weight the default rack cannot build, ramp written in. */
  function anUnbuildableWorkout(context: SessionContext): WorkoutSession {
    const session = aWorkout(context, at(226.1));
    const exercise = onlyExercise(session);
    const result = warmupChange(
      session,
      exercise.id,
      {
        family: 'squat-press',
        equipment: DEFAULT_EQUIPMENT,
        workingWeight: 226.1,
        workingSets: 1,
        workingReps: 5,
      },
      context,
    );
    if (result?.ok !== true) throw new Error('the fixture produced no ramp');
    return applyWarmup(session, exercise.id, result.change, context);
  }

  /** The same session with the working set's upper neighbour split impossibly. */
  function withRewrittenNeighbour(
    session: WorkoutSession,
    context: SessionContext,
  ): WorkoutSession {
    const exercise = onlyExercise(session);
    const snapshot = exercise.warmup;
    if (snapshot === null) throw new Error('the fixture lost its ramp');
    const { load } = snapshot.plan.working;
    if (load.kind !== 'not-loadable') throw new Error('the fixture built the working weight');
    const rewritten: WarmupSnapshot = {
      ...snapshot,
      plan: {
        ...snapshot.plan,
        working: {
          ...snapshot.plan.working,
          load: { ...load, above: { total: 226.5, perSide: [90.75] } },
        },
      },
    };
    return attachWarmup(session, exercise.id, rewritten, context);
  }
});
