import { describe, expect, it } from 'vitest';

import {
  buildLoadingTable,
  emptyImplement,
  findLoading,
  plateChange,
  type BarbellSetup,
  type PlateDenomination,
} from './plates.js';

/** A well-equipped kilogram gym: every competition denomination, uncounted. */
const KILOGRAM_PLATES: readonly PlateDenomination[] = [
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 20, pairs: null, fullDiameter: true },
  { weight: 15, pairs: null, fullDiameter: false },
  { weight: 10, pairs: null, fullDiameter: false },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1, pairs: null, fullDiameter: false },
  { weight: 0.5, pairs: null, fullDiameter: false },
];

const POUND_PLATES: readonly PlateDenomination[] = [
  { weight: 45, pairs: null, fullDiameter: true },
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 10, pairs: null, fullDiameter: true },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1.25, pairs: null, fullDiameter: false },
];

const KILOGRAM_GYM: BarbellSetup = {
  plateUnit: 'kg',
  bar: { amount: 20, unit: 'kg' },
  collars: { amount: 0, unit: 'kg' },
  plates: KILOGRAM_PLATES,
};

const POUND_GYM: BarbellSetup = {
  plateUnit: 'lb',
  bar: { amount: 45, unit: 'lb' },
  collars: { amount: 0, unit: 'lb' },
  plates: POUND_PLATES,
};

describe('emptyImplement', () => {
  it('is the bar when there are no collars to count', () => {
    expect(emptyImplement(KILOGRAM_GYM)).toBe(20);
  });

  it('includes competition collars', () => {
    expect(emptyImplement({ ...KILOGRAM_GYM, collars: { amount: 5, unit: 'kg' } })).toBe(25);
  });

  it('converts a bar marked in the other unit', () => {
    const mixed = { ...KILOGRAM_GYM, bar: { amount: 45, unit: 'lb' as const } };
    expect(emptyImplement(mixed)).toBeCloseTo(20.41165665, 8);
  });
});

describe('buildLoadingTable', () => {
  it('always offers the empty implement', () => {
    const table = buildLoadingTable(KILOGRAM_GYM, 200);
    expect(table.loadings[0]).toEqual({ total: 20, perSide: [] });
  });

  it('offers only the empty implement when no plates are selected', () => {
    // A stated edge case: a gym with nothing on the rack has exactly one
    // loadable weight, and saying so is the honest answer.
    const table = buildLoadingTable({ ...KILOGRAM_GYM, plates: [] }, 200);
    expect(table.loadings).toEqual([{ total: 20, perSide: [] }]);
  });

  it('produces totals that are exactly the bar plus twice the side', () => {
    // The integer-arithmetic property. Built by repeated floating-point addition
    // this drifts, two equal loadings stop comparing equal, and a ramp shows the
    // same weight twice.
    const table = buildLoadingTable(KILOGRAM_GYM, 300);
    for (const loading of table.loadings) {
      const side = loading.perSide.reduce((sum, plate) => sum + plate, 0);
      expect(loading.total).toBeCloseTo(20 + side * 2, 10);
    }
  });

  it('has no duplicate totals', () => {
    const table = buildLoadingTable(KILOGRAM_GYM, 300);
    const totals = table.loadings.map((loading) => loading.total);
    expect(new Set(totals).size).toBe(totals.length);
  });

  it('is ascending', () => {
    const table = buildLoadingTable(POUND_GYM, 500);
    const totals = table.loadings.map((loading) => loading.total);
    expect([...totals].sort((left, right) => left - right)).toEqual(totals);
  });

  it('reaches every half kilogram a kilogram gym can make', () => {
    // 0.5 kg plates in pairs means every 1 kg step, and nothing between.
    const table = buildLoadingTable(KILOGRAM_GYM, 120);
    const totals = new Set(table.loadings.map((loading) => loading.total));
    for (let total = 20; total <= 120; total += 1) {
      expect(totals.has(total)).toBe(true);
    }
    expect(totals.has(20.5)).toBe(false);
  });

  it('never suggests a plate the gym does not own', () => {
    const oneHeavyPair: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [
        { weight: 20, pairs: 1, fullDiameter: true },
        { weight: 10, pairs: 2, fullDiameter: false },
        { weight: 5, pairs: 2, fullDiameter: false },
      ],
    };
    const table = buildLoadingTable(oneHeavyPair, 200);
    for (const loading of table.loadings) {
      expect(loading.perSide.filter((plate) => plate === 20).length).toBeLessThanOrEqual(1);
      expect(loading.perSide.filter((plate) => plate === 10).length).toBeLessThanOrEqual(2);
      expect(loading.perSide.filter((plate) => plate === 5).length).toBeLessThanOrEqual(2);
    }
  });

  it('caps the total at what a gym with one pair of everything can build', () => {
    const onePairEach: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [
        { weight: 25, pairs: 1, fullDiameter: true },
        { weight: 10, pairs: 1, fullDiameter: false },
      ],
    };
    const table = buildLoadingTable(onePairEach, 500);
    const heaviest = table.loadings.at(-1);
    expect(heaviest?.total).toBe(20 + 2 * 35);
  });
});

describe('choosing between combinations of the same total', () => {
  it('prefers fewer plates', () => {
    const table = buildLoadingTable(KILOGRAM_GYM, 200);
    const hundred = table.loadings.find((loading) => loading.total === 100);
    // 40 a side: one 25 and one 15, not two 20s -- both are two plates -- and
    // certainly not four 10s.
    expect(hundred?.perSide.length).toBe(2);
  });

  it('prefers the bigger plates when the count ties', () => {
    // 30 a side is 25 + 5 or 20 + 10. Same count; the first is what a lifter
    // reaches for, and it puts the heavy plate against the collar.
    const table = buildLoadingTable(KILOGRAM_GYM, 200);
    const eighty = table.loadings.find((loading) => loading.total === 80);
    expect(eighty?.perSide).toEqual([25, 5]);
  });

  it('lists plates heaviest first', () => {
    const table = buildLoadingTable(KILOGRAM_GYM, 300);
    for (const loading of table.loadings) {
      const descending = [...loading.perSide].sort((left, right) => right - left);
      expect(loading.perSide).toEqual(descending);
    }
  });

  it('is deterministic', () => {
    const first = buildLoadingTable(KILOGRAM_GYM, 250);
    const second = buildLoadingTable(KILOGRAM_GYM, 250);
    expect(first.loadings).toEqual(second.loadings);
  });
});

describe('mixed units', () => {
  it('gives correct kilogram totals for a pound bar', () => {
    // A stated acceptance scenario: a 45 lb bar with kilogram plates.
    const mixed: BarbellSetup = { ...KILOGRAM_GYM, bar: { amount: 45, unit: 'lb' } };
    const table = buildLoadingTable(mixed, 150);
    const withOneRedPlate = table.loadings.find((loading) => loading.perSide.join() === '25');
    expect(withOneRedPlate?.total).toBeCloseTo(20.41165665 + 50, 8);
  });
});

describe('findLoading', () => {
  const table = buildLoadingTable(KILOGRAM_GYM, 300);

  it('finds an exact match', () => {
    expect(findLoading(table, 100)?.total).toBe(100);
  });

  it('takes the lighter load when a target falls exactly between two', () => {
    // 100.5 is unreachable; 100 and 101 are equidistant. A warm-up exists to
    // prepare the working set, not to compete with it, so the tie goes down.
    expect(findLoading(table, 100.5)?.total).toBe(100);
  });

  it('stays at or below the target when asked to', () => {
    expect(findLoading(table, 100.4, { bound: 'at-most' })?.total).toBe(100);
    expect(findLoading(table, 100.6, { bound: 'at-most' })?.total).toBe(100);
  });

  it('stays at or above the target when asked to', () => {
    expect(findLoading(table, 100.4, { bound: 'at-least' })?.total).toBe(101);
  });

  it('treats an exactly loadable target as satisfying both bounds', () => {
    expect(findLoading(table, 100, { bound: 'at-most' })?.total).toBe(100);
    expect(findLoading(table, 100, { bound: 'at-least' })?.total).toBe(100);
  });

  it('honours a floor, so a ramp can keep increasing', () => {
    expect(findLoading(table, 60, { above: 60 })?.total).toBe(61);
  });

  it('honours a ceiling, so a warm-up stays under the working weight', () => {
    expect(findLoading(table, 100, { below: 100 })?.total).toBe(99);
  });

  it('returns null when the constraints admit nothing', () => {
    // Not an empty loading and not the bar: a caller that cannot tell the
    // difference will render a set that does not exist.
    const barOnly = buildLoadingTable({ ...KILOGRAM_GYM, plates: [] }, 200);
    expect(findLoading(barOnly, 100, { above: 20 })).toBe(null);
  });

  it('can require a full-diameter plate', () => {
    const found = findLoading(table, 60, { fullDiameter: true });
    expect(found?.perSide.some((plate) => plate === 25 || plate === 20)).toBe(true);
  });

  it('returns null when no full-diameter plate is available at all', () => {
    const smallIron: BarbellSetup = {
      ...KILOGRAM_GYM,
      plates: [{ weight: 10, pairs: null, fullDiameter: false }],
    };
    const smallTable = buildLoadingTable(smallIron, 200);
    expect(findLoading(smallTable, 60, { fullDiameter: true })).toBe(null);
  });

  it('does not let floating-point noise reject an exact match', () => {
    // 40% of 250 is 100 in arithmetic and 100.00000000000001 in some routes to
    // it. Without a tolerance, `at-most` would step down a whole kilogram.
    expect(findLoading(table, 250 * 0.4, { bound: 'at-most' })?.total).toBe(100);
  });
});

describe('plateChange', () => {
  const table = buildLoadingTable(KILOGRAM_GYM, 300);
  const at = (total: number): NonNullable<ReturnType<typeof findLoading>> => {
    const loading = findLoading(table, total);
    if (loading?.total !== total) {
      throw new Error(`${String(total)} kg is not loadable in the test gym.`);
    }
    return loading;
  };

  it('reports only the plates that move', () => {
    // 60 kg is 20 a side; 100 kg is 25 + 15. The 20 comes off.
    expect(plateChange(at(60), at(100))).toEqual({ removed: [20], added: [25, 15] });
  });

  it('says nothing about plates that stay on the bar', () => {
    // 90 kg is 25 + 10 a side, 110 kg is 25 + 20. The 25 is not mentioned.
    expect(plateChange(at(90), at(110))).toEqual({ removed: [10], added: [20] });
  });

  it('is empty when nothing changes', () => {
    expect(plateChange(at(100), at(100))).toEqual({ removed: [], added: [] });
  });

  it('handles loading onto an empty bar', () => {
    expect(plateChange(at(20), at(70))).toEqual({ removed: [], added: [25] });
  });

  it('handles stripping back to the bar', () => {
    expect(plateChange(at(70), at(20))).toEqual({ removed: [25], added: [] });
  });

  it('lists both sides of the change heaviest first', () => {
    // 95 kg is 25 + 10 + 2.5 a side, 132 kg is 25 + 25 + 5 + 1: two plates off
    // and three on, so both lists have something to be out of order about.
    const change = plateChange(at(95), at(132));
    expect(change.removed).toEqual([...change.removed].sort((left, right) => right - left));
    expect(change.added).toEqual([...change.added].sort((left, right) => right - left));
  });
});
