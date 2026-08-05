#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
 * Four blunt properties, each one a failure a screenshot does not show:
 *
 *   - nothing scrolls sideways
 *   - nothing is clipped out of existence by an ancestor that hides its overflow
 *   - everything interactive is at least the tap-target minimum in both axes
 *   - no text-entry control is under 16px, which is the size below which iOS
 *     Safari zooms the page on focus and the layout jumps under a thumb
 *
 * Anything about how a screen *reads* belongs in a story, where a person looks
 * at it. This is only for the things a person will not notice until it is live.
 *
 * AND AT WHAT TEXT SIZE
 *
 * All four again with the text at 200%, which is WCAG 1.4.4 and is not the same
 * question as a narrow viewport. A layout can survive 320px by wrapping and then
 * fail at 200% because one box was given a height in pixels and the words inside
 * it were not -- and the reader who set 200% is the reader least able to notice
 * that the sentence now stops mid-word.
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
 * How much wider than the requirement the last pass is, and why there is one.
 *
 * 200% is the requirement. 220% is margin, and the margin exists because this
 * check is a *measurement* and the thing it measures is not the same on every
 * machine. Fonts are not: the runner's Linux faces set the same sentence wider
 * than this laptop's do, by something in the region of a tenth. Three deploys
 * have now failed on a layout that cleared 320px here and did not there --
 * `ptk-conversion-table` at 326px, `/one-rep-max/` at 341px, and the warm-up
 * card at 350px -- and each time the local run before the push said pass.
 *
 * So the last pass is not a stricter standard anybody has to design to. It is
 * the same standard asked with enough slack that clearing it here means
 * clearing it there. A failure that appears only in this pass is not a bug in
 * the layout at 220%; it is a warning that the layout has no room left at 200%.
 *
 * Do not raise it further to chase a stubborn screen. Past about 250% a 320px
 * column genuinely cannot hold two words of English, and the failures stop
 * being about margin and start being about arithmetic.
 */
const HEADROOM_SCALE = 2.2;

/**
 * A text scale as a percentage, rounded.
 *
 * `2.2 * 100` is `220.00000000000003` in binary floating point, and a check
 * whose passing line reads like that invites somebody to go looking for the bug
 * that is not there.
 *
 * @param {number} scale
 * @returns {string}
 */
function percent(scale) {
  return String(Math.round(scale * 100));
}

/**
 * The passes worth running, each one a viewport width and a text size.
 *
 * 320 is the narrowest phone still in service and also narrower than most
 * third-party embed columns, so it covers both. 390 is a current handset, and
 * catches the case where a rule keyed to the smallest size stops applying just
 * above it.
 *
 * The third pass is 320px again with the text at 200%, and it is deliberately
 * the narrow width rather than the roomy one. A reader who has doubled their
 * text has not bought a wider phone, so 320px at 200% is the combination they
 * actually hold -- and running 390px at 200% instead would be measuring a
 * screen with 70px of slack that the reader who needs this does not have.
 *
 * 430 is the top of the range the review asks for (320-430) and the widest
 * current handset. It was left out of an earlier version of this list on the
 * argument that nothing here is keyed to a viewport media query (§5.7:
 * container queries only) so another width would measure the same layout again.
 * That argument is wrong, and the way it is wrong is worth keeping: the house
 * layout primitive is `repeat(auto-fit, minmax(min(100%, VAR), 1fr))`, and
 * auto-fit resolves the column *count* from the element's own width. A grid
 * that is one column at 390 is two at 430, which is a different arrangement
 * with its own ways to clip -- and it is the arrangement most phones in a gym
 * are actually showing.
 *
 * 320 is also, exactly, WCAG 1.4.10 reflow: 1280px at 400% zoom is 320 CSS px.
 * Do not add a separate 400%-zoom pass to cover that. Chromium's page zoom
 * scales the viewport as well, so it would measure a 160px layout that no
 * reader has, and 1.4.10 is already answered by the pass above.
 *
 * The fifth pass is the same 320px column past the requirement, at
 * `HEADROOM_SCALE`. It is margin against the runner's wider fonts rather than a
 * standard of its own -- see the constant.
 */
const PASSES = [
  { width: 320, textScale: 1 },
  { width: 390, textScale: 1 },
  { width: 430, textScale: 1 },
  { width: 320, textScale: 2 },
  { width: 320, textScale: HEADROOM_SCALE },
];

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
 * class adds a column to every matrix (requirement 8), an age division adds a
 * second row to every block (requirement 2), and a state adds a level of record
 * (requirement 3). Answering only the required one would measure the narrowest
 * report the tool can draw and call the widest one covered.
 *
 * The comparison class is index **2**, and that is the whole point of it. Both
 * pickers offer the same ladder, so index 1 in both names one class twice --
 * which `chosenWeightClasses` deduplicates through a `Set`, exactly as it should
 * for a lifter who picked their own class in both. The check then measured a
 * one-column matrix in a list whose comment claimed it was measuring two.
 */
const PLATFORM_TARGETS_CHOOSE = [
  { selector: 'ptk-select[data-field="weightClass"] select', index: 1 },
  { selector: 'ptk-select[data-field="comparisonWeightClass"] select', index: 2 },
  { selector: 'ptk-select[data-field="division"] select', index: 1 },
  { selector: 'ptk-select[data-field="region"] select', index: 1 },
];

/**
 * The setup screen is finished when its action has stopped being disabled.
 *
 * Which is the only observable that says all four required answers registered.
 * Every other candidate is true too early: the pickers exist before they are
 * answered, and the action itself exists from the first paint -- disabled, and
 * carrying a different set of styles from the one a lifter presses. Measuring
 * then would report on a bar in a state the screen only passes through.
 *
 * `:not([disabled])` works because `ptk-button` reflects the property, which is
 * a fact about that element rather than about Lit -- a non-reflecting property
 * would leave this selector matching from the start and the wait would measure
 * nothing.
 */
const PLATFORM_TARGETS_SETUP_SETTLE = [
  'ptk-target-categories ptk-button[data-action="apply"]:not([disabled])',
];

/**
 * Weights typed into the lift fields, which exist only after "Show targets".
 *
 * In `fillAfter` rather than `fill` for the same reason the record cell is in
 * `clickAfter`: the setup screen has no lift entry on it at all, so a `fill`
 * entry naming one would report "nothing matched" -- a true statement about a
 * state the check itself created.
 *
 * Three component lifts and no total, so the fourth field fills itself and the
 * derived-total sentence -- the longest string the panel ever renders -- is on
 * screen when the measurement runs. A blank panel would measure the placeholder
 * layout, which is not the one that overflows.
 *
 * The figures are invented. Nothing here compares them against anything.
 */
const PLATFORM_TARGETS_FILL_AFTER = [
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
 * The adjust fold, which cannot be opened until there is a ramp to adjust.
 *
 * `#renderAdjust` returns nothing while no set can be moved, so this fold does
 * not exist in the DOM until a working weight has been typed -- which is why it
 * is a `clickAfter` rather than another entry in `WARM_UP_CLICK`. What is inside
 * it is the densest row in the tool: a weight, a unit, a "Your weight" mark and
 * two 44px steppers on one line, per warm-up set, in a 320px column. The
 * checklist above it wraps freely; this row cannot, so it is the first thing
 * here that scrolls sideways.
 *
 * Named by label like the two folds above, and for the same reason -- the card
 * draws a second disclosure for the bar, and `.first()` over a bare
 * `ptk-disclosure` would open that one and leave this measured shut.
 *
 * **This press is not what makes those rows measurable, and the tempting comment
 * saying it is would be false.** Unlike `CONVERT_CLICK`'s chart fold -- which
 * renders no body at all while closed, so the press genuinely conjures the
 * table -- this one is a native `<details>` whose contents are always in the
 * DOM, and Chromium lays out the contents of a shut `<details>`. Measured on the
 * built site: a stepper reports one client rect and the same 44.22 x 44 box
 * before and after the summary is pressed, differing only in `y`. So the two
 * obvious ways to prove this step non-vacuous both fail to bite -- a `settle`
 * selector inside the fold matches either way because `count()` asks about
 * attachment, and raising `TAP_TARGET_MIN` names the steppers either way because
 * `MEASURE` skips only what has no client rects. Removing the press produced
 * byte-identical output.
 *
 * It is kept for the two things it does do. `tap` fails with "nothing matched"
 * rather than skipping, so the entry asserts that the fold still exists and is
 * still called this -- which is how it was proven non-vacuous: renaming the
 * label here produced one failure per warm-up route per width, eight in all. And
 * it makes the measurement independent of an engine behaviour that is not
 * guaranteed; the day an engine stops laying out shut-fold contents, the press
 * is what keeps these rows measured instead of silently dropping them.
 */
const WARM_UP_CLICK_AFTER = ['ptk-disclosure[label="Adjust the warm-up weights"] summary'];

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
 * The federation, and the fold holding everything §8 asks for.
 *
 * The federation answer is a `click` on a label rather than a `reveal` entry on
 * the radio, and it is the one place in this file where that distinction is
 * load-bearing rather than stylistic. `reveal` asks `count()`, which is an
 * instantaneous question, and this control does not exist until a published
 * rule book has been read over the network -- so a `reveal` entry here would
 * report "nothing matched" on a cold cache and pass on a warm one. `tap` waits
 * for attachment, which is the same wait `settle` performs at the other end of
 * the route. Clicking the label rather than the input is what §5.7's tap-target
 * rule already assumes: the label *is* the target.
 *
 * `.first()` picks whichever federation the corpus publishes first, on purpose.
 * Naming one would put a federation identifier in a layout check, and a renamed
 * profile would then arrive as a layout regression (the `pick` rule, one control
 * type across).
 *
 * The plan cannot be drawn at all without this answer -- the attempt increments
 * come from the profile -- so without it the route would measure a page of
 * questions and none of the output.
 */
const MEET_DAY_CLICK = [
  'ptk-choice-group[data-field="federation"] label',
  'ptk-disclosure[label="Improve my plan"] summary',
];

/**
 * Three maximums, which is the least that produces a full nine-attempt plan.
 *
 * Invented figures (§5.1), and deliberately not round ones: every attempt is
 * rounded to the profile's bar multiple, so round inputs would hide the rounding
 * note that sits under an attempt and shorten the longest line on the card.
 * Different per lift, because the three cards are laid out side by side above a
 * certain width and identical figures would make a column-width difference
 * invisible.
 */
const MEET_DAY_FILL = ['squat', 'bench', 'deadlift'].map((lift, index) => ({
  selector: `ptk-number-field[data-field="expected-maximum"][data-lift="${lift}"] input`,
  value: ['192.5', '117.5', '227.5'][index],
}));

/**
 * The three agreements, without which there is no plan on the page at all.
 *
 * In `clickAfter` and not in `reveal` for a reason particular to this tool
 * rather than for the ordering reason the estimator's folds have: `reveal` runs
 * *before* `fill`, and typing a maximum withdraws that lift's agreement
 * (`withFigures`, and §7's gate behind it). Ticked first, all three would be
 * cleared by the very next step and the check would measure the questions with
 * the plan missing -- while passing, because nothing here asserts that a plan
 * appeared. The `settle` entry below is the other half of that guard.
 *
 * The label rather than the checkbox inside it, so that the row is pressed the
 * way a thumb presses it.
 */
const MEET_DAY_CLICK_AFTER = ['squat', 'bench', 'deadlift'].map(
  (lift) => `ptk-toggle-group[data-field="confirm"][data-lift="${lift}"] label`,
);

/**
 * A lifter's name, which is the last thing between a plan and a platform.
 *
 * In `fillAfter` rather than `fill` because the field does not exist until the
 * three agreements above have drawn a *complete* plan -- §14's start panel shows
 * a sentence about needing one until then, and typing into a sentence fails.
 *
 * Invented, like every other figure here (§5.1), and one word rather than a
 * long name: the name is echoed into the live screen's header, so a deliberately
 * wide one would measure a string this check chose rather than the layout.
 */
const MEET_DAY_FILL_AFTER = [
  { selector: 'ptk-text-field[data-field="lifter-name"] input', value: 'Quintero' },
];

/**
 * Start the meet, which is the only way to reach the live screen at all.
 *
 * The native control inside the host rather than the host itself, so that a
 * button still disabled at this point fails the run as an unclickable element
 * rather than swallowing the press on the host's padding and leaving the settle
 * below to report the absence of a screen nobody tried to open.
 */
const MEET_DAY_CLICK_LAST = ['section.start ptk-button button'];

/**
 * One attempt taken from unchosen to recorded, which is five presses (§12, §13).
 *
 * Choose the offered weight, mark it handed in so the bar is on the platform,
 * answer what happened, answer how it felt, record. The two middle presses are
 * one question each and neither can be skipped: the result controls appear only
 * while an attempt is on the platform (§13.9's one-workspace rule), and Record
 * is disabled until a good lift has an effort reading beside it.
 *
 * "Good lift" rather than "Passed", which would be two presses instead of five
 * and is the obvious economy. A meet of nine passes finishes just as well and
 * summarises a lifter who bombed all three lifts -- no weight on any attempt
 * row, no total, and §26's widest lines replaced by the sentences that stand in
 * for them. That is a real screen and not the one worth measuring; the cost of
 * measuring the full one is two presses an attempt.
 *
 * A choice card is named by `data-slot` rather than by position, because that is
 * the attribute §13.7 put on it so that a caller need not depend on order -- but
 * `.first()` still decides which of the three, and deliberately so: any legal
 * weight finishes the attempt, and pinning a slot here would make a change to
 * which slots are offered arrive as a layout regression.
 *
 * The outcome and effort tiles are named by the value inside them, the way the
 * mode tile is, and the two are not equally load-bearing. `good` is: choosing
 * anything else changes which follow-up question is asked, and the effort
 * selector below would then report "nothing matched" -- loudly, which is right.
 * `solid` is not: every reading finishes the attempt, so the value is named only
 * because there is no shorter way to say "one of them".
 *
 * The native control inside each host, for the reason Start is pressed that way.
 */
const MEET_DAY_ATTEMPT_CLICK = [
  'ptk-live-choices ptk-button[data-slot] button',
  'ptk-submission-countdown section.panel > ptk-button button',
  'ptk-attempt-result ptk-choice-group[data-field="outcome"] label:has(input[value="good"])',
  'ptk-attempt-result ptk-choice-group[data-field="effort"] label:has(input[value="solid"])',
  'ptk-attempt-result div.card > ptk-button button',
];

/** Three lifts, three attempts each, which is the whole of a full-power meet. */
const ATTEMPTS_IN_A_MEET = 9;

/**
 * Start the meet and then run it to the end, which is the only way to reach §26.
 *
 * Forty-six presses, and there is no shorter road: `recordResult` resolves the
 * attempt it names and nothing else, so the meet is over after the ninth result
 * and not before. Written as a repeat of one sequence rather than as a literal
 * list, so that a change to the result flow is one edit here instead of nine.
 */
const MEET_DAY_FINISHED_CLICK_LAST = [
  ...MEET_DAY_CLICK_LAST,
  ...Array.from({ length: ATTEMPTS_IN_A_MEET }, () => MEET_DAY_ATTEMPT_CLICK).flat(),
];

/**
 * Open §22's fold, which sits under the Start button on the planning screen.
 *
 * In `clickLast` rather than `clickAfter` only because the plan above it has to
 * be drawn first for the two settle selectors below to mean anything in order;
 * the fold itself is on screen from the first paint.
 *
 * Named by `.prep` and not by `ptk-disclosure`, which the plan screen also uses:
 * a bare tag selector is correct until a second fold is added above this one,
 * and then it opens something else while the run goes on passing, because what
 * it opened is also a real fold (§13.11's `class="back"`, for the same reason).
 *
 * What the press buys is not that the boxes below become measurable -- Chromium
 * lays out the contents of a shut `<details>`, so they are measured either way,
 * and `apps/web/CLAUDE.md` records the measurements that show it. It buys a live
 * assertion that the fold still exists under that class, and independence from
 * an engine behaviour nothing guarantees. Prove it by renaming the selector.
 */
const MEET_DAY_PREP_CLICK = ['ptk-disclosure.prep summary'];

/**
 * Open §20's fold, which sits between the Start button and §22's.
 *
 * Named by `.warmup` for the reason the one above is named by `.prep`, and the
 * two together are why neither may be a bare `ptk-disclosure`: this screen now
 * carries two folds at the same level and a tag selector opens whichever the
 * template puts first, which is this one. The same collision already cost a
 * debugging pass in the browser tests, where `prepFold` was silently reading
 * the warm-up fold.
 *
 * Nothing inside is conjured by the press -- Chromium lays out the contents of
 * a shut `<details>`, and `apps/web/CLAUDE.md` records the measurements -- so
 * this buys a live assertion that the fold still exists under that class. Prove
 * it by renaming the selector, never by measurement.
 *
 * The two folds *inside* this one, holding the per-set weights and the room
 * preferences, are deliberately not pressed. They carry no class of their own,
 * so a press would have to name them by position, which is the mistake the two
 * classes above exist to prevent -- and by the same engine behaviour their rows
 * are measured shut.
 */
const MEET_DAY_WARMUP_CLICK = ['ptk-disclosure.warmup summary'];

/**
 * Show the printable sheet (§23), which both meet-day screens carry.
 *
 * Unlike every other press in this file, this one really is what puts the rows
 * on the page: a shut sheet is `display: none` in the root's own styles rather
 * than a folded `<details>`, so it generates no box at all and `MEASURE` skips
 * it -- `ptk-meet-day-planner.browser.test.ts` asserts exactly that computed
 * value. So the sheet would otherwise be the one panel in the tool that ships
 * unmeasured, which matters more here than anywhere else: it is the widest thing
 * either screen draws (a twelve-lifter roster is a name, an identifier, a
 * handler and nine cells across, and the single-lifter sheet carries the
 * longest labels in the tool over a written-on line).
 *
 * The native control inside the host, for the reason Start is pressed that way.
 *
 * Named by `section.pack` and not by the element inside it because the two
 * screens hang different sheets off the same section -- one selector drives both
 * routes, and a sheet moved out of that section fails here rather than quietly
 * going unmeasured. Prove it by renaming the selector; measurement cannot say
 * whether the press ran, because a sheet that fits contributes no finding
 * either way.
 */
const MEET_DAY_PACK_CLICK = ['section.pack ptk-button button'];

/**
 * Name a meet and start saving into it, so §24's shelf has a row on it.
 *
 * The shelf is on screen from the first paint of either planning screen, but an
 * empty one is a heading, two buttons and a sentence saying there is nothing
 * here -- and the row is where the width actually goes: a meet name a lifter
 * typed, the date it was saved, and five controls under it (Open, Rename,
 * Duplicate, Archive, Delete). Settling on the element rather than on a row
 * would measure the empty state at every width and report the shelf as clear.
 *
 * The fill and the press are in `fillAfter` and `clickLast` rather than earlier
 * because both routes reach §24 below the plan, and the plan has to be drawn
 * before the presses above these run in the order their own comments describe.
 * Nothing about §24 needs the plan -- naming a meet is deliberately available
 * before there is anything to save (§24.1) -- so this is a sequencing
 * convenience, not a dependency, and that is worth saying because the opposite
 * reading would make a reordering here look safe.
 *
 * Unlike Start, the press is on the host and not the native control inside it:
 * the Create button carries no `disabled`, so there is no state for the inner
 * selector to catch, and a name-shaped press on a host is what the element's own
 * tests do.
 */
const MEET_DAY_SHELF_FILL = [
  { selector: 'ptk-text-field[data-field="meet-name"] input', value: 'County Open' },
];

const MEET_DAY_SHELF_CLICK = ['section.naming ptk-button'];

/**
 * §6.1's other branch, then the rule book the meet is created against.
 *
 * The mode tile is named by the value inside it rather than by `.first()`, which
 * is the one place in this file a control is picked by identity: the two options
 * are two different screens, and taking whichever the template happens to put
 * first would measure the solo path twice while reporting a coach route. The
 * value is `mode`'s own vocabulary and not published data, so the `pick` rule --
 * never name a published identifier -- does not reach it.
 *
 * The federation press comes second because the question does not exist until
 * the branch is taken: the coach path draws its own setup panel.
 */
const MEET_DAY_COACH_CLICK = [
  'ptk-choice-group[data-field="mode"] label:has(input[value="coach"])',
  'ptk-choice-group[data-field="federation"] label',
];

/**
 * One lifter's name, which is what creates the meet document (§21).
 *
 * One rather than a flight of eight: every row is the same row, so a longer list
 * measures the same widest line more times, and this is already the slowest
 * route in the file. Invented (§5.1) and one word, for the reason the solo
 * route's is -- the name is echoed onto the board, so a deliberately wide one
 * would measure a string this check chose rather than the layout.
 */
const MEET_DAY_COACH_FILL = [
  { selector: 'ptk-text-field[data-field="roster-name"] input', value: 'Quintero' },
];

/** Add, which is the press that turns a name into a board. */
const MEET_DAY_COACH_CLICK_AFTER = ['ptk-coach-roster .add ptk-button button'];

/**
 * The lifter's own fold, then §21.3's Add a handler inside it.
 *
 * The fold's contents are laid out whether or not it is open -- Chromium lays
 * out the contents of a shut `<details>`, which is why `apps/web/CLAUDE.md` says
 * a press-style step cannot be proven by measurement -- so the first press buys
 * the live assertion that a row still renders a fold, not the measurement.
 *
 * The second one is different, and is the reason this is now two steps: a
 * handler's three controls do not exist until somebody has been added. Seven
 * responsibility tiles and a remove button naming the handler are the widest
 * things in the fold, and a roster with nobody helping anybody renders none of
 * them -- so without this press the coach route measures the empty sentence that
 * stands in for them and reports a clean pass on the part nobody reached.
 */
const MEET_DAY_COACH_CLICK_LAST = [
  'ptk-coach-roster ptk-disclosure summary',
  'ptk-coach-roster [data-field="roster-handler-add"] button',
];

/**
 * Add a lifter, then open their own screen off the board (§21, §20).
 *
 * Named by `.open` rather than by the first `ptk-button` in a row, for the
 * reason §13.11 put `class="back"` on the way out of live mode: a row carries a
 * fold, a swatch and whatever §21.3 has added to it, and a bare tag selector is
 * correct until one of those renders a control above this one -- at which point
 * the run goes on passing, because what it pressed is also a real button.
 *
 * The native control inside the host, the way Start is pressed: a press that
 * lands on the host's own padding is swallowed, and the settle below would then
 * report the absence of a screen nobody tried to open.
 */
const MEET_DAY_COACH_LIFTER_CLICK_AFTER = [
  ...MEET_DAY_COACH_CLICK_AFTER,
  'ptk-coach-board ptk-button.open button',
];

/**
 * An opener for the lifter now on screen, typed rather than chosen.
 *
 * §13.17 records why there is nothing to press instead: a lifter opened off the
 * board has no plan behind them, so `liveChoicesFor` offers no cards and §13.7's
 * "fourth thing on the list" is the only way through an attempt on this path.
 *
 * It is also what gives §20's fold a ramp. The coach path reads the opener off
 * the document's first competition attempt, so until this is typed the fold
 * draws §20.1's estimate and no sets at all -- and the two settle selectors
 * below, which are the widest lines the fold has, would measure nothing.
 *
 * A round figure, unlike every other invented weight in this file (§5.1), and
 * the exception is deliberate: this weight is declared rather than planned, so
 * nothing rounds it onto the profile's grid and an increment the corpus happens
 * to publish would refuse it outright. There is no rounding note to expose here
 * and a refusal would take the ramp off the screen, so the robust figure is the
 * one that is legal under any bar multiple a federation could publish.
 */
const MEET_DAY_COACH_LIFTER_FILL_AFTER = [
  { selector: 'ptk-live-choices ptk-number-field[data-field="other-weight"] input', value: '140' },
];

/**
 * Declare the typed weight, then open §20's fold over it.
 *
 * The press is on the native control for the reason Start is: it is disabled
 * until the field above holds a number, so a press swallowed by the host would
 * leave the attempt unchosen and the failure would arrive as a missing ramp
 * rather than as an unclickable button.
 *
 * The fold press buys the same thing it buys on the plan route and no more --
 * Chromium lays out the contents of a shut `<details>`, so prove it by renaming
 * the selector and never by measurement.
 */
const MEET_DAY_COACH_LIFTER_CLICK_LAST = [
  'ptk-live-choices div.other ptk-button button',
  ...MEET_DAY_WARMUP_CLICK,
];

/**
 * The report shows one lift and one target type at a time, so the widest thing
 * on it has to be navigated to before it can be measured.
 *
 * These run in `clickAfter` rather than `click` because none of them exists
 * until the four required answers have been given and the reads behind them have
 * landed -- pressing them in `click` would report "nothing matched", a true
 * statement about a state the check itself produced, and the pressure that
 * follows is to weaken the unmatched-selector failure into a skip.
 *
 * What each reaches, in order:
 *
 * - **"Show targets"**, which is what replaces the setup screen with the report.
 *   Since the three-phase rebuild there is no report on the page until this is
 *   pressed, so every selector below it names something that does not exist yet.
 *   It is a press rather than a step of its own because that is what it is: the
 *   lifter's own commitment, and the check should reach the report the way they
 *   do rather than through a back door the product does not have.
 * - The **records** half. Classifications open by default and are the narrower
 *   of the two: a record cell carries a disclosure caret beside its figures, and
 *   a record matrix carries the note and the fold above it.
 * - The **rule fold**, which holds the longest unbroken prose in the tool. The
 *   whole redesign was moving those two sentences out of seventy record rows and
 *   into one place; folded, that place measures one line.
 * - A **record detail**, which is the widest arrangement the element ever draws
 *   -- two attempt weights each with a label, a condition and a basis, then the
 *   responsibility note, the holder line and the source link, all inside the
 *   width of one matrix.
 * - The **goal commitment** inside that detail, which is the only thing that
 *   brings the tray into existence -- it renders nothing at all until something
 *   is saved. A route that stopped before this would measure a screen with no
 *   tray on it and report a clean pass on the panel holding the longest control
 *   row in the tool.
 * - The **lift entry**, which arrives folded and measures the one line it shows.
 *   Last, so the record detail above it is still open when the page is measured,
 *   and after everything else because `fillAfter` has to be able to type into
 *   the four fields inside it -- Playwright refuses to type into something that
 *   is not visible.
 *
 * A segment is named by the text a lifter reads, because its value is bound as a
 * property and there is no attribute to select on. Playwright's CSS engine
 * pierces open shadow roots, which is what makes a control inside `ptk-segmented`
 * reachable at all.
 *
 * The spelling of that name is `:has(span:text-is(…))` and the two obvious
 * shorter forms are both wrong. `label.segment:text-is("Records")` matches
 * nothing: Playwright's text engine resolves to the *smallest* element holding
 * the string, which is the `<span>` the segment wraps, so the exact-match
 * pseudo-class asked of the label never fires. `label.segment:has-text("Records")`
 * does match, and is a substring test -- it would silently start matching a
 * future "Records (state)" segment as well, and `.first()` would then press
 * whichever the template happened to render first.
 */
const PLATFORM_TARGETS_CLICK_AFTER = [
  'ptk-target-categories ptk-button[data-action="apply"]',
  'ptk-target-report ptk-segmented[data-control="target-type"] label.segment:has(span:text-is("Records"))',
  'ptk-target-report ptk-disclosure[label="How record attempts work"] summary',
  'ptk-target-report td button.cell-button',
  // Commits to the first attempt in the open detail, which is the only way the
  // goal tray comes into existence: it renders nothing at all until something is
  // saved, so a route that never pressed this would measure a screen with no
  // tray on it and report a clean pass on the panel that carries the longest
  // control row in the tool -- a label picker and a Remove button side by side
  // under a two-line goal title.
  'ptk-target-report .detail button.goal-button',
  // Hand-kept in step with `LIFTS_FOLD_LABEL` in `ptk-target-lifts.ts`. This
  // file is plain Node and cannot import a TypeScript module, so a rename there
  // arrives here as "nothing matched" -- loudly, which is the whole reason an
  // unmatched selector is a failure rather than a skip.
  'ptk-disclosure[label="Add current lifts"] summary',
];

/**
 * The last things to appear on the Platform Targets screen.
 *
 * Three rather than one, because the screen has panels that finish at
 * different moments and none of them implies the others. The derived total fills in
 * once the three lifts above it parse; the record detail exists only once the
 * classification standards and the record partitions have arrived, been laid out
 * against the chosen classes, and had one of their cells pressed open by
 * `clickAfter` above. Settling on the total alone would measure a report still
 * showing its loading notice, which is a fraction of the height of the one with
 * matrices on it.
 *
 * The detail rather than a cell or a caption, because it is the last thing to
 * appear and it implies everything before it: there is no detail without a
 * pressed cell, no cell without a matrix, and no matrix without a book. A
 * `tbody td` would be satisfied by an empty cell in a table still waiting on its
 * second partition.
 *
 * That this is reachable at all is a fact about published data rather than a
 * guarantee of the code: the first option in every picker names a real category,
 * and a category the federation publishes no record for would leave `clickAfter`
 * with nothing to press. It is reachable today for both routes at both widths,
 * and it fails loudly rather than silently if a refresh ever changes that --
 * which is the right way round, because the alternative is a check that stops
 * measuring the panel it exists for and goes on reporting a pass.
 */
const PLATFORM_TARGETS_SETTLE = [
  'ptk-number-field[data-lift="total"] input',
  'ptk-target-report .detail .attempt-weight',
  // A row inside the tray rather than the tray element, which is always in the
  // document and renders nothing until a goal is saved. So the host matching
  // says only that the composition root drew a placeholder; the row says the
  // press above actually committed to something, and it is the row -- a goal
  // title over a figure line over a picker beside a Remove button -- that has
  // to fit the column.
  'ptk-target-goals li',
];

/**
 * The hub's one fold: how to install the toolkit.
 *
 * Shut it is a single row and measures nothing. Open it is two sentences naming
 * four separate menu items, which is the longest unbroken prose the hub renders
 * and the only thing on it with a real chance of overflowing a 320px column.
 */
const HUB_CLICK = ['ptk-disclosure[label="Install the toolkit"] summary'];

/**
 * The routes, and what has to happen before each is worth measuring.
 *
 * A path may appear more than once. Platform Targets shows one of two whole
 * screens and the first one *stops existing* when the lifter presses the action
 * on it, so a single entry that walked through to the report would measure the
 * report and never the setup form -- seven controls and a sticky action bar,
 * unmeasured at every width, which is precisely the silent coverage loss this
 * file exists to prevent. Two entries over one path is the honest shape: two
 * screens, two measurements. The `label` is what keeps their failures apart in
 * the report, since the path no longer identifies one.
 */
const ROUTES = [
  { path: '/', click: HUB_CLICK, reveal: [], fill: [] },
  {
    path: '/platform-targets/',
    label: '/platform-targets/ (setup)',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: [],
    settle: PLATFORM_TARGETS_SETUP_SETTLE,
  },
  {
    path: '/platform-targets/',
    label: '/platform-targets/ (targets)',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: [],
    clickAfter: PLATFORM_TARGETS_CLICK_AFTER,
    fillAfter: PLATFORM_TARGETS_FILL_AFTER,
    settle: PLATFORM_TARGETS_SETTLE,
  },
  {
    path: '/platform-targets/embed/uspa/',
    label: '/platform-targets/embed/uspa/ (setup)',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: [],
    settle: PLATFORM_TARGETS_SETUP_SETTLE,
  },
  {
    path: '/platform-targets/embed/uspa/',
    label: '/platform-targets/embed/uspa/ (targets)',
    click: [],
    reveal: PLATFORM_TARGETS_REVEAL,
    choose: PLATFORM_TARGETS_CHOOSE,
    fill: [],
    clickAfter: PLATFORM_TARGETS_CLICK_AFTER,
    fillAfter: PLATFORM_TARGETS_FILL_AFTER,
    settle: PLATFORM_TARGETS_SETTLE,
  },
  {
    path: '/warm-up/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    clickAfter: WARM_UP_CLICK_AFTER,
    // The checklist rows, not the field just typed into: a filled field says the
    // keystroke landed, which it did before the plan was computed. A row exists
    // only once the ramp has been worked out and rendered.
    //
    // Deliberately *not* also naming the stepper rows behind the fold above.
    // `settled` asks `count()`, which is attachment, and a shut `<details>`
    // keeps its contents attached -- so such a selector matches whether or not
    // the fold was ever pressed, and would sit here reading as proof of a press
    // it cannot see. What proves that step is the mutation described in
    // `WARM_UP_CLICK_AFTER`'s header, not anything in this list.
    settle: ['ptk-lift-card li'],
  },
  {
    path: '/warm-up/embed/',
    click: WARM_UP_CLICK,
    reveal: [],
    fill: WARM_UP_FILL,
    clickAfter: WARM_UP_CLICK_AFTER,
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
  {
    path: '/meet-day/',
    label: '/meet-day/ (plan)',
    click: MEET_DAY_CLICK,
    reveal: [],
    fill: MEET_DAY_FILL,
    clickAfter: MEET_DAY_CLICK_AFTER,
    fillAfter: MEET_DAY_SHELF_FILL,
    clickLast: [
      ...MEET_DAY_WARMUP_CLICK,
      ...MEET_DAY_PREP_CLICK,
      ...MEET_DAY_PACK_CLICK,
      ...MEET_DAY_SHELF_CLICK,
    ],
    // An attempt card, not a field and not the plan element itself. The element
    // is in the DOM from the first paint carrying one sentence about a
    // federation nobody has chosen; a card exists only once all three
    // agreements survived the typing above, which is the one thing this route
    // gets wrong silently. It is also the densest row in the collection -- an
    // attempt number, a weight in kilograms, the federation's published pounds
    // beside it, a risk word and a rounding note, on one line in 320px.
    //
    // Then the two widest things inside §22's fold, which is the other half of
    // this screen and the half with the longest labels in the tool: "Deadlift
    // bar or platform notes" over a full-width box, and a checklist row that is
    // a 44px tap target carrying a whole sentence. Both are listed because the
    // fold holds two independent elements and neither one arriving implies the
    // other.
    //
    // Then §23.1's sheet, named by an attempt row rather than by the element:
    // `ptk-meet-pack` is in the DOM from the first paint that has a view, so it
    // would settle against a sheet holding nothing but a heading. A row exists
    // only once the plan behind it does, which is the same gate the first
    // selector names -- and it is the line the sheet is widest on, an attempt
    // number, a weight, the published pounds and a subtotal in 320px.
    //
    // Then §24's shelf, named by a saved row for the reason the sheet is named
    // by an attempt row: the element is on screen from the first paint and an
    // empty shelf measures nothing worth measuring. A row exists only if the
    // fill and the press above both landed, which is also what makes this the
    // one selector here that proves the shelf renders at all -- on a route whose
    // store is the browser's, which is the only configuration §24 is offered in.
    //
    // Then the two widest things inside §20's fold, and both are listed for the
    // reason §22's two are: they arrive by different routes. A timeline row is
    // the ramp itself and exists only once the plan above has an opener to
    // count back from -- it is also the longest line the fold draws, a set
    // number, a weight, the plates on the bar and a minute range. A set row is
    // two number fields side by side under a heading, and it exists only for
    // the rungs `isAdjustable` allows a weight on, so a ramp that came out
    // bar-only would settle on the first selector and draw none of these.
    //
    // And §23.1's ramp, which is a second row shape on the same sheet rather
    // than more of the first: a rung carries a name column wide enough to line
    // six weights up under one another and then a whole phrase -- "142.5 kg, 1
    // rep" -- where an attempt row carries a bare figure. The name column has a
    // `min-width` in `em`, so it is the one thing on the sheet that grows with
    // the text-scaling passes rather than merely rewrapping under them.
    settle: [
      'ptk-plan-screen li.attempt',
      'ptk-meet-warmup ol.timeline li',
      'ptk-meet-warmup .set-row ptk-number-field',
      'ptk-meet-prep ptk-text-area[data-field="deadliftNotes"]',
      'ptk-meet-checklist ptk-toggle-group[data-group="bring"]',
      'ptk-meet-pack li.attempt',
      'ptk-meet-pack li.rung',
      'ptk-meet-library li.meet',
    ],
  },
  /*
   * The same path again, driven two presses further, because live mode replaces
   * the plan rather than appending to it (§13.10).
   *
   * A third entry rather than more steps on the one above: `li.attempt` is gone
   * the moment the meet starts, so a single entry could settle on the plan or on
   * the platform but not on both -- and dropping the plan's settle to reach the
   * platform would give up the one assertion that proves the fill and the three
   * agreements ran in the right order. Two entries measure two screens and each
   * fails on its own.
   *
   * Standalone only, and deliberately not the embed. The embed gives the element
   * *more* room -- no site gutter -- so the standalone width is the conservative
   * one, and the chrome difference between the two routes is already measured by
   * the pair above. A fourth entry would double the slowest route in the file to
   * re-measure a difference nothing here can change.
   */
  {
    path: '/meet-day/',
    label: '/meet-day/ (live)',
    click: MEET_DAY_CLICK,
    reveal: [],
    fill: MEET_DAY_FILL,
    clickAfter: MEET_DAY_CLICK_AFTER,
    fillAfter: MEET_DAY_FILL_AFTER,
    clickLast: MEET_DAY_CLICK_LAST,
    // A choice card, which is the densest thing in the collection and beats the
    // attempt card it replaces: a weight, the published pound reading, a jump, a
    // share of the maximum, a projected total, a risk band and up to three
    // sentences, stacked in 320px between attempts. It is also the only selector
    // here that cannot match before the meet starts, so it is what makes the
    // press above load-bearing.
    settle: ['ptk-live-choices li.card'],
  },
  /*
   * The same path once more, run to the end of the day (§26).
   *
   * A fourth entry for the reason the live one is a third: the finished page
   * replaces the platform screen rather than joining it, so the entry above
   * could settle on the choices or on the summary but not on both -- and the
   * choices are what prove the meet started in the first place.
   *
   * It is the most expensive entry in the file by a wide margin, and the two
   * cheaper things were both tried in the reasoning and rejected. Measuring the
   * summary in a component test is what `ptk-meet-day-planner.browser.test.ts`
   * already does at 320px, and `apps/web/CLAUDE.md` is explicit that a component
   * test cannot see the surfaces that hold most of these failures -- the gutter,
   * the site header, the back link -- nor the two text-scaling passes, which is
   * where three deploys have actually broken. Stopping the meet early does not
   * work either: there is no state between the ninth result and the summary.
   *
   * What it cannot reach is worth writing down, because the gap is invisible
   * from a green run. §9.4's panel renders here with an empty shelf, so its
   * header sentences are measured and its five figure rows -- which carry the
   * longest labels in the tool, "Best lift against the maximum you planned" over
   * a figure over a line of evidence -- are not. Filling the shelf needs a saved
   * meet with history on it, and the only route to one through the screens is
   * the file picker, which this check has no way to answer. The panel's own
   * narrow test covers those rows; nothing covers them inside the page chrome.
   *
   * Standalone only, on the same reasoning as the live and coach entries: the
   * embed has no site gutter, so this is the conservative width.
   */
  {
    path: '/meet-day/',
    label: '/meet-day/ (finished)',
    click: MEET_DAY_CLICK,
    reveal: [],
    fill: MEET_DAY_FILL,
    clickAfter: MEET_DAY_CLICK_AFTER,
    fillAfter: MEET_DAY_FILL_AFTER,
    clickLast: MEET_DAY_FINISHED_CLICK_LAST,
    // An attempt block inside a lift, and the calibration panel's own first
    // sentence. Two, because the finished page is two elements one above the
    // other and neither one arriving implies the other (§9.4's panel is a
    // sibling of the summary, deliberately, so that an imported meet can be
    // summarised with no shelf behind it).
    //
    // The attempt block rather than the total: a total is one short line and
    // exists the moment the summary does, whereas the block is the densest thing
    // on the page -- an attempt name, a weight in kilograms, the federation's
    // published pounds beside it and an outcome word, then a recommendation line
    // and how far the lifter went from it. It is also the selector that proves
    // all nine presses landed, since a meet abandoned part-way renders no
    // summary at all.
    settle: ['ptk-meet-summary .lift .attempt', 'ptk-meet-calibration p.read'],
  },
  /*
   * The same path again, down §6.1's other branch (§21).
   *
   * A separate entry for the reason the live one is separate: the coach screen
   * replaces the plan rather than appending to it, so no single entry could
   * settle on both. It is also the widest thing this tool draws -- a row carries
   * a name, an identifier, a swatch, a countdown, an attempt weight and a banked
   * total on one line, above a roster of folds -- and §27 forbids sideways
   * scrolling on an urgent workflow outright, which a coach reading a board
   * between flights is.
   *
   * Standalone only, on the same reasoning as the live entry: the embed gives
   * the element more room, so this is the conservative width.
   */
  {
    path: '/meet-day/',
    label: '/meet-day/ (coach)',
    click: MEET_DAY_COACH_CLICK,
    reveal: [],
    fill: MEET_DAY_COACH_FILL,
    clickAfter: MEET_DAY_COACH_CLICK_AFTER,
    fillAfter: MEET_DAY_SHELF_FILL,
    clickLast: [...MEET_DAY_COACH_CLICK_LAST, ...MEET_DAY_PACK_CLICK, ...MEET_DAY_SHELF_CLICK],
    // A board row and the widest thing inside the fold below it, because the
    // screen paints in two stages and both halves are measured: the row exists
    // only if the press above created a meet document, and the colour tiles
    // exist only if the roster re-rendered with a lifter in it. Settling on the
    // row alone would measure a roster that had not caught up.
    //
    // The tiles and not the identifier field beside them: `settled` asks an
    // `input` to hold a *value*, and nobody has typed an identifier -- so that
    // selector would wait out its hundred polls and fail on a screen that had
    // rendered perfectly.
    //
    // Then §23.2's roster, named by a lifter block for the reason the plan
    // route names an attempt row: the sheet exists from the paint that has a
    // board, and what has to have arrived is a lifter on it. This is the widest
    // thing the tool draws on paper or on screen -- a name, a board identifier,
    // who is handling, and three lift rows of three cells each.
    //
    // Then §24's shelf, which is on the coach screen for the reason it is on the
    // solo one: a coach's board is exactly the document worth not losing. It is
    // measured on both because the two screens are different widths above it and
    // a shelf row is the same width on each -- so a column that has run out of
    // room by the time §24 is reached runs out on one screen and not the other.
    //
    // And §21.3's tiles, which arrive a render after the press that adds a
    // handler -- a separate stage again, and the one carrying the seven
    // responsibility labels the fold is widest for.
    settle: [
      'ptk-coach-board article.row',
      'ptk-coach-roster ptk-choice-group[data-field="roster-colour"]',
      'ptk-coach-roster ptk-toggle-group[data-field="roster-handler-duties"]',
      'ptk-handler-pack .lifter',
      'ptk-meet-library li.meet',
    ],
  },
  /*
   * The same path a sixth time, one press further down the coach branch: the
   * screen a coach reaches by opening one lifter off the board (§21, §20).
   *
   * A separate entry for the reason the live one is separate from the plan --
   * this screen *replaces* the board, so the entry above could settle on a row
   * or on a ramp but not on both, and giving up the row would give up the one
   * assertion that proves the roster ever produced a board.
   *
   * What only this entry can measure is §20's fold under a lifter with no plan
   * behind them. The plan route measures the same element, but under a plan: the
   * opener there is rounded onto the profile's grid and arrives with the whole
   * planning screen above it, while here it is typed at the rack and the fold
   * sits under a live screen and a back control. The chrome above a component is
   * the half a component test cannot see, which is the whole reason this file
   * exists.
   *
   * Standalone only, on the same reasoning as the live and coach entries: the
   * embed gives the element more room, so this is the conservative width.
   */
  {
    path: '/meet-day/',
    label: '/meet-day/ (coach lifter)',
    click: MEET_DAY_COACH_CLICK,
    reveal: [],
    fill: MEET_DAY_COACH_FILL,
    clickAfter: MEET_DAY_COACH_LIFTER_CLICK_AFTER,
    fillAfter: MEET_DAY_COACH_LIFTER_FILL_AFTER,
    clickLast: MEET_DAY_COACH_LIFTER_CLICK_LAST,
    // The declared weight on the live screen, which is the only selector here
    // that cannot match before the press above landed -- the panel renders "no
    // attempt is owed" until a weight is chosen, and that sentence is narrower
    // than everything this route exists to measure.
    //
    // Then the two widest lines §20's fold draws, listed for the reason the
    // plan route lists both: a timeline row is the ramp itself -- a set number,
    // a weight, the plates on the bar and a minute range on one line -- and a
    // set row is two number fields side by side, which exists only for the
    // rungs `isAdjustable` allows a weight on. A ramp that came out bar-only
    // would settle on the first and draw none of the second.
    settle: [
      'ptk-live-screen section.panel p.weight',
      'ptk-meet-warmup ol.timeline li',
      'ptk-meet-warmup .set-row ptk-number-field',
    ],
  },
  {
    path: '/meet-day/embed/',
    click: MEET_DAY_CLICK,
    reveal: [],
    fill: MEET_DAY_FILL,
    clickAfter: MEET_DAY_CLICK_AFTER,
    settle: ['ptk-plan-screen li.attempt'],
  },
];

/** Kept in step with `--ptk-tap-target-min` in `packages/ui/src/tokens.css`. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page when a field takes focus. */
const MINIMUM_INPUT_FONT_SIZE = 16;

/**
 * How long something fetched over the network has to appear before it counts as
 * absent.
 *
 * Generous on purpose: this is a loopback server reading a directory, so the
 * real wait is a few frames, and the only thing a short limit buys is a failure
 * report about a slow machine. `settled` below polls to its own budget for the
 * same reason.
 */
const ARRIVAL_TIMEOUT_MS = 10_000;

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
  const everything = [];
  const walk = (node) => {
    for (const element of node.querySelectorAll('*')) {
      if (element.shadowRoot) walk(element.shadowRoot);
      everything.push(element);
      if (element.matches('a, button, input, select, textarea, [role="button"], label:has(input)')) {
        controls.push(element);
      }
    }
  };
  walk(document);

  // Content clipped out of existence.
  //
  // The page not scrolling sideways says the *document* fits. It says nothing
  // about a box inside it that hides its own overflow, and that box is where
  // doubling the text size actually breaks a layout: a container given a height
  // in pixels holds words that are not, so at 200% the last line is simply gone
  // -- silently, with no scrollbar and no reflow, and invisibly to the reader who
  // set 200% precisely because they cannot see small text.
  //
  // Only \`hidden\` and \`clip\`. \`auto\` and \`scroll\` overflow too, and that is
  // fine: the content is still reachable, which is the whole of what 1.4.4 asks.
  //
  // Boxes a pixel high are skipped, because that is the visually-hidden idiom --
  // position absolute, 1x1, clip-path, overflow hidden -- and a live region or a
  // clipped legend is *supposed* to hold text longer than its box. Skipping them
  // by their size rather than by a class name is what keeps this working when a
  // component spells the idiom its own way.
  //
  // One pixel of tolerance on each axis, for a child rounded out past a rounded
  // corner. A clipped sentence is never one pixel.
  //
  // Text-entry fields are exempt, and this is not a convenience. A field whose
  // value is longer than its box scrolls that value under the caret -- it is how
  // every text field on every platform has always worked, and the content is
  // fully reachable, which is the whole of what 1.4.4 asks. Without the exemption
  // the 200% pass reported a typed weight in a 123px-wide number field as lost
  // content, which is a report nobody could act on except by widening a field
  // that is already the width of the column.
  const hides = (axis) => axis === 'hidden' || axis === 'clip';
  const scrollsItsOwnText = (element) =>
    element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
  for (const element of everything) {
    if (scrollsItsOwnText(element)) continue;
    if (element.clientWidth <= 1 || element.clientHeight <= 1) continue;
    const overflowed =
      element.scrollWidth - element.clientWidth > 1 ||
      element.scrollHeight - element.clientHeight > 1;
    if (!overflowed) continue;

    const style = getComputedStyle(element);
    if (!hides(style.overflowX) && !hides(style.overflowY)) continue;

    // \`getAttribute\` rather than \`className\`, which on an SVG element is an
    // object and stringifies to nothing anybody can grep for.
    const classes = element.getAttribute('class');
    const flat = (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    problems.push(
      'clipped content in ' + element.tagName.toLowerCase() +
        (classes ? '.' + classes : '') +
        ': ' + element.scrollWidth + 'x' + element.scrollHeight +
        ' inside ' + element.clientWidth + 'x' + element.clientHeight + ' "' + flat + '"',
    );
  }

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

    // Taken out of the interface by its own two attributes, and therefore not a
    // target anybody can aim a thumb at.
    //
    // Both are required, and requiring both is the whole of what makes this
    // narrow enough to be safe. \`aria-hidden\` alone is a decorative glyph that a
    // sighted person still taps; \`tabindex="-1"\` alone is a control reached by
    // pointer but skipped in the tab order, which is a real target and often a
    // large one. Together they say the element is in neither interface: no
    // keyboard route, no accessibility tree, and -- since these are only ever
    // written on something clipped to a pixel -- no visible box to press.
    //
    // The case is \`ptk-meet-library\`'s file input, which is the collection's
    // first visually-hidden *control*. It is clipped rather than
    // \`display: none\` because Safari will not let a script open a display-none
    // picker, so it keeps a 1x1 rect, and \`MEASURE\`'s no-rects rule correctly
    // does not fire. It was then reported twice at every width, as a 1x1 tap
    // target and as a 13px font -- and both fixes available at the element
    // (padding it to 44px, or setting its font size) would have satisfied this
    // check while changing nothing a person could see. So the check is what was
    // wrong, not the element.
    //
    // Stated on the element itself and never walked up the tree. An ancestor
    // rule reads as the more thorough version and is how a whole panel of real
    // controls gets skipped in silence: one \`aria-hidden\` left on a wrapper
    // during a refactor and the check goes on printing "passed".
    if (element.getAttribute('aria-hidden') === 'true' && element.getAttribute('tabindex') === '-1') {
      continue;
    }

    // The label a person reading the failure can act on. Four sources in order,
    // because a control inside a shared component usually has no text of its
    // own: the \`<button>\` inside \`ptk-button\` holds a \`<slot>\`, and a slot has
    // no text, so every one of them reported as \`button ""\` -- four on one
    // screen, none distinguishable from the others; a \`ptk-number-field\` input
    // reported the same, and there are four of those side by side. A field's
    // \`labels\` resolves inside the shadow root, and the host's text is what a
    // slot is showing. \`aria-label\` comes before both because a glyph button has
    // a visible label that is not a name, which is the whole reason
    // \`ptk-button\` carries \`accessible-name\` at all.
    const flatten = (text) => (text || '').replace(/\\s+/g, ' ').trim();
    const host = element.getRootNode().host;
    const label =
      flatten(element.textContent) ||
      flatten(element.getAttribute('aria-label')) ||
      flatten(element.labels && element.labels[0] ? element.labels[0].textContent : '') ||
      (host ? flatten(host.textContent) : '');
    const name =
      element.tagName.toLowerCase() +
      (element.className ? '.' + element.className : '') +
      ' "' + label.slice(0, 32) + '"';

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
 * It **waits** for each one rather than counting immediately, and that is not a
 * flake mitigation -- it is what makes `clickAfter` able to press something that
 * arrives over the network. A record cell exists only once its partition has been
 * fetched, parsed and laid out, so `count()` on the tick after the last keystroke
 * is a question about the connection rather than about the page. Counting was
 * enough while every `clickAfter` entry was a fold rendered synchronously beside
 * a computed number. A selector that never appears still fails, with the same
 * message, a few seconds later.
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
    try {
      await control.waitFor({ state: 'attached', timeout: ARRIVAL_TIMEOUT_MS });
    } catch {
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
 * Types into a list of fields, failing on anything that is not there.
 *
 * Shared by `fill` and `fillAfter` for the reason `tap` is shared by `click`
 * and `clickAfter`: two copies of this loop is two places to decide what a
 * missing selector means, and the copy that decides "skip" is the one that
 * makes this file stop checking while still printing a pass.
 *
 * @param {import('playwright').Page} page
 * @param {readonly {selector: string, value: string}[]} fields
 * @param {string} where
 * @param {string[]} failures
 * @returns {Promise<boolean>}
 */
async function enter(page, fields, where, failures) {
  for (const { selector, value } of fields) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    await field.fill(value);
  }
  return true;
}

/**
 * What stands in for a reader's own text-size setting.
 *
 * A percentage on the root, so it resolves against the browser's default rather
 * than against a figure written here -- which is what a reader's setting does.
 * Every size on this site is in `rem` (§5.7 and `tokens.css`), and `rem` is
 * resolved against the document root from inside a shadow root exactly as it is
 * outside one, so one declaration reaches every component. `important` because
 * the site's own reset sets a root size, and a reader's setting is not something
 * a stylesheet gets to overrule.
 *
 * WHY THE CSSOM AND NOT A STYLESHEET
 *
 * `addStyleTag` is the obvious spelling and the production CSP refuses it:
 * `style-src 'self'` blocks an injected inline stylesheet, and the check died on
 * the first zoom pass with a console violation rather than a layout report. That
 * refusal is the deployed policy working, so the check bends rather than the
 * site -- a `unsafe-inline` allowance added to make a test convenient is the kind
 * of hole nobody remembers closing. Writing the declaration through the CSSOM is
 * not blocked by CSP, which draws its line at markup and at parsed stylesheets.
 *
 * Deliberately *not* page zoom either. Chromium's zoom scales the viewport too,
 * so a 320px window at 200% becomes a 160px layout -- a much harsher test that
 * fails for a different reason and would report reflow bugs as text bugs. What
 * 1.4.4 asks is what this does: the words get bigger, the column does not.
 *
 * Written as a string for the reason `MEASURE` is: this file is Node code, and
 * `document` is not a binding in it.
 *
 * @param {number} scale
 * @returns {string}
 */
function textSizeExpression(scale) {
  return `document.documentElement.style.setProperty('font-size', '${String(scale * 100)}%', 'important')`;
}

/**
 * How a failure names the screen it came from.
 *
 * The path is not enough on its own any more: two entries share
 * `/platform-targets/` and measure different screens of it, so a report keyed
 * to the path alone would print the same prefix for both and leave somebody
 * reading it to guess which screen has the overflowing row. Falling back to the
 * path keeps every other route's message exactly as it was, which matters
 * because those strings are what a person greps for.
 *
 * The text size joins it for the same reason, and only when it is not the
 * default: every existing message keeps its exact spelling, and the new pass is
 * distinguishable from the one it shares a width with.
 *
 * @param {{path: string, label?: string}} route
 * @param {{width: number, textScale: number}} pass
 * @returns {string}
 */
function whereOf(route, pass) {
  const text = pass.textScale === 1 ? '' : ` at ${percent(pass.textScale)}% text`;
  return `${String(pass.width)}px${text} ${route.label ?? route.path}`;
}

/**
 * Drives a route into the state worth measuring.
 *
 * Returns false, having recorded a failure, if any step could not be taken. A
 * selector that stops matching is treated as a failure rather than skipped:
 * these controls come from published data, so a silent skip is how the check
 * quietly stops checking the state it exists for while still reporting a pass.
 */
async function reveal(page, route, pass, failures) {
  const where = whereOf(route, pass);

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

  if (!(await enter(page, route.fill, where, failures))) return false;

  // Folds that do not exist until the fields above have been answered. The
  // estimator's percentage table and formula comparison render nothing at all
  // without an estimate, so pressing them in `click` would report "nothing
  // matched" -- a true statement about a state the check itself produced, and
  // one that would push somebody to weaken the unmatched-selector failure into
  // a skip, which is the thing that makes this file stop checking.
  if (!(await tap(page, route.clickAfter ?? [], where, failures))) return false;

  // Fields that do not exist until something above was pressed. Platform
  // Targets' lift entry is the case: since the three-phase rebuild the setup
  // screen carries no lift fields at all, so they cannot be typed into until
  // "Show targets" has replaced it -- and the fold they sit in has to be opened
  // after that, because Playwright refuses to type into something invisible.
  //
  // The same function as `fill`, deliberately, so the two cannot drift into
  // disagreeing about what a missing selector means. It means the same in both:
  // a failure, never a skip.
  if (!(await enter(page, route.fillAfter ?? [], where, failures))) return false;

  // A press that needs a field typed into first. The meet-day route is the case
  // and the reason this is a fourth press slot rather than more entries in
  // `clickAfter`: Start is disabled until a lifter's name is in the box, and the
  // box itself does not exist until the three agreements in `clickAfter` have
  // drawn a complete plan -- so the press is strictly after `fillAfter`, which
  // no earlier slot can express. Same function as the other two, so all three
  // agree that an unmatched selector is a failure and never a skip.
  if (!(await tap(page, route.clickLast ?? [], where, failures))) return false;

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
    for (const pass of PASSES) {
      for (const route of ROUTES) {
        // A context per route, not per width, because these tools remember
        // things. Every route on this site is one origin, so one context shared
        // across them carries the equipment and the lifts added on the previous
        // route into the next one -- and the next route's `click` list then
        // misses, because the button that read "Add Squat" now reads "Squat,
        // already on the list". Which is a genuine failure report about a
        // condition the check itself created.
        //
        // Per *entry*, not per path, which is what makes two entries over one
        // path independent: Platform Targets remembers an applied context, so
        // the targets entry running in the setup entry's context would open
        // straight into the report and its `reveal` list would find no
        // questions to answer.
        //
        // Touch and a device pixel ratio, not just a narrow window: a phone is
        // what is being stood in for, and `isMobile` is what makes the viewport
        // behave like one rather than like a very small desktop.
        const context = await browser.newContext({
          viewport: { width: pass.width, height: 720 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        await page.goto(origin + route.path, { waitUntil: 'networkidle' });

        // Before anything is pressed, so every fold this route opens is laid out
        // at the size it will be measured at. Applied after `goto` rather than
        // as an init script because a stylesheet has nowhere to go until there
        // is a document to put it in, and nothing here measures the first paint.
        if (pass.textScale !== 1) {
          await page.evaluate(textSizeExpression(pass.textScale));
        }

        const reached = await reveal(page, route, pass, failures);
        if (reached) {
          for (const problem of await page.evaluate(MEASURE)) {
            failures.push(`${whereOf(route, pass)}: ${problem}`);
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
    `Narrow-layout check passed: ${String(measured)} screens at ${PASSES.map(
      (pass) =>
        `${String(pass.width)}px${pass.textScale === 1 ? '' : `/${percent(pass.textScale)}% text`}`,
    ).join(', ')}.`,
  );
}

await main();
