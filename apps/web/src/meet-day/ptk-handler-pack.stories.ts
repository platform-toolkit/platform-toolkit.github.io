// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23.2's roster, in the states a handler's clipboard actually reaches.
 *
 * Every story is a real flight played through `applyMeetAction` and read by
 * `buildBoardView` and `buildHandlerPack`, never a hand-written `HandlerPack`,
 * for the reason `ptk-coach-board.stories.ts` gives about ranked rows: a
 * literal is free to document a roster the board would never produce, and the
 * arrangements worth reviewing are the ones that look wrong.
 *
 * The fixture is `pack-fixture.ts`, shared with the browser tests and the unit
 * suite (§13.7).
 *
 * NOTHING HERE ADVANCES A CLOCK, AND NOTHING HERE READS ONE
 *
 * Nothing on this sheet is a time -- a roster is a page of weights and names,
 * and the countdowns live on the coach board it was printed from. But the
 * actions that put weights on the board carry an instant, so `PACK_AT` is a
 * fixed epoch: a fixture on the system clock makes two visits to the docs page
 * two different documents, and the smoke check would be comparing them.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  benchOnlyHandlerPack,
  clashingHandlerPack,
  handlerPackOf,
  undeclaredHandlerPack,
} from './pack-fixture.js';
import type { PtkHandlerPack } from './ptk-handler-pack.js';
import './ptk-handler-pack.js';

const meta: Meta<PtkHandlerPack> = {
  title: 'Meet day/Handler pack',
  component: 'ptk-handler-pack',
  tags: ['autodocs'],
  args: { pack: handlerPackOf() },
  render: (args) => html`<ptk-handler-pack .pack=${args.pack}></ptk-handler-pack>`,
};

export default meta;

type Story = StoryObj<PtkHandlerPack>;

/**
 * A flight of three, one of them with a handler named.
 *
 * The other two say so rather than leaving the line empty: a roster that
 * printed nothing where nobody is assigned reads as a column the tool forgot,
 * on the sheet whose whole job is saying who to shout at. The handler here is
 * invented (§5.1) and deliberately shares no name with a lifter, because a
 * roster where the two collide is unreadable in exactly that column.
 */
export const AFlight: Story = {};

/**
 * §21.2's clash, on paper: two minutes expiring inside one errand.
 *
 * Printed as a code under each lifter rather than as a sentence naming the
 * other one. The roster carries every lifter in the flight, so the sheet says
 * who is clashing by having both of them on it -- and a sentence naming a
 * lifter on a page that already lists them is the same fact twice, in the
 * screen's words rather than the page's.
 */
export const WithADeadlineClash: Story = {
  args: { pack: clashingHandlerPack() },
};

/**
 * A bench-only meet with nobody set up on this phone.
 *
 * One lift rather than three: a sheet drawing a fixed squat/bench/deadlift
 * block whatever the format would print two rows of blanks nobody is lifting.
 * And no per-device entry, so every identifier is the position the board filled
 * in and no lifter has a handler -- the state a roster is in before a coach has
 * entered anything, and the one most likely to render as a column of empty
 * boxes.
 */
export const ABenchOnlyMeet: Story = {
  args: { pack: benchOnlyHandlerPack() },
};

/**
 * One lifter, set up, with nothing declared yet.
 *
 * Three ruled cells per lift, which is what makes this sheet worth printing
 * before the flight rather than after it: a handler writes the openers on it at
 * the expeditor's table. Every row is the same width whatever is on it, so the
 * eye reads down a column (§27's answer to a table that cannot fit).
 */
export const NothingDeclaredYet: Story = {
  args: { pack: undeclaredHandlerPack() },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element responds to, and a
 * viewport parameter would document a screen the component never sees.
 *
 * This is the width the card-per-lifter layout exists for. A roster is
 * genuinely tabular and a `<table>` is the honest markup for it, but eight
 * columns of weights cannot be made to fit 320px without sideways scrolling,
 * which §27 forbids outright in an urgent workflow. So each lifter stacks, and
 * the print rules give paper the density a table would have had.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-handler-pack .pack=${args.pack}></ptk-handler-pack>
    </div>
  `,
};
