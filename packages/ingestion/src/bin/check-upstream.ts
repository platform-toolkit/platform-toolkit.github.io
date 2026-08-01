#!/usr/bin/env node
/**
 * Asks every watched source whether it still publishes what we published.
 *
 * The build already refuses to run when a committed snapshot stops matching the
 * digest its mapping pins. That is a lock, and it only turns when somebody builds.
 * This is the doorbell: it runs on a schedule, downloads what upstream serves
 * today, and says so. It never edits a snapshot or a pin, because updating one is
 * the deliberate re-reading of a federation's table that the pin exists to force.
 *
 * The report it writes is committed on purpose, and its timestamp changes on every
 * run even when nothing else does. Two reasons, and the second is the load-bearing
 * one:
 *
 *   1. "Upstream was unchanged on this date" is provenance. Without it, a green
 *      run leaves no trace and the repository cannot say when it last looked.
 *   2. GitHub disables a repository's scheduled workflows after sixty days with
 *      no activity. A weekly commit of a real, true record is activity, so the
 *      schedule that produces it keeps itself alive.
 *
 * USAGE
 *
 *   node packages/ingestion/dist/bin/check-upstream.js [--report <path>]
 *
 * Run from the repository root. Writes `data/upstream-check.json` unless told
 * otherwise, prints a line per source, and exits non-zero only if it could not
 * run -- drift is a finding in the report, not a crash, because the caller needs
 * the report in order to act on it.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { readClassificationSourceReferences } from '../sources/classification-standards.js';
import { readConversionSourceReferences } from '../sources/conversion-chart.js';
import { checkUpstream, type UpstreamSource } from '../upstream-check.js';

const CLASSIFICATION_SOURCES = join('data', 'sources', 'classifications');
const CONVERSION_SOURCES = join('data', 'sources', 'conversions');

/** Committed. See the note above on why its timestamp moves every run. */
const DEFAULT_REPORT = join('data', 'upstream-check.json');

async function main(): Promise<void> {
  const report = await checkUpstream(await collectSources(), new Date().toISOString());

  for (const finding of report.findings) {
    const suffix = finding.detail === null ? '' : ` -- ${finding.detail}`;
    console.log(`${finding.status.padEnd(11)} ${finding.id}${suffix}`);
  }

  const drifted = report.findings.filter((finding) => finding.status === 'drifted');
  if (drifted.length > 0) {
    // Said plainly rather than left to whoever reads the JSON. A drifted source
    // means the site is serving figures the federation has stopped publishing.
    console.log(
      `\n${String(drifted.length)} source(s) drifted. The committed snapshot and its mapping ` +
        'have to be revisited together; nothing here changed either of them.',
    );
  }

  const path = resolve(process.cwd(), readReportPath());
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${readReportPath()}.`);
}

/**
 * Every source that declares a pin, whether or not it declares a URL.
 *
 * The undownloadable ones are collected too, so the report says out loud that
 * they exist and that nothing is watching them. Category catalogues are absent
 * because they are transcribed from a rulebook rather than pinned to a file --
 * they have nothing to compare, which is a different thing again and belongs in
 * the report only once there is something to say about it.
 *
 * A conversion chart is pinned without its document being committed: the chart
 * PDF carries a federation's logo and is not redistributed, so the digest in the
 * source file is the only copy of those bytes the repository holds. That makes
 * this check the sole thing standing between a revised chart and a site quietly
 * serving the old one.
 */
async function collectSources(): Promise<readonly UpstreamSource[]> {
  const sources: UpstreamSource[] = [];

  for (const { path, document } of await readSourceDocuments(CLASSIFICATION_SOURCES)) {
    const references = readClassificationSourceReferences(document);
    sources.push({
      id: `${references.federationId}-classifications`,
      document: path,
      sha256: references.standardsSha256,
      url: references.standardsUrl,
    });
  }

  for (const { path, document } of await readSourceDocuments(CONVERSION_SOURCES)) {
    const references = readConversionSourceReferences(document);
    sources.push({
      id: `${references.federationId}-conversions`,
      document: path,
      sha256: references.chartSha256,
      url: references.chartUrl,
    });
  }

  return sources;
}

/** Every JSON document in a directory, in filename order so a report is stable. */
async function readSourceDocuments(
  directory: string,
): Promise<readonly { path: string; document: unknown }[]> {
  const root = resolve(process.cwd(), directory);
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();

  const documents: { path: string; document: unknown }[] = [];
  for (const name of names) {
    const path = join(directory, name);
    const contents = await readFile(join(root, name), 'utf8');
    try {
      documents.push({ path, document: JSON.parse(contents) as unknown });
    } catch (cause) {
      throw new Error(`${path}: is not valid JSON.`, { cause });
    }
  }
  return documents;
}

/**
 * The report path, from `--report <path>`.
 *
 * Rejected rather than defaulted when the flag is present with nothing after it,
 * because the alternative is a run that writes somewhere the caller did not mean
 * and reports success.
 */
function readReportPath(): string {
  const index = process.argv.indexOf('--report');
  if (index === -1) {
    return DEFAULT_REPORT;
  }
  const supplied = process.argv[index + 1];
  if (supplied === undefined || supplied.startsWith('--')) {
    throw new Error('--report needs a path after it.');
  }
  return supplied;
}

await main();
