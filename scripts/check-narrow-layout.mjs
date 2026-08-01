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
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { serveDirectory } from './lib/static-server.mjs';

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
 * The interactions that reveal the rest of the Platform Targets screen.
 *
 * Each question is only offered once the one before it has been answered -- the
 * catalogue cannot name a weight class before it knows a sex category -- so the
 * state with the most on it is reachable only by working down the list. Every
 * selector picks the *first* option in its group, which is enough: the check is
 * about layout, and the longest label in each group is measured whether or not
 * it is the one chosen.
 *
 * All five matter. The standards panel below the questions renders four fields
 * and four status lines, and it is inert until a category is complete, so
 * stopping after the first answer would measure roughly a third of the page --
 * which is what this list used to do, and why it is a list now.
 */
const PLATFORM_TARGETS_REVEAL = [
  'ptk-choice-group[data-field="sex"] input',
  'ptk-choice-group[data-field="equipment"] input',
  'ptk-choice-group[data-field="weightClass"] input',
  'ptk-choice-group[data-field="division"] input',
  'ptk-choice-group[data-field="tested"] input',
];

/**
 * Weights typed into the lift fields once the category is answered.
 *
 * Three component lifts and no total, so the fourth field fills itself and the
 * derived-total sentence -- the longest string the panel ever renders -- is on
 * screen when the measurement runs. A blank panel would measure the placeholder
 * layout, which is not the one that overflows.
 *
 * The figures are invented. Nothing here compares them against anything.
 */
const PLATFORM_TARGETS_FILL = [
  { selector: 'ptk-number-field[data-lift="squat"] input', value: '142.5' },
  { selector: 'ptk-number-field[data-lift="bench"] input', value: '82.5' },
  { selector: 'ptk-number-field[data-lift="deadlift"] input', value: '175' },
];

/** The routes, and what has to happen before each is worth measuring. */
const ROUTES = [
  { path: '/', reveal: [], fill: [] },
  {
    path: '/platform-targets/',
    reveal: PLATFORM_TARGETS_REVEAL,
    fill: PLATFORM_TARGETS_FILL,
    settle: 'ptk-number-field[data-lift="total"] input',
  },
  {
    path: '/platform-targets/embed/uspa/',
    reveal: PLATFORM_TARGETS_REVEAL,
    fill: PLATFORM_TARGETS_FILL,
    settle: 'ptk-number-field[data-lift="total"] input',
  },
];

/** Kept in step with `--ptk-tap-target-min` in `packages/ui/src/tokens.css`. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page when a field takes focus. */
const MINIMUM_INPUT_FONT_SIZE = 16;

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

/**
 * Drives a route into the state worth measuring.
 *
 * Returns false, having recorded a failure, if any step could not be taken. A
 * selector that stops matching is treated as a failure rather than skipped:
 * these controls come from published data, so a silent skip is how the check
 * quietly stops checking the state it exists for while still reporting a pass.
 */
async function reveal(page, route, width, failures) {
  const where = `${String(width)}px ${route.path}`;

  for (const selector of route.reveal) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await control.check();
  }

  for (const { selector, value } of route.fill) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await field.fill(value);
  }

  if (route.settle !== undefined && !(await settled(page, route.settle))) {
    // The derived total is the last thing to appear, so an empty one means the
    // panel never re-rendered -- and a panel that never re-rendered is showing
    // placeholder-width text, which is not the layout at risk of overflowing.
    failures.push(`${where}: ${route.settle} never took a value`);
    return false;
  }

  return true;
}

/** Polls for a field to hold something, rather than trusting a fixed pause. */
async function settled(page, selector) {
  const field = page.locator(selector).first();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await field.count()) > 0 && (await field.inputValue()) !== '') {
      return true;
    }
    await page.waitForTimeout(20);
  }
  return false;
}

async function main() {
  try {
    await readFile(join(OUTPUT_DIRECTORY, 'index.html'));
  } catch {
    console.error('No site build found. Run `pnpm run build` first.');
    process.exitCode = 1;
    return;
  }

  const { server, origin } = await serveDirectory(OUTPUT_DIRECTORY);
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

        const reached = await reveal(page, route, width, failures);
        if (!reached) {
          await page.close();
          continue;
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
