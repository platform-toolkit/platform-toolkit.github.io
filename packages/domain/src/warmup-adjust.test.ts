// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import type { BarbellSetup, PlateDenomination } from './plates.js';
import { planWarmup, type WarmupFamily, type WarmupPlan } from './warmup.js';
import { adjustWarmups, isAdjustable, nudgeWarmup, warmupSteps } from './warmup-adjust.js';

/** Invented denominations, shaped like a rack. See the note in `warmup.test.ts`. */
function plates(weights: readonly number[], full: readonly number[]): PlateDenomination[] {
  return weights.map((weight) => ({
    weight,
    pairs: null,
    fullDiameter: full.includes(weight),
  }));
}

const POUND_GYM: BarbellSetup = {
  plateUnit: 'lb',
  bar: { amount: 45, unit: 'lb' },
  collars: { amount: 0, unit: 'lb' },
  plates: plates([45, 25, 10, 5, 2.5, 1.25], [45, 25, 10]),
};

/** A rack with nothing small on it, so one step is a long way. */
const COARSE_GYM: BarbellSetup = {
  plateUnit: 'lb',
  bar: { amount: 45, unit: 'lb' },
  collars: { amount: 0, unit: 'lb' },
  plates: plates([45], [45]),
};

/** A rack that runs out: one pair of each, so its heaviest loading is the last one. */
const SPARSE_GYM: BarbellSetup = {
  plateUnit: 'lb',
  bar: { amount: 45, unit: 'lb' },
  collars: { amount: 0, unit: 'lb' },
  plates: [
    { weight: 45, pairs: 1, fullDiameter: true },
    { weight: 25, pairs: 1, fullDiameter: true },
  ],
};

function planned(setup: BarbellSetup, family: WarmupFamily, workingWeight: number): WarmupPlan {
  const result = planWarmup({ setup, family, workingWeight, workingSets: 3, workingReps: 5 });
  if (!result.ok) throw new Error('The fixture should produce a plan.');
  return result.plan;
}

function totals(plan: WarmupPlan): number[] {
  return plan.warmups.map((set) => set.loading.total);
}

/** The index of the last warm-up, which is the one a lifter reaches for first. */
function lastWarmup(plan: WarmupPlan): number {
  return plan.warmups.length - 1;
}

describe('isAdjustable', () => {
  it('refuses the bar-only sets', () => {
    // There is nothing to adjust: the weight is the implement. A control that
    // cannot move is worse than no control.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const empty = plan.warmups.filter((set) => set.stage === 'empty-implement');
    expect(empty).not.toHaveLength(0);
    for (const set of empty) expect(isAdjustable(set)).toBe(false);
  });

  it('allows every weighted set', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    for (const set of plan.warmups) {
      if (set.stage === 'empty-implement') continue;
      expect(isAdjustable(set)).toBe(true);
    }
  });
});

describe('adjustWarmups', () => {
  it('leaves a plan alone when nothing has been adjusted', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    expect(adjustWarmups(plan, [])).toBe(plan);
  });

  it('puts the lifter’s weight on the set they named', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    const moved = adjustWarmups(plan, [{ index, total: 195 }]);

    expect(moved.warmups[index]?.loading.total).toBe(195);
  });

  it('resolves a weight the rack cannot build to one it can', () => {
    // The nearest loadable, not the request. A ramp that names a weight the
    // plates cannot make is a checklist with a set nobody can load.
    const plan = planned(COARSE_GYM, 'squat-press', 315);
    const index = lastWarmup(plan);
    const moved = adjustWarmups(plan, [{ index, total: 200 }]);

    expect(moved.warmups[index]?.loading.total).toBe(225);
  });

  it('recomputes what comes off and what goes on, either side of the change', () => {
    // The whole reason this is arithmetic and not a substitution in a template.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    const moved = adjustWarmups(plan, [{ index, total: 195 }]);

    const before = moved.warmups[index - 1]?.loading.total ?? Number.NaN;
    const sum = (weights: readonly number[]): number =>
      weights.reduce((total, weight) => total + weight, 0);
    const change = moved.warmups[index]?.change ?? { removed: [], added: [] };
    expect(before + 2 * (sum(change.added) - sum(change.removed))).toBe(195);

    const working = moved.working.change ?? { removed: [], added: [] };
    expect(195 + 2 * (sum(working.added) - sum(working.removed))).toBe(225);
  });

  it('never moves the working weight, which is the lifter’s figure already', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const moved = adjustWarmups(plan, [{ index: lastWarmup(plan), total: 195 }]);
    expect(moved.working.total).toBe(225);
  });

  it('leaves the sets nobody touched exactly where they were', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    const moved = adjustWarmups(plan, [{ index, total: 195 }]);

    expect(totals(moved).slice(0, index)).toEqual(totals(plan).slice(0, index));
  });

  it('ignores a set that is not in this ramp', () => {
    // Adjustments arrive from stored state written against a ramp that has since
    // changed shape. A warning about a set the lifter cannot see is a warning
    // about nothing.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    expect(totals(adjustWarmups(plan, [{ index: 99, total: 195 }]))).toEqual(totals(plan));
  });

  it('ignores an adjustment aimed at a bar-only set', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = plan.warmups.findIndex((set) => set.stage === 'empty-implement');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(totals(adjustWarmups(plan, [{ index, total: 135 }]))).toEqual(totals(plan));
  });

  it('does not reorder a set nudged past its neighbour', () => {
    // It reads strangely, and it reads strangely because it is strange. Sorting
    // would move a set the lifter is looking at.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    const moved = adjustWarmups(plan, [{ index: index - 1, total: 215 }]);

    expect(moved.warmups[index - 1]?.loading.total).toBe(215);
    expect(moved.warmups[index]?.loading.total).toBe(totals(plan)[index]);
    expect(moved.warmups[index]?.change.removed).not.toHaveLength(0);
  });

  it('keeps the advisories and the rest of the plan intact', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const moved = adjustWarmups(plan, [{ index: lastWarmup(plan), total: 195 }]);
    expect(moved.advisories).toBe(plan.advisories);
    expect(moved.setup).toBe(plan.setup);
    expect(moved.emptyImplement).toBe(plan.emptyImplement);
  });

  it('describes no plate change for a working weight that cannot be built', () => {
    const plan = planned(COARSE_GYM, 'squat-press', 300);
    expect(plan.working.load.kind).toBe('not-loadable');
    const moved = adjustWarmups(plan, [{ index: lastWarmup(plan), total: 225 }]);
    expect(moved.working.change).toBe(null);
  });
});

describe('nudgeWarmup', () => {
  it('steps to the next weight the rack can make, not a fixed amount', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    const from = totals(plan)[index] ?? Number.NaN;
    // 1.25 lb plates, so 2.5 lb on the bar.
    expect(nudgeWarmup(plan, index, 1)).toBe(from + 2.5);
    expect(nudgeWarmup(plan, index, -1)).toBe(from - 2.5);
  });

  it('steps by what a coarse rack can do instead of inventing a smaller plate', () => {
    const plan = planned(COARSE_GYM, 'squat-press', 315);
    const index = lastWarmup(plan);
    const from = totals(plan)[index] ?? Number.NaN;
    expect(nudgeWarmup(plan, index, 1)).toBe(from + 90);
  });

  it('finds the step up even when it lands a long way above the working weight', () => {
    // The rack this bites on is the one that needs the control most: a garage
    // with nothing but 45s, warming up at 135 for a 140 lb working set. The
    // search used to be built a fixed fifty pounds above the ramp, which on a
    // rack stepping in ninetys holds nothing above the top warm-up at all -- so
    // `Raise` drew itself disabled beside a plate the lifter can plainly see.
    const plan = planned(COARSE_GYM, 'squat-press', 140);
    const index = lastWarmup(plan);
    expect(totals(plan)[index]).toBe(135);
    expect(nudgeWarmup(plan, index, 1)).toBe(225);
  });

  it('will step a set all the way down to the bar, and no further', () => {
    // The bar is a real answer -- a lifter dropping a set to the bar is doing
    // something ordinary -- and there is nothing under it.
    const plan = planned(COARSE_GYM, 'squat-press', 315);
    const index = plan.warmups.findIndex((set) => set.stage !== 'empty-implement');
    expect(nudgeWarmup(plan, index, -1)).toBe(45);

    const atTheBar = adjustWarmups(plan, [{ index, total: 45 }]);
    expect(nudgeWarmup(atTheBar, index, -1)).toBe(null);
  });

  it('answers nothing for a set that is not there or cannot move', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const empty = plan.warmups.findIndex((set) => set.stage === 'empty-implement');
    expect(nudgeWarmup(plan, 99, 1)).toBe(null);
    expect(nudgeWarmup(plan, empty, 1)).toBe(null);
  });

  it('agrees with the plural form, which is what the control is drawn from', () => {
    // If these two ever disagree, a stepper offers a weight that the press then
    // refuses to move to, and the control looks broken rather than bounded.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    for (const step of warmupSteps(plan)) {
      expect(step.up).toBe(nudgeWarmup(plan, step.index, 1));
      expect(step.down).toBe(nudgeWarmup(plan, step.index, -1));
    }
  });

  it('lets a set be walked up past the working weight if that is what is wanted', () => {
    // Nothing here polices the lifter's judgement. The ramp rules keep warm-ups
    // under the work; an adjustment is the lifter overruling them on purpose.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const index = lastWarmup(plan);
    let total = totals(plan)[index] ?? Number.NaN;
    let current = plan;
    for (let step = 0; step < 40 && total < 225; step += 1) {
      const next = nudgeWarmup(current, index, 1);
      if (next === null) break;
      total = next;
      current = adjustWarmups(current, [{ index, total }]);
    }
    expect(total).toBeGreaterThanOrEqual(225);
  });
});

describe('warmupSteps', () => {
  it('describes every set a lifter may move, and none of the bar-only ones', () => {
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const movable = plan.warmups.filter((set) => isAdjustable(set));
    expect(movable).not.toHaveLength(0);

    const steps = warmupSteps(plan);
    expect(steps).toHaveLength(movable.length);
    expect(steps.map((step) => step.total)).toEqual(movable.map((set) => set.loading.total));
    for (const step of steps) {
      expect(plan.warmups[step.index]?.stage).not.toBe('empty-implement');
    }
  });

  it('keeps the index into the plan, not its own position, so an adjustment lands', () => {
    // The rows are numbered for the lifter elsewhere; what travels back into
    // `adjustWarmups` is the position in the plan, bar-only sets included.
    const plan = planned(POUND_GYM, 'squat-press', 225);
    const first = warmupSteps(plan)[0];
    expect(first).toBeDefined();
    expect(plan.warmups[first?.index ?? -1]?.stage).not.toBe('empty-implement');
  });

  it('reports nothing above a set already at the top of the rack', () => {
    // The one honest way to reach a disabled `Raise`, and it is worth knowing
    // that it is the only one: the search now reaches a full step past the
    // heaviest plate, so a step is missing only when the rack has genuinely run
    // out of pairs -- which also means the working weight above it cannot be
    // built. Any *other* route to this state is a bug in the search width.
    const plan = planned(SPARSE_GYM, 'squat-press', 200);
    expect(plan.working.load.kind).toBe('not-loadable');

    const top = warmupSteps(plan).at(-1);
    expect(top?.total).toBe(185);
    expect(top?.up).toBe(null);
    expect(top?.down).toBe(135);
  });

  it('reports nothing below a set already sitting on the bar', () => {
    const plan = planned(COARSE_GYM, 'squat-press', 315);
    const index = plan.warmups.findIndex((set) => set.stage !== 'empty-implement');
    const atTheBar = adjustWarmups(plan, [{ index, total: 45 }]);
    const step = warmupSteps(atTheBar).find((candidate) => candidate.index === index);
    expect(step?.down).toBe(null);
    expect(step?.up).toBe(135);
  });
});
