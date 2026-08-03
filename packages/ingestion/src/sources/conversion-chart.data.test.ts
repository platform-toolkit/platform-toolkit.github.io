// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';

import { ConversionChart } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import { buildConversionChart } from './conversion-chart.js';

/**
 * A tripwire on the committed transcription itself.
 *
 * Every other test in this package uses invented figures, and for good reason: a
 * test that restates a federation's numbers is a second copy of them, and the day
 * the federation revises one, the test fails for being right. This file is the
 * deliberate exception the requirements ask for -- "automated tests pin known
 * rows" -- and it is kept to the smallest set that does the job.
 *
 * What it pins is the *shape* of the chart plus its two endpoints: 180 rows from
 * 25 kg to 472.5 kg in uniform 2.5 kg steps. Those five facts cannot change
 * without somebody having gone back to the published document, and an accidental
 * edit -- a row deleted while scrolling, a digit transposed, a merge that dropped
 * a block -- breaks at least one of them. Nothing here restates the interior rows;
 * `data/sources/conversions/uspa.json` remains their only copy.
 *
 * If USPA publishes a revision, this test is meant to fail. Update it in the same
 * commit that updates the transcription, the digest, and the verification date.
 */

const SOURCE_PATH = new URL('../../../../data/sources/conversions/uspa.json', import.meta.url);

const document = JSON.parse(readFileSync(SOURCE_PATH, 'utf8')) as unknown;

describe('the committed USPA conversion chart', () => {
  const result = buildConversionChart(document);

  it('builds without a gap, an ordering problem, or a duplicate', () => {
    // `buildConversionChart` throws on any of those, so reaching here is the
    // assertion. Stated as a test anyway, because a file that only fails at
    // import time reports as a suite that could not load.
    expect(result.chart.rows.length).toBeGreaterThan(0);
  });

  it('has the published number of rows', () => {
    expect(result.chart.rows).toHaveLength(180);
  });

  it('starts and ends where the document does', () => {
    expect(result.chart.rows.at(0)).toStrictEqual({ kilograms: 25, pounds: 55.1 });
    expect(result.chart.rows.at(-1)).toStrictEqual({ kilograms: 472.5, pounds: 1041.7 });
  });

  it('steps by 2.5 kg the whole way, with nothing missing', () => {
    const steps = new Set<number>();
    for (const [index, row] of result.chart.rows.entries()) {
      const previous = index === 0 ? undefined : result.chart.rows[index - 1];
      if (previous !== undefined) {
        steps.add(Math.round((row.kilograms - previous.kilograms) * 10) / 10);
      }
    }
    expect([...steps]).toStrictEqual([2.5]);
  });

  it('agrees with the factor the chart itself prints', () => {
    // The rows are the source and the factor is only a check -- see the adapter --
    // so a disagreement here is a finding, not a correction. Today there are none,
    // and that is worth knowing if it ever stops being true.
    expect(result.anomalies).toStrictEqual([]);
  });

  it('is a chart the domain will look up in', () => {
    const built = ConversionChart.from(result.chart);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.chart.gaps).toStrictEqual([]);
  });

  it('cites the federation without claiming to be its product', () => {
    expect(result.chart.source.url.startsWith('https://')).toBe(true);
    expect(result.chart.source.revision).not.toBe('');
    expect(result.chart.source.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});
