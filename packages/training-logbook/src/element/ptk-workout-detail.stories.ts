// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One session, opened out of the history and read back.
 *
 * The page a lifter lands on when they want to know what last Tuesday actually was, and
 * the only screen in the tool with nothing to press on it. What is worth reviewing here
 * is the density: five or six sets under two headings, on a phone, with the numbers
 * findable at arm's length.
 *
 * Every weight, rep count, note and day here is invented (section 5.1).
 */
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  recordSet,
  setExerciseNote,
  setSetNote,
  setWorkoutNote,
  skipSet,
  startWorkout,
  type SessionContext,
  type WorkoutSession,
} from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkWorkoutDetail } from './ptk-workout-detail.js';
import { AT_LATER, AT_START, A_TRAINING_DAY } from './story.fixture.js';

// Through the package entry and behind an explicit call, for the reason spelled out in
// `ptk-workout-history.stories.ts`: a relative import would define every tag twice.
defineTrainingLogbook();

/** A barbell load at an invented weight. */
function kg(amount: number): ReturnType<typeof performance>['load'] {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

/**
 * A counter of the shared fixture's kind, prefixed out of every other story's sequence.
 *
 * A repeated identifier is a repeated list key, and Lit reuses one row's DOM for
 * another's data -- which on a page of near-identical set rows looks correct right up
 * until something changes.
 */
function series(prefix: string): (at: typeof AT_START) => SessionContext {
  let next = 0;
  const nextId = (): string => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return (at) => ({ nextId, at });
}

/**
 * A squat and a bench press, done, with the three things worth looking at on this screen.
 *
 * Built through the core rather than typed out, for `story.fixture.ts`'s reason: a
 * session written by hand is free to hold a shape the core would never produce, and a
 * page built on one is the page a reviewer would trust.
 *
 * The three are a warm-up above the work, a working set edited down from what it was
 * written as, and a set that was skipped. Each renders differently and each is a line a
 * template can get wrong without looking wrong -- the edited set is the only place on
 * the screen where two numbers for one set are both true.
 */
function aWorkoutWorthReading(): WorkoutSession {
  const at = series('detail');
  let session = createWorkout(at(AT_START), { localDate: A_TRAINING_DAY, title: 'Squat day' });
  session = addExercise(session, at(AT_START), {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: [
      { kind: 'warmup', performance: performance(kg(60), 8) },
      { kind: 'working', performance: performance(kg(100), 5) },
      { kind: 'working', performance: performance(kg(100), 5) },
      { kind: 'working', performance: performance(kg(100), 5) },
    ],
  });
  session = addExercise(session, at(AT_START), {
    exerciseId: 'bench-press',
    displayName: 'Bench press',
    loading: 'barbell-total-weight',
    plan: [
      { kind: 'working', performance: performance(kg(70), 6) },
      { kind: 'working', performance: performance(kg(70), 6) },
    ],
  });
  session = startWorkout(session, at(AT_START));

  const squat = session.exercises[0];
  const bench = session.exercises[1];
  if (squat === undefined || bench === undefined) throw new Error('the fixture lost an exercise');
  const [warmup, first, second, third] = squat.sets;
  const [pressOne, pressTwo] = bench.sets;
  if (
    warmup === undefined ||
    first === undefined ||
    second === undefined ||
    third === undefined ||
    pressOne === undefined ||
    pressTwo === undefined
  ) {
    throw new Error('the fixture lost a set');
  }

  session = completeSet(session, warmup.id, at(AT_START));
  session = completeSet(session, first.id, at(AT_LATER));
  // The one edited row: written as 100 for 5, done at 95 for 4, at an RPE nobody
  // planned. Both numbers stay true and the screen has to show which is which.
  session = recordSet(
    session,
    second.id,
    performance(kg(95), 4, { scale: 'rpe', value: 9 }),
    at(AT_LATER),
  );
  session = setSetNote(session, second.id, 'Cut it short, hip was tight.', at(AT_LATER));
  session = skipSet(session, third.id, at(AT_LATER));
  session = completeSet(session, pressOne.id, at(AT_LATER));
  session = completeSet(session, pressTwo.id, at(AT_LATER));

  session = setExerciseNote(session, squat.id, 'Belt on from the second set.', at(AT_LATER));
  session = setWorkoutNote(session, 'Short on time, cut the last squat.', at(AT_LATER));
  return finishWorkout(session, 'leave', at(AT_LATER));
}

/** Started, nothing added, finished anyway. The ordinary route to an empty record. */
function anEmptyWorkout(): WorkoutSession {
  const at = series('empty');
  const started = startWorkout(
    createWorkout(at(AT_START), { localDate: A_TRAINING_DAY, title: null }),
    at(AT_START),
  );
  return finishWorkout(started, 'leave', at(AT_LATER));
}

const meta: Meta<PtkWorkoutDetail> = {
  title: 'Training logbook/Workout detail',
  component: 'ptk-workout-detail',
  tags: ['autodocs'],
  args: { session: aWorkoutWorthReading() },
  render: (args) => html`<ptk-workout-detail .session=${args.session}></ptk-workout-detail>`,
};

export default meta;

type Story = StoryObj<PtkWorkoutDetail>;

/**
 * The whole of a session that was actually trained.
 *
 * Six set rows under two headings, with a warm-up, an edit and a skip among them, and
 * notes at all three levels. Nothing on the page adds up the work or says how it went:
 * section 15.3, and this is the screen where the temptation lives, because every number
 * needed to grade the session is already on it.
 */
export const AWorkoutRead: Story = {};

/**
 * A record with nothing in it.
 *
 * Reachable -- a session started and abandoned before a lift went in is still a row in
 * the history -- and the state most likely to read as a failed read. The sentence is
 * what separates the two, which is the same reason the history's empty list has one.
 */
export const NothingRecorded: Story = {
  args: { session: anEmptyWorkout() },
};

/**
 * The workout could not be read.
 *
 * One answer for two causes: a row that is not there, and a database that would not
 * open. A lifter can act on neither, so they get the same sentence -- and it has to be
 * plainly different from the empty one above, because "you did nothing that day" is a
 * thing this screen must never say by accident.
 */
export const CouldNotBeRead: Story = {
  args: { session: null },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than a
 * viewport parameter -- the wrapper is what the element responds to.
 *
 * The tight line is a set row: a kind, a load, a status and an effort, four things that
 * wrap onto two lines here and must stay readable as one set rather than two.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-workout-detail .session=${args.session}></ptk-workout-detail>
    </div>
  `,
};
