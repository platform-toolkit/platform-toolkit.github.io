import { defineConfig } from 'vitest/config';

/**
 * One project per workspace package.
 *
 * Vitest 4 replaced `workspace` with `test.projects`. Splitting by package is
 * not cosmetic: `domain` and `configuration` are pure and must keep running in
 * a bare Node environment, so that a DOM dependency accidentally introduced
 * into them fails the test run instead of quietly working.
 *
 * The browser-mode project for Lit components is added in the component phase,
 * alongside the first component test -- installing Playwright browsers is a
 * large download and there is nothing yet for it to run.
 */
export default defineConfig({
  test: {
    projects: [
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
          name: 'ingestion',
          root: './packages/ingestion',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
