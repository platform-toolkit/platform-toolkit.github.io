// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The direction rules, and the arithmetic that makes them hold.
 *
 * Every claim here is about safety rather than about neatness: room the lifter
 * has rounds down, work they have left rounds up, and a figure that rounded the
 * wrong way looks entirely correct on screen while telling somebody they made a
 * weight class they missed. The floating-point cases are the ones that actually
 * bite -- a bare ceiling on `74.7 - 60` reports 14.71, which is safe and wrong
 * enough that a lifter distrusts the rest of the page.
 */
import { describe, expect, it } from 'vitest';

import {
  ceilToHundredths,
  ceilToIncrement,
  floorToHundredths,
  floorToIncrement,
  roundToIncrement,
} from './rounding.js';

describe('hundredths', () => {
  it('rounds each direction to the resolution a competition scale reports at', () => {
    expect(floorToHundredths(74.699)).toBe(74.69);
    expect(ceilToHundredths(74.691)).toBe(74.7);
  });

  it('absorbs representation noise without absorbing a real difference', () => {
    // 74.7 - 60 is 14.700000000000003 in binary floating point.
    expect(ceilToHundredths(74.7 - 60)).toBe(14.7);
    expect(floorToHundredths(0.1 + 0.2)).toBe(0.3);
    // A genuine sub-hundredth difference still rounds in the direction asked for.
    expect(ceilToHundredths(14.7001)).toBe(14.71);
    expect(floorToHundredths(14.7099)).toBe(14.7);
  });
});

describe('a caller-chosen step', () => {
  it('rounds in three directions', () => {
    // Nearest necessarily agrees with one of the other two -- they are one step
    // apart -- so both cases are here: 142.4 rounds up to the ceiling and 141.0
    // rounds down to the floor.
    expect(floorToIncrement(142.4, 2.5)).toBe(140);
    expect(roundToIncrement(142.4, 2.5)).toBe(142.5);
    expect(ceilToIncrement(142.4, 2.5)).toBe(142.5);

    expect(floorToIncrement(141, 2.5)).toBe(140);
    expect(roundToIncrement(141, 2.5)).toBe(140);
    expect(ceilToIncrement(141, 2.5)).toBe(142.5);
  });

  it('leaves a value already on the step exactly where it is', () => {
    // Otherwise the low end of a range drops a whole step for nothing, and the
    // high end gains one, every time an estimate lands on a round number.
    for (const step of [0.5, 1, 2.5, 5]) {
      const on = step * 57;
      expect(floorToIncrement(on, step), String(step)).toBe(on);
      expect(ceilToIncrement(on, step), String(step)).toBe(on);
      expect(roundToIncrement(on, step), String(step)).toBe(on);
    }
  });

  it('absorbs quotient noise, which is where the step-based helpers differ', () => {
    // 0.1 + 0.2 divided by 0.5 is not exactly 0.6, and 145.05 / 0.05 lands just
    // under 2901. The slack is applied to the quotient rather than the product
    // so that it scales with the step instead of meaning less as the step grows.
    expect(ceilToIncrement(0.1 + 0.2, 0.5)).toBe(0.5);
    expect(floorToIncrement(2.5 * 3, 2.5)).toBe(7.5);
    expect(ceilToIncrement(2.5 * 3, 2.5)).toBe(7.5);
  });

  it('leaves no floating-point dust on the answer', () => {
    // Every step in use today is exactly representable, so this is a property of
    // the current list rather than of the arithmetic. A 0.1 step added later
    // would otherwise put 142.60000000000002 on a screen: 142.6 / 0.1 is
    // 1425.9999999999998, and multiplying the rounded quotient back up does not
    // land on 142.6 unless the dust is taken off.
    expect(roundToIncrement(142.6, 0.1)).toBe(142.6);
    expect(floorToIncrement(87.3, 0.1)).toBe(87.3);
    expect(ceilToIncrement(315.4, 0.1)).toBe(315.4);
    expect(roundToIncrement(0.7, 0.2)).toBe(0.8);
  });

  it('rounds halves away from zero, symmetrically about zero', () => {
    // No estimate in this project is negative. The symmetry is here because the
    // helper sits beside two that are direction-symmetric, and an exception
    // would be a trap for whoever reaches for it next.
    expect(roundToIncrement(2.5, 5)).toBe(5);
    expect(roundToIncrement(-2.5, 5)).toBe(-5);
    expect(floorToIncrement(-2.5, 5)).toBe(-5);
    expect(ceilToIncrement(-7.5, 5)).toBe(-5);
  });

  it('refuses a step that cannot round anything', () => {
    // Zero would divide by zero and return a silent NaN, which propagates into
    // every figure downstream and is reported nowhere.
    for (const step of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => floorToIncrement(100, step), String(step)).toThrow(RangeError);
      expect(() => ceilToIncrement(100, step), String(step)).toThrow(RangeError);
      expect(() => roundToIncrement(100, step), String(step)).toThrow(RangeError);
    }
  });

  it('never crosses over: floor <= nearest <= ceiling, at every step', () => {
    // The ordering is what stops an estimated range coming out backwards on
    // screen with no arithmetic error anywhere, and it has to hold at the
    // boundaries a hand-picked example never visits.
    const slack = 1e-9;
    for (const step of [0.5, 1, 2.5, 5]) {
      for (let hundredths = 4000; hundredths < 6000; hundredths += 7) {
        const value = hundredths / 100;
        const where = `${String(value)}/${String(step)}`;
        expect(floorToIncrement(value, step), where).toBeLessThanOrEqual(
          roundToIncrement(value, step),
        );
        expect(roundToIncrement(value, step), where).toBeLessThanOrEqual(
          ceilToIncrement(value, step),
        );
        // The tolerance is the documented slack: a value a hair below a step
        // boundary is treated as being on it, in both directions, on purpose.
        expect(floorToIncrement(value, step), where).toBeLessThanOrEqual(value + slack);
        expect(ceilToIncrement(value, step), where).toBeGreaterThanOrEqual(value - slack);
      }
    }
  });
});
