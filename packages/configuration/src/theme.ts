/**
 * Theme configuration and precedence resolution.
 *
 * The central distinction in this module is between the theme *mode* a user or
 * host has configured and the theme that is actually *in effect*. `system` is a
 * legitimate configured mode, but it is never an effective theme -- it resolves
 * to light or dark depending on the operating system preference at that moment.
 * Collapsing the two is the usual source of theme bugs: a UI that stores the
 * effective value cannot tell "the user chose light" from "the user chose system
 * and the system happens to be light", so it stops following the system when the
 * system changes.
 *
 * This module is pure. It performs no DOM access and reads no globals, so the
 * precedence rules can be tested exhaustively without a browser.
 */

/** A theme setting that a user or host can configure. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** A theme that can actually be rendered. `system` is deliberately absent. */
export type EffectiveTheme = 'light' | 'dark';

/**
 * Every accepted mode, and the canonical order they are offered in.
 *
 * Exported because it is duplicated once, unavoidably: `theme-boot.js` runs as
 * an unbundled classic script before first paint and cannot import anything. A
 * test compares that copy against this list, so the duplication is checked
 * rather than merely regretted.
 */
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/**
 * Narrows arbitrary input to a ThemeMode.
 *
 * Theme values arrive from untrusted places -- iframe query parameters, host
 * postMessage payloads, persisted storage that a user can edit. Everything is
 * validated through here so no caller can inject an arbitrary string that ends
 * up in a class name, selector, or attribute value.
 */
export function asThemeMode(value: unknown): ThemeMode | undefined {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
    ? (value as ThemeMode)
    : undefined;
}

/** The inputs that can influence which theme is shown, in no particular order. */
export interface ThemeInputs {
  /**
   * A theme forced by the embedding host. When present this wins outright and
   * the in-app theme control is disabled with an explanation, so an embedded
   * instance cannot visually clash with the page around it.
   */
  readonly hostLock?: ThemeMode | undefined;

  /** A theme the user explicitly chose, restored from storage or set this session. */
  readonly userPreference?: ThemeMode | undefined;

  /**
   * A starting theme suggested by the host via query parameter. Unlike a lock
   * this is only a default -- the user may override it and their choice sticks.
   */
  readonly hostDefault?: ThemeMode | undefined;
}

/** Why a particular mode won, so the interface can explain itself. */
export type ThemeModeSource = 'host-lock' | 'user-preference' | 'host-default' | 'fallback';

export interface ResolvedThemeMode {
  readonly mode: ThemeMode;
  readonly source: ThemeModeSource;
  /** True when the user cannot change the theme, i.e. the host has locked it. */
  readonly locked: boolean;
}

/**
 * Resolves the configured theme mode from all inputs.
 *
 * Precedence, highest first:
 *   1. Host lock       -- an embedding page's explicit requirement
 *   2. User preference -- an explicit human choice outranks any suggestion
 *   3. Host default    -- a suggestion, used only until the user decides
 *   4. `system`        -- follow the operating system
 */
export function resolveThemeMode(inputs: ThemeInputs): ResolvedThemeMode {
  if (inputs.hostLock !== undefined) {
    return { mode: inputs.hostLock, source: 'host-lock', locked: true };
  }
  if (inputs.userPreference !== undefined) {
    return { mode: inputs.userPreference, source: 'user-preference', locked: false };
  }
  if (inputs.hostDefault !== undefined) {
    return { mode: inputs.hostDefault, source: 'host-default', locked: false };
  }
  return { mode: 'system', source: 'fallback', locked: false };
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
