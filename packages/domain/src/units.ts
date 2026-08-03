// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Kilogram/pound conversion matching the USPA classification calculator exactly.
 *
 * The published calculator performs this conversion inline, with no named constant:
 *
 *     displayTotal = Math.ceil(totals[i] * 2.2046226 * 10) / 10;
 *
 * Two details of that expression are load-bearing and must not be "cleaned up":
 *
 *  1. The factor is 2.2046226, not the exact 2.20462262184878. Reproducing the
 *     published numbers requires reproducing the published factor.
 *
 *  2. `Math.ceil`, not rounding. A classification standard is a floor: the lifter
 *     must reach it. Rounding a pound display down could show a target below the
 *     true kilogram standard, and a lifter who hit exactly that displayed number
 *     would believe they qualified when they did not. Ceiling can only ever
 *     overstate by less than 0.1 lb, which is harmless. Rounding can understate,
 *     which is not.
 */

/** The conversion factor used by the published USPA calculator. */
export const USPA_POUNDS_PER_KILOGRAM = 2.2046226;

/** Precision of the published pound figures: one decimal place. */
const DISPLAY_DECIMAL_PLACES = 10;

/**
 * Converts a kilogram standard to the pound figure the USPA calculator displays.
 *
 * @throws {RangeError} if given a value that cannot produce a meaningful standard.
 */
export function kilogramsToUspaDisplayPounds(kilograms: number): number {
  if (!Number.isFinite(kilograms)) {
    throw new RangeError(`Expected a finite kilogram value, received ${String(kilograms)}`);
  }
  if (kilograms < 0) {
    throw new RangeError(`Expected a non-negative kilogram value, received ${kilograms}`);
  }
  return (
    Math.ceil(kilograms * USPA_POUNDS_PER_KILOGRAM * DISPLAY_DECIMAL_PLACES) /
    DISPLAY_DECIMAL_PLACES
  );
}

/** Outcome of parsing a numeric string that arrived from an external source. */
export type ParsedKilograms =
  | { readonly ok: true; readonly kilograms: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Parses a kilogram value that arrived as a string from an upstream source.
 *
 * Every numeric field in the published classification data is a string. The
 * upstream calculator relies on implicit coercion; we parse explicitly so that
 * malformed input surfaces as a reported failure rather than a silent NaN that
 * propagates into a displayed target.
 */
export function parseKilograms(raw: string): ParsedKilograms {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'value is empty' };
  }
  // Number() accepts forms we do not want from a data feed (hex, Infinity,
  // whitespace-only), so validate the shape before converting.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, reason: `value is not a plain decimal number: ${JSON.stringify(raw)}` };
  }
  const kilograms = Number(trimmed);
  if (!Number.isFinite(kilograms)) {
    return { ok: false, reason: `value is not finite: ${JSON.stringify(raw)}` };
  }
  return { ok: true, kilograms };
}
