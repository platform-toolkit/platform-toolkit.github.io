// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  ConversionSourceError,
  buildConversionChart,
  readConversionSourceReferences,
} from './conversion-chart.js';

/**
 * Every figure below is invented. The real chart lives in `data/sources/`, and a
 * test asserting its rows would be a second copy of it -- so the day the
 * federation revised a row, the test would fail for being correct.
 *
 * The fixture uses a factor of exactly 2, which makes every expectation legible:
 * 30 kg is 60 lb and nothing rounds.
 */
const DIGEST = 'a'.repeat(64);

interface Row {
  kilograms: number;
  pounds: number;
}

function document(overrides: { rows?: Row[]; chart?: Record<string, unknown> } = {}): unknown {
  return {
    $comment: 'Tolerated and dropped, like everywhere else.',
    id: 'example',
    label: 'Example Federation',
    provenance: {
      id: 'example-conversions',
      label: 'Example conversion chart',
      document: 'Kilograms to Pounds Conversion Chart',
      url: 'https://example.test/chart/',
      sections: ['Kilograms to Pounds Conversion Chart'],
      retrievedAt: '2026-08-01T00:00:00.000Z',
    },
    chart: {
      revision: '2026-01',
      sha256: DIGEST,
      url: 'https://example.test/chart.pdf',
      statedFactor: 2,
      rows: overrides.rows ?? [
        { kilograms: 30, pounds: 60 },
        { kilograms: 32.5, pounds: 65 },
        { kilograms: 35, pounds: 70 },
        { kilograms: 37.5, pounds: 75 },
      ],
      ...overrides.chart,
    },
  };
}

function built(candidate: unknown = document()) {
  return buildConversionChart(candidate);
}

describe('buildConversionChart', () => {
  it('produces the artifact the browser reads', () => {
    const { chart } = built();
    expect(chart.id).toBe('example');
    expect(chart.rows).toHaveLength(4);
    expect(chart.source).toStrictEqual({
      label: 'Kilograms to Pounds Conversion Chart',
      url: 'https://example.test/chart/',
      revision: '2026-01',
      verifiedOn: '2026-08-01',
    });
  });

  it('cites the page a reader can visit, not the file it was transcribed from', () => {
    // The PDF is pinned so a revision is noticed; it is not what a lifter is sent
    // to, and it is not redistributed.
    const { chart } = built();
    expect(chart.source.url).toBe('https://example.test/chart/');
  });

  it('reports freshness from the day the document was read', () => {
    const { freshness } = built();
    expect(freshness.retrievedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(freshness.status).toBe('ok');
    expect(freshness.label).toContain('Kilograms to Pounds Conversion Chart');
  });

  it('finds nothing to report when every row matches the printed factor', () => {
    expect(built().anomalies).toStrictEqual([]);
  });

  it('reports a row the chart’s own factor does not reproduce, and publishes it anyway', () => {
    // The published row wins. A build that refused it would be insisting the
    // federation is wrong about its own chart; what this needs is a person's
    // attention, which is what the report is.
    const result = built(
      document({
        rows: [
          { kilograms: 30, pounds: 60 },
          { kilograms: 32.5, pounds: 68 },
          { kilograms: 35, pounds: 70 },
          { kilograms: 37.5, pounds: 75 },
        ],
      }),
    );
    expect(result.anomalies).toStrictEqual([
      { kilograms: 32.5, publishedPounds: 68, factorPounds: 65 },
    ]);
    expect(result.chart.rows[1]).toStrictEqual({ kilograms: 32.5, pounds: 68 });
  });

  it('tolerates the last decimal place, which is where a federation’s rounding lands', () => {
    const result = built(
      document({
        rows: [
          { kilograms: 30, pounds: 60 },
          { kilograms: 32.5, pounds: 65.04 },
          { kilograms: 35, pounds: 70 },
          { kilograms: 37.5, pounds: 75 },
        ],
      }),
    );
    expect(result.anomalies).toStrictEqual([]);
  });

  it('refuses a chart with a gap nobody has vouched for', () => {
    // The requirement is that a missing increment be flagged for review, never
    // generated. This is the flag.
    expect(() =>
      built(
        document({
          rows: [
            { kilograms: 30, pounds: 60 },
            { kilograms: 32.5, pounds: 65 },
            { kilograms: 37.5, pounds: 75 },
            { kilograms: 40, pounds: 80 },
          ],
        }),
      ),
    ).toThrow(/increment changes between 32.5 kg and 37.5 kg/u);
  });

  it('accepts a gap a person has looked at and explained', () => {
    const result = built(
      document({
        rows: [
          { kilograms: 30, pounds: 60 },
          { kilograms: 32.5, pounds: 65 },
          { kilograms: 37.5, pounds: 75 },
          { kilograms: 40, pounds: 80 },
        ],
        chart: {
          acknowledgedGaps: [
            {
              belowKilograms: 32.5,
              aboveKilograms: 37.5,
              reason: 'The published chart really does skip this increment.',
            },
          ],
        },
      }),
    );
    expect(result.chart.rows).toHaveLength(4);
  });

  it('refuses an acknowledgement that no longer describes a gap', () => {
    // Left alone it would sit in the document vouching for nothing and read as a
    // fact about the chart to the next person.
    expect(() =>
      built(
        document({
          chart: {
            acknowledgedGaps: [
              { belowKilograms: 32.5, aboveKilograms: 37.5, reason: 'Stale, the row came back.' },
            ],
          },
        }),
      ),
    ).toThrow(/no longer a gap/u);
  });

  it('refuses rows that are out of order', () => {
    expect(() =>
      built(
        document({
          rows: [
            { kilograms: 30, pounds: 60 },
            { kilograms: 27.5, pounds: 55 },
          ],
        }),
      ),
    ).toThrow(ConversionSourceError);
  });

  it('refuses a digest that is not a sha-256', () => {
    expect(() => built(document({ chart: { sha256: 'not-a-digest' } }))).toThrow(
      ConversionSourceError,
    );
  });

  it('refuses a document with no pin at all', () => {
    // Without it, `check:upstream` has nothing to watch, and the chart is not
    // committed -- so a revision would go unnoticed indefinitely.
    expect(() => built(document({ chart: { sha256: undefined } }))).toThrow(ConversionSourceError);
  });

  it('reports every problem at once', () => {
    let problems: readonly string[] = [];
    try {
      built({ id: 'example' });
    } catch (error) {
      if (error instanceof ConversionSourceError) {
        problems = error.problems;
      }
    }
    expect(problems.length).toBeGreaterThan(1);
  });

  it('never quotes a value back in a schema failure', () => {
    // Ingestion logs are public, and these artifacts will one day include imported
    // results. Path and expectation are enough to find the bug.
    try {
      built(document({ chart: { statedFactor: 'two' } }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConversionSourceError);
      expect((error as ConversionSourceError).message).not.toContain('two');
      expect((error as ConversionSourceError).message).toContain('chart.statedFactor');
    }
  });
});

describe('readConversionSourceReferences', () => {
  it('reads the pin without the rest of the document being valid', () => {
    // The moment knowing whether upstream moved is most useful is when the build
    // is rejecting the transcription.
    expect(
      readConversionSourceReferences({
        id: 'example',
        chart: { sha256: DIGEST, url: 'https://example.test/chart.pdf', rows: 'nonsense' },
      }),
    ).toStrictEqual({
      federationId: 'example',
      chartSha256: DIGEST,
      chartUrl: 'https://example.test/chart.pdf',
    });
  });

  it('refuses a document with no pin', () => {
    expect(() => readConversionSourceReferences({ id: 'example', chart: {} })).toThrow(
      ConversionSourceError,
    );
  });
});
