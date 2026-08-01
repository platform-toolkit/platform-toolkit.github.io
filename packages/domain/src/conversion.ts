import type { ConversionRow } from '@platform-toolkit/data-contracts';

import type { BarbellMilestone, MilestoneChart } from './barbell-milestones.js';
import type { ChartColumn, ChartLookup, ConversionChart } from './conversion-chart.js';
import { convertWeight, type Weight, type WeightUnit } from './weight.js';

/**
 * Converting one weight, two ways at once.
 *
 * A lifter asking "what is 405 lb in kilos" is asking two questions that have two
 * different answers, and a tool that gives one of them is wrong half the time.
 *
 *   - The *exact* answer is arithmetic: the international pound is defined as
 *     0.45359237 kg, so 405 lb is 183.705... kg and nothing about that is a
 *     matter of opinion. It is what a scale reads and what a shipping label says.
 *   - The *competition* answer is a row on the federation's published chart, at
 *     the increments the federation runs meets in. It is what goes on the attempt
 *     card, what the announcer calls, and what the loaders put on the bar.
 *
 * They are usually within a kilogram of each other and they are never the same
 * concept, so this module keeps them in separate fields with separate types and
 * refuses to reduce them to one number with a formatting flag. The exact figure
 * is reference; it must never be offered as an attempt, and it must never stand in
 * for a chart row that does not exist.
 *
 * The other half of what is here is the direction of the conversion, which sounds
 * too small to model until you notice that reversing it is the single most common
 * thing a visitor does with a converter, and that the obvious implementation --
 * convert the displayed number and put it back in the box -- loses a little
 * accuracy on every flick. See `weight.ts`; `EnteredWeight` is the answer, and a
 * direction is just which unit that entry is currently shown in.
 */

/** Which way round the conversion is running. */
export type ConversionDirection = 'lb-to-kg' | 'kg-to-lb';

/** The unit the visitor is typing in. */
export function directionInputUnit(direction: ConversionDirection): WeightUnit {
  return direction === 'lb-to-kg' ? 'lb' : 'kg';
}

/** The unit the answer comes back in. */
export function directionOutputUnit(direction: ConversionDirection): WeightUnit {
  return direction === 'lb-to-kg' ? 'kg' : 'lb';
}

/** The other direction. Reversing twice is the direction you started with. */
export function reverseDirection(direction: ConversionDirection): ConversionDirection {
  return direction === 'lb-to-kg' ? 'kg-to-lb' : 'lb-to-kg';
}

/** The direction that takes this unit as its input. */
export function directionFrom(unit: WeightUnit): ConversionDirection {
  return unit === 'lb' ? 'lb-to-kg' : 'kg-to-lb';
}

/**
 * Which column of the published chart a unit is looked up in.
 *
 * Both columns are looked up the same way, and that is deliberate rather than a
 * convenience. A federation publishes a kilogram-indexed chart; a lifter asking
 * about a pound figure is asking which published attempts sit either side of it,
 * and computing a kilogram answer instead would invent an attempt nobody can take.
 */
export function chartColumnFor(unit: WeightUnit): ChartColumn {
  return unit === 'kg' ? 'kilograms' : 'pounds';
}

/** One side of a published row, as a weight. Never a computed figure. */
export function rowWeight(row: ConversionRow, unit: WeightUnit): Weight {
  return { amount: row[chartColumnFor(unit)], unit };
}

/**
 * What the tool knows about one weight.
 *
 * `chart` is `null` when no chart is in hand -- the federation publishes none, or
 * the read failed, or the page is offline and this artifact was never cached. That
 * is a real state and not a failure of this function: a converter that stops
 * converting because a fetch did not come back is useless in the one place these
 * tools are used. The exact figure is always available, and the interface says
 * plainly that the competition figure is missing rather than quietly presenting
 * arithmetic as a chart row.
 */
export interface ConversionAnswer {
  /** The figure the visitor is converting, in the unit they entered it in. */
  readonly entered: Weight;
  /** The exact equivalent. Reference only -- never an attempt. */
  readonly exact: Weight;
  /** What the federation's published chart says, or `null` if there is no chart. */
  readonly chart: ChartLookup | null;
}

/**
 * Answers a weight both ways.
 *
 * Takes the figure as it stands in the field rather than an `EnteredWeight`, so
 * that the exact equivalent shown is the exact equivalent of the number the
 * visitor can see. Keeping the drift-free origin is the caller's job and has to
 * stay there: it is a property of the session across many interactions, not of
 * one conversion.
 *
 * @throws {RangeError} if the weight is not finite or is negative -- both come
 *   from a parser that should have refused them, and swallowing one here would
 *   put a plausible number on screen for input the tool never accepted.
 */
export function convertAgainstChart(
  entered: Weight,
  chart: ConversionChart | null,
): ConversionAnswer {
  const other = entered.unit === 'kg' ? 'lb' : 'kg';
  return {
    entered,
    exact: convertWeight(entered, other),
    // `lookup` throws on a non-finite or negative figure, which is the check this
    // function's contract promises; letting it through rather than pre-empting it
    // keeps one implementation of the rule.
    chart: chart === null ? null : chart.lookup(entered.amount, chartColumnFor(entered.unit)),
  };
}

/**
 * A barbell milestone read against the published chart.
 *
 * The milestone sequences are fixed loadings -- three plates a side, four plates a
 * side -- and a lifter's question about them is always the same: what is this in
 * the other unit, and is it a weight I can actually be given on the platform. The
 * second half is why the chart lookup travels with the milestone instead of the
 * interface computing one and quietly rounding it.
 */
export interface MilestoneConversion {
  readonly milestone: BarbellMilestone;
  /** The milestone as a weight in its own unit. */
  readonly weight: Weight;
  /** Its exact equivalent in the other unit. Reference only. */
  readonly exact: Weight;
  /** Where it falls on the federation's chart, or `null` without one. */
  readonly chart: ChartLookup | null;
}

/** Every milestone in a sequence, read against the chart. Order is preserved. */
export function convertMilestones(
  milestones: MilestoneChart,
  chart: ConversionChart | null,
): readonly MilestoneConversion[] {
  return milestones.milestones.map((milestone) => {
    const weight: Weight = { amount: milestone.total, unit: milestones.unit };
    const answer = convertAgainstChart(weight, chart);
    return { milestone, weight, exact: answer.exact, chart: answer.chart };
  });
}

/**
 * How close a figure must be to a multiple to count as one.
 *
 * Chart kilograms arrive through JSON at one or two decimal places, so 102.5
 * divided by 2.5 is not always exactly 41. Nine orders of magnitude below the
 * smallest increment any chart prints, so it can never admit a row that is not
 * genuinely on the step.
 */
const STEP_TOLERANCE = 1e-9;

/**
 * Thins a published chart to every Nth kilogram, for a reader scanning it.
 *
 * A 180-row table on a phone is a scroll, and most of the time a lifter wants the
 * shape of it rather than every increment. What this must never become is a
 * generator: it selects from the rows the federation published and returns nothing
 * else, so a "cleaner" chart at 25 kg steps is still 25 kg steps *of real rows*. A
 * row that is not on the step is dropped, never rewritten to fit -- including the
 * chart's own first row, which is why the interface says which step is showing.
 *
 * Multiples are measured from zero rather than from the chart's first row, so the
 * selection is the same whichever revision a federation publishes and whatever it
 * starts at. A step of zero or less returns every row, because the caller asking
 * for no thinning at all is the common case and should not need a branch.
 */
export function filterRowsByStep(
  rows: readonly ConversionRow[],
  stepKilograms: number,
): readonly ConversionRow[] {
  if (!Number.isFinite(stepKilograms) || stepKilograms <= 0) {
    return rows;
  }
  return rows.filter((row) => {
    const multiples = row.kilograms / stepKilograms;
    return Math.abs(multiples - Math.round(multiples)) <= STEP_TOLERANCE;
  });
}

/**
 * The index of the row nearest a figure, for scrolling a long chart to it.
 *
 * Deliberately an index into the array the caller passed rather than a row: the
 * caller is about to move focus or scroll position to a rendered element, and a
 * row object cannot tell it which one. Returns `null` for an empty list, which is
 * the state a step filter can legitimately produce.
 */
export function nearestRowIndex(
  rows: readonly ConversionRow[],
  value: number,
  column: ChartColumn,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, row] of rows.entries()) {
    const distance = Math.abs(row[column] - value);
    // Strictly less than, so a tie keeps the lighter row -- the same direction the
    // rest of this collection resolves a tie in, and stable regardless of order.
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
