// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/*
 * Applies an embedder's theme choice before first paint.
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
 * Note what this does NOT do. `system` sets no attribute at all: it is handled
 * purely by `@media (prefers-color-scheme: dark)` in CSS, so the default case
 * needs no JavaScript and cannot flash even if this script fails to load. And
 * nothing is read from storage, because a visitor has no theme setting to
 * remember -- their operating system already holds it.
 */
(function () {
  'use strict';

  const MODES = ['system', 'light', 'dark'];

  const requested = new URLSearchParams(window.location.search).get('theme');
  const mode = MODES.indexOf(requested) === -1 ? 'system' : requested;

  const root = document.documentElement;
  root.setAttribute('data-theme-mode', mode);

  if (mode === 'light' || mode === 'dark') {
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
  }
})();
