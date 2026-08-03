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
  type EvidenceAge,
  type MaximumSource,
  type MeetGoal,
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
