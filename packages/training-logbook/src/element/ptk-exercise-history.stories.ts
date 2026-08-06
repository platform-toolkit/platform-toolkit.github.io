// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One lift, read back across every session it has ever appeared in.
 *
 * The page a lifter lands on when they want to know whether today's top set is the most
 * they have done. What is worth reviewing here is restraint: the marks have to be
 * findable at arm's length and still read as measurements rather than as a scoreboard,
 * and section 15.3 is easiest to break on exactly this screen.
 *
 * Every weight, rep count, note and day here is invented (section 5.1).
 */
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  searchExerciseHistory,
  setExerciseNote,
  startWorkout,
  type CalendarDay,
  type ExerciseHistory,
  type SessionContext,
  type WorkoutSession,
} from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkExerciseHistory } from './ptk-exercise-history.js';
import { AT_LATER, AT_START } from './story.fixture.js';

// Through the package entry and behind an explicit call, for the reason spelled out in
// `ptk-workout-history.stories.ts`: a relative import would define every tag twice.
defineTrainingLogbook();

const SQUAT = 'squat';

/** A barbell load at an invented weight. */
function kg(amount: number): ReturnType<typeof performance>['load'] {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

/** A counter of the shared fixture's kind, prefixed out of every other story's sequence. */
function series(prefix: string): (at: typeof AT_START) => SessionContext {
  let next = 0;
  const nextId = (): string => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return (at) => ({ nextId, at });
}

/** One session's worth of squats, done exactly as written. */
function aSquatDay(
  prefix: string,
  localDate: CalendarDay,
  weight: number,
  reps: number,
  note: string | null = null,
): WorkoutSession {
  const at = series(prefix);
  let session = createWorkout(at(AT_START), { localDate, title: 'Lower' });
  session = addExercise(session, at(AT_START), {
    exerciseId: SQUAT,
    displayName: 'Back squat',
    loading: 'barbell-total-weight',
    plan: [
      { kind: 'warmup', performance: performance(kg(60), 8) },
      { kind: 'working', performance: performance(kg(weight), reps) },
      { kind: 'working', performance: performance(kg(weight), reps) },
    ],
  });
  session = startWorkout(session, at(AT_START));

  const squat = session.exercises[0];
  if (squat === undefined) throw new Error('the fixture lost an exercise');
  for (const set of squat.sets) session = completeSet(session, set.id, at(AT_LATER));
  if (note !== null) session = setExerciseNote(session, squat.id, note, at(AT_LATER));
  return finishWorkout(session, 'leave', at(AT_LATER));
}

/**
 * Walks a run of sessions the way the repository does.
 *
 * Newest day first, which is `scanWorkouts`' order and the order the search is written
 * against. Built through the core rather than typed out, for `story.fixture.ts`'s
 * reason: a history written by hand is free to hold marks the core would never place.
 */
function walk(sessions: readonly WorkoutSession[], limit?: number): ExerciseHistory {
  const search = searchExerciseHistory(SQUAT, limit === undefined ? {} : { limit });
  for (const session of sessions) search.consider(session);
  return search.history();
}

/**
 * Three months of squatting, with all three marks on the screen at once.
 *
 * The weights climb and one session goes heavier for fewer, which is what spreads the
 * marks over three rows: May is the heaviest, April is the most reps at a weight trained
 * across two sessions and the most weight for five, and March is the most weight for
 * four. Nine rows and three marks -- what is worth reviewing is how the unmarked six
 * read, because a screen where every row is decorated has said nothing.
 */
function aTrainedLift(limit?: number): ExerciseHistory {
  return walk(
    [
      aSquatDay('may', '2026-05-18', 145, 3),
      aSquatDay('apr', '2026-04-20', 130, 5, 'Belt on from the second set.'),
      aSquatDay('mar', '2026-03-16', 130, 4),
    ],
    limit,
  );
}

/** Never trained. Reachable the moment a lift is added to a plan. */
function anUntrainedLift(): ExerciseHistory {
  return walk([]);
}

const meta: Meta<PtkExerciseHistory> = {
  title: 'Training logbook/Exercise history',
  component: 'ptk-exercise-history',
  tags: ['autodocs'],
  args: { history: aTrainedLift() },
  render: (args) => html`<ptk-exercise-history .history=${args.history}></ptk-exercise-history>`,
};

export default meta;

type Story = StoryObj<PtkExerciseHistory>;

/**
 * Four sessions, three marks, and nothing that adds them up.
 *
 * The marks are words in the same register as the weights beside them. No badge, no
 * colour, no count of how many there are: section 15.3 rules out the tool having an
 * opinion, and everything that would make a mark feel earned also makes the unmarked
 * sessions read as failures.
 */
export const ALiftWithAHistory: Story = {};

/**
 * More sessions than the screen lists.
 *
 * The sentence at the bottom is the whole point of this state. The marks are folded over
 * every session and the list is capped, so a lifter whose best day is off the end must
 * be told that the two answer different questions -- otherwise the heaviest line at the
 * top looks like it disagrees with the rows underneath it.
 */
export const MoreThanFits: Story = {
  args: { history: aTrainedLift(2) },
};

/**
 * A lift with nothing behind it yet.
 *
 * Reachable the first time a lifter opens the history of something they have just added
 * to a plan. It says so plainly rather than drawing an empty list, which would read as a
 * failed load -- the distinction the workout detail screen draws for the same reason.
 */
export const NothingYet: Story = {
  args: { history: anUntrainedLift() },
};

/**
 * The history could not be read.
 *
 * One answer for a database that would not open and for a read that threw. A lifter can
 * act on neither, and it must be plainly different from the empty state above: "you have
 * never done this" is a thing this screen must never say by accident.
 */
export const CouldNotBeRead: Story = {
  args: { history: null },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than a
 * viewport parameter -- the wrapper is what the element responds to.
 *
 * The tight line is a set row with a mark under it: a kind, a load, a status and then a
 * phrase like "Most weight for these reps", which is the longest string on the screen and
 * the one most likely to break the layout.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-exercise-history .history=${args.history}></ptk-exercise-history>
    </div>
  `,
};
