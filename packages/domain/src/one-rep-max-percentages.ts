/**
 * Fractions of an estimated maximum, for somebody who came for one number and
 * stayed for the training loads.
 *
 * WHY THESE ARE COMPUTED FROM THE ROUNDED FIGURE
 *
 * The requirement is that every number on the screen agrees exactly, and the
 * number on the screen is the rounded one. Computing the table from the
 * unrounded middle figure would put a hundred percent row beside the headline
 * estimate showing a different weight -- half a kilogram out, entirely correct,
 * and impossible to explain to a lifter at a rack. So the headline figure is the
 * input, and the hundred percent row is that figure by construction.
 *
 * WHY EVERY ROW ROUNDS DOWN
 *
 * A percentage of an estimate is an estimate twice over. Rounding a training
 * load up puts more on the bar than the lifter asked for, on the strength of a
 * figure nobody measured -- §5.5's rule that room rounds down, arriving in a
 * place where "room" means the difference between a set that moves and a set
 * that does not.
 */
import { floorToIncrement } from './rounding.js';
import type { Weight } from './weight.js';

/** The lowest fraction worth tabulating. Below half, nothing here is training load. */
const LOWEST_PERCENT = 50;
const HIGHEST_PERCENT = 100;

/** The steps an interface offers. Five is the conventional one; ten is for a phone. */
export const PERCENTAGE_STEPS: readonly number[] = [5, 10];

export const DEFAULT_PERCENTAGE_STEP = 5;

export interface TrainingPercentage {
  /** A whole percentage from 50 through 100. */
  readonly percent: number;
  /** The load, rounded down to the caller's step. */
  readonly load: Weight;
}

export interface PercentageOptions {
  /** The gap between rows, in whole percent. */
  readonly step: number;
  /**
   * The loading step, in the same unit as the estimate.
   *
   * The same step the estimate was rounded to. Hand in a coarser one and the
   * hundred percent row lands *below* the headline figure beside it, which is
   * the mismatch this module exists to avoid.
   */
  readonly roundTo: number;
}

/**
 * The table, heaviest first.
 *
 * Heaviest first because the row a lifter is looking for is nearly always near
 * the top -- a percentage table is read to answer "what is my triple", not "what
 * is half of this" -- and because it puts the hundred percent row next to the
 * headline figure it was derived from.
 *
 * Nothing here labels a row. Ninety percent is not a training max and eighty is
 * not a working set; those are programme decisions this tool does not make, and
 * a label would turn a reference table into a prescription.
 */
export function trainingPercentages(
  estimate: Weight,
  options: PercentageOptions,
): readonly TrainingPercentage[] {
  const { step, roundTo } = options;
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError(`Percentage step must be a positive finite number, got ${step}.`);
  }

  const rows: TrainingPercentage[] = [];
  for (let percent = HIGHEST_PERCENT; percent >= LOWEST_PERCENT; percent -= step) {
    rows.push({
      percent,
      load: {
        amount: floorToIncrement((estimate.amount * percent) / 100, roundTo),
        unit: estimate.unit,
      },
    });
  }
  return rows;
}
