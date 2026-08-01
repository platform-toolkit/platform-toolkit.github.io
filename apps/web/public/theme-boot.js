/*
 * Applies the configured theme before first paint.
 *
 * This runs as an external *classic* script in <head>, deliberately:
 *
 *  - It cannot be inline, because the Content Security Policy is `script-src
 *    'self'` with no `unsafe-inline`. An external file satisfies that with no
 *    weakening of the policy.
 *
 *  - It cannot be a module, because module scripts are deferred until after the
 *    document is parsed, which is exactly the flash of wrong theme this exists
 *    to prevent.
 *
 * Because it cannot be bundled, it cannot import the shared theme resolver. The
 * accepted values are therefore duplicated here, and a test asserts this file
 * stays in step with the canonical list in @platform-toolkit/configuration.
 *
 * Note what this does NOT do: `system` mode sets no attribute at all. It is
 * handled purely by `@media (prefers-color-scheme: dark)` in CSS, so the common
 * case needs no JavaScript and cannot flash even if this script fails to load.
 */
(function () {
  'use strict';

  const MODES = ['system', 'light', 'dark'];

  function asMode(value) {
    return MODES.indexOf(value) === -1 ? null : value;
  }

  /**
   * Resolves the configured mode, and whether the host has locked it.
   *
   * Returning a value rather than assigning to outer variables keeps every
   * precedence branch visible in one place -- this ordering is the whole point
   * of the function, and it is easy to break by accident.
   */
  function resolveConfiguredMode() {
    try {
      const params = new URLSearchParams(window.location.search);

      // A host lock outranks everything, including a stored user preference.
      const lock = asMode(params.get('themeLock'));
      if (lock !== null) {
        return { mode: lock, locked: true };
      }

      // An explicit user choice outranks a host-suggested default.
      let stored = null;
      try {
        stored = asMode(window.localStorage.getItem('ptk.theme-mode'));
      } catch {
        // Storage can be unavailable in an embedded context with third-party
        // cookies blocked. That is expected, not exceptional: fall through to
        // the host default and leave the interface fully functional.
        stored = null;
      }

      return { mode: stored !== null ? stored : asMode(params.get('theme')), locked: false };
    } catch {
      // A malformed URL must not leave the page unstyled. `system` is the safe
      // default and is what the CSS already assumes.
      return { mode: null, locked: false };
    }
  }

  const resolved = resolveConfiguredMode();
  const mode = resolved.mode === null ? 'system' : resolved.mode;
  const root = document.documentElement;

  root.setAttribute('data-theme-mode', mode);
  if (resolved.locked) {
    root.setAttribute('data-theme-locked', '');
  }

  if (mode === 'light' || mode === 'dark') {
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
  }
})();
