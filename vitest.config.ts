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
 */
const workspaceSource = Object.fromEntries(
  ['configuration', 'data-access', 'data-contracts', 'domain', 'ingestion', 'ui'].map((name) => [
    `@platform-toolkit/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
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
      // Not a package: this guards `apps/web/public/theme-boot.js`, which is
      // served verbatim and so cannot be covered by anything that imports it.
      name: 'web',
      root: './apps/web',
      environment: 'node',
      include: ['src/**/*.test.ts'],
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
