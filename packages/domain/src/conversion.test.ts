import type { ConversionChartData, ConversionRow } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { KILOGRAM_MILESTONES, POUND_MILESTONES } from './barbell-milestones.js';
import { ConversionChart } from './conversion-chart.js';
import {
  chartColumnFor,
  convertAgainstChart,
  convertMilestones,
  directionFrom,
  directionInputUnit,
  directionOutputUnit,
  filterRowsByStep,
  nearestRowIndex,
  reverseDirection,
  rowWeight,
} from './conversion.js';
import { roundForDisplay } from './weight.js';

/**
 * Every figure below is invented. The real chart lives in `data/sources/`, and a
 * test restating its rows would be a second copy of it -- so the day the
 * federation revised one, this file would fail for being correct.
 *
 * The fixture uses a factor of exactly 2 in 2.5 kg steps, which makes every
 * expectation legible: 30 kg is 60 lb and nothing rounds.
 */
function rows(step = 2.5, from = 30, count = 9): ConversionRow[] {
  return Array.from({ length: count }, (_, index) => {
    const kilograms = Math.round((from + index * step) * 10) / 10;
    return { kilograms, pounds: kilograms * 2 };
  });
}

function chartOf(data: readonly ConversionRow[] = rows()): ConversionChart {
  const candidate: ConversionChartData = {
    id: 'example',
    label: 'Example Federation',
    source: {
      label: 'Example conversion chart',
      url: 'https://example.test/chart/',
      revision: '2026-01',
      verifiedOn: '2026-08-01',
    },
    rows: [...data],
  };
  const built = ConversionChart.from(candidate);
  if (!built.ok) {
    throw new Error('The fixture chart should build.');
  }
  return built.chart;
}

describe('direction', () => {
  it('names the unit each way round takes and gives', () => {
    expect(directionInputUnit('lb-to-kg')).toBe('lb');
    expect(directionOutputUnit('lb-to-kg')).toBe('kg');
    expect(directionInputUnit('kg-to-lb')).toBe('kg');
    expect(directionOutputUnit('kg-to-lb')).toBe('lb');
  });

  it('reverses, and reversing twice is where it started', () => {
    expect(reverseDirection('lb-to-kg')).toBe('kg-to-lb');
    expect(reverseDirection(reverseDirection('lb-to-kg'))).toBe('lb-to-kg');
  });

  it('derives the direction from the unit being typed in', () => {
    // The interface stores which unit the field is in; the direction follows from
    // it. Storing both would let them disagree, and the visible symptom would be an
    // answer in the unit the visitor is already typing.
    expect(directionFrom('lb')).toBe('lb-to-kg');
    expect(directionFrom('kg')).toBe('kg-to-lb');
  });
});

describe('chartColumnFor', () => {
  it('maps each unit to the column the chart prints it in', () => {
    expect(chartColumnFor('kg')).toBe('kilograms');
    expect(chartColumnFor('lb')).toBe('pounds');
  });
});

describe('rowWeight', () => {
  it('reads one side of a published row without computing anything', () => {
    const row: ConversionRow = { kilograms: 100, pounds: 220.5 };
    expect(rowWeight(row, 'kg')).toStrictEqual({ amount: 100, unit: 'kg' });
    // Note this is *not* 220.462: the pound figure is the federation's own, and
    // deriving it here would be the tool overruling the chart.
    expect(rowWeight(row, 'lb')).toStrictEqual({ amount: 220.5, unit: 'lb' });
  });
});

describe('convertAgainstChart', () => {
  it('answers with the exact figure and the chart row, kept apart', () => {
    const answer = convertAgainstChart({ amount: 35, unit: 'kg' }, chartOf());
    expect(answer.entered).toStrictEqual({ amount: 35, unit: 'kg' });
    // Arithmetic, not the fixture's factor of 2: the exact figure never inherits a
    // federation's rounding.
    expect(roundForDisplay(answer.exact.amount)).toBe(77.16);
    expect(answer.exact.unit).toBe('lb');
    expect(answer.chart).toStrictEqual({
      kind: 'exact',
      row: { kilograms: 35, pounds: 70 },
      below: { kilograms: 32.5, pounds: 65 },
      above: { kilograms: 37.5, pounds: 75 },
    });
  });

  it('still converts when there is no chart at all', () => {
    // A read that did not come back, a federation that publishes none, a phone with
    // no signal. A converter that stops converting in a gym is no converter.
    const answer = convertAgainstChart({ amount: 100, unit: 'kg' }, null);
    expect(answer.chart).toBeNull();
    expect(roundForDisplay(answer.exact.amount)).toBe(220.46);
  });

  it('reports a weight between two rows as between them, and never as a row', () => {
    const answer = convertAgainstChart({ amount: 33, unit: 'kg' }, chartOf());
    expect(answer.chart).toStrictEqual({
      kind: 'between',
      below: { kilograms: 32.5, pounds: 65 },
      above: { kilograms: 35, pounds: 70 },
      closest: 'below',
    });
  });

  it('reports an exact midpoint as equally close rather than picking one', () => {
    const answer = convertAgainstChart({ amount: 33.75, unit: 'kg' }, chartOf());
    expect(answer.chart?.kind).toBe('between');
    if (answer.chart?.kind !== 'between') return;
    expect(answer.chart.closest).toBe('tie');
  });

  it('looks a pound figure up in the pound column rather than converting first', () => {
    // Converting to kilograms and looking that up would answer with the rows around
    // a number the visitor never asked about.
    const answer = convertAgainstChart({ amount: 70, unit: 'lb' }, chartOf());
    expect(answer.chart).toStrictEqual({
      kind: 'exact',
      row: { kilograms: 35, pounds: 70 },
      below: { kilograms: 32.5, pounds: 65 },
      above: { kilograms: 37.5, pounds: 75 },
    });
  });

  it('says when a weight is off either end of the published range', () => {
    expect(convertAgainstChart({ amount: 10, unit: 'kg' }, chartOf()).chart).toStrictEqual({
      kind: 'below-range',
      nearest: { kilograms: 30, pounds: 60 },
    });
    expect(convertAgainstChart({ amount: 900, unit: 'kg' }, chartOf()).chart).toStrictEqual({
      kind: 'above-range',
      nearest: { kilograms: 50, pounds: 100 },
    });
  });

  it('refuses a figure the parser should never have passed on', () => {
    expect(() => convertAgainstChart({ amount: -1, unit: 'kg' }, chartOf())).toThrow(RangeError);
    expect(() => convertAgainstChart({ amount: Number.NaN, unit: 'kg' }, chartOf())).toThrow(
      RangeError,
    );
  });

  it('refuses a bad figure even with no chart, so the failure does not depend on a fetch', () => {
    expect(() => convertAgainstChart({ amount: Number.NaN, unit: 'kg' }, null)).toThrow(RangeError);
  });
});

describe('convertMilestones', () => {
  it('reads every milestone against the chart, in order', () => {
    const chart = chartOf(rows(2.5, 30, 200));
    const converted = convertMilestones(KILOGRAM_MILESTONES, chart);
    expect(converted).toHaveLength(KILOGRAM_MILESTONES.milestones.length);
    expect(converted.map((entry) => entry.weight.amount)).toStrictEqual(
      KILOGRAM_MILESTONES.milestones.map((milestone) => milestone.total),
    );
    for (const entry of converted) {
      expect(entry.weight.unit).toBe('kg');
      expect(entry.exact.unit).toBe('lb');
    }
  });

  it('keeps the plate breakdown attached, so a row can show what is on the bar', () => {
    const [first] = convertMilestones(POUND_MILESTONES, null);
    expect(first?.milestone.perSide).toStrictEqual(POUND_MILESTONES.milestones[0]?.perSide);
  });

  it('works with no chart, reporting the exact figure and no chart answer', () => {
    const converted = convertMilestones(POUND_MILESTONES, null);
    expect(converted.every((entry) => entry.chart === null)).toBe(true);
    expect(converted.length).toBeGreaterThan(0);
  });
});

describe('filterRowsByStep', () => {
  it('selects published rows and never manufactures one', () => {
    const all = rows(2.5, 30, 9);
    const every5 = filterRowsByStep(all, 5);
    expect(every5.map((row) => row.kilograms)).toStrictEqual([30, 35, 40, 45, 50]);
    for (const row of every5) {
      expect(all).toContainEqual(row);
    }
  });

  it('drops a row that is not on the step rather than rewriting it to fit', () => {
    // The chart's own first row is dropped when it is not a multiple. That is why
    // the interface has to say which step is showing.
    const every10 = filterRowsByStep(rows(2.5, 25, 9), 10);
    expect(every10.map((row) => row.kilograms)).toStrictEqual([30, 40]);
  });

  it('measures multiples from zero, so the selection does not move with a revision', () => {
    const fromThirty = filterRowsByStep(rows(2.5, 30, 9), 5).map((row) => row.kilograms);
    const fromTwentyFive = filterRowsByStep(rows(2.5, 25, 11), 5).map((row) => row.kilograms);
    expect(fromTwentyFive).toStrictEqual([25, 30, 35, 40, 45, 50]);
    expect(fromThirty.every((kilograms) => fromTwentyFive.includes(kilograms))).toBe(true);
  });

  it('tolerates the float noise a parsed decimal carries', () => {
    const filtered = filterRowsByStep([{ kilograms: 102.5, pounds: 205 }], 2.5);
    expect(filtered).toHaveLength(1);
  });

  it('returns every row when no thinning was asked for', () => {
    const all = rows();
    expect(filterRowsByStep(all, 0)).toStrictEqual(all);
    expect(filterRowsByStep(all, Number.NaN)).toStrictEqual(all);
  });
});

describe('nearestRowIndex', () => {
  it('finds the row a long chart should scroll to', () => {
    expect(nearestRowIndex(rows(), 36, 'kilograms')).toBe(2);
  });

  it('keeps the lighter row on a tie, the same direction as everywhere else', () => {
    expect(nearestRowIndex(rows(), 33.75, 'kilograms')).toBe(1);
  });

  it('answers null for an empty list, which a step filter can legitimately produce', () => {
    expect(nearestRowIndex([], 100, 'kilograms')).toBeNull();
  });
});
