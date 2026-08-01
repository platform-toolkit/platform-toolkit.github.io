import { describe, expect, it } from 'vitest';

import { LIFTS, PRIMARY_LIFTS, findLift, liftsByGroup, type LiftDefinition } from './lifts.js';
import { planWarmup } from './warmup.js';
import type { BarbellSetup } from './plates.js';

const GYM: BarbellSetup = {
  plateUnit: 'kg',
  bar: { amount: 20, unit: 'kg' },
  collars: { amount: 0, unit: 'kg' },
  plates: [
    { weight: 25, pairs: null, fullDiameter: true },
    { weight: 20, pairs: null, fullDiameter: true },
    { weight: 10, pairs: null, fullDiameter: true },
    { weight: 5, pairs: null, fullDiameter: false },
    { weight: 2.5, pairs: null, fullDiameter: false },
    { weight: 1.25, pairs: null, fullDiameter: false },
  ],
};

describe('the catalogue', () => {
  it('has no duplicate identifiers', () => {
    // Identifiers are persisted in local preferences, so a duplicate is not a
    // tidiness problem: `findLift` would return whichever the map happened to
    // keep, and a lifter's saved squat could come back as a pin squat.
    const ids = LIFTS.map((lift) => lift.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate names either', () => {
    // Two rows reading "Front Squat" in a picker is a choice nobody can make.
    const names = LIFTS.map((lift) => lift.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('prescribes whole positive sets and reps', () => {
    for (const lift of LIFTS) {
      expect(Number.isInteger(lift.defaultSets) && lift.defaultSets > 0).toBe(true);
      expect(Number.isInteger(lift.defaultReps) && lift.defaultReps > 0).toBe(true);
    }
  });

  it('gives every lift a family the planner accepts', () => {
    // The family is the only thing that decides what a lifter does with a loaded
    // bar, so a lift carrying one the planner does not implement is worse than a
    // missing lift. Planning each one is the check: a family with no ramp behind
    // it produces nothing.
    for (const lift of LIFTS) {
      const result = planWarmup({ setup: GYM, family: lift.family, workingWeight: 100 });
      expect(result.ok, lift.id).toBe(true);
    }
  });
});

describe('the four', () => {
  it('is exactly squat, bench press, deadlift, and overhead press, in that order', () => {
    expect(PRIMARY_LIFTS.map((lift) => lift.id)).toEqual([
      'squat',
      'bench-press',
      'deadlift',
      'overhead-press',
    ]);
  });

  it('is derived from the flag, so the two cannot disagree', () => {
    expect(PRIMARY_LIFTS).toEqual(LIFTS.filter((lift) => lift.primary));
  });

  it('is the whole of the primary group', () => {
    // A lift could otherwise be filed under `primary` without the flag and get
    // the group's billing without appearing on the screen that reads the flag.
    const group = liftsByGroup().get('primary') ?? [];
    expect(group).toEqual(PRIMARY_LIFTS);
  });

  it('pulls the deadlift for a single work set', () => {
    const deadlift = findLift('deadlift');
    expect(deadlift).toMatchObject({ family: 'deadlift', defaultSets: 1, defaultReps: 5 });
  });
});

describe('findLift', () => {
  it('returns the definition for an identifier this build has', () => {
    expect(findLift('power-clean')?.name).toBe('Power Clean');
  });

  it('returns null for one it does not, rather than throwing', () => {
    // Identifiers arrive from preferences written by an older build. Losing the
    // row beats losing the screen.
    expect(findLift('sandbag-carry')).toBe(null);
  });

  it('does not answer for an inherited property name', () => {
    // The lookup is a Map, so this is already safe -- the test is here so that a
    // later change to a plain object record does not quietly make `constructor`
    // resolve to a function.
    expect(findLift('constructor')).toBe(null);
    expect(findLift('toString')).toBe(null);
  });
});

describe('liftsByGroup', () => {
  it('keeps every lift exactly once', () => {
    const grouped: LiftDefinition[] = [...liftsByGroup().values()].flat();
    expect(grouped.length).toBe(LIFTS.length);
    expect(new Set(grouped.map((lift) => lift.id)).size).toBe(LIFTS.length);
  });

  it('preserves the catalogue order within a group', () => {
    // The order is a product decision -- the power clean before the pin squat --
    // and grouping must not quietly sort it.
    for (const [group, lifts] of liftsByGroup()) {
      expect(lifts).toEqual(LIFTS.filter((lift) => lift.group === group));
    }
  });

  it('offers groups in the order they first appear', () => {
    const seen: string[] = [];
    for (const lift of LIFTS) {
      if (!seen.includes(lift.group)) seen.push(lift.group);
    }
    expect([...liftsByGroup().keys()]).toEqual(seen);
  });

  it('has no empty group', () => {
    for (const [group, lifts] of liftsByGroup()) {
      expect(lifts.length, group).toBeGreaterThan(0);
    }
  });
});
