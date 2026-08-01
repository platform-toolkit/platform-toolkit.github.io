/**
 * Theme configuration.
 *
 * Two rules shape this module.
 *
 * The visitor does not choose a theme here. That choice already exists, at the
 * operating system, and a widget that offers its own toggle asks someone to
 * make the same decision a second time and then be wrong about it on one site
 * out of every ten. Following `prefers-color-scheme` is the entire default
 * behaviour, and it needs no JavaScript at all.
 *
 * The embedding site does get to override it. A widget framed inside a dark
 * page and rendering light is a visible defect, and the embedder is the only
 * party who knows which way it should go. That override arrives as a documented
 * query parameter carrying one of three fixed words -- never CSS, never markup
 * -- so a parent page can match its own design without gaining any way to put
 * content inside the frame.
 *
 * Throughout, the configured *mode* and the theme actually *in effect* stay
 * distinct. `system` is a legitimate mode but is never an effective theme.
 * Collapsing the two is the usual source of theme bugs: code that stores the
 * effective value cannot tell "the embedder asked for light" from "the embedder
 * asked for system and the system is currently light", so it stops following
 * the system the moment the system changes.
 *
 * This module is pure. It performs no DOM access and reads no globals, so the
 * rules can be tested exhaustively without a browser.
 */

/** A theme setting an embedding site can configure. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** A theme that can actually be rendered. `system` is deliberately absent. */
export type EffectiveTheme = 'light' | 'dark';

/**
 * Every accepted mode.
 *
 * Exported because it is duplicated once, unavoidably: `theme-boot.js` runs as
 * an unbundled classic script before first paint and cannot import anything. A
 * test compares that copy against this list, so the duplication is checked
 * rather than merely regretted.
 */
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/**
 * The query parameter an embedding site uses to force a theme.
 *
 * Part of the public embedding contract, so it is named once here and read from
 * here everywhere. Renaming it breaks every site that has already written the
 * URL into its markup.
 */
export const THEME_PARAMETER = 'theme';

/**
 * Narrows arbitrary input to a ThemeMode.
 *
 * Theme values arrive from untrusted places: an iframe query parameter and a
 * host postMessage payload, both of which an arbitrary site controls. Every one
 * of them is validated through here, so nothing can put a chosen string into an
 * attribute value, a selector, or the `color-scheme` property.
 */
export function asThemeMode(value: unknown): ThemeMode | undefined {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
    ? (value as ThemeMode)
    : undefined;
}

/**
 * Reads the mode an embedding site asked for out of a query string.
 *
 * Anything absent, misspelled, or hostile resolves to `system`. That is not
 * leniency for its own sake: `system` is what the CSS already assumes when no
 * attribute is set, so an unrecognised value produces the correct default
 * appearance rather than an unstyled page.
 *
 * @param search a `location.search` value, with or without its leading `?`
 */
export function themeModeFromSearch(search: string): ThemeMode {
  return asThemeMode(new URLSearchParams(search).get(THEME_PARAMETER)) ?? 'system';
}

/**
 * Resolves a configured mode to the theme that should actually render.
 *
 * @param mode              the configured mode
 * @param systemPrefersDark whether the OS currently prefers a dark colour scheme
 */
export function resolveEffectiveTheme(mode: ThemeMode, systemPrefersDark: boolean): EffectiveTheme {
  switch (mode) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'system':
      return systemPrefersDark ? 'dark' : 'light';
  }
}
