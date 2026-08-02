import type { AgeDivision } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  admitsAge,
  competitionAge,
  eligibleAgeDivisions,
  findAgeDivisionProblems,
  narrowestAgeDivision,
  openAgeDivision,
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

describe('openAgeDivision', () => {
  it('finds a division with no bounds at all', () => {
    expect(openAgeDivision(DIVISIONS)).toEqual({ ok: true, division: DIVISIONS[0] });
  });

  it('finds one with a floor at the youngest age the federation competes at', () => {
    // The case that breaks the obvious test. A real published set has its open
    // division starting at 13 rather than at nothing, because the federation
    // runs no division below 13 -- so "both bounds are null" finds nothing, and
    // a report built on it shows every lifter an empty Open column.
    const floored: readonly AgeDivision[] = [
      division('junior-13-15', 13, 15),
      division('open', 13, null),
      division('master-40-44', 40, 44),
      division('master-85-plus', 85, null),
    ];

    expect(openAgeDivision(floored)).toEqual({ ok: true, division: floored[1] });
  });

  it('is not fooled by another division that is also unbounded above', () => {
    // Masters 50+ has one null bound too, so anything testing for a null
    // maximum has two answers. Reach is what separates them.
    const result = openAgeDivision([division('master-2', 50, null), division('open', null, null)]);

    expect(result.ok && result.division.id).toBe('open');
  });

  it('accepts a division that does not reach the very youngest band', () => {
    // The open division starts at 13 and the federation also runs a 10-12
    // division, which therefore sits outside it. Requiring the winner to
    // contain *every* other band would reject the answer here; reaching the
    // most of them is what the rule actually needs.
    const withChildren: readonly AgeDivision[] = [
      division('junior-10-12', 10, 12),
      division('open', 13, null),
      division('master-40-44', 40, 44),
    ];

    expect(openAgeDivision(withChildren)).toEqual({ ok: true, division: withChildren[1] });
  });

  it('returns the only division there is', () => {
    const only = division('open', null, null);
    expect(openAgeDivision([only])).toEqual({ ok: true, division: only });
  });

  it('reports ambiguity rather than picking by document order', () => {
    // Two divisions with the same reach is a question about the published data,
    // not something to resolve here. Answering it with the first one puts a
    // federation's arbitrary ordering in front of a lifter as a fact.
    expect(
      openAgeDivision([division('open', null, null), division('also-open', null, null)]),
    ).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('reports ambiguity when no division contains any other', () => {
    expect(openAgeDivision([division('junior', 19, 23), division('master', 40, 49)])).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });

  it('has no answer for an empty set', () => {
    expect(openAgeDivision([])).toEqual({ ok: false, reason: 'none' });
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
