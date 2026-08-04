// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's board, in the states a coach's phone actually reaches.
 *
 * Every story is a real flight played through `applyMeetAction` and read by
 * `buildBoardView`, never a hand-written `BoardView`. The rows are *ranked* by
 * the domain, so a literal is free to document an order the ladder would never
 * produce -- a lifter with nothing running above one whose minute is expiring,
 * two rows under one heading that the sort would have separated -- and those are
 * precisely the arrangements a reviewer would study, because they look wrong and
 * are meant to.
 *
 * They are named after the room rather than after the screen, for the reason
 * `ptk-live-choices.stories.ts` gives: the question worth answering in review is
 * whether this is the correct board for that flight, and a name describing the
 * pixels cannot be checked against anything.
 *
 * NOTHING HERE ADVANCES A CLOCK, AND NOTHING HERE READS ONE
 *
 * The board takes an instant as part of its view (§13.5) and the countdowns are
 * `deadline - now` at that instant, so each story is a photograph. The fixture's
 * `START` is a fixed epoch, which is what makes two visits to the docs page show
 * the same seconds -- a board built on the system clock documents a different
 * screen every time it is opened, and the smoke check would be comparing two.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { EMPTY_BOARD_VIEW, type BoardView } from './board.js';
import {
  boardAt,
  chooseFor,
  contextAt,
  lifterIdAt,
  sharedRack,
  takeFor,
  threeLifters,
} from './board-fixture.js';
import { OPENER, START } from './live-fixture.js';
import type { PtkCoachBoard } from './ptk-coach-board.js';
import './ptk-coach-board.js';

/** The default flight: one lifter warming up, two still waiting. */
function flight(): BoardView {
  const { timeline, context } = threeLifters();
  return boardAt(timeline, context);
}

/** The same flight with the lifters named by position pinned. */
function pinning(...positions: readonly number[]): BoardView {
  const { timeline, context } = threeLifters();
  const ids = positions.map((position) => lifterIdAt(timeline.present, position));
  return boardAt(timeline, {
    ...context,
    entries: context.entries.map((entry) =>
      ids.includes(entry.lifterId) ? { ...entry, pinned: true } : entry,
    ),
  });
}

const meta: Meta<PtkCoachBoard> = {
  title: 'Meet day/Coach board',
  component: 'ptk-coach-board',
  tags: ['autodocs'],
  args: { view: flight(), unit: 'kg' },
  render: (args) => html`<ptk-coach-board .view=${args.view} .unit=${args.unit}></ptk-coach-board>`,
};

export default meta;

type Story = StoryObj<PtkCoachBoard>;

/**
 * Three lifters, two urgency bands, one heading per run.
 *
 * The runs are one row and two rows rather than one each, deliberately: a
 * flight where every row earned its own heading would look identical to a board
 * printing a heading above every lifter, which is the list-with-decoration this
 * screen exists not to be.
 */
export const AFlight: Story = {};

/**
 * Two lifters pinned, and the order unchanged.
 *
 * The pin is a filter and never a sort (§21). This is the story that shows it:
 * the pinned rows are still in the positions the ladder gave them, under the
 * headings they were already under, and nothing about them is promoted.
 */
export const WithPins: Story = {
  args: { view: pinning(0, 2) },
};

/**
 * The same board with the filter on, which is a screen and not a state.
 *
 * `pinnedOnly` is element-local -- the board repaints four times a second and
 * routing a checkbox through the caller would be a state update per tick -- so a
 * story cannot set it from outside and presses the real control instead. The
 * throw names the cause on the first line of the log, rather than publishing an
 * unfiltered board under a title saying it is filtered.
 */
export const FilteredToPinned: Story = {
  args: { view: pinning(0, 2) },
  play: async ({ canvasElement }) => {
    const board = canvasElement.querySelector('ptk-coach-board');
    if (board === null) throw new Error('The board did not render.');
    await board.updateComplete;
    const group = board.shadowRoot?.querySelector('ptk-toggle-group');
    const box = group?.shadowRoot?.querySelector('input[type="checkbox"]');
    if (!(box instanceof HTMLInputElement)) {
      throw new Error('The board has no pinned-only filter.');
    }
    box.click();
    await board.updateComplete;
  },
};

/**
 * §21.2: two minutes expiring inside one errand.
 *
 * The count above the rows is one, not two. A pair appears on both its rows, so
 * a board summing the per-row lists heads two warnings "2 clashes" -- the tool
 * looking broken in the direction that costs attention, on the screen that
 * exists to ration it. Exactly one of the two rows says to go there first, and
 * the other says why it is second.
 */
export const WithADeadlineClash: Story = {
  args: {
    view: ((): BoardView => {
      const { timeline, context } = threeLifters(START + 20_000);
      const sooner = lifterIdAt(timeline.present, 0);
      const later = lifterIdAt(timeline.present, 1);
      return boardAt(
        takeFor(
          takeFor(timeline, sooner, 'squat', OPENER, START),
          later,
          'squat',
          OPENER,
          START + 10_000,
        ),
        context,
      );
    })(),
  },
};

/**
 * §21.4: two lifters queueing for one bar on ramps that cross.
 *
 * The panel is the plan for the bar and not a second copy of the rows: the
 * loads in the order they go on, what each one costs in plate moves, and the
 * advisories for the two places the sequence doubles back. The saving line
 * reports whatever the sequence actually saves, including none: a panel that
 * could only ever report a saving would be an argument for sharing rather than
 * a plan for it.
 */
export const SharingABar: Story = {
  args: {
    view: ((): BoardView => {
      const { timeline, context } = sharedRack();
      return boardAt(timeline, context);
    })(),
  },
};

/**
 * One declared opener, read in pounds.
 *
 * §16: the kilogram figure is the attempt and the pound figure is a reading of
 * it, taken off the published chart where there is a row and hedged where there
 * is not. The fixture chart is five kilograms apart, so most weights land
 * between rows -- which is the common case on a real board and the one worth
 * documenting.
 */
export const InPounds: Story = {
  args: {
    unit: 'lb',
    view: ((): BoardView => {
      const { timeline, context } = threeLifters();
      const first = lifterIdAt(timeline.present, 0);
      return boardAt(chooseFor(timeline, first, 'squat', OPENER, START), {
        ...context,
        now: START + 1_000,
      });
    })(),
  },
};

/**
 * Lifters in the meet and nobody set up on this phone.
 *
 * No warm-up, no bar, no clock and no colour -- the state a coach's board is in
 * before they have entered anything, and the one most likely to render as a
 * column of empty boxes. Every row still carries a name, an identifier and an
 * imperative, because those come off the meet document rather than off the
 * per-device entry.
 */
export const NobodySetUp: Story = {
  args: {
    view: ((): BoardView => {
      const { timeline } = threeLifters();
      return boardAt(timeline, contextAt(START, { entries: [] }));
    })(),
  },
};

/**
 * A colour the browser does not parse as one.
 *
 * `CoachBoardEntry.colour` is a coach's own choice today and an imported string
 * off somebody else's phone after §24, and `styleMap` is not the guard it looks
 * like: on the *first* render lit writes the joined declarations as the `style`
 * attribute, so a value carrying a semicolon arrives as two declarations. The
 * board asks `CSS.supports` instead and draws no swatch at all for an answer of
 * no. The row is still readable, which is the point -- §21 requires the
 * identifier beside it to be sufficient on its own, so losing the swatch costs
 * nothing a coach was relying on.
 */
export const WithAColourThatIsNotOne: Story = {
  args: {
    view: ((): BoardView => {
      const { timeline, context } = threeLifters();
      const first = lifterIdAt(timeline.present, 0);
      return boardAt(timeline, {
        ...context,
        entries: context.entries.map((entry) =>
          // No `url()` and nothing that fetches: if the guard ever regressed,
          // this story would document the regression rather than perform it.
          entry.lifterId === first ? { ...entry, colour: 'crimson; opacity: 0.15' } : entry,
        ),
      });
    })(),
  },
};

/** A meet with nobody in it, which is a sentence and not an empty page. */
export const WithNobodyInTheMeet: Story = {
  args: { view: EMPTY_BOARD_VIEW },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to, and a viewport parameter would document a screen the component
 * never sees. This is the width the board is designed at: a coach reads it
 * walking between two rooms, and §27 forbids sideways scrolling on it outright.
 */
export const Narrow: Story = {
  args: { view: pinning(0) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-coach-board .view=${args.view} .unit=${args.unit}></ptk-coach-board>
    </div>
  `,
};
