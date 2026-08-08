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
 *   - every bare specifier the tarball's own shipped code imports is declared by the
 *     tarball's own manifest, so an undeclared dependency is a missing module for a
 *     consumer rather than a lucky hoist here
 *   - a shared singleton (see below) is peered, and peered on a range wide enough
 *     that a consumer's own copy is the copy the package gets
 *   - the declared dependency closure is enough to build against
 *   - the shipped `.d.ts` files type-check under a plain, strict `tsc` that knows
 *     nothing of this repository's `tsconfig.base.json`
 *   - the pure core actually runs in Node, from the tarball, with no bundler
 *
 * EVERY PACKAGE IS PACKED, NOT ONLY THE TWO WITH A CONSUMER
 *
 * `CONSUMABLE` names the packages a stranger is meant to *build against*, and only
 * those get a compiled consumer and a runtime smoke -- writing one costs a page of
 * annotated source per tool. But packing is cheap, and the manifest faults below are
 * not about a consumer's source at all: a package with no `files` field ships its
 * `src/`, its `tsbuildinfo` and any gitignored notes beside it, and nothing in a
 * consumer's build would ever mention that. So the pack, the `exports` sweep, the
 * import audit and the singleton rules run over **every** package under `packages/`.
 * Three of them had been outside this check's reach entirely, which is how three of
 * them came to be shipping their source.
 *
 * SHARED SINGLETONS, AND WHY A PINNED `dependency` ON ONE IS THE WORST BUG HERE
 *
 * Lit is not an ordinary dependency. It writes to the one global `customElements`
 * registry, and `ReactiveElement`, the directive base classes and lit-html's
 * template-part brands are all identities held per module instance. So two copies in
 * one page is not "slightly larger download": `defineTrainingLogbook()` from copy A
 * registers elements copy B does not recognise, `instanceof LitElement` is false
 * across the seam, and a directive authored against one throws inside the other. The
 * elements simply never upgrade, and **nothing logs**.
 *
 * A consumer gets two copies whenever the range a package declares does not admit
 * the version the consumer already has -- npm and pnpm both answer that by nesting a
 * second copy under the package rather than by failing. So the rules are:
 *
 *   - a singleton is a `peerDependency`, never a `dependency`. A dependency is a
 *     copy this package owns; a peer is the consumer's copy, which is the only
 *     answer that can be correct for something with a global registry behind it.
 *   - the peer range must admit more than one version. `"lit": "3.3.3"` as a peer is
 *     the same duplication with an extra step, and `~3.3.3` only defers it a minor.
 *     The check measures the range against the installed version *and* against the
 *     next minor of it, which is the plausible consumer six months from now.
 *   - it stays in `devDependencies`, or the workspace has no version to build and
 *     test against and every tsc here fails on a missing module.
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
import { builtinModules } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_ROOT = join(REPOSITORY_ROOT, 'packages');

/** See the header: $HOME, not `/tmp`, and the reason is Santa rather than taste. */
const SCRATCH_ROOT = join(homedir(), '.ptk-pack-check');

/**
 * Dependencies a consumer's graph must hold exactly one copy of. The header says why
 * Lit is one; the test for adding another is whether two copies would disagree about
 * an identity rather than merely cost bytes -- a global registry, a `Symbol`-free
 * brand check, an `instanceof` across the seam.
 *
 * `valibot` is deliberately *not* here. Two copies of it validate independently and
 * agree, so pinning it is a size question and not a correctness one.
 */
const SHARED_SINGLETONS = new Set(['lit']);

/** Node's own modules, which no manifest has to declare. */
const BUILTINS = new Set(builtinModules);

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
    name: '@platform-toolkit/convert',
    slug: 'convert',
    consumer: `import {
  CONVERSION_RESULT_TAG,
  CONVERTER_TAG,
  SELECT_WEIGHT_EVENT,
  defineConvert,
  type SelectWeightDetail,
} from '@platform-toolkit/convert/element';
import {
  CHART_STEPS,
  EMPTY_ENTRY,
  reverse,
  typeInto,
  weightProblem,
} from '@platform-toolkit/convert/core';
import { DEFAULT_PRECISION } from '@platform-toolkit/convert';
import type { ChartStatus, ConverterEntry } from '@platform-toolkit/convert/types';

export function consumeConvert(): string {
  // Annotated on purpose: an inferred type would still compile if the shipped
  // \`./types\` entry point resolved to nothing, and \`ConverterEntry\` is what a
  // consumer driving the field itself has to name.
  const typed: ConverterEntry = typeInto(EMPTY_ENTRY, '315');
  const flipped = reverse(typed);
  // The one property a host must set that no interaction produces. A build that
  // shipped the element without its declarations would leave that host casting a
  // string literal at the tool's most load-bearing four-way.
  const status: ChartStatus = 'unavailable';
  const detail: SelectWeightDetail = { amount: 100 };
  const define: () => unknown = defineConvert;
  return [
    CONVERTER_TAG,
    CONVERSION_RESULT_TAG,
    SELECT_WEIGHT_EVENT,
    typed.text,
    flipped.direction,
    String(DEFAULT_PRECISION),
    String(CHART_STEPS.length),
    String(weightProblem('-1') !== null),
    status,
    String(detail.amount),
    typeof define,
  ].join(' ');
}
`,
    // Core only, and it asserts rather than prints. The reversal is the assertion
    // worth making in Node: it is the one rule of this tool that a rewrite can break
    // while every screen still looks right, because the drift only shows up after
    // several flicks.
    smoke: `import { EMPTY_ENTRY, reverse, typeInto } from '@platform-toolkit/convert/core';

const typed = typeInto(EMPTY_ENTRY, '315');
if (typed.entry === null) throw new Error('a plain figure did not parse');

let entry = typed;
for (let flick = 0; flick < 50; flick += 1) entry = reverse(entry);
if (entry.text !== typed.text) throw new Error('fifty reversals moved the number');
if (entry.direction !== typed.direction) throw new Error('fifty reversals moved the direction');
`,
  },
  {
    name: '@platform-toolkit/one-rep-max',
    slug: 'one-rep-max',
    consumer: `import {
  CALCULATOR_TAG,
  ESTIMATE_RESULT_TAG,
  defineOneRepMax,
} from '@platform-toolkit/one-rep-max/element';
import {
  EMPTY_ENTRY,
  LIFTS,
  requestFor,
  reserveFrom,
  typeReps,
  typeWeight,
} from '@platform-toolkit/one-rep-max/core';
import { QUICK_REPS } from '@platform-toolkit/one-rep-max';
import type { EstimateEntry, ReserveChoice } from '@platform-toolkit/one-rep-max/types';

export function consumeOneRepMax(): string {
  // Annotated on purpose: an inferred type would still compile if the shipped
  // \`./types\` entry point resolved to nothing, and \`EstimateEntry\` is what a
  // consumer describing a set for itself has to name.
  const typed: EstimateEntry = typeReps(typeWeight(EMPTY_ENTRY, '140'), '5');
  // The reserve answer is a string here and a number in the domain, and this is
  // the crossing. A build that shipped the element without its declarations would
  // leave a host writing the domain's spelling into the tool's field, which
  // produces an answer -- the wrong one, silently.
  const reserve: ReserveChoice = 'four-or-more';
  const define: () => unknown = defineOneRepMax;
  return [
    CALCULATOR_TAG,
    ESTIMATE_RESULT_TAG,
    typed.weightText,
    String(requestFor(typed) !== null),
    String(reserveFrom(reserve)),
    String(LIFTS.length),
    String(QUICK_REPS.length),
    typeof define,
  ].join(' ');
}
`,
    // Core only, and it asserts rather than prints. The unit flick is the assertion
    // worth making in Node: converting rather than reinterpreting is a stated
    // acceptance test, and a rewrite can break it while every screen still looks
    // right, because the drift only shows up after several flicks.
    smoke: `import {
  EMPTY_ENTRY,
  requestFor,
  setUnit,
  typeReps,
  typeWeight,
} from '@platform-toolkit/one-rep-max/core';

const typed = typeReps(typeWeight(EMPTY_ENTRY, '140'), '5');
if (typed.weight === null) throw new Error('a plain figure did not parse');
if (requestFor(typed) === null) throw new Error('a described set produced no request');

let entry = typed;
for (let flick = 0; flick < 50; flick += 1) {
  entry = setUnit(entry, entry.unit === 'kg' ? 'lb' : 'kg');
}
if (entry.unit !== typed.unit) throw new Error('fifty flicks landed on the wrong unit');
if (entry.weightText !== typed.weightText) throw new Error('fifty flicks moved the number');
`,
  },
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
  DEFAULT_EQUIPMENT,
  createWorkout,
  emptyPerformance,
  workoutProgress,
} from '@platform-toolkit/training-logbook/core';
import {
  HANDOFF_STORAGE_KEY,
  createHandoffSource,
  offerHandoff,
  type HandoffSource,
  type HandoffStorage,
} from '@platform-toolkit/training-logbook/handoff';
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
  // The handoff seam, and the only entry point here that a *different* tool
  // imports -- the warm-up calculator writes the record and has no use for the
  // rest of the package. \`HandoffStorage\` is the port it supplies, so a build
  // that shipped this subpath without its declarations would leave that tool
  // implementing a shape it cannot see. Annotated for the same reason as the two
  // above: an inferred type would compile against nothing.
  const carrier: HandoffStorage = {
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  };
  const handoff: HandoffSource = createHandoffSource(carrier, { now: () => 0 });
  const offered = offerHandoff(
    carrier,
    { equipment: DEFAULT_EQUIPMENT, exercises: [] },
    '2026-01-01T09:00:00.000Z',
  );
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
    HANDOFF_STORAGE_KEY,
    offered,
    String(handoff.peek() === null),
  ].join(' ');
}
`,
    // Core, storage and the handoff, because none of the three may need a browser.
    // The in-memory adapter is what a host with no IndexedDB is handed; the handoff
    // is written by another tool entirely and read through a port that host
    // supplies. That is the assertion worth making here: if either subpath ever
    // drags the DOM in behind it, this is the only test in the repository that
    // would notice.
    smoke: `import { DEFAULT_EQUIPMENT, createWorkout, workoutProgress } from '@platform-toolkit/training-logbook/core';
import { createHandoffSource, offerHandoff } from '@platform-toolkit/training-logbook/handoff';
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

const written = new Map();
const carrier = {
  read: (key) => written.get(key) ?? null,
  write: (key, value) => {
    written.set(key, value);
  },
  remove: (key) => {
    written.delete(key);
  },
};
const content = {
  equipment: DEFAULT_EQUIPMENT,
  exercises: [
    { exerciseId: 'squat', bar: null, workingWeight: 135, workingSets: 3, workingReps: 5, adjustments: [] },
  ],
};
if (offerHandoff(carrier, content, '2026-01-01T09:00:00.000Z') !== 'offered') {
  throw new Error('the handoff would not write to a store that accepts everything');
}
const waiting = createHandoffSource(carrier, {
  now: () => Date.parse('2026-01-01T09:05:00.000Z'),
}).peek();
if (waiting === null) throw new Error('the handoff could not read back its own record');
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
 * Just enough semver to answer "would this range take that version".
 *
 * Hand-rolled rather than depending on `semver`, which is in the store as somebody
 * else's transitive dependency and is not declared by anything here -- reaching for
 * it would be the same undeclared-dependency mistake this file exists to catch, in
 * the file that catches it. The vocabulary supported is the vocabulary a peer range
 * in this repository may use, and anything outside it is reported rather than
 * guessed at, because a range this cannot parse must not read as a range it admits.
 *
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {[number, number, number]} left
 * @param {[number, number, number]} right
 * @returns {number}
 */
function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * @param {string} range one comparator, already split off any `||`
 * @param {[number, number, number]} version
 * @returns {boolean | null} null when the comparator is not one this understands
 */
function admitsComparator(range, version) {
  const comparator = range.trim();
  if (comparator === '' || comparator === '*') return true;
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+\.\d+\.\d+[^\s]*)$/.exec(comparator);
  if (match === null) return null;
  const bound = parseVersion(match[2]);
  if (bound === null) return null;
  const order = compareVersions(version, bound);
  switch (match[1] ?? '=') {
    case '=':
      return order === 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '~':
      return order >= 0 && compareVersions(version, [bound[0], bound[1] + 1, 0]) < 0;
    case '^':
      // Only the >= 1.0.0 form, because that is the only form a dependency of this
      // collection has. A 0.x caret is narrower and would be answered wrongly here.
      return bound[0] > 0 && order >= 0 && compareVersions(version, [bound[0] + 1, 0, 0]) < 0;
    default:
      return null;
  }
}

/**
 * @param {string} range
 * @param {string} version
 * @returns {boolean | null} null when the range is not one this understands
 */
function admits(range, version) {
  const parsed = parseVersion(version);
  if (parsed === null) return null;
  let understood = false;
  for (const alternative of range.split('||')) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    const answers = comparators.map((comparator) => admitsComparator(comparator, parsed));
    if (answers.includes(null)) continue;
    understood = true;
    if (answers.every(Boolean)) return true;
  }
  return understood ? false : null;
}

/**
 * The version a consumer who installed this range later would plausibly be holding.
 * A caret range takes it and an exact pin does not, which is the whole discrimination.
 *
 * @param {string} version
 * @returns {string | null}
 */
function nextMinor(version) {
  const parsed = parseVersion(version);
  return parsed === null ? null : `${String(parsed[0])}.${String(parsed[1] + 1)}.0`;
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
 * Walks the declared dependency graph from every workspace package, packing each one
 * and noting each registry package it needs.
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

  // Every package, not only the two with a hand-written consumer. See the header:
  // the manifest faults this catches are invisible from a consumer's source, so a
  // package left out of the walk is a package left out of the check entirely.
  const queue = [...workspace.keys()];
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
 * Every bare specifier a piece of shipped code imports.
 *
 * The first two are **anchored to the start of a line**, and that is not tidiness.
 * An unanchored `\bfrom\s*['"]` reads the prose in this collection's own doc
 * comments -- "…apart from 'this is some other tool'…" -- and reports a dozen
 * sentences as undeclared packages. A block comment's continuation lines begin with
 * `*`, so the anchor is what tells a statement from a sentence about one. Statement
 * position is also where `tsc` puts every static import it emits, in both the `.js`
 * and the `.d.ts`.
 *
 * The body may run over several lines but may not contain a quote, which stops one
 * `export` from reaching across a string literal to a later statement's `from`.
 *
 * The dynamic and `require` forms stay unanchored because neither is at statement
 * position, and both are specific enough not to need it.
 */
const SPECIFIER_PATTERNS = [
  /^\s*(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * The package a specifier names, or null when it names no package.
 *
 * @param {string} specifier
 * @returns {string | null}
 */
function packageNameOf(specifier) {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * Every shipped module in a tarball. Source maps are skipped -- they quote the
 * source, so scanning one reports the imports of a file that is not in the tarball.
 *
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function shippedModules(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await shippedModules(path)));
      continue;
    }
    if (entry.name.endsWith('.map')) continue;
    if (['.js', '.mjs', '.cjs', '.ts'].includes(extname(entry.name))) found.push(path);
  }
  return found;
}

/**
 * Every package the shipped code imports must be a package the shipped manifest asks
 * for.
 *
 * This is the check that catches a missing peer directly, by name, rather than as
 * whatever a downstream `tsc` happens to say about the first file that could not
 * resolve. The workspace cannot see the fault at all: pnpm's store is one hoisted
 * tree and the import succeeds here however the manifest is written.
 *
 * @param {Map<string, string>} packed
 * @param {string[]} failures
 */
async function checkDeclaredImports(packed, failures) {
  for (const [name, unpacked] of packed) {
    const manifest = await readManifest(join(unpacked, 'package.json'));
    const declared = new Set([
      ...Object.keys(manifest['dependencies'] ?? {}),
      ...Object.keys(manifest['peerDependencies'] ?? {}),
      ...Object.keys(manifest['optionalDependencies'] ?? {}),
    ]);
    /** @type {Set<string>} */
    const undeclared = new Set();
    for (const file of await shippedModules(unpacked)) {
      const text = await readFile(file, 'utf8');
      for (const pattern of SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const dependency = packageNameOf(match[1]);
          if (dependency === null) continue;
          if (dependency === name || declared.has(dependency) || BUILTINS.has(dependency)) continue;
          undeclared.add(dependency);
        }
      }
    }
    for (const dependency of [...undeclared].sort()) {
      failures.push(
        `${name} ships code importing ${dependency}, which its manifest declares nowhere`,
      );
    }
  }
}

/**
 * The shared-singleton rules from the header, measured against what is installed.
 *
 * @param {Map<string, string>} workspace
 * @param {Map<string, string>} packed
 * @param {Map<string, string>} external
 * @param {string[]} failures
 */
async function checkSharedSingletons(workspace, packed, external, failures) {
  for (const [name, unpacked] of packed) {
    const shipped = await readManifest(join(unpacked, 'package.json'));
    const runtime = /** @type {Record<string, string>} */ (shipped['dependencies'] ?? {});
    const peers = /** @type {Record<string, string>} */ (shipped['peerDependencies'] ?? {});
    const directory = workspace.get(name);
    if (directory === undefined) continue;
    const local = await readManifest(join(directory, 'package.json'));
    const development = /** @type {Record<string, string>} */ (local['devDependencies'] ?? {});

    for (const singleton of SHARED_SINGLETONS) {
      if (singleton in runtime) {
        failures.push(
          `${name} declares ${singleton} as a dependency, so a consumer with its own copy gets a second one; it belongs in peerDependencies`,
        );
      }
      const range = peers[singleton];
      if (range === undefined) continue;

      if (!(singleton in development)) {
        failures.push(
          `${name} peers ${singleton} without a devDependency on it, so the workspace has no version to build and test against`,
        );
      }

      const resolved = external.get(singleton);
      if (resolved === undefined) continue;
      const installed = String((await readManifest(join(resolved, 'package.json')))['version']);
      const later = nextMinor(installed);

      const takesInstalled = admits(range, installed);
      if (takesInstalled === null) {
        failures.push(`${name} peers ${singleton} on "${range}", which this check cannot read`);
        continue;
      }
      if (!takesInstalled) {
        failures.push(
          `${name} peers ${singleton} on "${range}", which the installed ${singleton}@${installed} does not satisfy`,
        );
        continue;
      }
      if (later !== null && admits(range, later) !== true) {
        failures.push(
          `${name} peers ${singleton} on "${range}", which a consumer's own ${singleton}@${later} does not satisfy -- the install nests a second copy rather than failing, and two copies of ${singleton} is two registries and no upgraded elements`,
        );
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
  await checkDeclaredImports(packed, failures);
  await checkSharedSingletons(workspace, packed, external, failures);

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
