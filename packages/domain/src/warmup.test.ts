// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import type { BarbellSetup, PlateDenomination } from './plates.js';
import { planWarmup, type WarmupAdvisoryCode, type WarmupPlan, type WarmupSet } from './warmup.js';

const KILOGRAM_PLATES: readonly PlateDenomination[] = [
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 20, pairs: null, fullDiameter: true },
  { weight: 15, pairs: null, fullDiameter: false },
  { weight: 10, pairs: null, fullDiameter: true },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1, pairs: null, fullDiameter: false },
  { weight: 0.5, pairs: null, fullDiameter: false },
];

const POUND_PLATES: readonly PlateDenomination[] = [
  { weight: 45, pairs: null, fullDiameter: true },
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 10, pairs: null, fullDiameter: true },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1.25, pairs: null, fullDiameter: false },
];

const KILOGRAM_GYM: BarbellSetup = {
  plateUnit: 'kg',
  bar: { amount: 20, unit: 'kg' },
  collars: { amount: 0, unit: 'kg' },
  plates: KILOGRAM_PLATES,
};

const POUND_GYM: BarbellSetup = {
  plateUnit: 'lb',
  bar: { amount: 45, unit: 'lb' },
  collars: { amount: 0, unit: 'lb' },
  plates: POUND_PLATES,
};

function planned(
  setup: BarbellSetup,
  family: Parameters<typeof planWarmup>[0]['family'],
  workingWeight: number,
  extra: { readonly workingSets?: number; readonly workingReps?: number } = {},
): WarmupPlan {
  const result = planWarmup({ setup, family, workingWeight, ...extra });
  if (!result.ok) {
    throw new Error(
      `Expected a plan, got problems: ${result.problems.map((p) => p.code).join(', ')}`,
    );
  }
  return result.plan;
}

function totals(plan: WarmupPlan): number[] {
  return plan.warmups.map((set) => set.loading.total);
}

function codes(plan: WarmupPlan): WarmupAdvisoryCode[] {
  return plan.advisories.map((advisory) => advisory.code);
}

function weighted(plan: WarmupPlan): WarmupSet[] {
  return plan.warmups.filter((set) => set.stage !== 'empty-implement');
}

describe('input problems', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY])('refuses a working weight of %p', (weight) => {
    const result = planWarmup({
      setup: KILOGRAM_GYM,
      family: 'squat-press',
      workingWeight: weight,
    });
    expect(result).toEqual({ ok: false, problems: [{ code: 'working-weight-not-a-number' }] });
  });

  it.each([0, -60])('refuses a working weight of %p', (weight) => {
    const result = planWarmup({
      setup: KILOGRAM_GYM,
      family: 'squat-press',
      workingWeight: weight,
    });
    expect(result).toEqual({ ok: false, problems: [{ code: 'working-weight-not-positive' }] });
  });

  it('reports every problem at once', () => {
    // Not the first one found. A form that reveals one problem per submission
    // makes the lifter fix, submit, and discover the next one.
    const result = planWarmup({
      setup: KILOGRAM_GYM,
      family: 'squat-press',
      workingWeight: -1,
      workingSets: 0,
      workingReps: 2.5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toEqual([
      'working-weight-not-positive',
      'working-sets-not-a-positive-whole-number',
      'working-reps-not-a-positive-whole-number',
    ]);
  });

  it('does not refuse equipment that simply cannot build the weight', () => {
    // A plan with a warning beats no plan: the lifter needs something on screen
    // to correct.
    const plan = planned({ ...KILOGRAM_GYM, plates: [] }, 'squat-press', 100);
    expect(codes(plan)).toContain('no-plates-available');
  });
});

describe('guarantees that hold for every plan', () => {
  const cases: readonly {
    readonly name: string;
    readonly setup: BarbellSetup;
    readonly family: Parameters<typeof planWarmup>[0]['family'];
    readonly weight: number;
  }[] = [
    { name: 'kg squat', setup: KILOGRAM_GYM, family: 'squat-press', weight: 142.5 },
    { name: 'kg deadlift', setup: KILOGRAM_GYM, family: 'deadlift', weight: 200 },
    { name: 'kg olympic', setup: KILOGRAM_GYM, family: 'olympic', weight: 80 },
    { name: 'kg assistance', setup: KILOGRAM_GYM, family: 'assistance', weight: 40 },
    { name: 'lb press', setup: POUND_GYM, family: 'squat-press', weight: 135 },
    { name: 'lb deadlift', setup: POUND_GYM, family: 'deadlift', weight: 405 },
    { name: 'lb pull', setup: POUND_GYM, family: 'pull', weight: 225 },
    { name: 'barely above the bar', setup: KILOGRAM_GYM, family: 'squat-press', weight: 22 },
    {
      name: 'coarse plates',
      setup: { ...KILOGRAM_GYM, plates: [KILOGRAM_PLATES[0]!] },
      family: 'squat-press',
      weight: 160,
    },
  ];

  it.each(cases)('$name: every warm-up is loadable', ({ setup, family, weight }) => {
    // The property the whole module exists for. A ramp that names a weight the
    // plates cannot make is a lifter standing at a bar unable to build it.
    const plan = planned(setup, family, weight);
    for (const set of plan.warmups) {
      const side = set.loading.perSide.reduce((sum, plate) => sum + plate, 0);
      expect(set.loading.total).toBeCloseTo(plan.emptyImplement.total + side * 2, 8);
    }
  });

  it.each(cases)('$name: warm-ups strictly increase', ({ setup, family, weight }) => {
    const plan = planned(setup, family, weight);
    const list = totals(plan);
    // The empty implement may repeat itself as a count, but never as two entries.
    for (const [index, total] of list.entries()) {
      if (index === 0) continue;
      expect(total).toBeGreaterThan(list[index - 1] ?? Number.NaN);
    }
  });

  it.each(cases)('$name: no warm-up reaches the working weight', ({ setup, family, weight }) => {
    const plan = planned(setup, family, weight);
    for (const total of totals(plan)) {
      expect(total).toBeLessThan(weight);
    }
  });

  it.each(cases)('$name: nothing is below the empty implement', ({ setup, family, weight }) => {
    const plan = planned(setup, family, weight);
    for (const total of totals(plan)) {
      expect(total).toBeGreaterThanOrEqual(plan.emptyImplement.total);
    }
  });

  it.each(cases)('$name: the same inputs give the same plan', ({ setup, family, weight }) => {
    expect(planned(setup, family, weight)).toEqual(planned(setup, family, weight));
  });
});

describe('squat, bench press, and overhead press', () => {
  it('opens with two bar-only sets of five', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 140);
    const [first] = plan.warmups;
    expect(first?.stage).toBe('empty-implement');
    expect(first?.loading).toEqual({ total: 20, perSide: [] });
    expect(first?.reps).toBe(5);
    // Two sets, one entry. The interface renders two checkboxes; the calculator
    // has one decision to record.
    expect(first?.count).toBe(2);
  });

  it('starts the weighted work at one full plate a side', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 200);
    const [firstWeighted] = weighted(plan);
    expect(firstWeighted?.loading).toEqual({ total: 70, perSide: [25] });
    expect(firstWeighted?.reps).toBe(5);
  });

  it('drops to roughly a third when a full plate would be too heavy an opener', () => {
    // The 40% cap, and it bites more often than it looks like it will: bar plus
    // 25 kg a side is 70, which is half of a 140 kg squat, so a lifter has to be
    // squatting 175 before the plate is the opener. That is the rule as written
    // and it is a product decision, not an approximation of one.
    for (const working of [90, 140]) {
      const [firstWeighted] = weighted(planned(KILOGRAM_GYM, 'squat-press', working));
      expect(firstWeighted?.loading.total).toBeLessThan(working * 0.4);
      expect(firstWeighted?.loading.total).toBeCloseTo(working / 3, 0);
      expect(firstWeighted?.loading.perSide.length).toBeGreaterThan(0);
    }
  });

  it('halves the remaining gap in the middle set, and finishes on a single near 90%', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 200);
    const list = weighted(plan);
    expect(list.map((set) => [set.stage, set.loading.total, set.reps])).toEqual([
      ['first', 70, 5],
      ['middle', 135, 3],
      ['final', 180, 1],
    ]);
  });

  it('uses pound plates and a pound bar without converting anything', () => {
    const plan = planned(POUND_GYM, 'squat-press', 405);
    const list = weighted(plan);
    expect(list[0]?.loading).toEqual({ total: 135, perSide: [45] });
    // 90% of 405 is 364.5, which no pound loading makes; the step either side is
    // 2.5 lb, so the answer has to be within half a step of the target.
    expect(Math.abs((list.at(-1)?.loading.total ?? 0) - 405 * 0.9)).toBeLessThanOrEqual(1.25);
  });

  it('never inserts singles, however wide the gaps', () => {
    // The jump cap belongs to the pull. A squat ramp is three weighted sets by
    // construction, and inserting extras would be adding work nobody asked for.
    const plan = planned(KILOGRAM_GYM, 'squat-press', 300);
    expect(plan.warmups.some((set) => set.stage === 'inserted')).toBe(false);
  });
});

describe('the deadlift', () => {
  it('opens on a full plate at competition height', () => {
    const plan = planned(KILOGRAM_GYM, 'deadlift', 200);
    const [first] = plan.warmups;
    expect(first?.stage).toBe('first');
    expect(first?.loading).toEqual({ total: 70, perSide: [25] });
    expect(first?.reps).toBe(5);
  });

  it('has no bar-only sets', () => {
    // Two empty-bar deadlifts is a rule borrowed from a lift that starts at the
    // top. The pull starts on the floor and the first set is already a full plate.
    const plan = planned(KILOGRAM_GYM, 'deadlift', 200);
    expect(plan.warmups.some((set) => set.stage === 'empty-implement')).toBe(false);
  });

  it('steps down to a smaller full-diameter plate for a light pull', () => {
    // Bar plus 25 a side is 70, which is 70% of 100 -- over the 50% cap. 20 kg
    // gives 60, still over. 10 kg gives 40, which fits, and a 10 kg plate is
    // marked full diameter in this gym.
    const plan = planned(KILOGRAM_GYM, 'deadlift', 100);
    const [first] = plan.warmups;
    expect(first?.loading).toEqual({ total: 40, perSide: [10] });
  });

  it('will not open on small plates that leave the bar low', () => {
    const smallIron: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: KILOGRAM_PLATES.map((plate) => ({ ...plate, fullDiameter: false })),
    };
    const plan = planned(smallIron, 'deadlift', 200);
    // It still produces a plan -- refusing to plan would help nobody -- but it
    // says the bar will be sitting low rather than pretending otherwise.
    expect(codes(plan)).toContain('full-diameter-unavailable');
  });

  it('keeps every jump within one full plate per side', () => {
    const plan = planned(KILOGRAM_GYM, 'deadlift', 260);
    const list = [plan.emptyImplement.total, ...totals(plan)];
    for (const [index, total] of list.entries()) {
      if (index === 0) continue;
      const previous = list[index - 1] ?? Number.NaN;
      if (index === 1) continue; // the opener is measured from the bar, not a warm-up
      expect(total - previous).toBeLessThanOrEqual(50 + 1e-6);
    }
  });

  it('inserts singles when the ramp would otherwise take a bigger jump', () => {
    // The stated heavy-deadlift scenario. 45 lb a side is the cap; the path from
    // the opener to 90% of 500 lb is far more than that in one move.
    const plan = planned(POUND_GYM, 'deadlift', 500);
    expect(plan.warmups.some((set) => set.stage === 'inserted')).toBe(true);
    for (const set of plan.warmups) {
      if (set.stage !== 'inserted') continue;
      expect(set.reps).toBe(1);
      expect(set.count).toBe(1);
    }
    const list = totals(plan);
    for (const [index, total] of list.entries()) {
      if (index === 0) continue;
      expect(total - (list[index - 1] ?? Number.NaN)).toBeLessThanOrEqual(90 + 1e-6);
    }
  });

  it('says so when the plates are too coarse to respect the cap', () => {
    const heavyOnly: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [{ weight: 25, pairs: null, fullDiameter: true }],
    };
    // Every step is 50 kg exactly, which is the cap, so nothing is flagged --
    // this is the control for the next assertion.
    expect(codes(planned(heavyOnly, 'deadlift', 300))).not.toContain('jump-exceeds-full-plate');

    const tooCoarse: BarbellSetup = {
      ...KILOGRAM_GYM,
      plateUnit: 'kg',
      plates: [{ weight: 40, pairs: null, fullDiameter: true }],
    };
    expect(codes(planned(tooCoarse, 'deadlift', 400))).toContain('jump-exceeds-full-plate');
  });

  it('ends on a single below the working weight', () => {
    const plan = planned(KILOGRAM_GYM, 'deadlift', 200);
    const last = plan.warmups.at(-1);
    expect(last?.stage).toBe('final');
    expect(last?.reps).toBe(1);
    expect(last?.loading.total).toBeCloseTo(180, 0);
  });
});

describe('rows and shrugs', () => {
  it('uses the pull ramp without demanding a full-diameter plate', () => {
    const smallIron: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: KILOGRAM_PLATES.map((plate) => ({ ...plate, fullDiameter: false })),
    };
    const plan = planned(smallIron, 'pull', 100);
    expect(codes(plan)).not.toContain('full-diameter-unavailable');
    expect(plan.warmups.length).toBeGreaterThan(0);
  });
});

describe('explosive lifts', () => {
  it('tapers reps and never prescribes fives at weight', () => {
    const plan = planned(KILOGRAM_GYM, 'olympic', 80);
    expect(weighted(plan).map((set) => set.reps)).toEqual([3, 2, 1]);
  });

  it('practises with the empty implement for threes, not fives', () => {
    const plan = planned(KILOGRAM_GYM, 'olympic', 80);
    const [first] = plan.warmups;
    expect(first?.stage).toBe('empty-implement');
    expect(first?.reps).toBe(3);
  });
});

describe('small assistance work', () => {
  it('is one light set and one intermediate, with no heavy single', () => {
    const plan = planned(KILOGRAM_GYM, 'assistance', 40);
    expect(plan.warmups.map((set) => [set.stage, set.reps])).toEqual([
      ['first', 5],
      ['final', 3],
    ]);
  });

  it('has no bar-only sets', () => {
    const plan = planned(KILOGRAM_GYM, 'assistance', 40);
    expect(plan.warmups.some((set) => set.stage === 'empty-implement')).toBe(false);
  });
});

describe('the working set', () => {
  it('shows exactly what was entered when it loads', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 142, { workingSets: 3, workingReps: 5 });
    expect(plan.working.total).toBe(142);
    expect(plan.working.sets).toBe(3);
    expect(plan.working.reps).toBe(5);
    expect(plan.working.load).toEqual({
      kind: 'loadable',
      loading: { total: 142, perSide: [25, 25, 10, 1] },
    });
  });

  it('shows an unloadable weight anyway, with the totals either side', () => {
    // 142.3 is not a multiple of anything this gym owns. The requirement is to
    // show it, flag it, and offer both neighbours -- not to move it silently.
    const plan = planned(KILOGRAM_GYM, 'squat-press', 142.3);
    expect(plan.working.total).toBe(142.3);
    expect(codes(plan)).toContain('working-weight-not-loadable');
    if (plan.working.load.kind !== 'not-loadable') throw new Error('expected not-loadable');
    expect(plan.working.load.below?.total).toBe(142);
    expect(plan.working.load.above?.total).toBe(143);
  });

  it('defaults the prescription without overwriting one that was given', () => {
    expect(planned(KILOGRAM_GYM, 'squat-press', 100).working).toMatchObject({ sets: 3, reps: 5 });
    expect(
      planned(KILOGRAM_GYM, 'squat-press', 100, { workingSets: 1, workingReps: 3 }).working,
    ).toMatchObject({ sets: 1, reps: 3 });
  });

  it('reports the plates to move from the last warm-up', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 140);
    // 126 is 25 + 25 + 2.5 + 0.5 a side; 140 is 25 + 25 + 10. A caller
    // subtracting totals would say "add 14 per side", which is not a plate.
    expect(plan.working.change).toEqual({ removed: [2.5, 0.5], added: [10] });
  });
});

describe('equipment edge cases', () => {
  it('offers only implement preparation when the weight is the bar', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 20);
    expect(codes(plan)).toContain('working-weight-at-or-below-implement');
    expect(plan.warmups.map((set) => set.stage)).toEqual(['empty-implement']);
    expect(plan.working.load).toEqual({ kind: 'loadable', loading: { total: 20, perSide: [] } });
  });

  it('does not invent warm-ups when the bar is already heavier than the plan', () => {
    const plan = planned(KILOGRAM_GYM, 'squat-press', 15);
    expect(codes(plan)).toContain('working-weight-at-or-below-implement');
    expect(totals(plan)).toEqual([20]);
    // Nothing below the bar exists, so there is no lower neighbour to offer.
    if (plan.working.load.kind !== 'not-loadable') throw new Error('expected not-loadable');
    expect(plan.working.load.below).toBe(null);
    expect(plan.working.load.above?.total).toBe(20);
  });

  it('counts competition collars in every total', () => {
    // The stated scenario: 2.5 kg collars add exactly 5 kg everywhere.
    const withCollars: BarbellSetup = { ...KILOGRAM_GYM, collars: { amount: 5, unit: 'kg' } };
    const plan = planned(withCollars, 'squat-press', 200);
    expect(plan.emptyImplement.total).toBe(25);
    expect(weighted(plan)[0]?.loading.total).toBe(75);
    // Shifting the reachable set is the point, not just shifting the labels: the
    // same plates now make different totals, so the ramp is not the collarless
    // one with 5 added to each line.
    expect(totals(plan)).not.toEqual(totals(planned(KILOGRAM_GYM, 'squat-press', 200)));
  });

  it('respects a limited inventory', () => {
    // The stated scenario: one pair of 20 kg plates means no set uses two.
    const oneHeavyPair: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [
        { weight: 20, pairs: 1, fullDiameter: true },
        { weight: 10, pairs: 2, fullDiameter: true },
        { weight: 5, pairs: 2, fullDiameter: false },
        { weight: 2.5, pairs: 2, fullDiameter: false },
      ],
    };
    const plan = planned(oneHeavyPair, 'squat-press', 80);
    for (const set of plan.warmups) {
      expect(set.loading.perSide.filter((plate) => plate === 20).length).toBeLessThanOrEqual(1);
    }
  });

  it('handles a pound bar under kilogram plates', () => {
    const mixed: BarbellSetup = { ...KILOGRAM_GYM, bar: { amount: 45, unit: 'lb' } };
    const plan = planned(mixed, 'squat-press', 100);
    expect(plan.emptyImplement.total).toBeCloseTo(20.41165665, 8);
    for (const set of plan.warmups) {
      const side = set.loading.perSide.reduce((sum, plate) => sum + plate, 0);
      expect(set.loading.total).toBeCloseTo(20.41165665 + side * 2, 8);
    }
  });

  it('returns fewer sets rather than duplicates when the plates are coarse', () => {
    // Only 25 kg plates: 20, 70, 120. A 90% single at 108 has nowhere to go that
    // is not 70 again, so the stage is omitted instead of repeated.
    const coarse: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [{ weight: 25, pairs: null, fullDiameter: true }],
    };
    const plan = planned(coarse, 'squat-press', 120);
    expect(totals(plan)).toEqual([20, 70]);
  });

  it('says nothing is loadable but the bar when no plates are selected', () => {
    const plan = planned({ ...KILOGRAM_GYM, plates: [] }, 'squat-press', 100);
    expect(codes(plan)).toContain('no-plates-available');
    expect(totals(plan)).toEqual([20]);
  });

  it('warns once, not once per stage', () => {
    const coarse: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [{ weight: 40, pairs: null, fullDiameter: true }],
    };
    const list = codes(planned(coarse, 'deadlift', 400));
    expect(new Set(list).size).toBe(list.length);
  });
});
