// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

/**
 * Workspace imports resolve to source, not to built output.
 *
 * Without this a test run silently uses whatever was last compiled into `dist`,
 * so editing a package and running `pnpm test` tests the previous version. It
 * fails in the confusing direction too: the symptom is an export that is
 * "missing" from a file where it plainly exists. `verify` happens to build
 * before testing, which hides the problem exactly until someone runs the tests
 * on their own.
 *
 * `tsconfig.tests.json` already maps these paths for the type checker. This is
 * the same mapping for the runtime, and the two must stay in step.
 *
 * Anchored regular expressions rather than plain strings, because a string
 * alias matches by *prefix*: `@platform-toolkit/ui/tokens.css` would be
 * rewritten to `packages/ui/src/index.ts/tokens.css`, a path under a file. The
 * failure is a test suite that will not import at all, and it appears the first
 * time anybody reaches for a subpath export. Anchored, a subpath falls through
 * to ordinary resolution and is answered by the package's own `exports` map --
 * which is the thing that should decide what a subpath means.
 */
const workspaceSource = [
  'configuration',
  'convert',
  'data-access',
  'data-contracts',
  'domain',
  'ingestion',
  'one-rep-max',
  'platform-targets',
  'preferences',
  'qualification-check',
  'training-logbook',
  'ui',
].map((name) => ({
  find: new RegExp(`^@platform-toolkit/${name}$`),
  replacement: fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
}));

/**
 * Every module `packages/ui` publishes as a subpath, mirroring its `exports` map
 * and the `paths` blocks in `tsconfig.tests.json` and `tsconfig.stories.json`.
 *
 * One per element, because `customElements.define` is not tree-shakeable: a page
 * that names the barrel downloads all fourteen whether or not it renders one, and
 * the hub rendered none of them. `deep-text`, `field-reading` and `theme` are not
 * elements and are here so that a consumer of any of them does not pull the
 * registry in sideways.
 */
const uiSubpaths = [
  'deep-text',
  'embed-height',
  'field-reading',
  'ptk-button',
  'ptk-choice-group',
  'ptk-copy-button',
  'ptk-date-field',
  'ptk-disclosure',
  'ptk-equipment-setup',
  'ptk-notice',
  'ptk-number-field',
  'ptk-plate-stack',
  'ptk-segmented',
  'ptk-select',
  'ptk-text-area',
  'ptk-text-field',
  'ptk-toggle-group',
  'theme',
];

// The subpaths a test reaches through. Left to the `exports` map each one
// resolves to `dist`, which is the stale-output trap the block above exists to
// close, so they are aliased to source like the rest.
//
// `training-logbook/handoff` is the one module of tool 2 that imports the logbook
// at all, and it is the seam where a shape written on one side is read on the
// other: tested against `dist` it would go on passing for as long as nobody
// rebuilt, which is the one place a stale answer is indistinguishable from
// agreement.
workspaceSource.push(
  ...uiSubpaths.map((name) => ({
    find: new RegExp(`^@platform-toolkit/ui/${name}$`),
    replacement: fileURLToPath(new URL(`./packages/ui/src/${name}.ts`, import.meta.url)),
  })),
  {
    find: /^@platform-toolkit\/training-logbook\/handoff$/,
    replacement: fileURLToPath(
      new URL('./packages/training-logbook/src/handoff.ts', import.meta.url),
    ),
  },
  // Tool 1's three subpaths, for the same reason. The shell's browser test drives
  // `view.ts`, which reaches the package through all three, so left to the
  // `exports` map the whole suite would be testing whatever was last built.
  ...['core', 'element'].map((name) => ({
    find: new RegExp(`^@platform-toolkit/platform-targets/${name}$`),
    replacement: fileURLToPath(
      new URL(`./packages/platform-targets/src/${name}/index.ts`, import.meta.url),
    ),
  })),
  {
    find: /^@platform-toolkit\/platform-targets\/types$/,
    replacement: fileURLToPath(
      new URL('./packages/platform-targets/src/types.ts', import.meta.url),
    ),
  },
  // Not a subpath the package exports. A fixture in `dist` is a fixture that
  // ships, so it is excluded from the build and reachable only from here and from
  // `tsconfig.tests.json` -- which means an import of it from anything that builds
  // fails to resolve instead of quietly packing invented records into a release.
  {
    find: /^@platform-toolkit\/platform-targets\/records\.fixture$/,
    replacement: fileURLToPath(
      new URL('./packages/platform-targets/src/core/records.fixture.ts', import.meta.url),
    ),
  },
);

/**
 * How long one browser-mode test has before it counts as wedged.
 *
 * Vitest's browser default is fifteen seconds, which is generous against an idle
 * machine and not against this one: `reads a restore that landed politely and one
 * that did not assertively` builds a backup file, opens two real databases and
 * restores into both, and on 2026-08-07 that took longer than fifteen at load 140
 * -- in a fresh-clone gate, so the whole verify went red over a test that does what
 * it says.
 *
 * Sixty is not a claim that a test may reasonably take a minute. It is the point at
 * which "busy" stops being a plausible explanation and "wedged" starts, which is the
 * only thing a test timeout is any good at telling apart. A passing test never
 * approaches it and pays nothing; a hung one is still caught, just later.
 *
 * Browser projects only. The Node projects are pure functions over in-memory data and
 * have never wanted more than the default, so leaving them at it keeps a real hang
 * there loud.
 */
const BROWSER_TEST_TIMEOUT_MS = 60_000;

/**
 * One project per workspace package.
 *
 * Vitest 4 replaced `workspace` with `test.projects`. Splitting by package is
 * not cosmetic: `domain` and `configuration` are pure and must keep running in
 * a bare Node environment, so that a DOM dependency accidentally introduced
 * into them fails the test run instead of quietly working.
 *
 * `ui` is the exception and runs in a real browser. Custom elements, Shadow DOM,
 * and Lit's update scheduling are the things being tested, and a DOM emulation
 * that approximates them would turn a passing test into weak evidence -- the
 * decorator misconfiguration this is guarding against is precisely the kind of
 * bug that survives a simulated environment.
 */
const projects: TestProjectInlineConfiguration[] = [
  {
    test: {
      name: 'domain',
      root: './packages/domain',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'configuration',
      root: './packages/configuration',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'data-contracts',
      root: './packages/data-contracts',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      // Node, not a browser environment, even though this package ships to
      // the browser. Its transport is injected, so nothing here needs a real
      // one -- and a test that passes in bare Node is a test that could not
      // have quietly depended on the DOM.
      name: 'data-access',
      root: './packages/data-access',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'ingestion',
      root: './packages/ingestion',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      // Node. This package is a tool, not a library of pure arithmetic, and it
      // still belongs here: section 15 requires a tool's core to hold no Lit, no
      // DOM, no storage and no clock, and running it in bare Node is what proves
      // that rather than asserting it in a comment.
      name: 'qualification-check',
      root: './packages/qualification-check',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The tool's elements, in a real browser, for the same reason `ui` is. This
    // package is the first one that is a whole tool rather than a component set,
    // and the thing worth proving is that the six elements compose: an event
    // dispatched from a control four levels down has to arrive at the root and
    // move a figure. A DOM emulation would answer that question with its own
    // retargeting rules rather than the platform's, which is exactly the
    // difference the composed-path bugs in these files turn on (section 5.8).
    test: {
      name: 'qualification-check-browser',
      root: './packages/qualification-check',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      // Node, for the same section 15 reason as `qualification-check` above. This
      // tool's core is the sharpest case for it: `session.ts` defines what may be
      // remembered and reads it through a `PreferenceStore` the caller supplies, so
      // a suite that passes in bare Node is the proof that it never reached for
      // `localStorage` itself.
      name: 'convert',
      root: './packages/convert',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The four elements, in a real browser, for the same reason `ui` is. Two things
    // here are platform behaviours rather than library ones and a DOM emulation
    // would answer both with its own rules: a `ptk-select-weight` event travels up
    // out of a copy button's shadow root and has to reach the root's handler, and
    // the assertions that matter read text through several shadow boundaries at
    // once -- the full chart's summary is rendered inside `ptk-disclosure`'s root,
    // so a host-only read comes back empty and a `not.toContain` passes by
    // measuring nothing.
    test: {
      name: 'convert-browser',
      root: './packages/convert',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      // Node, for the same section 15 reason as `convert` above. The seven core
      // modules here are the largest of any tool -- what a catalogue offers, what
      // a lifter has answered, and the kilograms between them and each published
      // target -- and every one of them is a function of its arguments. Nothing
      // in the set fetches, reads a clock or touches storage, so a bare Node run
      // is both the cheapest way to cover it and the thing that proves it.
      name: 'platform-targets',
      root: './packages/platform-targets',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The seven elements, in a real browser, for the same reason `convert` is. Six
    // of them sit inside the seventh's shadow root and report through composed
    // events that have to cross it -- an applied context is what tells the host
    // which artifacts to fetch, and an emulated DOM that got `composed` wrong
    // would leave a green suite and a tool that never loads a record. The report
    // is the other half: its figures are read back through two shadow boundaries
    // at once, so a host-only read comes back empty and an assertion that a
    // number is absent passes by measuring nothing.
    test: {
      name: 'platform-targets-browser',
      root: './packages/platform-targets',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      // Node, for the same section 15 reason as `convert` above. The core here is
      // the two mappings a control's answer crosses -- a radio reports `'2'` and
      // the domain wants `2` -- plus what survives a lock screen and what must
      // not, and none of that needs a browser to state or a browser to test.
      name: 'one-rep-max',
      root: './packages/one-rep-max',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The five elements, in a real browser, for the same reason `convert` is. A
    // `ptk-choice-change` event leaves a control's shadow root and has to reach the
    // root's delegated listener by the `data-field` it carries, and the assertions
    // that matter read text through several shadow boundaries at once -- the
    // equation cards and the percentage table are both rendered inside
    // `ptk-disclosure`'s root, so a host-only read comes back empty and an
    // assertion that a phrase is absent then passes by measuring nothing.
    test: {
      name: 'one-rep-max-browser',
      root: './packages/one-rep-max',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      // Node, for the same section 15 reason as `qualification-check` above: the
      // core of a tool holds no Lit, no DOM, no storage and no clock, and a bare
      // Node run is what proves it. The in-memory repository is covered here too
      // -- it is an ordinary object, not a browser feature.
      name: 'training-logbook',
      root: './packages/training-logbook',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The elements and the IndexedDB adapter, in a real browser. The adapter is
    // the reason this project is not optional: a fake IndexedDB would answer
    // questions with its own transaction semantics, and the two failures worth
    // catching -- a transaction that commits before an awaited callback resolves,
    // and a private-browsing context that refuses to open a database at all --
    // are precisely the ones a fake gets wrong.
    test: {
      name: 'training-logbook-browser',
      root: './packages/training-logbook',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      // Node, despite this package existing to talk to `localStorage`. The
      // storage port is injected, so a fake covers every case the real one has
      // -- including the two that matter most and cannot be reproduced in a
      // test browser at all: storage that throws on access, and storage that
      // accepts a read and refuses a write.
      name: 'preferences',
      root: './packages/preferences',
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      // Not a package: this guards `apps/web/public/theme-boot.js`, which is
      // served verbatim and so cannot be covered by anything that imports it,
      // plus the tool's pure selection rules.
      name: 'web',
      root: './apps/web',
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // The browser suite below matches the same glob, so it has to be excluded
      // by name. Vitest replaces the default exclude list rather than adding to
      // it, so the standard entries are repeated here.
      exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    },
  },
  {
    // The tool's own composed interface, in a real browser for the same reason
    // `ui` is: custom elements, Shadow DOM, and Lit's update scheduling are what
    // is being tested, and an emulation of them makes a passing test weak
    // evidence.
    // Both build-time defines, because a composition root that stamps the
    // application version into a backup file is one of the things this suite
    // exists to cover, and an undefined identifier throws before it can.
    define: {
      __PTK_DATA_BASE_URL__: JSON.stringify('/data/'),
      __PTK_APPLICATION_VERSION__: JSON.stringify('0.0.0-test'),
    },
    test: {
      name: 'web-browser',
      root: './apps/web',
      include: ['src/**/*.browser.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
  {
    test: {
      name: 'ui',
      root: './packages/ui',
      include: ['src/**/*.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT_MS,
      browser: {
        enabled: true,
        provider: playwright(),
        // One engine, headless. The components use no engine-specific
        // behaviour, so a matrix would multiply CI time to re-test the same
        // code paths; cross-browser differences are a question for the
        // end-to-end suite against the built site, not for unit tests.
        instances: [{ browser: 'chromium' }],
        headless: true,
        screenshotFailures: false,
      },
    },
  },
];

export default defineConfig({
  // Applied to every project rather than at the root: Vitest 4 projects do not
  // inherit the root `resolve` config, so a root-level alias would look correct
  // and do nothing.
  test: {
    projects: projects.map((project) => ({ ...project, resolve: { alias: workspaceSource } })),
  },
});
