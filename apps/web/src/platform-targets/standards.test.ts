import type {
  ClassificationBook,
  ClassificationTable,
  Lift,
} from '@platform-toolkit/data-contracts';
import type { ClassificationLadder, WeightUnit } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type { CategorySelection } from './selection.js';
import {
  LIFTS,
  NO_ENTRIES,
  formatAsUnit,
  formatKilograms,
  lifterAxesFrom,
  lifterCategoryFor,
  readLiftEntries,
  resolveStandards,
  setEntryUnit,
  typeLift,
  type LiftEntries,
  type LiftEntry,
  type LifterAxes,
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

/** The three axes every column of a report shares. */
const AXES: LifterAxes = { sex: 'female', equipmentId: 'raw', tested: true };

/** One cell of it: the shared axes plus the two the report walks. */
const CATEGORY: LifterCategory = lifterCategoryFor(AXES, 'f-56', 'open');

/**
 * A lifter who has answered everything the shared axes need.
 *
 * `division` is `null`, which is the ordinary state rather than an omission: the
 * report always covers Open and the picker offers only the Masters and Juniors
 * bands, so most selections never carry one.
 */
const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  comparisonWeightClass: null,
  division: null,
  tested: 'tested',
  region: null,
};

/**
 * Entries as though somebody typed them, rather than assembled as a literal.
 *
 * Routed through `typeLift` on purpose. A field carries both the text and the
 * figure behind it, and a hand-written literal is free to make the two disagree --
 * which is the one state the tool itself can never produce, and so the one no test
 * should be pinning behaviour against.
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

function standing(standings: readonly LiftStanding[], lift: Lift): LiftStanding {
  const found = standings.find((candidate) => candidate.lift === lift);
  if (found === undefined) {
    throw new Error(`No standing for "${lift}".`);
  }
  return found;
}

/** The one entry a test is about, read straight out of a set of typed fields. */
function entryFor(
  typed: Partial<Record<Lift, string>>,
  lift: Lift = 'squat',
  unit: WeightUnit = 'kg',
): LiftEntry {
  return readLiftEntries(entriesOf(typed, unit))[lift];
}

/** The ladder a standing resolved to, or a failure naming which kind arrived instead. */
function ladderOf(found: LiftStanding): ClassificationLadder {
  if (found.standards.kind !== 'ladder') {
    throw new Error(`Expected a ladder for "${found.lift}", got "${found.standards.kind}".`);
  }
  return found.standards.ladder;
}

describe('lifterAxesFrom', () => {
  it('narrows the three axes every column of the report shares', () => {
    expect(lifterAxesFrom(ANSWERED)).toEqual(AXES);
  });

  it.each(['sex', 'equipment', 'tested'] as const)(
    'refuses a selection missing its %s',
    (field) => {
      // All or nothing on purpose. Every one of these narrows which table
      // applies, so a partial category would select the general table and
      // present it as the lifter's -- and nothing on screen would look
      // unfinished.
      expect(lifterAxesFrom({ ...ANSWERED, [field]: null })).toBeNull();
    },
  );

  it('does not wait for the two answers that vary within one report', () => {
    // The weight class and the division are per-column, not per-report: the
    // screen shows up to two of each side by side. A version of this that
    // returned a whole category would have had to pick the *first* of them,
    // producing one correct column and silently dropping the comparison the
    // lifter asked for.
    expect(lifterAxesFrom({ ...ANSWERED, weightClass: null, division: null })).toEqual(AXES);
  });

  it('refuses a sex category the contract does not admit', () => {
    // The value arrives as a string from a radio. Casting it would compile and
    // then select a table for a category no catalogue ever offered.
    expect(lifterAxesFrom({ ...ANSWERED, sex: 'Female' })).toBeNull();
  });

  it('carries the drug-tested answer through as a boolean', () => {
    expect(lifterAxesFrom({ ...ANSWERED, tested: 'untested' })?.tested).toBe(false);
  });
});

describe('lifterCategoryFor', () => {
  it('adds the two axes the report walks to the ones it shares', () => {
    expect(lifterCategoryFor(AXES, 'f-52', 'masters-1')).toEqual({
      sex: 'female',
      equipmentId: 'raw',
      tested: true,
      weightClassId: 'f-52',
      divisionId: 'masters-1',
    });
  });

  it('is total, because both identifiers came from lists already filtered', () => {
    // No nullable return and no validation. The resolver drops anything the
    // catalogue does not offer before either of these reaches here, so a second
    // check would be a branch no caller can take and no test can cover.
    expect(lifterCategoryFor(AXES, 'f-56', 'open')).toEqual(CATEGORY);
  });
});

describe('typeLift', () => {
  it('records the figure in the unit the panel is currently in', () => {
    const pounds = typeLift(setEntryUnit(NO_ENTRIES, 'lb'), 'squat', '315');
    expect(pounds.fields.squat.weight?.origin).toEqual({ amount: 315, unit: 'lb' });
    // Kept as typed, not normalised. Rewriting the text under the caret is how a
    // field fights someone halfway through correcting a number.
    expect(pounds.fields.squat.text).toBe('315');
  });

  it('honours a unit written into the field over the unit of the field', () => {
    // A coach messages "183.7 kg" and it is pasted into a panel set to pounds.
    // Reading it as 183.7 lb because of where the radio sits discards the one
    // thing in the string that settles the question.
    const entries = typeLift(setEntryUnit(NO_ENTRIES, 'lb'), 'squat', '183.7 kg');
    expect(entries.fields.squat.weight?.origin).toEqual({ amount: 183.7, unit: 'kg' });
  });

  it('leaves nothing behind the text when it does not read as a weight', () => {
    const entries = typeLift(NO_ENTRIES, 'squat', '1o5');
    expect(entries.fields.squat).toEqual({ text: '1o5', weight: null });
  });

  it('treats zero as nothing to place rather than as a weight', () => {
    // Every standard is a floor above zero, so there is no ladder position for it
    // and classifying it would throw.
    expect(typeLift(NO_ENTRIES, 'squat', '0').fields.squat.weight).toBeNull();
  });
});

describe('setEntryUnit', () => {
  it('converts what was typed instead of rereading it', () => {
    // The rule tool 3 states outright, and it matters more here. A lift on this
    // screen is a fact about a meet that already happened: 405 does not become
    // 405 kg because the lifter tapped a different radio. Rereading would report a
    // 405 lb squat back as Elite with nothing on screen to question.
    const pounds = entriesOf({ squat: '405' }, 'lb');
    const kilograms = setEntryUnit(pounds, 'kg');
    expect(kilograms.unit).toBe('kg');
    expect(kilograms.fields.squat.text).toBe('183.7');
  });

  it('does not drift over repeated toggles', () => {
    // The acceptance test tool 2 wrote for the converter, arriving here. Each
    // toggle displays a rounded figure, so a version that reread its own output
    // would lose a hundredth per flick -- and after a few, a different squat.
    let entries = entriesOf({ squat: '130' });
    for (let flick = 0; flick < 8; flick += 1) {
      entries = setEntryUnit(entries, entries.unit === 'kg' ? 'lb' : 'kg');
    }
    expect(entries.unit).toBe('kg');
    expect(entries.fields.squat.text).toBe('130');
    expect(entries.fields.squat.weight?.origin).toEqual({ amount: 130, unit: 'kg' });
  });

  it('leaves text that is not a weight exactly as it was', () => {
    // There is nothing to convert, and rewriting it would delete what somebody
    // typed in the middle of correcting it.
    const switched = setEntryUnit(entriesOf({ squat: '1o5' }), 'lb');
    expect(switched.fields.squat).toEqual({ text: '1o5', weight: null });
  });

  it('is a no-op for the unit already selected', () => {
    const entries = entriesOf({ squat: '130' });
    expect(setEntryUnit(entries, 'kg')).toBe(entries);
  });
});

describe('resolveStandards', () => {
  it('resolves every lift, in platform order', () => {
    const standings = resolveStandards(BOOK, CATEGORY);
    expect(standings.map((entry) => entry.lift)).toEqual(['squat', 'bench', 'deadlift', 'total']);
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
    const standings = resolveStandards(book, CATEGORY);

    expect(ladderOf(standing(standings, 'squat')).standards.at(0)?.label).toBe('Class III');
    expect(ladderOf(standing(standings, 'total')).standards.at(0)?.label).toBe('Elite');
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
    const standings = resolveStandards(book, CATEGORY);

    expect(ladderOf(standing(standings, 'squat')).standards.map((rung) => rung.label)).toEqual([
      'Open Elite',
    ]);
  });

  it('reports two equally specific tables rather than picking one', () => {
    const book: ClassificationBook = {
      ...BOOK,
      tables: [table('squat', { divisionId: 'open' }), table('squat', { tested: true })],
    };
    const standings = resolveStandards(book, CATEGORY);

    expect(standing(standings, 'squat').standards.kind).toBe('ambiguous');
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
    const squat = standing(resolveStandards(book, CATEGORY), 'squat');

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
    const standings = resolveStandards(book, CATEGORY);

    expect(standing(standings, 'squat').standards.kind).toBe('ladder');
    expect(standing(standings, 'bench').standards.kind).toBe('none');
  });

  it('distinguishes an unanswered category from an unpublished one', () => {
    // Two different sentences on the screen. Collapsing them would tell a lifter
    // their federation publishes nothing when they simply have not finished
    // answering.
    expect(standing(resolveStandards(BOOK, null), 'squat').standards.kind).toBe('unselected');
    expect(standing(resolveStandards(null, CATEGORY), 'squat').standards.kind).toBe('none');
  });
});

/**
 * The other half of the old `resolveStandards`.
 *
 * These used to be asserted through a standing, back when one call answered both
 * "which table applies" and "what did the lifter type". They are separate calls
 * now -- the report resolves tables once per category and reads entries once per
 * keystroke -- so they are asserted separately too.
 */
describe('readLiftEntries', () => {
  it('leaves an empty field alone', () => {
    // An unanswered field is a normal state of this screen, not an error. Marking
    // it the moment the page loads is the easiest way to make a tool feel broken.
    expect(entryFor({})).toEqual({ kind: 'empty' });
  });

  it('converts a weight typed in pounds into the kilograms every standard is in', () => {
    // 300 lb is 136.08 kg. Comparing the pound figure directly against a ladder
    // published in kilograms would read 300 against a 150 kg standard and report
    // a class the lifter has not earned.
    expect(entryFor({ squat: '300' }, 'squat', 'lb')).toEqual({
      kind: 'weight',
      kilograms: 136.077711,
      derived: false,
    });
  });

  it('reads the number that was typed, not the number on display', () => {
    // 120 kg shown in pounds rounds to 264.55, which reads back as 119.9979 kg --
    // so a reader working from the displayed text would drop the lifter a class
    // for tapping a radio and tapping it back.
    const shown = setEntryUnit(entriesOf({ squat: '120' }), 'lb');
    expect(readLiftEntries(shown).squat).toEqual({
      kind: 'weight',
      kilograms: 120,
      derived: false,
    });
  });

  it.each([
    ['1o5', 'Enter a weight in kilograms, for example 142.5.'],
    ['1e3', 'Enter a weight in kilograms, for example 142.5.'],
    ['-100', 'Enter a weight above zero.'],
    ['0', 'Enter a weight above zero.'],
    ['0.0', 'Enter a weight above zero.'],
    ['100 stone', 'Write the unit as kg or lb, or leave it off.'],
    ['200000', 'That is heavier than this tool can read.'],
  ])('rejects %s without quoting it back', (typed, message) => {
    expect(entryFor({ squat: typed })).toEqual({ kind: 'invalid', message });
    // The domain's own reason quotes the input, which belongs in a CI log rather
    // than under a field where the input is already visible.
    expect(message).not.toContain(typed);
  });

  it('offers a pound example to somebody entering pounds', () => {
    // Telling a lifter working in pounds to "enter 142.5" is an instruction to
    // type a figure that will be read as a different lift entirely.
    expect(entryFor({ squat: '1o5' }, 'squat', 'lb')).toEqual({
      kind: 'invalid',
      message: 'Enter a weight in pounds, for example 315.',
    });
  });

  it('accepts a weight with surrounding whitespace', () => {
    expect(entryFor({ squat: ' 130 ' })).toEqual({
      kind: 'weight',
      kilograms: 130,
      derived: false,
    });
  });

  it('adds up the total when all three lifts are entered and it is not', () => {
    // The arithmetic a lifter would otherwise do on a phone between attempts.
    const total = entryFor({ squat: '62.5', bench: '42.5', deadlift: '145' }, 'total');
    expect(total).toEqual({ kind: 'weight', kilograms: 250, derived: true });
  });

  it('adds up three pound entries as one kilogram total', () => {
    // 315 + 225 + 405 lb. Summed in pounds and converted once it is 428.64 kg;
    // converted individually and summed it is the same figure, which is the point
    // -- the three fields must not each carry their own rounding into the total.
    const total = entryFor({ squat: '315', bench: '225', deadlift: '405' }, 'total', 'lb');
    expect(total).toEqual({ kind: 'weight', kilograms: 428.64, derived: true });
  });

  it('does not let floating point show through the derived total', () => {
    // 100 + 40.1 + 128.2 sums to 268.29999999999995 in binary floating point,
    // and a total displayed like that is a bug report. Asserted on the number
    // rather than the formatted string, because the value is what a later
    // comparison against a record uses.
    expect(100 + 40.1 + 128.2).not.toBe(268.3);
    expect(entryFor({ squat: '100', bench: '40.1', deadlift: '128.2' }, 'total')).toEqual({
      kind: 'weight',
      kilograms: 268.3,
      derived: true,
    });
  });

  it('leaves a typed total alone', () => {
    // A lifter entering a total directly is saying something the three fields
    // cannot: their best total came from a different day.
    const total = entryFor({ squat: '60', bench: '40', deadlift: '140', total: '260' }, 'total');
    expect(total).toEqual({ kind: 'weight', kilograms: 260, derived: false });
  });

  it('does not add up a partial set of lifts', () => {
    expect(entryFor({ squat: '60', bench: '40' }, 'total')).toEqual({ kind: 'empty' });
  });

  it('does not add up around a lift that will not parse', () => {
    // Otherwise a mistyped bench press silently becomes a total two hundred
    // kilograms light, presented with the same confidence as a correct one.
    const total = entryFor({ squat: '60', bench: '4o', deadlift: '140' }, 'total');
    expect(total).toEqual({ kind: 'empty' });
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

describe('formatAsUnit', () => {
  it('writes kilograms to a hundredth and pounds to a tenth', () => {
    // Every standard is published to the half kilogram, so the hundredths of a
    // converted pound figure come from 0.45359237 and not from the federation.
    // "10.47 lb to Class I" claims a precision that does not exist.
    expect(formatAsUnit(142.5, 'kg')).toBe('142.5 kg');
    expect(formatAsUnit(4.75, 'lb')).toBe('10.5 lb');
  });

  it('drops a trailing zero rather than printing false precision', () => {
    expect(formatAsUnit(100, 'kg')).toBe('100 kg');
    expect(formatAsUnit(45.359237, 'lb')).toBe('100 lb');
  });
});
