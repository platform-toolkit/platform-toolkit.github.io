// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §9.4 on the screen: what the meets before this one say, and the sentences that
 * stand in for the parts of it that are empty.
 *
 * `calibrateFrom` decided every figure and has its own suite in the domain, so
 * nothing below re-asserts a median or a count. What is this file's own is the
 * rule the element was written for, which it inherits from `ptk-meet-summary`
 * one screen up and which is sharper here: **no section is ever dropped, and
 * every empty one flatters.** A missing missed-jump figure means the lifter has
 * never missed; a missing cluster means no lift stands out. Rendered as nothing,
 * both read as a panel that has not finished loading.
 *
 * So every section is asserted in both of its states, and the empty one is
 * asserted as a **sentence** rather than as a heading over nothing.
 *
 * WHERE THE STATES COME FROM
 *
 * Out of `calibration-fixture.ts`, every one of them through `calibrateFrom`, so
 * none is a report the domain could not produce. Its header explains why the
 * figures are all distinct; the short version is that a row reading 12.5 says
 * both which lift it came from and which of the two jump questions it answered,
 * so an assertion cannot pass against the wrong row.
 *
 * WHY SO FEW ASSERTIONS NAME A FUNCTION FROM `copy.ts`
 *
 * §13.8's rule, arriving for the seventh time in this directory: an assertion
 * whose expected value is computed by the module under test moves with the code
 * and goes on passing under exactly the mutation it was written to catch. So each
 * test below reads two states through one selector, asserts they differ, and pins
 * one literal fragment of the one it is about.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { CalibrationReport, WeightUnit } from '@platform-toolkit/domain';

import {
  aRecord,
  neverMissed,
  noHistory,
  oneMeet,
  withMeetsOutOfScope,
} from './calibration-fixture.js';
import type { PtkMeetCalibration } from './ptk-meet-calibration.js';
import './ptk-meet-calibration.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  report: CalibrationReport = aRecord(),
  unit: WeightUnit = 'kg',
): Promise<PtkMeetCalibration> {
  const element = document.createElement('ptk-meet-calibration');
  element.report = report;
  element.unit = unit;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkMeetCalibration, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textsOf(element: PtkMeetCalibration, selector: string): string[] {
  return query(element, selector).map((found) => found.textContent.trim());
}

function textOf(element: PtkMeetCalibration, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The panel has no ${selector}.`);
  return found.textContent.trim();
}

/**
 * One figure's row, by lift position and then by the field it measures.
 *
 * Named by field rather than by position because the five are built as data and
 * a positional lookup would go on passing if two of them swapped -- which is the
 * failure `#rowsFor` exists to prevent, so a test that could not see it would be
 * measuring the wrong thing.
 */
function rowIn(element: PtkMeetCalibration, liftIndex: number, field: string): HTMLElement {
  const lift = query(element, 'section.lift').at(liftIndex);
  if (lift === undefined) throw new Error(`The panel has no lift at ${String(liftIndex)}.`);
  const found = lift.querySelector(`li.row.${field}`);
  if (!(found instanceof HTMLElement)) throw new Error(`That lift has no ${field} row.`);
  return found;
}

/**
 * Every match inside one row, which is how a line is asserted *absent*.
 *
 * A `.textContent` assertion on the row would be satisfied by any sibling saying
 * something similar, which is the failure §13.12 records.
 */
function queryIn(block: HTMLElement, selector: string): HTMLElement[] {
  return [...block.querySelectorAll(selector)].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textIn(block: HTMLElement, selector: string): string {
  const found = block.querySelector(selector);
  if (found === null) throw new Error(`That row has no ${selector}.`);
  return found.textContent.trim();
}

describe('ptk-meet-calibration', () => {
  /*
   * ---------------------------------------------------------------------------
   * The rule the panel exists for. Everything after this is one section of it.
   * ---------------------------------------------------------------------------
   */

  it('keeps both headings on the panel for a lifter with no history, each over a sentence', async () => {
    const empty = await mount(noHistory());
    const full = await mount();

    expect(textsOf(empty, '.calibration > section > h4')).toHaveLength(2);
    expect(textsOf(full, '.calibration > section > h4')).toEqual(
      textsOf(empty, '.calibration > section > h4'),
    );

    // The lift list is the one section that can be empty as a whole, and it says
    // so rather than leaving its heading bare.
    expect(textOf(empty, '.lifts .empty')).toContain('No lifts to compare yet');
    expect(query(full, '.lifts .empty')).toEqual([]);

    // The cluster section is never empty in either direction: both states carry a
    // sentence, and they are not the same sentence.
    expect(textOf(empty, '.cluster .what').length).toBeGreaterThan(0);
    expect(textOf(full, '.cluster .what')).not.toBe(textOf(empty, '.cluster .what'));
  });

  /*
   * ---------------------------------------------------------------------------
   * What was read, which every figure below is drawn from.
   * ---------------------------------------------------------------------------
   */

  it('separates no history at all from a history that was read, and names the scope in both', async () => {
    const empty = await mount(noHistory());
    const full = await mount();

    expect(textOf(empty, '.read')).not.toBe(textOf(full, '.read'));
    expect(textOf(empty, '.read')).toContain('No earlier');
    expect(textOf(full, '.read')).toContain('5 earlier meets');

    // The scope is on both lines deliberately: a lifter with no *raw* meets and a
    // lifter with no meets at all are being told different things, and the panel
    // that drops the scope tells them the same one.
    for (const element of [empty, full]) {
      expect(textOf(element, '.read')).toContain('raw meets');
    }
  });

  it('says what it left out only when something was left out', async () => {
    const partial = await mount(withMeetsOutOfScope());
    const whole = await mount();

    expect(textOf(partial, '.out-of-scope')).toContain('2 meets were');
    expect(query(whole, '.out-of-scope')).toEqual([]);

    // The two shelves read the same number of meets, so the line above cannot be
    // the count moving: it is the two meets that were not counted being reported.
    expect(textOf(partial, '.read')).toBe(textOf(whole, '.read'));
  });

  it('puts the floor sentence under the floor and takes it away above it', async () => {
    const thin = await mount(oneMeet());
    const enough = await mount();

    expect(textOf(thin, '.floor')).toContain('not enough to call any of this a pattern');
    expect(query(enough, '.floor')).toEqual([]);

    // And the figures are still drawn under it. Hiding them would leave a lifter
    // unable to see what the tool is counting, which is this panel's whole claim.
    expect(query(thin, 'section.lift')).toHaveLength(3);
  });

  it('says the panel is not advice on every state, including the one with nothing in it', async () => {
    const empty = await mount(noHistory());
    const full = await mount();

    for (const element of [empty, full]) {
      expect(textOf(element, '.caveat')).toContain('not advice');
    }
  });

  /*
   * ---------------------------------------------------------------------------
   * The five figures, which is most of the panel.
   * ---------------------------------------------------------------------------
   */

  it('draws all five figures for every lift, in the order §9.4 lists them', async () => {
    const element = await mount();

    expect(textsOf(element, 'section.lift h5')).toEqual(['Squat', 'Bench press', 'Deadlift']);

    const rows = query(element, 'section.lift').map(
      (lift) => lift.querySelectorAll('li.row').length,
    );
    expect(rows).toEqual([5, 5, 5]);

    // First and last pinned rather than all five: the order is what a wrong row
    // looks like, and the two ends are what moves if the list is rebuilt.
    const [squat] = query(element, 'section.lift');
    if (squat === undefined) throw new Error('The panel drew no lifts.');
    const labels = queryIn(squat, '.label').map((found) => found.textContent.trim());
    expect(labels[0]).toContain('Typical jump into a made attempt');
    expect(labels.at(-1)).toContain('Best lift against the maximum you planned');
  });

  it('drops the evidence line where the figure is, rather than reporting nothing twice', async () => {
    const element = await mount();

    // The squat in this history has no missed jump: nothing was ever missed on it.
    const missed = rowIn(element, 0, 'missed-jump');
    expect(textIn(missed, '.value')).toContain('Nothing recorded yet');
    expect(queryIn(missed, '.evidence')).toEqual([]);

    // The control, three lines up the same list: a figure that exists carries its
    // working, so the absence above is the null branch and not a missing line.
    const made = rowIn(element, 0, 'successful-jump');
    expect(queryIn(made, '.evidence')).toHaveLength(1);
  });

  it('counts the observations per figure rather than per lift', async () => {
    const element = await mount();
    const lift = 0;

    // Two jumps a meet across five meets, against one second attempt a meet. A
    // panel printing the report's own meet count under every figure reads as five
    // everywhere, which is the same screen for a figure drawn from ten readings.
    const jump = textIn(rowIn(element, lift, 'successful-jump'), '.evidence');
    const seconds = textIn(rowIn(element, lift, 'second-attempts'), '.evidence');

    expect(jump).not.toBe(seconds);
    expect(jump).toContain('From 10 observations');
    expect(seconds).toContain('From 5 observations');
  });

  it('shows the empty rows a lifter who has never missed produces, rather than dropping them', async () => {
    const clean = await mount(neverMissed());
    const missing = await mount();

    // One empty missed-jump row per lift against two: the bench in the other
    // history is the lift with misses on it.
    expect(textsOf(clean, '.value.none')).toHaveLength(3);
    expect(textsOf(missing, '.value.none')).toHaveLength(2);
    expect(textOf(clean, '.value.none')).toContain('Nothing recorded yet');
  });

  /*
   * ---------------------------------------------------------------------------
   * The two rules about numbers: §16's unit, and §10.2's forbidden percentage.
   * ---------------------------------------------------------------------------
   */

  it('converts the weight figures and leaves the counts alone', async () => {
    const kilograms = await mount(aRecord(), 'kg');
    const pounds = await mount(aRecord(), 'lb');

    // Every weight here is a *difference* between two attempts rather than an
    // attempt, so §16's chart rule does not reach it and it converts.
    const jump = [kilograms, pounds].map((element) =>
      textIn(rowIn(element, 0, 'successful-jump'), '.value'),
    );
    expect(jump[0]).not.toBe(jump[1]);
    expect(jump[0]).toContain('kg');
    expect(jump[1]).toContain('lb');

    // A count is not a weight, and a unit switch that moved it would be reporting
    // a different number of attempts for the same five meets.
    const seconds = [kilograms, pounds].map((element) =>
      textIn(rowIn(element, 0, 'second-attempts'), '.value'),
    );
    expect(seconds[0]).toBe(seconds[1]);
    expect(seconds[0]).toContain('5 of 5 made');
  });

  it('prints attempts as two counts and keeps the one percent sign for a share of weights', async () => {
    const element = await mount();

    // The bench in this history missed every third attempt. "0 of 5 made" is a
    // count; the same pair as a percentage is a success rate, which §10.2 forbids.
    const thirds = textIn(rowIn(element, 1, 'third-attempts'), '.value');
    expect(thirds).toContain('0 of 5 made');
    expect(thirds).not.toContain('%');

    // The control, and the only line on the panel that carries a percent sign: a
    // weight against another weight, which is a ratio of two figures the lifter
    // can point at.
    const reached = textIn(rowIn(element, 1, 'reached-of-planned'), '.value');
    expect(reached).toContain('%');
    expect(reached).toContain('of what you planned');
  });

  /*
   * ---------------------------------------------------------------------------
   * The cluster, which is the one section that is never a list.
   * ---------------------------------------------------------------------------
   */

  it('names the lift holding the misses, and says so plainly when none does', async () => {
    const clustered = await mount();
    const spread = await mount(neverMissed());

    expect(textOf(clustered, '.cluster .what')).not.toBe(textOf(spread, '.cluster .what'));
    expect(textOf(clustered, '.cluster .what')).toContain('bench');
    // Both counts, because "5 of 5" is a fact a lifter can check against their own
    // memory of the days and a multiple is a derivation they cannot.
    expect(textOf(clustered, '.cluster .what')).toContain('5 of 5');
    expect(textOf(spread, '.cluster .what')).toContain('No lift holds more of your misses');
  });

  /*
   * ---------------------------------------------------------------------------
   * Accessibility, on the fullest report and the emptiest.
   * ---------------------------------------------------------------------------
   */

  it('has no accessibility violations with every figure drawn', async () => {
    const element = await mount(withMeetsOutOfScope());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations with nothing to show', async () => {
    const element = await mount(noHistory());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
