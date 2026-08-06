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
 * WHAT IS NOT HERE YET, AND IS NOT PRETENDED TO BE
 *
 * Custom exercises, the rest timer, editing history, reading a backup back in,
 * Markdown export and the deletion flow are all later milestones. Section 0.4
 * forbids standing in for them with a disabled control or a "coming soon", so none of
 * them has one: the only thing said about a missing feature is said in prose, where a
 * lifter would otherwise go looking for it -- reading a backup file back in, which is
 * the one a person will hunt for the moment they have downloaded a file.
 */

import { convertWeight, formatWeight, type WeightUnit } from '@platform-toolkit/domain';
import {
  SEGMENTED_CHANGE_EVENT,
  type Choice,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { backupFilename, serializeBackup } from '../core/backup.js';
import { exerciseOptions, loadFor } from '../core/catalog.js';
import { createProfile, findProfile, updateProfileEquipment } from '../core/equipment.js';
import { handoffLifts, workoutFromHandoff } from '../core/handoff.js';
import type { PreviousPerformance } from '../core/previous.js';
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
  createWorkout,
  performance,
  repeatWorkout,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from '../core/session.js';
import { workoutDurationMillis, type WorkoutSummary } from '../core/summary.js';
import { defaultSettings, type TrainingLogbookRepository } from '../storage/repository.js';
import type {
  CalendarDay,
  EffortSetting,
  EquipmentProfile,
  EquipmentSnapshot,
  ExerciseOption,
  Instant,
  LogbookId,
  LogbookSettings,
  WarmupHandoff,
  WorkoutExercise,
  WorkoutSession,
} from '../types.js';

import {
  DONE_NOTES,
  EFFORT_SETTING_LABELS,
  EFFORT_SETTING_NOTES,
  HANDOFF_NOTES,
  HOME_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  UNIT_LABELS,
  formatDuration,
  type SaveState,
} from './copy.js';
import { EFFORT_SETTING_FIELD, UNIT_SETTING_FIELD, actionOf, fieldOf } from './dataset.js';
import { formatVolume } from './format.js';
import {
  BACKUP_EXPORTED_EVENT,
  SET_COMPLETED_EVENT,
  WORKOUT_COMPLETED_EVENT,
  WORKOUT_SAVED_EVENT,
  WORKOUT_STARTED_EVENT,
  type BackupExportedDetail,
  type SetCompletedDetail,
  type WorkoutEventDetail,
} from './events.js';
import {
  WORKOUT_CHANGED_EVENT,
  WORKOUT_FINISHED_EVENT,
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
import type { PlannedExercise } from './plan.js';
import { WORKOUT_PLANNED_EVENT, type WorkoutPlannedDetail } from './ptk-workout-builder.js';
import { WORKOUT_REPEAT_EVENT, type WorkoutRepeatDetail } from './ptk-workout-history.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const TRAINING_LOGBOOK_TAG = 'ptk-training-logbook';

/**
 * Which screen is showing.
 *
 * A union rather than a router. This tool is four screens with one path between them,
 * and a URL per screen would put a lifter's session in their history -- a back button
 * that unwinds a workout is worse than one that leaves the page.
 */
type Screen = 'home' | 'build' | 'active' | 'done';

const START_ACTION = 'start-workout';
const RESUME_ACTION = 'resume-workout';
const CANCEL_PLAN_ACTION = 'cancel-plan';
const BACKUP_ACTION = 'backup';
const HOME_ACTION = 'home';
const HANDOFF_START_ACTION = 'start-handoff';
const HANDOFF_DISCARD_ACTION = 'discard-handoff';

/** How many history rows the home screen reads. Section 17.2's budget, applied. */
const HISTORY_LIMIT = 20;

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
 * `events.ts`: five events carrying identifiers and counts.
 *
 * Stopping propagation and not immediate propagation, so a consumer that deliberately
 * listens on this element -- inside the boundary, having imported the constant -- still
 * hears it. What is cut off is everything above.
 */
function stopHere(event: Event): void {
  event.stopPropagation();
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
   * A property because this package must not read a clock, and because the correct
   * value cannot be derived from an instant without knowing the zone. The host builds
   * it from `getFullYear`/`getMonth`/`getDate` -- never `toISOString`, which is UTC and
   * gives yesterday to everyone west of Greenwich in the evening.
   */
  @property({ attribute: false }) today: CalendarDay = '';

  /** The current instant, supplied for the same reason as {@link today}. */
  @property({ attribute: false }) now: () => Instant = () => new Date().toISOString();

  /** A fresh opaque identifier. Overridable so a test can make them predictable. */
  @property({ attribute: false }) nextId: () => LogbookId = () => crypto.randomUUID();

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

  @state() private screen: Screen = 'home';
  @state() private settings: LogbookSettings = defaultSettings();
  @state() private active: WorkoutSession | null = null;
  @state() private finished: WorkoutSession | null = null;
  @state() private history: readonly WorkoutSummary[] = [];
  @state() private exercises: readonly ExerciseOption[] = exerciseOptions([]);
  @state() private profiles: readonly EquipmentProfile[] = [];

  /** Whether the library could be read at all. See {@link #reloadProfiles}. */
  @state() private profilesUnreadable = false;

  /** Whether the last Repeat press failed to read its workout back. */
  @state() private repeatFailed = false;

  /** `null` until the first read has told us whether this browser stores anything. */
  @state() private saveState: SaveState | null = null;

  /** Set after a file is handed to the browser, so nobody presses it twice. */
  @state() private backupDone = false;

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

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.addEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.addEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSetting);
    this.addEventListener(RACK_CHANGED_EVENT, this.#onRack);
    this.addEventListener(PROFILE_SAVED_EVENT, this.#onProfileSaved);
    this.addEventListener(PROFILE_APPLIED_EVENT, this.#onProfileApplied);
    this.addEventListener(PROFILE_REMOVED_EVENT, this.#onProfileRemoved);
    this.addEventListener(WORKOUT_REPEAT_EVENT, this.#onRepeat);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.removeEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.removeEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSetting);
    this.removeEventListener(RACK_CHANGED_EVENT, this.#onRack);
    this.removeEventListener(PROFILE_SAVED_EVENT, this.#onProfileSaved);
    this.removeEventListener(PROFILE_APPLIED_EVENT, this.#onProfileApplied);
    this.removeEventListener(PROFILE_REMOVED_EVENT, this.#onProfileRemoved);
    this.removeEventListener(WORKOUT_REPEAT_EVENT, this.#onRepeat);
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

  override render(): TemplateResult {
    switch (this.screen) {
      case 'build':
        return this.#buildScreen();
      case 'active':
        return this.#activeScreen();
      case 'done':
        return this.#doneScreen();
      case 'home':
        return this.#homeScreen();
    }
  }

  #homeScreen(): TemplateResult {
    return html`
      ${this.#saveLine()} ${this.#handoffCard()}
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
        <ptk-workout-history
          .workouts=${this.history}
          ?busy=${this.active !== null}
        ></ptk-workout-history>
        ${this.repeatFailed ? html`<p class="note">${HOME_NOTES.repeatFailed}</p>` : nothing}
      </section>

      <section class="section">
        <ptk-equipment-library
          .equipment=${this.settings.equipment}
          .profiles=${this.profiles}
          ?unreadable=${this.profilesUnreadable}
          ?remembers=${this.repository?.durable ?? true}
        ></ptk-equipment-library>
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
      </section>

      <section class="section">
        <h2>${HOME_NOTES.backupHeading}</h2>
        <p class="note">${HOME_NOTES.backupNote}</p>
        <div class="actions">
          <ptk-button variant="secondary" data-action=${BACKUP_ACTION}
            >${HOME_NOTES.backup}</ptk-button
          >
        </div>
        ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
        <p class="note">${HOME_NOTES.restoreNotYet}</p>
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
      ${this.#saveLine()}
      <ptk-workout-builder
        .today=${this.today}
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
      ${this.#saveLine()}
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
      ${this.#saveLine()}
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
        ${this.backupDone ? html`<p class="note">${HOME_NOTES.backupDone}</p>` : nothing}
      </section>
    `;
  }

  /** Section 18.9's phrase, on every screen rather than only on the home one. */
  #saveLine(): TemplateResult | typeof nothing {
    const state = this.saveState;
    if (state === null) return nothing;
    const note = SAVE_STATE_NOTES[state];
    const warn = state === 'unavailable' || state === 'failed';
    return html`<p class=${warn ? 'save warn' : 'save'}>
      ${SAVE_STATES[state]}${note === undefined ? nothing : html` ${note}`}
    </p>`;
  }

  async #reload(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    const [settings, active, history, customs] = await Promise.all([
      repository.loadSettings(),
      repository.loadActiveWorkout(),
      repository.listWorkouts({ limit: HISTORY_LIMIT }),
      repository.listExercises(),
    ]);
    this.settings = settings;
    this.active = active;
    this.history = history;
    this.exercises = exerciseOptions(customs);
    this.saveState = repository.durable ? 'saved' : 'unavailable';
    // A resumed session lands on the logging screen rather than behind a button on
    // the home one only when the lifter asks. Section 7.2: reopening the tool
    // mid-workout should not lose the session, and should not assume the reason it
    // was reopened was to carry on -- somebody checking last week's squats would
    // otherwise be dropped into today's.
    if (active === null && this.screen === 'active') this.screen = 'home';
    await this.#reloadProfiles();
  }

  /**
   * Reads the saved gyms, on its own and behind a catch.
   *
   * Deliberately not a fifth entry in the `Promise.all` above, which has no catch and
   * rejects as a unit. A single corrupt profile row would then take the settings, the
   * workout in progress, the history and the exercise list with it -- a blank tool at
   * boot, with the JSON backup a lifter would reach for blocked by the same record.
   * The library is the one thing here the tool works without, so it fails alone and
   * says so on screen rather than reading as a library nobody has written to.
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
    void this.#persist(session, false);
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
    let session = repeatWorkout(source, context, { localDate: this.today });
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
    void this.#persist(session, false);
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
    this.active = session;
    if (completedSetId !== null) {
      this.dispatchEvent(
        new CustomEvent<SetCompletedDetail>(SET_COMPLETED_EVENT, {
          detail: { workoutId: session.id, setId: completedSetId },
          bubbles: true,
          composed: true,
        }),
      );
    }
    void this.#persist(session, false);
  };

  readonly #onFinished = (event: CustomEvent<WorkoutFinishedDetail>): void => {
    stopHere(event);
    const { session } = event.detail;
    this.active = null;
    this.finished = session;
    this.screen = 'done';
    this.backupDone = false;
    this.#emitWorkout(WORKOUT_COMPLETED_EVENT, session.id);
    void this.#persist(session, true);
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
    }
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
    void this.#writeLibrary((repository) => repository.saveEquipmentProfile(profile));
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
    void this.#writeLibrary((repository) => repository.deleteEquipmentProfile(id));
  };

  /**
   * Writes a library change and reads the library back.
   *
   * Read back rather than patched into `profiles` locally, because the list on screen
   * has to be the list in the database: a save that was rejected, or that landed under
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
    await this.#reloadProfiles();
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
        this.unramped = [];
        this.repeatFailed = false;
        void this.#reload();
        return;
      case BACKUP_ACTION:
        void this.#backup();
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
      localDate: this.today,
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
    await this.#persist(session, false);
  }

  /**
   * Writes the session and says on screen how it went.
   *
   * A finished workout goes through `completeWorkout` rather than
   * `saveActiveWorkout` because clearing the active marker and storing the workout
   * have to happen in one transaction -- two writes would leave, on a crash between
   * them, a finished workout that the tool still offers to carry on with.
   */
  async #persist(session: WorkoutSession, finished: boolean): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    if (!repository.durable) {
      // Nothing to await and nothing to promise. The tool works for this tab and the
      // line above the screen already says so.
      return;
    }

    this.saveState = 'unsaved';
    try {
      if (finished) await repository.completeWorkout(session);
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
    if (finished) void this.#refreshHistory();
  }

  async #refreshHistory(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    this.history = await repository.listWorkouts({ limit: HISTORY_LIMIT });
  }

  /**
   * Section 10.4's backup, handed straight to the browser.
   *
   * The anchor is never attached to the document: a detached one still opens the
   * download, and attaching it would put a control in the light DOM of a page that
   * renders everything else inside a shadow root.
   *
   * The filename carries the lifter's own day rather than an instant, because a file
   * named for a UTC timestamp sorts oddly in a folder for anybody who trains in the
   * evening west of Greenwich.
   */
  async #backup(): Promise<void> {
    const repository = this.repository;
    if (repository === null) return;
    const snapshot = await repository.exportSnapshot();
    const url = URL.createObjectURL(
      new Blob([serializeBackup(snapshot)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFilename(this.today);
    link.click();
    URL.revokeObjectURL(url);

    this.backupDone = true;
    this.dispatchEvent(
      new CustomEvent<BackupExportedDetail>(BACKUP_EXPORTED_EVENT, {
        detail: { workoutCount: snapshot.data.workouts.length },
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
