// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §13's three choices, in the states the platform actually produces them in.
 *
 * Every story below is a real sequence played through `applyMeetAction` and then
 * asked for its choices -- never a hand-written `LiveChoices`. The cards are a
 * branch table over what the last attempt did (§13.1), so a literal would let a
 * story document a combination the rules cannot reach: a push slot beside a
 * report of pain, three cards where the branch offers two, a repeat offered
 * after a lift that flew. Those are exactly the arrangements a reviewer would
 * study hardest, and none of them will ever appear on a phone.
 *
 * The stories are therefore named after what the lifter did, not after what the
 * screen shows. That is the harder name to read and the right one: it is the
 * only way to tell whether the screen in the frame is the correct answer to the
 * thing that happened, which is the whole question §13 asks.
 *
 * Most of them supply a confirmed meet-day maximum. Two of §13's facts per card
 * -- the risk band and the share of the maximum -- are `null` without one, so
 * the ungraded screen is a different screen and gets a story of its own rather
 * than being the default everything else inherits.
 */
import type { LiveTarget } from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  CHART,
  OPENER,
  SECOND,
  START,
  choicesOf,
  contextAt,
  maximumOn,
  meetWith,
  take,
} from './live-fixture.js';
import type { PtkLiveChoices } from './ptk-live-choices.js';
import './ptk-live-choices.js';

/**
 * A maximum the fixture's opener is a plausible share of.
 *
 * Invented, on the fixture's invented grid (§5.1). The figure matters only in
 * that the opener has to land somewhere sensible against it -- around eighty per
 * cent -- or every card documents a percentage nobody would ever see.
 */
const MAXIMUM = 220;

/**
 * §17's targets, as the caller resolves them: one lift figure and one total.
 *
 * The lift target carries its lift, which is not optional here even though the
 * screen shows one lift at a time -- `targetAppliesToLift` is what stops a squat
 * record being reported as reached by a deadlift, and a story that omitted the
 * field would document the shape that caused that bug.
 */
const TARGETS: readonly LiveTarget[] = [
  { kind: 'personal-record', measure: 'lift', lift: 'squat', kilograms: 200, label: 'squat best' },
  { kind: 'qualification', measure: 'total', kilograms: 560, label: 'qualifying total' },
];

const GRADED = contextAt(START, { planning: maximumOn('squat', MAXIMUM), targets: TARGETS });

/** The same meet with no chart loaded, so §16's absence sentence has a story. */
const UNCHARTED = contextAt(START, {
  chart: null,
  planning: maximumOn('squat', MAXIMUM),
  targets: TARGETS,
});

const meta: Meta<PtkLiveChoices> = {
  title: 'Meet day/Live choices',
  component: 'ptk-live-choices',
  tags: ['autodocs'],
  args: { chart: CHART, unit: 'kg', refusals: [] },
  render: (args) =>
    html`<ptk-live-choices
      .choices=${args.choices}
      .chart=${args.chart}
      .unit=${args.unit}
      .refusals=${args.refusals}
    ></ptk-live-choices>`,
};

export default meta;

type Story = StoryObj<PtkLiveChoices>;

/** An opener that went up cleanly with nothing to say about it. */
export const AfterASolidOpener: Story = {
  args: { choices: choicesOf(take(meetWith(), 'squat', OPENER), GRADED) },
};

/**
 * The same opener, reported as easy.
 *
 * §13.1's named bug lives here: the tool must not answer a lift that flew by
 * abandoning the plan, so the secure card is still the planned second attempt
 * and the push card is one legal step above it -- not a jump sized to the
 * enthusiasm.
 */
export const AfterALiftThatFlew: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', OPENER, { outcome: 'good', effort: 'flew' }),
      GRADED,
    ),
  },
};

/**
 * A grind, which is the story that proves the highlight is not the first card.
 *
 * Pass sits in the secure slot because it is the conservative answer, and the
 * tool still recommends the smallest legal increase beside it -- so the first
 * card and the highlighted card are different cards. Reading the highlight off
 * the position would report this lifter as projecting nothing (§13.5).
 */
export const AfterAGrind: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'good', effort: 'grind' }),
      GRADED,
    ),
  },
};

/**
 * A missed attempt on strength, which is where the repeat appears.
 *
 * The secure card is the same weight again, so `increaseText` writes "The same
 * weight again" rather than "Up 0 kg" -- a jump of nothing and a jump that could
 * not be worked out are different facts, and only one of them is a sentence.
 */
export const AfterAMissOnStrength: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'no-lift', reason: 'strength' }),
      GRADED,
    ),
  },
};

/**
 * Pain, which removes the push slot entirely.
 *
 * The highlight is on the pass, no increase is offered at all, and the advisory
 * is `strong`. §13.5 is the reason slot and highlight are two fields: one marker
 * doing both jobs forces the recommendation onto the middle card, and the middle
 * card is an increase.
 */
export const AfterPain: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'no-lift', reason: 'pain' }),
      GRADED,
    ),
  },
};

/**
 * A platform error, which asks the lifter to confirm something off-screen.
 *
 * The tool cannot see whether the extra attempt was granted, so it says so at
 * `strong` and offers the choices anyway. Nothing here schedules anything --
 * the timing is the expeditor's call (§13.8).
 */
export const AfterAPlatformError: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'no-lift', reason: 'platform-error' }),
      GRADED,
    ),
  },
};

/**
 * A granted extra attempt, which is reported beside the three and never among
 * them.
 *
 * Also the one branch where the jump comes out negative: the attempt that was
 * set aside is no longer the floor, so the offer sits far below it and the card
 * reads "Down". A screen that printed an unsigned figure here would say the
 * lifter is going up when they are going down.
 */
export const WithAnExtraAttempt: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'extra-attempt-granted' }),
      GRADED,
    ),
  },
};

/**
 * Two misses, so the third attempt is the last chance on the lift.
 *
 * The advisory names the bomb-out, at `strong`, and the cards do not change
 * shape around it -- the tool states the stake and still offers the same three
 * weights, because deciding for the lifter is what §13 exists not to do.
 */
export const OnTheLastChance: Story = {
  args: {
    choices: choicesOf(
      take(
        take(meetWith(), 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' }),
        'squat',
        OPENER,
        { outcome: 'no-lift', reason: 'strength' },
      ),
      GRADED,
    ),
  },
};

/**
 * No maximum was ever confirmed, which is what declining §7's tick looks like.
 *
 * The risk line reads "not graded" and the share of the maximum is absent
 * altogether -- not zero, not "unknown". §10 keeps risk and data confidence on
 * separate axes, and a band printed off a maximum nobody supplied would be a
 * grade with nothing behind it.
 */
export const WithNoConfirmedMaximum: Story = {
  args: { choices: choicesOf(take(meetWith(), 'squat', OPENER), contextAt(START)) },
};

/**
 * No published pound chart, so the cards carry kilograms and a reason.
 *
 * §16 forbids computing the missing figure. The reason is said once for the
 * whole list rather than once per card, because "no chart is loaded" is one fact
 * about the read and not three facts about three weights.
 */
export const WithNoPoundChart: Story = {
  args: {
    chart: null,
    choices: choicesOf(take(meetWith(), 'squat', OPENER), UNCHARTED),
  },
};

/**
 * A weight the rule book refused, reported under the field it came from.
 *
 * The element does not work these out and must not try -- legality belongs to
 * the rule profile, and a second opinion in a template is a copy of a
 * federation's rules that goes stale in silence. The caller applies the action
 * and hands the codes back.
 */
export const WithARefusedWeight: Story = {
  args: {
    choices: choicesOf(take(meetWith(), 'squat', OPENER), GRADED),
    refusals: ['below-the-minimum-progression', 'not-a-legal-bar-weight'],
  },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to, and a viewport parameter would document a screen the component
 * never sees.
 */
export const Narrow: Story = {
  args: {
    choices: choicesOf(
      take(meetWith(), 'squat', SECOND, { outcome: 'good', effort: 'grind' }),
      GRADED,
    ),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-live-choices
        .choices=${args.choices}
        .chart=${args.chart}
        .unit=${args.unit}
        .refusals=${args.refusals}
      ></ptk-live-choices>
    </div>
  `,
};
