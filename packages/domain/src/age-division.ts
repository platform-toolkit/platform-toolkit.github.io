import type { AgeBasis, AgeDivision } from '@platform-toolkit/data-contracts';

import { completedYearsBetween, type PlainDate } from './plain-date.js';

/**
 * Working out which age divisions a lifter may enter.
 *
 * Unlike weight classes, divisions are not a ladder. They overlap deliberately:
 * an Open division admits everyone, so a lifter of 45 is eligible for Open and
 * for a Masters division at the same time, and choosing between them is a
 * strategic decision the lifter makes rather than a fact to be computed. Every
 * function here therefore returns the full set, and the one that narrows it says
 * so when it cannot.
 */

/**
 * The age a lifter competes at, which is not always the age they are.
 *
 * Under `age-in-calendar-year` a lifter is treated as the age they reach at any
 * point that year, so someone born in December is already that age in March. The
 * difference decides division eligibility for a large part of the year, which is
 * why the basis is carried in the data next to the divisions it applies to rather
 * than assumed here.
 */
export function competitionAge(birthDate: PlainDate, meetDate: PlainDate, basis: AgeBasis): number {
  switch (basis) {
    case 'age-on-meet-date':
      return completedYearsBetween(birthDate, meetDate);
    case 'age-in-calendar-year': {
      const years = meetDate.year - birthDate.year;
      if (years < 0) {
        throw new RangeError('Cannot take an age in a year before the year of birth.');
      }
      return years;
    }
  }
}

/** Whether an age falls inside a division's bounds, both of which are inclusive. */
export function admitsAge(division: AgeDivision, age: number): boolean {
  if (division.minimumAge !== null && age < division.minimumAge) {
    return false;
  }
  if (division.maximumAge !== null && age > division.maximumAge) {
    return false;
  }
  return true;
}

/** Every division this age may enter, in the order the source publishes them. */
export function eligibleAgeDivisions(
  age: number,
  divisions: readonly AgeDivision[],
): readonly AgeDivision[] {
  return divisions.filter((division) => admitsAge(division, age));
}

/**
 * The narrowest division the lifter is eligible for, or `null` when there is no
 * single narrowest one.
 *
 * "Narrowest" means the division whose age range fits inside every other eligible
 * range -- Masters 1 sits inside Open, so it wins. Two divisions can overlap
 * without either containing the other, and then there is no answer to give: a
 * federation that publishes both a Submaster and a Junior division covering the
 * same age has made a genuine choice for the lifter to make, and returning one of
 * them arbitrarily would present a guess as a fact. Callers should fall back to
 * showing everything {@link eligibleAgeDivisions} returns.
 */
export function narrowestAgeDivision(
  age: number,
  divisions: readonly AgeDivision[],
): AgeDivision | null {
  const eligible = eligibleAgeDivisions(age, divisions);
  const narrowest = eligible.find((candidate) =>
    eligible.every((other) => contains(other, candidate)),
  );
  return narrowest ?? null;
}

/** Whether `inner`'s age range fits entirely inside `outer`'s. */
function contains(outer: AgeDivision, inner: AgeDivision): boolean {
  const outerMinimum = outer.minimumAge ?? Number.NEGATIVE_INFINITY;
  const innerMinimum = inner.minimumAge ?? Number.NEGATIVE_INFINITY;
  const outerMaximum = outer.maximumAge ?? Number.POSITIVE_INFINITY;
  const innerMaximum = inner.maximumAge ?? Number.POSITIVE_INFINITY;
  return innerMinimum >= outerMinimum && innerMaximum <= outerMaximum;
}

/** Why a division could not be accepted. */
export interface AgeDivisionProblem {
  readonly code: 'duplicate-id' | 'inverted-bounds';
  readonly message: string;
}

/**
 * Checks a published division set. An empty result means it is usable.
 *
 * There is no smart constructor here, unlike {@link
 * import('./weight-class.js').WeightClassLadder}, because nothing downstream
 * depends on an invariant of the set as a whole: a malformed division makes that
 * division wrong, not the eligibility question unanswerable.
 */
export function findAgeDivisionProblems(
  divisions: readonly AgeDivision[],
): readonly AgeDivisionProblem[] {
  const problems: AgeDivisionProblem[] = [];
  const seen = new Set<string>();

  for (const division of divisions) {
    if (seen.has(division.id)) {
      problems.push({
        code: 'duplicate-id',
        message: `Age division id "${division.id}" appears more than once.`,
      });
    }
    seen.add(division.id);

    if (
      division.minimumAge !== null &&
      division.maximumAge !== null &&
      division.minimumAge > division.maximumAge
    ) {
      problems.push({
        code: 'inverted-bounds',
        message: `Age division "${division.id}" has a minimum age above its maximum, so nobody is eligible.`,
      });
    }
  }

  return problems;
}
