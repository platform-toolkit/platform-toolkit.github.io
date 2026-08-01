import type { AgeDivision } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  admitsAge,
  competitionAge,
  eligibleAgeDivisions,
  findAgeDivisionProblems,
  narrowestAgeDivision,
} from './age-division.js';
import type { PlainDate } from './plain-date.js';

function division(id: string, minimumAge: number | null, maximumAge: number | null): AgeDivision {
  return { id, label: id, minimumAge, maximumAge };
}

function date(year: number, month: number, day: number): PlainDate {
  return { year, month, day };
}

/**
 * A shape typical of published division sets: an open division that admits
 * everyone, bounded youth divisions, and unbounded masters at the top. The
 * numbers are invented -- the rules are what is under test.
 */
const DIVISIONS: readonly AgeDivision[] = [
  division('open', null, null),
  division('junior', 19, 23),
  division('master-1', 40, 49),
  division('master-2', 50, null),
];

describe('competitionAge', () => {
  const birth = date(1984, 11, 20);

  it('uses completed years when the basis is the meet date', () => {
    expect(competitionAge(birth, date(2024, 3, 9), 'age-on-meet-date')).toBe(39);
    expect(competitionAge(birth, date(2024, 11, 20), 'age-on-meet-date')).toBe(40);
  });

  it('uses the year difference when the basis is the calendar year', () => {
    // The same lifter at the same March meet, one basis apart. Under this basis
    // they are already 40 in March, which is the whole reason the basis travels
    // with the data instead of being assumed.
    expect(competitionAge(birth, date(2024, 3, 9), 'age-in-calendar-year')).toBe(40);
  });

  it('agrees with itself after the birthday has passed', () => {
    const late = date(2024, 12, 1);
    expect(competitionAge(birth, late, 'age-on-meet-date')).toBe(
      competitionAge(birth, late, 'age-in-calendar-year'),
    );
  });

  it('refuses a meet that precedes the birth on either basis', () => {
    expect(() => competitionAge(birth, date(1980, 1, 1), 'age-on-meet-date')).toThrow(RangeError);
    expect(() => competitionAge(birth, date(1980, 1, 1), 'age-in-calendar-year')).toThrow(
      RangeError,
    );
  });
});

describe('admitsAge', () => {
  it('treats both bounds as inclusive', () => {
    const junior = division('junior', 19, 23);
    expect(admitsAge(junior, 18)).toBe(false);
    expect(admitsAge(junior, 19)).toBe(true);
    expect(admitsAge(junior, 23)).toBe(true);
    expect(admitsAge(junior, 24)).toBe(false);
  });

  it('treats a null bound as no bound', () => {
    expect(admitsAge(division('open', null, null), 0)).toBe(true);
    expect(admitsAge(division('open', null, null), 120)).toBe(true);
    expect(admitsAge(division('master-2', 50, null), 90)).toBe(true);
    expect(admitsAge(division('master-2', 50, null), 49)).toBe(false);
  });
});

describe('eligibleAgeDivisions', () => {
  it('returns every division a lifter may enter, not just one', () => {
    // Divisions overlap by design. A lifter of 45 has a real choice here, and
    // collapsing it to a single answer would make the choice for them.
    expect(eligibleAgeDivisions(45, DIVISIONS).map((d) => d.id)).toEqual(['open', 'master-1']);
  });

  it('preserves the order the source publishes', () => {
    expect(eligibleAgeDivisions(21, DIVISIONS).map((d) => d.id)).toEqual(['open', 'junior']);
  });

  it('returns the open division alone for an age in no other', () => {
    expect(eligibleAgeDivisions(30, DIVISIONS).map((d) => d.id)).toEqual(['open']);
  });
});

describe('narrowestAgeDivision', () => {
  it('prefers a bounded division over the open division that contains it', () => {
    expect(narrowestAgeDivision(45, DIVISIONS)?.id).toBe('master-1');
  });

  it('prefers an unbounded masters division over open, because it starts later', () => {
    expect(narrowestAgeDivision(60, DIVISIONS)?.id).toBe('master-2');
  });

  it('returns the only eligible division when there is one', () => {
    expect(narrowestAgeDivision(30, DIVISIONS)?.id).toBe('open');
  });

  it('declines to choose between divisions that overlap without nesting', () => {
    // A submaster division that starts inside the junior range is a genuine
    // choice for the lifter. Returning either one would present a guess as a
    // fact, so the caller has to fall back to showing both.
    const overlapping: readonly AgeDivision[] = [
      division('junior', 19, 23),
      division('submaster', 22, 39),
    ];
    expect(narrowestAgeDivision(22, overlapping)).toBeNull();
  });

  it('returns null when no division admits the age', () => {
    expect(narrowestAgeDivision(15, [division('junior', 19, 23)])).toBeNull();
  });
});

describe('findAgeDivisionProblems', () => {
  it('passes a well-formed set', () => {
    expect(findAgeDivisionProblems(DIVISIONS)).toEqual([]);
  });

  it('reports a duplicate identifier', () => {
    const problems = findAgeDivisionProblems([
      division('open', null, null),
      division('open', 1, 2),
    ]);
    expect(problems.map((problem) => problem.code)).toEqual(['duplicate-id']);
  });

  it('reports a division nobody can enter', () => {
    // Inverted bounds are silently empty otherwise: the division renders, admits
    // no one, and looks like the lifter is simply not eligible.
    const problems = findAgeDivisionProblems([division('backwards', 50, 40)]);
    expect(problems.map((problem) => problem.code)).toEqual(['inverted-bounds']);
  });

  it('accepts a division whose bounds are equal, which is a single-age division', () => {
    expect(findAgeDivisionProblems([division('exactly-40', 40, 40)])).toEqual([]);
  });
});
