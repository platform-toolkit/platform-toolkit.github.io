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
  'data-access',
  'data-contracts',
  'domain',
  'ingestion',
  'preferences',
  'qualification-check',
  'training-logbook',
  'ui',
].map((name) => ({
  find: new RegExp(`^@platform-toolkit/${name}$`),
  replacement: fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
}));

// The two subpaths a test reaches through. Left to the `exports` map either one
// resolves to `dist`, which is the stale-output trap the block above exists to
// close, so both are aliased to source like the rest.
//
// `ui/field-reading` exists so that `session.ts` -- pure, and run in a bare Node
// project on purpose -- can have the field parsers without pulling the element
// barrel, which calls `customElements.define` on import. `training-logbook/
// handoff` is the one module of tool 2 that imports the logbook at all, and it
// is the seam where a shape written on one side is read on the other: tested
// against `dist` it would go on passing for as long as nobody rebuilt, which is
// the one place a stale answer is indistinguishable from agreement.
workspaceSource.push(
  {
    find: /^@platform-toolkit\/ui\/field-reading$/,
    replacement: fileURLToPath(new URL('./packages/ui/src/field-reading.ts', import.meta.url)),
  },
  {
    find: /^@platform-toolkit\/training-logbook\/handoff$/,
    replacement: fileURLToPath(
      new URL('./packages/training-logbook/src/handoff.ts', import.meta.url),
    ),
  },
);

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
    define: { __PTK_DATA_BASE_URL__: JSON.stringify('/data/') },
    test: {
      name: 'web-browser',
      root: './apps/web',
      include: ['src/**/*.browser.test.ts'],
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
