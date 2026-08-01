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
