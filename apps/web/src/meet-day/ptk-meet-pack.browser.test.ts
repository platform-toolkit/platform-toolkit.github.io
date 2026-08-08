// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.1: one lifter's whole day on a sheet, and what it does with a gap.
 *
 * `pack.ts` decided every weight, branch, count and omission on this sheet and
 * has its own suite, so nothing here re-asserts a number. What is this file's
 * own is the two things a layout can do with an answer nobody gave, and the two
 * are opposites: a rack height nobody knows draws a ruled line to write on, and
 * a schedule nobody has been told is dropped entirely. A sheet that got either
 * one backwards looks finished -- a page of empty boxes reads as a tool that
 * failed to print, and a missing section reads as a tool that forgot -- and
 * neither shows up in a test written as "the heading is on the screen", because
 * on this sheet every heading is.
 *
 * So each of the nine sections is asserted in *both* of its states, against
 * `fullPack()` and `blankPack()`, and the states come out of `pack-fixture.ts`
 * through the tool's own transitions so neither is a sheet the builder could not
 * produce.
 *
 * WHY THE PRINT RULES ARE READ OUT OF THE CSSOM
 *
 * A browser running a test is not printing, so `getComputedStyle` reports the
 * screen half and the paper half -- which is most of the reason this element
 * exists -- would go untested. `printRule` reads the parsed `@media print` block
 * instead. It cannot prove the rules take effect on paper; it can prove they
 * exist, name a selector the element renders, and set the property claimed. The
 * DOM assertion beside each one covers the selector.
 *
 * A real browser rather than jsdom because the ruled line *is* a computed
 * border: a blank drawn with no rule under it is the failure, and it is
 * invisible to anything reading markup.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import { printRule } from '../testing/print-rules.js';
import { rulesFor } from './meet-rules.fixture.js';
import { blankPack, filledPrep, fullPack, packOf, planned } from './pack-fixture.js';
import type { MeetPack } from './pack.js';
import { PtkMeetPack } from './ptk-meet-pack.js';
import './ptk-meet-pack.js';
import { withTargets } from './session.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(pack: MeetPack = fullPack()): Promise<PtkMeetPack> {
  const element = document.createElement('ptk-meet-pack');
  element.pack = pack;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkMeetPack, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textOf(element: PtkMeetPack, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The sheet has no ${selector}.`);
  return found.textContent.trim();
}

/** The blocks under one lift, by position in the format's own order. */
function liftAt(element: PtkMeetPack, index: number): HTMLElement {
  const found = query(element, 'section.lift').at(index);
  if (found === undefined) throw new Error(`The sheet has no lift at ${String(index)}.`);
  return found;
}

describe('ptk-meet-pack', () => {
  /*
   * ---------------------------------------------------------------------------
   * The heading, which is what tells two sheets on one table apart.
   * ---------------------------------------------------------------------------
   */

  it('puts the name on the first line and does not invent one for a lifter who typed none', async () => {
    const named = await mount();
    const anonymous = await mount(blankPack());

    // Asserted as a difference plus one pinned fragment rather than against
    // `packTitle`: an expected value computed by the module under test moves
    // with the code and the assertion goes on passing.
    expect(textOf(named, 'h3')).not.toBe(textOf(anonymous, 'h3'));
    expect(textOf(named, 'h3')).toContain('Dana Okafor');
    expect(textOf(anonymous, 'h3')).not.toContain('--');
  });

  it('cites the rulebook revision the profile names, on the sheet itself', async () => {
    const element = await mount();

    // Paper outlives a rule change, so the revision is what makes an old sheet
    // recognisable as one. Read off the fixture profile rather than written out.
    expect(textOf(element, '.muted.rules')).toContain(rulesFor().profile.source.revision);
  });

  /*
   * ---------------------------------------------------------------------------
   * §22.1, and the two opposite things to do with a blank.
   * ---------------------------------------------------------------------------
   */

  it('draws a ruled line for a rack height nobody has answered', async () => {
    const element = await mount();
    const [blank] = query(element, 'section.setup .fact .blank');
    if (blank === undefined) throw new Error('The filled sheet has no blank setup rows.');

    // The rule is the whole point: a blank with nothing under it reads as a
    // value the tool failed to print rather than as a line to write on. This
    // needs `tokens.css` imported above -- without it the custom property is
    // undefined, the declaration is dropped, and the assertion measures a border
    // that was never asked for.
    expect(getComputedStyle(blank).borderBottomStyle).toBe('solid');
    expect(Number.parseFloat(getComputedStyle(blank).borderBottomWidth)).toBeGreaterThan(0);
  });

  it('keeps every platform fact whether or not it was answered, and prints the answers', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());

    // Two of the fixture's sixteen answers are deliberately withheld, so the
    // filled sheet has both kinds on it at once -- a fixture that answered
    // everything would leave the blank branch with no coverage here at all.
    expect(query(filled, 'section.setup .fact')).toHaveLength(8);
    expect(query(filled, 'section.setup .fact .blank')).toHaveLength(2);
    expect(query(empty, 'section.setup .fact')).toHaveLength(8);
    expect(query(empty, 'section.setup .fact .blank')).toHaveLength(8);
  });

  it('drops the scheduling section rather than printing a heading over three blank rows', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());

    expect(query(empty, 'section.schedule')).toHaveLength(0);
    expect(query(filled, 'section.schedule')).toHaveLength(1);
    expect(deepText(filled)).toContain('Afternoon');
  });

  /*
   * ---------------------------------------------------------------------------
   * The attempts, and §16's pound column.
   * ---------------------------------------------------------------------------
   */

  it('prints nine attempts under three lifts, each with a subtotal, under one total', async () => {
    const element = await mount();

    expect(query(element, 'section.lift')).toHaveLength(3);
    expect(query(element, 'li.attempt')).toHaveLength(9);
    expect(query(element, 'p.muted.subtotal')).toHaveLength(3);
    expect(query(element, 'p.total')).toHaveLength(1);
  });

  it('says a lift has no plan in a sentence rather than printing an empty list', async () => {
    const element = await mount(blankPack());

    expect(query(element, 'li.attempt')).toHaveLength(0);
    expect(query(element, 'p.total')).toHaveLength(0);
    expect(deepText(element)).toContain('nothing to print');
  });

  it('prints the published pound figure and nothing at all where there is no chart', async () => {
    const charted = await mount();
    const chartless = await mount(packOf(planned(), { prep: filledPrep() }));

    expect(query(charted, 'section.attempts .pounds').length).toBeGreaterThan(0);
    expect(query(chartless, 'section.attempts .pounds')).toHaveLength(0);
    // §16 forbids the fallback, and the fallback is what a reader would want:
    // an approximate conversion loses its hedge the moment somebody reads the
    // number aloud at the expeditor's table. Scoped to the attempts section
    // because the checklist below it has its own vocabulary.
    const attempts = query(chartless, 'section.attempts').at(0);
    expect(attempts === undefined ? 'missing' : deepText(attempts)).not.toContain('lb');
  });

  /*
   * ---------------------------------------------------------------------------
   * §13's branches, on paper.
   * ---------------------------------------------------------------------------
   */

  it('groups the branches by the attempt being decided, six readings in each', async () => {
    const squat = liftAt(await mount(), 0);
    const [second, third] = [...squat.querySelectorAll(':scope > .contingency')];

    // Twelve rows split two ways, not one table of twelve. A lifter reads this
    // sheet at one moment -- the opener is over, the second is owed -- and the
    // ungrouped version has them scanning every row for the six that apply.
    expect(squat.querySelectorAll(':scope > .contingency')).toHaveLength(2);
    expect(second?.querySelectorAll('.trigger')).toHaveLength(6);
    expect(third?.querySelectorAll('.trigger')).toHaveLength(6);
  });

  it('says the third-attempt block assumes the second was made, and does not say it of the second', async () => {
    const squat = liftAt(await mount(), 0);
    const [second, third] = [...squat.querySelectorAll(':scope > .contingency')];

    // Both halves, because a sentence that is always there says nothing. This is
    // the one line on the sheet that stops a lifter reading a third-attempt row
    // as advice for the attempt they are actually owed.
    expect(second?.querySelectorAll('.assumption')).toHaveLength(0);
    expect(third?.querySelectorAll('.assumption')).toHaveLength(1);
  });

  it('names the suggested branch in a word, never in weight alone', async () => {
    const element = await mount();
    const [suggested] = query(element, '.branch .suggested');
    if (suggested === undefined) throw new Error('No branch on the sheet is suggested.');

    // §5.8's rule that colour is never the sole carrier, arriving somewhere it
    // binds harder: this sheet is photocopied and read aloud, so a marker glyph
    // or a bold weight would carry nothing at all in either.
    expect(suggested.textContent.trim()).not.toBe('');
    expect(suggested.textContent.trim()).toContain('Suggested');
  });

  /*
   * ---------------------------------------------------------------------------
   * §8.3, §22.2, and what the sheet admits it is missing.
   * ---------------------------------------------------------------------------
   */

  it('drops the targets section when the lifter set none and prints it when they did', async () => {
    const without = await mount();
    const with_ = await mount(fullPack(withTargets(planned(), { qualifyingTotal: '600' })));

    expect(query(without, 'section.targets')).toHaveLength(0);
    expect(query(with_, 'section.targets li.row').length).toBeGreaterThan(0);
  });

  it('counts the ticked rows in a line that agrees with the rows under it', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());

    // The expected count is read off the rows the element rendered, not off
    // `checklistProgressText` -- an expected value computed by the code under
    // test moves with it and the assertion goes on passing (§13.8). A progress
    // line disagreeing with the list beneath it is the one contradiction paper
    // has no way to resolve.
    const done = query(filled, 'section.checklist li.done');
    expect(done).toHaveLength(4);
    expect(textOf(filled, 'section.checklist .progress')).toContain(String(done.length));
    expect(query(empty, 'section.checklist li.done')).toHaveLength(0);
    expect(query(empty, 'section.checklist li.todo').length).toBeGreaterThan(0);
    expect(textOf(empty, 'section.checklist .progress')).not.toBe(
      textOf(filled, 'section.checklist .progress'),
    );
  });

  it('drops the notes section when the lifter wrote none and prints their own words when they did', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());

    expect(query(empty, 'section.own-notes')).toHaveLength(0);
    expect(textOf(filled, 'section.own-notes p.notes')).toContain('expeditor');
  });

  it('names what is not on the sheet rather than leaving it out silently', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());
    const printed = query(filled, 'section.omissions').at(0);
    const missing = query(empty, 'section.omissions').at(0);
    if (printed === undefined || missing === undefined) {
      throw new Error('The sheet declares no omissions.');
    }

    // Two on every pack `pack.ts` builds -- records and qualifying standards --
    // and a third when there is no opener to count a ramp back from. Asserted in
    // both states rather than as a fixed count, because the count is the one
    // thing about this section that moved when §23.1 started printing the ramp.
    expect(printed.querySelectorAll(':scope > ul > li')).toHaveLength(2);
    expect(missing.querySelectorAll(':scope > ul > li')).toHaveLength(3);
    expect(deepText(missing)).toContain('no opener has been agreed');
    expect(deepText(printed)).not.toContain('no opener has been agreed');
  });

  /*
   * ---------------------------------------------------------------------------
   * §23.1's warm-up ramp.
   * ---------------------------------------------------------------------------
   */

  it('prints a ramp per lift and drops the section for a sheet with no opener', async () => {
    const filled = await mount();
    const empty = await mount(blankPack());

    expect(query(filled, 'section.ramp')).toHaveLength(1);
    expect(query(filled, 'section.lift-ramp')).toHaveLength(3);
    expect(query(filled, 'li.rung').length).toBeGreaterThan(3);
    // The other half of the pair above: the ramp is the one section on this
    // sheet that is dropped *and* declared, so a version that dropped it
    // silently passes every assertion in the first half.
    expect(query(empty, 'section.ramp')).toHaveLength(0);
    expect(query(empty, 'li.rung')).toHaveLength(0);
  });

  it('puts the lead above the rungs, because it is the only line about when', async () => {
    const element = await mount();
    const block = query(element, 'section.lift-ramp').at(0);
    if (block === undefined) throw new Error('The sheet printed no ramp.');

    const lead = block.querySelector('p.lead');
    const rungs = block.querySelector('ol');
    if (lead === null || rungs === null) throw new Error('The ramp has no lead or no rungs.');
    // A lead and not a time of day and not a countdown -- the fragment is pinned
    // rather than compared against `packWarmupLeadText`, which would move the
    // expected value with the code (§13.8).
    expect(lead.textContent).toContain('before you are called');
    expect(lead.compareDocumentPosition(rungs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states the room every weight under it is standing on', async () => {
    const element = await mount();
    const rooms = query(element, 'section.lift-ramp p.room');

    expect(rooms).toHaveLength(3);
    // `fullPack()` puts bench in a pound room and leaves the other two on the
    // default, so one line in three says pounds -- which is what says the room is
    // read per ramp rather than printed once from whatever the tool started the
    // lifter on. It is also the case that costs the most: bench's rungs are in
    // pounds while every attempt above them on the sheet is in kilograms.
    const lines = rooms.map((room) => room.textContent);
    expect(lines.filter((line) => line.includes('lb plates'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('kg plates'))).toHaveLength(2);
  });

  it('names every rung, so no weight sits under a heading on its own', async () => {
    const element = await mount();
    const block = query(element, 'section.lift-ramp').at(0);
    if (block === undefined) throw new Error('The sheet printed no ramp.');

    const rungs = [...block.querySelectorAll('li.rung')];
    expect(rungs.length).toBeGreaterThan(3);
    expect(block.querySelectorAll('li.rung .name')).toHaveLength(rungs.length);
    // Tool 2's own vocabulary, and its own numbering: the bar is not counted, so
    // the first thing a lifter can move is always "Warm-up 1". A sheet that
    // numbered the bar would be off by one against the phone all the way up.
    expect(rungs.at(0)?.querySelector('.name')?.textContent).toBe('Empty bar');
    expect(rungs.at(1)?.querySelector('.name')?.textContent).toBe('Warm-up 1');
    expect(deepText(block)).toContain('reps');
  });

  it('prints an advisory that is still true tomorrow and none that is not', async () => {
    const element = await mount();
    const blocks = query(element, 'section.lift-ramp');
    const squat = blocks.at(0);
    if (squat === undefined) throw new Error('The sheet printed no ramp.');

    // §20's shared-rack answer, which is a fact about the room and reads the
    // same in the morning. Exactly one of the three blocks carries a line, and
    // that lift carries exactly one -- the schedule behind every one of them also
    // carries the standing "meet staff are authoritative" advisory, so a sheet
    // printing what the domain hands it would put a line under all three
    // (`pack.ts` says which codes are kept and why).
    expect(squat.querySelectorAll('ul.advisories > li')).toHaveLength(1);
    expect(deepText(squat)).toContain('comes free in turn');
    expect(query(element, 'ul.advisories')).toHaveLength(1);
  });

  /*
   * ---------------------------------------------------------------------------
   * The paper half.
   * ---------------------------------------------------------------------------
   */

  it('forces black on white in print, because a dark theme prints as a blank page', async () => {
    const element = await mount();

    // The DOM half of the pair. `printRule` proves the rule exists and sets what
    // it claims; it cannot see whether anything matches the selector, so the
    // assertion above it is what says this element renders a sheet at all.
    expect(element.shadowRoot?.querySelector('.sheet')).not.toBeNull();
    const host = printRule(PtkMeetPack.styles, ':host');
    expect(host.getPropertyValue('color')).toBe('rgb(0, 0, 0)');
    expect(host.getPropertyValue('background')).toContain('rgb(255, 255, 255)');
  });

  it('keeps a contingency block from breaking across a page', async () => {
    const element = await mount();

    expect(query(element, '.trigger').length).toBeGreaterThan(0);
    expect(query(element, '.contingency').length).toBeGreaterThan(0);
    // `section` in the same grouped rule reaches §23.1's ramp, which is why no
    // second rule was written for it -- and this is the DOM half that says the
    // selector reaches something. A ramp split over a fold is the same failure
    // as a split contingency: six rungs are read from the top down.
    expect(query(element, 'section.lift-ramp').length).toBeGreaterThan(0);
    // Half a decision at the foot of a page is the lost sheet §23's copy is
    // written against -- a reader with the trigger on one side of a fold and
    // the weights on the other. Named with the whole comma-separated selector
    // because that is what the CSSOM calls a grouped rule, and matching one of
    // the three would be the substring search `print-rules.ts` exists to avoid.
    expect(
      printRule(PtkMeetPack.styles, 'section, .contingency, .trigger').getPropertyValue(
        'break-inside',
      ),
    ).toBe('avoid');
    // The rule left keeps its border on paper, where a rule with no colour of
    // its own inherits a theme variable the printer has never heard of.
    expect(printRule(PtkMeetPack.styles, '.trigger').getPropertyValue('border-left')).toContain(
      'rgb(0, 0, 0)',
    );
  });

  /*
   * ---------------------------------------------------------------------------
   * §5.7 and §5.8.
   * ---------------------------------------------------------------------------
   */

  it('fits a phone-width column with every section on the sheet', async () => {
    const element = await mount();
    element.style.width = '320px';
    element.style.display = 'block';
    await element.updateComplete;

    expect(element.scrollWidth).toBeLessThanOrEqual(320);
  });

  it('has no axe violations with the whole day on the sheet', async () => {
    const element = await mount();

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no axe violations on the sheet nobody has answered', async () => {
    const element = await mount(blankPack());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
