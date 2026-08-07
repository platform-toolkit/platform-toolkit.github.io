// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The custom elements, and the one call that puts them in the registry.
 *
 * The same construction as tool 9's, for the same reason. Section 15 asks every tool
 * package for an explicit `define…()` rather than a side-effecting import, because the
 * registry is a global that throws on a second write: a package registering its tags
 * on import hands a consumer a `NotSupportedError` at module-evaluation time -- before
 * a line of its own code runs, from a file it did not write, naming a tag it has never
 * heard of -- the first time a bundler fails to dedupe this package or a second copy
 * arrives through a transitive dependency. So no file here carries a `@customElement`
 * decorator, and this is the only module that touches `customElements`.
 *
 * Every tag is defined together. All but the root are inside the root's shadow root,
 * and defining only the root would leave a page of unupgraded elements that render
 * nothing and report nothing -- a blank tool with a clean console. `ELEMENTS` below is
 * the list; do not write the count into a sentence, which is how the last one went
 * stale in three files at once.
 */
import type { LitElement } from 'lit';

import { ACTIVE_WORKOUT_TAG, PtkActiveWorkout } from './ptk-active-workout.js';
import { EQUIPMENT_LIBRARY_TAG, PtkEquipmentLibrary } from './ptk-equipment-library.js';
import { EXERCISE_HISTORY_TAG, PtkExerciseHistory } from './ptk-exercise-history.js';
import { EXERCISE_LIBRARY_TAG, PtkExerciseLibrary } from './ptk-exercise-library.js';
import { PtkTrainingLogbook, TRAINING_LOGBOOK_TAG } from './ptk-training-logbook.js';
import { PtkWorkoutBuilder, WORKOUT_BUILDER_TAG } from './ptk-workout-builder.js';
import { PtkWorkoutDetail, WORKOUT_DETAIL_TAG } from './ptk-workout-detail.js';
import { PtkWorkoutHistory, WORKOUT_HISTORY_TAG } from './ptk-workout-history.js';

export {
  ACTIVE_WORKOUT_TAG,
  EQUIPMENT_LIBRARY_TAG,
  EXERCISE_HISTORY_TAG,
  EXERCISE_LIBRARY_TAG,
  PtkActiveWorkout,
  PtkEquipmentLibrary,
  PtkExerciseHistory,
  PtkExerciseLibrary,
  PtkTrainingLogbook,
  PtkWorkoutBuilder,
  PtkWorkoutDetail,
  PtkWorkoutHistory,
  TRAINING_LOGBOOK_TAG,
  WORKOUT_BUILDER_TAG,
  WORKOUT_DETAIL_TAG,
  WORKOUT_HISTORY_TAG,
};

export {
  SET_PLAN_EVENT,
  WORKOUT_CHANGED_EVENT,
  WORKOUT_FINISHED_EVENT,
  type SetPlanChange,
  type SetPlanChangedDetail,
  type WorkoutChangedDetail,
  type WorkoutFinishedDetail,
} from './ptk-active-workout.js';
export { WORKOUT_PLANNED_EVENT, type WorkoutPlannedDetail } from './ptk-workout-builder.js';
export {
  PROFILE_APPLIED_EVENT,
  PROFILE_REMOVED_EVENT,
  PROFILE_SAVED_EVENT,
  RACK_CHANGED_EVENT,
  type ProfileIdDetail,
  type ProfileSavedDetail,
  type RackChangedDetail,
} from './ptk-equipment-library.js';
export { EXERCISE_HISTORY_EVENT, type ExerciseHistoryOpenDetail } from './ptk-exercise-history.js';
export {
  EXERCISE_REMOVED_EVENT,
  EXERCISE_SAVED_EVENT,
  type ExerciseIdDetail,
  type ExerciseSavedDetail,
} from './ptk-exercise-library.js';
export {
  WORKOUT_OPEN_EVENT,
  WORKOUT_REPEAT_EVENT,
  type WorkoutOpenDetail,
  type WorkoutRepeatDetail,
} from './ptk-workout-history.js';

export {
  BACKUP_EXPORTED_EVENT,
  SET_COMPLETED_EVENT,
  WORKOUT_COMPLETED_EVENT,
  WORKOUT_SAVED_EVENT,
  WORKOUT_STARTED_EVENT,
  type BackupExportedDetail,
  type SetCompletedDetail,
  type WorkoutEventDetail,
} from './events.js';

export {
  ACTIVE_NOTES,
  BUILDER_NOTES,
  DETAIL_NOTES,
  DONE_NOTES,
  EDIT_NOTES,
  EQUIPMENT_NOTES,
  EXERCISE_NOTES,
  FINISH_DISPOSITIONS,
  FINISH_DISPOSITION_NOTES,
  HANDOFF_NOTES,
  HISTORY_NOTES,
  HOME_NOTES,
  LOADING_LABELS,
  LOADING_NOTES,
  RECORDS_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  SET_KINDS,
  SET_STATUSES,
  UNIT_LABELS,
  WARMUP_FAMILY_LABELS,
  WORKOUT_STATUSES,
  formatDuration,
  type SaveState,
} from './copy.js';

export {
  ASSIST_SUFFIX,
  NOT_SET,
  formatLoad,
  formatPerformance,
  formatSetRun,
  formatVolume,
} from './format.js';

export {
  MAX_PLANNED_REPS,
  MAX_PLANNED_SETS,
  newPlanRow,
  planProblem,
  problemFor,
  readPlan,
  type PlanDraftRow,
  type PlanField,
  type PlanProblem,
  type PlanProblemCode,
  type PlanReading,
  type PlannedExercise,
} from './plan.js';

/** Every tag this package owns, paired with what to register under it. */
const ELEMENTS: readonly (readonly [string, typeof LitElement])[] = [
  [ACTIVE_WORKOUT_TAG, PtkActiveWorkout],
  [EQUIPMENT_LIBRARY_TAG, PtkEquipmentLibrary],
  [EXERCISE_HISTORY_TAG, PtkExerciseHistory],
  [EXERCISE_LIBRARY_TAG, PtkExerciseLibrary],
  [WORKOUT_BUILDER_TAG, PtkWorkoutBuilder],
  [WORKOUT_DETAIL_TAG, PtkWorkoutDetail],
  [WORKOUT_HISTORY_TAG, PtkWorkoutHistory],
  [TRAINING_LOGBOOK_TAG, PtkTrainingLogbook],
];

/**
 * Registers the tool's elements, once.
 *
 * Safe to call any number of times, from any number of modules, in any order. Returns
 * the root constructor so a consumer can reach the property types without a second
 * import.
 *
 * A tag already held by *something else* is left alone rather than reported. There is
 * nothing useful to do about it here -- the page that defined it did so first and this
 * package cannot take it back -- and throwing would turn somebody else's naming
 * collision into this tool refusing to load at all.
 */
export function defineTrainingLogbook(): typeof PtkTrainingLogbook {
  for (const [tag, constructor] of ELEMENTS) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
  return PtkTrainingLogbook;
}
