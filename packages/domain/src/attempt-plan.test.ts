// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  MEET_GOALS,
  percentagesFor,
  planAttempts,
  strategyForGoal,
  type AttemptPlan,
  type AttemptPlanRequest,
  type PlannedAttempt,
  type RoundingReason,
} from './attempt-plan.js';
import { rulesFor } from './meet-profile.fixture.js';
import type { MeetRules } from './meet-rules.js';

/**
 * A 100 kg planning maximum throughout, so a weight reads as its own percentage
 * and every figure below can be checked against the §9 table by eye. It is not a
 * federation number and could not be one -- it is what a lifter says about
 * themselves -- so §5.1 is satisfied by the choice being arbitrary.
 */
const MAXIMUM = 100;

/**
 * Two grids, because the two halves of §9.1 need different ones to be visible at
 * all. Both are the shared invented federation with the increment patched; the
 * increment is the only thing this file's assertions depend on, and saying so as
 * a patch is what keeps the rest of the profile from looking load-bearing.
 */

/** A half-kilogram grid: every whole percentage of 100 is already legal. */
const FINE = rulesFor({ barMultipleKilograms: 0.5, minimumProgressionKilograms: 1 });

/**
 * A five-kilogram grid with a five-kilogram progression.
 *
 * Coarse on purpose. §9.1's rules about direction only have teeth where a target
 * falls between two legal weights, and on a real-sized grid the gap is small
 * enough that a broken rule still produces a plausible-looking plan.
 */
const COARSE = rulesFor({ barMultipleKilograms: 5, minimumProgressionKilograms: 5 });

function planFor(
  overrides: Partial<AttemptPlanRequest> = {},
  rules: MeetRules = FINE,
): AttemptPlan {
  const result = planAttempts(rules, {
    lift: 'squat',
    meetDayMaximumKilograms: MAXIMUM,
    goal: 'balanced',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`plan was refused: ${JSON.stringify(result.problems)}`);
  }
  return result.plan;
}

function weights(overrides: Partial<AttemptPlanRequest> = {}, rules?: MeetRules): number[] {
  return planFor(overrides, rules).attempts.map((attempt) => attempt.kilograms);
}

function problemCodesFor(
  overrides: Partial<AttemptPlanRequest>,
  rules: MeetRules = FINE,
): readonly string[] {
  const result = planAttempts(rules, {
    lift: 'squat',
    meetDayMaximumKilograms: MAXIMUM,
    goal: 'balanced',
    ...overrides,
  });
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

function reasonsOn(attempt: PlannedAttempt): readonly RoundingReason[] {
  return attempt.rounding?.reasons ?? [];
}

describe('strategyForGoal', () => {
  it('gives every goal a curve', () => {
    for (const goal of MEET_GOALS) {
      const strategy = strategyForGoal(goal);
      // Custom is the one that legitimately has no table row; every other goal
      // must resolve to one, or the tool offers a preset it cannot plan.
      expect(strategy === 'custom' || percentagesFor(strategy) !== null).toBe(true);
    }
  });

  it('spends an ambitious goal on the third attempt and not on the opener', () => {
    // §6.3 and §2.3: "selecting an aggressive goal must not automatically make the
    // opener aggressive". Read off the table rather than asserted about the code,
    // because the failure is a preset whose opener crept up one release at a time.
    const balanced = percentagesFor('balanced');
    const record = percentagesFor(strategyForGoal('record-attempt'));
    expect(balanced).not.toBeNull();
    expect(record).not.toBeNull();
    expect(record?.opener.lowPercent ?? 0).toBeLessThanOrEqual(balanced?.opener.lowPercent ?? 0);
    expect(record?.third.lowPercent ?? 0).toBeGreaterThan(balanced?.third.lowPercent ?? 0);
  });

  it('plans a qualifying total on the balanced curve', () => {
    // A qualifying total is a target to measure against (§18), not a reason to
    // reach on the platform.
    expect(strategyForGoal('qualification')).toBe('balanced');
  });
});

describe('planAttempts', () => {
  it('reads the first-meet row straight off the table when every weight is legal', () => {
    expect(weights({ goal: 'first-meet' })).toStrictEqual([88, 94, 98]);
  });

  it('takes the bottom of a ranged cell and leaves the top to be asked for', () => {
    // Personal Record is 90-91 / 96-97 / 101-103. One rule for all three cells --
    // default to the low end, offer the band -- rather than three ad-hoc choices,
    // and the band travels on the attempt so an interface can offer the rest.
    const plan = planFor({ goal: 'personal-record' });
    expect(plan.attempts.map((attempt) => attempt.kilograms)).toStrictEqual([90, 96, 101]);
    expect(plan.attempts[2].band).toStrictEqual({ lowPercent: 101, highPercent: 103 });
  });

  it('rounds an opener down and never up', () => {
    // §9.1's default direction. On the coarse grid the balanced opener of 91 kg
    // falls between 90 and 95, and 95 is nearer -- rounding to nearest here would
    // hand a lifter an opener four percentage points above the one they chose.
    const plan = planFor({}, COARSE);
    expect(plan.attempts[0].kilograms).toBe(90);
    expect(reasonsOn(plan.attempts[0])).toStrictEqual(['opener-rounds-down']);
  });

  it('rounds a later attempt to the nearest legal weight rather than always down', () => {
    // The other half of §9.1. Flooring every attempt would quietly cost a lifter
    // most of an increment on each of them, which on a coarse grid is a plan
    // several kilograms below the one they picked.
    //
    // Custom percentages rather than a preset, because the preset rows sit at the
    // top of their risk bands by construction and so round *down* on a coarse grid
    // -- which is the next test, not this one.
    const plan = planFor(
      {
        goal: 'custom',
        customPercentages: {
          opener: { lowPercent: 85, highPercent: 85 },
          second: { lowPercent: 94.5, highPercent: 94.5 },
          third: { lowPercent: 99, highPercent: 99 },
        },
      },
      COARSE,
    );
    // 94.5% of 100 sits between 90 and 95, nearer 95, and 95 is inside the same
    // risk band -- so nothing stops it rounding up.
    expect(plan.attempts[1].kilograms).toBe(95);
    expect(reasonsOn(plan.attempts[1])).toStrictEqual(['nearest-legal-weight']);
  });

  it('rounds the first-meet second down on a coarse grid rather than into a harder attempt', () => {
    // The two halves of §9.1 meeting: 94% is exactly the top of the Secure band for
    // a second attempt, so the nearer legal weight of 95 is a more aggressive
    // attempt than the preset chose. The plan gives up four kilograms rather than
    // quietly change what the lifter picked.
    const plan = planFor({ goal: 'first-meet' }, COARSE);
    expect(plan.attempts[1].kilograms).toBe(90);
    expect(reasonsOn(plan.attempts[1])).toStrictEqual(['rounding-up-would-raise-the-risk']);
  });

  it('refuses to round up when doing so would make the attempt more aggressive', () => {
    // §9.1 by name: "never let upward rounding silently turn a conservative
    // attempt into an aggressive attempt". 97.6% is inside the Secure band for a
    // third; the nearer legal weight, 100, is not.
    const plan = planFor(
      {
        goal: 'custom',
        customPercentages: {
          opener: { lowPercent: 85, highPercent: 85 },
          second: { lowPercent: 90, highPercent: 90 },
          third: { lowPercent: 97.6, highPercent: 97.6 },
        },
      },
      COARSE,
    );
    expect(plan.attempts[2].kilograms).toBe(95);
    expect(reasonsOn(plan.attempts[2])).toStrictEqual(['rounding-up-would-raise-the-risk']);
    expect(plan.attempts[2].risk).toBe('secure');
  });

  it('never produces a later attempt below the federation minimum progression', () => {
    // §9.1. A plan that asks for an increase the officials will not accept is a
    // plan a lifter finds out about at the expeditor's table.
    const plan = planFor(
      {
        goal: 'custom',
        customPercentages: {
          opener: { lowPercent: 85, highPercent: 85 },
          second: { lowPercent: 86, highPercent: 86 },
          third: { lowPercent: 95, highPercent: 95 },
        },
      },
      COARSE,
    );
    expect(plan.attempts[1].kilograms).toBe(90);
    expect(reasonsOn(plan.attempts[1])).toStrictEqual(['minimum-progression']);
  });

  it('drops the rounding reason when a floor decided the weight instead', () => {
    // The weight on screen did not come from rounding to the nearest legal figure,
    // and saying it did sends a lifter looking for arithmetic that never happened.
    const plan = planFor(
      {
        goal: 'custom',
        customPercentages: {
          opener: { lowPercent: 85, highPercent: 85 },
          second: { lowPercent: 86, highPercent: 86 },
          third: { lowPercent: 95, highPercent: 95 },
        },
      },
      COARSE,
    );
    expect(reasonsOn(plan.attempts[1])).not.toContain('nearest-legal-weight');
  });

  it('says a ceiling below the opener is not a plan, in those terms', () => {
    // There is no capping to do here. Every later attempt has to clear the one
    // before it, so a ceiling under the opener leaves the second nowhere to go --
    // and reporting that as "attempt 2 has no legal weight left" would send a
    // lifter to the wrong setting.
    const result = planAttempts(FINE, {
      lift: 'squat',
      meetDayMaximumKilograms: MAXIMUM,
      goal: 'balanced',
      ceilingKilograms: 80,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toStrictEqual([
      'ceiling-below-the-opener',
    ]);
    expect(result.problems[0]?.attemptNumber).toBe(1);
  });

  it('caps a later attempt at a hard ceiling', () => {
    const plan = planFor({ ceilingKilograms: 97.5 });
    expect(plan.attempts.map((attempt) => attempt.kilograms)).toStrictEqual([91, 96, 97.5]);
    expect(reasonsOn(plan.attempts[2])).toStrictEqual(['hard-ceiling']);
  });

  it('honours a custom maximum jump on every gap after the opener', () => {
    const plan = planFor({ maximumJumpKilograms: 3 });
    expect(plan.attempts.map((attempt) => attempt.kilograms)).toStrictEqual([91, 94, 97]);
    expect(reasonsOn(plan.attempts[1])).toStrictEqual(['maximum-jump']);
  });

  it('honours a custom minimum jump without blaming the federation for it', () => {
    // Both floors can bind at once and only one of them is the lifter's to change,
    // so the reason has to name the right one.
    const plan = planFor({ minimumJumpKilograms: 8 });
    expect(plan.attempts[1].kilograms).toBe(99);
    expect(reasonsOn(plan.attempts[1])).toStrictEqual(['minimum-jump']);
  });

  it('reports the attempt that has nowhere legal left to go', () => {
    // A ceiling one kilogram above the opener leaves no weight that is both above
    // the minimum progression and below the ceiling. Refusing beats silently
    // repeating the opener, which is a plan the officials would not accept either.
    const result = planAttempts(FINE, {
      lift: 'squat',
      meetDayMaximumKilograms: MAXIMUM,
      goal: 'balanced',
      ceilingKilograms: 91.5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toStrictEqual([
      'limits-leave-no-legal-weight',
    ]);
    expect(result.problems[0]?.attemptNumber).toBe(2);
  });

  it('refuses a maximum that is not a weight', () => {
    expect(problemCodesFor({ meetDayMaximumKilograms: 0 })).toContain('maximum-is-not-a-weight');
    expect(problemCodesFor({ meetDayMaximumKilograms: Number.NaN })).toContain(
      'maximum-is-not-a-weight',
    );
  });

  it('refuses a custom goal with no percentages rather than falling back to a preset', () => {
    // A silent fallback is a plan attributed to a choice the lifter did not make.
    expect(problemCodesFor({ goal: 'custom' })).toStrictEqual(['custom-percentages-missing']);
  });

  it('refuses percentages that do not ascend', () => {
    expect(
      problemCodesFor({
        goal: 'custom',
        customPercentages: {
          opener: { lowPercent: 95, highPercent: 95 },
          second: { lowPercent: 92, highPercent: 92 },
          third: { lowPercent: 99, highPercent: 99 },
        },
      }),
    ).toContain('percentages-out-of-order');
  });

  it('reports every problem with the request at once', () => {
    // §5.5. A lifter who fixes the one problem they were told about and is handed
    // the next one has been made to guess twice.
    const codes = problemCodesFor({
      meetDayMaximumKilograms: -5,
      ceilingKilograms: 0,
      minimumJumpKilograms: 20,
      maximumJumpKilograms: 5,
    });
    expect(codes).toContain('maximum-is-not-a-weight');
    expect(codes).toContain('ceiling-is-not-a-weight');
    expect(codes).toContain('jump-limits-contradict');
  });

  it('says when there is no legal opener at all', () => {
    // A planning maximum lighter than the bar's smallest step. Absurd, and it
    // arrives from a lifter typing into a unit-converted field.
    expect(problemCodesFor({ meetDayMaximumKilograms: 0.2 })).toStrictEqual(['no-legal-opener']);
  });

  it('reports the percentage of the weight it planned, not of the one it wanted', () => {
    // The honest figure is the one describing what is on the bar. Reporting the
    // target's percentage next to a rounded weight is a plan that does not add up
    // on its own screen.
    const plan = planFor({}, COARSE);
    expect(plan.attempts[0].kilograms).toBe(90);
    expect(plan.attempts[0].targetKilograms).toBe(91);
    expect(plan.attempts[0].percentOfMaximum).toBeCloseTo(90, 10);
  });

  it('leaves no rounding note when nothing moved the weight', () => {
    for (const attempt of planFor({ goal: 'first-meet' }).attempts) {
      expect(attempt.rounding).toBeNull();
    }
  });

  it('says what rounding did, in a sentence, with the reason attached', () => {
    // §9.1 asks for the change to be shown clearly. A bare flag is not clear: the
    // reason is what tells a lifter whether it is theirs to change.
    const note = planFor({}, COARSE).attempts[0].rounding;
    expect(note?.direction).toBe('down');
    expect(note?.kilograms).toBeCloseTo(1, 10);
    expect(note?.message).toContain('91 kg');
    expect(note?.message).toContain('90 kg');
  });

  it('marks the third attempt provisional and the first two not', () => {
    // §9: "The planned third is a scenario, not a commitment." A per-attempt fact
    // rather than a constant, because live mode settles the first two and leaves
    // this one true.
    expect(planFor().attempts.map((attempt) => attempt.provisional)).toStrictEqual([
      false,
      false,
      true,
    ]);
  });

  it('reports each gap alongside the attempt it leads into', () => {
    const plan = planFor({ goal: 'first-meet' });
    expect(plan.attempts[0].jumpKilograms).toBeNull();
    expect(plan.attempts[1].jumpKilograms).toBeCloseTo(6, 10);
    expect(plan.attempts[2].jumpKilograms).toBeCloseTo(4, 10);
  });

  it('carries the risk of each attempt without ever combining it with anything', () => {
    // §10.2. The two axes stay apart: there is a risk on the attempt, a confidence
    // assessed elsewhere, and deliberately nothing on the plan that fuses them.
    const plan = planFor({ goal: 'first-meet' });
    expect(plan.attempts.map((attempt) => attempt.risk)).toStrictEqual([
      'secure',
      'secure',
      'secure',
    ]);
    expect(Object.keys(plan)).not.toContain('score');
    expect(Object.keys(plan)).not.toContain('confidence');
  });

  it('reviews its own jumps and stays quiet about an ordinary ladder', () => {
    expect(planFor({ goal: 'first-meet' }).advisories).toStrictEqual([]);
  });

  it('gives general guidance when no comparison group was offered', () => {
    // §8.2: declining is a supported answer, and omitting the field is declining.
    const plan = planFor({
      goal: 'custom',
      customPercentages: {
        opener: { lowPercent: 88, highPercent: 88 },
        second: { lowPercent: 105, highPercent: 105 },
        third: { lowPercent: 118, highPercent: 118 },
      },
    });
    expect(plan.advisories.length).toBeGreaterThan(0);
    expect(plan.advisories.every((advisory) => advisory.evidence === 'general')).toBe(true);
  });

  it('adds the population figures once a comparison group is given', () => {
    const plan = planFor({
      goal: 'custom',
      customPercentages: {
        opener: { lowPercent: 88, highPercent: 88 },
        second: { lowPercent: 105, highPercent: 105 },
        third: { lowPercent: 118, highPercent: 118 },
      },
      population: { comparison: 'male', equipment: 'raw', ruleset: 'research-population' },
    });
    expect(plan.advisories.map((advisory) => advisory.code)).toContain(
      'second-to-third-above-research-range',
    );
  });

  it('totals the three planned weights so a target has something to measure', () => {
    const plan = planFor({ goal: 'first-meet' });
    expect(plan.plannedSubtotalKilograms).toBeCloseTo(280, 10);
  });

  it('records the methodology version and the strategy the goal resolved to', () => {
    // §30. A saved plan that does not say which reading produced it reads as
    // current forever.
    const plan = planFor({ goal: 'place-or-win' });
    expect(plan.strategy).toBe('personal-record');
    expect(plan.goal).toBe('place-or-win');
    expect(plan.methodologyVersion).toMatch(/^attempt-plan-\d{4}\.\d+$/u);
  });

  it('produces a legal weight for every attempt of every preset', () => {
    // The guarantee the interface is allowed to assume. Written as a sweep rather
    // than per preset, so a preset added later cannot quietly skip it.
    for (const goal of MEET_GOALS) {
      if (goal === 'custom') continue;
      for (const rules of [FINE, COARSE]) {
        for (const maximum of [62.5, 100, 187.5, 303]) {
          const result = planAttempts(rules, {
            lift: 'deadlift',
            meetDayMaximumKilograms: maximum,
            goal,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) continue;
          let previous = 0;
          for (const attempt of result.plan.attempts) {
            expect(rules.isLegalBarWeight(attempt.kilograms)).toBe(true);
            expect(attempt.kilograms).toBeGreaterThan(previous);
            previous = attempt.kilograms;
          }
        }
      }
    }
  });
});
