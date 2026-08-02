import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  ClassificationSourceError,
  buildClassificationTables,
  type ClassificationSnapshot,
} from './classification-standards.js';

/**
 * Every figure below is invented. Real classification standards live in
 * `data/sources/`, and a test asserting them would be a second place they are
 * written down -- so the day a federation moved one, the test would fail for
 * being correct.
 */

/** Any 64 lowercase hex characters. The digest is compared, never recomputed here. */
const DIGEST = 'a'.repeat(64);

function catalog(overrides: Partial<CategoryCatalog> = {}): CategoryCatalog {
  return {
    id: 'example',
    label: 'Example Federation',
    equipment: [
      { id: 'raw', label: 'Raw' },
      { id: 'single-ply', label: 'Single-ply' },
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
        { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: null },
      ],
    },

    // Records vocabulary. Classifications are not published per level or per
    // discipline, so nothing under test reads either of these.
    levels: [{ id: 'national', label: 'National', regions: [] }],
    disciplines: [
      { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
    ],
    ...overrides,
  };
}

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example',
    label: 'Example Federation',
    provenance: {
      id: 'example-classifications',
      label: 'Example classification standards',
      document: 'Example Classification Chart 1999v1',
      url: 'https://example.invalid/classifications',
      sections: ['Item 1'],
      retrievedAt: '1999-01-01T00:00:00.000Z',
    },
    standards: { file: 'example-standards.json', sha256: DIGEST, url: null },
    tested: null,
    grades: [
      { column: 'Bronze', id: 'bronze', label: 'Bronze', rank: 0 },
      { column: 'Silver', id: 'silver', label: 'Silver', rank: 1 },
    ],
    lifts: [
      { event: 'Total', lift: 'total', label: 'Total' },
      { event: 'SQ', lift: 'squat', label: 'Squat' },
    ],
    equipment: [
      { gear: 'Raw', equipmentId: 'raw' },
      { gear: 'SP', equipmentId: 'single-ply' },
    ],
    sexes: [
      { gender: 'Female', sex: 'female' },
      { gender: 'Male', sex: 'male' },
    ],
    weightClasses: [
      { sex: 'female', weight: '40', weightClassId: 'f-40' },
      { sex: 'female', weight: '40+', weightClassId: 'f-open' },
      { sex: 'male', weight: '60', weightClassId: 'm-60' },
      { sex: 'male', weight: '60+', weightClassId: 'm-open' },
    ],
    divisions: [
      { age: 'OPEN', divisionIds: ['open'] },
      { age: '40+', divisionIds: ['master-1'] },
    ],
    unmappedDivisions: [],
    quarantine: [],
    ...overrides,
  };
}

const WEIGHTS: Record<string, readonly string[]> = {
  Female: ['40', '40+'],
  Male: ['60', '60+'],
};

/**
 * One published row.
 *
 * The five axes are declared even though the grade columns are not, so that a
 * test reading `row.gear` is checked against a real field rather than against
 * the index signature -- a typo there would silently take the untouched branch
 * and the test would pass by mutating nothing.
 */
interface Row {
  gender: string;
  event: string;
  gear: string;
  age: string;
  weight: string;
  [column: string]: string;
}

/**
 * The full cross product the mapping above describes.
 *
 * Generated rather than listed because coverage is checked in both directions:
 * a hand-written subset would fail for omitting a combination, which is exactly
 * what the checks are for and not what most of these tests are about.
 */
function rows(mutate: (row: Row) => Row | null = (row) => row): Row[] {
  const out: Row[] = [];
  for (const gender of ['Female', 'Male']) {
    for (const event of ['Total', 'SQ']) {
      for (const gear of ['Raw', 'SP']) {
        for (const age of ['OPEN', '40+']) {
          for (const weight of WEIGHTS[gender] ?? []) {
            const row = mutate({
              gender,
              event,
              gear,
              age,
              weight,
              Bronze: '100',
              Silver: '150',
            });
            if (row !== null) {
              out.push(row);
            }
          }
        }
      }
    }
  }
  return out;
}

function snapshot(data: unknown = rows(), sha256 = DIGEST): ClassificationSnapshot {
  return { value: { data }, sha256 };
}

/** The problems reported by a build that should have failed. */
function problemsFrom(
  candidate: unknown,
  data: ClassificationSnapshot = snapshot(),
  categories: CategoryCatalog = catalog(),
): readonly string[] {
  try {
    buildClassificationTables(candidate, data, categories);
  } catch (error) {
    if (error instanceof ClassificationSourceError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected the source to be rejected, but it was accepted.');
}

describe('buildClassificationTables', () => {
  it('builds one table per published row and division, with a freshness entry', () => {
    const { tables, freshness, withheld } = buildClassificationTables(
      document(),
      snapshot(),
      catalog(),
    );

    // Two sexes x two lifts x two equipment categories x two divisions x two
    // classes, each division band naming exactly one division.
    expect(tables).toHaveLength(32);
    expect(withheld).toEqual([]);
    expect(freshness).toEqual({
      id: 'example-classifications',
      label: 'Example classification standards (Example Classification Chart 1999v1)',
      retrievedAt: '1999-01-01T00:00:00.000Z',
      status: 'ok',
    });
  });

  it('names and captions a table from the catalogue, not from the mapping', () => {
    const { tables } = buildClassificationTables(document(), snapshot(), catalog());

    expect(tables.find((table) => table.id === 'example-female-squat-raw-f-40-master-1')).toEqual({
      id: 'example-female-squat-raw-f-40-master-1',
      label: 'Women, Raw Squat, 40 kg, Master 1',
      scope: {
        sex: 'female',
        lift: 'squat',
        equipmentId: 'raw',
        weightClassId: 'f-40',
        divisionId: 'master-1',
        tested: null,
      },
      standards: [
        { id: 'bronze', label: 'Bronze', rank: 0, requiredKilograms: 100 },
        { id: 'silver', label: 'Silver', rank: 1, requiredKilograms: 150 },
      ],
    });
  });

  it('sorts tables by identifier so a reordered source does not rewrite every file', () => {
    const forwards = buildClassificationTables(document(), snapshot(), catalog()).tables;
    const backwards = buildClassificationTables(
      document(),
      snapshot([...rows()].reverse()),
      catalog(),
    ).tables;

    expect(backwards).toEqual(forwards);
    expect([...forwards].sort((left, right) => (left.id < right.id ? -1 : 1))).toEqual(forwards);
  });

  it('expands one published age band into every division it covers', () => {
    const { tables } = buildClassificationTables(
      document({
        divisions: [
          { age: 'OPEN', divisionIds: ['open'] },
          { age: '40+', divisionIds: ['master-1', 'master-2'] },
        ],
      }),
      snapshot(),
      catalog({
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [
            { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
            { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: 44 },
            { id: 'master-2', label: 'Master 2', minimumAge: 45, maximumAge: null },
          ],
        },
      }),
    );

    // A band naming two divisions produces two tables, so the reader never has
    // to know that the federation prints them together.
    expect(tables).toHaveLength(48);
    expect(tables.filter((table) => table.scope.divisionId === 'master-2')).toHaveLength(16);
  });

  it('carries the tested flag onto every scope when the source declares one', () => {
    const { tables } = buildClassificationTables(document({ tested: true }), snapshot(), catalog());

    expect(tables.every((table) => table.scope.tested === true)).toBe(true);
  });
});

describe('buildClassificationTables, refusing a snapshot it was not written against', () => {
  it('reports the digest alone, because every other message would be noise', () => {
    const problems = problemsFrom(document(), snapshot(rows(), 'b'.repeat(64)));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('example-standards.json');
    expect(problems[0]).toContain('update the digest');
  });

  it('refuses a standards reference that is a path rather than a filename', () => {
    const problems = problemsFrom(
      document({ standards: { file: '../../etc/passwd.json', sha256: DIGEST, url: null } }),
    );

    expect(problems).toEqual(['standards.file: expected a plain JSON filename']);
  });

  it('refuses a catalogue for a different federation', () => {
    const problems = problemsFrom(document(), snapshot(), catalog({ id: 'other' }));

    expect(problems).toEqual([
      'mapping is for federation "example" but was given the catalogue for "other"',
    ]);
  });
});

describe('buildClassificationTables, checking axis coverage in both directions', () => {
  it('reports a published value that nothing maps', () => {
    const problems = problemsFrom(
      document(),
      snapshot(rows((row) => (row.gear === 'SP' ? { ...row, gear: 'MP' } : row))),
    );

    // Both directions fire: "MP" is unmapped, and "SP" is now unused. Either
    // alone would be an incomplete account of what changed upstream.
    expect(problems).toContain('equipment gear: the published data uses "MP", which nothing maps');
    expect(problems).toContain(
      'equipment gear: "SP" is mapped but the published data never uses it',
    );
  });

  it('reports a mapping the published data no longer uses', () => {
    const problems = problemsFrom(
      document(),
      snapshot(rows((row) => (row.event === 'SQ' ? null : row))),
    );

    expect(problems).toEqual(['lift event: "SQ" is mapped but the published data never uses it']);
  });

  it('reports an unmapped grade column once, not once per row', () => {
    const problems = problemsFrom(document(), snapshot(rows((row) => ({ ...row, Gold: '200' }))));

    // Thirty-two rows carry the new column. One message.
    expect(problems).toEqual(['grade column: the published data uses "Gold", which nothing maps']);
  });

  it('keys weight classes by sex, so two ladders may share a number', () => {
    const problems = problemsFrom(
      document({
        weightClasses: [
          { sex: 'female', weight: '40', weightClassId: 'f-40' },
          { sex: 'female', weight: '40+', weightClassId: 'f-open' },
          { sex: 'male', weight: '60', weightClassId: 'm-60' },
          { sex: 'male', weight: '40+', weightClassId: 'm-open' },
        ],
      }),
    );

    expect(problems).toContain(
      'weight class: the published data uses "male 60+", which nothing maps',
    );
    expect(problems).toContain(
      'weight class: "male 40+" is mapped but the published data never uses it',
    );
  });
});

describe('buildClassificationTables, checking the mapping against the catalogue', () => {
  it('reports an equipment identifier the catalogue does not define', () => {
    const problems = problemsFrom(
      document({
        equipment: [
          { gear: 'Raw', equipmentId: 'raw' },
          { gear: 'SP', equipmentId: 'wraps' },
        ],
      }),
    );

    expect(problems).toContain(
      'equipment: gear "SP" maps to "wraps", which the catalogue does not define',
    );
  });

  it('reports a weight class that belongs to the other sex', () => {
    const problems = problemsFrom(
      document({
        weightClasses: [
          { sex: 'female', weight: '40', weightClassId: 'm-60' },
          { sex: 'female', weight: '40+', weightClassId: 'f-open' },
          { sex: 'male', weight: '60', weightClassId: 'm-60' },
          { sex: 'male', weight: '60+', weightClassId: 'm-open' },
        ],
      }),
    );

    // Named against the ladder, because a men's class written under a women's
    // weight is a mapping that would otherwise build a table nothing matches.
    expect(problems).toContain(
      'weight classes: female "40" maps to "m-60", which is not in the female ladder',
    );
  });

  it('refuses a division the rulebook defines but nothing accounts for', () => {
    const problems = problemsFrom(
      document(),
      snapshot(),
      catalog({
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [
            { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
            { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: null },
            { id: 'junior', label: 'Junior', minimumAge: 13, maximumAge: 19 },
          ],
        },
      }),
    );

    // The failure this prevents is silent: a division with no standards renders
    // exactly like one the federation deliberately publishes none for.
    expect(problems).toEqual([
      'divisions: "junior" is neither mapped to an age band nor listed in unmappedDivisions ' +
        'with a reason',
    ]);
  });

  it('accepts a division that is explained instead of mapped', () => {
    const { tables } = buildClassificationTables(
      document({
        unmappedDivisions: [{ divisionId: 'junior', reason: 'No published standards.' }],
      }),
      snapshot(),
      catalog({
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [
            { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
            { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: null },
            { id: 'junior', label: 'Junior', minimumAge: 13, maximumAge: 19 },
          ],
        },
      }),
    );

    expect(tables.some((table) => table.scope.divisionId === 'junior')).toBe(false);
  });

  it('refuses a division that is both mapped and listed as unmapped', () => {
    const problems = problemsFrom(
      document({ unmappedDivisions: [{ divisionId: 'open', reason: 'Contradicts the mapping.' }] }),
    );

    expect(problems).toContain(
      'divisions: "open" is both mapped to an age band and listed as unmapped',
    );
  });

  it('refuses one division claimed by two age bands', () => {
    const problems = problemsFrom(
      document({
        divisions: [
          { age: 'OPEN', divisionIds: ['open'] },
          { age: '40+', divisionIds: ['open', 'master-1'] },
        ],
      }),
    );

    // Two sets of standards for one division. Neither is more right than the
    // other, and picking the first would hide that from whoever can fix it.
    expect(problems).toContain('mapped division: "open" is used more than once');
  });
});

describe('buildClassificationTables, reading the figures', () => {
  it('refuses a figure that is not a plain decimal number', () => {
    const problems = problemsFrom(
      document(),
      snapshot(rows((row) => (row.weight === '40' ? { ...row, Silver: '150kg' } : row))),
    );

    expect(problems.every((problem) => problem.includes('"Silver"'))).toBe(true);
    expect(problems[0]).toContain('Female / Raw / Total / OPEN / 40');
  });

  it('refuses a row missing a grade the mapping declares', () => {
    const problems = problemsFrom(
      document(),
      snapshot(
        rows((row) => {
          if (row.gender !== 'Male') {
            return row;
          }
          const { Silver: _dropped, ...rest } = row;
          return rest;
        }),
      ),
    );

    // The column vanishing everywhere is caught by the coverage check; here it
    // is missing from some rows only, which coverage cannot see.
    expect(problems).toContain('Male / Raw / Total / OPEN / 60: has no "Silver" figure');
  });

  it('refuses a ladder whose grades do not ascend, naming the row', () => {
    const problems = problemsFrom(
      document(),
      snapshot(rows((row) => (row.age === '40+' ? { ...row, Silver: '90' } : row))),
    );

    expect(problems[0]).toContain('Female / Raw / Total / 40+ / 40');
    expect(problems[0]).toContain('Quarantine the row with a reason');
  });

  it('refuses two rows for one combination', () => {
    const duplicated = rows();
    const [first] = duplicated;
    if (first === undefined) {
      throw new Error('The fixture produced no rows.');
    }
    const problems = problemsFrom(document(), snapshot([...duplicated, { ...first }]));

    expect(problems).toEqual(['Female / Raw / Total / OPEN / 40: appears more than once']);
  });
});

describe('buildClassificationTables, reconciling the quarantine list', () => {
  const CONTRADICTORY = {
    gender: 'Female',
    gear: 'Raw',
    event: 'Total',
    age: '40+',
    weight: '40',
    reason: 'The published Silver figure is below Bronze.',
  };

  function withContradiction(): Row[] {
    return rows((row) =>
      row.gender === 'Female' &&
      row.gear === 'Raw' &&
      row.event === 'Total' &&
      row.age === '40+' &&
      row.weight === '40'
        ? { ...row, Silver: '90' }
        : row,
    );
  }

  it('withholds a quarantined row and reports why', () => {
    const { tables, withheld } = buildClassificationTables(
      document({ quarantine: [CONTRADICTORY] }),
      snapshot(withContradiction()),
      catalog(),
    );

    expect(withheld).toEqual([
      {
        row: 'Female / Raw / Total / 40+ / 40',
        reason: 'The published Silver figure is below Bronze.',
      },
    ]);
    // Withheld, not merely unpublished: the row is gone and the count says so.
    expect(tables).toHaveLength(31);
    expect(tables.some((table) => table.id === 'example-female-total-raw-f-40-master-1')).toBe(
      false,
    );
  });

  it('refuses a quarantined row that upstream has since corrected', () => {
    const problems = problemsFrom(document({ quarantine: [CONTRADICTORY] }));

    // The quieter of the two failures: a good row suppressed forever, with the
    // lifter shown nothing and nobody told.
    expect(problems).toEqual([
      'Female / Raw / Total / 40+ / 40: is quarantined but its grades now ascend. Remove the ' +
        'entry: "The published Silver figure is below Bronze."',
    ]);
  });

  it('refuses a quarantine entry for a row that is not published', () => {
    const problems = problemsFrom(
      document({
        quarantine: [{ ...CONTRADICTORY, weight: '35' }, CONTRADICTORY],
      }),
      snapshot(withContradiction()),
    );

    // A weight class the federation dropped, with the quarantine entry for it
    // left behind. Harmless today and a lie the moment somebody reads the list.
    expect(problems).toEqual([
      'Female / Raw / Total / 40+ / 35: is quarantined but no such row is published. Remove ' +
        'the entry: "The published Silver figure is below Bronze."',
    ]);
  });
});

describe('buildClassificationTables, refusing an ambiguous mapping', () => {
  it('reports two grades sharing a rank', () => {
    const problems = problemsFrom(
      document({
        grades: [
          { column: 'Bronze', id: 'bronze', label: 'Bronze', rank: 0 },
          { column: 'Silver', id: 'silver', label: 'Silver', rank: 0 },
        ],
      }),
    );

    expect(problems).toContain('grade rank: "0" is used more than once');
  });

  it('reports two gear values mapping to one equipment category', () => {
    const problems = problemsFrom(
      document({
        equipment: [
          { gear: 'Raw', equipmentId: 'raw' },
          { gear: 'SP', equipmentId: 'raw' },
        ],
      }),
    );

    expect(problems).toContain('equipment identifier: "raw" is used more than once');
  });

  it('reports every problem at once rather than the first', () => {
    const problems = problemsFrom(
      document({
        grades: [
          { column: 'Bronze', id: 'bronze', label: 'Bronze', rank: 0 },
          { column: 'Silver', id: 'bronze', label: 'Silver', rank: 0 },
        ],
      }),
    );

    // A mapping is edited by somebody working through a published chart, and a
    // build that surfaces one of three mistakes costs three builds.
    expect(problems.length).toBeGreaterThan(1);
  });
});
