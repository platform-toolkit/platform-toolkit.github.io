// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { USPA_POUNDS_PER_KILOGRAM, kilogramsToUspaDisplayPounds, parseKilograms } from './units.js';

describe('kilogramsToUspaDisplayPounds', () => {
  it('reproduces the factor published by the upstream calculator', () => {
    expect(USPA_POUNDS_PER_KILOGRAM).toBe(2.2046226);
  });

  it.each([
    // Real Class I standards from the published grid, female raw full power.
    { kilograms: 212.5, pounds: 468.5 },
    { kilograms: 190.0, pounds: 418.9 },
    { kilograms: 165.0, pounds: 363.8 },
    { kilograms: 142.5, pounds: 314.2 },
    { kilograms: 285.0, pounds: 628.4 },
    { kilograms: 237.5, pounds: 523.6 },

    // Worth keeping for the near-worst case of Math.ceil: the exact value is
    // 573.201876, barely over 573.2, and it still rounds up a full increment to
    // 573.3. Anyone "correcting" this to 573.2 has replaced the upstream
    // formula with ordinary rounding, and lifters would start seeing targets
    // fractionally below the real standard.
    { kilograms: 260.0, pounds: 573.3 },
  ])('converts $kilograms kg to $pounds lb', ({ kilograms, pounds }) => {
    expect(kilogramsToUspaDisplayPounds(kilograms)).toBe(pounds);
  });

  it('never displays a pound figure below the true standard', () => {
    // The safety property that justifies Math.ceil. A displayed target that
    // rounded down would let a lifter believe they had met a standard they had not.
    for (let tenths = 0; tenths <= 4000; tenths += 1) {
      const kilograms = tenths / 10;
      const displayed = kilogramsToUspaDisplayPounds(kilograms);
      const exact = kilograms * USPA_POUNDS_PER_KILOGRAM;
      expect(displayed).toBeGreaterThanOrEqual(exact);
      // ...and never overstates by a full display increment.
      expect(displayed - exact).toBeLessThan(0.1);
    }
  });

  it('returns exactly one decimal place', () => {
    for (const kilograms of [1, 47.5, 100, 333.3]) {
      const displayed = kilogramsToUspaDisplayPounds(kilograms);
      expect(Math.round(displayed * 10)).toBeCloseTo(displayed * 10, 10);
    }
  });

  it('handles zero', () => {
    expect(kilogramsToUspaDisplayPounds(0)).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects %p', (value) => {
    expect(() => kilogramsToUspaDisplayPounds(value)).toThrow(RangeError);
  });
});

describe('parseKilograms', () => {
  it.each([
    { raw: '212.5', kilograms: 212.5 },
    { raw: '190.0', kilograms: 190 },
    { raw: '  67.5  ', kilograms: 67.5 },
    { raw: '0', kilograms: 0 },
  ])('parses $raw', ({ raw, kilograms }) => {
    expect(parseKilograms(raw)).toEqual({ ok: true, kilograms });
  });

  it.each(['', '   ', 'Infinity', '0x10', '1e3', '-5', '12.5kg', 'N/A', '--'])(
    'reports %p as a failure rather than coercing it',
    (raw) => {
      const result = parseKilograms(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBeTruthy();
      }
    },
  );
});
