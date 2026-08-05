// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen section 4.1 walks through, whose whole job is to be finished quickly.
 *
 * Another one worth pressing. The plan rows are internal state and appear only when an
 * exercise is added, so the stories below document what the screen offers rather than what
 * a filled-in plan looks like -- tap a primary lift and the row, its counts and its weight
 * box appear, with the counts already seeded from the catalogue and the weight left blank
 * on purpose (section 7.4: a prefilled number is one a lifter has to notice before they
 * overwrite it).
 *
 * Every exercise here is a catalogue movement and no figure on this screen is a federation
 * figure (section 5.1); the seeded counts are the catalogue's own defaults.
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { CATALOG_EXERCISES, PRIMARY_EXERCISES } from '../core/catalog.js';

import type { PtkWorkoutBuilder } from './ptk-workout-builder.js';
import { A_TRAINING_DAY } from './story.fixture.js';

// Through the package entry and behind an explicit call. See the note in the history
// stories: a relative import would define every tag a second time and the only symptom
// would be a console error.
defineTrainingLogbook();

const meta: Meta<PtkWorkoutBuilder> = {
  title: 'Training logbook/Workout builder',
  component: 'ptk-workout-builder',
  tags: ['autodocs'],
  args: {
    // A literal, never the clock. A story that defaulted the date field to today would
    // document a different screen every day and could never be reviewed against itself.
    today: A_TRAINING_DAY,
    unit: 'kg',
    exercises: CATALOG_EXERCISES,
  },
  render: (args) => html`
    <ptk-workout-builder
      .today=${args.today}
      .unit=${args.unit}
      .exercises=${args.exercises}
    ></ptk-workout-builder>
  `,
};

export default meta;

type Story = StoryObj<PtkWorkoutBuilder>;

/**
 * The screen as it opens: a date, an optional name, four tiles and a picker.
 *
 * The four competition lifts are on the page rather than behind the picker because they
 * are what most sessions start with, and the sentence beside them exists because four
 * tiles with no framing read as the only four the tool knows. The plan below them is empty
 * and says so -- an empty list under a Start button reads as a broken screen.
 */
export const EmptyPlan: Story = {};

/**
 * The display in pounds.
 *
 * Only the weight boxes change. Section 11.4: this setting decides what new entries are
 * typed in and converts nothing that is already recorded, which is a promise the builder
 * keeps by never having anything recorded on it.
 */
export const InPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * A catalogue holding only the four competition lifts.
 *
 * What a consumer supplying its own exercise list gets. The picker still renders, with the
 * primaries already on the page above it, and the screen does not pretend there is more
 * behind it than there is.
 */
export const OnlyTheCompetitionLifts: Story = {
  args: { exercises: PRIMARY_EXERCISES },
};

/**
 * No exercises at all, which is what a consumer that passes an empty list produces.
 *
 * Not a state the shipped tool reaches -- it hands over the built-in catalogue -- and
 * worth documenting for exactly that reason: the picker says nobody has given it anything
 * to choose from rather than rendering an empty control that looks broken.
 */
export const NoCatalogue: Story = {
  args: { exercises: [] },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * The tight row is Sets, Reps and Weight side by side once an exercise is added; the four
 * primary tiles are the other one, and they are on an intrinsic grid rather than a fixed
 * column count so they reflow instead of overflowing.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-workout-builder
        .today=${args.today}
        .unit=${args.unit}
        .exercises=${args.exercises}
      ></ptk-workout-builder>
    </div>
  `,
};
