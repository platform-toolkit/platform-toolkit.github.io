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
  WeightClass,
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
  weightClasses: WEIGHT_CLASSES_FIXTURE,
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
 * - **total** has exactly one table, so it grades.
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
];

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
