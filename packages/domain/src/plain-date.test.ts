// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  comparePlainDates,
  completedYearsBetween,
  formatPlainDate,
  formatPlainDateLong,
  parsePlainDate,
  type PlainDate,
} from './plain-date.js';

function date(year: number, month: number, day: number): PlainDate {
  return { year, month, day };
}

function parsed(raw: string): PlainDate {
  const result = parsePlainDate(raw);
  if (!result.ok) {
    throw new Error(`Fixture date was rejected: ${result.reason}`);
  }
  return result.date;
}

describe('parsePlainDate', () => {
  it('reads an ISO date as written, with no zone shift', () => {
    // `new Date('1990-05-15')` is midnight UTC, which is 14 May anywhere west of
    // Greenwich. This is the bug the whole module exists to avoid.
    expect(parsed('1990-05-15')).toEqual(date(1990, 5, 15));
  });

  it('accepts surrounding whitespace, which a pasted value often carries', () => {
    expect(parsed('  1990-05-15 ')).toEqual(date(1990, 5, 15));
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    for (const raw of ['', '1990-5-15', '15/05/1990', '1990-05-15T00:00:00Z', '90-05-15']) {
      expect(parsePlainDate(raw).ok, raw).toBe(false);
    }
  });

  it('rejects a day that does not exist in that month', () => {
    expect(parsePlainDate('2023-04-31').ok).toBe(false);
    expect(parsePlainDate('2023-02-29').ok).toBe(false);
    expect(parsePlainDate('2024-02-29').ok).toBe(true);
  });

  it('rejects an out-of-range month', () => {
    expect(parsePlainDate('2023-00-10').ok).toBe(false);
    expect(parsePlainDate('2023-13-10').ok).toBe(false);
  });

  it('applies the full leap year rule, not just the divisible-by-four part', () => {
    expect(parsePlainDate('1900-02-29').ok).toBe(false);
    expect(parsePlainDate('2000-02-29').ok).toBe(true);
  });

  it('never quotes the input in its reason', () => {
    // A date reaching this function is very often a lifter's date of birth, and
    // a reason string is exactly what ends up in a log line.
    const result = parsePlainDate('1990-13-15');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).not.toContain('1990');
  });
});

describe('comparePlainDates', () => {
  it('orders by year, then month, then day', () => {
    expect(comparePlainDates(date(1990, 1, 1), date(1991, 1, 1))).toBeLessThan(0);
    expect(comparePlainDates(date(1990, 3, 1), date(1990, 2, 28))).toBeGreaterThan(0);
    expect(comparePlainDates(date(1990, 2, 2), date(1990, 2, 1))).toBeGreaterThan(0);
    expect(comparePlainDates(date(1990, 2, 1), date(1990, 2, 1))).toBe(0);
  });
});

describe('formatPlainDate', () => {
  it('pads every component back to ISO width', () => {
    expect(formatPlainDate(date(1990, 5, 1))).toBe('1990-05-01');
    expect(formatPlainDate(date(7, 12, 31))).toBe('0007-12-31');
  });

  it('round-trips a parsed date', () => {
    expect(formatPlainDate(parsed('2024-02-29'))).toBe('2024-02-29');
  });
});

describe('formatPlainDateLong', () => {
  it('writes the month as a word, so no reader has to guess the order', () => {
    expect(formatPlainDateLong(parsed('2026-07-28'))).toBe('July 28, 2026');
    // The pair that is two different days in numeric form, and unambiguous here.
    expect(formatPlainDateLong(parsed('2026-03-04'))).toBe('March 4, 2026');
  });

  it('does not pad the day, because a sentence does not', () => {
    expect(formatPlainDateLong(parsed('2026-01-01'))).toBe('January 1, 2026');
  });

  it('falls back to the ISO spelling rather than printing an undefined month', () => {
    expect(formatPlainDateLong({ year: 2026, month: 13, day: 1 })).toBe('2026-13-01');
  });
});

describe('completedYearsBetween', () => {
  it('counts the birthday on the day it falls, not the day after', () => {
    const birth = date(1990, 5, 15);
    expect(completedYearsBetween(birth, date(2024, 5, 14))).toBe(33);
    expect(completedYearsBetween(birth, date(2024, 5, 15))).toBe(34);
    expect(completedYearsBetween(birth, date(2024, 5, 16))).toBe(34);
  });

  it('does not count a birthday later in the same year', () => {
    expect(completedYearsBetween(date(1990, 12, 31), date(2024, 1, 1))).toBe(33);
  });

  it('recognises a 29 February birthday on 1 March in a common year', () => {
    const birth = date(2000, 2, 29);
    expect(completedYearsBetween(birth, date(2023, 2, 28))).toBe(22);
    expect(completedYearsBetween(birth, date(2023, 3, 1))).toBe(23);
    // And on the day itself when the year has one.
    expect(completedYearsBetween(birth, date(2024, 2, 29))).toBe(24);
  });

  it('is zero on the day of birth', () => {
    expect(completedYearsBetween(date(2024, 6, 1), date(2024, 6, 1))).toBe(0);
  });

  it('refuses a date before the date of birth rather than returning a negative age', () => {
    // A negative age matches no division, which would read as "not eligible"
    // instead of "these dates are wrong".
    expect(() => completedYearsBetween(date(2000, 1, 1), date(1999, 12, 31))).toThrow(RangeError);
  });
});
