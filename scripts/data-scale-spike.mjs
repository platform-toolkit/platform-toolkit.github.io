#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Measures what a full record book costs to publish, so that the hosting
 * decision is made against numbers rather than against a guess.
 *
 * The question this answers: a complete set of records -- every level, region,
 * sex, equipment category, weight class, division and lift -- is on the order of
 * a million rows. Does that fit inside GitHub Pages, and does it arrive at a
 * browser in a usable shape?
 *
 * WHY SYNTHETIC DATA
 *
 * No published federation figure appears here. The spike measures the *cost of
 * a row*, which depends on the shape of a row and not on what the numbers are,
 * so invented values answer the question exactly as well and keep this
 * repository free of data it has no licence to restate. Identifier lengths are
 * chosen to resemble real ones, because those do affect the byte count.
 *
 * USAGE
 *
 *   node scripts/data-scale-spike.mjs                    default sweep
 *   node scripts/data-scale-spike.mjs --rows 250000      one measurement
 *   node scripts/data-scale-spike.mjs --write            also write to disk
 *
 * Requires a build: it imports the real publishing pipeline from
 * `packages/ingestion/dist` rather than reimplementing it, because a
 * measurement of something other than the shipping code is worth nothing.
 */
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { RecordBookSchema } from '../packages/data-contracts/dist/index.js';
import {
  ARTIFACT_BUDGET_BYTES,
  planPublication,
  writePublication,
} from '../packages/ingestion/dist/index.js';

/** GitHub Pages refuses to publish a site larger than this. Documented, not a guess. */
const PAGES_SITE_LIMIT_BYTES = 1024 ** 3;

const DEFAULT_SWEEP = [1_000, 10_000, 100_000, 400_000];

function parseArguments(argv) {
  const rowsFlag = argv.indexOf('--rows');
  return {
    rowCounts: rowsFlag === -1 ? DEFAULT_SWEEP : [Number.parseInt(argv[rowsFlag + 1] ?? '', 10)],
    write: argv.includes('--write'),
  };
}

/**
 * Builds a record book of `rowCount` rows.
 *
 * Values vary across rows on purpose. A book of identical rows compresses to
 * almost nothing and would make the gzip figure a fiction; varying the
 * identifiers and the weights gives an entropy profile closer to the real
 * thing, which is what the transfer estimate depends on.
 */
function syntheticBook(rowCount) {
  const levels = ['state', 'national', 'world'];
  const equipment = ['raw', 'single-ply', 'multi-ply'];
  const divisions = ['open', 'junior', 'sub-master', 'master-1', 'master-2', 'master-3'];
  const lifts = ['squat', 'bench', 'deadlift', 'total'];

  const records = [];
  for (let index = 0; index < rowCount; index += 1) {
    const regionNumber = index % 50;
    records.push({
      id: `rec-${index.toString(36).padStart(6, '0')}`,
      scope: {
        levelId: levels[index % levels.length],
        regionId: `region-${regionNumber.toString().padStart(2, '0')}`,
        sex: index % 2 === 0 ? 'female' : 'male',
        equipmentId: equipment[index % equipment.length],
        weightClassId: `wc-${(index % 13) * 5 + 44}`,
        divisionId: divisions[index % divisions.length],
        tested: index % 3 === 0,
        lift: lifts[index % lifts.length],
      },
      // Spread across a plausible range with a half-kilo step, so the numbers
      // serialize at the same width real ones would.
      kilograms: 60 + ((index * 7) % 800) / 2,
      holderName: `Lifter ${index.toString(36)}`,
      achievedOn: `20${(10 + (index % 16)).toString()}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      meetName: `Meet ${(index % 700).toString(36)} Championships`,
    });
  }

  return { id: 'spike', label: 'Scale spike', minimumIncrementKilograms: 0.5, records };
}

function megabytes(bytes) {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function measure(rowCount, write) {
  const book = syntheticBook(rowCount);

  const planStart = process.hrtime.bigint();
  const plan = planPublication({
    generatedAt: '2026-07-31T00:00:00.000Z',
    sources: [
      {
        id: 'spike',
        label: 'Scale spike',
        retrievedAt: '2026-07-31T00:00:00.000Z',
        status: 'ok',
      },
    ],
    artifacts: [{ id: 'records-spike', schema: RecordBookSchema, schemaVersion: 1, value: book }],
    // Deliberately unbudgeted. Measuring what an unsharded corpus costs is the
    // whole point, and the budget exists because of what this measurement says.
    maxArtifactBytes: Number.POSITIVE_INFINITY,
  });
  const planMs = Number(process.hrtime.bigint() - planStart) / 1e6;

  const artifact = plan.files[0];
  const rawBytes = Buffer.byteLength(artifact.contents, 'utf8');

  const gzipStart = process.hrtime.bigint();
  // Level 6 is what a CDN serves by default. Measuring level 9 would flatter the
  // result by an amount nobody will actually receive.
  const gzipBytes = gzipSync(artifact.contents, {
    level: zlibConstants.Z_DEFAULT_COMPRESSION,
  }).byteLength;
  const gzipMs = Number(process.hrtime.bigint() - gzipStart) / 1e6;

  let writeMs = null;
  if (write) {
    const directory = await mkdtemp(join(tmpdir(), 'ptk-spike-'));
    try {
      const writeStart = process.hrtime.bigint();
      await writePublication(plan, directory);
      writeMs = Number(process.hrtime.bigint() - writeStart) / 1e6;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return { rowCount, rawBytes, gzipBytes, planMs, gzipMs, writeMs };
}

function report(results) {
  const rows = results.map((result) => ({
    rows: result.rowCount.toLocaleString('en-US'),
    raw: megabytes(result.rawBytes),
    gzip: megabytes(result.gzipBytes),
    'bytes/row': (result.rawBytes / result.rowCount).toFixed(0),
    'gzip/row': (result.gzipBytes / result.rowCount).toFixed(0),
    'plan ms': result.planMs.toFixed(0),
    'gzip ms': result.gzipMs.toFixed(0),
    'write ms': result.writeMs === null ? '-' : result.writeMs.toFixed(0),
  }));
  console.table(rows);

  const largest = results.at(-1);
  const bytesPerRow = largest.rawBytes / largest.rowCount;
  const gzipPerRow = largest.gzipBytes / largest.rowCount;

  console.log('\nExtrapolated from the largest measurement:');
  for (const total of [1_000_000, 2_500_000]) {
    console.log(
      `  ${total.toLocaleString('en-US')} rows: ${megabytes(total * bytesPerRow)} on disk, ` +
        `${megabytes(total * gzipPerRow)} over the wire ` +
        `(${((total * bytesPerRow) / PAGES_SITE_LIMIT_BYTES).toFixed(2)}x the Pages 1 GB site limit)`,
    );
  }

  const rowsPerShard = Math.floor(ARTIFACT_BUDGET_BYTES / bytesPerRow);
  console.log(
    `\nAt a ${megabytes(ARTIFACT_BUDGET_BYTES)} artifact budget, one artifact holds about ` +
      `${rowsPerShard.toLocaleString('en-US')} rows, so 1,000,000 rows is about ` +
      `${Math.ceil(1_000_000 / rowsPerShard).toLocaleString('en-US')} artifacts.`,
  );
}

const { rowCounts, write } = parseArguments(process.argv.slice(2));
const results = [];
for (const rowCount of rowCounts) {
  if (!Number.isInteger(rowCount) || rowCount <= 0) {
    throw new RangeError(`--rows expects a positive integer, received ${String(rowCount)}`);
  }
  results.push(await measure(rowCount, write));
}
report(results);
