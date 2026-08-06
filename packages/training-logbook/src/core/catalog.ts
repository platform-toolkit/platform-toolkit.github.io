// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a lifter can log, and what each of those things asks them for.
 *
 * WHERE THE CATALOGUE COMES FROM
 *
 * Most of it is not here. `@platform-toolkit/domain` already publishes `LIFTS`
 * -- the barbell movements the warm-up engine can build a ramp for, each with the
 * family that ramp uses -- and the warm-up calculator has shown that list to
 * people for as long as it has existed. Copying it would give this tool a second
 * list to keep in step, and the first divergence would be a lifter warming up a
 * pin squat in one tool and finding no pin squat in the other.
 *
 * So this file maps that list into {@link ExerciseOption} and *adds* the
 * movements a barbell catalogue has no business holding. That line is worth
 * stating plainly, because it is the reason for the split and not an accident of
 * history:
 *
 *   - `domain`'s `LIFTS` is "movements the warm-up engine can ramp on a bar".
 *     Every entry has a `WarmupFamily`, and it has one because the calculator
 *     cannot draw a plate-loading card without it.
 *   - This catalogue is "movements a training log can record". That is a
 *     superset. A chin-up, a dip, a lat pulldown and a back extension are all
 *     things a powerlifter does on a Tuesday, and none of them has a barbell
 *     ramp -- putting them in `LIFTS` would offer the warm-up calculator four
 *     movements it would have to invent plate maths for.
 *
 * A movement added to `LIFTS` therefore appears here automatically, which is the
 * behaviour worth having: the shared list stays the place a barbell lift is
 * added.
 *
 * NOTHING HERE INFERS ANYTHING FROM A NAME
 *
 * Section 6.3 and section 6.4. Every entry declares its loading model, and a
 * custom exercise declares its own -- including whether it can be warmed up at
 * all, and if so with which family. There is no string matching in this file and
 * there must never be: a tool that decided "Assisted Chin-Up" was assisted by
 * reading the word would record a machine's counterweight as weight lifted the
 * first time somebody named a movement "Chin-Up (assisted by nothing)".
 */

import {
  LIFTS,
  type LiftDefinition,
  type WarmupFamily,
  type Weight,
  type WeightUnit,
} from '@platform-toolkit/domain';

import type {
  CustomExercise,
  ExerciseOption,
  LoadingModel,
  SetLoad,
  SetLoadKind,
} from '../types.js';

import type { SessionContext } from './session.js';

/**
 * What each loading model asks a lifter for.
 *
 * A total map rather than a switch with a default, so adding a loading model to
 * the union is a compile error here instead of a set that silently records
 * nothing.
 */
const LOAD_KINDS: Readonly<Record<LoadingModel, SetLoadKind>> = {
  'barbell-total-weight': 'implement',
  bodyweight: 'none',
  'bodyweight-plus-added-weight': 'added',
  'assisted-bodyweight': 'assisted',
  'machine-or-cable-weight': 'implement',
  'repetitions-only': 'none',
  'custom-weight-reps': 'implement',
};

/** Which of the four load shapes a loading model asks for. */
export function loadKindFor(model: LoadingModel): SetLoadKind {
  return LOAD_KINDS[model];
}

/** Whether a loading model records a weight at all. */
export function takesWeight(model: LoadingModel): boolean {
  return LOAD_KINDS[model] !== 'none';
}

/**
 * A weight, put into the shape the movement records it in.
 *
 * Here rather than in each screen because getting it wrong is silent and section
 * 6.2 says what it costs: an assisted chin-up whose 40 kg counterweight is
 * written as `implement` reads, forever after, as forty kilograms the lifter
 * pulled -- and every summary, export and future chart built on that history
 * repeats it. The mapping from model to shape lives in exactly one table, so a
 * screen cannot choose a different one.
 *
 * A `null` weight collapses to `none`, which is how a lifter leaving the box
 * blank is recorded: they planned the set and have not said what it weighs yet.
 */
export function loadFor(model: LoadingModel, weight: Weight | null): SetLoad {
  const kind = LOAD_KINDS[model];
  if (kind === 'none' || weight === null) return { kind: 'none' };
  return { kind, weight };
}

/**
 * A movement this catalogue adds on top of the shared barbell list.
 *
 * Deliberately not the same shape as `LiftDefinition`: these have no warm-up
 * family, and giving them a nullable one would be inviting somebody to fill it
 * in.
 */
interface UnrampedExercise {
  readonly id: string;
  readonly name: string;
  readonly loading: LoadingModel;
  readonly defaultSets: number;
  readonly defaultReps: number;
}

/**
 * The movements section 6.2 asks for that a barbell ramp cannot describe.
 *
 * Three sets of eight throughout, because these are assistance work and the
 * requirements ask for a default rather than a prescription -- and a default is
 * a starting number in a field, overwritten by whatever the lifter types.
 *
 * Chin-ups appear three times on purpose, and it is the clearest case for
 * declared loading models in the whole file. Bodyweight, plus 20 kg, and minus
 * 20 kg of machine assistance are three different sets, and a single "Chin-Up"
 * with a weight box would record all three as the same number.
 */
const UNRAMPED: readonly UnrampedExercise[] = [
  { id: 'chin-up', name: 'Chin-Up', loading: 'bodyweight', defaultSets: 3, defaultReps: 8 },
  {
    id: 'weighted-chin-up',
    name: 'Weighted Chin-Up',
    loading: 'bodyweight-plus-added-weight',
    defaultSets: 3,
    defaultReps: 8,
  },
  {
    id: 'assisted-chin-up',
    name: 'Assisted Chin-Up',
    loading: 'assisted-bodyweight',
    defaultSets: 3,
    defaultReps: 8,
  },
  {
    id: 'lat-pulldown',
    name: 'Lat Pulldown',
    loading: 'machine-or-cable-weight',
    defaultSets: 3,
    defaultReps: 8,
  },
  { id: 'dip', name: 'Dip', loading: 'bodyweight', defaultSets: 3, defaultReps: 8 },
  {
    id: 'weighted-dip',
    name: 'Weighted Dip',
    loading: 'bodyweight-plus-added-weight',
    defaultSets: 3,
    defaultReps: 8,
  },
  {
    id: 'back-extension',
    name: 'Back Extension',
    loading: 'bodyweight',
    defaultSets: 3,
    defaultReps: 8,
  },
];

function fromLift(lift: LiftDefinition): ExerciseOption {
  return {
    id: lift.id,
    name: lift.name,
    // Every entry in the shared list is a barbell lift by construction -- the
    // warm-up engine has no other kind of ramp -- so the model is a fact about
    // that list rather than a per-entry judgement.
    loading: 'barbell-total-weight',
    warmupFamily: lift.family,
    primary: lift.primary,
    defaultSets: lift.defaultSets,
    defaultReps: lift.defaultReps,
    origin: 'catalog',
  };
}

function fromUnramped(exercise: UnrampedExercise): ExerciseOption {
  return {
    id: exercise.id,
    name: exercise.name,
    loading: exercise.loading,
    warmupFamily: null,
    primary: false,
    defaultSets: exercise.defaultSets,
    defaultReps: exercise.defaultReps,
    origin: 'catalog',
  };
}

/**
 * Every exercise the tool ships with, in the order a picker shows them.
 *
 * The barbell lifts keep the shared list's order, which puts the four first and
 * then groups the variants by movement -- somebody hunting for the pin squat
 * looks under squats, not under P. The unramped additions follow, because they
 * are assistance work and a lifter opening a picker is usually not looking for a
 * back extension.
 */
export const CATALOG_EXERCISES: readonly ExerciseOption[] = [
  ...LIFTS.map(fromLift),
  ...UNRAMPED.map(fromUnramped),
];

/** The four shown without opening a picker. Section 6.1, LOG-004. */
export const PRIMARY_EXERCISES: readonly ExerciseOption[] = CATALOG_EXERCISES.filter(
  (exercise) => exercise.primary,
);

function fromCustom(exercise: CustomExercise): ExerciseOption {
  return {
    id: exercise.id,
    name: exercise.name,
    loading: exercise.loading,
    // Whatever the lifter chose, and `null` when they chose nothing. Section 6.4
    // forbids deriving this, and the type is what stops a later edit from
    // deriving it anyway.
    warmupFamily: exercise.warmupFamily,
    primary: false,
    defaultSets: 3,
    defaultReps: 5,
    origin: 'custom',
  };
}

/**
 * The catalogue plus whatever this lifter has invented.
 *
 * A custom exercise whose id collides with a catalogue one replaces it, rather
 * than appearing twice. Collisions should not happen -- custom ids are generated
 * -- but a restored backup from a future version is exactly where one would, and
 * two rows with the same id in a picker is a worse answer than one.
 */
export function exerciseOptions(customs: readonly CustomExercise[]): readonly ExerciseOption[] {
  const custom = customs.map(fromCustom);
  const overridden = new Set(custom.map((exercise) => exercise.id));
  return [...CATALOG_EXERCISES.filter((entry) => !overridden.has(entry.id)), ...custom];
}

/** One exercise by id, or `null` where nothing answers to it. */
export function findExercise(
  id: string,
  customs: readonly CustomExercise[] = [],
): ExerciseOption | null {
  return exerciseOptions(customs).find((exercise) => exercise.id === id) ?? null;
}

/**
 * Whether this exercise can have a warm-up generated for it.
 *
 * Both halves matter. A family alone is not enough -- the engine loads a barbell,
 * and a movement whose loading model is not a barbell total has no plates to put
 * on one. Section 8.2 says the same thing in prose: bodyweight, machine and cable
 * exercises do not receive barbell plate calculations.
 */
export function canGenerateWarmup(exercise: ExerciseOption): boolean {
  return exercise.warmupFamily !== null && exercise.loading === 'barbell-total-weight';
}

/** The warm-up family for an exercise, or `null` where there is not one to use. */
export function warmupFamilyFor(exercise: ExerciseOption): WarmupFamily | null {
  return canGenerateWarmup(exercise) ? exercise.warmupFamily : null;
}

/**
 * What a lifter answered about a movement they invented. Section 6.4.
 *
 * No identifier and no timestamps, for the reason `ProfileSavedDetail` has
 * neither: the screen that collects this has no clock and no id source, and one
 * that invented either would be minting identity out of a form. The two
 * constructors below are where a draft becomes a stored exercise.
 */
export interface CustomExerciseDraft {
  readonly name: string;
  readonly loading: LoadingModel;
  /** `null` unless the lifter explicitly chose one. Never derived from the name. */
  readonly warmupFamily: WarmupFamily | null;
  /** `null` means "whatever the logbook is set to", which is not the same as a unit. */
  readonly defaultUnit: WeightUnit | null;
}

/**
 * A movement the lifter invented, as it should be stored.
 *
 * `warmupFamily` is passed through untouched even where {@link canGenerateWarmup}
 * would refuse it -- a family on a machine exercise is stored and simply never
 * used. Dropping it here would silently discard an answer the lifter gave, and
 * then changing the loading model to a barbell later would lose the family they
 * had already chosen. The refusal belongs at the point of generation, where it
 * already is, and not at the point of record.
 */
export function createCustomExercise(
  draft: CustomExerciseDraft,
  context: SessionContext,
): CustomExercise {
  return {
    id: context.nextId(),
    name: draft.name.trim(),
    loading: draft.loading,
    warmupFamily: draft.warmupFamily,
    defaultUnit: draft.defaultUnit,
    createdAt: context.at,
    updatedAt: context.at,
  };
}

/**
 * The same movement, answered again.
 *
 * The identifier does not move, which is `renameProfile`'s rule and matters more
 * here: `WorkoutExercise.exerciseId` points at this row, so a new identifier
 * would orphan every session that has ever used the movement -- and because the
 * name is snapshotted onto each session, the orphaning would be invisible until
 * somebody tried to repeat one.
 *
 * A draft that changes nothing returns the exercise it was given, unchanged
 * object and all. Without that, opening the editor and pressing Save moves the
 * row's `updatedAt`, and #98's complaint about a dead tap stamping a workout is
 * the same defect one table over.
 */
export function updateCustomExercise(
  exercise: CustomExercise,
  draft: CustomExerciseDraft,
  context: SessionContext,
): CustomExercise {
  const name = draft.name.trim();
  if (
    name === exercise.name &&
    draft.loading === exercise.loading &&
    draft.warmupFamily === exercise.warmupFamily &&
    draft.defaultUnit === exercise.defaultUnit
  ) {
    return exercise;
  }
  return {
    ...exercise,
    name,
    loading: draft.loading,
    warmupFamily: draft.warmupFamily,
    defaultUnit: draft.defaultUnit,
    updatedAt: context.at,
  };
}

/** The draft an editor opens on when it is editing something that exists. */
export function draftFrom(exercise: CustomExercise): CustomExerciseDraft {
  return {
    name: exercise.name,
    loading: exercise.loading,
    warmupFamily: exercise.warmupFamily,
    defaultUnit: exercise.defaultUnit,
  };
}

/** One of the lifter's own movements by id, or `null`. */
export function findCustomExercise(
  customs: readonly CustomExercise[],
  id: string,
): CustomExercise | null {
  return customs.find((exercise) => exercise.id === id) ?? null;
}
