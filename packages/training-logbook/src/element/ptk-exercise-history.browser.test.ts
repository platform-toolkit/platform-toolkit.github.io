// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One lift, read back across its whole history, in a real browser.
 *
 * Mounted on its own, like the workout detail screen next door: it is handed an
 * `ExerciseHistory` and draws it, and the only control is the Back button the root draws
 * underneath, which is not part of this element.
 *
 * WHAT THIS FILE IS GUARDING
 *
 * Two things a read-only screen gets wrong silently. The first is the numbers: every
 * wrong version still renders a page of plausible weights, so the history below is built
 * through the core with a different number on every row -- a template that drew one
 * session twice, or hung a mark on the wrong set, cannot pass a case that names them.
 *
 * The second is the marks. They are the one place in the tool where a measurement can
 * turn into a score without anybody deciding to make it one, so there is a case for what
 * they say, a case for their being words rather than only a colour, and the vocabulary
 * walk section 15.3 asks for.
 *
 * Every weight, rep count, note and day below is invented (section 5.1).
 */

// Without the stylesheet every declaration reading a custom property is dropped, and the
// accessibility pass measures a screen that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  searchExerciseHistory,
  setExerciseNote,
  startWorkout,
  type SessionContext,
} from '../core/index.js';
import type { ExerciseHistory } from '../core/records.js';
import type { CalendarDay, SetLoad, WorkoutSession } from '../types.js';

import { RECORDS_NOTES, SET_KINDS, SET_STATUSES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import type { PtkExerciseHistory } from './ptk-exercise-history.js';

const SQUAT = 'squat';

/** Invented instants twenty minutes apart. */
const AT_START = '2026-05-18T16:00:00.000Z';
const AT_LATER = '2026-05-18T16:20:00.000Z';

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineTrainingLogbook();
});

afterEach(() => {
  for (const undo of teardown.splice(0)) undo();
});

function kg(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

/** A counter per session, so no two fixtures share an identifier. */
function series(prefix: string): (at: string) => SessionContext {
  let next = 0;
  const nextId = (): string => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
  return (at) => ({ nextId, at });
}

interface DayOptions {
  readonly note?: string;
  readonly title?: string | null;
}

/**
 * One day of squats: a warm-up and two working sets at the same weight.
 *
 * Built through the core rather than typed out. A history assembled by hand is free to
 * hold a mark on a set the core would never have marked, and a screen tested against one
 * proves only that it can draw whatever it is given.
 */
function aSquatDay(
  prefix: string,
  localDate: CalendarDay,
  weight: number,
  reps: number,
  options: DayOptions = {},
): WorkoutSession {
  const at = series(prefix);
  let session = createWorkout(at(AT_START), {
    localDate,
    title: options.title === undefined ? 'Lower' : options.title,
  });
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
  if (options.note !== undefined) {
    session = setExerciseNote(session, squat.id, options.note, at(AT_LATER));
  }
  return finishWorkout(session, 'leave', at(AT_LATER));
}

/** Walks a run of sessions newest day first, which is the order the repository reads in. */
function walk(sessions: readonly WorkoutSession[], limit?: number): ExerciseHistory {
  const search = searchExerciseHistory(SQUAT, limit === undefined ? {} : { limit });
  for (const session of sessions) search.consider(session);
  return search.history();
}

/**
 * Three sessions, arranged so all three marks are on screen and most rows carry none.
 *
 * May is 145 for 3, which is the heaviest. April and March are both at 130, so that
 * weight is a group of four sets rather than a group of one and its largest rep count --
 * April's five -- is a fact about the history. April is also the most weight for five,
 * and March the most weight for four.
 *
 * Nine rows and three marks, which is the shape that matters: a template that hung a
 * session's mark on all of its sets, or marked every row of the heaviest day, fails here
 * rather than looking plausible. Two of the three rows carry two marks each, which is
 * the other thing worth guarding -- a row is not limited to one.
 */
function aTrainedLift(limit?: number): ExerciseHistory {
  return walk(
    [
      aSquatDay('may', '2026-05-18', 145, 3),
      aSquatDay('apr', '2026-04-20', 130, 5, { note: 'Belt on from the second set.' }),
      aSquatDay('mar', '2026-03-16', 130, 4),
    ],
    limit,
  );
}

async function mount(history: ExerciseHistory | null): Promise<PtkExerciseHistory> {
  const element = document.createElement('ptk-exercise-history');
  element.history = history;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** Everything the screen says, at any shadow depth. */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  visit(shadow(element));
  return parts.join(' ');
}

/** One set row: the numbers on it, and whatever it is the record of. */
interface Row {
  readonly says: string;
  readonly marks: readonly string[];
}

/**
 * Every row of one session, found by the day rather than by an identifier.
 *
 * The identifiers come out of a counter inside the fixture, so a case naming them would
 * be asserting how many times the core happened to call `nextId` on the way to building
 * a session -- which is not a fact about this screen.
 */
function rowsOn(element: PtkExerciseHistory, day: CalendarDay): Row[] {
  const session = [...shadow(element).querySelectorAll('.sessions > li')].find(
    (entry) => entry.querySelector('h3')?.textContent.trim() === day,
  );
  if (session === undefined) throw new Error(`No session on ${day} is on this screen.`);
  return [...session.querySelectorAll('li[data-set]')].map((row) => ({
    says: row.querySelector('.set-what')?.textContent.replace(/\s+/gu, ' ').trim() ?? '',
    marks: [...row.querySelectorAll('[data-marker]')].map(
      (mark) => mark.getAttribute('data-marker') ?? '',
    ),
  }));
}

/** How many rows on the whole screen carry a mark. */
function markedRows(element: PtkExerciseHistory): number {
  return [...shadow(element).querySelectorAll('li[data-set]')].filter(
    (row) => row.querySelector('[data-marker]') !== null,
  ).length;
}

/** The days on screen, in the order they are drawn. */
function days(element: PtkExerciseHistory): string[] {
  return [...shadow(element).querySelectorAll('.sessions > li h3')].map((day) =>
    day.textContent.trim(),
  );
}

describe('what a history says', () => {
  it('names the lift as it was last recorded', async () => {
    const element = await mount(aTrainedLift());

    expect(shadow(element).querySelector('h2')?.textContent.trim()).toBe('Back squat');
  });

  it('lists the sessions newest day first', async () => {
    // The order the core produced, drawn without being re-sorted. A screen that sorted
    // again would be a second opinion about which session is the newest.
    const element = await mount(aTrainedLift());

    expect(days(element)).toEqual(['2026-05-18', '2026-04-20', '2026-03-16']);
  });

  it('states the heaviest set above the list', async () => {
    // Stated at the top as well as marked on its row, because the row may be off the
    // end: the sessions are capped and the marks are not.
    const element = await mount(aTrainedLift());
    const best = shadow(element).querySelector('.best > li');

    expect(best?.textContent).toContain(RECORDS_NOTES.heaviestLabel);
    expect(best?.textContent).toContain('145');
    expect(best?.textContent).toContain('2026-05-18');
  });

  it('draws every set of every session, warm-ups included', async () => {
    // The exclusions in section 9.2 are about the marks and not about the list. A
    // history that hid the sets that earned nothing would be editing the record.
    const element = await mount(aTrainedLift());

    expect(shadow(element).querySelectorAll('li[data-set]')).toHaveLength(9);
    expect(readAll(element)).toContain(SET_KINDS.warmup);
    expect(readAll(element)).toContain(SET_STATUSES.complete);
  });

  it('shows the note the lifter wrote on that day', async () => {
    const element = await mount(aTrainedLift());

    expect(readAll(element)).toContain('Belt on from the second set.');
  });

  it('says older sessions are not listed, and that the marks still cover them', async () => {
    // Without the sentence the heaviest line at the top looks like it disagrees with
    // the rows underneath it.
    const element = await mount(aTrainedLift(2));

    expect(days(element)).toEqual(['2026-05-18', '2026-04-20']);
    expect(readAll(element)).toContain(RECORDS_NOTES.truncated);
  });

  it('does not say that when the whole history is on screen', async () => {
    const element = await mount(aTrainedLift());

    expect(readAll(element)).not.toContain(RECORDS_NOTES.truncated);
  });

  it('says a lift has never been done, rather than drawing an empty list', async () => {
    const element = await mount(walk([]));

    expect(readAll(element)).toContain(RECORDS_NOTES.empty);
  });

  it('says a history could not be read, and does not pretend it was empty', async () => {
    // `null` is the root's answer to a read that threw and to a database that would
    // not open. It must not read as "you have never done this".
    const element = await mount(null);

    expect(readAll(element)).toContain(RECORDS_NOTES.unreadable);
    expect(readAll(element)).not.toContain(RECORDS_NOTES.empty);
  });

  it('clears the last lift off the screen when the history goes away', async () => {
    // The root reuses one element across opens. A failed second read that left the
    // first history on screen would show one lift's numbers under another's name.
    const element = await mount(aTrainedLift());
    expect(readAll(element)).toContain('Back squat');

    element.history = null;
    await element.updateComplete;

    expect(readAll(element)).not.toContain('Back squat');
    expect(readAll(element)).toContain(RECORDS_NOTES.unreadable);
  });
});

describe('the marks', () => {
  it('puts a mark on the row that holds it and on no other', async () => {
    // Three rows out of nine. A template that hung a session's mark on all of its
    // sets, or drew one on the session heading, fails here rather than looking right.
    const element = await mount(aTrainedLift());

    expect(markedRows(element)).toBe(3);
  });

  it('marks the heaviest set, on the first of the two that reached it', async () => {
    // A tie goes to the set that got there first, which is what a record is. The
    // warm-up above it and the repeat below it are both unmarked.
    const element = await mount(aTrainedLift());
    const rows = rowsOn(element, '2026-05-18');

    expect(rows.map((row) => row.marks)).toEqual([[], ['heaviest', 'most-reps-at-load'], []]);
    expect(rows[1]?.says).toContain('145');
  });

  it('marks the most reps at a weight, and the most weight for those reps', async () => {
    // April is the top of two groups at once: five is the most anybody has done at
    // 130, and 130 is the most anybody has put up for five.
    const element = await mount(aTrainedLift());
    const rows = rowsOn(element, '2026-04-20');

    expect(rows.map((row) => row.marks)).toEqual([
      [],
      ['most-reps-at-load', 'most-load-for-reps'],
      [],
    ]);
  });

  it('marks a session that was neither the heaviest nor the most reps', async () => {
    // March is 130 for four, which is the most weight anybody has done for four -- a
    // fact about a rep count that the heaviest day says nothing about.
    const element = await mount(aTrainedLift());
    const rows = rowsOn(element, '2026-03-16');

    expect(rows.map((row) => row.marks)).toEqual([[], ['most-load-for-reps'], []]);
  });

  it('says what a mark means in words', async () => {
    // Words and not only a colour or an icon. A mark that reads as an emphasis to one
    // lifter and as nothing at all to another is not a mark.
    const element = await mount(aTrainedLift());
    const said = readAll(element);

    expect(said).toContain(RECORDS_NOTES.markers.heaviest);
    expect(said).toContain(RECORDS_NOTES.markers['most-reps-at-load']);
    expect(said).toContain(RECORDS_NOTES.markers['most-load-for-reps']);
  });

  it('does not count how many there are', async () => {
    // A tally is a score. Section 15.3: nothing in this tool keeps one.
    const element = await mount(aTrainedLift());

    expect(readAll(element)).not.toContain('3 records');
    expect(shadow(element).querySelector('[data-marker-count]')).toBeNull();
  });
});

describe('what it refuses to say', () => {
  it('has no opinion about the work it is showing', async () => {
    // Section 15.3, on the screen where the temptation is strongest: this page exists
    // to point at the best sets in a history, and every one of these words is a
    // sentence away from where it already is.
    const element = await mount(aTrainedLift());
    const said = readAll(element).toLowerCase();

    for (const forbidden of [
      'personal best',
      'record',
      'congratulations',
      'well done',
      'great',
      'good',
      'easy',
      'hard',
      'ahead',
      'behind',
      'on track',
      'missed',
      'failed',
      'streak',
    ]) {
      expect(said).not.toContain(forbidden);
    }
  });

  it('offers nothing to press', async () => {
    // Section 0.4: no dead controls. The way back is the root's button, drawn outside
    // this element, and nothing on this screen writes.
    const element = await mount(aTrainedLift());

    expect(shadow(element).querySelectorAll('button, ptk-button, a')).toHaveLength(0);
  });
});

describe('accessibility', () => {
  it('has no violations with a whole history on screen', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends on
    // the page background this element does not control.
    const element = await mount(aTrainedLift());

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('has no violations on the unreadable screen', async () => {
    const element = await mount(null);

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
