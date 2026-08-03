// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  asThemeMode,
  readHostThemeMessage,
  resolveEffectiveTheme,
  themeModeFromSearch,
  type EffectiveTheme,
  type ThemeMode,
} from '@platform-toolkit/configuration';

/**
 * The DOM half of theming: everything that touches a document.
 *
 * The rules themselves live in `@platform-toolkit/configuration` and are pure.
 * What is left here is small on purpose, because most of the work is already
 * done by the time any of it runs: `theme-boot.js` applies the embedder's
 * choice before first paint, and `system` mode is handled entirely by
 * `prefers-color-scheme` in CSS. This module exists for the one case neither
 * covers -- a host page that changes its own theme while the frame is open --
 * and to keep the applied state readable by components that need to know which
 * way they are rendering.
 *
 * There is no visitor-facing control, and adding one back would be a product
 * change rather than a UI addition. See the configuration package for why.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Attribute carrying the configured mode. Read back by {@link currentThemeMode}. */
const MODE_ATTRIBUTE = 'data-theme-mode';

/** Attribute carrying a forced theme. Absent for `system`, which is the point. */
const THEME_ATTRIBUTE = 'data-theme';

/**
 * Applies a mode to a document root.
 *
 * Mirrors `apps/web/public/theme-boot.js`, which does the same thing before
 * first paint and cannot import this. The two must agree; a test holds the
 * boot script to the shared list of modes for exactly that reason.
 */
export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute(MODE_ATTRIBUTE, mode);

  if (mode === 'system') {
    // Leave the attribute off so the CSS media query stays in charge. Pinning
    // it to whatever the system currently says would freeze the theme at the
    // value it had when the page loaded, and the page would stop following the
    // system without anything appearing to be wrong.
    root.removeAttribute(THEME_ATTRIBUTE);
    root.style.removeProperty('color-scheme');
  } else {
    root.setAttribute(THEME_ATTRIBUTE, mode);
    root.style.colorScheme = mode;
  }
}

/**
 * The mode currently applied to a document root.
 *
 * Read from the DOM rather than from a variable so that there is one answer
 * even though two things can write it: the boot script before any module has
 * run, and this module afterwards.
 */
export function currentThemeMode(root: HTMLElement = document.documentElement): ThemeMode {
  return asThemeMode(root.getAttribute(MODE_ATTRIBUTE)) ?? 'system';
}

/** The theme actually rendering right now, with `system` resolved against the OS. */
export function effectiveTheme(root: HTMLElement = document.documentElement): EffectiveTheme {
  const prefersDark =
    typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
  return resolveEffectiveTheme(currentThemeMode(root), prefersDark);
}

export interface ThemeOptions {
  /** Document root to theme. Defaults to `document.documentElement`. */
  readonly root?: HTMLElement;

  /**
   * The window allowed to send theme instructions. Defaults to the embedding
   * page.
   *
   * Named rather than assumed because this check is the security rule: a
   * message from anywhere else -- a sibling frame, a popup, a nested frame the
   * host page opened -- is not from the embedder and is ignored. There is no
   * origin allowlist to pair it with, deliberately, since any site may frame
   * these tools; what makes that safe is that the protocol carries one word
   * from a closed set and affects nothing but appearance.
   */
  readonly host?: Window;

  /** Called after a host instruction changes the theme, never on a rejected one. */
  readonly onChange?: (mode: ThemeMode) => void;
}

/**
 * Accepts a theme override sent by the embedding page.
 *
 * @returns a function that stops listening
 */
export function listenForHostTheme(options: ThemeOptions = {}): () => void {
  const root = options.root ?? document.documentElement;
  const host = options.host ?? window.parent;

  const handler = (event: MessageEvent): void => {
    if (event.source !== host) {
      return;
    }
    const mode = readHostThemeMessage(event.data);
    if (mode === null || mode === currentThemeMode(root)) {
      return;
    }
    applyThemeMode(mode, root);
    options.onChange?.(mode);
  };

  window.addEventListener('message', handler);
  return () => {
    window.removeEventListener('message', handler);
  };
}

/**
 * Sets up theming for a page. Every entry point calls this once.
 *
 * Re-applying the query parameter here duplicates what the boot script already
 * did, and that redundancy is the point: the boot script lives in `public/` and
 * is loaded by URL, so a stale cache entry or a blocked request leaves it out
 * with no build error. Doing it again from the bundle costs one attribute write
 * and means the worst case is a flash rather than the wrong theme entirely.
 *
 * @returns a function that stops listening for host instructions
 */
export function initializeTheme(options: ThemeOptions = {}): () => void {
  const root = options.root ?? document.documentElement;
  applyThemeMode(themeModeFromSearch(window.location.search), root);
  return listenForHostTheme({ ...options, root });
}
