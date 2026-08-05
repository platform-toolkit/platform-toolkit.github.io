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
 * Milestone 1. Warm-up generation, notes, RPE, repeating a session, custom exercises,
 * the rest timer, editing history, reading a backup back in, Markdown export and the
 * deletion flow are all later milestones. Section 0.4 forbids standing in for them with
 * a disabled control or a "coming soon", so none of them has one: the only thing said
 * about a missing feature is said in prose, where a lifter would otherwise go looking
 * for it -- reading a backup file back in, which is the one a person will hunt for the
 * moment they have downloaded a file.
 */

import type { WeightUnit } from '@platform-toolkit/domain';
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
import {
  addExercise,
  createWorkout,
  performance,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from '../core/session.js';
import { workoutDurationMillis, type WorkoutSummary } from '../core/summary.js';
import { defaultSettings, type TrainingLogbookRepository } from '../storage/repository.js';
import type {
  CalendarDay,
  ExerciseOption,
  Instant,
  LogbookId,
  LogbookSettings,
  WorkoutSession,
} from '../types.js';

import {
  DONE_NOTES,
  HOME_NOTES,
  SAVE_STATES,
  SAVE_STATE_NOTES,
  UNIT_LABELS,
  formatDuration,
  type SaveState,
} from './copy.js';
import { actionOf } from './dataset.js';
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
import { WORKOUT_PLANNED_EVENT, type WorkoutPlannedDetail } from './ptk-workout-builder.js';

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

/** How many history rows the home screen reads. Section 17.2's budget, applied. */
const HISTORY_LIMIT = 20;

const UNIT_CHOICES: readonly Choice[] = [
  { value: 'lb', label: UNIT_LABELS.lb },
  { value: 'kg', label: UNIT_LABELS.kg },
];

function isUnit(value: string): value is WeightUnit {
  return value === 'kg' || value === 'lb';
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

    .units {
      display: grid;
      gap: var(--ptk-space-sm);
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

  @state() private screen: Screen = 'home';
  @state() private settings: LogbookSettings = defaultSettings();
  @state() private active: WorkoutSession | null = null;
  @state() private finished: WorkoutSession | null = null;
  @state() private history: readonly WorkoutSummary[] = [];
  @state() private exercises: readonly ExerciseOption[] = exerciseOptions([]);

  /** `null` until the first read has told us whether this browser stores anything. */
  @state() private saveState: SaveState | null = null;

  /** Set after a file is handed to the browser, so nobody presses it twice. */
  @state() private backupDone = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.addEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.addEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onUnit);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(WORKOUT_PLANNED_EVENT, this.#onPlanned);
    this.removeEventListener(WORKOUT_CHANGED_EVENT, this.#onChanged);
    this.removeEventListener(WORKOUT_FINISHED_EVENT, this.#onFinished);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onUnit);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Reloading on the property rather than in `firstUpdated`, because a host that
    // wires the repository a tick after upgrade is the ordinary case and a one-shot
    // read would leave that host on an empty logbook forever.
    if (changed.has('repository')) void this.#reload();
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
      ${this.#saveLine()}
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
        <ptk-workout-history .workouts=${this.history}></ptk-workout-history>
      </section>

      <section class="section units">
        <h2>${HOME_NOTES.settingsHeading}</h2>
        <ptk-segmented
          label=${HOME_NOTES.unitLabel}
          .choices=${UNIT_CHOICES}
          .value=${this.settings.displayUnit}
        ></ptk-segmented>
        <p class="note">${HOME_NOTES.unitNote}</p>
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

  #buildScreen(): TemplateResult {
    return html`
      ${this.#saveLine()}
      <ptk-workout-builder
        .today=${this.today}
        .unit=${this.settings.displayUnit}
        .exercises=${this.exercises}
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
      <ptk-active-workout
        .session=${this.active}
        .unit=${this.settings.displayUnit}
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
        // Every set from the builder is a working set. Warm-ups are generated in
        // Milestone 2 and back-offs and AMRAPs are added mid-session, so `working`
        // is the only kind this screen can honestly produce.
        kind: 'working' as const,
        performance: performance(load, planned.reps),
      }));
      session = addExercise(session, context, {
        exerciseId: planned.option.id,
        displayName: planned.option.name,
        loading: planned.option.loading,
        plan,
      });
    }
    session = startWorkout(session, context);

    this.active = session;
    this.screen = 'active';
    this.#emitWorkout(WORKOUT_STARTED_EVENT, session.id);
    void this.#persist(session, false);
  };

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

  readonly #onUnit = (event: CustomEvent<SegmentedChangeDetail>): void => {
    const { value } = event.detail;
    if (!isUnit(value) || value === this.settings.displayUnit) return;
    const settings = { ...this.settings, displayUnit: value };
    this.settings = settings;
    void this.repository?.saveSettings(settings);
  };

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
        void this.#reload();
        return;
      case BACKUP_ACTION:
        void this.#backup();
        return;
      default:
        return;
    }
  };

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

declare global {
  interface HTMLElementTagNameMap {
    'ptk-training-logbook': PtkTrainingLogbook;
  }
}
