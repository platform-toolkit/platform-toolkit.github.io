#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Fails the build when a dependency arrives under a licence this project cannot
 * accept, and regenerates the published dependency-licence report.
 *
 * WHY A GATE RATHER THAN A PERIODIC AUDIT
 *
 * A licence problem is introduced by a transitive dependency bump, which is the
 * one kind of change nobody reads. `pnpm update` can move a package from MIT to
 * a source-available licence in a line of the lockfile that looks like every
 * other line, and the first anyone hears of it is from a downstream user who
 * cannot ship. The whole point of picking a permissive licence for this
 * repository is that people can build on it without a legal review; that promise
 * is only worth something if the dependency tree keeps it too.
 *
 * THE TWO TIERS, AND WHY THERE ARE TWO
 *
 * `PERMISSIVE` is allowed anywhere. Everything in it grants use, modification
 * and redistribution with attribution and nothing else.
 *
 * `BUILD_ONLY` is allowed in development and build tooling, and nowhere near the
 * production closure. The live entry is MPL-2.0, which is file-level copyleft:
 * its obligations attach to modified copies of the MPL-covered files themselves,
 * not to a work that merely ran the tool. An accessibility test runner and a CSS
 * transformer sit in that position -- their output is our output. If one of them
 * ever became a runtime dependency the calculus would change completely, so the
 * distinction is enforced instead of remembered.
 *
 * Anything in neither tier fails. That includes a missing licence field and an
 * unrecognised identifier: "we could not tell" is a failure here, not a pass,
 * because the failure mode of guessing is discovering the answer in public.
 *
 * The production closure comes from `pnpm licenses list --prod`, which resolves
 * what the workspace's `dependencies` actually pull in. Note that it includes
 * optional peers -- TypeScript arrives that way through valibot -- so membership
 * means "could reach a consumer", which is the conservative reading and the one
 * a gate should use.
 *
 * WHY THE REPORT LEAVES OUT NATIVE BINARIES
 *
 * A handful of build tools ship their compiled half as one package per platform
 * and let the package manager install the single variant that matches the
 * machine. A developer on an Apple laptop gets the darwin-arm64 builds; CI on
 * Linux gets different packages with different names. Both are correct, and a
 * report generated from either one is wrong on the other -- which is exactly how
 * this gate first failed: green locally, red in CI, with nothing wrong.
 *
 * So the enumerated table covers only the packages every host installs, and
 * host-specific binaries are excluded from it. They are still checked. The
 * licence rules run over everything installed, on whichever machine runs them,
 * so an unacceptable licence on a native binary fails the build for the person
 * who has it. What is dropped is the pretence that a committed document can
 * describe a set that is a property of the machine rather than of the project.
 *
 * USAGE
 *
 *   node scripts/check-dependency-licenses.mjs            check only
 *   node scripts/check-dependency-licenses.mjs --write    also rewrite the report
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPORT_PATH = fileURLToPath(new URL('../docs/dependency-licenses.md', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Licences accepted for any dependency, shipped or not.
 *
 * Every one of these permits commercial use, modification and redistribution
 * under attribution alone. 0BSD and CC0 go further and require not even that.
 */
const PERMISSIVE = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

/**
 * Licences accepted only outside the production closure.
 *
 * @see the header for why MPL-2.0 is here rather than in PERMISSIVE.
 */
const BUILD_ONLY = new Set(['MPL-2.0']);

// The tiers are checked in order, so an identifier in both would be allowed
// everywhere and its build-only restriction would read as enforced while doing
// nothing. That is the failure this project cares most about avoiding in a
// checker: a rule that is written down, tested green, and inert.
for (const license of BUILD_ONLY) {
  if (PERMISSIVE.has(license)) {
    throw new Error(`${license} is in both PERMISSIVE and BUILD_ONLY, so its restriction is inert`);
  }
}

/**
 * True when a package declares that it only installs on some machines.
 *
 * `os`, `cpu` and `libc` are npm's own way of saying "this artifact is for one
 * platform". Reading them beats matching names against a list of platform words:
 * the package itself is the authority on whether it is host-specific, and a name
 * pattern would both miss `fsevents` and eventually catch something innocent.
 *
 * @param {string | undefined} path
 * @returns {boolean}
 */
function isHostSpecific(path) {
  if (path === undefined) return false;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(`${path}/package.json`, 'utf8'));
  } catch {
    // A package pnpm listed but whose manifest will not read is not a place to
    // guess. Treating it as host-independent keeps it in the report, where a
    // human sees it, rather than silently dropping it.
    return false;
  }
  return Array.isArray(manifest.os) || Array.isArray(manifest.cpu) || Array.isArray(manifest.libc);
}

/**
 * Reads one of pnpm's licence listings.
 *
 * @param {boolean} productionOnly
 * @returns {Map<string, { license: string, versions: string[], homepage: string, hostSpecific: boolean }>}
 */
function readLicenses(productionOnly) {
  const args = ['licenses', 'list', '--json'];
  if (productionOnly) args.push('--prod');

  let raw;
  try {
    raw = execFileSync('pnpm', args, {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Almost always an absent node_modules. Say so, rather than letting a
    // JSON parse error stand in for "you have not installed anything yet".
    throw new Error('`pnpm licenses list` failed. Run `pnpm install` first.', { cause: error });
  }

  /**
   * @type {Record<string, Array<{ name: string, versions?: string[], homepage?: string, paths?: string[] }>>}
   */
  const grouped = JSON.parse(raw);
  const packages = new Map();
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      packages.set(entry.name, {
        license,
        versions: entry.versions ?? [],
        homepage: entry.homepage ?? '',
        hostSpecific: isHostSpecific(entry.paths?.[0]),
      });
    }
  }
  return packages;
}

/**
 * @param {Map<string, { license: string, hostSpecific: boolean }>} all
 * @param {Set<string>} shipped
 * @returns {string[]}
 */
function findViolations(all, shipped) {
  const violations = [];
  for (const [name, { license, hostSpecific }] of all) {
    // The report tells readers that no native binary reaches them, which is a
    // claim and therefore has to be a check. If one ever enters the production
    // closure, the document is wrong before anybody reads it.
    if (hostSpecific && shipped.has(name)) {
      violations.push(
        `${name} is a host-specific native binary, which the licence report says never ships, but it is in the production closure`,
      );
    }

    if (PERMISSIVE.has(license)) continue;

    if (BUILD_ONLY.has(license)) {
      if (shipped.has(name)) {
        violations.push(
          `${name} is ${license}, which is allowed for build tooling only, but it is in the production closure`,
        );
      }
      continue;
    }

    // Covers an unrecognised identifier and pnpm's own "Unknown" bucket alike.
    // Both mean the same thing to a downstream user: nobody checked.
    violations.push(
      `${name} is ${license === 'Unknown' ? 'missing a licence' : `licensed ${license}`}, which is not on the accepted list`,
    );
  }
  return violations.sort((left, right) => left.localeCompare(right));
}

/**
 * @param {Map<string, { license: string, versions: string[], homepage: string, hostSpecific: boolean }>} all
 * @param {Set<string>} shipped
 * @returns {string}
 */
function renderReport(all, shipped) {
  const rows = [...all.entries()]
    .filter(([, entry]) => !entry.hostSpecific)
    .sort(([left], [right]) => left.localeCompare(right));

  const byLicense = new Map();
  for (const [, { license }] of rows) byLicense.set(license, (byLicense.get(license) ?? 0) + 1);
  const summary = [...byLicense.entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([license, count]) => `- ${license} — ${String(count)}`)
    .join('\n');

  const table = rows
    .map(([name, entry]) => {
      const versions = entry.versions.join(', ');
      const where = shipped.has(name) ? 'shipped' : 'build';
      return `| ${name} | ${versions} | ${entry.license} | ${where} |`;
    })
    .join('\n');

  return `# Dependency licences

<!-- Generated by scripts/check-dependency-licenses.mjs --write. Do not edit by hand. -->

Every third-party package this repository installs, with the licence it declares
and whether it reaches a consumer.

**shipped** means the package is in the production closure: it is reachable from
a workspace package's \`dependencies\`, so it can end up inside the built site or
inside a published npm package. **build** means it exists only to develop, test
or build this repository, and no user of the toolkit receives it.

The distinction is enforced, not documentary —
\`scripts/check-dependency-licenses.mjs\` runs as part of \`pnpm run verify\` and
fails the build when a licence is unaccepted, unrecognised or missing, and when a
build-tooling-only licence turns up in the shipped column.

Attribution for the shipped packages is reproduced in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## What this table leaves out

Several build tools publish their compiled half as one package per operating
system and processor, and the package manager installs only the variant matching
the machine. Those packages are excluded from the table below, because the set of
them is a fact about a computer rather than about this project: a Linux CI runner
and an Apple laptop install different ones from the same lockfile, and a
committed list would be wrong on one of them by construction.

They are still checked. The licence rules run over everything actually installed,
wherever the check runs, so an unacceptable licence on a native binary fails the
build for whoever has it. None of them are in the production closure — no build
of this site or of any published package contains a native binary.

## Counts by licence

${summary}

## Packages

| Package | Version | Licence | Reach |
| --- | --- | --- | --- |
${table}
`;
}

async function main() {
  const all = readLicenses(false);
  const shipped = new Set(readLicenses(true).keys());

  const violations = findViolations(all, shipped);
  if (violations.length > 0) {
    console.error(`Dependency licence check failed:\n  ${violations.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  const report = renderReport(all, shipped);

  if (process.argv.includes('--write')) {
    await writeFile(REPORT_PATH, report, 'utf8');
    console.log(`Dependency licence report written: ${String(all.size)} packages.`);
    return;
  }

  // The committed report has to match the installed tree, or it is a document
  // that describes whatever was installed the last time somebody remembered to
  // regenerate it. Because the renderer is deterministic, staleness is exactly a
  // string comparison -- there is no reason to accept a report that drifted.
  /** @type {string | null} */
  let committed;
  try {
    committed = await readFile(REPORT_PATH, 'utf8');
  } catch {
    // An absent report is a distinct message below, not a crash: the first run
    // after adding the gate has nothing to compare against and the fix is the
    // same as for a stale one.
    committed = null;
  }
  if (committed !== report) {
    console.error(
      `Dependency licence check failed: ${committed === null ? 'docs/dependency-licenses.md is missing' : 'docs/dependency-licenses.md is out of date'}. Run \`pnpm run licenses:report\` and commit the result.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Dependency licence check passed: ${String(all.size)} packages, ${String(shipped.size)} of them shipped, report current.`,
  );
}

await main();
