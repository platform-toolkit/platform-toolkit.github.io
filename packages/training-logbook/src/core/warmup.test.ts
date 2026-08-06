// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Two claims, and the second one is the reason this file is long.
 *
 * The first is that the ramp is the calculator's ramp -- the numbers below are
 * not restated rules, they are what `planWarmup` answers for the default rack,
 * and a test that pinned its own arithmetic instead would pass through exactly
 * the fork section 8.1 forbids.
 *
 * The second is section 8.5: a warm-up regenerated mid-session must never
 * silently alter a set somebody performed. Most of what follows is that one
 * sentence taken apart -- what survives, what goes, what order it ends up in,
 * and what a screen is told before any of it happens.
 */

import {
  WARMUP_ENGINE_VERSION,
  WARMUP_RULESET_VERSION,
  type WeightUnit,
} from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type {
  EquipmentSnapshot,
  ExerciseOption,
  SetPerformance,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { findExercise } from './catalog.js';
import { AT_LATER, AT_START, ON_DAY, testContext } from './context.fixture.js';
import { DEFAULT_EQUIPMENT } from './equipment.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  performance,
  planSet,
  recordSet,
  skipSet,
  type NewExerciseOptions,
  type PlannedSet,
  type SessionContext,
} from './session.js';
import {
  applyWarmup,
  clearWarmup,
  rampExercise,
  rampLastExercise,
  warmupChange,
  warmupIsCurrent,
  warmupMatchesEquipment,
  warmupSets,
  workingPrescription,
  type WarmupChange,
  type WarmupInput,
} from './warmup.js';

/**
 * A squat at 225 on the rack the tool opens with.
 *
 * Round enough that the ramp below reads at a glance, and heavy enough that the
 * engine produces every stage: two bar-only sets, a first, two middles and a
 * final. A lighter number would collapse the ramp and quietly stop testing the
 * ordering.
 */
function squatInput(overrides: Partial<WarmupInput> = {}): WarmupInput {
  return {
    family: 'squat-press',
    equipment: DEFAULT_EQUIPMENT,
    workingWeight: 225,
    workingSets: 3,
    workingReps: 5,
    ...overrides,
  };
}

/** What `planWarmup` answers for {@link squatInput}, as totals in pounds. */
const RAMP = [45, 45, 105, 145, 175, 205];

/**
 * {@link squatInput} with the family taken off.
 *
 * Rebuilt field by field rather than spread and deleted, because working out the
 * family from the option is the whole of what `rampLastExercise` adds -- a caller's
 * own family reaching the engine would let the derivation break unnoticed.
 */
function rampInput(overrides: Partial<WarmupInput> = {}): Omit<WarmupInput, 'family'> {
  const { equipment, workingWeight, workingSets, workingReps } = squatInput(overrides);
  return { equipment, workingWeight, workingSets, workingReps };
}

function option(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such exercise: ${id}`);
  return found;
}

const SQUAT = option('squat');
const DEADLIFT = option('deadlift');
const CHIN_UP = option('chin-up');

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

/** A draft holding one squat of two planned working sets, and nothing else. */
function aSquatWorkout(context: SessionContext): WorkoutSession {
  const draft = createWorkout(context, { localDate: ON_DAY });
  return addExercise(draft, context, {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: [
      { kind: 'working', performance: workingSet() },
      { kind: 'working', performance: workingSet() },
    ],
  });
}

function workingSet() {
  return performance({ kind: 'implement', weight: { amount: 225, unit: 'lb' } }, 5);
}

/** The only exercise in the session. */
function onlyExercise(session: WorkoutSession) {
  const exercise = session.exercises[0];
  if (exercise === undefined) throw new Error('the fixture lost its exercise');
  return exercise;
}

/** The exercise at a position, for the cases where there is more than one. */
function exerciseAt(session: WorkoutSession, index: number): WorkoutExercise {
  const exercise = session.exercises[index];
  if (exercise === undefined) throw new Error('the fixture lost its exercise');
  return exercise;
}

/** The warm-up rows of one named exercise, in the order they are on the card. */
function warmupsOf(session: WorkoutSession, exerciseId: string): readonly WorkoutSet[] {
  const exercise = session.exercises.find((candidate) => candidate.id === exerciseId);
  if (exercise === undefined) throw new Error('the fixture lost its exercise');
  return exercise.sets.filter((set) => set.kind === 'warmup');
}

/** A draft holding exactly the exercise described, and nothing else. */
function anExerciseOf(context: SessionContext, options: NewExerciseOptions): WorkoutExercise {
  return onlyExercise(addExercise(createWorkout(context, { localDate: ON_DAY }), context, options));
}

/** A squat carrying exactly the sets described. */
function aSquatOf(context: SessionContext, plan: readonly PlannedSet[]): WorkoutExercise {
  return anExerciseOf(context, {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan,
  });
}

/**
 * One working set on a bar.
 *
 * Every weight handed to this in the cases below is an invented fixture number --
 * root section 5.1 -- picked to be unequal and to read at a glance, and none of it
 * is anybody's published figure.
 */
function workingAt(amount: number, unit: WeightUnit, reps: number | null): PlannedSet {
  return {
    kind: 'working',
    performance: performance({ kind: 'implement', weight: { amount, unit } }, reps),
  };
}

/** The change for {@link squatInput}, unwrapped, or a failure that says why. */
function changeFor(
  session: WorkoutSession,
  context: SessionContext,
  input: WarmupInput = squatInput(),
): WarmupChange {
  const exercise = onlyExercise(session);
  const result = warmupChange(session, exercise.id, input, context);
  if (result === null) throw new Error('the fixture lost its exercise');
  if (!result.ok) throw new Error(`no plan: ${result.problems.map((p) => p.code).join(', ')}`);
  return result.change;
}

/** A session with the generated ramp written into it. */
function withRamp(session: WorkoutSession, context: SessionContext): WorkoutSession {
  return applyWarmup(session, onlyExercise(session).id, changeFor(session, context), context);
}

function totals(sets: readonly WorkoutSet[]): readonly number[] {
  return sets.map((set) => {
    const load = set.planned?.load ?? set.performed?.load;
    return load !== undefined && load.kind !== 'none' ? load.weight.amount : Number.NaN;
  });
}

describe('warmupSets', () => {
  it('expands the engine’s repeat count into sets a lifter can tick off', () => {
    // The engine collapses the two bar-only sets into one entry with a count of
    // two, which is right for a calculator and wrong for a logbook: somebody who
    // has done the first and not the second has a fact to record, and a row with
    // a multiplier on it has nowhere to put it. Section 8.4.
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.snapshot.plan.warmups).toHaveLength(5);
    expect(change.sets).toHaveLength(6);
  });

  it('is the calculator’s ramp and not one of its own', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.sets.map((set) => weightOf(set.performance))).toEqual(RAMP);
  });

  it('writes every row in the plate unit rather than the display unit', () => {
    // This total is about to be built out of the plates printed beside it.
    // Converting it would put a number on the card that its own per-side list
    // does not add up to.
    const context = testContext();
    const change = changeFor(
      aSquatWorkout(context),
      context,
      squatInput({ equipment: aGym(), workingWeight: 100 }),
    );
    expect(change.sets.every((set) => unitOf(set.performance) === 'kg')).toBe(true);
  });

  it('leaves effort alone, because a generated set has none', () => {
    // Section 7.10: effort is entered. A ramp arriving with an RPE on it would be
    // this package deciding how hard a warm-up ought to feel.
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.sets.every((set) => set.performance.effort === null)).toBe(true);
  });

  it('marks every row as a warm-up', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.sets.every((set) => set.kind === 'warmup')).toBe(true);
  });

  it('can be read off a stored plan without regenerating it', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(warmupSets(change.snapshot.plan, change.snapshot.equipment)).toEqual(change.sets);
  });
});

describe('warmupChange', () => {
  it('answers nothing for an exercise that is no longer there', () => {
    const context = testContext();
    expect(warmupChange(aSquatWorkout(context), 'id-gone', squatInput(), context)).toBe(null);
  });

  it('hands back the engine’s problems rather than inventing a plan', () => {
    const context = testContext();
    const session = aSquatWorkout(context);
    const result = warmupChange(
      session,
      onlyExercise(session).id,
      squatInput({ workingWeight: 0 }),
      context,
    );
    expect(result?.ok).toBe(false);
    expect(result?.ok === false && result.problems.map((problem) => problem.code)).toEqual([
      'working-weight-not-positive',
    ]);
  });

  it('freezes the engine and the ruleset that produced the plan', () => {
    // Section 8.4's reason, in one assertion: a percentage changed next year must
    // alter what the calculator suggests tomorrow and alter nothing already done.
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.snapshot.engineVersion).toBe(WARMUP_ENGINE_VERSION);
    expect(change.snapshot.rulesetVersion).toBe(WARMUP_RULESET_VERSION);
    expect(change.snapshot.generatedAt).toBe(AT_START);
  });

  it('freezes the rack it was generated against', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context, squatInput({ equipment: aGym() }));
    expect(change.snapshot.equipment).toEqual(aGym());
    expect(change.snapshot.plan.setup.bar).toEqual({ amount: 20, unit: 'kg' });
    expect(change.snapshot.plan.setup.collars).toEqual({ amount: 5, unit: 'kg' });
  });

  it('keeps the working prescription exactly as it was entered', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context, squatInput({ workingWeight: 227 }));
    expect(change.snapshot.plan.working.total).toBe(227);
    expect(change.snapshot.plan.working.sets).toBe(3);
    expect(change.snapshot.plan.working.reps).toBe(5);
  });

  it('reports a weight the rack cannot make instead of rounding it away', () => {
    // Section 8.6's last clause, seen from the other end: the tool may say what it
    // could load either side of the number, and may not quietly replace it. A
    // rounded working weight would propagate into the performed record as though
    // the lifter had chosen it.
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context, squatInput({ workingWeight: 226.1 }));
    expect(change.snapshot.plan.working.total).toBe(226.1);
    expect(change.snapshot.plan.working.load.kind).toBe('not-loadable');
  });

  it('writes nothing and spends no identifiers', () => {
    // The preview is what a confirmation dialog reads, and a lifter who opens one
    // and cancels must leave no trace. Identifiers are the trace that would be
    // hardest to see: the next set added would be numbered as though six sets had
    // been created and thrown away.
    const context = testContext();
    const session = aSquatWorkout(context);
    changeFor(session, context);
    expect(context.nextId()).toBe('id-5');
    expect(session).toEqual(aSquatWorkout(testContext()));
  });

  it('has nothing to preserve or replace on an exercise with no warm-up', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(change.preserved).toEqual([]);
    expect(change.replaced).toEqual([]);
    expect(change.changesPlan).toBe(true);
  });

  it('marks untouched warm-up sets for replacement', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const change = changeFor(ramped, context, squatInput({ workingWeight: 315 }));
    expect(change.replaced).toHaveLength(6);
    expect(change.preserved).toEqual([]);
  });

  it('preserves a warm-up set that was done, skipped, or half-done', () => {
    // Three statuses, one rule. Section 8.5 says preserve completed sets as
    // performed history, and a skipped set is a decision the lifter made -- a
    // recalculation that swept it away would be answering for them.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const warmups = onlyExercise(ramped).sets.filter((set) => set.kind === 'warmup');
    const [first, second, third] = warmups;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('the fixture lost its ramp');
    }
    const done = skipSet(
      recordSet(
        completeSet(ramped, first.id, context),
        second.id,
        performance(first.planned?.load ?? { kind: 'none' }, 3),
        context,
      ),
      third.id,
      context,
    );
    const change = changeFor(done, context, squatInput({ workingWeight: 315 }));
    expect(change.preserved.map((set) => set.id)).toEqual([first.id, second.id, third.id]);
    expect(change.replaced).toHaveLength(3);
  });

  it('says nothing changed when only the working sets did', () => {
    // Neither the set count nor the rep count reaches the ramp -- they land in the
    // working prescription. A tool that warned "6 warm-up sets will be replaced"
    // before replacing six sets with the same six would teach lifters to dismiss
    // the warning that matters.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const change = changeFor(ramped, context, squatInput({ workingSets: 5, workingReps: 3 }));
    expect(change.replaced).toHaveLength(6);
    expect(change.changesPlan).toBe(false);
    expect(change.snapshot.plan.working.sets).toBe(5);
  });

  it('says the plan changed when the weight did', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    expect(changeFor(ramped, context, squatInput({ workingWeight: 315 })).changesPlan).toBe(true);
  });

  it('says the plan changed when the rack did', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    expect(changeFor(ramped, context, squatInput({ equipment: aGym() })).changesPlan).toBe(true);
  });

  it('says the plan changed when the reps on the card no longer match it', () => {
    // A lifter who retyped a warm-up's reps and then asked for a fresh ramp is
    // about to lose that edit, and the weights alone cannot tell them so. Reps are
    // half of what a warm-up row says; comparing only the loads would make this
    // the one recalculation that overwrites something deliberate without a word.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const first = onlyExercise(ramped).sets[0];
    const planned = first?.planned;
    if (first === undefined || planned == null) throw new Error('the fixture lost its ramp');
    const edited = planSet(ramped, first.id, { ...planned, repetitions: 8 }, context);
    expect(changeFor(edited, context).changesPlan).toBe(true);
  });
});

describe('applyWarmup', () => {
  it('puts the ramp above the working sets', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const sets = onlyExercise(ramped).sets;
    expect(sets.map((set) => set.kind)).toEqual([
      'warmup',
      'warmup',
      'warmup',
      'warmup',
      'warmup',
      'warmup',
      'working',
      'working',
    ]);
    expect(totals(sets)).toEqual([...RAMP, 225, 225]);
  });

  it('attaches the snapshot to the exercise', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    expect(onlyExercise(ramped).warmup?.plan.family).toBe('squat-press');
  });

  it('gives every generated set its own identity', () => {
    // Section 11.3. Six rows sharing an identifier is six rows that tick off
    // together, and the first tap would look like the tool completing the ramp.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const ids = onlyExercise(ramped).sets.map((set) => set.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a performed warm-up set exactly as it was performed', () => {
    // The sentence section 8.5 ends on: never silently alter a completed set.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const first = onlyExercise(ramped).sets[0];
    if (first === undefined) throw new Error('the fixture lost its ramp');
    const done = completeSet(ramped, first.id, context);
    const before = onlyExercise(done).sets[0];

    const later = testContext(AT_LATER);
    const after = applyWarmup(
      done,
      onlyExercise(done).id,
      changeFor(done, later, squatInput({ workingWeight: 315 })),
      later,
    );
    expect(onlyExercise(after).sets[0]).toEqual(before);
  });

  it('puts a regenerated ramp after the sets already done', () => {
    // Read down the card in the order the lifter will walk it: what they did,
    // then the new ladder, then their working sets.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const first = onlyExercise(ramped).sets[0];
    if (first === undefined) throw new Error('the fixture lost its ramp');
    const done = completeSet(ramped, first.id, context);

    const later = testContext(AT_LATER);
    const change = changeFor(done, later, squatInput({ workingWeight: 135 }));
    const after = applyWarmup(done, onlyExercise(done).id, change, later);
    const sets = onlyExercise(after).sets;
    expect(sets[0]?.id).toBe(first.id);
    expect(sets).toHaveLength(1 + change.sets.length + 2);
    expect(sets.slice(0, -2).every((set) => set.kind === 'warmup')).toBe(true);
    expect(sets.slice(-2).every((set) => set.kind === 'working')).toBe(true);
  });

  it('starts the new ramp from the bar even where the lifter is past it', () => {
    // Trimming it to "what you still need" is the tool deciding how somebody
    // should warm up from a weight change it knows nothing about. The lifter skips
    // the rungs they have done; the record keeps both facts.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const third = onlyExercise(ramped).sets[2];
    if (third === undefined) throw new Error('the fixture lost its ramp');
    const done = completeSet(ramped, third.id, context);

    const later = testContext(AT_LATER);
    const after = applyWarmup(
      done,
      onlyExercise(done).id,
      changeFor(done, later, squatInput({ workingWeight: 315 })),
      later,
    );
    const fresh = onlyExercise(after).sets.filter((set) => set.status === 'planned');
    expect(totals(fresh)[0]).toBe(45);
  });

  it('leaves another exercise’s sets alone', () => {
    const context = testContext();
    const session = addExercise(aSquatWorkout(context), context, {
      exerciseId: 'bench-press',
      displayName: 'Bench Press',
      loading: 'barbell-total-weight',
      plan: [{ kind: 'working', performance: workingSet() }],
    });
    const after = applyWarmup(
      session,
      onlyExercise(session).id,
      changeFor(session, context),
      context,
    );
    expect(after.exercises[1]?.sets).toEqual(session.exercises[1]?.sets);
    expect(after.exercises[1]?.warmup).toBe(null);
  });

  it('moves the workout’s own timestamp', () => {
    const context = testContext();
    const session = aSquatWorkout(context);
    const later = testContext(AT_LATER);
    const after = applyWarmup(session, onlyExercise(session).id, changeFor(session, later), later);
    expect(after.updatedAt).toBe(AT_LATER);
  });
});

describe('clearWarmup', () => {
  it('drops the snapshot and the rows nobody performed', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const cleared = clearWarmup(ramped, onlyExercise(ramped).id, context);
    expect(onlyExercise(cleared).warmup).toBe(null);
    expect(onlyExercise(cleared).sets.map((set) => set.kind)).toEqual(['working', 'working']);
  });

  it('keeps a warm-up set that was performed', () => {
    // The snapshot is a claim about how a ramp was generated; the sets are a
    // record of what somebody lifted. Retracting the first does not undo the
    // second.
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    const first = onlyExercise(ramped).sets[0];
    if (first === undefined) throw new Error('the fixture lost its ramp');
    const done = completeSet(ramped, first.id, context);
    const cleared = clearWarmup(done, onlyExercise(done).id, context);
    expect(onlyExercise(cleared).sets.map((set) => set.id)).toEqual([
      first.id,
      ...onlyExercise(done)
        .sets.filter((set) => set.kind === 'working')
        .map((set) => set.id),
    ]);
  });

  it('leaves a session it cannot find the exercise in exactly as it was', () => {
    const context = testContext();
    const ramped = withRamp(aSquatWorkout(context), context);
    expect(clearWarmup(ramped, 'id-gone', context)).toBe(ramped);
  });
});

describe('rampLastExercise', () => {
  it('writes the ramp above the exercise it was asked about', () => {
    const context = testContext();
    const session = aSquatWorkout(context);
    const outcome = rampLastExercise(session, SQUAT, rampInput(), context);

    expect(outcome.ok).toBe(true);
    expect(totals(onlyExercise(outcome.session).sets)).toEqual([...RAMP, 225, 225]);
    expect(onlyExercise(outcome.session).warmup?.plan.family).toBe('squat-press');
  });

  it('ramps the exercise just added and not the first one', () => {
    // `addExercise` appends and mints the identifier itself, so the lift is read
    // back rather than named. Reading back the wrong one would put a deadlift ramp
    // under the squat that was already there, on the lift the lifter has finished.
    const context = testContext();
    const session = addExercise(aSquatWorkout(context), context, {
      exerciseId: 'deadlift',
      displayName: 'Deadlift',
      loading: 'barbell-total-weight',
      plan: [{ kind: 'working', performance: workingSet() }],
    });
    const outcome = rampLastExercise(session, DEADLIFT, rampInput(), context);

    expect(outcome.session.exercises[0]?.warmup).toBe(null);
    expect(outcome.session.exercises[1]?.warmup?.plan.family).toBe('deadlift');
  });

  it('has nothing to say about a movement with no ramp', () => {
    // Ordinary, expected and silent: somebody who planned a squat and a chin-up did
    // not ask for a chin-up ramp and must not be told one was skipped.
    const context = testContext();
    const session = addExercise(aSquatWorkout(context), context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'working', performance: performance({ kind: 'none' }, 8) }],
    });
    const outcome = rampLastExercise(session, CHIN_UP, rampInput(), context);

    expect(outcome).toEqual({ ok: false, session, reason: 'no-ramp' });
    expect(outcome.session).toBe(session);
  });

  it('answers the same way for a session with nothing in it', () => {
    // Grouped with the no-family answer rather than given a third reason. Both mean
    // there is nothing to ramp, and a caller that got here with an empty session has
    // a bug the name of a refusal code would not help with.
    const context = testContext();
    const empty = createWorkout(context, { localDate: ON_DAY });
    const outcome = rampLastExercise(empty, SQUAT, rampInput(), context);

    expect(outcome).toEqual({ ok: false, session: empty, reason: 'no-ramp' });
  });

  it('separates a refusal by the engine from a lift that has no ramp', () => {
    // The one a screen names, because something the lifter typed is why. The lift
    // still keeps its working sets -- refusing those would lose the session over a
    // warm-up.
    const context = testContext();
    const session = aSquatWorkout(context);
    const outcome = rampLastExercise(session, SQUAT, rampInput({ workingWeight: 0 }), context);

    expect(outcome).toEqual({ ok: false, session, reason: 'refused' });
    expect(outcome.session).toBe(session);
  });
});

describe('rampExercise', () => {
  /** A squat and then a deadlift, so that the squat is not the last lift. */
  function twoLifts(context: SessionContext): WorkoutSession {
    return addExercise(aSquatWorkout(context), context, {
      exerciseId: 'deadlift',
      displayName: 'Deadlift',
      loading: 'barbell-total-weight',
      plan: [{ kind: 'working', performance: workingSet() }],
    });
  }

  it('ramps a lift in the middle of a session', () => {
    // The case the tail-reading form structurally cannot reach, and the whole
    // reason this one exists. A repeated session arrives with every exercise in it
    // already, so rebuilding the ladder the repeat dropped means naming a lift --
    // and after the first of them, none is the last.
    const context = testContext();
    const session = twoLifts(context);
    const outcome = rampExercise(session, exerciseAt(session, 0).id, SQUAT, rampInput(), context);

    expect(outcome.ok).toBe(true);
    expect(totals(exerciseAt(outcome.session, 0).sets)).toEqual([...RAMP, 225, 225]);
    expect(exerciseAt(outcome.session, 0).warmup?.plan.family).toBe('squat-press');
    expect(exerciseAt(outcome.session, 1).sets).toEqual(exerciseAt(session, 1).sets);
    expect(exerciseAt(outcome.session, 1).warmup).toBe(null);
  });

  it('answers the last lift exactly the way rampLastExercise does', () => {
    // The two must not be able to drift, so the tail form is now a lookup and this
    // call and nothing else. Both contexts are fresh, so the identifiers they mint
    // line up and the comparison is about the ramp rather than about counting.
    const session = twoLifts(testContext());
    const last = exerciseAt(session, 1);

    expect(rampExercise(session, last.id, DEADLIFT, rampInput(), testContext())).toEqual(
      rampLastExercise(session, DEADLIFT, rampInput(), testContext()),
    );
  });

  it('has nothing to say about a movement with no ramp', () => {
    // Silent, for the reason it is silent in the tail form: somebody who repeated a
    // session with a chin-up in it did not ask for a chin-up ramp.
    const context = testContext();
    const session = addExercise(aSquatWorkout(context), context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'working', performance: performance({ kind: 'none' }, 8) }],
    });
    const outcome = rampExercise(session, exerciseAt(session, 1).id, CHIN_UP, rampInput(), context);

    expect(outcome).toEqual({ ok: false, session, reason: 'no-ramp' });
    expect(outcome.session).toBe(session);
  });

  it('says the same about an exercise the session no longer holds', () => {
    // Grouped with the no-family answer rather than given a third reason. A screen
    // holding an identifier a background reload removed has nothing to say either.
    const context = testContext();
    const session = twoLifts(context);
    const outcome = rampExercise(session, 'id-gone', SQUAT, rampInput(), context);

    expect(outcome).toEqual({ ok: false, session, reason: 'no-ramp' });
    expect(outcome.session).toBe(session);
  });

  it('separates a refusal by the engine from a lift that has no ramp', () => {
    const context = testContext();
    const session = twoLifts(context);
    const outcome = rampExercise(
      session,
      exerciseAt(session, 0).id,
      SQUAT,
      rampInput({ workingWeight: 0 }),
      context,
    );

    expect(outcome).toEqual({ ok: false, session, reason: 'refused' });
    expect(outcome.session).toBe(session);
  });

  it('replaces the ramp already on a lift rather than writing a second one', () => {
    // Re-ramping is the ordinary case here, not the exceptional one: a repeat is
    // rebuilt lift by lift and a lifter may change their mind twice. Appending
    // would leave twelve rows above the working sets and each pass would add six
    // more.
    const context = testContext();
    const session = twoLifts(context);
    const squat = exerciseAt(session, 0).id;
    const once = rampExercise(session, squat, SQUAT, rampInput(), context);
    const twice = rampExercise(once.session, squat, SQUAT, rampInput(), context);

    expect(warmupsOf(once.session, squat)).toHaveLength(6);
    expect(warmupsOf(twice.session, squat)).toHaveLength(6);
    expect(totals(exerciseAt(twice.session, 0).sets)).toEqual([...RAMP, 225, 225]);
  });

  it('keeps a warm-up row the lifter has already ticked off', () => {
    // Section 8.5's sentence, reached through the new door: preserve completed sets
    // as performed history. A repeat being re-ramped mid-session is a lifter who
    // has already walked part of the ladder.
    const context = testContext();
    const session = twoLifts(context);
    const squat = exerciseAt(session, 0).id;
    const once = rampExercise(session, squat, SQUAT, rampInput(), context);
    const first = warmupsOf(once.session, squat)[0];
    if (first === undefined) throw new Error('the fixture lost its ramp');
    const done = completeSet(once.session, first.id, context);

    const later = testContext(AT_LATER);
    const twice = rampExercise(done, squat, SQUAT, rampInput({ workingWeight: 315 }), later);
    const after = warmupsOf(twice.session, squat);

    expect(after[0]?.id).toBe(first.id);
    expect(after[0]?.status).toBe('complete');
    expect(after.slice(1).every((set) => set.status === 'planned')).toBe(true);
  });
});

describe('workingPrescription', () => {
  it('works up to the heaviest working set and not the first one', () => {
    // A repeat of a hand-edited session holds unequal working sets, and a ramp
    // built to the lightest of them is a ramp that stops below the work.
    const context = testContext();
    const exercise = aSquatOf(context, [workingAt(185, 'lb', 5), workingAt(245, 'lb', 3)]);

    expect(workingPrescription(exercise)).toEqual({
      weight: { amount: 245, unit: 'lb' },
      sets: 2,
      reps: 3,
    });
  });

  it('is the weight as it was recorded, even where the comparison crossed units', () => {
    // Section 11.4: a weight is shown in the unit it was typed in. 100 kg outweighs
    // 215 lb, so working out which one won had to convert -- and the answer must
    // not, or a lifter's own logbook starts rewriting the numbers back at them.
    const context = testContext();
    const exercise = aSquatOf(context, [workingAt(215, 'lb', 5), workingAt(100, 'kg', 2)]);

    expect(workingPrescription(exercise)?.weight).toEqual({ amount: 100, unit: 'kg' });
    expect(workingPrescription(exercise)?.reps).toBe(2);
  });

  it('leaves the earlier of two equal sets in front', () => {
    const context = testContext();
    const exercise = aSquatOf(context, [workingAt(200, 'lb', 5), workingAt(200, 'lb', 2)]);

    expect(workingPrescription(exercise)?.reps).toBe(5);
  });

  it('has no bar to work up to on a bodyweight lift', () => {
    const context = testContext();
    const exercise = anExerciseOf(context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight',
      plan: [{ kind: 'working', performance: performance({ kind: 'none' }, 8) }],
    });

    expect(workingPrescription(exercise)).toBe(null);
  });

  it('has none on a weighted or an assisted lift either', () => {
    // `added` and `assisted` are the same number with opposite signs against a
    // body, and neither is a barbell total. Flattening the union to "whatever
    // weight is in there" would ramp somebody to the plate hung off their belt.
    const context = testContext();
    const added = anExerciseOf(context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'bodyweight-plus-added-weight',
      plan: [
        {
          kind: 'working',
          performance: performance({ kind: 'added', weight: { amount: 25, unit: 'lb' } }, 6),
        },
      ],
    });
    const assisted = anExerciseOf(context, {
      exerciseId: 'chin-up',
      displayName: 'Chin-Up',
      loading: 'assisted-bodyweight',
      plan: [
        {
          kind: 'working',
          performance: performance({ kind: 'assisted', weight: { amount: 30, unit: 'lb' } }, 6),
        },
      ],
    });

    expect(workingPrescription(added)).toBe(null);
    expect(workingPrescription(assisted)).toBe(null);
  });

  it('answers nothing for an exercise with no working sets in it', () => {
    const context = testContext();
    const exercise = aSquatOf(context, [
      { kind: 'warmup', performance: workingAt(135, 'lb', 5).performance },
    ]);

    expect(workingPrescription(exercise)).toBe(null);
  });

  it('answers nothing where the heaviest set has no rep count', () => {
    // Borrowing the lighter set's 5 would attach one set's reps to another set's
    // weight and freeze a prescription nobody wrote down.
    const context = testContext();
    const exercise = aSquatOf(context, [workingAt(185, 'lb', 5), workingAt(245, 'lb', null)]);

    expect(workingPrescription(exercise)).toBe(null);
  });
});

describe('warmupMatchesEquipment', () => {
  it('recognises the rack the plan was generated on', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(warmupMatchesEquipment(change.snapshot, DEFAULT_EQUIPMENT)).toBe(true);
  });

  it('notices a lifter who has walked into a different gym', () => {
    const context = testContext();
    const change = changeFor(aSquatWorkout(context), context);
    expect(warmupMatchesEquipment(change.snapshot, aGym())).toBe(false);
  });
});

describe('warmupIsCurrent', () => {
  it('recognises a plan this build produced', () => {
    const context = testContext();
    expect(warmupIsCurrent(changeFor(aSquatWorkout(context), context).snapshot)).toBe(true);
  });

  it('notices a plan from an older ruleset', () => {
    const context = testContext();
    const snapshot = changeFor(aSquatWorkout(context), context).snapshot;
    expect(warmupIsCurrent({ ...snapshot, rulesetVersion: 'warmup-rules-2019.1' })).toBe(false);
  });

  it('notices a plan from an older engine', () => {
    const context = testContext();
    const snapshot = changeFor(aSquatWorkout(context), context).snapshot;
    expect(warmupIsCurrent({ ...snapshot, engineVersion: 'warmup-engine-2019.1' })).toBe(false);
  });
});

function weightOf(entry: SetPerformance): number {
  return entry.load.kind === 'none' ? Number.NaN : entry.load.weight.amount;
}

function unitOf(entry: SetPerformance): string {
  return entry.load.kind === 'none' ? '' : entry.load.weight.unit;
}
