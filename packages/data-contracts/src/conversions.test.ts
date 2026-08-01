import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { ConversionChartSchema, conversionChartArtifactId } from './conversions.js';

/**
 * Invented rows throughout, and deliberately not USPA's.
 *
 * A fixture that happened to hold real published figures would be a second copy
 * of the chart -- the exact thing the source document forbids -- and would read
 * as authoritative to anyone who found it years from now. These are three made-up
 * pairs that are internally consistent and belong to nobody.
 */
const CHART = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Conversion Chart',
    url: 'https://example.test/conversion-chart/',
    revision: '2026-01',
    verifiedOn: '2026-08-01',
  },
  rows: [
    { kilograms: 50, pounds: 110.2 },
    { kilograms: 52.5, pounds: 115.7 },
    { kilograms: 55, pounds: 121.3 },
  ],
};

function parses(candidate: unknown): boolean {
  return v.safeParse(ConversionChartSchema, candidate).success;
}

describe('ConversionChartSchema', () => {
  it('accepts a chart with its source', () => {
    expect(parses(CHART)).toBe(true);
  });

  it('refuses a chart with one row', () => {
    // "The rows around this value" has no answer in a one-row table, and the
    // interface's whole between-rows behaviour is built on there being one.
    expect(parses({ ...CHART, rows: [CHART.rows[0]] })).toBe(false);
  });

  it.each([
    ['no rows at all', { ...CHART, rows: [] }],
    ['a row missing its pound figure', { ...CHART, rows: [CHART.rows[0], { kilograms: 55 }] }],
    ['a negative weight', { ...CHART, rows: [CHART.rows[0], { kilograms: -5, pounds: -11 }] }],
    [
      'an infinite weight',
      { ...CHART, rows: [CHART.rows[0], { kilograms: 55, pounds: Infinity }] },
    ],
  ])('refuses %s', (_what, candidate) => {
    expect(parses(candidate)).toBe(false);
  });

  it.each([
    ['no revision', { ...CHART.source, revision: '' }],
    ['no verification date', { ...CHART.source, verifiedOn: '' }],
    ['a verification date that is a year', { ...CHART.source, verifiedOn: '2026' }],
  ])('refuses a source with %s', (_what, source) => {
    // Attribution without a revision or a date is a claim the tool cannot
    // support: it says whose numbers these are but not which ones or how old.
    expect(parses({ ...CHART, source })).toBe(false);
  });

  it('refuses a citation URL that is not https', () => {
    // This string is rendered into an `href`. `javascript:` is the case that
    // makes a URL check a security control rather than tidiness -- it passes a
    // plain URL validator, and it runs when a lifter taps the citation.
    expect(parses({ ...CHART, source: { ...CHART.source, url: 'javascript:alert(1)' } })).toBe(
      false,
    );
    expect(parses({ ...CHART, source: { ...CHART.source, url: 'http://example.test/' } })).toBe(
      false,
    );
  });
});

describe('conversionChartArtifactId', () => {
  it('names an artifact per federation', () => {
    expect(conversionChartArtifactId('uspa')).toBe('conversions-uspa');
  });

  it('slugs an identifier that would not survive a filename', () => {
    expect(conversionChartArtifactId('Example Federation')).toBe('conversions-example-federation');
  });

  it('returns null when nothing survives slugging', () => {
    // Total rather than throwing, because the browser asks this on the way to
    // deciding whether an artifact exists, and "no such chart" is a state the
    // interface already renders.
    expect(conversionChartArtifactId('///')).toBeNull();
  });
});
