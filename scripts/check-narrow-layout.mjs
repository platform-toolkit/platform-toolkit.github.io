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
import { Buffer } from 'node:buffer';
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
 * Open §19's fold, which sits below §20's on both the plan and the coach screen.
 *
 * **`ptk-disclosure.record` and never a bare `.record`.** Playwright's CSS engine
 * pierces open shadow roots, and `ptk-meet-record` names its own outermost
 * wrapper `.record` -- so the bare form matches a `<div>` inside the fold as well
 * as the fold, and `summary` under it matches nothing at all. That is the fifth
 * bare-class collision this directory has produced and the first one where the
 * two elements are in different shadow roots, which is precisely why the tag
 * qualification is load-bearing rather than tidy.
 *
 * Pressed in `clickAfter` and not `clickLast` because the record figure is typed
 * in `fillAfter`, which runs between the two: a shut `<details>` is laid out by
 * Chromium but a field inside one is not something Playwright will agree to type
 * into, and the failure would arrive as an unmatched settle selector rather than
 * as an untyped box.
 */
const MEET_DAY_RECORD_CLICK = ['ptk-disclosure.record summary'];

/**
 * A record to chase, in kilograms, which is the only unit §19's field offers.
 *
 * Invented (§5.1) and deliberately unlike the 140 the coach route declares as an
 * opener, so a figure appearing on the wrong screen is visible rather than
 * plausible. Nothing rounds it -- the routes below round *up* onto the profile's
 * grid from whatever is typed -- so unlike the declared opener there is no
 * increment a published federation could pick that would refuse it.
 *
 * Typing it is what brings the whole answer half of the fold into existence:
 * with no figure the element draws one sentence saying so, which is narrower
 * than everything this step exists to measure.
 */
const MEET_DAY_RECORD_FILL = [
  {
    selector: 'ptk-meet-record ptk-number-field[data-field="record-kilograms"] input',
    value: '205',
  },
];

/**
 * The two widest things §19's fold draws, and both are listed because they
 * arrive by different routes.
 *
 * A route block exists as soon as the figure above reads, whichever way the
 * rules answer -- it is the heading and either a weight or the reason there is
 * none. The figure line inside it exists only where a route is actually open,
 * and it is the longest sentence in the fold: a weight in kilograms, then "for a
 * total of" and a second weight, on one line in 320px. A fold that read the
 * figure but refused both routes would settle on the first selector and draw
 * none of the second.
 */
const MEET_DAY_RECORD_SETTLE = ['ptk-meet-record .record-route', 'ptk-meet-record .record-figure'];

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
 * The install fold, which is now on all eight installable pages and not just the
 * hub.
 *
 * Shut it is a single row and measures nothing. Open it is two sentences naming
 * four separate menu items -- the longest unbroken prose the hub renders, and the
 * only thing on it with a real chance of overflowing a 320px column. That prose
 * did not get shorter when it was copied to the tool pages, so every route that
 * grew the fold has to open it: a fold this list does not name is measured as the
 * one line of its summary, at every width, which is how a check quietly stops
 * covering what it claims to.
 *
 * `click` and not `reveal`. The `reveal` driver is Playwright's `check()`, which
 * refuses anything that is not a checkbox or a radio, so a `<summary>` named
 * there could not be opened at all.
 *
 * One route entry per path carries it, not all of them. The fold is the same
 * element with the same contents wherever it appears, so a second entry over the
 * same path would re-measure one row of prose and cost a browser context.
 */
const INSTALL_CLICK = ['ptk-disclosure[label="Install the toolkit"] summary'];

/**
 * One competition result, typed the way a lifter reads it off an archive page.
 *
 * Every figure is invented (§5.1), and so is every *word*: `sex`, `equipment`,
 * `division` and `ageClass` are archive spellings here, not federation
 * identifiers. That is the whole reason this route can type them while the
 * pickers below are still answered by position -- an archive spelling is a
 * string somebody transcribed, and the tool's job is to say it could not read
 * it. A spelling that matches nothing is therefore a perfectly good input for
 * this check: it leaves the axis unproposed, and an unproposed axis is answered
 * by `QUALIFY_CLICK_AFTER` a step later, which is the state worth measuring.
 *
 * All twelve, and not the six `readTypedResult` insists on. The missing-field
 * problems it reports are one narrow line each, whereas a complete result is
 * what draws the log row, the standings tile and everything below them -- and
 * the log row is the densest line on the upper half of this screen, a meet
 * name over a date, a category and a total in 320px.
 */
const QUALIFY_FILL = [
  { selector: 'ptk-result-form [data-field="date"] input', value: '2026-03-14' },
  { selector: 'ptk-result-form [data-field="meetName"] input', value: 'Invented Spring Open' },
  { selector: 'ptk-result-form [data-field="federation"] input', value: 'Invented Federation' },
  { selector: 'ptk-result-form [data-field="parentFederation"] input', value: 'Invented Parent' },
  { selector: 'ptk-result-form [data-field="sex"] input', value: 'M' },
  { selector: 'ptk-result-form [data-field="equipment"] input', value: 'Raw' },
  { selector: 'ptk-result-form [data-field="division"] input', value: 'Masters 1' },
  { selector: 'ptk-result-form [data-field="ageClass"] input', value: '45-49' },
  { selector: 'ptk-result-form [data-field="ageYears"] input', value: '47' },
  { selector: 'ptk-result-form [data-field="bodyweightKg"] input', value: '108.4' },
  { selector: 'ptk-result-form [data-field="weightClassKg"] input', value: '110' },
  { selector: 'ptk-result-form [data-field="squatKg"] input', value: '250' },
  { selector: 'ptk-result-form [data-field="benchKg"] input', value: '165' },
  { selector: 'ptk-result-form [data-field="deadliftKg"] input', value: '260' },
];

/**
 * Submit the result, then answer the three questions drawn as tiles.
 *
 * The submit is on the native control inside the host, the way Start is on the
 * meet-day route: a press that lands on the host's own padding is swallowed, and
 * the failure would then arrive as a missing registration screen rather than as
 * an unclickable button.
 *
 * Nothing below it exists before that press. There is no standing until a result
 * has been entered, and the standings tile is not pressed either -- one typed
 * result makes exactly one standing, and the element selects a lone standing
 * itself rather than making the reader confirm a list of one.
 *
 * The three tiles are pressed by *position* -- `.first()`, which is what `tap`
 * takes -- rather than by an option value, for the reason `choose` picks by
 * index: these come from the published catalogue, so naming one would deliver a
 * federation's renamed equipment category as a layout regression in this file.
 * Sex first and not in any order: the weight-class ladder is published per sex,
 * so the picker in `chooseLast` holds nothing at all until this tile is answered
 * (`weightClassesFor` returns an empty list for an unknown sex, which is the
 * guard that stops a 115 kg woman being placed in a men's class).
 *
 * All three are pressed rather than only the ones a proposal left open, because
 * which ones it leaves open is published data. `mayPreselect` admits a measured
 * proposal and refuses a spelled one, so a bodyweight can fill in a weight class
 * and a transcribed word never fills in anything -- and answering an axis that
 * was already answered changes nothing on screen, whereas leaving one open stops
 * the registration resolving and takes the entire lower half of the page away.
 */
const QUALIFY_CLICK_AFTER = [
  'ptk-result-form .actions ptk-button button',
  'ptk-registration-answers [data-axis="sex"] input',
  'ptk-registration-answers [data-axis="equipment"] input',
  'ptk-registration-answers [data-axis="tested"] input',
];

/**
 * The two registration answers drawn as pickers, and then the meet.
 *
 * In `chooseLast` and not `choose` because none of the three is on the page when
 * `choose` runs: the registration questions are drawn from a result the reader
 * typed and submitted, which is `fill` and then `clickAfter`. That ordering is
 * the whole reason the slot exists.
 *
 * Weight class and division are selects rather than tiles because seventeen age
 * divisions as a tile grid is the ragged column §5.7 forbids -- so this list is
 * not an implementation detail of the check, it is the shape of the screen.
 *
 * The meet is third and depends on the two above it: `resolveRegistration` needs
 * all five axes before the meet panel is drawn at all. Picking it is what turns
 * one line of prose into the densest section of the tool -- the criteria the
 * federation published, each route set apart, with what this lifter's results
 * read against it -- so a route that stopped at the fifth answer would report a
 * clean pass on a screen missing the part it exists to show.
 */
const QUALIFY_CHOOSE_LAST = [
  { selector: 'ptk-registration-answers [data-axis="weight-class"] select', index: 1 },
  { selector: 'ptk-registration-answers [data-axis="division"] select', index: 1 },
  { selector: '[data-picker="meet"] select', index: 1 },
];

/**
 * The two panels that arrive last, and neither one implies the other.
 *
 * A lift row from the report: it exists only once the classification standards
 * for the chosen sex and equipment have been fetched -- a second read, fired by
 * the registration answers above and not by the first paint -- and it is the
 * densest line the report draws, a lift name over a best, what it achieved, and
 * how far it sits from the next rung.
 *
 * Then the meet's own name, which is the one selector here that cannot match
 * unless the pick above resolved: an identifier the published book does not
 * carry renders an error notice instead, which is narrower than everything this
 * route is for. Not a criteria row, tempting as it is -- how many routes a meet
 * publishes is published data, and settling on one would turn a federation
 * transcribing a meet with a single unconditional entry rule into a layout
 * failure.
 */
const QUALIFY_SETTLE = ['ptk-standing-report li.lift', 'ptk-meet-reading p.meet-name'];

/**
 * Unfold the rack editor on the home screen.
 *
 * A `click` and not a `reveal` because Playwright's `check()` refuses anything
 * that is not a checkbox or a radio, and this is a `<summary>`.
 *
 * The summary is reached through `ptk-equipment-library` rather than by naming
 * `ptk-disclosure` alone: the home screen has a second fold under Backup, the
 * two are the same element, and `.first()` would silently measure whichever one
 * the template happens to draw first the next time that screen is rearranged.
 */
const LOGBOOK_RACK_CLICK = ['ptk-training-logbook ptk-equipment-library ptk-disclosure summary'];

/**
 * The fold reporting itself open, alongside the storage line.
 *
 * `open` is reflected by `ptk-disclosure`, so this distinguishes "the press
 * landed" from "the element exists" -- and the body of a `<details>` is in the
 * DOM either way, which is what makes every selector inside it useless here.
 */
const LOGBOOK_HOME_SETTLE = [
  'ptk-training-logbook p.save',
  'ptk-training-logbook ptk-equipment-library ptk-disclosure[open]',
];

/**
 * Change the rack, which is what gives the library something to save.
 *
 * The untick is not decoration on the way to the name box. `settings.equipment`
 * stays null until a lifter *changes* something -- opening the fold is not a
 * change -- and a null rack means no row can ever read "In use", so the saved
 * gym would be measured in its one-button shape only.
 */
const LOGBOOK_LIBRARY_CLICK = [
  ...LOGBOOK_RACK_CLICK,
  'ptk-equipment-setup ptk-toggle-group[data-field="plates"] [data-value="45"] input',
];

/** The one press that turns the draft rack into a stored gym. */
const LOGBOOK_LIBRARY_SAVE = ['ptk-equipment-library ptk-button[data-action="save-rack"] button'];

/**
 * Name the rack, save it, change the rack, then name and save a second one.
 *
 * Two gyms rather than one, and the untick between them is what makes the pair
 * worth the extra presses: the row template draws "In use" and the Use button as
 * *alternatives*, so a library holding one profile can only ever show one of the
 * two row shapes. Saving a second gym against a rack the first no longer matches
 * puts both on screen at once -- a name, a badge and a Remove on one row and a
 * name, a Use and a Remove on the next, which is the widest thing the library
 * draws and the reason this route exists.
 *
 * The box has to be filled twice because saving empties it. That is the element
 * clearing a field it has consumed, not a quirk to work around, and a second fill
 * is the honest way to drive it.
 *
 * Both names are invented (section 5.1) and deliberately long: the name is free text a
 * lifter types, and it is the string that has to wrap rather than push a
 * two-button row sideways in a 320px column.
 */
const LOGBOOK_LIBRARY_FILL = [
  {
    selector: 'ptk-equipment-library ptk-text-field[data-field="gym-name"] input',
    value: 'Invented Garage, everything but the 45s',
  },
];

const LOGBOOK_LIBRARY_CLICK_AFTER = [
  ...LOGBOOK_LIBRARY_SAVE,
  'ptk-equipment-setup ptk-toggle-group[data-field="plates"] [data-value="25"] input',
];

const LOGBOOK_LIBRARY_FILL_AFTER = [
  {
    selector: 'ptk-equipment-library ptk-text-field[data-field="gym-name"] input',
    value: 'Invented Basement, tens and under',
  },
];

/**
 * One row of each kind, which is the whole point of saving twice.
 *
 * Neither selector alone proves the screen. A `li[data-profile]` exists against
 * any stored gym, so settling on the row would pass with one profile and measure
 * a library that never drew a badge; and the badge alone would pass against a
 * library whose every row is the current rack. Requiring both is requiring that
 * two gyms landed and that they disagree about the plates -- which is the state
 * the row template has two shapes for.
 */
const LOGBOOK_LIBRARY_SETTLE = [
  'ptk-equipment-library li[data-profile] span.in-use',
  'ptk-equipment-library li[data-profile] ptk-button[data-action="use-rack"] button',
];

/**
 * Name a movement the lifter invented.
 *
 * Deliberately long and invented (section 5.1). The name is free text and it is
 * the string that has to wrap rather than push a two-button row sideways in a
 * 320px column -- the same reason the gym names above are long.
 */
const LOGBOOK_EXERCISE_FILL = [
  {
    selector: 'ptk-exercise-library ptk-text-field[data-field="exercise-name"] input',
    value: 'Invented safety bar squat, high handle',
  },
];

/** The one press that turns the form into a stored movement. */
const LOGBOOK_EXERCISE_SAVE = [
  'ptk-exercise-library ptk-button[data-action="save-exercise"] button',
];

/**
 * Tick the warm-up box, which is what puts the form at its widest.
 *
 * After the save rather than before it, because saving empties the form. The tick
 * is the only control on this screen that reveals another one: the family select
 * does not exist until it is on, so a form measured without it is a form measured
 * one control short of the tallest thing it draws.
 */
const LOGBOOK_EXERCISE_TICK = [
  'ptk-exercise-library [data-field="exercise-warmup"] ptk-toggle-group input',
];

/**
 * A stored row and the revealed select, which no single selector proves.
 *
 * The row alone would pass against a form that never opened the family select,
 * and the select alone would pass against an empty library. Both together are the
 * state this route exists for: the widest form the screen draws, above a list with
 * a name and two quiet buttons sharing a line.
 */
const LOGBOOK_EXERCISE_SETTLE = [
  'ptk-exercise-library li[data-exercise] ptk-button[data-action="remove-exercise"] button',
  'ptk-exercise-library ptk-select[data-field="exercise-family"] select',
];

/**
 * Open the planner and put two lifts in it.
 *
 * Two, and specifically these two. One row measures a row; two measure the gap
 * between them and the second heading, which is where a list stops being a card
 * and starts being a layout. The overhead press is the longest primary name the
 * catalogue holds and the squat is the shortest, so the pair also spans the
 * widest and narrowest heading the screen can draw.
 *
 * Named by `data-exercise` rather than pressed by position, which reads like a
 * violation of the rule the `choose` steps follow and is not one. That rule is
 * about **published data** -- a federation's weight classes and equipment
 * categories arrive in an artifact and get renamed by their governing body, so
 * naming one here would deliver a data refresh as a layout failure. These four
 * ids are `LIFTS` in `packages/domain`, ordinary source in this repository:
 * renaming one is a compile-visible edit somebody makes on purpose, and this
 * check failing is the correct answer to it.
 */
const LOGBOOK_PLAN_CLICK = [
  'ptk-training-logbook ptk-button[data-action="start-workout"] button',
  'ptk-workout-builder ptk-button[data-exercise="squat"] button',
  'ptk-workout-builder ptk-button[data-exercise="overhead-press"] button',
];

/**
 * A title and a working weight for each lift.
 *
 * Sets and reps are left alone: the catalogue puts a default in both boxes, and
 * typing over a number with another number of the same length measures nothing.
 * The weight boxes start empty, so filling them is what makes the row render its
 * third control at full width -- and 142.5 rather than 140 because a decimal is
 * a character wider and this is a 320px column.
 *
 * Every figure is invented (§5.1), and the title is deliberately a long one: it
 * is free text a lifter types, it is the widest single string on the planner, and
 * it is the string that has to wrap rather than push the page sideways.
 */
const LOGBOOK_PLAN_FILL = [
  {
    selector: 'ptk-workout-builder [data-field="title"] input',
    value: 'Invented Tuesday — heavy squat and press',
  },
  { selector: 'ptk-workout-builder li[data-row="0"] [data-field="weight"] input', value: '142.5' },
  { selector: 'ptk-workout-builder li[data-row="1"] [data-field="weight"] input', value: '62.5' },
];

/**
 * The weight box just typed into, which is the one input on the planner a `fill`
 * has put a value in.
 *
 * `settled()` asks an input for a *value* and everything else merely for
 * existence, so the row's sets box -- the obvious thing to wait for -- would sit
 * here holding a default that arrived before the row was laid out, and the date
 * field would wait out all hundred polls against a screen that rendered
 * perfectly. Row 1 rather than row 0: the second tile's press is the one that
 * proves both landed.
 *
 * The save line is named as well, and it is the slow half. It appears only when
 * the repository has answered, which is an IndexedDB open and four reads -- so a
 * planner measured without it is a planner measured one paint before a sentence
 * arrives above it.
 */
const LOGBOOK_PLAN_SETTLE = [
  'ptk-training-logbook p.save',
  'ptk-workout-builder li[data-row="1"] [data-field="weight"] input',
];

/** Start the session the planner has just been given. */
const LOGBOOK_START = ['ptk-workout-builder ptk-button[data-action="start"] button'];

/**
 * Tick the first set off, then open its editor.
 *
 * Both, because they are the two states a row has and the second is the taller
 * one: a completed row grows an "edited" line, and the editor unfolds two number
 * fields, a save button and two of §7.7's three inside a list item that is
 * already indented. That is the densest thing this tool draws in a phone column,
 * and it is drawn *inside* a row rather than in a dialog, so it inherits every
 * level of padding above it -- which is exactly the nesting §5.7 says eats a
 * 320px column at 200% text.
 *
 * Two of the three and not all three: Skip is drawn only where nothing has been
 * said about a row yet, and this editor is opened on the row just ticked. The
 * wider arrangement has a route of its own below, because `.structure` wraps and
 * two buttons and three are different layouts rather than more of the same one.
 */
const LOGBOOK_LOG_CLICK = [
  'ptk-active-workout ptk-button[data-action="complete"] button',
  'ptk-active-workout ptk-button[data-action="edit"] button',
];

/**
 * The same editor over a row nothing has been said about, which is where Skip is.
 *
 * A route of its own rather than a third press on the list above, because only one
 * editor is open at a time and `LOGBOOK_EFFORT_CLICK_LAST` re-uses that list and
 * depends on the editor sitting over the row it completed. Nothing is ticked on
 * this route, so `.first()` lands on a planned row without naming one by position.
 */
const LOGBOOK_STRUCTURE_CLICK_LAST = ['ptk-active-workout ptk-button[data-action="edit"] button'];

/**
 * All three of them, named one by one.
 *
 * Skip is what distinguishes this route from the logging route above, and Remove is
 * the last control in the editor -- so the pair is both "the arrangement this entry
 * exists for" and "the fold has finished drawing".
 */
const LOGBOOK_STRUCTURE_SETTLE = [
  'ptk-active-workout ptk-button[data-action="duplicate-set"] button',
  'ptk-active-workout ptk-button[data-action="skip-set"] button',
  'ptk-active-workout ptk-button[data-action="remove-set"] button',
];

/**
 * The row that has been ticked off, and the editor open inside it.
 *
 * `li[data-set].done` carries the class only once the set is recorded, so it is
 * the press being proven rather than the row existing. Remove is the last control
 * rendered in the editor -- below Save, behind §7.7's rule -- so waiting for it
 * waits for the whole fold. Save was this line until those three arrived, and it
 * would now settle the route one block early.
 *
 * Not the editor's own number fields, tempting as they are: their values come
 * from the performance being corrected, and a set completed at its planned
 * weight with no weight typed leaves the box empty. `settled()` would then poll a
 * hundred times against a perfectly rendered editor and report a layout failure.
 */
const LOGBOOK_LOG_SETTLE = [
  'ptk-active-workout li[data-set].done',
  'ptk-active-workout ptk-button[data-action="remove-set"] button',
];

/**
 * Turn effort entry on, then plan the standard session over it.
 *
 * The setting has to be the first press. `start-workout` replaces the home
 * screen with the planner and takes the settings section with it, and nothing
 * carries the answer forward afterwards but the root's own state -- so the order
 * here is the whole of what puts a third box in the editor seven presses later.
 * Get it wrong and the route still runs, still measures a logging screen, and
 * measures the two-box editor every other logbook route already covers.
 *
 * `ptk-segmented` exposes no `data-value`, so the option is reached by the words
 * in it. `ptk-toggle-group` writes one onto each option for exactly this reader,
 * which is why `LOGBOOK_LOADING_CLICK` above can name a plate by its
 * denomination; `ptk-segmented` renders `<label class="segment">` around a
 * clipped radio and a `<span>`, and puts the value on the input as a property,
 * where no selector can see it. That leaves the words, spelled
 * `label.segment:has(span:text-is("RPE"))` -- the form
 * `PLATFORM_TARGETS_CLICK_AFTER` argues at length, and the two shorter spellings
 * are wrong here for the reasons given there.
 *
 * Naming visible text is the weaker contract and it is taken knowingly rather
 * than by preference. `EFFORT_SETTING_LABELS` is this repository's own source,
 * and this route failing is the right answer to somebody renaming it -- but the
 * failure will say "nothing matched", not "the label moved". If a third caller
 * ever wants an option out of a `ptk-segmented`, give the element the attribute
 * and delete this paragraph.
 *
 * Qualified through `[data-field="effort-setting"]`, never a bare segment. The
 * settings section holds two of these bars now, `tap` takes `.first()`, and an
 * unqualified selector would answer the unit question instead -- silently,
 * because "lb" is a real segment and pressing it is a real press.
 *
 * RPE rather than RIR, by one character in the right direction: the two field
 * labels are the same length and RPE's hint sentence is the longer of the two.
 * RIR's sentence is longer only under the *home* control, which this route walks
 * away from before anything is measured.
 */
const LOGBOOK_EFFORT_CLICK = [
  'ptk-training-logbook [data-field="effort-setting"] label.segment:has(span:text-is("RPE"))',
  ...LOGBOOK_PLAN_CLICK,
];

/**
 * A reading with a half point in it, which is the widest an ordinary answer gets.
 *
 * Invented (section 5.1), and a decimal rather than a whole number for the same
 * reason the planner's 142.5 is one: it is a character wider, and it is the shape
 * `readEffort` was deliberately written to accept where `readReps` refuses it. It
 * reaches the row as "RPE 8.5" one press later.
 */
const LOGBOOK_EFFORT_FILL_AFTER = [
  { selector: 'ptk-active-workout [data-field="done-effort"] input', value: '8.5' },
];

/**
 * Save the correction, then open the editor over it again.
 *
 * The second press is what makes this one route instead of two. `#saveEdit`
 * clears `editing`, so the three-box editor is gone by the time anything is
 * measured -- and the row line this route also exists for does not exist until
 * that save has been through the root and come back. Re-opening draws both at
 * once, because `#toggleEditor` re-seeds from the stored performance: the grid
 * comes back with the reading in it, underneath a row already carrying it.
 *
 * The alternative was two entries, one settling on the editor before the save and
 * one on the row after it, for ten more page loads and an arrangement one press
 * produces. The precedent is the deliberate absence of a "finishing with a note"
 * route: a second entry earns itself only where the first genuinely cannot draw
 * the thing.
 *
 * `.first()` on both, which is the first set of the first exercise -- the same row
 * `LOGBOOK_LOG_CLICK` completed and opened above.
 */
const LOGBOOK_EFFORT_CLICK_LAST = [
  'ptk-active-workout ptk-button[data-action="save-edit"] button',
  'ptk-active-workout ptk-button[data-action="edit"] button',
];

/**
 * The recorded reading on the row, and the box it came out of, re-opened over it.
 *
 * Neither implies the other and both are the point of the route.
 *
 * `span.set-effort` inside `li[data-set].done` is drawn only where the set was
 * recorded with an effort, which needs the home-screen press, the typed reading
 * and the save to have all landed. A set completed with the setting off draws the
 * kind and the plan line and nothing else, so this cannot pass against the screen
 * `LOGBOOK_LOG_SETTLE` already measures.
 *
 * The box is named as an `input` on purpose: that is the one selector shape
 * `settled()` asks a *value* of. Existence would be satisfied the moment the
 * second press committed a template, and would say nothing about the press before
 * it. A value can only have come from `#seedEffort` reading the effort back off
 * the stored set, so this is the whole round trip -- press, event, root state,
 * property, re-render -- rather than a box that merely rendered.
 *
 * That is also why the objection on `LOGBOOK_LOG_SETTLE` does not apply. It
 * refuses the editor's number fields because a set completed at its planned
 * weight leaves them empty; the effort box is the one field that cannot be empty
 * here, because the value in it is the one this route typed.
 */
const LOGBOOK_EFFORT_SETTLE = [
  'ptk-active-workout li[data-set].done span.set-effort',
  'ptk-active-workout [data-field="done-effort"] input',
];

/**
 * Pick a rack on the way past, so the logging screen draws plates.
 *
 * The tool leaves `settings.equipment` null until a lifter answers the equipment
 * section, and drawing the catalogue's default gym under somebody's session would
 * be worse than drawing nothing -- so every other logbook route measures a
 * logging screen with no plate diagram on it at all. Without these two presses the
 * widest thing this tool draws would be measured at no width.
 *
 * Unticking the 45 is what makes it the widest. A rack whose biggest plate is a 25
 * builds the route's 142.5 out of six plates a side instead of four, and six plate
 * faces in a flex row inside a set row inside a card is the deepest nesting and the
 * longest line the diagram can reach. It stays *loadable*, which matters: an
 * unbuildable weight replaces the diagram with a sentence, and a sentence wraps.
 *
 * A garage gym with no 45s is an ordinary rack rather than a contrived one, and
 * every figure here is invented (§5.1) -- these are plate denominations out of
 * `packages/domain`, this repository's own source, not a federation's published
 * numbers. Named by `data-value` and not by position for the reason on
 * `ptk-toggle-group`: the list is thirteen long and the domain may lengthen it.
 */
const LOGBOOK_LOADING_CLICK = [
  ...LOGBOOK_RACK_CLICK,
  'ptk-equipment-setup ptk-toggle-group[data-field="plates"] [data-value="45"] input',
  ...LOGBOOK_PLAN_CLICK,
];

/**
 * A diagram with plates in it, on the row that has been ticked off.
 *
 * The `[role="img"]` inside the stack rather than the stack itself: the element
 * renders either a labelled row of plates or the "Bar only" line, both from the
 * same tag, so settling on the tag would pass against a rack change that never
 * landed. The `aria-label` exists only where there is something on the bar.
 */
const LOGBOOK_LOADING_SETTLE = [
  ...LOGBOOK_LOG_SETTLE,
  'ptk-active-workout ptk-plate-stack [role="img"]',
];

/**
 * Strip the rack down to plates that cannot make a half.
 *
 * The fractional set goes in one press -- the switch above the chips is there
 * because the small plates are owned or not owned as a bag -- and the 2.5 goes
 * with it. What is left is 45, 25, 10 and 5, so every side is a multiple of five
 * and every total the rack can build is the bar plus a multiple of ten.
 *
 * That is an ordinary gym rather than a contrived one, which is the point: the
 * sentence this route measures is not an edge case, it is what a lifter sees the
 * first time they type a weight their plates do not reach. Every figure is
 * invented (section 5.1) and every denomination named here is `packages/domain`'s own
 * source, not a federation's published numbers.
 */
const LOGBOOK_COARSE_CLICK = [
  ...LOGBOOK_RACK_CLICK,
  'ptk-equipment-setup input[data-field="micro-all"]',
  'ptk-equipment-setup ptk-toggle-group[data-field="plates"] [data-value="2.5"] input',
  ...LOGBOOK_PLAN_CLICK,
];

/**
 * A weight that rack cannot build, beside one it can.
 *
 * 137.5 falls between 135 and 145 and is reachable by neither, so the diagram is
 * replaced by the longest form of the sentence -- the refusal, the lead-in, and
 * *both* neighbours -- which is a line of prose where every other route on this
 * tool has a row of plate faces. A gap with only one neighbour would measure a
 * shorter string, so the number is chosen to sit strictly inside the range the
 * plates reach rather than off either end.
 *
 * The press stays loadable at 65 on purpose. A card that is nothing but refusals
 * is not the screen a lifter meets, and the two side by side is what puts a
 * wrapped sentence directly under a plate row -- the vertical rhythm that breaks
 * first. It also keeps the settle honest: an equipment answer that never landed
 * draws neither the sentence nor the diagram.
 */
const LOGBOOK_UNBUILDABLE_FILL = [
  {
    selector: 'ptk-workout-builder [data-field="title"] input',
    value: 'Invented Thursday -- a weight these plates cannot build',
  },
  { selector: 'ptk-workout-builder li[data-row="0"] [data-field="weight"] input', value: '137.5' },
  { selector: 'ptk-workout-builder li[data-row="1"] [data-field="weight"] input', value: '65' },
];

/**
 * The refusal sentence, and a diagram somewhere else on the card.
 *
 * `p.refusal` and not `.loading-note`: the change line under a plate row carries
 * that class too, so matching it would settle on the wrong paragraph and report
 * this screen covered against a session that loaded perfectly.
 */
const LOGBOOK_UNBUILDABLE_SETTLE = [
  'ptk-active-workout p.refusal',
  'ptk-active-workout ptk-plate-stack [role="img"]',
];

/**
 * Ask for a ramp under both lifts, then start.
 *
 * After the fill and not before it, because a ticked row with an empty weight box is
 * refused -- the planner would stay put and the route would go on to measure the
 * planner while calling itself the logging screen. Both rows rather than one: two
 * ramps is what a real session looks like and it is the taller card.
 *
 * The tick is reached through `[data-value="warmup"]`, which is the only way in from
 * outside. `ptk-toggle-group` holds an option's value as a *property* on the input,
 * invisible to a selector, and it writes the attribute onto the label for exactly
 * this. Position would work today and there is one option; a second tick beside it
 * would silently move this press onto the wrong question.
 */
const LOGBOOK_WARMUP_CLICK = [
  'ptk-workout-builder li[data-row="0"] [data-field="warmup"] [data-value="warmup"] input',
  'ptk-workout-builder li[data-row="1"] [data-field="warmup"] [data-value="warmup"] input',
  ...LOGBOOK_START,
];

/**
 * A generated warm-up row, with plates drawn under it.
 *
 * `data-kind` rather than the row's position or its visible word. A ramp and a
 * working set come out of the same tag with the same classes, so every other selector
 * on this screen matches just as well against a session where nothing was generated
 * -- and that is the failure this route exists to catch, since the whole route is two
 * ticks and a Start. The attribute is on the row for this reader and nothing in the
 * element consults it.
 *
 * The plate stack is named too, and it is the slower half: the ramp's rungs are
 * searched against the rack rather than read off the plan, so a screen settled on the
 * row alone is a screen measured a paint before the plates arrive under it.
 */
const LOGBOOK_WARMUP_SETTLE = [
  'ptk-active-workout li[data-set][data-kind="warmup"]',
  'ptk-active-workout li[data-set][data-kind="warmup"] ptk-plate-stack [role="img"]',
];

/**
 * A rack, one lift that can ramp, and the picker open over it.
 *
 * The four tiles are all barbell lifts, so a plan built from them alone can never
 * reach the mixed case: every row ramps, and the note stays silent. The other
 * movement has to come through the picker, and the picker is behind a disclosure
 * -- opened here rather than in `clickAfter` because `pick` runs before it and
 * Playwright will not answer a select it cannot see.
 *
 * The untick is the rack. Without one the section draws the *other* sentence, the
 * one that says where to set a rack up, and this route would measure that while
 * calling itself the mixed plan.
 */
const LOGBOOK_MIXED_CLICK = [
  ...LOGBOOK_RACK_CLICK,
  'ptk-equipment-setup ptk-toggle-group[data-field="plates"] [data-value="45"] input',
  'ptk-training-logbook ptk-button[data-action="start-workout"] button',
  'ptk-workout-builder ptk-button[data-exercise="squat"] button',
  'ptk-workout-builder ptk-disclosure summary',
];

/**
 * The first movement in the picker with no ramp to generate.
 *
 * By position because that is the only thing `pick` speaks, and the position is
 * derived rather than guessed: the options are grouped by loading model in a
 * fixed order and sorted by name inside each group, so a placeholder, the
 * thirty-five barbell lifts, the one machine and the two weighted bodyweight
 * movements sit ahead of the first plain bodyweight entry.
 *
 * A catalogue edit that moved it is not a silent failure. The settle below
 * requires the row that lands here to be one with no weight box, and every
 * neighbour on either side of this index has one.
 */
const LOGBOOK_MIXED_CHOOSE = [{ selector: 'ptk-workout-builder ptk-select select', index: 39 }];

/**
 * A title and a weight for the lift that has one.
 *
 * Only row 0, because the picked movement records reps and nothing else -- there
 * is no weight box on it to fill, and naming one would be a failure about a
 * control the catalogue is right not to draw.
 */
const LOGBOOK_MIXED_FILL = [
  {
    selector: 'ptk-workout-builder [data-field="title"] input',
    value: 'Invented Friday -- a barbell lift and an accessory',
  },
  { selector: 'ptk-workout-builder li[data-row="0"] [data-field="weight"] input', value: '142.5' },
];

/** Put the picked movement on the list. Disabled until the select is answered. */
const LOGBOOK_MIXED_ADD = ['ptk-workout-builder ptk-button[data-action="add-picked"] button'];

/**
 * Both halves of the mixed plan, and the sentence they produce between them.
 *
 * The note is one of two the section can draw from the same tag and class, so it
 * is settled on last and never alone: the tick on row 0 proves a rack exists and
 * that a ramp is on offer somewhere, and the reps-only paragraph on row 1 proves
 * the picked movement landed and cannot be ramped. Those two facts are exactly
 * the condition the sentence is written for, so the three together cannot pass
 * against the no-rack sentence, which is the one they would otherwise be
 * confused with.
 *
 * `section.section:last-of-type > p.note` and not `p.note`: the planner opens
 * with a note under its own heading and every reps-only row carries one, so the
 * bare class matches four things here and would settle before the picker was
 * ever answered.
 */
const LOGBOOK_MIXED_SETTLE = [
  'ptk-workout-builder li[data-row="0"] [data-field="warmup"]',
  'ptk-workout-builder li[data-row="1"] .numbers p.note',
  'ptk-workout-builder section.section:last-of-type > p.note',
];

/**
 * Ask to finish, then answer the question that asking raises.
 *
 * Nothing has been ticked off on this route, so every set is outstanding and the
 * panel draws its disposition question -- which is the state worth measuring, and
 * the only one where the panel is more than two sentences and two buttons. The
 * radio is pressed by position because there are exactly two, both from a closed
 * union in this repository's own source.
 */
const LOGBOOK_FINISH_CLICK = [
  'ptk-active-workout ptk-button[data-action="finish"] button',
  'ptk-active-workout .finish ptk-choice-group input',
];

/**
 * The confirm button with its disabled attribute gone.
 *
 * It is rendered from the first paint of the panel and starts disabled, so its
 * mere existence proves only that the panel opened. Enabled proves the radio
 * above it was answered -- and answering is also what draws the sentence
 * explaining what the chosen disposition does to the sets nobody did, which is
 * the tallest line in the panel and the reason this route exists.
 */
const LOGBOOK_FINISH_SETTLE = [
  'ptk-active-workout .finish ptk-button[data-action="finish-confirm"] button:not([disabled])',
];

/**
 * Do the whole session, put it away, and come back to the row it left behind.
 *
 * The long way round because there is no short one. The Repeat button is drawn per
 * history row, a history row exists only once a workout has been completed, and a
 * completed workout lives in IndexedDB -- which nothing in this runner's vocabulary
 * can seed (#94). Finishing and pressing Home is therefore both the only route to
 * the control and the exact route a lifter takes to it.
 *
 * The row is also the widest thing the home screen draws and none of it had been
 * measured at any width: a title a lifter typed, an ISO day beside it, every lift
 * in the session comma-joined, a facts line of three or four items, and a trailing
 * button under the lot. Every other entry on this path opens on an empty logbook
 * and gets the one-sentence empty state instead.
 */
const LOGBOOK_REPEAT_CLICK = [
  ...LOGBOOK_START,
  ...LOGBOOK_FINISH_CLICK,
  'ptk-active-workout .finish ptk-button[data-action="finish-confirm"] button',
  'ptk-training-logbook ptk-button[data-action="home"] button',
];

/**
 * The row's own button, and the storage line under everything.
 *
 * `li[data-workout]` in the selector rather than the button on its own: the button
 * is drawn inside a row, so naming the row is requiring that the finished session
 * came back out of storage and was listed. The whole route is worthless against a
 * history the home screen never read, and a bare action selector would not know.
 */
const LOGBOOK_REPEAT_SETTLE = [
  'ptk-workout-history li[data-workout] ptk-button[data-action="repeat-workout"] button',
  'ptk-training-logbook p.save',
];

/**
 * The row's other button, which opens the session rather than starting a new one.
 *
 * In `clickLast` over `LOGBOOK_REPEAT_CLICK`, so the whole session-and-home journey
 * above is walked once and paid for twice. The row it lands on is the same one --
 * `li[data-workout]` for the reason the settle list above names it -- and the press
 * cannot happen at all unless the finished workout came back out of storage.
 */
const LOGBOOK_OPEN_CLICK_LAST = [
  'ptk-workout-history li[data-workout] ptk-button[data-action="open-workout"] button',
];

/**
 * A set row on the opened workout.
 *
 * The read behind the press is asynchronous and writes nothing, so the storage line
 * says Saved for the entire journey and cannot be waited on. A `li[data-set]` inside
 * `ptk-workout-detail` exists only on the far side of a `getWorkout` that came back.
 */
const LOGBOOK_OPEN_SETTLE = ['ptk-workout-detail li[data-set]'];

/**
 * Open the workout, then press the one control on it that changes the record.
 *
 * Two presses in `clickLast` for `LOGBOOK_RECORDS_CLICK_LAST`'s reason: reaching a
 * finished workout has already spent `click`, `fill` and `clickAfter`. Edit is drawn by
 * the root beside Back rather than by the detail element, which is why the first
 * selector is scoped to `ptk-workout-detail` and this one is not.
 */
const LOGBOOK_EDIT_CLICK_LAST = [
  ...LOGBOOK_OPEN_CLICK_LAST,
  'ptk-training-logbook ptk-button[data-action="edit-workout"] button',
];

/**
 * A set row on the workout screen, which on this route can only be the editor.
 *
 * `ptk-active-workout` is on screen twice in this journey -- once while the session was
 * being logged and once here -- but the detail screen sits between them, so a row inside
 * that element after the last press is this screen and not the earlier one.
 */
const LOGBOOK_EDIT_SETTLE = ['ptk-active-workout li[data-set]'];

/**
 * The repeat route's journey with one set actually ticked off in the middle of it.
 *
 * `LOGBOOK_REPEAT_CLICK` finishes a session in which nothing was done, which is the
 * right shape for the disposition panel it exists to measure and the wrong one for a
 * history: an exercise history lists performed sets and nothing else, so that journey
 * leaves behind a workout the records screen correctly reports as never having been
 * trained. One `complete` press before the finish is the whole difference, and it is
 * what puts a marked row on the screen below.
 */
const LOGBOOK_RECORDS_CLICK = [
  ...LOGBOOK_START,
  'ptk-active-workout ptk-button[data-action="complete"] button',
  ...LOGBOOK_FINISH_CLICK,
  'ptk-active-workout .finish ptk-button[data-action="finish-confirm"] button',
  'ptk-training-logbook ptk-button[data-action="home"] button',
];

/**
 * Open the workout, then open the first lift on it.
 *
 * Two presses in `clickLast` rather than one because there is no earlier slot left --
 * getting to a finished workout has already spent `click`, `fill` and `clickAfter`.
 * The history control is drawn once per lift and `.first()` lands on the squat, which
 * is the lift whose set was ticked off above and therefore the only one with anything
 * to show.
 */
const LOGBOOK_RECORDS_CLICK_LAST = [
  ...LOGBOOK_OPEN_CLICK_LAST,
  'ptk-workout-detail ptk-button[data-action="open-exercise-history"] button',
];

/**
 * A marked set row, and the heaviest line above the list.
 *
 * The marker and not the row: `li[data-set]` here is much the arrangement the workout
 * screen already measures, and what is new is the line under it -- a phrase of four or
 * five words, in a wrapping flex row, inside a set row, inside a session card, which is
 * one level deeper than anything else in the tool puts a sentence.
 *
 * The heaviest line is named as well because it comes from the other half of the read.
 * A history whose sessions were listed and whose best was never computed draws a marked
 * row perfectly and is missing the widest single line on the screen -- a label, a load
 * and an ISO day on one row that has to wrap at 320px.
 */
const LOGBOOK_RECORDS_SETTLE = [
  'ptk-exercise-history .best > li',
  'ptk-exercise-history li[data-set] p.marks span[data-marker]',
];

/**
 * The planner's two tiles, then the picker over them.
 *
 * The picker is here for one thing only: the longest exercise name the catalogue
 * holds. Every name on this screen is the catalogue's -- `displayName` is
 * `option.name` and nothing on the planner types over it -- so the widest heading
 * the note row can ever be asked to sit beside is reached by choosing it, not by
 * inventing it. The two tiles come first because the fill list below is the plan
 * route's, unchanged: reusing it is what keeps a change to the planner one edit
 * rather than two that drift.
 *
 * The fold is opened here rather than in `clickAfter` for the reason the mixed
 * route opens it here: `pick` runs before that list and Playwright will not
 * answer a select it cannot see.
 */
const LOGBOOK_NOTES_CLICK = [...LOGBOOK_PLAN_CLICK, 'ptk-workout-builder ptk-disclosure summary'];

/**
 * The longest name in the catalogue, by position because that is all `pick` speaks.
 *
 * Derived rather than guessed, the way the mixed route's index is: the options are
 * grouped by loading model and sorted by name inside each group, so a placeholder
 * and fifteen barbell lifts sort ahead of this one. The same arithmetic puts the
 * first plain bodyweight movement at 39, which is the index that route uses.
 *
 * A catalogue edit that moves it is not a silent failure. The first settle
 * selector below names the heading this index has to produce, so an index that
 * lands on a shorter movement fails here rather than measuring a narrower screen
 * and reporting the widest one covered.
 */
const LOGBOOK_NOTES_CHOOSE = [{ selector: 'ptk-workout-builder ptk-select select', index: 16 }];

/**
 * Add the picked lift, start, and open the first exercise's note.
 *
 * The picked row's own weight box is deliberately left empty, and that is a
 * consequence of the slot order rather than a choice: `add-picked` cannot run
 * before `choose`, so the row does not exist when `fill` runs, and `fillAfter` --
 * the only fill left -- is what types the note this route exists for. A planned
 * weight is not what is being measured here, and five other logbook routes draw
 * one. What the empty box buys instead is a set row in a state no other route
 * reaches: a barbell lift with reps and no weight on it.
 *
 * The note button is `.first()`, which is the first exercise on the card. Its box
 * is what `fillAfter` types into, and the press in `clickLast` is what closes it
 * again -- so this is the note that ends up as the written line, and the last
 * exercise's is the one left open.
 */
const LOGBOOK_NOTES_CLICK_AFTER = [
  ...LOGBOOK_MIXED_ADD,
  ...LOGBOOK_START,
  'ptk-active-workout ptk-button[data-action="note"][data-note^="exercise:"] button',
];

/**
 * A note with a token in it that cannot be broken between two words.
 *
 * Invented (section 5.1), and hostile on purpose. `p.written` is drawn
 * `white-space: pre-wrap` so that a note typed as a list stays one, and pre-wrap
 * is exactly the setting under which a long unbroken run of characters stops
 * being wrapped -- `overflow-wrap: anywhere` beside it is what saves the page,
 * and a note of ordinary words would never ask it to. Sixty-odd characters, which
 * is wider than a 320px column at any of the five passes and far wider than one
 * at 220% text.
 *
 * Typed into the `textarea` inside the box rather than into the host: `fill`
 * needs a real editable control, and the host is a Lit element with the field in
 * its own shadow root. Playwright's CSS engine pierces it.
 */
const LOGBOOK_NOTES_FILL_AFTER = [
  {
    selector: 'ptk-active-workout ptk-text-area[data-note^="exercise:"] textarea',
    value:
      'Invented note -- felt heavy off the floor, cue: bracehardbeforethebaroverthemidfootandthenstand',
  },
];

/**
 * The last exercise's note button, which closes the box above and opens its own.
 *
 * Two presses would be the obvious way to reach both states and one is enough,
 * because this control does both: opening a second note writes the first. That
 * leaves the two surfaces on screen at once -- the typed note read back as a
 * muted line under the first heading, and an open box under the longest heading
 * in the catalogue -- which is the arrangement worth measuring and one no single
 * press could produce.
 *
 * Named through `section.exercise:last-of-type` and not by its `data-note` value:
 * the key carries `WorkoutExercise.id`, which is minted at runtime and is not a
 * string this file can know. `tap` takes `.first()`, which is the note button at
 * the top of the card, so the last section is the only way to name the other one.
 */
const LOGBOOK_NOTES_CLICK_LAST = [
  'ptk-active-workout section.exercise:last-of-type ptk-button[data-action="note"] button',
];

/**
 * The three things this route exists for, and none of them implies another.
 *
 * **The open box is named `[data-note^="exercise:"]` and never a bare
 * `ptk-text-area`.** The finish panel draws its own box, unconditionally and
 * already open, so the bare tag matches a screen this route never reached -- and
 * `/logbook/ (finishing)` is measuring that one already. The prefix says the box
 * on screen belongs to a lift, which only the press in `clickLast` can produce.
 * Qualified through the last section as well, because that is the box that press
 * opened rather than whichever one the template drew first.
 *
 * `p.written` is the other half and is the slower one: it is the note the fill
 * typed, written by the press above, handed to the root, and handed back down as
 * a new session. Nothing draws it until that round trip has completed, so it
 * cannot pass against a keystroke that landed in a box nobody closed.
 *
 * The heading is settled on first because it is what proves the picker's index
 * still names the movement this route was written around. Naming the string is
 * not the `pick` rule broken: these are `LIFTS` in `packages/domain`, this
 * repository's own source, and renaming one is a compile-visible edit that this
 * check failing is the correct answer to.
 */
const LOGBOOK_NOTES_SETTLE = [
  'ptk-active-workout section.exercise:last-of-type h3:text-is("Lying Triceps Extension")',
  'ptk-active-workout section.exercise:last-of-type ptk-text-area[data-note^="exercise:"]',
  'ptk-active-workout p.written',
];

/**
 * A backup file, as a lifter's disk would hold one.
 *
 * There is no control on the site that produces this screen from an empty
 * logbook: a backup arrives off a disk, and the picker that reads it opens a
 * native window nothing here can drive. So the file is handed straight to the
 * input, and without it the confirmation screen -- the one screen in the tool
 * whose whole job is to be read carefully before an irreversible press -- would
 * be measured at no width at all.
 *
 * Written out here rather than imported, for `LOGBOOK_HANDOFF_SEED`'s reason:
 * this file is plain `.mjs` and the package is TypeScript, so the only importable
 * copy is a build output. Drift is not silent. The screen renders only from a
 * document the package's own validator accepts, so a field renamed in that
 * package fails this check loudly rather than quietly measuring the home screen
 * under a label saying otherwise.
 *
 * Two sessions and not one, because the newest-sessions list is a list: a single
 * row cannot show what a second one does to the line above it. The titles are the
 * longest a person plausibly types beside a short one, and the second session has
 * none at all -- the screen writes "Untitled" there, and a column sized to the
 * long title is not the column that has to hold the short one.
 *
 * Every figure is invented (section 5.1).
 */
const LOGBOOK_RESTORE_FILE = JSON.stringify({
  format: 'platform-toolkit-training-logbook-backup',
  schemaVersion: 1,
  exportedAt: '2026-03-10T09:00:00.000Z',
  applicationVersion: '0.0.0-narrow',
  data: {
    settings: {
      schemaVersion: 1,
      displayUnit: 'kg',
      effort: 'none',
      restTimer: { enabled: false, defaultSeconds: 180, perExerciseSeconds: {} },
      equipment: null,
      acceptedTerms: {},
      lastBackupAt: null,
    },
    equipmentProfiles: [],
    exerciseDefinitions: [],
    activeWorkout: null,
    workouts: [
      aRestorableWorkout('older', '2026-02-17', null),
      aRestorableWorkout('newer', '2026-03-09', 'Tuesday, heavy squats and a long name on it'),
    ],
  },
});

/**
 * One finished session in that file.
 *
 * A function rather than two spelled-out objects: what the list draws is a day and
 * a title, and everything under those is the same session twice. Two copies of it
 * written out would be forty lines whose only differences are the three arguments
 * here.
 */
function aRestorableWorkout(prefix, localDate, title) {
  return {
    id: `${prefix}-workout`,
    schemaVersion: 1,
    status: 'completed',
    localDate,
    startedAt: `${localDate}T09:00:00.000Z`,
    completedAt: `${localDate}T10:00:00.000Z`,
    title,
    note: null,
    createdAt: `${localDate}T09:00:00.000Z`,
    updatedAt: `${localDate}T10:00:00.000Z`,
    source: 'manual',
    exercises: [
      {
        id: `${prefix}-exercise`,
        exerciseId: 'squat',
        displayName: 'Squat',
        loading: 'barbell-total-weight',
        warmup: null,
        note: null,
        sets: [
          {
            id: `${prefix}-set`,
            kind: 'working',
            planned: {
              load: { kind: 'implement', weight: { amount: 100, unit: 'kg' } },
              repetitions: 5,
              effort: null,
            },
            performed: {
              load: { kind: 'implement', weight: { amount: 100, unit: 'kg' } },
              repetitions: 5,
              effort: null,
            },
            status: 'complete',
            completedAt: `${localDate}T09:30:00.000Z`,
            note: null,
          },
        ],
      },
    ],
  };
}

const LOGBOOK_RESTORE_UPLOAD = [
  {
    selector: 'ptk-training-logbook input[type="file"]',
    name: 'platform-toolkit-training-logbook-backup-2026-03-10.json',
    mimeType: 'application/json',
    body: LOGBOOK_RESTORE_FILE,
  },
];

/**
 * The three things on that screen that arrive at their own moment.
 *
 * The counts, the sessions list and the press that cannot be taken back. Waiting
 * on the first alone would measure the list mid-render, which is placeholder-width
 * text rather than the layout at risk of overflowing.
 */
const LOGBOOK_RESTORE_SETTLE = [
  'ptk-training-logbook section.restore dl.facts dd',
  'ptk-training-logbook section.restore ul.sessions li',
  'ptk-training-logbook section.restore ptk-button[data-action="restore-confirm"] button',
];

/** Take the restore, so the two screens below have something to be about. */
const LOGBOOK_RESTORE_CONFIRM = [
  'ptk-training-logbook section.restore ptk-button[data-action="restore-confirm"] button',
];

const LOGBOOK_DELETE_OPEN = ['ptk-training-logbook ptk-button[data-action="delete-pick"] button'];

/**
 * The counts and the press, on the screen that is not the restore one.
 *
 * `section.erase` and not `section.restore`, which both carry: the two screens
 * share a layout deliberately, so a selector matching either would let this route
 * pass while sitting on the restore screen it was supposed to have left.
 */
const LOGBOOK_DELETE_SETTLE = [
  'ptk-training-logbook section.erase dl.facts dd',
  'ptk-training-logbook section.erase ptk-button[data-action="delete-confirm"] button',
];

/**
 * The offer to keep this on the device, which only exists once there is training.
 *
 * The button and not the section: the heading and the two sentences around it are
 * constants and would draw against a browser that answered nothing, so settling on
 * `section.keep` alone would measure a card the lifter cannot act on. The button is
 * also the part at risk -- its label is the longest control text on the home screen,
 * and at 320px and 200% text it is the one that stops fitting.
 *
 * An unmatched selector fails this check rather than skipping it, which is the answer
 * wanted here: the button is absent when the browser has already agreed to keep the
 * origin, and a fresh context per pass is what makes that not the case. If a Chromium
 * ever starts granting persistence unasked, this route saying so is better than it
 * quietly measuring a screen with no control on it.
 */
const LOGBOOK_KEEP_SETTLE = [
  'ptk-training-logbook section.keep ptk-button[data-action="persist-ask"] button',
  'ptk-training-logbook section.keep p.note',
];

/**
 * A session left on the origin by the warm-up calculator, as if a lifter had
 * just walked over from it.
 *
 * There is no control anywhere on the site that produces this screen -- the
 * record arrives from another page, through storage -- so a `click` list cannot
 * reach it and the offer card would be the one surface in the tool measured at
 * no width at all. Hence a `seed`, which is an init script rather than a
 * post-`goto` evaluate: the element reads the key once, when the page entry hands
 * it a reader, and a write that landed after that read would be a write the tool
 * never sees.
 *
 * The key and the version are written out here rather than imported. This file
 * is plain `.mjs` and the package is TypeScript, so the only importable copy is
 * a build output -- and the same contract is already spelled out in this file as
 * a list of `data-action` names. Renaming either is a compile-visible edit in
 * that package and this check failing is the correct answer to it.
 *
 * Every figure is invented (§5.1). The two lifts are chosen the way the planner's
 * are: the longest name the catalogue holds beside the shortest, so the list is
 * measured at both extremes, and a decimal weight because a decimal is a
 * character wider. The stamp is taken at page load because the reader refuses a
 * record over an hour old, and a fixed one would make this route start passing
 * for the wrong reason the first time nobody noticed.
 */
const LOGBOOK_HANDOFF_SEED = `
  localStorage.setItem(
    'ptk.logbook.warmup-handoff',
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      equipment: {
        barWeight: { amount: 20, unit: 'kg' },
        collarWeight: { amount: 2.5, unit: 'kg' },
        plateUnit: 'kg',
        plates: [
          { weight: 25, pairs: null, fullDiameter: true },
          { weight: 10, pairs: null, fullDiameter: true },
          { weight: 5, pairs: null, fullDiameter: false },
          { weight: 2.5, pairs: null, fullDiameter: false },
        ],
      },
      exercises: [
        {
          exerciseId: 'overhead-press',
          bar: null,
          workingWeight: 62.5,
          workingSets: 3,
          workingReps: 5,
          adjustments: [],
        },
        {
          exerciseId: 'squat',
          bar: null,
          workingWeight: 142.5,
          workingSets: 5,
          workingReps: 3,
          adjustments: [],
        },
      ],
    }),
  );
`;

/**
 * The offer's own list, and the storage line under everything.
 *
 * The list item and not the section: the card's heading and its two buttons are
 * drawn from constants and would be there against a record that parsed into
 * nothing, so settling on the section would measure an empty card and call the
 * screen covered. A row exists only where a lift in the record is one this build
 * can land.
 */
const LOGBOOK_HANDOFF_SETTLE = ['ptk-training-logbook .offer li', 'ptk-training-logbook p.save'];

/**
 * The storage line saying the write is *finished*, which is the only such signal.
 *
 * The two `revisit` routes below both reload a page whose last press started an
 * IndexedDB write, and a reload lands wherever the device got to -- so without
 * this the workout being carried across might be a transaction the navigation
 * cancelled. That failure is intermittent by construction: it depends on how
 * quickly a machine under a full `verify` finishes a round trip.
 *
 * The text rather than the class, which reads like the weaker contract and here
 * is the only one available: all four states render `p.save` and two of them
 * render it without `.warn`, so the class distinguishes "trouble" from "not
 * trouble" and never "saving" from "saved". `:text-is` and not `:has-text`,
 * because Playwright's substring engine is case-insensitive and "Not saved on
 * this device" -- the state where the browser gave the page no storage at all --
 * contains this string. `SAVE_STATE_NOTES` has no entry for `saved`, so the
 * paragraph holds exactly these four words and nothing is interpolated into it.
 */
const LOGBOOK_SAVED = ['ptk-training-logbook p.save:text-is("Saved on this device")'];

/**
 * A live session under the offer, which is the state the reload has to carry.
 *
 * A set row proves the session is on screen and the storage line proves it is on
 * the device, and only the second of those survives a navigation. Neither alone
 * is the condition: a session rendered but not yet written comes back from the
 * reload as no session at all, and the route would then measure the ordinary
 * offer card while reporting the busy one.
 */
const LOGBOOK_BUSY_HANDOFF_HOLDING = ['ptk-active-workout li[data-set]', ...LOGBOOK_SAVED];

/**
 * The two things the busy branch draws that the ordinary offer card does not.
 *
 * The line itself is named by the sibling that always precedes it. Both
 * paragraphs in the card are `p.note` and they differ only in position -- the
 * intro is above the list of lifts and this one is below it -- so `ul ~ p.note`
 * is the only way to say "the conditional one" without quoting a hundred
 * characters of copy. Moving it above the list breaks this loudly, which is the
 * right answer: the sentence explains the list it sits under.
 *
 * Resume is the second and comes from the other half of the state. The busy note
 * is drawn from `active !== null` read on the offer card, and Resume from the
 * same field read a section lower, so a screen with both on it is one where the
 * session came back out of storage rather than one where a template happened to
 * render. It is also the control at risk: it replaces the Start button with a
 * longer label under a sentence that is not there when the logbook is idle.
 *
 * Neither of these exists on the screen this route reloads away from, which is
 * what makes the reload falsifiable -- see {@link revisit}.
 */
const LOGBOOK_BUSY_HANDOFF_SETTLE = [
  'ptk-training-logbook .offer ul ~ p.note',
  'ptk-training-logbook ptk-button[data-action="resume-workout"] button',
  ...LOGBOOK_SAVED,
];

/**
 * A whole session, done and put away, which is what section 7.8's line needs.
 *
 * The line is drawn from a *completed* session holding the lift, so the walk has
 * to include the one press that records a set: a session finished with nothing
 * ticked off leaves a workout in the history that `previousPerformanceIn`
 * correctly reports as never having been trained, and the logging screen at the
 * end of this route would draw no line while every selector on the way still
 * matched. `LOGBOOK_RECORDS_CLICK` walks the same ground for the same reason.
 *
 * It ends at the finish rather than pressing Home, because Home is what the
 * reload replaces. Reading the history back through a fresh boot is the stronger
 * claim of the two: Home re-reads a database this tab has had open all along,
 * and the reload asks whether the session is on the *device*.
 */
const LOGBOOK_LAST_TIME_CLICK_AFTER = [
  ...LOGBOOK_START,
  'ptk-active-workout ptk-button[data-action="complete"] button',
  ...LOGBOOK_FINISH_CLICK,
  'ptk-active-workout .finish ptk-button[data-action="finish-confirm"] button',
];

/**
 * The finished screen, and the write under it.
 *
 * `#onFinished` sets the screen and starts the write in the same statement
 * without awaiting it, so the heading is on the page some milliseconds before the
 * session is on the device. The storage line is the half that matters here and
 * the region is named as well, because it is the one selector that says which of
 * the nine screens is up -- `p.save` alone would be satisfied by the logging
 * screen this route is supposed to have left.
 */
const LOGBOOK_LAST_TIME_HOLDING = [
  'ptk-training-logbook section.screen[aria-label="Workout finished"]',
  ...LOGBOOK_SAVED,
];

/**
 * Plan the same lift again on the far side of the reload.
 *
 * The squat and not both lifts: two would measure two copies of one line, and
 * what the second row would add is the gap between an exercise with history and
 * one without -- which is a real arrangement and is the plan route's, one section
 * apart from this one. One lift keeps the walk short enough to pay for five
 * times.
 *
 * These are presses and not more `clickAfter`, because `clickAfter` ran before
 * the navigation. The slot exists so that a route can drive the rebooted app to
 * the screen it names instead of stopping at whatever the boot lands on.
 */
const LOGBOOK_LAST_TIME_THEN = [
  'ptk-training-logbook ptk-button[data-action="start-workout"] button',
  'ptk-workout-builder ptk-button[data-exercise="squat"] button',
];

/**
 * A working weight on the new plan, deliberately unlike the one in the history.
 *
 * Invented (section 5.1), and heavier than the 142.5 the finished session was
 * logged at so that the two numbers on screen cannot be confused for each other:
 * the previous-performance line and the row under it are a weight above a weight,
 * and identical figures would make a line drawn from the wrong session look
 * right.
 */
const LOGBOOK_LAST_TIME_FILL_AFTER = [
  { selector: 'ptk-workout-builder li[data-row="0"] [data-field="weight"] input', value: '147.5' },
];

/**
 * Section 7.8's line, and the row it is context for.
 *
 * `p.previous` and not `p.note`: the class exists to separate the lifter's own
 * record read back from the tool talking about itself, and `#previousLine` says
 * in as many words that this reader is why. It cannot be drawn against an empty
 * history, so it is what proves the reload came back to a device that had kept
 * the session -- and it is absent from the finished screen this route reloads
 * away from, which is what makes the reload falsifiable.
 *
 * The set row is named as well because the arrangement is the pair. The line is a
 * day and a run of sets on one wrapping row above a card that has its own
 * heading, its own weight and its own controls, and a line measured before the
 * card is measured against a column nothing else is competing for.
 */
const LOGBOOK_LAST_TIME_SETTLE = [
  'ptk-active-workout p.previous',
  'ptk-active-workout li[data-set]',
];

/**
 * Switch the rest timer on, which is what makes everything below it exist.
 *
 * Section 7.11 leaves the feature optional and it defaults off, so a route that
 * skipped this press would walk a whole session and measure a logging screen with
 * no band on it -- which is the screen five other logbook routes already measure.
 *
 * Reached by the words in the segment for `LOGBOOK_EFFORT_CLICK`'s reason and with
 * the same reservation attached: `ptk-segmented` puts the value on the input as a
 * property, where no selector can see it, so the visible text is all there is.
 * Qualified through `[data-field="rest-setting"]` because the settings section now
 * holds three of these bars and `tap` takes `.first()` -- unqualified, this would
 * answer the unit question instead, silently, since "On" is not a word either of
 * the other two bars uses and the miss would land on the first bar rather than
 * failing.
 */
const LOGBOOK_REST_CLICK = [
  'ptk-training-logbook [data-field="rest-setting"] label.segment:has(span:text-is("On"))',
];

/**
 * The longest duration the picker offers, by position because that is all `pick`
 * speaks.
 *
 * Index 4 rather than 3: `ptk-select` always draws a placeholder option first, so
 * the seven presets sit at 1 through 7 and 150 seconds is the fourth of them. Its
 * label, "2 min 30 s", ties with "1 min 30 s" for the longest the list can hold,
 * and a select that shrink-wraps takes its closed width from the option chosen
 * rather than from the widest one available.
 *
 * A preset list edited to a different length does not fail silently here: `pick`
 * reports the option count when the index is past the end, and the settle below
 * names the control the answer has to have landed in.
 */
const LOGBOOK_REST_CHOOSE = [
  { selector: 'ptk-training-logbook [data-field="rest-duration"] select', index: 4 },
];

/**
 * The revealed picker, and the storage line under the whole card.
 *
 * The picker is drawn only where the timer is on, so naming it is naming the press
 * rather than a control that was always there. The save line is named as well
 * because it lands beneath everything being measured and can still push the card
 * taller -- `LOGBOOK_REPEAT_SETTLE` names it for the same reason.
 */
const LOGBOOK_REST_SETTLE = [
  'ptk-training-logbook [data-field="rest-duration"] select',
  'ptk-training-logbook p.save',
];

/** Switch the timer on, then plan the standard session over it. */
const LOGBOOK_RESTING_CLICK = [...LOGBOOK_REST_CLICK, ...LOGBOOK_PLAN_CLICK];

/**
 * Tick one set off, which is the only thing that starts a rest.
 *
 * `complete` on its own rather than `LOGBOOK_LOG_CLICK`, whose second press opens
 * the set editor: that editor is measured by three routes already, and all it would
 * add here is height under the band this route exists for.
 */
const LOGBOOK_RESTING_CLICK_AFTER = [
  ...LOGBOOK_START,
  'ptk-active-workout ptk-button[data-action="complete"] button',
];

/**
 * The last of the band's five controls, and the row whose tick started it.
 *
 * Dismiss is drawn last of the five, so waiting for it waits for the whole wrapping
 * row rather than for the first button in it. Nothing else in this collection puts
 * five controls on one line.
 *
 * The completed row is the second selector because the band and the card under it
 * are two elements with two independently scheduled renders, and the arrangement
 * this route exists to measure is the pair -- a session card pushed down the page by
 * a band that was not there a moment ago. Waiting on the band alone measures
 * whichever of the two happens to be later, some of the time.
 */
const LOGBOOK_RESTING_SETTLE = [
  'ptk-training-logbook ptk-rest-timer ptk-button[data-action="dismiss"] button',
  'ptk-active-workout li[data-set].done',
];

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
  { path: '/', click: INSTALL_CLICK, reveal: [], fill: [] },
  {
    path: '/platform-targets/',
    label: '/platform-targets/ (setup)',
    click: INSTALL_CLICK,
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
    click: [...WARM_UP_CLICK, ...INSTALL_CLICK],
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
    click: [...CONVERT_CLICK, ...INSTALL_CLICK],
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
    click: [...ONE_REP_MAX_CLICK, ...INSTALL_CLICK],
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
    click: [...MEET_DAY_CLICK, ...INSTALL_CLICK],
    reveal: [],
    fill: MEET_DAY_FILL,
    clickAfter: [...MEET_DAY_CLICK_AFTER, ...MEET_DAY_RECORD_CLICK],
    fillAfter: [...MEET_DAY_SHELF_FILL, ...MEET_DAY_RECORD_FILL],
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
      ...MEET_DAY_RECORD_SETTLE,
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
    clickAfter: [...MEET_DAY_COACH_LIFTER_CLICK_AFTER, ...MEET_DAY_RECORD_CLICK],
    fillAfter: [...MEET_DAY_COACH_LIFTER_FILL_AFTER, ...MEET_DAY_RECORD_FILL],
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
      // And §19's fold under a lifter who has already been on the platform,
      // which is the one thing only this route reaches: `takenOn` narrows what
      // the rules still allow, so the weight measured here is computed from a
      // declared attempt rather than from an empty list the way the plan route's
      // is. The two selectors are listed for the reason they are listed there.
      ...MEET_DAY_RECORD_SETTLE,
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
  {
    path: '/qualify/',
    click: INSTALL_CLICK,
    reveal: [],
    fill: QUALIFY_FILL,
    clickAfter: QUALIFY_CLICK_AFTER,
    chooseLast: QUALIFY_CHOOSE_LAST,
    settle: QUALIFY_SETTLE,
  },
  {
    path: '/qualify/embed/uspa/',
    click: [],
    reveal: [],
    fill: QUALIFY_FILL,
    clickAfter: QUALIFY_CLICK_AFTER,
    chooseLast: QUALIFY_CHOOSE_LAST,
    settle: QUALIFY_SETTLE,
  },
  {
    path: '/logbook/',
    label: '/logbook/ (home)',
    // One step, and only one: this is the whole screen a returning lifter lands
    // on, and everything else on it -- the storage sentence, the history, the
    // unit control, the backup fold -- is drawn before anything is pressed. The
    // other three entries all walk away from it, so without this row the landing
    // screen would be the one surface in the tool measured at no width at all.
    //
    // The rack editor is the exception because it ships folded, and a folded
    // section is measured as the one line it shows. Behind that line are the
    // widest controls in the tool: a row of plate switches and four radio groups,
    // at 320px, inside a section that is itself inside a card. Measuring the
    // summary and calling the section covered is how a two-plate row would reach
    // a phone sideways.
    click: [...LOGBOOK_RACK_CLICK, ...INSTALL_CLICK],
    reveal: [],
    fill: [],
    // The storage line is the last thing to arrive and the only thing here that
    // waits on anything: it is drawn from the repository, and the repository is
    // an IndexedDB open away.
    settle: LOGBOOK_HOME_SETTLE,
  },
  {
    // The library with something in it, which no other route reaches: every one
    // of them leaves the equipment section holding the "no saved gyms" line, so
    // the row that actually gets stored -- a name, a badge and two quiet buttons
    // side by side, inside a list, inside a fold, inside a card -- has never been
    // measured at any width. It is the deepest nesting in the tool and the one
    // place two buttons share a line.
    path: '/logbook/',
    label: '/logbook/ (saved gym)',
    click: LOGBOOK_LIBRARY_CLICK,
    reveal: [],
    fill: LOGBOOK_LIBRARY_FILL,
    clickAfter: LOGBOOK_LIBRARY_CLICK_AFTER,
    fillAfter: LOGBOOK_LIBRARY_FILL_AFTER,
    clickLast: LOGBOOK_LIBRARY_SAVE,
    settle: LOGBOOK_LIBRARY_SETTLE,
  },
  {
    // The exercise library with something in it and its form fully open, which no
    // other route reaches: every one of them leaves this section holding the
    // "nothing added yet" line above a four-question form with one question
    // hidden. The stored row is the same two-quiet-buttons shape the gym row has,
    // and the form above it is the only place a select, a segmented control and a
    // list-layout tick stack in one column.
    path: '/logbook/',
    label: '/logbook/ (saved exercise)',
    click: [],
    reveal: [],
    fill: LOGBOOK_EXERCISE_FILL,
    clickAfter: LOGBOOK_EXERCISE_SAVE,
    clickLast: LOGBOOK_EXERCISE_TICK,
    settle: LOGBOOK_EXERCISE_SETTLE,
  },
  {
    // The one screen in the tool a lifter is meant to stop and read: six counts
    // in a grid, the span the file covers, the newest sessions in it and two
    // presses, one of which replaces everything they have. At 320px the grid is
    // the question -- it is the only layout here that runs out of room for a
    // second column -- and at 200% text the long session title is.
    //
    // Reached by handing the input a file, because there is no other way: the
    // button beside it opens a native picker, and a picker is a window outside
    // the page.
    path: '/logbook/',
    label: '/logbook/ (restore)',
    click: [],
    reveal: [],
    fill: [],
    upload: LOGBOOK_RESTORE_UPLOAD,
    settle: LOGBOOK_RESTORE_SETTLE,
  },
  {
    // The other irreversible press, and the reason it is worth its own entry: the
    // warning above the buttons is the longest sentence in the tool, and at 320px
    // and at 200% text it is the line that runs out of room.
    //
    // Reached through the restore screen because the counts are the point. Opening
    // it on an empty logbook would measure three zeroes and the "nothing here"
    // line, which is the one arrangement of this screen that cannot overflow.
    path: '/logbook/',
    label: '/logbook/ (delete)',
    click: [],
    reveal: [],
    fill: [],
    upload: LOGBOOK_RESTORE_UPLOAD,
    clickAfter: LOGBOOK_RESTORE_CONFIRM,
    clickLast: LOGBOOK_DELETE_OPEN,
    settle: LOGBOOK_DELETE_SETTLE,
  },
  {
    // Section 10.3's offer, which is drawn only where the device holds something
    // and the browser has answered -- so it is reached the same way the delete
    // screen is, and for the same reason: on an empty logbook it does not exist.
    //
    // Its own entry rather than a settle added to the home row, because the offer
    // is between the settings and the backup card and only appears after a
    // restore, so the home row measures a page this one cannot be folded into.
    path: '/logbook/',
    label: '/logbook/ (keep)',
    click: [],
    reveal: [],
    fill: [],
    upload: LOGBOOK_RESTORE_UPLOAD,
    clickAfter: LOGBOOK_RESTORE_CONFIRM,
    settle: LOGBOOK_KEEP_SETTLE,
  },
  {
    // Its own entry rather than a seed on the home row, because the offer sits
    // above everything that row exists to measure and would push the rack fold
    // off the screen it was measured on.
    path: '/logbook/',
    label: '/logbook/ (handoff)',
    seed: LOGBOOK_HANDOFF_SEED,
    click: [],
    reveal: [],
    fill: [],
    settle: LOGBOOK_HANDOFF_SETTLE,
  },
  {
    // The same offer with a workout already running under it, which the card
    // answers by dropping Start and explaining why. It is a separate route and
    // not a longer version of the one above because the two are different
    // paragraphs at different heights, and it needs a reload because the app has
    // no path to it: Start is only drawn while nothing is active, resume only
    // goes the other way, and the one exit from a live session ends it. Booting
    // with the session on the device is how a lifter reaches this in the morning,
    // and it is the only way anyone reaches it.
    path: '/logbook/',
    label: '/logbook/ (handoff over a session)',
    seed: LOGBOOK_HANDOFF_SEED,
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    revisit: { holding: LOGBOOK_BUSY_HANDOFF_HOLDING },
    settle: LOGBOOK_BUSY_HANDOFF_SETTLE,
  },
  {
    path: '/logbook/',
    label: '/logbook/ (plan)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    settle: LOGBOOK_PLAN_SETTLE,
  },
  {
    path: '/logbook/',
    label: '/logbook/ (logging)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    clickLast: LOGBOOK_LOG_CLICK,
    settle: LOGBOOK_LOG_SETTLE,
  },
  {
    // The same screen for a lift that has been done before, which adds section
    // 7.8's line above the first card and had never been measured at any width:
    // every other route on this path opens on an empty logbook, and the line is
    // drawn only where a completed session already holds the lift. It is also the
    // longest single string the logging screen can draw -- a date and a whole run
    // of sets on one line -- so 320px is the width it is at risk on.
    //
    // Two sessions in one route, and no shorter version exists. The history has to
    // be a real workout in IndexedDB, which nothing here can seed without a second
    // copy of the record schema, so the first session is walked through the app's
    // own controls and the second is planned on the far side of the reload.
    path: '/logbook/',
    label: '/logbook/ (last time)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_LAST_TIME_CLICK_AFTER,
    revisit: { holding: LOGBOOK_LAST_TIME_HOLDING, then: LOGBOOK_LAST_TIME_THEN },
    fillAfter: LOGBOOK_LAST_TIME_FILL_AFTER,
    clickLast: LOGBOOK_START,
    settle: LOGBOOK_LAST_TIME_SETTLE,
  },
  {
    // §7.7's four changes to the shape of a lift. Three of them are a wrapping
    // flex row inside the editor, inside a list item, inside a card -- and the row
    // above them is Save on its own line, which makes the block the deepest wrap
    // point in the tool. The fourth, Add, is drawn under every lift from the first
    // paint, so the route above already measures it.
    path: '/logbook/',
    label: '/logbook/ (changing sets)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    clickLast: LOGBOOK_STRUCTURE_CLICK_LAST,
    settle: LOGBOOK_STRUCTURE_SETTLE,
  },
  {
    // Section 7.10's effort entry, which arrived as two surfaces and is measured
    // as one route.
    //
    // The editor's `.numbers` is `repeat(auto-fit, minmax(min(100%, 8rem), 1fr))`
    // and every route in this file has measured it holding two boxes. Three has
    // never been drawn at any width. auto-fit resolves its column count from the
    // element's own width, so a third track is a different arrangement rather
    // than more of the same one -- and the third box is the one that costs most
    // per track: 'Weight lifted' is the longer label, but the effort field is the
    // only one of the three carrying a hint sentence under it.
    //
    // The second surface is a set row with a `.set-effort` line on it, and that is
    // a height question rather than a width one. "RPE 8.5" cannot widen
    // `.set-what`; what it does is put a third stacked line into the left half of a
    // `space-between` flex row whose right half is two 44px buttons and which
    // already wraps at 320px. That is what the two text-scaling passes are for, and
    // it is the failure an ancestor with a height in pixels makes silently.
    //
    // One route and not two, because one press list reaches both -- see
    // `LOGBOOK_EFFORT_CLICK_LAST` for the press that does it.
    //
    // The home screen's settings section needs no route of its own. It went from
    // one bar and one sentence to two bars and three, but it is drawn from the
    // first paint behind no fold, so `/logbook/ (home)` already measures the whole
    // of it at all five passes and this route would only measure it again.
    //
    // What a green run here does not say anything about:
    //
    // - The RIR wording, anywhere. The editor is measured at its worse case, since
    //   the two field labels are the same length and RPE's hint is the longer -- but
    //   the note under the home bar is the *chosen* scale's explanation, the default
    //   is `none`, and RIR's sentence is the longest of the three. Nothing draws it.
    // - A long reading. Section 15.3 refuses nothing a lifter types, so the box holds
    //   whatever string goes in it and this types three characters. An 8rem track
    //   under a hostile entry is unmeasured, and unlike the unbuildable route's
    //   figure there is no honest ordinary value that reaches it.
    // - Effort on a movement with no weight box. A reps-only lift draws two boxes,
    //   and that pair is uneven in a way the weight/reps pair is not: one label with
    //   a sentence under it beside one without. It needs the picker and
    //   `LOGBOOK_MIXED_CHOOSE`'s index, which is a whole entry for a grid narrower
    //   than this one.
    // - A reading stored on the other scale. `#seedEffort` opens the box empty where
    //   the stored scale differs, so a row reading "RIR 2" under a box labelled
    //   'Effort (RPE)' is real and undrawn. No press list reaches it: `home` is
    //   rendered only on the finish panel, so changing the bar mid-session means
    //   ending the session first, and the sets are then behind a screen this route
    //   never visits.
    path: '/logbook/',
    label: '/logbook/ (effort)',
    click: LOGBOOK_EFFORT_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: [...LOGBOOK_START, ...LOGBOOK_LOG_CLICK],
    fillAfter: LOGBOOK_EFFORT_FILL_AFTER,
    clickLast: LOGBOOK_EFFORT_CLICK_LAST,
    settle: LOGBOOK_EFFORT_SETTLE,
  },
  {
    // A second logging entry rather than plates added to the one above, because
    // the two are different screens and the one without a rack is the one most
    // lifters see -- it is what the tool draws until somebody opens the equipment
    // section, and swapping it for this would trade a measured surface for a
    // measured surface. The framed entry below stays plateless for the same
    // reason: between them the no-rack logging screen is still measured twice.
    path: '/logbook/',
    label: '/logbook/ (loading)',
    click: LOGBOOK_LOADING_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    clickLast: LOGBOOK_LOG_CLICK,
    settle: LOGBOOK_LOADING_SETTLE,
  },
  {
    // The one logging screen where the plate diagram is replaced by prose. Every
    // other route on this tool measures a row of plate faces, which is a wide
    // element that cannot wrap; this measures the sentence drawn in its place,
    // which is a long one and must. The two are the same slot in the same row and
    // nothing else in this file has ever put text in it.
    path: '/logbook/',
    label: '/logbook/ (unbuildable weight)',
    click: LOGBOOK_COARSE_CLICK,
    reveal: [],
    fill: LOGBOOK_UNBUILDABLE_FILL,
    clickAfter: LOGBOOK_START,
    settle: LOGBOOK_UNBUILDABLE_SETTLE,
  },
  {
    // The planner explaining why one row has a warm-up tick and the other does
    // not. It needs a rack, a lift that can ramp and a movement that cannot, and
    // the third can only arrive through the picker -- so no existing route comes
    // close to it, and the picker itself has never been driven at any width.
    path: '/logbook/',
    label: '/logbook/ (mixed plan)',
    click: LOGBOOK_MIXED_CLICK,
    reveal: [],
    choose: LOGBOOK_MIXED_CHOOSE,
    fill: LOGBOOK_MIXED_FILL,
    clickAfter: LOGBOOK_MIXED_ADD,
    settle: LOGBOOK_MIXED_SETTLE,
  },
  {
    // The logging screen with a ramp on it, which no other route can reach: every
    // one of them plans working sets only, so the warm-up rows a session actually
    // opens with have never been measured at any width. It is also the longest card
    // the tool draws -- a squat ramp is five or six rows above the working sets, each
    // with its own plate diagram -- and the rack presses are borrowed from the
    // loading route because a tick is not offered at all until a rack exists.
    path: '/logbook/',
    label: '/logbook/ (warm-up)',
    click: LOGBOOK_LOADING_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_WARMUP_CLICK,
    clickLast: [],
    settle: LOGBOOK_WARMUP_SETTLE,
  },
  {
    path: '/logbook/',
    label: '/logbook/ (finishing)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    clickLast: LOGBOOK_FINISH_CLICK,
    settle: LOGBOOK_FINISH_SETTLE,
  },
  {
    path: '/logbook/',
    label: '/logbook/ (repeat)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_REPEAT_CLICK,
    settle: LOGBOOK_REPEAT_SETTLE,
  },
  {
    // Section 5.4's read-only screen, reached the only way it can be: the repeat
    // route's whole journey, then the other button on the row it leaves behind.
    // Nothing here has been measured at any width -- a set row is a kind, a load, a
    // status and sometimes an effort on one wrapping line, under an exercise heading,
    // inside a card, and the planned line beneath an edited set is longer than any of
    // them. The title a lifter typed heads the page and the ISO day sits under it,
    // which is the same pairing the history row has and at a different depth.
    path: '/logbook/',
    label: '/logbook/ (a workout read back)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_REPEAT_CLICK,
    clickLast: LOGBOOK_OPEN_CLICK_LAST,
    settle: LOGBOOK_OPEN_SETTLE,
  },
  {
    // The correcting screen, which is section 5.4's workout screen with the finish
    // control taken off and a line of explanation put above it. Most of what is here is
    // measured by `/logbook/ (logging)` and that is the point of reusing the element --
    // what nothing measures is the arrangement around it. The note is the longest
    // sentence the tool puts above a card, the actions row is down to a single primary
    // button where every other route has two, and the rows underneath are all in their
    // performed state at once, which on the logging routes only the last pass reaches.
    path: '/logbook/',
    label: '/logbook/ (a workout corrected)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_REPEAT_CLICK,
    clickLast: LOGBOOK_EDIT_CLICK_LAST,
    settle: LOGBOOK_EDIT_SETTLE,
  },
  {
    // Section 5.5's third read-only screen, and the only one whose rows carry a
    // second line. A set row on the two screens before this one is a kind, a load, a
    // status and sometimes an effort; here it can grow a `p.marks` under all of that,
    // and the phrases in it are the longest strings the tool draws -- long enough that
    // two of them wrap on their own at 320px, inside a row, inside a session card.
    //
    // The heading pair above the list is the other new arrangement: an ISO day and a
    // title a lifter typed, side by side in a flex row, which the history row draws on
    // two lines and this one does not.
    //
    // The journey is the repeat route's with one set ticked off part-way through, for
    // the reason `LOGBOOK_RECORDS_CLICK` gives -- a history of a workout in which
    // nothing was performed is a one-sentence screen, and measuring that instead would
    // be a pass about a surface this route was not written for.
    path: '/logbook/',
    label: '/logbook/ (an exercise read back)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_RECORDS_CLICK,
    clickLast: LOGBOOK_RECORDS_CLICK_LAST,
    settle: LOGBOOK_RECORDS_SETTLE,
  },
  {
    // Section 7.9's note surface, which arrived with two hazards nothing here
    // measured. The first is the head row a note button put on every exercise: an
    // `<h3>` and a 44px control in one `space-between` flex line, which is the
    // arrangement that overflows when the heading is long and the column is 320px.
    // The second is a `ptk-text-area` inside a card that has padding of its own --
    // a textarea takes its intrinsic width from `cols` rather than from its
    // container, and `width: 100%` with `box-sizing: border-box` in the element's
    // own shadow root is the whole of what stops it -- and this is the first time
    // the tool draws one there. The third thing on the screen is the written line,
    // which is where a lifter's unbroken token has to wrap.
    //
    // One entry rather than two, and the finish panel's box is the one deliberately
    // not given its own. That panel draws it open and unconditionally, so
    // `/logbook/ (finishing)` already measures it at all five passes -- a second
    // route would spend ten more page loads re-measuring a surface that is covered
    // and would say nothing about the box inside an exercise card, which is a
    // different container at a different depth.
    path: '/logbook/',
    label: '/logbook/ (notes)',
    click: LOGBOOK_NOTES_CLICK,
    reveal: [],
    choose: LOGBOOK_NOTES_CHOOSE,
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_NOTES_CLICK_AFTER,
    fillAfter: LOGBOOK_NOTES_FILL_AFTER,
    clickLast: LOGBOOK_NOTES_CLICK_LAST,
    settle: LOGBOOK_NOTES_SETTLE,
  },
  {
    // The settings section with the timer switched on, which is not the card
    // `/logbook/ (home)` measures: the switch reveals a duration picker that is drawn
    // nowhere else in the tool. Section 0.4 is why it is revealed rather than disabled,
    // and the consequence for this file is that the home route measures the section one
    // full-width control short of its tallest arrangement.
    //
    // Its own entry rather than a press folded into the route below, because that route
    // walks away from the home screen before anything is measured -- the picker is on a
    // screen no journey ending at the band still has open. The precedent is the effort
    // route, which correctly declined a home entry because its setting revealed nothing;
    // this one does.
    path: '/logbook/',
    label: '/logbook/ (rest timer settings)',
    click: LOGBOOK_REST_CLICK,
    reveal: [],
    choose: LOGBOOK_REST_CHOOSE,
    fill: [],
    settle: LOGBOOK_REST_SETTLE,
  },
  {
    // Section 7.11's band, which is the only thing this tool draws *above* a screen
    // rather than inside one. That makes its failure mode different from every other
    // route's: it can be laid out perfectly and still be wrong, by taking enough height
    // that the set a lifter is standing over goes off the bottom of a 320px handset.
    // Five controls in one wrapping flex row is more than anything else in the
    // collection puts on a line, and they are meant to wrap into rows of whole 44px
    // buttons rather than into a strip that hides the last one.
    //
    // The timer defaults off, so the press that switches it on is the first thing in
    // the list and the whole of what separates this from the logging route.
    //
    // What a green run here does not say anything about:
    //
    // - The rest running out. Pause comes off the row and "Rest is up." appears in the
    //   live region beside the heading, which is four controls and a sentence against
    //   five controls and a blank -- narrower, in a row that already wraps. Reaching it
    //   means waiting out the shortest preset per pass per width, which is minutes of
    //   wall clock for an arrangement strictly smaller than the one measured.
    // - A paused rest. Resume is a character shorter than Pause and the state line holds
    //   "Paused.", so it is the same trade as above for one more press.
    // - A ten-minute rest. `clampRestSeconds` allows one and the picker does not offer
    //   it, so the two-digit clock is only reachable through a restored backup. The
    //   digits are tabular and the widest preset is already 5:00, so the difference is
    //   one character in a line that is nowhere near the edge.
    path: '/logbook/',
    label: '/logbook/ (resting)',
    click: LOGBOOK_RESTING_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_RESTING_CLICK_AFTER,
    settle: LOGBOOK_RESTING_SETTLE,
  },
  {
    // One entry for the framed copy, the way meet-day gets one: the chrome around
    // it differs by a header and the tool inside it does not, so a second and
    // third framed screen would re-measure the same components at the same widths
    // for the cost of ten more page loads. The logging screen is the one to keep
    // -- it is the densest, and it is the screen a lifter is actually looking at
    // while the tool is doing its job.
    path: '/logbook/embed/',
    // Labelled like the rest of the tool's entries, though the path is unique.
    // A failure here reads beside eight others whose messages all name a screen,
    // and "the framed one" is not the useful half of what this measures.
    label: '/logbook/embed/ (logging)',
    click: LOGBOOK_PLAN_CLICK,
    reveal: [],
    fill: LOGBOOK_PLAN_FILL,
    clickAfter: LOGBOOK_START,
    clickLast: LOGBOOK_LOG_CLICK,
    settle: LOGBOOK_LOG_SETTLE,
  },
];

/** Kept in step with `--ptk-tap-target-min` in `packages/ui/src/tokens.css`. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page when a field takes focus. */
const MINIMUM_INPUT_FONT_SIZE = 16;

/**
 * How long something has to appear before `tap` calls it absent.
 *
 * Thirty seconds and not the ten it was. Both numbers are absurd for what this
 * measures -- a loopback server reading a directory, so the real wait is a few
 * frames -- and that is the argument for the larger one rather than against it.
 * A control that is genuinely missing is missing at ten seconds and at thirty
 * alike, so the only thing the shorter cap ever bought was a failure report
 * about a busy machine, and it bought three of those in one evening: the same
 * exercise tile at 390px, under a different route label each time, passing on a
 * re-run with nothing changed. The third took down a fresh-clone check, and
 * because `run-s` aborts, two later steps never ran at all.
 *
 * The cost of the larger number is bounded and lands only on a real failure: a
 * check that is going to fail takes twenty seconds longer to say so, once, while
 * the 225 measurements that decide its wall clock are unaffected.
 *
 * **Not a retry.** A route that fails on the first attempt and passes on the
 * second is a route whose result depends on the machine, and re-running it hides
 * that rather than removing it. Raise the cap so the first attempt is the true
 * one. `settled` below polls to its own budget, for the same reasons.
 */
const ARRIVAL_TIMEOUT_MS = 30_000;

/** `settled`'s budget, as a poll interval and a count: 20 s. */
const SETTLE_POLL_MS = 20;
const SETTLE_POLLS = 1_000;

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
 * Runs one action on a control, turning an actionability timeout into a failure.
 *
 * Playwright waits for a control to be visible, enabled and stable before it acts,
 * and throws a `TimeoutError` when it never gets there -- covered by something,
 * still animating, or disabled behind a read that has not answered. Every one of
 * those is a fact about the screen and belongs in the list with the others.
 *
 * Unguarded, that exception left `main` and killed the process mid-route. A run
 * that had already measured a hundred screens printed no failure list, no count and
 * no route name, and exited with the code a genuine layout failure uses -- so the
 * one thing this script exists to print was the thing that went missing, and the
 * only way to find out which screen it died on was to read a stack trace. It cost a
 * verify on 2026-08-07, on a workout-builder button that pressed fine on a rerun.
 *
 * Reporting it and moving on also means the remaining routes still run, so a real
 * layout regression somewhere after the wedged screen is not hidden behind it.
 *
 * @param {() => Promise<unknown>} act
 * @param {string} what
 * @param {string} selector
 * @param {string} where
 * @param {string[]} failures
 * @returns {Promise<boolean>}
 */
async function attempt(act, what, selector, where, failures) {
  try {
    await act();
    return true;
  } catch (caught) {
    // The name rather than the message. Playwright hangs its whole actionability
    // call log off the message, which is a dozen indented lines per entry in
    // something that is read as a list of one-line findings.
    const reason = caught instanceof Error ? caught.name : 'failed';
    failures.push(`${where}: could not ${what} ${selector} (${reason})`);
    return false;
  }
}

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
    if (!(await attempt(() => control.click(), 'press', selector, where, failures))) return false;
  }
  return true;
}

/**
 * Hands a file to a file input, failing where there is none.
 *
 * Its own slot rather than an entry in `fill`, because Playwright's `fill` refuses
 * a file input outright and the only way in is `setInputFiles`. The bytes are
 * built here rather than read off the disk: a fixture file in the repository is a
 * second thing to keep in step with the format, and this way the document and the
 * reasoning for it sit in one place.
 *
 * The input this drives is deliberately invisible -- a native file control cannot
 * be made to look like the rest of a page, so the tool clips it and puts a button
 * in front of it. `setInputFiles` does not require visibility, which is the only
 * reason the screen behind such a button can be measured at all.
 */
async function hand(page, uploads, where, failures) {
  for (const { selector, name, mimeType, body } of uploads) {
    const control = page.locator(selector).first();
    // Waits rather than counting, for `tap`'s reason.
    try {
      await control.waitFor({ state: 'attached', timeout: ARRIVAL_TIMEOUT_MS });
    } catch {
      failures.push(`${where}: nothing matched ${selector}`);
      return false;
    }
    const file = { name, mimeType, buffer: Buffer.from(body, 'utf8') };
    const handed = await attempt(
      () => control.setInputFiles(file),
      'hand a file to',
      selector,
      where,
      failures,
    );
    if (!handed) return false;
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
    // Waits rather than counting, for the reason `tap` does and for one more of
    // its own. A picker in `chooseLast` can be *conjured by the picker before
    // it*: answering `/qualify/`'s division question is what resolves the
    // registration, and resolving it is what draws the meet panel underneath.
    // Lit renders on a microtask, so `count()` on the tick after `selectOption`
    // asks whether a component has caught up rather than whether the page has
    // the control -- and the answer would decide a layout check. A selector that
    // never appears still fails, with the same message, a few seconds later.
    try {
      await control.waitFor({ state: 'attached', timeout: ARRIVAL_TIMEOUT_MS });
    } catch {
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
    const choose = () => control.selectOption({ index });
    if (!(await attempt(choose, 'answer', selector, where, failures))) return false;
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
    const type = () => field.fill(value);
    if (!(await attempt(type, 'type into', selector, where, failures))) return false;
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
 * Loads the route a second time, so the screen is rebuilt from what was kept.
 *
 * WHY A SECOND NAVIGATION IS A STEP AT ALL
 *
 * Two screens in the logbook need one and neither is reachable without it. The
 * handoff card's busy branch wants a seeded record, a live session and the home
 * screen at once, and there is no control that returns home from a live session
 * -- the only exit is finish, which ends it (#93). Section 7.8's
 * previous-performance line wants a completed session already in IndexedDB, which
 * no `seed` can write: a workout is a schema-validated record in an object store,
 * so an init script that wrote one would be a second copy of the valibot schema
 * living in this directory, racing the application's own `openLogbookStore()`
 * (#94). Reloading answers both, because the thing both screens are actually
 * about is state the *device* kept -- and the only writer that can put a workout
 * there without duplicating the schema is the application, driven through its own
 * controls by the press lists above.
 *
 * WHY IT IS THE MOST DANGEROUS STEP IN THIS FILE
 *
 * Every other step adds something to a screen. This one throws a screen away. The
 * tool boots to its home screen, so a route whose earlier presses failed to leave
 * anything behind still arrives *somewhere* that renders -- and a settle list that
 * happens to match the home page would then report a clean measurement of the
 * wrong screen, under a label naming the right one. That is worse than the gap
 * #93 and #94 were filed about, because a gap is visible in the route list and
 * this is not.
 *
 * So a revisit is falsifiable from both sides, and neither half is optional:
 *
 *   - `holding` is what has to be on screen at the moment of the reload. It says
 *     what the reload is being asked to carry, and it fails before the navigation
 *     rather than eight seconds after it, which is the difference between a report
 *     naming the press that did not land and one naming a screen that did not
 *     arrive. A revisit that holds nothing is refused outright.
 *   - At least one `settle` selector has to be *absent* before the reload. If
 *     everything the route waits for was already on screen, the reload proves
 *     nothing -- the same run, with the navigation deleted, would pass. Requiring
 *     all of them to be absent would be wrong: the storage line is on every screen
 *     this tool draws and is worth settling on either side.
 *
 * `then` is the press list for the rebooted app, and it is a separate slot rather
 * than more entries in `clickAfter` because that list has already run. Without it
 * a revisit could only ever end a route on the boot screen, which is one of the
 * two screens wanted here and not the other.
 *
 * @param {import('playwright').Page} page
 * @param {{settle?: readonly string[], revisit?: {holding: readonly string[], then?: readonly string[]}}} route
 * @param {{width: number, textScale: number}} pass
 * @param {string} where
 * @param {string[]} failures
 * @returns {Promise<boolean>}
 */
async function revisit(page, route, pass, where, failures) {
  const step = route.revisit;
  if (step === undefined) return true;

  if (step.holding.length === 0) {
    failures.push(`${where}: a revisit that holds nothing cannot say what the reload carried`);
    return false;
  }

  for (const selector of step.holding) {
    if (!(await settled(page, selector))) {
      failures.push(`${where}: ${selector} was not on screen when the page was reloaded`);
      return false;
    }
  }

  // Counted after `holding` has settled, so this is the finished pre-reload
  // screen rather than one caught mid-render -- a selector that is merely late
  // would otherwise read as one the reload conjured.
  const already = await Promise.all(
    (route.settle ?? []).map((selector) => page.locator(selector).first().count()),
  );
  if (already.length === 0 || already.every((count) => count > 0)) {
    failures.push(
      `${where}: nothing this route settles on is missing before the reload, so the reload proves nothing`,
    );
    return false;
  }

  await page.reload({ waitUntil: 'networkidle' });

  // The reload discards the declaration `main` wrote through the CSSOM after the
  // first navigation, and nothing downstream would notice: the two 200% passes
  // and the headroom pass would measure this screen at the browser's own text
  // size and report a pass on a question they never asked.
  if (pass.textScale !== 1) {
    await page.evaluate(textSizeExpression(pass.textScale));
  }

  return tap(page, step.then ?? [], where, failures);
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
    if (!(await attempt(() => control.check(), 'tick', selector, where, failures))) return false;
  }

  // Pickers after tiles, and not arrangeable the other way round: a weight class
  // list is empty until a sex category has been answered above, so a picker
  // driven first would be a select with one placeholder in it.
  if (!(await pick(page, route.choose ?? [], where, failures))) return false;

  if (!(await enter(page, route.fill, where, failures))) return false;

  // A file is an answer like a typed number, so it goes in beside the other
  // answers rather than among the presses -- and after them, because the input it
  // is handed to is drawn on the screen the presses above arrive at.
  if (!(await hand(page, route.upload ?? [], where, failures))) return false;

  // Folds that do not exist until the fields above have been answered. The
  // estimator's percentage table and formula comparison render nothing at all
  // without an estimate, so pressing them in `click` would report "nothing
  // matched" -- a true statement about a state the check itself produced, and
  // one that would push somebody to weaken the unmatched-selector failure into
  // a skip, which is the thing that makes this file stop checking.
  if (!(await tap(page, route.clickAfter ?? [], where, failures))) return false;

  // The reload sits here and not lower down because everything above it is how a
  // route puts something on the device worth keeping, and everything below it is
  // how a route drives the app that came back. Both logbook routes that use it
  // need presses on the far side, so it cannot be last.
  if (!(await revisit(page, route, pass, where, failures))) return false;

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

  // Pickers that do not exist until something above was pressed. `/qualify/` is
  // the case and the reason this is a second picker slot rather than more
  // entries in `choose`: the registration questions are drawn from a result the
  // reader typed and submitted, so the weight-class and division selects come
  // into being after `fill` and after the press in `clickAfter` -- and `choose`
  // runs before both, where they are not on the page to answer. Two of the five
  // answers unanswered means the registration does not resolve, so the meet
  // panel and the standing report never render and the widest half of that
  // screen would go unmeasured behind a clean pass.
  //
  // Same function as `choose`, deliberately, so the two cannot drift into
  // disagreeing about what a missing picker means. It means the same in both: a
  // failure, never a skip.
  if (!(await pick(page, route.chooseLast ?? [], where, failures))) return false;

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
 *
 * Twenty seconds, having been two and then eight. The logbook routes reach their
 * screen by writing a workout to IndexedDB and reading it back, and under the load
 * of a full `verify` that round trip does not always finish inside two. Each raise
 * has been made against the same evidence -- a route that fails once and passes on
 * a re-run with nothing changed -- and against the same reasoning: a poll costs
 * nothing when it succeeds, so the only thing a longer cap buys a genuine failure
 * is a slower report of it. Kept in step with `ARRIVAL_TIMEOUT_MS`, whose docblock
 * has the rest of the argument.
 */
async function settled(page, selector) {
  const target = page.locator(selector).first();
  for (let attempt = 0; attempt < SETTLE_POLLS; attempt += 1) {
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
    await page.waitForTimeout(SETTLE_POLL_MS);
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
        // Before the navigation, and not after it: a route seeded this way is one
        // whose screen is produced by state the site itself has no control for,
        // and the page reads that state while it boots.
        if (route.seed !== undefined) await page.addInitScript(route.seed);
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
