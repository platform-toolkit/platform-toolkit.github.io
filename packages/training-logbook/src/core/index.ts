// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The pure core of the training logbook.
 *
 * No Lit, no DOM, no storage, no network, and no clock -- section 15's first
 * requirement for a tool package, and section 12.3's for this one. A workout is a
 * value and every operation on it is a function from one value to the next, which
 * is what makes section 18.2's demand -- "test interruption after every meaningful
 * action" -- a thing a test can express rather than a thing a test can simulate.
 *
 * The clock and the identifier generator are the two things this cannot do for
 * itself, and both arrive in a {@link SessionContext} supplied by the caller.
 */

export {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_BYTES,
  backupFilename,
  backupPreview,
  backupSummaries,
  createBackup,
  readBackup,
  serializeBackup,
  type BackupOptions,
  type BackupPreview,
  type LogbookSnapshot,
  type RestoreProblem,
  type RestoreProblemCode,
  type RestoreResult,
  type TrainingLogbookBackup,
} from './backup.js';

export { calendarDayOf } from './calendar.js';

export {
  CATALOG_EXERCISES,
  PRIMARY_EXERCISES,
  canGenerateWarmup,
  createCustomExercise,
  draftFrom,
  exerciseOptions,
  findCustomExercise,
  findExercise,
  loadKindFor,
  takesWeight,
  updateCustomExercise,
  warmupFamilyFor,
  type CustomExerciseDraft,
} from './catalog.js';

export {
  DEFAULT_EQUIPMENT,
  createProfile,
  describeEquipment,
  equipmentFrom,
  findProfile,
  findProfileFor,
  renameProfile,
  sameEquipment,
  snapshotFrom,
  toBarbellSetup,
  updateProfileEquipment,
} from './equipment.js';

export {
  HANDOFF_VERSION,
  createHandoff,
  handoffLifts,
  parseHandoff,
  serializeHandoff,
  workoutFromHandoff,
  type HandoffContent,
  type HandoffLanding,
  type HandoffLandingOptions,
  type HandoffLift,
} from './handoff.js';

export {
  SCHEMA_VERSION,
  addExercise,
  addSet,
  attachWarmup,
  completeSet,
  createWorkout,
  discardWorkout,
  duplicateSet,
  emptyPerformance,
  findSet,
  findWorkoutExercise,
  finishWorkout,
  insertSets,
  markSetIncomplete,
  moveExercise,
  outstandingSets,
  performance,
  planSet,
  recordSet,
  removeExercise,
  removeSet,
  repeatWorkout,
  setExerciseNote,
  setSetNote,
  setWorkoutNote,
  setWorkoutTitle,
  skipSet,
  startWorkout,
  undoSet,
  type FinishDisposition,
  type NewExerciseOptions,
  type NewWorkoutOptions,
  type PlannedSet,
  type SessionContext,
} from './session.js';

export { sessionLoadings, type SetLoading } from './loading.js';

export {
  DEFAULT_SESSION_LIMIT,
  searchExerciseHistory,
  type ExerciseBest,
  type ExerciseHistory,
  type ExerciseHistoryOptions,
  type ExerciseHistorySearch,
  type ExerciseMarker,
  type ExerciseSessionEntry,
  type ExerciseSetEntry,
} from './records.js';

export {
  previousPerformanceIn,
  searchPreviousPerformance,
  type PreviousPerformance,
  type PreviousPerformanceSearch,
} from './previous.js';

export {
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_STEP_SECONDS,
  adjustRest,
  clampRestSeconds,
  pauseRest,
  resetRest,
  restIsUp,
  restRemainingMillis,
  restSecondsFor,
  resumeRest,
  retimeRest,
  startRest,
  startRestFor,
  withRestSecondsFor,
  type RestTimer,
} from './rest.js';

export {
  byMostRecent,
  isWorkingSet,
  loadWeight,
  setWasEdited,
  summarize,
  workoutDurationMillis,
  workoutProgress,
  type WorkoutProgress,
  type WorkoutSummary,
} from './summary.js';

export {
  applyWarmup,
  clearWarmup,
  rampExercise,
  rampLastExercise,
  warmupChange,
  warmupIsCurrent,
  warmupMatchesEquipment,
  warmupSets,
  workingPrescription,
  type RampOutcome,
  type RampRefusal,
  type WarmupChange,
  type WarmupChangeResult,
  type WarmupInput,
  type WorkingPrescription,
} from './warmup.js';
