import {
  asThemeMode,
  resolveEffectiveTheme,
  resolveThemeMode,
  type EffectiveTheme,
  type ResolvedThemeMode,
  type ThemeMode,
} from '@platform-toolkit/configuration';

const STORAGE_KEY = 'ptk.theme-mode';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Notified whenever the configured mode or the effective theme changes. */
export type ThemeChangeListener = (state: ThemeState) => void;

export interface ThemeState {
  readonly resolved: ResolvedThemeMode;
  readonly effective: EffectiveTheme;
}

/**
 * Owns the theme for a document.
 *
 * Reads the same inputs the pre-paint bootstrap script read, then keeps the
 * document in step as the user or the operating system changes their mind. The
 * bootstrap and this controller must agree on precedence; the precedence itself
 * lives in the shared configuration package so there is one definition of it.
 */
export class ThemeController {
  readonly #root: HTMLElement;
  readonly #media: MediaQueryList | undefined;
  readonly #listeners = new Set<ThemeChangeListener>();
  #resolved: ResolvedThemeMode;

  public constructor(root: HTMLElement = document.documentElement) {
    this.#root = root;
    this.#media =
      typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : undefined;

    const params = new URLSearchParams(window.location.search);
    this.#resolved = resolveThemeMode({
      hostLock: asThemeMode(params.get('themeLock')),
      userPreference: readStoredMode(),
      hostDefault: asThemeMode(params.get('theme')),
    });

    // Following the system means reacting to it, not just reading it once.
    this.#media?.addEventListener('change', () => {
      if (this.#resolved.mode === 'system') {
        this.#apply();
      }
    });

    this.#apply();
  }

  public get state(): ThemeState {
    return { resolved: this.#resolved, effective: this.effective };
  }

  public get effective(): EffectiveTheme {
    return resolveEffectiveTheme(this.#resolved.mode, this.#media?.matches ?? false);
  }

  /**
   * Records an explicit user choice.
   *
   * Ignored while the host has locked the theme -- including when the request
   * arrives by postMessage, so a parent page cannot escape its own lock.
   */
  public setMode(mode: ThemeMode): void {
    if (this.#resolved.locked || mode === this.#resolved.mode) {
      return;
    }
    this.#resolved = { mode, source: 'user-preference', locked: false };
    writeStoredMode(mode);
    this.#apply();
  }

  public subscribe(listener: ThemeChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #apply(): void {
    const { mode } = this.#resolved;
    const effective = this.effective;

    this.#root.setAttribute('data-theme-mode', mode);
    this.#root.toggleAttribute('data-theme-locked', this.#resolved.locked);

    if (mode === 'system') {
      // Leave the attribute off so the CSS media query stays in charge. Pinning
      // it to the current system value here would freeze the theme at whatever
      // the system happened to be at load.
      this.#root.removeAttribute('data-theme');
      this.#root.style.removeProperty('color-scheme');
    } else {
      this.#root.setAttribute('data-theme', mode);
      this.#root.style.colorScheme = mode;
    }

    const state: ThemeState = { resolved: this.#resolved, effective };
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

function readStoredMode(): ThemeMode | undefined {
  try {
    return asThemeMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage is unavailable in some embedded contexts. That is an expected
    // condition, not a failure: the interface still works, it just cannot
    // remember the choice between visits.
    return undefined;
  }
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // As above -- an unremembered preference is a degraded experience, not an error.
  }
}
