// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rest between sets. Section 7.11.
 *
 * Every story here freezes the clock, which is the only way to photograph a countdown:
 * the element is handed a `now` that always answers the same instant, so 2:00 stays
 * 2:00 and the interval it starts has nothing to repaint. That is not a testing trick
 * bolted on for Storybook -- the clock is a property because the package may not read
 * one (section 12.3), and a frozen one is what falls out of that.
 *
 * What is worth reviewing is whether five controls in a row still work at 320px, and
 * whether the timer reads as part of the tool rather than as a notification that landed
 * on top of it. And, where the picker is on, whether the one control that outlives the
 * countdown reads as separate from the five that do not.
 *
 * Every duration here is invented (section 5.1).
 */
import {
  startRest,
  type Instant,
  type RestAlertSettings,
  type RestTimer,
} from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkRestTimer, RestLift } from './ptk-rest-timer.js';
// Value imports, unlike the line above, and safe where the tag imports are not: nothing
// in this module registers an element or holds anything a second copy could disagree
// about.
import { createRestAlerter, defaultRestAlerter } from './rest-alert.js';

// Through the package entry and behind an explicit call, for the reason spelled out in
// `ptk-workout-history.stories.ts`: a relative import would define every tag twice.
defineTrainingLogbook();

/** The invented instant every rest below is started at. */
const AT_START: Instant = '2026-03-10T17:00:00.000Z';

/** An invented rest, and one press of shorten away from a rounder one. */
const REST_SECONDS = 180;

function at(seconds: number): Instant {
  return new Date(Date.parse(AT_START) + seconds * 1000).toISOString();
}

/** A rest of the given length, already `elapsed` seconds into itself. */
function running(elapsed: number, seconds = REST_SECONDS): RestTimer {
  return startRest(seconds, at(-elapsed));
}

/**
 * An invented lift, and the lengths the root offers for it.
 *
 * The list is the root's in the tool. Here it is written out, because a story that
 * imported the root's private preset list would be reviewing the list rather than the
 * band.
 */
function aLift(seconds = REST_SECONDS): RestLift {
  return {
    name: 'Back squat',
    seconds,
    options: [60, 90, 120, 150, 180, 240, 300].map((value) => ({
      value: String(value),
      label:
        value % 60 === 0
          ? `${String(value / 60)} min`
          : `${String(Math.floor(value / 60))} min ${String(value % 60)} s`,
    })),
  };
}

/** What a lifter who has chosen nothing has. All three are an opt-in (section 7.11). */
const NOTHING_ON: RestAlertSettings = { sound: false, vibrate: false, notify: false };

const meta: Meta<PtkRestTimer> = {
  title: 'Training logbook/Rest timer',
  component: 'ptk-rest-timer',
  tags: ['autodocs'],
  // The real device, so a reviewer opening Alerts and pressing Sound hears what ships
  // -- and is asked for notification permission by the browser exactly as a lifter is.
  args: {
    timer: running(60),
    now: () => AT_START,
    lift: null,
    alerts: NOTHING_ON,
    alerter: defaultRestAlerter(),
  },
  render: (args) =>
    html`<ptk-rest-timer
      .timer=${args.timer}
      .now=${args.now}
      .lift=${args.lift}
      .alerts=${args.alerts}
      .alerter=${args.alerter}
    ></ptk-rest-timer>`,
};

export default meta;

type Story = StoryObj<PtkRestTimer>;

/**
 * A minute into a three-minute rest.
 *
 * The ordinary state, and the one the layout has to survive: a countdown, five controls
 * and no sentence. The digits are tabular so the line does not shuffle sideways as they
 * change -- worth checking against the paused story, where they are the same width.
 */
export const Running: Story = {};

/**
 * Stopped, with two minutes still owed.
 *
 * Pause is the control that changes shape: it becomes Resume, and it is the only one
 * drawn as the primary action, because a paused timer's obvious next press is the one
 * that starts it again. The sentence beside the heading is what stops a frozen number
 * reading as a broken one.
 */
export const Paused: Story = {
  args: { timer: { kind: 'paused', remainingMillis: 120_000, totalSeconds: REST_SECONDS } },
};

/**
 * The rest ran out.
 *
 * Zero rather than a negative count of how far over the lifter is -- the tool has no
 * opinion about that (section 15.3), and a second number to read is the last thing
 * anybody wants at the moment they are walking back to the bar. Pause is gone, because
 * there is nothing left to pause; Start again and Done resting are what remain.
 */
export const RestIsUp: Story = {
  args: { timer: running(REST_SECONDS + 40) },
};

/**
 * A rest long enough to need two digits of minutes.
 *
 * Five minutes between heavy singles is ordinary, and it is the width the clock has to
 * hold without the controls below it reflowing.
 */
export const ALongRest: Story = {
  args: { timer: running(15, 300) },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than a
 * viewport parameter -- the wrapper is what the element responds to.
 *
 * Five controls do not fit on one line here and are not meant to. What matters is that
 * they wrap into rows of whole buttons, each still 44px tall, rather than into a strip
 * that scrolls sideways and hides the last one.
 */
export const Narrow: Story = {
  args: { lift: aLift() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-rest-timer
        .timer=${args.timer}
        .now=${args.now}
        .lift=${args.lift}
        .alerts=${args.alerts}
        .alerter=${args.alerter}
      ></ptk-rest-timer>
    </div>
  `,
};

/**
 * The rest this lift keeps, offered under the controls. Section 7.11.
 *
 * The one thing on the band that outlives the three minutes on screen, which is why it
 * is below a rule and carries a sentence saying so. Worth reviewing: that it does not
 * read as a sixth control, and that the label names the lift -- the settings screen has
 * a picker worded "Rest for" that changes every lift at once, and the two must not be
 * mistakable for each other.
 */
export const ChoosingThisLiftsRest: Story = {
  args: { lift: aLift() },
};

/**
 * The same picker on a lift already carrying its own length.
 *
 * Five minutes, chosen at some earlier session, read back rather than defaulted. Setting
 * it to whatever the default happens to be is how a lift goes back to following it --
 * there is deliberately no separate "use the default" option, because an option that
 * duplicates one already in the list is a second way to say the same thing.
 */
export const ALiftWithItsOwnRest: Story = {
  args: { timer: running(15, 300), lift: aLift(300) },
};

/**
 * The alerts, with two of the three already on. Section 7.11.
 *
 * Folded away by default, because they are set once and the band they sit on is on
 * screen after every set. Worth reviewing: that the disclosure does not read as a sixth
 * control, and that each option's second line is legible -- every one of them is an
 * admission about what its channel cannot promise, and a description nobody reads is a
 * lifter who thinks a phone on silent will still beep.
 *
 * Open it and press one. The switch fires the channel from the press that turned it on,
 * which is deliberate: it is the only moment a browser will honour a permission request,
 * and the only way to find out in the car park rather than at the rack.
 */
export const Alerts: Story = {
  args: { alerts: { sound: true, vibrate: true, notify: false } },
};

/**
 * A device that says no to all three.
 *
 * The state this feature is mostly about. Press any switch and it flicks back off with a
 * sentence under the band saying what happened and, where there is one, what to do about
 * it -- a switch that turns on and then does nothing is worse than no switch.
 *
 * Worth reviewing at 320px: two of these sentences at once must not push the controls
 * off the screen, and the text is full strength rather than the muted grey of the notes,
 * because it is the one thing on the band that is a fault.
 */
export const AnAlertThisDeviceRefuses: Story = {
  args: {
    alerter: createRestAlerter({
      tone: () => Promise.resolve(false),
      vibrate: () => false,
      notifications: {
        permission: () => 'denied',
        request: () => Promise.resolve('denied'),
        post: () => undefined,
      },
    }),
  },
};
