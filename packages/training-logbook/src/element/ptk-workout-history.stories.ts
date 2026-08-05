// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a lifter has already done, listed newest first.
 *
 * The read-only half of the tool, and the one whose empty state matters most: a list with
 * nothing in it is the first thing anybody sees, and the difference between "nothing
 * logged yet" and a read that silently failed is a sentence.
 *
 * Every weight and every session here is invented (section 5.1).
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkWorkoutHistory } from './ptk-workout-history.js';
import { RECENT_WORKOUTS } from './story.fixture.js';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// four tags a second time: the registry throws on the second write, the story still looks
// right because the first definition already won, and the only symptom is a console error
// -- which `smoke-stories.mjs` fails on, for exactly this reason.
defineTrainingLogbook();

const meta: Meta<PtkWorkoutHistory> = {
  title: 'Training logbook/Workout history',
  component: 'ptk-workout-history',
  tags: ['autodocs'],
  args: { workouts: RECENT_WORKOUTS },
  render: (args) => html`<ptk-workout-history .workouts=${args.workouts}></ptk-workout-history>`,
};

export default meta;

type Story = StoryObj<PtkWorkoutHistory>;

/**
 * Three finished sessions, newest first.
 *
 * The order comes from the repository rather than from this element -- `byMostRecent`
 * sorts it at the storage layer, where the whole list is already in hand. An element that
 * sorted its own property would be sorting a page of a list it cannot see the rest of,
 * which is the bug that arrives the day this list is paginated.
 */
export const SomeTraining: Story = {};

/**
 * Nothing logged yet.
 *
 * The state most likely to read as broken, and the reason `HOME_NOTES.historyEmpty` is a
 * sentence rather than an absence. A heading over an empty box is indistinguishable from
 * a failed read; a heading over "your finished workouts will be listed here" is a
 * beginning.
 */
export const NothingYet: Story = {
  args: { workouts: [] },
};

/**
 * One row, so the row itself can be read.
 *
 * Four facts on a line -- status, working-set count, duration, whether it carries notes --
 * and no fifth one summarising them. Section 15.3: a row that added "solid session" would
 * be grading work this tool did not watch.
 */
export const OneWorkout: Story = {
  args: { workouts: RECENT_WORKOUTS.slice(0, 1) },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * The tight pair is the title and the date on one line: the date is `white-space: nowrap`
 * because "2026-08-" on its own line is not a date, so the title is what has to give.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-workout-history .workouts=${args.workouts}></ptk-workout-history>
    </div>
  `,
};
