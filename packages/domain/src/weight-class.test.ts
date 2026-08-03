// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { WeightClass } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { WeightClassLadder, type WeightClassLadderProblemCode } from './weight-class.js';

/**
 * Fixture, not federation data. The point of these tests is the placement rules,
 * and using real published limits would make a change to those limits look like a
 * regression here.
 */
function ladderOf(...maxima: readonly (number | null)[]): readonly WeightClass[] {
  return maxima.map((maximumKilograms) => ({
    id: maximumKilograms === null ? 'top' : `c-${maximumKilograms}`,
    label: maximumKilograms === null ? 'unlimited' : `${maximumKilograms} kg`,
    maximumKilograms,
  }));
}

function build(...maxima: readonly (number | null)[]): WeightClassLadder {
  const result = WeightClassLadder.from(ladderOf(...maxima));
  if (!result.ok) {
    throw new Error(
      `Fixture ladder was rejected: ${result.problems.map((p) => p.code).join(', ')}`,
    );
  }
  return result.ladder;
}

function problemCodes(classes: readonly WeightClass[]): readonly WeightClassLadderProblemCode[] {
  const result = WeightClassLadder.from(classes);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe('WeightClassLadder.from', () => {
  it('accepts an ascending ladder that ends unbounded', () => {
    expect(WeightClassLadder.from(ladderOf(60, 75, 90, null)).ok).toBe(true);
  });

  it('rejects an empty ladder', () => {
    expect(problemCodes([])).toEqual(['empty']);
  });

  it('rejects a ladder whose heaviest class is bounded', () => {
    // Without this the top class would have to be spelled with a sentinel like
    // 999, and every consumer would need to know the sentinel.
    expect(problemCodes(ladderOf(60, 75))).toContain('top-class-bounded');
  });

  it('rejects an unbounded class that is not last', () => {
    expect(problemCodes(ladderOf(60, null, 90, null))).toContain('unbounded-not-last');
  });

  it('rejects limits that do not ascend, including a repeated limit', () => {
    expect(problemCodes(ladderOf(75, 60, null))).toContain('not-ascending');
    expect(problemCodes(ladderOf(75, 75, null))).toContain('not-ascending');
  });

  it('rejects duplicate identifiers, which would make records ambiguous', () => {
    const classes: readonly WeightClass[] = [
      { id: 'same', label: '60 kg', maximumKilograms: 60 },
      { id: 'same', label: '75 kg', maximumKilograms: 75 },
      { id: 'top', label: 'unlimited', maximumKilograms: null },
    ];
    expect(problemCodes(classes)).toEqual(['duplicate-id']);
  });

  it('reports every problem at once rather than only the first', () => {
    // A data maintainer fixing one problem per run is a slow way to fix three.
    const codes = problemCodes(ladderOf(90, 75, 60));
    expect(new Set(codes)).toEqual(new Set(['not-ascending', 'top-class-bounded']));
    expect(codes.filter((code) => code === 'not-ascending')).toHaveLength(2);
  });

  it('is unaffected by later mutation of the array it was given', () => {
    const classes = [...ladderOf(60, 75, null)];
    const result = WeightClassLadder.from(classes);
    expect(result.ok).toBe(true);
    classes.length = 0;
    expect(result.ok && result.ladder.classes).toHaveLength(3);
  });
});

describe('WeightClassLadder.resolve', () => {
  const ladder = build(60, 75, 90, null);

  it('puts a lifter exactly on the limit in that class, not the one above', () => {
    // The single most consequential boundary in the file: 75.00 makes 75.
    expect(ladder.resolve(75).id).toBe('c-75');
    expect(ladder.resolve(75.01).id).toBe('c-90');
  });

  it('places a bodyweight between limits in the class above it', () => {
    expect(ladder.resolve(61.4).id).toBe('c-75');
  });

  it('places anything over the heaviest limit in the unbounded class', () => {
    expect(ladder.resolve(200).id).toBe('top');
  });

  it('places a very light lifter in the lightest class', () => {
    expect(ladder.resolve(0.5).id).toBe('c-60');
  });

  it('refuses a bodyweight that is not a positive finite number', () => {
    expect(() => ladder.resolve(0)).toThrow(RangeError);
    expect(() => ladder.resolve(-1)).toThrow(RangeError);
    expect(() => ladder.resolve(Number.NaN)).toThrow(RangeError);
    expect(() => ladder.resolve(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('WeightClassLadder.eligible', () => {
  const ladder = build(60, 75, 90, null);

  it('offers the class made and every heavier one, never a lighter one', () => {
    expect(ladder.eligible(70).map((weightClass) => weightClass.id)).toEqual([
      'c-75',
      'c-90',
      'top',
    ]);
  });

  it('offers only the unbounded class to a lifter above every limit', () => {
    expect(ladder.eligible(150).map((weightClass) => weightClass.id)).toEqual(['top']);
  });

  it('offers the whole ladder to a lifter who makes the lightest class', () => {
    expect(ladder.eligible(55)).toHaveLength(4);
  });
});

describe('WeightClassLadder.fit', () => {
  const ladder = build(60, 75, 90, null);

  it('reports the room left in the class and the cut to the one below', () => {
    const fit = ladder.fit(74.7);
    expect(fit.weightClass.id).toBe('c-75');
    expect(fit.nextClassDown?.id).toBe('c-60');
    expect(fit.marginKilograms).toBe(0.3);
    expect(fit.cutToNextClassDownKilograms).toBe(14.7);
  });

  it('does not leak binary floating point into the reported figures', () => {
    // `75 - 74.7` is 0.2999999999999972 and `74.7 - 60` is 14.700000000000003.
    // Both are checked above; this states the failure they would produce.
    expect(String(ladder.fit(74.7).marginKilograms)).toBe('0.3');
    expect(String(ladder.fit(90.1).cutToNextClassDownKilograms)).toBe('0.1');
  });

  it('rounds a real sub-hundredth difference down for margin and up for cut', () => {
    // Neither figure may flatter the lifter. 74.995 has 0.005 kg of room, which
    // is not 0.01 kg of room, and needs 14.995 kg off, which 14.99 would not do.
    const fit = ladder.fit(74.995);
    expect(fit.marginKilograms).toBe(0);
    expect(fit.cutToNextClassDownKilograms).toBe(15);
  });

  it('reports no margin in the unbounded class, because there is no limit to be under', () => {
    const fit = ladder.fit(150);
    expect(fit.marginKilograms).toBeNull();
    expect(fit.cutToNextClassDownKilograms).toBe(60);
  });

  it('reports no cut for a lifter already in the lightest class', () => {
    const fit = ladder.fit(55);
    expect(fit.nextClassDown).toBeNull();
    expect(fit.cutToNextClassDownKilograms).toBeNull();
    expect(fit.marginKilograms).toBe(5);
  });

  it('reports a zero margin for a lifter exactly on the limit', () => {
    expect(ladder.fit(75).marginKilograms).toBe(0);
  });
});
