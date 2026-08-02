/**
 * The one invented federation every records test and story in this tool uses.
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
  FederationRecord,
  Lift,
  RecordBook,
} from '@platform-toolkit/data-contracts';

import type { CategorySelection } from './selection.js';

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

/** A lifter who has answered every category question. */
export const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  division: 'open',
  tested: 'tested',
};

interface RecordOverrides {
  readonly kilograms: number;
  readonly levelId?: string;
  readonly regionId?: string | null;
  readonly disciplineId?: string;
  readonly unclaimed?: boolean;
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
    unclaimed = false,
    holderName = 'Robin Vance',
    achievedOn = '2024-05-18',
    meetName = 'Example Winter Open',
  } = overrides;
  return {
    id: `${levelId}-${regionId ?? 'none'}-${disciplineId}-${lift}`,
    scope: {
      levelId,
      regionId,
      sex: 'female',
      equipmentId: 'raw',
      disciplineId,
      weightClassId: 'f-56',
      divisionId: 'open',
      tested: true,
      lift,
    },
    kilograms,
    unclaimed,
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
