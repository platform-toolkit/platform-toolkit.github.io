import { describe, expect, it } from 'vitest';

import {
  KILOGRAMS_PER_POUND,
  convertWeight,
  enterWeight,
  entryAmount,
  entryWeight,
  formatWeight,
  retypeEntry,
  roundForDisplay,
  showEntryIn,
  weightIn,
  type WeightUnit,
} from './weight.js';

describe('convertWeight', () => {
  it('uses the exact definition of the pound', () => {
    // Not 2.2046226. That figure belongs to `units.ts`, where matching a
    // federation's published calculator is the requirement; here the requirement
    // is that a bar weighs what it weighs.
    expect(KILOGRAMS_PER_POUND).toBe(0.45359237);
  });

  it.each([
    { pounds: 45, kilograms: 20.41165665 },
    { pounds: 15, kilograms: 6.80388555 },
    { pounds: 55, kilograms: 24.94758035 },
    { pounds: 65, kilograms: 29.48350405 },
  ])('converts a $pounds lb bar to $kilograms kg', ({ pounds, kilograms }) => {
    expect(convertWeight({ amount: pounds, unit: 'lb' }, 'kg').amount).toBeCloseTo(kilograms, 8);
  });

  it('returns the same weight untouched when the unit already matches', () => {
    const weight = { amount: 20, unit: 'kg' } as const;
    expect(convertWeight(weight, 'kg')).toBe(weight);
  });

  it('does not round', () => {
    // The bar feeds plate arithmetic. Rounding here would put the error into
    // every total on the screen instead of into the one number being displayed.
    const converted = convertWeight({ amount: 45, unit: 'lb' }, 'kg');
    expect(converted.amount).not.toBe(20.41);
    expect(converted.amount).toBeGreaterThan(20.4116);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects %p', (amount) => {
    expect(() => convertWeight({ amount, unit: 'kg' }, 'lb')).toThrow(RangeError);
  });
});

describe('weightIn', () => {
  it('reads a weight in either unit', () => {
    const bar = { amount: 20, unit: 'kg' } as const;
    expect(weightIn(bar, 'kg')).toBe(20);
    expect(weightIn(bar, 'lb')).toBeCloseTo(44.0924524, 6);
  });
});

describe('roundForDisplay', () => {
  it.each([
    { amount: 20.41165665, shown: 20.41 },
    { amount: 2.345, shown: 2.35 },
    { amount: 0, shown: 0 },
    { amount: 142.5, shown: 142.5 },
  ])('shows $amount as $shown', ({ amount, shown }) => {
    expect(roundForDisplay(amount)).toBe(shown);
  });

  it('rounds a half up rather than to whatever the binary fraction happens to be', () => {
    // 1.005 is stored as slightly less than 1.005, so a bare Math.round gives
    // 1.00. The nudge is nine orders of magnitude below a hundredth, so it can
    // only ever cancel representation error.
    expect(roundForDisplay(1.005)).toBe(1.01);
  });
});

describe('formatWeight', () => {
  it.each([
    { amount: 20, unit: 'kg' as const, text: '20 kg' },
    { amount: 142.5, unit: 'kg' as const, text: '142.5 kg' },
    { amount: 1.25, unit: 'lb' as const, text: '1.25 lb' },
    { amount: 20.41165665, unit: 'kg' as const, text: '20.41 kg' },
  ])('writes $amount $unit as "$text"', ({ amount, unit, text }) => {
    expect(formatWeight({ amount, unit })).toBe(text);
  });

  it('drops trailing zeros rather than claiming precision it does not have', () => {
    expect(formatWeight({ amount: 100, unit: 'kg' })).toBe('100 kg');
    expect(formatWeight({ amount: 100.1, unit: 'kg' })).toBe('100.1 kg');
  });

  it('never inserts a thousands separator', () => {
    // A lifter reads this number off the screen and loads it. A comma would be
    // read as a decimal point by a good part of the audience.
    expect(formatWeight({ amount: 1000, unit: 'lb' })).toBe('1000 lb');
  });
});

describe('EnteredWeight', () => {
  it('keeps what was typed, in the unit it was typed in', () => {
    const entry = enterWeight(142.5, 'kg');
    expect(entry.origin).toEqual({ amount: 142.5, unit: 'kg' });
    expect(entryAmount(entry)).toBe(142.5);
  });

  it('shows the same entry in the other unit', () => {
    const entry = showEntryIn(enterWeight(100, 'kg'), 'lb');
    expect(entryAmount(entry)).toBe(220.46);
    expect(entry.origin).toEqual({ amount: 100, unit: 'kg' });
  });

  it('survives repeated unit toggles without drifting', () => {
    // The failure this type exists to prevent. Converting the *displayed* value
    // each time compounds the rounding, and a 45 lb bar slowly stops being 45.
    // Because every view is derived from the origin, there is nothing to
    // compound.
    let entry = enterWeight(45, 'lb');
    const units: WeightUnit[] = ['kg', 'lb'];
    for (let round = 0; round < 50; round += 1) {
      for (const unit of units) {
        entry = showEntryIn(entry, unit);
      }
    }
    expect(entryAmount(entry)).toBe(45);
    expect(entry.origin).toEqual({ amount: 45, unit: 'lb' });
  });

  it('drifts nowhere for a value that does not round cleanly either way', () => {
    let entry = enterWeight(137.5, 'lb');
    for (let round = 0; round < 20; round += 1) {
      entry = showEntryIn(showEntryIn(entry, 'kg'), 'lb');
    }
    expect(entryAmount(entry)).toBe(137.5);
  });

  it('adopts a retyped number in the unit currently on screen', () => {
    // The one legitimate way to lose an origin: the lifter typed something else,
    // so the old value is not theirs any more.
    const entry = retypeEntry(showEntryIn(enterWeight(100, 'kg'), 'lb'), 225);
    expect(entry.origin).toEqual({ amount: 225, unit: 'lb' });
    expect(entry.shownIn).toBe('lb');
  });

  it('reports the unrounded weight for arithmetic', () => {
    // `entryAmount` is for the field; `entryWeight` is for the maths. They differ
    // by a rounding, and using the first for a calculation is how that rounding
    // gets into a plate total.
    const entry = showEntryIn(enterWeight(100, 'kg'), 'lb');
    expect(entryWeight(entry).amount).toBeGreaterThan(220.462);
    expect(entryWeight(entry).amount).toBeLessThan(220.463);
    expect(entryAmount(entry)).toBe(220.46);
  });
});
