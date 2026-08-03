#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Sets a source mapping's `provenance.retrievedAt` to now.
 *
 * USAGE
 *
 *   node packages/ingestion/dist/bin/stamp-retrieval.js <mapping path> [<iso>]
 *
 * Run from the repository root. The timestamp is optional and defaults to the
 * current clock; a caller supplies one to stamp the moment a crawl *started*
 * rather than the moment it finished, and to re-stamp a refresh that failed
 * after the crawl.
 *
 * Two positional arguments and no flags, deliberately. This is invoked through
 * `pnpm run data:stamp`, and a package manager between the caller and the script
 * is one more thing that gets to decide whether `--at` was meant for it.
 *
 * WHEN TO RUN IT
 *
 * Immediately after a crawl that produced a changed snapshot, in the same
 * commit. Not after one that produced no change: the date then reads as the last
 * time the figures moved rather than the last time they were checked, which
 * understates freshness. That is the safe direction, and the direction the
 * scheduled workflow takes deliberately -- a page saying the records were
 * retrieved earlier than they were sends a reader to the federation's site,
 * while one saying they were retrieved later than they were sends nobody
 * anywhere. The weekly upstream report is where "checked and unchanged" is
 * recorded.
 *
 * The whole of the interesting behaviour is in `stamp-retrieval.ts`, which is
 * pure and tested. This file is argument reading and two filesystem calls.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { stampRetrievedAt } from '../stamp-retrieval.js';

async function main(): Promise<void> {
  const [path, at = new Date().toISOString(), ...rest] = process.argv.slice(2);
  if (path === undefined || rest.length > 0) {
    // No default path. This edits a committed document, and a tool that picked
    // a file to rewrite when nobody named one is a tool that rewrites the wrong
    // file the first time somebody mistypes something.
    throw new Error('Usage: stamp-retrieval.js <mapping path> [<iso timestamp>]');
  }

  const full = resolve(process.cwd(), path);
  const before = await readFile(full, 'utf8');
  const after = stampRetrievedAt(before, at);

  if (after === before) {
    // Reachable when the same instant is stamped twice, which a re-run of a
    // failed refresh does. Nothing to write, and nothing wrong.
    console.log(`${path} already records ${at}.`);
    return;
  }

  await writeFile(full, after, 'utf8');
  console.log(`${path}: retrievedAt is now ${at}.`);
}

await main();
