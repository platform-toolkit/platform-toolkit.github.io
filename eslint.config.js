import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '.cache/**',
      'tmp/**',
      'apps/web/public/data/**',
    ],
  },

  js.configs.recommended,
  comments.recommended,

  // Type-aware linting for all TypeScript. `strictTypeChecked` is what makes the
  // "no silent coercion" requirement enforceable -- rules like
  // no-unnecessary-condition and no-unsafe-assignment need the type graph.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Listed explicitly rather than via `projectService`. Tests are excluded
        // from the package projects so they stay out of `dist`, which leaves
        // them outside the project graph that automatic discovery walks; naming
        // every config is what lets type-aware rules run on them too.
        project: [
          './packages/*/tsconfig.json',
          './apps/web/tsconfig.json',
          './tsconfig.tests.json',
          './tsconfig.tooling.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The project prohibits suppressing type errors rather than fixing them.
      // No description makes these acceptable, so the escape hatch is closed.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': false,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',

      // `verbatimModuleSyntax` is on, so type-only imports must say so or the
      // emitted JS keeps a runtime import of a type that does not exist.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',

      // Unused values are usually a mistake; a leading underscore is the
      // deliberate opt-out for genuinely unused signature parameters.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Interpolating a number into a message is safe and readable; wrapping
      // every one in String() buys nothing. Everything looser than that stays
      // banned, which is the part that actually prevents "[object Object]".
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Browser code. `packages/ui` belongs here rather than with the packages
  // below: it is the one package that touches the DOM, which is precisely why
  // the pure ones stay separate from it.
  {
    files: ['apps/web/**/*.ts', 'packages/ui/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  // The one package that makes network requests. It ships to the browser but
  // must never touch the DOM, so it gets the networking globals and not
  // `globals.browser`: referring to `document` here is an undefined variable,
  // which is the error it should be.
  {
    files: ['packages/data-access/**/*.ts'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // Its tsconfig uses `@types/node` to obtain those same globals without
      // pulling in the DOM lib. That is a typing convenience and must not become
      // permission to import Node APIs into code that runs in a browser.
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['node:*'], message: 'This package runs in the browser.' }],
        },
      ],
    },
  },

  // Unbundled browser scripts served verbatim from public/. Not modules, not
  // TypeScript, and not part of any tsconfig -- they are copied to the output
  // as-is, which is the only reason theme-boot.js can run before first paint.
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
      sourceType: 'script',
    },
  },

  // Node code: ingestion, build config, and scripts.
  {
    files: [
      'packages/ingestion/**/*.ts',
      '**/vite.config.ts',
      'vitest.config.ts',
      'scripts/**/*.mjs',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.nodeBuiltin },
  },

  // Plain JavaScript tooling. Type-aware rules cannot run without a program, and
  // pulling these into one would mean type-checking build scripts as if they
  // were shipped code.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Tests may assert on deliberately wrong values, which is exactly what several
  // type-aware rules exist to prevent elsewhere.
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Rules that apply everywhere, whatever the language.
  {
    linterOptions: {
      // A disable comment that no longer suppresses anything is stale
      // documentation claiming a problem exists where none does.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // An unexplained suppression is indistinguishable from an accidental one.
      '@eslint-community/eslint-comments/require-description': [
        'error',
        { ignore: ['eslint-enable'] },
      ],
      '@eslint-community/eslint-comments/no-unused-disable': 'error',

      // Swallowing an error silently is prohibited. `no-empty` treats a block
      // containing a comment as non-empty, so an intentionally ignored error
      // stays legal exactly when it carries a written justification.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
);
