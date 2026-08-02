import type { Lift } from '@platform-toolkit/data-contracts';
import type { WeightUnit } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type { RecordPartition } from './record-scope.js';
import {
  recordCategoryFrom,
  recordFigure,
  recordSummary,
  resolveRecordStandings,
  type LiftRecordStanding,
  type RecordCategory,
} from './record-standings.js';
import { ANSWERED, BOOK, bookOf, record } from './records-fixture.js';
import {
  LIFTS,
  NO_ENTRIES,
  lifterCategoryFrom,
  setEntryUnit,
  typeLift,
  type LiftEntries,
} from './standards.js';

const NATIONAL: RecordPartition = { levelId: 'national', regionId: null };

const CATEGORY: RecordCategory = {
  levelId: 'national',
  regionId: null,
  sex: 'female',
  equipmentId: 'raw',
  disciplineId: 'full-power',
  weightClassId: 'f-56',
  divisionId: 'open',
  tested: true,
};

const FULL_POWER: readonly Lift[] = ['squat', 'bench', 'deadlift', 'total'];

/**
 * Entries as though somebody typed them, for the reason `standards.test.ts`
 * gives: a field carries both the text and the figure behind it, and a literal
 * is free to make the two disagree in a way the tool itself never can.
 */
function entriesOf(typed: Partial<Record<Lift, string>>, unit: WeightUnit = 'kg'): LiftEntries {
  let entries = setEntryUnit(NO_ENTRIES, unit);
  for (const lift of LIFTS) {
    const text = typed[lift];
    if (text !== undefined) {
      entries = typeLift(entries, lift, text);
    }
  }
  return entries;
}

function standingFor(
  typed: Partial<Record<Lift, string>>,
  lift: Lift = 'squat',
  unit: WeightUnit = 'kg',
): LiftRecordStanding {
  const standings = resolveRecordStandings(BOOK, CATEGORY, FULL_POWER, entriesOf(typed, unit));
  const found = standings.find((candidate) => candidate.lift === lift);
  if (found === undefined) {
    throw new Error(`No standing for "${lift}".`);
  }
  return found;
}

describe('recordCategoryFrom', () => {
  it('joins the lifter half and the record half', () => {
    expect(recordCategoryFrom(lifterCategoryFrom(ANSWERED), NATIONAL, 'full-power')).toEqual(
      CATEGORY,
    );
  });

  /**
   * All-or-nothing, and more sharply than the classification version: a record
   * lookup matches exactly, so a missing axis does not select a broader record.
   * It selects nothing, and the panel would report that the federation keeps no
   * record in a category it certainly does.
   */
  it('refuses an unanswered lifter', () => {
    expect(recordCategoryFrom(null, NATIONAL, 'full-power')).toBeNull();
  });

  it('refuses an unsettled partition', () => {
    expect(recordCategoryFrom(lifterCategoryFrom(ANSWERED), null, 'full-power')).toBeNull();
  });

  it('refuses an unchosen event', () => {
    expect(recordCategoryFrom(lifterCategoryFrom(ANSWERED), NATIONAL, null)).toBeNull();
  });

  /**
   * `regionId: null` is a settled answer here -- this level is not subdivided --
   * and it has to survive into the query, because that is exactly what the
   * published record's own scope carries.
   */
  it('keeps a null region as an answer rather than dropping the axis', () => {
    const category = recordCategoryFrom(lifterCategoryFrom(ANSWERED), NATIONAL, 'full-power');
    expect(category?.regionId).toBeNull();
  });
});

describe('resolveRecordStandings', () => {
  it('produces one standing per lift the event contests', () => {
    const standings = resolveRecordStandings(BOOK, CATEGORY, ['bench'], NO_ENTRIES);
    expect(standings.map((standing) => standing.lift)).toEqual(['bench']);
  });

  it('finds the record standing in the category', () => {
    expect(recordFigure(standingFor({}))).toBe('145 kg');
  });

  /**
   * The margin comes from the book. A federation that requires half a kilo and
   * one that does not disagree about whether equalling a record breaks it, and a
   * lifter told the wrong answer finds out on the platform.
   */
  it('adds the book’s required margin to the figure that replaces it', () => {
    expect(standingFor({}).kilogramsToReplace).toBe(145.5);
  });

  it('prints the target before anything has been typed', () => {
    expect(recordSummary(standingFor({}))).toBe('145.5 kg replaces it.');
  });

  it('measures what is left when the lift is short', () => {
    expect(recordSummary(standingFor({ squat: '140' }))).toBe(
      '5.5 kg more replaces it, at 145.5 kg.',
    );
  });

  /**
   * Conditional on purpose. This application does not adjudicate a lift, and "you
   * have broken this record" claims an authority it does not have -- the record
   * stands until a meet is held under the federation's own officials.
   */
  it('says a heavier lift would replace the record, never that it has', () => {
    const summary = recordSummary(standingFor({ squat: '150' }));
    expect(summary).toBe('This would replace the record, at 145.5 kg.');
    expect(summary).not.toContain('broken');
  });

  it('treats exactly the required figure as enough', () => {
    expect(standingFor({ squat: '145.5' }).standing?.wouldReplace).toBe(true);
  });

  it('treats matching the record exactly as short of it, because the book asks for more', () => {
    expect(standingFor({ squat: '145' }).standing?.wouldReplace).toBe(false);
  });

  /**
   * The whole reason `readLiftEntries` was pulled out of `standards.ts`. Both
   * panels add the three lifts up in the same place, so they cannot come to
   * disagree about a lifter's total -- one rounding a sum the other did not, in a
   * category where nothing on screen says which is which.
   */
  it('derives the total from the three lifts and says where it came from', () => {
    const summary = recordSummary(
      standingFor({ squat: '140', bench: '80', deadlift: '160' }, 'total'),
    );
    expect(summary).toBe('From your three lifts. 10.5 kg more replaces it, at 390.5 kg.');
  });

  it('writes every figure in the unit the lifter is working in', () => {
    expect(recordFigure(standingFor({}, 'squat', 'lb'))).toBe('319.7 lb');
    expect(recordSummary(standingFor({}, 'squat', 'lb'))).toBe('320.8 lb replaces it.');
  });

  /**
   * The most useful thing this panel says. A category with no record standing is
   * one where the first qualifying lift sets one, and a blank row would say the
   * opposite of that by saying nothing.
   */
  it('reports a category with no record as an opportunity', () => {
    const standing = standingFor({}, 'deadlift');
    expect(standing.record.kind).toBe('none');
    expect(recordSummary(standing)).toBe(
      'No record stands in this category. The first qualifying lift sets one.',
    );
    expect(recordFigure(standing)).toBeNull();
  });

  it('has nothing to measure against a missing record', () => {
    const standing = standingFor({ deadlift: '200' }, 'deadlift');
    expect(standing.standing).toBeNull();
    expect(standing.kilogramsToReplace).toBeNull();
  });

  it('waits for the category rather than showing a broader record', () => {
    const standings = resolveRecordStandings(BOOK, null, FULL_POWER, NO_ENTRIES);
    expect(standings.map((standing) => standing.record.kind)).toEqual([
      'unselected',
      'unselected',
      'unselected',
      'unselected',
    ]);
    expect(recordSummary(standings[0] ?? standingFor({}))).toBe(
      'Answer every question above to see the records for this category.',
    );
  });

  it('treats a partition with no published book as a category with no records', () => {
    const standings = resolveRecordStandings(null, CATEGORY, ['squat'], NO_ENTRIES);
    expect(standings[0]?.record.kind).toBe('none');
  });

  /**
   * Reported, never resolved by document order. Two records published for one
   * category cannot both be current, and showing the first is a plausible figure
   * that is wrong half the time with nothing on screen to indicate it.
   */
  it('refuses to choose between two records for one category', () => {
    const duplicated = bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 150 }),
    ]);
    const standings = resolveRecordStandings(duplicated, CATEGORY, ['squat'], NO_ENTRIES);
    expect(standings[0]?.record.kind).toBe('ambiguous');
    expect(recordSummary(standings[0] ?? standingFor({}))).toBe(
      'More than one record is published for this category, so none can be shown.',
    );
  });

  /**
   * What is wrong with the entry comes before what is missing from the data. The
   * lifter can fix the first and can only report the second.
   */
  it('says what is wrong with the entry before anything about the record', () => {
    expect(recordSummary(standingFor({ squat: '1o5' }))).toBe(
      'Enter a weight in kilograms, for example 142.5.',
    );
  });

  /**
   * A seeded record is a record. The federation founds a category with a bar to
   * clear so the first lifter has something to beat, and a lifter who clears it
   * takes it -- so the arithmetic is the arithmetic, and the only thing that
   * differs is the sentence about who holds it. Treating an unclaimed figure as
   * "no record stands here" would tell a lifter the first qualifying lift sets
   * one at any weight, which is the one wrong answer this panel could give.
   */
  it('measures against a record nobody holds exactly as against one somebody does', () => {
    const seeded = bookOf([record('squat', { kilograms: 145, unclaimed: true })]);
    const standings = resolveRecordStandings(
      seeded,
      CATEGORY,
      ['squat'],
      entriesOf({ squat: '140' }),
    );
    const standing = standings[0] ?? standingFor({});
    expect(standing.record.kind).toBe('record');
    expect(recordSummary(standing)).toBe('5.5 kg more replaces it, at 145.5 kg.');
  });

  it('matches exactly on the region rather than widening to the level', () => {
    const stateBook = bookOf([
      record('squat', { kilograms: 130, levelId: 'state', regionId: 'north-example' }),
    ]);
    const elsewhere = { ...CATEGORY, levelId: 'state', regionId: 'south-example' };
    const standings = resolveRecordStandings(stateBook, elsewhere, ['squat'], NO_ENTRIES);
    expect(standings[0]?.record.kind).toBe('none');
  });

  it('matches exactly on the event rather than widening to another', () => {
    const standings = resolveRecordStandings(
      BOOK,
      { ...CATEGORY, disciplineId: 'bench-only' },
      ['bench'],
      NO_ENTRIES,
    );
    expect(standings[0]?.record.kind).toBe('none');
  });
});
