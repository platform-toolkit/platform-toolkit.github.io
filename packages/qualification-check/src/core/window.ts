// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { comparePlainDates, parsePlainDate } from '@platform-toolkit/domain';

import type { CalendarDay } from '../types.js';

/**
 * The date range a qualification question is asked over.
 *
 * Two of them reach this tool and they are the same shape by coincidence rather
 * than by inheritance: a meet publishes a `QualifyingWindow` per route, and a
 * lifter types a range into the form. Keeping one type for both is what lets the
 * same filter serve both ways in.
 */

/** A closed range of days. Both ends are inclusive. */
export interface PerformanceWindow {
  readonly from: CalendarDay;
  readonly to: CalendarDay;
}

/** Why a range could not be accepted. */
export type WindowProblemCode =
  | 'from-unreadable'
  | 'to-unreadable'
  /** The range ends before it starts, so nothing can fall inside it. */
  | 'inverted';

export type PerformanceWindowResult =
  | { readonly ok: true; readonly window: PerformanceWindow }
  | { readonly ok: false; readonly problems: readonly WindowProblemCode[] };

/**
 * Checks a pair of days and accepts them as a window, or reports every problem.
 *
 * A smart constructor (section 5.5) rather than a pair of loose strings, and the
 * invariant it buys is worth more than it looks. {@link windowContains} compares
 * days with `<=` on the strings themselves, which is correct **only** because
 * `YYYY-MM-DD` is fixed-width and big-endian, so lexical order is chronological
 * order. Hand it `2026-9-01` and the comparison quietly reverses -- `'2026-9-01'`
 * sorts after `'2026-10-01'` -- and a lifter is told a result falls outside a
 * window it is squarely inside. Nothing downstream could detect that; the parse
 * on the way in is the whole defence.
 *
 * Both problems are reported at once so a form can mark both fields, rather than
 * making somebody fix one date to discover the other is wrong too.
 */
export function performanceWindow(from: string, to: string): PerformanceWindowResult {
  const problems: WindowProblemCode[] = [];

  const start = parsePlainDate(from);
  const finish = parsePlainDate(to);
  if (!start.ok) problems.push('from-unreadable');
  if (!finish.ok) problems.push('to-unreadable');

  if (start.ok && finish.ok && comparePlainDates(start.date, finish.date) > 0) {
    problems.push('inverted');
  }
  if (problems.length > 0) return { ok: false, problems };

  // Normalised back out of the parse rather than passed through, so a value that
  // arrived with surrounding whitespace cannot reach the string comparison.
  return {
    ok: true,
    window: { from: formatDay(from), to: formatDay(to) },
  };
}

/**
 * Whether a day falls inside the window, both ends included.
 *
 * Inclusive at both ends because that is what every source this tool reads means
 * by a range: a qualifying window that runs to the day before the meet says so,
 * and a lifter typing "1 January to 31 December" means the whole year. See
 * {@link performanceWindow} for why comparing the strings is safe.
 */
export function windowContains(window: PerformanceWindow, day: CalendarDay): boolean {
  return day >= window.from && day <= window.to;
}

/** Whether one window sits entirely inside another. */
export function windowWithin(inner: PerformanceWindow, outer: PerformanceWindow): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

/**
 * The overlap of two windows, or `null` where they do not meet.
 *
 * Way two lets a lifter give a range and way one gives every route its own, so a
 * screen showing both has to say which part of the lifter's range a route could
 * ever be satisfied in. `null` is a real answer and a useful one: it means no
 * result in the range the lifter asked about can count towards that route,
 * whatever they lifted.
 */
export function windowOverlap(
  left: PerformanceWindow,
  right: PerformanceWindow,
): PerformanceWindow | null {
  const from = left.from >= right.from ? left.from : right.from;
  const to = left.to <= right.to ? left.to : right.to;
  return from <= to ? { from, to } : null;
}

/** Re-emits a checked day with no surrounding whitespace. */
function formatDay(raw: string): CalendarDay {
  return raw.trim();
}
