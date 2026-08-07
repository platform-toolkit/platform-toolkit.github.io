// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The events the logbook reports, and the rule about what they may say.
 *
 * Section 12.5. These are ordinary browser events on the element, so anything in
 * the embedding page can hear them -- which is exactly why none of them carries a
 * lifter's training. A detail here holds identifiers this package generated and
 * counts, and never a weight, a rep count, an exercise name or a date. The
 * requirement puts it as "events remain local browser events; they must not
 * transmit data", and an identifier that means nothing outside this database is the
 * strongest form of that: a listener can tell that something happened and can
 * correlate two of these events with each other, and can learn nothing else.
 *
 * WHY SEVEN, AND WHY THAT IS ALL
 *
 * Section 12.5 suggests exactly these seven and the list is now complete. It is also
 * closed: a new download button next to an existing one is not a reason to invent an
 * eighth by symmetry. The Markdown export fires nothing for that reason. An event is
 * the one thing in this element a consumer can come to depend on and this package
 * cannot take back, so the bar for adding one is that the requirement asked for it.
 */

import type { LogbookId } from '../types.js';

/** A workout moved from planned to in progress. */
export const WORKOUT_STARTED_EVENT = 'training-workout-started';
/** A set was marked done. Fires on the one-tap path and the edited one alike. */
export const SET_COMPLETED_EVENT = 'training-set-completed';
/** A workout was finished and frozen. */
export const WORKOUT_COMPLETED_EVENT = 'training-workout-completed';
/** A workout was written to storage. Fires on every save, including autosaves. */
export const WORKOUT_SAVED_EVENT = 'training-workout-saved';
/** A backup file was handed to the browser to download. */
export const BACKUP_EXPORTED_EVENT = 'training-backup-exported';
/** A backup file was read back in and everything on the device replaced from it. */
export const BACKUP_RESTORED_EVENT = 'training-backup-restored';
/** Everything the logbook had on this device was deleted, at the lifter's request. */
export const LOCAL_DATA_CLEARED_EVENT = 'training-local-data-cleared';

/** Which workout. Nothing about what is in it. */
export interface WorkoutEventDetail {
  readonly workoutId: LogbookId;
}

/** Which set, and which workout it is in. Not what was lifted. */
export interface SetCompletedDetail {
  readonly workoutId: LogbookId;
  readonly setId: LogbookId;
}

/**
 * How much went into the file.
 *
 * A count rather than the file, deliberately. A listener that wants to know a backup
 * happened is served by this; one that wants the contents is asking the page to hand
 * a lifter's training history to whatever else is listening.
 */
export interface BackupExportedDetail {
  readonly workoutCount: number;
}

/**
 * How much came out of the file, and so how much is now on the device.
 *
 * The same count as {@link BackupExportedDetail} and a separate type anyway, because
 * the two are separate promises: a host reacting to a restore is reacting to its whole
 * view having been replaced, and a shared interface is how the day one of them grows a
 * field the other must not have becomes a breaking change to both.
 *
 * Fired only after the write landed *and* was read back. A listener that refreshes on
 * this event must not be told to refresh onto a database that does not hold the file.
 */
export interface BackupRestoredDetail {
  readonly workoutCount: number;
}

/**
 * How much was destroyed.
 *
 * The same count shape as the two backup details and, again, its own type: this one is
 * a report that something is *gone*, and a host that treats it as interchangeable with
 * a restore is a host that refreshes a view onto an empty database thinking it has a
 * full one.
 *
 * Fired only after the delete landed **and** the database was read back empty. Saying
 * *deleted* over a write that did not land is the one failure in this tool that tells a
 * lifter their training is off the device when it is still on it.
 */
export interface LocalDataClearedDetail {
  readonly workoutCount: number;
}

declare global {
  /**
   * So `addEventListener` types the detail without the listener casting it.
   *
   * Computed keys, because the event names are constants and a listener that wrote
   * the string literal instead would keep compiling on the day one of them changed.
   */
  interface HTMLElementEventMap {
    [WORKOUT_STARTED_EVENT]: CustomEvent<WorkoutEventDetail>;
    [SET_COMPLETED_EVENT]: CustomEvent<SetCompletedDetail>;
    [WORKOUT_COMPLETED_EVENT]: CustomEvent<WorkoutEventDetail>;
    [WORKOUT_SAVED_EVENT]: CustomEvent<WorkoutEventDetail>;
    [BACKUP_EXPORTED_EVENT]: CustomEvent<BackupExportedDetail>;
    [BACKUP_RESTORED_EVENT]: CustomEvent<BackupRestoredDetail>;
    [LOCAL_DATA_CLEARED_EVENT]: CustomEvent<LocalDataClearedDetail>;
  }
}
