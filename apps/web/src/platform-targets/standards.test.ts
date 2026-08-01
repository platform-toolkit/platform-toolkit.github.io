import type {
  ClassificationBook,
  ClassificationTable,
  Lift,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { NO_SELECTION, type CategorySelection } from './selection.js';
import {
  NO_ENTRIES,
  formatKilograms,
  lifterCategoryFrom,
  resolveStandards,
  standingSummary,
  type LifterCategory,
  type LiftStanding,
} from './standards.js';

/**
 * Invented figures throughout. Real classification standards belong in published
 * data, where a stale one can be refreshed without a release -- and a test that
 * pinned real ones would have to be edited the day a federation revised them.
 */
function table(
  lift: Lift,
  overrides: Partial<ClassificationTable['scope']> = {},
  standards: ClassificationTable['standards'] = [
    { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 100 },
    { id: 'second', label: 'Class II', rank: 1, requiredKilograms: 120 },
    { id: 'first', label: 'Class I', rank: 2, requiredKilograms: 150 },
  ],
): ClassificationTable {
  return {
    id: `example-${lift}-${JSON.stringify(overrides)}`,
    label: `Example ${lift}`,
    scope: {
      sex: 'female',
      lift,
      equipmentId: 'raw',
      weightClassId: null,
      divisionId: null,
      tested: null,
      ...overrides,
    },
    standards,
  };
}

const BOOK: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [table('squat'), table('bench'), table('deadlift'), table('total')],
};

const CATEGORY: LifterCategory = {
  sex: 'female',
  equipmentId: 'raw',
  weightClassId: 'f-56',
  divisionId: 'open',
  tested: true,
};

const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  division: 'open',
  tested: 'tested',
};

function standing(standings: readonly LiftStanding[], lift: Lift): LiftStanding {
  const found = standings.find((candidate) => candidate.lift === lift);
  if (found === undefined) {
    throw new Error(`No standing for "${lift}".`);
  }
  return found;
}

describe('lifterCategoryFrom', () => {
  it('narrows a complete selection', () => {
    expect(lifterCategoryFrom(ANSWERED)).toEqual(CATEGORY);
  });

  it.each(['sex', 'equipment', 'weightClass', 'division', 'tested'] as const)(
    'refuses a selection missing its %s',
    (field) => {
      // All or nothing on purpose. Every axis narrows which table applies, so a
      // partial category would select the general table and present it as the
      // lifter's -- and nothing on the screen would look unfinished.
      expect(lifterCategoryFrom({ ...ANSWERED, [field]: null })).toBeNull();
    },
  );

  it('refuses a sex category the contract does not admit', () => {
    // The value arrives as a string from a radio. Casting it would compile and
    // then select a table for a category no catalogue ever offered.
    expect(lifterCategoryFrom({ ...ANSWERED, sex: 'Female' })).toBeNull();
  });

  it('carries the drug-tested answer through as a boolean', () => {
    expect(lifterCategoryFrom({ ...ANSWERED, tested: 'untested' })?.tested).toBe(false);
  });
});

describe('resolveStandards', () => {
  it('reads every lift, in platform order', () => {
    const standings = resolveStandards(BOOK, CATEGORY, NO_ENTRIES);
    expect(standings.map((entry) => entry.lift)).toEqual(['squat', 'bench', 'deadlift', 'total']);
  });

  it('places a typed weight in the ladder', () => {
    const standings = resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, squat: '130' });
    const squat = standing(standings, 'squat');

    expect(squat.classification?.achieved?.label).toBe('Class II');
    expect(squat.classification?.next?.label).toBe('Class I');
    expect(squat.classification?.kilogramsToNext).toBe(20);
  });

  it('treats a standard as a floor, not as a target to approach', () => {
    // Exactly the required weight earns it; a hundredth under does not. The
    // whole reason `>=` is used in the domain, asserted here because this is the
    // layer a lifter reads.
    const at = resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, squat: '120' });
    expect(standing(at, 'squat').classification?.achieved?.label).toBe('Class II');

    const under = resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, squat: '119.99' });
    expect(standing(under, 'squat').classification?.achieved?.label).toBe('Class III');
  });

  it('reads each lift against its own table', () => {
    // A squat read against a total ladder is the failure the scope's non-nullable
    // `lift` exists to prevent, and it produces a completely plausible screen.
    const book: ClassificationBook = {
      ...BOOK,
      tables: [
        table('squat'),
        table('total', {}, [{ id: 'elite', label: 'Elite', rank: 0, requiredKilograms: 400 }]),
      ],
    };
    const standings = resolveStandards(book, CATEGORY, {
      ...NO_ENTRIES,
      squat: '150',
      total: '150',
    });

    expect(standing(standings, 'squat').classification?.achieved?.label).toBe('Class I');
    expect(standing(standings, 'total').classification?.achieved).toBeNull();
  });

  it('prefers the more specific of two matching tables', () => {
    const book: ClassificationBook = {
      ...BOOK,
      tables: [
        table('squat'),
        table('squat', { divisionId: 'open' }, [
          { id: 'override', label: 'Open Elite', rank: 0, requiredKilograms: 90 },
        ]),
      ],
    };
    const standings = resolveStandards(book, CATEGORY, { ...NO_ENTRIES, squat: '95' });

    expect(standing(standings, 'squat').classification?.achieved?.label).toBe('Open Elite');
  });

  it('reports two equally specific tables rather than picking one', () => {
    const book: ClassificationBook = {
      ...BOOK,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const standings = resolveStandards(book, CATEGORY, NO_ENTRIES);

    expect(standing(standings, 'squat').standards.kind).toBe('ambiguous');
    expect(standing(standings, 'squat').classification).toBeNull();
  });

  it('reports a table whose ranks disagree with its weights', () => {
    // A schema cannot catch this: every field is well formed and the table is
    // simply wrong. Sorting it into a plausible order would tell a lifter they
    // had earned a title they had not.
    const book: ClassificationBook = {
      ...BOOK,
      tables: [
        table('squat', {}, [
          { id: 'lower', label: 'Class III', rank: 0, requiredKilograms: 150 },
          { id: 'higher', label: 'Class II', rank: 1, requiredKilograms: 120 },
        ]),
      ],
    };
    const squat = standing(resolveStandards(book, CATEGORY, NO_ENTRIES), 'squat');

    expect(squat.standards.kind).toBe('unreadable');
    if (squat.standards.kind !== 'unreadable') throw new Error('narrowing');
    expect(squat.standards.problems.map((problem) => problem.code)).toContain(
      'rank-disagrees-with-total',
    );
  });

  it('says nothing is published rather than failing when a lift has no table', () => {
    // Real today: the published catalogue offers three divisions that the
    // standards do not cover at all.
    const book: ClassificationBook = { ...BOOK, tables: [table('squat')] };
    const standings = resolveStandards(book, CATEGORY, NO_ENTRIES);

    expect(standing(standings, 'squat').standards.kind).toBe('ladder');
    expect(standing(standings, 'bench').standards.kind).toBe('none');
  });

  it('distinguishes an unanswered category from an unpublished one', () => {
    // Two different sentences on the screen. Collapsing them would tell a lifter
    // their federation publishes nothing when they simply have not finished
    // answering.
    expect(standing(resolveStandards(BOOK, null, NO_ENTRIES), 'squat').standards.kind).toBe(
      'unselected',
    );
    expect(standing(resolveStandards(null, CATEGORY, NO_ENTRIES), 'squat').standards.kind).toBe(
      'none',
    );
  });

  it('leaves an empty field alone', () => {
    // An unanswered field is a normal state of this screen, not an error. Marking
    // it the moment the page loads is the easiest way to make a tool feel broken.
    const squat = standing(resolveStandards(BOOK, CATEGORY, NO_ENTRIES), 'squat');
    expect(squat.entry).toEqual({ kind: 'empty' });
    expect(squat.classification).toBeNull();
  });

  it.each([
    ['1o5', 'Enter a weight in kilograms, for example 142.5.'],
    ['-100', 'Enter a weight in kilograms, for example 142.5.'],
    ['1e3', 'Enter a weight in kilograms, for example 142.5.'],
    ['0', 'Enter a weight above zero.'],
    ['0.0', 'Enter a weight above zero.'],
  ])('rejects %s without quoting it back', (typed, message) => {
    const squat = standing(
      resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, squat: typed }),
      'squat',
    );

    expect(squat.entry).toEqual({ kind: 'invalid', message });
    // The domain's own reason quotes the input, which belongs in a CI log rather
    // than under a field where the input is already visible.
    expect(message).not.toContain(typed);
  });

  it('accepts a weight with surrounding whitespace', () => {
    const squat = standing(
      resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, squat: ' 130 ' }),
      'squat',
    );
    expect(squat.entry).toEqual({ kind: 'weight', kilograms: 130, derived: false });
  });

  it('adds up the total when all three lifts are entered and it is not', () => {
    // The arithmetic a lifter would otherwise do on a phone between attempts.
    const standings = resolveStandards(BOOK, CATEGORY, {
      ...NO_ENTRIES,
      squat: '62.5',
      bench: '42.5',
      deadlift: '145',
    });

    expect(standing(standings, 'total').entry).toEqual({
      kind: 'weight',
      kilograms: 250,
      derived: true,
    });
  });

  it('does not let floating point show through the derived total', () => {
    // 100 + 40.1 + 128.2 sums to 268.29999999999995 in binary floating point,
    // and a total displayed like that is a bug report. Asserted on the number
    // rather than the formatted string, because the value is what a later
    // comparison against a record uses.
    const standings = resolveStandards(BOOK, CATEGORY, {
      ...NO_ENTRIES,
      squat: '100',
      bench: '40.1',
      deadlift: '128.2',
    });
    expect(100 + 40.1 + 128.2).not.toBe(268.3);
    expect(standing(standings, 'total').entry).toEqual({
      kind: 'weight',
      kilograms: 268.3,
      derived: true,
    });
  });

  it('leaves a typed total alone', () => {
    // A lifter entering a total directly is saying something the three fields
    // cannot: their best total came from a different day.
    const standings = resolveStandards(BOOK, CATEGORY, {
      squat: '60',
      bench: '40',
      deadlift: '140',
      total: '260',
    });

    expect(standing(standings, 'total').entry).toEqual({
      kind: 'weight',
      kilograms: 260,
      derived: false,
    });
  });

  it('does not add up a partial set of lifts', () => {
    const standings = resolveStandards(BOOK, CATEGORY, {
      ...NO_ENTRIES,
      squat: '60',
      bench: '40',
    });
    expect(standing(standings, 'total').entry).toEqual({ kind: 'empty' });
  });

  it('does not add up around a lift that will not parse', () => {
    // Otherwise a mistyped bench press silently becomes a total two hundred
    // kilograms light, presented with the same confidence as a correct one.
    const standings = resolveStandards(BOOK, CATEGORY, {
      ...NO_ENTRIES,
      squat: '60',
      bench: '4o',
      deadlift: '140',
    });
    expect(standing(standings, 'total').entry).toEqual({ kind: 'empty' });
  });
});

describe('standingSummary', () => {
  function summaryFor(entries: Partial<Record<Lift, string>>, lift: Lift = 'squat'): string {
    return standingSummary(
      standing(resolveStandards(BOOK, CATEGORY, { ...NO_ENTRIES, ...entries }), lift),
    );
  }

  it('names the range of the ladder before anything is entered', () => {
    expect(summaryFor({})).toBe('Class III at 100 kg, up to Class I at 150 kg.');
  });

  it('names the standard reached and the work left to the next one', () => {
    expect(summaryFor({ squat: '130' })).toBe('Class II. 20 kg to Class I.');
  });

  it('says plainly when the weight is below the first standard', () => {
    expect(summaryFor({ squat: '80' })).toBe(
      'Below the first published standard. 20 kg to Class III.',
    );
  });

  it('says there is nothing above the top standard', () => {
    expect(summaryFor({ squat: '200' })).toBe('Class I. This is the highest published standard.');
  });

  it('rounds the work left up, never down', () => {
    // Directional rounding is a safety property: a lifter told they need 2.49 kg
    // who adds exactly that has not reached the standard.
    expect(summaryFor({ squat: '117.505' })).toBe('Class III. 2.5 kg to Class II.');
  });

  it('says when the total was added up rather than typed', () => {
    const summary = summaryFor({ squat: '50', bench: '40', deadlift: '45' }, 'total');
    expect(summary).toBe('From your three lifts. Class II. 15 kg to Class I.');
  });

  it('leads with what the lifter can fix', () => {
    // The entry message beats anything about the data: one of them they can act
    // on and the other they can only report.
    expect(summaryFor({ squat: '1o5' })).toBe('Enter a weight in kilograms, for example 142.5.');
  });

  it.each([
    [null as ClassificationBook | null, CATEGORY, 'publishes no standards'],
    [BOOK, null as LifterCategory | null, 'Answer every question above'],
  ])('explains why there is nothing to show', (book, category, expected) => {
    const summary = standingSummary(
      standing(resolveStandards(book, category, NO_ENTRIES), 'squat'),
    );
    expect(summary).toContain(expected);
  });

  it('explains an ambiguous category without picking a table', () => {
    const book: ClassificationBook = {
      ...BOOK,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const summary = standingSummary(
      standing(resolveStandards(book, CATEGORY, NO_ENTRIES), 'squat'),
    );
    expect(summary).toContain('More than one set of standards');
  });

  it('explains an unreadable table without showing a maintainer message to a lifter', () => {
    const book: ClassificationBook = {
      ...BOOK,
      tables: [
        table('squat', {}, [
          { id: 'lower', label: 'Class III', rank: 0, requiredKilograms: 150 },
          { id: 'higher', label: 'Class II', rank: 1, requiredKilograms: 120 },
        ]),
      ],
    };
    const summary = standingSummary(
      standing(resolveStandards(book, CATEGORY, NO_ENTRIES), 'squat'),
    );

    expect(summary).toBe('The published standards for this category could not be read.');
    // The problem text names ids and is addressed to whoever maintains the feed.
    expect(summary).not.toContain('rank');
  });

  it('says nothing is selected before the category is answered', () => {
    const summary = standingSummary(
      standing(resolveStandards(BOOK, lifterCategoryFrom(NO_SELECTION), NO_ENTRIES), 'squat'),
    );
    expect(summary).toContain('Answer every question above');
  });
});

describe('formatKilograms', () => {
  it.each([
    [142.5, '142.5'],
    [100, '100'],
    [2.5, '2.5'],
    [0.01, '0.01'],
    [250.00000000000003, '250'],
  ])('writes %s the way a person would', (value, expected) => {
    expect(formatKilograms(value)).toBe(expected);
  });
});
