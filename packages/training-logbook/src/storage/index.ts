// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a lifter's training is kept, and the seam that lets a host decide.
 *
 * Section 15: storage sits behind a repository adapter the consumer supplies. The
 * public shell calls {@link openLogbookStore} and gets IndexedDB, or memory where
 * the browser will not give a database. Another host implements
 * {@link LogbookStore} over whatever it has and gets the same repository.
 *
 * This is a separate entry point from `./core` because it is the half that touches
 * the platform. A consumer that only wants the rules -- to render a plan on a
 * server, to score a session in a script -- imports `./core` and never loads any of
 * this.
 */

export { memoryLogbookStore } from './memory.js';

export {
  DATABASE_NAME,
  DATABASE_VERSION,
  LogbookStorageError,
  indexedDbLogbookStore,
  openLogbookStore,
  type OpenDatabaseOptions,
  type StorageFailure,
} from './indexed-db.js';

export type { ActiveWorkoutPointer, LogbookStore } from './port.js';

export {
  createRepository,
  defaultSettings,
  type RepositoryOptions,
  type TrainingLogbookRepository,
  type WorkoutHistoryQuery,
} from './repository.js';
