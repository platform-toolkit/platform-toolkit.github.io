// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The catalogue, and the rule it exists to enforce: what an exercise asks a
 * lifter for is declared, never guessed from its name.
 */

import { LIFTS } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type { CustomExercise, LoadingModel } from '../types.js';

import {
  CATALOG_EXERCISES,
  PRIMARY_EXERCISES,
  canGenerateWarmup,
  createCustomExercise,
  draftFrom,
  exerciseOptions,
  findCustomExercise,
  findExercise,
  loadFor,
  loadKindFor,
  takesWeight,
  updateCustomExercise,
  warmupFamilyFor,
  type CustomExerciseDraft,
} from './catalog.js';
import { AT_LATER, testContext } from './context.fixture.js';

const AT = '2026-03-10T17:00:00.000Z';

function custom(overrides: Partial<CustomExercise> = {}): CustomExercise {
  return {
    id: 'custom-1',
    name: 'Sled Push',
    loading: 'custom-weight-reps',
    warmupFamily: null,
    defaultUnit: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe('loading models', () => {
  it.each([
    ['barbell-total-weight', 'implement', true],
    ['bodyweight', 'none', false],
    ['bodyweight-plus-added-weight', 'added', true],
    ['assisted-bodyweight', 'assisted', true],
    ['machine-or-cable-weight', 'implement', true],
    ['repetitions-only', 'none', false],
    ['custom-weight-reps', 'implement', true],
  ] as const)('%s asks for a %s load', (model: LoadingModel, kind, weighed) => {
    expect(loadKindFor(model)).toBe(kind);
    expect(takesWeight(model)).toBe(weighed);
  });
});

describe('CATALOG_EXERCISES', () => {
  it('contains every shared barbell lift', () => {
    const ids = new Set(CATALOG_EXERCISES.map((exercise) => exercise.id));

    expect(LIFTS.every((lift) => ids.has(lift.id))).toBe(true);
  });

  it('gives every shared lift a barbell total and the ramp family it already had', () => {
    const barbell = CATALOG_EXERCISES.filter((exercise) =>
      LIFTS.some((lift) => lift.id === exercise.id),
    );

    expect(barbell.every((exercise) => exercise.loading === 'barbell-total-weight')).toBe(true);
    expect(
      barbell.every(
        (exercise) =>
          exercise.warmupFamily === LIFTS.find((lift) => lift.id === exercise.id)?.family,
      ),
    ).toBe(true);
  });

  it('adds the movements a barbell ramp cannot describe, with no family', () => {
    const unramped = [
      'chin-up',
      'weighted-chin-up',
      'assisted-chin-up',
      'lat-pulldown',
      'dip',
      'weighted-dip',
      'back-extension',
    ];

    for (const id of unramped) {
      const exercise = findExercise(id);
      expect(exercise, id).not.toBeNull();
      expect(exercise?.warmupFamily, id).toBeNull();
    }
  });

  it('separates the three chin-up variants by what they load', () => {
    // The clearest case for declared loading models: bodyweight, plus 20 kg, and
    // minus 20 kg of machine assistance are three different sets.
    expect(findExercise('chin-up')?.loading).toBe('bodyweight');
    expect(findExercise('weighted-chin-up')?.loading).toBe('bodyweight-plus-added-weight');
    expect(findExercise('assisted-chin-up')?.loading).toBe('assisted-bodyweight');
  });

  it('has no duplicate identifiers', () => {
    const ids = CATALOG_EXERCISES.map((exercise) => exercise.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers at least the two dozen movements the requirements name', () => {
    expect(CATALOG_EXERCISES.length).toBeGreaterThanOrEqual(24);
  });

  it('marks everything as coming from the catalogue', () => {
    expect(CATALOG_EXERCISES.every((exercise) => exercise.origin === 'catalog')).toBe(true);
  });
});

describe('PRIMARY_EXERCISES', () => {
  it('is the four, in the shared list s order', () => {
    expect(PRIMARY_EXERCISES.map((exercise) => exercise.id)).toEqual([
      'squat',
      'bench-press',
      'deadlift',
      'overhead-press',
    ]);
  });

  it('is derived from the flag rather than a second list', () => {
    expect(PRIMARY_EXERCISES).toEqual(CATALOG_EXERCISES.filter((exercise) => exercise.primary));
  });
});

describe('exerciseOptions', () => {
  it('appends a lifter s own exercises after the catalogue', () => {
    const options = exerciseOptions([custom()]);
    const last = options[options.length - 1];

    expect(last).toMatchObject({ id: 'custom-1', name: 'Sled Push', origin: 'custom' });
    expect(options).toHaveLength(CATALOG_EXERCISES.length + 1);
  });

  it('never marks a custom exercise as primary', () => {
    expect(exerciseOptions([custom()]).filter((exercise) => exercise.primary)).toHaveLength(4);
  });

  it('a custom exercise sharing a catalogue identifier replaces it rather than doubling it', () => {
    const options = exerciseOptions([custom({ id: 'squat', name: 'My Squat' })]);

    expect(options.filter((exercise) => exercise.id === 'squat')).toHaveLength(1);
    expect(findExercise('squat', [custom({ id: 'squat', name: 'My Squat' })])?.name).toBe(
      'My Squat',
    );
  });

  it('keeps the family a lifter chose and invents none where they chose nothing', () => {
    expect(exerciseOptions([custom({ warmupFamily: 'squat-press' })]).at(-1)?.warmupFamily).toBe(
      'squat-press',
    );
    expect(exerciseOptions([custom()]).at(-1)?.warmupFamily).toBeNull();
  });
});

describe('findExercise', () => {
  it('answers null for an identifier nothing has', () => {
    expect(findExercise('no-such-movement')).toBeNull();
  });
});

describe('canGenerateWarmup', () => {
  it('is true for a barbell lift with a family', () => {
    const squat = findExercise('squat');
    if (squat === null) throw new Error('no squat');

    expect(canGenerateWarmup(squat)).toBe(true);
    expect(warmupFamilyFor(squat)).toBe('squat-press');
  });

  it('is false without a family', () => {
    const chinUp = findExercise('chin-up');
    if (chinUp === null) throw new Error('no chin-up');

    expect(canGenerateWarmup(chinUp)).toBe(false);
    expect(warmupFamilyFor(chinUp)).toBeNull();
  });

  it('is false for a family on something that is not a barbell', () => {
    // Both halves matter. A lifter may give a custom cable movement a family, and
    // the engine still has no plates to put on a cable stack -- section 8.2.
    const [cable] = exerciseOptions([
      custom({ loading: 'machine-or-cable-weight', warmupFamily: 'pull' }),
    ]).slice(-1);
    if (cable === undefined) throw new Error('no custom exercise');

    expect(canGenerateWarmup(cable)).toBe(false);
    expect(warmupFamilyFor(cable)).toBeNull();
  });

  it('is true for a custom barbell movement the lifter gave a family', () => {
    const [barbell] = exerciseOptions([
      custom({ loading: 'barbell-total-weight', warmupFamily: 'deadlift' }),
    ]).slice(-1);
    if (barbell === undefined) throw new Error('no custom exercise');

    expect(canGenerateWarmup(barbell)).toBe(true);
    expect(warmupFamilyFor(barbell)).toBe('deadlift');
  });
});

describe('loadFor', () => {
  // Invented weights. Nothing in this file is a federation figure; these are
  // whatever number makes the four shapes distinguishable from each other.
  const WEIGHT = { amount: 60, unit: 'kg' } as const;

  it.each([
    ['barbell-total-weight', 'implement'],
    ['bodyweight-plus-added-weight', 'added'],
    ['assisted-bodyweight', 'assisted'],
    ['machine-or-cable-weight', 'implement'],
    ['custom-weight-reps', 'implement'],
  ] as const)('puts a %s weight into an %s load', (model: LoadingModel, kind) => {
    expect(loadFor(model, WEIGHT)).toStrictEqual({ kind, weight: WEIGHT });
  });

  it.each(['bodyweight', 'repetitions-only'] as const)(
    'drops a weight handed to %s, which does not record one',
    (model: LoadingModel) => {
      // Not an error and not a silent `implement`. A screen that offered a weight
      // box on a chin-up is the bug; recording forty kilograms of chin-up because
      // it did would be the bug nobody finds.
      expect(loadFor(model, WEIGHT)).toStrictEqual({ kind: 'none' });
    },
  );

  it('reads a blank weight as no load rather than as zero', () => {
    // Section 6.2: a planned set with the weight left blank is "I will fill it in
    // as I go", and a zero-kilogram squat is a different claim.
    expect(loadFor('barbell-total-weight', null)).toStrictEqual({ kind: 'none' });
  });

  it('never writes a counterweight as weight lifted', () => {
    const assisted = loadFor('assisted-bodyweight', WEIGHT);
    const added = loadFor('bodyweight-plus-added-weight', WEIGHT);

    // The whole reason this function exists in one place. Both are 60 kg and they
    // are opposite facts, so the shapes have to differ even though the numbers do
    // not -- every summary and export downstream reads the shape.
    expect(assisted).not.toStrictEqual(added);
  });
});

describe('createCustomExercise', () => {
  const DRAFT: CustomExerciseDraft = {
    name: 'Sled Push',
    loading: 'custom-weight-reps',
    warmupFamily: null,
    defaultUnit: null,
  };

  it('takes its identifier and both stamps from the context', () => {
    expect(createCustomExercise(DRAFT, testContext())).toStrictEqual(
      custom({ id: 'id-1', createdAt: AT, updatedAt: AT }),
    );
  });

  it('trims the name it is given', () => {
    // A leading space is invisible in the list and decisive in the sort, so a
    // movement typed with one sits above every other movement forever.
    const padded = createCustomExercise({ ...DRAFT, name: '  Sled Push  ' }, testContext());

    expect(padded.name).toBe('Sled Push');
  });

  it('keeps a family the engine would refuse', () => {
    // Deliberate, and the docblock's reason: dropping it here would discard an
    // answer the lifter gave, so switching this to a barbell later would lose a
    // family they had already chosen. The refusal stays where it already is, and
    // the describe above proves it still refuses this one.
    const machine = createCustomExercise(
      { ...DRAFT, loading: 'machine-or-cable-weight', warmupFamily: 'squat-press' },
      testContext(),
    );

    expect(machine.warmupFamily).toBe('squat-press');
  });
});

describe('updateCustomExercise', () => {
  const SAVED = custom({ id: 'exercise-1' });

  it('never moves the identifier', () => {
    // WorkoutExercise.exerciseId points here, and because the name is snapshotted
    // onto each session the orphaning would stay invisible until a repeat.
    const renamed = updateCustomExercise(
      SAVED,
      { ...draftFrom(SAVED), name: 'Prowler Push' },
      testContext(AT_LATER),
    );

    expect(renamed.id).toBe(SAVED.id);
    expect(renamed.name).toBe('Prowler Push');
  });

  it('stamps only the second timestamp', () => {
    const renamed = updateCustomExercise(
      SAVED,
      { ...draftFrom(SAVED), name: 'Prowler Push' },
      testContext(AT_LATER),
    );

    expect(renamed.createdAt).toBe(AT);
    expect(renamed.updatedAt).toBe(AT_LATER);
  });

  it('returns the exercise it was handed when the draft changes nothing', () => {
    // #98 one table over: opening the editor and pressing Save with nothing typed
    // would otherwise re-stamp the row, and updatedAt is what history sorts on.
    expect(updateCustomExercise(SAVED, draftFrom(SAVED), testContext(AT_LATER))).toBe(SAVED);
  });

  it('reads that sameness through the trim', () => {
    // Otherwise the identity check is defeated by a space nobody can see, which is
    // the one way a lifter reliably produces a no-op save.
    const padded = { ...draftFrom(SAVED), name: `  ${SAVED.name}  ` };

    expect(updateCustomExercise(SAVED, padded, testContext(AT_LATER))).toBe(SAVED);
  });

  it.each([
    ['loading', { loading: 'barbell-total-weight' }],
    ['warm-up family', { warmupFamily: 'squat-press' }],
    ['unit', { defaultUnit: 'lb' }],
  ] as const)('counts a changed %s as a change', (_what, change) => {
    const updated = updateCustomExercise(
      SAVED,
      { ...draftFrom(SAVED), ...change },
      testContext(AT_LATER),
    );

    expect(updated).not.toBe(SAVED);
    expect(updated.updatedAt).toBe(AT_LATER);
  });
});

describe('draftFrom', () => {
  it('round-trips through an update that changes nothing', () => {
    // The pair is the contract: what an editor opens on has to be what a save of
    // an untouched form sends back, or every open-and-close is an edit.
    const saved = custom({ id: 'exercise-1', warmupFamily: 'olympic', defaultUnit: 'kg' });

    expect(updateCustomExercise(saved, draftFrom(saved), testContext(AT_LATER))).toBe(saved);
  });

  it('carries no identifier and no stamps', () => {
    expect(Object.keys(draftFrom(custom())).sort()).toStrictEqual([
      'defaultUnit',
      'loading',
      'name',
      'warmupFamily',
    ]);
  });
});

describe('findCustomExercise', () => {
  const LIBRARY = [custom({ id: 'exercise-1' }), custom({ id: 'exercise-2', name: 'Yoke Walk' })];

  it('finds one by identifier', () => {
    expect(findCustomExercise(LIBRARY, 'exercise-2')?.name).toBe('Yoke Walk');
  });

  it('answers null for an identifier nothing has', () => {
    // Not undefined, and not a throw: the callers are event handlers holding an id
    // from a row that may have been removed between the render and the tap.
    expect(findCustomExercise(LIBRARY, 'exercise-9')).toBeNull();
  });
});
