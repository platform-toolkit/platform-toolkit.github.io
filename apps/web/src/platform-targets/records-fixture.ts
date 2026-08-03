// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The one invented federation every test and story in this tool uses.
 *
 * Invented throughout, and deliberately so: real record figures belong in
 * published data, where a stale one is refreshed without a release, and a test
 * pinning a real one would have to be edited the week somebody breaks it. §5.1.
 *
 * Shaped to reach the awkward cases rather than the happy one. One level is
 * subdivided and one is not, so the region question has to be both asked and
 * omitted; there are three disciplines contesting four, one and two lifts, so a
 * card list of four is never the only shape; and the book leaves a hole in one
 * category on purpose, because "no record stands here" is the most useful thing
 * this panel says and the easiest state to never look at.
 *
 * Nothing that ships may import this file.
 */
import type {
  CategoryCatalog,
  ClassificationBook,
  ClassificationTable,
  DataMeta,
  FederationRecord,
  Lift,
  RecordBook,
} from '@platform-toolkit/data-contracts';

import type { CategorySelection, RecordPartition } from './selection.js';

/**
 * The published index, as the freshness line reads it.
 *
 * Two sources retrieved on different days, because the line prints the *oldest*
 * and a single-source fixture cannot tell a correct implementation from one that
 * prints whichever it saw last. The dates are invented like everything else here
 * and are far enough apart to read as a mistake if the wrong one appears.
 */
export const DATA_META: DataMeta = {
  schemaVersion: 1,
  generatedAt: '2026-07-31T06:00:00.000Z',
  sources: [
    {
      id: 'example-classifications',
      label: 'Example classification standards',
      retrievedAt: '2026-07-28T04:15:00.000Z',
      status: 'ok',
    },
    {
      id: 'example-records',
      label: 'Example records',
      retrievedAt: '2026-07-30T04:15:00.000Z',
      status: 'ok',
    },
  ],
  artifacts: {},
};

export const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single-ply' },
  ],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [
        { id: 'f-52', label: '52 kg', maximumKilograms: 52 },
        { id: 'f-56', label: '56 kg', maximumKilograms: 56 },
      ],
    },
    {
      id: 'example-male',
      label: 'Male classes',
      sex: 'male',
      classes: [{ id: 'm-83', label: '83 kg', maximumKilograms: 83 }],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
    ],
  },
  levels: [
    // Subdivided, so the region question is asked and the partition is not
    // settled until it is answered.
    {
      id: 'state',
      label: 'State',
      regions: [
        { id: 'north-example', label: 'North Example' },
        { id: 'south-example', label: 'South Example' },
      ],
    },
    // Not subdivided. There is one national record, and the region question is
    // omitted entirely rather than rendered empty.
    { id: 'national', label: 'National', regions: [] },
  ],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
    { id: 'bench-only', label: 'Bench only', lifts: ['bench'] },
    { id: 'push-pull', label: 'Push pull', lifts: ['bench', 'deadlift', 'total'] },
  ],
};

/**
 * A lifter who has answered everything the report needs and nothing optional.
 *
 * `division` is `null` rather than `'open'`, and that is the shape of
 * requirement 2 rather than an omission: Open is not something a lifter picks,
 * it is the column the report always draws, and the picker offers only the
 * Masters and Juniors bands. A fixture that answered `'open'` would exercise a
 * state the interface cannot produce.
 */
export const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  comparisonWeightClass: null,
  division: null,
  tested: 'tested',
  region: null,
};

/**
 * The same lifter with every optional answer given as well.
 *
 * A second weight class, a masters division and a state, so the report is at its
 * widest: two columns, two divisions and both record partitions. Kept beside the
 * minimal one because the interesting failures are all in the difference --
 * a column that does not appear, a division that appears twice, a state read
 * that never starts.
 */
export const FULLY_ANSWERED: CategorySelection = {
  ...ANSWERED,
  comparisonWeightClass: 'f-52',
  division: 'masters-1',
  region: 'north-example',
};

interface RecordOverrides {
  readonly kilograms: number;
  readonly levelId?: string;
  readonly regionId?: string | null;
  readonly disciplineId?: string;
  /**
   * Which division holds it. Open unless a test is about requirement 2.
   *
   * Here rather than left to the default because Open and a masters division are
   * drawn side by side, and without a way to say "this one is a masters record"
   * every assertion about the pair is really an assertion about Open twice.
   */
  readonly divisionId?: string;
  readonly unclaimed?: boolean;
  /**
   * The pound figure the source printed, when it contradicts the kilograms.
   *
   * Settable because the caution the report draws for it sits beside the record
   * it is about, and a fixture that could not produce one would leave the only
   * state where a lifter is told not to trust a figure untested and unstoried.
   * Defaulted to `null`, which is what almost every real row carries.
   */
  readonly sourceDisagreement?: FederationRecord['sourceDisagreement'];
  readonly holderName?: string | null;
  readonly achievedOn?: string | null;
  readonly meetName?: string | null;
}

/**
 * One record in the answered lifter's category unless told otherwise.
 *
 * Every axis defaulted to {@link ANSWERED}'s, because a record matches exactly on
 * all nine and a test that spelled them out each time would be nine chances to
 * write a category the lookup then reports as empty -- which reads as the code
 * being wrong rather than the fixture.
 */
export function record(lift: Lift, overrides: RecordOverrides): FederationRecord {
  const {
    kilograms,
    levelId = 'national',
    regionId = null,
    disciplineId = 'full-power',
    divisionId = 'open',
    unclaimed = false,
    sourceDisagreement = null,
    holderName = 'Robin Vance',
    achievedOn = '2024-05-18',
    meetName = 'Example Winter Open',
  } = overrides;
  return {
    // Every axis the caller can vary is in the identifier, so two records that
    // differ are two rows -- and two calls with the same axes still collide,
    // which is how the duplicate-record fixtures are built.
    id: `${levelId}-${regionId ?? 'none'}-${disciplineId}-${divisionId}-${lift}`,
    scope: {
      levelId,
      regionId,
      sex: 'female',
      equipmentId: 'raw',
      disciplineId,
      weightClassId: 'f-56',
      divisionId,
      tested: true,
      lift,
    },
    kilograms,
    unclaimed,
    sourceDisagreement,
    // Both dropped for a seeded record, here as well as in the publisher, so a
    // fixture cannot describe a record that is unclaimed *and* held by somebody.
    // The panel would have to decide which of the two to believe, and a test
    // written against whichever it picked would pass while describing a row the
    // pipeline cannot produce.
    holderName: unclaimed ? null : holderName,
    achievedOn: unclaimed ? null : achievedOn,
    meetName: unclaimed ? null : meetName,
  };
}

/**
 * A book with a deliberate hole: nothing stands in the deadlift.
 *
 * Three of the four full-power lifts have a record and the fourth does not, so
 * the "no record stands in this category" card is on screen next to three that
 * do — which is the only arrangement in which anybody notices it says something
 * different from the others.
 */
export function bookOf(records: readonly FederationRecord[]): RecordBook {
  return {
    id: 'example',
    label: 'Example Federation records',
    // A federation that requires a margin. Zero would let every "would replace"
    // sentence pass while the arithmetic that adds the margin was missing.
    minimumIncrementKilograms: 0.5,
    // Larger than the margin above and different from it, so a test cannot pass
    // by using either figure where the other belongs.
    higherSanctionIncrementKilograms: 2.5,
    // National only. A seeded state record still has to be beaten, which is the
    // half of the rule that would go untested if this listed both levels.
    matchTakesUnclaimedLevelIds: ['national'],
    // One table, and deliberately not one per level: a record whose scope matches
    // nothing here is shown without a link, and that path needs a fixture too.
    sourceTables: [
      {
        levelId: 'national',
        regionId: null,
        tested: true,
        equipmentId: 'raw',
        disciplineId: 'full-power',
        url: 'https://records.example.test/records?level=national&event=raw-full-power',
      },
    ],
    // Copied rather than passed through. The contract's array is mutable -- it
    // is the output of a valibot parse -- and handing it a `readonly` one is a
    // type error the day a caller writes the argument as a literal instead.
    records: [...records],
  };
}

export const BOOK: RecordBook = bookOf([
  record('squat', { kilograms: 145 }),
  record('bench', { kilograms: 82.5 }),
  record('total', { kilograms: 390 }),
]);

/**
 * The two partitions this catalogue can settle on.
 *
 * One subdivided level and one that is not, so a report drawn from both has a
 * region in one label and none in the other -- and the pair is the only shape in
 * which "the state read failed while the national one succeeded" is reachable.
 */
export const NATIONAL: RecordPartition = { levelId: 'national', regionId: null, label: 'National' };

export const NORTH: RecordPartition = {
  levelId: 'state',
  regionId: 'north-example',
  label: 'North Example State',
};

/** A state book, so the two-partition case has something to draw in both columns. */
export const STATE_BOOK: RecordBook = bookOf([
  record('squat', { kilograms: 130, levelId: 'state', regionId: 'north-example' }),
]);

/**
 * One classification table, with invented figures (§5.1) chosen to *interleave*
 * with the record book rather than to be tidy.
 *
 * 100, 120 and 150 straddle the squat record's 145.5 target, which is the whole
 * point: the report's central claim is that a classification and a record are
 * one ladder, and a fixture whose standards all sat below every record would let
 * a merge that simply concatenated the two lists pass.
 */
export function classificationTable(
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
      // Null on every axis the report walks, which is the ordinary published
      // shape: one table serves every class and every division. It is also the
      // case the division-labelling rule turns on -- see the tests for it.
      weightClassId: null,
      divisionId: null,
      tested: null,
      ...overrides,
    },
    standards,
  };
}

export const CLASSIFICATIONS: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [
    classificationTable('squat'),
    classificationTable('bench'),
    classificationTable('deadlift'),
    classificationTable('total'),
  ],
};
