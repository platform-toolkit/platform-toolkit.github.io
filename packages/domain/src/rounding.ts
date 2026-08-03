// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Rounding to the hundredth of a kilogram, in a chosen direction.
 *
 * Internal to this package. Every figure this project shows a lifter is either
 * room they have or work they have left, and the two must round in opposite
 * directions: room rounds down and work rounds up, so that neither is ever
 * flattering. Getting that backwards produces a number that looks right and
 * quietly tells a lifter they have made a class or a standard they have not,
 * which is why the two directions live together rather than being written out at
 * each call site.
 *
 * A hundredth of a kilogram is the resolution a competition scale reports at.
 */

const HUNDREDTHS = 100;

/**
 * Absorbs representation error without absorbing a real difference.
 *
 * `74.7 - 60` is 14.700000000000003, and a bare ceiling would report 14.71 --
 * safe, but wrong-looking enough that a lifter would distrust the rest of the
 * screen. This slack is around a billionth of a kilogram, some seven orders of
 * magnitude below what a scale reports, so it can only ever cancel noise. A
 * genuinely sub-hundredth value still rounds away in whichever direction was
 * asked for.
 */
const FLOATING_POINT_SLACK = 1e-9;

/** Rounds down: use for room the lifter has. */
export function floorToHundredths(value: number): number {
  return Math.floor(value * HUNDREDTHS + FLOATING_POINT_SLACK) / HUNDREDTHS;
}

/** Rounds up: use for work the lifter has left. */
export function ceilToHundredths(value: number): number {
  return Math.ceil(value * HUNDREDTHS - FLOATING_POINT_SLACK) / HUNDREDTHS;
}

/*
 * The same three directions at a caller's chosen step, for figures that are
 * estimates rather than measurements.
 *
 * A hundredth of a kilogram is the right resolution for a bodyweight, which was
 * weighed. It is the wrong resolution for a one-repetition maximum inferred from
 * a set of five: 154.83 kg states a precision the method does not have, and a
 * reader who sees two decimal places reasonably concludes somebody measured
 * something. The step is the caller's because what counts as a meaningful
 * difference depends on what is going to be loaded -- half a kilogram is a real
 * jump on a microloaded bar and noise on a bar being loaded in 2.5 kg plates.
 *
 * The three directions matter more here than the step does. A low figure that
 * rounds up can end up above the middle one, and then a range that was ordered
 * before rounding is out of order on screen with no arithmetic error anywhere.
 */

/** Absorbs representation error in the *quotient*, so it scales with the step. */
function stepsIn(value: number, increment: number): number {
  return value / increment;
}

/**
 * Removes the dust a multiply can leave behind.
 *
 * Every step this project offers (0.5, 1, 2.5, 5) is exactly representable, so
 * today the product is exact. That is a property of the current list rather than
 * of the arithmetic, and a step of 0.1 added later would otherwise put
 * 142.60000000000002 on the screen.
 */
const CLEANUP_SCALE = 1e6;
function withoutDust(value: number): number {
  return Math.round(value * CLEANUP_SCALE) / CLEANUP_SCALE;
}

function assertIncrement(increment: number): void {
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new RangeError(`Rounding increment must be a positive finite number, got ${increment}.`);
  }
}

/** Rounds down to a step: use for the low end of an estimated range. */
export function floorToIncrement(value: number, increment: number): number {
  assertIncrement(increment);
  return withoutDust(Math.floor(stepsIn(value, increment) + FLOATING_POINT_SLACK) * increment);
}

/** Rounds up to a step: use for the high end of an estimated range. */
export function ceilToIncrement(value: number, increment: number): number {
  assertIncrement(increment);
  return withoutDust(Math.ceil(stepsIn(value, increment) - FLOATING_POINT_SLACK) * increment);
}

/**
 * Rounds to the nearest step, halves away from zero.
 *
 * Away from zero rather than JavaScript's built-in half-up, which is asymmetric
 * about zero and would round -0.5 to -0. No estimate here is negative, but the
 * helper sits beside two that are direction-symmetric and an exception would be
 * a trap for the next caller.
 */
export function roundToIncrement(value: number, increment: number): number {
  assertIncrement(increment);
  const steps = stepsIn(value, increment);
  const rounded =
    steps < 0
      ? -Math.round(-steps + FLOATING_POINT_SLACK)
      : Math.round(steps + FLOATING_POINT_SLACK);
  return withoutDust(rounded * increment);
}
