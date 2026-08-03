// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the lifter typed, plus a federation's rules, turned into a plan a screen
 * can render without deciding anything.
 *
 * The counterpart of tool 1's `report.ts`: pure, no DOM, no storage, no network.
 * `session.ts` holds the answers, this file asks the domain what they mean, and
 * `view.ts` is the only file that knows a transport exists. Everything below
 * takes the result as a property, which is what lets every state on this screen
 * -- a withheld estimate, a ceiling under the opener, a target nobody can reach
 * -- be reached from a story with nothing behind it.
 *
 * FIVE METHODS, ONE SHAPE
 *
 * §7's five ways in produce different intermediate things -- an estimate, an
 * implied maximum, a proportional split -- and exactly one final thing: three
 * attempts on a bar with a risk label each. So `LiftPlanView` is the same shape
 * for all five, and what differs between them is which of its optional fields
 * are filled. A screen written against it does not branch on the method to draw
 * the plan; it branches only to draw the working.
 *
 * NOTHING HERE INVENTS A MISSING ANSWER
 *
 * Every figure arrives as a `FieldReading`, which distinguishes "nothing typed
 * yet" from "typed something wrong", and both from a number. That three-way runs
 * all the way through: a lift with nothing typed reports `awaiting: true` and no
 * problems, because an empty form is not a mistake and a screen that says so on
 * first paint is a screen that opens by telling the lifter off.
 *
 * The same rule governs the derived answers. Manual entry has no planning
 * maximum in it unless the lifter volunteered one, so `risk` is `null` rather
 * than a label -- `classifyAttemptRisk` is total and grades a missing maximum as
 * a Long Shot, which is the right answer for the domain and a fabricated warning
 * on a screen. §10.2's four words are a claim about the lifter, and there is
 * nothing to base one on.
 *
 * RISK AND DATA CONFIDENCE STAY TWO AXES
 *
 * §10 is explicit that these "must not be combined into one misleading score",
 * so they are not combined here either: `AttemptView.risk` is per attempt and
 * `LiftPlanView.confidence` is per lift, they are computed from disjoint inputs,
 * and no field anywhere in this module is a function of both. No probability
 * appears in any of it, per §10.2.
 */
import type { ConversionChart } from '@platform-toolkit/domain';
import {
  assessDataConfidence,
  attemptWeightFor,
  classifyAttemptRisk,
  convertWeight,
  defaultRoundingIncrement,
  distributeTargetTotal,
  estimateOneRepMax,
  planAttempts,
  planFromOpener,
  reviewJumps,
  type AttemptPlanProblemCode,
  type AttemptRefusalCode,
  type AttemptRisk,
  type AttemptWeight,
  type DataConfidenceAssessment,
  type EstimateLift,
  type JumpAdvisory,
  type JumpPopulation,
  type MeetRules,
  type OneRepMaxEstimate,
  type OneRepMaxProblemCode,
  type OpenerPlanNote,
  type OpenerPlanProblemCode,
  type Readiness,
  type RoundingNote,
  type TargetTotalProblemCode,
  type TargetTotalProposal,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import {
  GUIDED_REPS_MAX,
  PRIOR_MEETS_MAX,
  allConfirmed,
  asBoolean,
  evidenceAgeFor,
  maximumSourceFor,
  parseCount,
  parseWeight,
  researchEquipmentFor,
  sessionLifts,
  type Answer,
  type FieldReading,
  type LiftFigures,
  type PlannerSession,
} from './session.js';

/*
 * ---------------------------------------------------------------------------
 * The shape a screen renders.
 * ---------------------------------------------------------------------------
 */

/**
 * Everything that can go wrong, from wherever it came from.
 *
 * The domain's four problem vocabularies are unioned rather than flattened to
 * strings, so a screen that wants to say something particular about, say, a
 * ceiling under the opener can match on the code and still be checked by the
 * compiler when the domain renames one.
 */
export type PlanProblemCode =
  | AttemptPlanProblemCode
  | OneRepMaxProblemCode
  | OpenerPlanProblemCode
  | TargetTotalProblemCode
  /** A field on this screen holds something that is not a number. */
  | 'field-is-not-a-number';

export interface PlanProblem {
  readonly code: PlanProblemCode;
  /**
   * The domain's own sentence, where it wrote one, and `null` where the code is
   * the whole answer -- `OneRepMaxProblem` carries no message, and tool 3 writes
   * those sentences in its own `copy.ts`. Kept nullable rather than filled in
   * here so that the two tools cannot end up describing the same refusal in two
   * slightly different ways; a screen renders the message when there is one and
   * looks the code up when there is not.
   */
  readonly message: string | null;
}

export interface AttemptView {
  readonly attemptNumber: 1 | 2 | 3;
  /** Kilograms, and what the federation's chart prints in pounds (§16). */
  readonly weight: AttemptWeight;
  /**
   * §10.2's label, or `null` where there is no confirmed maximum to measure
   * against. Only Manual entry can produce `null`.
   */
  readonly risk: AttemptRisk | null;
  /** §9.1: `null` when the target was already a legal weight. */
  readonly rounding: RoundingNote | null;
  /** The gap up from the attempt before. `null` for the opener. */
  readonly jumpKilograms: number | null;
  /** §9: the planned third is a scenario, not a commitment. */
  readonly provisional: boolean;
  /**
   * Why the federation's rules refuse this weight. Always empty for a planned
   * attempt, which is generated legal; only Manual entry can fill it.
   */
  readonly refusals: readonly AttemptRefusalCode[];
}

export interface LiftPlanView {
  readonly lift: PlatformLift;
  /** `M`, in kilograms. `null` where the method has not produced one yet. */
  readonly maximumKilograms: number | null;
  /** Three attempts, or none. Never one or two. */
  readonly attempts: readonly AttemptView[];
  /** §9.2 and §9.3. Never a refusal, and never a reason to withhold the plan. */
  readonly advisories: readonly JumpAdvisory[];
  /** §10.1, computed from the evidence and from nothing about the attempts. */
  readonly confidence: DataConfidenceAssessment;
  readonly problems: readonly PlanProblem[];
  /** §7.3's working: what the opener implies, and whether it fits the ceiling. */
  readonly openerNotes: readonly OpenerPlanNote[];
  /** §7.2's working: the estimate the lifter is being asked to confirm. */
  readonly estimate: OneRepMaxEstimate | null;
  /** The sum of the three planned weights. `null` without a plan. */
  readonly subtotalKilograms: number | null;
  /** Nothing is wrong; the lifter simply has not typed enough yet. */
  readonly awaiting: boolean;
  /** A figure is on screen and §7 is waiting for the lifter to agree to it. */
  readonly awaitingConfirmation: boolean;
}

export interface PlannerView {
  /** One entry per lift the meet contests, in platform order. */
  readonly lifts: readonly LiftPlanView[];
  /** §7.5's split. `null` under every other method. */
  readonly proposal: TargetTotalProposal | null;
  /** §7.5's refusals, which are about the target rather than about one lift. */
  readonly proposalProblems: readonly PlanProblem[];
  /** The sum of the planned thirds. `null` unless every contested lift has one. */
  readonly plannedTotalKilograms: number | null;
  /** The readiness the confidence grade was computed from, after §8.1's cut. */
  readonly readiness: Readiness;
  /** Every contested lift has three attempts on it. */
  readonly complete: boolean;
}

/**
 * The view of a session nobody has answered anything in.
 *
 * Exported so an element can default its `view` property to a real value rather
 * than to `null`, which would put a "there is no view yet" branch in every
 * template that reads one -- a branch reachable only by a wiring mistake, and
 * therefore one nothing tests. `buildPlan(EMPTY_SESSION, …)` would produce this
 * shape for every method, but it needs a `MeetRules` to do it, and requiring a
 * rule book to render an unanswered form is exactly the coupling the property
 * exists to avoid.
 */
export const EMPTY_VIEW: PlannerView = {
  lifts: [],
  proposal: null,
  proposalProblems: [],
  plannedTotalKilograms: null,
  readiness: 'unstated',
  complete: false,
};

/** What the plan is built against, beyond the lifter's own answers. */
export interface PlanContext {
  readonly rules: MeetRules;
  /**
   * The federation's published kilogram-to-pound chart, or `null` when it has
   * not loaded or the federation publishes none. Never computed -- §16 gives
   * that job to the chart, and `attemptWeightFor` says which case it is in.
   */
  readonly chart: ConversionChart | null;
}

/*
 * ---------------------------------------------------------------------------
 * Reading the fields.
 * ---------------------------------------------------------------------------
 */

/**
 * A reading in kilograms, whatever unit the screen is showing.
 *
 * Every domain entry point on this screen takes kilograms, because a competition
 * bar is loaded in them. Converting here rather than at each call site means the
 * conversion cannot be applied twice or forgotten once -- and forgetting it is
 * silent, since 200 lb is a perfectly plausible squat in kilograms.
 */
function readKilograms(text: string, unit: WeightUnit): FieldReading {
  const reading = parseWeight(text, unit);
  if (!reading.ok) return reading;
  if (unit === 'kg') return reading;
  return { ok: true, value: convertWeight({ amount: reading.value, unit }, 'kg').amount };
}

/** The value, or `null` for both "nothing typed" and "typed something wrong". */
function valueOf(reading: FieldReading): number | null {
  return reading.ok ? reading.value : null;
}

/**
 * Collects the problems from a set of readings, ignoring the empty ones.
 *
 * An untyped field is not a problem and must not read as one: §8's whole section
 * is optional, so a ceiling nobody set has to be indistinguishable from a screen
 * that was never scrolled to.
 */
function problemsIn(readings: readonly FieldReading[]): PlanProblem[] {
  const problems: PlanProblem[] = [];
  for (const reading of readings) {
    if (!reading.ok && reading.message !== null) {
      problems.push({ code: 'field-is-not-a-number', message: reading.message });
    }
  }
  return problems;
}

/*
 * ---------------------------------------------------------------------------
 * §8's optional information, as the domain wants it.
 * ---------------------------------------------------------------------------
 */

/**
 * §8.1's weight cut folded onto the readiness axis.
 *
 * The two questions are asked separately -- "how ready do you expect to be" and
 * "may a cut or a hard recovery affect this" -- and `ConfidenceEvidence` has one
 * slot, because a cut is not a second kind of readiness. It is the commonest
 * reason readiness is not normal.
 *
 * A declared cut therefore lifts an unstated or normal answer to `uncertain`,
 * and deliberately no further: the cut may go fine, and calling it `reduced`
 * would put the lifter in the worst band on a fact that is merely a risk. It
 * never *improves* a stated answer either -- a lifter who has already said their
 * readiness is reduced knows something the cut question does not ask about, and
 * raising them to `uncertain` on the strength of a checkbox would grade them
 * more confidently for having volunteered more.
 */
export function readinessWith(readiness: Readiness, hardCut: Answer): Readiness {
  if (hardCut !== 'yes') return readiness;
  return readiness === 'reduced' ? 'reduced' : 'uncertain';
}

/**
 * §8.2's comparison group as `reviewJumps` wants it.
 *
 * `ruleset` is `'other'` for every profile published today, and that is an
 * answer rather than a placeholder: §9.3's ranges come from raw IPF competition,
 * the profiles this tool ships against are not that, and the lower-evidence
 * label is exactly what the requirement asks for in that case. Nothing in
 * `MeetRuleProfile` says which ruleset it is, and inferring it from a profile
 * identifier would put a federation in source, which §5.1 forbids -- so when a
 * research-ruleset profile is ever published, the profile gains a field and this
 * function reads it rather than growing a list of names.
 */
export function populationFor(session: PlannerSession): JumpPopulation {
  return {
    comparison: session.extras.comparison,
    equipment: researchEquipmentFor(session.extras.equipment),
    ruleset: 'other',
  };
}

/** §10.1's evidence for one lift, gathered from wherever the lifter said it. */
function confidenceFor(session: PlannerSession, lift: PlatformLift): DataConfidenceAssessment {
  const figures = session.figures[lift];
  const priorMeets = parseCount(session.extras.priorMeets, 'prior meets', {
    min: 0,
    max: PRIOR_MEETS_MAX,
  });

  return assessDataConfidence({
    maximumSource: maximumSourceFor(session, lift),
    evidenceAge: evidenceAgeFor(session, lift),
    openerTestedInTraining: asBoolean(figures.openerTested),
    equipmentMatchesMeet: asBoolean(figures.guided.sameEquipment),
    priorMeets: valueOf(priorMeets),
    readiness: readinessWith(session.extras.readiness, session.extras.hardCut),
    // §10.1's Medium condition. A described effort is a reps-in-reserve figure
    // the lifter actually chose, so `unknown` -- the default nobody touched --
    // is not one, and neither is a maximum typed with no set behind it at all.
    effortDescribed:
      session.setup.method === 'guided-estimate' && figures.guided.repsInReserve !== 'unknown',
  });
}

/*
 * ---------------------------------------------------------------------------
 * §7.2's estimate.
 * ---------------------------------------------------------------------------
 */

const ESTIMATE_LIFT_FOR: Readonly<Record<PlatformLift, EstimateLift>> = {
  squat: 'squat',
  bench: 'bench-press',
  deadlift: 'deadlift',
};

interface GuidedOutcome {
  readonly estimate: OneRepMaxEstimate | null;
  readonly kilograms: number | null;
  readonly problems: readonly PlanProblem[];
  readonly awaiting: boolean;
}

/**
 * §7.2: a recent set run through the toolkit's own estimator.
 *
 * Three of the estimator's inputs are declined rather than guessed, and each for
 * the same reason -- the planner never asked, and a plausible default here is a
 * figure the lifter would have to notice was wrong:
 *
 * - `sex` is `null`, and specifically is *not* §8.2's comparison group. That is
 *   an opt-in about which population's jump ranges to compare against, chosen on
 *   a different screen for a different purpose; feeding it into a strength model
 *   would make one answer quietly change two things, and a lifter who picked a
 *   comparison to read the jump warnings would have moved their planning maximum.
 * - `experience` is `null` rather than derived from §8.1's meet count. How long
 *   somebody has trained and how many meets they have done are different facts,
 *   and a lifter can have twenty years of training and one platform.
 * - `assisted` is `false` because a spotter taking part of the bar withholds the
 *   estimate entirely, and nobody was asked. `false` is what "the lifter did not
 *   say a spotter helped" means; `true` would refuse to answer a question they
 *   did not know they had failed.
 *
 * The confirmed maximum is the rounded middle figure and not the unrounded one,
 * because that is the number on screen with a tick beside it. Planning off a
 * figure the lifter never saw makes the plan disagree with its own working by a
 * fraction of a kilogram, which reads as a bug in whichever of the two the
 * lifter checks second.
 */
function estimateFor(session: PlannerSession, lift: PlatformLift): GuidedOutcome {
  const { unit } = session.setup;
  const guided = session.figures[lift].guided;
  const weight = parseWeight(guided.weight, unit);
  const reps = parseCount(guided.reps, 'repetitions', { max: GUIDED_REPS_MAX });
  const problems = problemsIn([weight, reps]);

  if (!weight.ok || !reps.ok) {
    return { estimate: null, kilograms: null, problems, awaiting: problems.length === 0 };
  }

  const result = estimateOneRepMax({
    weight: { amount: weight.value, unit },
    completedReps: reps.value,
    repsInReserve: guided.repsInReserve,
    lift: ESTIMATE_LIFT_FOR[lift],
    techniqueId: null,
    sex: null,
    experience: null,
    freshness: 'unstated',
    formQuality: 'unstated',
    assisted: false,
    displayUnit: unit,
    roundTo: defaultRoundingIncrement(unit),
  });

  if (!result.ok) {
    return {
      estimate: null,
      kilograms: null,
      problems: [
        ...problems,
        ...result.problems.map((problem) => ({ code: problem.code, message: null })),
      ],
      awaiting: false,
    };
  }

  const { estimate } = result;
  const shown =
    estimate.kind === 'observed-single'
      ? estimate.observed
      : estimate.kind === 'estimated'
        ? estimate.toolkit
        : null;

  return {
    estimate,
    kilograms: shown === null ? null : convertWeight(shown, 'kg').amount,
    problems,
    awaiting: false,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Building one lift.
 * ---------------------------------------------------------------------------
 */

/** The §8.1 limits, which every method passes through unchanged. */
interface Limits {
  readonly ceilingKilograms: number | null;
  readonly minimumJumpKilograms: number | null;
  readonly maximumJumpKilograms: number | null;
  readonly problems: readonly PlanProblem[];
}

function limitsFor(session: PlannerSession, figures: LiftFigures): Limits {
  const { unit } = session.setup;
  const ceiling = readKilograms(figures.ceiling, unit);
  const minimum = readKilograms(session.extras.minimumJump, unit);
  const maximum = readKilograms(session.extras.maximumJump, unit);
  return {
    ceilingKilograms: valueOf(ceiling),
    minimumJumpKilograms: valueOf(minimum),
    maximumJumpKilograms: valueOf(maximum),
    problems: problemsIn([ceiling, minimum, maximum]),
  };
}

function viewOf(
  context: PlanContext,
  attempt: {
    readonly attemptNumber: 1 | 2 | 3;
    readonly kilograms: number;
    readonly risk: AttemptRisk | null;
    readonly rounding: RoundingNote | null;
    readonly jumpKilograms: number | null;
    readonly provisional: boolean;
    readonly refusals: readonly AttemptRefusalCode[];
  },
): AttemptView {
  return {
    attemptNumber: attempt.attemptNumber,
    weight: attemptWeightFor(attempt.kilograms, context.chart),
    risk: attempt.risk,
    rounding: attempt.rounding,
    jumpKilograms: attempt.jumpKilograms,
    provisional: attempt.provisional,
    refusals: attempt.refusals,
  };
}

/** An empty lift, which is also what every failure falls back to. */
function emptyLift(
  session: PlannerSession,
  lift: PlatformLift,
  parts: {
    readonly problems?: readonly PlanProblem[];
    readonly openerNotes?: readonly OpenerPlanNote[];
    readonly estimate?: OneRepMaxEstimate | null;
    readonly maximumKilograms?: number | null;
    readonly awaiting?: boolean;
    readonly awaitingConfirmation?: boolean;
  } = {},
): LiftPlanView {
  return {
    lift,
    maximumKilograms: parts.maximumKilograms ?? null,
    attempts: [],
    advisories: [],
    confidence: confidenceFor(session, lift),
    problems: parts.problems ?? [],
    openerNotes: parts.openerNotes ?? [],
    estimate: parts.estimate ?? null,
    subtotalKilograms: null,
    awaiting: parts.awaiting ?? false,
    awaitingConfirmation: parts.awaitingConfirmation ?? false,
  };
}

/**
 * The four methods that end in `planAttempts`, once a maximum exists.
 *
 * Expected Max, Guided Estimate and Target Total all reach here; they differ
 * only in where `maximumKilograms` came from and in what working they show
 * beside it. Known Opener and Manual do not, because neither starts from a
 * maximum -- one inverts to find it and the other never has one.
 */
function planFromMaximum(
  session: PlannerSession,
  context: PlanContext,
  lift: PlatformLift,
  maximumKilograms: number,
  extra: {
    readonly problems: readonly PlanProblem[];
    readonly estimate?: OneRepMaxEstimate | null;
  },
): LiftPlanView {
  const limits = limitsFor(session, session.figures[lift]);
  const result = planAttempts(context.rules, {
    lift,
    meetDayMaximumKilograms: maximumKilograms,
    goal: session.setup.goal,
    ceilingKilograms: limits.ceilingKilograms,
    minimumJumpKilograms: limits.minimumJumpKilograms,
    maximumJumpKilograms: limits.maximumJumpKilograms,
    population: populationFor(session),
  });

  const problems = [...extra.problems, ...limits.problems];
  if (!result.ok) {
    return emptyLift(session, lift, {
      maximumKilograms,
      estimate: extra.estimate ?? null,
      problems: [...problems, ...result.problems],
    });
  }

  const { plan } = result;
  return {
    lift,
    maximumKilograms,
    attempts: plan.attempts.map((attempt) =>
      viewOf(context, {
        attemptNumber: attempt.attemptNumber,
        kilograms: attempt.kilograms,
        risk: attempt.risk,
        rounding: attempt.rounding,
        jumpKilograms: attempt.jumpKilograms,
        provisional: attempt.provisional,
        refusals: [],
      }),
    ),
    advisories: plan.advisories,
    confidence: confidenceFor(session, lift),
    problems,
    openerNotes: [],
    estimate: extra.estimate ?? null,
    subtotalKilograms: plan.plannedSubtotalKilograms,
    awaiting: false,
    awaitingConfirmation: false,
  };
}

/** §7.3: three attempts built back from a weight the lifter has already chosen. */
function planKnownOpener(
  session: PlannerSession,
  context: PlanContext,
  lift: PlatformLift,
): LiftPlanView {
  const figures = session.figures[lift];
  const opener = readKilograms(figures.opener, session.setup.unit);
  const limits = limitsFor(session, figures);
  const problems = [...problemsIn([opener]), ...limits.problems];

  // A ceiling is optional everywhere else and required here: the method has no
  // maximum to bound the third against, so without one there is nothing to stop
  // the plan at. Asking for it is better than inventing a multiple of the opener.
  if (!opener.ok || limits.ceilingKilograms === null) {
    return emptyLift(session, lift, { problems, awaiting: problems.length === 0 });
  }

  const result = planFromOpener(context.rules, {
    lift,
    openerKilograms: opener.value,
    ceilingKilograms: limits.ceilingKilograms,
    goal: session.setup.goal,
    minimumJumpKilograms: limits.minimumJumpKilograms,
    maximumJumpKilograms: limits.maximumJumpKilograms,
    population: populationFor(session),
  });

  if (!result.ok) {
    return emptyLift(session, lift, { problems: [...problems, ...result.problems] });
  }

  const { plan, impliedMaximumKilograms, notes } = result.plan;
  return {
    lift,
    maximumKilograms: impliedMaximumKilograms,
    attempts: plan.attempts.map((attempt) =>
      viewOf(context, {
        attemptNumber: attempt.attemptNumber,
        kilograms: attempt.kilograms,
        risk: attempt.risk,
        rounding: attempt.rounding,
        jumpKilograms: attempt.jumpKilograms,
        provisional: attempt.provisional,
        refusals: [],
      }),
    ),
    advisories: plan.advisories,
    confidence: confidenceFor(session, lift),
    problems,
    openerNotes: notes,
    estimate: null,
    subtotalKilograms: plan.plannedSubtotalKilograms,
    awaiting: false,
    awaitingConfirmation: false,
  };
}

/**
 * §7.4: three weights the lifter typed, checked rather than generated.
 *
 * Every attempt is checked against the rules as though the ones before it were
 * good lifts, which is what makes the minimum progression bite between the first
 * and the second. Nothing is moved onto a legal weight: this is the one method
 * whose premise is that the lifter has decided, so an illegal weight is reported
 * where it was typed rather than quietly corrected into a plan they did not write.
 *
 * Risk and the jump advisories both need `M`, and Manual has no field for one.
 * Where the lifter volunteered an expected maximum anyway -- the field is on
 * screen under §8.3 and is kept for every method -- both are computed from it;
 * where they did not, `risk` is `null` on every attempt and `reviewJumps` is not
 * called at all. §9.2's anchors are percentages of `M`, so without one there is
 * no gap to be wide *of*.
 */
function planManual(
  session: PlannerSession,
  context: PlanContext,
  lift: PlatformLift,
): LiftPlanView {
  const { unit } = session.setup;
  const figures = session.figures[lift];
  const readings = figures.attempts.map((text) => readKilograms(text, unit));
  const maximum = readKilograms(figures.expectedMaximum, unit);
  const problems = problemsIn([...readings, maximum]);

  const weights: number[] = [];
  for (const reading of readings) {
    if (!reading.ok) break;
    weights.push(reading.value);
  }
  if (weights.length < readings.length) {
    return emptyLift(session, lift, { problems, awaiting: problems.length === 0 });
  }

  const maximumKilograms = valueOf(maximum);
  const attempts: AttemptView[] = [];
  weights.forEach((kilograms, index) => {
    const attemptNumber = (index + 1) as 1 | 2 | 3;
    const taken = weights.slice(0, index).map((earlier, position) => ({
      attemptNumber: position + 1,
      kilograms: earlier,
      outcome: 'good' as const,
    }));
    const legality = context.rules.isLegalNextAttempt(taken, kilograms);
    const previous = weights[index - 1];

    attempts.push(
      viewOf(context, {
        attemptNumber,
        kilograms,
        risk:
          maximumKilograms === null
            ? null
            : classifyAttemptRisk({
                lift,
                attemptNumber,
                kilograms,
                meetDayMaximumKilograms: maximumKilograms,
              }),
        // Nothing rounded these: they are the weights the lifter typed.
        rounding: null,
        jumpKilograms: previous === undefined ? null : kilograms - previous,
        // §9's scenario rule holds however the third was arrived at.
        provisional: attemptNumber === 3,
        refusals: legality.legal ? [] : legality.reasons,
      }),
    );
  });

  const [opener, second, third] = weights;
  const advisories =
    maximumKilograms === null || opener === undefined || second === undefined || third === undefined
      ? []
      : reviewJumps(
          {
            lift,
            meetDayMaximumKilograms: maximumKilograms,
            openerKilograms: opener,
            secondKilograms: second,
            thirdKilograms: third,
          },
          populationFor(session),
        );

  return {
    lift,
    maximumKilograms,
    attempts,
    advisories,
    confidence: confidenceFor(session, lift),
    problems,
    openerNotes: [],
    estimate: null,
    subtotalKilograms: weights.reduce((sum, weight) => sum + weight, 0),
    awaiting: false,
    awaitingConfirmation: false,
  };
}

/*
 * ---------------------------------------------------------------------------
 * §7.5's split, which is about the meet rather than about one lift.
 * ---------------------------------------------------------------------------
 */

interface Split {
  readonly proposal: TargetTotalProposal | null;
  readonly problems: readonly PlanProblem[];
  readonly awaiting: boolean;
}

function splitTargetTotal(session: PlannerSession): Split {
  const { unit } = session.setup;
  const target = readKilograms(session.targetTotal, unit);
  const lifts = sessionLifts(session);

  const entries = lifts.map((lift) => {
    const figures = session.figures[lift];
    return {
      lift,
      expected: readKilograms(figures.expectedMaximum, unit),
      ceiling: readKilograms(figures.ceiling, unit),
    };
  });

  const problems = problemsIn([target, ...entries.flatMap((e) => [e.expected, e.ceiling])]);
  const expectations = entries.map((entry) => entry.expected);
  if (!target.ok || expectations.some((reading) => !reading.ok)) {
    return { proposal: null, problems, awaiting: problems.length === 0 };
  }

  const result = distributeTargetTotal({
    targetTotalKilograms: target.value,
    goal: session.setup.goal,
    lifts: entries.map((entry) => ({
      lift: entry.lift,
      // Checked above: every expectation read, or this function returned.
      expectedMaximumKilograms: entry.expected.ok ? entry.expected.value : 0,
      ceilingKilograms: valueOf(entry.ceiling),
    })),
  });

  if (!result.ok) {
    return { proposal: null, problems: [...problems, ...result.problems], awaiting: false };
  }
  return { proposal: result.proposal, problems, awaiting: false };
}

/*
 * ---------------------------------------------------------------------------
 * The whole screen.
 * ---------------------------------------------------------------------------
 */

/**
 * The plan, as far as the lifter's answers reach.
 *
 * Total: there is no state of the session this refuses to describe. A screen
 * calls it on every keystroke and renders whatever comes back, which is what
 * keeps "half typed" from being a case the interface has to invent an answer
 * for -- it is the same answer as "not typed", one field further along.
 */
export function buildPlan(session: PlannerSession, context: PlanContext): PlannerView {
  const lifts = sessionLifts(session);
  const split = session.setup.method === 'target-total' ? splitTargetTotal(session) : null;
  const gate = allConfirmed(session);

  const views = lifts.map((lift): LiftPlanView => {
    const figures = session.figures[lift];

    switch (session.setup.method) {
      case 'known-opener':
        return planKnownOpener(session, context, lift);

      case 'manual':
        return planManual(session, context, lift);

      case 'expected-max': {
        const maximum = readKilograms(figures.expectedMaximum, session.setup.unit);
        const problems = problemsIn([maximum]);
        if (!maximum.ok) {
          return emptyLift(session, lift, { problems, awaiting: problems.length === 0 });
        }
        if (!figures.confirmed) {
          return emptyLift(session, lift, {
            problems,
            maximumKilograms: maximum.value,
            awaitingConfirmation: true,
          });
        }
        return planFromMaximum(session, context, lift, maximum.value, { problems });
      }

      case 'guided-estimate': {
        const guided = estimateFor(session, lift);
        if (guided.kilograms === null) {
          return emptyLift(session, lift, {
            problems: guided.problems,
            estimate: guided.estimate,
            awaiting: guided.awaiting,
          });
        }
        if (!figures.confirmed) {
          return emptyLift(session, lift, {
            problems: guided.problems,
            estimate: guided.estimate,
            maximumKilograms: guided.kilograms,
            awaitingConfirmation: true,
          });
        }
        return planFromMaximum(session, context, lift, guided.kilograms, {
          problems: guided.problems,
          estimate: guided.estimate,
        });
      }

      case 'target-total': {
        // The split's problems belong to the target, not to any one lift, so
        // they are reported once on the view rather than three times over.
        const share = split?.proposal?.shares.find((entry) => entry.lift === lift) ?? null;
        if (share === null) {
          return emptyLift(session, lift, { awaiting: split?.awaiting ?? false });
        }
        if (!figures.confirmed) {
          return emptyLift(session, lift, {
            maximumKilograms: share.proposedMaximumKilograms,
            awaitingConfirmation: true,
          });
        }
        return planFromMaximum(session, context, lift, share.proposedMaximumKilograms, {
          problems: [],
        });
      }
    }
  });

  const thirds = views.map((view) => view.attempts[2]?.weight.kilograms);
  const plannedTotalKilograms = thirds.every((third) => third !== undefined)
    ? thirds.reduce((sum, third) => sum + third, 0)
    : null;

  return {
    lifts: views,
    proposal: split?.proposal ?? null,
    proposalProblems: split?.problems ?? [],
    plannedTotalKilograms,
    readiness: readinessWith(session.extras.readiness, session.extras.hardCut),
    // Restating §7.1's gate here, rather than trusting that an unconfirmed lift
    // produced no attempts above. It is redundant today and deliberately so: a
    // mutation replacing this conjunct with `true` survives the suite, because
    // every branch that skips confirmation returns an `emptyLift` and so already
    // fails the attempt count. Recorded rather than deleted because the two say
    // different things -- the count says a plan was drawn, the gate says the
    // lifter underwrote it -- and the day a branch draws provisional attempts for
    // an unconfirmed lift, only this conjunct still holds.
    //
    // Written as `gate` alone, not `gate || !methodNeedsConfirmation(method)`.
    // `allConfirmed` already answers `true` for a method that asks nothing, so
    // that disjunct could never be the reason this was true; it read as a second
    // lock against a stale `confirmed` flag and was none. The real second lock is
    // `voidsConfirmation` in `session.ts`, which clears the flags at the edit.
    complete: views.length > 0 && views.every((view) => view.attempts.length === 3) && gate,
  };
}
