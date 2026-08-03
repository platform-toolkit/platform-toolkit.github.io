// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §14.1's panel, in every band it passes through.
 *
 * All four come out of one recorded opener and four instants, which is the point
 * worth making in a story file: the panel has no timer in it. The screen above it
 * repaints off the clock seam and hands in a view whose seconds are
 * `deadline - now`, so a story is a photograph of one instant and a test is an
 * assertion about one instant. Nothing here waits.
 *
 * The fixture rule profile allows ninety seconds rather than the sixty §14.1
 * describes for USPA/IPL, and deliberately so (§5.1): the two urgency thresholds
 * are absolute seconds, so a fixture whose deadline matched the real one would
 * let a story pass while measuring the wrong boundary.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  OPENER,
  SECOND,
  START,
  contextAt,
  meetWith,
  submit,
  submissionOf,
  take,
} from './live-fixture.js';
import type { Haptics, PtkSubmissionCountdown } from './ptk-submission-countdown.js';
import './ptk-submission-countdown.js';

/** One made opener, which is what starts the clock. */
const RECORDED = take(meetWith(), 'squat', OPENER);

/** The same opener with the next weight already at the table. */
const HANDED_IN = submit(RECORDED, 'squat', SECOND, START + 5_000);

/** Seconds into the minute, so each story names the instant rather than the band. */
function at(seconds: number) {
  return submissionOf(RECORDED, contextAt(START + seconds * 1_000));
}

/**
 * A story never buzzes the reviewer's phone.
 *
 * The default port is the device's, and Storybook renders every story in the
 * docs page at once -- so the real one would fire four times on load, on a laptop
 * that cannot show what happened.
 */
const SILENT: Haptics = () => {
  // Deliberately nothing.
};

const meta: Meta<PtkSubmissionCountdown> = {
  title: 'Meet day/Submission countdown',
  component: 'ptk-submission-countdown',
  tags: ['autodocs'],
  args: { haptics: SILENT },
  render: (args) =>
    html`<ptk-submission-countdown
      .submission=${args.submission}
      .haptics=${args.haptics}
    ></ptk-submission-countdown>`,
};

export default meta;

type Story = StoryObj<PtkSubmissionCountdown>;

/** The top of the minute. No weight chosen yet, so the button has nothing to mark. */
export const WithTimeLeft: Story = {
  args: { submission: at(0) },
};

/**
 * Under thirty seconds.
 *
 * The border changes and so does the sentence. §5.8 forbids colour as the sole
 * carrier of meaning, and this panel is the case that makes the rule concrete: a
 * handler reads it aloud across a warm-up room, where a border has never been
 * heard.
 */
export const RunningShort: Story = {
  args: { submission: at(65) },
};

/** Under ten. The sentence is two words because there is time for two words. */
export const AlmostOut: Story = {
  args: { submission: at(85) },
};

/**
 * The minute has gone.
 *
 * The panel does not disappear and does not scold. It says what the officials
 * write down instead -- the automatic weight §14.1 asks for -- because a lifter
 * reading this after the deadline needs to know what they are now lifting, not
 * that they were late.
 */
export const Lapsed: Story = {
  args: { submission: at(95) },
};

/**
 * Marked handed in, with time still on the clock.
 *
 * The button is spent and the status line says so in words rather than by being
 * greyed. The clock keeps running because the deadline has not moved: §14
 * distinguishes submitted from confirmed, and the tool cannot see the second one.
 */
export const MarkedHandedIn: Story = {
  args: { submission: submissionOf(HANDED_IN, contextAt(START + 10_000)) },
};

/** No deadline is running, which is a sentence and not an empty box. */
export const NothingRunning: Story = {
  args: { submission: null },
};

/** The narrowest phone still in use (§5.7), constrained by a wrapper. */
export const Narrow: Story = {
  args: { submission: at(85) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-submission-countdown
        .submission=${args.submission}
        .haptics=${args.haptics}
      ></ptk-submission-countdown>
    </div>
  `,
};
