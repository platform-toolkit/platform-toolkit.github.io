// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  ConversionChartData,
  ConversionRow,
  ConversionSource,
} from '@platform-toolkit/data-contracts';

/**
 * Reading a weight against a federation's published conversion chart.
 *
 * A conversion chart is not arithmetic. The exact relationship between a pound
 * and a kilogram is a definition and lives in `weight.ts`; this file is about a
 * table a federation printed, at the increments it runs meets in, rounded the way
 * it chose to round. Those are the numbers on the attempt card and the scoreboard,
 * so they are the numbers a lifter needs -- and they are transcribed, never
 * derived.
 *
 * The consequence that shapes every signature here: nothing in this file can
 * produce a row. A weight that falls between two published rows is answered with
 * both of them and which is nearer, because a weight the federation does not
 * publish is not an attempt anyone can take, however correct its arithmetic. A
 * value exactly between two rows is reported as exactly between: choosing for the
 * lifter would be choosing their next attempt for them.
 */

/**
 * How close two figures must be to count as the same.
 *
 * Published values carry one decimal place and arrive through JSON, so a lookup
 * for `102.5` must match a row of `102.5` that a parse turned into
 * `102.50000000000001`. The window is far tighter than any real increment on any
 * chart -- the smallest is 0.25 kg -- so it can never merge two genuine rows.
 */
const MATCH_TOLERANCE = 1e-9;

/** Which of a row's two figures a lookup is asking about. */
export type ChartColumn = 'kilograms' | 'pounds';

/** Why a table of rows could not be accepted as a chart. */
export type ConversionChartProblemCode =
  | 'empty'
  | 'duplicate-kilograms'
  | 'duplicate-pounds'
  | 'kilograms-not-ascending'
  | 'pounds-not-ascending';

export interface ConversionChartProblem {
  readonly code: ConversionChartProblemCode;
  /** Plain-language description, addressed to whoever maintains the data feed. */
  readonly message: string;
}

export type ConversionChartResult =
  | { readonly ok: true; readonly chart: ConversionChart }
  | { readonly ok: false; readonly problems: readonly ConversionChartProblem[] };

/**
 * A place where the published increment changes.
 *
 * Not a failure. A federation is free to print 2.5 kg steps at the bottom of its
 * chart and 5 kg steps at the top, and a chart that does is correct. It is
 * reported so that the publishing step can hold it in front of a person, because
 * the other thing that produces a gap is a row lost in transcription -- and the
 * two are indistinguishable from inside this file. Whoever compares the chart to
 * the printed document can tell them apart; code that filled the gap in could not.
 */
export interface ConversionChartGap {
  readonly below: ConversionRow;
  readonly above: ConversionRow;
  /** The step across the gap, in kilograms. */
  readonly kilograms: number;
}

/** What the chart says about a weight. Never a manufactured row. */
export type ChartLookup =
  /** The weight is published. `below` and `above` are the neighbouring attempts. */
  | {
      readonly kind: 'exact';
      readonly row: ConversionRow;
      readonly below: ConversionRow | null;
      readonly above: ConversionRow | null;
    }
  /**
   * The weight falls between two published rows.
   *
   * `closest` is advice, not a decision -- an interface shows both rows and lets
   * the lifter pick. `'tie'` means the weight is the exact midpoint, which is
   * shown as equally close rather than resolved.
   */
  | {
      readonly kind: 'between';
      readonly below: ConversionRow;
      readonly above: ConversionRow;
      readonly closest: 'below' | 'above' | 'tie';
    }
  /** The weight is lighter than anything published. `nearest` is the first row. */
  | { readonly kind: 'below-range'; readonly nearest: ConversionRow }
  /** The weight is heavier than anything published. `nearest` is the last row. */
  | { readonly kind: 'above-range'; readonly nearest: ConversionRow };

/**
 * One federation's published chart, in ascending order.
 *
 * Built through {@link ConversionChart.from}, which refuses a table that is out of
 * order or repeats a value -- both of which would make a lookup return rows that
 * do not surround the weight asked about, silently.
 */
export class ConversionChart {
  private constructor(
    /** The federation this chart belongs to. Never merged with another's. */
    readonly id: string,
    readonly label: string,
    readonly source: ConversionSource,
    readonly rows: readonly ConversionRow[],
    /** Every place the published increment changes. Empty on a uniform chart. */
    readonly gaps: readonly ConversionChartGap[],
  ) {}

  /** Checks a chart as published and accepts it, or reports every problem found. */
  static from(data: ConversionChartData): ConversionChartResult {
    const problems = findProblems(data.rows);
    if (problems.length > 0) {
      return { ok: false, problems };
    }
    return {
      ok: true,
      chart: new ConversionChart(data.id, data.label, data.source, data.rows, findGaps(data.rows)),
    };
  }

  /** The chart's lightest published row. */
  get lightest(): ConversionRow {
    // `from` rejects an empty table, so the array is never empty -- but
    // `noUncheckedIndexedAccess` cannot know that, and `as` is not how this
    // codebase answers it.
    const [first] = this.rows;
    if (first === undefined) {
      throw new Error('A conversion chart always has rows; this one does not.');
    }
    return first;
  }

  /** The chart's heaviest published row. */
  get heaviest(): ConversionRow {
    const last = this.rows[this.rows.length - 1];
    if (last === undefined) {
      throw new Error('A conversion chart always has rows; this one does not.');
    }
    return last;
  }

  /**
   * Reads a weight against the chart, in either column.
   *
   * The pound column is looked up the same way as the kilogram column, and this is
   * deliberate rather than a shortcut. USPA publishes a kilogram-indexed chart and
   * no pound-indexed one, so a lifter asking "what is 405 lb" is asking which
   * published attempts sit either side of it. Answering with a computed kilogram
   * figure would invent an attempt that is not on the platform.
   *
   * @throws {RangeError} if the weight is not a finite, non-negative number.
   */
  lookup(value: number, column: ChartColumn): ChartLookup {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Expected a finite weight, received ${String(value)}`);
    }
    if (value < 0) {
      throw new RangeError(`Expected a weight of zero or more, received ${value}`);
    }

    const rows = this.rows;
    let below: ConversionRow | null = null;
    let above: ConversionRow | null = null;

    for (const [index, row] of rows.entries()) {
      const published = row[column];
      if (Math.abs(published - value) <= MATCH_TOLERANCE) {
        // The neighbours are the previous and next attempts on the platform,
        // which is what a lifter who just hit this one wants to see.
        return { kind: 'exact', row, below, above: rows[index + 1] ?? null };
      }
      if (published < value) {
        below = row;
      } else {
        above = row;
        break;
      }
    }

    if (below === null) {
      return { kind: 'below-range', nearest: this.lightest };
    }
    if (above === null) {
      return { kind: 'above-range', nearest: this.heaviest };
    }

    const gapBelow = value - below[column];
    const gapAbove = above[column] - value;
    const difference = gapBelow - gapAbove;

    return {
      kind: 'between',
      below,
      above,
      closest: Math.abs(difference) <= MATCH_TOLERANCE ? 'tie' : difference < 0 ? 'below' : 'above',
    };
  }
}

function findProblems(rows: readonly ConversionRow[]): readonly ConversionChartProblem[] {
  if (rows.length === 0) {
    return [{ code: 'empty', message: 'A conversion chart must have at least one row.' }];
  }

  const problems: ConversionChartProblem[] = [];

  for (const [index, row] of rows.entries()) {
    const previous = index === 0 ? undefined : rows[index - 1];
    if (previous === undefined) {
      continue;
    }
    if (row.kilograms === previous.kilograms) {
      problems.push({
        code: 'duplicate-kilograms',
        message: `${row.kilograms} kg appears more than once, so a lookup for it has two answers.`,
      });
    } else if (row.kilograms < previous.kilograms) {
      problems.push({
        code: 'kilograms-not-ascending',
        message: `Row ${index + 1} is ${row.kilograms} kg, lighter than the ${previous.kilograms} kg row before it.`,
      });
    }

    if (row.pounds === previous.pounds) {
      problems.push({
        code: 'duplicate-pounds',
        message: `${row.pounds} lb appears more than once, so a pound lookup for it has two answers.`,
      });
    } else if (row.pounds < previous.pounds) {
      problems.push({
        code: 'pounds-not-ascending',
        message: `Row ${index + 1} is ${row.pounds} lb, lighter than the ${previous.pounds} lb row before it.`,
      });
    }
  }

  return problems;
}

/**
 * Every place the increment changes, measured against the chart's own most common
 * step rather than an assumed one. A chart printed entirely in 5 kg steps has no
 * gaps; a chart in 2.5 kg steps that jumps 5 kg once has one.
 */
function findGaps(rows: readonly ConversionRow[]): readonly ConversionChartGap[] {
  const steps: number[] = [];
  for (const [index, row] of rows.entries()) {
    const previous = index === 0 ? undefined : rows[index - 1];
    if (previous !== undefined) {
      steps.push(round(row.kilograms - previous.kilograms));
    }
  }

  const usual = mostCommon(steps);
  if (usual === null) {
    return [];
  }

  const gaps: ConversionChartGap[] = [];
  for (const [index, step] of steps.entries()) {
    // Only a larger-than-usual step is a gap. A smaller one is a finer increment,
    // which is more information rather than less.
    if (step <= usual) {
      continue;
    }
    const below = rows[index];
    const above = rows[index + 1];
    if (below !== undefined && above !== undefined) {
      gaps.push({ below, above, kilograms: step });
    }
  }
  return gaps;
}

function mostCommon(steps: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const step of steps) {
    counts.set(step, (counts.get(step) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [step, count] of counts) {
    // Ties go to the smaller step, so a chart split evenly between two increments
    // reports the coarser half as gaps rather than hiding them.
    if (count > bestCount || (count === bestCount && best !== null && step < best)) {
      best = step;
      bestCount = count;
    }
  }
  return best;
}

/** Trims the float noise that subtracting two parsed decimals leaves behind. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
