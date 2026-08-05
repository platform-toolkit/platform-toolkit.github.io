// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen a lifter reads between sets, with a belt on.
 *
 * This is the one worth pressing rather than looking at. Section 21's whole claim is that
 * logging a set is one tap, and a screenshot proves the button exists; tapping Done and
 * watching the row tick, the progress line move and an Undo appear in the same place is
 * the thing the claim is actually about. The finish panel is internal state and only
 * appears after Finish the workout is pressed -- deliberately, because it asks a question
 * (section 7.12) and a question with a preselected answer is not one.
 *
 * Every weight and every session here is invented (section 5.1).
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkActiveWorkout } from './ptk-active-workout.js';
import { AT_LATER, aBodyweightSession, aStartedSession } from './story.fixture.js';

// Through the package entry and behind an explicit call. See the note in the history
// stories: a relative import would define every tag a second time and the only symptom
// would be a console error.
defineTrainingLogbook();

const meta: Meta<PtkActiveWorkout> = {
  title: 'Training logbook/Active workout',
  component: 'ptk-active-workout',
  tags: ['autodocs'],
  args: {
    session: aStartedSession(),
    unit: 'kg',
    // Pinned. A story that read the clock would stamp a different instant on every set
    // completed in it, and two reviewers would be looking at different pages.
    now: () => AT_LATER,
  },
  render: (args) => html`
    <ptk-active-workout
      .session=${args.session}
      .unit=${args.unit}
      .now=${args.now}
    ></ptk-active-workout>
  `,
};

export default meta;

type Story = StoryObj<PtkActiveWorkout>;

/**
 * Six sets planned and none of them done yet, which is the page as the bar is loaded.
 *
 * Two exercises, because almost every layout question here is invisible with one: how the
 * second heading reads under the first exercise's last row, and where the progress line
 * sits relative to both. Every row offers Done and Change what you did, and nothing on the
 * page says what the lifter ought to do with them.
 */
export const JustStarted: Story = {};

/**
 * One set in, which is where the two states of a row can be compared.
 *
 * The completed row swaps Done for Undo in the same position rather than adding a control
 * beside it. A tap that cannot be taken back is a tap nobody makes confidently, and a tap
 * whose reversal is somewhere else on the page is nearly as bad with a barbell waiting.
 */
export const PartlyDone: Story = {
  args: { session: aStartedSession({ completed: 1 }) },
};

/**
 * Everything ticked, and still a Finish button rather than an automatic finish.
 *
 * The tool never decides a session is over. A workout with every planned set complete is a
 * workout a lifter may still add to, and one that closed itself would have to be reopened
 * -- which this version cannot do, and says so in the finish panel.
 */
export const AllSetsDone: Story = {
  args: { session: aStartedSession({ completed: 3, prefix: 'all' }) },
};

/**
 * Chin-ups, which record a rep count and no weight.
 *
 * The failure this story exists to make visible is silent: a set line that printed "Not
 * set" beside a bodyweight movement would be reporting a missing weight that is not
 * missing, and nothing about the page would look wrong. It reads "8 reps".
 */
export const Bodyweight: Story = {
  args: { session: aBodyweightSession() },
};

/**
 * The display switched to pounds over a session that was typed in kilograms.
 *
 * Section 11.4, and the reason it is a story rather than only a test: every recorded
 * weight still reads in kilograms, because that is what the lifter typed, and only the
 * boxes for new entries are in pounds. A tool that converted the history would round
 * somewhere new every time the setting was touched.
 */
export const ShownInPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * The hardest row in the tool: a set kind, a weight and rep count, and two buttons that
 * each have to keep a 44-pixel tap target (48 in this flow, which is the one a lifter uses
 * with cold hands).
 */
export const Narrow: Story = {
  args: { session: aStartedSession({ completed: 1, prefix: 'narrow' }) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-active-workout
        .session=${args.session}
        .unit=${args.unit}
        .now=${args.now}
      ></ptk-active-workout>
    </div>
  `,
};
