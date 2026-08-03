// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The offline layer, in one file, by hand.
 *
 * WHY NOT A GENERATOR
 *
 * The usual answer is a plugin that generates a worker from a configuration
 * object. That trades about a hundred lines of readable code for a dependency
 * whose output nobody reads, in a file that decides what a lifter sees when the
 * gym wifi drops. This is the one script in the project that runs with no page
 * around it, outlives every deploy, and cannot be debugged by reloading -- it is
 * the last place to accept generated code.
 *
 * WHY IT LIVES HERE AND NOT IN `public/`
 *
 * `public/` is copied verbatim, and this file is a template: the precache list
 * and the build identifier are substituted by `serviceWorkerPlugin` in
 * `vite.config.ts`, which emits the result as `sw.js`. The placeholders below are
 * written as real values so that the file stays valid, lintable JavaScript on its
 * own -- a template with holes in it cannot be checked by anything.
 *
 * SCOPE
 *
 * `sw.js` is emitted at the root of the build output, so its scope is the whole
 * deployment, including the embed routes. That is deliberate and harmless: the
 * embed pages never register a worker, but if one is already installed from a
 * visit to the site proper, an embedded view loads offline too.
 */

/**
 * Everything the site needs to render its shell with no network.
 *
 * Substituted at build time with the emitted filenames, which carry content
 * hashes, so this list changes exactly when the output does. Published data is
 * deliberately absent -- see the fetch handler.
 */
const PRECACHE_PATHS = /* @__PTK_PRECACHE__ */ [];

/**
 * Identifies this build's precache.
 *
 * Derived from the precache list itself rather than from a timestamp or a
 * counter, so two builds of the same source produce the same identifier and a
 * rebuild that changed nothing does not evict a cache that was still correct.
 * The same reasoning as content-addressed artifacts, applied one level up.
 */
const BUILD_ID = /* @__PTK_BUILD_ID__ */ 'development';

/**
 * Where published data lives, as the build configured it.
 *
 * Resolved against the worker's own URL so a relative value works under any
 * deployed base. If it points at another origin the caching below declines to
 * act on it: a cross-origin response without CORS is opaque, and an opaque
 * response in a cache is a stored failure that looks like a hit.
 */
const DATA_BASE = /* @__PTK_DATA_BASE__ */ '/data/';

const PRECACHE_NAME = `ptk-shell-${BUILD_ID}`;

/**
 * The data cache is not versioned, and must not be.
 *
 * Artifacts are content-addressed: the filename contains a hash of the bytes, so
 * an entry can never be stale, only unreferenced. Versioning this cache with the
 * build would throw away perfectly good megabytes on every deploy, which is the
 * opposite of what content addressing is for.
 */
const DATA_CACHE_NAME = 'ptk-data';

/**
 * A ceiling on the data cache, because nothing else bounds it.
 *
 * Unreferenced artifacts accumulate as records are republished, and no client
 * knows which ones are dead. Cache keys come back in insertion order, so trimming
 * from the front approximates evicting the oldest. Sixty entries is far more than
 * one screen needs and far less than a phone would notice.
 */
const MAX_DATA_ENTRIES = 60;

const dataBaseUrl = new URL(DATA_BASE, self.location.href);
const precacheUrls = PRECACHE_PATHS.map((path) => new URL(path, self.location.href).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE_NAME).then((cache) =>
      // `reload` bypasses the HTTP cache. Without it a precache can be populated
      // from stale browser-cached copies of the very files this deploy changed,
      // producing an offline experience that is a mix of two builds.
      cache.addAll(precacheUrls.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
  // There is deliberately no `skipWaiting()` here.
  //
  // Taking over immediately would leave an already-open page controlled by a
  // worker whose precache holds none of the hashed files that page is still
  // asking for. Waiting until the last old tab closes costs an update one
  // session and cannot break a page somebody is reading. Content still refreshes
  // in the meantime, because navigations and the data index are network-first.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Anything that is neither this build's shell nor the data cache belongs
        // to a build with no clients left, since activation waited for them.
        if (name !== PRECACHE_NAME && name !== DATA_CACHE_NAME) {
          await caches.delete(name);
        }
      }
      // Claim the pages open right now. On a first visit there is no controller
      // at all, and without this the site would only work offline from the
      // second load onwards -- which is the load that never happens on a phone
      // that has already lost signal.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that is not a plain GET is somebody else's problem: there is no
  // meaningful cached answer for a POST, and intercepting one risks replaying it.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isData = url.href.startsWith(dataBaseUrl.href) && url.origin === dataBaseUrl.origin;

  // A navigation is the request that decides whether the visitor sees the
  // application or the browser's offline page, so it is the one worth handling
  // even though its response is rarely the freshest thing in the cache.
  if (request.mode === 'navigate') {
    // `ignoreSearch`, because the documented embed parameters (`?theme=dark`)
    // select an appearance and never a different document. Without it every
    // parameterised URL is a cache miss, and the offline case that fails is the
    // embedded one -- the hardest to notice.
    event.respondWith(networkFirst(request, PRECACHE_NAME, { ignoreSearch: true }));
    return;
  }

  if (isData) {
    // The index names the artifacts and is the only file whose contents change
    // under a fixed name, so it is the only data request that must reach the
    // network when there is one. A cached index with cached artifacts is a
    // complete, internally consistent older view of the data -- which is the
    // right thing to show offline, and the reason both are cached at all.
    if (url.pathname.endsWith('/meta.json')) {
      event.respondWith(networkFirst(request, DATA_CACHE_NAME));
      return;
    }
    event.respondWith(cacheFirst(request, DATA_CACHE_NAME, MAX_DATA_ENTRIES));
    return;
  }

  // Build output. Every one of these filenames contains a content hash, so a hit
  // is a hit forever and a miss means a file this build does not know about --
  // an old page asking for an old chunk, which the network can still answer.
  if (isSameOrigin && precacheUrls.includes(url.href)) {
    event.respondWith(cacheFirst(request, PRECACHE_NAME, null));
    return;
  }

  // Everything else -- a font, an image, anything added later -- is left to the
  // browser. Silently caching requests nobody planned for is how a service worker
  // starts serving a version of the site that no deploy can replace.
});

/**
 * Network, then cache. For things that change under a fixed name.
 *
 * @param {Request} request
 * @param {string} cacheName
 * @param {CacheQueryOptions} [matchOptions]
 * @returns {Promise<Response>}
 */
async function networkFirst(request, cacheName, matchOptions) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (networkError) {
    const cached = await caches.match(request, matchOptions);
    if (cached !== undefined) return cached;
    // Nothing cached and no network. Rethrowing rather than inventing a response
    // hands the browser its own offline page, which says what happened in the
    // visitor's language and does not pretend to be the application.
    throw networkError;
  }
}

/**
 * Cache, then network. For things whose name changes when their contents do.
 *
 * @param {Request} request
 * @param {string} cacheName
 * @param {number | null} maximumEntries
 * @returns {Promise<Response>}
 */
async function cacheFirst(request, cacheName, maximumEntries) {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (maximumEntries !== null) await trim(cache, maximumEntries);
  }
  return response;
}

/**
 * @param {Response} response
 * @returns {boolean}
 */
function isCacheable(response) {
  // `basic` means same-origin and fully readable. An `opaque` response has a
  // status of 0 and a body nothing can inspect, so storing one caches a failure
  // that is indistinguishable from success on every subsequent read. `redirected`
  // is excluded because a cached redirected response cannot be returned to a
  // navigation -- the browser rejects it, and the page fails offline only.
  return response.ok && response.type === 'basic' && !response.redirected;
}

/**
 * @param {Cache} cache
 * @param {number} maximumEntries
 * @returns {Promise<void>}
 */
async function trim(cache, maximumEntries) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - maximumEntries))) {
    await cache.delete(key);
  }
}
