// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The JSON backup: the only copy of a lifter's training that leaves the device.
 *
 * WHY THE FILE IS AUTHORITATIVE AND THE DATABASE IS NOT
 *
 * Section 10.4 says the backup is authoritative for restore, and section 10.3
 * says why: a browser may clear its own storage, and nothing in this tool can stop
 * it. So the file is the durable copy and the database is the working one. That
 * inverts the usual relationship and it changes what this file has to be -- a
 * complete, self-describing, version-stamped document, not a dump.
 *
 * WHAT IS AND IS NOT VALIDATED
 *
 * Restore is a trust boundary: the input is a file the lifter chose, and section
 * 10.7 sets out ten steps for reading one. Steps 1 to 5 live here -- size, parse,
 * format identifier, schema, migration -- and 6 to 10 belong to the caller,
 * because "show a preview", "require confirmation" and "preserve the prior
 * database if any step fails" are a screen and a transaction and neither is a pure
 * function. {@link backupPreview} is what step 6 renders.
 *
 * The size limit is checked before `JSON.parse` and not after. A four hundred
 * megabyte file parsed and then rejected has already been allocated, and the
 * failure a lifter sees is a tab that died rather than a message saying the file
 * is too big.
 *
 * ONE THING THIS DELIBERATELY DOES NOT DO
 *
 * It does not merge. Section 10.7 permits replace-restore for the first version
 * and this takes it, because a merge needs a conflict rule for two edits to the
 * same set and there is no honest default for that -- picking the newer one would
 * silently discard a correction. Replacing is a decision the lifter can see, which
 * is why the caller must offer to download the current data first.
 */

import * as v from 'valibot';

import type {
  CustomExercise,
  EquipmentProfile,
  Instant,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';

import {
  CustomExerciseSchema,
  EquipmentProfileSchema,
  LogbookSettingsSchema,
  WorkoutSessionSchema,
} from './schema.js';
import type { WorkoutSummary } from './summary.js';
import { byMostRecent, summarize } from './summary.js';

/**
 * The format identifier.
 *
 * A whole-string match, not a prefix and not a substring. It is the one field
 * that separates "this is a logbook backup" from "this is some other tool's JSON
 * that happens to have a `workouts` array", and a loose comparison would let the
 * second one through to a replace-restore.
 */
export const BACKUP_FORMAT = 'platform-toolkit-training-logbook-backup';

/**
 * The version of the backup envelope this build writes.
 *
 * Separate from the package version and from a workout's own `schemaVersion`, per
 * section 12: three numbers because they answer three questions, and one number
 * answering all three is a number that has to be bumped for reasons that do not
 * apply to two of them.
 */
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * The largest file this will read, in bytes.
 *
 * Eight mebibytes is about two hundred thousand sets of prose-free JSON -- decades
 * of training for anybody. It exists to stop a mistyped file selection from
 * pinning a phone, not to police a real backup, and the message a caller shows for
 * it should say so.
 */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

/** Everything the logbook holds for one lifter on one device. */
export interface LogbookSnapshot {
  readonly settings: LogbookSettings;
  readonly equipmentProfiles: readonly EquipmentProfile[];
  readonly exerciseDefinitions: readonly CustomExercise[];
  /** The unfinished workout, which section 10.4 requires a backup to carry. */
  readonly activeWorkout: WorkoutSession | null;
  readonly workouts: readonly WorkoutSession[];
}

/** The document written to disk. */
export interface TrainingLogbookBackup {
  readonly format: typeof BACKUP_FORMAT;
  readonly schemaVersion: number;
  readonly exportedAt: Instant;
  /** The build that wrote it. Provenance for a human reading the file, not a gate. */
  readonly applicationVersion: string;
  readonly data: LogbookSnapshot;
}

const SnapshotSchema: v.GenericSchema<LogbookSnapshot> = v.object({
  settings: LogbookSettingsSchema,
  equipmentProfiles: v.array(EquipmentProfileSchema),
  exerciseDefinitions: v.array(CustomExerciseSchema),
  activeWorkout: v.nullable(WorkoutSessionSchema),
  workouts: v.array(WorkoutSessionSchema),
});

const BackupSchema: v.GenericSchema<TrainingLogbookBackup> = v.object({
  // The format identifier is checked twice: here and in `EnvelopeSchema` below.
  // Only the envelope's check can ever fail at runtime, because `readBackup` runs
  // it first -- but relaxing this one to `v.string()` is a compile error, since
  // `GenericSchema<TrainingLogbookBackup>` demands the literal type. Neither is
  // redundant with the other; one guards the file and one guards the code.
  format: v.literal(BACKUP_FORMAT),
  schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
  exportedAt: v.pipe(v.string(), v.minLength(1)),
  applicationVersion: v.string(),
  data: SnapshotSchema,
});

/** What a backup is being written as. */
export interface BackupOptions {
  readonly exportedAt: Instant;
  readonly applicationVersion: string;
}

/** Wraps a snapshot in the envelope. */
export function createBackup(
  snapshot: LogbookSnapshot,
  options: BackupOptions,
): TrainingLogbookBackup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: options.exportedAt,
    applicationVersion: options.applicationVersion,
    data: snapshot,
  };
}

/**
 * The suggested filename for a backup taken on a given calendar day.
 *
 * The day, not the instant. A lifter with three backups in their downloads folder
 * is looking for "the one from Tuesday", and a filename carrying a time to the
 * millisecond answers a question nobody asked while making the useful part harder
 * to read.
 */
export function backupFilename(localDate: string): string {
  return `${BACKUP_FORMAT}-${localDate}.json`;
}

/** Why a file could not be restored. */
export type RestoreProblemCode =
  /** Larger than {@link MAX_BACKUP_BYTES}. Rejected before it is parsed. */
  | 'too-large'
  /** Not JSON at all. */
  | 'not-json'
  /** JSON, but not this tool's backup: the format identifier is absent or different. */
  | 'not-a-backup'
  /** A backup from a newer build. Nothing here can know what its fields mean. */
  | 'newer-schema-version'
  /** The right format and a shape that does not match it. */
  | 'invalid-data';

export interface RestoreProblem {
  readonly code: RestoreProblemCode;
  /**
   * Where in the document the trouble is, as dotted path segments.
   *
   * Present only for `invalid-data`, and deliberately a *path* rather than the
   * value found there. A lifter's own training numbers are not secret from them,
   * but an error string is the kind of thing that gets pasted into a bug report,
   * and section 2.3's rule about not logging personal data is easier to keep when
   * the diagnostic has nowhere to put any.
   */
  readonly path: string | null;
}

export type RestoreResult =
  | { readonly ok: true; readonly backup: TrainingLogbookBackup; readonly migrated: boolean }
  | { readonly ok: false; readonly problems: readonly RestoreProblem[] };

/**
 * Brings an older envelope up to the current one.
 *
 * There is one version, so today this only reports whether anything was done. The
 * function exists anyway, and it exists now rather than later: section 19.2 asks
 * for migrations where practical, and the practical moment to build the seam is
 * before there is a second version to squeeze it around.
 */
function migrate(backup: TrainingLogbookBackup): {
  readonly backup: TrainingLogbookBackup;
  readonly migrated: boolean;
} {
  return { backup, migrated: backup.schemaVersion !== BACKUP_SCHEMA_VERSION };
}

function problemsFrom(issues: readonly v.BaseIssue<unknown>[]): readonly RestoreProblem[] {
  return issues.map((issue) => ({
    code: 'invalid-data' as const,
    path: issue.path?.map((segment) => String(segment.key)).join('.') ?? null,
  }));
}

/**
 * Reads a backup file's text. Steps 1 to 5 of section 10.7.
 *
 * The byte count is the caller's, because a `File` knows its own size and this
 * function only has a string -- and `text.length` is UTF-16 code units, which
 * undercounts a file full of non-Latin exercise names by up to a factor of three.
 * Passing the real size in keeps the limit honest.
 */
export function readBackup(text: string, byteLength: number): RestoreResult {
  if (byteLength > MAX_BACKUP_BYTES) {
    return { ok: false, problems: [{ code: 'too-large', path: null }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parse error's message is not carried forward. It quotes the input, and
    // the input is a lifter's training history.
    return { ok: false, problems: [{ code: 'not-json', path: null }] };
  }

  // The format identifier is checked before the schema so that somebody else's
  // JSON produces "this is not a logbook backup" rather than forty complaints
  // about missing fields.
  if (!isBackupShaped(parsed)) {
    return { ok: false, problems: [{ code: 'not-a-backup', path: null }] };
  }
  if (parsed.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, problems: [{ code: 'newer-schema-version', path: null }] };
  }

  const result = v.safeParse(BackupSchema, parsed);
  if (!result.success) {
    return { ok: false, problems: problemsFrom(result.issues) };
  }
  const { backup, migrated } = migrate(result.output);
  return { ok: true, backup, migrated };
}

/** Enough of the envelope to tell whose file this is and how new it is. */
const EnvelopeSchema = v.object({
  format: v.literal(BACKUP_FORMAT),
  schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

function isBackupShaped(value: unknown): value is { readonly schemaVersion: number } {
  return v.safeParse(EnvelopeSchema, value).success;
}

/** What the confirmation screen shows before anything is replaced. Section 10.7 step 6. */
export interface BackupPreview {
  readonly exportedAt: Instant;
  readonly applicationVersion: string;
  readonly workoutCount: number;
  readonly completedWorkoutCount: number;
  readonly customExerciseCount: number;
  readonly equipmentProfileCount: number;
  readonly hasActiveWorkout: boolean;
  /** The span the file covers, or `null` where it holds no workouts. */
  readonly earliestDay: string | null;
  readonly latestDay: string | null;
}

/**
 * Summarises a validated backup so a person can recognise it before replacing
 * everything they have.
 *
 * The date range matters more than the counts. "Forty-one workouts" describes a
 * great many files; "March to August, ending last Tuesday" is the one a lifter can
 * tell apart from the backup they took a year ago and forgot about.
 */
export function backupPreview(backup: TrainingLogbookBackup): BackupPreview {
  const { data } = backup;
  const days = [...data.workouts]
    .map((workout) => workout.localDate)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  return {
    exportedAt: backup.exportedAt,
    applicationVersion: backup.applicationVersion,
    workoutCount: data.workouts.length,
    completedWorkoutCount: data.workouts.filter((workout) => workout.status === 'completed').length,
    customExerciseCount: data.exerciseDefinitions.length,
    equipmentProfileCount: data.equipmentProfiles.length,
    hasActiveWorkout: data.activeWorkout !== null,
    earliestDay: days[0] ?? null,
    latestDay: days[days.length - 1] ?? null,
  };
}

/**
 * Serialises a backup for download.
 *
 * Indented. The file is a lifter's only durable copy of their training, and the
 * one thing they may ever do with it besides restoring it is open it and look --
 * so a few kilobytes of whitespace buys a document a person can read.
 */
export function serializeBackup(backup: TrainingLogbookBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/**
 * The workouts of a backup as history rows, newest first.
 *
 * Sorted here rather than trusted from the file. A backup's array order is
 * whatever the database iterated, and a restore preview listing a lifter's
 * sessions in insertion order is a list they cannot check against their memory of
 * the last month.
 */
export function backupSummaries(backup: TrainingLogbookBackup): readonly WorkoutSummary[] {
  return backup.data.workouts.map(summarize).sort(byMostRecent);
}
