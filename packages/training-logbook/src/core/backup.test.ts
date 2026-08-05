// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The restore path, which is the one place in this package where the input was
 * not written by this package.
 *
 * Most of what follows is a rejection test, and that is the right proportion. A
 * restore replaces everything a lifter has, so the interesting question is never
 * "does a good file work" -- it is what a bad one does on its way to being
 * refused, and whether it can get far enough to write anything.
 */

import { describe, expect, it } from 'vitest';

import type { LogbookSettings, WorkoutSession } from '../types.js';

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  type LogbookSnapshot,
  type TrainingLogbookBackup,
  backupFilename,
  backupPreview,
  backupSummaries,
  createBackup,
  readBackup,
  serializeBackup,
} from './backup.js';
import { AT_LATER, AT_START, ON_DAY, contextSeries, testContext } from './context.fixture.js';
import {
  addExercise,
  completeSet,
  createWorkout,
  finishWorkout,
  performance,
  startWorkout,
} from './session.js';

const SETTINGS: LogbookSettings = {
  schemaVersion: 1,
  displayUnit: 'kg',
  effort: 'none',
  restTimer: { enabled: false, defaultSeconds: 180, perExerciseSeconds: {} },
  equipment: null,
  acceptedTerms: {},
  lastBackupAt: null,
};

/** A finished squat session. Invented numbers; see section 5.1. */
function session(localDate = ON_DAY): WorkoutSession {
  const at = contextSeries();
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

function snapshot(overrides: Partial<LogbookSnapshot> = {}): LogbookSnapshot {
  return {
    settings: SETTINGS,
    equipmentProfiles: [],
    exerciseDefinitions: [],
    activeWorkout: null,
    workouts: [session()],
    ...overrides,
  };
}

function backup(overrides: Partial<LogbookSnapshot> = {}): TrainingLogbookBackup {
  return createBackup(snapshot(overrides), {
    exportedAt: AT_LATER,
    applicationVersion: '0.1.0',
  });
}

/** Reads a document the way a caller would, measuring its real byte length. */
function read(document: unknown, byteLength?: number) {
  const text = typeof document === 'string' ? document : JSON.stringify(document);
  return readBackup(text, byteLength ?? new TextEncoder().encode(text).length);
}

describe('createBackup', () => {
  it('stamps the envelope this build writes', () => {
    expect(backup()).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: AT_LATER,
      applicationVersion: '0.1.0',
    });
  });

  it('carries the unfinished workout as well as the finished ones', () => {
    // Section 10.4. A lifter who backs up mid-session and then loses the device
    // should not lose the session they were in the middle of.
    const active = startWorkout(createWorkout(testContext(), { localDate: ON_DAY }), testContext());

    expect(backup({ activeWorkout: active }).data.activeWorkout?.id).toBe(active.id);
  });
});

describe('backupFilename', () => {
  it('names the day, not the instant', () => {
    expect(backupFilename('2026-03-10')).toBe(`${BACKUP_FORMAT}-2026-03-10.json`);
  });
});

describe('serializeBackup', () => {
  it('round-trips through readBackup unchanged', () => {
    const written = backup();
    const result = read(serializeBackup(written));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a valid backup');
    expect(result.backup).toEqual(written);
    expect(result.migrated).toBe(false);
  });

  it('ends with a newline so the file is a well-formed text document', () => {
    expect(serializeBackup(backup()).endsWith('\n')).toBe(true);
  });
});

describe('readBackup', () => {
  it('rejects a file over the size limit without parsing it', () => {
    // The text passed here is valid. Only the declared size is not, which is how
    // this proves the limit is checked before the parse rather than after it.
    const result = readBackup(serializeBackup(backup()), MAX_BACKUP_BYTES + 1);

    expect(result).toEqual({ ok: false, problems: [{ code: 'too-large', path: null }] });
  });

  it('accepts a file exactly at the limit', () => {
    expect(readBackup(serializeBackup(backup()), MAX_BACKUP_BYTES).ok).toBe(true);
  });

  it('measures bytes and not characters', () => {
    // A three-byte character counts as three. Passing `text.length` would
    // undercount a file full of non-Latin exercise names by up to a factor of
    // three, and the limit would then be a limit on something else.
    const name = 'スクワット';

    expect(new TextEncoder().encode(name).length).toBe(15);
    expect(name.length).toBe(5);
  });

  it('refuses text that is not JSON', () => {
    expect(read('not a backup at all')).toEqual({
      ok: false,
      problems: [{ code: 'not-json', path: null }],
    });
  });

  it('refuses JSON that is not this tool’s backup', () => {
    // One problem naming the document, not forty naming its fields.
    const result = read({ workouts: [], settings: {} });

    expect(result).toEqual({ ok: false, problems: [{ code: 'not-a-backup', path: null }] });
  });

  it('refuses a format identifier that merely starts the same way', () => {
    const result = read({ ...backup(), format: `${BACKUP_FORMAT}-v2` });

    expect(result).toEqual({ ok: false, problems: [{ code: 'not-a-backup', path: null }] });
  });

  it('refuses a backup written by a newer build rather than parsing it', () => {
    // valibot strips unknown keys, so a future field would be silently dropped and
    // the restore would succeed while losing data. Refusing is the only honest
    // answer a build that predates the format can give.
    const result = read({ ...backup(), schemaVersion: BACKUP_SCHEMA_VERSION + 1 });

    expect(result).toEqual({ ok: false, problems: [{ code: 'newer-schema-version', path: null }] });
  });

  it('reports where an invalid value is', () => {
    const broken = backup();
    const result = read({
      ...broken,
      data: { ...broken.data, settings: { ...SETTINGS, displayUnit: 'stone' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.problems[0]?.code).toBe('invalid-data');
    expect(result.problems[0]?.path).toBe('data.settings.displayUnit');
  });

  it('never carries the offending value into the problem', () => {
    // Section 2.3 read from the other end: an error string is the thing that gets
    // pasted into a bug report, so it has nowhere to put a lifter's own numbers.
    const broken = backup();
    const result = read({
      ...broken,
      data: {
        ...broken.data,
        workouts: [{ ...session(), title: 42 }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    for (const problem of result.problems) {
      expect(JSON.stringify(problem)).not.toContain('42');
    }
  });

  it('does not coerce a weight that arrives as a string', () => {
    // Section 2.4. A file that disagrees about what a number is disagrees about
    // other things too, and repairing it would be guessing at a training history.
    const broken = backup();
    const workout = session();
    const rewritten = {
      ...workout,
      exercises: workout.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => ({
          ...set,
          planned: {
            ...set.planned,
            load: { kind: 'implement', weight: { amount: '100', unit: 'kg' } },
          },
        })),
      })),
    };
    const result = read({ ...broken, data: { ...broken.data, workouts: [rewritten] } });

    expect(result.ok).toBe(false);
  });

  it('refuses a calendar day that is not YYYY-MM-DD', () => {
    const broken = backup();
    const result = read({
      ...broken,
      data: { ...broken.data, workouts: [{ ...session(), localDate: '10/03/2026' }] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.problems[0]?.path).toBe('data.workouts.0.localDate');
  });

  it('accepts an empty logbook', () => {
    // A lifter who installs the tool, exports before logging anything, and
    // restores on a new phone is doing something reasonable.
    const empty = createBackup(
      {
        settings: SETTINGS,
        equipmentProfiles: [],
        exerciseDefinitions: [],
        activeWorkout: null,
        workouts: [],
      },
      { exportedAt: AT_START, applicationVersion: '0.1.0' },
    );

    expect(read(empty).ok).toBe(true);
  });

  it('refuses a document with no data at all', () => {
    const result = read({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: AT_START,
      applicationVersion: '0.1.0',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.problems[0]?.code).toBe('invalid-data');
  });

  it('refuses an empty export stamp', () => {
    const result = read({ ...backup(), exportedAt: '' });

    expect(result.ok).toBe(false);
  });

  it('drops a key the format does not define, and says nothing about it', () => {
    // valibot's default object behaviour, recorded because it is exactly why a
    // newer schemaVersion has to be refused above rather than parsed.
    const result = read({ ...backup(), somethingElse: 'ignored' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a valid backup');
    expect('somethingElse' in result.backup).toBe(false);
  });
});

describe('backupPreview', () => {
  it('describes the file well enough to recognise it', () => {
    const active = createWorkout(testContext(), { localDate: '2026-03-12' });
    const preview = backupPreview(
      backup({
        activeWorkout: active,
        workouts: [session('2026-03-10'), session('2026-02-14'), session('2026-03-11')],
      }),
    );

    expect(preview).toEqual({
      exportedAt: AT_LATER,
      applicationVersion: '0.1.0',
      workoutCount: 3,
      completedWorkoutCount: 3,
      customExerciseCount: 0,
      equipmentProfileCount: 0,
      hasActiveWorkout: true,
      earliestDay: '2026-02-14',
      latestDay: '2026-03-11',
    });
  });

  it('has no date range where the file holds no workouts', () => {
    const preview = backupPreview(backup({ workouts: [] }));

    expect(preview).toMatchObject({ earliestDay: null, latestDay: null, workoutCount: 0 });
  });

  it('counts only the workouts that were finished', () => {
    const draft = createWorkout(testContext(), { localDate: '2026-03-09' });
    const preview = backupPreview(backup({ workouts: [session(), draft] }));

    expect(preview).toMatchObject({ workoutCount: 2, completedWorkoutCount: 1 });
  });

  it('does not reorder the backup it was given', () => {
    const document = backup({
      workouts: [session('2026-02-14'), session('2026-03-11')],
    });
    backupPreview(document);

    expect(document.data.workouts.map((workout) => workout.localDate)).toEqual([
      '2026-02-14',
      '2026-03-11',
    ]);
  });
});

describe('backupSummaries', () => {
  it('lists the file’s workouts newest first, whatever order they are stored in', () => {
    const document = backup({
      workouts: [session('2026-02-14'), session('2026-03-11'), session('2026-03-10')],
    });

    expect(backupSummaries(document).map((row) => row.localDate)).toEqual([
      '2026-03-11',
      '2026-03-10',
      '2026-02-14',
    ]);
  });
});
