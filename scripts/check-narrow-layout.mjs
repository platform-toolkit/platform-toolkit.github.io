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

/**
 * What has to be tapped before the warm-up calculator has anything on it.
 *
 * The equipment section and the plate details are folded shut on arrival, and a
 * folded section measures nothing -- the plate grid, the pair counts and the
 * full-diameter switches are all inside them, and they are the densest part of
 * the screen. Adding a lift is what produces a card and therefore a ramp; with
 * no lift on the list the page is two folds and a sentence.
 *
 * The order is not arrangeable: the plate details live inside the equipment
 * section and do not exist in the DOM until it is open. Each fold is named by
 * its label rather than by position, because `.first()` over a bare
 * `ptk-disclosure` picks whichever one the template happens to render first --
 * so adding a fold above the equipment section would silently open that instead
 * and leave the dense part of the screen folded and unmeasured.
 */
const WARM_UP_CLICK = [
  'ptk-disclosure[label="Equipment"] summary',
  'ptk-disclosure[label="Plate details"] summary',
  'ptk-button[accessible-name="Add Squat"]',
];

/**
 * A working weight, so the card renders a full ramp rather than one sentence.
 *
 * An invented figure that lands off a round plate on purpose: it produces the
 * longest change lines the checklist ever prints ("take off X, add Y per side"),
 * which is the row most likely to overflow a 320px column.
 */
const WARM_UP_FILL = [
  { selector: 'ptk-lift-card ptk-number-field[data-field="weight"] input', value: '102.5' },
];

/** The routes, and what has to happen before each is worth measuring. */
const ROUTES = [
  { path: '/', click: [], reveal: [], fill: [] },
  {
    path: '/platform-targets/',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    fill: PLATFORM_TARGETS_FILL,
    settle: 'ptk-number-field[data-lift="total"] input',
  },
  {
    path: '/platform-targets/embed/uspa/',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    fill: PLATFORM_TARGETS_FILL,
    settle: 'ptk-number-field[data-lift="total"] input',
  },
  {
    path: '/warm-up/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    // The checklist rows, not the field just typed into: a filled field says the
    // keystroke landed, which it did before the plan was computed. A row exists
    // only once the ramp has been worked out and rendered.
    settle: 'ptk-lift-card li',
  },
  {
    path: '/warm-up/embed/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    settle: 'ptk-lift-card li',
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
 * A radio or checkbox inside a wrapping label is skipped: the label is the
 * target, the box is a glyph within it, and the browser routes a tap on either
 * to the same control. Flagging it would be a false positive nobody could fix.
 * The label is measured in its place, which is why the exemption and the control
 * list are keyed to the same `label:has(input)` -- keyed to a class name instead,
 * as this once was, a new component's differently-named row exempts its own
 * checkbox and contributes no target of its own, so the row is not measured at
 * all and the check reports a pass over a screen it never looked at.
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
      if (element.matches('a, button, input, select, textarea, [role="button"], label:has(input)')) {
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

    const isGlyphInTile = element.tagName === 'INPUT' && element.closest('label:has(input)') !== null;
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

  // Taps come first and are separate from the checks below because they are a
  // different kind of act: opening a fold or pressing a button, rather than
  // answering a question. Playwright's `check` refuses anything that is not a
  // checkbox or a radio, so a folded section could not be opened at all without
  // this list -- and a folded section is measured as the one line it shows.
  for (const selector of route.click ?? []) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await control.click();
  }

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

/**
 * Polls for the render that matters, rather than trusting a fixed pause.
 *
 * A field has to hold a value; anything else only has to exist. Those are the
 * same question asked of the two kinds of thing that can answer it -- a derived
 * total is present from the start and fills in later, while a checklist row does
 * not exist at all until the plan behind it has been worked out. Requiring a
 * value from the second kind would mean settling on the field just typed into,
 * which reports success the moment the keystroke lands and before anything has
 * been calculated from it.
 */
async function settled(page, selector) {
  const target = page.locator(selector).first();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await target.count()) > 0) {
      // `tagName` rather than `instanceof HTMLInputElement`. This callback is
      // serialised and run inside the page, but it is *written* in a Node module
      // where the DOM constructor is not a binding at all -- so the reference
      // reads as an undefined variable to anything analysing this file, and the
      // two contexts are not distinguishable from here.
      const isField = await target.evaluate((node) => node.tagName === 'INPUT');
      if (!isField || (await target.inputValue()) !== '') {
        return true;
      }
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
      for (const route of ROUTES) {
        // A context per route, not per width, because these tools remember
        // things. Every route on this site is one origin, so one context shared
        // across them carries the equipment and the lifts added on the previous
        // route into the next one -- and the next route's `click` list then
        // misses, because the button that read "Add Squat" now reads "Squat,
        // already on the list". Which is a genuine failure report about a
        // condition the check itself created.
        //
        // Touch and a device pixel ratio, not just a narrow window: a phone is
        // what is being stood in for, and `isMobile` is what makes the viewport
        // behave like one rather than like a very small desktop.
        const context = await browser.newContext({
          viewport: { width, height: 720 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        await page.goto(origin + route.path, { waitUntil: 'networkidle' });

        const reached = await reveal(page, route, width, failures);
        if (reached) {
          for (const problem of await page.evaluate(MEASURE)) {
            failures.push(`${String(width)}px ${route.path}: ${problem}`);
          }
          measured += 1;
        }

        await context.close();
      }
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
