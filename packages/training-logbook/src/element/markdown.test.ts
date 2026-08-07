// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The readable copy, and the four ways a document can quietly stop being one.
 *
 * Every failure this file is built to catch produces a file that opens, renders and
 * looks like a training log. A converted weight is a plausible number. A dropped
 * session leaves a document that reads as complete. A note collapsed onto one line is
 * still a note. A marker stitched to the wrong row is a record claimed on a day it was
 * not set. None of them throw, and none of them are visible to anybody who does not
 * already know what the answer should have been -- which is why the assertions below
 * are on the text of the document rather than on an object it was built from.
 *
 * Every session here is built through the core rather than typed out, for the reason
 * `story.fixture.ts` gives: a hand-written `WorkoutSession` is free to hold a shape the
 * core would never produce, and a document rendered from an impossible session proves
 * nothing about the documents lifters will get.
 *
 * Invented numbers throughout, section 5.1. 95 and 100 kilograms because they are
 * round, one plate change apart, and neither is a rep count.
 */

import type { Weight } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import { backupFilename, createBackup, type TrainingLogbookBackup } from '../core/backup.js';
import { CATALOG_EXERCISES, findExercise, loadFor } from '../core/catalog.js';
import { contextSeries } from '../core/context.fixture.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  discardWorkout,
  finishWorkout,
  performance,
  recordSet,
  setExerciseNote,
  setSetNote,
  setWorkoutNote,
  setWorkoutTitle,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from '../core/session.js';
import { defaultSettings } from '../storage/repository.js';
import type { CalendarDay, ExerciseOption, Instant, WorkoutSession } from '../types.js';

import {
  EFFORT_LABELS,
  MARKDOWN_NOTES,
  RECORDS_NOTES,
  SET_KINDS,
  SET_STATUSES,
  UNIT_LABELS,
  WORKOUT_STATUSES,
} from './copy.js';
import { markdownExport, markdownFilename } from './markdown.js';
import { FORBIDDEN, withoutExerciseNames } from './vocabulary.fixture.js';

/**
 * The day after the later training day, deliberately.
 *
 * An export stamped on a day the logbook also trained would put that day's digits into
 * the header, and an assertion looking for the day in the document would find the header
 * line instead of the heading and pass whatever order the workouts came out in.
 */
const EXPORTED_AT: Instant = '2026-03-11T18:00:00.000Z';
const VERSION = '0.0.0-test';

/** Two invented training days, a week apart, the later one second. */
const EARLIER_DAY: CalendarDay = '2026-03-03';
const LATER_DAY: CalendarDay = '2026-03-10';

/** Invented squat weights, one plate change apart. */
const LIGHTER: Weight = { amount: 95, unit: 'kg' };
const HEAVIER: Weight = { amount: 100, unit: 'kg' };

function catalogExercise(id: string): ExerciseOption {
  const found = findExercise(id);
  if (found === null) throw new Error(`no such catalogue exercise: ${id}`);
  return found;
}

const SQUAT = catalogExercise('squat');

/**
 * Instants derived from the day, so a session's duration is a fact of the fixture.
 *
 * Twenty minutes from start to finish everywhere below, which is what makes the
 * duration line assertable without pinning a clock.
 */
function instants(day: CalendarDay): { readonly start: Instant; readonly end: Instant } {
  return { start: `${day}T17:00:00.000Z`, end: `${day}T17:20:00.000Z` };
}

interface DayOptions {
  readonly day: CalendarDay;
  readonly weight: Weight;
  /** How many working sets, all at the same weight. */
  readonly sets?: number;
  /** Absent for the default title; explicitly `null` for a session never named. */
  readonly title?: string | null;
  /**
   * How far the session got. `active` is the one worth having: a session started, with
   * every set ticked off, that nobody has pressed Done on yet.
   */
  readonly state?: 'draft' | 'active' | 'completed';
}

/**
 * One squat session, planned and -- unless asked otherwise -- done.
 *
 * The identifier prefix is the day, because a document rendered from two sessions
 * sharing a set id would mark the wrong row and the test would agree with it.
 */
function squatDay(options: DayOptions): WorkoutSession {
  const { start, end } = instants(options.day);
  const series = contextSeries();
  const prefixed = (at: Instant): SessionContext => {
    const base = series(at);
    return { at, nextId: () => `${options.day}-${base.nextId()}` };
  };

  const plan: readonly PlannedSet[] = Array.from({ length: options.sets ?? 3 }, () => ({
    kind: 'working' as const,
    performance: performance(loadFor(SQUAT.loading, options.weight), 5),
  }));

  let session = createWorkout(prefixed(start), {
    localDate: options.day,
    title: 'title' in options ? options.title : 'Squat day',
  });
  session = addExercise(session, prefixed(start), {
    exerciseId: SQUAT.id,
    displayName: SQUAT.name,
    loading: SQUAT.loading,
    plan,
  });
  const state = options.state ?? 'completed';
  if (state === 'draft') return session;

  session = startWorkout(session, prefixed(start));
  for (const set of sets(session)) {
    session = completeSet(session, set.id, prefixed(end));
  }
  if (state === 'active') return session;
  return finishWorkout(session, 'leave', prefixed(end));
}

/** The first exercise's sets, or a loud failure. A test cannot assert on half a fixture. */
function sets(session: WorkoutSession): WorkoutSession['exercises'][number]['sets'] {
  const [exercise] = session.exercises;
  if (exercise === undefined) throw new Error('the fixture lost its exercise');
  return exercise.sets;
}

function firstSetId(session: WorkoutSession): string {
  const [set] = sets(session);
  if (set === undefined) throw new Error('the fixture lost its first set');
  return set.id;
}

/** One block of a session: a lift, a weight, and how many sets of it. */
interface Block {
  readonly exercise: ExerciseOption;
  readonly weight: Weight;
  readonly sets: number;
}

/**
 * A finished session built block by block, for the two shapes `squatDay` cannot describe:
 * one lift listed twice, and a day of lifts that are not squats.
 */
function trainingDay(day: CalendarDay, blocks: readonly Block[]): WorkoutSession {
  const { start, end } = instants(day);
  const series = contextSeries();
  const prefixed = (at: Instant): SessionContext => {
    const base = series(at);
    return { at, nextId: () => `${day}-${base.nextId()}` };
  };

  let session = createWorkout(prefixed(start), { localDate: day, title: null });
  for (const block of blocks) {
    session = addExercise(session, prefixed(start), {
      exerciseId: block.exercise.id,
      displayName: block.exercise.name,
      loading: block.exercise.loading,
      plan: Array.from({ length: block.sets }, () => ({
        kind: 'working' as const,
        performance: performance(loadFor(block.exercise.loading, block.weight), 5),
      })),
    });
  }

  session = startWorkout(session, prefixed(start));
  // The list is read once, before the loop rebuilds the session under it: set
  // identifiers survive a completion and array identities do not.
  for (const set of session.exercises.flatMap((exercise) => exercise.sets)) {
    session = completeSet(session, set.id, prefixed(end));
  }
  return finishWorkout(session, 'leave', prefixed(end));
}

interface BackupOptions {
  readonly active?: WorkoutSession;
  readonly displayUnit?: 'kg' | 'lb';
  readonly equipment?: boolean;
}

function backupOf(
  workouts: readonly WorkoutSession[],
  options: BackupOptions = {},
): TrainingLogbookBackup {
  return createBackup(
    {
      settings: {
        ...defaultSettings(),
        displayUnit: options.displayUnit ?? 'lb',
        equipment:
          options.equipment === true
            ? {
                barWeight: { amount: 20, unit: 'kg' },
                collarWeight: { amount: 0, unit: 'kg' },
                plateUnit: 'kg',
                plates: [{ weight: 25, pairs: null, fullDiameter: true }],
              }
            : null,
      },
      equipmentProfiles: [],
      exerciseDefinitions: [],
      activeWorkout: options.active ?? null,
      workouts,
    },
    { exportedAt: EXPORTED_AT, applicationVersion: VERSION },
  );
}

/** Every table row in a document, header and delimiter excluded. */
function setRows(document: string): readonly string[] {
  return document
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---'))
    .filter((line) => !line.includes(MARKDOWN_NOTES.columns.performed));
}

/**
 * A session that counts every read of its exercise list.
 *
 * A getter rather than a spy because the read is the unit of work being asserted on: the
 * document asks each session what is in it once to print it and once per walk it is
 * offered to, and it is the second of those that is allowed to grow with the number of
 * lifts in the file.
 */
function counted(session: WorkoutSession, tally: { reads: number }): WorkoutSession {
  return {
    ...session,
    get exercises() {
      tally.reads += 1;
      return session.exercises;
    },
  };
}

/** Every row that earned a mark of any kind. */
function markedRows(document: string): readonly string[] {
  const marks = Object.values(RECORDS_NOTES.markers);
  return setRows(document).filter((line) => marks.some((mark) => line.includes(mark)));
}

describe('markdownFilename', () => {
  it('names the day and not the instant', () => {
    expect(markdownFilename(LATER_DAY)).toBe(`platform-toolkit-training-logbook-${LATER_DAY}.md`);
  });

  it('is never the backup taken the same day', () => {
    // Two files in one downloads folder describing one device. A shared name would
    // mean the browser silently numbered one of them, and the numbered one is the
    // file a lifter opens six months later expecting to restore from it.
    expect(markdownFilename(LATER_DAY)).not.toBe(backupFilename(LATER_DAY));
  });
});

describe('markdownExport header', () => {
  it('says which of the two files restores', () => {
    // Section 10.5's first line, put where somebody deciding what to keep will read
    // it. A readable record that did not disclaim being a backup is a readable record
    // somebody will keep instead of one.
    expect(markdownExport(backupOf([]))).toContain(MARKDOWN_NOTES.preamble);
  });

  it('states the display unit as a fact about the device', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    expect(document).toContain(`- **${MARKDOWN_NOTES.unit}:** ${UNIT_LABELS.lb}`);
  });

  it('summarises the equipment, or says there is none', () => {
    expect(markdownExport(backupOf([]))).toContain(
      `- **${MARKDOWN_NOTES.equipment}:** ${MARKDOWN_NOTES.noEquipment}`,
    );
    expect(markdownExport(backupOf([], { equipment: true }))).toContain('20 kg bar');
  });

  it('counts the workouts it actually printed', () => {
    const document = markdownExport(
      backupOf([squatDay({ day: EARLIER_DAY, weight: LIGHTER })], {
        active: squatDay({ day: LATER_DAY, weight: HEAVIER, state: 'draft' }),
      }),
    );
    // Two, not one. The unfinished session is a workout the file holds and a workout
    // the file prints, and a count taken off `workouts` alone would disagree with the
    // document underneath it.
    expect(document).toContain(`- **${MARKDOWN_NOTES.workouts}:** 2`);
  });

  it('carries the build that wrote it', () => {
    expect(markdownExport(backupOf([]))).toContain(`- **${MARKDOWN_NOTES.writtenBy}:** ${VERSION}`);
  });

  it('is a document even with nothing in it', () => {
    const document = markdownExport(backupOf([]));
    expect(document).toContain(`# ${MARKDOWN_NOTES.title}`);
    expect(document).toContain(MARKDOWN_NOTES.empty);
  });
});

describe('markdownExport ordering', () => {
  it('puts the newest day first', () => {
    const document = markdownExport(
      backupOf([
        squatDay({ day: EARLIER_DAY, weight: LIGHTER }),
        squatDay({ day: LATER_DAY, weight: HEAVIER }),
      ]),
    );
    expect(document.indexOf(`## ${LATER_DAY}`)).toBeLessThan(document.indexOf(`## ${EARLIER_DAY}`));
  });

  it('hoists the unfinished session above the history and labels it', () => {
    // Dated a week before the finished one, which is the only arrangement that can
    // tell a hoist from a sort. In life it is almost always today's session and
    // therefore already first, which is exactly why an ordering bug here would ship.
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })], {
        active: squatDay({ day: EARLIER_DAY, weight: LIGHTER, state: 'draft' }),
      }),
    );
    expect(document.indexOf(`## ${EARLIER_DAY}`)).toBeLessThan(document.indexOf(`## ${LATER_DAY}`));
    expect(document).toContain(`## ${EARLIER_DAY} -- Squat day (${WORKOUT_STATUSES.draft})`);
  });

  it('prints a discarded session rather than dropping it, and says what it is', () => {
    const discarded = discardWorkout(
      squatDay({ day: EARLIER_DAY, weight: LIGHTER, state: 'draft' }),
      { at: EXPORTED_AT, nextId: () => 'unused' },
    );
    const document = markdownExport(backupOf([discarded]));
    expect(document).toContain(`(${WORKOUT_STATUSES.discarded})`);
    // The sets are still there. A record of a session a lifter threw away is still a
    // record of what they wrote down before they threw it away.
    expect(setRows(document)).toHaveLength(3);
  });

  it('leaves a finished session unlabelled, because finished is what a logbook is', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    expect(document).toContain(`## ${LATER_DAY} -- Squat day`);
    expect(document).not.toContain(WORKOUT_STATUSES.completed);
  });

  it('heads an untitled session with its day alone', () => {
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER, title: null })]),
    );
    expect(document).toContain(`## ${LATER_DAY}\n`);
  });

  it('keeps a heading on one line whatever was typed into the title', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const titled = setWorkoutTitle(day, 'Squat\nday', { at: EXPORTED_AT, nextId: () => 'unused' });
    const document = markdownExport(backupOf([titled]));
    expect(document).toContain(`## ${LATER_DAY} -- Squat day`);
    // A newline in the title would end the heading and leave the rest as body text --
    // which renders, and renders wrong, in every Markdown viewer there is.
    expect(document).not.toContain('## 2026-03-10 -- Squat\n');
  });
});

describe('markdownExport sets', () => {
  it('prints the five columns section 10.5 asks for, numbers right-aligned', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    expect(document).toContain(
      `| ${MARKDOWN_NOTES.columns.kind} | ${MARKDOWN_NOTES.columns.planned} | ${MARKDOWN_NOTES.columns.performed} | ${MARKDOWN_NOTES.columns.effort} | ${MARKDOWN_NOTES.columns.status} |`,
    );
    expect(document).toContain('| --- | ---: | ---: | ---: | --- |');
  });

  it('prints a weight in the unit it was recorded in, whatever the device shows', () => {
    // Section 11.4. The logbook is set to pounds and the session was typed in
    // kilograms; a document that converted would print 220.5 lb for a lift nobody
    // did, and it would look entirely reasonable.
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })], { displayUnit: 'lb' }),
    );
    expect(document).toContain('100 kg x 5');
    expect(document).not.toContain('220');
  });

  it('prints the effort in the scale it was recorded on', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const recorded = recordSet(
      day,
      firstSetId(day),
      performance(loadFor(SQUAT.loading, HEAVIER), 5, { scale: 'rpe', value: 8 }),
      { at: EXPORTED_AT, nextId: () => 'unused' },
    );
    expect(markdownExport(backupOf([recorded]))).toContain(`| ${EFFORT_LABELS.rpe} 8 |`);
  });

  it('dashes a column with nothing under it rather than inventing a sentence', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    // "Not set" is a screen telling a lifter they have not typed something yet. A
    // finished record has no such thing to say, and `formatPerformance`'s answer for
    // `null` would put those two words into a document about a session that is over.
    expect(document).not.toContain('Not set');
    expect(document).toContain(`| ${MARKDOWN_NOTES.blank} |`);
  });

  it('names what a set was for and what became of it', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    expect(document).toContain(
      `| ${SET_KINDS.working} | 100 kg x 5 | 100 kg x 5 | ${MARKDOWN_NOTES.blank} | ${SET_STATUSES.complete} |`,
    );
  });

  it('shows a planned session with nothing performed yet', () => {
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER, state: 'draft' })]),
    );
    expect(document).toContain(
      `| ${SET_KINDS.working} | 100 kg x 5 | ${MARKDOWN_NOTES.blank} | ${MARKDOWN_NOTES.blank} | ${SET_STATUSES.planned} |`,
    );
  });
});

describe('markdownExport notes', () => {
  const at: SessionContext = { at: EXPORTED_AT, nextId: () => 'unused' };

  it('puts a one-line workout note inline, the way section 10.5 writes it', () => {
    const day = setWorkoutNote(squatDay({ day: LATER_DAY, weight: HEAVIER }), 'Poor sleep.', at);
    expect(markdownExport(backupOf([day]))).toContain(`**${MARKDOWN_NOTES.note}:** Poor sleep.`);
  });

  it('keeps the line breaks in a longer note instead of flattening it', () => {
    const day = setWorkoutNote(
      squatDay({ day: LATER_DAY, weight: HEAVIER }),
      'Poor sleep.\n\nKept the last one conservative.',
      at,
    );
    const document = markdownExport(backupOf([day]));
    // A blockquote, with the blank line kept as a bare marker so the two paragraphs
    // stay two paragraphs. Joining them with a space would be readable and would
    // silently rewrite what the lifter wrote.
    expect(document).toContain('> Poor sleep.\n>\n> Kept the last one conservative.');
  });

  it('carries the exercise note as well as the workout one', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const [exercise] = day.exercises;
    if (exercise === undefined) throw new Error('the fixture lost its exercise');
    const noted = setExerciseNote(day, exercise.id, 'Belt from the second set.', at);
    expect(markdownExport(backupOf([noted]))).toContain('Belt from the second set.');
  });

  it('numbers a set note by its position in the exercise', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const second = sets(day)[1];
    if (second === undefined) throw new Error('the fixture lost its second set');
    const noted = setSetNote(day, second.id, 'Felt fast.', at);
    // Position and not identifier: the id is in the file the restore reads, and a
    // person reading this one is counting down the table with a finger.
    expect(markdownExport(backupOf([noted]))).toContain(
      `**${MARKDOWN_NOTES.setLabel(2)}:** Felt fast.`,
    );
  });

  it('keeps a note out of the table', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const second = sets(day)[1];
    if (second === undefined) throw new Error('the fixture lost its second set');
    const noted = setSetNote(day, second.id, 'Felt fast.', at);
    const document = markdownExport(backupOf([noted]));
    // A sentence in a cell either wraps the column to uselessness or gets cut, and a
    // pipe typed into a note would end the cell early and shift every column after it.
    expect(setRows(document).some((line) => line.includes('Felt fast.'))).toBe(false);
  });

  it('escapes nothing into a cell, because a note never reaches one', () => {
    const day = squatDay({ day: LATER_DAY, weight: HEAVIER });
    const noted = setSetNote(day, firstSetId(day), 'a | b', at);
    const document = markdownExport(backupOf([noted]));
    for (const line of setRows(document)) {
      // Five cells, still, whatever a lifter typed.
      expect(line.split('|')).toHaveLength(7);
    }
  });
});

describe('markdownExport duration', () => {
  it('states how long a finished session took', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    expect(document).toContain(`**${MARKDOWN_NOTES.duration}:** 20 min`);
  });

  it('says nothing about a session that has not run', () => {
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER, state: 'draft' })]),
    );
    expect(document).not.toContain(`**${MARKDOWN_NOTES.duration}:**`);
  });
});

describe('markdownExport markers', () => {
  it('marks the heaviest set once across the whole document', () => {
    const document = markdownExport(
      backupOf([
        squatDay({ day: EARLIER_DAY, weight: LIGHTER }),
        squatDay({ day: LATER_DAY, weight: HEAVIER }),
      ]),
    );
    const marked = setRows(document).filter((line) =>
      line.includes(RECORDS_NOTES.markers.heaviest),
    );
    expect(marked).toHaveLength(1);
    // On the heavier day, and on its first set: a tie goes to the older set, and all
    // three of that day's sets are jointly the heaviest.
    expect(marked[0]).toContain('100 kg x 5');
  });

  it('leaves the ordinary sets unmarked', () => {
    const document = markdownExport(
      backupOf([
        squatDay({ day: EARLIER_DAY, weight: LIGHTER }),
        squatDay({ day: LATER_DAY, weight: HEAVIER }),
      ]),
    );
    const rows = setRows(document);
    expect(rows).toHaveLength(6);
    // Four of six. Section 10.5's *only when meaningful* is a claim about how much of
    // the table the marks are allowed to take up, and it is the claim a marker that
    // landed on every row would break without failing anything else here.
    expect(rows.filter((line) => line.endsWith(`${SET_STATUSES.complete} |`))).toHaveLength(4);
  });

  it('puts the mark on the status rather than in a column of its own', () => {
    const document = markdownExport(backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })]));
    for (const line of setRows(document)) {
      expect(line.split('|')).toHaveLength(7);
    }
    expect(document).toContain(`${SET_STATUSES.complete} (${RECORDS_NOTES.markers.heaviest}`);
  });

  it('claims no record for a set inside a session still being lifted', () => {
    // Section 9.2's first exclusion, read from the document rather than the screen. The
    // in-progress lift is the heaviest squat on the device by 20 kilograms, and it is
    // still not a record: the lifter has not pressed Done, and a record awarded to a
    // session that could still be abandoned is one the file would have to take back.
    //
    // It is also what makes the printed order safe to ignore when the marks are folded
    // -- the hoisted session is the one session `consider` throws away.
    const document = markdownExport(
      backupOf([squatDay({ day: LATER_DAY, weight: HEAVIER })], {
        active: squatDay({
          day: EARLIER_DAY,
          weight: { amount: 120, unit: 'kg' },
          state: 'active',
        }),
      }),
    );

    const marked = setRows(document).filter((line) =>
      line.includes(RECORDS_NOTES.markers.heaviest),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('100 kg x 5');
    expect(document).toContain('120 kg x 5');
  });

  it('marks a set older than the history screen would ever list', () => {
    // Twenty-five sessions, the heaviest on the oldest day. `searchExerciseHistory`
    // keeps twenty by default -- a screen's budget -- and a marker stitched onto a
    // session that fell off that list is a marker this document would never see. The
    // file is the whole history, so it asks for the whole history.
    const days = Array.from(
      { length: 25 },
      (_unused, index): CalendarDay => `2026-02-${String(index + 1).padStart(2, '0')}`,
    );
    const [oldest] = days;
    if (oldest === undefined) throw new Error('the fixture lost its oldest day');

    const workouts = days.map((day) =>
      squatDay({ day, weight: day === oldest ? HEAVIER : LIGHTER, sets: 1 }),
    );
    const document = markdownExport(backupOf(workouts));

    const marked = setRows(document).filter((line) =>
      line.includes(RECORDS_NOTES.markers.heaviest),
    );
    expect(marked).toHaveLength(1);
    expect(document.indexOf(RECORDS_NOTES.markers.heaviest)).toBeGreaterThan(
      document.indexOf(`## ${oldest}`),
    );
  });

  it('does not turn one lift in two blocks into a group of two', () => {
    // Squats at the front and lighter back-offs at the end are two blocks of one lift in
    // one session, and the walk already reads both of them together. Offering the session
    // to that lift once per block folds every set twice, and section 9.2's group of two
    // is then met by one set counted again -- a maximum over a set with nothing to be
    // better than, which is the exact failure that rule exists to prevent.
    const document = markdownExport(
      backupOf([
        trainingDay(LATER_DAY, [
          { exercise: SQUAT, weight: HEAVIER, sets: 1 },
          { exercise: SQUAT, weight: LIGHTER, sets: 1 },
        ]),
      ]),
    );

    const marked = markedRows(document);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(RECORDS_NOTES.markers.heaviest);
    expect(marked[0]).toContain('100 kg x 5');
  });

  it('asks a session what is in it as often for twelve lifts as for one', () => {
    // The marks are folded by one walk per lift the file mentions, and the shape invites
    // offering every session to every one of them: sixty movements over three years is
    // tens of thousands of calls, each reaching a walk that discards the session on its
    // first line. Counted rather than timed, for the reason sub-task 31 counts records --
    // twelve invented sessions time this laptop and nothing else.
    const days = Array.from(
      { length: 12 },
      (_unused, index): CalendarDay => `2026-04-${String(index + 1).padStart(2, '0')}`,
    );
    const lifts = CATALOG_EXERCISES.slice(0, days.length);
    expect(lifts).toHaveLength(days.length);

    const reads = (blocks: readonly Block[][]): number => {
      const tally = { reads: 0 };
      const sessions = blocks.map((day, index) =>
        counted(trainingDay(days[index] ?? LATER_DAY, day), tally),
      );
      markdownExport(backupOf(sessions));
      return tally.reads;
    };

    const one = reads(days.map(() => [{ exercise: SQUAT, weight: HEAVIER, sets: 1 }]));
    const many = reads(lifts.map((lift) => [{ exercise: lift, weight: HEAVIER, sets: 1 }]));

    expect(many).toBe(one);
  });
});

describe('markdownExport vocabulary', () => {
  it('does not grade the session in the file either', () => {
    // Sections 15.3 and 16.1, asserted against a written document for the same reason
    // the browser test asserts against rendered screens: the rule is about what leaves
    // this tool, and this is the second thing that does. The list is shared, so a word
    // added to it tightens both at once.
    const at: SessionContext = { at: EXPORTED_AT, nextId: () => 'unused' };
    const day = setWorkoutNote(squatDay({ day: LATER_DAY, weight: HEAVIER }), 'Slept badly.', at);
    const document = markdownExport(
      backupOf([day, squatDay({ day: EARLIER_DAY, weight: LIGHTER })], { equipment: true }),
    );

    const text = withoutExerciseNames(document.toLowerCase());
    for (const word of FORBIDDEN) {
      expect(text).not.toContain(word);
    }
  });
});
