// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Registers the service worker, from the pages that should have one.
 *
 * Called by the hub and by each tool's standalone entry, and by no embed entry.
 * A worker registered from inside somebody else's iframe would install the whole
 * application into their visitor's browser as a side effect of them quoting a
 * widget -- and its scope is the deployment, not the frame, so it would go on
 * serving pages the embedder never linked to.
 */

/**
 * Whether this document is the top-level one.
 *
 * `window.top` is readable across origins; only its contents are not, and this
 * compares references. A page framed by a site on any origin fails this, which
 * is the point.
 */
function isFramed(): boolean {
  return window.top !== window.self;
}

export function registerServiceWorker(): void {
  // Development is served by Vite, which rewrites modules on every save. A
  // worker caching that output is a debugging session spent wondering why an
  // edit did nothing.
  if (!import.meta.env.PROD) return;

  if (!('serviceWorker' in navigator)) return;
  if (isFramed()) return;

  // `BASE_URL` rather than a path from `location`: the worker's scope has to be
  // the deployment root, which under a project-site deploy is a subpath, and the
  // page asking for it may be two directories below that. It always ends in `/`.
  const base = import.meta.env.BASE_URL;

  // After load, because registration competes with the page's own requests for
  // the same connection, and precaching every asset in the build is not what
  // should be in front of first paint on a phone at a warm-up rack.
  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).then(
        () => undefined,
        (error: unknown) => {
          // Not swallowed, and not fatal either: everything on these pages works
          // without a worker, so the visitor is told nothing and the failure goes
          // where a developer will find it. The reason is logged without the
          // registration URL, which under a custom deploy would name the host.
          console.error(
            'Offline support is unavailable: the service worker did not register.',
            error instanceof Error ? error.name : 'unknown',
          );
        },
      );
    },
    { once: true },
  );
}
