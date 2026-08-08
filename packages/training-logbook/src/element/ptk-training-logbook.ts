// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, as one element.
 *
 * Everything below it is a screen that renders what it is given and reports what was
 * pressed. This one owns the four things a screen must not: the repository, the clock,
 * the identifier generator, and which screen is showing. Section 12.4.
 *
 * WHY THE SCREENS DO NOT WRITE TO STORAGE
 *
 * Section 18.9 promises that a set showing **Saved on this device** is still there
 * after a refresh, a tab close, an app switch, a PWA restart, a service-worker update
 * and a route change. That is a promise about a write completing, so the thing that
 * makes it has to be the thing that awaits the write -- and it has to render the
 * result of the *stored* session rather than an optimistic local copy, or a failed
 * write leaves a ticked set on screen and nothing in the database. Every screen
 * therefore hands up a whole next session and gets the saved one back as a property.
 *
 * WHY THE HOST SUPPLIES THE REPOSITORY AND THE CLOCK
 *
 * Section 15's package shape. The public shell hands in IndexedDB; a test hands in the
 * memory store; another host hands in its own. Nothing in this package constructs
 * storage, which is also what stops it from constructing the *wrong* storage in a
 * partitioned iframe where IndexedDB exists and silently keeps nothing.
 *
 * THE THREE WRITES THAT ARE NOT A WORKOUT
 *
 * Restore, delete and the two downloads all act on the whole device rather than on one
 * session, and all four are reached from one heading on the home screen. Restore and
 * delete share a shape deliberately -- counts, a span, an offer to take a backup first,
 * then one press -- because a lifter arriving at either is answering the same question
 * about the same logbook, and the outcome of both is reported back on the home screen
 * rather than on the confirmation, which is gone by the time there is anything to say.
 */

import { convertWeight, formatWeight, type WeightUnit } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-segmented';
import '@platform-toolkit/ui/ptk-select';
import type { Choice } from '@platform-toolkit/ui/ptk-choice-group';
import {
  SEGMENTED_CHANGE_EVENT,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui/ptk-segmented';
import {
  SELECT_CHANGE_EVENT,
  type SelectChangeDetail,
  type SelectOption,
} from '@platform-toolkit/ui/ptk-select';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import {
  backupFilename,
  backupPreview,
  backupSummaries,
  readBackup,
  serializeBackup,
  type BackupPreview,
  type LogbookSnapshot,
  type RestoreProblem,
  type RestoreProblemCode,
  type TrainingLogbookBackup,
} from '../core/backup.js';
import { calendarDayOf } from '../core/calendar.js';
import {
  createCustomExercise,
  exerciseOptions,
  findCustomExercise,
  loadFor,
  updateCustomExercise,
} from '../core/catalog.js';
import { createProfile, findProfile, updateProfileEquipment } from '../core/equipment.js';
import { handoffLifts, workoutFromHandoff } from '../core/handoff.js';
import type { PreviousPerformance } from '../core/previous.js';
import type { ExerciseHistory } from '../core/records.js';
import {
  REST_STEP_SECONDS,
  adjustRest,
  clampRestSeconds,
  pauseRest,
  readAlerts,
  resetRest,
  restSecondsFor,
  resumeRest,
  retimeRest,
  startRestFor,
  withRestSecondsFor,
  type RestTimer,
} from '../core/rest.js';
import {
  rampExercise,
  rampLastExercise,
  workingPrescription,
  type RampOutcome,
} from '../core/warmup.js';
// Type-only, so nothing of the storage side reaches this module. The port and the
// key belong to the shell, which is the only thing that knows the browser has
// somewhere to leave a record; this element is handed a reader and asks it twice.
import type { HandoffSource } from '../handoff.js';
import {
  addExercise,
  addSet,
  createWorkout,
  duplicateSet,
  emptyPerformance,
  findSet,
  findWorkoutExercise,
  performance,
  removeSet,
  repeatWorkout,
  skipSet,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from '../core/session.js';
import { workoutDurationMillis, type WorkoutSummary } from '../core/summary.js';
// Type-only for the same reason the handoff import above is: the port is supplied.
import type { StorageDurability, StoragePersistence } from '../storage/persistence.js';
import { defaultSettings, type TrainingLogbookRepository } from '../storage/repository.js';
import type {
  CalendarDay,
  CustomExercise,
  EffortSetting,
  EquipmentProfile,
  EquipmentSnapshot,
  ExerciseOption,
  Instant,
  LogbookId,
  LogbookSettings,
  RestAlertSettings,
  WarmupHandoff,
  WorkoutExercise,
  WorkoutSession,
} from '../types.js';

import {
  BUILDER_NOTES,
  DELETE_NOTES,
  DETAIL_NOTES,
  DONE_NOTES,
  EDIT_NOTES,
  EFFORT_SETTING_LABELS,
  EFFORT_SETTING_NOTES,
  HANDOFF_NOTES,
  HOME_NOTES,
  PERSIST_NOTES,
  RECORDS_NOTES,
  RESTORE_NOTES,
  RESTORE_REFUSALS,
  REST_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  SCREEN_NOTES,
  UNIT_LABELS,
  formatDuration,
  type SaveState,
} from './copy.js';
import {
  EFFORT_SETTING_FIELD,
  REST_DURATION_FIELD,
  REST_LIFT_DURATION_FIELD,
  REST_SETTING_FIELD,
  UNIT_SETTING_FIELD,
  actionOf,
  fieldOf,
} from './dataset.js';
import { formatVolume } from './format.js';
import { markdownExport, markdownFilename } from './markdown.js';
import {
  BACKUP_EXPORTED_EVENT,
  BACKUP_RESTORED_EVENT,
  LOCAL_DATA_CLEARED_EVENT,
  SET_COMPLETED_EVENT,
  WORKOUT_COMPLETED_EVENT,
  WORKOUT_SAVED_EVENT,
  WORKOUT_STARTED_EVENT,
  type BackupExportedDetail,
  type BackupRestoredDetail,
  type LocalDataClearedDetail,
  type SetCompletedDetail,
  type WorkoutEventDetail,
} from './events.js';
import {
  SET_PLAN_EVENT,
  WORKOUT_CHANGED_EVENT,
  WORKOUT_FINISHED_EVENT,
  type SetPlanChange,
  type SetPlanChangedDetail,
  type WorkoutChangedDetail,
  type WorkoutFinishedDetail,
} from './ptk-active-workout.js';
import {
  PROFILE_APPLIED_EVENT,
  PROFILE_REMOVED_EVENT,
  PROFILE_SAVED_EVENT,
  RACK_CHANGED_EVENT,
  type ProfileIdDetail,
  type ProfileSavedDetail,
  type RackChangedDetail,
} from './ptk-equipment-library.js';
import { EXERCISE_HISTORY_EVENT, type ExerciseHistoryOpenDetail } from './ptk-exercise-history.js';
import {
  REST_ACTION_EVENT,
  REST_ALERTS_EVENT,
  type RestActionDetail,
  type RestAlertsDetail,
  type RestLift,
} from './ptk-rest-timer.js';
import {
  EXERCISE_REMOVED_EVENT,
  EXERCISE_SAVED_EVENT,
  type ExerciseIdDetail,
  type ExerciseSavedDetail,
} from './ptk-exercise-library.js';
import type { PlannedExercise } from './plan.js';
import { WORKOUT_PLANNED_EVENT, type WorkoutPlannedDetail } from './ptk-workout-builder.js';
import {
  WORKOUT_OPEN_EVENT,
  WORKOUT_REPEAT_EVENT,
  type WorkoutOpenDetail,
  type WorkoutRepeatDetail,
} from './ptk-workout-history.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const TRAINING_LOGBOOK_TAG = 'ptk-training-logbook';

/**
 * Which screen is showing.
 *
 * A union rather than a router. This tool is a handful of screens with one path between
 * them, and a URL per screen would put a lifter's session in their history -- a back
 * button that unwinds a workout is worse than one that leaves the page.
 *
 * `detail` and `records` are the two that are reached and left rather than passed
 * through, and neither is a route. They are also the two reachable while a session is
 * open: looking up what a lift was done for last month is a thing done mid-workout, and
 * the live session is untouched behind them.
 *
 * `records` is the only one with more than one way in -- section 5.5 opens it from the
 * logging screen and from a workout read back -- which is why {@link #recordsFrom}
 * exists. A Back button that guessed would drop a lifter out of a live session for
 * having looked something up.
 *
 * `restore` is the only one that cannot be reached by pressing a button alone. It needs
 * a file the browser has read and this package has validated, so {@link #pending} is
 * what puts it up and clearing that is what takes it down -- which is also why leaving
 * it by any route drops the parsed backup rather than keeping it for a second visit.
 */
type Screen =
  'home' | 'build' | 'active' | 'done' | 'detail' | 'records' | 'edit' | 'restore' | 'delete';

/**
 * What each screen is called to somebody who cannot see it changing.
 *
 * The name of the region a screen change moves focus to, so it is the first thing a
 * reader is told after a press that replaced everything below the rest timer -- which
 * is every press in {@link #onClick} that assigns {@link #screen}. Six of the nine are
 * the heading the screen already draws, taken from the same constant the screen takes
 * it from rather than written out again here; the other three have no heading of their
 * own and are in {@link SCREEN_NOTES}.
 *
 * Typed against the union so a tenth screen does not ship nameless.
 */
const SCREEN_NAMES: Readonly<Record<Screen, string>> = {
  home: SCREEN_NOTES.home,
  build: BUILDER_NOTES.heading,
  active: SCREEN_NOTES.active,
  done: DONE_NOTES.heading,
  // The generic fallbacks, not the workout's own title. The heading inside says which
  // workout; a region that renamed itself per session would be announced as a
  // different place every time a lifter opened one.
  detail: DETAIL_NOTES.heading,
  records: RECORDS_NOTES.heading,
  edit: SCREEN_NOTES.edit,
  restore: RESTORE_NOTES.heading,
  delete: DELETE_NOTES.heading,
};

/**
 * Which of the repository's three writes a session goes through.
 *
 * A name rather than the boolean this used to be, because two of the three now differ
 * in what they do to the active pointer and a third boolean argument at a call site
 * says nothing about which.
 */
type PersistKind = 'active' | 'finished' | 'past';

const START_ACTION = 'start-workout';
const RESUME_ACTION = 'resume-workout';
const CANCEL_PLAN_ACTION = 'cancel-plan';
const BACKUP_ACTION = 'backup';
const MARKDOWN_ACTION = 'markdown';
const RESTORE_PICK_ACTION = 'restore-pick';
const RESTORE_CONFIRM_ACTION = 'restore-confirm';
const PERSIST_ASK_ACTION = 'persist-ask';
const DELETE_PICK_ACTION = 'delete-pick';
const DELETE_CONFIRM_ACTION = 'delete-confirm';
const DELETE_CANCEL_ACTION = 'delete-cancel';
const RESTORE_CANCEL_ACTION = 'restore-cancel';
const HOME_ACTION = 'home';
const HANDOFF_START_ACTION = 'start-handoff';
const HANDOFF_DISCARD_ACTION = 'discard-handoff';
const RECORDS_BACK_ACTION = 'records-back';
const EDIT_ACTION = 'edit-workout';
const EDIT_DONE_ACTION = 'edit-done';

/** How many history rows the home screen reads. Section 17.2's budget, applied. */
const HISTORY_LIMIT = 20;

/**
 * How many of a backup's sessions the confirmation lists.
 *
 * Five, and the count under them says how many are not shown. A file can hold three
 * years, and a confirmation a lifter has to scroll past to reach the button that
 * replaces their training is a confirmation they stop reading.
 */
const RESTORE_PREVIEW_ROWS = 5;

/**
 * The one empty answer to "what was this lifted for last time".
 *
 * A shared instance and not a fresh `new Map()` per assignment, because Lit compares
 * state by identity: a new empty map written on each update is a change, which is a
 * re-render, which writes another one. That is not a slow render, it is a loop.
 */
const NO_PREVIOUS: ReadonlyMap<string, PreviousPerformance> = new Map();

const UNIT_CHOICES: readonly Choice[] = [
  { value: 'lb', label: UNIT_LABELS.lb },
  { value: 'kg', label: UNIT_LABELS.kg },
];

/** Off first, because section 7.10 makes it the default and it is the shortest answer. */
const EFFORT_CHOICES: readonly Choice[] = [
  { value: 'none', label: EFFORT_SETTING_LABELS.none },
  { value: 'rpe', label: EFFORT_SETTING_LABELS.rpe },
  { value: 'rir', label: EFFORT_SETTING_LABELS.rir },
];

/** On first, because the control is only reached by somebody looking for the timer. */
const REST_CHOICES: readonly Choice[] = [
  { value: 'on', label: REST_NOTES.settingOn },
  { value: 'off', label: REST_NOTES.settingOff },
];

/**
 * The rests a lifter is offered, in seconds.
 *
 * A picker and not a number box. Section 7.11 wants a duration, not a stopwatch to
 * configure, and every one of these is a rest somebody actually takes: a minute between
 * accessory sets, five between heavy singles. A free number field would put the whole
 * of `clampRestSeconds` in front of a lifter who wanted three minutes.
 */
const REST_PRESET_SECONDS: readonly number[] = [60, 90, 120, 150, 180, 240, 300];

/**
 * Those presets, plus whatever is actually stored if it is not one of them.
 *
 * A restored backup, or a per-exercise duration written by an earlier version, can hold
 * a number this list does not offer -- and `ptk-select` refuses a value it has no option
 * for, so the control would paint as unanswered while the timer ran on a duration
 * nothing on screen admitted to.
 */
function restDurationOptions(current: number): readonly SelectOption[] {
  const seconds = REST_PRESET_SECONDS.includes(current)
    ? REST_PRESET_SECONDS
    : [...REST_PRESET_SECONDS, current].sort((left, right) => left - right);
  return seconds.map((value) => ({ value: String(value), label: REST_NOTES.duration(value) }));
}

function isUnit(value: string): value is WeightUnit {
  return value === 'kg' || value === 'lb';
}

function isEffortSetting(value: string): value is EffortSetting {
  return Object.hasOwn(EFFORT_SETTING_LABELS, value);
}

/**
 * Stops an internal event at the tool boundary.
 *
 * The three events the screens send up carry a whole `WorkoutSession` -- every set of
 * every exercise, with the weights. They have to be `composed` or they would never
 * leave the screen's shadow root and this element would never hear them, and `composed`
 * means the default is that they keep going: past this host, up through the page, to
 * anything the embedding site has listening on `document`. Section 2.5 is explicit that
 * public framing grants the parent no access to application data, and section 12.5 that
 * the events a host may hear "must not transmit data" -- so the boundary has to be
 * enforced by the element that is the boundary. What leaves here instead is
 * `events.ts`: seven events carrying identifiers and counts.
 *
 * Stopping propagation and not immediate propagation, so a consumer that deliberately
 * listens on this element -- inside the boundary, having imported the constant -- still
 * hears it. What is cut off is everything above.
 */
function stopHere(event: Event): void {
  event.stopPropagation();
}

/**
 * Why a chosen file did not become a restore.
 *
 * The core's codes plus the one it cannot produce. `readBackup` is handed text, so it
 * has no way to report that the platform never produced any -- and widening
 * `RestoreProblemCode` to say so would put a caller's trouble inside a union that
 * `readBackup`'s own return type promises to cover.
 */
type RestoreRefusalCode = RestoreProblemCode | 'unreadable';

interface RestoreRefusal {
  readonly code: RestoreRefusalCode;
  readonly path: string | null;
}

/** A validated backup waiting for the press that replaces everything with it. */
interface PendingRestore {
  readonly backup: TrainingLogbookBackup;
  readonly preview: BackupPreview;
  readonly summaries: readonly WorkoutSummary[];
}

/**
 * One sentence per kind of trouble, not one per field.
 *
 * A file whose sets are all one version out produces an `invalid-data` problem for
 * every set in it, and a screen carrying four hundred identical sentences says less
 * than a screen carrying one. The first path of each kind is what is kept, because the
 * path is the only part that differs between two problems of the same code and it is
 * the only part a person can do anything with.
 */
function distinctRefusals(problems: readonly RestoreProblem[]): readonly RestoreRefusal[] {
  const byCode = new Map<RestoreRefusalCode, RestoreRefusal>();
  for (const problem of problems) {
    if (!byCode.has(problem.code)) byCode.set(problem.code, problem);
  }
  return [...byCode.values()];
}

/**
 * Whether what came back out of storage is the file that went into it. Section 10.7's
 * ninth step.
 *
 * Counts, and not a field-by-field comparison. What a mismatch here means is that some
 * of the writes landed and some did not, and that shows up in a count; walking a year
 * of training twice to say the same thing would cost more than the restore did.
 *
 * The settings are the exception, because a store of exactly one record has no count
 * to compare -- so a few of its fields stand in for it. They are the ones a lifter
 * would notice within a minute of the restore, which is the point: a settings row that
 * silently did not land is the failure this step exists to catch.
 *
 * The three alert flags are here because of #119, where they *were* the settings row
 * not landing: the restore schema stripped them and this step compared two fields that
 * both survived, so the read-back agreed with a file it had just half-applied.
 */
function sameShape(written: LogbookSnapshot, file: LogbookSnapshot): boolean {
  return (
    written.workouts.length === file.workouts.length &&
    written.exerciseDefinitions.length === file.exerciseDefinitions.length &&
    written.equipmentProfiles.length === file.equipmentProfiles.length &&
    (written.activeWorkout === null) === (file.activeWorkout === null) &&
    written.settings.displayUnit === file.settings.displayUnit &&
    written.settings.effort === file.settings.effort &&
    sameAlerts(written.settings.restTimer.alerts, readAlerts(file.settings.restTimer.alerts))
  );
}

/**
 * Whether a read-back after a delete shows a device with nothing on it.
 *
 * Deliberately not `sameShape` against a freshly-built empty snapshot. That would
 * compare the settings too, and a settings record reset to its defaults is
 * indistinguishable from one that was never cleared on a device whose lifter never
 * changed a setting -- so the check would pass on exactly the store where it had the
 * least to go on. What is asserted here is only what section 10.8 promises was removed.
 */
function nothingLeft(written: LogbookSnapshot): boolean {
  return (
    written.workouts.length === 0 &&
    written.exerciseDefinitions.length === 0 &&
    written.equipmentProfiles.length === 0 &&
    written.activeWorkout === null
  );
}

/**
 * Whether these are the three alert flags the settings already hold.
 *
 * A function rather than the conjunction written inline, because inline it cannot be
 * spelled in a way both lint rules accept: `current !== undefined && current.sound
 * === …` is rewritten by `prefer-optional-chain`, and the `current?.sound` form it
 * asks for then trips `no-unnecessary-condition` on the second and third reads, the
 * first `?.` having already narrowed. Neither rule is wrong; they simply disagree.
 *
 * Absent counts as all-off, which is `readAlerts`' decision in `repository.ts` rather
 * than a second one made here -- so an all-off answer against a record with no key
 * correctly writes nothing.
 */
function sameAlerts(current: RestAlertSettings | undefined, next: RestAlertSettings): boolean {
  return (
    (current?.sound ?? false) === next.sound &&
    (current?.vibrate ?? false) === next.vibrate &&
    (current?.notify ?? false) === next.notify
  );
}

export class PtkTrainingLogbook extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
      color: var(--ptk-color-text);
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
    }

    /*
     * The same clip rectangle ptk-rest-timer uses, and for the same reason:
     * display: none would take the text out of the accessibility tree along with
     * the pixels, and the text is the entire point. SCREEN_NOTES says why the
     * title is drawn at all when the hosting page draws one too.
     *
     * No backticks in here: a CSS comment is still inside the tagged template,
     * and one quoted identifier ends it 40 lines before the parser notices.
     */
    .spoken {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .section + .section {
      margin-top: var(--ptk-space-lg);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
    }

    .actions ptk-button {
      max-width: 100%;
    }

    /*
     * The storage line sits above everything, not in a footer. It is the one sentence
     * on this screen a lifter has to read before they trust the tool with a year of
     * training, and a footer is where a sentence goes to be missed.
     */
    .save {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .save.warn {
      color: var(--ptk-color-text);
    }

    .settings {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .offer ul {
      list-style: none;
      margin: 0 0 var(--ptk-space-sm);
      padding: 0;
    }

    /*
     * Name and numbers on one line where there is room and two where there is
     * not. A lift the lifter named is as long as they made it, and this is the
     * one list on the home screen whose text comes from another tool.
     */
    .offer li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--ptk-space-xs) var(--ptk-space-md);
      padding: var(--ptk-space-xs) 0;
      border-top: 1px solid var(--ptk-color-border);
      overflow-wrap: anywhere;
    }

    .offer .volume {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * A refusal is the answer to a press, not a footnote under one, so it is drawn at
     * full text colour while the notes around it stay muted. Colour is not the only
     * signal -- every one of these sentences says what happened in words -- but a
     * muted one under a muted paragraph is a sentence a lifter scrolls past.
     */
    .note.trouble {
      color: var(--ptk-color-text);
    }

    /*
     * The native file input is replaced by a button that presses it. Clipped rather
     * than display: none, because a display-none input cannot be opened by a script in
     * Safari and opening the picker is the whole job of the button beside it.
     */
    input[type='file'] {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    /* Two screens, one layout. The grid of counts is the same grid, and a second
       copy of these rules under another name is the drift they exist to prevent. */
    .restore h3 {
      margin: var(--ptk-space-md) 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    /*
     * Term over value rather than beside it. At 320px a label as long as "Your own
     * exercises" and a figure on the same row leave the figure hanging on its own
     * line anyway, and a grid of narrow columns puts the two together whatever the
     * label is.
     */
    .restore .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: var(--ptk-space-sm);
      margin: var(--ptk-space-sm) 0;
    }

    .restore .facts dt {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .restore .facts dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .restore .sessions {
      list-style: none;
      margin: 0 0 var(--ptk-space-sm);
      padding: 0;
    }

    .restore .sessions li {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--ptk-space-xs) var(--ptk-space-md);
      padding: var(--ptk-space-xs) 0;
      border-top: 1px solid var(--ptk-color-border);
      overflow-wrap: anywhere;
    }

    /* The day never wraps mid-string: "2026-08-" on one line is not a date. */
    .restore .sessions .day {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      white-space: nowrap;
    }
  `;

  /**
   * Where the training lives. Supplied, never constructed here.
   *
   * `null` renders the screens against nothing rather than throwing, because an
   * element upgraded before its host has finished wiring is ordinary and not an error.
   */
  @property({ attribute: false }) repository: TrainingLogbookRepository | null = null;

  /**
   * The lifter's own calendar day, in their own time zone.
   *
   * A property because the host knows the zone and this package must not read a clock.
   * It builds the value from `getFullYear`/`getMonth`/`getDate` -- never `toISOString`,
   * which is UTC and gives yesterday to everyone west of Greenwich in the evening.
   *
   * Left unset it is the empty string, which is not a calendar day at all, and nothing
   * downstream refuses one: `CalendarDay` is structurally a string, so an unset host
   * silently dated every workout `''` and named every export file after nothing. Read
   * it through {@link #day} rather than directly -- that resolves the empty case
   * against `now`, which already defaults, so a consumer who mounts this element and
   * wires nothing else gets the right day instead of a corrupt one.
   */
  @property({ attribute: false }) today: CalendarDay = '';

  /** The current instant, supplied for the same reason as {@link today}. */
  @property({ attribute: false }) now: () => Instant = () => new Date().toISOString();

  /** A fresh opaque identifier. Overridable so a test can make them predictable. */
  @property({ attribute: false }) nextId: () => LogbookId = () => crypto.randomUUID();

  /**
   * Set when the surrounding page already names this tool in a heading of its own.
   *
   * The element draws a clipped `<h1>` so that a reader landing in a bare frame is
   * told what they have landed in. On a page that has its own visible `<h1>` saying
   * the same words, that is the outline saying it twice. The host is the only side
   * that can know which it is, so it says, the same way it says the day and the
   * clock.
   *
   * Unset is the safe answer and that is why it is the default: a consumer who mounts
   * this element and wires nothing gets a heading, and the failure mode of the wrong
   * default in the other direction is a document with no `<h1>` at all.
   */
  @property({ attribute: false }) pageTitled = false;

  /**
   * The day to file things under. Every write and every filename goes through here.
   *
   * Resolved on each read rather than defaulted once in the field initialiser, because
   * a field initialiser runs at construction: an element built at 23:59 would keep
   * yesterday for as long as the tab stayed open. `now` is a function for the same
   * reason and this borrows its answer, so the fallback costs no second clock read.
   */
  get #day(): CalendarDay {
    return this.today === '' ? calendarDayOf(this.now()) : this.today;
  }

  /** The build stamped into a backup file, for a human reading it later. */
  @property({ attribute: false }) applicationVersion = '0.0.0';

  /**
   * Where a session handed over by the warm-up calculator would be found.
   *
   * Supplied for the same reason the repository is: this package constructs no
   * storage. `null` is the ordinary answer on a page that has no sibling
   * calculator, in a frame whose storage is partitioned away from the one the
   * calculator wrote to, and in every story and test that does not care.
   */
  @property({ attribute: false }) handoff: HandoffSource | null = null;

  /**
   * How this browser is asked to keep what is written here. Section 10.3.
   *
   * Supplied and not reached for, like everything else that touches the platform,
   * and `null` is an ordinary answer rather than an error: a host with no Storage
   * API, a frame whose storage is partitioned away, and every story and test that
   * does not care all arrive here as `null`, and the offer simply is not drawn.
   *
   * Nothing on this element calls {@link StoragePersistence.request} except the
   * press that offers it. Section 10.3 makes the timing part of the requirement,
   * and it is a requirement with teeth: a browser asked on load by a visitor who
   * has logged nothing is a browser that says no and remembers.
   */
  @property({ attribute: false }) persistence: StoragePersistence | null = null;

  @state() private screen: Screen = 'home';

  /** The screen the last render drew, so {@link updated} can tell a change from a repaint. */
  #painted: Screen | null = null;
  @state() private settings: LogbookSettings = defaultSettings();
  @state() private active: WorkoutSession | null = null;
  @state() private finished: WorkoutSession | null = null;
  @state() private history: readonly WorkoutSummary[] = [];

  /** Whether the history could be read at all. See {@link #readHistory}. */
  @state() private historyUnreadable = false;
  @state() private exercises: readonly ExerciseOption[] = exerciseOptions([]);
  @state() private profiles: readonly EquipmentProfile[] = [];

  /** Whether the library could be read at all. See {@link #reloadProfiles}. */
  @state() private profilesUnreadable = false;

  /**
   * The lifter's own movements, as stored.
   *
   * Held alongside {@link exercises} rather than filtered back out of it. The options
   * list is a merge -- catalogue entries and customs mapped into one shape, sorted --
   * and picking the customs out of it again would mean either an `origin` test that
   * silently changes meaning if a third source is ever added, or a second mapping back
   * to a `CustomExercise` from an `ExerciseOption` that has already dropped the
   * timestamps. The library screen edits the stored rows, so it is handed those.
   */
  @state() private customs: readonly CustomExercise[] = [];

  /** Whether those could be read at all. See {@link #reloadExercises}. */
  @state() private exercisesUnreadable = false;

  /** Whether the last Repeat press failed to read its workout back. */
  @state() private repeatFailed = false;

  /**
   * The finished workout being read, or `null` where it could not be read back.
   *
   * A session and not a summary, and read on the press rather than held for every row
   * in the list. Section 17.2: twenty rows on the home screen are twenty summaries,
   * and the sets behind one of them are fetched when somebody asks to see them.
   *
   * `null` is also what an unreadable workout looks like, and the screen says so. The
   * alternative -- staying on the home screen with a note under the list -- makes a
   * press that reached storage and failed look like a press that missed the button.
   */
  @state() private opened: WorkoutSession | null = null;

  /**
   * The workout being corrected, or `null` when none is. Section 5.4's edit.
   *
   * A second field rather than editing {@link opened} in place, because the two answer
   * different questions and the difference decides where a write goes: `opened` is what
   * the detail screen is showing, and this is the session the logging screen's events
   * are about. It is also what tells `#onChanged` and `#onSetPlan` apart from the same
   * events fired by a live session -- both screens are the same element.
   *
   * Never `null` while the edit screen is up, which is why that screen needs no answer
   * for an unreadable workout: it is only reachable from a detail screen that has one.
   */
  @state() private editing: WorkoutSession | null = null;

  /**
   * The last write handed to the repository, chained so they land in the order they
   * were made and so `#leaveEditor` has something to wait for.
   */
  #writing: Promise<void> = Promise.resolve();

  /**
   * The exercise being read back, or `null` where it could not be read.
   *
   * The same three outcomes `opened` has, collapsed the same way and for the same
   * reason: a press that reached storage and failed must not look like a press that
   * missed the button.
   */
  /**
   * The rest the lifter is taking, or `null` for none. Section 7.11.
   *
   * Here rather than on the logging screen, because looking up what a lift went for
   * last month is a thing done mid-rest -- section 5.5 puts a History button on the
   * logging screen for exactly that -- and a timer owned by the screen would be
   * destroyed by the trip. It is deliberately **not** persisted: a rest is thirty
   * seconds to five minutes long and a session read back tomorrow with a countdown
   * still on it would be describing a rest that ended yesterday.
   */
  @state() private rest: RestTimer | null = null;

  /**
   * Which lift the rest above is for, so its length can be chosen from the band.
   *
   * Separate from the timer rather than a field on it, because `core/rest.ts` is
   * arithmetic about time and a lift's name is neither. It is also not cleared when a
   * rest ends: `#restLift` reads it only alongside a timer, so a leftover is invisible,
   * and `#startRest` is the one place that writes it.
   */
  @state() private restExercise: { readonly id: string; readonly name: string } | null = null;

  @state() private records: ExerciseHistory | null = null;

  /**
   * Which screen the history was opened from, so Back goes there.
   *
   * Section 5.5 gives it two ways in and one of them is a live session. Sending Back
   * to the home screen would end a lifter's set-by-set place in a workout as the price
   * of checking what they lifted last month, which is the one thing this screen must
   * not cost them. Held rather than derived, because by the time Back is pressed the
   * screen it came from is no longer the screen that is up.
   */
  @state() private recordsFrom: Screen = 'home';

  /** `null` until the first read has told us whether this browser stores anything. */
  @state() private saveState: SaveState | null = null;

  /** Set after a file is handed to the browser, so nobody presses it twice. */
  @state() private backupDone = false;

  /**
   * The same, for the readable copy. Section 10.5.
   *
   * A second flag rather than one shared with {@link backupDone}, because the two
   * buttons produce two different files and a lifter who has taken the readable one
   * and not the backup is in the state the note beside it warns about. One flag would
   * tell them they had a backup.
   */
  @state() private markdownDone = false;

  /**
   * The backup a lifter chose and this build could read, waiting to be confirmed.
   *
   * `null` on every screen but `restore`, and the two move together: this is what puts
   * that screen up, and clearing it is what takes it down. Held rather than re-read on
   * the press, because the file the picker handed over is gone by then -- and re-asking
   * for it would mean a second dialog between "yes, replace everything" and the write.
   */
  @state() private pending: PendingRestore | null = null;

  /** Why the last chosen file was not read. Empty when there was no trouble. */
  @state() private refusals: readonly RestoreRefusal[] = [];

  /** Set after a restore landed and was read back, for {@link backupDone}'s reason. */
  @state() private restoreDone = false;

  /**
   * How a restore went wrong, or `null` where none did.
   *
   * Two values and not one, because they are two different states of the database and
   * a lifter has to do different things about them. `write` is nothing lost; `verify`
   * is a logbook that holds neither the old training nor the new whole.
   */
  @state() private restoreProblem: 'write' | 'verify' | null = null;

  /**
   * What is on the device, counted, waiting for the press that destroys it.
   *
   * `null` on every screen but `delete`, the same way {@link pending} pairs with
   * `restore`. It is a `BackupPreview` because that is what the count of everything
   * here already is -- reading it off `exportSnapshot()` means the numbers on the
   * confirmation are the numbers a backup taken at that moment would hold, rather than
   * a second tally maintained beside them that can disagree.
   */
  @state() private deletion: BackupPreview | null = null;

  /** Set once a delete landed and the database was read back empty. */
  @state() private deleteDone = false;

  /**
   * How a delete went wrong, or `null` where none did.
   *
   * The same two-value shape as {@link restoreProblem} and for the same reason, with
   * the stakes the other way round: `write` is everything still here, and `verify` is
   * some of it gone and nothing able to say which.
   */
  @state() private deleteProblem: 'write' | 'verify' | null = null;

  /**
   * What this browser last said about keeping the data. Section 10.3.
   *
   * `'unknown'` until the port answers, and `'unknown'` for good where there is no
   * port -- which is why it is the initial value rather than a `null` meaning not yet
   * read. A screen has the same nothing to offer in both cases.
   */
  @state() private durability: StorageDurability = 'unknown';

  /**
   * Whether the lifter has pressed the ask and the browser has answered.
   *
   * Needed because {@link durability} cannot tell the two `'best-effort'` cases
   * apart, and they say different things: one is a device nobody has asked about
   * yet, and the other is a device whose browser has just declined. Without this,
   * the press would produce a screen identical to the one before it and read as a
   * button that does nothing.
   */
  @state() private persistAsked = false;

  /** The record waiting to be offered, or `null` when there is nothing to offer. */
  @state() private offer: WarmupHandoff | null = null;

  /**
   * Lifts that landed from a handoff with no ramp under them.
   *
   * Deliberately not kept anywhere. It describes one landing, and a note about
   * what a press did an hour ago, still on screen after a reload, would read as a
   * claim about the session rather than a report of what happened.
   */
  @state() private unramped: readonly string[] = [];

  /**
   * What the lifts in the live session were last done for. Section 7.8.
   *
   * Empty until the read finishes, and empty is a complete state rather than a
   * loading one: an exercise with no history renders nothing either way, so there is
   * no moment where the screen shows a placeholder for a line that will never come.
   */
  @state() private previous: ReadonlyMap<string, PreviousPerformance> = NO_PREVIOUS;

  /**
   * The session the {@link previous} map was read for, as id plus exercise ids.
   *
   * A string and not the session object, because `active` is replaced whole on every
   * tick of every set -- identity would re-read the entire history each time a lifter
   * pressed Done, which is section 9.3's read on a render path wearing a different
   * hat. What actually changes the answer is which exercises are in the session, and
   * that is what this compares. `null` before the first read.
   */
  #previousKey: string | null = null;

  /**
   * How many writes have landed, so a read can tell whether it is still the answer.
   *
   * The other half of {@link #reload}'s guard, and {@link #previousKey}'s shape rather
   * than a second pattern: a value captured before the await and compared after it,
   * because the field the read is about is one nothing in `PropertyValues<this>` can
   * name.
   *
   * Bumped by {@link #persist} and {@link #saveSettings} and by nothing else, which is
   * the whole of the discipline. Those two are the only paths that change what a reload
   * reads, and both are called synchronously by the handler that has just assigned the
   * newer state -- so the bump lands in the same task as the assignment it stands for.
   * Bumping at each of the six `this.active =` sites instead would put the rule in six
   * places for one guard to depend on.
   *
   * Reads do not bump it. A second reload landing over a first assigns the same three
   * answers out of the same database, so racing them would buy a branch no test can
   * tell apart -- and a reload that superseded itself would need exempting from its own
   * check.
   *
   * What it costs, and the cost is the right way round: a write landing inside a
   * reload's window discards a history that write does not itself rebuild, so the list
   * can be one press stale until the next reload. The session and the settings in
   * memory are always the newer of the two, a finished workout rebuilds the list
   * through {@link #refreshHistory} anyway, and the alternative is #95 -- a lifter's
   * session overwritten by an answer read before they started it.
   */
  #generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.addEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.addEventListener(SET_PLAN_EVENT, this.#onSetPlan);
    this.addEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSetting);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onSelectSetting);
    this.addEventListener(REST_ACTION_EVENT, this.#onRestAction);
    this.addEventListener(REST_ALERTS_EVENT, this.#onRestAlerts);
    this.addEventListener(RACK_CHANGED_EVENT, this.#onRack);
    this.addEventListener(PROFILE_SAVED_EVENT, this.#onProfileSaved);
    this.addEventListener(PROFILE_APPLIED_EVENT, this.#onProfileApplied);
    this.addEventListener(PROFILE_REMOVED_EVENT, this.#onProfileRemoved);
    this.addEventListener(EXERCISE_SAVED_EVENT, this.#onExerciseSaved);
    this.addEventListener(EXERCISE_REMOVED_EVENT, this.#onExerciseRemoved);
    this.addEventListener(WORKOUT_REPEAT_EVENT, this.#onRepeat);
    this.addEventListener(WORKOUT_OPEN_EVENT, this.#onOpen);
    this.addEventListener(EXERCISE_HISTORY_EVENT, this.#onExerciseHistory);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.removeEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.removeEventListener(SET_PLAN_EVENT, this.#onSetPlan);
    this.removeEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSetting);
    this.removeEventListener(SELECT_CHANGE_EVENT, this.#onSelectSetting);
    this.removeEventListener(REST_ACTION_EVENT, this.#onRestAction);
    this.removeEventListener(REST_ALERTS_EVENT, this.#onRestAlerts);
    this.removeEventListener(RACK_CHANGED_EVENT, this.#onRack);
    this.removeEventListener(PROFILE_SAVED_EVENT, this.#onProfileSaved);
    this.removeEventListener(PROFILE_APPLIED_EVENT, this.#onProfileApplied);
    this.removeEventListener(PROFILE_REMOVED_EVENT, this.#onProfileRemoved);
    this.removeEventListener(EXERCISE_SAVED_EVENT, this.#onExerciseSaved);
    this.removeEventListener(EXERCISE_REMOVED_EVENT, this.#onExerciseRemoved);
    this.removeEventListener(WORKOUT_OPEN_EVENT, this.#onOpen);
    this.removeEventListener(WORKOUT_REPEAT_EVENT, this.#onRepeat);
    this.removeEventListener(EXERCISE_HISTORY_EVENT, this.#onExerciseHistory);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Reloading on the property rather than in `firstUpdated`, because a host that
    // wires the repository a tick after upgrade is the ordinary case and a one-shot
    // read would leave that host on an empty logbook forever.
    if (changed.has('repository')) void this.#reload();
    // Read once, when the reader arrives, and never during a render. `peek` goes
    // to storage and parses a document, and a render path that did that would do
    // it on every keystroke of a session -- and would answer differently halfway
    // through one, because another tab can write the key at any time.
    if (changed.has('handoff')) this.#readHandoff();
    // A read and never an ask. `durability` raises no prompt and grants nothing --
    // section 10.3's request happens on a press, and calling it here is the one
    // mistake in this feature that cannot be undone, because a browser that refuses
    // an unengaged visitor may not offer to be asked again.
    if (changed.has('persistence')) void this.#readDurability();
    // Unconditional, because `changed` is keyed by the public properties and the
    // session lives in private state it cannot name. The guard is inside instead,
    // and it is a better one than a dirty check would be: `active` is replaced whole
    // on every tick of every set, so watching it would re-read the history on each
    // one anyway.
    void this.#reloadPrevious();
  }

  /**
   * Reads what the live session's lifts were last done for, at most once per session.
   *
   * Behind its own catch for `#reloadProfiles`' reason: this walks the whole history
   * and section 7.8's line is the one thing on the screen a lifter can do without.
   * A record from an older build that no longer parses would otherwise take the
   * session they are in the middle of with it.
   */
  async #reloadPrevious(): Promise<void> {
    const repository = this.repository;
    const session = this.active;
    if (repository === null || session === null) {
      this.#previousKey = null;
      this.previous = NO_PREVIOUS;
      return;
    }

    const ids = session.exercises.map((exercise) => exercise.exerciseId);
    // The id is in the key as well as the exercises, so that starting a second
    // session with the same lifts in it still re-reads -- the first session is by
    // then part of the history and is the answer.
    const key = [session.id, ...ids].join('\n');
    if (key === this.#previousKey) return;
    this.#previousKey = key;

    try {
      this.previous = await repository.lastPerformance(ids);
    } catch {
      this.previous = NO_PREVIOUS;
    }
  }

  /**
   * Asks the reader what is waiting, and decides whether it is worth offering.
   *
   * A record naming nothing this build's catalogue knows is dropped here rather
   * than drawn as an empty card. It is also *forgotten* rather than left: the
   * lifter cannot act on it, and a record that is refused silently on every visit
   * is a key that never clears itself until it expires.
   */
  #readHandoff(): void {
    const source = this.handoff;
    this.offer = null;
    if (source === null) return;

    const record = source.peek();
    if (record === null) return;
    if (handoffLifts(record).length === 0) {
      source.clear();
      return;
    }
    this.offer = record;
  }

  /** Waits for the screens as well as for this element. Section 5.8. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.renderRoot.querySelectorAll('*');
    await Promise.all(
      [...children].filter((node) => node instanceof LitElement).map((node) => node.updateComplete),
    );
    return done;
  }

  /**
   * The title, the rest timer, the storage line, then whichever screen is showing.
   *
   * The timer is above the switch and not inside one of the cases, which is the whole
   * point: it outlives a change of screen. A lifter who taps History between sets comes
   * back to a rest that kept running, and one who finishes the session has no timer
   * because there is nothing left to rest for.
   *
   * The storage line is up here for a second reason. It says the same thing on every
   * screen and used to be drawn by each of them, which meant the live region announcing
   * it was destroyed and rebuilt on every press that changed screen -- and a region
   * built at the moment it has something to say is announced by about half the engines.
   * Drawn once, it is in the document from the first paint and survives every
   * transition below it. See {@link #saveLine}.
   *
   * The `<h1>` is clipped rather than absent. See {@link SCREEN_NOTES}. It is dropped
   * entirely on a page that draws its own -- see {@link pageTitled}.
   */
  override render(): TemplateResult {
    return html`
      ${this.pageTitled ? nothing : html`<h1 class="spoken">${SCREEN_NOTES.title}</h1>`}
      <ptk-rest-timer
        .timer=${this.rest}
        .now=${this.now}
        .lift=${this.#restLift()}
        .alerts=${this.settings.restTimer.alerts ?? null}
      ></ptk-rest-timer>
      ${this.#saveLine()}
      <section class="screen" tabindex="-1" aria-label=${SCREEN_NAMES[this.screen]}>
        ${this.#screen()}
      </section>
    `;
  }

  /**
   * A screen change lands focus on the screen it changed to.
   *
   * The gap this closes is the whole reason the rest of this file has any focus
   * handling in it: pressing Start replaced everything below the timer and left focus
   * on the button that had gone, which the platform resolves by dropping it on the
   * document. A keyboard is then at the top of the page and a reader has been told
   * nothing happened.
   *
   * The region and not a heading. Six of the nine screens draw their heading inside a
   * child's shadow root, so a parent that wanted to focus one would have to reach
   * through a boundary it does not own and guess which of the headings it found was the
   * screen's -- the rest timer has one too. The region is this element's own, it is
   * named for the screen in {@link SCREEN_NAMES}, and focusing it puts a reader at the
   * top of what just arrived rather than one heading into it.
   *
   * Only on a change, and never on the first paint -- a tool mounted into a page it
   * does not own must not steal focus from whatever the visitor was reading. The
   * previous screen is remembered here rather than read out of `changed`, because
   * `screen` is a private `@state` and `PropertyValues<this>` cannot name one; the
   * same reason `#reloadPrevious` keeps `#previousKey`.
   */
  protected override updated(): void {
    const painted = this.#painted;
    this.#painted = this.screen;
    if (painted === null || painted === this.screen) return;
    const region = this.renderRoot.querySelector('.screen');
    if (region instanceof HTMLElement) region.focus();
  }

  #screen(): TemplateResult {
    switch (this.screen) {
      case 'build':
        return this.#buildScreen();
      case 'active':
        return this.#activeScreen();
      case 'done':
        return this.#doneScreen();
      case 'detail':
        return this.#detailScreen();
      case 'records':
        return this.#recordsScreen();
      case 'edit':
        return this.#editScreen();
      case 'restore': {
        const pending = this.pending;
        // A narrowing guard and not a path a thumb can walk: the only writer of
        // `screen = 'restore'` sets `pending` in the same statement, and every way
        // off the screen clears both. It falls back to the home screen rather than
        // throwing, because the one thing worse than an unreachable branch is an
        // unreachable branch that takes the tool down if it is ever reached.
        return pending === null ? this.#homeScreen() : this.#restoreScreen(pending);
      }
      case 'delete': {
        const deletion = this.deletion;
        // The same narrowing guard as `restore` above, for the same reason and with
        // the same fallback.
        return deletion === null ? this.#homeScreen() : this.#deleteScreen(deletion);
      }
      case 'home':
        return this.#homeScreen();
    }
  }

  #homeScreen(): TemplateResult {
    return html`
      ${this.#handoffCard()}
      <section class="section">
        <p class="note">${HOME_NOTES.intro}</p>
        <p class="note">${HOME_NOTES.localOnly}</p>
        ${
          this.active === null
            ? html`<div class="actions">
                <ptk-button variant="primary" data-action=${START_ACTION}
                  >${HOME_NOTES.start}</ptk-button
                >
              </div>`
            : html`
                <p class="note">${HOME_NOTES.resumeNote}</p>
                <div class="actions">
                  <ptk-button variant="primary" data-action=${RESUME_ACTION}
                    >${HOME_NOTES.resume}</ptk-button
                  >
                </div>
              `
        }
      </section>

      <section class="section">
        ${
          // The list is withdrawn rather than drawn empty, which is the two libraries'
          // shape and is here for the records screen's reason: `historyEmpty` tells a
          // lifter their finished workouts will be listed here, and under a walk that
          // failed that is a claim about a database nothing has managed to read. The
          // heading is drawn in its place because `ptk-workout-history` owns the one
          // this section normally has, and a section that loses its heading when it has
          // bad news to give is a section a reader arrives in the middle of.
          this.historyUnreadable
            ? html`<h2>${HOME_NOTES.historyHeading}</h2>`
            : html`<ptk-workout-history
                .workouts=${this.history}
                ?busy=${this.active !== null}
              ></ptk-workout-history>`
        }
        <div class="unreadable" role="status">
          ${
            this.historyUnreadable
              ? html`<p class="note trouble">${HOME_NOTES.historyUnreadable}</p>`
              : nothing
          }
        </div>
        <div class="outcome" role="alert">
          ${this.repeatFailed ? html`<p class="note">${HOME_NOTES.repeatFailed}</p>` : nothing}
        </div>
      </section>

      <section class="section">
        <ptk-equipment-library
          .equipment=${this.settings.equipment}
          .profiles=${this.profiles}
          ?unreadable=${this.profilesUnreadable}
          ?remembers=${this.repository?.durable ?? true}
        ></ptk-equipment-library>
      </section>

      <section class="section">
        <ptk-exercise-library
          .exercises=${this.customs}
          ?unreadable=${this.exercisesUnreadable}
        ></ptk-exercise-library>
      </section>

      <section class="section settings">
        <h2>${HOME_NOTES.settingsHeading}</h2>
        <div data-field=${UNIT_SETTING_FIELD}>
          <ptk-segmented
            label=${HOME_NOTES.unitLabel}
            .choices=${UNIT_CHOICES}
            .value=${this.settings.displayUnit}
          ></ptk-segmented>
        </div>
        <p class="note">${HOME_NOTES.unitNote}</p>
        <div data-field=${EFFORT_SETTING_FIELD}>
          <ptk-segmented
            label=${HOME_NOTES.effortLabel}
            .choices=${EFFORT_CHOICES}
            .value=${this.settings.effort}
          ></ptk-segmented>
        </div>
        ${
          // The chosen scale explained rather than all three listed. Section 17: the
          // terms are explained where they are needed, and a lifter who has picked
          // one does not need the other two argued at them.
          html`<p class="note">${EFFORT_SETTING_NOTES[this.settings.effort]}</p>`
        }
        <p class="note">${HOME_NOTES.effortNote}</p>
        <div data-field=${REST_SETTING_FIELD}>
          <ptk-segmented
            label=${REST_NOTES.settingLabel}
            .choices=${REST_CHOICES}
            .value=${this.settings.restTimer.enabled ? 'on' : 'off'}
          ></ptk-segmented>
        </div>
        <p class="note">${REST_NOTES.settingNote}</p>
        ${
          // The duration only where the timer is on. Section 0.4 forbids a disabled
          // control standing in for a feature, and a picker that changes nothing is
          // the same thing with a different excuse.
          this.settings.restTimer.enabled
            ? html`<div data-field=${REST_DURATION_FIELD}>
                <ptk-select
                  label=${REST_NOTES.durationLabel}
                  .options=${restDurationOptions(clampRestSeconds(this.settings.restTimer.defaultSeconds))}
                  .value=${String(clampRestSeconds(this.settings.restTimer.defaultSeconds))}
                ></ptk-select>
              </div>`
            : nothing
        }
      </section>

      ${this.#keepSection()}

      <section class="section">
        <h2>${HOME_NOTES.backupHeading}</h2>
        <p class="note">${HOME_NOTES.backupNote}</p>
        <div class="actions">
          <ptk-button variant="secondary" data-action=${BACKUP_ACTION}
            >${HOME_NOTES.backup}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${MARKDOWN_ACTION}
            >${HOME_NOTES.markdown}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${RESTORE_PICK_ACTION}
            >${HOME_NOTES.restore}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${DELETE_PICK_ACTION}
            >${DELETE_NOTES.action}</ptk-button
          >
        </div>
        <div class="outcome" role="status">
          ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
          ${this.markdownDone ? html`<p class="note">${HOME_NOTES.markdownDone}</p>` : nothing}
        </div>
        <p class="note">${HOME_NOTES.markdownNote}</p>
        <p class="note">${HOME_NOTES.restoreNote}</p>
        <input
          type="file"
          accept="application/json,.json"
          aria-hidden="true"
          tabindex="-1"
          @change=${this.#onFileChosen}
        />
        ${this.#outcomes()}
      </section>
    `;
  }

  /**
   * Whether this device holds anything worth asking the browser to keep.
   *
   * All four of the things a delete removes, and not the workout count alone. Section
   * 10.3 asks for the request to come *after the tool has demonstrated value*, and a
   * lifter who has entered four gyms and two movements of their own before their first
   * session has done the work this feature exists to protect -- offering them nothing
   * until they finish a workout would leave the setup evictable for exactly as long as
   * it is the only thing on the device.
   *
   * The history list is capped, so this reads "at least one" and never a total. That is
   * all the question needs.
   *
   * `active` was the one conjunct with no test, on the grounds that a session in
   * progress was in `history` anyway and mutating the conjunct away left the suite
   * green. The note ended by saying that filtering the history list was a change one
   * task away and would silently take the offer off the device of somebody in the
   * middle of their first workout. #97 made that change, so this conjunct is now the
   * whole of the offer for that device rather than a fourth way to say what `history`
   * already said, and the browser suite covers it.
   */
  #hasSomethingToKeep(): boolean {
    return (
      this.history.length > 0 ||
      this.active !== null ||
      this.customs.length > 0 ||
      this.profiles.length > 0
    );
  }

  /**
   * The offer to have this browser keep the logbook. Section 10.3.
   *
   * Drawn nowhere else and drawn conditionally, which is the whole of 10.3's timing
   * requirement expressed as structure rather than as a comment somebody can edit
   * around: no device content, no section; no port or a port that knows nothing, no
   * section. Section 0.4 forbids a disabled control standing in for a feature, and a
   * greyed-out ask on a browser with no Storage API would be exactly that.
   *
   * The last sentence is outside every branch on purpose -- see {@link PERSIST_NOTES}.
   * The lifter who most needs to hear that a backup is the only copy that outlives this
   * browser is the one who has just been told the browser agreed to keep it.
   */
  #keepSection(): TemplateResult | typeof nothing {
    if (!this.#hasSomethingToKeep()) return nothing;
    if (this.durability === 'unknown' && !this.persistAsked) return nothing;

    return html`
      <section class="section keep">
        <h2>${PERSIST_NOTES.heading}</h2>
        ${
          this.durability === 'persisted'
            ? html`<p class="note">${PERSIST_NOTES.persisted}</p>`
            : html`
                <p class="note">${PERSIST_NOTES.atRisk}</p>
                <div class="actions">
                  <ptk-button variant="secondary" data-action=${PERSIST_ASK_ACTION}
                    >${PERSIST_NOTES.action}</ptk-button
                  >
                </div>
                ${
                  // Only after a press. Before one, the sentence above already says what
                  // is true, and an answer printed without a question asked reads as a
                  // refusal the lifter never triggered.
                  this.persistAsked
                    ? html`<p class="note">
                        ${
                          this.durability === 'unknown'
                            ? PERSIST_NOTES.noAnswer
                            : PERSIST_NOTES.declined
                        }
                      </p>`
                    : nothing
                }
              `
        }
        <p class="note">${PERSIST_NOTES.stillClearable}</p>
      </section>
    `;
  }

  /**
   * The confirmation. Section 10.8.
   *
   * Section 10.7's screen with a different write behind it, which is why it was built
   * second and why it borrows the shape rather than inventing one: counts, the span
   * they cover, an extra line where a workout is open, and the offer to take a backup
   * before pressing anything. A lifter arriving at either one is answering the same
   * question about the same logbook.
   *
   * Where it differs is the list. Restore shows the newest sessions in the *file*,
   * because recognising the file is the decision being made. There is no file here and
   * the sessions are the lifter's own, so a list would be a tool printing somebody's
   * training back at them under a heading asking whether to destroy it. The counts and
   * the span say what is here; naming it is what a backup is for, and the button for
   * that is on this screen.
   *
   * Delete is the primary. Section 0.4's argument holds -- the variant is never the
   * only signal -- so the sentence above the buttons is what carries the meaning, and
   * Keep it is worded as a thing to choose rather than as a way out.
   */
  #deleteScreen(deletion: BackupPreview): TemplateResult {
    return html`
      <section class="section restore erase">
        <h2>${DELETE_NOTES.heading}</h2>
        <p class="note trouble">${DELETE_NOTES.warning}</p>
        ${
          this.active === null
            ? nothing
            : html`<p class="note trouble">${DELETE_NOTES.activeWarning}</p>`
        }

        <dl class="facts">
          <div>
            <dt>${DELETE_NOTES.workoutsLabel}</dt>
            <dd>${deletion.workoutCount}</dd>
          </div>
          <div>
            <dt>${DELETE_NOTES.exercisesLabel}</dt>
            <dd>${deletion.customExerciseCount}</dd>
          </div>
          <div>
            <dt>${DELETE_NOTES.racksLabel}</dt>
            <dd>${deletion.equipmentProfileCount}</dd>
          </div>
          ${
            deletion.earliestDay === null || deletion.latestDay === null
              ? nothing
              : html`<div>
                  <dt>${DELETE_NOTES.spanLabel}</dt>
                  <dd>${DELETE_NOTES.span(deletion.earliestDay, deletion.latestDay)}</dd>
                </div>`
          }
        </dl>

        ${
          // Every count zero, rather than the workout count alone. A device with no
          // sessions but four saved gyms on it does have something to lose, and a
          // screen that said otherwise would be talking a lifter through a press that
          // throws away the setup work they did before their first session.
          deletion.workoutCount === 0 &&
          deletion.customExerciseCount === 0 &&
          deletion.equipmentProfileCount === 0
            ? html`<p class="note">${DELETE_NOTES.nothingHere}</p>`
            : nothing
        }

        <div class="actions">
          <ptk-button variant="primary" data-action=${DELETE_CONFIRM_ACTION}
            >${DELETE_NOTES.confirm}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${DELETE_CANCEL_ACTION}
            >${DELETE_NOTES.cancel}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${BACKUP_ACTION}
            >${DELETE_NOTES.backupFirst}</ptk-button
          >
        </div>
        <div class="outcome" role="status">
          ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
        </div>
      </section>
    `;
  }

  /**
   * What the last file the lifter chose did, and what the last delete did, said where
   * they were asked for.
   *
   * On the home screen and not on the one that has gone, because all of these are
   * reported after the screen that asked has been left -- a refused file never gets one
   * drawn at all, and a restore or a delete that landed is a thing that happened to
   * this screen. A delete that landed says so in one sentence: there is nothing left to
   * describe, and a count of what was destroyed would be the tool reciting a logbook
   * back to somebody who has just erased it.
   *
   * The two carry their own classes -- `landed` and `trouble` -- because three other
   * screens draw an `.outcome` region of their own for a backup they have just written,
   * and a selector that could not tell them apart would find four regions where a case
   * meant one.
   *
   * Two regions rather than one, both drawn empty when there is nothing in them, which
   * is what makes the refusals work: a file the browser read and this package would not
   * accept changes nothing but this paragraph, so the region holding it has to already
   * be in the document -- the same rule `ptk-rest-timer` follows.
   *
   * The split is by what it costs to miss the sentence. A restore or a delete that
   * landed is polite: the screen it lands on is the evidence, and it arrives with a
   * change of screen that has already moved focus. The other three interrupt, because
   * each of them means the lifter has to do something before they close the tab -- a
   * file that was refused, a write that did not go, and a delete whose read-back still
   * found training on the device. `alert` is also the one live role engines announce
   * reliably on insertion, which is what the two that do arrive with a screen change
   * need.
   */
  #outcomes(): TemplateResult {
    return html`
      <div class="outcome landed" role="status">
        ${this.restoreDone ? html`<p class="note">${RESTORE_NOTES.done}</p>` : nothing}
        ${this.deleteDone ? html`<p class="note">${DELETE_NOTES.done}</p>` : nothing}
      </div>
      <div class="outcome trouble" role="alert">
        ${this.refusals.map(
          (refusal) =>
            html`<p class="note trouble">
              ${RESTORE_REFUSALS[refusal.code]}${
                refusal.path === null ? nothing : html` ${RESTORE_NOTES.path(refusal.path)}`
              }
            </p>`,
        )}
        ${
          this.restoreProblem === null
            ? nothing
            : html`<p class="note trouble">
                ${
                  this.restoreProblem === 'write'
                    ? RESTORE_NOTES.writeProblem
                    : RESTORE_NOTES.verifyProblem
                }
              </p>`
        }
        ${
          this.deleteProblem === null
            ? nothing
            : html`<p class="note trouble">
                ${
                  this.deleteProblem === 'write' ? DELETE_NOTES.problem : DELETE_NOTES.verifyProblem
                }
              </p>`
        }
      </div>
    `;
  }

  /**
   * The confirmation. Section 10.7's sixth step, and the last moment before its
   * seventh.
   *
   * A screen and not a panel under the Backup heading, for the reason the detail
   * screen is a screen: what is being confirmed is a description of a whole logbook,
   * and a lifter should not have to scroll past their own history to read what is
   * about to replace it.
   *
   * Replace is the primary and Keep is beside it, which is the same arrangement the
   * meet-day shelf uses for the same argued reason: the variant is never the only
   * signal of what a press does. What carries the meaning here is the sentence above
   * the buttons, which survives forced colours and being read aloud.
   *
   * The offer to take a backup first is on this screen and not only on the home one,
   * because this is where a lifter finds out what they are about to lose. Pressing it
   * leaves the confirmation exactly as it is: the file has already been read and the
   * download is a separate errand.
   */
  #restoreScreen(pending: PendingRestore): TemplateResult {
    const { preview, summaries } = pending;
    const shown = summaries.slice(0, RESTORE_PREVIEW_ROWS);
    const unshown = summaries.length - shown.length;

    return html`
      <section class="section restore">
        <h2>${RESTORE_NOTES.heading}</h2>
        <p class="note trouble">${RESTORE_NOTES.warning}</p>
        ${
          this.active === null
            ? nothing
            : html`<p class="note trouble">${RESTORE_NOTES.activeWarning}</p>`
        }

        <dl class="facts">
          <div>
            <dt>${RESTORE_NOTES.workoutsLabel}</dt>
            <dd>${preview.workoutCount}</dd>
          </div>
          <div>
            <dt>${RESTORE_NOTES.finishedLabel}</dt>
            <dd>${preview.completedWorkoutCount}</dd>
          </div>
          <div>
            <dt>${RESTORE_NOTES.exercisesLabel}</dt>
            <dd>${preview.customExerciseCount}</dd>
          </div>
          <div>
            <dt>${RESTORE_NOTES.racksLabel}</dt>
            <dd>${preview.equipmentProfileCount}</dd>
          </div>
          ${
            preview.earliestDay === null || preview.latestDay === null
              ? nothing
              : html`<div>
                  <dt>${RESTORE_NOTES.spanLabel}</dt>
                  <dd>${RESTORE_NOTES.span(preview.earliestDay, preview.latestDay)}</dd>
                </div>`
          }
          <div>
            <dt>${RESTORE_NOTES.versionLabel}</dt>
            <dd>${preview.applicationVersion}</dd>
          </div>
        </dl>

        ${preview.workoutCount === 0 ? html`<p class="note">${RESTORE_NOTES.noWorkouts}</p>` : nothing}
        ${
          preview.hasActiveWorkout
            ? html`<p class="note">${RESTORE_NOTES.fileHasActive}</p>`
            : nothing
        }
        ${
          shown.length === 0
            ? nothing
            : html`
                <h3>${RESTORE_NOTES.newestHeading}</h3>
                <ul class="sessions">
                  ${shown.map(
                    (summary) =>
                      html`<li>
                        <span class="name">${summary.title ?? RESTORE_NOTES.untitled}</span>
                        <span class="day">${summary.localDate}</span>
                      </li>`,
                  )}
                </ul>
                ${unshown > 0 ? html`<p class="note">${RESTORE_NOTES.more(unshown)}</p>` : nothing}
              `
        }

        <div class="actions">
          <ptk-button variant="primary" data-action=${RESTORE_CONFIRM_ACTION}
            >${RESTORE_NOTES.confirm}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${RESTORE_CANCEL_ACTION}
            >${RESTORE_NOTES.cancel}</ptk-button
          >
          <ptk-button variant="secondary" data-action=${BACKUP_ACTION}
            >${RESTORE_NOTES.backupFirst}</ptk-button
          >
        </div>
        <div class="outcome" role="status">
          ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
        </div>
      </section>
    `;
  }

  /**
   * The offer, at the top of the home screen because it is why the lifter is here.
   *
   * The list is `handoffLifts` and not the record's own entries, so the card
   * promises exactly what pressing it produces. A record can name a lift added to
   * the catalogue after this page was built, and a card counting the record would
   * offer four lifts and log three -- discovered at the rack, with the bar loaded.
   *
   * Start is absent, rather than disabled, while a workout is open. Landing over
   * one would replace work a lifter has done with work they have not, so there is
   * nothing for the control to do and section 0.4 says it should not be drawn.
   * Discard stays either way: an hour of waiting for the record to expire is not
   * an answer to somebody looking at the card now.
   */
  #handoffCard(): TemplateResult | typeof nothing {
    const record = this.offer;
    if (record === null) return nothing;
    const busy = this.active !== null;

    return html`
      <section class="section offer">
        <h2>${HANDOFF_NOTES.heading}</h2>
        <p class="note">${HANDOFF_NOTES.intro}</p>
        <ul>
          ${handoffLifts(record).map(
            (lift) =>
              html`<li>
                <span>${lift.name}</span>
                <span class="volume"
                  >${formatVolume(lift.sets, lift.reps)} ${formatWeight(lift.weight)}</span
                >
              </li>`,
          )}
        </ul>
        ${busy ? html`<p class="note">${HANDOFF_NOTES.busy}</p>` : nothing}
        <div class="actions">
          ${
            busy
              ? nothing
              : html`<ptk-button variant="primary" data-action=${HANDOFF_START_ACTION}
                  >${HANDOFF_NOTES.start}</ptk-button
                >`
          }
          <ptk-button variant="quiet" data-action=${HANDOFF_DISCARD_ACTION}
            >${HANDOFF_NOTES.discard}</ptk-button
          >
        </div>
      </section>
    `;
  }

  #buildScreen(): TemplateResult {
    return html`
      <ptk-workout-builder
        .today=${this.#day}
        .unit=${this.settings.displayUnit}
        .exercises=${this.exercises}
        .equipment=${this.settings.equipment}
      ></ptk-workout-builder>
      <div class="actions section">
        <ptk-button variant="quiet" data-action=${CANCEL_PLAN_ACTION}
          >${DONE_NOTES.home}</ptk-button
        >
      </div>
    `;
  }

  #activeScreen(): TemplateResult {
    return html`
      ${
        this.unramped.length === 0
          ? nothing
          : html`<p class="note">
              ${HANDOFF_NOTES.unrampedLead} ${listNames(this.unramped)}.
              ${HANDOFF_NOTES.unrampedNote}
            </p>`
      }
      <ptk-active-workout
        .session=${this.active}
        .unit=${this.settings.displayUnit}
        .effort=${this.settings.effort}
        .equipment=${this.settings.equipment}
        .previous=${this.previous}
        .now=${this.now}
      ></ptk-active-workout>
    `;
  }

  #doneScreen(): TemplateResult {
    const session = this.finished;
    const millis = session === null ? null : workoutDurationMillis(session);
    return html`
      <section class="section">
        <h2>${DONE_NOTES.heading}</h2>
        <p class="note">${DONE_NOTES.note}</p>
        ${
          millis === null
            ? nothing
            : html`<p class="note">${DONE_NOTES.durationLabel} ${formatDuration(millis)}</p>`
        }
        <div class="actions">
          <ptk-button variant="secondary" data-action=${BACKUP_ACTION}
            >${DONE_NOTES.backup}</ptk-button
          >
          <ptk-button variant="primary" data-action=${HOME_ACTION}>${DONE_NOTES.home}</ptk-button>
        </div>
        <div class="outcome" role="status">
          ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
        </div>
      </section>
    `;
  }

  /**
   * A workout that is already done, with a way back and nothing else.
   *
   * No Repeat here, though section 5.4 lists it as a history action. It is on the row
   * this screen was opened from, one press away, and putting it here as well would
   * mean a second answer to what happens when the copy cannot be read -- the row's
   * note is on the home screen, which is not the screen the press would have been on.
   *
   * Back rather than a browser back button, for the reason the {@link Screen} union
   * exists. It goes through `HOME_ACTION`, so it reloads the history on the way -- a
   * workout opened, read and returned from should not leave a stale list behind it.
   */
  #detailScreen(): TemplateResult {
    return html`
      <section class="section">
        <ptk-workout-detail .session=${this.opened}></ptk-workout-detail>
        <div class="actions">
          <ptk-button variant="primary" data-action=${HOME_ACTION}>${DETAIL_NOTES.back}</ptk-button>
          ${
            // Drawn here rather than inside the element, which keeps "nothing on the
            // detail screen writes to the record" literally true of that element. It
            // sits beside Back because both of them change screen and neither is a
            // change to the workout; the one behind it is.
            this.opened === null
              ? nothing
              : html`<ptk-button variant="secondary" data-action=${EDIT_ACTION}
                  >${DETAIL_NOTES.edit}</ptk-button
                >`
          }
        </div>
      </section>
    `;
  }

  /**
   * A workout out of the history, on the screen that logged it. Section 5.4.
   *
   * `past` is the whole of the difference: no finish flow, because it is finished. No
   * `previous` either -- "last time" on a session from March would name training that
   * happened after it, which is the one line on that screen that would be a lie here.
   *
   * There is no Save. Every change writes as it is made, exactly as it does mid-workout,
   * and the line above the session says so once rather than a button implying the
   * opposite.
   */
  #editScreen(): TemplateResult {
    return html`
      <p class="note">${EDIT_NOTES.note}</p>
      <ptk-active-workout
        past
        .session=${this.editing}
        .unit=${this.settings.displayUnit}
        .effort=${this.settings.effort}
        .equipment=${this.settings.equipment}
        .now=${this.now}
      ></ptk-active-workout>
      <div class="actions section">
        <ptk-button variant="primary" data-action=${EDIT_DONE_ACTION}
          >${EDIT_NOTES.back}</ptk-button
        >
      </div>
    `;
  }

  /**
   * One lift across every session it appears in. Section 5.5.
   *
   * Back and nothing else, exactly as the detail screen has, and it returns to
   * {@link #recordsFrom} rather than home -- see that field. One word for both origins,
   * because both of them are a workout: the one being done and the one being read.
   *
   * It does not reload the history on the way, unlike the detail screen's Back. This
   * screen wrote nothing, and a reload would redraw the live session underneath a
   * lifter standing at the rack between sets.
   */
  #recordsScreen(): TemplateResult {
    return html`
      <section class="section">
        <ptk-exercise-history .history=${this.records}></ptk-exercise-history>
        <div class="actions">
          <ptk-button variant="primary" data-action=${RECORDS_BACK_ACTION}
            >${RECORDS_NOTES.back}</ptk-button
          >
        </div>
      </section>
    `;
  }

  /**
   * Section 18.9's phrase, in a region that is in the document before it has anything
   * to say.
   *
   * The paragraph stays conditional: there is nothing to report until the first read
   * comes back, and a blank line above the tool reads as a fault. What is
   * unconditional is the region around it, for the reason `ptk-rest-timer` sets out at
   * length -- a live region created at the moment its sentence appears is announced by
   * roughly half the engines and reliably by none.
   *
   * `role="status"` *and* an explicit politeness. The role is what registers the region
   * at insertion and brings `aria-atomic` with it, so the line is read whole rather
   * than as the words that moved; the attribute is what lets the two states a lifter
   * has to act on interrupt. Everything else stays polite, which matters more here than
   * it looks -- this line changes twice on every set ticked off, and a region that says
   * "Saving. Saved on this device." over the top of everything else, three times a
   * minute, for an hour, is a region that gets the tool turned off.
   */
  #saveLine(): TemplateResult {
    const state = this.saveState;
    const note = state === null ? undefined : SAVE_STATE_NOTES[state];
    const warn = state === 'unavailable' || state === 'failed';
    return html`<div class="storage" role="status" aria-live=${warn ? 'assertive' : 'polite'}>
      ${
        state === null
          ? nothing
          : html`<p class=${warn ? 'save warn' : 'save'}>
              ${SAVE_STATES[state]}${note === undefined ? nothing : html` ${note}`}
            </p>`
      }
    </div>`;
  }

  /**
   * The boot read: the settings, the workout in progress and the recent history.
   *
   * Two things here are load-bearing and neither is visible from the six call sites.
   *
   * The history goes through {@link #readHistory}, which never rejects, so it can no
   * longer take the other two reads down with it. It stays *inside* the `Promise.all`
   * rather than moving out behind the libraries: three reads on one round trip is what
   * makes the storage line an honest signal that the boot read is over, and a suite
   * whose `mount` waits for that line would otherwise be driving a screen whose history
   * had not arrived. The libraries are after it for the opposite reason and that is
   * still right -- see {@link #reloadProfiles}.
   *
   * The generation check is the other. Every read here is answered by storage some
   * milliseconds after it was asked, and the tool is fully usable in between: press
   * Done, go home, and plan a session inside that window, and the answer taken before
   * the new session existed would assign `active = null` over it, drop the logging
   * screen and leave the workout in storage with nothing pointing at it. Four taps for
   * a lifter and four milliseconds for a test, which is how it was found. So a read
   * that has been superseded by a write is discarded whole rather than assigned in
   * pieces -- {@link #generation} says why the counter is bumped where it is.
   *
   * The library reads are outside the check on purpose. They are superseded by nothing
   * a write here can do, and skipping them would leave a discarded boot with no saved
   * gyms and no custom movements for as long as the tab stayed open.
   */
  async #reload(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    const generation = this.#generation;
    const [settings, active, history] = await Promise.all([
      repository.loadSettings(),
      repository.loadActiveWorkout(),
      this.#readHistory(repository),
    ]);
    if (generation === this.#generation) {
      this.settings = settings;
      this.active = active;
      this.#showHistory(history);
      this.saveState = repository.durable ? 'saved' : 'unavailable';
      // A resumed session lands on the logging screen rather than behind a button on
      // the home one only when the lifter asks. Section 7.2: reopening the tool
      // mid-workout should not lose the session, and should not assume the reason it
      // was reopened was to carry on -- somebody checking last week's squats would
      // otherwise be dropped into today's.
      if (active === null && this.screen === 'active') this.screen = 'home';
    }
    await Promise.all([this.#reloadProfiles(), this.#reloadExercises()]);
  }

  /**
   * Reads the recent history, on its own and behind a catch.
   *
   * Section 9.3's walk, and therefore the read here most likely to meet a record it
   * cannot parse. It used to be a bare third entry in the `Promise.all` above, which
   * meant one bad row rejected the boot read as a unit and took the settings and the
   * workout in progress with it: a blank tool, with the JSON backup a lifter would
   * reach for behind the same blank screen. That is {@link #reloadProfiles}' argument
   * exactly, and the history was on the wrong side of the line it draws.
   *
   * `null` and not an empty list, because the two are different sentences and only one
   * of them is true -- see `HOME_NOTES.historyUnreadable`. The `catch` is not a
   * swallow: {@link #showHistory} is what says so on screen, and section 2.4 forbids
   * the version of this that only returns `[]`.
   */
  async #readHistory(
    repository: TrainingLogbookRepository,
  ): Promise<readonly WorkoutSummary[] | null> {
    try {
      return await repository.listWorkouts({ limit: HISTORY_LIMIT });
    } catch {
      return null;
    }
  }

  /** The list and the sentence, set together so neither can be left saying the other. */
  #showHistory(history: readonly WorkoutSummary[] | null): void {
    this.history = history ?? [];
    this.historyUnreadable = history === null;
  }

  /**
   * Reads the saved gyms, on its own and behind a catch.
   *
   * Deliberately not a fourth entry in the `Promise.all` above, which has no catch
   * and rejects as a unit. A single corrupt profile row would then take the settings,
   * the workout in progress and the history with it -- a blank tool at boot, with the
   * JSON backup a lifter would reach for blocked by the same record. The library is
   * one of the two things here the tool works without, so it fails alone and says so
   * on screen rather than reading as a library nobody has written to.
   */
  async #reloadProfiles(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    try {
      this.profiles = await repository.listEquipmentProfiles();
      this.profilesUnreadable = false;
    } catch {
      this.profiles = [];
      this.profilesUnreadable = true;
    }
  }

  /**
   * Reads the lifter's own movements, on its own and behind a catch.
   *
   * The other thing the tool works without, and out of the boot read for
   * {@link #reloadProfiles}' reason. `exercises` is set from whatever came back, so a
   * failed read leaves the built-in catalogue rather than an empty picker: a lifter
   * whose custom rows will not parse can still plan a squat, which is the difference
   * between a tool with a gap in it and a tool that has forgotten what a barbell is.
   */
  async #reloadExercises(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    try {
      this.customs = await repository.listExercises();
      this.exercisesUnreadable = false;
    } catch {
      this.customs = [];
      this.exercisesUnreadable = true;
    }
    this.exercises = exerciseOptions(this.customs);
  }

  /**
   * Writes the settings and says on screen how it went.
   *
   * The same shape as `#persist` and for the same reason: section 18.9's promise is
   * about a write completing, and a settings write that fails silently leaves a rack
   * on screen that the next visit will not have. Both settings writers go through
   * here, because two of them with two different answers to a failure is how one of
   * them ends up with none.
   */
  async #saveSettings(settings: LogbookSettings): Promise<void> {
    this.settings = settings;
    // Before the durability guard, and for the same reason `#persist`'s is where it
    // is: the line above is what makes a boot read stale, whether or not the write
    // that follows it goes anywhere. See {@link #generation}.
    this.#generation += 1;
    const repository = this.repository;
    if (repository?.durable !== true) return;
    this.saveState = 'unsaved';
    try {
      await repository.saveSettings(settings);
    } catch {
      this.saveState = 'failed';
      return;
    }
    this.saveState = 'saved';
  }

  #context(): SessionContext {
    return { nextId: () => this.nextId(), at: this.now() };
  }

  readonly #onPlanned = (event: CustomEvent<WorkoutPlannedDetail>): void => {
    stopHere(event);
    const { localDate, title, exercises } = event.detail;
    const context = this.#context();

    // Built here and not in the builder: identifiers and timestamps are the two
    // things the core needs and a pure screen cannot have. Section 12.3.
    let session = createWorkout(context, { localDate, title });
    for (const planned of exercises) {
      const load = loadFor(planned.option.loading, planned.weight);
      const plan: readonly PlannedSet[] = Array.from({ length: planned.sets }, () => ({
        // Every set typed into the builder is a working set. A ramp is added below,
        // and back-offs and AMRAPs are added mid-session, so `working` is the only
        // kind the form itself can honestly produce.
        kind: 'working' as const,
        performance: performance(load, planned.reps),
      }));
      session = addExercise(session, context, {
        exerciseId: planned.option.id,
        displayName: planned.option.name,
        loading: planned.option.loading,
        plan,
      });
      session = this.#ramp(session, planned, context);
    }
    session = startWorkout(session, context);

    this.active = session;
    this.screen = 'active';
    this.#emitWorkout(WORKOUT_STARTED_EVENT, session.id);
    void this.#persist(session, 'active');
  };

  /**
   * The ramp under one planned exercise, where one was asked for and is possible.
   *
   * Three guards before the engine sees anything, and none of them is defensive
   * duplication of the builder. The builder decides what to *draw*; a plan can also
   * arrive from a consumer dispatching the event itself, and a tick honoured without
   * a rack would reach `toBarbellSetup` with nothing to build out of.
   *
   * The weight is converted into the rack's own unit rather than passed as typed.
   * `WarmupInput.workingWeight` is a bare number in the plate unit -- it has nowhere
   * to carry one -- so a lifter who reads in pounds and trains on kilogram plates
   * would otherwise get a ramp up to 100 kg from a 100 lb top set. Section 11.4
   * expects exactly that mix, and what they typed is untouched: the conversion feeds
   * the ramp and nothing else.
   *
   * A refusal is silent. The lift keeps its working sets, which are the lifter's own
   * numbers, and the alternative -- a sentence on the logging screen naming a lift
   * whose ramp the engine turned down -- is a message at a rack about something
   * already fixable there. The handoff names them because a lifter who pressed one
   * button cannot see what it was about to do; somebody who filled in this form can.
   */
  #ramp(
    session: WorkoutSession,
    planned: PlannedExercise,
    context: SessionContext,
  ): WorkoutSession {
    const equipment = this.settings.equipment;
    if (!planned.warmup || equipment === null || planned.weight === null) return session;
    const { amount } = convertWeight(planned.weight, equipment.plateUnit);
    if (!Number.isFinite(amount) || amount <= 0) return session;
    return rampLastExercise(
      session,
      planned.option,
      {
        equipment,
        workingWeight: amount,
        workingSets: planned.sets,
        workingReps: planned.reps,
      },
      context,
    ).session;
  }

  readonly #onRepeat = (event: CustomEvent<WorkoutRepeatDetail>): void => {
    stopHere(event);
    void this.#repeat(event.detail.id);
  };

  readonly #onOpen = (event: CustomEvent<WorkoutOpenDetail>): void => {
    stopHere(event);
    void this.#open(event.detail.id);
  };

  readonly #onExerciseHistory = (event: CustomEvent<ExerciseHistoryOpenDetail>): void => {
    stopHere(event);
    void this.#records(event.detail.exerciseId);
  };

  /**
   * Reads a finished workout back and shows it. Section 5.4.
   *
   * The screen changes whatever the read returns, including on a throw. A press that
   * appeared to do nothing is the worst of the three outcomes -- a lifter presses it
   * again, and again -- and the detail screen has a sentence for a workout it has not
   * got, which is the same sentence for a row storage no longer holds and for a
   * database that would not open. To somebody looking at the row those are one event.
   *
   * No `active` guard, unlike {@link #repeat}. Nothing here writes.
   */
  async #open(id: LogbookId): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    try {
      this.opened = await repository.getWorkout(id);
    } catch {
      this.opened = null;
    }
    this.screen = 'detail';
  }

  /**
   * Reads one exercise back across the whole history. Sections 5.5 and 9.2.
   *
   * The screen changes whatever the read returns, `#open`'s rule and `#open`'s reason.
   *
   * The origin is recorded before the await and not after it. `screen` is what the
   * lifter is looking at, and a slow read on a phone is long enough for something else
   * -- a resumed session, a finished one -- to have moved it; Back would then return
   * them to a screen they were never on.
   *
   * No `active` guard, and no reload afterwards. Nothing here writes.
   */
  async #records(exerciseId: string): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    this.recordsFrom = this.screen;
    try {
      this.records = await repository.exerciseHistory(exerciseId);
    } catch {
      this.records = null;
    }
    this.screen = 'records';
  }

  /**
   * Does a listed workout again, as a fresh session dated today.
   *
   * WHY THE PLAN IS READ BACK FROM STORAGE
   *
   * The history holds `WorkoutSummary`, which has exercise *names* in it and no sets.
   * Copying a session needs the sets, so the press is a read -- which is also why this
   * is the one control on the home screen that can fail at something other than a
   * write, and the only one with a sentence for it.
   *
   * WHY THE RAMP IS REGENERATED RATHER THAN COPIED
   *
   * `repeatWorkout` drops the warm-ups on purpose: a stored ramp was built against the
   * rack the lifter stood at last week, and the plates in the record are the plates
   * that were on that bar. Regenerating is never worse. On an unchanged rack the engine
   * is deterministic and rebuilds the same ladder; on a changed one it builds a ladder
   * that can actually be loaded, where the copy would have named plates that are not
   * there. A lift that had no ramp last time gets none now -- the copy is of what the
   * lifter did, not of what the engine would offer.
   *
   * The `active` guard is checked twice, before the read and after it. `busy` already
   * takes the buttons away, but a read is a trip to IndexedDB and a session started in
   * another tab can land inside it, and the second check is what stops a repeat from
   * replacing a workout somebody is in the middle of.
   */
  async #repeat(id: LogbookId): Promise<void> {
    const repository = this.repository;
    if (repository === null || this.#sessionOpen()) return;

    let stored: WorkoutSession | null;
    try {
      stored = await repository.getWorkout(id);
    } catch {
      this.repeatFailed = true;
      return;
    }
    if (this.#sessionOpen()) return;
    if (stored === null) {
      // A row naming a workout storage no longer holds. Reported the same way as a
      // throw, because to a lifter looking at the row they are the same event, and
      // told rather than swallowed for the same reason.
      this.repeatFailed = true;
      return;
    }
    this.repeatFailed = false;

    const source = stored;
    const context = this.#context();
    let session = repeatWorkout(source, context, { localDate: this.#day });
    const unramped: string[] = [];
    // By position, which is `repeatWorkout`'s own contract: it maps the exercises one
    // for one and in order. The pairing is what says whether *this* lift was ramped
    // last time -- the copy has no snapshot left to ask.
    //
    // The list is the copy's, read once, so `exercise` goes stale as the loop rebuilds
    // the session around it. That is fine and it is why the loop can be written this
    // way at all: `session` is threaded through so each ramp lands on the last one, and
    // the only things read off `exercise` are its identifier and its working sets --
    // neither of which ramping another lift can touch.
    session.exercises.forEach((exercise, index) => {
      if (source.exercises[index]?.warmup == null) return;
      const outcome = this.#rampCopied(session, exercise, context);
      session = outcome.session;
      // Only a refusal is named, exactly as on the handoff: `no-ramp` means there was
      // never a ladder to build and is not news, while `refused` means the lifter
      // asked for one and the rack in front of them cannot make it.
      if (!outcome.ok && outcome.reason === 'refused') unramped.push(exercise.displayName);
    });
    session = startWorkout(session, context);

    this.active = session;
    this.unramped = unramped;
    this.screen = 'active';
    this.#emitWorkout(WORKOUT_STARTED_EVENT, session.id);
    void this.#persist(session, 'active');
  }

  /**
   * Whether a session is open right now.
   *
   * A call rather than a bare `this.active !== null`, and not for taste. The second
   * check in {@link #repeat} happens after an await, by which point the compiler has
   * narrowed the field to `null` from the first one and `no-unnecessary-condition`
   * reports the guard as dead code. It is not: `active` is a field another tab's write
   * reaches through a property, so the await is exactly where it can change. The rule
   * is right about the types and wrong about the program, and a call it cannot see
   * through says so without suppressing anything.
   */
  #sessionOpen(): boolean {
    return this.active !== null;
  }

  /**
   * The ramp under one copied exercise, worked out from its own sets.
   *
   * The counterpart of {@link #ramp} for a session nobody filled a form in for: there
   * is no `PlannedExercise` to read a weight off, so `workingPrescription` reads it
   * back out of the copied working sets. Everything after that is the same, including
   * converting into the rack's plate unit -- section 11.4's mixed-unit lifter repeats
   * sessions too.
   *
   * A lift the catalogue no longer knows is `no-ramp` rather than an error. Its working
   * sets are in the session either way, which is the lifter's own record, and a
   * catalogue that dropped a movement between two builds is not something to lose a
   * session over.
   */
  #rampCopied(
    session: WorkoutSession,
    exercise: WorkoutExercise,
    context: SessionContext,
  ): RampOutcome {
    const equipment = this.settings.equipment;
    const option = this.exercises.find((candidate) => candidate.id === exercise.exerciseId);
    const prescription = workingPrescription(exercise);
    if (equipment === null || option === undefined || prescription === null) {
      return { ok: false, session, reason: 'no-ramp' };
    }
    const { amount } = convertWeight(prescription.weight, equipment.plateUnit);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, session, reason: 'no-ramp' };
    return rampExercise(
      session,
      exercise.id,
      option,
      {
        equipment,
        workingWeight: amount,
        workingSets: prescription.sets,
        workingReps: prescription.reps,
      },
      context,
    );
  }

  readonly #onChanged = (event: CustomEvent<WorkoutChangedDetail>): void => {
    stopHere(event);
    const { session, completedSetId } = event.detail;
    if (this.editing !== null) {
      // No `SET_COMPLETED_EVENT`, and no rest. Section 12.5's event says a set was
      // just done, and ticking a row on a session from March did not do a set --
      // section 7.11's timer hangs off that event, and a correction must not start
      // one.
      this.editing = session;
      void this.#persist(session, 'past');
      return;
    }
    this.active = session;
    if (completedSetId !== null) {
      this.#startRest(session, completedSetId);
      this.dispatchEvent(
        new CustomEvent<SetCompletedDetail>(SET_COMPLETED_EVENT, {
          detail: { workoutId: session.id, setId: completedSetId },
          bubbles: true,
          composed: true,
        }),
      );
    }
    void this.#persist(session, 'active');
  };

  /**
   * Section 7.7's changes to the shape of a lift, applied here rather than on screen.
   *
   * Two of the four mint an identifier and `ptk-active-workout` deliberately has no
   * id source, so it names the change and this decides what it means. Against
   * `this.active` and not against anything in the detail: the screen flushes an open
   * note first, and the note reached this element rather than the copy the screen
   * still holds.
   */
  readonly #onSetPlan = (event: CustomEvent<SetPlanChangedDetail>): void => {
    stopHere(event);
    const editing = this.editing;
    if (editing !== null) {
      const corrected = this.#applyPlan(editing, event.detail.change);
      if (corrected === editing) return;
      this.editing = corrected;
      void this.#persist(corrected, 'past');
      return;
    }
    const session = this.active;
    if (session === null) return;
    const next = this.#applyPlan(session, event.detail.change);
    // The whole of the "does this row exist" question, for all four changes. The core
    // hands back the session it was given where an identifier matched nothing, so a
    // change naming a row that has gone -- a stale render, a consumer's own event --
    // stops here rather than costing a write whose only difference is a newer
    // `updatedAt`, which would move the workout up the history for nothing.
    if (next === session) return;
    this.active = next;
    void this.#persist(next, 'active');
  };

  #applyPlan(session: WorkoutSession, change: SetPlanChange): WorkoutSession {
    const context = this.#context();
    switch (change.kind) {
      case 'add': {
        const planned = this.#planForAdd(session, change.exerciseId);
        return planned === null ? session : addSet(session, change.exerciseId, planned, context);
      }
      // No "does this row exist" check in front of these three. The core hands back
      // the session it was given where an identifier matched nothing, so the check
      // above -- `next === session` -- already refuses a change naming a row that has
      // gone, and a second one here would only restate it a level further out.
      case 'duplicate':
        return duplicateSet(session, change.setId, context);
      case 'skip':
        return skipSet(session, change.setId, context);
      case 'remove':
        return removeSet(session, change.setId, context);
    }
  }

  /**
   * What an added set is planned as, or `null` where there is no such lift.
   *
   * `addSet` appends, so the row it lands after is the last one, and taking that
   * row's kind is what makes Add mean "another back-off" at the end of a lift and
   * "another working set" in the middle of one.
   *
   * `planned ?? performed` is `duplicateSet`'s rule and is here so the two controls
   * agree: a lifter who did four against a plan of five and then pressed either one
   * gets a row planned as five. Copying what the row *shows* instead would make the
   * button beside it copy something different, which is worse than either answer.
   */
  #planForAdd(session: WorkoutSession, exerciseId: LogbookId): PlannedSet | null {
    const exercise = findWorkoutExercise(session, exerciseId);
    if (exercise === null) return null;
    const last = exercise.sets.at(-1);
    // Nothing to copy, which is reachable: removing the last row leaves the lift on
    // screen with its Add button. A working set, because that is the kind every other
    // path plans, and an empty one, because an empty row is still a row to tick.
    if (last === undefined) return { kind: 'working', performance: emptyPerformance() };
    return { kind: last.kind, performance: last.planned ?? last.performed ?? emptyPerformance() };
  }

  readonly #onFinished = (event: CustomEvent<WorkoutFinishedDetail>): void => {
    stopHere(event);
    const { session } = event.detail;
    this.active = null;
    this.rest = null;
    this.finished = session;
    this.screen = 'done';
    this.backupDone = false;
    this.markdownDone = false;
    this.#emitWorkout(WORKOUT_COMPLETED_EVENT, session.id);
    void this.#persist(session, 'finished');
  };

  /**
   * One of the two settings segmented controls.
   *
   * Routed on `data-field` rather than on the value, because both send the same
   * event carrying nothing but a string and this element hears both. Matching on
   * the value alone works only for as long as no two choices collide, and `none`
   * is one careless addition away from being a unit or a disposition.
   *
   * The type guards stay anyway. They are what makes a value arriving from a
   * consumer that dispatched the event itself unable to write a scale the schema
   * would refuse, and they are the reason neither branch needs a cast.
   */
  readonly #onSetting = (event: CustomEvent<SegmentedChangeDetail>): void => {
    // Stopped here like every other handler, and it had been the one that was not.
    // A segmented change is `composed`, so `{value: 'rpe'}` and `{value: 'kg'}` were
    // reaching whatever the embedding site listens for on `document`. Neither is
    // training and section 12.5 is arguably untouched -- but the boundary this
    // element declares is the boundary it should keep, and a preference is still
    // application state a framing page was granted no access to.
    stopHere(event);
    const { value } = event.detail;
    const field = fieldOf(event);
    if (field === UNIT_SETTING_FIELD) {
      if (!isUnit(value) || value === this.settings.displayUnit) return;
      void this.#saveSettings({ ...this.settings, displayUnit: value });
      return;
    }
    if (field === EFFORT_SETTING_FIELD) {
      if (!isEffortSetting(value) || value === this.settings.effort) return;
      void this.#saveSettings({ ...this.settings, effort: value });
      return;
    }
    if (field === REST_SETTING_FIELD) {
      const enabled = value === 'on';
      if (enabled === this.settings.restTimer.enabled) return;
      // Switching the timer off takes the one on screen with it, and no test covers
      // this line: a rest exists only during a live session, the settings are on the
      // home screen, and there is no way to the home screen from a live session. So it
      // is a guard against the day there is one rather than a path a thumb can walk --
      // leaving a countdown running would be a screen with nothing on it that explains
      // where the countdown came from. Do not delete it on the strength of a green run,
      // and do not claim it is tested.
      if (!enabled) this.rest = null;
      void this.#saveSettings({
        ...this.settings,
        restTimer: { ...this.settings.restTimer, enabled },
      });
    }
  };

  /**
   * A rest duration: the default on the settings screen, or one lift's on the band.
   *
   * Routed on `data-field` like the segmented controls beside it, for the reason
   * `dataset.ts` gives: "it is the select" stops being a routing rule the moment there
   * are two, and there are now two carrying the same kind of value -- a number of
   * seconds -- so the one that got it wrong would write a rest for squats into the
   * default for everything. A value that is not a number is dropped rather than clamped
   * -- the options are this element's own and anything else came from a consumer firing
   * the event by hand, which is not a number to guess at.
   */
  readonly #onSelectSetting = (event: CustomEvent<SelectChangeDetail>): void => {
    stopHere(event);
    const field = fieldOf(event);
    if (field !== REST_DURATION_FIELD && field !== REST_LIFT_DURATION_FIELD) return;
    const { value } = event.detail;
    if (value === null) return;
    const seconds = Number.parseInt(value, 10);
    if (!Number.isInteger(seconds)) return;
    if (field === REST_LIFT_DURATION_FIELD) {
      this.#setLiftRest(seconds);
      return;
    }
    const defaultSeconds = clampRestSeconds(seconds);
    if (defaultSeconds === this.settings.restTimer.defaultSeconds) return;
    // The running rest is deliberately left alone. This says how long the *next* rest
    // is, and rewriting the one in progress would move the end of a rest the lifter is
    // already taking -- section 7.11 has a Start again button for that, and it is a
    // press rather than a side effect of a setting three screens away.
    void this.#saveSettings({
      ...this.settings,
      restTimer: { ...this.settings.restTimer, defaultSeconds },
    });
  };

  /**
   * A set was ticked off, so the rest for that lift begins.
   *
   * The exercise is looked up rather than passed down, because the logging screen
   * reports the set and the duration hangs off the movement. A set that is somehow not
   * in the session it came with leaves the previous timer alone: a rest of the wrong
   * length is worse than the one already running, and this is a path nothing reaches by
   * ordinary use.
   */
  #startRest(session: WorkoutSession, completedSetId: LogbookId): void {
    const found = findSet(session, completedSetId);
    if (found === null) return;
    this.rest = startRestFor(this.settings.restTimer, found.exercise.exerciseId, this.now());
    // The name as the session snapshotted it, which is the one the lifter is looking at
    // -- a custom exercise renamed since is a different word for the same movement, and
    // the picker names the rest they are taking rather than the row in the library.
    this.restExercise = {
      id: found.exercise.exerciseId,
      name: found.exercise.displayName,
    };
  }

  /**
   * What the band offers for choosing this lift's own rest, or `null` for nothing.
   *
   * Computed here because only this element knows the settings, and offered only while
   * a rest is actually on screen: a picker under no countdown would be a setting hiding
   * on whichever screen the lifter happened to leave open.
   */
  #restLift(): RestLift | null {
    const lift = this.restExercise;
    // The timer half of that guard is not covered by any test and cannot be: the band
    // draws nothing at all without a rest, so a leftover lift handed down after a
    // dismiss is invisible either way. It is here so that what this element hands down
    // is true rather than merely unread, which is what `restExercise` is allowed to go
    // stale on the strength of. Do not delete it on a green run.
    if (this.rest === null || lift === null) return null;
    const seconds = restSecondsFor(this.settings.restTimer, lift.id);
    return { name: lift.name, seconds, options: restDurationOptions(seconds) };
  }

  /**
   * How long this lift rests, from now on. Section 7.11's exercise-specific duration.
   *
   * The running rest is retimed, which is the opposite of what the settings picker does
   * and for the opposite reason: that one is three screens away and says what the
   * *next* rest is, while this one is printed on the countdown it describes. Leaving it
   * alone would be a lifter choosing five minutes and watching three run out.
   *
   * `withRestSecondsFor` takes the entry away again for a length that matches the
   * default, so the picker is also how a lift goes back to following it.
   */
  #setLiftRest(seconds: number): void {
    const lift = this.restExercise;
    const timer = this.rest;
    if (lift === null || timer === null) return;
    const restTimer = withRestSecondsFor(this.settings.restTimer, lift.id, seconds);
    const wanted = restSecondsFor(restTimer, lift.id);
    if (wanted === restSecondsFor(this.settings.restTimer, lift.id)) return;
    void this.#saveSettings({ ...this.settings, restTimer });
    this.rest = retimeRest(timer, wanted, this.now());
  }

  /**
   * One of the rest timer's controls.
   *
   * Applied here because the timer is this element's state; `ptk-rest-timer` names the
   * press and computes nothing. Dismiss is the only one that ends the rest, and it ends
   * it whether or not it had run out -- a lifter pressing Done resting has finished
   * resting.
   */
  readonly #onRestAction = (event: CustomEvent<RestActionDetail>): void => {
    stopHere(event);
    const timer = this.rest;
    if (timer === null) return;
    const at = this.now();
    switch (event.detail.action) {
      case 'pause':
        this.rest = pauseRest(timer, at);
        return;
      case 'resume':
        this.rest = resumeRest(timer, at);
        return;
      case 'extend':
        this.rest = adjustRest(timer, REST_STEP_SECONDS, at);
        return;
      case 'shorten':
        this.rest = adjustRest(timer, -REST_STEP_SECONDS, at);
        return;
      case 'reset':
        this.rest = resetRest(timer, at);
        return;
      case 'dismiss':
        this.rest = null;
        return;
    }
  };

  /**
   * A rest alert that has been switched on or off. Section 7.11.
   *
   * Stored rather than acted on: the band that dispatched this has already made the
   * device do the thing, and only dispatches once it worked. So what arrives here is
   * a demonstration, not a request, and the settings record cannot come to hold an
   * alert this device refuses to give. See `rest-alert.ts`.
   *
   * The unchanged guard is not decoration. This lands on every flick, `#saveSettings`
   * bumps `#generation`, and a settings write that changed nothing would discard a
   * history read already in flight -- #95's window, reached from a switch.
   */
  readonly #onRestAlerts = (event: CustomEvent<RestAlertsDetail>): void => {
    stopHere(event);
    const { alerts } = event.detail;
    if (sameAlerts(this.settings.restTimer.alerts, alerts)) return;
    void this.#saveSettings({
      ...this.settings,
      restTimer: { ...this.settings.restTimer, alerts },
    });
  };

  /**
   * The rack in front of the lifter changed.
   *
   * Written straight through with no press, which is the whole difference between the
   * editor and the library: this is what the tool is using now, and a rack behind a
   * Save button would leave the plate math running on the last gym the lifter
   * remembered to confirm. `displayUnit` is deliberately untouched -- the plate unit of
   * a rack and the unit weights are shown in are two facts, and coupling them would
   * rewrite what a lifter types in because they moved to a kilogram gym.
   */
  readonly #onRack = (event: CustomEvent<RackChangedDetail>): void => {
    stopHere(event);
    void this.#saveSettings({ ...this.settings, equipment: event.detail.equipment });
  };

  /**
   * The lifter asked to keep the rack under a name.
   *
   * A name already in the library replaces that gym rather than adding a second row
   * under the same word, which is what `EQUIPMENT_NOTES.saveOverwrites` promises.
   * Matched case-insensitively on the trimmed name: "The garage" and "the garage" are
   * one gym to the person who typed both, and a library that disagreed would grow a
   * duplicate whose only distinguishing mark is invisible.
   */
  readonly #onProfileSaved = (event: CustomEvent<ProfileSavedDetail>): void => {
    stopHere(event);
    const { name, equipment } = event.detail;
    const key = name.toLocaleLowerCase();
    const existing = this.profiles.find((profile) => profile.name.toLocaleLowerCase() === key);
    const context = this.#context();
    const profile =
      existing === undefined
        ? createProfile(name, equipment, context)
        : updateProfileEquipment(existing, equipment, context);
    void this.#writeLibrary(
      (repository) => repository.saveEquipmentProfile(profile),
      () => this.#reloadProfiles(),
    );
  };

  /**
   * The lifter asked to stand in a gym they saved.
   *
   * The snapshot is stored by value, exactly as it sits in the profile. It is not
   * aliased to the profile by identifier and it is not deep-copied here: both stores
   * structured-clone on the way in and out, so a copy at this layer would buy nothing
   * and the settings type has nowhere to put an identifier anyway. The consequence,
   * which is deliberate and not an oversight: editing a saved gym's rack while it is
   * in use detaches it from the settings, and the "In use" mark on that row goes out.
   */
  readonly #onProfileApplied = (event: CustomEvent<ProfileIdDetail>): void => {
    stopHere(event);
    const profile = findProfile(this.profiles, event.detail.id);
    if (profile === null) return;
    void this.#saveSettings({ ...this.settings, equipment: profile.equipment });
  };

  /**
   * The lifter asked to forget a saved gym.
   *
   * `settings.equipment` is left exactly as it is, even when it is the rack that was
   * just removed. Section 8.4 froze the rack into every finished session, and the one
   * in force is a rack the lifter is standing in front of -- forgetting where they
   * wrote its name down is not the same as walking out of the gym.
   */
  readonly #onProfileRemoved = (event: CustomEvent<ProfileIdDetail>): void => {
    stopHere(event);
    const { id } = event.detail;
    void this.#writeLibrary(
      (repository) => repository.deleteEquipmentProfile(id),
      () => this.#reloadProfiles(),
    );
  };

  /**
   * The lifter asked to keep a movement they described.
   *
   * Two ways in and one way out. An edit names the row it replaces, so it goes
   * straight to `updateCustomExercise` and keeps the identifier -- which it has to,
   * because every `WorkoutExercise` planned from it holds that identifier and a new
   * one would orphan them. An add matches on the trimmed name, case-insensitively, for
   * `#onProfileSaved`' reason and with more riding on it: two rows called "Belt squat"
   * are indistinguishable in the picker, and the second is how a lifter loses track of
   * which one their history is filed under.
   *
   * A name typed over a movement that already exists therefore replaces it, which is
   * what `EXERCISE_NOTES.addOverwrites` promises. Sessions already planned keep
   * reading correctly either way: section 7.1 snapshots `displayName` onto the row.
   */
  readonly #onExerciseSaved = (event: CustomEvent<ExerciseSavedDetail>): void => {
    stopHere(event);
    const { id, draft } = event.detail;
    const context = this.#context();
    const key = draft.name.trim().toLocaleLowerCase();
    const existing =
      id === null
        ? (this.customs.find((exercise) => exercise.name.toLocaleLowerCase() === key) ?? null)
        : findCustomExercise(this.customs, id);
    const exercise =
      existing === null
        ? createCustomExercise(draft, context)
        : updateCustomExercise(existing, draft, context);
    void this.#writeLibrary(
      (repository) => repository.saveExercise(exercise),
      () => this.#reloadExercises(),
    );
  };

  /**
   * The lifter asked to forget one of their own movements.
   *
   * Nothing else is touched, including a session in progress that is using it. The
   * row holds its own `displayName` and `loading`, so the workout goes on asking for
   * the same boxes and reads the same way afterwards; what is gone is the picker
   * entry, which is exactly what `EXERCISE_NOTES.removeNote` says.
   */
  readonly #onExerciseRemoved = (event: CustomEvent<ExerciseIdDetail>): void => {
    stopHere(event);
    const { id } = event.detail;
    void this.#writeLibrary(
      (repository) => repository.deleteExercise(id),
      () => this.#reloadExercises(),
    );
  };

  /**
   * Writes a library change and reads the library back.
   *
   * Read back rather than patched into the local list, because what is on screen has
   * to be what is in the database: a save that was rejected, or that landed under
   * a name a second tab had already taken, must not leave a row on screen that nothing
   * holds. It costs one read per press on a list that is a handful of rows long.
   *
   * Unlike `#persist` and `#saveSettings` this writes even where the repository is not
   * durable. Those two have somewhere else to keep their answer -- the session and the
   * settings are already in this element's state -- and the library's only copy is the
   * store. Skipping the write would make Save a control that does nothing, which
   * section 0.4 forbids more strongly than it forbids a gym that does not outlive the
   * tab. The save line still says which of the two happened.
   */
  async #writeLibrary(
    change: (repository: TrainingLogbookRepository) => Promise<void>,
    readBack: () => Promise<void>,
  ): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    if (repository.durable) this.saveState = 'unsaved';
    try {
      await change(repository);
    } catch {
      if (repository.durable) this.saveState = 'failed';
      return;
    }
    await readBack();
    if (repository.durable) this.saveState = 'saved';
  }

  readonly #onClick = (event: Event): void => {
    switch (actionOf(event)) {
      case START_ACTION:
        this.screen = 'build';
        return;
      case RESUME_ACTION:
        if (this.active !== null) this.screen = 'active';
        return;
      case CANCEL_PLAN_ACTION:
      case HOME_ACTION:
        this.screen = 'home';
        this.backupDone = false;
        this.markdownDone = false;
        // Cleared with the download notes beside them and for the same reason: every
        // one of them reports what one press did, and a report still on screen after a
        // trip through a workout reads as a claim about the logbook rather than as the
        // answer to something the lifter did.
        this.refusals = [];
        this.restoreDone = false;
        this.restoreProblem = null;
        this.deleteDone = false;
        this.deleteProblem = null;
        this.unramped = [];
        this.repeatFailed = false;
        // Dropped rather than kept for a second visit. It is a whole session held in
        // memory, and the next press re-reads it in a few milliseconds -- while a
        // stale copy would redraw the workout as it was before an edit somewhere else
        // changed it.
        this.opened = null;
        this.records = null;
        this.editing = null;
        void this.#reload();
        return;
      case RECORDS_BACK_ACTION:
        this.screen = this.recordsFrom;
        this.records = null;
        return;
      case EDIT_ACTION:
        // The session already read for the detail screen, handed straight over rather
        // than read again. It is the same record and a second read would only widen
        // the window in which the two could disagree.
        if (this.opened === null) return;
        this.editing = this.opened;
        this.screen = 'edit';
        return;
      case EDIT_DONE_ACTION:
        // The corrected session becomes what the detail screen shows, because it is
        // what storage now holds. The list behind it is reloaded as well: the set
        // count and the note mark on a row are summary fields and an edit moves both.
        this.opened = this.editing;
        this.editing = null;
        this.screen = 'detail';
        void this.#leaveEditor();
        return;
      case BACKUP_ACTION:
        void this.#backup();
        return;
      case MARKDOWN_ACTION:
        void this.#markdown();
        return;
      case RESTORE_PICK_ACTION:
        // A `MouseEvent` rather than `click()`, which is what the meet-day shelf
        // found it needed: the input is clipped, and the synthetic press is the only
        // thing that opens a picker a lifter cannot see.
        this.renderRoot.querySelector('input[type=file]')?.dispatchEvent(new MouseEvent('click'));
        return;
      case RESTORE_CONFIRM_ACTION:
        void this.#restore();
        return;
      case PERSIST_ASK_ACTION:
        void this.#askToKeep();
        return;
      case DELETE_PICK_ACTION:
        void this.#openDelete();
        return;
      case DELETE_CONFIRM_ACTION:
        void this.#deleteAll();
        return;
      case DELETE_CANCEL_ACTION:
        // The counts go with the screen, the way the parsed backup does. They describe
        // a device that anything else in the tool can change while the lifter is away
        // from this screen, and a stale set of them is a confirmation describing a
        // logbook that is not the one the press would destroy.
        this.deletion = null;
        this.screen = 'home';
        return;
      case RESTORE_CANCEL_ACTION:
        // The parsed backup goes with the screen. Keeping it would leave a file a
        // lifter has already declined one press away from replacing everything, on a
        // screen they thought they had left.
        this.pending = null;
        this.screen = 'home';
        return;
      case HANDOFF_START_ACTION:
        this.#startHandoff();
        return;
      case HANDOFF_DISCARD_ACTION:
        this.handoff?.clear();
        this.offer = null;
        return;
      default:
        return;
    }
  };

  /**
   * Turns the waiting record into a workout and starts it.
   *
   * The record is forgotten whatever happens, including when nothing lands. It
   * was written for one press and there is no second thing to do with it, and a
   * record left behind after a press is one the tool offers again on the next
   * visit -- to a lifter who has already answered it.
   *
   * `today` and not a day derived from the record. The record's stamp is an
   * instant written by another page, possibly in another time zone the same
   * device has since left, and the day a session is filed under is the lifter's
   * own. It is also the day they are training, not the day they pressed the
   * button in the calculator, which for a session set up the night before are
   * two different answers and only one of them is right.
   */
  #startHandoff(): void {
    const record = this.offer;
    const source = this.handoff;
    if (record === null || source === null || this.active !== null) return;

    const landing = workoutFromHandoff(record, {
      localDate: this.#day,
      context: this.#context(),
    });
    source.clear();
    this.offer = null;
    if (landing === null) return;

    this.active = landing.session;
    this.unramped = landing.unramped;
    this.screen = 'active';
    this.#emitWorkout(WORKOUT_STARTED_EVENT, landing.session.id);
    void this.#writeLanding(landing.session, record.equipment);
  }

  /**
   * Writes what a landing produced: a rack, if this device has none, then the
   * session.
   *
   * **The rack is adopted only where `settings.equipment` is `null`.** A lifter
   * who has set one up here chose it on this screen, and a record arriving from
   * another tab must not overwrite that -- the calculator's rack is where they
   * warmed up, which is not a statement about where the logbook thinks they
   * train. Where there is none, the record is strictly better than nothing: it is
   * the only rack this device has been told about, and #13b's plate diagrams draw
   * nothing without one.
   *
   * Sequential and rack-first, so that the save line ends on the session's own
   * answer. That is the write section 18.9 makes a promise about; a settings
   * write finishing second would report "Saved" over a session that was not.
   */
  async #writeLanding(session: WorkoutSession, equipment: EquipmentSnapshot): Promise<void> {
    if (this.settings.equipment === null) {
      await this.#saveSettings({ ...this.settings, equipment });
    }
    await this.#persist(session, 'active');
  }

  /**
   * Writes the session and says on screen how it went.
   *
   * A finished workout goes through `completeWorkout` rather than
   * `saveActiveWorkout` because clearing the active marker and storing the workout
   * have to happen in one transaction -- two writes would leave, on a crash between
   * them, a finished workout that the tool still offers to carry on with.
   *
   * A correction is the third answer and takes `saveWorkout`, which writes the record
   * with the active pointer untouched. That is the whole of what makes editing a
   * session from March safe: neither of the other two calls can be used for it, since
   * one would make it the workout in progress and the other would finish it a second
   * time.
   */
  async #persist(session: WorkoutSession, kind: PersistKind): Promise<void> {
    // Here and not in `#write`, which runs a chain later: what supersedes a read in
    // flight is the caller having already assigned the session above this line, not
    // the database agreeing to it. See {@link #generation}.
    this.#generation += 1;
    const write = this.#writing.then(async () => this.#write(session, kind));
    // Held even when it fails, so a later reader waits for the attempt rather than
    // skipping past it. `#write` reports failure on the screen and never rejects.
    this.#writing = write;
    return write;
  }

  async #write(session: WorkoutSession, kind: PersistKind): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    if (!repository.durable) {
      // Nothing to await and nothing to promise. The tool works for this tab and the
      // line above the screen already says so.
      return;
    }

    this.saveState = 'unsaved';
    try {
      if (kind === 'finished') await repository.completeWorkout(session);
      else if (kind === 'past') await repository.saveWorkout(session);
      else await repository.saveActiveWorkout(session);
    } catch {
      // Reported to the lifter rather than to a console, which is section 2.4's
      // "do not silently ignore" met where it matters: `SAVE_STATE_NOTES.failed`
      // tells them the tab still holds everything and to download a backup now.
      // A console line is not something anybody reads between sets.
      this.saveState = 'failed';
      return;
    }
    this.saveState = 'saved';
    this.#emitWorkout(WORKOUT_SAVED_EVENT, session.id);
    if (kind === 'finished') void this.#refreshHistory();
  }

  /**
   * Rebuilds the history list, but only once the correction behind it is written.
   *
   * Everywhere else `#persist` is fired and forgotten, because nothing on the screen
   * it returns to reads the database back. Leaving the editor does: the list is built
   * from storage, and built too early it shows the lifter the numbers they just
   * changed.
   */
  async #leaveEditor(): Promise<void> {
    await this.#writing;
    await this.#refreshHistory();
  }

  /**
   * The same read as the boot one, through the same catch and the same two fields.
   *
   * Not a second `listWorkouts` of its own. This one runs off the back of a write, so
   * an uncaught rejection here is a promise nobody is holding as well as a list that
   * silently stops matching the database -- the lifter finishes a session, lands on the
   * home screen, and the workout they just did is not in the list with nothing saying
   * why.
   */
  async #refreshHistory(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    this.#showHistory(await this.#readHistory(repository));
  }

  /**
   * A file, handed straight to the browser. Section 10.6.
   *
   * The anchor is never attached to the document: a detached one still opens the
   * download, and attaching it would put a control in the light DOM of a page that
   * renders everything else inside a shadow root.
   *
   * An object URL and an anchor and nothing else, which section 10.6 asks for in as
   * many words -- the required path has to be the broadly compatible one. A save-file
   * picker is allowed as an enhancement and there is not one here, because two ways of
   * writing a file is two ways for it to go wrong on a phone.
   *
   * Filenames carry the lifter's own day rather than an instant. A file named for a UTC
   * timestamp sorts oddly in a folder for anybody who trains in the evening west of
   * Greenwich.
   */
  #download(text: string, mime: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Section 10.4's backup: the file a restore reads. */
  async #backup(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    const snapshot = await repository.exportSnapshot();
    this.#download(serializeBackup(snapshot), 'application/json', backupFilename(this.#day));

    this.backupDone = true;
    this.dispatchEvent(
      new CustomEvent<BackupExportedDetail>(BACKUP_EXPORTED_EVENT, {
        detail: { workoutCount: snapshot.data.workouts.length },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Section 10.5's readable copy: the file nothing reads.
   *
   * Built from the same snapshot the backup is, through the same `exportSnapshot`, so
   * the two files a lifter takes in one sitting describe the same device. It fires no
   * event. Section 12.5's list is closed at seven and none of them is this: a host
   * cannot act on a Markdown download differently from a JSON one, since the only fact
   * either carries is that a file left the device, and `training-backup-exported`
   * already says that about the file that matters.
   */
  async #markdown(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    const snapshot = await repository.exportSnapshot();
    this.#download(markdownExport(snapshot), 'text/markdown', markdownFilename(this.#day));
    this.markdownDone = true;
  }

  /**
   * A file off the lifter's own disk, on its way to {@link #readChosen}.
   *
   * The input is cleared whether or not a file arrived, so choosing the same file
   * twice running fires a second change. Without it, a file refused once cannot be
   * tried again -- after fixing it in an editor, say -- without picking something
   * else in between.
   */
  readonly #onFileChosen = (event: Event): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    void this.#readChosen(file);
  };

  /**
   * Section 10.7's steps 1 to 6: read the file, validate it, describe it.
   *
   * Nothing is written here and nothing is replaced. What this produces is either a
   * refusal on the home screen or a confirmation on its own screen, and the press on
   * that screen is the only thing in the tool that can replace a logbook.
   *
   * `file.size` and never `text.length`. `MAX_BACKUP_BYTES` is a byte count, and
   * UTF-16 code units undercount a file full of non-Latin exercise names by up to a
   * factor of three -- so a limit measured in code units would let a file three times
   * the size through and would say the limit had been kept.
   *
   * The outcome of the *previous* file is cleared first. A refusal left under the
   * button while a second file is being read would be answering a question the lifter
   * has already moved on from.
   */
  async #readChosen(file: File): Promise<void> {
    this.refusals = [];
    this.restoreDone = false;
    this.restoreProblem = null;

    let text: string;
    try {
      text = await file.text();
    } catch {
      this.refusals = [{ code: 'unreadable', path: null }];
      return;
    }

    const result = readBackup(text, file.size);
    if (!result.ok) {
      this.refusals = distinctRefusals(result.problems);
      return;
    }

    this.pending = {
      backup: result.backup,
      preview: backupPreview(result.backup),
      summaries: backupSummaries(result.backup),
    };
    this.screen = 'restore';
  }

  /**
   * Section 10.7's steps 7 to 10: replace everything, then read it back.
   *
   * The read-back is the ninth step and it is not ceremony. `replaceAll` in the
   * IndexedDB store is one transaction across all four object stores, so on that store
   * a half-landed restore is not reachable -- but the in-memory store cannot be
   * transactional, a host may hand in its own, and this is the one write in the tool
   * whose failure destroys the thing it was asked to protect. Comparing what came back
   * out is what turns "the write did not throw" into "the database holds the file".
   *
   * The screen is left before the write rather than after it. A confirmation still up
   * while the restore runs is a second press away from running it twice, and the two
   * outcomes are both reported on the home screen anyway.
   *
   * `backupDone` is cleared on the way out. It would otherwise say a backup had been
   * downloaded of a logbook that no longer exists.
   */
  async #restore(): Promise<void> {
    const repository = this.repository;
    const pending = this.pending;
    if (repository === null || pending === null) return;

    this.pending = null;
    this.screen = 'home';
    this.backupDone = false;
    this.markdownDone = false;
    if (repository.durable) this.saveState = 'unsaved';

    try {
      await repository.replaceFromBackup(pending.backup);
    } catch {
      this.restoreProblem = 'write';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    let written: TrainingLogbookBackup;
    try {
      written = await repository.exportSnapshot();
    } catch {
      // A read-back that will not run is the ninth step answering no. The write
      // landed, and nothing here can say what it landed as.
      this.restoreProblem = 'verify';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    // Before the verdict either way, because the screen has to show what the database
    // actually holds -- most of all when the two disagree.
    await this.#reload();

    if (!sameShape(written.data, pending.backup.data)) {
      this.restoreProblem = 'verify';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    if (repository.durable) this.saveState = 'saved';
    this.restoreDone = true;
    this.dispatchEvent(
      new CustomEvent<BackupRestoredDetail>(BACKUP_RESTORED_EVENT, {
        detail: { workoutCount: pending.preview.workoutCount },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Reads what the browser already thinks, asking it for nothing.
   *
   * Called when the port arrives and at no other time. {@link persistAsked} is cleared
   * with it, because a host that swaps the port has swapped the thing that answered,
   * and a refusal note left over from the old one would be reporting a press made
   * against something else.
   */
  async #readDurability(): Promise<void> {
    const persistence = this.persistence;
    this.persistAsked = false;
    this.durability = persistence === null ? 'unknown' : await persistence.durability();
  }

  /**
   * Asks. Section 10.3's request, from the press and from nowhere else.
   *
   * The flag is set after the answer rather than before the ask, so a browser still
   * showing its own permission prompt is not yet being told what it decided.
   *
   * There is no failure branch, because there is no failure: the port maps a rejection
   * to `'unknown'`, and a browser that gave no answer is a browser that changed
   * nothing. The screen says exactly that and offers the press again.
   */
  async #askToKeep(): Promise<void> {
    const persistence = this.persistence;
    if (persistence === null) return;

    const answer = await persistence.request();
    this.durability = answer;
    this.persistAsked = true;
  }

  /**
   * Counts what is here, then shows the confirmation. Section 10.8's first half.
   *
   * The counts are read at the press and not held from the last reload, so the numbers
   * on the screen are the ones true when the question was asked. `backupPreview` over
   * the live snapshot rather than a tally of `this.workouts`: the list on the home
   * screen is a page of summaries and the snapshot is everything, and the whole promise
   * of this screen is that the number is what goes.
   *
   * A read that will not run leaves the lifter on the home screen with the write
   * problem's wording. It is the honest answer -- a device that cannot be read is one
   * this press did not empty -- and it is the same sentence a failed delete gets,
   * because the only fact either has to report is that everything is still here.
   */
  async #openDelete(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;

    this.deleteDone = false;
    this.deleteProblem = null;

    let snapshot: TrainingLogbookBackup;
    try {
      snapshot = await repository.exportSnapshot();
    } catch {
      this.deleteProblem = 'write';
      return;
    }

    this.deletion = backupPreview(snapshot);
    this.screen = 'delete';
  }

  /**
   * Section 10.8: everything on this device, gone, and then read back to prove it.
   *
   * The read-back is here for the reason it is in {@link #restore}, turned around. A
   * restore that half-lands destroys a logbook; a delete that half-lands leaves one
   * behind, on a device whose owner has been told it is clean. That is the worse of
   * the two to get wrong silently, because the lifter's next act is to hand the phone
   * on, so `verify` says plainly that some of it is still here and that nothing here
   * can say how much.
   *
   * The handoff record is cleared alongside the database. It lives in `localStorage`
   * rather than IndexedDB, so `clearAll` does not reach it -- and it holds lift names
   * and working weights, which makes it exactly the kind of thing section 10.8 is
   * about. A delete that emptied four object stores and left a warm-up ladder sitting
   * in another one would be the most convincing possible way to fail this.
   *
   * The offline cache is deliberately untouched; the reasoning is in `DELETE_NOTES`.
   *
   * The screen is left before the write, and every first-use note is cleared with it:
   * they each report a press made against a logbook that no longer exists.
   */
  async #deleteAll(): Promise<void> {
    const repository = this.repository;
    const deletion = this.deletion;
    if (repository === null || deletion === null) return;

    this.deletion = null;
    this.screen = 'home';
    this.backupDone = false;
    this.markdownDone = false;
    this.refusals = [];
    this.restoreDone = false;
    this.restoreProblem = null;
    this.pending = null;
    if (repository.durable) this.saveState = 'unsaved';

    try {
      await repository.clearAll();
    } catch {
      this.deleteProblem = 'write';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    this.handoff?.clear();
    this.offer = null;

    let written: TrainingLogbookBackup;
    try {
      written = await repository.exportSnapshot();
    } catch {
      this.deleteProblem = 'verify';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    // Before the verdict, so the screen shows what the database holds even -- most of
    // all -- where the two disagree.
    await this.#reload();

    if (!nothingLeft(written.data)) {
      this.deleteProblem = 'verify';
      if (repository.durable) this.saveState = 'failed';
      return;
    }

    if (repository.durable) this.saveState = 'saved';
    this.deleteDone = true;
    this.dispatchEvent(
      new CustomEvent<LocalDataClearedDetail>(LOCAL_DATA_CLEARED_EVENT, {
        detail: { workoutCount: deletion.workoutCount },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emitWorkout(name: string, workoutId: LogbookId): void {
    this.dispatchEvent(
      new CustomEvent<WorkoutEventDetail>(name, {
        detail: { workoutId },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * Names, as a sentence reads them.
 *
 * The sentence around it is written so that one name and four read the same way.
 * These are catalogue names rather than anything a lifter typed -- nothing a
 * record carries reaches a screen -- but the count is not knowable, so a plural
 * agreement written into the copy would be a second string to get wrong.
 */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-training-logbook': PtkTrainingLogbook;
  }
}
