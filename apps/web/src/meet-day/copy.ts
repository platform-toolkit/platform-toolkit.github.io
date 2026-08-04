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
  MAX_WEIGHT_INPUT,
  RPE_BOUNDS,
  convertWeight,
  formatWeight,
  type AttemptEffort,
  type AttemptRefusalCode,
  type AttemptRisk,
  type AttemptStatus,
  type AttemptWeight,
  type BombOutRisk,
  type DataConfidence,
  type EvidenceAge,
  type JumpEvidence,
  type LiveAttempt,
  type LiveChoice,
  type LiveChoiceSlot,
  type LiveTarget,
  type LiveTargetKind,
  type LiveTrigger,
  type MaximumSource,
  type MeetAction,
  type MeetActionProblemCode,
  type MeetGoal,
  type MissReason,
  type PublishedPoundsReason,
  type Readiness,
  type RecordedResult,
  type ResearchComparison,
  type RefereeLight,
  type RunningTotal,
  type SubmissionStatus,
  type WeightInputProblem,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import { type Choice } from '@platform-toolkit/ui';

import type { LivePosition, NextActionCode, SubmissionUrgency, UrgentNote } from './live.js';
import type { PlanProblem } from './plan.js';
import {
  EQUIPMENT_CATEGORIES,
  PLAN_METHODS,
  type EquipmentCategory,
  type PlanMethod,
} from './session.js';

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
function listText(items: readonly string[]): string {
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
