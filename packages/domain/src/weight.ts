// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A weight and the unit it is in, and conversion between the two units.
 *
 * WHY THIS IS NOT `units.ts`
 *
 * There are deliberately two conversions in this package and they must not be
 * merged. `units.ts` reproduces a published federation calculator, including a
 * truncated factor and a ceiling, because a classification standard displayed in
 * pounds has to match the number the federation shows or a lifter plans against
 * the wrong target. That conversion is a data-fidelity requirement and is wrong
 * on purpose.
 *
 * This one is arithmetic. A bar weighs what it weighs, and 45 lb is exactly
 * 20.41165665 kg by the international definition of the pound. Nothing here is
 * a federation's opinion, so nothing here should inherit a federation's rounding.
 *
 * WHY CONVERSION TAKES AN ORIGIN
 *
 * Repeated unit toggles are a stated acceptance test for more than one tool in
 * this collection, and the obvious implementation fails it. Convert 45 lb to
 * kilograms, round for display, convert that back, round again, and the number
 * a lifter sees drifts a little further from 45 every time -- because each
 * conversion starts from the previous conversion's rounded output.
 *
 * The fix is not more decimal places, which only makes the drift slower and the
 * display worse. It is to keep what the lifter actually typed, in the unit they
 * typed it in, and derive every display from that. Switching units is then a
 * change of view rather than a change of value, and switching back is exact
 * however many times it happens. `EnteredWeight` is that origin, and
 * `showEntryIn` is the only way to read it in another unit.
 */

/** The two units this collection works in. */
export type WeightUnit = 'kg' | 'lb';

/** A weight, with the unit it is expressed in. Never a bare number. */
export interface Weight {
  readonly amount: number;
  readonly unit: WeightUnit;
}

/**
 * Exact by definition: the international pound is defined as this many
 * kilograms, with no rounding involved. Everything else here follows from it.
 */
export const KILOGRAMS_PER_POUND = 0.45359237;

/**
 * What a converted figure is rounded to for display.
 *
 * Two decimal places in either unit. Enough to show a 0.5 kg or 1.25 lb plate
 * change exactly, and short enough that a converted bar reads as 20.41 kg rather
 * than as a fourteen-digit apology. Deliberately *not* applied to the values the
 * arithmetic uses -- see `convertWeight`, which does not round at all.
 */
const DISPLAY_PLACES = 2;

function assertFinite(amount: number, what: string): void {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Expected a finite ${what}, received ${String(amount)}`);
  }
}

/**
 * The same weight expressed in another unit, unrounded.
 *
 * Unrounded on purpose. This feeds plate arithmetic, where a bar rounded to a
 * hundredth before the totals are computed puts that error into every set on
 * the screen. Round at the edge, when a number is about to be shown, and not
 * before.
 */
export function convertWeight(weight: Weight, to: WeightUnit): Weight {
  assertFinite(weight.amount, 'weight');
  if (weight.unit === to) {
    return weight;
  }
  const amount =
    to === 'kg' ? weight.amount * KILOGRAMS_PER_POUND : weight.amount / KILOGRAMS_PER_POUND;
  return { amount, unit: to };
}

/** The magnitude of a weight in the requested unit, unrounded. */
export function weightIn(weight: Weight, unit: WeightUnit): number {
  return convertWeight(weight, unit).amount;
}

/**
 * The most decimal places anything here will round to.
 *
 * Not a precision judgement -- it is the point past which `10 ** places` stops
 * being exactly representable and the scale-round-unscale trick starts adding
 * error instead of removing it. A caller asking for more than this has a bug,
 * and a thrown `RangeError` says so where a silently wrong hundredth would not.
 */
const MAX_PLACES = 10;

function assertPlaces(places: number): void {
  if (!Number.isInteger(places) || places < 0 || places > MAX_PLACES) {
    throw new RangeError(
      `Expected 0 to ${String(MAX_PLACES)} decimal places, received ${String(places)}`,
    );
  }
}

/**
 * Rounds a figure to a given number of decimal places.
 *
 * Half away from zero rather than JavaScript's half-up, so that -- for a
 * quantity that is always positive here -- 2.345 shows as 2.35 and not as 2.34
 * because of how the binary fraction happens to fall. The epsilon absorbs
 * representation error only: it is nine orders of magnitude below a hundredth,
 * so it can never move a value that was genuinely on the boundary.
 */
export function roundToPlaces(amount: number, places: number): number {
  assertFinite(amount, 'weight');
  assertPlaces(places);
  const scale = 10 ** places;
  const scaled = amount * scale;
  const nudged = scaled + Math.sign(scaled) * 1e-9;
  return Math.round(nudged) / scale;
}

/** Rounds to the collection's default display precision. */
export function roundForDisplay(amount: number): number {
  return roundToPlaces(amount, DISPLAY_PLACES);
}

/**
 * A weight formatted the way this collection writes weights.
 *
 * Trailing zeros are dropped -- 20 kg, not 20.00 kg -- because a plan full of
 * `.00` reads as false precision, and the one place a lifter genuinely needs two
 * places is a fractional plate, which keeps them.
 */
export function formatWeight(weight: Weight): string {
  return formatWeightAt(weight, DISPLAY_PLACES);
}

/**
 * The same, at a precision the caller chooses.
 *
 * The converter offers a more precise reading of a conversion, because the
 * two-place default is the right answer at a rack and the wrong one for somebody
 * checking arithmetic. Trailing zeros still go, so asking for four places does
 * not turn 100 kg into 100.0000 kg -- the extra places appear only where there
 * is something in them.
 */
export function formatWeightAt(weight: Weight, places: number): string {
  const rounded = roundToPlaces(weight.amount, places);
  // `toFixed` then strip, rather than `toLocaleString`: this is a number a lifter
  // loads on a bar, and a thousands separator or a comma decimal point would be
  // read as a different number by half the audience.
  const fixed = rounded.toFixed(places);
  // Guarded on the point rather than stripping zeros unconditionally: at zero
  // places there is no point in the string, and `/\.?0+$/` would turn 100 into 1.
  const text = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `${text} ${weight.unit}`;
}

/**
 * What the lifter typed, kept in the unit they typed it in.
 *
 * The whole point of the type is that the amount is never overwritten by a
 * conversion. A tool switching units changes `shownIn`; the origin stays put,
 * and switching back is exact rather than nearly exact.
 */
export interface EnteredWeight {
  /** Exactly what was entered, in the unit it was entered in. */
  readonly origin: Weight;
  /** The unit it is currently being displayed in. */
  readonly shownIn: WeightUnit;
}

/** An entry in the unit it was typed in. */
export function enterWeight(amount: number, unit: WeightUnit): EnteredWeight {
  assertFinite(amount, 'weight');
  return { origin: { amount, unit }, shownIn: unit };
}

/**
 * The same entry, displayed in another unit.
 *
 * Note what this does *not* do: it does not convert `origin`. Repeated calls
 * therefore all start from the same number, so `showEntryIn(showEntryIn(e,
 * 'lb'), 'kg')` is `e` exactly, not `e` plus two roundings.
 */
export function showEntryIn(entry: EnteredWeight, unit: WeightUnit): EnteredWeight {
  return { origin: entry.origin, shownIn: unit };
}

/**
 * Replaces the entry with a number typed in the unit currently shown.
 *
 * This is where an origin is legitimately discarded: the lifter has typed
 * something new, so the old value is not theirs any more.
 */
export function retypeEntry(entry: EnteredWeight, amount: number): EnteredWeight {
  return enterWeight(amount, entry.shownIn);
}

/** The value to put in the field: the origin seen from the displayed unit. */
export function entryAmount(entry: EnteredWeight): number {
  return roundForDisplay(weightIn(entry.origin, entry.shownIn));
}

/** The entry as a plain weight in the displayed unit, unrounded. */
export function entryWeight(entry: EnteredWeight): Weight {
  return convertWeight(entry.origin, entry.shownIn);
}
