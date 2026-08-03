// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Calendar dates, with no time and no zone.
 *
 * A birth date and a meet date are calendar facts. Putting either through `Date`
 * attaches a time and a zone to something that has neither, and the usual
 * consequence is an off-by-one day: `new Date('1990-05-15')` is midnight UTC,
 * which is 14 May for anyone west of Greenwich, and a lifter born on the first of
 * a month would drop an age band for half the world. Nothing in this file
 * constructs a `Date`, and that is the point of it existing.
 *
 * `Temporal.PlainDate` is the eventual answer. It is not yet available across the
 * browsers this project supports, and the surface needed here is small enough
 * that waiting is cheaper than a polyfill.
 */

/** A date on the calendar. Months and days are one-based, as they are written. */
export interface PlainDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Outcome of reading a date that arrived from outside.
 *
 * The failure reason never quotes the input. Unlike the federation figures that
 * `parseKilograms` reads, a date reaching this function is very often a lifter's
 * date of birth, and a reason string is exactly the kind of value that ends up in
 * a log line or an error report. The caller knows what it passed in; a report
 * does not need to.
 */
export type ParsedPlainDate =
  { readonly ok: true; readonly date: PlainDate } | { readonly ok: false; readonly reason: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads an ISO `YYYY-MM-DD` date, rejecting days that do not exist. */
export function parsePlainDate(raw: string): ParsedPlainDate {
  const match = ISO_DATE.exec(raw.trim());
  if (match === null) {
    return { ok: false, reason: 'date is not in YYYY-MM-DD form' };
  }

  // The pattern guarantees three digit groups, so these conversions cannot be NaN.
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > MONTHS_IN_YEAR) {
    return { ok: false, reason: 'month is outside 01-12' };
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    // Catches 31 April and 29 February in a common year, which a length check
    // alone would accept and which would then quietly shift an age by a day.
    return { ok: false, reason: 'day does not exist in that month' };
  }

  return { ok: true, date: { year, month, day } };
}

/** Orders two calendar dates: negative if `left` is earlier, zero if they are the same day. */
export function comparePlainDates(left: PlainDate, right: PlainDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

/** Formats a date back to `YYYY-MM-DD`. */
export function formatPlainDate(date: PlainDate): string {
  const year = String(date.year).padStart(4, '0');
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a date the way a sentence says it: `July 28, 2026`.
 *
 * For the one place a date is read rather than compared -- "Showing data last
 * verified …", where the ISO spelling reads as a machine talking. Everywhere a
 * date is *evidence* (when a record was set, when a source was retrieved) keeps
 * `formatPlainDate` and the ISO form, because a reader checking a certificate is
 * matching a string, not reading a phrase.
 *
 * Not `toLocaleDateString`. Two reasons, and the second is the one that decides
 * it: the numeric locale forms are the ambiguity this module exists to avoid --
 * `03/04/2026` is two different days depending on who is holding the phone --
 * and the long forms vary between browsers and between an installed ICU and a
 * trimmed one, so a test asserting a sentence would pass here and fail on a CI
 * image with a smaller data set. The month names are English because every other
 * word in the sentence is.
 */
export function formatPlainDateLong(date: PlainDate): string {
  // Bounded by `parsePlainDate`, and defensive anyway: a hand-built PlainDate
  // with a month of 13 should print a date that is merely odd rather than
  // "undefined 28, 2026".
  const month = MONTH_NAMES[date.month - 1];
  return month === undefined
    ? formatPlainDate(date)
    : `${month} ${String(date.day)}, ${String(date.year)}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Completed years between two dates.
 *
 * A birthday counts on the day it falls. Someone born on 29 February has their
 * birthday recognised on 29 February in a leap year and on 1 March otherwise,
 * which is what comparing the month and day separately produces without any
 * special case.
 *
 * @throws {RangeError} if `onDate` falls before `birthDate`. A negative age is
 *   not a smaller age -- it would match no division at all and read as though the
 *   lifter were simply ineligible, hiding the data error that caused it.
 */
export function completedYearsBetween(birthDate: PlainDate, onDate: PlainDate): number {
  if (comparePlainDates(onDate, birthDate) < 0) {
    throw new RangeError('Cannot take an age on a date before the date of birth.');
  }
  const years = onDate.year - birthDate.year;
  const birthdayHasPassed =
    onDate.month > birthDate.month ||
    (onDate.month === birthDate.month && onDate.day >= birthDate.day);
  return birthdayHasPassed ? years : years - 1;
}

const MONTHS_IN_YEAR = 12;
const DAYS_IN_COMMON_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const FEBRUARY = 2;
const DAYS_IN_LEAP_FEBRUARY = 29;

function daysInMonth(year: number, month: number): number {
  if (month === FEBRUARY && isLeapYear(year)) {
    return DAYS_IN_LEAP_FEBRUARY;
  }
  // The caller has already bounded `month` to 1-12.
  return DAYS_IN_COMMON_MONTH[month - 1] ?? 0;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
