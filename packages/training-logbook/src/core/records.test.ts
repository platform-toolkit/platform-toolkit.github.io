// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One exercise read back across a history, and the three marks section 9.2 allows.
 *
 * WHY THE FIXTURES ARE BUILT BY HAND HERE
 *
 * `previous.test.ts` composes its sessions through the core, and that is the right
 * default -- a hand-written session is free to hold a shape the core would never
 * produce. Almost every case below needs a set whose status, kind, performed numbers
 * and load shape are set independently of one another, which through the core is four
 * calls and a lookup per set, and the case stops being readable long before it stops
 * being correct. So the sets are literals, and the last describe block runs a session
 * built entirely through the core to prove the literals are shapes the core produces.
 *
 * Every weight, rep count and day below is invented (section 5.1). The numbers are
 * spaced far apart on purpose: a marker landing on the wrong set has to show up as a
 * different number rather than a near miss.
 */

import { describe, expect, it } from 'vitest';

import type {
  Instant,
  LogbookId,
  SetKind,
  SetLoad,
  SetStatus,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { AT_LATER, AT_START, contextSeries } from './context.fixture.js';
import { searchExerciseHistory, type ExerciseHistory, type ExerciseMarker } from './records.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  recordSet,
  setExerciseNote,
  skipSet,
  startWorkout,
} from './session.js';

/** The exercise every case below asks about. */
const SQUAT = 'squat';

/** Three invented days, newest first, far enough apart to read at a glance. */
const TODAY = '2026-03-10';
const LAST_WEEK = '2026-03-03';
const LAST_MONTH = '2026-02-10';

function kg(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'kg' } };
}

function lb(amount: number): SetLoad {
  return { kind: 'implement', weight: { amount, unit: 'lb' } };
}

/** Weight hung off a body, and weight taken off one. Section 6.2's opposite pair. */
function added(amount: number): SetLoad {
  return { kind: 'added', weight: { amount, unit: 'kg' } };
}

function assisted(amount: number): SetLoad {
  return { kind: 'assisted', weight: { amount, unit: 'kg' } };
}

interface SetOptions {
  readonly kind?: SetKind;
  readonly status?: SetStatus;
  readonly note?: string | null;
}

/** A set that was done: a load, a rep count, and nothing surprising about it. */
function did(
  id: LogbookId,
  load: SetLoad,
  reps: number | null,
  options: SetOptions = {},
): WorkoutSet {
  return {
    id,
    kind: options.kind ?? 'working',
    planned: { load, repetitions: reps, effort: null },
    performed: { load, repetitions: reps, effort: null },
    status: options.status ?? 'complete',
    completedAt: null,
    note: options.note ?? null,
  };
}

/** A set nobody got to. No `performed` at all, which is what `skipSet` writes. */
function skipped(id: LogbookId, load: SetLoad, reps: number): WorkoutSet {
  return {
    id,
    kind: 'working',
    planned: { load, repetitions: reps, effort: null },
    performed: null,
    status: 'skipped',
    completedAt: null,
    note: null,
  };
}

function block(
  sets: readonly WorkoutSet[],
  options: {
    readonly exerciseId?: string;
    readonly displayName?: string;
    readonly note?: string | null;
  } = {},
): WorkoutExercise {
  const exerciseId = options.exerciseId ?? SQUAT;
  return {
    id: `lift-${exerciseId}-${String(sets.length)}`,
    exerciseId,
    displayName: options.displayName ?? 'Squat',
    loading: 'barbell-total-weight',
    warmup: null,
    note: options.note ?? null,
    sets,
  };
}

interface SessionOptions {
  readonly status?: WorkoutSession['status'];
  readonly title?: string | null;
  readonly updatedAt?: Instant;
}

function session(
  id: LogbookId,
  localDate: string,
  blocks: readonly WorkoutExercise[],
  options: SessionOptions = {},
): WorkoutSession {
  return {
    id,
    schemaVersion: 1,
    status: options.status ?? 'completed',
    localDate,
    startedAt: AT_START,
    completedAt: AT_LATER,
    title: options.title ?? null,
    note: null,
    exercises: blocks,
    createdAt: AT_START,
    updatedAt: options.updatedAt ?? AT_LATER,
    source: 'manual',
  };
}

/** Feeds a history in the order given -- newest first, as storage delivers it. */
function walk(
  sessions: readonly WorkoutSession[],
  options: { readonly limit?: number; readonly exerciseId?: string } = {},
): ExerciseHistory {
  const search = searchExerciseHistory(
    options.exerciseId ?? SQUAT,
    // Spread rather than `{ limit: options.limit }`: an explicit `undefined` is not
    // an absent key under `exactOptionalPropertyTypes`, and half these cases omit it.
    options.limit === undefined ? {} : { limit: options.limit },
  );
  for (const one of sessions) search.consider(one);
  return search.history();
}

/** Every marker on one set, by identifier, so a case never counts rows. */
function markersOn(history: ExerciseHistory, setId: LogbookId): readonly ExerciseMarker[] {
  for (const one of history.sessions) {
    for (const set of one.sets) if (set.id === setId) return set.markers;
  }
  throw new Error(`No set "${setId}" is in this history.`);
}

/** Which sets carry a given marker, across the whole listed history. */
function marked(history: ExerciseHistory, marker: ExerciseMarker): readonly LogbookId[] {
  return history.sessions.flatMap((one) =>
    one.sets.filter((set) => set.markers.includes(marker)).map((set) => set.id),
  );
}

describe('the sessions it lists', () => {
  it('lists only the sessions the exercise appears in, newest first', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5)])]),
      session('w-2', LAST_WEEK, [block([did('b', kg(90), 5)], { exerciseId: 'bench-press' })]),
      session('w-3', LAST_MONTH, [block([did('c', kg(80), 5)])]),
    ]);

    expect(history.sessions.map((one) => one.workoutId)).toEqual(['w-1', 'w-3']);
    expect(history.sessions.map((one) => one.localDate)).toEqual([TODAY, LAST_MONTH]);
  });

  it('leaves out a session where the lift was planned and nothing was done', () => {
    // Reachable and ordinary: a session finished early. A row with no numbers on it
    // is a row that says nothing, and it would push a real one off the limit.
    const history = walk([
      session('w-1', TODAY, [block([skipped('a', kg(100), 5)])]),
      session('w-2', LAST_WEEK, [block([did('b', kg(90), 5)])]),
    ]);

    expect(history.sessions.map((one) => one.workoutId)).toEqual(['w-2']);
  });

  it('lists a set that was attempted and not finished, with what was made', () => {
    // The mark is withheld from it, which is the next describe's business. The row
    // itself is a thing that happened and hiding it would be editing the record.
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 3, { status: 'incomplete' })])]),
    ]);

    expect(history.sessions[0]?.sets.map((set) => set.id)).toEqual(['a']);
    expect(history.sessions[0]?.sets[0]?.performed.repetitions).toBe(3);
  });

  it('ignores a session that was never finished', () => {
    // Three statuses, one case. A draft holds a plan, an active session is the one on
    // the screen, and a discarded one was thrown away -- the same three `previous.ts`
    // refuses, and offering this morning's second set as history beside the third is
    // the tool answering a question nobody asked.
    for (const status of ['draft', 'active', 'discarded'] as const) {
      const history = walk([session('w-1', TODAY, [block([did('a', kg(100), 5)])], { status })]);
      expect(history.sessions).toEqual([]);
      expect(history.heaviest).toEqual([]);
    }
  });

  it('reads both blocks where the lift was done twice in one session', () => {
    // Squats at the front and back-offs at the end is one exercise's work in two
    // blocks, and taking only one of them drops half the session.
    const history = walk([
      session('w-1', TODAY, [
        block([did('a', kg(140), 3)]),
        block([did('b', kg(100), 8)], { note: 'Back-offs.' }),
      ]),
    ]);

    expect(history.sessions[0]?.sets.map((set) => set.id)).toEqual(['a', 'b']);
  });

  it('keeps both notes where the lift was written about twice', () => {
    const history = walk([
      session('w-1', TODAY, [
        block([did('a', kg(140), 3)], { note: 'Belt on.' }),
        block([did('b', kg(100), 8)], { note: 'Back-offs.' }),
      ]),
    ]);

    expect(history.sessions[0]?.note).toBe('Belt on.\nBack-offs.');
  });

  it('leaves the note null where nothing was written', () => {
    const history = walk([session('w-1', TODAY, [block([did('a', kg(100), 5)])])]);

    expect(history.sessions[0]?.note).toBeNull();
  });

  it('reports the name each session recorded, and the newest one for the history', () => {
    // A renamed custom exercise reads differently in old sessions on purpose --
    // that is what snapshotting `displayName` is for -- so the history must not
    // retitle last year's work with this year's name.
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5)], { displayName: 'Back squat' })]),
      session('w-2', LAST_WEEK, [block([did('b', kg(90), 5)], { displayName: 'Squat' })]),
    ]);

    expect(history.displayName).toBe('Back squat');
    expect(history.sessions.map((one) => one.displayName)).toEqual(['Back squat', 'Squat']);
  });

  it('carries the workout title and the day, for a row that names the session', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5)])], { title: 'Heavy day' }),
    ]);

    expect(history.sessions[0]?.title).toBe('Heavy day');
    expect(history.sessions[0]?.localDate).toBe(TODAY);
  });

  it('stops listing at the limit and says so', () => {
    const history = walk(
      [
        session('w-1', TODAY, [block([did('a', kg(100), 5)])]),
        session('w-2', LAST_WEEK, [block([did('b', kg(90), 5)])]),
        session('w-3', LAST_MONTH, [block([did('c', kg(80), 5)])]),
      ],
      { limit: 2 },
    );

    expect(history.sessions.map((one) => one.workoutId)).toEqual(['w-1', 'w-2']);
    expect(history.truncated).toBe(true);
  });

  it('says nothing was left out where the whole history fits', () => {
    // Paired with the case above, because a flag that was always true would pass it
    // and put "older sessions are not shown" under a history of one session.
    const history = walk([session('w-1', TODAY, [block([did('a', kg(100), 5)])])], { limit: 2 });

    expect(history.truncated).toBe(false);
  });

  it('answers about a lift that has never been done', () => {
    const history = walk([session('w-1', TODAY, [block([did('a', kg(100), 5)])])], {
      exerciseId: 'deadlift',
    });

    expect(history.sessions).toEqual([]);
    expect(history.displayName).toBeNull();
    expect(history.heaviest).toEqual([]);
    expect(history.truncated).toBe(false);
  });
});

describe('what a set gets marked as', () => {
  it('marks the heaviest completed set', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5), did('b', kg(140), 1)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['b']);
  });

  it('marks the most repetitions done at one weight', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5)])]),
      session('w-2', LAST_WEEK, [block([did('b', kg(100), 8)])]),
    ]);

    expect(markersOn(history, 'b')).toContain('most-reps-at-load');
    expect(markersOn(history, 'a')).not.toContain('most-reps-at-load');
  });

  it('marks the most weight lifted for a given number of repetitions', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(110), 5), did('b', kg(150), 1)])]),
      session('w-2', LAST_WEEK, [block([did('c', kg(100), 5)])]),
    ]);

    expect(markersOn(history, 'a')).toContain('most-load-for-reps');
    expect(markersOn(history, 'c')).not.toContain('most-load-for-reps');
  });

  it('does not say the heaviest set twice', () => {
    // The heaviest set is trivially also the most weight at its own rep count, and a
    // row reading "Heaviest" beside "Most weight for 1" is one fact wearing two hats.
    // Two singles, so the rep-count group is a real group and the second marker is
    // genuinely earned before it is withheld.
    const history = walk([
      session('w-1', TODAY, [block([did('top', kg(150), 1), did('lighter', kg(120), 1)])]),
    ]);

    expect(markersOn(history, 'top')).toEqual(['heaviest']);
    expect(marked(history, 'most-load-for-reps')).toEqual([]);
  });

  it('says nothing about a weight that has only been lifted once', () => {
    // A maximum over one set is the set. A lifter who works up differently every week
    // would otherwise find every row marked, which is the failure the tie rule below
    // exists to prevent arriving by another door.
    const history = walk([
      session('w-1', TODAY, [block([did('once', kg(100), 5), did('other', kg(90), 5)])]),
    ]);

    expect(marked(history, 'most-reps-at-load')).toEqual([]);
  });

  it('says nothing about a repetition count that has only been done once', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('triple', kg(140), 3), did('five', kg(100), 5)])]),
    ]);

    expect(marked(history, 'most-load-for-reps')).toEqual([]);
  });

  it('still names the heaviest set in a history of one set', () => {
    // The exemption, and the reason it is one: "heaviest" is a single mark over the
    // whole history rather than one per group, so it cannot multiply, and the most a
    // lifter has ever picked up is worth saying on the day they first pick it up.
    const history = walk([session('w-1', TODAY, [block([did('only', kg(100), 5)])])]);

    expect(markersOn(history, 'only')).toEqual(['heaviest']);
  });

  it('gives a tie to the set that got there first', () => {
    // Straight sets are the ordinary case, so without this every row in a history of
    // 100 x 5 carries every mark and the marks stop meaning anything. The useful
    // consequence is the other way round: a mark on today's row means today.
    const history = walk([
      session('w-1', TODAY, [block([did('new', kg(100), 5)])]),
      session('w-2', LAST_MONTH, [block([did('old', kg(100), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['old']);
  });

  it('gives a tie inside one session to the earlier set', () => {
    // The same rule one level down, and it is why the fold walks each session's sets
    // backwards: without the reversal the last of three identical sets would be
    // reported as the one that set the record.
    const history = walk([
      session('w-1', TODAY, [block([did('a', kg(100), 5), did('b', kg(100), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['a']);
  });

  it('never compares one load shape against another', () => {
    // Section 6.2: 20 kg hung off a body and 20 kg taken off one are opposite facts,
    // and a maximum spanning them would say a lifter pulled weight a machine lifted.
    const history = walk([
      session('w-1', TODAY, [block([did('plus', added(20), 8), did('minus', assisted(20), 8)])]),
    ]);

    expect(marked(history, 'heaviest').toSorted()).toEqual(['minus', 'plus']);
    expect(history.heaviest).toHaveLength(2);
  });

  it('does not group a weight added on with the same weight taken off', () => {
    // The same rule one marker across: 20 kg hung off a body and 20 kg taken off one
    // are the same number and opposite facts, so "most reps at 20 kg" is two questions
    // and has two answers. Two sets in each group, so both groups are real groups.
    const history = walk([
      session('w-1', TODAY, [
        block([
          did('plus-most', added(20), 5),
          did('plus-fewer', added(20), 2),
          did('minus-most', assisted(20), 8),
          did('minus-fewer', assisted(20), 3),
        ]),
      ]),
    ]);

    expect(marked(history, 'most-reps-at-load').toSorted()).toEqual(['minus-most', 'plus-most']);
  });

  it('answers "the most weight for three" once per load shape', () => {
    // The last of the three markers held to the same line. Every set below is a triple
    // or a single, so each shape has one real group at three; the singles are the
    // heaviest of their shape and exist to keep the triples' marks off the
    // suppression path.
    const history = walk([
      session('w-1', TODAY, [
        block([
          did('plus-max', added(60), 1),
          did('plus-best-triple', added(50), 3),
          did('plus-triple', added(20), 3),
          did('minus-max', assisted(70), 1),
          did('minus-best-triple', assisted(45), 3),
          did('minus-triple', assisted(15), 3),
        ]),
      ]),
    ]);

    expect(marked(history, 'most-load-for-reps').toSorted()).toEqual([
      'minus-best-triple',
      'plus-best-triple',
    ]);
  });

  it('leaves a warm-up unmarked, however heavy it was', () => {
    const history = walk([
      session('w-1', TODAY, [
        block([did('ramp', kg(200), 1, { kind: 'warmup' }), did('work', kg(100), 5)]),
      ]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['work']);
  });

  it('leaves a set that was attempted and not finished unmarked', () => {
    const history = walk([
      session('w-1', TODAY, [
        block([did('missed', kg(200), 1, { status: 'incomplete' }), did('work', kg(100), 5)]),
      ]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['work']);
    expect(markersOn(history, 'missed')).toEqual([]);
  });

  it('leaves a set of no repetitions unmarked', () => {
    // Zero is a set that was loaded and not moved. It is a fact worth keeping and it
    // is not a maximum of anything.
    const history = walk([
      session('w-1', TODAY, [block([did('nothing', kg(200), 0), did('work', kg(100), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['work']);
  });

  it('leaves a set whose repetitions were never entered unmarked', () => {
    const history = walk([
      session('w-1', TODAY, [block([did('blank', kg(200), null), did('work', kg(100), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['work']);
  });

  it('ignores a weight that cannot be read as a number', () => {
    // A restored backup from another tool is the way this arrives, and the damage a
    // maximum takes from one is total: every comparison against it answers false, so
    // the real heaviest set is never claimed and the screen marks nothing.
    const broken: SetLoad = { kind: 'implement', weight: { amount: Number.NaN, unit: 'kg' } };
    const history = walk([
      session('w-1', TODAY, [block([did('bad', broken, 5), did('work', kg(100), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['work']);
    expect(markersOn(history, 'bad')).toEqual([]);
  });
});

describe('two units in one history', () => {
  it('orders the heaviest across units, and reports what was recorded', () => {
    // 225 lb is a little over 102 kg, so it wins -- ordering is a question with an
    // answer across units. What comes back is the entry as it was typed: section
    // 11.4, and a marker that reprinted it as 102.06 kg would be the conversion the
    // whole package refuses.
    const history = walk([
      session('w-1', TODAY, [block([did('metric', kg(100), 5), did('imperial', lb(225), 5)])]),
    ]);

    expect(marked(history, 'heaviest')).toEqual(['imperial']);
    expect(history.heaviest).toEqual([
      { localDate: TODAY, performance: { load: lb(225), repetitions: 5, effort: null } },
    ]);
  });

  it('does not treat two units as one weight', () => {
    // Equality across units is an artefact of where a conversion was rounded, so
    // "most repetitions at this weight" groups on exactly what was typed. Two sets at
    // each of the two weights, so both groups are real groups; a merged group would
    // mark only the 8 and leave the best kilogram set unmarked.
    const history = walk([
      session('w-1', TODAY, [
        block([
          did('metric-most', kg(100), 5),
          did('metric-fewer', kg(100), 2),
          did('imperial-most', lb(100), 8),
          did('imperial-fewer', lb(100), 3),
        ]),
      ]),
    ]);

    expect(marked(history, 'most-reps-at-load').toSorted()).toEqual([
      'imperial-most',
      'metric-most',
    ]);
  });
});

describe('the marks are over the whole history, not the part on screen', () => {
  it('finds the heaviest set in a session past the limit', () => {
    // The reason the walk cannot stop early. "The most you have ever lifted" read off
    // the last two sessions is a different claim wearing the same word.
    const history = walk(
      [
        session('w-1', TODAY, [block([did('a', kg(100), 5)])]),
        session('w-2', LAST_MONTH, [block([did('b', kg(180), 1)])]),
      ],
      { limit: 1 },
    );

    expect(history.sessions.map((one) => one.workoutId)).toEqual(['w-1']);
    expect(history.truncated).toBe(true);
    expect(history.heaviest[0]?.performance.load).toEqual(kg(180));
    expect(history.heaviest[0]?.localDate).toBe(LAST_MONTH);
  });

  it('withholds the mark from a listed set that a hidden session beats', () => {
    const history = walk(
      [
        session('w-1', TODAY, [block([did('a', kg(100), 5)])]),
        session('w-2', LAST_MONTH, [block([did('b', kg(180), 5)])]),
      ],
      { limit: 1 },
    );

    expect(markersOn(history, 'a')).toEqual([]);
  });

  it('reads the whole history even where nothing is listed at all', () => {
    const history = walk([session('w-1', TODAY, [block([did('a', kg(100), 5)])])], { limit: 0 });

    expect(history.sessions).toEqual([]);
    expect(history.truncated).toBe(true);
    expect(history.heaviest[0]?.performance.load).toEqual(kg(100));
  });
});

describe('two sessions on one day', () => {
  it('orders them by when they were last written, whatever order they arrive in', () => {
    // Storage indexes on the day and says nothing about the two sessions inside it,
    // so without this the answer changes between browsers and between a fresh
    // database and a restored one.
    const morning = session('w-morning', TODAY, [block([did('a', kg(100), 5)])], {
      updatedAt: '2026-03-10T09:00:00.000Z',
    });
    const evening = session('w-evening', TODAY, [block([did('b', kg(120), 5)])], {
      updatedAt: '2026-03-10T19:00:00.000Z',
    });

    for (const order of [
      [morning, evening],
      [evening, morning],
    ]) {
      const history = walk(order);
      expect(history.sessions.map((one) => one.workoutId)).toEqual(['w-evening', 'w-morning']);
    }
  });

  it('settles a tie between them on the same rule, and not on arrival order', () => {
    const morning = session('w-morning', TODAY, [block([did('a', kg(100), 5)])], {
      updatedAt: '2026-03-10T09:00:00.000Z',
    });
    const evening = session('w-evening', TODAY, [block([did('b', kg(100), 5)])], {
      updatedAt: '2026-03-10T19:00:00.000Z',
    });

    expect(marked(walk([morning, evening]), 'heaviest')).toEqual(['a']);
    expect(marked(walk([evening, morning]), 'heaviest')).toEqual(['a']);
  });
});

describe('against a session the core actually built', () => {
  it('reads a real workout the same way it reads the literals above', () => {
    // The literals in this file are the readable way to write twenty cases and the
    // risky way: nothing stops one of them holding a shape `session.ts` would never
    // produce. This case builds a session through the core -- plan, start, tick,
    // edit, skip, note, finish -- and asserts the same things about it.
    const at = contextSeries();
    let built = createWorkout(at(AT_START), { localDate: TODAY, title: 'Squat day' });
    built = addExercise(built, at(AT_START), {
      exerciseId: SQUAT,
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: [
        { kind: 'warmup', performance: performance(kg(60), 8) },
        { kind: 'working', performance: performance(kg(100), 5) },
        { kind: 'working', performance: performance(kg(100), 5) },
      ],
    });
    built = startWorkout(built, at(AT_START));

    const sets = built.exercises[0]?.sets ?? [];
    const [warmup, first, second] = sets;
    if (warmup === undefined || first === undefined || second === undefined) {
      throw new Error('the fixture lost a set');
    }
    built = completeSet(built, warmup.id, at(AT_LATER));
    built = recordSet(built, first.id, performance(kg(120), 3), at(AT_LATER));
    built = skipSet(built, second.id, at(AT_LATER));
    built = setExerciseNote(built, built.exercises[0]?.id ?? '', 'Belt on.', at(AT_LATER));
    built = finishWorkout(built, 'leave', at(AT_LATER));

    const history = walk([built]);

    expect(history.displayName).toBe('Squat');
    expect(history.sessions[0]?.title).toBe('Squat day');
    expect(history.sessions[0]?.note).toBe('Belt on.');
    // The warm-up and the edited set were performed and are listed; the skipped one
    // has no result and is not.
    expect(history.sessions[0]?.sets.map((set) => set.id)).toEqual([warmup.id, first.id]);
    // ...and only the working set is marked, though the ramp is on the screen.
    expect(marked(history, 'heaviest')).toEqual([first.id]);
    expect(history.heaviest).toEqual([
      { localDate: TODAY, performance: { load: kg(120), repetitions: 3, effort: null } },
    ]);
  });
});
