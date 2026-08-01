/**
 * The two axes a meet-day recommendation is graded on, kept apart on purpose.
 *
 * §10 of the planner requirements is unusually emphatic, and the emphasis is
 * earned: *how aggressive an attempt is* and *how well described the lifter is*
 * are different questions with different answers, and a tool that multiplies them
 * into one number destroys the only two facts a lifter can act on. A plan can be
 * high-confidence and aggressive -- a lifter with a tested opener going for a
 * record third -- or low-confidence and conservative, which is a first-timer
 * working from a gym single. A single score renders those two as the same middling
 * figure, and the second lifter reads it as permission.
 *
 * So this file exports two functions that never call each other and two result
 * types with no arithmetic between them. There is deliberately no
 * `overallScore`, no weighting, and nothing that returns a percentage. Adding one
 * would be a visible change to this file rather than an emergent property of
 * somewhere else.
 *
 * NO PROBABILITIES, AT ALL
 *
 * §10.2 forbids displaying an exact probability of success until a future release
 * implements and independently validates a complete predictive model. The
 * research this is built on reports roughly 62% balanced accuracy; a percentage on
 * screen would be a lie with a citation behind it. Nothing here returns a number
 * that could be rendered as one -- the risk axis is four words and the confidence
 * axis is three.
 *
 * WHY THE THRESHOLDS ARE CODE AND NOT PUBLISHED DATA
 *
 * §5.1 keeps federation numbers out of source because a federation can revise
 * them between releases. Nothing here is a federation's number. These are the
 * project's own reading of published population research plus its own judgement
 * about where one label ends and the next begins -- the same line `lifts.ts` and
 * the one-rep-max evidence weights sit on. What makes that honest is
 * `ATTEMPT_PLAN_METHODOLOGY_VERSION`: a saved plan records which reading produced
 * it, so a plan opened after the judgement changes can say so rather than quietly
 * meaning something else.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

/**
 * Which reading of the anchors and thresholds produced an answer.
 *
 * Saved with any planned attempt (§30 requires the stored document to carry a
 * methodology version) so that a plan made under one set of judgements is not
 * silently reinterpreted under the next. Bump it whenever a threshold in this
 * file or in `attempt-plan.ts` moves.
 */
export const ATTEMPT_PLAN_METHODOLOGY_VERSION = 'attempt-plan-2026.1';

// ---------------------------------------------------------------------------
// Axis one: how aggressive an attempt is
// ---------------------------------------------------------------------------

/**
 * How much of a reach one attempt is, in four words and no numbers.
 *
 * Ordered from least to most aggressive. The words are §10.2's, verbatim, and
 * they are the vocabulary the interface must use -- "safe", "guaranteed" and
 * anything in the language of probability are forbidden by §10.2 and by tool 3's
 * §11 rules, which this collection already follows.
 */
export type AttemptRisk = 'secure' | 'recommended' | 'push' | 'long-shot';

/** In order, so an interface can render a scale without hard-coding one. */
export const ATTEMPT_RISKS: readonly AttemptRisk[] = ['secure', 'recommended', 'push', 'long-shot'];

/**
 * Where one label stops and the next begins, as a share of the planning maximum.
 *
 * Each figure is the *inclusive top* of that label. Read them against the §9
 * strategy table, because that is where they come from rather than from anywhere
 * new: the openers the presets offer run 88% to 91%, the seconds run 94% to 97%,
 * and the thirds run 98% to 103%. `secure` is set at the conservative end of each
 * of those ranges, `recommended` at the aggressive end plus room for a legal
 * rounding step, and `push` above the table entirely. Anything past `push` is a
 * weight no preset in the product would have proposed, which is exactly what
 * "Long Shot" should mean.
 *
 * Deriving the labels from the presets rather than inventing a fresh scale is
 * what stops the two from drifting: a preset that started recommending a weight
 * its own tool calls a Long Shot would be a contradiction nobody would notice,
 * because both halves would keep passing their own tests.
 */
const ATTEMPT_RISK_CEILINGS: Readonly<
  Record<
    1 | 2 | 3,
    { readonly secure: number; readonly recommended: number; readonly push: number }
  >
> = {
  1: { secure: 89, recommended: 92, push: 95 },
  2: { secure: 94, recommended: 97, push: 100 },
  3: { secure: 98, recommended: 101, push: 105 },
};

/**
 * How far the third-attempt scale shifts down for the bench press.
 *
 * §9.2: "third-attempt risk should normally be lower on the bench press than the
 * same relative risk on squat or deadlift". Read as a statement about the same
 * *percentage*, which is the only way it can be implemented: 102% of a bench
 * maximum is a bigger reach than 102% of a squat maximum, because a bench third is
 * a handful of kilograms and a lifter has no way to grind one out of a bad
 * position. Shifting the scale down is how a percentage that is Recommended on the
 * squat comes back as a Push on the bench.
 *
 * Two percentage points is this project's judgement, not a figure the research
 * supplies, which is why it moves with `ATTEMPT_PLAN_METHODOLOGY_VERSION`. It is
 * applied to the third attempt only, because that is the attempt the sentence is
 * about -- an opener is a warm-up single on every lift.
 */
const BENCH_THIRD_ATTEMPT_SHIFT = 2;

export interface AttemptRiskQuery {
  readonly lift: PlatformLift;
  readonly attemptNumber: 1 | 2 | 3;
  readonly kilograms: number;
  /** `M`: the maximum the lifter confirmed as realistic for meet day, per §9. */
  readonly meetDayMaximumKilograms: number;
}

/**
 * Which of the four words describes this attempt.
 *
 * Total on purpose. A weight can be anything a lifter typed, including something
 * absurd, and a screen still has to label it -- so a nonsensical maximum grades
 * everything as a Long Shot rather than throwing. There is nothing here that can
 * fail in a way an interface would need a branch for, and adding one would put a
 * fifth state on a scale that §10.2 says has four.
 */
export function classifyAttemptRisk(query: AttemptRiskQuery): AttemptRisk {
  const { kilograms, meetDayMaximumKilograms: maximum } = query;
  if (!Number.isFinite(kilograms) || !Number.isFinite(maximum) || maximum <= 0 || kilograms <= 0) {
    // No usable denominator, so no basis for any of the three lighter labels.
    // Grading it Secure would be the reading that gets somebody hurt.
    return 'long-shot';
  }

  const percent = (kilograms / maximum) * 100;
  const shift = query.attemptNumber === 3 && query.lift === 'bench' ? BENCH_THIRD_ATTEMPT_SHIFT : 0;
  const ceilings = ATTEMPT_RISK_CEILINGS[query.attemptNumber];

  if (percent <= ceilings.secure - shift) return 'secure';
  if (percent <= ceilings.recommended - shift) return 'recommended';
  if (percent <= ceilings.push - shift) return 'push';
  return 'long-shot';
}

/** Whether one label is more aggressive than another, without exposing an index. */
export function isRiskierThan(left: AttemptRisk, right: AttemptRisk): boolean {
  return ATTEMPT_RISKS.indexOf(left) > ATTEMPT_RISKS.indexOf(right);
}

// ---------------------------------------------------------------------------
// Axis two: how well described the lifter is
// ---------------------------------------------------------------------------

/**
 * How much the tool actually knows, in §10.1's three words.
 *
 * Note what this is *not*: it is not how likely the plan is to work. A Low
 * confidence plan can be entirely sensible -- it is the honest label on a first
 * meet planned from a gym single, which is the most common way this tool will be
 * used.
 */
export type DataConfidence = 'high' | 'medium' | 'low';

/** In order, weakest first, so a cap can be applied without an index at call sites. */
export const DATA_CONFIDENCES: readonly DataConfidence[] = ['low', 'medium', 'high'];

/**
 * Where the confirmed maximum came from.
 *
 * A closed list rather than free text, and the reason is §5.12's: nothing on this
 * axis may become somewhere to type a sentence about a lifter. It is also what
 * makes the grading reproducible -- "a heavy single last month" and "a heavy
 * single last month" typed twice are two strings and one fact.
 */
export type MaximumSource =
  /** Taken on a platform, under the rules the meet runs. The best evidence there is. */
  | 'competition-single'
  /** A training single to competition standards: depth, pause, commands. */
  | 'competition-standard-single'
  /** A set of two to five, with the effort described. §10.1's Medium case. */
  | 'low-repetition-estimate'
  /** A set of six or more. The equations are least trustworthy here (tool 3, §11). */
  | 'high-repetition-estimate'
  /** A personal best with no date attached to it. */
  | 'lifetime-best'
  /** Nothing was said. Not the same as a bad answer, and graded the same way. */
  | 'unstated';

/** How long ago, in bands rather than a date, because the bands are what change the grade. */
export type EvidenceAge = 'within-eight-weeks' | 'within-six-months' | 'older' | 'unstated';

/** §8.1's readiness question. `unstated` is a real answer and is treated as one. */
export type Readiness = 'normal' | 'uncertain' | 'reduced' | 'unstated';

/**
 * Everything the confidence grade is allowed to look at.
 *
 * Every field is required, including the ones whose answer is "nobody said". An
 * optional field would let a caller omit readiness and get the grade of a lifter
 * who answered "normal", which is the difference between High and Low.
 */
export interface ConfidenceEvidence {
  readonly maximumSource: MaximumSource;
  readonly evidenceAge: EvidenceAge;
  /** Whether the planned opener has actually been performed in training (§8.1). */
  readonly openerTestedInTraining: boolean | null;
  /** Whether the evidence was gathered in the equipment category the meet is under. */
  readonly equipmentMatchesMeet: boolean | null;
  /** How many meets the lifter has done. `null` when they did not say. */
  readonly priorMeets: number | null;
  readonly readiness: Readiness;
  /** Whether an RPE or reps-in-reserve figure came with the set. §10.1's Medium condition. */
  readonly effortDescribed: boolean;
}

export type ConfidenceReasonCode =
  | 'competition-standard-single'
  | 'low-repetition-estimate'
  | 'high-repetition-estimate'
  | 'undated-best'
  | 'source-unstated'
  | 'effort-not-described'
  | 'evidence-is-months-old'
  | 'evidence-is-stale'
  | 'evidence-undated'
  | 'equipment-differs-from-the-meet'
  | 'equipment-unstated'
  | 'readiness-uncertain'
  | 'readiness-reduced'
  | 'readiness-unstated'
  | 'no-tested-opener-and-no-meet-history';

/**
 * One thing that set or held down the grade.
 *
 * `holdsAt` rather than a weight or a penalty: every rule here is a *ceiling*, so
 * the grade is the lowest ceiling any of them imposed and a reader can see which
 * one bit. A points system would let two small deductions add up to a downgrade
 * nobody can point at.
 */
export interface ConfidenceReason {
  readonly code: ConfidenceReasonCode;
  readonly holdsAt: DataConfidence;
  readonly message: string;
}

export interface DataConfidenceAssessment {
  readonly level: DataConfidence;
  /**
   * Every ceiling that applied, not only the binding one.
   *
   * §5.5's report-everything rule, and here it is also the answer to "what would
   * I have to do to improve this?" -- a lifter told only about the binding
   * ceiling fixes it and is graded Low again for the next one.
   */
  readonly reasons: readonly ConfidenceReason[];
}

function lowest(levels: readonly DataConfidence[]): DataConfidence {
  return levels.reduce((floor, level) =>
    DATA_CONFIDENCES.indexOf(level) < DATA_CONFIDENCES.indexOf(floor) ? level : floor,
  );
}

/**
 * Grade how well described the lifter is, and say what held the grade down.
 *
 * The shape is deliberately all ceilings and no bonuses. Every rule below can
 * only lower the result, so there is no way for a lifter to answer enough
 * optional questions to talk the tool up past something it has a structural
 * reason to distrust -- the same discipline tool 3 applies to its estimate grade
 * (§11.1), for the same reason: it is what makes the questions worth answering
 * honestly.
 */
export function assessDataConfidence(evidence: ConfidenceEvidence): DataConfidenceAssessment {
  const reasons: ConfidenceReason[] = [];

  switch (evidence.maximumSource) {
    case 'competition-single':
      break;
    case 'competition-standard-single':
      // Not a ceiling below High -- a paused, depth-legal single is the evidence
      // §10.1's High case asks for. Recorded so the grade can be explained.
      reasons.push({
        code: 'competition-standard-single',
        holdsAt: 'high',
        message: 'The maximum came from a training single held to competition standards.',
      });
      break;
    case 'low-repetition-estimate':
      reasons.push({
        code: 'low-repetition-estimate',
        holdsAt: 'medium',
        message: 'The maximum is estimated from a set of repetitions rather than a single.',
      });
      break;
    case 'high-repetition-estimate':
      reasons.push({
        code: 'high-repetition-estimate',
        holdsAt: 'low',
        message: 'The maximum is estimated from a high-repetition set, where estimates vary most.',
      });
      break;
    case 'lifetime-best':
      reasons.push({
        code: 'undated-best',
        holdsAt: 'low',
        message: 'The maximum is a personal best with no date attached to it.',
      });
      break;
    case 'unstated':
      reasons.push({
        code: 'source-unstated',
        holdsAt: 'low',
        message: 'Where the maximum came from was not recorded.',
      });
      break;
  }

  if (evidence.maximumSource === 'low-repetition-estimate' && !evidence.effortDescribed) {
    // §10.1 grants Medium to "recent low-repetition training data with reasonable
    // effort information". Without the effort, the repetitions could have been a
    // grinding set or an easy one, and the two estimate tens of kilograms apart.
    reasons.push({
      code: 'effort-not-described',
      holdsAt: 'low',
      message: 'How hard the set was -- an RPE or repetitions in reserve -- was not recorded.',
    });
  }

  switch (evidence.evidenceAge) {
    case 'within-eight-weeks':
      break;
    case 'within-six-months':
      reasons.push({
        code: 'evidence-is-months-old',
        holdsAt: 'medium',
        message: 'The evidence is several months old, so it may not describe meet day.',
      });
      break;
    case 'older':
      reasons.push({
        code: 'evidence-is-stale',
        holdsAt: 'low',
        message: 'The evidence is more than six months old.',
      });
      break;
    case 'unstated':
      reasons.push({
        code: 'evidence-undated',
        holdsAt: 'low',
        message: 'When the evidence was gathered was not recorded.',
      });
      break;
  }

  if (evidence.equipmentMatchesMeet === false) {
    reasons.push({
      code: 'equipment-differs-from-the-meet',
      holdsAt: 'low',
      message: 'The evidence was gathered in different equipment from the one the meet is under.',
    });
  } else if (evidence.equipmentMatchesMeet === null) {
    reasons.push({
      code: 'equipment-unstated',
      holdsAt: 'medium',
      message: 'Whether the evidence used the meet equipment was not recorded.',
    });
  }

  switch (evidence.readiness) {
    case 'normal':
      break;
    case 'uncertain':
      reasons.push({
        code: 'readiness-uncertain',
        holdsAt: 'low',
        message: 'Readiness for meet day is uncertain.',
      });
      break;
    case 'reduced':
      // Reduced readiness is *information*, and it still holds the grade at Low:
      // the maximum was measured on a day the lifter is not going to have, so the
      // figure describes someone else's meet.
      reasons.push({
        code: 'readiness-reduced',
        holdsAt: 'low',
        message: 'Readiness is reduced, so the confirmed maximum may overstate meet day.',
      });
      break;
    case 'unstated':
      reasons.push({
        code: 'readiness-unstated',
        holdsAt: 'medium',
        message: 'Readiness for meet day was not recorded.',
      });
      break;
  }

  const hasTestedOpener = evidence.openerTestedInTraining === true;
  const hasMeetHistory = evidence.priorMeets !== null && evidence.priorMeets >= 1;
  if (!hasTestedOpener && !hasMeetHistory) {
    // §10.1's High case wants a tested opener *and* relevant history. Requiring
    // both would make a well-prepared first meet impossible to grade High, which
    // is unfair to the lifter this tool is most for; requiring neither would let
    // an untested gym number sit at the top of the scale. One of the two.
    reasons.push({
      code: 'no-tested-opener-and-no-meet-history',
      holdsAt: 'medium',
      message: 'The opener has not been performed in training and there is no meet history yet.',
    });
  }

  const level = reasons.length === 0 ? 'high' : lowest(reasons.map((reason) => reason.holdsAt));
  return { level, reasons };
}
