/**
 * Turning a submaximal set into a range, and being honest about the range.
 *
 * WHAT THIS PRODUCES, AND WHAT IT REFUSES TO PRODUCE
 *
 * Three figures -- a conservative one, a middle one, and an optimistic one --
 * drawn from the spread of what the published equations say. The spread is
 * *disagreement between models*. It is not a confidence interval, it carries no
 * probability, and nothing here may be rendered as one: the equations were
 * fitted on different populations doing different lifts, so their disagreement
 * measures the state of the literature rather than the uncertainty about this
 * lifter. That distinction is the reason the range is shown at all, and it is
 * the first thing a redesign will be tempted to smooth over.
 *
 * Nothing here says a lifter can complete any of these weights. An estimate is
 * a description of a set that already happened, not a prediction about a set
 * that has not.
 *
 * WHY A WEIGHTED QUARTILE RATHER THAN AN AVERAGE
 *
 * A mean is dragged by whichever equation is furthest out, and at ten
 * repetitions there is always one. Quartiles of the model spread are stable
 * against that, and they degrade gracefully: drop a formula and the middle
 * barely moves. The weighting is what lets the evidence for a particular lift
 * and population count for more without letting it count for everything.
 *
 * THE THREE FIGURES ROUND IN THREE DIRECTIONS
 *
 * Conservative rounds down, the middle one rounds to nearest, and the
 * optimistic one rounds up. This is not decoration. It makes the two guarantees
 * hold by construction rather than by luck: a rounded conservative figure can
 * never exceed the unrounded middle one, and the three can never come out of
 * order at a boundary -- which is what happens when three nearby values all
 * round to nearest and two of them land on the same number.
 *
 * WHY THE RESULT CARRIES A VERSION
 *
 * Which equations vote, and how heavily, is judgement rather than arithmetic,
 * and it will change. A stored estimate with no version is a number nobody can
 * reproduce later. See ONE_REP_MAX_METHODOLOGY_VERSION.
 */
import {
  FORMULAS,
  evaluateFormula,
  type EstimateLift,
  type FormulaDefinition,
  type FormulaFamily,
} from './one-rep-max-formulas.js';
import { findTechnique, type TechniqueOption } from './one-rep-max-technique.js';
import { ceilToIncrement, floorToIncrement, roundToIncrement } from './rounding.js';
import { convertWeight, weightIn, type Weight, type WeightUnit } from './weight.js';

/**
 * Bump this whenever an equation joins or leaves the ensemble, a weight changes,
 * or the quartile or grading rules change. Do not bump it for wording, for a new
 * display-only formula, or for anything that leaves every existing estimate
 * producing the same three numbers.
 */
export const ONE_REP_MAX_METHODOLOGY_VERSION = '1.0.0';

/** The repetition range a completed set may report. */
export const MIN_COMPLETED_REPS = 1;
export const MAX_COMPLETED_REPS = 20;

/**
 * The effective-repetition ceiling.
 *
 * The same number as the completed ceiling, but a different rule: twenty-five
 * completed repetitions is a typing error and is rejected as input, whereas
 * eighteen completed with three in reserve is a perfectly sincere answer that
 * this method cannot turn into a maximum. The first is a problem, the second is
 * a withheld result, and conflating them means telling a lifter who answered
 * honestly that they answered wrongly.
 */
const MAX_EFFECTIVE_REPS = 20;

/**
 * Below three independent relationships there is no consensus to report.
 *
 * Families, not formulas -- two members of the Epley family agreeing is one
 * equation agreeing with itself.
 */
const MINIMUM_FAMILIES = 3;

/**
 * Where the models disagree enough to cost the input a grade, and where they
 * agree closely enough to buy one back.
 *
 * Both figures are stated in the requirements rather than chosen here, and both
 * are measured on the interquartile spread -- the distance between the
 * conservative and optimistic figures -- as a fraction of the middle one.
 *
 * Worth recording what the core seven actually do, because it is what makes the
 * thresholds bite in the right place rather than arbitrarily. Measured across a
 * bench press at 100 kg: the interquartile spread is 2.5% at two repetitions,
 * hovers between 2.5% and 4% from three through nine, crosses five percent at
 * ten, and climbs from 7.9% at eleven to 9.3% at sixteen as the curved and
 * linear models pull apart. So the five percent line falls almost exactly where
 * the literature says repetition-based estimates start to degrade, and the
 * three percent line is reachable only by a genuinely low-repetition set. There
 * is a deliberate gap between the two: a set can earn neither band, which is
 * what stops every result being nudged one way or the other by a threshold it
 * happened to sit beside. Neither figure is a probability and neither may be
 * rendered as one.
 */
const SPREAD_DOWNGRADE_RATIO = 0.05;
const SPREAD_UPGRADE_RATIO = 0.03;

/** Absorbs representation error when comparing an estimate against the entered load. */
const COMPARISON_SLACK = 1e-9;

/**
 * Repetitions left in the tank.
 *
 * Numbers up to three, then a bucket, then "unknown" -- because a lifter who
 * could have done four more has no better idea whether it was four or seven, and
 * offering the choice would collect a number that reads as measured and is not.
 */
export type RepsInReserve = 0 | 1 | 2 | 3 | 'four-or-more' | 'unknown';

/**
 * What is assumed when repetitions in reserve are not stated.
 *
 * Zero: the set is taken at its word as having been to failure. This is the
 * conservative direction -- assuming reserve would inflate the estimate -- and it
 * is stated in an advisory rather than left for the reader to infer.
 */
const ASSUMED_UNKNOWN_RESERVE = 0;

/** The floor of the "four or more" bucket, used because a floor cannot flatter. */
const ASSUMED_LARGE_RESERVE = 4;

/**
 * Reported sex, or `null` for declined.
 *
 * Collected only because two of the studies behind the weighting reported
 * results by sex, and only ever used to shift how much an equation counts. It is
 * never required, declining costs nothing but the weighting, and the estimate is
 * produced either way.
 */
export type ReportedSex = 'man' | 'woman' | null;

export type SetFreshness = 'fresh' | 'fatigued' | 'unstated';
export type FormQuality = 'consistent' | 'degraded' | 'unstated';

/**
 * How long the lifter has been training, or `null` for declined.
 *
 * It never touches the arithmetic, which the requirements state outright: there
 * is no defensible coefficient for inexperience, and inventing one would move a
 * number on the strength of a dropdown. What it does move is the grade, in the
 * same way fatigue does -- somebody new to maximal effort is systematically poor
 * at judging how close to failure a set was, and that is a fact about the
 * *input*, which is the thing being graded.
 *
 * `intermediate` exists as a distinct answer from `null` on purpose: one is a
 * lifter saying where they are, and it happens to move nothing, while the other
 * is a lifter declining to say. Collapsing them would mean the interface could
 * not show the answer back.
 */
export type TrainingExperience = 'new' | 'intermediate' | 'experienced' | null;

/**
 * How much the input supports an estimate at all.
 *
 * Deliberately not "confidence", "accuracy", or a percentage. It grades the
 * *set that was described*, which is something this tool can actually see, and
 * not the distance from the lifter's true maximum, which it cannot.
 */
export type InputGrade = 'strong' | 'useful' | 'rough' | 'endurance-dominated';

const GRADE_ORDER: readonly InputGrade[] = ['strong', 'useful', 'rough', 'endurance-dominated'];

export type OneRepMaxProblemCode =
  | 'weight-not-finite'
  | 'weight-not-positive'
  | 'reps-not-whole'
  | 'reps-below-range'
  | 'reps-above-range'
  | 'technique-unknown';

export interface OneRepMaxProblem {
  readonly code: OneRepMaxProblemCode;
}

/** Why a formula did or did not contribute. One reason per row, the first that applies. */
export type OutcomeReasonCode =
  | 'included'
  | 'declined'
  | 'below-entered-weight'
  | 'duplicate-family'
  | 'expanded-tier'
  | 'conditional-tier'
  | 'experimental-tier'
  | 'single-observed'
  | 'outside-supported-range';

export interface FormulaOutcome {
  readonly formula: FormulaDefinition;
  /** In the display unit, unrounded. `null` when the equation declined. */
  readonly estimate: Weight | null;
  readonly included: boolean;
  /**
   * How heavily it counted, or `null` when it did not count.
   *
   * `null` rather than `0` so that no caller can read a weight off an excluded
   * row and quietly put it back into an average.
   */
  readonly influence: number | null;
  readonly reasonCode: OutcomeReasonCode;
}

export type OneRepMaxAdvisoryCode =
  | 'reps-in-reserve-low'
  | 'reps-in-reserve-moderate'
  | 'reps-in-reserve-unknown'
  | 'far-from-failure'
  | 'technique-matches'
  | 'technique-differs'
  | 'technique-unstated'
  | 'set-performed-fresh'
  | 'set-performed-fatigued'
  | 'form-degraded'
  | 'new-to-maximal-effort'
  | 'experienced-with-singles'
  | 'lift-not-validated'
  | 'evidence-weighted'
  | 'estimates-agree'
  | 'estimates-disagree'
  | 'sex-weighting-declined'
  | 'repetitions-high';

/**
 * Something worth saying about the input, as a code.
 *
 * Codes rather than sentences, following `warmup.ts`: the domain decides what is
 * true and the component decides how to say it, so the same finding can be a
 * sentence on the page, a shorter one in a tooltip, and a different one again in
 * another language, without any of that reaching the arithmetic.
 *
 * `effect` is how the finding moved the grade, so the interface can show the
 * grade and its causes together instead of asserting a grade and listing notes
 * beside it.
 */
export interface OneRepMaxAdvisory {
  readonly code: OneRepMaxAdvisoryCode;
  readonly effect: 'raises-confidence' | 'lowers-confidence' | 'caps-confidence' | 'note';
}

export type WithheldReasonCode =
  'assisted' | 'effective-reps-too-high' | 'too-few-formula-families';

interface EstimateCommon {
  readonly methodologyVersion: string;
  readonly lift: EstimateLift;
  readonly technique: TechniqueOption | null;
  /** Exactly what was typed, in the unit it was typed in. */
  readonly entered: Weight;
  readonly displayUnit: WeightUnit;
  readonly completedReps: number;
  readonly repsInReserve: RepsInReserve;
  readonly effectiveReps: number;
  readonly outcomes: readonly FormulaOutcome[];
  readonly advisories: readonly OneRepMaxAdvisory[];
}

/**
 * A single, already performed.
 *
 * The entered weight is the answer and no equation may overrule it. Several of
 * them return more than the load at one repetition -- Mayhew is nine percent
 * high -- and a tool that let that through would tell somebody who just missed a
 * second attempt that they had in fact lifted more than they lifted.
 */
export interface ObservedSingle extends EstimateCommon {
  readonly kind: 'observed-single';
  readonly observed: Weight;
}

export interface EstimatedMax extends EstimateCommon {
  readonly kind: 'estimated';
  /** Rounded down, to a whole unit. */
  readonly conservative: Weight;
  /** Rounded to nearest. Never "your one-rep max" -- a consensus of published models. */
  readonly toolkit: Weight;
  /** Rounded up. */
  readonly optimistic: Weight;
  /** The same three before rounding, for anything that needs to recompute. */
  readonly unrounded: {
    readonly conservative: Weight;
    readonly toolkit: Weight;
    readonly optimistic: Weight;
  };
  readonly grade: InputGrade;
  readonly disagreement: FormulaDisagreement;
  readonly familyCount: number;
}

/**
 * How far apart the contributing equations are, in five ways the requirements
 * ask for by name.
 *
 * None of it is a confidence interval and none of it may be rendered as one.
 * `fullRatio` describes the whole cluster and is the honest headline -- at ten
 * repetitions the outermost equations can be a tenth apart while the middle half
 * looks tight. `interquartileRatio` is the one the grade is computed from,
 * because it is the spread the conservative and optimistic figures are actually
 * drawn from, and grading on the full range would let one outlying equation cost
 * a well-described set its grade.
 */
export interface FormulaDisagreement {
  /** The lowest contributing estimate, unrounded. */
  readonly lowest: Weight;
  /** The highest contributing estimate, unrounded. */
  readonly highest: Weight;
  /** `highest - lowest`. */
  readonly spread: Weight;
  /** `spread` as a fraction of the unrounded middle figure. */
  readonly fullRatio: number;
  /** The unrounded optimistic figure less the unrounded conservative one. */
  readonly interquartileSpread: Weight;
  /** `interquartileSpread` as a fraction of the unrounded middle figure. */
  readonly interquartileRatio: number;
}

export interface WithheldEstimate extends EstimateCommon {
  readonly kind: 'withheld';
  readonly reason: WithheldReasonCode;
}

export type OneRepMaxEstimate = ObservedSingle | EstimatedMax | WithheldEstimate;

export type OneRepMaxResult =
  | { readonly ok: true; readonly estimate: OneRepMaxEstimate }
  | { readonly ok: false; readonly problems: readonly OneRepMaxProblem[] };

export interface OneRepMaxRequest {
  readonly weight: Weight;
  readonly completedReps: number;
  readonly repsInReserve: RepsInReserve;
  readonly lift: EstimateLift;
  /** A technique identifier from `techniquesFor(lift)`, or `null` for none offered. */
  readonly techniqueId: string | null;
  readonly sex: ReportedSex;
  readonly experience: TrainingExperience;
  readonly freshness: SetFreshness;
  readonly formQuality: FormQuality;
  /** A spotter took some of the bar. Nothing can be estimated from that. */
  readonly assisted: boolean;
  readonly displayUnit: WeightUnit;
  /**
   * The step the three displayed figures are rounded to, in the display unit.
   *
   * Required rather than defaulted, because the right step is a fact about the
   * bar in front of the lifter and not about the arithmetic: half a kilogram is
   * a real jump on a microloaded bar and noise on one being loaded in 2.5 kg
   * plates. A default here would be a plausible number that is wrong in a gym
   * and right in a test. See `ROUNDING_INCREMENTS`.
   */
  readonly roundTo: number;
}

/**
 * The steps offered for each unit, smallest first.
 *
 * Half a kilogram and one pound are the requirements' defaults; the larger steps
 * are the jumps a competition bar is loaded in. Nothing here is enforced by
 * `estimateOneRepMax`, which accepts any positive step -- this is the list an
 * interface offers, kept beside the rule rather than in a component so a second
 * caller cannot invent a different one.
 */
export const ROUNDING_INCREMENTS: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [0.5, 1, 2.5],
  lb: [1, 2.5, 5],
};

/** The step a unit starts on. */
export function defaultRoundingIncrement(unit: WeightUnit): number {
  return unit === 'kg' ? 0.5 : 1;
}

/**
 * The whole calculation, from a described set to a range or a refusal.
 *
 * Every problem with the input is reported at once (§5.5) -- a form that reveals
 * one fault per submission makes a lifter guess at the rest.
 */
export function estimateOneRepMax(request: OneRepMaxRequest): OneRepMaxResult {
  const problems = validate(request);
  if (problems.length > 0) return { ok: false, problems };

  const technique =
    request.techniqueId === null ? null : findTechnique(request.lift, request.techniqueId);

  const reserve = resolveReserve(request.repsInReserve, request.completedReps);
  const enteredKilograms = weightIn(request.weight, 'kg');
  const advisories = collectAdvisories(request, technique, reserve.effectiveReps);

  const common: EstimateCommon = {
    methodologyVersion: ONE_REP_MAX_METHODOLOGY_VERSION,
    lift: request.lift,
    technique,
    entered: request.weight,
    displayUnit: request.displayUnit,
    completedReps: request.completedReps,
    repsInReserve: request.repsInReserve,
    effectiveReps: reserve.effectiveReps,
    outcomes: [],
    advisories,
  };

  // An assisted set is the one case with nothing to show. Every other refusal
  // still renders the formula table, because seeing what the equations said and
  // why none of it was used is the explanation; an assisted set has no honest
  // input to feed them in the first place.
  if (request.assisted) {
    return { ok: true, estimate: { ...common, kind: 'withheld', reason: 'assisted' } };
  }

  const observedSingle = request.completedReps === 1 && reserve.effectiveReps === 1;
  const outOfRange = reserve.effectiveReps > MAX_EFFECTIVE_REPS;

  const evaluated = FORMULAS.map((formula) => ({
    formula,
    kilograms: evaluateFormula(formula, {
      kilograms: enteredKilograms,
      reps: reserve.effectiveReps,
      lift: request.lift,
    }),
  }));

  const brownSupported =
    request.sex === 'woman' && (request.lift === 'bench-press' || request.lift === 'squat');

  const seenFamilies = new Set<FormulaFamily>();
  const outcomes: FormulaOutcome[] = [];

  for (const { formula, kilograms } of evaluated) {
    const estimate =
      kilograms === null
        ? null
        : convertWeight({ amount: kilograms, unit: 'kg' }, request.displayUnit);

    const reason = reasonFor({
      kilograms,
      enteredKilograms,
      observedSingle,
      outOfRange,
      eligible: isEnsembleEligible(formula, brownSupported),
      formula,
      seenFamilies,
    });

    const included = reason === 'included';
    if (included) seenFamilies.add(formula.family);

    outcomes.push({
      formula,
      estimate,
      included,
      influence: included ? influenceOf(formula, request.lift, request.sex) : null,
      reasonCode: reason,
    });
  }

  const withOutcomes: EstimateCommon = { ...common, outcomes };

  if (observedSingle) {
    return {
      ok: true,
      estimate: { ...withOutcomes, kind: 'observed-single', observed: request.weight },
    };
  }

  if (outOfRange) {
    return {
      ok: true,
      estimate: { ...withOutcomes, kind: 'withheld', reason: 'effective-reps-too-high' },
    };
  }

  const contributors = outcomes.filter(
    (outcome): outcome is FormulaOutcome & { estimate: Weight; influence: number } =>
      outcome.included && outcome.estimate !== null && outcome.influence !== null,
  );
  const familyCount = new Set(contributors.map((outcome) => outcome.formula.family)).size;

  if (familyCount < MINIMUM_FAMILIES) {
    return {
      ok: true,
      estimate: { ...withOutcomes, kind: 'withheld', reason: 'too-few-formula-families' },
    };
  }

  const entries = contributors.map((outcome) => ({
    value: outcome.estimate.amount,
    weight: outcome.influence,
  }));

  const low = weightedQuantile(entries, 0.25);
  const middle = weightedQuantile(entries, 0.5);
  const high = weightedQuantile(entries, 0.75);
  if (low === null || middle === null || high === null) {
    return {
      ok: true,
      estimate: { ...withOutcomes, kind: 'withheld', reason: 'too-few-formula-families' },
    };
  }

  const amounts = contributors.map((outcome) => outcome.estimate.amount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const interquartileRatio = middle > 0 ? (high - low) / middle : 0;

  // Computed here rather than in `collectAdvisories` because it is the one
  // finding that depends on the answer: the quartiles have to exist before the
  // models can be said to agree about them. It is folded into the list *before*
  // the grade is computed, which is the whole point -- the requirements make
  // agreement and disagreement grade adjustments, not footnotes.
  const advisoriesWithSpread = [...advisories, ...spreadAdvisories(interquartileRatio)];

  const unit = request.displayUnit;
  const step = request.roundTo;
  return {
    ok: true,
    estimate: {
      ...withOutcomes,
      advisories: advisoriesWithSpread,
      kind: 'estimated',
      conservative: { amount: floorToIncrement(low, step), unit },
      toolkit: { amount: roundToIncrement(middle, step), unit },
      optimistic: { amount: ceilToIncrement(high, step), unit },
      unrounded: {
        conservative: { amount: low, unit },
        toolkit: { amount: middle, unit },
        optimistic: { amount: high, unit },
      },
      grade: gradeFor(reserve.effectiveReps, request.lift, advisoriesWithSpread),
      disagreement: {
        lowest: { amount: lowest, unit },
        highest: { amount: highest, unit },
        spread: { amount: highest - lowest, unit },
        fullRatio: middle > 0 ? (highest - lowest) / middle : 0,
        interquartileSpread: { amount: high - low, unit },
        interquartileRatio,
      },
      familyCount,
    },
  };
}

/** Nothing, one upgrade, or one downgrade -- never both, since the bands do not overlap. */
function spreadAdvisories(interquartileRatio: number): readonly OneRepMaxAdvisory[] {
  if (interquartileRatio > SPREAD_DOWNGRADE_RATIO) {
    return [{ code: 'estimates-disagree', effect: 'lowers-confidence' }];
  }
  if (interquartileRatio <= SPREAD_UPGRADE_RATIO) {
    return [{ code: 'estimates-agree', effect: 'raises-confidence' }];
  }
  return [];
}

function validate(request: OneRepMaxRequest): OneRepMaxProblem[] {
  const problems: OneRepMaxProblem[] = [];
  const amount = request.weight.amount;

  if (!Number.isFinite(amount)) {
    problems.push({ code: 'weight-not-finite' });
  } else if (amount <= 0) {
    problems.push({ code: 'weight-not-positive' });
  }

  const reps = request.completedReps;
  if (!Number.isInteger(reps)) {
    problems.push({ code: 'reps-not-whole' });
  } else if (reps < MIN_COMPLETED_REPS) {
    problems.push({ code: 'reps-below-range' });
  } else if (reps > MAX_COMPLETED_REPS) {
    problems.push({ code: 'reps-above-range' });
  }

  // A technique that belongs to a different lift is a wiring fault, not a
  // preference to honour quietly -- a stored `touch-and-go` arriving against a
  // squat would otherwise silently downgrade a perfectly ordinary set.
  if (request.techniqueId !== null && findTechnique(request.lift, request.techniqueId) === null) {
    problems.push({ code: 'technique-unknown' });
  }

  return problems;
}

interface ResolvedReserve {
  readonly effectiveReps: number;
}

function resolveReserve(reserve: RepsInReserve, completedReps: number): ResolvedReserve {
  if (reserve === 'unknown') return { effectiveReps: completedReps + ASSUMED_UNKNOWN_RESERVE };
  if (reserve === 'four-or-more') return { effectiveReps: completedReps + ASSUMED_LARGE_RESERVE };
  return { effectiveReps: completedReps + reserve };
}

function collectAdvisories(
  request: OneRepMaxRequest,
  technique: TechniqueOption | null,
  effectiveReps: number,
): readonly OneRepMaxAdvisory[] {
  const advisories: OneRepMaxAdvisory[] = [];

  const reserve = request.repsInReserve;
  if (reserve === 0 || reserve === 1) {
    advisories.push({ code: 'reps-in-reserve-low', effect: 'raises-confidence' });
  }
  // Two or three in reserve is a downgrade even though the arithmetic accepts it
  // cleanly. The addition is a heuristic, not a measurement: a lifter who
  // believes they had three left is describing a feeling, and the further from
  // failure the set was the less that feeling is worth.
  if (reserve === 2 || reserve === 3) {
    advisories.push({ code: 'reps-in-reserve-moderate', effect: 'lowers-confidence' });
  }
  if (reserve === 'unknown') {
    advisories.push({ code: 'reps-in-reserve-unknown', effect: 'lowers-confidence' });
  }
  if (reserve === 'four-or-more') {
    advisories.push({ code: 'far-from-failure', effect: 'lowers-confidence' });
  }
  if (technique?.match === 'matches') {
    advisories.push({ code: 'technique-matches', effect: 'raises-confidence' });
  }
  if (technique?.match === 'differs') {
    advisories.push({ code: 'technique-differs', effect: 'lowers-confidence' });
  }
  if (technique?.match === 'unsure') {
    advisories.push({ code: 'technique-unstated', effect: 'lowers-confidence' });
  }
  if (request.freshness === 'fresh') {
    advisories.push({ code: 'set-performed-fresh', effect: 'raises-confidence' });
  }
  if (request.freshness === 'fatigued') {
    advisories.push({ code: 'set-performed-fatigued', effect: 'lowers-confidence' });
  }
  if (request.formQuality === 'degraded') {
    advisories.push({ code: 'form-degraded', effect: 'lowers-confidence' });
  }
  if (request.experience === 'new') {
    advisories.push({ code: 'new-to-maximal-effort', effect: 'lowers-confidence' });
  }
  if (request.experience === 'experienced') {
    advisories.push({ code: 'experienced-with-singles', effect: 'raises-confidence' });
  }
  if (request.lift === 'overhead-press' || request.lift === 'other') {
    advisories.push({ code: 'lift-not-validated', effect: 'caps-confidence' });
  }
  if (raisesConfidence(request, effectiveReps)) {
    advisories.push({ code: 'evidence-weighted', effect: 'raises-confidence' });
  }
  if (request.sex === null && (request.lift === 'bench-press' || request.lift === 'squat')) {
    advisories.push({ code: 'sex-weighting-declined', effect: 'note' });
  }
  if (startLevelFor(effectiveReps) >= 2) {
    advisories.push({ code: 'repetitions-high', effect: 'note' });
  }

  return advisories;
}

/**
 * The one thing that can buy back a downgrade.
 *
 * Bench press or squat, at a repetition count the studies covered, with sex
 * stated so the population-specific weighting actually applies. This is the
 * narrow case where the evidence is about the lift in front of us rather than
 * about lifting in general.
 */
function raisesConfidence(request: OneRepMaxRequest, effectiveReps: number): boolean {
  const studied = request.lift === 'bench-press' || request.lift === 'squat';
  return studied && request.sex !== null && effectiveReps <= 8;
}

/** Where the grade starts, before anything about the set is taken into account. */
function startLevelFor(effectiveReps: number): number {
  if (effectiveReps <= 5) return 0;
  if (effectiveReps <= 8) return 1;
  if (effectiveReps <= 10) return 2;
  return 3;
}

/**
 * The grade, from the repetition count and the advisories.
 *
 * An upgrade cancels at most one downgrade and can never beat the
 * repetition-based starting level: five well-described repetitions and fifteen
 * well-described repetitions are not the same evidence, and no amount of care
 * about technique makes a set of fifteen into a strong basis for a maximum.
 */
function gradeFor(
  effectiveReps: number,
  lift: EstimateLift,
  advisories: readonly OneRepMaxAdvisory[],
): InputGrade {
  const start = startLevelFor(effectiveReps);
  const lowers = advisories.filter((advisory) => advisory.effect === 'lowers-confidence').length;
  const raises = advisories.some((advisory) => advisory.effect === 'raises-confidence');

  let level = start + lowers;
  if (raises) level -= 1;
  level = Math.max(start, level);

  // Not a downgrade but a ceiling: no combination of careful answers makes an
  // unvalidated lift a strong basis, and no repetition count makes it worse than
  // the other rules already say.
  if (lift === 'overhead-press' || lift === 'other') level = Math.max(level, 1);

  level = Math.min(GRADE_ORDER.length - 1, level);
  return GRADE_ORDER[level] ?? 'endurance-dominated';
}

/** Whether a formula is allowed to vote at all, before duplicate-family pruning. */
function isEnsembleEligible(formula: FormulaDefinition, brownSupported: boolean): boolean {
  if (formula.tier === 'core') return true;
  // Brown is the single exception to "expanded formulas are shown, not counted".
  // It is not a better equation in general; there is specific published support
  // for it in one population and two lifts, and it votes exactly there. Widening
  // this to the rest of the expanded tier would let equations with no
  // lift-specific support sway the middle figure.
  return formula.id === 'brown' && brownSupported;
}

/**
 * How heavily an eligible formula counts.
 *
 * One by default. Two where a study specifically supports it for this lift and
 * this population -- and nowhere else. Declining to state sex costs the
 * weighting and nothing more: every eligible formula counts once and the result
 * is still produced.
 */
function influenceOf(formula: FormulaDefinition, lift: EstimateLift, sex: ReportedSex): number {
  const studied = lift === 'bench-press' || lift === 'squat';
  if (!studied || sex === null) return 1;

  if (sex === 'man' && formula.id === 'lombardi') return 2;
  if (
    sex === 'woman' &&
    (formula.id === 'brown' || formula.id === 'brzycki' || formula.id === 'lander')
  ) {
    return 2;
  }
  return 1;
}

interface ReasonInput {
  readonly kilograms: number | null;
  readonly enteredKilograms: number;
  readonly observedSingle: boolean;
  readonly outOfRange: boolean;
  readonly eligible: boolean;
  readonly formula: FormulaDefinition;
  readonly seenFamilies: ReadonlySet<FormulaFamily>;
}

/**
 * Why one row did or did not count, first reason wins.
 *
 * The order is the order a reader needs: what the equation itself did, then
 * whether its answer was usable, then whether this tool was going to count it
 * anyway. Putting the tier check first would report "expanded formula" for a row
 * that in fact returned nothing, which is true and useless.
 */
function reasonFor(input: ReasonInput): OutcomeReasonCode {
  if (input.kilograms === null) return 'declined';
  // An estimate below the load already lifted is arithmetically fine and
  // physically impossible; the study-specific regressions with negative
  // intercepts produce it at light loads.
  if (input.kilograms < input.enteredKilograms - COMPARISON_SLACK) return 'below-entered-weight';
  if (input.observedSingle) return 'single-observed';
  if (input.outOfRange) return 'outside-supported-range';
  if (!input.eligible) {
    if (input.formula.tier === 'conditional') return 'conditional-tier';
    if (input.formula.tier === 'experimental') return 'experimental-tier';
    return 'expanded-tier';
  }
  if (input.seenFamilies.has(input.formula.family)) return 'duplicate-family';
  return 'included';
}

interface WeightedValue {
  readonly value: number;
  readonly weight: number;
}

/**
 * A quantile of a weighted sample, by interpolated plotting position.
 *
 * Each value sits at `(cumulative - half its own weight) / total`, which places
 * a value in the middle of the span its weight occupies rather than at one end.
 * Without the half-weight the sample is biased upward: the lowest value would
 * sit above zero and the highest exactly at one, and the median of an evenly
 * weighted odd-sized sample would not be the middle value.
 *
 * The result is monotone in the probability, which is what guarantees
 * conservative <= middle <= optimistic before rounding ever happens.
 */
function weightedQuantile(entries: readonly WeightedValue[], probability: number): number | null {
  if (entries.length === 0) return null;

  const sorted = [...entries].sort((left, right) => left.value - right.value);
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) return null;

  const positions: number[] = [];
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    positions.push((cumulative - entry.weight / 2) / total);
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstPosition = positions[0];
  const lastPosition = positions[positions.length - 1];
  if (
    first === undefined ||
    last === undefined ||
    firstPosition === undefined ||
    lastPosition === undefined
  ) {
    return null;
  }

  // Clamped rather than extrapolated. Beyond the outermost plotting positions
  // there is no data, and a linear extension there would invent an estimate
  // below every formula's answer or above all of them.
  if (probability <= firstPosition) return first.value;
  if (probability >= lastPosition) return last.value;

  for (let index = 1; index < sorted.length; index += 1) {
    const lowerPosition = positions[index - 1];
    const upperPosition = positions[index];
    const lower = sorted[index - 1];
    const upper = sorted[index];
    if (
      lowerPosition === undefined ||
      upperPosition === undefined ||
      lower === undefined ||
      upper === undefined
    ) {
      continue;
    }
    if (probability <= upperPosition) {
      const span = upperPosition - lowerPosition;
      const fraction = span > 0 ? (probability - lowerPosition) / span : 0;
      return lower.value + fraction * (upper.value - lower.value);
    }
  }

  return last.value;
}
