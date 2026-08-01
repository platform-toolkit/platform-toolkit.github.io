#!/usr/bin/env node
/**
 * Loads every built story in a real browser and fails on anything it logs.
 *
 * WHY A BUILD IS NOT ENOUGH
 *
 * `storybook build` proves the stories compile and bundle. It does not run them.
 * The first version of this repository's stories built cleanly and every one of
 * the shared-component stories threw on load: a story imported its element by
 * relative path while the preview reached the same element through the package
 * entry, which is two modules and therefore two `customElements.define` calls
 * for one tag name. The registry throws on the second. Nothing looked wrong --
 * the first definition had already won, so the story rendered correctly -- and
 * the only evidence was a console error nobody was reading.
 *
 * That is the shape of failure this guards: a story that is silently broken but
 * visibly fine. So the bar is deliberately blunt. A story must render some text,
 * and the page must log nothing. Anything more specific belongs in a test beside
 * the component, where it can say what it means.
 *
 * WHY IT SERVES THE FILES ITSELF
 *
 * `file://` gives modules a null origin and breaks the dynamic imports Storybook
 * uses to load a story, so the output has to come over HTTP. A twenty-line static
 * server on the loopback interface is a smaller commitment than a dependency, and
 * it can only read below the output directory.
 *
 * USAGE
 *
 *   node scripts/smoke-stories.mjs            after `pnpm run storybook:build`
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../storybook-static', import.meta.url));

/** Enough to serve a Storybook build. An unknown extension is not guessed at. */
const CONTENT_TYPES = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

/**
 * Serves the built output on an ephemeral loopback port.
 *
 * The path is resolved and then checked to be inside the output directory. A
 * request for `/../../.commit-identity.local` is a real thing a browser can be
 * made to send, and this server is trivially reachable while it runs.
 */
async function serve(root) {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://localhost');
    const file = resolve(root, `.${decodeURIComponent(requested.pathname)}`);
    const inside = relative(root, file);
    if (inside.startsWith(`..${sep}`) || inside === '..') {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => {
        const type = CONTENT_TYPES.get(extname(file));
        response.writeHead(200, type === undefined ? {} : { 'content-type': type });
        response.end(body);
      },
      () => {
        response.writeHead(404).end();
      },
    );
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

/**
 * The text a visitor would see, shadow roots included.
 *
 * `innerText` stops at a shadow boundary, so every one of these elements would
 * report an empty string and the "did it render anything" check would fail for
 * all of them equally -- which is the same as not checking.
 */
const VISIBLE_TEXT = `() => {
  const walk = (node) =>
    [...node.childNodes]
      .map((child) =>
        child.nodeType === Node.TEXT_NODE
          ? child.textContent
          : (child.shadowRoot ? walk(child.shadowRoot) : '') + walk(child),
      )
      .join(' ');
  return walk(document.querySelector('#storybook-root')).replace(/\\s+/g, ' ').trim();
}`;

async function main() {
  let index;
  try {
    index = JSON.parse(await readFile(join(OUTPUT_DIRECTORY, 'index.json'), 'utf8'));
  } catch {
    console.error('No Storybook build found. Run `pnpm run storybook:build` first.');
    process.exitCode = 1;
    return;
  }

  const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');
  if (stories.length === 0) {
    // Not a pass. A glob that stopped matching is exactly how this check would
    // quietly stop checking anything.
    console.error('The Storybook build contains no stories.');
    process.exitCode = 1;
    return;
  }

  const { server, origin } = await serve(OUTPUT_DIRECTORY);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let logged = [];
  page.on('pageerror', (error) => logged.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      logged.push(`console.${message.type()}: ${message.text()}`);
    }
  });

  const failures = [];
  try {
    for (const story of stories) {
      logged = [];
      const url = `${origin}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
      await page.goto(url, { waitUntil: 'networkidle' });
      const text = await page.evaluate(VISIBLE_TEXT);

      if (text === '') {
        failures.push(`${story.id}: rendered no text`);
      }
      for (const entry of logged) {
        failures.push(`${story.id}: ${entry}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`Story smoke check failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Story smoke check passed: ${String(stories.length)} stories rendered, nothing logged.`,
  );
}

await main();
