// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The builder's form reader.
 *
 * A Node test rather than a browser one, which is the reason this reader is its own
 * module: what is worth proving here is arithmetic on strings a thumb typed, and every
 * one of the interesting cases -- a decimal, a minus sign, a stray letter, a number
 * with more sets in it than a screen can show -- is a case a browser test would have to
 * drive through a control to reach.
 */

import { describe, expect, it } from 'vitest';

import { findExercise } from '../core/catalog.js';
import type { ExerciseOption } from '../types.js';

import {
  MAX_PLANNED_REPS,
  MAX_PLANNED_SETS,
  newPlanRow,
  planProblem,
  problemFor,
  readPlan,
  type PlanDraftRow,
} from './plan.js';

function option(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such exercise: ${id}`);
  return found;
}

const SQUAT = option('squat');
const CHIN_UP = option('chin-up');

function row(overrides: Partial<PlanDraftRow> = {}): PlanDraftRow {
  return { ...newPlanRow(SQUAT, 'row-1'), ...overrides };
}

describe('newPlanRow', () => {
  it('seeds the counts from the exercise and leaves the weight blank', () => {
    const seeded = newPlanRow(SQUAT, 'row-7');

    expect(seeded.key).toBe('row-7');
    expect(seeded.option).toBe(SQUAT);
    expect(seeded.sets).toBe(String(SQUAT.defaultSets));
    expect(seeded.reps).toBe(String(SQUAT.defaultReps));
    // Blank rather than a guess. Section 7.4 allows a plan with no weight in it,
    // and a prefilled number is one a lifter has to notice before they overwrite it.
    expect(seeded.weight).toBe('');
  });

  it('takes the key from its caller, so one exercise can appear twice', () => {
    // Heavy singles and then back-off sets is two squats in one session, so the
    // row identity cannot be the exercise identifier.
    const first = newPlanRow(SQUAT, 'row-1');
    const second = newPlanRow(SQUAT, 'row-2');

    expect(first.key).not.toBe(second.key);
    expect(first.option).toBe(second.option);
  });
});

describe('readPlan', () => {
  it('reads a filled row into a planned exercise', () => {
    const reading = readPlan([row({ sets: '5', reps: '3', weight: '140' })], 'kg');

    expect(reading).toStrictEqual({
      ok: true,
      exercises: [{ option: SQUAT, sets: 5, reps: 3, weight: { amount: 140, unit: 'kg' } }],
    });
  });

  it('stamps the weight with the unit it was typed in', () => {
    // Section 11.4. The number is not converted on the way in or on the way out;
    // what is recorded is what the lifter typed, in the unit the screen was in.
    const reading = readPlan([row({ weight: '315' })], 'lb');

    expect(reading.ok && reading.exercises[0]?.weight).toStrictEqual({
      amount: 315,
      unit: 'lb',
    });
  });

  it('reads a blank weight as no weight rather than as a problem', () => {
    const reading = readPlan([row({ weight: '   ' })], 'kg');

    expect(reading.ok && reading.exercises[0]?.weight).toBeNull();
  });

  it('ignores whatever is in the weight box for an exercise that has no weight', () => {
    // The chin-up row never renders a weight field, so anything left in the draft
    // is stale -- from before a row was removed, or from a future edit that reuses
    // a row. Reading it would record a bodyweight chin-up as a loaded one.
    const seeded = newPlanRow(CHIN_UP, 'row-1');
    const reading = readPlan([{ ...seeded, weight: 'nonsense' }], 'kg');

    expect(reading).toStrictEqual({
      ok: true,
      exercises: [
        {
          option: CHIN_UP,
          sets: Number(seeded.sets),
          reps: Number(seeded.reps),
          weight: null,
        },
      ],
    });
  });

  it('reads every row, not only the first', () => {
    const reading = readPlan(
      [
        row({ key: 'row-1', sets: '1', reps: '1' }),
        row({ key: 'row-2', option: CHIN_UP, sets: '4', reps: '8' }),
      ],
      'kg',
    );

    expect(reading.ok && reading.exercises.map((exercise) => exercise.sets)).toStrictEqual([1, 4]);
  });

  it('reads an empty plan as an empty success', () => {
    // The builder refuses to start an empty workout, and it does so with the row
    // count rather than with a reading. A reader that called nothing a problem
    // would put an error under a control the lifter has not touched yet.
    expect(readPlan([], 'kg')).toStrictEqual({ ok: true, exercises: [] });
  });

  it.each([
    ['', 'unreadable'],
    ['   ', 'unreadable'],
    ['five', 'unreadable'],
    ['3.5', 'not-whole'],
    ['0', 'not-positive'],
    ['-2', 'not-positive'],
    [String(MAX_PLANNED_SETS + 1), 'too-many'],
  ] as const)('reports %s sets as %s', (sets, code) => {
    const reading = readPlan([row({ sets })], 'kg');

    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.problems).toStrictEqual([{ row: 0, field: 'sets', code }]);
  });

  it('allows the largest count the screen can show', () => {
    // The boundary is inclusive on both fields. A limit that refused its own
    // documented maximum would be a limit nobody could find the edge of.
    const reading = readPlan(
      [row({ sets: String(MAX_PLANNED_SETS), reps: String(MAX_PLANNED_REPS) })],
      'kg',
    );

    expect(reading.ok).toBe(true);
  });

  it.each([
    ['nope', 'unreadable'],
    ['0', 'not-positive'],
    ['-5', 'not-positive'],
  ] as const)('reports a weight of %s as %s', (weight, code) => {
    const reading = readPlan([row({ weight })], 'kg');

    expect(!reading.ok && reading.problems).toStrictEqual([{ row: 0, field: 'weight', code }]);
  });

  it('allows a fractional weight, which a whole count does not get', () => {
    // 2.5 kg is a real plate and 2.5 sets is a typo. The two fields are read by
    // different rules on purpose, and this is the assertion that says so.
    const reading = readPlan([row({ weight: '102.5' })], 'kg');

    expect(reading.ok && reading.exercises[0]?.weight?.amount).toBe(102.5);
  });

  it('reports every problem on every row at once', () => {
    // Section 5.5's rule seen from a form: a reader that stopped at the first
    // problem would make a lifter press Start once per mistake.
    const reading = readPlan(
      [
        row({ key: 'row-1', sets: 'x', reps: '0', weight: 'y' }),
        row({ key: 'row-2', sets: '3', reps: '5', weight: '100' }),
        row({ key: 'row-3', sets: '2.5', reps: '5', weight: '' }),
      ],
      'kg',
    );

    expect(!reading.ok && reading.problems).toStrictEqual([
      { row: 0, field: 'sets', code: 'unreadable' },
      { row: 0, field: 'reps', code: 'not-positive' },
      { row: 0, field: 'weight', code: 'unreadable' },
      { row: 2, field: 'sets', code: 'not-whole' },
    ]);
  });

  it('returns no exercises at all when any row is unreadable', () => {
    // Half a plan is not a plan. Starting the readable rows and dropping the rest
    // would silently log a session the lifter did not write down.
    const reading = readPlan([row({ key: 'row-1' }), row({ key: 'row-2', sets: '' })], 'kg');

    expect(reading.ok).toBe(false);
  });
});

describe('problemFor', () => {
  it('finds the problem belonging to one field of one row', () => {
    const problems = [
      { row: 0, field: 'sets', code: 'unreadable' },
      { row: 1, field: 'reps', code: 'not-whole' },
    ] as const;

    expect(problemFor(problems, 1, 'reps')?.code).toBe('not-whole');
    expect(problemFor(problems, 1, 'sets')).toBeNull();
    expect(problemFor(problems, 0, 'reps')).toBeNull();
  });
});

describe('planProblem', () => {
  it.each(['unreadable', 'not-whole', 'not-positive', 'too-many'] as const)(
    'says something a lifter can act on for %s',
    (code) => {
      const message = planProblem({ row: 0, field: 'sets', code });

      expect(message.length).toBeGreaterThan(0);
      // No error code, no field name, no "invalid". The message has to say what to
      // type instead, because it is read by somebody holding a phone in a gym.
      expect(message).not.toContain(code);
    },
  );

  it('tells a lifter how to plan none of an exercise', () => {
    // The one message that would otherwise be a dead end: zero is refused, and
    // wanting zero of something is a real intention with a different control.
    expect(planProblem({ row: 0, field: 'sets', code: 'not-positive' })).toContain('Remove');
  });
});
