// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Lift, RecordBook } from '@platform-toolkit/data-contracts';
import type { WeightUnit } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import {
  recordCategoryFrom,
  recordFigure,
  recordSummary,
  recordTargetLines,
  resolveRecordStandings,
  type LiftRecordStanding,
  type RecordCategory,
} from './record-standings.js';
import { ANSWERED, BOOK, bookOf, record } from './records.fixture.js';
import { NO_SELECTION } from './selection.js';
import type { CategorySelection, RecordPartition } from '../types.js';
import {
  LIFTS,
  NO_ENTRIES,
  lifterAxesFrom,
  lifterCategoryFor,
  setEntryUnit,
  typeLift,
  type LiftEntries,
  type LifterCategory,
} from './standards.js';

const NATIONAL: RecordPartition = { levelId: 'national', regionId: null, label: 'National' };

/**
 * The lifter half of a record category, assembled the way the report assembles
 * it rather than written out.
 *
 * `lifterAxesFrom` answers only the three axes every column of the report
 * shares, because the report walks the other two -- up to two weight classes and
 * up to two divisions -- and a function returning a whole category would have had
 * to pick one of each and silently drop the comparison. So a *category* only
 * exists per cell, and it is built here the same way. A literal instead would be
 * free to name a class or a division the selection above it never chose, which is
 * the one disagreement this file exists to catch.
 */
function lifterFor(
  selection: CategorySelection,
  weightClassId = 'f-56',
  divisionId = 'open',
): LifterCategory {
  const axes = lifterAxesFrom(selection);
  if (axes === null) {
    throw new Error('This fixture selection is missing an axis the report needs.');
  }
  return lifterCategoryFor(axes, weightClassId, divisionId);
}

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
    expect(recordCategoryFrom(lifterFor(ANSWERED), NATIONAL, 'full-power')).toEqual(CATEGORY);
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
    expect(recordCategoryFrom(lifterFor(ANSWERED), null, 'full-power')).toBeNull();
  });

  it('refuses an unchosen event', () => {
    expect(recordCategoryFrom(lifterFor(ANSWERED), NATIONAL, null)).toBeNull();
  });

  /**
   * The three shared axes are all-or-nothing on their own, one level up. A
   * selection with no sex category answered has no axes at all, so there is
   * nothing for the report to build a cell's category out of -- which is the
   * state the screen is in before anything is answered, and it has to be
   * representable rather than thrown over.
   */
  it('has no lifter axes at all before the shared questions are answered', () => {
    expect(lifterAxesFrom(NO_SELECTION)).toBeNull();
  });

  /**
   * `regionId: null` is a settled answer here -- this level is not subdivided --
   * and it has to survive into the query, because that is exactly what the
   * published record's own scope carries.
   */
  it('keeps a null region as an answer rather than dropping the axis', () => {
    const category = recordCategoryFrom(lifterFor(ANSWERED), NATIONAL, 'full-power');
    expect(category?.regionId).toBeNull();
  });

  /**
   * The two walked axes come from the caller and not from the selection, which is
   * requirements 2 and 8 in one assertion: the report draws a cell per weight
   * class per division, and every one of them is a different record lookup.
   */
  it('takes the class and the division it is told rather than the ones answered', () => {
    const category = recordCategoryFrom(
      lifterFor(ANSWERED, 'f-52', 'masters-1'),
      NATIONAL,
      'full-power',
    );
    expect(category?.weightClassId).toBe('f-52');
    expect(category?.divisionId).toBe('masters-1');
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
    expect(standingFor({}).targets?.recordAtOrAboveMeetLevel).toEqual({
      kilograms: 145.5,
      basis: 'chip',
    });
  });

  /**
   * The targets are present with nothing typed, because they are what the lifter
   * came to find out and they do not depend on anybody having entered a lift.
   * They are printed as their own lines rather than named in this sentence, for
   * the reason {@link recordTargetLines} gives: each holds under a condition
   * about the meet, and a bare figure in a sentence carries none of it.
   */
  it('has its targets before anything is typed, and says there is nothing to measure', () => {
    const standing = standingFor({});
    expect(standing.targets).not.toBeNull();
    expect(standing.standing).toBeNull();
    expect(recordSummary(standing)).toBe('Enter a lift to see how close you are.');
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
    expect(recordSummary(standingFor({ squat: '310' }, 'squat', 'lb'))).toBe(
      '10.8 lb more replaces it, at 320.8 lb.',
    );
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
    expect(standing.targets).toBeNull();
    expect(recordTargetLines(standing)).toEqual([]);
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
   * takes it. Treating an unclaimed figure as "no record stands here" would tell
   * a lifter the first qualifying lift sets one at any weight, which is the one
   * wrong answer this panel could give.
   *
   * What differs is the *figure*, not whether there is one: this book lets an
   * unclaimed national standard be matched exactly, so 145 takes it rather than
   * 145.5. That is the one basis where the target equals the record, and a reader
   * who assumes every target is record-plus-something loads a heavier bar than
   * the rules ask for.
   */
  it('measures against a record nobody holds, at the figure the book asks for', () => {
    const seeded = bookOf([record('squat', { kilograms: 145, unclaimed: true })]);
    const standings = resolveRecordStandings(
      seeded,
      CATEGORY,
      ['squat'],
      entriesOf({ squat: '140' }),
    );
    const standing = standings[0] ?? standingFor({});
    expect(standing.record.kind).toBe('record');
    expect(standing.targets?.recordAtOrAboveMeetLevel.basis).toBe('match');
    expect(recordSummary(standing)).toBe('5 kg more replaces it, at 145 kg.');
  });

  /**
   * The same seeded record at a level the book grants no match for. `bookOf`
   * lists national only, on purpose -- a rule that applied everywhere would let
   * the panel pass while the level check that decides it was missing entirely.
   */
  it('still requires the margin for a seeded record at a level the book excludes', () => {
    const seeded = bookOf([
      record('squat', {
        kilograms: 130,
        levelId: 'state',
        regionId: 'north-example',
        unclaimed: true,
      }),
    ]);
    const atState = { ...CATEGORY, levelId: 'state', regionId: 'north-example' };
    const standings = resolveRecordStandings(seeded, atState, ['squat'], NO_ENTRIES);
    expect(standings[0]?.targets?.recordAtOrAboveMeetLevel).toEqual({
      kilograms: 130.5,
      basis: 'chip',
    });
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

/**
 * Requirement 6, which is the requirement most easily satisfied wrongly.
 *
 * The user's instruction was to find the exact rule for when a record may be
 * chipped and when it may not, and to show both options if it can be done
 * without a wall of words. It cannot be shown as one figure: the condition is
 * about the level of the meet the lifter has entered, which this application
 * cannot see and must not guess. So the panel prints a line per condition, and
 * these tests pin the conditions rather than the wording of a sentence.
 */
describe('recordTargetLines', () => {
  it('gives a line for the record chipped and a line for the full increment', () => {
    expect(recordTargetLines(standingFor({}))).toEqual([
      {
        label: 'Chip target',
        condition: 'At a meet of this level or below',
        kilograms: 145.5,
        basis: 'Exceeds the record by 0.5 kg',
        basisId: 'chip',
      },
      {
        label: 'Full increment',
        condition: 'At a meet above this level',
        kilograms: 147.5,
        basis: 'Exceeds the record by 2.5 kg',
        basisId: 'full-increment',
      },
    ]);
  });

  /**
   * The basis is subtracted from the two figures already on screen rather than
   * described in prose. A sentence naming 2.5 kg is a second copy of arithmetic
   * that comes from the book, so a federation publishing 1 kg would be described
   * by a line saying otherwise.
   */
  it('measures the basis from the book’s own margin rather than naming one', () => {
    const wide: RecordBook = {
      ...bookOf([record('squat', { kilograms: 145 })]),
      minimumIncrementKilograms: 1,
      higherSanctionIncrementKilograms: 5,
    };
    const standings = resolveRecordStandings(wide, CATEGORY, ['squat'], NO_ENTRIES);
    expect(recordTargetLines(standings[0] ?? standingFor({})).map((line) => line.basis)).toEqual([
      'Exceeds the record by 1 kg',
      'Exceeds the record by 5 kg',
    ]);
  });

  /**
   * The label is short because it is the name on a tap target: a lifter chooses
   * one of these as their goal, and a choice whose options are each a sentence is
   * a paragraph with radio buttons in it.
   *
   * Deliberately not "next 2.5 kg loading interval". A record attempt is the
   * exemption from the loading-multiple rule, so a 200.5 kg record is taken at
   * 203 kg and not at 205 -- and a label naming a multiple would be false for
   * every record that was itself chipped, in the direction that costs a lifter
   * the record.
   */
  it('names each figure in the fewest words that stay true', () => {
    expect(recordTargetLines(standingFor({})).map((line) => line.label)).toEqual([
      'Chip target',
      'Full increment',
    ]);
  });

  /**
   * The one basis where the target equals the record. Named explicitly, because
   * "record plus the margin" is what a reader assumes of every row and assuming
   * it here means opening half a kilo above what the rules ask for.
   */
  it('says a seeded record may be matched where the book allows it', () => {
    const seeded = bookOf([record('squat', { kilograms: 145, unclaimed: true })]);
    const standings = resolveRecordStandings(seeded, CATEGORY, ['squat'], NO_ENTRIES);
    const lines = recordTargetLines(standings[0] ?? standingFor({}));
    expect(lines[0]).toEqual({
      label: 'Match target',
      condition: 'At a meet of this level or below',
      kilograms: 145,
      basis: 'Matching the opening standard takes it, as nobody holds it yet',
      basisId: 'match',
    });
  });

  /**
   * A book that draws no distinction gets one line, not one line repeated. Two
   * identical weights on screen under two conditions reads as a rule the lifter
   * has failed to understand rather than as one that does not bite here.
   */
  it('gives one line when the book publishes no higher-sanction increment', () => {
    const flat: RecordBook = {
      ...bookOf([record('squat', { kilograms: 145 })]),
      higherSanctionIncrementKilograms: null,
    };
    const standings = resolveRecordStandings(flat, CATEGORY, ['squat'], NO_ENTRIES);
    expect(recordTargetLines(standings[0] ?? standingFor({}))).toEqual([
      {
        label: 'Chip target',
        condition: 'At a meet of this level or below',
        kilograms: 145.5,
        basis: 'Exceeds the record by 0.5 kg',
        basisId: 'chip',
      },
    ]);
  });

  it('gives one line when both rules land on the same weight', () => {
    const tied: RecordBook = {
      ...bookOf([record('squat', { kilograms: 145 })]),
      minimumIncrementKilograms: 2.5,
    };
    const standings = resolveRecordStandings(tied, CATEGORY, ['squat'], NO_ENTRIES);
    const lines = recordTargetLines(standings[0] ?? standingFor({}));
    expect(lines.map((line) => line.kilograms)).toEqual([147.5]);
  });
});

/**
 * Requirement 12, on the data side.
 *
 * The link goes to the *table* the record is published in, and it comes from the
 * book's own list rather than being assembled from the axes. An assembled URL
 * would resolve and show somebody else's category, which is worse than no link
 * at all -- it is a wrong answer wearing the federation's own domain name.
 */
describe('the link back to the federation’s table', () => {
  it('carries the table the book lists for the record’s scope', () => {
    expect(standingFor({}).sourceUrl).toBe(
      'https://records.example.test/records?level=national&event=raw-full-power',
    );
  });

  it('carries no link when the book lists no table for that scope', () => {
    const stateBook = bookOf([
      record('squat', { kilograms: 130, levelId: 'state', regionId: 'north-example' }),
    ]);
    const atState = { ...CATEGORY, levelId: 'state', regionId: 'north-example' };
    const standings = resolveRecordStandings(stateBook, atState, ['squat'], NO_ENTRIES);
    expect(standings[0]?.record.kind).toBe('record');
    expect(standings[0]?.sourceUrl).toBeNull();
  });

  it('carries no link for a category with no record in it', () => {
    expect(standingFor({}, 'deadlift').sourceUrl).toBeNull();
  });
});
