// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One function, and one mistake it exists to refuse.
 *
 * Every case here sets `TZ` rather than trusting the machine's own zone. A test
 * written against the ambient zone measures nothing on a runner in UTC, where
 * the local day and the UTC day never disagree -- which is the one arrangement
 * in which the bug cannot appear and the one the deploy runs in.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { calendarDayOf } from './calendar.js';

const REAL_ZONE = process.env['TZ'];

function inZone(zone: string, instant: string): string {
  process.env['TZ'] = zone;
  return calendarDayOf(instant);
}

afterEach(() => {
  if (REAL_ZONE === undefined) {
    delete process.env['TZ'];
  } else {
    process.env['TZ'] = REAL_ZONE;
  }
});

describe('calendarDayOf', () => {
  it('is the day where the lifter is, not the day in UTC', () => {
    // Half past ten on the evening of the 7th in UTC is already the 8th in
    // Auckland, and half past five on the morning of the 8th in UTC is still the
    // 7th in Los Angeles. Both directions, because the error changes sign at
    // Greenwich and a single case would pass on one side of it.
    expect(inZone('Pacific/Auckland', '2026-03-07T22:30:00Z')).toBe('2026-03-08');
    expect(inZone('America/Los_Angeles', '2026-03-08T05:30:00Z')).toBe('2026-03-07');
  });

  it('pads a single-digit month and day', () => {
    expect(inZone('UTC', '2026-01-05T12:00:00Z')).toBe('2026-01-05');
  });

  it('takes the offset in the instant rather than assuming one', () => {
    // The same moment written three ways. An implementation slicing the string
    // instead of reading the date would answer differently for each.
    expect(inZone('UTC', '2026-03-08T00:00:00Z')).toBe('2026-03-08');
    expect(inZone('UTC', '2026-03-07T19:00:00-05:00')).toBe('2026-03-08');
    expect(inZone('UTC', '2026-03-08T09:00:00+09:00')).toBe('2026-03-08');
  });
});
