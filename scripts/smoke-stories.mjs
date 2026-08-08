#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { serveDirectory } from './lib/static-server.mjs';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../storybook-static', import.meta.url));

/**
 * How long one story has to reach `networkidle` before it counts as broken.
 *
 * Ninety seconds, where Playwright's unstated default is thirty. `networkidle`
 * is half a second of quiet, so what this really measures is how long a loaded
 * machine takes to finish a page it would finish in under a second idle -- and
 * on 2026-08-07 that was more than thirty, at load 135, for a story that renders
 * perfectly. A story that is genuinely broken is broken at thirty seconds and at
 * ninety alike, so the shorter cap protects nothing; it only decides how quickly
 * a busy machine is mistaken for a bad story. The cost is bounded and lands only
 * on a real failure, because the 543 stories that pass never approach it.
 */
const LOAD_TIMEOUT_MS = 90_000;

/**
 * The text a visitor would see, shadow roots included.
 *
 * `innerText` stops at a shadow boundary, so every one of these elements would
 * report an empty string and the "did it render anything" check would fail for
 * all of them equally -- which is the same as not checking.
 *
 * It is a string rather than a function because this file runs under Node's lint
 * configuration, where `document` and `Node` are not defined. It is an *invoked*
 * expression because that is what `page.evaluate` does with a string: it
 * evaluates it. Handing it `() => {...}` returned the function object itself,
 * which does not serialize, so every call resolved `undefined` and the check
 * below never once fired. The `typeof` guard is there so that the next version
 * of this mistake fails loudly instead of passing 494 stories.
 */
const VISIBLE_TEXT = `(() => {
  const walk = (node) =>
    [...node.childNodes]
      .map((child) =>
        child.nodeType === Node.TEXT_NODE
          ? child.textContent
          : (child.shadowRoot ? walk(child.shadowRoot) : '') + walk(child),
      )
      .join(' ');
  return walk(document.querySelector('#storybook-root')).replace(/\\s+/g, ' ').trim();
})()`;

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

  const { server, origin } = await serveDirectory(OUTPUT_DIRECTORY);
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
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: LOAD_TIMEOUT_MS });
      } catch (error) {
        // Report it against the story and keep going. Letting it throw ended the
        // run on a stack trace that named no story and left every later one
        // unchecked -- a worse answer than the one failure it was reporting, and
        // not a retry: the check still fails, it just says what and finishes.
        failures.push(
          `${story.id}: did not load (${error instanceof Error ? error.name : 'threw'})`,
        );
        continue;
      }
      const text = await page.evaluate(VISIBLE_TEXT);

      if (typeof text !== 'string') {
        throw new Error(
          `The visible-text probe returned ${typeof text} rather than a string. ` +
            'Every story would pass regardless of what it rendered; fix the probe.',
        );
      }
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
