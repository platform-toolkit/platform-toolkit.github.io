/**
 * Three attempts on one lift, from one number the lifter confirmed about themselves.
 *
 * §9 of the planner requirements. The input is `M`, "the user-confirmed realistic
 * meet-day maximum" -- confirmed being the load-bearing word, and §7's job rather
 * than this file's. Whatever route produced it (a tested single, a one-rep-max
 * estimate from tool 3, an opener the lifter already knows, a target total shared
 * across the three lifts), by the time it arrives here somebody has looked at it
 * and said yes.
 *
 * WHAT THIS FILE IS AND IS NOT ALLOWED TO DECIDE
 *
 * It picks percentages and then makes them legal. It does **not** decide whether
 * `M` is believable -- that is `assessDataConfidence` in `attempt-risk.ts`, kept
 * separate because §10 forbids fusing the two -- and it does not decide whether
 * the gaps it produced are gaps lifters actually take, which is `reviewJumps` in
 * `attempt-jumps.ts`. All three answers come back on the plan, side by side and
 * uncombined. A single number blending them is the thing §10 exists to prevent.
 *
 * THE PERCENTAGES ARE ANCHORS, AND THE REQUIREMENTS SAY SO IN THOSE WORDS
 *
 * "These percentages are starting anchors, not guarantees." Nothing here promises
 * a lift, labels one safe, or attaches a probability to any of them -- the same
 * hard constraints tool 3 carries (§11), arriving from a different direction.
 *
 * WHY THE TABLE IS CODE AND NOT PUBLISHED DATA
 *
 * §5.1 keeps *federation* numbers in artifacts because a federation revises them
 * between releases. These are not a federation's numbers. Which presets the
 * product offers and what each one means is product scope -- the same line
 * `lifts.ts` sits on -- and it moves with `ATTEMPT_PLAN_METHODOLOGY_VERSION` so a
 * saved plan records the reading that produced it. The numbers that *are* a
 * federation's, and that this file will not touch directly, are every increment
 * and floor it asks `MeetRules` about.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { reviewJumps, type JumpAdvisory, type JumpPopulation } from './attempt-jumps.js';
import {
  ATTEMPT_PLAN_METHODOLOGY_VERSION,
  classifyAttemptRisk,
  isRiskierThan,
  type AttemptRisk,
} from './attempt-risk.js';
import type { MeetRules, TakenAttempt } from './meet-rules.js';

/**
 * Half a gram, the same tolerance `meet-rules.ts` uses and for the same reason:
 * these weights have been through a percentage, a division and a rounding step,
 * and exact equality would report a weight as "moved by rounding" because a float
 * divide left dust behind.
 */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

function describeKilograms(value: number): string {
  // Trailing zeros read as precision this figure does not have.
  return `${Number(value.toFixed(2))} kg`;
}

// ---------------------------------------------------------------------------
// Goals and strategies
// ---------------------------------------------------------------------------

/**
 * What the lifter said they came for. §6.3's list, unabridged.
 *
 * Eight goals and five attempt curves, because three of these are *targets*
 * rather than curves: qualification, placing and a record are things a plan is
 * measured against (§17 to §19), not different ways of choosing an opener.
 */
export type MeetGoal =
  | 'first-meet'
  | 'conservative'
  | 'balanced'
  | 'personal-record'
  | 'qualification'
  | 'place-or-win'
  | 'record-attempt'
  | 'custom';

export const MEET_GOALS: readonly MeetGoal[] = [
  'first-meet',
  'conservative',
  'balanced',
  'personal-record',
  'qualification',
  'place-or-win',
  'record-attempt',
  'custom',
];

/** The five curves §9's table actually defines. */
export type PlanStrategy =
  'first-meet' | 'conservative' | 'balanced' | 'personal-record' | 'custom';

/**
 * A percentage cell from the §9 table.
 *
 * A band rather than a number because two of the table's cells are ranges, and
 * flattening a range to its midpoint invents a figure the requirements did not
 * give. The band also gives the interface something to offer: the default is the
 * bottom of it, and the rest is a choice a lifter makes deliberately.
 */
export interface PercentBand {
  readonly lowPercent: number;
  readonly highPercent: number;
}

export interface StrategyPercentages {
  readonly opener: PercentBand;
  readonly second: PercentBand;
  readonly third: PercentBand;
}

function band(lowPercent: number, highPercent: number = lowPercent): PercentBand {
  return { lowPercent, highPercent };
}

/**
 * §9's table, verbatim.
 *
 * The Personal Record row is the one to read carefully: its opener (90% to 91%)
 * is *at or below* the Balanced opener, and that is not a transcription slip. It
 * is §6.3 and §2.3's rule made arithmetic -- "selecting an aggressive goal must
 * not automatically make the opener aggressive" -- and the risk it buys is spent
 * entirely on the third, which is the only row that goes above `M`.
 */
const STRATEGY_PERCENTAGES: Readonly<Record<Exclude<PlanStrategy, 'custom'>, StrategyPercentages>> =
  {
    'first-meet': { opener: band(88), second: band(94), third: band(98) },
    conservative: { opener: band(89), second: band(95), third: band(99) },
    balanced: { opener: band(91), second: band(96), third: band(100) },
    'personal-record': { opener: band(90, 91), second: band(96, 97), third: band(101, 103) },
  };

/**
 * Which curve a goal plans on.
 *
 * The three goals with no row of their own map onto a curve whose *third* is
 * aggressive and whose opener is not. That is the whole of §6.3's warning: a
 * lifter who says they came to win must not find that the tool moved their
 * opener, because an opener is the attempt that decides whether they have a total
 * at all.
 */
export function strategyForGoal(goal: MeetGoal): PlanStrategy {
  switch (goal) {
    case 'qualification':
      // A qualifying total is usually reachable without reaching: Balanced, and
      // §18's target tracking says whether it is on course.
      return 'balanced';
    case 'place-or-win':
    case 'record-attempt':
      return 'personal-record';
    default:
      return goal;
  }
}

/** The table row for a strategy, or `null` for `custom`, which supplies its own. */
export function percentagesFor(strategy: PlanStrategy): StrategyPercentages | null {
  return strategy === 'custom' ? null : STRATEGY_PERCENTAGES[strategy];
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface AttemptPlanRequest {
  readonly lift: PlatformLift;
  /** `M`. Confirmed by the lifter before it gets here -- see §7. */
  readonly meetDayMaximumKilograms: number;
  readonly goal: MeetGoal;
  /** Required when the goal is `custom`, ignored otherwise. */
  readonly customPercentages?: StrategyPercentages | undefined;
  /** §8.1's hard ceiling: a weight the lifter will not go above whatever the table says. */
  readonly ceilingKilograms?: number | null | undefined;
  /** §8.1's custom jump limits, in kilograms, applied to every gap after the opener. */
  readonly minimumJumpKilograms?: number | null | undefined;
  readonly maximumJumpKilograms?: number | null | undefined;
  /**
   * §8.2's opt-in comparison group. Omitted means declined, which is a supported
   * answer: the plan still comes back, with general guidance labelled as such.
   */
  readonly population?: JumpPopulation | undefined;
}

/** The comparison a request that said nothing gets. Declined, and honest about it. */
const DECLINED_COMPARISON: JumpPopulation = {
  comparison: 'none',
  equipment: 'raw',
  ruleset: 'other',
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Why a weight is not the percentage that asked for it.
 *
 * §9.1 requires the tool to "show clearly when rounding has changed the original
 * target", which needs more than a flag: a lifter looking at 97.5 kg where the
 * table said 98 kg is owed the reason, because one of these reasons is theirs to
 * change and the others are not.
 */
export type RoundingReason =
  /** §9.1's default direction for an opener, and the reason it is never the other way. */
  | 'opener-rounds-down'
  /** The target fell between two legal weights and the nearer one won. */
  | 'nearest-legal-weight'
  /** Rounding up would have moved the attempt into a more aggressive risk label. */
  | 'rounding-up-would-raise-the-risk'
  /** The federation's minimum progression put a floor under it. */
  | 'minimum-progression'
  /** §8.1's hard ceiling. */
  | 'hard-ceiling'
  /** §8.1's custom maximum jump. */
  | 'maximum-jump'
  /** §8.1's custom minimum jump. */
  | 'minimum-jump';

export interface RoundingNote {
  readonly direction: 'down' | 'up';
  /** How far the weight moved from the percentage target. Always positive. */
  readonly kilograms: number;
  /** Every reason that applied, per §5.5 -- a ceiling and an increment can both bite. */
  readonly reasons: readonly RoundingReason[];
  readonly message: string;
}

export interface PlannedAttempt {
  readonly attemptNumber: 1 | 2 | 3;
  /** A legal weight under the profile this was planned against. */
  readonly kilograms: number;
  /** What the percentage asked for, before anything made it legal. */
  readonly targetKilograms: number;
  /** What the *planned* weight is as a share of `M`, not what the target was. */
  readonly percentOfMaximum: number;
  readonly band: PercentBand;
  readonly risk: AttemptRisk;
  /** `null` when the target was already a legal weight and nothing moved it. */
  readonly rounding: RoundingNote | null;
  /** The gap up from the attempt before. `null` for the opener. */
  readonly jumpKilograms: number | null;
  readonly jumpPercentOfMaximum: number | null;
  /**
   * Whether this is a scenario rather than a decision.
   *
   * §9: "The planned third is a scenario, not a commitment. It should be
   * recalculated after the second attempt." So it is a per-attempt fact rather
   * than a constant -- live mode settles the first two and leaves this one true,
   * and an interface written against it keeps working when that happens.
   */
  readonly provisional: boolean;
}

export interface AttemptPlan {
  readonly lift: PlatformLift;
  readonly meetDayMaximumKilograms: number;
  readonly goal: MeetGoal;
  readonly strategy: PlanStrategy;
  readonly percentages: StrategyPercentages;
  readonly attempts: readonly [PlannedAttempt, PlannedAttempt, PlannedAttempt];
  /** §9.2 and §9.3's guardrails on the gaps. Never a refusal. */
  readonly advisories: readonly JumpAdvisory[];
  /** The sum of the three planned weights, which §17 measures targets against. */
  readonly plannedSubtotalKilograms: number;
  /** §30: the saved document records which reading produced it. */
  readonly methodologyVersion: string;
}

export type AttemptPlanProblemCode =
  | 'maximum-is-not-a-weight'
  | 'custom-percentages-missing'
  | 'percentage-band-inverted'
  | 'percentages-out-of-order'
  | 'ceiling-is-not-a-weight'
  /** A ceiling below the opener cannot be a three-attempt plan at all. */
  | 'ceiling-below-the-opener'
  | 'jump-limit-is-not-a-weight'
  | 'jump-limits-contradict'
  | 'no-legal-opener'
  | 'limits-leave-no-legal-weight';

export interface AttemptPlanProblem {
  readonly code: AttemptPlanProblemCode;
  readonly message: string;
  /** Which attempt could not be placed, where the problem is about one. */
  readonly attemptNumber?: 1 | 2 | 3;
}

export type AttemptPlanResult =
  | { readonly ok: true; readonly plan: AttemptPlan }
  | { readonly ok: false; readonly problems: readonly AttemptPlanProblem[] };

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface PlacedWeight {
  readonly kilograms: number;
  readonly reasons: readonly RoundingReason[];
}

/**
 * Turn a confirmed maximum into three legal attempts.
 *
 * `rules` is the federation profile the meet runs under. Every increment, floor
 * and legality question goes through it, so a rulebook revision changes the plan
 * without changing this file -- which is the arrangement §15 asks for and the
 * reason there is no "universal" default profile anywhere in the collection.
 */
export function planAttempts(rules: MeetRules, request: AttemptPlanRequest): AttemptPlanResult {
  const problems: AttemptPlanProblem[] = [];
  const maximum = request.meetDayMaximumKilograms;

  if (!Number.isFinite(maximum) || maximum <= 0) {
    problems.push({
      code: 'maximum-is-not-a-weight',
      message: 'The planning maximum must be a weight above zero.',
    });
  }

  const strategy = strategyForGoal(request.goal);
  const percentages = strategy === 'custom' ? request.customPercentages : percentagesFor(strategy);
  if (percentages === undefined || percentages === null) {
    problems.push({
      code: 'custom-percentages-missing',
      message: 'A custom goal has to supply its own opener, second and third percentages.',
    });
  } else {
    checkPercentages(percentages, problems);
  }

  const ceiling = request.ceilingKilograms ?? null;
  if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling <= 0)) {
    problems.push({
      code: 'ceiling-is-not-a-weight',
      message: 'A hard ceiling must be a weight above zero.',
    });
  }

  const minimumJump = request.minimumJumpKilograms ?? null;
  const maximumJump = request.maximumJumpKilograms ?? null;
  for (const limit of [minimumJump, maximumJump]) {
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
      problems.push({
        code: 'jump-limit-is-not-a-weight',
        message: 'A jump limit must be a weight above zero.',
      });
    }
  }
  if (minimumJump !== null && maximumJump !== null && minimumJump > maximumJump) {
    problems.push({
      code: 'jump-limits-contradict',
      message: 'The smallest jump asked for is larger than the largest jump allowed.',
    });
  }

  if (problems.length > 0 || percentages === undefined || percentages === null) {
    return { ok: false, problems };
  }

  // --- The opener. §9.1: down, always. -------------------------------------
  const openerTarget = (maximum * percentages.opener.lowPercent) / 100;
  if (ceiling !== null && ceiling < openerTarget - SAME_WEIGHT_SLACK) {
    // Not a ceiling the opener can be capped at. Every later attempt has to clear
    // the one before it by at least a progression, so a ceiling below the opener
    // leaves nowhere for the second to go -- reported here, in the lifter's own
    // terms, rather than several steps later as an unplaceable second attempt
    // with a message about increments.
    return {
      ok: false,
      problems: [
        {
          code: 'ceiling-below-the-opener',
          attemptNumber: 1,
          message: `The ceiling of ${describeKilograms(ceiling)} is below the opener this plan asks for, so there is no room for three rising attempts underneath it. Lower the planning maximum or raise the ceiling.`,
        },
      ],
    };
  }
  const openerWeight = rules.floorToLegal(openerTarget);
  if (openerWeight <= 0) {
    return {
      ok: false,
      problems: [
        {
          code: 'no-legal-opener',
          message:
            'There is no legal weight at or below the opener the plan asks for. The planning maximum is lighter than the lightest weight the bar can be loaded to.',
          attemptNumber: 1,
        },
      ],
    };
  }
  const openerReasons: RoundingReason[] = [];
  if (!isSameWeight(openerWeight, openerTarget)) {
    openerReasons.push('opener-rounds-down');
  }

  const opener = describeAttempt({
    attemptNumber: 1,
    lift: request.lift,
    maximum,
    target: openerTarget,
    band: percentages.opener,
    placed: { kilograms: openerWeight, reasons: openerReasons },
    previousKilograms: null,
    provisional: false,
  });

  // --- The second and the planned third. -----------------------------------
  // Written out rather than looped so that neither step can be reached without
  // the attempt before it in hand: the federation's floor is a function of what
  // has already been planned, and an index into a growing array would make that
  // dependency something the type checker cannot see.
  const place = (
    attemptNumber: 2 | 3,
    cell: PercentBand,
    previous: PlannedAttempt,
    earlier: readonly PlannedAttempt[],
  ):
    | { readonly ok: true; readonly attempt: PlannedAttempt }
    | { readonly ok: false; readonly problem: AttemptPlanProblem } => {
    const placed = placeLaterAttempt({
      rules,
      lift: request.lift,
      attemptNumber,
      maximum,
      band: cell,
      previous,
      ceiling,
      minimumJump,
      maximumJump,
      earlier,
    });
    if (!placed.ok) return placed;
    return {
      ok: true,
      attempt: describeAttempt({
        attemptNumber,
        lift: request.lift,
        maximum,
        target: (maximum * cell.lowPercent) / 100,
        band: cell,
        placed: placed.placed,
        previousKilograms: previous.kilograms,
        provisional: attemptNumber === 3,
      }),
    };
  };

  const second = place(2, percentages.second, opener, [opener]);
  if (!second.ok) return { ok: false, problems: [second.problem] };
  const third = place(3, percentages.third, second.attempt, [opener, second.attempt]);
  if (!third.ok) return { ok: false, problems: [third.problem] };

  const advisories = reviewJumps(
    {
      lift: request.lift,
      meetDayMaximumKilograms: maximum,
      openerKilograms: opener.kilograms,
      secondKilograms: second.attempt.kilograms,
      thirdKilograms: third.attempt.kilograms,
    },
    request.population ?? DECLINED_COMPARISON,
  );

  return {
    ok: true,
    plan: {
      lift: request.lift,
      meetDayMaximumKilograms: maximum,
      goal: request.goal,
      strategy,
      percentages,
      attempts: [opener, second.attempt, third.attempt],
      advisories,
      plannedSubtotalKilograms:
        opener.kilograms + second.attempt.kilograms + third.attempt.kilograms,
      methodologyVersion: ATTEMPT_PLAN_METHODOLOGY_VERSION,
    },
  };
}

function checkPercentages(percentages: StrategyPercentages, problems: AttemptPlanProblem[]): void {
  const cells = [
    { name: 'opener', cell: percentages.opener },
    { name: 'second attempt', cell: percentages.second },
    { name: 'third attempt', cell: percentages.third },
  ];
  for (const { name, cell } of cells) {
    if (
      !Number.isFinite(cell.lowPercent) ||
      !Number.isFinite(cell.highPercent) ||
      cell.lowPercent <= 0 ||
      cell.highPercent < cell.lowPercent
    ) {
      problems.push({
        code: 'percentage-band-inverted',
        message: `The ${name} percentage range runs backwards or is not a percentage.`,
      });
    }
  }
  if (
    percentages.opener.lowPercent >= percentages.second.lowPercent ||
    percentages.second.lowPercent >= percentages.third.lowPercent
  ) {
    // Not merely untidy. Three attempts that do not ascend cannot be made legal
    // at all under a rising bar, and the failure would otherwise surface as an
    // unplaceable second attempt with a message about increments.
    problems.push({
      code: 'percentages-out-of-order',
      message: 'The opener, second and third percentages have to increase in that order.',
    });
  }
}

interface LaterAttemptQuery {
  readonly rules: MeetRules;
  readonly lift: PlatformLift;
  readonly attemptNumber: 2 | 3;
  readonly maximum: number;
  readonly band: PercentBand;
  readonly previous: PlannedAttempt;
  readonly ceiling: number | null;
  readonly minimumJump: number | null;
  readonly maximumJump: number | null;
  readonly earlier: readonly PlannedAttempt[];
}

type LaterAttemptResult =
  | { readonly ok: true; readonly placed: PlacedWeight }
  | { readonly ok: false; readonly problem: AttemptPlanProblem };

/**
 * Where an attempt after the opener lands.
 *
 * §9.1 in one function, and the order of the two halves is the point. First the
 * target is rounded to the *nearest* legal weight -- an opener rounds down but a
 * later attempt should not be dragged half an increment lighter every time --
 * except where rounding up would move it into a more aggressive risk label, which
 * is §9.1's "never let upward rounding silently turn a conservative attempt into
 * an aggressive attempt" stated in terms of the scale §10.2 defines. Then the
 * floors and ceilings clamp it, and every one that bit is recorded.
 */
function placeLaterAttempt(query: LaterAttemptQuery): LaterAttemptResult {
  const { rules, maximum, band: cell, previous } = query;
  const target = (maximum * cell.lowPercent) / 100;
  const reasons: RoundingReason[] = [];

  const around = rules.legalWeightsAround(target);
  let candidate = around.nearest;
  if (candidate > target + SAME_WEIGHT_SLACK) {
    const targetRisk = classifyAttemptRisk({
      lift: query.lift,
      attemptNumber: query.attemptNumber,
      kilograms: target,
      meetDayMaximumKilograms: maximum,
    });
    const candidateRisk = classifyAttemptRisk({
      lift: query.lift,
      attemptNumber: query.attemptNumber,
      kilograms: candidate,
      meetDayMaximumKilograms: maximum,
    });
    if (isRiskierThan(candidateRisk, targetRisk) && around.below !== null) {
      candidate = around.below;
      reasons.push('rounding-up-would-raise-the-risk');
    }
  }
  if (reasons.length === 0 && !isSameWeight(candidate, target)) {
    reasons.push('nearest-legal-weight');
  }

  // The federation's own floor. Modelled as `good` outcomes because that is what
  // a plan is: the scenario in which the attempts before this one were made. A
  // missed attempt raises the floor further, and that is live mode's job (§11).
  const taken: TakenAttempt[] = query.earlier.map((attempt) => ({
    attemptNumber: attempt.attemptNumber,
    kilograms: attempt.kilograms,
    outcome: 'good',
  }));
  const bounds = rules.nextAttemptBounds(taken);

  const jumpFloor = query.minimumJump === null ? null : previous.kilograms + query.minimumJump;
  const jumpCap = query.maximumJump === null ? null : previous.kilograms + query.maximumJump;

  const rawFloor = Math.max(bounds.minimumKilograms, jumpFloor ?? Number.NEGATIVE_INFINITY);
  const rawCap = Math.min(
    query.ceiling ?? Number.POSITIVE_INFINITY,
    jumpCap ?? Number.POSITIVE_INFINITY,
  );
  const legalFloor = rules.ceilToLegal(rawFloor);
  const legalCap = Number.isFinite(rawCap) ? rules.floorToLegal(rawCap) : Number.POSITIVE_INFINITY;

  if (legalCap < legalFloor - SAME_WEIGHT_SLACK) {
    return {
      ok: false,
      problem: {
        code: 'limits-leave-no-legal-weight',
        attemptNumber: query.attemptNumber,
        message: `Attempt ${query.attemptNumber} has no legal weight left: the lightest the federation allows after ${describeKilograms(previous.kilograms)} is ${describeKilograms(legalFloor)}, which is above the ${describeKilograms(legalCap)} the ceiling and jump limits allow.`,
      },
    };
  }

  let weight = candidate;
  if (weight < legalFloor - SAME_WEIGHT_SLACK) {
    weight = legalFloor;
    // A clamp supersedes the rounding that produced the candidate: the weight on
    // screen is not where the nearest legal weight was, and saying it rounded to
    // the nearest one would send a lifter looking for arithmetic that did not
    // happen. Which floor bound bit is what they can act on, and both can bind at
    // once, so both are reported (§5.5).
    reasons.length = 0;
    if (jumpFloor !== null && jumpFloor >= bounds.minimumKilograms) {
      reasons.push('minimum-jump');
    }
    if (bounds.minimumKilograms >= (jumpFloor ?? Number.NEGATIVE_INFINITY)) {
      reasons.push('minimum-progression');
    }
  } else if (weight > legalCap + SAME_WEIGHT_SLACK) {
    weight = legalCap;
    reasons.length = 0;
    if (jumpCap !== null && jumpCap <= (query.ceiling ?? Number.POSITIVE_INFINITY)) {
      reasons.push('maximum-jump');
    }
    if (query.ceiling !== null && query.ceiling <= (jumpCap ?? Number.POSITIVE_INFINITY)) {
      reasons.push('hard-ceiling');
    }
  }

  return { ok: true, placed: { kilograms: weight, reasons } };
}

interface AttemptDescription {
  readonly attemptNumber: 1 | 2 | 3;
  readonly lift: PlatformLift;
  readonly maximum: number;
  readonly target: number;
  readonly band: PercentBand;
  readonly placed: PlacedWeight;
  readonly previousKilograms: number | null;
  readonly provisional: boolean;
}

function describeAttempt(description: AttemptDescription): PlannedAttempt {
  const { placed, target, maximum } = description;
  const moved = placed.kilograms - target;
  const rounding: RoundingNote | null = isSameWeight(placed.kilograms, target)
    ? null
    : {
        direction: moved < 0 ? 'down' : 'up',
        kilograms: Math.abs(moved),
        reasons: placed.reasons,
        message: roundingMessage(
          target,
          placed.kilograms,
          moved < 0 ? 'down' : 'up',
          placed.reasons,
        ),
      };

  const jump =
    description.previousKilograms === null
      ? null
      : placed.kilograms - description.previousKilograms;

  return {
    attemptNumber: description.attemptNumber,
    kilograms: placed.kilograms,
    targetKilograms: target,
    percentOfMaximum: (placed.kilograms / maximum) * 100,
    band: description.band,
    risk: classifyAttemptRisk({
      lift: description.lift,
      attemptNumber: description.attemptNumber,
      kilograms: placed.kilograms,
      meetDayMaximumKilograms: maximum,
    }),
    rounding,
    jumpKilograms: jump,
    jumpPercentOfMaximum: jump === null ? null : (jump / maximum) * 100,
    provisional: description.provisional,
  };
}

const REASON_CLAUSES: Readonly<Record<RoundingReason, string>> = {
  'opener-rounds-down': 'an opener is rounded down so it stays the attempt it was meant to be',
  'nearest-legal-weight': 'the target fell between two weights the bar can be loaded to',
  'rounding-up-would-raise-the-risk':
    'rounding up would have made it a more aggressive attempt than the plan asked for',
  'minimum-progression': 'the federation requires a larger increase than that',
  'hard-ceiling': 'it is capped by the ceiling you set',
  'maximum-jump': 'it is capped by the largest jump you allowed',
  'minimum-jump': 'it is raised to the smallest jump you asked for',
};

function roundingMessage(
  target: number,
  weight: number,
  direction: 'down' | 'up',
  reasons: readonly RoundingReason[],
): string {
  const head = `Rounded ${direction} from ${describeKilograms(target)} to ${describeKilograms(weight)}`;
  const clauses = reasons.map((reason) => REASON_CLAUSES[reason]);
  // §9.1 asks for the change to be shown clearly, and a bare "rounded" is not
  // clear -- the reason is what tells a lifter whether it is theirs to change.
  return clauses.length === 0 ? `${head}.` : `${head}: ${clauses.join('; ')}.`;
}
