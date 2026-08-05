// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.1's sheet, in the states a lifter would actually print.
 *
 * Every story is a real session played through the tool's own transitions and
 * projected by `buildMeetPack`, never a hand-written `MeetPack`. A literal is
 * free to hold a sheet the builder would never produce -- an attempt with no
 * subtotal under it, a contingency block whose branches disagree with §13, a
 * checklist whose progress line disagrees with its rows -- and those are exactly
 * the sheets a reviewer would study, because they look wrong and are meant to.
 * `pack-fixture.ts` is the one builder, shared with the browser tests and the
 * unit suite for the reason §13.7 gives.
 *
 * They are named after the day rather than after the screen: the question worth
 * answering in review is whether this is the correct sheet for that lifter, and
 * a name describing the pixels cannot be checked against anything.
 *
 * WHY THERE IS NO PRINT STORY, AND WHAT THAT COSTS
 *
 * Half of this element only exists inside `@media print`, and Storybook has no
 * way to show it -- a docs page renders on a screen, and forcing the print
 * stylesheet with a wrapper would document a set of rules the browser applies
 * with different page-break behaviour anyway. So these stories document the
 * screen half honestly and the paper half is covered where it can be: the print
 * rules are asserted in `ptk-meet-pack.browser.test.ts` by reading the
 * stylesheet, and the split across three files is written down in the element's
 * own header. Do not add a story that fakes paper; it would be the one artifact
 * a reviewer trusts and the one most likely to be wrong.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { blankPack, fullPack, packOf, planned } from './pack-fixture.js';
import type { PtkMeetPack } from './ptk-meet-pack.js';
import './ptk-meet-pack.js';

const meta: Meta<PtkMeetPack> = {
  title: 'Meet day/Meet pack',
  component: 'ptk-meet-pack',
  tags: ['autodocs'],
  args: { pack: fullPack() },
  render: (args) => html`<ptk-meet-pack .pack=${args.pack}></ptk-meet-pack>`,
};

export default meta;

type Story = StoryObj<PtkMeetPack>;

/**
 * A lifter who used the whole tool, printing the night before.
 *
 * Nine attempts with the branches under them, §23.1's warm-up ramp counted back
 * from each opener, the setup answers off §22, a checklist part-way through,
 * their own note, and the pound column read off the published chart (§16). Two
 * of the sixteen setup answers are deliberately blank -- the monolift setting
 * and the bench safety height -- because an unanswered fact draws a ruled line
 * to write on rather than an empty gap, and a sheet that answered everything
 * would leave that branch undocumented.
 *
 * The ramp is where this fixture is least symmetrical, on purpose. §20 is
 * answered differently on each lift: squat shares a rack, bench is counted for a
 * room loaded in pounds, and deadlift was never opened. So the bench rungs read
 * in pounds under attempts written in kilograms -- which is correct, and is the
 * thing a reviewer should check the "Counted for" line against.
 */
export const AWholeDay: Story = {};

/**
 * The same day with no chart behind it, which is most days.
 *
 * §16 makes the published chart the only authority for a pound figure, so a
 * weight with no row on it prints in kilograms and nothing else. Deliberately
 * not an approximate conversion: a hedged figure loses its hedge the moment
 * somebody reads it aloud at the expeditor's table, and this sheet is read
 * aloud more than any other screen in the collection.
 */
export const WithNoPoundColumn: Story = {
  args: { pack: packOf(planned()) },
};

/**
 * Nothing answered yet, which is a real thing to print.
 *
 * §23 calls the printed pack a battery and connectivity fallback, so it is
 * reached by a lifter whose phone died -- possibly before they typed anything.
 * Every section with nothing to say either draws a ruled line or is dropped,
 * and which of the two is right differs per section: the setup facts are lines
 * to write on, the schedule and the notes are simply absent, and the attempts
 * section says so in a sentence rather than printing an empty list. The warm-up
 * ramp is the third answer -- dropped *and* named at the foot, because it is
 * counted back from an opener and there is no opener here to count back from.
 * The other three stories all print one, including the one that answered §20
 * with nothing: a ramp needs an opener, not an answer.
 */
export const NothingAnsweredYet: Story = {
  args: { pack: blankPack() },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element responds to, and a
 * viewport parameter would document a screen the component never sees.
 *
 * A sheet is read on paper and reviewed on a phone, and the phone is the harder
 * of the two: the contingency blocks are the widest thing in the collection,
 * carrying a slot, a weight, a pound reading and a reason on one line. They
 * wrap here rather than scrolling sideways (§27).
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-pack .pack=${args.pack}></ptk-meet-pack>
    </div>
  `,
};
