// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §11, at each of the four points a lifter passes through.
 *
 * The four are one sequence and not four arrangements: an opener is made, a
 * second weight is picked, it goes to the table, a referee judges it. Read down
 * the page and the thing worth watching is what *leaves* -- the three choice
 * cards are gone while the bar is loaded, and the countdown is absent before the
 * first result and after the last one. A story file that showed four screens
 * each with everything on it would be documenting the dashboard §11 replaces.
 *
 * Every story is a photograph of one instant. Nothing here is on a timer: the
 * countdown panel is a function of the view it is handed, and the caller in the
 * application is what repaints it (`src/clock.ts`).
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  CHART,
  OPENER,
  SECOND,
  START,
  THIRD,
  choose,
  contextAt,
  meetWith,
  submit,
  take,
  viewOf,
} from './live-fixture.js';
import type { LiveView } from './live.js';
import type { Haptics } from './ptk-submission-countdown.js';
import type { PtkLiveScreen } from './ptk-live-screen.js';
import './ptk-live-screen.js';

/** One made opener, ten seconds ago. The minute is running. */
const RECORDED = take(meetWith(), 'squat', OPENER);

const TEN_SECONDS_IN = contextAt(START + 10_000);

/**
 * A story never buzzes the reviewer's phone.
 *
 * §14.1's panel is a child of this screen and buzzes when the band escalates.
 * Storybook renders every story on the docs page at once, so the real port would
 * fire several times on load, on a laptop that cannot show what happened.
 */
const SILENT: Haptics = () => {
  // Deliberately nothing.
};

const meta: Meta<PtkLiveScreen> = {
  title: 'Meet day/Live screen',
  component: 'ptk-live-screen',
  tags: ['autodocs'],
  args: { chart: CHART, unit: 'kg', haptics: SILENT },
  render: (args) =>
    html`<ptk-live-screen
      .view=${args.view}
      .chart=${args.chart}
      .unit=${args.unit}
      .haptics=${args.haptics}
    ></ptk-live-screen>`,
};

export default meta;

type Story = StoryObj<PtkLiveScreen>;

/** A result is in and nothing is picked. §13's three cards are the workspace. */
export const Choosing: Story = {
  args: { view: viewOf(RECORDED, TEN_SECONDS_IN) },
};

/**
 * The weight is picked and the table has not been told.
 *
 * The cards stay up on purpose. §13's requirement is that a lifter may change
 * their mind for as long as the rules allow it, and a running minute is not the
 * same fact as a closed decision.
 */
export const AtTheTable: Story = {
  args: { view: viewOf(choose(RECORDED, 'squat', SECOND), TEN_SECONDS_IN) },
};

/**
 * The bar is loaded and three referees are watching.
 *
 * The choices are gone and §12's controls have taken their place. Offering a new
 * weight for the attempt being judged is a suggestion the rules refuse, made at
 * the moment the lifter is least able to check it.
 */
export const OnThePlatform: Story = {
  args: { view: viewOf(submit(RECORDED, 'squat', SECOND), TEN_SECONDS_IN) },
};

/**
 * Two misses, one attempt left.
 *
 * §13.7's warning, and the only thing on this screen rendered in the negative
 * tone. A single miss deliberately produces nothing -- most lifters miss one in
 * most flights, and a warning that common teaches the reader to skim the one
 * that matters.
 */
export const OnTheLastChance: Story = {
  args: { view: missedTwice() },
};

/**
 * Up now, with something to do away from the platform.
 *
 * "You are up now" is a different sentence from a smaller number, because it is
 * the only one of the three that means move.
 */
export const CalledNow: Story = {
  args: { view: observed(viewOf(RECORDED, TEN_SECONDS_IN)) },
};

/**
 * Every contested lift over.
 *
 * No attempt card, no workspace, no line counting attempts ahead -- and the
 * banked figure has become a total rather than a subtotal, which is the one word
 * that says the day is finished.
 */
export const MeetOver: Story = {
  args: { view: benchOnlyFinished() },
};

/** The narrowest phone still in use (§5.7), constrained by a wrapper. */
export const Narrow: Story = {
  args: { view: observed(viewOf(choose(RECORDED, 'squat', SECOND), TEN_SECONDS_IN)) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-live-screen
        .view=${args.view}
        .chart=${args.chart}
        .unit=${args.unit}
        .haptics=${args.haptics}
      ></ptk-live-screen>
    </div>
  `,
};

function missedTwice(): LiveView {
  const first = take(meetWith(), 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' });
  const second = take(first, 'squat', SECOND, { outcome: 'no-lift', reason: 'strength' });
  return viewOf(second, TEN_SECONDS_IN);
}

function benchOnlyFinished(): LiveView {
  const first = take(meetWith('bench-only'), 'bench', OPENER);
  const second = take(first, 'bench', SECOND);
  return viewOf(take(second, 'bench', THIRD), TEN_SECONDS_IN);
}

/** What a handler at the side of the platform has counted and noticed. */
function observed(view: LiveView): LiveView {
  return {
    ...view,
    observed: {
      attemptsBeforeCalled: 0,
      urgent: [{ kind: 'equipment', message: 'Knee sleeves on before you walk out.' }],
    },
  };
}
