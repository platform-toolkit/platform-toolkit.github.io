import type {
  ClassificationScope,
  ClassificationStandard,
  ClassificationTable,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  ClassificationLadder,
  selectClassificationTable,
  type ClassificationQuery,
} from './classification.js';

/**
 * Invented standards. Real published totals would make a federation revising its
 * table look like a regression in the placement rules, which are what is tested.
 */
function standard(id: string, rank: number, totalKilograms: number): ClassificationStandard {
  return { id, label: id, rank, totalKilograms };
}

const STANDARDS: readonly ClassificationStandard[] = [
  standard('third', 0, 400),
  standard('second', 1, 500),
  standard('first', 2, 600),
  standard('elite', 3, 700),
];

function build(standards: readonly ClassificationStandard[] = STANDARDS): ClassificationLadder {
  const result = ClassificationLadder.from(standards);
  if (!result.ok) {
    throw new Error(
      `Fixture table was rejected: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.ladder;
}

function problemCodes(standards: readonly ClassificationStandard[]): readonly string[] {
  const result = ClassificationLadder.from(standards);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe('ClassificationLadder.from', () => {
  it('accepts a table whose ranks and totals agree', () => {
    expect(ClassificationLadder.from(STANDARDS).ok).toBe(true);
  });

  it('orders by rank regardless of the order the source published', () => {
    const shuffled = [STANDARDS[2], STANDARDS[0], STANDARDS[3], STANDARDS[1]].filter(
      (entry): entry is ClassificationStandard => entry !== undefined,
    );
    expect(build(shuffled).standards.map((entry) => entry.id)).toEqual([
      'third',
      'second',
      'first',
      'elite',
    ]);
  });

  it('rejects an empty table', () => {
    expect(problemCodes([])).toEqual(['empty']);
  });

  it('rejects a table whose ranks contradict its totals', () => {
    // The failure this check exists for: a mistranscribed total. Sorting by rank
    // alone would order it plausibly and award a title that was not earned.
    const wrong = [standard('a', 0, 500), standard('b', 1, 400)];
    expect(problemCodes(wrong)).toEqual(['rank-disagrees-with-total']);
  });

  it('rejects two standards requiring the same total', () => {
    expect(problemCodes([standard('a', 0, 500), standard('b', 1, 500)])).toEqual([
      'rank-disagrees-with-total',
    ]);
  });

  it('rejects a repeated rank, which leaves the order undefined', () => {
    expect(problemCodes([standard('a', 0, 400), standard('b', 0, 500)])).toContain(
      'duplicate-rank',
    );
  });

  it('rejects a repeated identifier', () => {
    expect(problemCodes([standard('a', 0, 400), standard('a', 1, 500)])).toEqual(['duplicate-id']);
  });

  it('accepts ranks that skip, since only the order they impose matters', () => {
    expect(ClassificationLadder.from([standard('a', 0, 400), standard('b', 7, 500)]).ok).toBe(true);
  });
});

describe('ClassificationLadder.classify', () => {
  const ladder = build();

  it('awards a standard to a total that reaches it exactly', () => {
    // Standards are floors. This boundary is the whole rule.
    const atStandard = ladder.classify(500);
    expect(atStandard.achieved?.id).toBe('second');

    const justUnder = ladder.classify(499.99);
    expect(justUnder.achieved?.id).toBe('third');
  });

  it('reports the most demanding standard reached, not the first', () => {
    expect(ladder.classify(650).achieved?.id).toBe('first');
  });

  it('reports the next standard and the work left to reach it', () => {
    const result = ladder.classify(555);
    expect(result.achieved?.id).toBe('second');
    expect(result.next?.id).toBe('first');
    expect(result.kilogramsToNext).toBe(45);
  });

  it('rounds the work left up, never down', () => {
    // 600 - 597.505 is 2.4949999999999903. A lifter told 2.49 who adds exactly
    // that is still short of the standard.
    expect(ladder.classify(597.505).kilogramsToNext).toBe(2.5);
  });

  it('reports no achievement for a total below the least demanding standard', () => {
    const result = ladder.classify(300);
    expect(result.achieved).toBeNull();
    expect(result.next?.id).toBe('third');
    expect(result.kilogramsToNext).toBe(100);
  });

  it('reports nothing left to reach once the most demanding standard is met', () => {
    const result = ladder.classify(800);
    expect(result.achieved?.id).toBe('elite');
    expect(result.next).toBeNull();
    expect(result.kilogramsToNext).toBeNull();
  });

  it('refuses a total that is not a positive finite number', () => {
    expect(() => ladder.classify(0)).toThrow(RangeError);
    expect(() => ladder.classify(-100)).toThrow(RangeError);
    expect(() => ladder.classify(Number.NaN)).toThrow(RangeError);
  });
});

describe('selectClassificationTable', () => {
  function table(id: string, scope: Partial<ClassificationScope>): ClassificationTable {
    return {
      id,
      label: id,
      scope: {
        sex: 'female',
        equipmentId: null,
        weightClassId: null,
        divisionId: null,
        tested: null,
        ...scope,
      },
      standards: [...STANDARDS],
    };
  }

  const QUERY: ClassificationQuery = {
    sex: 'female',
    equipmentId: 'raw',
    weightClassId: 'f-60',
    divisionId: 'open',
    tested: true,
  };

  it('finds a table that distinguishes on nothing but sex', () => {
    const general = table('general', {});
    expect(selectClassificationTable(QUERY, [general])).toEqual({ ok: true, table: general });
  });

  it('prefers a more specific table over the general one', () => {
    // Both apply. The override is the answer, and it must win regardless of the
    // order the source lists them in.
    const general = table('general', {});
    const equipped = table('raw-only', { equipmentId: 'raw' });
    expect(selectClassificationTable(QUERY, [general, equipped])).toEqual({
      ok: true,
      table: equipped,
    });
    expect(selectClassificationTable(QUERY, [equipped, general])).toEqual({
      ok: true,
      table: equipped,
    });
  });

  it('prefers the table pinning the most axes', () => {
    const one = table('one', { equipmentId: 'raw' });
    const three = table('three', { equipmentId: 'raw', divisionId: 'open', tested: true });
    expect(selectClassificationTable(QUERY, [one, three])).toEqual({ ok: true, table: three });
  });

  it('reports no match rather than falling back to an unrelated table', () => {
    expect(selectClassificationTable(QUERY, [table('male', { sex: 'male' })])).toEqual({
      ok: false,
      reason: 'no-match',
    });
    expect(
      selectClassificationTable(QUERY, [table('equipped', { equipmentId: 'single-ply' })]),
    ).toEqual({ ok: false, reason: 'no-match' });
    expect(selectClassificationTable(QUERY, [])).toEqual({ ok: false, reason: 'no-match' });
  });

  it('reports ambiguity rather than resolving it by document order', () => {
    // Two equally specific tables mean the data has two answers. Silently taking
    // the first would show one of them to a lifter and hide the fault from the
    // person who can correct it.
    const byEquipment = table('by-equipment', { equipmentId: 'raw' });
    const byDivision = table('by-division', { divisionId: 'open' });
    expect(selectClassificationTable(QUERY, [byEquipment, byDivision])).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });

  it('is not confused by a tie that a later, more specific table settles', () => {
    const byEquipment = table('by-equipment', { equipmentId: 'raw' });
    const byDivision = table('by-division', { divisionId: 'open' });
    const both = table('both', { equipmentId: 'raw', divisionId: 'open' });
    expect(selectClassificationTable(QUERY, [byEquipment, byDivision, both])).toEqual({
      ok: true,
      table: both,
    });
  });

  it('treats a null axis as applying to a lifter on either side of it', () => {
    const untestedOnly = table('untested', { tested: false });
    const eitherWay = table('either', { tested: null, equipmentId: 'raw' });
    expect(selectClassificationTable(QUERY, [untestedOnly, eitherWay])).toEqual({
      ok: true,
      table: eitherWay,
    });
  });
});
