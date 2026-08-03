// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The two ways into a plan that do not start from a confirmed maximum.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT MORE OF `attempt-plan.ts`
 *
 * §7 offers five ways to build a plan and every one of them has to end at the
 * same place: three legal attempts off §9's table. Three of the five already do.
 * The expected-max method (§7.1) *is* `planAttempts`. The guided estimate (§7.2)
 * is tool 3's `estimateOneRepMax` handing its answer to `planAttempts` once the
 * lifter has confirmed it. The manual plan (§7.4) is not a derivation at all --
 * the lifter names all three weights and the tool checks them, which is
 * `MeetRules`, `reviewJumps` and `meetTotals` doing what they already do.
 *
 * The remaining two invert the arithmetic. §7.3 starts from an opener and works
 * out what maximum that opener implies; §7.5 starts from a total and works out
 * what each lift would have to carry. Both are arithmetic on weights, so both
 * belong in the domain (§5.1) rather than in a session module -- but neither is
 * a *different* plan, and putting them inside `attempt-plan.ts` would invite the
 * one mistake that matters here: a second copy of §9's percentage table, drifting
 * from the first. Everything below composes onto `planAttempts` or onto
 * `percentagesFor`. Nothing below writes down a percentage.
 *
 * WHAT NEITHER OF THEM IS ALLOWED TO DO
 *
 * Treat the lifter's stated figure as evidence about the lifter. §7.5 says it in
 * one line -- "the planner must not treat a desired total as proof that the
 * required lifts are realistic" -- and §7.3 has the same shape: an opener is a
 * decision, not a measurement, and a lifter who names a heavy one has not thereby
 * become stronger. So both answers carry the arithmetic *and* the distance
 * between what was asked for and what the lifter said they could do, and the
 * second of those is never folded into the first.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { JumpPopulation } from './attempt-jumps.js';
import {
  percentagesFor,
  planAttempts,
  strategyForGoal,
  type AttemptPlan,
  type AttemptPlanProblemCode,
  type MeetGoal,
  type StrategyPercentages,
} from './attempt-plan.js';
import type { MeetRules } from './meet-rules.js';

/** Half a gram, the same tolerance the rest of the planning modules use. */
const SAME_WEIGHT_SLACK = 0.000_5;

function describeKilograms(value: number): string {
  // Trailing zeros read as precision this figure does not have.
  return `${Number(value.toFixed(2))} kg`;
}

/**
 * The percentages a goal plans on, or `null` when a custom goal did not supply them.
 *
 * Shared by both methods below because both need to read one cell of the table
 * without building a plan -- the opener cell to invert it, the third cell to turn
 * a required best attempt into a planning maximum.
 */
function percentagesForRequest(
  goal: MeetGoal,
  custom: StrategyPercentages | undefined,
): StrategyPercentages | null {
  const strategy = strategyForGoal(goal);
  return strategy === 'custom' ? (custom ?? null) : percentagesFor(strategy);
}

// ---------------------------------------------------------------------------
// §7.3 -- the known-opener method
// ---------------------------------------------------------------------------

export interface OpenerPlanRequest {
  readonly lift: PlatformLift;
  /**
   * What the lifter is going to open with. Their figure, and the one fixed point
   * in this method: everything else is derived from it.
   */
  readonly openerKilograms: number;
  /**
   * §7.3's "realistic ceiling" -- the most the lifter believes is in them today.
   *
   * Required here, where §8.1's hard ceiling is optional on `planAttempts`,
   * because without it this method has nothing to bound the third against: an
   * opener alone implies a maximum and would happily imply an absurd one.
   */
  readonly ceilingKilograms: number;
  readonly goal: MeetGoal;
  /** Required when the goal is `custom`, ignored otherwise. */
  readonly customPercentages?: StrategyPercentages | undefined;
  /** §8.1's custom jump limits, passed through to the planner unchanged. */
  readonly minimumJumpKilograms?: number | null | undefined;
  readonly maximumJumpKilograms?: number | null | undefined;
  /** §8.2's opt-in comparison group. Omitted means declined. */
  readonly population?: JumpPopulation | undefined;
}

/**
 * Something worth saying about the opener the lifter chose. Never a refusal.
 *
 * Both codes describe the same thing from opposite sides -- the relationship
 * between an opener and a ceiling -- and both are the lifter's business rather
 * than the tool's. A planner that silently reconciled the two would be making the
 * one decision §7.3 hands to the lifter.
 */
export type OpenerPlanNoteCode =
  /**
   * The opener is heavy enough that the goal's curve wants a maximum above the
   * ceiling. The ceiling still holds -- it clamps the second and the third -- but
   * the plan underneath is built on what the opener implies.
   */
  | 'opener-implies-more-than-the-ceiling'
  /**
   * The planned third finishes far enough under the ceiling that there is another
   * attempt's worth of room above it. Not a mistake; often deliberate.
   */
  | 'opener-is-light-for-the-ceiling';

export interface OpenerPlanNote {
  readonly code: OpenerPlanNoteCode;
  readonly message: string;
}

export interface OpenerPlan {
  /** Three legal attempts, off the same table every other method lands on. */
  readonly plan: AttemptPlan;
  /**
   * What the opener says the maximum is, under this goal's opener percentage.
   *
   * Reported rather than hidden because it is the whole of the inversion: a
   * lifter who thinks their opener is conservative and sees a maximum here they
   * do not recognise has learned something about the opener, which is the point
   * of offering the method.
   */
  readonly impliedMaximumKilograms: number;
  readonly notes: readonly OpenerPlanNote[];
}

/**
 * Reusing the planner's codes wherever they already say the right thing.
 *
 * `ceiling-below-the-opener`, `ceiling-is-not-a-weight`, `jump-limits-contradict`
 * and the rest mean exactly here what they mean there, and inventing parallel
 * names for them would give a caller two switch arms to render one sentence.
 */
export type OpenerPlanProblemCode = AttemptPlanProblemCode | 'opener-is-not-a-weight';

export interface OpenerPlanProblem {
  readonly code: OpenerPlanProblemCode;
  readonly message: string;
  readonly attemptNumber?: 1 | 2 | 3;
}

export type OpenerPlanResult =
  | { readonly ok: true; readonly plan: OpenerPlan }
  | { readonly ok: false; readonly problems: readonly OpenerPlanProblem[] };

function noteCeilingRelationship(plan: AttemptPlan, ceiling: number): OpenerPlanNote | null {
  const [, second, third] = plan.attempts;
  const headroom = ceiling - third.kilograms;
  if (headroom <= SAME_WEIGHT_SLACK) return null;

  // Measured against this plan's own second-to-third jump rather than against an
  // invented threshold. "Another attempt's worth of room" is a figure the plan
  // already contains, and it scales with the lifter -- ten kilograms spare is a
  // lot on a bench and nothing on a deadlift.
  const jump = third.kilograms - second.kilograms;
  if (jump <= SAME_WEIGHT_SLACK || headroom < jump) return null;
  return {
    code: 'opener-is-light-for-the-ceiling',
    message: `The planned third of ${describeKilograms(third.kilograms)} finishes ${describeKilograms(headroom)} under the ceiling of ${describeKilograms(ceiling)}, which is more than the jump from the second. An opener this size leaves the top of the range unused.`,
  };
}

/**
 * Plan the second and third from an opener the lifter has already chosen.
 *
 * The inversion is one line -- the opener is the goal's opener percentage of some
 * maximum, so that maximum is the opener divided by it -- and everything after it
 * is `planAttempts` doing the work it already does, with the stated ceiling
 * passed straight through as §8.1's hard ceiling. Two consequences of building it
 * this way are worth spelling out, because both would be bugs if they were
 * accidents:
 *
 * The bottom of the band is what gets inverted, not the middle or the top. §9's
 * Personal Record row opens at "90-91%", `planAttempts` opens at the bottom of
 * every band, and inverting against anything else would produce a plan whose
 * first attempt is not the weight the lifter typed.
 *
 * The ceiling never becomes the planning maximum, even when it is lower than what
 * the opener implies. Planning on the ceiling would put the goal's opener
 * percentage of the *ceiling* on the bar, which is below the opener the lifter
 * gave -- so the method would answer a question nobody asked. The opener wins,
 * the ceiling clamps what comes after it, and the disagreement is reported.
 */
export function planFromOpener(rules: MeetRules, request: OpenerPlanRequest): OpenerPlanResult {
  const problems: OpenerPlanProblem[] = [];
  const opener = request.openerKilograms;
  const ceiling = request.ceilingKilograms;

  if (!Number.isFinite(opener) || opener <= 0) {
    problems.push({
      code: 'opener-is-not-a-weight',
      attemptNumber: 1,
      message: 'The opener must be a weight above zero.',
    });
  }
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    problems.push({
      code: 'ceiling-is-not-a-weight',
      message: 'The realistic ceiling must be a weight above zero.',
    });
  }

  const percentages = percentagesForRequest(request.goal, request.customPercentages);
  if (percentages === null) {
    problems.push({
      code: 'custom-percentages-missing',
      message: 'A custom goal has to supply its own opener, second and third percentages.',
    });
  }

  // Checked here rather than left to the planner so the sentence is about the
  // weight the lifter typed. The planner would report it against the opener it
  // derived, which is the same number by construction and reads like a figure the
  // tool invented.
  if (
    Number.isFinite(opener) &&
    Number.isFinite(ceiling) &&
    opener > 0 &&
    ceiling > 0 &&
    ceiling < opener - SAME_WEIGHT_SLACK
  ) {
    problems.push({
      code: 'ceiling-below-the-opener',
      attemptNumber: 1,
      message: `The ceiling of ${describeKilograms(ceiling)} is below the opener of ${describeKilograms(opener)}. An opener is the attempt that decides whether there is a total at all, so it cannot be the heaviest weight of the day.`,
    });
  }

  if (problems.length > 0 || percentages === null) return { ok: false, problems };

  const openerPercent = percentages.opener.lowPercent;
  if (!Number.isFinite(openerPercent) || openerPercent <= 0) {
    return {
      ok: false,
      problems: [
        {
          code: 'percentage-band-inverted',
          attemptNumber: 1,
          message: 'The opener percentage must be above zero for an opener to imply a maximum.',
        },
      ],
    };
  }
  const impliedMaximum = (opener * 100) / openerPercent;

  const planned = planAttempts(rules, {
    lift: request.lift,
    meetDayMaximumKilograms: impliedMaximum,
    goal: request.goal,
    ...(request.customPercentages === undefined
      ? {}
      : { customPercentages: request.customPercentages }),
    ceilingKilograms: ceiling,
    ...(request.minimumJumpKilograms === undefined
      ? {}
      : { minimumJumpKilograms: request.minimumJumpKilograms }),
    ...(request.maximumJumpKilograms === undefined
      ? {}
      : { maximumJumpKilograms: request.maximumJumpKilograms }),
    ...(request.population === undefined ? {} : { population: request.population }),
  });
  if (!planned.ok) return { ok: false, problems: planned.problems };

  const notes: OpenerPlanNote[] = [];
  if (impliedMaximum > ceiling + SAME_WEIGHT_SLACK) {
    notes.push({
      code: 'opener-implies-more-than-the-ceiling',
      message: `Opening at ${describeKilograms(opener)} under this goal implies a meet-day maximum of ${describeKilograms(impliedMaximum)}, which is above the ceiling of ${describeKilograms(ceiling)} you gave. The ceiling still holds -- it caps the second and the third -- but the opener is heavier than the ceiling accounts for.`,
    });
  }
  const light = noteCeilingRelationship(planned.plan, ceiling);
  if (light !== null) notes.push(light);

  return {
    ok: true,
    plan: { plan: planned.plan, impliedMaximumKilograms: impliedMaximum, notes },
  };
}

// ---------------------------------------------------------------------------
// §7.5 -- the target-total method
// ---------------------------------------------------------------------------

export interface TargetTotalLift {
  readonly lift: PlatformLift;
  /**
   * What the lifter expects to be capable of on the day, per lift.
   *
   * This is what sets the *shape* of the distribution: a lifter who deadlifts far
   * more than they bench should not be handed an even split. It is also the
   * figure every reach below is measured against, which is why it is required
   * rather than optional -- a target split with no expectation behind it is three
   * numbers with nothing to say about whether they are reachable.
   */
  readonly expectedMaximumKilograms: number;
  /** §8.1's hard ceiling for this lift, if the lifter named one. */
  readonly ceilingKilograms?: number | null | undefined;
}

export interface TargetTotalRequest {
  readonly targetTotalKilograms: number;
  /** The lifts this meet contests (§5). One entry each, in platform order. */
  readonly lifts: readonly TargetTotalLift[];
  /** Whose third-attempt percentage turns a required best attempt into a maximum. */
  readonly goal: MeetGoal;
  readonly customPercentages?: StrategyPercentages | undefined;
}

export interface TargetTotalShare {
  readonly lift: PlatformLift;
  /** The best attempt this lift has to make for the total to land. */
  readonly requiredBestKilograms: number;
  /**
   * The planning maximum that would put `requiredBestKilograms` on the third
   * attempt of this goal's curve -- what §7.1 gets if the lifter approves it.
   */
  readonly proposedMaximumKilograms: number;
  /** Repeated from the request so a caller rendering one row has both figures. */
  readonly expectedMaximumKilograms: number;
  /** How far the proposal is above what the lifter expects. Zero when it is not. */
  readonly reachKilograms: number;
  /** The same distance as a share of the expectation. Zero when there is none. */
  readonly reachPercent: number;
  /** Whether §8.1's ceiling stopped this lift taking a proportional share. */
  readonly cappedByCeiling: boolean;
}

export type TargetTotalAdvisoryCode =
  /**
   * §7.5's rule, made arithmetic: the target is above the sum of what the lifter
   * said they can do. Always reported, and never as a refusal -- a stretch total
   * is a legitimate thing to plan against as long as nobody pretends otherwise.
   */
  | 'target-is-above-what-the-lifter-expects'
  /** One lift's proposal is above that lift's own expectation. Per lift. */
  | 'lift-requires-a-reach'
  /** A ceiling stopped a lift taking its share, and other lifts took the rest. */
  | 'ceiling-moved-weight-onto-other-lifts'
  /** Every lift is at its ceiling and the total still does not reach the target. */
  | 'ceilings-cannot-hold-the-target';

/** `strong` where a lifter acting on the split without reading it would be misled. */
export type TargetTotalAdvisorySeverity = 'note' | 'strong';

export interface TargetTotalAdvisory {
  readonly code: TargetTotalAdvisoryCode;
  readonly severity: TargetTotalAdvisorySeverity;
  readonly message: string;
  /** Which lift, where the advisory is about one. */
  readonly lift?: PlatformLift;
}

export interface TargetTotalProposal {
  readonly targetTotalKilograms: number;
  /** One per requested lift, in the order they were given. */
  readonly shares: readonly TargetTotalShare[];
  /** The sum of `requiredBestKilograms`. Below the target when ceilings bind. */
  readonly reachableTotalKilograms: number;
  /** Target minus reachable, never negative. Positive when the ceilings bite. */
  readonly shortfallKilograms: number;
  readonly advisories: readonly TargetTotalAdvisory[];
}

export type TargetTotalProblemCode =
  | 'target-is-not-a-weight'
  | 'no-lifts'
  | 'expected-maximum-is-not-a-weight'
  | 'ceiling-is-not-a-weight'
  | 'duplicate-lift'
  | 'custom-percentages-missing'
  | 'third-percentage-is-not-usable';

export interface TargetTotalProblem {
  readonly code: TargetTotalProblemCode;
  readonly message: string;
  readonly lift?: PlatformLift;
}

export type TargetTotalResult =
  | { readonly ok: true; readonly proposal: TargetTotalProposal }
  | { readonly ok: false; readonly problems: readonly TargetTotalProblem[] };

interface ShareWorking {
  readonly entry: TargetTotalLift;
  readonly ceiling: number | null;
  best: number;
  pinned: boolean;
}

/**
 * Fill the target proportionally, pinning any lift that hits its ceiling.
 *
 * The obvious one-pass version is wrong: capping a lift at its ceiling leaves
 * weight unallocated, and handing that weight to the others can push one of
 * *them* over its own ceiling. So this is the standard water-filling loop --
 * distribute the remainder across whoever still has room, pin whoever overflows,
 * repeat. It terminates because every pass either pins at least one lift or
 * changes nothing, and there are finitely many lifts.
 */
function fillShares(working: readonly ShareWorking[], target: number): void {
  for (let pass = 0; pass <= working.length; pass += 1) {
    const open = working.filter((share) => !share.pinned);
    if (open.length === 0) return;

    const pinnedTotal = working
      .filter((share) => share.pinned)
      .reduce((total, share) => total + share.best, 0);
    const remaining = Math.max(0, target - pinnedTotal);
    const weight = open.reduce((total, share) => total + share.entry.expectedMaximumKilograms, 0);

    for (const share of open) {
      // A zero denominator cannot happen -- every expectation is validated above
      // zero -- but an even split is the only defensible answer if it ever did,
      // and it beats writing NaN into a weight the lifter is about to read.
      share.best =
        weight > 0
          ? (remaining * share.entry.expectedMaximumKilograms) / weight
          : remaining / open.length;
    }

    const overflowing = open.filter(
      (share) => share.ceiling !== null && share.best > share.ceiling + SAME_WEIGHT_SLACK,
    );
    if (overflowing.length === 0) return;
    for (const share of overflowing) {
      share.best = share.ceiling ?? share.best;
      share.pinned = true;
    }
  }
}

/**
 * Propose how a target total could be split across the lifts of the meet.
 *
 * "Could be" is the whole of §7.5. The split is arithmetic -- each lift carries
 * the share of the target that matches its share of what the lifter expects to
 * lift -- and arithmetic has nothing to say about whether the result is in the
 * lifter about to attempt it. So every share comes back beside the expectation it
 * was derived from and the distance between the two, the sum of the expectations
 * is checked against the target outright, and the requirements' own sentence is
 * the first advisory a caller will render.
 *
 * NOTHING HERE IS ROUNDED TO A LEGAL WEIGHT
 *
 * A share is a target for the planner, not a weight anybody loads: `planAttempts`
 * rounds the attempts, once, against the federation profile. Rounding three
 * shares to legal increments here would make them sum to something other than the
 * total the lifter asked for -- and a split that does not add up to the target is
 * a worse answer than one with a decimal in it, because the error is invisible
 * until somebody adds the column up.
 */
export function distributeTargetTotal(request: TargetTotalRequest): TargetTotalResult {
  const problems: TargetTotalProblem[] = [];
  const target = request.targetTotalKilograms;

  if (!Number.isFinite(target) || target <= 0) {
    problems.push({
      code: 'target-is-not-a-weight',
      message: 'The target total must be a weight above zero.',
    });
  }
  if (request.lifts.length === 0) {
    problems.push({
      code: 'no-lifts',
      message: 'A target total has to be split across at least one lift.',
    });
  }

  const seen = new Set<PlatformLift>();
  for (const entry of request.lifts) {
    if (seen.has(entry.lift)) {
      problems.push({
        code: 'duplicate-lift',
        lift: entry.lift,
        message: 'Each lift may appear once in the split.',
      });
    }
    seen.add(entry.lift);

    if (!Number.isFinite(entry.expectedMaximumKilograms) || entry.expectedMaximumKilograms <= 0) {
      problems.push({
        code: 'expected-maximum-is-not-a-weight',
        lift: entry.lift,
        message: 'Each lift needs an expected maximum above zero for the split to have a shape.',
      });
    }
    const ceiling = entry.ceilingKilograms ?? null;
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling <= 0)) {
      problems.push({
        code: 'ceiling-is-not-a-weight',
        lift: entry.lift,
        message: 'A hard ceiling must be a weight above zero.',
      });
    }
  }

  const percentages = percentagesForRequest(request.goal, request.customPercentages);
  if (percentages === null) {
    problems.push({
      code: 'custom-percentages-missing',
      message: 'A custom goal has to supply its own opener, second and third percentages.',
    });
  } else if (!Number.isFinite(percentages.third.lowPercent) || percentages.third.lowPercent <= 0) {
    problems.push({
      code: 'third-percentage-is-not-usable',
      message: 'The third-attempt percentage must be above zero to turn a share into a maximum.',
    });
  }

  if (problems.length > 0 || percentages === null) return { ok: false, problems };

  const working: ShareWorking[] = request.lifts.map((entry) => ({
    entry,
    ceiling: entry.ceilingKilograms ?? null,
    best: 0,
    pinned: false,
  }));
  fillShares(working, target);

  const thirdPercent = percentages.third.lowPercent;
  const shares: TargetTotalShare[] = working.map((share) => {
    const proposed = (share.best * 100) / thirdPercent;
    const expected = share.entry.expectedMaximumKilograms;
    const reach = Math.max(0, proposed - expected);
    return {
      lift: share.entry.lift,
      requiredBestKilograms: share.best,
      proposedMaximumKilograms: proposed,
      expectedMaximumKilograms: expected,
      reachKilograms: reach,
      reachPercent: expected > 0 ? (reach / expected) * 100 : 0,
      cappedByCeiling: share.pinned,
    };
  });

  const reachable = shares.reduce((total, share) => total + share.requiredBestKilograms, 0);
  const shortfall = Math.max(0, target - reachable);
  const expectedTotal = shares.reduce((total, share) => total + share.expectedMaximumKilograms, 0);

  const advisories: TargetTotalAdvisory[] = [];
  if (target > expectedTotal + SAME_WEIGHT_SLACK) {
    advisories.push({
      code: 'target-is-above-what-the-lifter-expects',
      severity: 'strong',
      message: `The target of ${describeKilograms(target)} is ${describeKilograms(target - expectedTotal)} above the ${describeKilograms(expectedTotal)} these lifts are expected to add up to. Wanting a total is not evidence that the lifts behind it are there; treat this split as what the total would require, not as what the day will produce.`,
    });
  }
  for (const share of shares) {
    if (share.reachKilograms > SAME_WEIGHT_SLACK) {
      advisories.push({
        code: 'lift-requires-a-reach',
        severity: 'note',
        lift: share.lift,
        message: `This split asks for a planning maximum of ${describeKilograms(share.proposedMaximumKilograms)}, which is ${describeKilograms(share.reachKilograms)} above the ${describeKilograms(share.expectedMaximumKilograms)} you expect on the day.`,
      });
    }
    // Only where somebody actually took the weight. When every lift is at its
    // ceiling there is nobody to move it onto, and saying so would be a sentence
    // describing something that did not happen -- the shortfall advisory below is
    // the honest report of that case.
    if (share.cappedByCeiling && shares.some((other) => !other.cappedByCeiling)) {
      advisories.push({
        code: 'ceiling-moved-weight-onto-other-lifts',
        severity: 'note',
        lift: share.lift,
        message: `This lift is held at its ceiling of ${describeKilograms(share.requiredBestKilograms)}, so the rest of the target has been carried by the other lifts.`,
      });
    }
  }
  if (shortfall > SAME_WEIGHT_SLACK) {
    advisories.push({
      code: 'ceilings-cannot-hold-the-target',
      severity: 'strong',
      message: `Every lift is at the ceiling you set and the split still comes to ${describeKilograms(reachable)}, which is ${describeKilograms(shortfall)} short of the target. Raise a ceiling or lower the target -- the split below cannot reach it.`,
    });
  }

  return {
    ok: true,
    proposal: {
      targetTotalKilograms: target,
      shares,
      reachableTotalKilograms: reachable,
      shortfallKilograms: shortfall,
      advisories,
    },
  };
}
