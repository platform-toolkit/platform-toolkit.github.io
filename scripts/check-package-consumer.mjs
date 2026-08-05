#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds a tool package the way a stranger would: from its tarball.
 *
 * WHY EVERY OTHER TEST IN THIS REPOSITORY MISSES WHAT THIS ONE CATCHES
 *
 * Inside the workspace, `@platform-toolkit/qualification-check` resolves through a
 * pnpm symlink to the package directory, and TypeScript resolves it through a
 * project reference to the source. Both of those are aliases the workspace invents.
 * Neither exists for someone who ran `npm install`. So a package can be imported by
 * every test in the repository, render in Storybook, ship in the built site, and
 * still be a package nobody outside can use -- because what a consumer gets is the
 * tarball, and the tarball is assembled by a completely different set of rules.
 *
 * Section 15 asks for this test by name, and the first run of it found the failure
 * it was written for: `dist/` is in `.gitignore`, `npm pack` honours `.gitignore`
 * when there is no `files` field, so every package in the collection packed its
 * TypeScript source and none of its compiled output. Every `exports` entry pointed
 * at a file that was not in the tarball. The published package would have been
 * inert, and nothing else here would have said a word.
 *
 * WHAT IT CHECKS
 *
 *   - every path named in every `exports` map is actually inside the tarball
 *   - the declared dependency closure is enough to build against -- a consumer gets
 *     only what the manifests ask for, so an undeclared dependency is a missing
 *     module rather than a lucky hoist
 *   - the shipped `.d.ts` files type-check under a plain, strict `tsc` that knows
 *     nothing of this repository's `tsconfig.base.json`
 *   - the pure core actually runs in Node, from the tarball, with no bundler
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never touches the network. Workspace packages come from tarballs; registry
 * dependencies are symlinked out of the store pnpm already populated. A check that
 * resolved `lit` from a registry would be testing the registry, would fail on a
 * train, and would take a minute doing it.
 *
 * It does not import `./element` at runtime. Those modules extend `HTMLElement` at
 * module-evaluation time, so importing them in Node throws for a reason that has
 * nothing to do with packaging. The type pass covers that entry point; the browser
 * suite covers the behaviour.
 *
 * WHY THE SCRATCH DIRECTORY IS UNDER $HOME
 *
 * Santa runs in Lockdown mode on the development machine and authorizes some
 * binaries by a path regex rooted at $HOME (section 6). A denial does not report a
 * permission error -- the process dies and the caller reports whatever a dead
 * subprocess looks like from the inside. Building under `/tmp` would eventually
 * produce a packaging bug that is not one.
 *
 * USAGE
 *
 *   node scripts/check-package-consumer.mjs                after `pnpm run build`
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_ROOT = join(REPOSITORY_ROOT, 'packages');

/** See the header: $HOME, not `/tmp`, and the reason is Santa rather than taste. */
const SCRATCH_ROOT = join(homedir(), '.ptk-pack-check');

/**
 * The packages a third party is meant to be able to install, each with the source
 * that consumes it.
 *
 * Section 15 makes every tool a package eventually (#76), and each one joins this
 * list as it lands -- the dependency closure is worked out from the manifests, so a
 * tool that pulls in a new workspace package needs no edit here.
 *
 * The two sources belong to the entry rather than to the file, because a shared one
 * could only import what every package happens to have in common, and what they have
 * in common is nothing: the entry points differ per tool, and the entry points are
 * the thing under test. `consumer` is type-checked and never run; `smoke` is run and
 * must therefore stay clear of anything that needs a DOM.
 *
 * Each `consumer` deliberately uses a *value* from every entry point rather than
 * importing for side effects: an `import` with no binding can be elided by the
 * compiler, and an elided import proves nothing about whether the file exists.
 *
 * @type {readonly { name: string, slug: string, consumer: string, smoke: string }[]}
 */
const CONSUMABLE = [
  {
    name: '@platform-toolkit/qualification-check',
    slug: 'qualification-check',
    consumer: `import {
  ATHLETE_SEARCH_EVENT,
  PROFILE_IMPORT_TAG,
  QUALIFICATION_CHECK_TAG,
  defineQualificationCheck,
  type AthleteMatches,
  type LookupStatus,
} from '@platform-toolkit/qualification-check/element';
import {
  emptyTypedResult,
  mayPreselect,
  readProfileQuery,
} from '@platform-toolkit/qualification-check/core';
import { proposeSex } from '@platform-toolkit/qualification-check';
import type { CategoryProposal } from '@platform-toolkit/qualification-check/types';

export function consume(): string {
  // Annotated on purpose: an inferred type would still compile if the shipped
  // \`./types\` entry point resolved to nothing, and \`CategoryProposal\` is exported
  // from there and nowhere else.
  const proposal: CategoryProposal<'female' | 'male'> = proposeSex('M');
  const form = emptyTypedResult();
  const preselects = mayPreselect('measured');
  const define: () => unknown = defineQualificationCheck;
  // The import route's whole seam, annotated for the same reason. A consumer wiring
  // its own archive to the panel needs all three of these and gets none of them from
  // \`data-access\`, which this package deliberately does not depend on -- so a build
  // that shipped the element without its types would leave that consumer casting.
  const status: LookupStatus = 'searching';
  const answer: AthleteMatches = { outcome: 'found', matches: [] };
  const reading = readProfileQuery('Jane Invented');
  return [
    QUALIFICATION_CHECK_TAG,
    PROFILE_IMPORT_TAG,
    ATHLETE_SEARCH_EVENT,
    proposal.proposed,
    form.date,
    preselects,
    typeof define,
    status,
    answer.outcome,
    reading.ok,
  ].join(' ');
}
`,
    // The runtime smoke. Core only, and it asserts rather than prints, so a module
    // that resolves but exports nothing useful still fails.
    smoke: `import { emptyTypedResult, mayPreselect } from '@platform-toolkit/qualification-check/core';

const form = emptyTypedResult();
if (typeof form !== 'object' || form === null) throw new Error('emptyTypedResult returned nothing');
if (mayPreselect('measured') !== true) throw new Error('mayPreselect disagrees with its own rule');
if (mayPreselect('spelled') !== false) throw new Error('mayPreselect disagrees with its own rule');
`,
  },
  {
    name: '@platform-toolkit/training-logbook',
    slug: 'training-logbook',
    consumer: `import {
  TRAINING_LOGBOOK_TAG,
  WORKOUT_STARTED_EVENT,
  defineTrainingLogbook,
  type SaveState,
  type WorkoutEventDetail,
} from '@platform-toolkit/training-logbook/element';
import {
  createWorkout,
  emptyPerformance,
  workoutProgress,
} from '@platform-toolkit/training-logbook/core';
import {
  createRepository,
  memoryLogbookStore,
  type TrainingLogbookRepository,
} from '@platform-toolkit/training-logbook/storage';
import { SCHEMA_VERSION } from '@platform-toolkit/training-logbook';
import type { WorkoutSession } from '@platform-toolkit/training-logbook/types';

export function consumeTrainingLogbook(): string {
  // Annotated on purpose: an inferred type would still compile if the shipped
  // \`./types\` entry point resolved to nothing, and \`WorkoutSession\` is what a
  // consumer reading a backup file off disk has to name. It is exported from there
  // and, as a type, from the root -- but not from \`./core\`, which is the entry
  // point such a consumer would otherwise reach for.
  const workout: WorkoutSession = createWorkout(
    { nextId: () => 'invented-id', at: '2026-01-01T09:00:00.000Z' },
    { localDate: '2026-01-01', title: 'Invented session' },
  );
  const progress = workoutProgress(workout);
  const blank = emptyPerformance();
  const define: () => unknown = defineTrainingLogbook;
  // The storage seam, annotated for the same reason. Section 15 puts storage behind
  // an adapter the host supplies, so a host with its own database implements
  // \`LogbookStore\` and gets this back -- and a build that shipped \`./storage\`
  // without its declarations would leave that host casting, which is the one thing
  // the seam exists to spare it.
  const repository: TrainingLogbookRepository = createRepository(memoryLogbookStore(), {
    now: () => '2026-01-01T09:00:00.000Z',
    applicationVersion: 'invented',
  });
  const save: SaveState = repository.durable ? 'saved' : 'unavailable';
  const started: WorkoutEventDetail = { workoutId: workout.id };
  return [
    TRAINING_LOGBOOK_TAG,
    WORKOUT_STARTED_EVENT,
    String(SCHEMA_VERSION),
    workout.status,
    String(progress.total),
    blank.load.kind,
    typeof define,
    save,
    started.workoutId,
  ].join(' ');
}
`,
    // Core and storage, because the in-memory adapter is the one a host with no
    // IndexedDB is handed and it therefore has to work with no browser at all. That
    // is also the assertion worth making here: if \`./storage\` ever drags the DOM in
    // behind it, this is the only test in the repository that would notice.
    smoke: `import { createWorkout, workoutProgress } from '@platform-toolkit/training-logbook/core';
import { createRepository, memoryLogbookStore } from '@platform-toolkit/training-logbook/storage';

const context = { nextId: () => 'invented-id', at: '2026-01-01T09:00:00.000Z' };
const workout = createWorkout(context, { localDate: '2026-01-01' });
if (workout.status !== 'draft') throw new Error('a new workout is not a draft');
if (workoutProgress(workout).total !== 0) throw new Error('an empty workout counts sets');

const repository = createRepository(memoryLogbookStore(), {
  now: () => '2026-01-01T09:00:00.000Z',
  applicationVersion: 'invented',
});
if (repository.durable) throw new Error('the memory store claims to keep things');
await repository.saveActiveWorkout(workout);
const reread = await repository.loadActiveWorkout();
if (reread === null) throw new Error('the repository lost the workout it was handed');
if (reread.id !== workout.id) throw new Error('the repository returned a different workout');
`,
  },
];

/**
 * A plain consumer's compiler settings, and every difference from
 * `tsconfig.base.json` is on purpose.
 *
 * No `experimentalDecorators`, no `useDefineForClassFields: false`, no path
 * mapping, no project references. A `.d.ts` that only type-checks under this
 * repository's own configuration is a `.d.ts` a consumer cannot use, and the
 * decorator settings are the likely way that happens -- Lit needs them to *author*
 * a component and must not need them to *consume* one.
 *
 * `skipLibCheck` stays off. The declaration files are the product here; skipping
 * them would leave this check testing four import specifiers.
 */
const CONSUMER_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
  },
  include: ['src'],
};

/**
 * npm's tarball name for a package. Computed rather than scraped from `pnpm pack`'s
 * output, which is human-facing text that has changed shape before.
 *
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
function tarballName(name, version) {
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown>>}
 */
async function readManifest(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Every workspace package, by the name it publishes under.
 *
 * @returns {Promise<Map<string, string>>} name to directory
 */
async function readWorkspace() {
  const workspace = new Map();
  for (const entry of await readdir(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(PACKAGES_ROOT, entry.name);
    const manifest = await readManifest(join(directory, 'package.json'));
    if (typeof manifest['name'] === 'string') workspace.set(manifest['name'], directory);
  }
  return workspace;
}

/**
 * Every file path an `exports` map promises, however deeply the conditions nest.
 *
 * @param {unknown} node
 * @param {string[]} found
 */
function collectExportPaths(node, found) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push(node);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const value of Object.values(node)) collectExportPaths(value, found);
}

/**
 * Packs one workspace package and unpacks it somewhere a consumer can see it.
 *
 * `pnpm pack` rather than `npm pack`, because pnpm rewrites `workspace:*` into a
 * real version range on the way out. That rewrite is part of what is being tested:
 * a manifest that still said `workspace:*` would be unresolvable everywhere except
 * here, and `npm pack` would have shipped exactly that.
 *
 * @param {string} name
 * @param {string} directory
 * @returns {Promise<string>} the directory the tarball's `package/` was unpacked to
 */
async function packAndUnpack(name, directory) {
  const manifest = await readManifest(join(directory, 'package.json'));
  const version = String(manifest['version']);
  const tarballs = join(SCRATCH_ROOT, 'tarballs');

  execFileSync('pnpm', ['pack', '--pack-destination', tarballs], {
    cwd: directory,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const tarball = join(tarballs, tarballName(name, version));
  if (!existsSync(tarball)) throw new Error(`pnpm pack produced no ${tarballName(name, version)}`);

  const unpacked = join(SCRATCH_ROOT, 'unpacked', name.replace(/[@/]/g, '_'));
  await mkdir(unpacked, { recursive: true });
  // `--strip-components=1` drops the `package/` prefix every npm tarball carries.
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1'], { stdio: 'pipe' });
  return unpacked;
}

/**
 * Walks the declared dependency graph from the consumable packages, packing each
 * workspace package it reaches and noting each registry package it needs.
 *
 * The walk is over `dependencies` and `peerDependencies` only. `devDependencies`
 * are not installed for a consumer, so a package that needs one at runtime is
 * broken in a way this must reproduce rather than paper over.
 *
 * @param {Map<string, string>} workspace
 * @param {string[]} failures
 * @returns {Promise<{ packed: Map<string, string>, external: Map<string, string> }>}
 */
async function resolveClosure(workspace, failures) {
  /** @type {Map<string, string>} workspace package name to unpacked directory */
  const packed = new Map();
  /** @type {Map<string, string>} registry package name to the directory that wants it */
  const external = new Map();

  const queue = CONSUMABLE.map((entry) => entry.name);
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || packed.has(name)) continue;

    const directory = workspace.get(name);
    if (directory === undefined) {
      failures.push(`${name} is named as a workspace dependency but no package publishes it`);
      continue;
    }

    const unpacked = await packAndUnpack(name, directory);
    packed.set(name, unpacked);

    const manifest = await readManifest(join(unpacked, 'package.json'));
    const declared = {
      ...(manifest['dependencies'] ?? {}),
      ...(manifest['peerDependencies'] ?? {}),
    };
    for (const [dependency, range] of Object.entries(declared)) {
      if (String(range).startsWith('workspace:')) {
        // pnpm should have replaced this on the way into the tarball. If it is
        // still here the package is unpublishable, and the symptom for a consumer
        // is an install that fails on a protocol npm has never heard of.
        failures.push(
          `${name} ships "${dependency}": "${String(range)}", which npm cannot resolve`,
        );
      }
      if (workspace.has(dependency)) {
        queue.push(dependency);
        continue;
      }
      // A registry dependency. Resolved out of the store pnpm already filled, from
      // the perspective of the package that declared it, so a version disagreement
      // between two packages shows up as two different realpaths rather than as
      // whichever one got installed first.
      const link = join(directory, 'node_modules', dependency);
      if (!existsSync(link)) {
        failures.push(`${name} declares ${dependency}, which is not installed in the workspace`);
        continue;
      }
      const resolved = await realpath(link);
      const already = external.get(dependency);
      if (already !== undefined && already !== resolved) {
        failures.push(
          `${dependency} resolves two ways across the closure, so a flat install of it would be a guess`,
        );
        continue;
      }
      external.set(dependency, resolved);
    }
  }

  return { packed, external };
}

/**
 * @param {Map<string, string>} packed
 * @param {string[]} failures
 */
async function checkExportsExist(packed, failures) {
  for (const [name, unpacked] of packed) {
    const manifest = await readManifest(join(unpacked, 'package.json'));
    /** @type {string[]} */
    const paths = [];
    collectExportPaths(manifest['exports'], paths);
    if (paths.length === 0) {
      failures.push(`${name} declares no exports, so a consumer has no way in`);
      continue;
    }
    for (const path of new Set(paths)) {
      if (!existsSync(join(unpacked, path))) {
        failures.push(`${name} exports ${path}, which its tarball does not contain`);
      }
    }
  }
}

/**
 * Assembles the consumer's `node_modules` by hand.
 *
 * Workspace packages are **copied**, not linked. A symlink would resolve to the
 * workspace, and Node resolves a module's own imports from its realpath -- so a
 * linked package would find its dependencies in the workspace's tree and the whole
 * point of the exercise would quietly evaporate. Registry packages are linked,
 * because their realpath in pnpm's store is where their own dependencies live.
 *
 * @param {string} consumer
 * @param {Map<string, string>} packed
 * @param {Map<string, string>} external
 */
async function assemble(consumer, packed, external) {
  const modules = join(consumer, 'node_modules');
  for (const [name, unpacked] of packed) {
    const destination = join(modules, name);
    await mkdir(dirname(destination), { recursive: true });
    await cp(unpacked, destination, { recursive: true });
  }
  for (const [name, resolved] of external) {
    const destination = join(modules, name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(resolved, destination, 'dir');
  }

  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'ptk-pack-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
  );
  await writeFile(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify(CONSUMER_TSCONFIG, null, 2)}\n`,
  );
  await mkdir(join(consumer, 'src'), { recursive: true });
  // One file per package rather than one file importing everything. A single
  // consumer would stop at the first package whose declarations do not compile, and
  // the report would then name one tool and stay silent about the rest -- which is
  // the wrong shape for a check that gains an entry per tool. `tsc` compiles the
  // whole `src` directory in one pass either way.
  for (const entry of CONSUMABLE) {
    await writeFile(join(consumer, 'src', `${entry.slug}.consumer.ts`), entry.consumer);
    await writeFile(join(consumer, 'src', `${entry.slug}.smoke.mjs`), entry.smoke);
  }
}

/**
 * Runs a command and turns a non-zero exit into a failure line rather than a throw.
 *
 * @param {string} what
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {string[]} failures
 */
function run(what, command, args, cwd, failures) {
  try {
    execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  } catch (error) {
    const output = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    const detail = `${output}${stderr}`.trim() || String(error);
    failures.push(`${what}:\n    ${detail.split('\n').slice(0, 30).join('\n    ')}`);
  }
}

async function main() {
  const workspace = await readWorkspace();
  for (const { name } of CONSUMABLE) {
    const directory = workspace.get(name);
    if (directory === undefined) {
      console.error(`No workspace package publishes ${name}.`);
      process.exitCode = 1;
      return;
    }
    if (!existsSync(join(directory, 'dist'))) {
      console.error(`${name} has no dist. Run \`pnpm run build\` first.`);
      process.exitCode = 1;
      return;
    }
  }

  await rm(SCRATCH_ROOT, { recursive: true, force: true });
  await mkdir(join(SCRATCH_ROOT, 'tarballs'), { recursive: true });

  /** @type {string[]} */
  const failures = [];
  const { packed, external } = await resolveClosure(workspace, failures);
  await checkExportsExist(packed, failures);

  const consumer = join(SCRATCH_ROOT, 'consumer');
  await mkdir(consumer, { recursive: true });
  await assemble(consumer, packed, external);

  // The workspace's own compiler, invoked as a stranger would invoke it: one
  // tsconfig, no references, no build mode.
  run(
    'the shipped declarations do not type-check in a plain consumer',
    process.execPath,
    [join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'],
    consumer,
    failures,
  );

  for (const entry of CONSUMABLE) {
    run(
      `${entry.name}'s pure core does not run in Node from the tarball`,
      process.execPath,
      [join('src', `${entry.slug}.smoke.mjs`)],
      consumer,
      failures,
    );
  }

  if (failures.length > 0) {
    console.error(`Package-consumer check failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  const names = [...packed.keys()].sort().join(', ');
  console.log(
    `Package-consumer check passed: ${String(packed.size)} tarball(s) built and consumed (${names}).`,
  );
}

await main();
