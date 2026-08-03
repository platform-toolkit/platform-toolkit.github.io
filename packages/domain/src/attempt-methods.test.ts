// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  distributeTargetTotal,
  planFromOpener,
  type OpenerPlanRequest,
  type TargetTotalProposal,
  type TargetTotalRequest,
} from './attempt-methods.js';
import { percentagesFor, strategyForGoal, type MeetGoal } from './attempt-plan.js';
import { rulesFor } from './meet-profile.fixture.js';
import type { MeetRules } from './meet-rules.js';

/**
 * A half-kilogram grid, so nothing in this file is really a test of rounding.
 *
 * `attempt-plan.test.ts` owns §9.1 and covers it on a coarse grid on purpose.
 * These two methods are inversions, and an inversion checked against a plan whose
 * weights have all moved to the nearest five is checked against the rounding
 * rather than against the arithmetic.
 */
const FINE = rulesFor({ barMultipleKilograms: 0.5, minimumProgressionKilograms: 1 });

/** A five-kilogram grid, for the one place the interaction actually matters. */
const COARSE = rulesFor({ barMultipleKilograms: 5, minimumProgressionKilograms: 5 });

/** The bottom of the opener band, which is the figure the inversion has to use. */
function openerPercentOf(goal: MeetGoal): number {
  const percentages = percentagesFor(strategyForGoal(goal));
  if (percentages === null) throw new Error('the fixture goals all have a table row');
  return percentages.opener.lowPercent;
}

function thirdPercentOf(goal: MeetGoal): number {
  const percentages = percentagesFor(strategyForGoal(goal));
  if (percentages === null) throw new Error('the fixture goals all have a table row');
  return percentages.third.lowPercent;
}

function openerPlan(overrides: Partial<OpenerPlanRequest> = {}, rules: MeetRules = FINE) {
  const result = planFromOpener(rules, {
    lift: 'squat',
    openerKilograms: 182,
    ceilingKilograms: 210,
    goal: 'balanced',
    ...overrides,
  });
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.problems)}`);
  return result.plan;
}

function proposal(overrides: Partial<TargetTotalRequest> = {}): TargetTotalProposal {
  const result = distributeTargetTotal({
    targetTotalKilograms: 500,
    goal: 'balanced',
    lifts: [
      { lift: 'squat', expectedMaximumKilograms: 200 },
      { lift: 'bench', expectedMaximumKilograms: 120 },
      { lift: 'deadlift', expectedMaximumKilograms: 230 },
    ],
    ...overrides,
  });
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.problems)}`);
  return result.proposal;
}

function codesOf(items: readonly { readonly code: string }[]): string[] {
  return items.map((item) => item.code);
}

describe('planFromOpener', () => {
  it('puts the opener the lifter typed on the bar', () => {
    // The whole promise of the method. Everything else it produces is worthless
    // if the first attempt is a weight the lifter did not choose.
    const { plan } = openerPlan({ openerKilograms: 182 });
    expect(plan.attempts[0].kilograms).toBe(182);
  });

  it('reports the maximum the opener implies, and it is the goal’s own percentage', () => {
    // The control is that the two goals disagree: a single expected figure would
    // pass against an inversion that ignored the goal and divided by a constant.
    for (const goal of ['balanced', 'first-meet'] as const) {
      const plan = openerPlan({ goal, openerKilograms: 182 });
      expect(plan.impliedMaximumKilograms).toBeCloseTo((182 * 100) / openerPercentOf(goal), 6);
    }
    expect(openerPercentOf('balanced')).not.toBe(openerPercentOf('first-meet'));
  });

  it('inverts the bottom of a band rather than its top, which is where the opener sits', () => {
    // §9's Personal Record opener is a range, and `planAttempts` opens at the
    // bottom of every band. Inverting against the top would produce a plan whose
    // first attempt is a kilogram or two under what the lifter typed -- plausible
    // enough to ship, and wrong in the one number this method exists to preserve.
    const percentages = percentagesFor('personal-record');
    expect(percentages?.opener.lowPercent).not.toBe(percentages?.opener.highPercent);

    const plan = openerPlan({
      goal: 'personal-record',
      openerKilograms: 180,
      ceilingKilograms: 230,
    });
    expect(plan.plan.attempts[0].kilograms).toBe(180);
  });

  it('builds the second and third off the same table every other method uses', () => {
    const { plan, impliedMaximumKilograms: maximum } = openerPlan();
    const percentages = percentagesFor('balanced');
    expect(percentages).not.toBeNull();
    expect(plan.attempts[1].kilograms).toBeCloseTo(
      (maximum * (percentages?.second.lowPercent ?? 0)) / 100,
      1,
    );
    expect(plan.attempts[2].kilograms).toBeCloseTo(
      (maximum * (percentages?.third.lowPercent ?? 0)) / 100,
      1,
    );
  });

  it('plans on what the opener implies, not on the ceiling, when the two disagree', () => {
    // Planning on the ceiling would put the goal's opener percentage of the
    // *ceiling* on the bar -- a lighter weight than the lifter asked for, in the
    // one method whose premise is that they have already chosen it.
    const plan = openerPlan({ openerKilograms: 182, ceilingKilograms: 196 });
    expect(plan.plan.attempts[0].kilograms).toBe(182);
    expect(plan.impliedMaximumKilograms).toBeGreaterThan(196);
    expect(codesOf(plan.notes)).toContain('opener-implies-more-than-the-ceiling');
  });

  it('still lets the ceiling clamp the attempts above the opener', () => {
    const plan = openerPlan({ openerKilograms: 182, ceilingKilograms: 196 });
    for (const attempt of plan.plan.attempts) {
      expect(attempt.kilograms).toBeLessThanOrEqual(196);
    }
    // The control: without the low ceiling the third goes well past it, so the
    // clamp above is the ceiling doing something rather than the plan being short.
    expect(openerPlan({ openerKilograms: 182 }).plan.attempts[2].kilograms).toBeGreaterThan(196);
  });

  it('says nothing about a ceiling the plan finishes just under', () => {
    // The note is about an unused range, and one kilogram of headroom is not one.
    const plan = openerPlan({ openerKilograms: 182, ceilingKilograms: 201 });
    expect(plan.plan.attempts[2].kilograms).toBeLessThan(201);
    expect(codesOf(plan.notes)).not.toContain('opener-is-light-for-the-ceiling');
  });

  it('says so when the third finishes more than a jump under the ceiling', () => {
    const plan = openerPlan({ openerKilograms: 182, ceilingKilograms: 260 });
    const [, second, third] = plan.plan.attempts;
    expect(260 - third.kilograms).toBeGreaterThan(third.kilograms - second.kilograms);
    expect(codesOf(plan.notes)).toContain('opener-is-light-for-the-ceiling');
  });

  it('refuses a ceiling under the opener, in the lifter’s own numbers', () => {
    const result = planFromOpener(FINE, {
      lift: 'squat',
      openerKilograms: 200,
      ceilingKilograms: 180,
      goal: 'balanced',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual(['ceiling-below-the-opener']);
    // The sentence names both weights the lifter typed. A message about a derived
    // opener reads like a figure the tool invented.
    expect(result.problems[0]?.message).toContain('200 kg');
    expect(result.problems[0]?.message).toContain('180 kg');
  });

  it('reports every bad figure at once rather than the first one', () => {
    const result = planFromOpener(FINE, {
      lift: 'bench',
      openerKilograms: 0,
      ceilingKilograms: Number.NaN,
      goal: 'balanced',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual(['opener-is-not-a-weight', 'ceiling-is-not-a-weight']);
  });

  it('asks a custom goal for its percentages instead of guessing one', () => {
    const result = planFromOpener(FINE, {
      lift: 'squat',
      openerKilograms: 180,
      ceilingKilograms: 220,
      goal: 'custom',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toContain('custom-percentages-missing');

    // The control: supplied, it plans, and the opener is still the lifter's.
    const supplied = planFromOpener(FINE, {
      lift: 'squat',
      openerKilograms: 180,
      ceilingKilograms: 220,
      goal: 'custom',
      customPercentages: {
        opener: { lowPercent: 90, highPercent: 90 },
        second: { lowPercent: 95, highPercent: 95 },
        third: { lowPercent: 100, highPercent: 100 },
      },
    });
    expect(supplied.ok).toBe(true);
    if (!supplied.ok) return;
    expect(supplied.plan.plan.attempts[0].kilograms).toBe(180);
    expect(supplied.plan.impliedMaximumKilograms).toBeCloseTo(200, 6);
  });

  it('hands the planner’s own refusal back rather than a summary of it', () => {
    // A grid this coarse cannot fit three rising attempts under a ceiling this
    // tight. The planner knows why; restating it here would be a second sentence
    // to keep in step with the first.
    const result = planFromOpener(COARSE, {
      lift: 'bench',
      openerKilograms: 100,
      ceilingKilograms: 102,
      goal: 'balanced',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual(['limits-leave-no-legal-weight']);
  });

  it('passes the jump limits and the comparison group straight through', () => {
    // Not re-derived here: §8.1 and §8.2 belong to the planner, and a method that
    // quietly dropped them would produce a plan missing the guardrails the lifter
    // asked for with nothing on screen to say so.
    const wide = openerPlan({ openerKilograms: 182, maximumJumpKilograms: 5 });
    expect(wide.plan.attempts[1].kilograms - wide.plan.attempts[0].kilograms).toBeLessThanOrEqual(
      5,
    );

    // §9.3's absolute thresholds only exist once a comparison has been chosen, so
    // one of those codes appearing is proof the group travelled -- where a bare
    // "there are advisories" would pass on §9.2's relative anchors, which apply
    // either way.
    const research = (advisories: readonly { readonly code: string }[]): string[] =>
      codesOf(advisories).filter((code) => code.endsWith('above-research-range'));
    const compared = openerPlan({
      openerKilograms: 200,
      ceilingKilograms: 240,
      population: { comparison: 'female', equipment: 'raw', ruleset: 'research-population' },
    });
    expect(research(compared.plan.advisories).length).toBeGreaterThan(0);
    expect(
      research(openerPlan({ openerKilograms: 200, ceilingKilograms: 240 }).plan.advisories),
    ).toHaveLength(0);
  });
});

describe('distributeTargetTotal', () => {
  it('splits the target in proportion to what the lifter expects', () => {
    const split = proposal();
    const expectedTotal = 200 + 120 + 230;
    expect(split.shares.map((share) => share.requiredBestKilograms)).toEqual([
      (500 * 200) / expectedTotal,
      (500 * 120) / expectedTotal,
      (500 * 230) / expectedTotal,
    ]);
  });

  it('adds up to the target exactly, which is why nothing here is rounded', () => {
    const split = proposal();
    expect(split.reachableTotalKilograms).toBeCloseTo(500, 9);
    expect(split.shortfallKilograms).toBe(0);
    // The control that this is a real property and not a coincidence of round
    // fixtures: a target that divides badly still sums to itself.
    expect(proposal({ targetTotalKilograms: 503.7 }).reachableTotalKilograms).toBeCloseTo(503.7, 9);
  });

  it('keeps the lifts in the order they were given', () => {
    // The caller renders these as rows beside the lifter's own inputs. Sorting
    // them by share would put the deadlift first on most lifters and change the
    // order of the screen as the numbers change.
    expect(proposal().shares.map((share) => share.lift)).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('turns a required best attempt into the maximum that would produce it', () => {
    for (const goal of ['balanced', 'first-meet', 'personal-record'] as const) {
      const share = proposal({ goal }).shares[0];
      expect(share).toBeDefined();
      expect(share?.proposedMaximumKilograms).toBeCloseTo(
        ((share?.requiredBestKilograms ?? 0) * 100) / thirdPercentOf(goal),
        6,
      );
    }
    // The control: the three goals do not agree, so a constant divisor fails.
    const maximums = (['balanced', 'first-meet', 'personal-record'] as const).map(
      (goal) => proposal({ goal }).shares[0]?.proposedMaximumKilograms,
    );
    expect(new Set(maximums).size).toBe(3);
  });

  it('says outright when the target is above the sum of the expectations', () => {
    // §7.5's one non-negotiable sentence. A split that reads as a plan without it
    // is the planner treating a wish as evidence.
    const split = proposal({ targetTotalKilograms: 600 });
    const advisory = split.advisories.find(
      (item) => item.code === 'target-is-above-what-the-lifter-expects',
    );
    expect(advisory?.severity).toBe('strong');
    expect(advisory?.message).toContain('50 kg');

    // The control: a target inside the expectations does not get the sentence.
    expect(codesOf(proposal({ targetTotalKilograms: 500 }).advisories)).not.toContain(
      'target-is-above-what-the-lifter-expects',
    );
  });

  it('measures the reach per lift against that lift’s own expectation', () => {
    const split = proposal({ targetTotalKilograms: 600 });
    for (const share of split.shares) {
      expect(share.reachKilograms).toBeCloseTo(
        Math.max(0, share.proposedMaximumKilograms - share.expectedMaximumKilograms),
        9,
      );
      expect(share.reachPercent).toBeCloseTo(
        (share.reachKilograms / share.expectedMaximumKilograms) * 100,
        9,
      );
    }
    expect(
      codesOf(split.advisories).filter((code) => code === 'lift-requires-a-reach'),
    ).toHaveLength(3);
  });

  it('reports no reach where the split is inside what the lifter expects', () => {
    const split = proposal({ targetTotalKilograms: 400 });
    expect(split.shares.map((share) => share.reachKilograms)).toEqual([0, 0, 0]);
    expect(codesOf(split.advisories)).not.toContain('lift-requires-a-reach');
  });

  it('holds a lift at its ceiling and moves the rest onto the others', () => {
    const split = proposal({
      targetTotalKilograms: 600,
      lifts: [
        { lift: 'squat', expectedMaximumKilograms: 200 },
        { lift: 'bench', expectedMaximumKilograms: 120, ceilingKilograms: 125 },
        { lift: 'deadlift', expectedMaximumKilograms: 230 },
      ],
    });
    const [squat, bench, deadlift] = split.shares;
    expect(bench?.requiredBestKilograms).toBe(125);
    expect(bench?.cappedByCeiling).toBe(true);
    expect(squat?.cappedByCeiling).toBe(false);
    // The target still lands: the 600 is whole, and the other two carry it.
    expect(split.reachableTotalKilograms).toBeCloseTo(600, 9);
    expect(split.shortfallKilograms).toBe(0);
    // And the two that carried it are still in proportion to each other.
    expect(
      (squat?.requiredBestKilograms ?? 0) / (deadlift?.requiredBestKilograms ?? 1),
    ).toBeCloseTo(200 / 230, 9);
    expect(codesOf(split.advisories)).toContain('ceiling-moved-weight-onto-other-lifts');
  });

  it('pins a second lift that the redistribution pushed over its own ceiling', () => {
    // The reason this is a loop and not one pass. Capping the bench hands its
    // surplus to the squat, and on these ceilings that is enough to put the squat
    // over too -- a one-pass version returns a squat above a ceiling the lifter
    // set, which is the failure §8.1 exists to prevent.
    const split = proposal({
      targetTotalKilograms: 600,
      lifts: [
        { lift: 'squat', expectedMaximumKilograms: 200, ceilingKilograms: 210 },
        { lift: 'bench', expectedMaximumKilograms: 120, ceilingKilograms: 125 },
        { lift: 'deadlift', expectedMaximumKilograms: 230 },
      ],
    });
    const [squat, bench, deadlift] = split.shares;
    expect(bench?.requiredBestKilograms).toBe(125);
    expect(squat?.requiredBestKilograms).toBe(210);
    expect(squat?.cappedByCeiling).toBe(true);
    expect(deadlift?.requiredBestKilograms).toBeCloseTo(265, 9);
    expect(split.reachableTotalKilograms).toBeCloseTo(600, 9);
  });

  it('reports a shortfall instead of quietly returning less than the target', () => {
    const split = proposal({
      targetTotalKilograms: 600,
      lifts: [
        { lift: 'squat', expectedMaximumKilograms: 200, ceilingKilograms: 205 },
        { lift: 'bench', expectedMaximumKilograms: 120, ceilingKilograms: 125 },
        { lift: 'deadlift', expectedMaximumKilograms: 230, ceilingKilograms: 235 },
      ],
    });
    expect(split.reachableTotalKilograms).toBeCloseTo(565, 9);
    expect(split.shortfallKilograms).toBeCloseTo(35, 9);
    const advisory = split.advisories.find(
      (item) => item.code === 'ceilings-cannot-hold-the-target',
    );
    expect(advisory?.severity).toBe('strong');
    // Nobody took the surplus, so nothing claims anybody did.
    expect(codesOf(split.advisories)).not.toContain('ceiling-moved-weight-onto-other-lifts');
  });

  it('splits across whatever lifts the meet contests, not always three', () => {
    // §5: push-pull, bench-only and deadlift-only are meets this tool supports.
    const pushPull = proposal({
      targetTotalKilograms: 350,
      lifts: [
        { lift: 'bench', expectedMaximumKilograms: 120 },
        { lift: 'deadlift', expectedMaximumKilograms: 230 },
      ],
    });
    expect(pushPull.shares.map((share) => share.lift)).toEqual(['bench', 'deadlift']);
    expect(pushPull.reachableTotalKilograms).toBeCloseTo(350, 9);

    const benchOnly = proposal({
      targetTotalKilograms: 130,
      lifts: [{ lift: 'bench', expectedMaximumKilograms: 120 }],
    });
    expect(benchOnly.shares[0]?.requiredBestKilograms).toBe(130);
  });

  it('reports every bad figure at once', () => {
    const result = distributeTargetTotal({
      targetTotalKilograms: -10,
      goal: 'balanced',
      lifts: [
        { lift: 'squat', expectedMaximumKilograms: 0 },
        { lift: 'squat', expectedMaximumKilograms: 200, ceilingKilograms: -5 },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual([
      'target-is-not-a-weight',
      'expected-maximum-is-not-a-weight',
      'duplicate-lift',
      'ceiling-is-not-a-weight',
    ]);
  });

  it('refuses a split with no lifts in it', () => {
    const result = distributeTargetTotal({
      targetTotalKilograms: 500,
      goal: 'balanced',
      lifts: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual(['no-lifts']);
  });

  it('asks a custom goal for its percentages instead of guessing one', () => {
    const result = distributeTargetTotal({
      targetTotalKilograms: 500,
      goal: 'custom',
      lifts: [{ lift: 'squat', expectedMaximumKilograms: 200 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.problems)).toEqual(['custom-percentages-missing']);
  });
});
