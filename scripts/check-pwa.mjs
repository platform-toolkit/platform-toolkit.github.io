#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Proves the built site is installable and works with no network.
 *
 * WHY THIS IS A SEPARATE CHECK
 *
 * Every part of installability fails silently. A manifest with a typo in an icon
 * path installs an app with no icon. A service worker whose precache list missed
 * the HTML shows the browser's offline page. A registration that throws logs one
 * line nobody reads. None of it affects a page loaded normally on a desk with
 * wifi, which is where all the other tests run.
 *
 * The case this exists for is a lifter in a basement gym with no signal opening
 * a bookmark between sets. There is no way to check that by looking at the site.
 *
 * WHAT IT CHECKS
 *
 *   - the manifest parses, is complete, and every icon and screenshot it names
 *     exists at the pixel size it claims
 *   - every shortcut points at a page of this collection, relatively
 *   - the hub and the tool page link the manifest and an apple-touch-icon, and
 *     the embed route links neither
 *   - the worker registers, activates, takes control, and fills its precache
 *   - with the network switched off, both pages still render -- including the
 *     tool page, which needs published data as well as its own code
 *   - a page never opened online renders offline, from the precache alone
 *   - an address that does not exist falls back to this collection's own page
 *   - the embed route installs nothing, even framed by another origin
 *
 * USAGE
 *
 *   node scripts/check-pwa.mjs                  after `pnpm run build`
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { serveDirectory } from './lib/static-server.mjs';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../apps/web/dist', import.meta.url));

/** Manifest members without which a browser will not offer to install. */
const REQUIRED_MANIFEST_MEMBERS = [
  'name',
  'short_name',
  'start_url',
  'scope',
  'display',
  'icons',
  'theme_color',
  'background_color',
];

/** Sizes a browser looks for. 192 for the launcher, 512 for the splash. */
const REQUIRED_ICON_SIZES = ['192x192', '512x512'];

/**
 * Pages that must offer installation, and the one that must not.
 *
 * The embed route is the interesting row. A manifest inside an iframe is ignored
 * by the browser, so shipping one there would be harmless and invisible -- which
 * is exactly why it needs asserting rather than assuming. The rule is that
 * embedding a widget never installs anything on the embedder's visitor.
 */
const PAGES = [
  { path: '/', installable: true },
  { path: '/platform-targets/', installable: true },
  { path: '/platform-targets/embed/uspa/', installable: false },
  { path: '/warm-up/', installable: true },
  { path: '/warm-up/embed/', installable: false },
  { path: '/convert/', installable: true },
  { path: '/convert/embed/uspa/', installable: false },
  { path: '/one-rep-max/', installable: true },
  { path: '/one-rep-max/embed/', installable: false },
  { path: '/meet-day/', installable: true },
  { path: '/meet-day/embed/', installable: false },
  { path: '/qualify/', installable: true },
  { path: '/qualify/embed/uspa/', installable: false },
  { path: '/logbook/', installable: true },
  { path: '/logbook/embed/', installable: false },
];

/**
 * Reads a PNG's dimensions from its header.
 *
 * Eight bytes of signature, then a length and a chunk type, then IHDR's width
 * and height as big-endian 32-bit integers. Worth the twelve lines: the sizes in
 * the manifest are a promise about the file, and a 512 icon regenerated at 256
 * would satisfy every other check here.
 *
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number } | null}
 */
function pngSize(bytes) {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Checks one declared image against the file the build actually emitted.
 *
 * Shared by the icons and the screenshots because the failure is the same in
 * both: a `sizes` string is a promise about the bytes, and nothing else here
 * opens the file to find out whether it was kept.
 *
 * @param {string[]} failures
 * @param {unknown} declared
 */
async function checkDeclaredImage(failures, declared) {
  const image = /** @type {Record<string, unknown>} */ (declared);
  const source = String(image['src'] ?? '');
  const file = join(OUTPUT_DIRECTORY, source.replace(/^\.\//, ''));
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    failures.push(`the manifest names ${source}, which the build does not contain`);
    return;
  }
  if (!source.endsWith('.png')) return;

  const size = pngSize(bytes);
  if (size === null) {
    failures.push(`${source} is named as a PNG but is not one`);
    return;
  }
  const [width, height] = String(image['sizes']).split('x').map(Number);
  if (size.width !== width || size.height !== height) {
    failures.push(
      `${source} is declared ${String(image['sizes'])} but is ${String(size.width)}x${String(size.height)}`,
    );
  }
}

/**
 * @param {string[]} failures
 * @returns {Promise<Record<string, unknown> | null>} the parsed manifest
 */
async function checkManifest(failures) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(OUTPUT_DIRECTORY, 'manifest.webmanifest'), 'utf8'));
  } catch (error) {
    failures.push(`the manifest could not be read or parsed: ${String(error)}`);
    return null;
  }

  for (const member of REQUIRED_MANIFEST_MEMBERS) {
    if (manifest[member] === undefined) failures.push(`the manifest has no ${member}`);
  }

  // Relative, or a subpath deploy installs an application whose start_url is
  // some other site's root. This is the single member most likely to be right in
  // development and wrong in production, because development is served from `/`.
  for (const member of ['start_url', 'scope']) {
    const value = manifest[member];
    if (typeof value === 'string' && !value.startsWith('.')) {
      failures.push(
        `the manifest's ${member} is "${value}", which is not relative to the manifest`,
      );
    }
  }

  // WCAG 1.3.4: content must not be locked to one display orientation. An
  // installed application takes its orientation from the manifest, so a value of
  // "portrait" here overrides the device rotation lock for everyone -- and the
  // people it locks out are the ones who cannot rotate their phone back, which
  // is the population the criterion is written for. It is correct today; without
  // an assertion the only thing keeping it correct is that nobody has edited the
  // file. "any" and "natural" both satisfy it; anything else does not.
  if (manifest.orientation !== 'any' && manifest.orientation !== 'natural') {
    failures.push(
      `the manifest's orientation is ${JSON.stringify(manifest.orientation)}, which locks the installed application to one orientation`,
    );
  }

  // `id` is the one member that does not resolve against the manifest's URL: the
  // algorithm parses it against the *origin* of the resolved start_url, so a
  // relative value cannot name a subpath at all and "./" simply means the
  // origin's root. Under PTK_BASE_PATH that is an identity shared with whatever
  // else is installed from that host. Left out, the identity defaults to the
  // resolved start_url, which does carry the base -- so the check is that the
  // member is absent, not that it looks relative like every other URL here.
  if (manifest.id !== undefined) {
    failures.push(
      `the manifest declares an id of ${JSON.stringify(manifest.id)}, which resolves against the origin rather than the deployed base`,
    );
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const declaredSizes = new Set(icons.map((icon) => icon.sizes));
  for (const size of REQUIRED_ICON_SIZES) {
    if (!declaredSizes.has(size)) failures.push(`the manifest declares no ${size} icon`);
  }
  if (!icons.some((icon) => String(icon.purpose ?? '').includes('maskable'))) {
    // Without one, a launcher that crops to a circle crops the artwork rather
    // than the safe area, and the result is a barbell with its ends cut off.
    failures.push('the manifest declares no maskable icon');
  }

  for (const icon of icons) {
    await checkDeclaredImage(failures, icon);
  }

  // A screenshot set that a browser cannot use is worse than none: it is carried
  // on every deploy and shows nowhere. The set is chosen by device, so an empty
  // form factor is a bare one-line install bar on exactly that class of device,
  // and the phone is the one this collection is written for.
  const screenshots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  for (const formFactor of ['narrow', 'wide']) {
    if (!screenshots.some((shot) => shot.form_factor === formFactor)) {
      failures.push(`the manifest declares no ${formFactor} screenshot`);
    }
  }
  for (const shot of screenshots) {
    await checkDeclaredImage(failures, shot);
  }

  // A shortcut is a deep link into the one installed application, so it has to
  // land on a page of this collection and it has to be relative for the same
  // reason start_url is. An absolute one is right in development and installs a
  // long-press menu pointing at somebody else's site on a subpath deploy, which
  // is the failure nobody looks for -- a launcher menu is opened by hand, months
  // later, by somebody who will not report it.
  const shortcuts = Array.isArray(manifest.shortcuts) ? manifest.shortcuts : [];
  if (shortcuts.length === 0) failures.push('the manifest declares no shortcuts');
  const installablePaths = new Set(PAGES.filter((page) => page.installable).map((p) => p.path));
  for (const shortcut of shortcuts) {
    const url = String(shortcut.url ?? '');
    if (typeof shortcut.name !== 'string' || shortcut.name === '') {
      failures.push(`the shortcut for ${url} has no name`);
    }
    if (!url.startsWith('./')) {
      failures.push(`the shortcut url "${url}" is not relative to the manifest`);
      continue;
    }
    if (!installablePaths.has(url.replace(/^\./, ''))) {
      failures.push(`the shortcut url "${url}" is not a page of this collection`);
    }
  }

  return manifest;
}

/**
 * Reads a meta tag's content, whichever order its attributes were written in.
 *
 * @param {string} html
 * @param {string} name
 * @returns {string | null}
 */
function metaContent(html, name) {
  const tag = new RegExp(`<meta[^>]+name="${name}"[^>]*>`).exec(html);
  if (tag === null) return null;
  const content = /content="([^"]*)"/.exec(tag[0]);
  return content === null ? null : content[1];
}

/**
 * @param {string[]} failures
 * @param {Record<string, unknown> | null} manifest
 */
async function checkDocuments(failures, manifest) {
  for (const page of PAGES) {
    const file = join(OUTPUT_DIRECTORY, page.path.replace(/^\//, ''), 'index.html');
    const html = await readFile(file, 'utf8');
    const hasManifest = html.includes('rel="manifest"');
    const hasAppleIcon = html.includes('rel="apple-touch-icon"');

    if (page.installable && !hasManifest) failures.push(`${page.path} does not link the manifest`);
    if (page.installable && !hasAppleIcon) {
      // iOS reads no manifest at all. Without this link an installed shortcut
      // shows a screenshot of the page where the icon should be.
      failures.push(`${page.path} does not link an apple-touch-icon`);
    }
    if (!page.installable && (hasManifest || hasAppleIcon)) {
      failures.push(`${page.path} offers installation and must not`);
    }
    if (!page.installable || manifest === null) continue;

    // The home-screen label, stated once per document and once in the manifest,
    // with nothing keeping the nine copies in step.
    //
    // It has to be the same on every page. `apple-mobile-web-app-title` overrides
    // short_name on iOS and is read from whichever page the lifter happened to be
    // on when they reached for Share -- but what gets installed is start_url, the
    // hub, because the collection is one application. So a per-page value does
    // not label a per-page install; it labels the whole collection with the name
    // of one tool, and which tool is decided by where a shared link landed.
    const title = metaContent(html, 'apple-mobile-web-app-title');
    if (title !== manifest['short_name']) {
      failures.push(
        `${page.path} names the home-screen icon ${JSON.stringify(title)}, and the manifest's short_name is ${JSON.stringify(manifest['short_name'])}`,
      );
    }
  }
}

/**
 * Compares the emitted precache list against what the build actually produced.
 *
 * The offline pass below cannot cover this on its own. A navigation the worker
 * has served once is cached at runtime, so a document missing from the precache
 * still works offline for anyone who visited it while online -- and fails only
 * for the person who installed the site and then lost signal before opening that
 * page. That is precisely the visitor this feature exists for, and the only way
 * to check for them is to read the list.
 *
 * @param {string[]} failures
 */
async function checkPrecache(failures) {
  let worker;
  try {
    worker = await readFile(join(OUTPUT_DIRECTORY, 'sw.js'), 'utf8');
  } catch {
    // The build emits this file, so its absence means the plugin did not run --
    // a configuration mistake, and one worth naming rather than crashing on.
    failures.push('the build produced no sw.js');
    return;
  }

  const listed = /const PRECACHE_PATHS = (\[.*?\]);/s.exec(worker);
  if (listed === null) {
    failures.push('sw.js has no precache list, so the build-time substitution did not happen');
    return;
  }
  const precache = new Set(JSON.parse(listed[1]));

  // The offline fallback is the one entry the build does not contribute: it is a
  // fixed name copied out of `public/`, and the worker adds it to its own
  // install. Folding it in here rather than exempting the file from the sweep
  // below means the document still has to exist and still has to be precached --
  // the check is the same, it is just satisfied from the other end. Reading the
  // constant rather than hard-coding the path is what makes renaming it a
  // failure instead of a silently unprecached page.
  const fallback = /const OFFLINE_FALLBACK_PATH = '([^']+)';/.exec(worker);
  if (fallback === null) {
    failures.push('sw.js names no offline fallback document');
  } else {
    precache.add(fallback[1]);
    // Asked directly, because the sweep below only walks files that exist and so
    // has nothing to say about one that does not. `cache.addAll` is all-or-
    // nothing, so a missing fallback fails every install and the browser pass
    // reports it as six cascading failures beginning "the worker never took
    // control" -- true, and no help at all in finding the deleted file.
    try {
      await readFile(join(OUTPUT_DIRECTORY, fallback[1].replace(/^\.\//, '')));
    } catch {
      failures.push(
        `the worker precaches ${fallback[1]}, which the build does not contain, so every install will fail`,
      );
    }
  }

  if (/const BUILD_ID = "development"/.test(worker)) {
    failures.push('sw.js still carries the template build identifier');
  }

  const entries = await readdir(OUTPUT_DIRECTORY, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = relative(OUTPUT_DIRECTORY, join(entry.parentPath, entry.name))
      .split(sep)
      .join('/');

    // Published data is cached on demand by design -- artifacts are budgeted at
    // 2 MiB each and precaching them would put every record book on a phone at
    // install time. `sw.js` itself is fetched by the browser, never by the page.
    //
    // The screenshots are exempt for a related reason: they exist for the
    // browser's install dialog, which is shown before there is an installed
    // application and never again afterwards, so precaching them spends the
    // install's download budget on imagery the installed app cannot display.
    if (path.startsWith('data/') || path.startsWith('screenshots/') || path === 'sw.js') continue;

    const expected = path.endsWith('index.html')
      ? `./${path.replace(/(^|\/)index\.html$/, '$1')}`
      : `./${path}`;
    if (!precache.has(expected)) {
      failures.push(`the precache list is missing ${expected}`);
    }
  }
}

/**
 * Waits for the worker to control the page it registered from.
 *
 * `serviceWorker.ready` resolves on activation, which is one step short: a
 * worker can be active and still not be the controller, and every cached
 * response depends on it being the controller. This is the state the offline
 * reload below actually needs.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>} the cache names the worker created
 */
async function waitForController(page) {
  // One deadline over the whole thing, not one per step. `serviceWorker.ready`
  // does not settle when registration fails -- it waits for an activation that
  // will never happen -- so a timeout guarding only the step after it leaves the
  // check hanging on exactly the failure it is here to report.
  return page.evaluate(`Promise.race([
    (async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller === null) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        });
      }
      return caches.keys();
    })(),
    new Promise((_, reject) => {
      setTimeout(() => { reject(new Error('no controlling worker within 10s')); }, 10000);
    }),
  ])`);
}

/**
 * Navigates, then waits for something the page only shows if it really loaded.
 *
 * @param {string[]} failures
 * @param {string} message
 * @param {() => Promise<unknown>} navigate
 * @param {() => import('playwright').Locator} locate
 */
async function expectRenders(failures, message, navigate, locate) {
  try {
    await navigate();
    await locate().waitFor({ timeout: 10000 });
  } catch (error) {
    failures.push(
      `${message} (${error instanceof Error ? error.message.split('\n')[0] : 'failed'})`,
    );
  }
}

async function main() {
  try {
    await readFile(join(OUTPUT_DIRECTORY, 'index.html'));
  } catch {
    console.error('No site build found. Run `pnpm run build` first.');
    process.exitCode = 1;
    return;
  }

  const failures = [];
  const manifest = await checkManifest(failures);
  await checkDocuments(failures, manifest);
  await checkPrecache(failures);

  const { server, origin } = await serveDirectory(OUTPUT_DIRECTORY);
  const browser = await chromium.launch();

  try {
    // A phone-shaped context, because that is the device this feature is for and
    // a service worker is the one thing that behaves the same on both.
    const context = await browser.newContext({
      viewport: { width: 390, height: 720 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await page.goto(`${origin}/`, { waitUntil: 'load' });
    let cacheNames = [];
    try {
      cacheNames = await waitForController(page);
    } catch (error) {
      failures.push(`the service worker never took control of the hub: ${String(error)}`);
    }
    if (!cacheNames.some((name) => name.startsWith('ptk-shell-'))) {
      failures.push(`no precache was populated; caches were [${cacheNames.join(', ')}]`);
    }

    // Visited online first, deliberately. Published data is cached on demand
    // rather than precached, so this is what puts the catalogue in the cache --
    // and the offline pass below is what proves the on-demand half works.
    await page.goto(`${origin}/platform-targets/`, { waitUntil: 'networkidle' });
    await page.locator('ptk-choice-group[data-field="sex"] input').first().waitFor();

    // Empty the ordinary HTTP cache before switching the network off.
    //
    // Without this the check passes without a service worker at all: an offline
    // reload of a page visited a moment ago is served from the browser's own
    // disk cache, so deleting every document from the precache changed nothing
    // and the whole offline pass was measuring the wrong mechanism. Cache
    // Storage is a separate store and is untouched by this, which is what makes
    // the reload below attributable to the worker.
    const devtools = await context.newCDPSession(page);
    await devtools.send('Network.clearBrowserCache');
    await devtools.detach();

    await context.setOffline(true);

    // Both navigations are wrapped, because an uncached document offline does
    // not render an error page for the check to inspect -- `goto` itself rejects
    // with a transport error. Letting that escape would replace a one-line
    // failure with a Playwright stack trace, which is a worse way to be told
    // that the precache missed a page.
    await expectRenders(
      failures,
      'the tool page does not render offline after an online visit',
      () => page.reload({ waitUntil: 'load' }),
      () => page.locator('ptk-choice-group[data-field="sex"] input').first(),
    );

    await expectRenders(
      failures,
      'the hub does not render offline',
      () => page.goto(`${origin}/`, { waitUntil: 'load' }),
      () => page.locator('.tool-list a').first(),
    );

    // The one page in this context that has never been fetched, opened with no
    // network at all.
    //
    // Everything above is a page the worker already served once, and a navigation
    // served network-first is cached at runtime -- so those two prove the worker
    // is answering and prove nothing about the precache being complete. This is
    // the other half, and it is the visitor the feature exists for: somebody who
    // installed the collection from the hub, put the phone in a bag, and opened
    // the logbook in a basement gym having never loaded it. It is the logbook
    // because it is the tool that owes the network nothing -- no artifact, no
    // federation, the training in IndexedDB and the rules in the bundle -- so a
    // failure here is the precache and cannot be anything else.
    await expectRenders(
      failures,
      'the logbook does not render offline having never been opened online',
      () => page.goto(`${origin}/logbook/`, { waitUntil: 'load' }),
      () => page.locator('ptk-training-logbook ptk-button[data-action="start-workout"] button'),
    );

    // An address with nothing behind it, offline. GitHub Pages answers the online
    // half of this with the same document, which is why one file covers both --
    // and why the worker has to be holding it, since the host that would have
    // served it is the thing that is unreachable.
    await expectRenders(
      failures,
      'an unknown address offline does not fall back to this collection',
      () => page.goto(`${origin}/no-such-tool/`, { waitUntil: 'load' }),
      () => page.locator('main.not-available'),
    );

    await context.close();

    // A context of its own: storage is per-context, so this one has never met a
    // service worker and cannot inherit one from the pass above.
    const embedContext = await browser.newContext();
    const embedPage = await embedContext.newPage();
    await embedPage.goto(`${origin}/platform-targets/embed/uspa/`, { waitUntil: 'networkidle' });
    const registrations = await embedPage.evaluate(
      `navigator.serviceWorker.getRegistrations().then((all) => all.length)`,
    );
    if (registrations !== 0) {
      failures.push(`the embed route registered ${String(registrations)} service worker(s)`);
    }
    await embedContext.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`PWA check failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('PWA check passed: manifest, icons, worker control, and offline rendering.');
}

await main();
