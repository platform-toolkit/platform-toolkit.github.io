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
  convertWeight,
  formatWeight,
  type AttemptRefusalCode,
  type AttemptRisk,
  type AttemptWeight,
  type DataConfidence,
  type EvidenceAge,
  type JumpEvidence,
  type MaximumSource,
  type MeetGoal,
  type PublishedPoundsReason,
  type Readiness,
  type ResearchComparison,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import { type Choice } from '@platform-toolkit/ui';

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
