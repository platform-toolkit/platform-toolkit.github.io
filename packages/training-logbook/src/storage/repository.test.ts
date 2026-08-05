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
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
} from '../core/session.js';
import type { CustomExercise, EquipmentProfile, WorkoutSession } from '../types.js';

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
