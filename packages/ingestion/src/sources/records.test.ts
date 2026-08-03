// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { CategoryCatalog, FederationRecord } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { RecordSourceError, buildRecordBook, readRecordSourceReferences } from './records.js';

/**
 * Every figure and every name below is invented. Real records live in
 * `data/sources/records/`, and a test asserting them would be a second place
 * they are written down -- so the day somebody broke one, the test would fail
 * for being correct.
 *
 * The holder names are deliberately made up too, and deliberately present: the
 * point of several of these cases is that a real name never reaches a message,
 * and a fixture with blank holders could not tell whether that held.
 */

const catalog: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single ply' },
  ],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Women',
      sex: 'female',
      classes: [
        { id: 'f-40', label: '40 kg', maximumKilograms: 40 },
        { id: 'f-open', label: '40+ kg', maximumKilograms: null },
      ],
    },
    {
      id: 'example-male',
      label: 'Men',
      sex: 'male',
      classes: [
        { id: 'm-60', label: '60 kg', maximumKilograms: 60 },
        { id: 'm-open', label: '60+ kg', maximumKilograms: null },
      ],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Example divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
      { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: 44 },
    ],
  },
  levels: [
    {
      id: 'state',
      label: 'State',
      regions: [
        { id: 'north', label: 'North' },
        { id: 'south', label: 'South' },
      ],
    },
    { id: 'national', label: 'National', regions: [] },
  ],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
    { id: 'bench-only', label: 'Bench only', lifts: ['bench'] },
  ],
};

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example',
    label: 'Example Federation',
    provenance: {
      id: 'example-records',
      label: 'Example records',
      document: 'Example published record tables',
      url: 'https://example.invalid/records',
      sections: ['State and national tables'],
      retrievedAt: '1999-01-01T00:00:00.000Z',
    },
    snapshot: { file: 'example-records.json', url: 'https://example.invalid/records' },
    book: {
      label: 'Example records',
      minimumIncrementKilograms: 0.5,
      // Larger than the margin above and different from it, so a test cannot
      // pass by reading either figure where the other belongs.
      higherSanctionIncrementKilograms: 2.5,
      // National only. A seeded state standard still has to be beaten, which is
      // the half of the rule that would go untested if this listed both.
      matchTakesUnclaimedLevelIds: ['national'],
    },
    tableUrl: 'https://example.invalid/records.php?l={location}&s={status}&e={event}',
    locations: [
      {
        location: 'north',
        levelId: 'state',
        regionId: 'north',
        titleLevel: 'State',
        titleRegion: 'North',
      },
      {
        location: 'south',
        levelId: 'state',
        regionId: 'south',
        titleLevel: 'State',
        titleRegion: 'South',
      },
      {
        location: 'nationwide',
        levelId: 'national',
        regionId: null,
        titleLevel: 'National',
        titleRegion: null,
      },
    ],
    statuses: [
      { status: 'tested', tested: true, titleStatus: 'Tested Records' },
      { status: 'untested', tested: false, titleStatus: 'Untested' },
    ],
    events: [
      {
        event: 'powerlifting',
        disciplineId: 'full-power',
        equipmentId: 'raw',
        titleGear: 'Raw',
        titleEvent: 'Full Power',
      },
      {
        event: 'bench',
        disciplineId: 'bench-only',
        equipmentId: 'single-ply',
        titleGear: 'Single Ply',
        titleEvent: 'Bench Only',
      },
    ],
    lifts: [
      { column: 'Squat', lift: 'squat' },
      { column: 'Bench', lift: 'bench' },
      { column: 'Deadlift', lift: 'deadlift' },
      { column: 'TOTAL', lift: 'total' },
    ],
    divisions: [
      { column: 'OPEN WOMEN', sex: 'female', divisionId: 'open' },
      { column: 'OPEN MEN', sex: 'male', divisionId: 'open' },
    ],
    weightClasses: [
      { sex: 'female', column: '40kg', weightClassId: 'f-40' },
      { sex: 'male', column: '60kg', weightClassId: 'm-60' },
    ],
    unmappedWeightClasses: [],
    absentLocations: [],
    // Empty by default, and every case that maps one also publishes a row
    // carrying it -- an unmatched placeholder is a reported problem, so a
    // fixture that mapped one globally would make every other case fail for a
    // reason that has nothing to do with what it is about.
    placeholderHolders: [],
    plausibility: {
      minimumKilograms: 15,
      maximumSingleLiftKilograms: 700,
      maximumTotalKilograms: 1600,
      maximumExcludedRows: 10,
    },
    // The factor the fixture's own pound cells were written against, so an
    // unmodified build finds no disagreement and every case below that wants one
    // has to state it. The budget is one, which is the smallest figure that lets
    // a single contradicting row publish and a second one trip the check --
    // testing both halves without either needing an override.
    columnCrossCheck: {
      poundsPerKilogram: 2.2046226,
      toleranceKilograms: 0.5,
      maximumDisagreements: 1,
    },
    ...overrides,
  };
}

/** One crawled table. `rows` are cells in the crawler's column order. */
function table(
  location: string,
  status: string,
  event: string,
  title: string,
  rows: readonly (readonly string[])[],
): Record<string, unknown> {
  return { location, status, event, title, rows };
}

/**
 * The tables the unmodified fixture publishes.
 *
 * Its own function rather than an inline literal in `snapshot`, because most
 * cases below replace the first table and keep the rest. Reaching them through
 * `snapshot().tables` needs a cast -- the factory answers an index signature --
 * and a cast to `unknown[]` would keep compiling the day the shape changes.
 */
function baseTables(): readonly Record<string, unknown>[] {
  return [
    table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
      ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '220.46', '05/18/2024'],
      ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '400.00', '881.85', '2024-05-18'],
    ]),
    table('south', 'untested', 'bench', 'State/Untested/South/Single Ply/Bench Only', [
      ['OPEN WOMEN', '40kg', 'Bench', 'Kit Alvarez', '70.00', '154.32', '01/02/2023'],
    ]),
    // Every mapped column appears here as well as in the state tables, so that
    // a case which replaces one table does not accidentally also test what
    // happens when a lift or a division stops being published.
    table('nationwide', 'tested', 'powerlifting', 'National/Tested Records/Raw/Full Power', [
      ['OPEN MEN', '60kg', 'Deadlift', 'Ash Whitfield', '250.00', '551.15', '03/04/2022'],
      ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '110.00', '242.51', '03/04/2022'],
      ['OPEN WOMEN', '40kg', 'TOTAL', 'Robin Vance', '280.00', '617.29', '03/04/2022'],
    ]),
    table('nationwide', 'untested', 'bench', 'National/Untested/Single Ply/Bench Only', [
      ['OPEN WOMEN', '40kg', 'Bench', 'Robin Vance', '72.50', '159.83', '06/07/2021'],
    ]),
  ];
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    partial: false,
    columns: ['division', 'weightClass', 'lift', 'holder', 'kilograms', 'pounds', 'date'],
    tables: baseTables(),
    absent: [],
    ...overrides,
  };
}

/** How many records the unmodified fixture produces. */
const BUILT_RECORDS = 7;

/**
 * One record by identifier.
 *
 * By identifier rather than by lift, because several tables publish the same
 * lift and a `find` on one axis would silently start reading a different row the
 * next time the fixture grows.
 */
function recordById(
  records: readonly FederationRecord[],
  id: string,
): FederationRecord | undefined {
  return records.find((record) => record.id === id);
}

/** The problems reported by a build that should have failed. */
function problemsFrom(
  candidate: unknown,
  crawl: unknown = snapshot(),
  categories: CategoryCatalog = catalog,
): readonly string[] {
  try {
    buildRecordBook(candidate, crawl, categories);
  } catch (error) {
    if (error instanceof RecordSourceError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected the record source to be rejected, but it was accepted.');
}

describe('readRecordSourceReferences', () => {
  it('answers what a caller needs before it can read anything', () => {
    expect(readRecordSourceReferences(document())).toEqual({
      federationId: 'example',
      snapshotFile: 'example-records.json',
      snapshotUrl: 'https://example.invalid/records',
      tableUrl: 'https://example.invalid/records.php?l={location}&s={status}&e={event}',
    });
  });

  it('refuses a snapshot reference that could climb out of the snapshot directory', () => {
    const problems = problemsFrom(
      document({ snapshot: { file: '../../etc/passwd.json', url: null } }),
    );

    expect(problems).toEqual(['snapshot.file: expected a plain JSON filename']);
  });

  it('refuses a snapshot URL carrying credentials', () => {
    // Committed and reviewed rather than user-supplied, but a credential pasted
    // into a URL has to be a failed parse rather than a value in a build log.
    const problems = problemsFrom(
      document({
        snapshot: { file: 'example-records.json', url: 'https://user:secret@example.invalid/r' },
      }),
    );

    expect(problems).toEqual(['snapshot.url: expected a URL with no embedded credentials']);
  });
});

describe('buildRecordBook', () => {
  it('builds a record book and a freshness entry from a well-formed mapping and crawl', () => {
    const { book, freshness, withheld } = buildRecordBook(document(), snapshot(), catalog);

    expect(book.id).toBe('example');
    expect(book.label).toBe('Example records');
    expect(book.minimumIncrementKilograms).toBe(0.5);
    expect(book.records).toHaveLength(BUILT_RECORDS);
    expect(withheld).toEqual([]);
    expect(freshness).toEqual({
      id: 'example-records',
      label: 'Example records (Example published record tables)',
      // The date the crawl was described, not the date this test ran.
      retrievedAt: '1999-01-01T00:00:00.000Z',
      status: 'ok',
    });
  });

  it('resolves every axis of a row into the scope a lookup will ask for', () => {
    const { book } = buildRecordBook(document(), snapshot(), catalog);
    const record = recordById(
      book.records,
      'example/state/north/female/raw/full-power/f-40/open/tested/squat',
    );

    expect(record?.scope).toEqual({
      levelId: 'state',
      regionId: 'north',
      sex: 'female',
      equipmentId: 'raw',
      disciplineId: 'full-power',
      weightClassId: 'f-40',
      divisionId: 'open',
      tested: true,
      lift: 'squat',
    });
    expect(record?.kilograms).toBe(100);
    expect(record?.holderName).toBe('Robin Vance');
    expect(record?.achievedOn).toBe('2024-05-18');
    // The tables carry no meet name. Deriving one from the date would be a guess
    // rendered on screen as a fact.
    expect(record?.meetName).toBeNull();
  });

  it('normalises both published date formats to one', () => {
    const { book } = buildRecordBook(document(), snapshot(), catalog);
    const american = recordById(
      book.records,
      'example/state/north/female/raw/full-power/f-40/open/tested/squat',
    );
    const iso = recordById(
      book.records,
      'example/state/north/male/raw/full-power/m-60/open/tested/total',
    );

    // The federation prints both. Normalising here rather than in the crawler
    // keeps the snapshot a record of what was actually served.
    expect(american?.achievedOn).toBe('2024-05-18');
    expect(iso?.achievedOn).toBe('2024-05-18');
  });

  it('tidies a holder name’s whitespace and changes nothing else about it', () => {
    const { book } = buildRecordBook(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', '  Renée  O’Shea-Blå  ', '100', '0', ''],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );
    const record = recordById(
      book.records,
      'example/state/north/female/raw/full-power/f-40/open/tested/squat',
    );

    // Padding and doubled spaces are a rendering artefact of the source table.
    // The accent, the apostrophe and the hyphen are how somebody's name is
    // spelled, and a build has no business correcting any of them.
    expect(record?.holderName).toBe('Renée O’Shea-Blå');
    // A blank date is the source omitting it, which is a fact worth keeping.
    expect(record?.achievedOn).toBeNull();
  });

  it('marks a seeded figure unclaimed and keeps the figure itself', () => {
    // A tenth of the real corpus. Founding a record book means writing a figure
    // into every category so the first lifter in it has something to beat, and
    // the holder column says so rather than naming anybody. Dropping the row
    // would tell a lifter any qualifying weight sets the first record.
    const { book } = buildRecordBook(
      document({
        placeholderHolders: [{ holder: 'Record Preset', reason: 'The federation’s own seed.' }],
      }),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Record Preset', '100.00', '220.46', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );
    const record = recordById(
      book.records,
      'example/state/north/female/raw/full-power/f-40/open/tested/squat',
    );

    expect(record?.kilograms).toBe(100);
    expect(record?.unclaimed).toBe(true);
    // The wording is not a lifter and the founding date is not a day any lift
    // was made. Publishing either asserts a lift happened.
    expect(record?.holderName).toBeNull();
    expect(record?.achievedOn).toBeNull();
  });

  it('matches a placeholder however the source capitalises and spaces it', () => {
    // The tables are hand-maintained. An unmatched variant publishes silently as
    // a lifter holding thousands of records, which is the failure this exists to
    // prevent -- so the comparison is on the whitespace-collapsed, lowercased
    // cell rather than on the literal string.
    const { book } = buildRecordBook(
      document({
        placeholderHolders: [{ holder: 'Record Preset', reason: 'The federation’s own seed.' }],
      }),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', ' record   PRESET ', '100.00', '220.46', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );

    expect(
      recordById(book.records, 'example/state/north/female/raw/full-power/f-40/open/tested/squat')
        ?.unclaimed,
    ).toBe(true);
  });

  it('says a real holder is not a placeholder', () => {
    // The other half of the flag, and the one that would fail silently: a
    // predicate that answered `true` for everything would pass every assertion
    // above while erasing every holder in the corpus.
    const { book } = buildRecordBook(
      document({
        placeholderHolders: [{ holder: 'Record Preset', reason: 'The federation’s own seed.' }],
      }),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Record Preset', '100.00', '220.46', '05/18/2024'],
            ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '400.00', '881.85', '2024-05-18'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );
    const held = recordById(
      book.records,
      'example/state/north/male/raw/full-power/m-60/open/tested/total',
    );

    expect(held?.unclaimed).toBe(false);
    expect(held?.holderName).toBe('Sam Ortiz');
    expect(held?.achievedOn).toBe('2024-05-18');
  });

  it('reports a mapped placeholder that no longer appears in any row', () => {
    // A rename looks exactly like this from inside the build, and the other
    // direction is undetectable by definition -- so a stale entry is worth
    // failing over rather than tidying away as unused.
    const problems = problemsFrom(
      document({
        placeholderHolders: [{ holder: 'Record Preset', reason: 'The federation’s own seed.' }],
      }),
      snapshot(),
    );

    expect(problems).toEqual([
      'placeholder holders: "Record Preset" is mapped as a placeholder and appears in no ' +
        'published row. Either the federation renamed it -- in which case the new wording is ' +
        'being published as a lifter -- or it is gone.',
    ]);
  });

  it('sorts records by identifier rather than leaving them in crawl order', () => {
    const { book } = buildRecordBook(document(), snapshot(), catalog);
    const ids = book.records.map((record) => record.id);

    // Artifacts are content-addressed, so a source that merely reordered its rows
    // would otherwise rewrite every filename and evict a cache still correct.
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe('example/national/all/female/raw/full-power/f-40/open/tested/squat');
  });

  it('reports a mapping built for another federation on its own', () => {
    const problems = problemsFrom(document({ id: 'other' }), snapshot(), catalog);

    // Alone, because every vocabulary message below it would be noise.
    expect(problems).toEqual([
      'mapping is for federation "other" but was given the catalogue for "example"',
    ]);
  });

  it('refuses a partial crawl outright', () => {
    const problems = problemsFrom(document(), snapshot({ partial: true }));

    // A `--limit` crawl publishes whole regions as though the federation kept no
    // records in them, which on screen is indistinguishable from the truth.
    expect(problems).toEqual([
      'example-records.json: is a partial crawl. Publishing it would report whole regions as ' +
        'having no records. Re-run the crawl without --limit.',
    ]);
  });

  it('refuses a crawl whose columns are not the ones this build reads', () => {
    // Cells are positional. Reordered, the holder's name reaches the weight
    // parser and a lifter reads somebody else's total.
    const problems = problemsFrom(
      document(),
      snapshot({
        columns: ['division', 'weightClass', 'lift', 'kilograms', 'holder', 'pounds', 'date'],
      }),
    );

    expect(problems).toEqual([
      'example-records.json: columns: expected the columns this build reads, in order: ' +
        'division, weightClass, lift, holder, kilograms, pounds, date',
    ]);
  });

  it('reports a published value nothing maps, and a mapping nothing uses, in both directions', () => {
    const problems = problemsFrom(
      document({
        divisions: [
          { column: 'OPEN WOMEN', sex: 'female', divisionId: 'open' },
          { column: 'MASTER MEN 40 TO 44', sex: 'male', divisionId: 'master-1' },
        ],
      }),
    );

    // One of each. A federation that adds a division and one that removes one are
    // different situations, and neither is visible from the other side.
    expect(problems).toEqual([
      'division column: the crawl uses "OPEN MEN", which nothing maps',
      'division column: "MASTER MEN 40 TO 44" is mapped but the crawl never uses it',
    ]);
  });

  it('refuses an identifier the catalogue does not define', () => {
    const problems = problemsFrom(
      document({
        events: [
          {
            event: 'powerlifting',
            disciplineId: 'full-power',
            equipmentId: 'wraps',
            titleGear: 'Raw',
            titleEvent: 'Full Power',
          },
          {
            event: 'bench',
            disciplineId: 'bench-only',
            equipmentId: 'single-ply',
            titleGear: 'Single Ply',
            titleEvent: 'Bench Only',
          },
        ],
      }),
    );

    expect(problems).toEqual([
      'events: "powerlifting" maps to equipment "wraps", which the catalogue does not define',
    ]);
  });

  it('refuses a class mapped into the other sex’s ladder', () => {
    const problems = problemsFrom(
      document({
        weightClasses: [
          { sex: 'female', column: '40kg', weightClassId: 'm-60' },
          { sex: 'male', column: '60kg', weightClassId: 'm-60' },
        ],
      }),
    );

    // Named against the ladder rather than the catalogue as a whole: a men's
    // class written under a women's column is the mistake worth naming exactly.
    expect(problems).toEqual([
      'weight classes: female "40kg" maps to "m-60", which is not in the female ladder',
    ]);
  });

  it('refuses a region-scoped location that names no region, because nothing could ask for it', () => {
    const problems = problemsFrom(
      document({
        locations: [
          {
            location: 'north',
            levelId: 'state',
            regionId: null,
            titleLevel: 'State',
            titleRegion: null,
          },
          {
            location: 'south',
            levelId: 'state',
            regionId: 'south',
            titleLevel: 'State',
            titleRegion: 'South',
          },
          {
            location: 'nationwide',
            levelId: 'national',
            regionId: null,
            titleLevel: 'National',
            titleRegion: null,
          },
        ],
      }),
    );

    // `null` means the level has no regions. It is never shorthand for all of
    // them: the browser builds its request from a region a lifter picked.
    expect(problems).toEqual([
      'locations: "north" names no region, but level "state" is divided into regions, so ' +
        'nothing could ever ask for it',
      'locations: the catalogue has region "north" under level "state", but no location maps to it',
    ]);
  });

  it('refuses a catalogue region no location reaches', () => {
    const withEast: CategoryCatalog = {
      ...catalog,
      levels: [
        {
          id: 'state',
          label: 'State',
          regions: [
            { id: 'north', label: 'North' },
            { id: 'south', label: 'South' },
            { id: 'east', label: 'East' },
          ],
        },
        { id: 'national', label: 'National', regions: [] },
      ],
    };
    const problems = problemsFrom(document(), snapshot(), withEast);

    // A region on screen with no records behind it reads as a region where
    // nobody has set one, which is a different and much better situation.
    expect(problems).toEqual([
      'locations: the catalogue has region "east" under level "state", but no location maps to it',
    ]);
  });

  it('refuses two locations resolving to one level and region', () => {
    const problems = problemsFrom(
      document({
        locations: [
          {
            location: 'north',
            levelId: 'state',
            regionId: 'north',
            titleLevel: 'State',
            titleRegion: 'North',
          },
          {
            location: 'south',
            levelId: 'state',
            regionId: 'north',
            titleLevel: 'State',
            titleRegion: 'North',
          },
          {
            location: 'nationwide',
            levelId: 'national',
            regionId: null,
            titleLevel: 'National',
            titleRegion: null,
          },
        ],
      }),
    );

    // Two sets of records for one place, where the second silently replaces the
    // first -- or, once ids collide, fails the build for a reason further away.
    expect(problems).toContain('level and region: "state / north" is used more than once');
  });

  it('refuses a table whose own heading disagrees with the identifiers that reached it', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/South/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '220.46', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
    );

    // The heading is the only cross-check there is. Without it a stale link files
    // one region's records under another's and every figure looks plausible.
    expect(problems).toEqual([
      'north/tested/powerlifting: is headed "State/Tested Records/South/Raw/Full Power" but the ' +
        'mapping expects "State/Tested Records/North/Raw/Full Power"',
    ]);
  });

  it('withholds a row whose class the rulebook ladder does not contain, with the curated reason', () => {
    const { book, withheld } = buildRecordBook(
      document({
        unmappedWeightClasses: [
          { sex: 'female', column: '140+kg', reason: 'a column the women’s ladder has never had' },
        ],
      }),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '220.46', '05/18/2024'],
            ['OPEN WOMEN', '140+kg', 'Squat', 'Robin Vance', '150.00', '330.69', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );

    // One fewer than the untouched fixture: the replaced table publishes one
    // usable row where it published two.
    expect(book.records).toHaveLength(BUILT_RECORDS - 1);
    expect(withheld).toEqual([
      {
        row: 'north/tested/powerlifting / OPEN WOMEN / 140+kg / Squat',
        reason: 'a column the women’s ladder has never had',
      },
    ]);
  });

  it('withholds a lift the table’s discipline does not contest', () => {
    const { withheld } = buildRecordBook(
      document(),
      snapshot({
        tables: [
          ...baseTables().slice(0, 1),
          table('south', 'untested', 'bench', 'State/Untested/South/Single Ply/Bench Only', [
            ['OPEN WOMEN', '40kg', 'Bench', 'Kit Alvarez', '70.00', '154.32', '01/02/2023'],
            // A deadlift printed on a bench-only table. Published onward it is a
            // bench-only record for a lift that meet did not contest.
            ['OPEN WOMEN', '40kg', 'Deadlift', 'Kit Alvarez', '130.00', '286.60', '01/02/2023'],
          ]),
          ...baseTables().slice(2),
        ],
      }),
      catalog,
    );

    expect(withheld).toEqual([
      {
        row: 'south/untested/bench / OPEN WOMEN / 40kg / Deadlift',
        reason: 'discipline "bench-only" does not contest the deadlift',
      },
    ]);
  });

  it('withholds a figure outside the plausibility band, and says which band it left', () => {
    const { withheld } = buildRecordBook(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '2.50', '5.51', '05/18/2024'],
            // Under the single-lift ceiling and over the total's -- which is why
            // the ceiling depends on the lift rather than being one number.
            ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '1900.00', '4188.78', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );

    expect(withheld).toEqual([
      {
        row: 'north/tested/powerlifting / OPEN WOMEN / 40kg / Squat',
        reason: 'figure is below 15 kg',
      },
      {
        row: 'north/tested/powerlifting / OPEN MEN / 60kg / TOTAL',
        reason: 'figure is above 1600 kg for a total',
      },
    ]);
  });

  it('fails when more rows are excluded than the mapping budgets for', () => {
    const rows = Array.from({ length: 12 }, (_unused, index) => [
      'OPEN WOMEN',
      '40kg',
      'Squat',
      `Holder ${String(index)}`,
      '1.00',
      '2.20',
      '05/18/2024',
    ]);
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table(
            'north',
            'tested',
            'powerlifting',
            'State/Tested Records/North/Raw/Full Power',
            rows,
          ),
          ...baseTables().slice(1),
        ],
      }),
    );

    // The check that catches a parser regression: every exclusion rule is one a
    // shifted column satisfies thousands of rows at a time, and without a budget
    // the result is a green build publishing a fraction of the records.
    expect(problems).toEqual([
      'exclusions: 12 rows were excluded, and the mapping allows 10. Either the tables changed ' +
        'shape or the budget needs revisiting; do not raise it without reading the reasons.',
    ]);
  });

  it('publishes a row whose pound column contradicts its kilogram column, and says so', () => {
    const { book } = buildRecordBook(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            // A decimal point moved. The kilogram cell is a plausible squat and
            // the pound cell is a tenth of one; arithmetic cannot say which cell
            // is the corrupt one, so the row publishes and shows both.
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '22.05', '05/18/2024'],
            ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '400.00', '881.85', '2024-05-18'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );

    const squat = recordById(
      book.records,
      'example/state/north/female/raw/full-power/f-40/open/tested/squat',
    );
    // Kilograms govern. The contradiction is recorded beside the figure, never
    // instead of it and never folded into it.
    expect(squat?.kilograms).toBe(100);
    expect(squat?.sourceDisagreement).toEqual({ pounds: 22.05, impliedKilograms: 10 });

    // Everything else is untouched: this withholds nothing and corrects nothing.
    expect(book.records).toHaveLength(BUILT_RECORDS);
    expect(
      recordById(book.records, 'example/state/north/male/raw/full-power/m-60/open/tested/total')
        ?.sourceDisagreement,
    ).toBeNull();
  });

  it('reads a blank pound cell as a missing figure rather than as a contradiction', () => {
    const { book } = buildRecordBook(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            // Thousands of real rows print exactly this. Read as a figure it
            // contradicts every weight there is, and the caution would land on a
            // tenth of the corpus over a cell nobody filled in.
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '0.00', '05/18/2024'],
            // Unreadable rather than empty, and equally not evidence of
            // anything: the pound column is a second witness, and a build that
            // refused a good kilogram figure over it would have made the witness
            // into the evidence.
            ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '400.00', '--', '2024-05-18'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
      catalog,
    );

    expect(book.records).toHaveLength(BUILT_RECORDS);
    for (const record of book.records) {
      expect(record.sourceDisagreement).toBeNull();
    }
  });

  it('fails when more columns disagree than the mapping budgets for', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '22.05', '05/18/2024'],
            ['OPEN MEN', '60kg', 'TOTAL', 'Sam Ortiz', '400.00', '88.19', '2024-05-18'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
    );

    // The budget is not a data-quality bar -- these rows would have published.
    // It is what notices the pound column starting to hold a different quantity,
    // which is silent and puts a wrong figure in front of every lifter.
    expect(problems).toEqual([
      'column cross-check: 2 rows have a pound column that disagrees with the kilogram column ' +
        'by more than 0.5 kg, and the mapping allows 1. Nothing is withheld for this; the budget ' +
        'is here to catch a column that changed meaning.',
    ]);
  });

  it('reports an unreadable figure rather than withholding it, and never quotes the holder', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '1oo', '220.46', '05/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
    );

    // No budget absorbs this one: a figure that is not a number is the parser
    // being wrong, not the federation publishing something unusual.
    expect(problems).toEqual([
      'north/tested/powerlifting / OPEN WOMEN / 40kg / Squat: value is not a plain decimal number: "1oo"',
    ]);
    expect(problems.join('\n')).not.toContain('Robin');
  });

  it('reports an unreadable date by position, naming neither the holder nor the date', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '220.46', '18/05/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
    );

    expect(problems).toEqual([
      'north/tested/powerlifting / OPEN WOMEN / 40kg / Squat: the date is unreadable: month is outside 01-12',
    ]);
    expect(problems.join('\n')).not.toContain('Robin');
  });

  it('refuses two published rows for one category', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table('north', 'tested', 'powerlifting', 'State/Tested Records/North/Raw/Full Power', [
            ['OPEN WOMEN', '40kg', 'Squat', 'Robin Vance', '100.00', '220.46', '05/18/2024'],
            ['OPEN WOMEN', '40kg', 'Squat', 'Kit Alvarez', '105.00', '231.49', '06/18/2024'],
          ]),
          ...baseTables().slice(1),
        ],
      }),
    );

    // Left alone one silently replaces the other, and which one wins depends on
    // the order the crawl happened to read them in.
    expect(problems).toEqual([
      'north/tested/powerlifting / OPEN WOMEN / 40kg / Squat: is the second published record for ' +
        '"example/state/north/female/raw/full-power/f-40/open/tested/squat"',
    ]);
  });

  it('caps one kind of problem so a thousand-fold mistake cannot hide the others', () => {
    const rows = Array.from({ length: 25 }, (_unused, index) => [
      'OPEN WOMEN',
      '40kg',
      'Squat',
      `Holder ${String(index)}`,
      'not a number',
      '0',
      '05/18/2024',
    ]);
    const problems = problemsFrom(
      document(),
      snapshot({
        tables: [
          table(
            'north',
            'tested',
            'powerlifting',
            'State/Tested Records/North/Raw/Full Power',
            rows,
          ),
          ...baseTables().slice(1),
        ],
      }),
    );

    expect(problems).toHaveLength(21);
    expect(problems.at(-1)).toBe('figures: and 5 more of the same kind');
  });

  it('requires an unanswered location to be accounted for, and an accounted one to be unanswered', () => {
    const unanswered = problemsFrom(
      document(),
      snapshot({
        absent: [
          {
            target: { location: 'elsewhere', status: 'tested', event: 'powerlifting' },
            reason: 'answered 503',
          },
        ],
      }),
    );
    expect(unanswered).toEqual([
      'absences: the crawl reached no tables for "elsewhere", which nothing accounts for',
    ]);

    const stale = problemsFrom(
      document({
        absentLocations: [{ location: 'elsewhere', reason: 'no records have been configured' }],
      }),
    );
    // A location that starts answering is a region whose records would otherwise
    // never be published, with nothing on screen to say so.
    expect(stale).toEqual([
      'absences: "elsewhere" is listed as absent but the crawl never tried it. Remove the entry: ' +
        '"no records have been configured"',
    ]);
  });

  it('refuses a location that answered for some of its tables and not others', () => {
    const problems = problemsFrom(
      document(),
      snapshot({
        absent: [
          {
            target: { location: 'north', status: 'untested', event: 'bench' },
            reason: 'answered 503',
          },
        ],
      }),
    );

    // Publishing part of a region's records with nothing to say the rest are
    // missing is indistinguishable from a region that simply holds fewer.
    expect(problems).toEqual([
      'absences: "north" answered for some of its tables and not others. Re-run the crawl; if it ' +
        'is permanent, the mapping needs to say so per table rather than per location.',
    ]);
  });

  it('accepts a location that is wholly absent and accounted for', () => {
    const { book } = buildRecordBook(
      document({
        absentLocations: [{ location: 'elsewhere', reason: 'no records have been configured' }],
      }),
      snapshot({
        absent: [
          {
            target: { location: 'elsewhere', status: 'tested', event: 'powerlifting' },
            reason: 'answered 503',
          },
        ],
      }),
      catalog,
    );

    expect(book.records).toHaveLength(BUILT_RECORDS);
  });

  it('reports every problem at once rather than the first', () => {
    const problems = problemsFrom(
      document({
        statuses: [
          { status: 'tested', tested: true, titleStatus: 'Tested Records' },
          { status: 'untested', tested: true, titleStatus: 'Untested' },
        ],
        lifts: [
          { column: 'Squat', lift: 'squat' },
          { column: 'Bench', lift: 'bench' },
          { column: 'Deadlift', lift: 'deadlift' },
          { column: 'TOTAL', lift: 'squat' },
        ],
      }),
    );

    // Two published books merged into one, and one lift published under two
    // columns. A mapping is edited by a person working through a website; one
    // problem per build costs one build per mistake.
    expect(problems).toEqual([
      'tested flag: "true" is used more than once',
      'lift: "squat" is used more than once',
    ]);
  });

  it('reports a malformed mapping by path and expectation, never by value', () => {
    const problems = problemsFrom(document({ locations: [] }));

    expect(problems).toEqual(['locations: expected >=1']);
  });

  it('ignores the comment keys a curated mapping explains itself with', () => {
    const { book } = buildRecordBook(
      document({ $comment: ['why this file exists'], '$comment:book': ['and this key'] }),
      snapshot(),
      catalog,
    );

    expect(book).not.toHaveProperty('$comment');
  });
});
