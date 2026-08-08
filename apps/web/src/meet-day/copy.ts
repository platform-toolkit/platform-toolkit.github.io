// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The sentences and the option lists. Every one of them, in one file.
 *
 * The domain answers in codes and, where it writes prose at all, writes it for
 * whichever tool asked; this is where a code becomes something a lifter reads.
 * Keeping the whole vocabulary in one file is what makes it checkable at once,
 * and this tool has a vocabulary that has to be checked, because several of its
 * rules are rules about *wording*:
 *
 *   - Risk and data confidence are two axes and never one (§10). A "high
 *     confidence attempt" fuses them, and that is the phrase this tool exists to
 *     not say.
 *   - No probability, anywhere (§10.2). Not a percentage of success, not a
 *     likelihood, not odds, not "should make it".
 *   - The planned third is a scenario, not a commitment (§9).
 *   - A research warning says what population the research measured, and says so
 *     even -- especially -- when the lifter is not in it (§9.3).
 *
 * Tone follows tools 2 to 4: confident, concise, gym-literate. Humour is allowed
 * in helper text and empty states, and nowhere near a refusal, an unsafe jump,
 * or an explanation of why a weight was withheld.
 */
import {
  HANDLER_RESPONSIBILITIES,
  MAX_WEIGHT_INPUT,
  MEETS_BEFORE_A_TREND,
  RPE_BOUNDS,
  convertWeight,
  formatWeight,
  type AttemptEffort,
  type AttemptKind,
  type AttemptLights,
  type AttemptRefusalCode,
  type AttemptRisk,
  type AttemptStatus,
  type AttemptSuccess,
  type AttemptWeight,
  type BombOutRisk,
  type CalibrationFigure,
  type CalibrationReport,
  type CalibrationShare,
  type CoachBoardActionCode,
  type CoachBoardConflictCode,
  type CoachBoardRemaining,
  type CoachBoardUrgency,
  type CurrentAttempt,
  type DataConfidence,
  type HandlerAssignment,
  type HandlerResponsibility,
  type HistoryScope,
  type HistoryStrength,
  type EvidenceAge,
  type JumpEvidence,
  type LiveAttempt,
  type LiveChoice,
  type LiveChoiceReason,
  type LiveChoiceSlot,
  type LiveTarget,
  type LiveTargetKind,
  type LiveTrigger,
  type MaximumSource,
  type MeetAction,
  type MeetActionProblemCode,
  type MeetGoal,
  type MeetPace,
  type MissCluster,
  type MissReason,
  type PlatformCall,
  type PlatformEstimate,
  type PublishedPoundsReason,
  type QualifyingAttempt,
  type RackAdvisory,
  type RackLoad,
  type RackSequence,
  type Readiness,
  type RecordRoute,
  type RecordRouteBlockCode,
  type RecordedResult,
  type ResearchComparison,
  type RefereeLight,
  type RunningTotal,
  type ScheduledItemKind,
  type SubmissionStatus,
  type TargetProgress,
  type WarmupProblemCode,
  type WeightInputProblem,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import { type Choice } from '@platform-toolkit/ui/ptk-choice-group';

import { describeEquipment, type Equipment } from '../warm-up/equipment.js';
import type { BoardLifterRef, BoardRowConflict, WarmupLead } from './board.js';
import type { LivePosition, NextActionCode, SubmissionUrgency, UrgentNote } from './live.js';
import type { MeetFileRefusal } from './meet-file.js';
import type { SaveOutcome } from './meet-store.js';
import type {
  HandlerWriteInCode,
  PackOmissionCode,
  PackWarmupAdvisoryCode,
  PackWarmupSet,
} from './pack.js';
import type { PlanProblem } from './plan.js';
import type { RecordLevelRelation, RecordSubject } from './records.js';
import {
  CUSTOM_ITEM_MAX,
  HANDOFF_PREFERENCES,
  PREP_NOTES_MAX,
  SETUP_NOTE_MAX,
  SQUAT_STARTS,
  type ChecklistGroup,
  type ChecklistItemId,
  type CustomItemRefusal,
  type LifterSetup,
  type SetupProblem,
} from './prep.js';
import {
  MEET_LIBRARY_MAX,
  MEET_NAME_MAX,
  type ImportOutcome,
  type ImportPreview,
  type LibraryRefusal,
} from './saved-meet.js';
import {
  EQUIPMENT_CATEGORIES,
  PLAN_METHODS,
  type EquipmentCategory,
  type PlanMethod,
} from './session.js';
import type {
  SummaryGapCode,
  SummaryLesson,
  SummaryLessonCode,
  SummaryOmissionCode,
  SummaryOutcome,
  SummaryRecommendation,
} from './summary.js';

export function liftLabel(lift: PlatformLift): string {
  switch (lift) {
    case 'squat':
      return 'Squat';
    case 'bench':
      return 'Bench press';
    case 'deadlift':
      return 'Deadlift';
  }
}

/**
 * A kilogram figure written in the unit the lifter chose.
 *
 * For figures that are *not* attempts -- an estimated maximum, a target total, a
 * personal record. An attempt's pound reading is the federation's chart and
 * never a conversion (`AttemptWeight.publishedPounds`, §16), so an attempt must
 * not come through here; that would print a number no bar can be loaded to and
 * no card will carry, in the one place a lifter reads a weight off a screen.
 */
export function weightText(kilograms: number, unit: WeightUnit): string {
  return formatWeight(convertWeight({ amount: kilograms, unit: 'kg' }, unit));
}

/*
 * ---------------------------------------------------------------------------
 * The sentences for a refused plan.
 * ---------------------------------------------------------------------------
 */

/**
 * One sentence per problem, all of them at once.
 *
 * A `PlanProblem` carries the domain's own message where the domain wrote one
 * and `null` where the code is the whole answer -- `OneRepMaxProblem` publishes
 * no prose, because each tool words the estimator's refusals for its own screen.
 * So this prefers the message and falls back to a sentence written here, rather
 * than re-wording every message: the domain's sentences name the figures the
 * lifter typed, and a second telling would either drop those or repeat them.
 */
export function problemSentence(problem: PlanProblem): string {
  if (problem.message !== null) return problem.message;
  switch (problem.code) {
    case 'weight-not-finite':
      return 'Enter the weight from that set using digits.';
    case 'weight-not-positive':
      return 'Enter a weight above zero for that set.';
    case 'reps-not-whole':
      return 'Enter a whole number of repetitions.';
    case 'reps-below-range':
      return 'Enter at least one completed repetition.';
    case 'reps-above-range':
      return 'Over twenty repetitions measures endurance rather than maximal strength. Use a heavier set.';
    case 'technique-unknown':
      return 'That lift has no movement standard on record.';
    case 'field-is-not-a-number':
      return 'Check the figures typed above.';
    default:
      // Every remaining code belongs to the domain's own planners, and each of
      // those problems carries a message naming the weights involved -- so this
      // arm is unreachable through `buildPlan` today. It exists because
      // `PlanProblemCode` is a union of four published code sets that grow
      // independently, and a `switch` that stopped being exhaustive would
      // otherwise fail to compile in a file nobody was editing.
      return 'That combination of figures does not make a legal plan.';
  }
}

/*
 * ---------------------------------------------------------------------------
 * The option lists.
 *
 * Here rather than in the components for the reason the sentences are: the
 * requirements constrain this wording, and the whole vocabulary has to be
 * readable in one place. They are `Choice` values because that is what
 * `ptk-choice-group` and `ptk-segmented` take.
 * ---------------------------------------------------------------------------
 */

/**
 * §6.1's opening choice, and the two branches that exist.
 *
 * The requirement names three: plan for one lifter, manage multiple lifters,
 * and resume the active meet -- with the third the most prominent when there is
 * one to resume. Nothing persists a meet across a reload yet (#52), so there is
 * never an active meet to resume and the branch is deliberately absent rather
 * than present and inert: a control that cannot do anything is never on screen
 * (§5.11), and one that says "resume" and starts an empty meet is worse than
 * one that is not there.
 */
export const SOLO_MODE = 'solo';
export const COACH_MODE = 'coach';

export const MODE_LABEL = 'What is this phone doing today?';

export const MODE_CHOICES: readonly Choice[] = [
  {
    value: SOLO_MODE,
    label: 'Plan for one lifter',
    description: 'Your own nine attempts, from the plan to the platform.',
  },
  {
    value: COACH_MODE,
    label: 'Manage multiple lifters',
    description: 'A board of everybody you are running, ordered by who needs you next.',
  },
];

/** §6.2's meet type. */
export const FORMAT_CHOICES: readonly Choice[] = [
  { value: 'full-power', label: 'Full power', description: 'Squat, bench and deadlift.' },
  { value: 'push-pull', label: 'Push/pull', description: 'Bench and deadlift.' },
  { value: 'bench-only', label: 'Bench only' },
  { value: 'deadlift-only', label: 'Deadlift only' },
];

export function formatLabel(format: MeetFormat): string {
  switch (format) {
    case 'full-power':
      return 'Full power';
    case 'push-pull':
      return 'Push/pull';
    case 'bench-only':
      return 'Bench only';
    case 'deadlift-only':
      return 'Deadlift only';
  }
}

/**
 * §6.2's display unit.
 *
 * Kilograms first, unlike tool 4's list. Attempt cards are written in kilograms
 * on every platform this planner has a rule profile for, so kilograms is the
 * unit the artefact is produced in and pounds is the reading aid.
 */
export const UNIT_CHOICES: readonly Choice[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
];

/**
 * The unit question's own label, asked from two places.
 *
 * `ptk-planner-setup` asks it as one of §6.2's four, and the coach screen asks
 * it on its own once the meet has started -- the federation and the meet type
 * are fixed by then and come off the screen, and the unit is a reading rather
 * than a decision (§16), so it keeps working. Written once because a control
 * that changes the same setting under two different names is two settings as
 * far as anybody reading the screen is concerned.
 */
export const UNIT_LABEL = 'Show weights in';

/** The unit as a word in a sentence, where "kg" beside prose reads as a label. */
export function unitWord(unit: WeightUnit): string {
  return unit === 'kg' ? 'kilograms' : 'pounds';
}

/*
 * ---------------------------------------------------------------------------
 * The question a unit change asks.
 * ---------------------------------------------------------------------------
 */

/** The two answers, spelled once so the template and the listener agree. */
export const CONVERT_ANSWER = 'convert';
export const KEEP_ANSWER = 'keep';

/**
 * A weight to show the conversion on, in whichever unit is being left.
 *
 * Two hundred of something: a plausible squat in kilograms and a plausible bench
 * in pounds, so the example never reads as a weight belonging to somebody else's
 * lift. It is an illustration and not a federation figure, so §5.1 does not
 * reach it.
 */
const CONVERSION_EXAMPLE_AMOUNT = 200;

/**
 * What the lifter is being asked, named by the unit the figures were typed in.
 *
 * The sentence says *typed in*, not *shown in*, because the two are the same
 * only until this moment: the unit control has already moved, so the figures on
 * screen are being read under a unit nobody typed them under, and a question
 * about "the weights shown" would be asking about the reading rather than about
 * the digits.
 */
export function conversionQuestion(from: WeightUnit): string {
  return `The figures on this screen were typed in ${unitWord(from)}. What should happen to them?`;
}

/**
 * The two named answers, with what each does to a worked example.
 *
 * A question with two answers rather than a "convert" button, for tool 2's
 * reason (§10.2): the button's absence is not an answer, so a lifter who ignores
 * it leaves the tool in a state where nobody -- including the tool -- knows
 * whether the digits on screen have been reinterpreted. Here that ambiguity is
 * worse than it is at a rack, because these digits become an attempt card: a
 * 200 that meant kilograms and is read as pounds is a hundred kilograms of
 * difference on a squat, declared to an expeditor.
 *
 * The example is worked out rather than described, because "convert them" and
 * "leave them" are both defensible readings of the same tap and neither label
 * says which digits end up in the boxes.
 */
export function conversionChoices(from: WeightUnit, to: WeightUnit): readonly Choice[] {
  const before = formatWeight({ amount: CONVERSION_EXAMPLE_AMOUNT, unit: from });
  const after = formatWeight(convertWeight({ amount: CONVERSION_EXAMPLE_AMOUNT, unit: from }, to));
  return [
    {
      value: CONVERT_ANSWER,
      label: `Convert them to ${unitWord(to)}`,
      description: `${before} becomes ${after}.`,
    },
    {
      value: KEEP_ANSWER,
      label: 'Leave the numbers as they are',
      description: `They were meant as ${unitWord(to)} all along.`,
    },
  ];
}

/**
 * Why the ticks went, said beside the question that took them.
 *
 * §7 will not plan from a maximum the lifter has not underwritten, and a unit
 * change moves what every figure on screen means -- so a tick made against
 * 200 kg would otherwise carry over to 200 lb unexamined. Saying so here is what
 * separates "the tool cleared them" from "the tool lost them", which is the same
 * screen to a lifter who is not told.
 */
export const CONVERSION_CONFIRMATION_NOTE =
  'The figures you agreed to have been un-ticked, because a weight means something else in the ' +
  'other unit. Agree to them again once the numbers below read the way you meant them.';

/** §6.2's first-meet question. Three states; see `firstMeetValueOf`. */
export const FIRST_MEET_CHOICES: readonly Choice[] = [
  { value: 'yes', label: 'Yes, my first' },
  { value: 'no', label: 'No, I have competed' },
  { value: 'unstated', label: 'Rather not say', secondary: true },
];

/**
 * §6.3's eight goals.
 *
 * Every description says what the goal does to the *third* attempt, because
 * §6.3's one hard rule is that an aggressive goal must not make the opener
 * aggressive -- and a list of eight ambitions with no mention of where the risk
 * goes invites exactly the reading it forbids. The last three are targets rather
 * than curves: the domain plans them off the balanced table and measures the
 * plan against the target, which is why they say so here.
 */
export const GOAL_CHOICES: readonly Choice[] = [
  {
    value: 'first-meet',
    label: 'First meet',
    description: 'Learn the meet and secure a total. The most room on every attempt.',
  },
  {
    value: 'conservative',
    label: 'Nine for nine',
    description: 'Favour making every attempt. A third just under what you expect.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'A third at what you expect on the day.',
  },
  {
    value: 'personal-record',
    label: 'Personal record',
    description: 'A dependable opener, with the risk saved for the third.',
  },
  {
    value: 'qualification',
    label: 'Qualifying total',
    description: 'Planned as balanced, then measured against the total you need.',
  },
  {
    value: 'place-or-win',
    label: 'Place or win',
    description: 'Planned as balanced, then measured against the platform.',
  },
  {
    value: 'record-attempt',
    label: 'Record attempt',
    description: 'Planned as balanced, then measured against the record.',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Your own percentages, with the legal checks still applied.',
    secondary: true,
  },
];

export function goalLabel(goal: MeetGoal): string {
  const choice = GOAL_CHOICES.find((entry) => entry.value === goal);
  return choice?.label ?? 'Balanced';
}

/**
 * §7's five ways in, as the labels a lifter chooses between.
 *
 * Named for the information the lifter already has rather than for what the tool
 * does with it -- "I know my openers", not "opener inversion". §7's premise is
 * beginning "from whichever information they trust most", and a lifter picks
 * that list by recognising their own situation in it.
 */
export const METHOD_CHOICES: readonly Choice[] = [
  { value: 'expected-max', label: 'Expected max' },
  { value: 'guided-estimate', label: 'From a recent set' },
  { value: 'known-opener', label: 'I know my openers' },
  { value: 'manual', label: 'Type every attempt' },
  { value: 'target-total', label: 'From a target total' },
];

export function methodLabel(method: PlanMethod): string {
  const choice = METHOD_CHOICES.find((entry) => entry.value === method);
  return choice?.label ?? 'Expected max';
}

/**
 * What each method wants, said once above its fields.
 *
 * Expected Max carries §7.1's four warnings in full, because that method is the
 * default and its one input is the number a lifter is most likely to overstate.
 * The others are one sentence: they ask for figures that are already facts.
 */
export function methodExplanation(method: PlanMethod): readonly string[] {
  switch (method) {
    case 'expected-max':
      return [
        'What you would realistically make on the day, in competition conditions.',
        'Not an old lifetime best, not a touch-and-go bench for a paused meet, not a gym lift to a different depth or under different rules, and not a number you are hoping for.',
      ];
    case 'guided-estimate':
      return [
        'Describe a recent set and the toolkit estimates a maximum from it. You confirm the planning figure before anything is planned.',
      ];
    case 'known-opener':
      return [
        'Enter the opener you have already decided on, and a realistic ceiling. The second and third are planned from those.',
      ];
    case 'manual':
      return [
        'Type all three attempts. Nothing here moves a weight you chose -- it checks them against the rule book and flags unusual jumps.',
      ];
    case 'target-total':
      return [
        'Enter the total you are chasing and the tool proposes how it divides. A target is not evidence that the lifts are realistic, and the split will say so when it is not.',
      ];
  }
}

/** A yes/no/declined answer, for the questions §8.1 asks that way. */
export const ANSWER_CHOICES: readonly Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unstated', label: 'Not sure', secondary: true },
];

/** §7.2's repetitions in reserve. Strings, because a radio's value is one. */
export const RESERVE_CHOICES: readonly Choice[] = [
  { value: '0', label: 'None left', description: 'Nothing more was going up.' },
  { value: '1', label: 'One more' },
  { value: '2', label: 'Two more' },
  { value: '3', label: 'Three more' },
  { value: 'four-or-more', label: 'Four or more' },
  { value: 'unknown', label: 'Not sure', secondary: true },
];

/**
 * §10.1's evidence age, asked in the bands it is graded in.
 *
 * §7.2 asks for a date. A date would be more precise than the grade can use, and
 * it is also a fact about a person that this tool would then be holding -- so the
 * question is asked at the resolution of the answer.
 */
export const EVIDENCE_AGE_CHOICES: readonly Choice[] = [
  { value: 'within-eight-weeks', label: 'Last eight weeks' },
  { value: 'within-six-months', label: 'Last six months' },
  { value: 'older', label: 'Longer ago' },
  { value: 'unstated', label: 'Not sure', secondary: true },
];

/** Where the planning maximum came from, for the methods that do not ask. */
export const MAXIMUM_SOURCE_CHOICES: readonly Choice[] = [
  { value: 'competition-single', label: 'A competition single' },
  {
    value: 'competition-standard-single',
    label: 'A training single',
    description: 'To competition depth, pause and commands.',
  },
  {
    value: 'low-repetition-estimate',
    label: 'Estimated from a low-rep set',
    description: 'Five repetitions or fewer.',
  },
  {
    value: 'high-repetition-estimate',
    label: 'Estimated from a higher-rep set',
    description: 'More than five repetitions.',
  },
  { value: 'lifetime-best', label: 'A lifetime best', description: 'With no date attached.' },
  { value: 'unstated', label: 'Rather not say', secondary: true },
];

/** §8.1's readiness. */
export const READINESS_CHOICES: readonly Choice[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'unstated', label: 'Rather not say', secondary: true },
];

export function readinessLabel(readiness: Readiness): string {
  switch (readiness) {
    case 'normal':
      return 'Normal readiness';
    case 'uncertain':
      return 'Uncertain readiness';
    case 'reduced':
      return 'Reduced readiness';
    case 'unstated':
      return 'Readiness unstated';
  }
}

export function evidenceAgeLabel(age: EvidenceAge): string {
  switch (age) {
    case 'within-eight-weeks':
      return 'evidence from the last eight weeks';
    case 'within-six-months':
      return 'evidence from the last six months';
    case 'older':
      return 'older evidence';
    case 'unstated':
      return 'undated evidence';
  }
}

export function maximumSourceLabel(source: MaximumSource): string {
  const choice = MAXIMUM_SOURCE_CHOICES.find((entry) => entry.value === source);
  return choice?.label ?? 'Rather not say';
}

/** §8.1's equipment category, as the federation counts it. */
export const EQUIPMENT_CHOICES: readonly Choice[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'wraps', label: 'Raw with wraps' },
  { value: 'single-ply', label: 'Single ply' },
  { value: 'multi-ply', label: 'Multi ply' },
  { value: 'other', label: 'Other', secondary: true },
  { value: 'unstated', label: 'Rather not say', secondary: true },
];

export function equipmentLabel(category: EquipmentCategory): string {
  const choice = EQUIPMENT_CHOICES.find((entry) => entry.value === category);
  return choice?.label ?? 'Rather not say';
}

/**
 * §8.2's research comparison group.
 *
 * Deliberately worded as a choice about which dataset the *warnings* are drawn
 * from, and never as a question about the lifter. §8.2 requires it to be
 * separate from any federation competition category, and the reason it is
 * offered at all is that the published jump research reports male and female
 * datasets separately -- so declining is a real answer that costs precision
 * rather than an omission.
 */
export const COMPARISON_CHOICES: readonly Choice[] = [
  { value: 'male', label: 'Male dataset' },
  { value: 'female', label: 'Female dataset' },
  { value: 'none', label: 'No sex-specific comparison' },
];

export function comparisonLabel(comparison: ResearchComparison): string {
  switch (comparison) {
    case 'male':
      return 'male dataset';
    case 'female':
      return 'female dataset';
    case 'none':
      return 'no sex-specific comparison';
  }
}

export const COMPARISON_EXPLANATION =
  'The published jump research reports male and female datasets separately. Choosing one makes the lift-specific warnings quote the figures measured on that group. It is optional, it is nothing to do with the category you compete in, and declining it leaves the warnings drawn from general guidance instead.';

/**
 * Every method's option list, so a caller does not rebuild it.
 *
 * Derived from `PLAN_METHODS` rather than written out, so a sixth method cannot
 * be added to the session and left out of the chooser -- which would be a method
 * reachable by a restored preference and by nothing on screen.
 */
export function methodChoices(): readonly Choice[] {
  return PLAN_METHODS.map(
    (method) =>
      METHOD_CHOICES.find((choice) => choice.value === method) ?? { value: method, label: method },
  );
}

/** The same guard for the equipment list, for the same reason. */
export function equipmentChoices(): readonly Choice[] {
  return EQUIPMENT_CATEGORIES.map(
    (category) =>
      EQUIPMENT_CHOICES.find((choice) => choice.value === category) ?? {
        value: category,
        label: category,
      },
  );
}

/*
 * ---------------------------------------------------------------------------
 * The plan screen.
 *
 * Everything below labels something the domain already decided. Nothing here
 * grades, compares or combines -- the two headline words on this screen are
 * §10's two axes, and the whole rule about them is that a sentence naming both
 * must not exist. So they get separate label functions, separate explanations,
 * and no function that takes them together.
 * ---------------------------------------------------------------------------
 */

/** §9's names for the three attempts. */
export function attemptLabel(attemptNumber: 1 | 2 | 3): string {
  switch (attemptNumber) {
    case 1:
      return 'Opener';
    case 2:
      return 'Second attempt';
    case 3:
      return 'Third attempt';
  }
}

/** §10.2's four words, verbatim, and the interface may use no others. */
export function riskLabel(risk: AttemptRisk): string {
  switch (risk) {
    case 'secure':
      return 'Secure';
    case 'recommended':
      return 'Recommended';
    case 'push':
      return 'Push';
    case 'long-shot':
      return 'Long shot';
  }
}

/**
 * What the risk word is measuring, said once beside the scale.
 *
 * The sentence has one job beyond describing the axis, and it is the last line:
 * a lifter who reads "Long shot" as an estimate of whether the lift will go up
 * has read a probability off a screen that never printed one, and §10.2's ban is
 * on the claim rather than on the digits. Saying what the word is *not* is the
 * only way to close that, because the word alone invites the reading.
 */
export const RISK_EXPLANATION =
  'Risk describes how much of a reach a weight is against your confirmed maximum, one attempt at a time. It is not a statement about whether the lift will be good on the day.';

/** §10.1's three grades. */
export function confidenceLabel(level: DataConfidence): string {
  switch (level) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
  }
}

/**
 * The other axis, and the sentence that keeps the two apart.
 *
 * §10 requires these never to be fused into one score, and the failure that rule
 * exists to prevent is not a formula -- it is a reader who sees two words side by
 * side and averages them. A low grade beside a Secure opener is a perfectly
 * coherent plan; this says so in as many words, because nothing else on the
 * screen can.
 */
export const CONFIDENCE_EXPLANATION =
  'Data confidence grades how well described you are, not how good the plan is. It moves only when you tell the planner more about where your maximum came from. A plan can be well described and ambitious, or thinly described and cautious.';

/** §9: the third is recalculated after the second, so it is never a commitment. */
export const PROVISIONAL_NOTE =
  'A scenario, not a commitment. Decide it after you see the second attempt.';

/**
 * §9.3's caveat, which is required whether or not the lifter is in the dataset.
 *
 * Both arms name the population, because the requirement is that a warning
 * "explain that these ranges come from population data in raw IPF competition
 * and may not fit every lifter" -- and the arm that matters most is `general`,
 * where the lifter is outside the measured group and the numbers are the same
 * numbers. §9.3 asks for a lower-evidence label there rather than false
 * precision, so the wording says the range is being quoted at a distance rather
 * than quietly dropping it.
 */
export function jumpEvidenceNote(evidence: JumpEvidence): string {
  switch (evidence) {
    case 'population-matched':
      return 'Drawn from published jump data measured in raw international competition. It describes what lifters commonly do, and may not fit you.';
    case 'general':
      return 'Drawn from published jump data measured in raw international competition, on lifters set up differently from you -- equipment, rules or comparison group. Treat it as general guidance rather than a figure matched to your lifting.';
  }
}

/** §15.1: the tool checks a weight against the rules and never submits one. */
export function refusalSentence(code: AttemptRefusalCode): string {
  switch (code) {
    case 'not-a-legal-bar-weight':
      return 'The bar cannot be loaded to this weight under the chosen rule book.';
    case 'below-the-minimum-progression':
      return 'This is not far enough above the attempt before it.';
    case 'below-a-failed-attempt':
      return 'This is below an attempt that was already missed, which the rule book does not allow.';
  }
}

/**
 * An attempt, in kilograms, whatever unit the lifter is typing in.
 *
 * Deliberately not `weightText`, and this is the one place on the screen where
 * the difference matters. `weightText` writes a figure in the lifter's chosen
 * unit, which for an attempt means computing a pound figure -- and §16 gives that
 * job to the federation's published chart and to nothing else. A card is written
 * in kilograms on every platform this tool has a rule profile for, so the
 * kilogram figure is the attempt and the pound figure beside it is a reading aid
 * that either comes off the chart or is labelled approximate.
 */
export function attemptKilogramsText(weight: AttemptWeight): string {
  return formatWeight({ amount: weight.kilograms, unit: 'kg' });
}

/**
 * An attempt's pound reading, which comes off the federation's chart or not at
 * all.
 *
 * §16 is explicit that a pound figure beside an attempt is the published chart's
 * and never a conversion, and the reason is the expeditor's table: a lifter who
 * reads a computed pound figure off this screen is reading a number that is not
 * on the card and not in the rule book. So this returns `null` rather than
 * falling back to `exactPounds` -- the approximate figure is shown separately
 * and labelled as approximate, which is a different claim in a different place.
 */
export function attemptPoundsText(weight: AttemptWeight): string | null {
  if (weight.publishedPounds === null) return null;
  return `${formatWeight({ amount: weight.publishedPounds, unit: 'lb' })} on the chart`;
}

/** Why there is no chart figure, so the absence is an answer rather than a gap. */
export function poundsAbsenceSentence(reason: PublishedPoundsReason): string | null {
  switch (reason) {
    case 'published':
      return null;
    case 'not-on-the-chart':
      return 'The federation chart has no row for this weight.';
    case 'no-chart':
      return 'No published pound chart is loaded, so the pound figures below are approximate conversions rather than the chart entries themselves.';
  }
}

/** The unrounded conversion, always hedged, and never the attempt (§16). */
export function approximatePoundsText(weight: AttemptWeight): string {
  return `about ${formatWeight({ amount: weight.exactPounds, unit: 'lb' })}`;
}

/*
 * §12: recording what happened.
 *
 * The wording here is doing more work than the rest of this file, because it is
 * read standing up, between attempts, by somebody who has just lifted. Every
 * label below is the shortest thing that is still unambiguous, and the second
 * lines exist only where the short label would be read two ways -- §12 allows
 * the whole flow three or four taps, and a tile carrying two lines of prose is
 * a tile that gets read instead of tapped.
 */

/** The four results §12.1 lists, in the order it lists them. */
export type ResultOutcome = RecordedResult['outcome'];

/**
 * §12.1's four outcomes.
 *
 * "Passed" and "Extra attempt granted" are marked secondary -- not hidden, and
 * still the same tiles under the same arrow keys, but the two answers that come
 * up a handful of times across a whole meet should not be the same visual weight
 * as the two that come up on every attempt. The granted extra in particular is
 * the expeditor's decision arriving at the tool, not a thing a lifter chooses.
 */
export const OUTCOME_CHOICES: readonly Choice[] = [
  { value: 'good', label: 'Good lift' },
  { value: 'no-lift', label: 'No lift' },
  { value: 'passed', label: 'Passed', secondary: true },
  { value: 'extra-attempt-granted', label: 'Extra attempt granted', secondary: true },
];

export function outcomeLabel(outcome: ResultOutcome): string {
  switch (outcome) {
    case 'good':
      return 'Good lift';
    case 'no-lift':
      return 'No lift';
    case 'passed':
      return 'Passed';
    case 'extra-attempt-granted':
      return 'Extra attempt granted';
  }
}

/**
 * §12.2's six readings, worded from the requirement rather than paraphrased.
 *
 * These carry descriptions where the others do not, because the whole scale is a
 * comparison against one thing -- what the lifter expected -- and a bare "Slow"
 * invites the reading "slow for a heavy weight", which is every third attempt
 * ever made. §13 branches on these, so a lifter picking the wrong word here moves
 * the next recommendation; that is the reason this is the one list on the screen
 * worth spending two lines a tile on.
 *
 * "Pain or unsafe" is not secondary and must never become so. It is the one
 * reading that stops the tool offering an increase at all.
 */
export const EFFORT_CHOICES: readonly Choice[] = [
  { value: 'flew', label: 'Flew', description: 'Clearly easier or faster than expected.' },
  { value: 'solid', label: 'Solid', description: 'About as expected.' },
  { value: 'slow', label: 'Slow', description: 'Harder than expected, but controlled.' },
  { value: 'grind', label: 'Grind', description: 'Near-maximal.' },
  { value: 'pain', label: 'Pain or unsafe' },
  { value: 'unsure', label: 'Not sure', secondary: true },
];

export function effortLabel(effort: AttemptEffort): string {
  switch (effort) {
    case 'flew':
      return 'Flew';
    case 'solid':
      return 'Solid';
    case 'slow':
      return 'Slow';
    case 'grind':
      return 'Grind';
    case 'pain':
      return 'Pain or unsafe';
    case 'unsure':
      return 'Not sure';
  }
}

/**
 * §12.3's six reasons.
 *
 * The requirement's own sentence is the reason this is a tile list and not a
 * note: "These reasons materially affect the next recommendation and must not be
 * hidden in a notes field." The first one carries a description because the
 * distinction it draws -- the strength was there, the lift was not -- is the
 * whole point of asking, and it is the difference between the tool offering the
 * same weight again and offering less.
 */
export const MISS_REASON_CHOICES: readonly Choice[] = [
  {
    value: 'command',
    label: 'Command or technical',
    description: 'The strength was there.',
  },
  { value: 'strength', label: 'Strength' },
  { value: 'pain', label: 'Pain or unsafe' },
  { value: 'platform-error', label: 'Loading, spotter or official error' },
  { value: 'administrative', label: 'Timeout or paperwork' },
  { value: 'unsure', label: 'Not sure', secondary: true },
];

export function missReasonLabel(reason: MissReason): string {
  switch (reason) {
    case 'command':
      return 'Command or technical';
    case 'strength':
      return 'Strength';
    case 'pain':
      return 'Pain or unsafe';
    case 'platform-error':
      return 'Loading, spotter or official error';
    case 'administrative':
      return 'Timeout or paperwork';
    case 'unsure':
      return 'Not sure';
  }
}

/**
 * One referee's light.
 *
 * Two words rather than two colours: §21 forbids colour as an identity cue on
 * the coach board, and the same argument applies harder here, where the two
 * values *are* colours and a red-green reader would be choosing between two
 * identical tiles. The words are the control; any colour is decoration on top.
 */
export const LIGHT_CHOICES: readonly Choice[] = [
  { value: 'white', label: 'White' },
  { value: 'red', label: 'Red' },
];

export function lightLabel(light: RefereeLight): string {
  switch (light) {
    case 'white':
      return 'White';
    case 'red':
      return 'Red';
  }
}

/** The three positions, in `AttemptLights` order. Names, because they are seats. */
export const LIGHT_POSITION_LABELS = ['Left', 'Head', 'Right'] as const;

/**
 * The optional fold, and the promise its summary has to keep.
 *
 * §12.1 says light-by-light entry must not be required before the next choices
 * appear, so everything in here is genuinely optional and the summary has to say
 * so while folded -- a fold whose summary reads like a question gets opened by
 * everyone, which costs the taps §12 was counting.
 */
export const DETAIL_FOLD_SUMMARY = 'Add lights, RPE or a note -- optional';

/** §12.1's notes field. The referees' stated reason goes here too. */
export const NOTE_LABEL = 'Notes';
export const NOTE_HINT =
  'What the referees said, how the bar moved -- anything worth reading back.';

/**
 * RPE, and the one place this tool knowingly departs from its requirement.
 *
 * §12.2 offers RPE "instead" of the plain-language effort. Here it is an
 * addition: the effort reading is required on a good lift and RPE sits beside it.
 * The reason is downstream -- `live-choices.ts` branches on `AttemptEffort` and
 * on nothing else, so an attempt recorded with RPE alone would reach the next
 * recommendation with no reading to act on. Mapping 8 onto "solid" would invent
 * a correspondence nobody published, and would do it silently, at the point where
 * the tool decides what to offer next.
 */
export const RPE_LABEL = 'RPE';
export const RPE_HINT =
  'Optional, on the usual 6 to 10 scale. Recorded alongside the reading above, not instead of it.';

/** Said on the card, because §14's named failure is the wrong athlete. */
export function resultSubjectLine(
  lifterName: string,
  lift: PlatformLift,
  attemptNumber: number,
): string {
  return `${lifterName} -- ${liftLabel(lift)} attempt ${String(attemptNumber)}`;
}

/**
 * What is still missing, said rather than left for the lifter to work out.
 *
 * A disabled button with no explanation is the version of this screen that gets
 * pressed four times and then abandoned, and this one is disabled for exactly one
 * reason at a time -- so the sentence can name it.
 */
export const OUTCOME_MISSING = 'Choose what happened.';
export const EFFORT_MISSING = 'Say how it felt. This changes what comes next.';
export const MISS_REASON_MISSING = 'Say why it was missed. This changes what comes next.';

/** The button. Imperative, because §12 counts the taps and this is the last one. */
export const RECORD_LABEL = 'Record';

/**
 * §29 arriving on the one screen where it is most tempting to leave it out.
 *
 * The tool has just been told the result of an attempt, which makes it look like
 * a record of the meet. It is not one: the scoring table's sheet is, and a lifter
 * who reconciles against this screen at the end of the day is reconciling against
 * their own typing.
 */
export const RECORD_KEEPING_NOTE =
  "Your record of the day, not the meet's. The scoring table's sheet is the one that counts.";

/*
 * ---------------------------------------------------------------------------
 * §13: the three choices, live.
 *
 * TWO VOCABULARIES THAT SHARE THREE WORDS
 *
 * §13 names the three slots Secure, Recommended and Push. §10.2 names the four
 * risk bands Secure, Recommended, Push and Long shot. They are not the same
 * scale and they do not move together: the slot says which of three offers a
 * card is, and the band says what `classifyAttemptRisk` made of the weight on
 * it. A Push slot holding a Recommended weight is not a contradiction -- it is
 * what a conservative plan looks like after a lift flew -- but a card headed
 * "Push" carrying a bare chip reading "Recommended" cannot be read at all.
 *
 * Neither word can be renamed. Both are the requirement's own, and inventing a
 * synonym for a term §10.2 defines would put a fifth word into a vocabulary
 * that already has one word too many. So the risk band is never printed bare on
 * this screen: it arrives prefixed, "Risk: Recommended", and the slot name is
 * the card's heading. Exactly one of the two is always labelled, which is the
 * cheapest thing that makes the pair legible, and it is a wording rule rather
 * than a layout one -- a colour or a position would be lost the moment the card
 * is read aloud, which on a platform floor is how it is usually read.
 * ---------------------------------------------------------------------------
 */

/** Which of the three offers this is. The card's heading. */
export function slotLabel(slot: LiveChoiceSlot): string {
  switch (slot) {
    case 'secure':
      return 'Secure';
    case 'recommended':
      return 'Recommended';
    case 'push':
      return 'Push';
  }
}

/**
 * What the three slots are, said once above them.
 *
 * The sentence exists because the highlighted card is the tool's answer and the
 * other two are not runners-up -- §13 requires all three to stay pressable, and
 * a lifter who reads the highlight as the only real option has lost the choice
 * the screen was built to offer.
 */
export const SLOTS_EXPLANATION =
  'Three legal weights, all of them yours to take. The highlighted one is what this tool would do; the other two are not worse answers, they are different bets.';

/**
 * The highlight, as a word rather than as a border.
 *
 * §13 asks for one option to be highlighted, and a tinted edge is the obvious
 * way to do it -- which fails under forced colours, fails for a reader who
 * cannot separate the hues, and fails completely when the card is read out. The
 * badge is the highlight; the border is decoration on top of it.
 */
export const HIGHLIGHT_BADGE = "This tool's pick";

/** Said when nothing was graded, so an absent band is not read as a safe one. */
export const RISK_NOT_ASSESSED = 'Risk: not graded without a confirmed meet-day maximum';

/**
 * The risk band, always prefixed, never bare (see the header above).
 *
 * Takes the whole choice rather than the band so that the one card with no
 * weight on it -- Pass -- is answered here instead of in the template. There is
 * nothing to grade about not lifting, and "Risk: not graded" on that card would
 * read as a warning about passing.
 */
export function riskLine(choice: LiveChoice): string | null {
  if (choice.kilograms === null) return null;
  if (choice.risk === null) return RISK_NOT_ASSESSED;
  return `Risk: ${riskLabel(choice.risk)}`;
}

/**
 * The jump from the preceding attempt, in kilograms and only in kilograms.
 *
 * The lifter's display unit is deliberately not consulted. §16 makes kilograms
 * the attempt, so the weight on this card is a kilogram figure, and a jump
 * printed in pounds beside it is two units in one sentence about one bar -- the
 * reading that produces is "up 11" from "182.5", which is not arithmetic anyone
 * can do standing up.
 */
export function increaseText(choice: LiveChoice): string | null {
  const increase = choice.increaseKilograms;
  if (increase === null) return null;
  if (choice.repeat || increase === 0) return 'The same weight again';
  if (increase < 0) return `Down ${formatWeight({ amount: -increase, unit: 'kg' })}`;
  return `Up ${formatWeight({ amount: increase, unit: 'kg' })}`;
}

/**
 * The weight as a share of the confirmed meet-day maximum.
 *
 * Whole numbers. A tenth of a percent of a maximum is a hundred grams of
 * implied precision, and the maximum this is a share of was in most cases typed
 * from memory -- the extra digit would be the most precise-looking thing on the
 * card and the least earned.
 *
 * Not a probability and must never be worded as one (§10.2): this says where
 * the weight sits on a scale the lifter already believes, and says nothing at
 * all about whether it goes up.
 */
export function percentOfMaximumText(percentOfMaximum: number | null): string | null {
  if (percentOfMaximum === null) return null;
  return `${percentOfMaximum.toFixed(0)}% of your meet-day maximum`;
}

/**
 * A running total said as a subtotal or as a total, with what is still to come.
 *
 * Named for the shape rather than for the caller, because there are two of these
 * on the §11 screen -- what is banked and what the highlighted choice would leave
 * -- and one function formatting both is the point: it was called `projectedText`
 * while it had one call site, and a second name for the same fact is how the two
 * figures drift into being worded differently, which §17 is precisely about.
 * Which of the two a figure is comes from its heading, not from its sentence.
 *
 * A total *is* shown in the lifter's unit, unlike the attempt above it: nobody
 * calls a total to an expeditor, so the §16 rule that makes the attempt a
 * kilogram figure does not reach it, and a lifter chasing a 1200 lb total wants
 * to see it in the unit they set it in.
 */
export function runningTotalText(total: RunningTotal, unit: WeightUnit): string {
  const amount = weightText(total.kilograms, unit);
  if (total.isTotal) return `Total ${amount}`;
  if (total.liftsOutstanding.length === 0) return `Subtotal ${amount}`;
  return `Subtotal ${amount}, ${liftListText(total.liftsOutstanding)} still to come`;
}

/**
 * How this tool names one of §8.3's targets.
 *
 * `LiveTarget.label` is a required field whose contract is "how the interface
 * names it, in the caller's words", so the words have to come from somewhere in
 * this tool, and this is where every other word on these screens lives. It is
 * the one string a pure builder here reads out of `copy.ts` -- `live-session.ts`
 * imports it -- and the alternative was passing a table of nine labels into that
 * builder, which is the same coupling written twice.
 *
 * The lift is part of the label rather than left to the layout, because a target
 * is named in a sentence -- "Reaches squat personal record, personal record
 * total" -- and three lifts' records all reading "Personal record" in one list
 * is a lifter being told they reached something three times.
 */
export function targetLabel(kind: LiveTargetKind, lift: PlatformLift | null): string {
  switch (kind) {
    case 'personal-record':
      return lift === null
        ? 'personal record total'
        : `${liftLabel(lift).toLowerCase()} personal record`;
    case 'qualification':
      return 'qualifying total';
    case 'classification':
      return 'classification target';
    case 'placing':
      return 'placing target';
    case 'record':
      return 'record target';
    case 'best-lifter':
      return 'best-lifter target';
    case 'minimum-acceptable':
      return 'minimum acceptable total';
    case 'stretch':
      // "Stretch total", never "stretch projection". The projection is what the
      // plan is currently on course for; this is what the lifter said would be a
      // good day, and §17's whole point is that the two are not one figure.
      return 'stretch total';
  }
}

/** §13's "reaches a target", named with the caller's own words for the target. */
export function reachesText(targets: readonly LiveTarget[]): string | null {
  if (targets.length === 0) return null;
  return `Reaches ${listText(targets.map((target) => target.label))}`;
}

/**
 * What taking this choice gives up.
 *
 * §13.3 asks for it on a reduction and this shows it on any choice that has
 * one, because the case that matters is the secure card quietly surrendering a
 * record the push card would have reached -- which is a fact about the secure
 * card, and putting it only on the reduction would hide it exactly there.
 */
export function surrendersText(targets: readonly LiveTarget[]): string | null {
  if (targets.length === 0) return null;
  return `Gives up ${listText(targets.map((target) => target.label))}`;
}

/**
 * §13.4's label, which the requirement asks for in those words.
 *
 * A tactical weight is chosen against another lifter's attempt and not against
 * what this lifter can lift, and the two reasons produce the same number on the
 * same card. Unlabelled, a lifter reads the tool's opinion of their strength
 * off a figure that was never about it.
 */
export const TACTICAL_NOTE = 'Tactical: chosen against the other lifters, not against your best';

/** §13.5's words, kept exactly, because they are what gets said to an official. */
export const PASS_LABEL = 'Pass / Stop this lift';

/**
 * The button on a card.
 *
 * Takes the resolved `AttemptWeight` and not a raw number so that the kilogram
 * figure on the button is the same object the card printed above it. Three
 * buttons reading "Choose" would also be three identical accessible names in
 * one list, which is the version of this screen a screen reader cannot use.
 */
export function chooseLabel(weight: AttemptWeight | null): string {
  return weight === null ? PASS_LABEL : `Choose ${attemptKilogramsText(weight)}`;
}

/**
 * What the offer is reacting to, said out loud above it.
 *
 * The three weights change completely between a lift that flew and one that was
 * a grind, and the reading that moved them was typed a screen ago. Printing it
 * here is what lets a lifter notice they tapped the wrong tile -- otherwise the
 * only evidence is that the numbers look wrong, and by then it is a declaration.
 */
export function triggerSentence(trigger: LiveTrigger): string {
  switch (trigger) {
    case 'flew':
      return 'That one flew.';
    case 'solid':
      return 'That one was solid.';
    case 'slow':
      return 'That one was slow.';
    case 'grind':
      return 'That one was a grind.';
    case 'pain':
      return 'You reported pain on that one.';
    case 'effort-not-recorded':
      return 'Good lift, with no reading of how it felt.';
    case 'command-miss':
      return 'Missed on a command.';
    case 'strength-miss':
      return 'Missed on strength.';
    case 'pain-miss':
      return 'Missed, with pain reported.';
    case 'platform-error':
      return 'Missed on a platform error.';
    case 'administrative-miss':
      return 'Missed on an administrative call.';
    case 'miss-reason-not-recorded':
      return 'Missed, with no reason recorded.';
    case 'attempt-set-aside':
      return 'That attempt was set aside and another granted.';
    case 'nothing-recorded-yet':
      return 'Nothing taken on this lift yet.';
  }
}

/**
 * The free-entry field, which is the half of §13 that is easiest to leave out.
 *
 * "Never prevent the user from entering a different legal weight" is a
 * requirement about this control existing, and a screen with three cards and no
 * field meets every other line of §13 while failing that one. The hint says the
 * three are suggestions because a card looks like a menu and a menu looks
 * closed.
 */
export const OTHER_WEIGHT_LABEL = 'Another weight';
export const OTHER_WEIGHT_HINT =
  'Kilograms. The three above are suggestions, not the list -- anything legal for this attempt can go here.';
export const OTHER_WEIGHT_SUBMIT = 'Use this weight';

/** Kilograms, because the attempt is a kilogram figure and nothing here converts (§16). */
export const OTHER_WEIGHT_MUST_BE_KILOGRAMS =
  'Attempts are declared in kilograms, so type the kilogram figure with no unit after it.';

/** One sentence per way a typed weight fails to be a weight. */
export function weightInputProblemSentence(code: WeightInputProblem): string {
  switch (code) {
    case 'empty':
      return 'Type a weight first.';
    case 'not-a-number':
      return 'Enter the weight using digits, for example 182.5.';
    case 'negative':
      return 'A weight cannot be negative.';
    case 'too-large':
      return `Enter a weight under ${String(MAX_WEIGHT_INPUT)} kg.`;
    case 'unknown-unit':
      return OTHER_WEIGHT_MUST_BE_KILOGRAMS;
  }
}

/**
 * §13.8's extras, kept beside the three and never among them.
 *
 * A fourth attempt is not a fourth choice: it does not raise the floor under a
 * later attempt, it does not count toward the total in most rule sets, and a
 * lifter who takes one from the same list they take a competition attempt from
 * has made the mistake the separate status exists to prevent.
 */
export const EXTRA_ATTEMPTS_HEADING = 'Extra attempts';
export const EXTRA_ATTEMPTS_NOTE =
  'Tracked apart from the three. These do not raise the floor under a competition attempt.';

export function extraAttemptLine(attempt: LiveAttempt): string {
  const kind = attempt.kind === 'record' ? 'Record attempt' : 'Extra attempt';
  const weight =
    attempt.kilograms === null
      ? 'no weight yet'
      : formatWeight({ amount: attempt.kilograms, unit: 'kg' });
  return `${kind} on ${liftMidSentence(attempt.lift)} -- ${weight}, ${attemptStatusText(attempt.status)}`;
}

/** Where an attempt has got to, in the words a handler would use. */
export function attemptStatusText(status: AttemptStatus): string {
  switch (status) {
    case 'planned':
      return 'planned';
    case 'proposed':
      return 'proposed';
    case 'selected':
      return 'chosen, not yet handed in';
    case 'submitted':
      return 'handed in';
    case 'confirmed':
      return 'confirmed by the table';
    case 'locked':
      return 'locked';
    case 'good':
      return 'good lift';
    case 'no-lift':
      return 'no lift';
    case 'passed':
      return 'passed';
    case 'extra-attempt-granted':
      return 'set aside, another granted';
  }
}

/** Said where there is nothing to offer, so an empty card list is an answer. */
export const NO_CHOICES_NOTE = 'No weights to offer on this lift.';

/*
 * ---------------------------------------------------------------------------
 * §14: handing the next attempt to the table, against a clock.
 *
 * THE TOOL HANDS NOTHING IN
 *
 * §14 says plainly that the application does not submit attempts to meet
 * officials, and every sentence below is written so that a lifter reading this
 * panel at speed cannot come away believing otherwise. The button says "Mark
 * handed in", which records something the lifter did; it never says "Submit",
 * which would name an action the tool cannot take and would be believed on the
 * one screen where being wrong costs an attempt.
 *
 * THE CLOCK IS AN AID AND SAYS SO
 *
 * The minute starts when the result is recorded here, which may already be
 * several seconds after the referees' decision -- §14.1 allows exactly that and
 * calls the official clock authoritative. So the panel carries that sentence
 * itself rather than putting it in a help fold: a countdown with no such line
 * on it is read as the deadline, and the reading is wrong in the direction of
 * running out of time later than the table does.
 *
 * URGENCY IS WORDS FIRST
 *
 * §14.1 asks for visual urgency, and §5.8 forbids colour as the sole carrier of
 * meaning. The seconds are always on screen and the band is always a sentence,
 * so the panel is legible in forced colours, to a reader who cannot separate the
 * hues, and -- the case that actually happens -- when a handler reads it aloud
 * across a warm-up room.
 * ---------------------------------------------------------------------------
 */

export const SUBMISSION_HEADING = 'Hand in the next attempt';

/**
 * The name and the weight on one line, because §14 names the failure.
 *
 * "Show the lifter's name and weight clearly to prevent submitting the correct
 * weight for the wrong athlete" -- which is a handler with two lifters on two
 * platforms and one phone. The two facts are one line so that neither can be
 * read without the other; on separate lines the name scrolls away from the
 * figure on a 320px screen, and it is the pairing that carries the check.
 */
export function submissionSubjectLine(lifterName: string, weight: AttemptWeight | null): string {
  const chosen = weight === null ? 'no weight chosen yet' : attemptKilogramsText(weight);
  return `${lifterName} -- ${chosen}`;
}

/**
 * The clock face: minutes and seconds, zero-padded.
 *
 * Negative input is clamped rather than rendered, because a lapsed deadline is a
 * different sentence and "-0:03 left" reads as three seconds of credit. The
 * seconds come from the view, which derives them from `now`, so a throttled tab
 * makes this jump rather than drift (see the clock seam).
 */
export function countdownText(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The same figure in words, for the label on the clock face.
 *
 * A screen reader announcing "zero colon four two" is the digits read as digits.
 * This is not a live region -- it changes four times a second and would talk
 * over everything else on the screen -- it is the accessible name of a figure
 * somebody may ask for once.
 */
export function countdownSpokenText(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  if (clamped === 0) return 'no time left';
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const minutePart = minutes === 0 ? '' : `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  const secondPart = seconds === 0 ? '' : `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
  return `${[minutePart, secondPart].filter((part) => part !== '').join(' ')} left`;
}

/**
 * The band as a sentence. The one thing on this panel that is announced.
 *
 * Four values over a whole minute, so a reader is told the deadline is closing
 * without being read a number every quarter second. The wording escalates and
 * never repeats, because a live region that announces the same string twice is
 * announced once by most screen readers and the second escalation would be
 * silent.
 */
export function urgencySentence(urgency: SubmissionUrgency): string {
  switch (urgency) {
    case 'calm':
      return 'There is time. Choose the weight, then mark it handed in.';
    case 'hurry':
      return 'Under thirty seconds. Get the weight to the table.';
    case 'critical':
      return 'Seconds left.';
    case 'lapsed':
      return 'The minute has passed.';
  }
}

/** Whether the lifter has said they handed it in. Not whether the table has it. */
export function submissionStatusText(submitted: boolean): string {
  return submitted ? 'Marked handed in' : 'Not marked handed in';
}

export const MARK_SUBMITTED_LABEL = 'Mark handed in';

/**
 * What the officials write down if nothing is handed in (§14.1).
 *
 * `null` where the rules have nothing to apply, and that is a different sentence
 * rather than a missing one: "the same weight again" is what happens after a
 * miss, and printing it where no result has been recorded yet would tell a lifter
 * a fallback exists that does not.
 */
export function automaticSentence(automatic: AttemptWeight | null): string {
  if (automatic === null) {
    return 'These rules set no automatic weight here, so a missed deadline is the table to sort out.';
  }
  return `If nothing is handed in, the table takes ${attemptKilogramsText(automatic)}.`;
}

/**
 * On the panel, not in a fold.
 *
 * The tool's minute starts when a result is recorded here, which is already late
 * by however long it took to reach the phone. A countdown with no such line on
 * it is read as the deadline itself.
 */
export const OFFICIAL_CLOCK_NOTE =
  'The official clock is the one that counts. This one starts when you record the result, so it may already be a few seconds behind.';

/** Said in place of the panel, so "no deadline is running" is an answer. */
export const NO_SUBMISSION_NOTE = 'No submission deadline is running.';

/**
 * Said in place of the clock, on the opener of a lift.
 *
 * The tool's minute runs from a recorded result and looks for the next attempt
 * on the same lift, so nothing is counting before squat one, bench one or
 * deadlift one -- and nothing should be, because an opener is due at weigh-in
 * and at whatever round the platform has reached, neither of which this tool can
 * see. The weight is still owed and the panel is still the control that says it
 * went to the table; it simply has no time on it. A blank where the digits go
 * reads as a clock that has stopped, which is the reading that costs an attempt,
 * so the absence gets a sentence.
 */
export const NO_DEADLINE_NOTE =
  'No clock on this one. An opener is due when the table says, not on this timer.';

/*
 * ---------------------------------------------------------------------------
 * §11: live mode, where the screen says one thing.
 *
 * ONE NEXT ACTION, NOT A LIST OF EVERYTHING POSSIBLE
 *
 * §11 asks that live mode "remove setup details from the immediate workflow and
 * show only what matters now", and names the next action as prominent. So the
 * headline below is one sentence in the imperative, chosen from four codes, and
 * every other thing the screen can do stays reachable without being offered.
 * The failure this avoids is the screen it replaces: a lifter at the expeditor's
 * table reading a page of live controls and having to work out which one is
 * theirs, with under a minute to do it.
 *
 * THE FIGURES ARE NAMED, NEVER JUST SHOWN
 *
 * There are two totals on this screen and §17 forbids collapsing them into one.
 * Both therefore carry their own heading, and the projected one says out loud
 * that it depends on an attempt that has not happened. A lifter two lifts in,
 * shown one figure, believes the day is banked.
 * ---------------------------------------------------------------------------
 */

/**
 * §11's headline, in the imperative, one code at a time.
 *
 * Written as an instruction rather than as a status ("Choose the next attempt",
 * not "Awaiting selection") because the requirement is that the lifter be told
 * the next thing to do. A status line is a description of the tool's state, and
 * the reader then has to translate it into their own action -- which is the step
 * this screen exists to remove.
 */
export function nextActionHeadline(action: NextActionCode): string {
  switch (action) {
    case 'choose-the-next-attempt':
      return 'Choose the next attempt';
    case 'submit-to-the-table':
      return 'Take the weight to the table';
    case 'record-the-result':
      return 'Record what the referees gave';
    case 'the-meet-is-over':
      return 'Your meet is done';
  }
}

/**
 * §11's "current lift and round", as one line.
 *
 * The round is the attempt number and is said as a word rather than shown as a
 * bare digit beside the weights: "Squat, attempt 2" cannot be misread as part of
 * the figure below it, and on this screen every other number is a kilogram.
 */
export function positionText(position: LivePosition): string {
  if (position.lift === null || position.attemptNumber === null) {
    return 'No lift under way';
  }
  return `${liftLabel(position.lift)}, attempt ${String(position.attemptNumber)}`;
}

/** §11's "jump from the previous attempt", which is silent rather than zero on an opener. */
export function jumpText(jumpKilograms: number | null): string | null {
  if (jumpKilograms === null) return null;
  if (jumpKilograms === 0) return 'Same weight again';
  const direction = jumpKilograms > 0 ? 'Up' : 'Down';
  return `${direction} ${formatWeight({ amount: Math.abs(jumpKilograms), unit: 'kg' })} from the last attempt`;
}

export const NEXT_ATTEMPT_HEADING = 'Next attempt';

/** Said where no attempt is owed, so an empty card is an answer rather than a gap. */
export const NO_NEXT_ATTEMPT_NOTE = 'No attempt is owed right now.';

/** Said where the attempt exists but has no weight yet, which is a state and not a fault. */
export const NEXT_ATTEMPT_UNCHOSEN = 'No weight chosen yet.';

export const BANKED_HEADING = 'Banked so far';
export const PROJECTED_HEADING = 'If the highlighted choice is made';

/**
 * Said in place of a projected figure when the tool is pointing at a pass.
 *
 * Printing the banked total under "projected" would read as the pass adding
 * something, when what it does is close the lift -- which is why `LiveView`
 * carries `null` there rather than repeating the banked figure (§13.5).
 */
export const NO_PROJECTION_NOTE = 'The pick is to stop this lift, so there is nothing to project.';

/**
 * §11's "attempts or lifters remaining before the user is called".
 *
 * Zero is "You are up now" and is a different sentence, not a smaller number:
 * the figure a handler acts on is whether to send the lifter to the platform.
 * `null` is nobody having counted, which gets its own sentence rather than no
 * line at all -- a missing line reads as "there is nobody ahead of you", which
 * is the one wrong answer that costs an attempt.
 */
export function attemptsBeforeCalledText(attemptsBeforeCalled: number | null): string {
  if (attemptsBeforeCalled === null) return 'Attempts ahead of you: not counted';
  if (attemptsBeforeCalled === 0) return 'You are up now';
  if (attemptsBeforeCalled === 1) return '1 attempt before you are called';
  return `${String(attemptsBeforeCalled)} attempts before you are called`;
}

/**
 * §13.7's prominent warning, and the single miss it deliberately says nothing
 * about.
 *
 * One miss is an ordinary meet. A warning on it fires for most lifters in most
 * flights and teaches the reader to skim the one that matters, which is the same
 * argument that keeps the countdown from buzzing on its calm band. Two is where
 * §13.7 asks for prominence, and the last chance is its own sentence because the
 * consequence -- no total for the day, not merely a weaker one -- is the part a
 * lifter mid-meet is least likely to have in mind.
 */
export function bombOutSentence(bombOut: BombOutRisk): string | null {
  if (bombOut.onTheLastChance) {
    return 'Last chance on this lift. Miss it and there is no total for the day.';
  }
  if (bombOut.misses >= 2) {
    return `Two misses on this lift, ${String(bombOut.attemptsRemaining)} left.`;
  }
  return null;
}

/** §11's "any urgent warm-up or equipment action", labelled by which it is. */
export function urgentNoteLabel(kind: UrgentNote['kind']): string {
  switch (kind) {
    case 'warm-up':
      return 'Warm-up';
    case 'equipment':
      return 'Equipment';
  }
}

export const URGENT_HEADING = 'Needs doing now';

/**
 * What one step along `SubmissionStatus` was, in the words the button uses.
 *
 * `advance-attempt` is one action carrying six destinations, and the live screen
 * already sends it to two of them -- `selected` when the lifter takes one of
 * §13's choices, `submitted` when they mark the weight handed in. A single label
 * covering both has to pick one, and the one it picked said the attempt had gone
 * to the table. Pressing undo on a weight that has *not* left the phone yet then
 * reads as taking back a submission, which is the sentence most likely to send a
 * handler to the expeditor to correct something nobody was told.
 *
 * So each destination says what it was. The two the tool cannot reach today are
 * spelled out rather than folded into a default: `confirmed` and `locked` come
 * from the table, `planned` and `proposed` from before the lifter answered, and
 * a wrong-but-plausible sentence on an undo control is worse than a long switch.
 */
function advanceDescribed(to: SubmissionStatus): string {
  switch (to) {
    case 'planned':
      return 'putting the attempt back in the plan';
    case 'proposed':
      return 'putting the weight forward';
    case 'selected':
      return 'declaring the attempt';
    case 'submitted':
      return 'handing the attempt in';
    case 'confirmed':
      return 'marking the attempt acknowledged';
    case 'locked':
      return 'locking the attempt';
  }
}

/**
 * §13.9's control, naming what it would take back.
 *
 * An undo button reading only "Undo" asks a lifter to remember what the last
 * thing they did was, at the one moment they are least able to -- and the action
 * being undone is usually a mis-tapped result, which the tool knows and they may
 * not. So the label says it, and the action is carried in the event so a caller
 * can check it is still undoing the thing that was on screen when the button was
 * pressed.
 */
export function undoLabel(action: MeetAction): string {
  switch (action.kind) {
    case 'add-lifter':
      return 'Undo adding the lifter';
    case 'focus-lifter':
      return 'Undo switching lifter';
    case 'set-attempt-weight':
      return `Undo choosing ${formatWeight({ amount: action.kilograms, unit: 'kg' })}`;
    case 'advance-attempt':
      return `Undo ${advanceDescribed(action.to)}`;
    case 'record-result':
      return `Undo recording ${outcomeLabel(action.result.outcome).toLowerCase()}`;
    case 'grant-extra-attempt':
      return 'Undo granting the extra attempt';
    case 'annotate-attempt':
      return 'Undo the lights or the note';
    case 'add-record-attempt':
      return 'Undo adding the record attempt';
  }
}

/** Said in place of the control, so the absence of undo is stated rather than blank. */
export const NOTHING_TO_UNDO = 'Nothing to undo yet.';

/** §11's "advanced details remain available without competing with the next action". */
export const MEET_DETAIL_SUMMARY = 'Meet detail';

/** Which lifts are behind the lifter, so the banked figure can be read against something. */
export function liftsFinishedText(lifts: readonly PlatformLift[]): string {
  if (lifts.length === 0) return 'No lift is finished yet.';
  return `Finished: ${liftListText(lifts)}.`;
}

/** The lift named inside a sentence, where a capital would read as a heading. */
function liftMidSentence(lift: PlatformLift): string {
  switch (lift) {
    case 'squat':
      return 'squat';
    case 'bench':
      return 'bench press';
    case 'deadlift':
      return 'deadlift';
  }
}

function liftListText(lifts: readonly PlatformLift[]): string {
  return listText(lifts.map(liftMidSentence));
}

/** "a", "a and b", "a, b and c". No serial comma, matching the rest of this file. */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  const last = items[items.length - 1] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${last}`;
}

/*
 * ---------------------------------------------------------------------------
 * Starting the meet, and going back to the plan.
 * ---------------------------------------------------------------------------
 */

export const START_MEET_HEADING = 'Meet day';

/**
 * Why the plan is not enough to start on.
 *
 * §14's named failure is the correct weight submitted for the wrong athlete, and
 * the name is the only thing on the live screen that guards against it -- so it
 * is asked for once, here, rather than defaulted to something the lifter would
 * have to notice was wrong.
 */
export const LIFTER_NAME_LABEL = 'Lifter name';

export const LIFTER_NAME_HINT = 'Shown beside every weight handed to the table.';

export const START_MEET_LABEL = 'Start the meet';

/**
 * What starting does to the plan, said before it is done rather than after.
 *
 * The plan is not consumed -- the weights are copied onto the board and the
 * planning screens are still there behind a link -- and a lifter who thinks
 * pressing this throws their work away will not press it at the moment it is
 * worth pressing, which is before the first attempt rather than after it.
 */
export const START_MEET_NOTE =
  'The planned attempts go on the board and can still be changed at the platform. ' +
  'The plan stays where it is.';

/** Said in place of the control while there is no plan to put on a board. */
export const START_MEET_NEEDS_A_PLAN =
  'Agree a maximum for each lift above and the meet can be started here.';

export const BACK_TO_PLAN_LABEL = 'Back to the plan';

/** Said above the planning screens once a meet is running behind them. */
export const MEET_IS_RUNNING_NOTE =
  'A meet is running. Changing an answer here does not move a weight already on the board.';

export const RETURN_TO_MEET_LABEL = 'Back to the meet';

/**
 * A refusal from the document layer, in this tool's words.
 *
 * `MeetActionProblem` carries a message of its own and this deliberately does
 * not use it: those sentences are written for whoever is reading a failed action
 * in a test, and half of them name a field rather than a thing a lifter did. The
 * same split as `PlanProblem` (§13.4) -- the domain publishes codes, each tool
 * writes its own wording.
 *
 * Total over the union rather than defaulted, so a new code is a compile error
 * here. A default would ship the day a code was added, saying "that could not be
 * recorded" on a screen where the lifter's next move depends on which of two
 * things went wrong.
 */
export function meetProblemSentence(code: MeetActionProblemCode): string {
  switch (code) {
    case 'unknown-lifter':
      return 'That lifter is not in this meet.';
    case 'unknown-attempt':
      return 'That attempt is not in this meet.';
    case 'lifter-name-required':
      return 'A meet needs a lifter name before it can start.';
    case 'attempt-already-resolved':
      return 'That attempt already has a result, so it cannot be changed here.';
    case 'status-would-go-backwards':
      return 'That attempt has already gone further than this.';
    case 'weight-is-not-a-weight':
      return 'That is not a weight.';
    case 'weight-not-legal':
      return 'The rules do not allow that weight for this attempt.';
    case 'weight-required-before-submitting':
      return 'Choose a weight before handing the attempt in.';
    case 'no-changes-remaining':
      return 'No changes are left on that attempt.';
    case 'not-a-missed-attempt':
      return 'An extra attempt can only be granted after a miss.';
    case 'record-attempt-not-available':
      return 'A record attempt is not available here.';
    case 'rpe-out-of-range':
      return `An RPE has to be between ${String(RPE_BOUNDS.min)} and ${String(RPE_BOUNDS.max)}.`;
    case 'note-too-long':
      return 'That note is too long to record.';
    case 'nothing-to-undo':
      return 'There is nothing left to undo.';
  }
}

/*
 * ---------------------------------------------------------------------------
 * §21, the coach board.
 *
 * Everything below is read at a glance, sideways, by somebody who is walking.
 * Two wording rules follow from that and are worth stating before the switches:
 *
 *   - **Every sentence is about one lifter and says what to do.** A board is a
 *     triage list, and a row reading "final warm-up due" is a status where
 *     "Take the final warm-up" is an instruction. The urgency labels are the
 *     one exception, because a section heading is not an instruction.
 *   - **Colour is never in the words and never on its own** (§21). Nothing here
 *     says "the red lifter"; the identifier is what names somebody at a
 *     distance, and `coachBoard` guarantees every row has one.
 * ---------------------------------------------------------------------------
 */

export const BOARD_HEADING = 'Coach board';

/** Said in place of the rows, so an empty board is a state rather than a blank. */
export const BOARD_EMPTY_NOTE = 'No lifters on the board yet.';

/**
 * The one sentence the board owes a coach who is reading it as a queue.
 *
 * The order is worked out from clocks and schedules, and a coach who is not told
 * that reads it as the order they typed the lifters in and stops trusting it the
 * first time it changes under them.
 */
export const BOARD_ORDER_NOTE = 'Ordered by what needs doing first, not by flight order.';

/**
 * §21's seven levels, as section headings.
 *
 * Total over the union rather than defaulted, the same rule as
 * {@link meetProblemSentence}: an eighth level added to the ladder is a compile
 * error here rather than a row filed under a heading somebody invented.
 */
export function boardUrgencyLabel(urgency: CoachBoardUrgency): string {
  switch (urgency) {
    case 'submission-deadline':
      return 'Clock running';
    case 'called-or-on-deck':
      return 'At the platform';
    case 'equipment-or-wrapping':
      return 'Wrapping or equipment';
    case 'final-warm-up':
      return 'Final warm-up';
    case 'other-warm-ups':
      return 'Warming up';
    case 'upcoming-flight':
      return 'Coming up';
    case 'non-urgent-preparation':
      return 'Nothing timed';
  }
}

/**
 * The one thing to do about a lifter, in the imperative.
 *
 * §21 asks for "the one action needed", and an imperative is the difference
 * between a board a coach acts on and a board a coach interprets. The last two
 * are the honest non-instructions and are phrased so they do not read like one.
 */
export function boardActionSentence(action: CoachBoardActionCode): string {
  switch (action) {
    case 'declare-the-next-attempt':
      return 'Choose the next weight.';
    case 'hand-the-weight-to-the-table':
      return 'Get the weight to the table.';
    case 'get-to-the-platform':
      return 'Get to the platform.';
    case 'start-equipment-or-wrapping':
      return 'Start wrapping or kit.';
    case 'take-the-final-warm-up':
      return 'Take the final warm-up.';
    case 'start-the-warm-up':
      return 'Start the warm-up.';
    case 'wait-for-the-flight':
      return 'Nothing due yet.';
    case 'nothing-time-bound':
      return 'Nothing on the clock.';
  }
}

/** Where the lifter stands relative to the bar, as the room announced it. */
export function platformCallLabel(call: PlatformCall): string {
  switch (call) {
    case 'called':
      return 'Called';
    case 'on-deck':
      return 'On deck';
    case 'in-the-hole':
      return 'In the hole';
  }
}

/** §21.3's list of what a handler has been asked to cover. */
export function handlerResponsibilityLabel(responsibility: HandlerResponsibility): string {
  switch (responsibility) {
    case 'attempt-submission':
      return 'attempt cards';
    case 'warm-up-loading':
      return 'loading';
    case 'wrapping-or-equipment':
      return 'wraps and kit';
    case 'platform-escort':
      return 'the walk out';
    case 'food-or-hydration':
      return 'food and drink';
    case 'video':
      return 'video';
    case 'general':
      return 'anything';
  }
}

/**
 * One handler and what they are on.
 *
 * A handler with no responsibilities named is reported as such rather than left
 * off: §21.3's point is that a coach can see who is covering a lifter, and a
 * name with nothing beside it still answers that.
 */
export function handlerLine(handler: HandlerAssignment): string {
  if (handler.responsibilities.length === 0) return handler.name;
  return `${handler.name}: ${listText(handler.responsibilities.map(handlerResponsibilityLabel))}`;
}

/**
 * Seconds until the next thing, or how far past it the lifter already is.
 *
 * The negative case is the one this exists for. `coachBoard` reports a moment
 * that has passed as a negative figure and never clamps it (§13.3), so clamping
 * it here would tell a coach who is four minutes behind that they are on time --
 * which is the same failure one layer up, and the layer that shows it.
 */
export function boardCountdownText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 0) return `${countdownText(-seconds)} late`;
  return `${countdownText(seconds)} to go`;
}

/**
 * What is left to lift, as two counts rather than one.
 *
 * §21's "attempts remaining" is ambiguous on a board showing three lifts, and
 * the two readings send a coach to different lifters -- one attempt left on the
 * squat is a lifter about to move rooms, one attempt left in the meet is a
 * lifter about to finish.
 */
export function attemptsRemainingText(remaining: CoachBoardRemaining): string {
  const onLift = remaining.attemptsOnThisLift;
  const inMeet = remaining.attemptsInTheMeet;
  if (inMeet === 0) return 'Finished';
  return `${String(onLift)} left on this lift, ${String(inMeet)} in the meet`;
}

/**
 * The attempt the coach is working towards.
 *
 * The weight is left out and rendered separately, because §16 makes it two
 * figures -- kilograms and a published pound reading -- and folding them into a
 * sentence here would put the tool in the business of writing the number a
 * handler reads aloud at the table.
 */
export function boardAttemptLine(current: CurrentAttempt): string {
  const lift = liftLabel(current.lift);
  const attempt = `attempt ${String(current.attemptNumber)}`;
  if (current.kind === 'competition') return `${lift}, ${attempt}`;
  return `${lift}, ${attempt} (${extraAttemptKindWord(current.kind)})`;
}

/** A non-competition attempt named in a word, so a row cannot read as the round. */
function extraAttemptKindWord(kind: CurrentAttempt['kind']): string {
  switch (kind) {
    case 'competition':
      return 'competition';
    case 'record':
      return 'record attempt';
    case 'extra':
      return 'extra attempt';
  }
}

/**
 * §21.3's list, which needs a heading because a bare name under a row is a guess.
 *
 * A row already carries a lifter's name; a second name below it with nothing
 * saying what it is reads as a second lifter, on the one screen that exists to
 * tell several of them apart.
 */
export const BOARD_HANDLERS_HEADING = 'Handlers';

/** Said where a row has no attempt to point at, rather than leaving the line out. */
export const BOARD_NO_ATTEMPT = 'No attempt owed.';

/** Said where an attempt is owed and nobody has put a weight on it yet. */
export const BOARD_NO_WEIGHT = 'No weight chosen.';

/*
 * ---------------------------------------------------------------------------
 * §21.2, the clashes.
 * ---------------------------------------------------------------------------
 */

export const BOARD_CONFLICTS_HEADING = 'Clashes';

/** The count, as a heading a coach can act on rather than a badge. */
export function conflictCountText(count: number): string {
  if (count === 0) return 'No clashes.';
  return `${String(count)} clash${count === 1 ? '' : 'es'} between lifters.`;
}

/**
 * A lifter, as this board names them at a distance.
 *
 * Both halves, always. The identifier alone is a bib number nobody has learned
 * yet and the name alone is two lifters called Sam, which is exactly the flight
 * where a clash warning matters.
 */
export function boardLifterText(ref: BoardLifterRef): string {
  return `${ref.name} (${ref.identifier})`;
}

function boardNameList(refs: readonly BoardLifterRef[]): string {
  // The domain guarantees a conflict names at least two lifters, so this list is
  // never empty in practice. It is written to read anyway, because a sentence
  // with a hole where a name should be is worse than a vague one, and a board is
  // read at a glance by somebody who will not stop to work out what happened.
  if (refs.length === 0) return 'another lifter';
  return listText(refs.map(boardLifterText));
}

/**
 * One clash, told from this row's point of view.
 *
 * Total over the union, and each sentence names the *other* lifters rather than
 * the pair, because the same clash is rendered on both rows -- a sentence
 * listing both reads on Bo's row as a third lifter nobody can find.
 */
export function conflictSentence(conflict: BoardRowConflict): string {
  const others = boardNameList(conflict.others);
  switch (conflict.code) {
    case 'submission-deadlines-overlap':
      return `Declaration clock closes alongside ${others}.`;
    case 'called-at-the-same-time':
      return `Due at the platform alongside ${others}.`;
    case 'handler-in-two-places':
      return `${conflict.handlerName ?? 'The same handler'} is wanted here and by ${others}.`;
    case 'wrapping-at-the-same-time':
      return `Wrapping or kit at the same time as ${others}.`;
    case 'shared-rack-loading-clash':
      return `Wants the shared bar at a different weight from ${others}.`;
    case 'warm-up-during-another-attempt':
      return `Final warm-up lands during the attempt of ${others}.`;
    case 'change-moves-the-order':
      return `Changing this weight moves the order against ${others}.`;
  }
}

/**
 * Which of the two to go to first, and why.
 *
 * `either-order` is the reason that must not read as advice -- the domain still
 * names a lifter there, because a screen has to draw something, and a view that
 * printed "go to Bo first" off that field would be inventing a recommendation
 * out of document order.
 */
export function conflictOrderText(conflict: BoardRowConflict): string {
  if (conflict.reason === 'either-order') {
    return 'Either order. Nothing here separates them.';
  }
  const who = conflict.servedFirst
    ? 'Go here first'
    : `Go to ${boardNameList(conflict.others)} first`;
  return `${who}: ${conflictReasonWords(conflict.reason)}.`;
}

function conflictReasonWords(reason: BoardRowConflict['reason']): string {
  switch (reason) {
    case 'sooner-deadline':
      return 'their clock closes first and the rulebook enforces it';
    case 'already-called':
      return 'the platform does not wait';
    case 'needed-sooner':
      return 'their moment comes first';
    case 'fixed-versus-movable':
      return 'their moment cannot be moved and the other can';
    case 'either-order':
      // Unreachable through `conflictOrderText`, which answers the tie above.
      // Kept because this function is total over the union and a default here
      // would be the one place a new reason could ship unworded.
      return 'nothing separates them';
  }
}

/** How far apart the two moments are, where there is a gap worth stating. */
export function separationText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds === 0) return 'At the same moment.';
  return `${countdownText(seconds)} apart.`;
}

/*
 * ---------------------------------------------------------------------------
 * §21.4, the shared warm-up bar.
 * ---------------------------------------------------------------------------
 */

export const RACK_HEADING = 'Shared bars';

/** Said in place of the panel, because an unshared room is an answer (§21.4). */
export const RACK_NONE_NOTE = 'No shared warm-up bars are set up.';

export function rackLabel(rackId: string): string {
  return `Bar ${rackId}`;
}

/**
 * One load: the weight, when it has to be on, and what it costs to get there.
 *
 * The plate figure is per side and says so, because a coach reading "4 plates"
 * and carrying four is a coach who has to go back.
 */
export function rackLoadLine(load: RackLoad): string {
  const weight = formatWeight({ amount: load.loading.total, unit: 'kg' });
  const due = boardCountdownText(load.dueInSeconds) ?? '';
  if (load.change === null) return `${weight} -- ${due}`;
  return `${weight} -- ${due}, ${plateMovesText(load.plateMoves)}`;
}

export function plateMovesText(plateMoves: number): string {
  if (plateMoves === 0) return 'no plates to move';
  return `${String(plateMoves)} plate${plateMoves === 1 ? '' : 's'} a side`;
}

/** Who is on a load, named so a coach can call across the room. */
export function rackTakersText(refs: readonly BoardLifterRef[]): string {
  if (refs.length === 0) return 'Nobody named.';
  return `For ${listText(refs.map(boardLifterText))}.`;
}

/**
 * What sharing the bar saved, or that it saved nothing.
 *
 * Shown rather than asserted, and the equal case is stated rather than hidden:
 * a coach who has set up a shared bar and got nothing back from it should be
 * able to see that, because the answer might be to find a second rack.
 */
export function rackSavingText(sequence: RackSequence): string {
  const saved = sequence.plateMovesUnshared - sequence.plateMoves;
  if (saved <= 0)
    return `${plateMovesText(sequence.plateMoves)} across the run. Sharing saves none.`;
  return `${plateMovesText(sequence.plateMoves)} across the run, ${String(saved)} fewer than one bar each.`;
}

/**
 * Where the timing and the plate maths wanted different things.
 *
 * Both codes are the same fact from two directions and both name the cost,
 * because the advisory is a request to go and move plates rather than a warning
 * that something is wrong -- §21.4 keeps the timing and charges for it.
 */
export function rackAdvisorySentence(advisory: RackAdvisory): string {
  switch (advisory.code) {
    case 'bar-goes-back-down':
      return `The bar comes back down here, ${plateMovesText(advisory.plateMoves)}.`;
    case 'same-weight-twice':
      return `The same weight is loaded twice, ${plateMovesText(advisory.plateMoves)}.`;
  }
}

/*
 * ---------------------------------------------------------------------------
 * §21.1, pinning and switching.
 * ---------------------------------------------------------------------------
 */

/**
 * The pin, worded as what pressing it does rather than as a state.
 *
 * A pin does not move a row -- `coach-board.ts` says so outright, because a rank
 * a coach has learned to scan cannot change meaning the moment somebody is
 * pinned -- so the label must not suggest it does.
 */
export function pinLabel(pinned: boolean): string {
  return pinned ? 'Unpin' : 'Pin';
}

export function pinDescription(ref: BoardLifterRef, pinned: boolean): string {
  return `${pinLabel(pinned)} ${boardLifterText(ref)}`;
}

/** §21.1's one-tap switch to a lifter's own live screen. */
export const BOARD_OPEN_LABEL = 'Open';

export function openDescription(ref: BoardLifterRef): string {
  return `Open ${boardLifterText(ref)}`;
}

/**
 * The filter's own question, which is not the same string as its one answer.
 *
 * A checkbox group takes its accessible name from the legend, so a group
 * labelled "Pinned only" holding a box labelled "Pinned only" is announced
 * twice and says nothing about what the second one does.
 */
export const BOARD_FILTER_LABEL = 'Which lifters to show';

/** The filter, so a coach running two lifters out of forty can say so. */
export const PINNED_ONLY_LABEL = 'Pinned only';

/** Said where the filter is on and has hidden everybody. */
export const NO_PINNED_LIFTERS = 'No lifters are pinned.';

/*
 * ---------------------------------------------------------------------------
 * §21's roster: who is on the board, and what this phone calls them.
 *
 * Two different kinds of answer live on one screen here and the wording has to
 * keep them apart. A name goes into the meet document and is a fact about the
 * meet; an identifier and a colour go into a `CoachBoardEntry` and are facts
 * about this phone. Only the first is shared with anybody, which is why only
 * the first is asked for in a sentence about the meet.
 * ---------------------------------------------------------------------------
 */

export const ROSTER_HEADING = 'Lifters';

export const ROSTER_NAME_LABEL = 'Add a lifter';

export const ROSTER_NAME_HINT = 'Goes on the board and on every weight handed to the table.';

export const ROSTER_ADD_LABEL = 'Add to the meet';

/** Said before there is a rule book to check a weight against. */
export const ROSTER_NEEDS_A_FEDERATION =
  'Choose a federation above and lifters can be added to the board.';

/** Said where the meet exists and nobody is in it. */
export const ROSTER_EMPTY = 'Nobody has been added yet.';

/**
 * What adding the first lifter fixes, said before it is done.
 *
 * The same promise `MEET_IS_RUNNING_NOTE` makes on the solo path and for the
 * same reason: the rules and the meet type are taken once, when the document is
 * created, and a coach who changed the federation halfway through a flight would
 * otherwise have the rest of it checked against a rule book the first attempts
 * were never checked against. So the two questions come off the screen instead
 * of staying on it saying nothing.
 */
export const ROSTER_STARTS_THE_MEET =
  'Adding the first lifter starts the meet. The federation and the meet type are ' +
  'fixed from that point, and everything else can still be changed.';

export const ROSTER_IDENTIFIER_LABEL = 'Identifier';

/**
 * Why a lot number is worth typing, in the case that makes it worth typing.
 *
 * §21 requires a distinctive identifier per lifter and `coachBoard` fills a
 * blank one with the row's position -- which is a number that moves as the board
 * re-sorts. That is fine for a coach running two people and useless for one
 * running eight, and the hint is where the difference is stated.
 */
export const ROSTER_IDENTIFIER_HINT =
  'A lot number or a bib. Left blank, the board numbers the row instead, and that ' +
  'number moves as the order changes.';

export const ROSTER_COLOUR_LABEL = 'Colour';

/**
 * §21's colour, which is never the only cue and is therefore never required.
 *
 * The values are literal colours rather than design tokens: the swatch is drawn
 * inside the board's shadow root and a custom property that failed to resolve
 * there would pass `CSS.supports` and paint nothing, which is a swatch that is
 * missing for a reason nobody can see. Every option is also named in words, so
 * the choice itself is readable to somebody who cannot tell two of them apart --
 * which is the whole reason the identifier sits beside it on the row.
 */
export const NO_COLOUR = 'none';

export const COLOUR_CHOICES: readonly Choice[] = [
  { value: NO_COLOUR, label: 'None' },
  { value: '#c2410c', label: 'Orange' },
  { value: '#1d4ed8', label: 'Blue' },
  { value: '#15803d', label: 'Green' },
  { value: '#7e22ce', label: 'Purple' },
  { value: '#0f766e', label: 'Teal' },
  { value: '#be185d', label: 'Pink' },
];

/**
 * The colour as a word, for the line that stays visible when a row is folded.
 *
 * Falls back to the value itself rather than to "None", because a colour that is
 * not on the list came from somewhere -- an import (§24), or a list that changed
 * under a stored entry -- and saying "None" over a row that is drawing a swatch
 * is the one answer that is definitely wrong.
 */
export function colourLabel(colour: string | null): string {
  if (colour === null) return 'No colour';
  return COLOUR_CHOICES.find((choice) => choice.value === colour)?.label ?? colour;
}

/*
 * §21.3's handlers and §21.4's bar, as the roster asks for them.
 *
 * Both are answers about the room rather than about the lifter, which is why
 * they are worded as arrangements and not as attributes: a bar is shared, and a
 * handler is a person who may be standing behind somebody else's row as well.
 * That is the whole reason the board can warn about either.
 */

export const ROSTER_HANDLERS_HEADING = 'Handlers';

/**
 * Said where a lifter has nobody on them yet.
 *
 * Present rather than an empty space above the add button, because §21.3 makes
 * handlers optional and "nobody yet" and "this screen has not finished loading"
 * look the same when both are blank.
 */
export const ROSTER_HANDLERS_EMPTY = 'Nobody is helping this lifter yet.';

export const ROSTER_ADD_HANDLER_LABEL = 'Add a handler';

export const ROSTER_HANDLER_NAME_LABEL = 'Name';

/**
 * What a handler name is for, said once per lifter rather than once per handler.
 *
 * Above the list and not as a hint on each name field, because it is the same
 * sentence three times over on a lifter with three handlers -- on a fold inside
 * a fold on a phone (§5.7).
 *
 * It is here at all because it is what makes §21.2 work: handlers are matched
 * between rows by name, so a coach who types "Sam" on one lifter and "Sam W" on
 * the next is never warned that one person is wanted in two places, and nothing
 * on the screen would say why. §21.3's "no user accounts" is the other half --
 * nobody is invited by typing a name here, and a control that looks like it
 * might be is one somebody hesitates over.
 */
export const ROSTER_HANDLERS_NOTE =
  'Names are for reading on this phone; nobody is invited. Spell one the same way ' +
  'on every lifter they are helping, and the board can warn you when they are ' +
  'wanted in two places at once.';

export const ROSTER_HANDLER_DUTIES_LABEL = 'Covering';

/**
 * §21.3's seven, in the requirement's order, off the domain's own tuple.
 *
 * Mapped rather than written out, so the option a coach can tick, the value §24
 * validates on import and the words the board prints all come from one list.
 * `handlerResponsibilityLabel` is the same function the board's handler line
 * uses, which is what stops a tick reading "the walk out" here and "escort"
 * there for the same answer.
 *
 * The labels are lower case because they are written to be read *after* a name
 * -- "Rae: wraps and kit, the walk out" is the board's line -- and a tile
 * capitalised for its own sake would be the only place in the tool where the
 * same string is cased two ways.
 */
export const HANDLER_RESPONSIBILITY_CHOICES: readonly Choice[] = HANDLER_RESPONSIBILITIES.map(
  (responsibility) => ({
    value: responsibility,
    label: handlerResponsibilityLabel(responsibility),
  }),
);

/**
 * The remove button's own label, which names the handler rather than the row.
 *
 * §22.2's `removeCustomItemLabel` and the same reason: several of these sit in a
 * column and a screen reader reads them one at a time, so seven buttons all
 * saying "Remove" is seven identical announcements over seven different
 * consequences. The unnamed case is real and not a fallback -- the row is added
 * blank and named afterwards -- so it says which row rather than pretending to a
 * name.
 */
export function removeHandlerLabel(name: string, position: number): string {
  const called = name.trim();
  if (called === '') return `Remove handler ${String(position + 1)}`;
  return `Remove ${called}`;
}

export const ROSTER_RACK_LABEL = 'Warm-up bar';

/**
 * Why naming a bar is worth the keystroke, said in terms of what it buys.
 *
 * §21.4's sequencing only exists for lifters who are on one bar, and the tool
 * cannot infer that: a room with four bars in it and nothing typed here is
 * indistinguishable from a room with one. So the hint states the arrangement it
 * is asking about rather than describing the field, and says that the answer has
 * to match -- an exact, trimmed match is how `rackSequences` decides two people
 * are queueing for the same plates.
 */
export const ROSTER_RACK_HINT =
  'Only if lifters are sharing one. Give the same bar the same name on each of ' +
  'them, and the board can work out a loading order.';

/** How many people are on a lifter, for the line that stays visible folded. */
function handlerCountText(count: number): string {
  if (count === 1) return '1 handler';
  return `${String(count)} handlers`;
}

/**
 * `rackLabel` mid-list: the tool's word lower case, the coach's name untouched.
 *
 * Derived from `rackLabel` rather than spelled again, because §21.4's panel and
 * this line have to call one bar one thing -- and lower-casing only the first
 * character rather than the string, because the rest of it is a name somebody
 * typed and `toLowerCase()` over the whole of it would report bar `2B` as `2b`.
 */
function barText(rackId: string): string {
  const label = rackLabel(rackId);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The fold's one visible line: what this phone calls the lifter inside it.
 *
 * Four answers and not two since §21.3 and §21.4 arrived, and the last two are
 * omitted when they are unset rather than reported as absent. That is the
 * opposite of what the first two do, deliberately: an identifier and a colour
 * are asked of every lifter and a row missing them is a row to go back to, so
 * "No identifier, no colour" is information. A bar and a handler are asked only
 * of a room that has them, so a roster of eight solo lifters would otherwise
 * carry sixteen words saying that a question does not apply -- on the line whose
 * whole job is to be readable at a glance on a phone (§5.7).
 */
export function rosterSummary(
  identifier: string,
  colour: string | null,
  rackId: string,
  handlerCount: number,
): string {
  const called = identifier.trim() === '' ? 'No identifier' : identifier.trim();
  const parts = [called, colourLabel(colour).toLowerCase()];
  const bar = rackId.trim();
  if (bar !== '') parts.push(barText(bar));
  if (handlerCount > 0) parts.push(handlerCountText(handlerCount));
  return parts.join(', ');
}

/** §21.1's way back from a lifter's own screen to the room. */
export const BACK_TO_BOARD_LABEL = 'Back to the board';

/*
 * =============================================================================
 * §22 -- MEET PREPARATION: THE SETUP ANSWERS AND THE CHECKLIST
 * =============================================================================
 *
 * WHY THIS BLOCK IS WORDED MORE CAREFULLY THAN IT LOOKS
 *
 * Nothing here is computed and nothing here is graded, so it reads as the easy
 * part of the tool. It is the part with the most rules about wording:
 *
 *   - §22.2 forbids prescriptive weight-cutting, medical, drug, supplement and
 *     nutrition instruction outright. So "Food" and "Fluids" are things to pack
 *     and are never things to consume in an amount. There is no gram, no litre,
 *     no timing and no "make weight" anywhere below, and none may be added --
 *     not even in a hint, which is exactly where advice of that kind tends to
 *     arrive wearing the word "just".
 *   - Two rows are conditional in the requirement on a fact no published
 *     `MeetRuleProfile` carries: approved underwear "where applicable" and
 *     chalk and baby powder "where permitted". The profile schema has no field
 *     for either, so the rows are unconditional and the caveat rides in the
 *     label. Dropping the caveat would state a federation's rule this tool has
 *     not read; dropping the row would hide a bag check somebody fails at.
 *   - A rack height is text and a weigh-in time is not. `prep.ts` says why in
 *     full; the consequence here is that only two field names take a refusal
 *     sentence, and neither of them says what format to type -- the parser
 *     accepts both clocks and both separators, so a sentence naming one would
 *     be a rule the code does not enforce.
 */

/** §22.1's fold, which is answered before the day and read on it. */
export const PREP_HEADING = 'Your setup and your bag';
export const PREP_SUMMARY = 'Rack heights, times, and what to pack';

export const SETUP_HEADING = 'Rack heights, flight and times';
export const SETUP_HINT =
  'Whatever you want in front of you at the equipment check. Written down here it is the same on the platform as it was in the warm-up room.';

export const CHECKLIST_HEADING = 'Checklist';
export const CHECKLIST_HINT =
  'Ticks are yours and the rows are the meet you told us about, so a bench-only day is not asked about deadlift socks. Add your own at the bottom.';

/** The two group headings, and the third that only exists once somebody adds a row. */
export function checklistGroupHeading(group: ChecklistGroup): string {
  switch (group) {
    case 'bring':
      return 'Bring';
    case 'do':
      return 'Do at the venue';
    case 'own':
      return 'Yours';
  }
}

/**
 * The 23 default rows.
 *
 * Total over the id union rather than a lookup with a fallback: a row with no
 * label is a tickable blank line, which is worse than a compile error the day
 * §22.2 grows a row. The wording is the requirement's own, expanded only where
 * a bag check needs a noun -- "Membership and identification" is what the
 * expeditor asks for and "Membership card and photo identification" is what
 * goes in the bag.
 */
export function checklistItemLabel(id: ChecklistItemId): string {
  switch (id) {
    case 'membership-and-identification':
      return 'Membership card and photo identification';
    case 'singlet':
      return 'Singlet';
    case 'approved-shirt':
      return 'Approved shirt';
    case 'approved-underwear':
      return 'Approved underwear, where your federation requires it';
    case 'belt':
      return 'Belt';
    case 'knee-sleeves-or-wraps':
      return 'Knee sleeves or knee wraps';
    case 'wrist-wraps':
      return 'Wrist wraps';
    case 'squat-shoes':
      return 'Squat shoes';
    case 'bench-shoes':
      return 'Bench shoes';
    case 'deadlift-shoes':
      return 'Deadlift shoes or slippers';
    case 'deadlift-socks':
      return 'Deadlift socks';
    case 'equipped-gear':
      return 'Suit, briefs and any other equipped gear';
    case 'chalk-and-powder':
      return 'Chalk and baby powder, where they are permitted';
    case 'food':
      return 'Food you have eaten on a training day before';
    case 'fluids':
      return 'Fluids';
    case 'attempt-plan-in-kilograms':
      return 'Attempt plan written in kilograms';
    case 'printed-backup':
      return 'Printed backup of the plan';
    case 'phone-charger':
      return 'Phone charger or battery pack';
    case 'record-documentation':
      return 'Record paperwork and whatever the federation asks for';
    case 'rack-height-confirmation':
      return 'Confirm your rack heights on the competition rack';
    case 'equipment-check':
      return 'Equipment check';
    case 'weigh-in':
      return 'Weigh-in';
    case 'rules-and-commands-review':
      return 'Read the commands and the rules briefing';
  }
}

/**
 * §22.1's sixteen labels, and the hints that keep two of them honest.
 *
 * `SETUP_LABELS` is a record rather than a function because the element renders
 * the whole form in one pass and the order of the fields is the order of the
 * interface -- a switch would put the ordering in the template, where a lifter
 * reading their bench height under the squat heading is a plausible edit.
 */
export interface SetupFieldCopy {
  readonly label: string;
  readonly hint?: string;
}

export const SETUP_LABELS = {
  squatRackHeight: { label: 'Squat rack height', hint: 'Whatever the rack is numbered in.' },
  squatSafetyHeight: { label: 'Squat safety height' },
  monoliftSetting: { label: 'Monolift setting' },
  squatStart: { label: 'Walkout or monolift' },
  benchRackHeight: { label: 'Bench rack height' },
  benchSafetyHeight: { label: 'Bench safety height' },
  footBlocks: { label: 'Foot blocks' },
  handoff: { label: 'Handoff' },
  deadliftNotes: {
    label: 'Deadlift bar or platform notes',
    hint: 'Bar stiffness, the platform, anything you want to remember.',
  },
  commands: {
    label: 'Commands and cues',
    hint: 'The commands as this federation gives them, and the cues you want in your head.',
  },
  flight: { label: 'Flight' },
  lot: { label: 'Lot number' },
  platform: { label: 'Platform' },
  session: { label: 'Session' },
  weighInTime: { label: 'Weigh-in time' },
  liftingStartTime: { label: 'Lifting starts' },
} as const satisfies Record<string, SetupFieldCopy>;

/**
 * The five headings the sixteen answers are grouped under.
 *
 * A record keyed by a local vocabulary rather than by anything in `prep.ts`,
 * because the grouping is a fact about the form and not about the data: the
 * squat's four answers are asked together because a lifter sets the rack once,
 * and nothing downstream of this screen cares which heading a rack height was
 * typed under. `where` is last because it is the part filled in on the morning,
 * from a sheet on a wall.
 */
export const SETUP_SECTION_HEADINGS = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
  commands: 'Commands and cues',
  where: 'Flight, platform and times',
} as const;

/** §22.1's walkout-or-monolift answer. `unstated` is a real answer and is first. */
export const SQUAT_START_CHOICES: readonly Choice[] = SQUAT_STARTS.map((start) => {
  switch (start) {
    case 'walkout':
      return { value: start, label: 'Walkout' };
    case 'monolift':
      return { value: start, label: 'Monolift' };
    case 'unstated':
      return { value: start, label: 'Not decided' };
  }
});

/**
 * §22.1's handoff answer.
 *
 * "No handoff" is a choice a lifter makes and not an absence of one, which is
 * why it is on the list beside the other two rather than left to `unstated`.
 * A handler reading a blank field cannot tell "they unrack it themselves" from
 * "nobody has asked them", and those two send different people to the platform.
 */
export const HANDOFF_CHOICES: readonly Choice[] = HANDOFF_PREFERENCES.map((preference) => {
  switch (preference) {
    case 'own-handler':
      return { value: preference, label: 'My own handler' };
    case 'meet-spotter':
      return { value: preference, label: 'A meet spotter' };
    case 'no-handoff':
      return { value: preference, label: 'No handoff' };
    case 'unstated':
      return { value: preference, label: 'Not decided' };
  }
});

/**
 * §22.1's foot blocks, which is `ANSWER_CHOICES` reworded and not reused.
 *
 * The same three values, and the third one has to read "Not decided" here
 * rather than "Not sure": it sits between the two answers above with their own
 * "Not decided", and three tile groups on one form where one of them hedges
 * differently reads as a distinction somebody meant. There is nothing to be
 * unsure about -- a lifter either wants blocks under their feet or has not
 * settled it yet.
 */
export const FOOT_BLOCKS_CHOICES: readonly Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unstated', label: 'Not decided' },
];

/** §22.2's "user-authored notes", which is one box and not a second checklist. */
export const PREP_NOTES_LABEL = 'Notes';
export const PREP_NOTES_HINT = `Anything else you want in front of you. Up to ${String(PREP_NOTES_MAX)} characters.`;

export const CUSTOM_ITEM_LABEL = 'Add something of your own';
export const CUSTOM_ITEM_PLACEHOLDER = 'Mouthguard';
export const ADD_CUSTOM_ITEM_LABEL = 'Add to the list';

/**
 * Removal is a fold of its own, and each button names the row it deletes.
 *
 * Not "Remove" beside a tick. A row is ticked with chalk on the hands between
 * sets and removed once, deliberately, so putting the two controls on one line
 * at one size makes the destructive one exactly as easy to hit as the one that
 * is hit forty times. And a list of buttons all reading "Remove" is unusable to
 * anybody reading it one control at a time -- the text is the only thing that
 * says which row a press takes away.
 */
export const REMOVE_CUSTOM_ITEM_HEADING = 'Remove a row you added';

export function removeCustomItemLabel(text: string): string {
  return `Remove: ${text}`;
}

/**
 * Why a row of somebody's own was not added.
 *
 * Total over the union, and each one says what to do rather than what happened.
 * "Duplicate" in particular has to name the list it is already on, because the
 * three groups are three controls and the row it collides with may be scrolled
 * off the screen -- a refusal with no explanation on a list that visibly does
 * not contain the word reads as the button being broken.
 */
export function customItemRefusalText(refusal: CustomItemRefusal): string {
  switch (refusal) {
    case 'empty':
      return 'Type what you want to add first.';
    case 'too-long':
      return `That is longer than ${String(CUSTOM_ITEM_MAX)} characters. Shorten it, or put the detail in the notes below.`;
    case 'duplicate':
      return 'That is already on your list.';
  }
}

/**
 * Why a setup answer was refused.
 *
 * Neither sentence names a format. `parseTimeOfDay` takes 12- and 24-hour
 * clocks and a colon or a full stop, so "use HH:MM" would be a rule the parser
 * does not have -- and a lifter who typed a perfectly acceptable "8.30 am"
 * would go and change it.
 *
 * The parameter is the two fields that are read rather than the whole
 * `SetupProblem`, so `PrepNotesProblem` -- which is the same refusal about a
 * string that is not a setup answer -- goes through here too. One sentence,
 * because a lifter over a cap wants the same thing said whichever box they are
 * in, and two copies of it drift the day the wording changes.
 */
export function setupProblemText(problem: Pick<SetupProblem, 'code' | 'max'>): string {
  switch (problem.code) {
    case 'time-not-understood':
      return 'That does not read as a time of day. Try something like 8:30 am, or 08:30.';
    case 'too-long':
      return `That is longer than ${String(problem.max ?? SETUP_NOTE_MAX)} characters.`;
  }
}

/** The count above the list, which is the one thing read at a glance. */
export function checklistProgressText(done: number, total: number): string {
  if (total === 0) return 'Nothing on the list yet.';
  if (done === total) return `All ${String(total)} ticked.`;
  return `${String(done)} of ${String(total)} ticked.`;
}

/**
 * The one sentence §22.2's prohibition earns on the screen.
 *
 * Not a disclaimer and not an apology: it says what the list is, so that its
 * silence on cutting, eating and dosing reads as deliberate rather than as an
 * omission somebody should fill in with a note. It sits under the checklist,
 * where a lifter is looking at "Food" and "Fluids" and is most likely to expect
 * the tool to go on and tell them what to do with them.
 */
export const PREP_SCOPE_NOTE =
  'This is a packing and errand list. It says nothing about cutting weight, eating, drinking to a schedule, or anything you take -- ask your coach and the meet staff.';

/*
 * =============================================================================
 * §23 -- THE MEET PACK, ON PAPER
 * =============================================================================
 *
 * WHY THIS BLOCK IS WRITTEN FOR A READER WHO CANNOT ASK A FOLLOW-UP QUESTION
 *
 * Every other sentence in this file is read next to a control. A tap clarifies
 * it, a fold expands it, and a wording that is 90% clear costs somebody two
 * seconds. §23's reader has a dead phone. Nothing here can be clarified, so
 * three rules apply to this block and to nothing above it:
 *
 *   - **A heading has to survive being read out of order.** A sheet comes out of
 *     a bag folded, upside down, with one page missing. "Second attempt" is not a
 *     heading; "If the opener went like this, take this" is, because it says what
 *     the rows underneath are for without the page above it.
 *   - **An omission is a sentence, never a gap.** A missing warm-up ramp reads as
 *     a lost page, and a lifter who thinks they have lost a page spends their
 *     warm-up looking for it. Each omission below says what is not here and why
 *     in one line, in the place the section would have been.
 *   - **The assumption the table is standing on is printed with the table.** The
 *     third-attempt rows assume the second was made. On the live screen that
 *     assumption is a fact the app knows; on paper it is a condition the reader
 *     has to check, and an unchecked condition is how a lifter takes the wrong
 *     weight after a miss they did not think counted.
 *
 * §10.2 still applies here and applies harder: this sheet is read alone, so a
 * word like "should" that reads as advice on a screen reads as a prediction on
 * paper. Nothing below says whether a lift will be made.
 */

/** The fold on the planning screen, and the button inside it. */
export const PACK_HEADING = 'Printable pack';
export const PACK_SUMMARY = 'Everything above on one sheet, for a dead battery';

export const PACK_SHOW_LABEL = 'Show the printable pack';
export const PACK_HIDE_LABEL = 'Hide the printable pack';

/**
 * How to get it onto paper, which is the browser's job and not this tool's.
 *
 * No Print button. A button would call `window.print()`, which is a native
 * dialog a component cannot test around, and it would be the only control in
 * this collection that takes over the browser. What the print stylesheet does
 * instead is make the browser's own Print command produce this sheet and nothing
 * else, from anywhere on the planning screen -- so the sentence names the command
 * the reader already has rather than adding one they do not.
 */
export const PACK_PRINT_NOTE =
  "Use your browser's Print command. Whatever else is on this screen, printing gives you this sheet.";

/** The line under the heading of the printed sheet itself. */
export function packRulesLine(
  rulesLabel: string,
  rulebookLabel: string,
  revision: string,
  verifiedOn: string,
): string {
  return `${rulesLabel} -- ${rulebookLabel}, revision ${revision}, read on ${verifiedOn}`;
}

/**
 * The sheet's own title, which carries the name because paper gets separated.
 *
 * Two lifters in one flight print two packs and a handler puts both on the same
 * table. Without a name on the first line the only thing distinguishing them is
 * a rack height, which is exactly the number somebody is about to set a monolift
 * to. A lifter who has typed no name gets the untitled form rather than a
 * dangling dash.
 */
export function packTitle(lifterName: string): string {
  return lifterName === '' ? 'Meet pack' : `Meet pack -- ${lifterName}`;
}

export const PACK_SETUP_HEADING = 'Rack and safety heights';

/**
 * What a blank row on the printed setup section is for.
 *
 * The blanks are kept on purpose (`pack.ts` says why), and without this line
 * they read as a tool that failed to fill something in. A lifter finds out their
 * rack height at the rack, and this sheet is what is in their hand there.
 */
export const PACK_SETUP_BLANK_NOTE = 'Blank rows are for the numbers you find at the rack.';

export const PACK_SCHEDULE_HEADING = 'Flight, platform and times';

export const PACK_ATTEMPTS_HEADING = 'Planned attempts';

export const PACK_TARGETS_HEADING = 'What you came for';

/*
 * -----------------------------------------------------------------------------
 * §23.1's warm-up ramp.
 * -----------------------------------------------------------------------------
 */

export const PACK_WARMUP_HEADING = 'Warm-up';

/**
 * The heading over one lift's rungs.
 *
 * Names the lift, because §23's reader has the sheet folded to one block and a
 * ramp is three sections away from the attempts it belongs to. "Warm-up" over a
 * column of weights on a full-power sheet is three ramps' worth of ambiguity in
 * the one place a wrong reading has somebody warming up for the wrong lift.
 */
export function packWarmupLiftHeading(lift: PlatformLift): string {
  return `${liftLabel(lift)} warm-up`;
}

/**
 * The assumption every weight under it is standing on.
 *
 * A printed ramp is only right for the room it was counted for, and the room is
 * an answer somebody gave on a phone the night before -- possibly the default
 * this tool started them on, in a venue they had not seen yet. On a screen that
 * assumption is one tap away in §20's own fold; on paper it has to be beside the
 * numbers, or the first unloadable weight reads as a broken tool rather than as a
 * room that turned out to have different plates.
 */
export function packWarmupRoomText(room: Equipment): string {
  return `Counted for: ${describeEquipment(room)}`;
}

/**
 * When to start, as a lead rather than as a time or a countdown.
 *
 * The same figure and the same rounding as `handlerPackWarmupLeadText` far below,
 * and deliberately not the same sentence: that one labels itself with the lift
 * because a roster puts three ramps on one row, and it is read by a handler who
 * subtracts it from a board. This one sits under a heading that already names the
 * lift and is read by the lifter it belongs to.
 *
 * **Both ends are ceiled**, which rounds the ramp *earlier*. See the note on
 * `handlerPackWarmupLeadText`: for a lead, the cautious direction is the one that
 * costs standing about rather than the one that costs the attempt. Do not "fix"
 * this to floor its shorter end the way an estimate does.
 *
 * Nothing clamps the range, so an inverted or non-positive lead has to be
 * answered rather than printed: "0 minutes" on paper reads as a ramp that starts
 * when the bar is called.
 */
export function packWarmupLeadText(minimumSeconds: number, maximumSeconds: number): string {
  const shortest = Math.ceil(minimumSeconds / 60);
  const longest = Math.ceil(maximumSeconds / 60);
  if (shortest <= 0 || longest < shortest) {
    return 'This ramp does not fit before the bar. Start it as soon as your flight is called.';
  }
  if (shortest === longest) {
    return `Start about ${String(longest)} minutes before you are called.`;
  }
  return `Start ${String(shortest)}-${String(longest)} minutes before you are called.`;
}

/**
 * What a rung is called, in tool 2's own words.
 *
 * "Empty bar" and "Warm-up N" are `stageName`'s wording in
 * `apps/web/src/warm-up/ptk-lift-card.ts`, repeated rather than imported: that
 * function takes a `SessionRow`, which is tool 2's own shape and reaches nothing
 * here. What matters is that the numbering agrees, because the ordinal is what
 * ties a printed rung to the row a lifter adjusted on the phone -- and it counts
 * only the movable sets, so the first numbered rung is always "Warm-up 1"
 * whatever sits above it.
 *
 * A null ordinal is the empty bar and nothing else (`pack.ts` derives it from
 * `isAdjustable`), so there is no third case to answer.
 */
export function packWarmupSetLabel(ordinal: number | null): string {
  return ordinal === null ? 'Empty bar' : `Warm-up ${String(ordinal)}`;
}

/**
 * One rung: what is on the bar and what to do with it.
 *
 * Words rather than the screen's `120 kg x 3`, because this sheet is read aloud
 * across a warm-up room and a multiplication sign is not a word. The repeat count
 * is only ever above one on the empty bar, and it is spelled out for the same
 * reason.
 */
export function packWarmupSetText(set: PackWarmupSet): string {
  const reps = `${String(set.reps)} rep${set.reps === 1 ? '' : 's'}`;
  const weight = formatWeight(set.weight);
  return set.count > 1 ? `${weight}, ${reps}, ${String(set.count)} times` : `${weight}, ${reps}`;
}

/**
 * What is worth saying about a ramp on paper, total over the three durable codes.
 *
 * Deliberately not the domain's own `advisory.message`, which every screen prints
 * verbatim. Those sentences are written for a reader who can tap the control they
 * are about; two of these three are about a decision the lifter already made
 * (`pack.ts` says which are kept and why), and on paper what matters is what to do
 * about it now, with no control in reach.
 */
export function packWarmupAdvisorySentence(code: PackWarmupAdvisoryCode): string {
  switch (code) {
    case 'sharing-a-rack':
      return 'These times assume the bar comes free in turn. If the queue is longer than you said, take sets off the bottom rather than rushing the top.';
    case 'equipment-prep-does-not-fit-the-lead':
      return 'Your gear takes longer to get on than the gap you left before the bar, so the start above already allows for it.';
    case 'the-ramp-was-shortened':
      return 'This is a shortened ramp: you asked for fewer sets than the full one has.';
  }
}

export const PACK_CHECKLIST_HEADING = 'Checklist';

export const PACK_NOTES_HEADING = 'Your notes';

/*
 * There is deliberately no heading over the contingency area as a whole. One was
 * written and removed: `packContingencyHeading` below already says "If the opener
 * went like this, take this second attempt" over each block, so a heading above
 * them reading the same thing in shorter words is the same sentence twice, and
 * the outer one is the one a folded sheet hides.
 */

/**
 * The heading over one attempt's worth of branches.
 *
 * Names both ends -- which attempt was taken and which one is being decided --
 * because §23's reader has the sheet folded to one section and no way to see the
 * heading above it. "Second attempt" over a block of weights is ambiguous in
 * exactly the direction that costs one: it reads as "the second attempt is 185"
 * to somebody who has just missed their opener.
 */
export function packContingencyHeading(attemptNumber: number): string {
  return attemptNumber === 2
    ? 'If the opener went like this, take this second attempt'
    : 'If the second went like this, take this third attempt';
}

/**
 * Why a branch is the weight it is, as a phrase rather than a sentence.
 *
 * The domain already writes one short sentence per reason and the live screen
 * prints it. This is deliberately not that sentence, for the reason
 * `packConflictLabel` is not `conflictSentence`: a contingency block is six rows
 * of up to three branches, so eighteen sentences under one heading is a page of
 * prose covering a table of six numbers. A phrase sits on the same line as the
 * weight it explains. Total over the union, so a reason added later cannot print
 * a bare weight with nothing saying what it is.
 */
export function packReasonPhrase(reason: LiveChoiceReason): string {
  switch (reason) {
    case 'continue-the-plan':
      return 'the plan';
    case 'upper-end-of-the-plan':
      return 'top of the planned range';
    case 'one-increment-above-the-plan':
      return 'one step above the plan';
    case 'one-increment-below-the-plan':
      return 'one step under the plan';
    case 'smallest-legal-increase':
      return 'smallest legal increase';
    case 'reduced-to-bank-the-lift':
      return 'under the plan, to bank the lift';
    case 'the-plan-unreduced':
      return 'the plan, unchanged';
    case 'repeat-the-same-weight':
      return 'the same weight again';
    case 'reaches-a-target':
      return 'lightest weight that still reaches a target';
    case 'pass-this-lift':
      return 'take no further attempt on this lift';
  }
}

/** Which branch §13 puts forward, said in words beside the mark that shows it. */
export const PACK_HIGHLIGHTED_NOTE = 'Suggested';

/** The subtotal under one lift, and the planned total under all of them. */
export function packSubtotalText(kilograms: number, unit: WeightUnit): string {
  return `Best case for this lift: ${weightText(kilograms, unit)}`;
}

export function packPlannedTotalText(kilograms: number, unit: WeightUnit): string {
  return `Planned total: ${weightText(kilograms, unit)}`;
}

/** What a lift with no agreed plan prints, so the gap is a sentence (§23). */
export const PACK_NO_PLAN = 'No plan agreed for this lift, so there is nothing to print.';

/**
 * The condition every third-attempt row is standing on.
 *
 * Printed beside the rows rather than once at the top of the sheet: the top of
 * the sheet is not what somebody is looking at while they read a row, and a
 * caveat that is one section away from the thing it qualifies is a caveat that
 * does not exist.
 */
export const PACK_CONTINGENCY_ASSUMPTION = 'Assumes the attempts before this one were made.';

/** The three column headings of a contingency row, from §13's own three slots. */
export function packSlotHeading(slot: LiveChoiceSlot): string {
  return slotLabel(slot);
}

/** What a branch offering no weight means, which is a decision and not a blank. */
export const PACK_NO_WEIGHT = 'Pass / stop this lift';

/**
 * Why a section §23 asks for is not on the sheet.
 *
 * One sentence each, in the place the section would have been, and each one says
 * what to do instead. Total over the union: a code with no sentence would print
 * an empty heading, which is the lost-page failure this whole mechanism exists to
 * avoid.
 */
export function packOmissionSentence(code: PackOmissionCode): string {
  switch (code) {
    case 'warm-up-ramp':
      // Reworded when §23.1 started printing the ramp: the reason it can be
      // missing is no longer that the tool has never been told about the room --
      // §20 asks -- but that a ramp is counted back from an opener and there is
      // no agreed opener on this sheet to count back from.
      return 'No warm-up ramp is printed. A ramp is counted back from your opener, and no opener has been agreed on the plan yet.';
    case 'records':
      return 'No record list is printed. This tool has not read a record book for this meet; the figures under "What you came for" are the ones you typed in.';
    case 'qualifying-standards':
      return 'No qualifying totals are printed, for the same reason. If you are chasing one, it is the total you typed in.';
  }
}

export const PACK_OMISSIONS_HEADING = 'Not on this sheet';

/*
 * -----------------------------------------------------------------------------
 * §23.2 -- the handler's roster sheet.
 * -----------------------------------------------------------------------------
 */

export const HANDLER_PACK_HEADING = 'Printable roster';
export const HANDLER_PACK_SUMMARY = 'Every lifter on one sheet, for a dead battery';

export const HANDLER_PACK_SHOW_LABEL = 'Show the printable roster';
export const HANDLER_PACK_HIDE_LABEL = 'Hide the printable roster';

export function handlerPackTitle(format: MeetFormat): string {
  return `Handler roster -- ${formatLabel(format)}`;
}

export const HANDLER_PACK_LIFTERS_HEADING = 'Lifters';
export const HANDLER_PACK_CONFLICTS_HEADING = 'Clashes';
export const HANDLER_PACK_NO_HANDLERS = 'Nobody assigned';

/**
 * §23.2's "warm-up start ranges", as the only form of them paper can carry.
 *
 * A *lead* -- how long before the bar the ramp starts -- rather than a time or a
 * countdown. Everything else on a `MeetWarmupSchedule` is seconds from the instant
 * the schedule was built, and a sheet is read hours after it is printed, on the day
 * the meet is running late: "in 40 minutes", printed at nine and read at eleven,
 * sends a handler to the rack cold and an hour early. `warmupLeadRange` cancels the
 * platform estimate out of both ends, so what is left does not move when the flight
 * does, and the handler subtracts it from whatever the board says now.
 *
 * **Both ends are ceiled, unlike `platformEstimateText` three thousand lines up,
 * which floors its early end and ceils its late one.** That looks like an
 * inconsistency and is the opposite: an estimate rounded outwards is a wider window,
 * which is the cautious direction for an *estimate*; a lead rounded up starts the
 * ramp *earlier*, which is the cautious direction for a lead. Flooring the shorter
 * end would print a lead up to a minute shorter than the schedule computed, and
 * §5.5's rule is that the direction which costs standing around beats the one that
 * costs the attempt. Do not "fix" this to match its neighbour.
 *
 * Total, and deliberately not clamped: `warmupLeadRange` leaves an inverted or
 * non-positive lead visible rather than absorbing it, so this has to answer for one.
 * It says the ramp does not fit rather than printing "0 minutes", which on paper
 * reads as a ramp that starts when the lifter is called.
 */
export function handlerPackWarmupLeadText(lead: WarmupLead): string {
  const shortest = Math.ceil(lead.minimumSeconds / 60);
  const longest = Math.ceil(lead.maximumSeconds / 60);
  const lift = liftLabel(lead.lift);
  if (shortest <= 0 || longest < shortest) {
    return `${lift} warm-up: does not fit before the bar. Start it as soon as the flight is called.`;
  }
  if (shortest === longest) {
    return `${lift} warm-up: start about ${String(longest)} minutes before the bar.`;
  }
  return `${lift} warm-up: start ${String(shortest)}-${String(longest)} minutes before the bar.`;
}

/**
 * A column with no data behind it, which is a column to write in.
 *
 * Not an omission sentence: an omission says a section is absent, and these
 * sections are present and empty on purpose. Nothing in this tool holds a flight
 * or a rack height *per lifter* -- §22.1 is one lifter's own answers, typed on
 * their own phone -- so a handler fills these in from the sheet on the wall, and
 * the sheet has to leave them room rather than pretend it asked.
 */
export function handlerWriteInLabel(code: HandlerWriteInCode): string {
  switch (code) {
    case 'flight':
      return 'Flight';
    case 'platform':
      return 'Platform';
    case 'rack-settings':
      return 'Rack';
    case 'results':
      return 'Result';
  }
}

export const HANDLER_PACK_WRITE_IN_NOTE =
  "The last columns are blank on purpose: this tool is not told the flight order, the platform, or each lifter's rack settings. Fill them in from the sheet on the wall.";

/**
 * One §21.2 warning, short enough to sit in a roster cell.
 *
 * Not `conflictSentence`, and the difference is the names. That function tells
 * the clash from one row's point of view and lists the other lifters, which is
 * right on a board read one row at a time and wrong on a roster where those
 * lifters are the rows above and below -- twelve rows each naming two others is
 * a page of names and no warnings. Total over the union for the reason
 * `packOmissionSentence` is: a code with no label prints an empty bullet, and an
 * empty bullet under "Clashes" reads as a line somebody tore off.
 */
export function packConflictLabel(code: CoachBoardConflictCode): string {
  switch (code) {
    case 'submission-deadlines-overlap':
      return 'Declaration clocks close together';
    case 'called-at-the-same-time':
      return 'Called at the same time';
    case 'handler-in-two-places':
      return 'Handler wanted in two places';
    case 'wrapping-at-the-same-time':
      return 'Wrapping at the same time';
    case 'shared-rack-loading-clash':
      return 'Shared bar at a different weight';
    case 'warm-up-during-another-attempt':
      return 'Final warm-up lands during an attempt';
    case 'change-moves-the-order':
      return 'A change here moves the order';
  }
}

/**
 * A §22.1 answer as words, for a reader with no tile group in front of them.
 *
 * Three of the sixteen answers are stored as enum codes, and a sheet printing
 * `own-handler` beside "Handoff" is a hyphenated identifier where a person
 * expected an instruction. The mapping goes through the same choice lists the
 * form draws, so the paper and the screen cannot come to say different things
 * about one answer. Everything else is the lifter's own text and is passed
 * through untouched -- reformatting what somebody wrote down for themselves is
 * the one edit this sheet must not make.
 */
export function packSetupValue(field: keyof LifterSetup, value: string): string {
  if (value === '') return '';
  const choices = PACK_ENUM_CHOICES[field];
  if (choices === undefined) return value;
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

const PACK_ENUM_CHOICES: Partial<Record<keyof LifterSetup, readonly Choice[]>> = {
  squatStart: SQUAT_START_CHOICES,
  handoff: HANDOFF_CHOICES,
  footBlocks: FOOT_BLOCKS_CHOICES,
};

/*
 * ---------------------------------------------------------------------------
 * §24 -- saving, the shelf, and moving a meet between devices.
 * ---------------------------------------------------------------------------
 */

/**
 * §24.3's warning, in the words the requirement gives.
 *
 * Reproduced almost exactly, and that is deliberate rather than lazy: it is the
 * one sentence in this tool that describes a way for a lifter to lose their
 * whole plan, and every rewording anybody attempts makes it gentler. "Can
 * remove the plan" is the honest verb.
 */
export const STORAGE_WARNING =
  'This version stores meets only in this browser. Clearing browser data, using a different device, or losing the device can remove the plan.';

/** The same fact where nothing is being kept at all, which is a different fact. */
export const STORAGE_WARNING_NOT_DURABLE =
  'Nothing is being saved. This browser will not keep anything for this page -- a private window and an embedded page both do this -- so the meet is here until the tab closes. Export it if you want to keep it.';

export const STORAGE_EXPORT_ADVICE = 'Export a copy before the meet if you want it somewhere else.';

export const MEET_LIBRARY_HEADING = 'Saved meets';

export const MEET_LIBRARY_EMPTY =
  'No saved meets yet. The one you are planning is saved as soon as you name it.';

export const MEET_LIBRARY_ARCHIVED_HEADING = 'Finished';

/**
 * Said when a saved meet is on the device and this build cannot open it.
 *
 * It says the meets were left alone because that is the part somebody needs to
 * know: the instinct on reading the first sentence is to clear the browser and
 * start again, which is the one action that would actually destroy them.
 */
export function unreadableMeetsSentence(count: number): string {
  if (count === 1) {
    return 'One saved meet on this device cannot be opened by this version of the tool. It has been left where it is, and may open in a newer one.';
  }
  return `${String(count)} saved meets on this device cannot be opened by this version of the tool. They have been left where they are, and may open in a newer one.`;
}

export function meetSavedSentence(outcome: SaveOutcome): string | null {
  switch (outcome) {
    case 'saved':
      return null;
    case 'no-storage':
      return STORAGE_WARNING_NOT_DURABLE;
    case 'storage-full':
      return 'There is no room left to save. Delete a finished meet, or export one and then delete it.';
    case 'failed':
      return 'The meet could not be saved just now. It is still on screen; try again, or export a copy.';
  }
}

export function libraryRefusalSentence(reason: LibraryRefusal): string {
  switch (reason) {
    case 'unknown-meet':
      return 'That meet is no longer on this device.';
    case 'name-required':
      return 'Give the meet a name.';
    case 'name-too-long':
      return `Keep the name to ${String(MEET_NAME_MAX)} characters or fewer.`;
    case 'library-full':
      return `This device holds ${String(MEET_LIBRARY_MAX)} meets. Delete a finished one to make room.`;
    case 'meet-archived':
      return 'That meet is finished. Resume it to make changes.';
  }
}

/**
 * Why a file was not read, with the two version cases kept apart.
 *
 * §24.4 asks for unsupported and older data to be reported clearly, and the
 * clear part is the instruction at the end: one of these means update the tool
 * and one means there is nothing to be done. A single "could not read that
 * file" would send somebody looking for a corrupted backup that is fine.
 */
export function meetFileRefusalSentence(reason: MeetFileRefusal, version?: number): string {
  switch (reason) {
    case 'unreadable':
      return 'That file is not a meet export.';
    case 'not-a-meet-file':
      return 'That file is not a meet export from this tool.';
    case 'newer-version':
      return `That file was written by a newer version of this tool${
        version === undefined ? '' : ` (version ${String(version)})`
      }. Update the tool, or open it on the device that made it.`;
    case 'older-version':
      return 'That file was written by an older version of this tool and cannot be opened by this one.';
    case 'damaged':
      return 'That file is a meet export, and part of it could not be read.';
  }
}

/** What an import is about to do, said before it does it (§24.4). */
export function importPreviewSentence(preview: ImportPreview): string {
  const total = preview.entries.length;
  if (total === 0) return 'That file holds no meets.';
  const meets = total === 1 ? '1 meet' : `${String(total)} meets`;
  const conflicts = preview.entries.filter((entry) => entry.disposition === 'conflict').length;
  const parts = [`${meets} in this file.`];
  if (conflicts > 0) {
    parts.push(
      conflicts === 1
        ? 'One of them has the same identifier as a meet already here; it will be added as a separate copy, and nothing here is replaced.'
        : `${String(conflicts)} of them have the same identifiers as meets already here; they will be added as separate copies, and nothing here is replaced.`,
    );
  }
  if (preview.overflow > 0) {
    parts.push(
      `There is only room for ${String(total - preview.overflow)} of them. Delete a finished meet first if you want the rest.`,
    );
  }
  return parts.join(' ');
}

/** What an import did, said afterwards. */
export function importOutcomeSentence(outcome: ImportOutcome): string {
  if (outcome.added === 0) return 'Nothing was imported.';
  const added = outcome.added === 1 ? '1 meet' : `${String(outcome.added)} meets`;
  const parts = [`Imported ${added}.`];
  if (outcome.skipped > 0) {
    parts.push(
      outcome.skipped === 1
        ? 'One did not fit and was not imported.'
        : `${String(outcome.skipped)} did not fit and were not imported.`,
    );
  }
  return parts.join(' ');
}

/**
 * The filename an export is offered under.
 *
 * The meet's name is not in it, on purpose. A downloaded file lands in a folder
 * that is often shared, backed up, or shown on a screen behind somebody, and
 * "Jane's first meet.json" says more about a person than a lifter chose to
 * publish by pressing Export. The date is enough to tell two exports apart.
 */
export function meetExportFilename(isoDate: string): string {
  return `meet-day-${isoDate}.json`;
}

export const MEET_EXPORT_LABEL = 'Export saved meets';
export const MEET_IMPORT_LABEL = 'Import from a file';

/*
 * The two answers to §24.4's preview.
 *
 * "Add them" rather than "Import" or "OK", because the sentence above it has
 * just said what will happen and the press is the lifter agreeing to that
 * sentence -- a button repeating the name of the control that opened the file
 * picker reads as a second attempt at the same step. "Do not add them" rather
 * than "Cancel" for the reason the shelf's delete panel says "Keep it": on a
 * panel with two presses a hair apart under a thumb, the safe one has to say
 * what it protects rather than name a dialog convention.
 */
export const MEET_IMPORT_CONFIRM_LABEL = 'Add them';
export const MEET_IMPORT_CANCEL_LABEL = 'Do not add them';
export const MEET_DELETE_ALL_LABEL = 'Delete everything saved here';

/** Said above the delete-everything control, which cannot be undone. */
export const MEET_DELETE_ALL_WARNING =
  'This removes every meet saved in this browser, including finished ones. It cannot be undone.';

export const MEET_RESUME_LABEL = 'Resume';
export const MEET_RENAME_LABEL = 'Rename';
export const MEET_DUPLICATE_LABEL = 'Duplicate';
export const MEET_ARCHIVE_LABEL = 'Mark finished';
export const MEET_DELETE_LABEL = 'Delete';

/** The name a duplicate is offered under, trimmed to fit the cap. */
export function duplicateMeetName(name: string): string {
  const suffix = ' (copy)';
  const room = MEET_NAME_MAX - suffix.length;
  return `${name.length > room ? name.slice(0, room).trimEnd() : name}${suffix}`;
}

/*
 * Naming the meet, which is the one thing a lifter has to do before anything is
 * saved at all.
 *
 * The shelf has no create control and must not grow one -- its own header says
 * why there is no Save button -- so the naming block sits above it, on the
 * planning screen and the coach board, and disappears the moment there is an
 * open meet. Two states, never both.
 */
export const MEET_NAMING_HEADING = 'This meet';

export const MEET_NAME_LABEL = 'Meet name';

/**
 * Said under the box, and it is two facts rather than one.
 *
 * The first is what the press does, because "saved as soon as you name it" is a
 * promise the empty shelf already makes and this is where it comes due. The
 * second is a nudge towards a venue rather than a person: the name is the one
 * string from this screen that lands in a filename's neighbourhood, shows in a
 * list somebody may hold up, and travels in an export to another device. §2.3
 * keeps athlete identity off the disk by default, and a lifter typing their own
 * name into a box labelled "Meet name" has not been told any of that.
 */
export const MEET_NAME_HINT =
  'Naming it starts saving it in this browser. A venue and a date works better than a person -- the name shows on the shelf and travels in an export.';

export const MEET_CREATE_LABEL = 'Start saving this meet';

/** Said in place of the box once there is a meet to save into. */
export function openMeetSentence(name: string): string {
  return `Saving to "${name}". Every change is kept as you make it.`;
}

/*
 * §24's three restore reports.
 *
 * A saved meet carries the rule book revision it was planned under and the
 * version of the attempt methodology that drew it, and `saved-meet.ts` is
 * explicit that recomputing a plan on restore is only safe because those two
 * figures are beside it. So all three of these say the same two things in
 * different words: the weights are exactly as they were left, and one of the
 * things they were derived from has moved. Neither half is safe on its own --
 * "the rules have changed" with no reassurance reads as a lost plan, and silence
 * reads as a plan still checked against a rule book nobody has checked it against.
 */
export const RESTORE_RULEBOOK_MOVED =
  'This meet was planned under an earlier revision of that rule book. Your attempts are exactly as you left them; check the increment and the submission deadline against the current rules before meet day.';

export const RESTORE_METHODOLOGY_MOVED =
  'This meet was planned by an earlier version of this tool. Your attempts are exactly as you left them, and anything worked out from here uses the current method.';

export const RESTORE_PROFILE_MISSING =
  'The rule book this meet was planned under is not published any more. Your attempts are exactly as you left them, and nothing here can be checked against a federation until you choose one.';

/*
 * -----------------------------------------------------------------------------
 * §26 -- the meet, once it is over.
 * -----------------------------------------------------------------------------
 *
 * `summary.ts` has already decided every figure on this screen, so everything
 * below is wording and nothing below compares, counts or grades. Three rules
 * shape it, and each one has cost something elsewhere in this file:
 *
 *   - Every absence is said rather than left out. `summary.ts`'s header is
 *     explicit about it: a section that quietly disappears is indistinguishable
 *     from a section the tool got wrong, and this screen is read once, after the
 *     fact, by somebody with no way to check.
 *   - An attempt figure is kilograms and never converted (§16). The total and
 *     the targets *are* written in the lifter's unit -- nobody calls a total to
 *     an expeditor -- so `weightText` is right for those two and wrong for
 *     everything else here.
 *   - A lesson is an observation about one day, with its derivation printed
 *     beside it, and never advice. §9.4's floor is two meets, and this screen
 *     shows one.
 */

/**
 * An attempt figure from a bare number of kilograms.
 *
 * `attemptKilogramsText` takes an `AttemptWeight`; the planned weight, the
 * against-plan difference and the recovered recommendation are all plain numbers
 * that never became one. Deliberately not `weightText`, which converts: a
 * recommendation printed in pounds is a weight no card carries (§16).
 */
function attemptFigure(kilograms: number): string {
  return formatWeight({ amount: kilograms, unit: 'kg' });
}

/** §9's names where they apply, and a number where they do not. */
function competitionAttemptLabel(attemptNumber: number): string {
  if (attemptNumber === 1 || attemptNumber === 2 || attemptNumber === 3) {
    return attemptLabel(attemptNumber);
  }
  return `Attempt ${String(attemptNumber)}`;
}

/**
 * Which attempt this was, including the two that are not competition attempts.
 *
 * A granted extra and a record try both carry an attempt number and neither is
 * the third attempt of the round -- printing "Third attempt" over a fourth-attempt
 * record try is the summary describing a meet the lifter did not have.
 */
export function summaryAttemptLabel(attemptNumber: number, kind: AttemptKind): string {
  switch (kind) {
    case 'competition':
      return competitionAttemptLabel(attemptNumber);
    case 'extra':
      return 'Extra attempt';
    case 'record':
      return 'Record attempt';
  }
}

/**
 * The heading, which has to work before there is a meet in it.
 *
 * `EMPTY_SUMMARY` carries an empty name for the lit-html binding hazard recorded
 * throughout this directory, so the blank branch is reachable from the first
 * paint of any route that binds it and is not defensive.
 */
export function summaryTitle(lifterName: string): string {
  return lifterName.trim() === '' ? 'How the day went' : `${lifterName} -- how the day went`;
}

export function summaryFormatText(format: MeetFormat): string {
  return `${formatLabel(format)} meet`;
}

export const SUMMARY_TOTAL_HEADING = 'Total';

/**
 * The one figure everybody looks at first, and the two ways there is not one.
 *
 * `runningTotalText` is the live screen's and cannot be reused here: on a finished
 * meet `isTotal` is false and `liftsOutstanding` is empty, so it prints "Subtotal
 * 0 kg" -- which reads as a meet still under way. A bomb-out is a finished meet
 * with no total, and saying so is the whole of §26 on this line.
 */
export function summaryTotalText(total: RunningTotal, unit: WeightUnit): string {
  if (total.isTotal) return `Total ${weightText(total.kilograms, unit)}`;
  if (total.kilograms === 0) return 'No total, and no good lift on the day.';
  return `No total. A total needs a good lift on every contested lift; ${weightText(total.kilograms, unit)} was made on the ones that produced one.`;
}

export const SUMMARY_LIFTS_HEADING = 'Lift by lift';

/**
 * Said in the place a lift-by-lift list would have been.
 *
 * Reachable from `EMPTY_SUMMARY` and from a meet somebody opened and abandoned,
 * and it is the section a reader looks at first -- so an empty heading with
 * nothing under it is the one gap on this page most likely to be read as the
 * summary having failed rather than as a meet nobody lifted in.
 */
export const SUMMARY_NO_LIFTS = 'No lift was contested.';

/** An attempt that was never given a weight, which is not the same as a pass. */
export const SUMMARY_NO_WEIGHT = 'No weight was set.';

/** The best made attempt, in kilograms because it is an attempt (§16). */
export function summaryBestText(best: AttemptWeight): string {
  return `Best ${attemptKilogramsText(best)}`;
}

export const SUMMARY_NO_GOOD_LIFT = 'Nothing made on this lift.';

export function summaryMadeText(made: number, taken: number): string {
  if (taken === 0) return 'No attempt taken.';
  return `${String(made)} of ${String(taken)} made.`;
}

/**
 * How an attempt ended, in five words the lifter would use.
 *
 * "Not taken" and "Passed" are deliberately different sentences for the reason
 * `summary.ts` separates the codes: a pass is a decision somebody made and an
 * untaken attempt is the meet ending first, and a summary that called the second
 * one a pass would put a choice on record that was never made.
 */
export function summaryOutcomeLabel(outcome: SummaryOutcome): string {
  switch (outcome) {
    case 'good':
      return 'Good lift';
    case 'no-lift':
      return 'No lift';
    case 'passed':
      return 'Passed';
    case 'extra-attempt-granted':
      return 'Extra attempt granted';
    case 'not-taken':
      return 'Not taken -- the meet ended first';
  }
}

export function summaryEffortText(effort: AttemptEffort): string {
  return `Effort: ${effortLabel(effort)}`;
}

export function summaryMissReasonText(reason: MissReason): string {
  return `Reason: ${missReasonLabel(reason)}`;
}

export function summaryRpeText(rpe: number): string {
  return `RPE ${String(rpe)}`;
}

/**
 * The three lights, by seat rather than as a tally.
 *
 * A bare "2-1" says the attempt was passed and nothing else; which referee
 * dissented is the part somebody goes back to the note for, and it is the reason
 * `LIGHT_FIELDS` is a tuple on the entry card (§12.1). The seats are destructured
 * rather than indexed so that a rearranged tuple is a compile error rather than a
 * head referee's light printed under the left referee's name.
 */
export function summaryLightsText(lights: AttemptLights): string {
  const [left, head, right] = lights;
  const [leftSeat, headSeat, rightSeat] = LIGHT_POSITION_LABELS;
  return [
    `${leftSeat} ${lightLabel(left).toLowerCase()}`,
    `${headSeat} ${lightLabel(head).toLowerCase()}`,
    `${rightSeat} ${lightLabel(right).toLowerCase()}`,
  ].join(', ');
}

export function summaryPlannedText(kilograms: number): string {
  return `Planned ${attemptFigure(kilograms)}`;
}

/**
 * Declared against planned, with the direction in words.
 *
 * A signed figure is the obvious form and is unreadable at a glance: "-5 kg
 * against the plan" is read as a shortfall by some people and as a reduction by
 * others, and the two are the same fact with opposite feelings attached. Zero is
 * its own sentence rather than "0 kg above", which reads as a rounding artefact.
 */
export function summaryAgainstPlanText(againstPlanKilograms: number): string {
  if (againstPlanKilograms === 0) return 'Exactly as planned';
  const size = attemptFigure(Math.abs(againstPlanKilograms));
  return againstPlanKilograms > 0 ? `${size} above the plan` : `${size} below the plan`;
}

/**
 * What the tool had on screen when the weight was declared.
 *
 * The slot is named as well as the weight, because the same number under Secure
 * and under Push is two different pieces of advice -- §13.7 makes the same
 * argument about the live card, and it holds harder here, where nobody can look
 * at the screen it came from any more.
 */
export function summaryRecommendationText(recommendation: SummaryRecommendation): string {
  const reason = packReasonPhrase(recommendation.reason);
  if (recommendation.kilograms === null) return `The tool pointed at a pass -- ${reason}`;
  const weight = attemptFigure(recommendation.kilograms);
  return `The tool pointed at ${weight} -- ${slotLabel(recommendation.slot)}, ${reason}`;
}

/** Whether it was taken. Two sentences rather than a tick, so it can be read aloud. */
export function summaryFollowedText(followed: boolean): string {
  return followed ? 'You took that weight.' : 'You took a different weight.';
}

/**
 * Why there is no comparison for this attempt.
 *
 * Both of these are ordinary rather than faulty -- the undo window is bounded and
 * a weight typed outside live mode was never offered against a choice -- so
 * neither sentence apologises. What they must not do is disappear: an attempt with
 * no line here is indistinguishable from one where the lifter took the tool's
 * suggestion, which is the flattering reading.
 */
export function summaryGapSentence(code: SummaryGapCode): string {
  switch (code) {
    case 'history-truncated':
      return 'What the tool suggested here has dropped out of the undo history, so there is nothing to compare this weight against.';
    case 'no-choice-was-offered':
      return 'This weight was not set from the live screen, so the tool never offered a choice beside it.';
  }
}

export const SUMMARY_LIGHTS_HEADING = 'Referee lights';

export function summaryLightCountsText(white: number, red: number): string {
  return `${String(white)} white, ${String(red)} red`;
}

/**
 * How much of the meet the light count is actually counting.
 *
 * §12.1 makes light entry optional and puts it behind a fold, so most meets have
 * some attempts with none. A count printed without this line is read as the whole
 * day, and the direction of the error is not neutral: the missing attempts are
 * disproportionately the ones nobody stopped to record, which is the busy end.
 */
export function summaryLightsMissingText(attemptsWithoutLights: number): string | null {
  if (attemptsWithoutLights === 0) return null;
  const attempts = attemptsWithoutLights === 1 ? 'attempt' : 'attempts';
  return `${String(attemptsWithoutLights)} resolved ${attempts} had no lights entered, so this is not the whole meet.`;
}

export const SUMMARY_TARGETS_HEADING = 'Targets';

/**
 * Said where §8.3's list is empty, and it names the reason rather than the state.
 *
 * "No targets" reads as a tool that lost them. Five of §8.3's ten kinds still have
 * no source (§13.10), so a lifter who set none is the ordinary case and the page
 * should not imply they missed a step.
 */
export const SUMMARY_NO_TARGETS = 'No targets were set for this meet.';

/**
 * Where the meet left one of §8.3's targets.
 *
 * Read off `reachedByGuaranteed`, which is the only one of `TargetProgress`'s four
 * flags that is about weight already on the board. The other three are
 * projections, and a finished meet has nothing left to project -- printing one
 * here would tell a lifter they reached something on an attempt they never took.
 */
export function summaryTargetText(progress: TargetProgress, unit: WeightUnit): string {
  if (progress.reachedByGuaranteed) return `Reached ${progress.target.label}.`;
  return `Short of ${progress.target.label} by ${weightText(progress.shortfallKilograms, unit)}.`;
}

export const SUMMARY_TIMING_HEADING = 'Timing';

/**
 * The sentence that keeps these figures out of a dispute.
 *
 * The gaps are between results recorded *on this phone*, which starts whenever
 * somebody got round to tapping. §29 requires the tool never to claim authority
 * it does not have, and a table of intervals with no such line on it is exactly
 * the artefact somebody brings to the scoring table.
 */
export const SUMMARY_TIMING_CAVEAT =
  'These are the gaps between results recorded here, not the official clock.';

export function summaryIntervalText(sincePreviousSeconds: number): string {
  return `${countdownText(sincePreviousSeconds)} after the previous result`;
}

export const SUMMARY_FIRST_RESULT = 'First result recorded';

/** Said where nothing was ever recorded, so the caveat above is not left hanging. */
export const SUMMARY_NO_INTERVALS = 'No results were recorded, so there is nothing to time.';

export const SUMMARY_NOTES_HEADING = 'What you wrote';

/**
 * Said where the lifter wrote nothing.
 *
 * §12.1 puts the note behind a fold precisely so that nobody has to write one, so
 * this is the common case and the sentence does not treat it as a lapse.
 */
export const SUMMARY_NO_NOTES = 'You wrote no notes during this meet.';

/**
 * Which attempt a note or a timing row is about.
 *
 * Shared by both because both carry a lift and a bare attempt number and neither
 * carries a kind -- so neither may call `summaryAttemptLabel`, which would have
 * to be told one. Writing "competition" into the call at the two sites is the
 * alternative, and it is a claim about an attempt nobody recorded a kind for.
 */
export function summaryAttemptHeading(lift: PlatformLift, attemptNumber: number): string {
  return `${liftLabel(lift)}, ${competitionAttemptLabel(attemptNumber).toLowerCase()}`;
}

export const SUMMARY_LESSONS_HEADING = 'What the record shows';

/**
 * §9.4's floor, said before anything it applies to.
 *
 * `meet-history.ts` refuses to call anything a trend under two meets, and this
 * screen is one. The caveat goes above the list rather than beside each line
 * because a reader who takes one observation as a pattern has already stopped
 * reading the qualifiers.
 */
export const SUMMARY_ONE_MEET_CAVEAT =
  'One meet is one meet. These are observations about this day, not a pattern.';

/**
 * Said where none of the eight derivations fired.
 *
 * Every one of them is a *shape* -- every third missed, every miss technical, more
 * attempts above the plan than under -- so a meet that was simply mixed produces
 * none, and that is the ordinary outcome rather than a quiet one. Left unsaid, the
 * empty heading reads as the tool having declined to comment.
 */
export const SUMMARY_NO_LESSONS =
  'Nothing about this meet fell into a shape worth naming. That is an ordinary day, not a missing answer.';

/**
 * What the record shows, one sentence per code.
 *
 * Each states the observation and the thing it was drawn from, and none of them
 * says what to do next. That is the line §9.4 draws and it is easy to cross by
 * accident: "you left weight on the platform" is an observation, "open heavier"
 * is a plan built from a single day.
 */
export function summaryLessonSentence(code: SummaryLessonCode): string {
  switch (code) {
    case 'bombed-out':
      return 'No total on the day. Three misses on one lift ends the total, whatever the other lifts did.';
    case 'opener-was-missed':
      return 'An opener was missed. An opener is meant to be the attempt you are certain of, so it is the one worth looking at first.';
    case 'every-third-was-missed':
      return 'Every third attempt taken was missed. That is a different day from missing throughout -- the weights up to the last round were there.';
    case 'nothing-was-hard':
      return 'Every good lift was reported as flying, and nothing was missed.';
    case 'misses-were-technical':
      return 'Every miss was a command or a platform error rather than the weight.';
    case 'misses-were-strength':
      return 'Every miss was reported as strength rather than execution.';
    case 'went-above-the-plan':
      return 'More attempts were taken above the plan than under it.';
    case 'stayed-below-the-plan':
      return 'More attempts were taken under the plan than above it.';
  }
}

/**
 * The working, printed beside the observation.
 *
 * `bombed-out` is the case with neither half -- it is drawn from the total rather
 * than from a count of attempts -- so this returns `null` rather than an empty
 * "From ." A lesson with no evidence line is still a lesson; one with a blank one
 * looks like a figure that failed to load.
 */
export function summaryLessonEvidenceText(lesson: SummaryLesson): string | null {
  const lifts = lesson.lifts.length === 0 ? null : liftListText(lesson.lifts);
  const attempts =
    lesson.attempts === 0
      ? null
      : `${String(lesson.attempts)} ${lesson.attempts === 1 ? 'attempt' : 'attempts'}`;
  if (lifts === null) return attempts === null ? null : `From ${attempts}`;
  if (attempts === null) return `From ${lifts}`;
  return `From ${lifts} -- ${attempts}`;
}

export const SUMMARY_OMISSIONS_HEADING = 'Not on this page';

/**
 * Why a section §26 asks for is missing, in the place it would have been.
 *
 * The same mechanism as `packOmissionSentence` and for the same reason: both of
 * these are things the requirement lists and this tool has no source for, and a
 * heading that simply is not there reads as a tool that forgot rather than one
 * that has not been told.
 */
export function summaryOmissionSentence(code: SummaryOmissionCode): string {
  switch (code) {
    case 'personal-records':
      return 'No personal records are shown. This tool keeps no record of your past bests, so it cannot say whether today beat one.';
    case 'qualifying-standards':
      return 'No qualifying standards are shown. This tool has no published source for them; if you were chasing one, it is the total you typed in.';
  }
}

/**
 * The undo window ran out before the start of the meet.
 *
 * Said once at the foot of the page rather than per attempt, because the attempts
 * it affects already carry `history-truncated` and repeating the explanation nine
 * times buries the one line that says why.
 */
export const SUMMARY_HISTORY_TRUNCATED =
  'The undo history did not reach the start of this meet, so the earliest attempts have no record of what the tool suggested.';

/**
 * §9.4 read back to the lifter, under the summary of the meet that just ended.
 *
 * Everything below states a figure and where it came from, and nothing below
 * says what to do about it. That is the same line `summaryLessonSentence` draws
 * one screen up, arriving somewhere it is much easier to cross: a panel headed
 * "what your past meets show" with a typical jump in it reads as a suggestion
 * unless it is written not to. The domain agrees -- `CalibrationReport.elevatable`
 * exists precisely because nothing yet turns this into a recommendation -- so the
 * wording here has no imperative in it anywhere.
 *
 * The other constraint is §10.2, and it is tighter here than anywhere else in
 * this file, because two of the five figures per lift are counts of made and
 * missed attempts. "Five of six made" is a count. The same pair written as a
 * percentage is a success rate, which is a probability with the word filed off,
 * and it is the one sentence a screen like this writes by itself.
 */
export const CALIBRATION_HEADING = 'What your past meets show';

/** Which meets were being looked for, as a noun phrase inside a sentence. */
export function calibrationScopeText(scope: HistoryScope): string {
  if (scope.combineEquipment) return 'meets under any equipment';
  switch (scope.equipment) {
    case 'raw':
      return 'raw meets';
    case 'wraps':
      return 'meets in wraps';
    case 'equipped':
      return 'equipped meets';
    case 'unstated':
      return 'meets with no equipment recorded';
  }
}

/**
 * How much was read, said before any figure drawn from it.
 *
 * Zero is a sentence rather than a blank, and it is deliberately not the same
 * sentence as {@link CALIBRATION_NOT_ENOUGH}: a lifter with one raw meet and
 * four in wraps has plenty of history and is being told none of it matched, and
 * a lifter on their first day has none. Those need different answers, and the
 * scope is named in both so the difference is visible.
 */
export function calibrationReadText(report: CalibrationReport): string {
  const scope = calibrationScopeText(report.scope);
  if (report.meetsRead === 0) return `No earlier ${scope} to read.`;
  const meets =
    report.meetsRead === 1 ? '1 earlier meet' : `${String(report.meetsRead)} earlier meets`;
  return `From ${meets}, counting ${scope}.`;
}

/**
 * What was on the shelf and deliberately not counted.
 *
 * `null` rather than "0 meets were left out", because the ordinary case is a
 * lifter whose meets are all under one equipment category and a line reporting
 * nothing every time is a line nobody reads the day it says something.
 */
export function calibrationOutOfScopeText(report: CalibrationReport): string | null {
  if (report.meetsOutOfScope === 0) return null;
  const meets =
    report.meetsOutOfScope === 1 ? '1 meet was' : `${String(report.meetsOutOfScope)} meets were`;
  return `${meets} left out for being under other equipment.`;
}

/**
 * The floor, said above the figures rather than instead of them.
 *
 * §9.4's one hard rule is that a personal trend is not reliable after one meet,
 * and `MEETS_BEFORE_A_TREND` is that rule as a number. The figures below it are
 * still drawn -- hiding them would leave a lifter unable to see what the tool is
 * counting, and this panel's whole claim is that it is showing its working -- but
 * the sentence stops at the floor and does not say so, because it is also the
 * sentence a lifter with no meets at all reads, under nothing.
 */
export const CALIBRATION_NOT_ENOUGH = `That is not enough to call any of this a pattern. It takes ${String(MEETS_BEFORE_A_TREND)} comparable meets before these figures say much.`;

/**
 * The sentence that keeps the panel from reading as advice.
 *
 * Sits under the heading, not at the foot, for the reason
 * {@link SUMMARY_ONE_MEET_CAVEAT} does: a reader who has taken a typical jump as
 * an instruction has already stopped reading the qualifiers.
 */
export const CALIBRATION_NOT_A_PLAN =
  'These are your own past figures, not advice. Nothing here changes what the tool suggests on the day.';

/** How far a figure can be trusted, in the three words the domain grades in. */
export function calibrationStrengthText(strength: HistoryStrength): string {
  switch (strength) {
    case 'not-enough':
      return 'not enough yet';
    case 'indicative':
      return 'indicative';
    case 'established':
      return 'established';
  }
}

/**
 * The working, printed under each figure.
 *
 * Every figure on this panel carries one, including the ones graded
 * `not-enough`, because a figure with no count beside it is indistinguishable
 * from a figure the tool is confident about.
 */
export function calibrationEvidenceText(observations: number, strength: HistoryStrength): string {
  const counted = observations === 1 ? '1 observation' : `${String(observations)} observations`;
  return `From ${counted} -- ${calibrationStrengthText(strength)}`;
}

export const CALIBRATION_LIFTS_HEADING = 'Lift by lift';

/**
 * Said where the history was read and held no lifts.
 *
 * Not the same case as no meets, which {@link calibrationReadText} answers on its
 * own line: this is a meet that finished with nothing contested, which a shelf
 * can hold and which would otherwise be a heading over a blank.
 */
export const CALIBRATION_NO_LIFTS = 'No lifts to compare yet.';

export const CALIBRATION_SUCCESSFUL_JUMP_LABEL = 'Typical jump into a made attempt';
export const CALIBRATION_MISSED_JUMP_LABEL = 'Typical jump into a miss';
export const CALIBRATION_SECOND_ATTEMPTS_LABEL = 'Second attempts';
export const CALIBRATION_THIRD_ATTEMPTS_LABEL = 'Third attempts';
export const CALIBRATION_REACHED_LABEL = 'Best lift against the maximum you planned';

/**
 * Said in the place a figure would have been.
 *
 * A lift can reach this panel with three of its five figures empty -- a lifter
 * who has never missed has no missed jump -- and an empty row would read as a
 * number that failed to load rather than as a thing that has not happened.
 */
export const CALIBRATION_NO_FIGURE = 'Nothing recorded yet';

/** A jump or a weight figure, in the unit the lifter set (§16). */
export function calibrationFigureText(figure: CalibrationFigure, unit: WeightUnit): string | null {
  if (figure.kilograms === null) return null;
  return weightText(figure.kilograms, unit);
}

/**
 * A share of the planned maximum.
 *
 * A percentage of a weight, which is a ratio of two figures the lifter can point
 * at -- deliberately not the same kind of number as a percentage of attempts,
 * which §10.2 forbids and which nothing on this panel prints.
 */
export function calibrationShareText(share: CalibrationShare): string | null {
  if (share.percent === null) return null;
  return `${String(Math.round(share.percent))}% of what you planned`;
}

/**
 * Made against taken, as two counts.
 *
 * Never a rate. `taken === 0` is its own answer rather than "0 of 0 made", which
 * is arithmetic that reads as a run of failures.
 */
export function calibrationSuccessText(success: AttemptSuccess): string | null {
  if (success.taken === 0) return null;
  return `${String(success.made)} of ${String(success.taken)} made`;
}

export const CALIBRATION_CLUSTER_HEADING = 'Where the misses fall';

/**
 * One lift holding more than its share of the misses.
 *
 * States both counts rather than the multiple that found it: "5 of 8" is a fact
 * a lifter can check against their own memory of the days, and "1.6 times as
 * many as the other lifts" is a derivation they cannot.
 */
export function calibrationClusterText(cluster: MissCluster): string {
  return `More of your misses are on the ${liftLabel(cluster.lift).toLowerCase()} than on the other lifts: ${String(cluster.misses)} of ${String(cluster.ofMisses)}.`;
}

/**
 * Said when no lift stands out, which includes a lifter who has missed nothing.
 *
 * One sentence for both, because the alternative -- a separate "you have missed
 * nothing" line -- is a compliment on a panel that has no business paying one,
 * and the misses that are there are already counted per lift above.
 */
export const CALIBRATION_NO_CLUSTER = 'No lift holds more of your misses than the others.';

/*
 * ---------------------------------------------------------------------------
 * §20 -- THE WARM-UP, ON THE MEET'S CLOCK
 *
 * Two rules govern every sentence below and they pull against each other.
 *
 * §20.1 says "avoid false precision", and §5.5's authority rule says the meet
 * staff decide. So nothing here names an instant. Every figure is a range, a
 * range is always two numbers and a dash, and the word "about" appears wherever
 * a single number could not be avoided. There is no "at 2:47" on this screen and
 * there is no clock face: a lifter reading a clock face plans to it.
 *
 * Against that, §20's point is that a lifter in a warm-up room has thirty
 * seconds and chalk on their hands. So the hedging lives in the *shape* of the
 * figures rather than in extra words around them. "In 18-24 minutes" is honest
 * and is four characters longer than "in 21 minutes"; a sentence apologising for
 * the range is neither.
 * ---------------------------------------------------------------------------
 */

export const WARMUP_HEADING = 'Warm-up';

/**
 * What the screen is for, said before any of it is filled in.
 *
 * Names the two things it needs and the one thing it cannot know. A screen of
 * eleven optional number fields with no opening sentence reads as a form; the
 * point is that every field is a question about a room this device cannot see,
 * and a lifter who understands that answers the two that matter and skips the
 * rest.
 */
export const WARMUP_INTRO =
  'Tell it roughly where the meet has got to and it will count backwards from your attempt to the first warm-up set.';

export const WARMUP_PLACE_HEADING = 'Where the meet is';
export const WARMUP_PACE_HEADING = 'How fast it is running';
export const WARMUP_TIMELINE_HEADING = 'Your warm-up';
export const WARMUP_PREFERENCES_HEADING = 'How you like to warm up';
export const WARMUP_PREP_HEADING = 'Gear and wraps';
export const WARMUP_ROOM_HEADING = 'The warm-up room';
export const WARMUP_SETS_HEADING = 'The sets';

/** §20.1's first question, and the one that changes which others are asked. */
export const WARMUP_PLACE_LABEL = 'Which flight is on the platform';

export const WARMUP_PLACE_CHOICES: readonly Choice[] = [
  { value: 'earlier-flight-running', label: 'One before mine' },
  { value: 'own-flight-running', label: 'Mine' },
];

export const WARMUP_ATTEMPTS_LEFT_LABEL = 'Attempts left in that flight';
export const WARMUP_FLIGHTS_BETWEEN_LABEL = 'Whole flights between';
export const WARMUP_CURRENT_ROUND_LABEL = 'Round on the platform';
export const WARMUP_CURRENT_POSITION_LABEL = 'Lifters done in that round';
export const WARMUP_FLIGHT_SIZE_LABEL = 'Lifters in my flight';
export const WARMUP_TARGET_ROUND_LABEL = 'My round';
export const WARMUP_TARGET_POSITION_LABEL = 'My place in it';
export const WARMUP_ATTEMPTS_DONE_LABEL = 'Attempts done today';
export const WARMUP_ELAPSED_LABEL = 'Minutes since the session started';
export const WARMUP_BREAK_LABEL = 'Scheduled break before I lift';
export const WARMUP_DELAY_LABEL = 'Minutes the meet is running late';

/**
 * The hints that stop a question being answered about the wrong thing.
 *
 * Only four fields carry one, and each is a question two readings can be given
 * to. "Lifters done in that round" is the one that costs a lifter the most:
 * counted as a position rather than a count, every estimate on the screen is one
 * attempt out, which at a minute an attempt is invisible and wrong.
 */
export const WARMUP_ATTEMPTS_LEFT_HINT = 'A guess is fine. Count the lifters still to go.';
export const WARMUP_CURRENT_POSITION_HINT = 'How many have lifted, not who is up.';
export const WARMUP_TARGET_POSITION_HINT = 'Counting from the front of the flight.';
export const WARMUP_ELAPSED_HINT = 'With the attempt count, this measures the real pace.';

/**
 * The pace, and where it came from.
 *
 * The source is in the sentence rather than beside it as a badge, because the
 * two readings are not degrees of the same thing: one is a measurement of this
 * session and the other is a number this tool made up. §20.1's spread already
 * widens the range for the assumed case, and the widened range is not
 * self-explaining -- a lifter seeing 12-40 minutes with no reason for it reads a
 * broken tool rather than an honest one.
 */
export function warmupPaceText(pace: MeetPace): string {
  const seconds = Math.round(pace.secondsPerAttempt);
  switch (pace.source) {
    case 'observed':
      return `About ${String(seconds)} seconds an attempt, measured from today.`;
    case 'supplied':
      return `About ${String(seconds)} seconds an attempt, as you set it.`;
    case 'assumed':
      return `Assuming ${String(seconds)} seconds an attempt. Fill in the two fields above and it will measure the real one.`;
  }
}

/**
 * §20.1's own example sentence: "Estimated platform time: 18-24 minutes".
 *
 * Minutes, floored and ceiled outwards, because the engine already rounded to
 * whole minutes in the directions §5.5 wants and rounding again inwards here
 * would undo it. A range that collapses to one number is still printed as one
 * number rather than as "3-3 minutes".
 */
export function platformEstimateText(estimate: PlatformEstimate): string {
  const earliest = Math.floor(estimate.earliestSeconds / 60);
  const latest = Math.ceil(estimate.latestSeconds / 60);
  if (earliest <= 0 && latest <= 0) return 'You are up now.';
  if (earliest === latest) return `About ${String(latest)} minutes to the platform.`;
  return `${String(Math.max(0, earliest))}-${String(latest)} minutes to the platform.`;
}

/** How many attempts stand between the lifter and the bar. */
export function attemptsBeforeText(estimate: PlatformEstimate): string {
  const count = estimate.attemptsBefore;
  if (count === 0) return 'No attempts in front of you.';
  return `${String(count)} attempt${count === 1 ? '' : 's'} in front of you.`;
}

/**
 * When a scheduled item starts, as a range counted from now.
 *
 * Negative is printed as "should have started", not as a negative number and not
 * clamped to zero. §13.3 made the domain report a start in the past honestly and
 * this is the sentence that was reserved for it: a lifter who is late needs to
 * know by how much, because that is what decides how many sets come off.
 */
export function warmupStartText(earliestSeconds: number, latestSeconds: number): string {
  if (latestSeconds < 0) {
    return `Should have started ${countdownText(-latestSeconds)} ago.`;
  }
  const earliest = Math.floor(Math.max(0, earliestSeconds) / 60);
  const latest = Math.ceil(latestSeconds / 60);
  if (latest <= 0) return 'Now.';
  if (earliest === latest) return `In about ${String(latest)} minutes.`;
  return `In ${String(earliest)}-${String(latest)} minutes.`;
}

/**
 * What one line of the timeline is.
 *
 * A warm-up set is numbered the way tool 2 numbers it -- counting only the sets
 * a lifter can move, so the bar-only set at the bottom is "Empty bar" and the
 * first movable one is always "Warm-up 1". Two tools numbering the same ramp
 * differently is the kind of disagreement that gets noticed at the rack with
 * both screens open.
 */
export function warmupItemLabel(
  kind: ScheduledItemKind,
  ordinal: number | null,
  equipmentId: string | null,
): string {
  switch (kind) {
    case 'platform':
      return 'Your attempt';
    case 'equipment':
      return equipmentId === null ? 'Get ready' : warmupPrepLabel(equipmentId);
    case 'warm-up-set':
      return ordinal === null ? 'Empty bar' : `Warm-up ${String(ordinal)}`;
  }
}

/** §20's five preparations, named. An unrecognised id is shown as itself. */
export function warmupPrepLabel(id: string): string {
  switch (id) {
    case 'knee-wraps':
      return 'Knee wraps';
    case 'bench-shirt':
      return 'Bench shirt';
    case 'squat-suit':
      return 'Squat suit';
    case 'deadlift-suit':
      return 'Deadlift suit';
    case 'other':
      return 'Other preparation';
    default:
      return id;
  }
}

export const WARMUP_PREP_MINUTES_LABEL = 'Minutes';

/**
 * Which side of the ramp a preparation falls on.
 *
 * Worded as what the lifter does rather than as the engine's two codes. "After
 * the final warm-up" is technically exact and describes a gap; "Just before I
 * walk out" describes the moment somebody is picturing when they answer.
 */
export const WARMUP_PREP_WHEN_CHOICES: readonly Choice[] = [
  { value: 'before-the-ramp', label: 'Before I start' },
  { value: 'after-the-final-warm-up', label: 'Just before I walk out' },
];

export const WARMUP_LEAD_MINIMUM_LABEL = 'Finish warming up at least';
export const WARMUP_LEAD_MAXIMUM_LABEL = 'and at most';
export const WARMUP_LEAD_UNIT = 'minutes before';
export const WARMUP_LEAD_HINT = 'The gap between your last warm-up and the bar.';
export const WARMUP_REST_LABEL = 'Rest between warm-up sets';
export const WARMUP_SET_SECONDS_LABEL = 'Time one set takes';
export const WARMUP_MAXIMUM_SETS_LABEL = 'Most warm-up sets I want';
export const WARMUP_MAXIMUM_SETS_HINT = 'Leave it blank for as many as the ramp needs.';
export const WARMUP_SHARED_RACK_LABEL = 'Lifters on my warm-up bar';
export const WARMUP_SHARED_RACK_HINT = 'Including you. Leave it blank if the bar is yours.';

export const WARMUP_DELAY_PREFERENCE_LABEL = 'If the meet runs late';

/**
 * §20.1's three answers, chosen in advance because the moment they are needed is
 * the worst moment to be deciding.
 */
export const WARMUP_DELAY_CHOICES: readonly Choice[] = [
  { value: 'wait', label: 'Wait' },
  { value: 'repeat-a-light-movement', label: 'Repeat something light' },
  { value: 'continue', label: 'Carry on' },
];

export const WARMUP_SET_WEIGHT_LABEL = 'Weight';
export const WARMUP_SET_REPS_LABEL = 'Reps';
export const WARMUP_RESET_SETS_LABEL = 'Back to the calculated sets';

/** §5.8's rule for a fold: say what is behind it, including whose figures they are. */
export function warmupSetsSummary(changed: number, total: number): string {
  if (changed === 0) return 'Calculated weights and reps';
  return `${String(changed)} of ${String(total)} set by you`;
}

/**
 * Said where an opener has not been chosen yet.
 *
 * The estimate above it still works, which is why this is a sentence in the
 * timeline section rather than a refusal covering the screen: a handler wanting
 * only "how long have we got" gets the answer with nothing typed here at all.
 */
export const WARMUP_NEEDS_AN_OPENER =
  'Pick an opener on the plan screen and the warm-up will count back from it.';

/**
 * Why no ramp could be drawn, total over the domain's codes.
 *
 * Total rather than defaulted, the same split as `meetProblemSentence` and
 * `PlanProblem` above: the domain publishes codes and each tool writes its own
 * wording, so a default would ship the day a code was added and would say the
 * wrong thing on a screen where the lifter's next move depends on which of two
 * things is wrong.
 *
 * The first draft of this was one constant blaming the warm-up room, and it was
 * wrong in the direction that costs the most. `collectProblems` refuses on the
 * opener or on a bar weight that will not read, and the opener is the one a
 * lifter can actually reach -- so a sentence saying "check the room below" sends
 * somebody to the one part of the screen that is fine, at the point where they
 * have the least time to work out that it is.
 */
export function warmupProblemSentence(code: WarmupProblemCode): string {
  switch (code) {
    case 'working-weight-not-a-number':
    case 'working-weight-not-positive':
      return 'There is no opener to count back from. Pick one on the plan screen.';
    case 'working-sets-not-a-positive-whole-number':
    case 'working-reps-not-a-positive-whole-number':
      return 'The attempt on the platform could not be read as one set of one.';
    case 'equipment-weight-not-a-number':
      return 'The bar or the collars in the warm-up room have no weight on them. Check the room below.';
  }
}

/*
 * §20 on the planning screen. The element renders its own `WARMUP_HEADING`, so
 * the fold that holds it is labelled differently on purpose: a fold reading
 * "Warm-up" opening onto a heading reading "Warm-up" says the word twice and
 * neither one earns its line. The inner heading stays, because the same element
 * is mounted on its own on the coach path where nothing else names it.
 */
export const WARMUP_FOLD_LABEL = 'Warming up at the meet';
export const WARMUP_FOLD_SUMMARY = 'How long you have, and what to put on the bar';

/**
 * The picker above the fold.
 *
 * Phrased as the lifter's question rather than as "Lift", because the answer
 * moves a whole screen underneath it: the timeline, the ramp and the room are
 * all per lift, and a bare noun reads as a filter over one list.
 */
export const WARMUP_LIFT_LABEL = 'Which lift are you warming up for';

/** One tile per contested lift, in the order the platform runs them. */
export function warmupLiftChoices(lifts: readonly PlatformLift[]): readonly Choice[] {
  return lifts.map((lift) => ({ value: lift, label: liftLabel(lift) }));
}

/*
 * ---------------------------------------------------------------------------
 * §19 -- GOING FOR A RECORD
 *
 * Two rules govern every sentence below.
 *
 * The first is that this application has read no record book (§29). Every
 * figure on this screen came out of the lifter's own typing, and the wording
 * has to keep saying so without saying it eight times over. So the questions
 * ask for the book's figure rather than for "the record", nothing here calls a
 * number verified, and `VERIFY_WITH_OFFICIALS` is printed off the plan verbatim
 * -- never paraphrased, and never shortened to fit a line.
 *
 * The second is that the two routes are two different weights, and a lifter
 * reading the wrong one loses either the record or the card. So neither figure
 * is ever shown on its own: each sits under a heading naming the attempt it
 * belongs to, and where a route is closed the heading stays and the reason
 * takes the place of the weight. A screen showing one number is a screen where
 * the lifter cannot tell which of the two they are looking at.
 * ---------------------------------------------------------------------------
 */

export const RECORD_HEADING = 'Record attempt';

/**
 * What the fold is for, and what it is not.
 *
 * Names the source in the first clause. A lifter opening this expects the tool
 * to know the records -- every other figure on this screen was worked out for
 * them -- and the honest answer is that it does not, which has to arrive before
 * the empty field rather than as an apology under it.
 */
export const RECORD_INTRO =
  "Type the record off your federation's own list and this works out the lightest attempt that takes it, by each of the two routes to it.";

/**
 * What a restored answer is, said where the restored answer is.
 *
 * The one caveat this fold owes a lifter in exchange for §24 saving the figure
 * at all -- `SavedRecords` argues the trade. Three things about the wording are
 * decisions:
 *
 * It carries **no date and no interval**. There is no date formatter in this
 * tool, `updatedAt` moves whenever any part of the meet is edited and would
 * therefore report a record as fresher than it is, and under §5.5's rule the
 * vague version is the safe one: "earlier" cannot overstate how recent the
 * figure is, and "yesterday" can.
 *
 * It says **check**, not "this may be out of date". A caveat that only doubts
 * the figure leaves the lifter holding it with nothing to do; the sentence has to
 * name the action, and the action is the same one the fold asked for in the first
 * place -- open the list.
 *
 * It does not repeat `verifyWithOfficials`, which is under the figures already
 * and is a different claim: that one is about whether the attempt qualifies under
 * the rules, and this one is about whether the number was ever right.
 */
export const RECORD_RESTORED =
  "These answers were saved with this meet earlier. Check the record against your federation's current list before you plan an attempt on it.";

export const RECORD_SUBJECT_LABEL = 'Which record are you going for';

/** A total is a record a lifter chases and is not a lift, so it is named apart. */
export function recordSubjectLabel(subject: RecordSubject): string {
  return subject === 'total' ? 'Total' : liftLabel(subject);
}

/** One tile per record this meet has, in platform order with the total last. */
export function recordSubjectChoices(subjects: readonly RecordSubject[]): readonly Choice[] {
  return subjects.map((subject) => ({ value: subject, label: recordSubjectLabel(subject) }));
}

/**
 * The one field the whole fold hangs on, asked in kilograms and labelled so.
 *
 * The unit is in the label as well as on the field, which is the one place in
 * this tool that repeats a unit. Everywhere else the figure follows the
 * session's display unit and the label can stay silent; here it does not, and a
 * lifter part-way down a pound-unit plan has no reason to expect the change. A
 * pound figure typed here is a record 3.4% lighter than the one they meant.
 */
export const RECORD_KILOGRAMS_LABEL = 'The record, in kilograms';
export const RECORD_KILOGRAMS_UNIT = 'kg';
export const RECORD_KILOGRAMS_HINT =
  'Kilograms even if the rest of your plan is in pounds. Record books are kept in kilograms and this figure is not converted.';

/**
 * The level as the book prints it, shown back and matched on by nothing.
 *
 * The hint says so outright rather than leaving it implied. A box next to a
 * record figure looks like a box the tool will look something up in, and a
 * lifter who believes that types a level and then trusts a margin nobody
 * checked against a federation's own table.
 */
export const RECORD_LEVEL_LABEL = 'What the list calls it';
export const RECORD_LEVEL_HINT =
  'State, National, whatever the heading said. Shown back to you on this screen and used for nothing else.';

/**
 * Whether the figure is a seeded standard or a lift somebody made.
 *
 * Two segments rather than one tick box, because the unticked state of a tick
 * box would be an answer nobody gave: an unclaimed record can, in some books, be
 * taken by matching it, and a screen that quietly assumed somebody holds it
 * would charge a margin the rules do not ask for. Both readings are on screen
 * and one of them is preselected, which is the honest way to show a default that
 * changes a weight.
 */
export const RECORD_HOLDER_LABEL = 'Does anybody hold it';
export const RECORD_HOLDER_HELD = 'held';
export const RECORD_HOLDER_UNCLAIMED = 'unclaimed';
export const RECORD_HOLDER_CHOICES: readonly Choice[] = [
  { value: RECORD_HOLDER_HELD, label: 'Somebody holds it' },
  { value: RECORD_HOLDER_UNCLAIMED, label: 'Nobody yet' },
];

/**
 * §19's question that no code in this repository can answer.
 *
 * Phrased as a comparison rather than as a level, because the level on its own
 * ("Is this a state record?") is a question about the record and the rule turns
 * on the pair. A national record at a national meet and a state record at a
 * state meet are the same answer here and read as opposites when the question
 * names only one of them.
 */
export const RECORD_RELATION_LABEL = "That record's level, next to this meet";
export const RECORD_RELATION_HINT =
  'A state record at a national championship is lower. Federations usually charge the full loading increment for one of those.';

export const RECORD_RELATION_CHOICES: readonly Choice[] = [
  { value: 'at-or-above-the-meet' satisfies RecordLevelRelation, label: 'Same or higher' },
  { value: 'below-the-meet' satisfies RecordLevelRelation, label: 'Lower' },
  { value: 'not-sure' satisfies RecordLevelRelation, label: 'Not sure' },
];

/**
 * Said only when the answer above is missing *and* the two conditions differ.
 *
 * The lighter figure is what the screen shows, which is the direction most
 * lifters are actually in, and this is the sentence that keeps that from being
 * silent. It names the heavier figure rather than describing it, so a lifter who
 * is at a bigger meet than their record can act on this line without answering
 * the question above it.
 */
export function recordRelationUnstatedText(heavierKilograms: number): string {
  return `Taken as the same level or higher. If that record is from a smaller meet than this one, it takes ${formatWeight({ amount: heavierKilograms, unit: 'kg' })} instead.`;
}

/**
 * The banked total, asked only for a total record.
 *
 * "So far" rather than "your other lifts", because on the platform path the
 * other lifts are half done -- the figure wanted is what is actually in the bag
 * at this moment, and a lifter mid-bench who reads the label as "squat plus
 * bench" types a bench they have not made yet.
 */
export const RECORD_TOTAL_SO_FAR_LABEL = 'Total banked so far, in kilograms';
export const RECORD_TOTAL_SO_FAR_HINT =
  'Your best lifts today, added up, not counting the one you are about to take.';

/**
 * Said where there is no rule book yet, which is a different screen from an
 * empty one and deliberately names a control that is somewhere else.
 *
 * Every margin on this screen is the federation's, so with no federation chosen
 * there is nothing to measure a record against -- not a lighter answer, none.
 * `RECORD_NEEDS_A_FIGURE` below asks for something on this screen and this asks
 * for something above it, and collapsing the two into one sentence would send a
 * lifter to fill in a box that is already full.
 */
export const RECORD_NEEDS_RULES =
  'Choose a federation in the setup above and the two routes to a record appear here.';

/** Said above an empty fold, where there is nothing yet to plan against. */
export const RECORD_NEEDS_A_FIGURE =
  "No record typed in yet. Put the figure from your federation's list in the box below and the two routes to it appear here.";

/*
 * The two routes, each under a heading naming the attempt it belongs to. Never
 * one figure on its own -- see this section's banner.
 */
export const RECORD_IN_COMPETITION_HEADING = 'On a competition attempt';
export const RECORD_FOURTH_ATTEMPT_HEADING = 'On a fourth attempt';

/**
 * What goes on the bar, and for a total record what it adds up to.
 *
 * Both figures on one line for a total, because the weight on the bar is the
 * one that gets written on the card and the total is the one that takes the
 * record -- a lifter shown only the total loads the total, and a lifter shown
 * only the bar weight cannot check the arithmetic they are trusting.
 */
export function recordRouteWeightText(route: RecordRoute): string {
  const bar = formatWeight({ amount: route.kilograms, unit: 'kg' });
  if (route.reachesTotalKilograms === null) return `${bar} on the bar.`;
  return `${bar} on the bar, for a total of ${formatWeight({ amount: route.reachesTotalKilograms, unit: 'kg' })}.`;
}

/**
 * Whether the lift is worth anything besides the record.
 *
 * §19 asks for this by name and it is the difference between the two routes
 * that is not a weight. Said on both routes rather than only on the fourth
 * attempt: "counts toward your total" under the competition heading is what
 * makes the absence of it under the other one mean something.
 */
export function recordCountsTowardTotalText(countsTowardTotal: boolean): string {
  return countsTowardTotal
    ? 'Counts toward your total, like any other attempt.'
    : 'Does not count toward your total.';
}

/**
 * Everything the federation excludes the attempt from, in the federation's own words.
 *
 * The list is passed through untranslated because it is published vocabulary --
 * "team-points" means whatever that federation's rulebook says it means, and a
 * sentence rewriting it here would be this tool inventing a rule. `null` where
 * the list is empty, so the caller renders no line rather than an empty one.
 */
export function recordExcludedFromText(excludedFrom: readonly string[]): string | null {
  if (excludedFrom.length === 0) return null;
  return `The federation lists it as excluded from: ${excludedFrom.join(', ')}.`;
}

export function recordSubmissionText(seconds: number): string {
  return `${String(seconds)} seconds to submit it.`;
}

export const RECORD_REQUIRES_PERMISSION = 'It has to be granted before you can take it.';
export const RECORD_POST_LIFT_EQUIPMENT_CHECK =
  'Your gear is checked after the lift rather than before it.';

/**
 * Why a route is closed, total over the domain's codes.
 *
 * Total rather than defaulted, the same split as `warmupProblemSentence`: a
 * default would ship the day a code was added, on the one screen where the
 * lifter's next move depends entirely on which of these it is. Two of them are
 * things they can fix in the next thirty seconds, three are facts about the day,
 * and one is the tool having nothing to go on.
 */
export function recordBlockSentence(code: RecordRouteBlockCode): string {
  switch (code) {
    case 'no-record-supplied':
      return 'No record figure to measure against.';
    case 'no-competition-attempts-left':
      return 'Every competition attempt on this lift has been taken.';
    case 'no-third-attempt-yet':
      return 'Nothing to be eligible after yet: the third attempt has not happened.';
    case 'fourth-attempt-excluded-from-the-total':
      return 'A fourth attempt does not count toward the total, so it cannot take a total record.';
    case 'total-so-far-not-supplied':
      return 'Fill in the total banked so far and this can work out what the bar needs.';
    case 'no-legal-attempt-reaches-it':
      return 'No attempt the rules allow today gets there.';
    case 'not-offered':
      return 'This federation does not have fourth attempts.';
    case 'third-attempt-not-successful':
      return 'The third attempt was not good, and this federation asks for one that was.';
    case 'outside-the-record-window':
      return 'The third attempt was further below the record than this federation allows.';
  }
}

/**
 * §19's "qualifying attempt", reported whether or not the route came back open.
 *
 * Two lifters are ineligible for opposite reasons -- one missed the third, one
 * was never close enough -- and they want opposite advice, so this is its own
 * line rather than a refusal folded into the route above it. Silent before the
 * third attempt exists: a lifter on the plan screen has not lost anything.
 */
export const RECORD_QUALIFYING_HEADING = 'The attempt before it';

export function recordQualifyingText(qualifying: QualifyingAttempt): string | null {
  if (qualifying.attempt === null) return null;
  if (qualifying.qualified) return 'Your third attempt earns the fourth.';
  const said = [...new Set(qualifying.reasons.map((reason) => recordBlockSentence(reason)))];
  return said.join(' ');
}

/*
 * §19 on the planning screen. The element renders its own `RECORD_HEADING`, so
 * the fold is labelled differently for `WARMUP_FOLD_LABEL`'s reason -- and this
 * one has a second job the warm-up's does not: it is the only thing on screen
 * while the fold is shut, so it has to say that nothing has been looked up.
 */
export const RECORD_FOLD_LABEL = 'Going for a record';
export const RECORD_FOLD_SUMMARY =
  'Type the record in and see what takes it. Nothing is looked up for you.';
