/**
 * Guards `public/theme-boot.js`, which nothing imports and nothing bundles.
 *
 * It runs as an unbundled classic script in `<head>` so that a forced theme is
 * applied before first paint, which means it cannot import the shared theme
 * resolver and has to duplicate the list of accepted modes. Duplication that
 * nobody checks drifts: a fourth mode added to the configuration package would
 * work everywhere except the one place that decides what the page looks like
 * before any JavaScript module has run, and the symptom would be a flash of the
 * wrong theme on exactly the machines that configured the new mode.
 *
 * Parsing the file as text is the point. Importing it would execute it, and a
 * mock DOM would prove only that a mock DOM works.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { THEME_MODES } from '@platform-toolkit/configuration';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../public/theme-boot.js', import.meta.url)),
  'utf8',
);

describe('theme-boot.js', () => {
  it('accepts exactly the modes the configuration package defines', () => {
    const declaration = /const MODES = \[([^\]]*)\]/.exec(source);
    expect(declaration, 'MODES declaration not found -- has the file been restructured?').not.toBe(
      null,
    );

    const modes = (declaration?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter((entry) => entry !== '');

    // Order matters as well as membership: this list is the same canonical
    // ordering the control renders, and a mismatch would be a quiet
    // inconsistency rather than a failure.
    expect(modes).toEqual([...THEME_MODES]);
  });

  it('stays a classic script, because a module would defer past first paint', () => {
    expect(source).not.toMatch(/^\s*(?:import|export)\s/m);
  });

  it('sets no theme attribute for system mode, leaving it to CSS', () => {
    // `system` is handled entirely by `prefers-color-scheme`, so the common case
    // needs no JavaScript and cannot flash even if this script fails to load.
    // The guard below is what keeps that true.
    expect(source).toContain("if (mode === 'light' || mode === 'dark')");
  });

  it('survives storage being unavailable in an embedded context', () => {
    // Third-party storage access is blocked in many embedding contexts. That is
    // expected rather than exceptional, and it must not leave the page unstyled.
    expect(source).toMatch(/catch\s*\{[^}]*stored = null;/s);
  });
});
