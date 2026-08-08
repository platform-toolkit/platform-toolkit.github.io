// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One invented federation and one invented archive, for every test in this package.
 *
 * Section 5.1 keeps federation numbers out of source, and a test fixture is source.
 * A fixture holding a real ladder is a second copy of it: it reads as authoritative
 * to whoever finds it, and it keeps asserting the old figures for years after the
 * rulebook moved. So the ladder below is chosen to be *unlike* anything published --
 * 62, 78, 94, 112 and over, where every real ladder this project reads has a 90 and
 * a 100 in it -- and the age bands are a ten-year Masters where the published ones
 * are five. A test that quietly hard-coded a real figure fails here.
 *
 * There is a second reason the numbers are unlike the real ones, particular to this
 * tool. Nearly everything here is about *not* translating one document's vocabulary
 * into another's, and the easiest way to write a test that proves nothing is to give
 * the archive and the federation the same fixture. The archive labels below are the
 * archive's (`Raw`, `M`, `90`, `SBD`) and the federation's identifiers are the
 * federation's (`raw`, `male`, `to-94`), and where the two happen to coincide -- as
 * `Raw` and `Raw` do -- that coincidence is the thing under test rather than the
 * setup for it.
 *
 * **Patch it, do not fork it.** {@link entry} takes a partial, so a test that needs
 * a bombed squat or a guest placing says exactly that at the point it matters.
 *
 * Not shipped: the package tsconfig excludes `*.fixture.ts` alongside `*.test.ts`,
 * so `dist` holds only what a consumer loads.
 */

import type {
  AgeDivision,
  AthleteEntry,
  ClassificationScope,
  ClassificationTable,
  EquipmentCategory,
  QualifyingFederationRules,
  QualifyingMeet,
  QualifyingMeetBook,
  QualifyingRoute,
  WeightClass,
  WeightClassLadderData,
} from '@platform-toolkit/data-contracts';

import type { CatalogVocabulary } from '../types.js';
import { performanceWindow, type PerformanceWindow } from './window.js';

/**
 * Three equipment categories, one of which is spelled the way the archive spells it.
 *
 * `raw` is here *because* the archive also prints `Raw`. The whole of
 * `category-match.ts` turns on that coincidence not being evidence, and a fixture
 * whose labels never collided could not tell a refusal to pre-select from a failure
 * to match at all.
 */
export const EQUIPMENT_FIXTURE: readonly EquipmentCategory[] = [
  { id: 'raw', label: 'Raw' },
  { id: 'raw-wraps', label: 'Raw with Wraps' },
  { id: 'single-ply', label: 'Single-ply' },
];

/** An invented ladder with no boundary any real federation publishes. */
export const WEIGHT_CLASSES_FIXTURE: readonly WeightClass[] = [
  { id: 'to-62', label: '62 kg', maximumKilograms: 62 },
  { id: 'to-78', label: '78 kg', maximumKilograms: 78 },
  { id: 'to-94', label: '94 kg', maximumKilograms: 94 },
  { id: 'to-112', label: '112 kg', maximumKilograms: 112 },
  { id: 'over-112', label: '112+ kg', maximumKilograms: null },
];

/**
 * A second invented ladder that shares not one boundary with the first.
 *
 * Disjoint on purpose, and it is the only reason the fixture has two. A real pair of
 * ladders overlaps heavily in the middle -- both federations' sexes compete at 60, at
 * 75, at 90 -- so a test written against a realistic pair passes whichever ladder the
 * code reaches for, right up to the ends. Sharing no boundary and no identifier makes
 * "read the wrong sex's ladder" a failure rather than a coincidence: every class here
 * is absent from the list above, so a proposal off the wrong one cannot resolve at all.
 *
 * Every figure invented (section 5.1).
 */
export const FEMALE_WEIGHT_CLASSES_FIXTURE: readonly WeightClass[] = [
  { id: 'f-to-47', label: '47 kg', maximumKilograms: 47 },
  { id: 'f-to-59', label: '59 kg', maximumKilograms: 59 },
  { id: 'f-to-71', label: '71 kg', maximumKilograms: 71 },
  { id: 'f-over-71', label: '71+ kg', maximumKilograms: null },
];

/**
 * The two ladders, published the way a catalogue publishes them.
 *
 * Female first, which is not the order anything reads them in and is why it is written
 * that way: a lookup that returned the first entry instead of the one matching the sex
 * would pass on a male-first list, because male is what nearly every fixture here
 * competes as.
 */
export const WEIGHT_CLASS_LADDERS_FIXTURE: readonly WeightClassLadderData[] = [
  // Copied rather than shared. `WeightClassLadderData.classes` is what valibot infers
  // from the schema, which is a mutable array, and handing it the very list every test
  // in this package asserts against would let one `sort` or `push` anywhere rewrite the
  // fixture for every other test in the file.
  {
    id: 'invented-female',
    label: 'Female',
    sex: 'female',
    classes: [...FEMALE_WEIGHT_CLASSES_FIXTURE],
  },
  { id: 'invented-male', label: 'Male', sex: 'male', classes: [...WEIGHT_CLASSES_FIXTURE] },
];

/**
 * Five divisions, arranged so that an approximate age straddles a boundary.
 *
 * `submaster` ends at 39 and `master-1` begins at 40, which is the case the archive's
 * half-year ages land on: a lifter recorded as "39 or 40" is a Submaster on one
 * reading and a Master on the other. `open` has a floor rather than two nulls,
 * because a real published Open division does -- see `openAgeDivision` in the domain
 * package for why the two-nulls shape is a trap.
 */
export const TEEN_FIXTURE: AgeDivision = {
  id: 'teen',
  label: 'Teen',
  minimumAge: 14,
  maximumAge: 19,
};
export const JUNIOR_FIXTURE: AgeDivision = {
  id: 'junior',
  label: 'Junior',
  minimumAge: 20,
  maximumAge: 24,
};
export const OPEN_FIXTURE: AgeDivision = {
  id: 'open',
  label: 'Open',
  minimumAge: 14,
  maximumAge: null,
};
export const SUBMASTER_FIXTURE: AgeDivision = {
  id: 'submaster',
  label: 'Submaster',
  minimumAge: 34,
  maximumAge: 39,
};
export const MASTER_FIXTURE: AgeDivision = {
  id: 'master-1',
  label: 'Masters 1',
  minimumAge: 40,
  maximumAge: 49,
};

/**
 * Published in an order no age produces, so a test cannot pass on coincidence.
 *
 * `open` sits between `junior` and `submaster` rather than first or last, which is
 * how a real entry form prints them and is the only arrangement that can tell
 * "published order" apart from "the order the ages were discovered in".
 */
export const DIVISIONS_FIXTURE: readonly AgeDivision[] = [
  TEEN_FIXTURE,
  JUNIOR_FIXTURE,
  OPEN_FIXTURE,
  SUBMASTER_FIXTURE,
  MASTER_FIXTURE,
];

export const VOCABULARY_FIXTURE: CatalogVocabulary = {
  equipment: EQUIPMENT_FIXTURE,
  weightClassLadders: WEIGHT_CLASS_LADDERS_FIXTURE,
  divisions: DIVISIONS_FIXTURE,
};

/**
 * A window wide enough that no test has to think about it.
 *
 * Built through the real constructor rather than as an object literal, so a fixture
 * cannot hand the filter a pair of days the constructor would have refused --
 * which is the one thing `windowContains` is not defended against.
 */
export function wholeYearWindow(): PerformanceWindow {
  const result = performanceWindow('2026-01-01', '2026-12-31');
  if (!result.ok) {
    throw new Error('The fixture window is not a window.');
  }
  return result.window;
}

/** A scope with every optional axis open, to be narrowed per table. */
function scope(patch: Partial<ClassificationScope>): ClassificationScope {
  return {
    sex: 'male',
    lift: 'total',
    equipmentId: null,
    weightClassId: null,
    divisionId: null,
    tested: null,
    ...patch,
  };
}

/**
 * A ladder of standards, deliberately unlike a published one.
 *
 * Four rungs at 2.5 kg-free figures, so that a test comparing against a remembered
 * real total fails rather than passing by luck.
 */
const STANDARDS_FIXTURE = [
  { id: 'third', label: 'Third Class', rank: 0, requiredKilograms: 403 },
  { id: 'second', label: 'Second Class', rank: 1, requiredKilograms: 471 },
  { id: 'first', label: 'First Class', rank: 2, requiredKilograms: 546 },
  { id: 'elite', label: 'Elite', rank: 3, requiredKilograms: 618 },
] as const;

/**
 * The tables every grading test reads against.
 *
 * Shaped to cover all four outcomes `gradeLift` can produce without any test having
 * to build its own book:
 *
 * - **total** has one table per division, so it grades -- and the two disagree by a
 *   rung, which is what lets way one test a criterion that names a standard without
 *   saying which table to read it out of.
 * - **bench** has one table that distinguishes on nothing, so it grades too, and
 *   proves a `null` axis widens rather than excludes.
 * - **squat** has two tables of equal specificity, so it is ambiguous. That is the
 *   outcome most likely to be quietly collapsed into "not qualified" by a later
 *   refactor, and the reason it has a fixture of its own.
 * - **deadlift** has none, so it is unpublished.
 */
export const TABLES_FIXTURE: readonly ClassificationTable[] = [
  {
    id: 'total-raw-94-open-tested',
    label: 'Total, Raw, 94 kg, Open, tested',
    scope: scope({
      lift: 'total',
      equipmentId: 'raw',
      weightClassId: 'to-94',
      divisionId: 'open',
      tested: true,
    }),
    standards: [...STANDARDS_FIXTURE],
  },
  {
    id: 'bench-all',
    label: 'Bench press, all categories',
    scope: scope({ lift: 'bench' }),
    standards: [
      { id: 'third', label: 'Third Class', rank: 0, requiredKilograms: 101 },
      { id: 'second', label: 'Second Class', rank: 1, requiredKilograms: 128 },
      { id: 'first', label: 'First Class', rank: 2, requiredKilograms: 157 },
    ],
  },
  {
    id: 'squat-by-equipment',
    label: 'Squat, Raw',
    scope: scope({ lift: 'squat', equipmentId: 'raw' }),
    standards: [{ id: 'first', label: 'First Class', rank: 0, requiredKilograms: 191 }],
  },
  {
    id: 'squat-by-class',
    label: 'Squat, 94 kg',
    scope: scope({ lift: 'squat', weightClassId: 'to-94' }),
    standards: [{ id: 'first', label: 'First Class', rank: 0, requiredKilograms: 203 }],
  },
  {
    /**
     * The same four rungs, easier, for the Masters division.
     *
     * Here so that "which table is this standard read out of" is a question with
     * two different answers rather than one answer twice. A published criterion
     * that names a standard and not a table is the common case, and a fixture whose
     * Open and Masters ladders were the same figures could not tell a tool that
     * reads both from one that reads whichever it happened to find first.
     *
     * The figures are chosen so that a 595 kg total is First Class in the Open
     * table and Elite in this one -- one rung apart, which is the gap a criterion's
     * silence is worth.
     */
    id: 'total-raw-94-master-tested',
    label: 'Total, Raw, 94 kg, Masters 1, tested',
    scope: scope({
      lift: 'total',
      equipmentId: 'raw',
      weightClassId: 'to-94',
      divisionId: 'master-1',
      tested: true,
    }),
    standards: [
      { id: 'third', label: 'Third Class', rank: 0, requiredKilograms: 361 },
      { id: 'second', label: 'Second Class', rank: 1, requiredKilograms: 424 },
      { id: 'first', label: 'First Class', rank: 2, requiredKilograms: 491 },
      { id: 'elite', label: 'Elite', rank: 3, requiredKilograms: 556 },
    ],
  },
];

/** A route that asks for a First Class total, patched where a test cares. */
export function classificationRoute(patch: Partial<QualifyingRoute> = {}): QualifyingRoute {
  return {
    id: 'first-class-total',
    label: 'First Class total',
    standard: {
      kind: 'classification',
      standardId: 'first',
      orAbove: true,
      lift: 'total',
      divisionBasis: null,
    },
    performance: {
      federationNames: ['Invented Federation'],
      tested: true,
      territory: 'Invented Republic',
      description: 'A First Class total from an Invented Federation drug tested meet.',
    },
    window: { from: '2026-01-01', to: '2026-12-31' },
    appliesToTested: null,
    quotation: 'Entrants must have a First Class total or above from a tested meet.',
    availability: null,
    dispute: null,
    ...patch,
  };
}

/**
 * A route that asks for a coefficient score, which nothing here computes.
 *
 * Present in the fixture rather than only in the test that needs it, because a
 * points route is not an exotic case: it is how every invite tier in the corpus is
 * written, and a fixture without one would let a screen that understands only
 * totals look complete.
 */
export function pointsRoute(patch: Partial<QualifyingRoute> = {}): QualifyingRoute {
  return {
    id: 'invited-by-score',
    label: 'By coefficient score',
    standard: {
      kind: 'points',
      systemId: 'invented-coefficient',
      thresholds: [
        { sex: 'male', minimumPoints: 471.3 },
        { sex: 'female', minimumPoints: 452.8 },
      ],
    },
    performance: {
      federationNames: null,
      tested: null,
      territory: null,
      description: 'A qualifying score from any meet.',
    },
    window: { from: '2026-01-01', to: '2026-12-31' },
    appliesToTested: null,
    quotation: 'Lifters scoring 471.3 or better may request an invitation.',
    availability: null,
    dispute: null,
    ...patch,
  };
}

/** One transcribed meet, asking for a First Class total by default. */
export function meet(patch: Partial<QualifyingMeet> = {}): QualifyingMeet {
  return {
    id: 'invented-national-2026',
    label: 'Invented National Championships 2026',
    federationId: 'invented',
    sanctionedBy: 'Invented Federation',
    held: { from: '2027-04-10', to: '2027-04-11' },
    location: 'Invented City',
    sanctionNumber: 'INV-2027-001',
    offerings: [{ discipline: 'Full Power', equipment: ['Raw', 'Single-ply'] }],
    testedOffering: 'both',
    entryClosesOn: '2027-03-10',
    entry: { kind: 'standard', routes: [classificationRoute()] },
    conditions: [
      {
        id: 'membership',
        label: 'Current membership',
        detail: 'Entrants must hold a current membership on the day the entry form is submitted.',
        quotation: 'A current card is required at registration.',
      },
    ],
    source: {
      label: 'Invented National Championships announcement',
      url: 'https://example.invalid/invented-national-2026',
      verifiedOn: '2026-08-05',
    },
    ...patch,
  };
}

/** The entry rules the meet's criteria are read beside. */
export function federationRules(
  patch: Partial<QualifyingFederationRules> = {},
): QualifyingFederationRules {
  return {
    federationId: 'invented',
    label: 'Invented Federation',
    weightClass: {
      mayMoveUp: true,
      moveUpRequiresHigherStandard: true,
      mayMoveDown: false,
      moveUpRequiresVacancy: true,
      quotation: 'A lifter may move up one class with the heavier class standard and a vacancy.',
    },
    gearLadder: [{ competedIn: 'Raw', standardReachedIn: 'Raw', opens: ['Raw', 'Single-ply'] }],
    testedCrossoverAllowed: null,
    conditions: [
      {
        id: 'weigh-in-window',
        label: 'Weigh-in window',
        detail: 'Entry is fixed at weigh-in and cannot be changed afterwards.',
        quotation: null,
      },
    ],
    source: {
      label: 'Invented Federation Technical Rules',
      url: 'https://example.invalid/invented-rules',
      revision: '2026v1',
      sections: ['Part 1', 'Part 8'],
      verifiedOn: '2026-08-05',
    },
    ...patch,
  };
}

/** A book of one meet and the rules it is read against. */
export function meetBook(patch: Partial<QualifyingMeetBook> = {}): QualifyingMeetBook {
  return {
    federations: [federationRules()],
    meets: [meet()],
    ...patch,
  };
}

/**
 * One archive entry, in the archive's words, patched where a test cares.
 *
 * The default is an ordinary full-power meet: a placing, three lifts, a total that
 * is their sum, and an exact age. Every interesting case in this package is a
 * departure from exactly one of those, which is why the default is worth having.
 */
export function entry(patch: Partial<AthleteEntry> = {}): AthleteEntry {
  return {
    date: '2026-03-14',
    federation: 'Invented Federation',
    parentFederation: 'Invented International',
    meetName: 'Invented Spring Open',
    event: 'SBD',
    equipment: 'Raw',
    division: 'Open',
    ageClass: '40-49',
    age: { years: 41, approximate: false },
    tested: true,
    sex: 'M',
    bodyweightKg: 93.4,
    weightClassKg: '94',
    squatKg: 205,
    benchKg: 140,
    deadliftKg: 250,
    totalKg: 595,
    place: '1',
    ...patch,
  };
}
