/**
 * How the set was actually performed, and what that does and does not change.
 *
 * WHY THIS IS NOT A CORRECTION FACTOR
 *
 * A touch-and-go bench is worth more than a paused one, knee wraps are worth
 * more than no wraps, and straps are worth more than a bare grip. The tempting
 * move is to multiply: subtract five percent for touch-and-go, add eight for
 * wraps, and hand back a "competition equivalent" number. Nobody has a
 * defensible coefficient for any of those, they vary more between two lifters
 * than between two variations, and a lifter who sees a single figure has no way
 * to know a guess was folded into it.
 *
 * So technique never moves the number. It moves the *confidence* and it changes
 * the *sentence*: an estimate from a touch-and-go set is an estimate of a
 * touch-and-go maximum, said plainly, and the lifter does the translating with
 * knowledge of their own bench that this tool does not have.
 *
 * `match` IS ABOUT COMPETITION, NOT ABOUT QUALITY
 *
 * `differs` does not mean the set was bad. A sumo deadlift and a conventional
 * deadlift are both competition lifts and both `matches`; a deficit deadlift is
 * a fine exercise and is `differs`, because the number it produces is not the
 * number a lifter would open with.
 */
import type { EstimateLift } from './one-rep-max-formulas.js';

/** Whether the estimate describes a competition lift, another lift, or an unstated one. */
export type TechniqueMatch = 'matches' | 'differs' | 'unsure';

export interface TechniqueOption {
  readonly id: string;
  readonly label: string;
  readonly match: TechniqueMatch;
  /**
   * What the estimate is actually an estimate *of*.
   *
   * Catalogue text, in the same sense as a formula's citation: fixed, tied to
   * the entry, and not a computed message. The advisory codes in
   * `one-rep-max.ts` are the computed ones, and those stay codes.
   */
  readonly note: string;
}

const SQUAT: readonly TechniqueOption[] = [
  {
    id: 'competition-squat',
    label: 'Competition depth, no wraps',
    match: 'matches',
    note: 'The estimate describes a competition squat.',
  },
  {
    id: 'above-depth',
    label: 'Above competition depth',
    match: 'differs',
    note: 'The estimate describes a squat to the depth performed, which a referee would not pass.',
  },
  {
    id: 'knee-wraps',
    label: 'With knee wraps',
    match: 'differs',
    note: 'The estimate describes a wrapped squat. A raw maximum will be lower by an amount this tool cannot predict.',
  },
  {
    id: 'paused-or-tempo',
    label: 'Paused or slow tempo',
    match: 'differs',
    note: 'The estimate describes a paused or tempo squat, which is usually below a competition maximum.',
  },
  {
    id: 'squat-unstated',
    label: 'Not sure',
    match: 'unsure',
    note: 'The estimate describes whatever squat was performed.',
  },
];

const BENCH_PRESS: readonly TechniqueOption[] = [
  {
    id: 'competition-bench',
    label: 'Competition pause, legal grip',
    match: 'matches',
    note: 'The estimate describes a competition bench press.',
  },
  {
    id: 'touch-and-go',
    label: 'Touch and go',
    match: 'differs',
    note: 'The estimate describes a touch-and-go bench press, which is usually above a paused competition maximum.',
  },
  {
    id: 'close-grip',
    label: 'Close grip',
    match: 'differs',
    note: 'The estimate describes a close-grip bench press, not a competition-grip one.',
  },
  {
    id: 'feet-up-or-larsen',
    label: 'Feet up or Larsen',
    match: 'differs',
    note: 'The estimate describes a bench press without leg drive, which is usually below a competition maximum.',
  },
  {
    id: 'bench-unstated',
    label: 'Not sure',
    match: 'unsure',
    note: 'The estimate describes whatever bench press was performed.',
  },
];

const DEADLIFT: readonly TechniqueOption[] = [
  {
    id: 'conventional',
    label: 'Conventional, no straps',
    match: 'matches',
    note: 'The estimate describes a competition deadlift.',
  },
  {
    id: 'sumo',
    label: 'Sumo, no straps',
    match: 'matches',
    // Both stances are legal, so neither is the "real" one. The note says so,
    // because a lifter who pulls sumo has been told otherwise on the internet.
    note: 'The estimate describes a competition deadlift. Both stances are legal.',
  },
  {
    id: 'straps',
    label: 'With straps',
    match: 'differs',
    note: 'The estimate describes a strapped deadlift. Straps are not permitted in competition and a bare grip usually holds less.',
  },
  {
    id: 'deficit-or-blocks',
    label: 'Deficit or blocks',
    match: 'differs',
    note: 'The estimate describes a deadlift from the height used, not from the floor.',
  },
  {
    id: 'deadlift-unstated',
    label: 'Not sure',
    match: 'unsure',
    note: 'The estimate describes whatever deadlift was performed.',
  },
];

const OVERHEAD_PRESS: readonly TechniqueOption[] = [
  {
    id: 'strict-press',
    label: 'Strict press',
    match: 'matches',
    note: 'The estimate describes a strict overhead press.',
  },
  {
    id: 'push-press',
    label: 'Push press',
    match: 'differs',
    // Named in the requirements as the case to state outright: the leg drive is
    // not a small adjustment to a strict press, it is a different movement.
    note: 'The estimate describes a push press. A push-press set cannot reliably estimate a strict-press maximum.',
  },
  {
    id: 'seated-press',
    label: 'Seated press',
    match: 'differs',
    note: 'The estimate describes a seated press, not a standing one.',
  },
  {
    id: 'press-unstated',
    label: 'Not sure',
    match: 'unsure',
    note: 'The estimate describes whatever press was performed.',
  },
];

/**
 * The technique choices for a lift, most competition-like first.
 *
 * Empty for `other`, and the interface hides the control rather than showing one
 * option: asking somebody which variation of an unnamed lift they did is a
 * question with no answer, and a lone "Not sure" entry is a control that exists
 * only to be ignored. An `other` estimate is already capped by the grading
 * rules, so nothing is lost by not asking.
 */
export function techniquesFor(lift: EstimateLift): readonly TechniqueOption[] {
  switch (lift) {
    case 'squat':
      return SQUAT;
    case 'bench-press':
      return BENCH_PRESS;
    case 'deadlift':
      return DEADLIFT;
    case 'overhead-press':
      return OVERHEAD_PRESS;
    case 'other':
      return [];
  }
}

/** The choice a lift starts on: the competition version, where there is one. */
export function defaultTechniqueFor(lift: EstimateLift): TechniqueOption | null {
  return techniquesFor(lift)[0] ?? null;
}

/**
 * One technique by identifier, or `null`.
 *
 * Scoped to a lift because the identifiers are only unique within one -- and
 * because a stored `touch-and-go` arriving against a squat is a mismatch worth
 * answering with `null` rather than silently honouring.
 */
export function findTechnique(lift: EstimateLift, id: string): TechniqueOption | null {
  return techniquesFor(lift).find((option) => option.id === id) ?? null;
}
