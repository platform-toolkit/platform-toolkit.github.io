import type { WeightUnit } from './weight.js';

/**
 * The weights lifters actually talk about, and what a bar looks like at each.
 *
 * These two sequences are not the loadable totals of anything -- a bar with 45 lb
 * plates reaches hundreds of totals and only a few of them are landmarks. They are
 * the numbers a gym counts in: the pound side runs on whole 45 lb plates with a
 * 25 lb plate splitting each step, and the kilogram side runs the same shape with
 * 25 kg and 15 kg plates over a collared competition bar.
 *
 * They are transcribed, not computed. A generator would produce these fifteen
 * pound figures and then keep going, or start somewhere else, or skip the
 * intermediate steps -- and the resulting list would be arithmetic rather than the
 * sequence people use. `barbell-milestones.test.ts` checks that every entry's
 * plates really do add up to its total, which catches a typo without ever letting
 * code decide what belongs on the list.
 *
 * THE TWO BARS ARE NOT THE SAME BAR
 *
 * The pound bar is 45 lb with spring clips that weigh nothing worth counting, so
 * an empty bar is 45 lb. The kilogram bar is a 20 kg competition bar with a pair
 * of 2.5 kg collars, so an empty bar is 25 kg before a single plate goes on. That
 * 25 kg is the most common source of a lifter's arithmetic being 5 kg out, which
 * is why {@link MilestoneChart} carries the empty weight as its own field for a
 * chart to state rather than leaving it implied by the numbers.
 */

/** One landmark weight and the plates that make it. */
export interface BarbellMilestone {
  /** The total, including bar and collars, in the chart's unit. */
  readonly total: number;
  /**
   * Plates on **one** side, heaviest first -- the same convention as `plates.ts`,
   * and the same order they go on the bar.
   */
  readonly perSide: readonly number[];
  /**
   * Whether this is a whole-plate landmark.
   *
   * The full-plate rows are the ones people name: three plates, four plates. The
   * intermediates exist because they are where the next jump lands, not because
   * anyone calls them anything. A chart can mark the difference; nothing here
   * depends on it.
   */
  readonly fullPlates: boolean;
}

/** A unit's landmark sequence, with the bar it assumes. */
export interface MilestoneChart {
  readonly unit: WeightUnit;
  /**
   * The bar and its collars, before any plate. Stated because it is the number
   * people forget, and because the two charts do not agree on it.
   */
  readonly emptyBar: number;
  /** A short description of that bar, for a chart to print beside its rows. */
  readonly barDescription: string;
  readonly milestones: readonly BarbellMilestone[];
}

/**
 * Pounds: a 45 lb bar, no collars worth counting, 45 lb plates with a 25 lb plate
 * splitting each step.
 */
export const POUND_MILESTONES: MilestoneChart = {
  unit: 'lb',
  emptyBar: 45,
  barDescription: '45 lb bar, no collars',
  milestones: [
    { total: 135, perSide: [45], fullPlates: true },
    { total: 185, perSide: [45, 25], fullPlates: false },
    { total: 225, perSide: [45, 45], fullPlates: true },
    { total: 275, perSide: [45, 45, 25], fullPlates: false },
    { total: 315, perSide: [45, 45, 45], fullPlates: true },
    { total: 365, perSide: [45, 45, 45, 25], fullPlates: false },
    { total: 405, perSide: [45, 45, 45, 45], fullPlates: true },
    { total: 455, perSide: [45, 45, 45, 45, 25], fullPlates: false },
    { total: 495, perSide: [45, 45, 45, 45, 45], fullPlates: true },
    { total: 545, perSide: [45, 45, 45, 45, 45, 25], fullPlates: false },
    { total: 585, perSide: [45, 45, 45, 45, 45, 45], fullPlates: true },
    { total: 635, perSide: [45, 45, 45, 45, 45, 45, 25], fullPlates: false },
    { total: 675, perSide: [45, 45, 45, 45, 45, 45, 45], fullPlates: true },
    { total: 725, perSide: [45, 45, 45, 45, 45, 45, 45, 25], fullPlates: false },
    { total: 765, perSide: [45, 45, 45, 45, 45, 45, 45, 45], fullPlates: true },
  ],
};

/**
 * Kilograms: a 20 kg competition bar with a pair of 2.5 kg collars -- 25 kg before
 * plates -- then 25 kg plates with a 15 kg plate splitting each step.
 */
export const KILOGRAM_MILESTONES: MilestoneChart = {
  unit: 'kg',
  emptyBar: 25,
  barDescription: '20 kg bar with 2.5 kg collars, 25 kg before plates',
  milestones: [
    { total: 75, perSide: [25], fullPlates: true },
    { total: 105, perSide: [25, 15], fullPlates: false },
    { total: 125, perSide: [25, 25], fullPlates: true },
    { total: 155, perSide: [25, 25, 15], fullPlates: false },
    { total: 175, perSide: [25, 25, 25], fullPlates: true },
    { total: 205, perSide: [25, 25, 25, 15], fullPlates: false },
    { total: 225, perSide: [25, 25, 25, 25], fullPlates: true },
    { total: 255, perSide: [25, 25, 25, 25, 15], fullPlates: false },
    { total: 275, perSide: [25, 25, 25, 25, 25], fullPlates: true },
    { total: 305, perSide: [25, 25, 25, 25, 25, 15], fullPlates: false },
    { total: 325, perSide: [25, 25, 25, 25, 25, 25], fullPlates: true },
  ],
};

/** The chart a unit uses. */
export function milestonesFor(unit: WeightUnit): MilestoneChart {
  return unit === 'kg' ? KILOGRAM_MILESTONES : POUND_MILESTONES;
}

/**
 * The milestone a weight has reached and the one after it.
 *
 * Both may be `null`: a weight under the lightest landmark has reached none, and a
 * weight past the heaviest has nothing ahead of it on a list that stops at eight
 * plates a side. Neither is an error, and neither is somewhere to invent a row.
 */
export interface MilestoneStanding {
  readonly reached: BarbellMilestone | null;
  readonly next: BarbellMilestone | null;
  /** How much more is needed for `next`, or `null` when there is no next. */
  readonly remaining: number | null;
}

/**
 * Where a weight sits among a unit's landmarks.
 *
 * A landmark counts as reached when the weight equals it, so a lifter at exactly
 * 315 lb has three plates rather than nearly having them.
 */
export function standingAmongMilestones(total: number, chart: MilestoneChart): MilestoneStanding {
  if (!Number.isFinite(total)) {
    throw new RangeError(`Expected a finite weight, received ${String(total)}`);
  }

  let reached: BarbellMilestone | null = null;
  let next: BarbellMilestone | null = null;
  for (const milestone of chart.milestones) {
    if (total >= milestone.total) {
      reached = milestone;
    } else {
      next = milestone;
      break;
    }
  }

  return {
    reached,
    next,
    remaining: next === null ? null : round(next.total - total),
  };
}

/** Trims the float noise a subtraction of two typed decimals leaves behind. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
