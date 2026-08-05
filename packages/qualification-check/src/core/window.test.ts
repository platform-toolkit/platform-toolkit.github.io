// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import type { CalendarDay } from '../types.js';
import {
  performanceWindow,
  windowContains,
  windowOverlap,
  windowWithin,
  type PerformanceWindow,
} from './window.js';

/** Unwraps a window a test has asserted is well formed. */
function accepted(from: string, to: string): PerformanceWindow {
  const result = performanceWindow(from, to);
  if (!result.ok) {
    throw new Error(`Expected a window, got ${result.problems.join(', ')}`);
  }
  return result.window;
}

function problems(from: string, to: string): readonly string[] {
  const result = performanceWindow(from, to);
  return result.ok ? [] : result.problems;
}

describe('performanceWindow', () => {
  it('accepts a pair of well-formed days', () => {
    expect(accepted('2026-01-01', '2026-12-31')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('accepts a single day as a window of one', () => {
    const window = accepted('2026-06-06', '2026-06-06');
    expect(windowContains(window, '2026-06-06')).toBe(true);
  });

  it('drops surrounding whitespace rather than carrying it into a comparison', () => {
    // A day with a leading space is not the same string as the day itself, and
    // `windowContains` compares strings. ' 2026-01-01' sorts before every real day
    // in the year, so an untrimmed lower bound would silently widen the window.
    expect(accepted(' 2026-01-01 ', '2026-12-31\n')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('refuses an unpadded month, which would reverse the comparison it feeds', () => {
    expect(problems('2026-9-01', '2026-12-31')).toEqual(['from-unreadable']);
  });

  it('is the only defence against that reversal', () => {
    // Not a test of the module so much as the reason the module exists. If the
    // constructor ever accepted an unpadded day, this is the arithmetic that would
    // then be wrong -- and nothing downstream could detect it, because both
    // operands are perfectly ordinary strings.
    // Typed as days rather than written inline, because the compiler can settle a
    // comparison between two string literals and would then object to it being
    // asserted -- which is a fair complaint about the literals and no comfort at all
    // about the days.
    const unpaddedSeptember: CalendarDay = '2026-9-01';
    const october: CalendarDay = '2026-10-01';
    expect(unpaddedSeptember > october).toBe(true);
    // A window that closed on 1 September, told that 1 October falls inside it.
    expect(windowContains({ from: '2026-01-01', to: unpaddedSeptember }, october)).toBe(true);
  });

  it('refuses a day that does not exist in its month', () => {
    expect(problems('2026-04-31', '2026-12-31')).toEqual(['from-unreadable']);
    expect(problems('2026-01-01', '2026-02-29')).toEqual(['to-unreadable']);
  });

  it('reports both ends at once so a form can mark both fields', () => {
    expect(problems('yesterday', 'tomorrow')).toEqual(['from-unreadable', 'to-unreadable']);
  });

  it('refuses a range that ends before it starts', () => {
    expect(problems('2026-12-31', '2026-01-01')).toEqual(['inverted']);
  });

  it('does not also claim inversion when a day could not be read at all', () => {
    // An unreadable end has no position in time, so calling the range inverted
    // would be inventing a second fault from the first one.
    expect(problems('2026-12-31', 'whenever')).toEqual(['to-unreadable']);
  });
});

describe('windowContains', () => {
  const window = accepted('2026-03-01', '2026-05-31');

  it('includes both ends', () => {
    expect(windowContains(window, '2026-03-01')).toBe(true);
    expect(windowContains(window, '2026-05-31')).toBe(true);
  });

  it('excludes the day either side', () => {
    expect(windowContains(window, '2026-02-28')).toBe(false);
    expect(windowContains(window, '2026-06-01')).toBe(false);
  });

  it('orders across a year boundary', () => {
    const across = accepted('2025-11-01', '2026-02-01');
    expect(windowContains(across, '2025-12-25')).toBe(true);
    expect(windowContains(across, '2026-03-01')).toBe(false);
  });
});

describe('windowWithin', () => {
  const outer = accepted('2026-01-01', '2026-12-31');

  it('accepts a range sharing an edge with the one around it', () => {
    expect(windowWithin(accepted('2026-01-01', '2026-06-30'), outer)).toBe(true);
    expect(windowWithin(outer, outer)).toBe(true);
  });

  it('refuses a range that hangs over either edge', () => {
    expect(windowWithin(accepted('2025-12-31', '2026-06-30'), outer)).toBe(false);
    expect(windowWithin(accepted('2026-06-30', '2027-01-01'), outer)).toBe(false);
  });
});

describe('windowOverlap', () => {
  it('is the part both ranges cover', () => {
    expect(
      windowOverlap(accepted('2026-01-01', '2026-06-30'), accepted('2026-04-01', '2026-09-30')),
    ).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('is the inner range when one contains the other', () => {
    expect(
      windowOverlap(accepted('2026-01-01', '2026-12-31'), accepted('2026-04-01', '2026-04-30')),
    ).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  it('is a single day where two ranges only touch', () => {
    expect(
      windowOverlap(accepted('2026-01-01', '2026-06-01'), accepted('2026-06-01', '2026-12-31')),
    ).toEqual({ from: '2026-06-01', to: '2026-06-01' });
  });

  it('is null where they never meet', () => {
    // A real answer and a useful one: no result in the lifter's range can count
    // towards a route whose window closed before it opened.
    expect(
      windowOverlap(accepted('2026-01-01', '2026-05-31'), accepted('2026-06-01', '2026-12-31')),
    ).toBeNull();
  });
});
