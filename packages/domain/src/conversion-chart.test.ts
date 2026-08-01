import type { ConversionChartData } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { ConversionChart } from './conversion-chart.js';

/**
 * Invented rows, deliberately not any federation's.
 *
 * A fixture holding real published figures would be a second copy of a chart, and
 * a second copy is the thing the whole design exists to prevent. These are
 * round-numbered pairs that belong to nobody: 10 kg apart, 20 lb apart, so the
 * midpoints and neighbours are obvious by eye.
 */
function chartOf(rows: readonly { kilograms: number; pounds: number }[]): ConversionChartData {
  return {
    id: 'example',
    label: 'Example Federation',
    source: {
      label: 'Example Federation Conversion Chart',
      url: 'https://example.test/chart/',
      revision: '2026-01',
      verifiedOn: '2026-08-01',
    },
    rows: [...rows],
  };
}

const EVEN = chartOf([
  { kilograms: 100, pounds: 220 },
  { kilograms: 110, pounds: 240 },
  { kilograms: 120, pounds: 260 },
  { kilograms: 130, pounds: 280 },
]);

function build(data: ConversionChartData): ConversionChart {
  const result = ConversionChart.from(data);
  if (!result.ok) {
    throw new Error(`Fixture did not build: ${result.problems.map((p) => p.message).join(' ')}`);
  }
  return result.chart;
}

describe('ConversionChart.from', () => {
  it('accepts an ascending chart and keeps its source', () => {
    const chart = build(EVEN);
    expect(chart.id).toBe('example');
    expect(chart.source.revision).toBe('2026-01');
    expect(chart.rows).toHaveLength(4);
  });

  it('reports every problem at once rather than the first', () => {
    const result = ConversionChart.from(
      chartOf([
        { kilograms: 100, pounds: 220 },
        { kilograms: 100, pounds: 220 },
        { kilograms: 90, pounds: 200 },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toStrictEqual([
      'duplicate-kilograms',
      'duplicate-pounds',
      'kilograms-not-ascending',
      'pounds-not-ascending',
    ]);
  });

  it('refuses a chart whose pound column runs backwards even though its kilograms do not', () => {
    // The pound column is looked up in its own right, so an out-of-order pound
    // value would return rows that do not surround the weight asked about --
    // silently, and only for pound queries.
    const result = ConversionChart.from(
      chartOf([
        { kilograms: 100, pounds: 240 },
        { kilograms: 110, pounds: 220 },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.code)).toStrictEqual(['pounds-not-ascending']);
  });

  it('names the rows involved so a maintainer can find them', () => {
    const result = ConversionChart.from(
      chartOf([
        { kilograms: 100, pounds: 220 },
        { kilograms: 90, pounds: 240 },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toContain('90');
    expect(result.problems[0]?.message).toContain('100');
  });
});

describe('gaps', () => {
  it('finds none in a chart of one increment', () => {
    expect(build(EVEN).gaps).toStrictEqual([]);
  });

  it('reports a step larger than the chart usually takes', () => {
    // Reported, never filled. The missing row is either a coarser published
    // increment or a transcription slip, and only a person with the document can
    // say which.
    const chart = build(
      chartOf([
        { kilograms: 100, pounds: 220 },
        { kilograms: 110, pounds: 240 },
        { kilograms: 130, pounds: 280 },
        { kilograms: 140, pounds: 300 },
      ]),
    );
    expect(chart.gaps).toHaveLength(1);
    expect(chart.gaps[0]?.below.kilograms).toBe(110);
    expect(chart.gaps[0]?.above.kilograms).toBe(130);
    expect(chart.gaps[0]?.kilograms).toBe(20);
  });

  it('does not call a finer increment a gap', () => {
    const chart = build(
      chartOf([
        { kilograms: 100, pounds: 220 },
        { kilograms: 105, pounds: 230 },
        { kilograms: 110, pounds: 240 },
        { kilograms: 120, pounds: 260 },
        { kilograms: 130, pounds: 280 },
        { kilograms: 140, pounds: 300 },
      ]),
    );
    // 10 kg is the usual step here, so the 5 kg one is extra detail rather than a
    // hole.
    expect(chart.gaps).toStrictEqual([]);
  });

  it('reports the coarser half of an evenly split chart', () => {
    // Two increments in equal measure is genuinely ambiguous, and the tie goes to
    // the finer one so that the coarse rows reach a person. Over-reporting costs a
    // look at the document; under-reporting hides a row that fell out.
    const chart = build(
      chartOf([
        { kilograms: 100, pounds: 220 },
        { kilograms: 105, pounds: 230 },
        { kilograms: 115, pounds: 250 },
        { kilograms: 120, pounds: 260 },
        { kilograms: 130, pounds: 280 },
      ]),
    );
    expect(chart.gaps.map((gap) => gap.below.kilograms)).toStrictEqual([105, 120]);
  });

  it('survives decimal increments without inventing a gap from float noise', () => {
    const chart = build(
      chartOf([
        { kilograms: 100, pounds: 220.5 },
        { kilograms: 102.5, pounds: 226 },
        { kilograms: 105, pounds: 231.5 },
        { kilograms: 107.5, pounds: 237 },
      ]),
    );
    expect(chart.gaps).toStrictEqual([]);
  });
});

describe('lookup', () => {
  const chart = build(EVEN);

  it('answers a published kilogram with the row and its neighbours', () => {
    const found = chart.lookup(110, 'kilograms');
    expect(found.kind).toBe('exact');
    if (found.kind !== 'exact') return;
    expect(found.row.pounds).toBe(240);
    expect(found.below?.kilograms).toBe(100);
    expect(found.above?.kilograms).toBe(120);
  });

  it('has no neighbour below at the bottom of the chart', () => {
    const found = chart.lookup(100, 'kilograms');
    expect(found.kind).toBe('exact');
    if (found.kind !== 'exact') return;
    expect(found.below).toBeNull();
    expect(found.above?.kilograms).toBe(110);
  });

  it('has no neighbour above at the top of the chart', () => {
    const found = chart.lookup(130, 'kilograms');
    expect(found.kind).toBe('exact');
    if (found.kind !== 'exact') return;
    expect(found.below?.kilograms).toBe(120);
    expect(found.above).toBeNull();
  });

  it('matches a published value that arrived with float noise', () => {
    const decimal = build(
      chartOf([
        { kilograms: 100, pounds: 220.5 },
        { kilograms: 102.5, pounds: 226 },
      ]),
    );
    expect(decimal.lookup(0.1 + 0.2 + 102.2, 'kilograms').kind).toBe('exact');
  });

  it('answers an unpublished weight with the rows around it, not a new row', () => {
    const found = chart.lookup(113, 'kilograms');
    expect(found.kind).toBe('between');
    if (found.kind !== 'between') return;
    expect(found.below.kilograms).toBe(110);
    expect(found.above.kilograms).toBe(120);
    expect(found.closest).toBe('below');
  });

  it('calls an exact midpoint a tie rather than picking one', () => {
    // Choosing here would be choosing a lifter's next attempt for them.
    const found = chart.lookup(115, 'kilograms');
    expect(found.kind).toBe('between');
    if (found.kind !== 'between') return;
    expect(found.closest).toBe('tie');
  });

  it('points at the nearer row when there is one', () => {
    const found = chart.lookup(118, 'kilograms');
    expect(found.kind).toBe('between');
    if (found.kind !== 'between') return;
    expect(found.closest).toBe('above');
  });

  it('says when a weight is lighter than anything published', () => {
    const found = chart.lookup(80, 'kilograms');
    expect(found.kind).toBe('below-range');
    if (found.kind !== 'below-range') return;
    expect(found.nearest.kilograms).toBe(100);
  });

  it('says when a weight is heavier than anything published', () => {
    const found = chart.lookup(500, 'kilograms');
    expect(found.kind).toBe('above-range');
    if (found.kind !== 'above-range') return;
    expect(found.nearest.kilograms).toBe(130);
  });

  it('reads the pound column against the same published rows', () => {
    // The chart is kilogram-indexed, so a pound question is answered with the
    // pound figures of real rows. Nothing computes a kilogram equivalent.
    const found = chart.lookup(250, 'pounds');
    expect(found.kind).toBe('between');
    if (found.kind !== 'between') return;
    expect(found.below).toStrictEqual({ kilograms: 110, pounds: 240 });
    expect(found.above).toStrictEqual({ kilograms: 120, pounds: 260 });
    expect(found.closest).toBe('tie');
  });

  it('answers a published pound figure exactly', () => {
    const found = chart.lookup(260, 'pounds');
    expect(found.kind).toBe('exact');
    if (found.kind !== 'exact') return;
    expect(found.row.kilograms).toBe(120);
  });

  it('accepts zero', () => {
    expect(chart.lookup(0, 'kilograms').kind).toBe('below-range');
  });

  it.each([
    ['a negative weight', -1],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s', (_what, value) => {
    expect(() => chart.lookup(value, 'kilograms')).toThrow(RangeError);
  });
});
