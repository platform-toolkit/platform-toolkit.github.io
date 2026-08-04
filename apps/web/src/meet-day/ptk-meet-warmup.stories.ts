// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20's screen, in the states a warm-up room actually puts it in.
 *
 * Every story is a `MeetWarmupState` built by the writers in `warmup.ts`, never a
 * literal -- `warmup-fixture.ts` is the one builder and its header says why. The
 * same fixture drives the browser tests, for the reason §13.7 gives: the
 * interesting states here are *sequences* of answers, and a story with its own
 * private sequence drifts away from the test that was meant to cover it.
 *
 * They are named after the room rather than after the screen. The question worth
 * answering in review is whether this is an honest reading of that situation, and
 * a name describing the pixels cannot be checked against anything.
 *
 * WHY THERE IS NO PLAY FUNCTION, UNLIKE §12'S CARD
 *
 * This element owns nothing. Every answer arrives as `state` and every change
 * leaves as an event, so each of these screens can be reached by setting one
 * property -- which is the whole of the reason the same element can serve the solo
 * planning screen and one lifter open on the coach board. §13.6's card needed a
 * play function because its draft is element-local and unreachable from outside;
 * anything here that needed one would be a fact this element had started keeping.
 *
 * WHY THE UNANSWERED SCREEN IS A STORY AND NOT AN EDGE CASE
 *
 * It is the screen every lifter sees first, and the rule this element exists for
 * is that the estimate is on it before anybody has answered anything (§20.1). A
 * story set that started from a filled-in state would document the easy half and
 * leave the degrading estimate -- the part that is hard to get right and easy to
 * ship broken -- visible to nobody.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  FORMAT,
  NO_OPENER,
  NOW,
  SQUAT,
  aPoundRoom,
  anEarlierFlight,
  longPreparation,
  nothingAnswered,
  ownFlightRunning,
  runningLate,
  sharingARack,
  withAdjustedSets,
  withKneeWraps,
} from './warmup-fixture.js';
import type { PtkMeetWarmup } from './ptk-meet-warmup.js';
import './ptk-meet-warmup.js';

const meta: Meta<PtkMeetWarmup> = {
  title: 'Meet day/Meet warm-up',
  component: 'ptk-meet-warmup',
  tags: ['autodocs'],
  args: { state: anEarlierFlight(), subject: SQUAT, format: FORMAT, now: NOW },
  render: (args) =>
    html`<ptk-meet-warmup
      .state=${args.state}
      .subject=${args.subject}
      .format=${args.format}
      .now=${args.now}
    ></ptk-meet-warmup>`,
};

export default meta;

type Story = StoryObj<PtkMeetWarmup>;

/**
 * An earlier flight is running and the session has a measured pace.
 *
 * The ordinary screen, and the one to read first: thirty attempts in forty-five
 * minutes clears the floor `observedPace` sets, so the estimate is drawn from a
 * measurement rather than from the assumption and the range is visibly narrower
 * for it. Forty-five attempts out, which is far enough that the whole ramp still
 * lies ahead -- the timeline reads as a plan rather than as a warning.
 */
export const AnEarlierFlightRunning: Story = {};

/**
 * The screen before anybody has answered anything.
 *
 * §20.1's requirement made visible: there is an estimate, it is wide, and it says
 * what it was drawn from. The judgement worth reviewing is that no question above
 * the fold is marked as missing -- a screen that scolded a lifter for not having
 * counted the flight yet would be read as broken rather than as unanswered, and
 * the handler opening this between attempts wants the figure, not the form.
 */
export const NothingAnswered: Story = {
  args: { state: nothingAnswered() },
};

/**
 * The lifter's own flight, thirteen attempts away, with the ramp already overdue.
 *
 * This is the state §20.1 exists for and the one the common screen above cannot
 * reach: sixteen to twenty-three minutes is shorter than the ramp, so the schedule
 * carries `behind-the-warm-up-timeline` and the first set's window has already
 * opened. Both halves have to be legible at once -- the advisory saying so, and a
 * timeline whose early rows are in the past.
 */
export const OwnFlightRunning: Story = {
  args: { state: ownFlightRunning() },
};

/**
 * A session eight minutes behind with a six-minute break still to come.
 *
 * Two facts that read alike and behave differently (§13.3): a published break is
 * scheduled and a delay is not, and neither widens the spread, because neither is
 * a forecast. What to check is that the timeline says the meet is behind *and*
 * that the range under the estimate is no wider than the story above -- a screen
 * that hedged its estimate because the meet is late would be telling a handler the
 * tool is less sure than it is.
 */
export const RunningLate: Story = {
  args: { state: runningLate() },
};

/**
 * No opener chosen yet, which is the one refusal a lifter can reach from here.
 *
 * Zero is what an unanswered weight field reads as, so this is not a defensive
 * branch -- it is the state between opening the screen and typing a number. The
 * refusal is about the opener and says so; the estimate above it is unaffected and
 * still renders, because how long there is until the platform does not depend on
 * what is going on the bar.
 */
export const NoOpenerYet: Story = {
  args: { subject: NO_OPENER },
};

/**
 * Knee wraps, nine minutes, going on after the final warm-up set.
 *
 * The prep that *fits*: nine minutes is inside the lead the ramp already leaves,
 * so it is not charged twice and the platform estimate does not move. Worth
 * reading beside the story below, which is the same control answered with a figure
 * that does not fit.
 */
export const WrapsThatFitTheLead: Story = {
  args: { state: withKneeWraps() },
};

/**
 * Twenty-five minutes to get into a squat suit, before the first set.
 *
 * The lead widens and the screen says it widened. The failure this documents is
 * the silent version -- a tool that quietly scheduled the suit over the call to
 * the bar, or one that absorbed the twenty-five minutes into the ramp without a
 * word, hands the lifter a timeline that cannot be followed by somebody who is
 * doing exactly what they said they would do.
 */
export const PreparationThatDoesNotFit: Story = {
  args: { state: longPreparation() },
};

/**
 * Two rungs of the calculated ramp overridden by hand.
 *
 * 112.5 kg at index three and four repetitions at index four, neither of which
 * appears anywhere in the calculated ramp -- so the timeline above the fold shows
 * the lifter's figures and the fold shows the calculated ones as placeholders
 * underneath. The way back is a single control and it is only on screen because
 * something was changed.
 */
export const AdjustedSets: Story = {
  args: { state: withAdjustedSets() },
};

/**
 * Four lifters queueing for one bar.
 *
 * §20 charges a set's time per gap for each of them, and the point of the story is
 * the sentence rather than the arithmetic: an allowance folded silently into the
 * rest intervals reads identically to a ramp that was simply planned longer, and a
 * handler who takes the rack back cannot tell which figure to ignore.
 */
export const SharingARack: Story = {
  args: { state: sharingARack() },
};

/**
 * A kilogram opener warming up on a pound bar.
 *
 * The two units on this screen are separate answers and this is the story that
 * says so: the opener is declared in the unit the platform is scored in, the ramp
 * is printed in the unit the warm-up room's plates are painted in, and printing
 * the ramp in the document's unit sends a lifter hunting for a plate nobody owns.
 * Both the timeline and the adjust fold have to agree with the room.
 */
export const APoundRoom: Story = {
  args: { state: aPoundRoom() },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than by
 * a viewport setting -- the wrapper is what the element responds to, and a viewport
 * parameter would document a screen the component never sees.
 *
 * The overdue state deliberately, because it is the widest: eight timeline rows
 * each carrying a label, a weight and a two-ended time range, with an advisory
 * above them. That row is the reason the timeline is a list and not a bar, and 320
 * pixels is where the decision either holds or does not.
 */
export const Narrow: Story = {
  args: { state: ownFlightRunning() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-warmup
        .state=${args.state}
        .subject=${args.subject}
        .format=${args.format}
        .now=${args.now}
      ></ptk-meet-warmup>
    </div>
  `,
};
