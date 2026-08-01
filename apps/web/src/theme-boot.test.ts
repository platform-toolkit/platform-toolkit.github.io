/**
 * Guards `public/theme-boot.js`, which nothing imports and nothing bundles.
 *
 * It runs as an unbundled classic script in `<head>` so that an embedder's
 * forced theme is applied before first paint, which means it cannot import the
 * shared theme resolver and has to duplicate what that resolver knows.
 * Duplication that nobody checks drifts: a fourth mode added to the
 * configuration package would work everywhere except the one place that decides
 * what the page looks like before any JavaScript module has run, and the symptom
 * would be a flash of the wrong theme on exactly the sites that asked for the
 * new mode.
 *
 * Parsing the file as text is the point. Importing it would execute it, and a
 * mock DOM would prove only that a mock DOM works.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { THEME_MODES, THEME_PARAMETER } from '@platform-toolkit/configuration';
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

    expect(modes).toEqual([...THEME_MODES]);
  });

  it('reads the same query parameter the rest of the application documents', () => {
    // The parameter name is the public embedding contract. If this copy and the
    // shared constant disagree, an embedder's URL works after hydration and not
    // before it, which presents as an intermittent flash.
    expect(source).toContain(`.get('${THEME_PARAMETER}')`);
  });

  it('stays a classic script, because a module would defer past first paint', () => {
    expect(source).not.toMatch(/^\s*(?:import|export)\s/m);
  });

  it('sets no theme attribute for system mode, leaving it to CSS', () => {
    // `system` is handled entirely by `prefers-color-scheme`, so the default
    // case needs no JavaScript and cannot flash even if this script fails to
    // load. The guard below is what keeps that true.
    expect(source).toContain("if (mode === 'light' || mode === 'dark')");
  });

  it('reads nothing but the URL', () => {
    // A visitor has no theme setting to remember here -- their operating system
    // already holds it -- so there is nothing to read from storage and no
    // separate lock parameter to arbitrate against. Both existed before the
    // in-page toggle was removed, and either creeping back would let a stored
    // value outrank the embedder while every page still looked correct by hand.
    expect(source).not.toMatch(/localStorage|sessionStorage|themeLock/);
  });
});
