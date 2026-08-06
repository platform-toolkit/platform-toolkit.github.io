// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The movements a lifter added themselves.
 *
 * Worth reading rather than pressing. The form is four questions and two of them are
 * questions no other screen in the collection asks -- what a movement's loading model
 * is, and whether a warm-up should be built for it -- so what these stories are for is
 * checking the wording. A reviewer who cannot answer "what gets recorded" from the
 * label and its hint alone is looking at a form that will be answered wrongly.
 *
 * The element stores nothing on its own. What happens after a press is the root
 * element's decision (section 12.3) and is covered by
 * `ptk-exercise-library.browser.test.ts`, which drives the whole tool.
 *
 * Every movement name here is invented (section 5.1).
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { WarmupFamily } from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { CustomExercise, LoadingModel } from '../types.js';

import type { PtkExerciseLibrary } from './ptk-exercise-library.js';
import { AT_START } from './story.fixture.js';

// Through the package entry and behind an explicit call, like every other story file
// here. A relative import would define every tag a second time and the only symptom
// would be a console error.
defineTrainingLogbook();

function aMovement(
  id: string,
  name: string,
  loading: LoadingModel,
  warmupFamily: WarmupFamily | null = null,
): CustomExercise {
  // Both timestamps are the same literal. They are not rendered, and a clock read here
  // would make the story a different one every time it was opened.
  return {
    id,
    name,
    loading,
    warmupFamily,
    defaultUnit: null,
    createdAt: AT_START,
    updatedAt: AT_START,
  };
}

/**
 * Three movements chosen to differ in their loading model rather than in their names.
 *
 * A library whose rows differ only in wording would let a row that ignored the model it
 * was given look correct in a screenshot.
 */
const A_LIBRARY: readonly CustomExercise[] = [
  aMovement('exercise-1', 'Belt squat', 'machine-or-cable-weight'),
  aMovement('exercise-2', 'Safety bar squat', 'barbell-total-weight', 'squat-press'),
  aMovement('exercise-3', 'Ring dip', 'bodyweight-plus-added-weight'),
];

const meta: Meta<PtkExerciseLibrary> = {
  title: 'Training logbook/Exercise library',
  component: 'ptk-exercise-library',
  tags: ['autodocs'],
  args: {
    exercises: A_LIBRARY,
    unreadable: false,
  },
  render: (args) => html`
    <ptk-exercise-library
      .exercises=${args.exercises}
      ?unreadable=${args.unreadable}
    ></ptk-exercise-library>
  `,
};

export default meta;

type Story = StoryObj<PtkExerciseLibrary>;

/**
 * Three movements saved, and the form open on a new one.
 *
 * The form opens on a barbell, so the warm-up tick is on screen and off. That is the
 * pair section 6.4 is about: the control exists, and nothing has answered it. A row's
 * loading model is shown beside its name because it is the one thing about a movement
 * a lifter cannot work out from the name they gave it.
 */
export const ThreeMovements: Story = {};

/**
 * The first time anybody opens it.
 *
 * The sentence under the heading is the whole point of this story. An empty list with a
 * heading over it reads as a read that failed, and the second sentence is there so a
 * lifter does not think the built-in catalogue has gone with it.
 */
export const NothingAddedYet: Story = {
  args: { exercises: [] },
};

/**
 * The library could not be read, which is not the same screen as an empty one.
 *
 * They look identical and only one of them makes adding under a familiar name safe: the
 * movement is still in the database, so adding will replace something the lifter cannot
 * see -- and that something may still be attached to sessions in their history. Nothing
 * is disabled, because the built-in catalogue is unaffected and a lifter with a failed
 * read can still plan a squat.
 */
export const LibraryUnreadable: Story = {
  args: { unreadable: true, exercises: [] },
};

/** At 320 px, which is where the row of controls under each movement has to wrap. */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-exercise-library
        .exercises=${args.exercises}
        ?unreadable=${args.unreadable}
      ></ptk-exercise-library>
    </div>
  `,
};
