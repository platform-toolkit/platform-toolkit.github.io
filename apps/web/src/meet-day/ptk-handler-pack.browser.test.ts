// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.2: twelve lifters across a page, and the columns nobody filled in.
 *
 * `pack.ts` decided every weight, identifier, handler and clash on this sheet
 * and has its own suite, so nothing here re-asserts a number. What belongs to
 * this file is the layout's two structural promises, both of which a sheet can
 * break while still looking finished:
 *
 * The first is that **a lift row is three cells whatever is on them**. Eight of
 * the nine cells on a roster printed before a flight are empty, and a template
 * that drew only the declared weights would satisfy every assertion about the
 * weights that *are* there while handing a handler three ragged rows they cannot
 * read down. So the cells are counted per row, on a sheet with one weight on it
 * and on a sheet with none.
 *
 * The second is that **an empty column is drawn rather than dropped**. Flight,
 * platform, rack settings and results are not in this tool's hands, and §23.2
 * asks for them anyway -- a column the tool silently omitted reads as one it
 * forgot, on a sheet whose whole purpose is being the thing left when the phone
 * is dead. The ruled line under each of them is a computed border, which is why
 * this is a real browser and not jsdom: a blank drawn with no rule under it is
 * the failure and it is invisible to anything reading markup.
 *
 * WHY THE PRINT RULES ARE READ OUT OF THE CSSOM
 *
 * The same reason `ptk-meet-pack.browser.test.ts` gives: a browser running a
 * test is not printing, so `getComputedStyle` reports the screen half only.
 * `printRule` reads the parsed `@media print` block instead. It cannot see
 * whether a selector matches anything, so each one is paired with an ordinary
 * DOM assertion naming the same selector.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { printRule } from '../testing/print-rules.js';
import { BOARD_LIFTERS } from './board-fixture.js';
import {
  benchOnlyHandlerPack,
  clashingHandlerPack,
  handlerPackOf,
  undeclaredHandlerPack,
} from './pack-fixture.js';
import type { HandlerPack } from './pack.js';
import { PtkHandlerPack } from './ptk-handler-pack.js';
import './ptk-handler-pack.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(pack: HandlerPack = handlerPackOf()): Promise<PtkHandlerPack> {
  const element = document.createElement('ptk-handler-pack');
  element.pack = pack;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkHandlerPack, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textOf(element: PtkHandlerPack, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The roster has no ${selector}.`);
  return found.textContent.trim();
}

/** The declared-or-blank cells on one lift row, which must always be three. */
function cellsIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll(':scope > .weight, :scope > .unset')].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

describe('ptk-handler-pack', () => {
  /*
   * ---------------------------------------------------------------------------
   * A card per lifter, which is §27 answered at the width that forced it.
   * ---------------------------------------------------------------------------
   */

  it('prints one block per lifter with the name and the board identifier on it', async () => {
    const element = await mount();

    expect(query(element, '.lifter')).toHaveLength(3);
    // Both, and in that order: §21 makes the identifier the thing a handler
    // shouts across a warm-up room, and a sheet carrying only names is unusable
    // the moment two lifters share a first name.
    for (const name of BOARD_LIFTERS) {
      expect(deepText(element)).toContain(name);
    }
    expect(query(element, '.identifier').map((cell) => cell.textContent.trim())).toEqual([
      '12',
      '31',
      '48',
    ]);
  });

  it('draws no colour anywhere, on a sheet that knows every lifter colour', async () => {
    const element = await mount();

    // The fixture gives all three lifters a colour and this element renders none
    // of them. Two reasons, both in the source: a value off somebody else's
    // device does not reach a style attribute without a `CSS.supports` check
    // (§13.12), and a colour is worth nothing on a monochrome printer -- which
    // is every printer this sheet will meet. Asserted as the absence of an
    // inline style rather than of one hex string, so a swatch added later fails
    // here whatever colour the fixture happens to carry.
    expect(element.shadowRoot?.querySelector('[style]')).toBeNull();
    expect(element.shadowRoot?.innerHTML ?? '').not.toContain('c2410c');
  });

  it('fits a phone-width column with a whole flight on the sheet', async () => {
    const element = await mount();
    element.style.width = '320px';
    element.style.display = 'block';
    await element.updateComplete;

    expect(element.scrollWidth).toBeLessThanOrEqual(320);
  });

  /*
   * ---------------------------------------------------------------------------
   * Three cells a row, whatever is on them.
   * ---------------------------------------------------------------------------
   */

  it('gives every lift row three cells whether or not a weight was declared', async () => {
    const started = await mount();
    const undeclared = await mount(undeclaredHandlerPack());

    // Three lifters times three lifts on the first sheet, one lifter's three on
    // the second, and every row three cells wide on both. A template that drew
    // only the declared weights passes any assertion about the weight that *is*
    // there and leaves a handler with rows of different widths, on the sheet
    // whose one job is being read down a column.
    const rows = [...query(started, '.lift'), ...query(undeclared, '.lift')];
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => cellsIn(row).length)).toEqual(Array.from({ length: 12 }, () => 3));
  });

  it('rules a line under an attempt nobody has declared', async () => {
    const element = await mount(undeclaredHandlerPack());
    const [blank] = query(element, '.unset');
    if (blank === undefined) throw new Error('The undeclared roster has no blank cells.');

    // Nine blanks and no weights, each with a rule under it to write on. The
    // rule is the point: a blank with nothing under it reads as a weight the
    // tool failed to print rather than as a cell for the handler's pen, and this
    // is the sheet printed *before* the flight, at the expeditor's table.
    expect(query(element, '.unset')).toHaveLength(9);
    expect(query(element, '.weight')).toHaveLength(0);
    expect(getComputedStyle(blank).borderBottomStyle).toBe('solid');
    expect(Number.parseFloat(getComputedStyle(blank).borderBottomWidth)).toBeGreaterThan(0);
  });

  it('prints one lift for a bench-only meet rather than two rows of blanks', async () => {
    const benchOnly = await mount(benchOnlyHandlerPack());
    const fullPower = await mount();

    // Both halves, because a sheet with a fixed squat/bench/deadlift block
    // satisfies the full-power assertion perfectly and prints two lifts nobody
    // at this meet is contesting.
    expect(query(benchOnly, '.lift')).toHaveLength(3);
    expect(query(fullPower, '.lift')).toHaveLength(9);
  });

  /*
   * ---------------------------------------------------------------------------
   * §16's pound column, and who is on the lifter.
   * ---------------------------------------------------------------------------
   */

  it('prints the published pound figure beside a declared weight and nothing where there is no chart', async () => {
    const charted = await mount();
    const chartless = await mount(clashingHandlerPack());

    expect(query(charted, '.weight')).toHaveLength(1);
    expect(query(charted, '.pounds').length).toBeGreaterThan(0);
    // §16 forbids the approximate conversion, and this is the sheet where it
    // would cost most: a handler reads this figure aloud at the expeditor's
    // table, where a hedged number loses its hedge. The chartless roster has two
    // declared weights on it, so the absence here is a decision rather than an
    // empty sheet.
    expect(query(chartless, '.weight')).toHaveLength(2);
    expect(query(chartless, '.pounds')).toHaveLength(0);
    expect(deepText(chartless)).not.toContain('lb');
  });

  it('says nobody is assigned rather than leaving the handler column empty', async () => {
    const element = await mount();
    const handlers = query(element, '.handlers').map((cell) => cell.textContent.trim());

    // One named handler and two who are not, from one fixture, because a sheet
    // printing the fallback everywhere and a sheet printing the name everywhere
    // both pass a one-sided assertion. An empty line here reads as a column the
    // tool forgot, on the sheet whose job is saying who to shout at.
    expect(handlers).toHaveLength(3);
    expect(handlers.at(0)).toContain('Kit Marlowe');
    expect(handlers.slice(1)).toEqual(['Nobody assigned', 'Nobody assigned']);
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.2's clashes, in the roster's own words.
   * ---------------------------------------------------------------------------
   */

  it('prints a clash as a labelled warning and never as the code behind it', async () => {
    const clashing = await mount(clashingHandlerPack());
    const quiet = await mount();
    const warnings = query(clashing, '.clashes li').map((row) => row.textContent.trim());

    expect(warnings.length).toBeGreaterThan(0);
    expect(query(quiet, '.clashes')).toHaveLength(0);
    for (const warning of warnings) {
      // A code with no label prints an empty bullet, and an empty bullet under
      // "Clashes" reads on paper as a line somebody tore off. Matched against
      // the shape of a code rather than against `packConflictLabel`, whose
      // output would move with the code and go on passing (§13.8).
      expect(warning).not.toBe('');
      expect(warning).not.toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('does not name the other lifter in a clash, because the other lifter is a row on the sheet', async () => {
    const element = await mount(clashingHandlerPack());
    const warnings = query(element, '.clashes li').map((row) => row.textContent.trim());

    // The board's own sentence names who you are clashing with, which is right
    // on a screen read one row at a time. Here they are the rows above and
    // below, so twelve rows each naming two others is a page of names and no
    // warnings. The names are on the sheet as a control -- the assertion is that
    // they are not *in the warning*, not that they are absent.
    expect(warnings.length).toBeGreaterThan(0);
    for (const name of BOARD_LIFTERS) {
      expect(deepText(element)).toContain(name);
      for (const warning of warnings) {
        expect(warning).not.toContain(name);
      }
    }
  });

  /*
   * ---------------------------------------------------------------------------
   * The columns the tool was never told.
   * ---------------------------------------------------------------------------
   */

  it('leaves a ruled line for each column this tool does not hold, and says why', async () => {
    const element = await mount();
    const [rule] = query(element, '.write-in .rule');
    if (rule === undefined) throw new Error('The roster has no write-in lines.');

    expect(query(element, '.write-in .line')).toHaveLength(4);
    expect(getComputedStyle(rule).borderBottomStyle).toBe('solid');
    expect(Number.parseFloat(getComputedStyle(rule).borderBottomWidth)).toBeGreaterThan(0);
    // The sentence is what separates an empty column from a forgotten one. It is
    // not an omission notice -- these sections are present and blank on purpose,
    // because nothing in this tool is told a flight order or a rack height.
    expect(textOf(element, '.write-in .muted')).toContain('on purpose');
  });

  /*
   * ---------------------------------------------------------------------------
   * The paper half.
   * ---------------------------------------------------------------------------
   */

  it('forces black on white in print, because a dark theme prints as a blank page', async () => {
    const element = await mount();

    // The DOM half of the pair: `printRule` proves the rule exists and sets what
    // it claims, and cannot see whether anything matches the selector.
    expect(element.shadowRoot?.querySelector('.sheet')).not.toBeNull();
    const host = printRule(PtkHandlerPack.styles, ':host');
    expect(host.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
    expect(host.getPropertyValue('background')).toContain('rgb(255, 255, 255)');
  });

  it('keeps one lifter on one side of a page fold', async () => {
    const element = await mount();

    expect(query(element, '.lifter').length).toBeGreaterThan(0);
    // A name at the foot of a page with the weights overleaf is a handler
    // holding the half of the row that does not matter. The border is asserted
    // alongside it because a rule with no colour of its own inherits a theme
    // variable the printer has never heard of, and the rows are what separates
    // twelve lifters printed at `gap: 0`.
    const lifter = printRule(PtkHandlerPack.styles, '.lifter');
    expect(lifter.getPropertyValue('break-inside')).toBe('avoid');
    expect(lifter.getPropertyValue('border-top')).toContain('rgb(0, 0, 0)');
  });

  it('keeps every ruled line visible on paper, blanks and write-in columns alike', async () => {
    const element = await mount();

    expect(query(element, '.unset').length).toBeGreaterThan(0);
    expect(query(element, '.write-in .rule').length).toBeGreaterThan(0);
    // Named with the whole comma-separated selector because that is what the
    // CSSOM calls a grouped rule, and matching one of the two would be the
    // substring search `print-rules.ts` exists to avoid. Both DOM assertions
    // above are needed: the rule is green for a selector nothing matches.
    expect(
      printRule(PtkHandlerPack.styles, '.unset, .write-in .rule').getPropertyValue('border-bottom'),
    ).toContain('rgb(0, 0, 0)');
  });

  /*
   * ---------------------------------------------------------------------------
   * §5.8.
   * ---------------------------------------------------------------------------
   */

  it('has no axe violations with a whole flight on the sheet', async () => {
    const element = await mount();

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no axe violations on the roster printed before anything was declared', async () => {
    const element = await mount(undeclaredHandlerPack());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
