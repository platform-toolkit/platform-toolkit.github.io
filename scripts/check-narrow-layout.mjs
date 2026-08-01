#!/usr/bin/env node
/**
 * Loads the built site at phone widths and fails on the ways a layout stops
 * working there.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE COMPONENT TESTS
 *
 * A component test can measure the element it mounted. It cannot see the page
 * that element sits on: the gutter, the header, the index's list of tools, the
 * link back. Every problem this check first caught was in that gap -- an index
 * whose only tap target was eighteen pixels of link text, a back link the same,
 * option tiles two pixels under the minimum. All of them looked fine in a
 * desktop window, which is where a layout that only works in one gets shipped.
 *
 * Mobile is where these tools are used -- a lifter at a warm-up rack, a meet
 * director working a registration list on the platform floor -- so this runs on
 * the real built output rather than a dev server, in a touch-emulating context,
 * at the narrowest width still in service.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Three blunt properties, each one a failure a screenshot does not show:
 *
 *   - nothing scrolls sideways
 *   - everything interactive is at least the tap-target minimum in both axes
 *   - no text-entry control is under 16px, which is the size below which iOS
 *     Safari zooms the page on focus and the layout jumps under a thumb
 *
 * Anything about how a screen *reads* belongs in a story, where a person looks
 * at it. This is only for the things a person will not notice until it is live.
 *
 * USAGE
 *
 *   node scripts/check-narrow-layout.mjs        after `pnpm run build`
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../apps/web/dist', import.meta.url));

/**
 * The widths worth checking.
 *
 * 320 is the narrowest phone still in service and also narrower than most
 * third-party embed columns, so it covers both. 390 is a current handset, and
 * catches the case where a rule keyed to the smallest size stops applying just
 * above it.
 */
const WIDTHS = [320, 390];

/**
 * The routes, and the one interaction that reveals the rest of each screen.
 *
 * Platform Targets asks for a sex category before it can offer a weight class,
 * so the state with the most on it -- four questions and the longest ladder --
 * is only reachable by answering the first. Checking the initial render alone
 * would measure about a third of the page.
 */
const ROUTES = [
  { path: '/', reveal: null },
  { path: '/platform-targets/', reveal: 'ptk-choice-group[data-field="sex"] input' },
  { path: '/platform-targets/embed/uspa/', reveal: 'ptk-choice-group[data-field="sex"] input' },
];

/** Kept in step with `--ptk-tap-target-min` in `packages/ui/src/tokens.css`. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page when a field takes focus. */
const MINIMUM_INPUT_FONT_SIZE = 16;

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
 * The path is resolved and then checked to be inside the output directory, for
 * the same reason the story smoke check does it: this server is trivially
 * reachable while it runs, and `/../../.commit-identity.local` is a request a
 * browser can be made to send.
 */
async function serve(root) {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(requested.pathname);
    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }
    const file = resolve(root, `.${pathname}`);
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
  return { server, origin: `http://127.0.0.1:${String(server.address().port)}` };
}

/**
 * Measures the page, reaching into shadow roots.
 *
 * Every control on these screens lives inside one, so a walk that stopped at
 * the boundary would find nothing to measure and report a clean pass -- the
 * exact failure mode the story smoke check ran into with `innerText`.
 *
 * A radio inside an option tile is skipped: the tile is the target, the radio
 * is a glyph within it, and the browser routes a tap on either to the same
 * control. Flagging it would be a false positive nobody could fix.
 *
 * Written as a string because this file is Node code -- `document` and
 * `getComputedStyle` are not defined here, and a real function would have to
 * either disable the rule that says so or pretend the file runs in a browser.
 * The limits are interpolated in rather than passed as an argument, and that is
 * not a style choice: Playwright evaluates a string first argument as an
 * expression and never forwards the second one, so a parameter would arrive
 * undefined and every comparison against it would quietly be false. The
 * trailing call is load-bearing for the same reason -- the expression's value
 * is what comes back, so a bare function literal would return a function.
 */
const MEASURE = `(() => {
  const limits = { tap: ${String(TAP_TARGET_MIN)}, font: ${String(MINIMUM_INPUT_FONT_SIZE)} };
  const problems = [];

  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    problems.push('the page scrolls sideways: ' + root.scrollWidth + 'px of content in ' + root.clientWidth + 'px');
  }

  const controls = [];
  const walk = (node) => {
    for (const element of node.querySelectorAll('*')) {
      if (element.shadowRoot) walk(element.shadowRoot);
      if (element.matches('a, button, input, select, textarea, [role="button"], label.option')) {
        controls.push(element);
      }
    }
  };
  walk(document);

  for (const element of controls) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const name =
      element.tagName.toLowerCase() +
      (element.className ? '.' + element.className : '') +
      ' "' + (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 32) + '"';

    const isGlyphInTile = element.tagName === 'INPUT' && element.closest('label.option') !== null;
    if (!isGlyphInTile && (box.height < limits.tap || box.width < limits.tap)) {
      problems.push(
        'tap target ' + Math.round(box.width) + 'x' + Math.round(box.height) +
          ', under ' + limits.tap + 'px: ' + name,
      );
    }

    const typed = ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) &&
      !['radio', 'checkbox', 'button', 'submit', 'range'].includes(element.type);
    if (typed && parseFloat(style.fontSize) < limits.font) {
      problems.push('font size ' + style.fontSize + ', under ' + limits.font + 'px: ' + name);
    }
  }

  return problems;
})()`;

async function main() {
  try {
    await readFile(join(OUTPUT_DIRECTORY, 'index.html'));
  } catch {
    console.error('No site build found. Run `pnpm run build` first.');
    process.exitCode = 1;
    return;
  }

  const { server, origin } = await serve(OUTPUT_DIRECTORY);
  const browser = await chromium.launch();
  const failures = [];
  let measured = 0;

  try {
    for (const width of WIDTHS) {
      // Touch and a device pixel ratio, not just a narrow window: a phone is
      // what is being stood in for, and `isMobile` is what makes the viewport
      // behave like one rather than like a very small desktop.
      const context = await browser.newContext({
        viewport: { width, height: 720 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });

      for (const route of ROUTES) {
        const page = await context.newPage();
        await page.goto(origin + route.path, { waitUntil: 'networkidle' });

        if (route.reveal !== null) {
          const control = page.locator(route.reveal).first();
          if ((await control.count()) === 0) {
            // The published data is what puts these controls on the page, so a
            // selector that stops matching means the check has quietly stopped
            // checking the state it exists for.
            failures.push(`${String(width)}px ${route.path}: nothing matched ${route.reveal}`);
            await page.close();
            continue;
          }
          await control.check();
        }

        for (const problem of await page.evaluate(MEASURE)) {
          failures.push(`${String(width)}px ${route.path}: ${problem}`);
        }
        measured += 1;
        await page.close();
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`Narrow-layout check failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Narrow-layout check passed: ${String(measured)} screens at ${WIDTHS.map(String).join('px, ')}px.`,
  );
}

await main();
