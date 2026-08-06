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
import {
  createWorkout,
  finishWorkout,
  startWorkout,
  summarize,
  type SessionContext,
  type WorkoutSummary,
} from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkWorkoutHistory } from './ptk-workout-history.js';
import { AT_LATER, AT_START, A_TRAINING_DAY, RECENT_WORKOUTS } from './story.fixture.js';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// every one of its tags a second time: the registry throws on the second write, the story still looks
// right because the first definition already won, and the only symptom is a console error
// -- which `smoke-stories.mjs` fails on, for exactly this reason.
defineTrainingLogbook();

/**
 * A finished session with no title and nothing in it.
 *
 * Through the core rather than typed out, for `story.fixture.ts`'s reason: a summary
 * written by hand is free to hold a shape `summarize` would never return, and a page
 * built on one is the page a reviewer would trust. This is the ordinary route to an
 * empty row -- started, nothing done, finished anyway -- so a change to any of those
 * three functions moves the story with it.
 *
 * The day and the two instants are the shared fixture's invented literals (section 5.1),
 * not the clock: `A_TRAINING_DAY` is what the row prints and the twenty minutes between
 * `AT_START` and `AT_LATER` is the duration on it, so the page reads the same every time
 * it is opened. `nextId` answers once because `createWorkout` is the only call here that
 * mints one, and it is prefixed out of the `history-*` sequence `RECENT_WORKOUTS` uses --
 * a repeated identifier is a repeated list key, and Lit reuses one row's DOM for
 * another's data.
 */
function anUnnamedWorkout(): WorkoutSummary {
  const context: SessionContext = { nextId: () => 'blank-1', at: AT_START };
  const started = startWorkout(
    createWorkout(context, { localDate: A_TRAINING_DAY, title: null }),
    context,
  );
  return summarize(finishWorkout(started, 'leave', { ...context, at: AT_LATER }));
}

const meta: Meta<PtkWorkoutHistory> = {
  title: 'Training logbook/Workout history',
  component: 'ptk-workout-history',
  tags: ['autodocs'],
  args: {
    workouts: RECENT_WORKOUTS,
    // False by default, so every story below except the one that says otherwise offers
    // Repeat on each row -- which is the list as a lifter with no session open meets it.
    busy: false,
  },
  render: (args) => html`
    <ptk-workout-history .workouts=${args.workouts} ?busy=${args.busy}></ptk-workout-history>
  `,
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
 *
 * Every row carries Open and Repeat, trailing, so two columns of them line up under one
 * another. Open is first because it is the one that is safe to press by accident.
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
 * A session is already open, so not one of these can be started again.
 *
 * The buttons are omitted rather than disabled, and that is the whole reason this story
 * is here beside `SomeTraining`: a disabled control gives no reason and a screen reader
 * skips it, so three rows of them are three silent dead ends and eight rows are eight.
 * What the lifter gets instead is `HISTORY_NOTES.repeatBusy` once, above the list, because
 * the reason is never about the row -- the same rule the builder's warm-up note is written
 * under.
 *
 * Open stays on every row, and that is the half of this story worth checking. The reason
 * Repeat goes is that only one session can be open at a time, and that reason says
 * nothing about reading: standing at the rack between sets wondering what the last set of
 * five went at is one of the reasons the logbook is out at all.
 */
export const WorkoutInProgress: Story = {
  args: { busy: true },
};

/**
 * A row with no title and nothing in it, which is where Repeat's label has to hold.
 *
 * Both halves of the row fall back at once: the heading reads `HISTORY_NOTES.unnamed` and
 * the line under it `HISTORY_NOTES.noExercises`. The button is the part worth inspecting.
 * Its visible word is "Repeat" like every other row's, and its accessible name is built
 * from the heading's fallback rather than from the missing title -- "Repeat: Workout,
 * 2026-03-10", never "Repeat: null". A list of untitled sessions is otherwise a list of
 * buttons all called the same thing, which is exactly what the per-row name exists to
 * prevent.
 *
 * House convention is `accessible-name=`, hyphenated. A Lit template lowercases an
 * attribute name, so the camel-cased spelling reaches nothing and the button quietly has
 * no name at all -- a failure with no symptom outside a screen reader, which is why the
 * one row most likely to expose it gets a page of its own.
 */
export const UnnamedWorkout: Story = {
  args: { workouts: [anUnnamedWorkout()] },
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
      <ptk-workout-history .workouts=${args.workouts} ?busy=${args.busy}></ptk-workout-history>
    </div>
  `,
};
