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
 * The lift entry, which arrives folded.
 *
 * Requirement 11 put it out of the way, and a folded section measures the one
 * line it shows -- so without this the four fields and the unit control are
 * never looked at, and `fill` below could not reach them either, because
 * Playwright refuses to type into something that is not visible.
 */
const PLATFORM_TARGETS_CLICK = ['ptk-disclosure[label="Your lifts (optional)"] summary'];

/**
 * The three tile questions, which are the only ones that gate the report.
 *
 * Requirement 9: sex, equipment, one weight class and drug-tested status are
 * enough, and the weight class is a picker rather than a tile (see `choose`
 * below). Each selector answers the *first* option in its group, which is
 * enough -- the check is about layout, and the longest label in a group is
 * measured whether or not it is the one chosen.
 *
 * This list used to be eight long, and shrank because the screen did. The
 * records panel's own level, region and discipline questions are gone entirely:
 * requirements 3 and 4 replaced them with a report that shows every level and
 * every event at once. Region survives as an optional picker.
 */
const PLATFORM_TARGETS_REVEAL = [
  'ptk-choice-group[data-field="sex"] input',
  'ptk-choice-group[data-field="equipment"] input',
  'ptk-choice-group[data-field="tested"] input',
];

/**
 * The four pickers, answered by position rather than by value.
 *
 * By position because the options come from published data: a weight class
 * identifier is USPA's, not this file's, and pinning one here would make a
 * federation renaming a class look like a layout regression. Index 1 is the
 * first real option in every one of these -- index 0 is the placeholder that
 * clears the answer ("Not selected", "One class only", "Open only", "Every
 * state"), and choosing it would leave the picker unanswered.
 *
 * Order matters and is not arrangeable. The weight-class pickers have no
 * options at all until a sex category has been answered, which is why this runs
 * after `reveal` rather than beside it.
 *
 * All four are answered because the report widens with each: a second weight
 * class adds a column (requirement 8), a masters division adds a set of rows to
 * every cell (requirement 2), and a state adds a second level of record
 * (requirement 3). Answering only the required one would measure the narrowest
 * report the tool can draw and call the widest one covered.
 */
const PLATFORM_TARGETS_CHOOSE = [
  { selector: 'ptk-select[data-field="weightClass"] select', index: 1 },
  { selector: 'ptk-select[data-field="comparisonWeightClass"] select', index: 1 },
  { selector: 'ptk-select[data-field="division"] select', index: 1 },
  { selector: 'ptk-select[data-field="region"] select', index: 1 },
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

/**
 * What has to be tapped before the converter's dense sections exist.
 *
 * Both are folded on arrival and a folded section measures one line. The chart
 * fold matters most: its body is not merely hidden while closed, it is not
 * rendered at all (a copy button per row is several hundred elements), so with
 * it shut the check would measure a page with no table on it -- and a
 * two-column numeric table with a per-row action is the one layout here that
 * has a real chance of scrolling sideways at 320 px.
 *
 * The precision fold is opened too because the choice group inside it is the
 * widest set of radio labels the tool renders.
 */
const CONVERT_CLICK = [
  'ptk-disclosure[label="Result precision"] summary',
  'ptk-disclosure[label="Full conversion chart"] summary',
];

/**
 * A weight that lands between two published rows.
 *
 * 315 lb is three plates a side and is on no row of a chart indexed in 2.5 kg
 * steps, so the result panel renders its widest state: two neighbouring
 * options, each with a heading, a figure, the pair, a select button and a copy
 * button. An exact match would render one number and measure nothing.
 */
const CONVERT_FILL = [
  { selector: 'ptk-converter ptk-number-field[data-field="weight"] input', value: '315' },
];

/**
 * The estimator's one fold that exists before a set has been described.
 *
 * Seven optional questions, including the widest radio labels the tool renders
 * ("Experienced with singles", "New to maximal work") and a checkbox row. Folded
 * it is one line.
 */
const ONE_REP_MAX_CLICK = ['ptk-disclosure[label="Improve this estimate"] summary'];

/**
 * A set that produces the estimator's densest possible screen.
 *
 * Five reps rather than one: a single is observed rather than estimated, so it
 * renders no scenarios, no grade and no spread, and the check would measure the
 * short version of every panel. A weight off a round plate keeps the rounded
 * figures from coinciding with the entered one.
 */
const ONE_REP_MAX_FILL = [
  {
    selector: 'ptk-one-rep-max-calculator ptk-number-field[data-field="weight"] input',
    value: '142.5',
  },
  { selector: 'ptk-one-rep-max-calculator ptk-number-field[data-field="reps"] input', value: '5' },
];

/**
 * The two folds that do not exist until a set parses.
 *
 * Both `ptk-training-percentages` and `ptk-formula-comparison` render nothing at
 * all without an estimate, so their summaries cannot be pressed in `click` --
 * that list runs before `fill` and would report "nothing matched", which is a
 * true statement about a condition the check itself created. `clickAfter` runs
 * once the numbers exist, and these are the two densest sections on the screen:
 * a two-column numeric table with forty rows, and twenty formula cards each
 * carrying a name, a notation, a figure and a reason.
 */
const ONE_REP_MAX_CLICK_AFTER = [
  'ptk-disclosure[label="Training percentages"] summary',
  'ptk-disclosure[label="Every equation"] summary',
];

/**
 * The two last things to appear on the Platform Targets screen.
 *
 * Two rather than one, because the screen has two panels that finish at
 * different moments and neither implies the other. The derived total fills in
 * once the three lifts above it parse; a report row exists only once both the
 * classification standards and at least one record partition have arrived and
 * been laid out against the chosen classes. Settling on the total alone would
 * measure a report still showing its loading notice, which is a fraction of the
 * height of the one with ladders on it.
 *
 * A row rather than a record figure. Every row -- classification rung or record
 * -- is the same `li.row`, and which of the two a given category has is a fact
 * about published data: the first option in every picker is a real category the
 * federation may publish no record for, so waiting for a record specifically
 * would be waiting for something correct data does not have to produce. The
 * widest string a record row renders, the holder line, is measured at 320 px in
 * `ptk-target-report.browser.test.ts` instead, where the book is a fixture.
 */
const PLATFORM_TARGETS_SETTLE = [
  'ptk-number-field[data-lift="total"] input',
  'ptk-target-report li.row',
];

/**
 * The hub's one fold: how to install the toolkit.
 *
 * Shut it is a single row and measures nothing. Open it is two sentences naming
 * four separate menu items, which is the longest unbroken prose the hub renders
 * and the only thing on it with a real chance of overflowing a 320px column.
 */
const HUB_CLICK = ['ptk-disclosure[label="Install the toolkit"] summary'];

/** The routes, and what has to happen before each is worth measuring. */
const ROUTES = [
  { path: '/', click: HUB_CLICK, reveal: [], fill: [] },
  {
    path: '/platform-targets/',
    click: PLATFORM_TARGETS_CLICK,
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: PLATFORM_TARGETS_FILL,
    settle: PLATFORM_TARGETS_SETTLE,
  },
  {
    path: '/platform-targets/embed/uspa/',
    click: PLATFORM_TARGETS_CLICK,
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: PLATFORM_TARGETS_FILL,
    settle: PLATFORM_TARGETS_SETTLE,
  },
  {
    path: '/warm-up/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    // The checklist rows, not the field just typed into: a filled field says the
    // keystroke landed, which it did before the plan was computed. A row exists
    // only once the ramp has been worked out and rendered.
    settle: ['ptk-lift-card li'],
  },
  {
    path: '/warm-up/embed/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    settle: ['ptk-lift-card li'],
  },
  {
    path: '/convert/',
    click: CONVERT_CLICK,
    reveal: [],
    fill: CONVERT_FILL,
    // An option card, not the field just typed into: a filled field says the
    // keystroke landed, which it did before the chart was consulted. A card
    // exists only once a published row has been found to offer.
    settle: ['ptk-conversion-result li'],
  },
  {
    path: '/convert/embed/uspa/',
    click: CONVERT_CLICK,
    reveal: [],
    fill: CONVERT_FILL,
    settle: ['ptk-conversion-result li'],
  },
  {
    path: '/one-rep-max/',
    click: ONE_REP_MAX_CLICK,
    reveal: [],
    fill: ONE_REP_MAX_FILL,
    clickAfter: ONE_REP_MAX_CLICK_AFTER,
    // A rendered formula row, not the field just typed into: a filled field says
    // the keystroke landed, which it did before any equation ran. A card exists
    // only once the ensemble has been computed.
    settle: ['ptk-formula-comparison li'],
  },
  {
    path: '/one-rep-max/embed/',
    click: ONE_REP_MAX_CLICK,
    reveal: [],
    fill: ONE_REP_MAX_FILL,
    clickAfter: ONE_REP_MAX_CLICK_AFTER,
    settle: ['ptk-formula-comparison li'],
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

    // Not rendered, so there is nothing to measure and a 0x0 box would be
    // reported as a tap target too small to hit.
    //
    // Asked as "does it generate a box" rather than "is its own display none",
    // which is what this used to ask and which only ever looked at the element
    // itself. An element inside a hidden ancestor still computes its own
    // display -- a hidden \`ptk-button\` renders a real \`<button>\` inside a host
    // the page has hidden, and that button computes \`inline-flex\`, measures
    // 0x0, and failed the check for existing. Crossing a shadow boundary makes
    // no difference here: boxes are generated over the flat tree.
    //
    // \`visibility\` stays a separate question. A visibility-hidden element does
    // generate a box, and it inherits, so this catches a hidden ancestor too.
    if (element.getClientRects().length === 0) continue;
    if (style.visibility === 'hidden') continue;

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
 * Presses a list of things, failing on anything that is not there.
 *
 * Shared by `click` and `clickAfter` so the two lists cannot drift into
 * disagreeing about what a missing selector means. It means the same thing in
 * both: a failure, never a skip.
 *
 * @param {import('playwright').Page} page
 * @param {readonly string[]} selectors
 * @param {string} where
 * @param {string[]} failures
 * @returns {Promise<boolean>}
 */
async function tap(page, selectors, where, failures) {
  for (const selector of selectors) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await control.click();
  }
  return true;
}

/**
 * Answers a list of pickers by position, failing on anything that is not there.
 *
 * By position rather than by value because the options are published data: the
 * identifiers on the deployed site belong to a federation, and naming one here
 * would make a renamed weight class arrive as a layout regression in a file that
 * has nothing to do with the change. Index 1 is the first real option in every
 * picker this drives -- index 0 clears the answer.
 *
 * A picker with too few options fails rather than falling back to whatever it
 * has. `selectOption({ index })` on an absent index resolves against nothing and
 * leaves the placeholder selected, so the check would go on to measure a report
 * that was never drawn while reporting a pass on it -- the same silent-skip
 * failure the unmatched-selector rule exists to prevent, arriving one level down.
 *
 * @param {import('playwright').Page} page
 * @param {readonly {selector: string, index: number}[]} pickers
 * @param {string} where
 * @param {string[]} failures
 * @returns {Promise<boolean>}
 */
async function pick(page, pickers, where, failures) {
  for (const { selector, index } of pickers) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    const options = await control.locator('option').count();
    if (options <= index) {
      failures.push(
        `${where}: ${selector} offers ${String(options)} options, so index ${String(index)} cannot be chosen`,
      );
      return false;
    }
    await control.selectOption({ index });
  }
  return true;
}

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
  if (!(await tap(page, route.click ?? [], where, failures))) return false;

  for (const selector of route.reveal) {
    const control = page.locator(selector).first();
    if ((await control.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await control.check();
  }

  // Pickers after tiles, and not arrangeable the other way round: a weight class
  // list is empty until a sex category has been answered above, so a picker
  // driven first would be a select with one placeholder in it.
  if (!(await pick(page, route.choose ?? [], where, failures))) return false;

  for (const { selector, value } of route.fill) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await field.fill(value);
  }

  // Folds that do not exist until the fields above have been answered. The
  // estimator's percentage table and formula comparison render nothing at all
  // without an estimate, so pressing them in `click` would report "nothing
  // matched" -- a true statement about a state the check itself produced, and
  // one that would push somebody to weaken the unmatched-selector failure into
  // a skip, which is the thing that makes this file stop checking.
  if (!(await tap(page, route.clickAfter ?? [], where, failures))) return false;

  // A list, because a screen can have more than one panel that finishes at its
  // own moment and neither one implies the other. Waiting on the earlier of two
  // measures the later one mid-render -- placeholder-width text, which is not
  // the layout at risk of overflowing.
  for (const selector of route.settle ?? []) {
    if (!(await settled(page, selector))) {
      failures.push(`${where}: ${selector} never took a value`);
      return false;
    }
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
