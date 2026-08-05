// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  AthleteCorpusError,
  buildAthleteMirror,
  projectCorpusRow,
  readCorpusColumns,
  summarizeWithheld,
  type WithheldEntryRow,
} from './athlete-mirror.js';

/**
 * Every figure, federation and lifter below is invented.
 *
 * Section 5.1 keeps federation identifiers out of source, and this is the corpus
 * where that rule has a second edge: a mirror of competition results is the one
 * file where a plausible fixture name would also be a person. `INVF`, `INTL` and
 * `Kestrel Vale` are nobody.
 */
const DOCUMENT = {
  id: 'athlete-mirror',
  label: 'Competition results archive',
  provenance: {
    id: 'athletes',
    label: 'Invented bulk results archive',
    document: 'invented-latest.zip (CSV export)',
    url: 'https://example.invalid/invented-latest.zip',
    attribution: 'This page uses data from the Invented project.',
    retrievedAt: '2026-08-01T03:03:00.000Z',
  },
  scope: {
    federations: ['INVF'],
    parentFederations: ['INTL'],
  },
  scopeNote: 'Lifters with at least one result under INVF or an INTL affiliate.',
  bounds: {
    minimumEntries: 1,
    maximumWithheldRows: 10,
  },
};

/**
 * The header, with the columns deliberately out of the adapter's own order and
 * with three it does not read scattered among them.
 *
 * Both are the point. The archive has grown columns before and will again, and a
 * projection pinned to a position publishes the wrong field the first time
 * somebody inserts one -- silently, because every value in the file is a
 * plausible string.
 */
const HEADER = [
  'Name',
  'Sex',
  'Event',
  'Equipment',
  'Age',
  'AgeClass',
  'BirthYearClass',
  'Division',
  'BodyweightKg',
  'WeightClassKg',
  'Squat1Kg',
  'Best3SquatKg',
  'Best3BenchKg',
  'Best3DeadliftKg',
  'TotalKg',
  'Place',
  'Dots',
  'Tested',
  'Country',
  'Federation',
  'ParentFederation',
  'Date',
  'MeetCountry',
  'MeetName',
].join(',');

const COLUMNS = readCorpusColumns(HEADER);

/** One archive row as a list of cells, with everything unstated left blank. */
function row(values: Readonly<Record<string, string>> = {}): string[] {
  const defaults: Record<string, string> = {
    Name: 'Kestrel Vale',
    Sex: 'F',
    Event: 'SBD',
    Equipment: 'Raw',
    Federation: 'INVF',
    Date: '2026-03-14',
    MeetName: 'Invented Open',
  };
  const merged: Record<string, string> = { ...defaults, ...values };
  return HEADER.split(',').map((column) => merged[column] ?? '');
}

/**
 * The archive as a file: a header and some rows, reopenable.
 *
 * An async iterable rather than an array, because that is the shape the real
 * reader hands over -- a stream off an 800 MB file that nothing may buffer.
 */
function corpus(rows: readonly string[][]): () => AsyncIterable<string> {
  const lines = [HEADER, ...rows.map((cells) => cells.join(','))];
  return () => ({
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      await Promise.resolve();
      yield* lines;
    },
  });
}

/** Projects a row, failing the test if it was withheld. */
function project(cells: readonly string[]) {
  const projected = projectCorpusRow(cells, COLUMNS);
  if (typeof projected === 'string') {
    throw new Error(`The row was withheld: ${projected}`);
  }
  return projected;
}

describe('readCorpusColumns', () => {
  it('finds every column it reads by name, wherever it sits', () => {
    expect(COLUMNS.Name).toBe(0);
    expect(COLUMNS.Federation).toBe(19);
    expect(COLUMNS.MeetName).toBe(23);
  });

  it('is unmoved by a column inserted before the ones it wants', () => {
    // The failure this prevents is not an error. A projection pinned to a
    // position reads the next field along and publishes a mirror in which every
    // meet name is a country.
    const shifted = readCorpusColumns(`Inserted,${HEADER}`);
    const bumped = Object.fromEntries(
      Object.entries(COLUMNS).map(([column, index]) => [column, index + 1]),
    );
    expect({ ...shifted }).toEqual(bumped);
  });

  it('refuses a header missing a column, and names it', () => {
    const without = HEADER.split(',')
      .filter((column) => column !== 'TotalKg')
      .join(',');
    expect(() => readCorpusColumns(without)).toThrow(/missing TotalKg/u);
  });

  it('lists every missing column, not the first one found', () => {
    // Section 5.5, report everything at once. One rebuild per column is a long
    // afternoon, and a header that has gone wrong has usually gone wrong in more
    // than one place.
    const without = HEADER.split(',')
      .filter((column) => column !== 'TotalKg' && column !== 'Place')
      .join(',');
    expect(() => readCorpusColumns(without)).toThrow(/missing TotalKg, Place/u);
  });

  it('refuses a header that names a column twice', () => {
    // Not pedantry: a duplicate means the file is not the shape it claims to be,
    // and taking the first occurrence is a guess about which of the two holds the
    // figures.
    expect(() => readCorpusColumns(`${HEADER},TotalKg`)).toThrow(/duplicated TotalKg/u);
  });

  it('reports a missing column and a duplicated one in one message', () => {
    const broken = HEADER.split(',')
      .filter((column) => column !== 'TotalKg')
      .concat('Place')
      .join(',');
    expect(() => readCorpusColumns(broken)).toThrow(/missing TotalKg; duplicated Place/u);
  });

  it('ignores a duplicate of a column it does not read', () => {
    expect(() => readCorpusColumns(`${HEADER},Dots`)).not.toThrow();
  });

  it('throws AthleteCorpusError, so a caller can tell bad data from a bug', () => {
    expect(() => readCorpusColumns('Name')).toThrow(AthleteCorpusError);
  });
});

describe('projectCorpusRow', () => {
  it('carries the source vocabulary through unmapped', () => {
    // Deliberately not translated onto this project's own identifiers. A mapping
    // would assert that an upstream `Division` string is the same thing as a
    // federation's division -- an assertion nobody has checked, on the one screen
    // whose entire job is to be checkable.
    const { entry } = project(
      row({
        Event: 'BD',
        Equipment: 'Single-ply',
        Division: 'Open Women',
        WeightClassKg: '60+',
        Sex: 'Mx',
      }),
    );
    expect(entry.event).toBe('BD');
    expect(entry.equipment).toBe('Single-ply');
    expect(entry.division).toBe('Open Women');
    expect(entry.weightClassKg).toBe('60+');
    expect(entry.sex).toBe('Mx');
  });

  it('reads a blank optional cell as an absence and not as a value', () => {
    const { entry } = project(row());
    expect(entry.parentFederation).toBeNull();
    expect(entry.division).toBeNull();
    expect(entry.ageClass).toBeNull();
    expect(entry.place).toBeNull();
    expect(entry.weightClassKg).toBeNull();
    expect(entry.bodyweightKg).toBeNull();
    expect(entry.totalKg).toBeNull();
  });

  it('reads a blank drug-test cell as silence, never as untested', () => {
    // The upstream column only ever asserts the positive. Collapsing a blank into
    // `false` would put "untested" beside results from meets that were tested and
    // simply not annotated, and this is the axis a lifter is turned away at
    // weigh-in over.
    expect(project(row({ Tested: '' })).entry.tested).toBeNull();
    expect(project(row({ Tested: 'Yes' })).entry.tested).toBe(true);
    expect(project(row({ Tested: 'yes' })).entry.tested).toBeNull();
  });

  it('keeps a half year as an ambiguity rather than rounding it away', () => {
    // The archive writes 23.5 to mean "23 or 24": the meet published a birth year
    // and not a birth date. That decides which age division somebody may enter,
    // so a rounded age is a confident answer to a question the source declined.
    expect(project(row({ Age: '23.5' })).entry.age).toEqual({ years: 23, approximate: true });
    expect(project(row({ Age: '23' })).entry.age).toEqual({ years: 23, approximate: false });
    expect(project(row({ Age: '' })).entry.age).toBeNull();
  });

  it.each(['abc', '-1', '23.25', 'Infinity'])('withholds a row whose Age reads %p', (Age) => {
    expect(projectCorpusRow(row({ Age }), COLUMNS)).toBe(
      'Age is neither blank nor a whole or half year',
    );
  });

  it('reads a negative best lift as no successful lift, not as a broken cell', () => {
    // The archive's own documentation: a negative best-of-three "is used by some
    // federations to report the lowest weight the lifter attempted and failed".
    // Withholding the row would delete a whole meet from a lifter's history
    // because they missed one lift at it -- and take the lifetime deadlift they
    // pulled at that same meet with it. Worth 3,099 entries on the measured
    // corpus.
    const { entry } = project(row({ Best3SquatKg: '-140', Best3DeadliftKg: '180' }));
    expect(entry.squatKg).toBeNull();
    expect(entry.deadliftKg).toBe(180);
  });

  it.each(['Best3SquatKg', 'Best3BenchKg', 'Best3DeadliftKg'])(
    'withholds a row whose %s is zero',
    (column) => {
      // The negative above is a documented convention. A zero is a cell nobody
      // can account for, and it is the one value that would read as a successful
      // lift of nothing.
      expect(projectCorpusRow(row({ [column]: '0' }), COLUMNS)).toBe(
        `${column} is neither blank, a weight above zero, nor a failed attempt`,
      );
    },
  );

  it('withholds a row whose bodyweight is negative', () => {
    // The failed-attempt convention is about the three best-of-three columns and
    // nothing else. A negative bodyweight is not a failed attempt at anything.
    expect(projectCorpusRow(row({ BodyweightKg: '-60' }), COLUMNS)).toBe(
      'BodyweightKg is neither blank nor a weight above zero',
    );
  });

  it('withholds a row whose total is negative', () => {
    expect(projectCorpusRow(row({ TotalKg: '-280' }), COLUMNS)).toBe(
      'TotalKg is neither blank nor a weight above zero',
    );
  });

  it.each(['abc', '   '])('withholds a row whose weight cell reads %p', (BodyweightKg) => {
    // A space is not a blank and is not a figure. `Number(' ')` is zero, which is
    // exactly the coercion that would otherwise publish a bodyweight of nothing.
    expect(projectCorpusRow(row({ BodyweightKg }), COLUMNS)).toBe(
      'BodyweightKg is neither blank nor a weight above zero',
    );
  });

  it('reads a blank weight as a missing figure and keeps the row', () => {
    expect(project(row({ BodyweightKg: '' })).entry.bodyweightKg).toBeNull();
  });

  it('withholds a name that folds to nothing', () => {
    // A name written in a script with no Latin letters -- spelled as escapes, the
    // way the fold table itself is. There is no key to publish it under and no
    // key a visitor could type to find it, so it is dropped with a count rather
    // than published somewhere unreachable.
    expect(projectCorpusRow(row({ Name: '\u4e2d\u6587' }), COLUMNS)).toBe(
      'the name reduces to no lookup key',
    );
  });

  it.each(['', '2026-3-14', '14/03/2026', '2026-03-14T00:00:00Z', 'unknown'])(
    'withholds a row dated %p',
    (Date) => {
      // The date is not a display detail. Every question this mirror answers is
      // scoped to a window, and a row with no day cannot be inside or outside
      // one.
      expect(projectCorpusRow(row({ Date }), COLUMNS)).toBe('the date is not YYYY-MM-DD');
    },
  );

  it.each(['Federation', 'MeetName', 'Event', 'Equipment', 'Sex'])(
    'withholds a row whose %s is empty',
    (column) => {
      expect(projectCorpusRow(row({ [column]: '' }), COLUMNS)).toBe(`${column} is empty`);
    },
  );

  it('withholds a row that split into too few cells rather than shifting it', () => {
    // The archive states that no field holds a comma, so there is no quote-aware
    // parser here. If that ever stops being true, a short row has to fail the
    // ordinary checks rather than publish a projection in which every field is
    // the one before it.
    expect(typeof projectCorpusRow(['Kestrel Vale', 'F'], COLUMNS)).toBe('string');
  });

  it('publishes the name as printed and the key a visitor could type', () => {
    const projected = project(row({ Name: 'Kestrel Vale #2' }));
    expect(projected.key).toBe('kestrelvale2');
    expect(projected.name).toBe('Kestrel Vale #2');
  });
});

describe('buildAthleteMirror', () => {
  it('mirrors a lifter matched on the sanctioning federation', async () => {
    const result = await buildAthleteMirror(DOCUMENT, corpus([row({ Federation: 'INVF' })]));
    expect(result.mirror.athletes.map((athlete) => athlete.name)).toEqual(['Kestrel Vale']);
  });

  it('mirrors a lifter matched only on the parent federation', async () => {
    // Two lists rather than one, because matching `Federation` alone misses every
    // meet run by an affiliate that names itself something else.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([row({ Federation: 'INVF-EAST', ParentFederation: 'INTL' })]),
    );
    expect(result.mirror.athletes).toHaveLength(1);
  });

  it('mirrors nobody whose meets are all outside the scope', async () => {
    // The scope is a speed decision and never a correctness one: a lifter outside
    // it is told plainly that nothing was found and given the manual route, which
    // stays fully usable on its own.
    await expect(
      buildAthleteMirror(DOCUMENT, corpus([row({ Federation: 'OTHER', ParentFederation: 'OTH' })])),
    ).rejects.toThrow(/Only 0 entries survived/u);
  });

  it('mirrors a lifter whole once they are in scope, other federations included', async () => {
    // The generous half of the scope rule. Somebody who spent five years in
    // another federation before their first in-scope meet sees those five years,
    // because a qualifying total is a qualifying total wherever it was lifted.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row({ Federation: 'OTHER', Date: '2021-05-02' }),
        row({ Federation: 'INVF', Date: '2026-03-14' }),
      ]),
    );
    expect(result.mirror.athletes[0]?.entries.map((one) => one.federation)).toEqual([
      'OTHER',
      'INVF',
    ]);
  });

  it('reads the archive twice, because scope is a fact about a lifter', async () => {
    // Nothing about the first row can be decided until the last has been seen.
    // `openRows` is a factory for exactly that reason: an iterable can only be
    // walked once, and a caller who handed one over would get an empty mirror and
    // no error at all.
    let opened = 0;
    const rows = corpus([row()]);
    await buildAthleteMirror(DOCUMENT, () => {
      opened += 1;
      return rows();
    });
    expect(opened).toBe(2);
  });

  it('does not drag a colliding name into scope behind a lifter who qualifies', async () => {
    // Scope is keyed on the archive's own name and not on the lookup key. The
    // fold is lossy, and two lifters who fold together are two lifters.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row({ Name: 'Kestrel Vale', Federation: 'INVF' }),
        row({ Name: 'Kestrel  Vale', Federation: 'OTHER', ParentFederation: 'OTH' }),
      ]),
    );
    expect(result.mirror.athletes.map((athlete) => athlete.name)).toEqual(['Kestrel Vale']);
  });

  it('keeps two lifters who fold to one key as two histories', async () => {
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row({ Name: 'Kestrel Vale' }),
        row({ Name: 'Kestrel Vale #2' }),
        row({ Name: 'Kestrel  Vale' }),
      ]),
    );
    const shared = result.mirror.athletes.filter((athlete) => athlete.key === 'kestrelvale');
    expect(shared.map((athlete) => athlete.name)).toEqual(['Kestrel  Vale', 'Kestrel Vale']);
  });

  it('orders a history oldest first', async () => {
    // The corpus is not ordered by date, and a history read in file order reads
    // as noise on a screen whose job is to show a progression.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row({ Date: '2026-03-14', MeetName: 'Third' }),
        row({ Date: '2021-05-02', MeetName: 'First' }),
        row({ Date: '2024-11-09', MeetName: 'Second' }),
      ]),
    );
    expect(result.mirror.athletes[0]?.entries.map((one) => one.meetName)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('orders two entries at one meet deterministically', async () => {
    // Date alone leaves them in whatever order the archive listed them, and a
    // content-addressed artifact whose order can move without its data changing
    // gets a new filename for nothing.
    const rows = [row({ Event: 'SBD', TotalKg: '280' }), row({ Event: 'B', TotalKg: '60' })];
    const forwards = await buildAthleteMirror(DOCUMENT, corpus(rows));
    const backwards = await buildAthleteMirror(DOCUMENT, corpus([...rows].reverse()));
    expect(forwards.mirror.athletes[0]?.entries.map((one) => one.event)).toEqual(['B', 'SBD']);
    expect(JSON.stringify(backwards.mirror)).toBe(JSON.stringify(forwards.mirror));
  });

  it('orders lifters by key, so the whole mirror is stable', async () => {
    const rows = [
      row({ Name: 'Wren Ashby' }),
      row({ Name: 'Kestrel Vale' }),
      row({ Name: 'Marlow Quill' }),
    ];
    const forwards = await buildAthleteMirror(DOCUMENT, corpus(rows));
    const backwards = await buildAthleteMirror(DOCUMENT, corpus([...rows].reverse()));
    expect(forwards.mirror.athletes.map((athlete) => athlete.key)).toEqual([
      'kestrelvale',
      'marlowquill',
      'wrenashby',
    ]);
    expect(JSON.stringify(backwards.mirror)).toBe(JSON.stringify(forwards.mirror));
  });

  it('counts the info off the data it just built, never off the document', async () => {
    // A figure the document declared would be a promise about the data rather
    // than a description of it, and the two would part company silently -- a
    // count printed under results it no longer describes.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row({ Name: 'Kestrel Vale', Date: '2026-03-14' }),
        row({ Name: 'Kestrel Vale', Date: '2024-11-09' }),
        row({ Name: 'Wren Ashby' }),
      ]),
    );
    expect(result.info.athleteCount).toBe(2);
    expect(result.info.entryCount).toBe(3);
  });

  it('carries the credit and the scope sentence the licence and the screen need', async () => {
    const result = await buildAthleteMirror(DOCUMENT, corpus([row()]));
    expect(result.info.attribution).toBe(DOCUMENT.provenance.attribution);
    expect(result.info.sourceUrl).toBe(DOCUMENT.provenance.url);
    expect(result.info.scopeNote).toBe(DOCUMENT.scopeNote);
    expect(result.info.id).toBe(DOCUMENT.id);
    expect(result.info.label).toBe(DOCUMENT.label);
  });

  it('reports the archive freshness from the document and not from a clock', async () => {
    const result = await buildAthleteMirror(DOCUMENT, corpus([row()]));
    expect(result.freshness).toEqual({
      id: 'athletes',
      label: 'Invented bulk results archive',
      retrievedAt: '2026-08-01T03:03:00.000Z',
      status: 'ok',
    });
  });

  it('refuses a build that found fewer entries than the floor', async () => {
    // The failure this catches is otherwise invisible: a scope or projection rule
    // that quietly stops matching produces a valid artifact that is simply mostly
    // empty, and on the site that reads as a quiet month upstream.
    await expect(
      buildAthleteMirror(
        { ...DOCUMENT, bounds: { minimumEntries: 5, maximumWithheldRows: 10 } },
        corpus([row(), row({ Date: '2024-11-09' })]),
      ),
    ).rejects.toThrow(/Only 2 entries survived, under the floor of 5/u);
  });

  it('refuses a build that withheld more rows than the budget', async () => {
    await expect(
      buildAthleteMirror(
        { ...DOCUMENT, bounds: { minimumEntries: 1, maximumWithheldRows: 1 } },
        corpus([row(), row({ Date: 'unknown' }), row({ Date: 'also unknown' })]),
      ),
    ).rejects.toThrow(/2 rows were withheld, over the budget of 1/u);
  });

  it('allows a build that withheld exactly the budget', async () => {
    // The budget is what a healthy corpus is allowed to lose, not one fewer. Off
    // by one here fails a refresh for being exactly as ragged as the document
    // says it is permitted to be -- unattended, at two in the morning.
    const result = await buildAthleteMirror(
      { ...DOCUMENT, bounds: { minimumEntries: 1, maximumWithheldRows: 1 } },
      corpus([row(), row({ Date: 'unknown' })]),
    );
    expect(result.withheld).toHaveLength(1);
  });

  it('allows a build that found exactly the floor', async () => {
    const result = await buildAthleteMirror(
      { ...DOCUMENT, bounds: { minimumEntries: 2, maximumWithheldRows: 10 } },
      corpus([row(), row({ Date: '2024-11-09' })]),
    );
    expect(result.info.entryCount).toBe(2);
  });

  it('names no lifter when it refuses a build', async () => {
    // Section 2.3. Six hundred thousand entries would otherwise put tens of
    // thousands of names into a CI log that is kept forever -- and unlike a
    // record holder, whose name the federation publishes beside their lift, these
    // are people who consented to nothing beyond their results being public.
    let message = '';
    try {
      await buildAthleteMirror(
        { ...DOCUMENT, bounds: { minimumEntries: 1, maximumWithheldRows: 0 } },
        corpus([row(), row({ Name: 'Kestrel Vale', Date: 'unknown' })]),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('withheld');
    expect(message).not.toContain('Kestrel Vale');
  });

  it('reports a withheld row by its line, counting the header as line 1', async () => {
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([row(), row({ Date: 'unknown' }), row({ Date: '2024-11-09' })]),
    );
    expect(result.withheld).toEqual([{ line: 3, reason: 'the date is not YYYY-MM-DD' }]);
  });

  it('counts no withheld row against a lifter nobody is mirroring', async () => {
    // Scope is decided before a row is projected. Otherwise the budget is spent
    // on the four hundred federations this mirror never publishes, and the build
    // fails over data it was always going to throw away.
    const result = await buildAthleteMirror(
      DOCUMENT,
      corpus([
        row(),
        row({ Name: 'Wren Ashby', Federation: 'OTHER', ParentFederation: 'OTH', Date: 'x' }),
      ]),
    );
    expect(result.withheld).toEqual([]);
  });

  it('skips a blank line rather than withholding it', async () => {
    // A trailing newline is a property of the file and not a row anybody wrote.
    // Counting it against the withheld budget spends the budget on punctuation.
    const rows = corpus([row()]);
    const result = await buildAthleteMirror(DOCUMENT, () => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for await (const line of rows()) {
          yield line;
        }
        yield '';
      },
    }));
    expect(result.withheld).toEqual([]);
  });

  it('still charges a blank line a line number, so later rows are findable', async () => {
    // The pair to the test above, and the one that pays for it. A blank line is
    // skipped, but the number's only job is to send a maintainer to that row in a
    // file of eight hundred megabytes -- so a skipped line that costs nothing
    // names every later row one early, and the report is wrong in exactly the
    // situation it was printed for. Line 4 here: header, row, blank, bad row.
    const rows = corpus([row()]);
    const bad = [row({ Date: 'unknown' }).join(',')];
    const result = await buildAthleteMirror(DOCUMENT, () => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for await (const line of rows()) {
          yield line;
        }
        yield '';
        yield* bad;
      },
    }));
    expect(result.withheld).toEqual([{ line: 4, reason: 'the date is not YYYY-MM-DD' }]);
  });

  it('skips a blank line even where the archive holds a nameless row', async () => {
    // Why the skip is a skip and not a consequence of the scope check. A row with
    // no name that matches the federation puts the empty string into scope, and
    // from that moment every blank line in the file looks like a lifter nobody
    // can name -- so a single malformed row eight hundred megabytes up turns the
    // file's own punctuation into thousands of withheld rows and blows the budget
    // over something that is not data.
    const rows = corpus([row(), row({ Name: '' })]);
    const result = await buildAthleteMirror(DOCUMENT, () => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<string> {
        for await (const line of rows()) {
          yield line;
        }
        yield '';
      },
    }));
    expect(result.withheld).toHaveLength(1);
    expect(result.withheld[0]?.line).toBe(3);
  });

  it('refuses an archive with no header at all', async () => {
    // A zero-byte download is what this looks like, and it is the failure most
    // likely to arrive unattended. Yielding an empty list rather than writing a
    // generator with no `yield` in it, which lints as a mistake and here is not.
    const nothing: readonly string[] = [];
    await expect(
      buildAthleteMirror(DOCUMENT, () => ({
        async *[Symbol.asyncIterator](): AsyncGenerator<string> {
          await Promise.resolve();
          yield* nothing;
        },
      })),
    ).rejects.toThrow(/not even a header row/u);
  });

  it('refuses a document that is not the shape it has to be', async () => {
    // Validated rather than trusted, because it is the file that decides which
    // ninety thousand people out of a million are published at all.
    await expect(
      buildAthleteMirror({ ...DOCUMENT, scopeNote: '' }, corpus([row()])),
    ).rejects.toThrow();
    await expect(
      buildAthleteMirror(
        { ...DOCUMENT, provenance: { ...DOCUMENT.provenance, url: 'http://example.invalid/x' } },
        corpus([row()]),
      ),
    ).rejects.toThrow();
    await expect(
      buildAthleteMirror(
        { ...DOCUMENT, scope: { federations: [], parentFederations: [] } },
        corpus([row()]),
      ),
    ).rejects.toThrow();
  });
});

describe('summarizeWithheld', () => {
  const rows = (reason: string, count: number, from = 1): WithheldEntryRow[] =>
    Array.from({ length: count }, (_unused, index) => ({ line: from + index, reason }));

  it('groups by rule and counts, rather than listing every row', () => {
    // At this scale one broken rule is tens of thousands of rows, and the full
    // list buries every other line of the build.
    expect(summarizeWithheld(rows('a bad date', 3))).toBe('3 x a bad date (lines 1, 2, 3)');
  });

  it('shows at most three line numbers per rule', () => {
    // Enough to go and look at, which is all a line number is for.
    expect(summarizeWithheld(rows('a bad date', 900))).toBe('900 x a bad date (lines 1, 2, 3)');
  });

  it('puts the largest group first', () => {
    const summary = summarizeWithheld([...rows('rare', 1, 100), ...rows('common', 5)]);
    expect(summary.split('\n')[0]).toContain('5 x common');
    expect(summary).toContain('1 x rare (lines 100)');
  });

  it('prints at most twenty rules', () => {
    const many = Array.from({ length: 30 }, (_unused, index) =>
      rows(`rule ${String(index)}`, 30 - index),
    ).flat();
    expect(summarizeWithheld(many).split('\n')).toHaveLength(20);
  });

  it('says nothing about nothing', () => {
    expect(summarizeWithheld([])).toBe('');
  });
});
