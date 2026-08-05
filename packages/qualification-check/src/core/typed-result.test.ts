// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { collectStandings } from './history.js';
import {
  emptyTypedResult,
  readTypedResult,
  type TypedResultForm,
  type TypedResultProblem,
} from './typed-result.js';
import { performanceWindow, type PerformanceWindow } from './window.js';

/**
 * Every figure and every name here is invented (section 5.1).
 *
 * A real meet name and a real total would read as a claim about a person, on the
 * one file whose subject is somebody typing their own result in.
 */
function form(overrides: Partial<TypedResultForm> = {}): TypedResultForm {
  return {
    ...emptyTypedResult(),
    date: '2026-03-14',
    meetName: 'Coastal Spring Open',
    federation: 'Harbour Lifting Alliance',
    sex: 'F',
    equipment: 'Raw',
    squatKg: '145',
    benchKg: '82.5',
    deadliftKg: '175',
    ...overrides,
  };
}

function readOrThrow(overrides: Partial<TypedResultForm> = {}) {
  const reading = readTypedResult(form(overrides));
  if (!reading.ok) {
    throw new Error(`Expected a readable result, got ${JSON.stringify(reading.problems)}.`);
  }
  return reading.entry;
}

function problemsOf(overrides: Partial<TypedResultForm>): readonly TypedResultProblem[] {
  const reading = readTypedResult(form(overrides));
  if (reading.ok) {
    throw new Error('Expected the form to be refused.');
  }
  return reading.problems;
}

function windowOrThrow(from: string, to: string): PerformanceWindow {
  const result = performanceWindow(from, to);
  if (!result.ok) throw new Error(`Bad fixture window: ${result.problems.join(', ')}.`);
  return result.window;
}

describe('emptyTypedResult', () => {
  it('opens a form nobody has answered', () => {
    const blank = emptyTypedResult();

    expect(blank.tested).toBe('unstated');
    expect(blank.ageApproximate).toBe(false);
    expect(blank.date).toBe('');
  });

  it('is refused as it stands, naming every blank at once', () => {
    // The reason a caller cannot submit an untouched form, and the shape of the
    // refusal: one pass, every field, so a phone shows the whole list.
    const reading = readTypedResult(emptyTypedResult());
    if (reading.ok) throw new Error('Expected a blank form to be refused.');

    expect(reading.problems).toEqual([
      { field: 'date', code: 'missing' },
      { field: 'meetName', code: 'missing' },
      { field: 'federation', code: 'missing' },
      { field: 'sex', code: 'missing' },
      { field: 'equipment', code: 'missing' },
      { field: 'lifts', code: 'no-lift' },
    ]);
  });
});

describe('readTypedResult', () => {
  it('reads a filled-in meet', () => {
    const entry = readOrThrow();

    expect(entry.date).toBe('2026-03-14');
    expect(entry.meetName).toBe('Coastal Spring Open');
    expect(entry.federation).toBe('Harbour Lifting Alliance');
    expect(entry.squatKg).toBe(145);
    expect(entry.benchKg).toBe(82.5);
    expect(entry.deadliftKg).toBe(175);
  });

  it('derives the total rather than asking for it', () => {
    // A total nobody types is a total nobody can mistype, and the sum is the one
    // figure on the sheet that is not independent of the others.
    expect(readOrThrow().totalKg).toBe(402.5);
  });

  it('does not print the sum of three decimals in full', () => {
    // The figures are what a pound-plate meet recorded in kilograms actually looks
    // like -- 275, 185 and 335 lb -- and they are here because they are one of the
    // triples that breaks: 124.74 + 83.91 + 151.95 is 360.59999999999997 in binary
    // floating point. Most decimal triples sum exactly and would pass this test
    // with the rounding deleted, so picking a pretty one would have proved nothing.
    expect(readOrThrow({ squatKg: '124.74', benchKg: '83.91', deadliftKg: '151.95' }).totalKg).toBe(
      360.6,
    );
  });

  it('totals the lifts that were contested, leaving the rest to the standing', () => {
    // A push/pull. The sum is real and the entry records two lifts, which is what
    // `buildStanding` reads to keep it out of `total` -- see the standing test below.
    const entry = readOrThrow({ squatKg: '' });

    expect(entry.totalKg).toBe(257.5);
    expect(entry.squatKg).toBeNull();
  });

  it('names the lifts that were contested the way the archive spells them', () => {
    expect(readOrThrow().event).toBe('SBD');
    expect(readOrThrow({ squatKg: '' }).event).toBe('BD');
    expect(readOrThrow({ squatKg: '', deadliftKg: '' }).event).toBe('B');
    // Each of the three letters needs a case that leaves it out, or a letter written
    // unconditionally reads as correct: every other case here contests the bench.
    expect(readOrThrow({ benchKg: '' }).event).toBe('SD');
  });

  it('leaves the parent federation unstated unless it is given', () => {
    // Never inferred. An assumed parent is a claim about who sanctioned a meet,
    // made by a tool, on the screen that exists to be checkable.
    expect(readOrThrow().parentFederation).toBeNull();
    expect(
      readOrThrow({ parentFederation: 'Continental Powerlifting Union' }).parentFederation,
    ).toBe('Continental Powerlifting Union');
  });

  it('records no placing', () => {
    // There is no control for one and there should not be. The only placings this
    // package reads are the struck codes, and a result the meet struck is one to
    // leave out rather than one to declare.
    expect(readOrThrow().place).toBeNull();
  });

  it('keeps three answers about drug testing apart', () => {
    expect(readOrThrow({ tested: 'tested' }).tested).toBe(true);
    expect(readOrThrow({ tested: 'untested' }).tested).toBe(false);
    // Not `false`. A blank is the source declining to say, and collapsing it would
    // put "untested" beside a meet that tested and was simply not annotated.
    expect(readOrThrow({ tested: 'unstated' }).tested).toBeNull();
  });

  it('carries an age that is only known to a year', () => {
    const entry = readOrThrow({ ageYears: '46', ageApproximate: true });

    expect(entry.age).toEqual({ years: 46, approximate: true });
  });

  it('leaves the age out when it was not given', () => {
    expect(readOrThrow().age).toBeNull();
  });

  it('reads every optional label as the source not saying when it is blank', () => {
    const entry = readOrThrow();

    expect(entry.division).toBeNull();
    expect(entry.ageClass).toBeNull();
    expect(entry.weightClassKg).toBeNull();
    expect(entry.bodyweightKg).toBeNull();
  });

  it('keeps the optional labels the source did give', () => {
    const entry = readOrThrow({
      division: 'Masters 1',
      ageClass: '45-49',
      weightClassKg: '82.5',
      bodyweightKg: '81.4',
    });

    expect(entry.division).toBe('Masters 1');
    expect(entry.ageClass).toBe('45-49');
    expect(entry.weightClassKg).toBe('82.5');
    expect(entry.bodyweightKg).toBe(81.4);
  });

  it('trims what it is given rather than carrying the whitespace into a key', () => {
    // `standingKey` joins these, so an untrimmed federation splits one registration
    // into two that render identically -- a report that is entirely valid and one
    // line too long, with nothing on screen to explain it.
    const entry = readOrThrow({ federation: '  Harbour Lifting Alliance  ', equipment: ' Raw ' });

    expect(entry.federation).toBe('Harbour Lifting Alliance');
    expect(entry.equipment).toBe('Raw');
  });

  it('takes the surrounding whitespace off a day', () => {
    expect(readOrThrow({ date: '  2026-03-14 ' }).date).toBe('2026-03-14');
  });
});

describe('readTypedResult, refusing', () => {
  it('refuses a day that is not a day', () => {
    expect(problemsOf({ date: '14 March 2026' })).toEqual([
      { field: 'date', code: 'unreadable-date' },
    ]);
  });

  it('refuses an unpadded day rather than reading it', () => {
    // The one that has to be a refusal rather than a repair. `windowContains`
    // compares days as strings, and `2026-3-14` sorts after `2026-10-01` -- so a
    // day that got through unpadded would put a result outside a window it is
    // squarely inside, with a plausible screen and nothing to investigate.
    expect(problemsOf({ date: '2026-3-14' })).toEqual([{ field: 'date', code: 'unreadable-date' }]);
  });

  it('refuses a day that does not exist in its month', () => {
    // 31 April passes a length check and would shift a result by a day.
    expect(problemsOf({ date: '2026-04-31' })).toEqual([
      { field: 'date', code: 'unreadable-date' },
    ]);
  });

  it('refuses a lift that is not a number', () => {
    expect(problemsOf({ benchKg: '82,5' })).toEqual([
      { field: 'benchKg', code: 'unreadable-number' },
    ]);
  });

  it('refuses a lift of nought and says so in its own words', () => {
    // Kept apart from the unreadable case because the fix is different: a nought is
    // somebody recording a missed lift, and the answer is to leave the field blank.
    expect(problemsOf({ squatKg: '0' })).toEqual([{ field: 'squatKg', code: 'not-above-zero' }]);
  });

  it('refuses a bodyweight of nought', () => {
    expect(problemsOf({ bodyweightKg: '0' })).toEqual([
      { field: 'bodyweightKg', code: 'not-above-zero' },
    ]);
  });

  it('refuses a fractional age rather than rounding it', () => {
    // The archive writes 23.5 for "one of these two", and that is carried by the
    // tick box. Rounding here would answer a question the source declined to answer.
    expect(problemsOf({ ageYears: '23.5' })).toEqual([
      { field: 'ageYears', code: 'not-a-whole-number' },
    ]);
  });

  it('refuses a result with no lift in it', () => {
    expect(problemsOf({ squatKg: '', benchKg: '', deadliftKg: '' })).toEqual([
      { field: 'lifts', code: 'no-lift' },
    ]);
  });

  it.each([['squatKg'], ['benchKg'], ['deadliftKg']] as const)(
    'does not also call a form empty when its only lift, the %s, was unreadable',
    (field) => {
      // Two messages about one field is how a form starts reading as broken. The
      // check is on the parsed values, so it has to consult what was already
      // reported -- and it is run over all three fields rather than the squat alone
      // because the guard lists them by name, and a list that had lost two of the
      // three would be proven correct by any test that only ever mistypes a squat.
      const noLifts = { squatKg: '', benchKg: '', deadliftKg: '' };

      expect(problemsOf({ ...noLifts, [field]: 'heavy' })).toEqual([
        { field, code: 'unreadable-number' },
      ]);
    },
  );

  it('refuses a required field that holds only spaces', () => {
    expect(problemsOf({ meetName: '   ' })).toEqual([{ field: 'meetName', code: 'missing' }]);
  });

  it('reports every fault in one pass', () => {
    const problems = problemsOf({
      date: 'last spring',
      federation: '',
      benchKg: '-5',
      ageYears: 'forty',
    });

    expect(problems).toEqual([
      { field: 'date', code: 'unreadable-date' },
      { field: 'federation', code: 'missing' },
      { field: 'ageYears', code: 'not-a-whole-number' },
      { field: 'benchKg', code: 'unreadable-number' },
    ]);
  });
});

describe('a typed result in the pipeline', () => {
  const window = windowOrThrow('2025-01-01', '2026-12-31');

  it('is graded by the same code that grades an imported one', () => {
    // The reason this file produces an `AthleteEntry` at all. Nothing below knows
    // where the entry came from, so way three inherits every rule already written.
    const standings = collectStandings([readOrThrow()], window);

    expect(standings).toHaveLength(1);
    expect(standings[0]?.total?.kilograms).toBe(402.5);
    expect(standings[0]?.total?.source.meetName).toBe('Coastal Spring Open');
  });

  it('keeps a two-lift total out of the three-lift total', () => {
    // The pair the derived sum depends on: this file totals what was contested, and
    // the standing decides that a push/pull sum is not a total. A `total` standard
    // is the sum of three, and grading a push/pull against it hands a lifter a
    // grade they have not reached.
    const standings = collectStandings([readOrThrow({ squatKg: '' })], window);

    expect(standings[0]?.total).toBeNull();
    expect(standings[0]?.partialTotal?.kilograms).toBe(257.5);
  });

  it('splits two typed meets a weight class apart into two registrations', () => {
    // The brief's sharpest line, reached from the manual route with no archive
    // involved: show every registration the results support, and pick none.
    const standings = collectStandings(
      [
        readOrThrow({ weightClassKg: '82.5' }),
        readOrThrow({
          date: '2026-06-20',
          meetName: 'Harbour Summer Classic',
          weightClassKg: '75',
        }),
      ],
      window,
    );

    expect(standings).toHaveLength(2);
    expect(standings.map((standing) => standing.registration.weightClassKg).sort()).toEqual([
      '75',
      '82.5',
    ]);
  });

  it('is dropped by the same window filter as an imported one', () => {
    const narrow = windowOrThrow('2026-04-01', '2026-12-31');

    expect(collectStandings([readOrThrow()], narrow)).toEqual([]);
  });
});
