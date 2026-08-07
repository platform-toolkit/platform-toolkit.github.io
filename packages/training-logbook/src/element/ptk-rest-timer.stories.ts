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
 * on top of it.
 *
 * Every duration here is invented (section 5.1).
 */
import { startRest, type Instant, type RestTimer } from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkRestTimer } from './ptk-rest-timer.js';

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

const meta: Meta<PtkRestTimer> = {
  title: 'Training logbook/Rest timer',
  component: 'ptk-rest-timer',
  tags: ['autodocs'],
  args: { timer: running(60), now: () => AT_START },
  render: (args) => html`<ptk-rest-timer .timer=${args.timer} .now=${args.now}></ptk-rest-timer>`,
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
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-rest-timer .timer=${args.timer} .now=${args.now}></ptk-rest-timer>
    </div>
  `,
};
