// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The sentences. Every one of them, in one file.
 *
 * The domain answers in codes and never in prose (see the note on
 * `OneRepMaxAdvisory`), so this is where a code becomes something a lifter
 * reads. Keeping it here rather than inline in four components is what makes it
 * possible to check the whole vocabulary at once -- and this tool has a
 * vocabulary that has to be checked, because several of its rules are rules
 * about *wording*:
 *
 *   - The spread is never a confidence interval, a margin of error, or a
 *     probability. It is disagreement between published models (§7.5, §11).
 *   - No scenario is a "safe attempt", an "opener", a "third attempt", or a
 *     "guaranteed max" (§7.5, §14).
 *   - Nothing here says a lifter can complete a weight today (§17).
 *   - Ninety percent is not labelled a training max, and no percentage row is
 *     labelled anything at all (§9.3).
 *
 * Tone is §13: confident, concise, gym-literate. Humour is allowed in helper
 * text and empty states and nowhere near a safety notice, an invalid input, or
 * an explanation of why a number was withheld.
 */
import {
  PERCENTAGE_STEPS,
  ROUNDING_INCREMENTS,
  formatWeight,
  techniquesFor,
  type EstimateLift,
  type InputGrade,
  type OneRepMaxAdvisory,
  type OneRepMaxEstimate,
  type OneRepMaxProblemCode,
  type OutcomeReasonCode,
  type WeightUnit,
  type WithheldReasonCode,
} from '@platform-toolkit/domain';
import { type Choice } from '@platform-toolkit/ui/ptk-choice-group';

import { LIFTS, RESERVE_CHOICES, type ReserveChoice, reserveChoiceOf } from './session.js';

export function liftLabel(lift: EstimateLift): string {
  switch (lift) {
    case 'squat':
      return 'Squat';
    case 'bench-press':
      return 'Bench press';
    case 'deadlift':
      return 'Deadlift';
    case 'overhead-press':
      return 'Overhead press';
    case 'other':
      return 'Other lift';
  }
}

/** The four grade names §8.1 fixes. Never a percentage, never "confidence". */
export function gradeLabel(grade: InputGrade): string {
  switch (grade) {
    case 'strong':
      return 'Strong input';
    case 'useful':
      return 'Useful estimate';
    case 'rough':
      return 'Rough estimate';
    case 'endurance-dominated':
      return 'Endurance-dominated';
  }
}

/** The reserve question's answers, spelled exactly as §5.2 spells them. */
export function reserveLabel(choice: ReserveChoice): string {
  switch (choice) {
    case '0':
      return '0 — none; this was a max-rep set';
    case '1':
      return '1';
    case '2':
      return '2';
    case '3':
      return '3';
    case 'four-or-more':
      return '4+';
    case 'unknown':
      return 'Not sure';
  }
}

/** The same answer inside a sentence, where the long form does not fit. */
function reserveClause(choice: ReserveChoice): string {
  switch (choice) {
    case '0':
      return 'taken to failure';
    case '1':
      return 'with one rep left';
    case '2':
      return 'with two reps left';
    case '3':
      return 'with three reps left';
    case 'four-or-more':
      return 'with four or more reps left';
    case 'unknown':
      return 'with the reserve not stated';
  }
}

/**
 * The input, read back.
 *
 * §9.1 puts this immediately under the headline figure, and it is doing more
 * than decoration: it is the only place the lifter can see that the tool
 * understood the set the way they described it. A number that is wrong because
 * a stray keystroke turned three reps into thirty-three is invisible until the
 * tool says "for thirty-three reps" out loud.
 */
export function describeSet(estimate: OneRepMaxEstimate): string {
  const reps = estimate.completedReps;
  const technique = estimate.technique;
  const standard =
    technique === null || technique.match === 'unsure' ? '' : ` (${technique.label.toLowerCase()})`;
  return `Based on a ${liftLabel(estimate.lift).toLowerCase()}${standard} of ${formatWeight(estimate.entered)} for ${String(reps)} ${reps === 1 ? 'rep' : 'reps'}, ${reserveClause(reserveChoiceOf(estimate.repsInReserve))}.`;
}

/**
 * One sentence on what the set can and cannot tell anybody (§9.1 item 4).
 *
 * Keyed to the grade rather than to the repetition count, because the grade is
 * where every concern has already been collected -- a five at 2 RIR performed
 * after a hard session is a different sentence from a five at 0 RIR fresh, and
 * both are fives.
 */
export function interpretation(estimate: OneRepMaxEstimate): string {
  switch (estimate.kind) {
    case 'observed-single':
      return 'You lifted it, so no equation gets a vote. The comparison below is for interest only.';
    case 'withheld':
      return withheldSentence(estimate.reason);
    case 'estimated':
      switch (estimate.grade) {
        case 'strong':
          return 'A low-rep set stopped near failure is the best input these equations get.';
        case 'useful':
          return 'A workable estimate. The true single could sit either side of it by more than the figures suggest.';
        case 'rough':
          return 'This many reps stretches the equations. Read the figure as a direction rather than as a number.';
        case 'endurance-dominated':
          return 'Triples and fives tell us more about maximal strength than long sets do. This one mostly measured muscular endurance.';
      }
  }
}

/** Why there is no headline figure. Never funny, never vague. */
export function withheldSentence(reason: WithheldReasonCode): string {
  switch (reason) {
    case 'assisted':
      return 'A spotter took part of the bar, so this is not a set anything can be estimated from. Repeat it unassisted and enter that.';
    case 'effective-reps-too-high':
      return 'More than twenty effective repetitions. Use a heavier weight for fewer reps and enter that set instead.';
    case 'too-few-formula-families':
      return 'Fewer than three independent equations apply to this set, so there is no cluster to take the middle of. The individual results are below.';
  }
}

/**
 * What one advisory says.
 *
 * The technique advisories deliberately have no sentence here: the domain
 * already carries one on the technique option itself, written against that
 * specific standard ("The estimate describes a touch-and-go bench press, which
 * is usually above a paused competition maximum"), and a generic replacement
 * would be strictly worse. `advisorySentence` answers `null` for those three
 * and the caller reaches for the note -- see `advisoryText`.
 */
function advisorySentence(advisory: OneRepMaxAdvisory): string | null {
  switch (advisory.code) {
    case 'reps-in-reserve-low':
      return 'You stopped within a rep of failure, which is where these equations behave best.';
    case 'reps-in-reserve-moderate':
      return 'Two or three reps left means the set was submaximal, so the estimate is softer than the numbers look.';
    case 'reps-in-reserve-unknown':
      return 'You did not say how many reps were left, so the set has been read as taken to failure.';
    case 'far-from-failure':
      return 'Four or more reps left is a long way from a maximum, and how far is a guess nobody can make from here.';
    case 'technique-matches':
    case 'technique-differs':
    case 'technique-unstated':
      return null;
    case 'set-performed-fresh':
      return 'The set was performed fresh, which is the condition the equations were measured in.';
    case 'set-performed-fatigued':
      return 'The set followed significant fatigue, which suppresses a rep max without suppressing the true single.';
    case 'form-degraded':
      return 'Form degraded during the set, so the last reps were not the same lift as the first.';
    case 'new-to-maximal-effort':
      return 'Lifters new to maximal effort are systematically poor judges of how close a set came to failure. That is a fact about the input, not about the lifter.';
    case 'experienced-with-singles':
      return 'Experience with heavy singles makes a stated reserve worth more.';
    case 'lift-not-validated':
      return 'No published study validates these equations for this lift, so the grade is capped at Useful estimate.';
    case 'evidence-weighted':
      return 'Some equations count for more here, following the study that measured them against this lift for the sex you reported.';
    case 'sex-weighting-declined':
      // Says where the question is, because this note is the only place the tool
      // mentions sex outside a fold. Reported as "mentions sex, but doesn't ask
      // for it": it does ask, under "Improve this estimate", and a note about a
      // setting with no route to the setting is indistinguishable from a note
      // about something the reader cannot change.
      return 'Sex-specific weighting is off, so every eligible equation counts equally. Reported sex is one of the optional questions under "Improve this estimate"; answering it is not required.';
    case 'estimates-agree':
      return 'The equations agree closely, so the set produced a consistent estimate.';
    case 'estimates-disagree':
      return 'The equations disagree by more than five percent of the middle figure. That is disagreement between models, not a margin of error.';
    case 'repetitions-high':
      return 'The repetition count is high enough that several equations approach the point where they stop behaving.';
  }
}

/** The sentence for an advisory, with the technique note filled in where one applies. */
export function advisoryText(advisory: OneRepMaxAdvisory, estimate: OneRepMaxEstimate): string {
  const written = advisorySentence(advisory);
  if (written !== null) return written;
  return (
    estimate.technique?.note ??
    'No movement standard was stated, so the estimate describes whatever was performed.'
  );
}

/**
 * How an advisory moved the grade, as a word.
 *
 * Shown beside the sentence rather than implied by colour: §5.7's forced-colours
 * rule and §21's "colour is never an identity cue" are the same rule, and a
 * lifter reading a list of eight notes needs to know which two of them cost
 * them a grade.
 */
export function effectLabel(advisory: OneRepMaxAdvisory): string {
  switch (advisory.effect) {
    case 'raises-confidence':
      return 'Improves the grade';
    case 'lowers-confidence':
      return 'Lowers the grade';
    case 'caps-confidence':
      return 'Caps the grade';
    case 'note':
      return 'Note';
  }
}

/** Why an equation did or did not count. One short phrase, for a table cell. */
export function reasonLabel(reason: OutcomeReasonCode): string {
  switch (reason) {
    case 'included':
      return 'Counted';
    case 'declined':
      return 'Not defined for this set';
    case 'below-entered-weight':
      return 'Answered less than the weight lifted';
    case 'duplicate-family':
      return 'Same family as an equation already counted';
    case 'expanded-tier':
      return 'Expanded set: shown, not counted';
    case 'conditional-tier':
      return 'Conditional: shown, not counted';
    case 'experimental-tier':
      return 'Experimental: shown, not counted';
    case 'single-observed':
      return 'A single was observed; no equation overrules it';
    case 'outside-supported-range':
      return 'Outside its supported repetition range';
  }
}

/** One symbol in the equations, and what it stands for. */
export interface NotationTerm {
  readonly symbol: string;
  readonly meaning: string;
}

/**
 * What the letters in the equations mean.
 *
 * Twenty-two notations were printed with nothing anywhere defining a single
 * symbol in them, on the strength of `w` and `r` being obvious. They are obvious
 * to somebody who already knows which weight is meant, and that is the whole
 * question: `1RM = 7.24 + 1.05w` and `1RM = -24.62 + 1.12w + 5.09r` read like
 * regressions on a person, and a lifter reading them concluded the tool was
 * using a body weight it had never asked for. A legend is four lines and removes
 * the reading entirely.
 */
export const NOTATION_LEGEND: readonly NotationTerm[] = [
  { symbol: 'w', meaning: 'The weight you lifted — what was on the bar, not what you weigh.' },
  {
    symbol: 'r',
    meaning: 'Effective repetitions: the reps you completed plus any you said were left.',
  },
  { symbol: '5RM', meaning: 'The heaviest weight liftable for five repetitions.' },
  { symbol: 'e, ln', meaning: 'The natural exponential and the natural logarithm.' },
];

/**
 * The answer to a question the equations look like they are asking (§16).
 *
 * Stated here rather than left to the legend to imply, because "w is the weight
 * you lifted" tells a reader what this tool does and not why it declines to do
 * the other thing. The equations that take a body weight predict a maximum from
 * repetitions at one fixed test load rather than from a set at a weight the
 * lifter chose; see the header of `one-rep-max-formulas.ts`.
 */
export const BODY_WEIGHT_NOTE =
  'None of these equations uses body weight, which is why the tool never asks for it. The published equations that do take body weight predict a maximum from repetitions at one fixed test load rather than from a set at a weight you chose, so they cannot answer this question.';

/** What is wrong with the input, one sentence per problem, all of them at once. */
export function problemSentence(code: OneRepMaxProblemCode): string {
  switch (code) {
    case 'weight-not-finite':
      return 'Enter the weight using digits.';
    case 'weight-not-positive':
      return 'Enter a weight above zero.';
    case 'reps-not-whole':
      return 'Enter a whole number of repetitions.';
    case 'reps-below-range':
      return 'Enter at least one completed repetition.';
    case 'reps-above-range':
      return 'Over twenty repetitions measures endurance rather than maximal strength. Use a heavier weight for fewer reps and enter that set.';
    case 'technique-unknown':
      return 'Choose a movement standard for this lift.';
  }
}

/*
 * ---------------------------------------------------------------------------
 * The option lists.
 *
 * Here rather than in the components, for the same reason the sentences are:
 * every one of these carries wording the requirements constrain, and the whole
 * vocabulary has to be readable in one place. They are `Choice` values because
 * that is what `ptk-choice-group` takes, and building them here means no
 * component has to know that "declined" and `null` are the same answer.
 * ---------------------------------------------------------------------------
 */

/**
 * The five lifts, with two of them quieter.
 *
 * §5.1 asks for the three competition lifts to be prominent and the other two
 * to stay available but visually secondary. One group, not two: radios group by
 * `name` within a tree, so a second group would be a second radio set and a
 * lifter could hold a squat and an overhead press selected at once.
 */
export function liftChoices(): readonly Choice[] {
  return LIFTS.map((lift) => ({
    value: lift,
    label: liftLabel(lift),
    secondary: lift === 'overhead-press' || lift === 'other',
  }));
}

/** Repetitions left in the tank, in the order §5.2 fixes them. */
export function reserveChoices(): readonly Choice[] {
  return RESERVE_CHOICES.map((choice) => ({ value: choice, label: reserveLabel(choice) }));
}

/**
 * The movement standards this lift offers, most competition-like first.
 *
 * The domain's own ordering is kept. Its `note` is deliberately *not* used as a
 * description here: five tiles each carrying a sentence is a wall of text on a
 * phone, and only the chosen one's note is worth reading. The tool shows that
 * one under the group instead.
 */
export function techniqueChoices(lift: EstimateLift): readonly Choice[] {
  return techniquesFor(lift).map((option) => ({ value: option.id, label: option.label }));
}

/** Kilograms or pounds. */
export const UNIT_CHOICES: readonly Choice[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
];

export const FRESHNESS_CHOICES: readonly Choice[] = [
  { value: 'fresh', label: 'Fresh', description: 'Early in the session, warmed up.' },
  { value: 'fatigued', label: 'Fatigued', description: 'After heavy work on this lift.' },
  { value: 'unstated', label: 'Not sure' },
];

export const FORM_QUALITY_CHOICES: readonly Choice[] = [
  {
    value: 'consistent',
    label: 'Held together',
    description: 'The last rep looked like the first.',
  },
  {
    value: 'degraded',
    label: 'Broke down',
    description: 'Position or bar path changed late in the set.',
  },
  { value: 'unstated', label: 'Not sure' },
];

/**
 * Training experience, and the fourth answer that is not a fourth level.
 *
 * "I would rather not say" is a distinct answer from "intermediate", and the
 * domain keeps them distinct (`null` against `'intermediate'`) even though
 * neither moves the arithmetic -- one is a lifter placing themselves, the other
 * is a lifter declining to. Collapsing them would mean the tool could not show
 * back what was answered.
 */
export const EXPERIENCE_CHOICES: readonly Choice[] = [
  {
    value: 'new',
    label: 'New to maximal work',
    description: 'Under a year, or no heavy singles yet.',
  },
  { value: 'intermediate', label: 'Some experience' },
  {
    value: 'experienced',
    label: 'Experienced with singles',
    description: 'Regularly takes near-maximal attempts.',
  },
  { value: 'declined', label: 'Rather not say', secondary: true },
];

/**
 * The sex question, worded so that declining is plainly free.
 *
 * It is collected for one reason -- two of the studies behind the weighting
 * reported results by sex -- and it changes how much an equation counts and
 * nothing else. The estimate is produced either way, so the description says so
 * rather than leaving a lifter to work out what answering costs them.
 */
export const SEX_CHOICES: readonly Choice[] = [
  { value: 'man', label: 'Man' },
  { value: 'woman', label: 'Woman' },
  { value: 'declined', label: 'Rather not say', secondary: true },
];

export const SEX_EXPLANATION =
  'Two of the studies behind the weighting reported results separately for men and women. Answering shifts how much each equation counts; declining weights them all equally and still produces an estimate.';

/** The one thing that stops an estimate outright. */
export const ASSISTED_CHOICES: readonly Choice[] = [
  {
    value: 'assisted',
    label: 'A spotter touched the bar',
    description: 'Nothing can be estimated from an assisted set.',
  },
];

/**
 * How far apart the percentage rows sit.
 *
 * Two answers only. Five percent is the conventional table; ten halves its
 * length, which is what a phone at a rack wants. A free number would let
 * somebody build a seventeen-percent table, which is not a thing.
 */
export function percentageStepChoices(): readonly Choice[] {
  return PERCENTAGE_STEPS.map((step) => ({ value: String(step), label: `${String(step)}%` }));
}

/** The rounding steps this unit offers, labelled with the unit so the number reads. */
export function roundingChoices(unit: WeightUnit): readonly Choice[] {
  return ROUNDING_INCREMENTS[unit].map((step) => ({
    value: String(step),
    label: `${String(step)} ${unit}`,
  }));
}

/** The three scenario labels and the plain-language gloss §7.5 fixes for each. */
export const SCENARIO_NOTES = {
  conservative: 'A cautious interpretation of this set.',
  toolkit: 'The middle of the research-weighted formula cluster.',
  optimistic:
    'Plausible if you are skilled at heavy singles and the set matched your max technique.',
} as const;
