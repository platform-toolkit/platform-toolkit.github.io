// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The repository's own rules, proven against the in-memory store.
 *
 * Everything here is the same whichever backing is underneath: ordering, the
 * history query, what a backup contains, where the active pointer ends up. Running
 * it in Node rather than a browser is not a shortcut -- it is what lets a test be
 * about the rule. The behaviours that genuinely need a real database live in
 * `./indexed-db.browser.test.ts`, and there are far fewer of them than this.
 */

import { defaultInventory } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import { AT_LATER, AT_START, ON_DAY, contextSeries } from '../core/context.fixture.js';
import type { PreviousPerformance } from '../core/previous.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
  type PlannedSet,
} from '../core/session.js';
import { loadWeight } from '../core/summary.js';
import type {
  CalendarDay,
  CustomExercise,
  EquipmentProfile,
  SetLoad,
  WorkoutSession,
} from '../types.js';

import { memoryLogbookStore } from './memory.js';
import type { LogbookStore } from './port.js';
import { createRepository, defaultSettings, type TrainingLogbookRepository } from './repository.js';

/** A repository over a fresh memory store, with a clock that does not move. */
function repository(store: LogbookStore = memoryLogbookStore()): TrainingLogbookRepository {
  return createRepository(store, { now: () => AT_LATER, applicationVersion: '0.1.0' });
}

/** A finished session. Invented numbers throughout; see section 5.1. */
function finished(localDate = ON_DAY, at = contextSeries()): WorkoutSession {
  let workout = createWorkout(at(AT_START), { localDate, title: 'Squat day' });
  workout = addExercise(workout, at(AT_START), {
    exerciseId: 'squat',
    displayName: 'Squat',
    loading: 'barbell-total-weight',
    plan: [
      {
        kind: 'working',
        performance: performance({ kind: 'implement', weight: { amount: 100, unit: 'kg' } }, 5),
      },
    ],
  });
  workout = startWorkout(workout, at(AT_START));
  const setId = workout.exercises[0]?.sets[0]?.id ?? '';
  workout = completeSet(workout, setId, at(AT_LATER));
  return finishWorkout(workout, 'skip', at(AT_LATER));
}

function exercise(id: string, name: string): CustomExercise {
  return {
    id,
    name,
    loading: 'machine-or-cable-weight',
    warmupFamily: null,
    defaultUnit: null,
    createdAt: AT_START,
    updatedAt: AT_START,
  };
}

function profile(id: string, name: string): EquipmentProfile {
  return {
    id,
    name,
    equipment: {
      barWeight: { amount: 20, unit: 'kg' },
      collarWeight: { amount: 2.5, unit: 'kg' },
      plateUnit: 'kg',
      plates: defaultInventory('kg'),
    },
    createdAt: AT_START,
    updatedAt: AT_START,
  };
}

describe('defaultSettings', () => {
  it('matches the warm-up calculator’s unit so two tools never disagree', () => {
    expect(defaultSettings().displayUnit).toBe('lb');
  });

  it('leaves effort off, because RPE is opt-in', () => {
    expect(defaultSettings().effort).toBe('none');
  });
});

describe('settings', () => {
  it('answers the defaults before anything has been chosen', async () => {
    const logbook = repository();

    expect(await logbook.loadSettings()).toEqual(defaultSettings());
  });

  it('answers what was saved afterwards', async () => {
    const logbook = repository();
    const chosen = { ...defaultSettings(), displayUnit: 'kg' as const, effort: 'rpe' as const };
    await logbook.saveSettings(chosen);

    expect(await logbook.loadSettings()).toEqual(chosen);
  });
});

describe('the active workout', () => {
  it('is nothing before a session is started', async () => {
    const logbook = repository();

    expect(await logbook.loadActiveWorkout()).toBeNull();
  });

  it('comes back after a save', async () => {
    const logbook = repository();
    const workout = finished();
    await logbook.saveActiveWorkout(workout);

    expect(await logbook.loadActiveWorkout()).toEqual(workout);
  });

  it('is cleared by completing it, and the workout is still there', async () => {
    // Section 18.2's interruption case seen from storage: the failure this rules
    // out is a finished session that reopens as live with every set already
    // ticked.
    const logbook = repository();
    const workout = finished();
    await logbook.saveActiveWorkout(workout);
    await logbook.completeWorkout(workout);

    expect(await logbook.loadActiveWorkout()).toBeNull();
    expect(await logbook.getWorkout(workout.id)).toEqual(workout);
  });

  it('is not resumed by editing a workout in the history', async () => {
    const logbook = repository();
    const live = finished('2026-03-11');
    const old = finished('2026-02-14');
    await logbook.saveActiveWorkout(live);
    await logbook.saveWorkout(old);

    expect((await logbook.loadActiveWorkout())?.id).toBe(live.id);
  });

  it('is cleared by deleting the workout it named', async () => {
    // A dangling pointer would make `loadActiveWorkout` answer null for a session
    // that looks fine, and the next save would resurrect a deleted workout.
    const logbook = repository();
    const workout = finished();
    await logbook.saveActiveWorkout(workout);
    await logbook.deleteWorkout(workout.id);

    expect(await logbook.loadActiveWorkout()).toBeNull();
    expect(await logbook.getWorkout(workout.id)).toBeNull();
  });

  it('survives deleting a different workout', async () => {
    const logbook = repository();
    const at = contextSeries();
    const live = finished('2026-03-11', at);
    const old = finished('2026-02-14', at);
    await logbook.saveActiveWorkout(live);
    await logbook.saveWorkout(old);
    await logbook.deleteWorkout(old.id);

    expect((await logbook.loadActiveWorkout())?.id).toBe(live.id);
  });
});

describe('listWorkouts', () => {
  /**
   * Three finished workouts, out of date order.
   *
   * The identifier series is handed back rather than kept private, because a test
   * that adds a fourth workout from a fresh series gets `id-1` again and silently
   * overwrites the first one. That is a fixture bug the assertion reports as a
   * missing workout, which is a long way from where the mistake is.
   */
  async function withHistory(): Promise<{
    readonly logbook: TrainingLogbookRepository;
    readonly at: ReturnType<typeof contextSeries>;
  }> {
    const logbook = repository();
    const at = contextSeries();
    for (const day of ['2026-02-14', '2026-03-11', '2026-03-10']) {
      await logbook.saveWorkout(finished(day, at));
    }
    return { logbook, at };
  }

  it('is newest first', async () => {
    const { logbook } = await withHistory();

    expect((await logbook.listWorkouts()).map((row) => row.localDate)).toEqual([
      '2026-03-11',
      '2026-03-10',
      '2026-02-14',
    ]);
  });

  it('narrows to a date range, inclusive at both ends', async () => {
    const { logbook } = await withHistory();
    const rows = await logbook.listWorkouts({ from: '2026-03-10', to: '2026-03-11' });

    expect(rows.map((row) => row.localDate)).toEqual(['2026-03-11', '2026-03-10']);
  });

  it('narrows to a status', async () => {
    const { logbook, at } = await withHistory();
    await logbook.saveWorkout(createWorkout(at(AT_START), { localDate: '2026-03-12' }));

    expect(await logbook.listWorkouts({ status: 'draft' })).toHaveLength(1);
    expect(await logbook.listWorkouts({ status: 'completed' })).toHaveLength(3);
  });

  it('applies the limit after ordering, not before', async () => {
    // A limit applied to whatever the store iterated first gives "your last two
    // workouts" made of two arbitrary ones, which reads as correct and is not.
    const { logbook } = await withHistory();

    expect((await logbook.listWorkouts({ limit: 2 })).map((row) => row.localDate)).toEqual([
      '2026-03-11',
      '2026-03-10',
    ]);
  });

  it('treats a limit of zero as none rather than as no limit', async () => {
    const { logbook } = await withHistory();

    expect(await logbook.listWorkouts({ limit: 0 })).toEqual([]);
  });

  it('treats a negative limit as none rather than as counting from the end', async () => {
    // `slice(0, -1)` is not an error, it is "all but the most recent" -- so an
    // unclamped limit turns a caller's arithmetic mistake into a history that is
    // missing exactly the workout the lifter just finished.
    const { logbook } = await withHistory();

    expect(await logbook.listWorkouts({ limit: -1 })).toEqual([]);
  });

  it('includes the workout in progress', async () => {
    // The history screen shows it labelled as unfinished. Hiding it here would
    // mean a lifter who backgrounded the app sees no trace of the session.
    const logbook = repository();
    await logbook.saveActiveWorkout(finished());

    expect(await logbook.listWorkouts()).toHaveLength(1);
  });

  it('is empty for a logbook nothing has been written to', async () => {
    const logbook = repository();

    expect(await logbook.listWorkouts()).toEqual([]);
  });
});

describe('lastPerformance', () => {
  /**
   * A store that reports what the scan was actually asked to read.
   *
   * Both of this method's cost rules are invisible in its answer: a repository
   * that read three years of sessions returns the same map as one that read two,
   * and one that opened a transaction to ask about no exercises at all returns the
   * same empty map as one that never touched the store. Counting the visits is the
   * only way a test can tell those apart.
   */
  function watched(store: LogbookStore = memoryLogbookStore()): {
    readonly store: LogbookStore;
    readonly scans: () => number;
    readonly visited: () => readonly CalendarDay[];
  } {
    let scans = 0;
    const visited: CalendarDay[] = [];
    return {
      store: {
        ...store,
        scanWorkouts: (visit) => {
          scans += 1;
          return store.scanWorkouts((workout) => {
            visited.push(workout.localDate);
            return visit(workout);
          });
        },
      },
      scans: () => scans,
      visited: () => visited,
    };
  }

  /** Invented weights, spaced far apart so a wrong set is a wrong number. */
  function kilograms(amount: number): SetLoad {
    return { kind: 'implement', weight: { amount, unit: 'kg' } };
  }

  function working(amount: number): PlannedSet {
    return { kind: 'working', performance: performance(kilograms(amount), 5) };
  }

  /** One exercise inside a fixture session. */
  interface Block {
    readonly exerciseId: string;
    /** Snapshotted per session, so two sessions may record one lift under two. */
    readonly displayName?: string;
    readonly sets: readonly PlannedSet[];
  }

  /**
   * A finished session with every set ticked off as planned.
   *
   * Takes the identifier series rather than starting one, for `withHistory`'s
   * reason: two sessions built from two fresh series both begin at `id-1`, and the
   * second silently replaces the first in the store.
   */
  function trained(
    at: ReturnType<typeof contextSeries>,
    localDate: CalendarDay,
    blocks: readonly Block[],
    overrides: Partial<WorkoutSession> = {},
  ): WorkoutSession {
    let workout = createWorkout(at(AT_START), { localDate });
    for (const block of blocks) {
      workout = addExercise(workout, at(AT_START), {
        exerciseId: block.exerciseId,
        displayName: block.displayName ?? block.exerciseId,
        loading: 'barbell-total-weight',
        plan: block.sets,
      });
    }
    workout = startWorkout(workout, at(AT_START));
    for (const set of workout.exercises.flatMap((held) => held.sets)) {
      workout = completeSet(workout, set.id, at(AT_LATER));
    }
    return { ...finishWorkout(workout, 'leave', at(AT_LATER)), ...overrides };
  }

  /** The weight of each set that came back, in order. */
  function amounts(entry: PreviousPerformance | undefined): readonly (number | null)[] {
    return (entry?.sets ?? []).map((set) => loadWeight(set.load)?.amount ?? null);
  }

  it('answers nothing without opening the store when nothing was asked about', async () => {
    // The ordinary case rather than an edge one: the screen asks this for a
    // session that has no exercises on it yet, and a scan is a transaction.
    const watcher = watched();
    const logbook = repository(watcher.store);
    await logbook.saveWorkout(
      trained(contextSeries(), ON_DAY, [{ exerciseId: 'squat', sets: [working(100)] }]),
    );

    expect((await logbook.lastPerformance([])).size).toBe(0);
    expect(watcher.scans()).toBe(0);
  });

  it('answers from the most recent completed session, with the day it was done', async () => {
    const at = contextSeries();
    const logbook = repository();
    await logbook.saveWorkout(
      trained(at, '2026-02-14', [{ exerciseId: 'squat', sets: [working(90)] }]),
    );
    await logbook.saveWorkout(
      trained(at, '2026-03-10', [{ exerciseId: 'squat', sets: [working(100), working(105)] }]),
    );
    await logbook.saveWorkout(
      trained(at, '2026-03-01', [{ exerciseId: 'squat', sets: [working(80)] }]),
    );

    const found = await logbook.lastPerformance(['squat']);

    expect(amounts(found.get('squat'))).toEqual([100, 105]);
    expect(found.get('squat')?.localDate).toBe('2026-03-10');
  });

  it('leaves an exercise with no completed history out of the map entirely', async () => {
    // Absent, not present and empty. A card rendered from an empty list reads
    // "last time: nothing", and a missing key is the case a caller already has.
    const logbook = repository();
    await logbook.saveWorkout(
      trained(contextSeries(), ON_DAY, [{ exerciseId: 'squat', sets: [working(100)] }]),
    );

    const found = await logbook.lastPerformance(['squat', 'deadlift']);

    expect(found.has('deadlift')).toBe(false);
    expect([...found.keys()]).toEqual(['squat']);
  });

  it('reads nothing out of a session that was never finished, however new it is', async () => {
    for (const status of ['draft', 'active', 'discarded'] as const) {
      const at = contextSeries();
      const logbook = repository();
      await logbook.saveWorkout(
        trained(at, '2026-02-14', [{ exerciseId: 'squat', sets: [working(90)] }]),
      );
      await logbook.saveWorkout(
        trained(at, '2026-03-10', [{ exerciseId: 'squat', sets: [working(140)] }], { status }),
      );

      expect(amounts((await logbook.lastPerformance(['squat'])).get('squat'))).toEqual([90]);
    }
  });

  it('counts only the working sets that were actually performed', async () => {
    const at = contextSeries();
    let workout = createWorkout(at(AT_START), { localDate: ON_DAY });
    workout = addExercise(workout, at(AT_START), {
      exerciseId: 'squat',
      displayName: 'Squat',
      loading: 'barbell-total-weight',
      plan: [
        { kind: 'warmup', performance: performance(kilograms(60), 5) },
        working(100),
        working(105),
        working(110),
      ],
    });
    workout = startWorkout(workout, at(AT_START));
    const ids = workout.exercises.flatMap((held) => held.sets).map((set) => set.id);
    // The warm-up and the first two working sets are ticked; the last is left
    // planned, and `leave` keeps it that way rather than marking it skipped.
    for (const id of ids.slice(0, 3)) workout = completeSet(workout, id, at(AT_LATER));
    const done = finishWorkout(workout, 'leave', at(AT_LATER));
    // A complete set carrying no result is unreachable through this package and
    // arrives from a backup something else wrote. It would draw an empty row.
    const stripped: WorkoutSession = {
      ...done,
      exercises: done.exercises.map((held) => ({
        ...held,
        sets: held.sets.map((set, index) => (index === 2 ? { ...set, performed: null } : set)),
      })),
    };
    const logbook = repository();
    await logbook.saveWorkout(stripped);

    expect(amounts((await logbook.lastPerformance(['squat'])).get('squat'))).toEqual([100]);
  });

  it('answers each exercise from whichever session is most recent for it', async () => {
    const at = contextSeries();
    const logbook = repository();
    await logbook.saveWorkout(
      trained(at, '2026-03-01', [
        { exerciseId: 'squat', sets: [working(80)] },
        { exerciseId: 'bench-press', sets: [working(50)] },
        { exerciseId: 'deadlift', sets: [working(150)] },
      ]),
    );
    await logbook.saveWorkout(
      trained(at, '2026-03-08', [{ exerciseId: 'bench-press', sets: [working(60)] }]),
    );
    await logbook.saveWorkout(
      trained(at, '2026-03-10', [{ exerciseId: 'squat', sets: [working(110)] }]),
    );

    const found = await logbook.lastPerformance(['squat', 'bench-press', 'deadlift']);

    expect(amounts(found.get('squat'))).toEqual([110]);
    expect(amounts(found.get('bench-press'))).toEqual([60]);
    expect(amounts(found.get('deadlift'))).toEqual([150]);
    expect([...found.values()].map((entry) => entry.localDate)).toEqual([
      '2026-03-10',
      '2026-03-08',
      '2026-03-01',
    ]);
  });

  it('finds a lift the two sessions named differently, because the key is the id', async () => {
    // `displayName` is snapshotted per session, so the same lift reads as whatever
    // the catalogue called it that day. Matching on it answers "no history" to a
    // lifter who renamed a custom exercise.
    const at = contextSeries();
    const logbook = repository();
    await logbook.saveWorkout(
      trained(at, '2026-02-14', [
        { exerciseId: 'squat', displayName: 'Squat', sets: [working(90)] },
      ]),
    );
    await logbook.saveWorkout(
      trained(at, '2026-03-10', [
        { exerciseId: 'squat', displayName: 'Back Squat, belt', sets: [working(120)] },
      ]),
    );

    const found = await logbook.lastPerformance(['squat']);

    expect(amounts(found.get('squat'))).toEqual([120]);
    expect(found.has('Back Squat, belt')).toBe(false);
    expect([...found.keys()]).toEqual(['squat']);
  });

  it('stops reading as soon as the day that answered everything is finished', async () => {
    // One session per calendar day, so there is no same-day tie and the boundary
    // is unambiguous: the newest session answers both exercises, the next one
    // read is from another day and ends the walk. Nothing older is fetched.
    const at = contextSeries();
    const watcher = watched();
    const logbook = repository(watcher.store);
    await logbook.saveWorkout(
      trained(at, '2026-03-10', [
        { exerciseId: 'squat', sets: [working(110)] },
        { exerciseId: 'bench-press', sets: [working(70)] },
      ]),
    );
    for (const day of ['2026-03-08', '2026-03-06', '2026-03-04', '2026-03-02', '2026-02-28']) {
      await logbook.saveWorkout(trained(at, day, [{ exerciseId: 'squat', sets: [working(90)] }]));
    }

    const found = await logbook.lastPerformance(['squat', 'bench-press']);
    const stored = await logbook.listWorkouts();

    expect(watcher.visited()).toEqual(['2026-03-10', '2026-03-08']);
    expect(watcher.visited().length).toBeLessThan(stored.length);
    // One walk for the whole question, not one per exercise.
    expect(watcher.scans()).toBe(1);
    expect(amounts(found.get('squat'))).toEqual([110]);
    expect(amounts(found.get('bench-press'))).toEqual([70]);
  });
});

describe('custom exercises and equipment profiles', () => {
  it('round-trip and can be removed', async () => {
    const logbook = repository();
    await logbook.saveExercise(exercise('cable-row', 'Cable Row'));
    await logbook.saveEquipmentProfile(profile('home', 'Garage'));

    expect(await logbook.listExercises()).toHaveLength(1);
    expect(await logbook.listEquipmentProfiles()).toHaveLength(1);

    await logbook.deleteExercise('cable-row');
    await logbook.deleteEquipmentProfile('home');

    expect(await logbook.listExercises()).toEqual([]);
    expect(await logbook.listEquipmentProfiles()).toEqual([]);
  });

  it('replaces rather than duplicates on a second save of the same id', async () => {
    const logbook = repository();
    await logbook.saveExercise(exercise('cable-row', 'Cable Row'));
    await logbook.saveExercise(exercise('cable-row', 'Seated Cable Row'));
    const found = await logbook.listExercises();

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('Seated Cable Row');
  });
});

describe('exportSnapshot', () => {
  it('stamps the clock and the build it was given', async () => {
    const logbook = repository();

    expect(await logbook.exportSnapshot()).toMatchObject({
      exportedAt: AT_LATER,
      applicationVersion: '0.1.0',
    });
  });

  it('carries everything, with the unfinished session in its own field', async () => {
    const logbook = repository();
    const at = contextSeries();
    const live = finished('2026-03-11', at);
    const old = finished('2026-02-14', at);
    await logbook.saveWorkout(old);
    await logbook.saveActiveWorkout(live);
    await logbook.saveExercise(exercise('cable-row', 'Cable Row'));
    await logbook.saveEquipmentProfile(profile('home', 'Garage'));

    const { data } = await logbook.exportSnapshot();

    expect(data.activeWorkout?.id).toBe(live.id);
    expect(data.workouts.map((workout) => workout.id)).toEqual([old.id]);
    expect(data.exerciseDefinitions).toHaveLength(1);
    expect(data.equipmentProfiles).toHaveLength(1);
  });

  it('never lists the active workout twice', async () => {
    // Restoring a backup that held it in both places would produce a second,
    // finished-looking copy of a session nobody did.
    const logbook = repository();
    const live = finished();
    await logbook.saveActiveWorkout(live);
    const { data } = await logbook.exportSnapshot();

    expect(data.workouts).toEqual([]);
    expect(data.activeWorkout?.id).toBe(live.id);
  });

  it('exports the defaults for a logbook that has never been configured', async () => {
    const logbook = repository();

    expect((await logbook.exportSnapshot()).data.settings).toEqual(defaultSettings());
  });
});

describe('replaceFromBackup', () => {
  it('is a replacement and not a merge', async () => {
    const logbook = repository();
    const at = contextSeries();
    await logbook.saveWorkout(finished('2026-01-01', at));
    await logbook.saveExercise(exercise('cable-row', 'Cable Row'));

    const other = repository();
    await other.saveWorkout(finished('2026-03-11', contextSeries()));
    const backup = await other.exportSnapshot();

    await logbook.replaceFromBackup(backup);

    expect((await logbook.listWorkouts()).map((row) => row.localDate)).toEqual(['2026-03-11']);
    expect(await logbook.listExercises()).toEqual([]);
  });

  it('restores the unfinished session as the unfinished session', async () => {
    const source = repository();
    const live = finished();
    await source.saveActiveWorkout(live);
    const backup = await source.exportSnapshot();

    const logbook = repository();
    await logbook.replaceFromBackup(backup);

    expect((await logbook.loadActiveWorkout())?.id).toBe(live.id);
    expect(await logbook.listWorkouts()).toHaveLength(1);
  });

  it('round-trips a whole logbook byte for byte', async () => {
    const source = repository();
    const at = contextSeries();
    await source.saveSettings({ ...defaultSettings(), displayUnit: 'kg' });
    await source.saveWorkout(finished('2026-02-14', at));
    await source.saveActiveWorkout(finished('2026-03-11', at));
    await source.saveExercise(exercise('cable-row', 'Cable Row'));
    await source.saveEquipmentProfile(profile('home', 'Garage'));
    const backup = await source.exportSnapshot();

    const logbook = repository();
    await logbook.replaceFromBackup(backup);

    expect(await logbook.exportSnapshot()).toEqual(backup);
  });

  it('clears an active session the backup does not have', async () => {
    const logbook = repository();
    await logbook.saveActiveWorkout(finished());

    const empty = repository();
    await logbook.replaceFromBackup(await empty.exportSnapshot());

    expect(await logbook.loadActiveWorkout()).toBeNull();
  });
});

describe('clearAll', () => {
  it('removes everything, including the settings', async () => {
    // Section 10.6. The settings go too: leaving a remembered gym behind after a
    // lifter asked for their data to be deleted is not what they asked for.
    const logbook = repository();
    await logbook.saveSettings({ ...defaultSettings(), displayUnit: 'kg' });
    await logbook.saveActiveWorkout(finished());
    await logbook.saveExercise(exercise('cable-row', 'Cable Row'));

    await logbook.clearAll();

    expect(await logbook.listWorkouts()).toEqual([]);
    expect(await logbook.listExercises()).toEqual([]);
    expect(await logbook.loadActiveWorkout()).toBeNull();
    expect(await logbook.loadSettings()).toEqual(defaultSettings());
  });
});

describe('the memory store', () => {
  it('says out loud that it is not keeping anything', async () => {
    // A supported mode a lifter is not told about is a data-loss trap.
    const logbook = repository();

    expect(logbook.durable).toBe(false);
    expect(await logbook.listWorkouts()).toEqual([]);
  });

  it('hands back copies, all the way down', async () => {
    // The real database deserialises afresh on every read. A store that handed out
    // its own objects would let a caller mutate the "database" by editing
    // something it read -- a bug that passes every test written against this store
    // and fails against IndexedDB. Checked at depth, because a shallow copy has
    // the same failure one level in.
    const logbook = repository();
    const workout = finished();
    await logbook.saveWorkout(workout);

    const first = await logbook.getWorkout(workout.id);
    const second = await logbook.getWorkout(workout.id);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first?.exercises[0]).not.toBe(second?.exercises[0]);
    expect(first?.exercises[0]?.sets[0]).not.toBe(second?.exercises[0]?.sets[0]);
    expect(first).not.toBe(workout);
  });
});
