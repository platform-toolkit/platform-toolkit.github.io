// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen a lifter holds between sets.
 *
 * This is the tool. Section 21's first research finding is that logging friction is
 * both the most repeated complaint about training apps and the most repeated praise
 * for the good ones, and section 7.5's answer is one tap when the plan and the result
 * agree -- which is most sets, most of the time. Everything else on this screen is
 * arranged not to get in the way of that tap.
 *
 * WHY THE EDITOR IS NOT ALWAYS OPEN
 *
 * A weight box and a reps box beside every set would make the common case slower to
 * serve the uncommon one: a lifter who did exactly what they planned would still be
 * looking at two empty fields and deciding whether to fill them in. So the row shows
 * the plan and a Done button, and the editor is one more tap behind it. Section 14.3.
 *
 * One editor is open at a time, and opening a second closes the first. Not a
 * limitation -- a phone screen with three editors open is a screen where the Done
 * button you meant to press has moved.
 *
 * WHY UNDO IS BESIDE DONE AND NOT IN A MENU
 *
 * Section 14.3 again: a tap that cannot be taken back is a tap nobody makes
 * confidently, and hesitating over a completion control is the friction this screen
 * exists to remove. `undoSet` clears the performance with the status, so undo means
 * "I did not do that" rather than "I did that but it is not ticked".
 *
 * WHERE THE NOTES ARE, AND WHY NO BUTTON SAVES ONE
 *
 * Section 7.9 asks for one note on the workout and one on each lift, and it
 * asks for them unobtrusive until they are wanted. So each is a quiet button
 * that reveals a box -- the same shape as the set editor, one open at a time,
 * for the same reason -- and a note already written shows as one muted line of
 * the lifter's own words rather than as a badge saying there is one.
 *
 * Nothing is pressed to keep it. The text is written half a second after the
 * last keystroke, which is section 10.2's debounce, and immediately on leaving
 * the box. It is also folded into every other edit this screen makes, so a
 * lifter who types a note and taps Done on a set in the same breath keeps both
 * whichever order the two events arrive in. Applying the same note twice costs
 * nothing: the core hands back the session it was given when the text has not
 * moved, and `#changed` is skipped on that.
 *
 * A *set* note is not here. The core stores one and section 7.9 only asks for
 * it if it fits cleanly; a fold on each of forty rows is forty controls in the
 * way of the one tap this screen exists for, so it stays unwritten until there
 * is a place for it that is not this list.
 *
 * WHAT THIS ELEMENT DOES NOT OWN
 *
 * Storage, the clock and the workout itself. The session arrives as a property and
 * every change leaves as an event carrying the next one; the root persists it and
 * hands it back. A screen that wrote to a database between two taps would be a screen
 * whose Done button could fail, and section 18.9's promise is that a ticked set is
 * saved -- which is a promise only the thing holding the repository can make.
 */

import type { Weight, WeightUnit } from '@platform-toolkit/domain';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  TEXT_AREA_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type Choice,
  type NumberFieldChangeDetail,
  type TextAreaChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { loadFor, takesWeight } from '../core/catalog.js';
import { sessionLoadings, type SetLoading } from '../core/loading.js';
import type { PreviousPerformance } from '../core/previous.js';
import {
  completeSet,
  finishWorkout,
  findSet,
  findWorkoutExercise,
  outstandingSets,
  recordSet,
  setExerciseNote,
  setWorkoutNote,
  undoSet,
  type FinishDisposition,
} from '../core/session.js';
import { setWasEdited, workoutProgress } from '../core/summary.js';
import type {
  EquipmentSnapshot,
  Instant,
  LogbookId,
  SetLoad,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { ACTIVE_NOTES, FINISH_DISPOSITIONS, FINISH_DISPOSITION_NOTES, SET_KINDS } from './copy.js';
import {
  DONE_REPS_FIELD,
  DONE_WEIGHT_FIELD,
  WORKOUT_NOTE_KEY,
  actionOf,
  exerciseNoteId,
  exerciseNoteKey,
  fieldOf,
  noteOf,
  setOf,
} from './dataset.js';
import { formatPerformance, formatSetRun } from './format.js';
import { renderLoading } from './loading-view.js';

/** The plates for every set of the session on screen, or none because there is no rack. */
type Loadings = ReadonlyMap<LogbookId, SetLoading> | null;

/**
 * A session after an edit, on its way to storage.
 *
 * `completedSetId` names a set that moved *into* `complete` on this change, and is
 * `null` for every other edit. It is here so the root can dispatch section 12.5's
 * `training-set-completed` without diffing two sessions to work out what happened --
 * a diff that would have to be written twice, once here and once wrong.
 */
export interface WorkoutChangedDetail {
  readonly session: WorkoutSession;
  readonly completedSetId: LogbookId | null;
}

/** A session the lifter has declared over. Separate because the root routes it. */
export interface WorkoutFinishedDetail {
  readonly session: WorkoutSession;
}

/** Fired for every edit to the live session, including each one-tap completion. */
export const WORKOUT_CHANGED_EVENT = 'ptk-workout-changed';

/** Fired once, when the lifter finishes. Never on the way there. */
export const WORKOUT_FINISHED_EVENT = 'ptk-workout-finished';

/** The tag `defineTrainingLogbook()` registers this under. */
export const ACTIVE_WORKOUT_TAG = 'ptk-active-workout';

const COMPLETE_ACTION = 'complete';
const UNDO_ACTION = 'undo';
const EDIT_ACTION = 'edit';
const SAVE_ACTION = 'save-edit';
const FINISH_ACTION = 'finish';
const FINISH_CANCEL_ACTION = 'finish-cancel';
const FINISH_CONFIRM_ACTION = 'finish-confirm';
const NOTE_ACTION = 'note';

/**
 * Section 10.2's short debounce, in milliseconds.
 *
 * Long enough that a sentence is one write rather than forty, short enough that
 * a phone taken out of a hand mid-note has already stored it. Not a property:
 * the tests reach the same code through the immediate flush on leaving the box,
 * and a knob a test sets to zero is a knob no test exercises at its real value.
 */
const NOTE_DELAY_MILLIS = 500;

/** Which disposition the finish panel is on. Neither is preselected; see copy. */
function isDisposition(value: string): value is FinishDisposition {
  return Object.hasOwn(FINISH_DISPOSITIONS, value);
}

export class PtkActiveWorkout extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
      overflow-wrap: anywhere;
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
      overflow-wrap: anywhere;
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .progress {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-md);
    }

    /* A heading with its quiet note control at the far end of the same line. */
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ptk-space-xs);
    }

    /*
     * The lifter's own words read back, so it is muted like .previous and
     * deliberately not styled as .note -- one is a record and the other is the
     * tool talking about itself. Newlines are kept: a note typed as a list was
     * meant as one.
     */
    .written {
      margin: var(--ptk-space-xs) 0 0;
      color: var(--ptk-color-text-muted);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .note-box {
      margin-top: var(--ptk-space-xs);
    }

    .exercise + .exercise {
      margin-top: var(--ptk-space-lg);
    }

    /*
     * Section 7.8's line. Muted like the notes above, but deliberately not shrunk to
     * their smaller size: this one is numbers, read at arm's length between two sets,
     * which is the furthest this screen ever gets from a lifter's eyes.
     */
    .previous {
      margin: var(--ptk-space-xs) 0 0;
      color: var(--ptk-color-text-muted);
      overflow-wrap: anywhere;
    }

    ul {
      list-style: none;
      margin: var(--ptk-space-sm) 0 0;
      padding: 0;
    }

    li {
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      padding: var(--ptk-space-sm);
      background: var(--ptk-color-surface-raised);
    }

    li + li {
      margin-top: var(--ptk-space-sm);
    }

    /*
     * Done is the widest thing on the row on purpose. It is pressed with a thumb, by
     * somebody who is not looking closely, more often than everything else on this
     * screen put together.
     */
    .set-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ptk-space-sm);
    }

    .set-what {
      flex: 1 1 8rem;
      min-width: 0;
    }

    .set-plan {
      font-size: var(--ptk-font-size-lg);
      overflow-wrap: anywhere;
    }

    .set-kind {
      display: block;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .set-controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs);
    }

    .set-controls ptk-button,
    .actions ptk-button,
    .editor ptk-button {
      max-width: 100%;
    }

    .done .set-plan {
      color: var(--ptk-color-text-muted);
    }

    .status {
      margin-top: var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .loading {
      margin-top: var(--ptk-space-xs);
    }

    /*
     * Not muted, unlike .status beside it. This is an instruction a lifter carries
     * out with their hands while looking at a bar, and it is the one line on the row
     * that is read at arm's length -- greying it out to match the rest of the small
     * print would be styling it by size rather than by what it is for.
     */
    .loading-note {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
    }

    .editor {
      margin-top: var(--ptk-space-sm);
      padding-top: var(--ptk-space-sm);
      border-top: 1px solid var(--ptk-color-border);
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .editor .numbers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-lg);
    }

    .finish {
      margin-top: var(--ptk-space-lg);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface-sunken);
    }

    .finish h3 {
      margin-bottom: var(--ptk-space-xs);
    }
  `;

  /** The live session. `null` renders nothing rather than an empty workout. */
  @property({ attribute: false }) session: WorkoutSession | null = null;

  /** The unit the editor's weight box is typed in. Section 11.4. */
  @property({ attribute: false }) unit: WeightUnit = 'lb';

  /**
   * The rack this session is being lifted on, or `null` where none has been chosen.
   *
   * `null` draws no plates anywhere, and that is the whole reason `settings.equipment`
   * starts out null rather than as the catalogue default: a lifter who has never opened
   * the equipment screen would otherwise be shown a diagram of somebody else's gym under
   * every set, in a tool whose one job is to record what actually happened.
   */
  @property({ attribute: false }) equipment: EquipmentSnapshot | null = null;

  /**
   * The clock, supplied.
   *
   * Every core function this screen calls takes the instant the operation happened,
   * and a pure package cannot read one. Passing it in rather than calling `Date.now()`
   * here is also what makes the browser test able to assert on a `completedAt`.
   */
  @property({ attribute: false }) now: () => Instant = () => new Date().toISOString();

  /**
   * What each exercise here was last done for, keyed by `exerciseId`. Section 7.8.
   *
   * Handed down rather than read here, because reading it means walking the history
   * and this element re-renders on every keystroke in the weight box. An exercise
   * missing from the map has no comparable history and gets no line at all -- section
   * 7.8 again, which asks for nothing rather than an empty panel.
   */
  @property({ attribute: false }) previous: ReadonlyMap<string, PreviousPerformance> = new Map();

  /** The one set whose editor is open, or `null`. */
  @state() private editing: LogbookId | null = null;

  @state() private editWeight = '';
  @state() private editReps = '';

  /** Whether the finish panel is up. Section 7.12 makes it a step, not a button. */
  @state() private finishing = false;

  /** The one note box that is open, by key, or `null`. See `dataset.ts`. */
  @state() private noting: string | null = null;

  /**
   * What that box holds, which is not state and must not become it.
   *
   * A field rather than `@state` on purpose. This changes on every keystroke,
   * and a re-render of this screen walks every set of every exercise -- on a
   * long session that is the whole template diffed to move a caret one place.
   * Nothing needs the re-render either: the box already holds what was typed,
   * and it adopts its own value before reporting it, so the binding below is
   * only ever writing back what is already there.
   */
  #noteText = '';

  /** Section 10.2's timer, or `null` when nothing is waiting to be written. */
  #noteTimer: ReturnType<typeof setTimeout> | null = null;

  /** The answer to "what about the sets you did not do", unset until given. */
  @state() private disposition: FinishDisposition | null = null;

  /**
   * The last answer `sessionLoadings` gave, and what it was asked about.
   *
   * A cache rather than a computation in `render()`, because the search behind it is a
   * subset-sum over the rack and this screen re-renders on every keystroke in the weight
   * box -- typing "1", "14", "142" would run it three times to produce the same plates.
   * Both keys are compared by identity, which is sound because a session is replaced
   * whole on every edit and a snapshot is only ever handed down from the root.
   */
  #loadings: { session: WorkoutSession; equipment: EquipmentSnapshot; answers: Loadings } | null =
    null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(TEXT_AREA_CHANGE_EVENT, this.#onText);
    // Composed, so one listener on the host catches a box inside a child's own
    // shadow root. This is what makes the note already written by the time a
    // lifter's next tap lands: moving focus happens on the press, and the tap
    // that took it is a separate event afterwards.
    this.addEventListener('focusout', this.#onFocusOut);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onValue);
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(TEXT_AREA_CHANGE_EVENT, this.#onText);
    this.removeEventListener('focusout', this.#onFocusOut);
    this.removeEventListener('click', this.#onClick);
    // Dropped rather than flushed. An event from a detached element reaches
    // nobody, so a write here would be a write that silently did not happen --
    // and the focusout above has already run for every way off this screen,
    // because leaving it means pressing something.
    this.#clearNoteTimer();
    super.disconnectedCallback();
  }

  /** Waits for the controls as well as for this element. Section 5.8. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.renderRoot.querySelectorAll('*');
    await Promise.all(
      [...children].filter((node) => node instanceof LitElement).map((node) => node.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult | typeof nothing {
    const session = this.session;
    if (session === null) return nothing;
    const progress = workoutProgress(session);
    const loadings = this.#loadingsFor(session);

    return html`
      <h2>${session.title ?? session.localDate}</h2>
      <p class="progress">
        ${String(progress.completed)} of ${String(progress.total)} ${ACTIVE_NOTES.setsDone}
      </p>
      ${session.exercises.map((exercise) => this.#exercise(session, exercise, loadings))}
      ${
        this.finishing
          ? this.#finishPanel(session)
          : html`
              ${
                // At the foot rather than under the title. A workout note is
                // written at the end of one, and a written note kept at the top
                // would push the first lift off a phone every time the screen
                // was opened.
                this.#noteSurface(session, WORKOUT_NOTE_KEY)
              }
              <div class="actions">
                <ptk-button variant="primary" data-action=${FINISH_ACTION}
                  >${ACTIVE_NOTES.finish}</ptk-button
                >
                ${this.#noteButton(WORKOUT_NOTE_KEY, ACTIVE_NOTES.workoutNote)}
              </div>
            `
      }
    `;
  }

  /**
   * The plates for this session, computed at most once per session.
   *
   * Returns `null` where there is no rack, which is a different answer from a map of
   * `none` entries: the first draws nothing because the tool does not know the gym, and
   * the second because the exercise takes no plates.
   */
  #loadingsFor(session: WorkoutSession): Loadings {
    const equipment = this.equipment;
    if (equipment === null) return null;
    const cached = this.#loadings;
    if (cached !== null && cached.session === session && cached.equipment === equipment) {
      return cached.answers;
    }
    const answers = sessionLoadings(session, equipment);
    this.#loadings = { session, equipment, answers };
    return answers;
  }

  #exercise(
    session: WorkoutSession,
    exercise: WorkoutExercise,
    loadings: Loadings,
  ): TemplateResult {
    const note = exerciseNoteKey(exercise.id);
    return html`<section class="exercise">
      <div class="head">
        <h3>${exercise.displayName}</h3>
        ${this.#noteButton(note, this.#exerciseName(ACTIVE_NOTES.note, exercise))}
      </div>
      ${this.#previousLine(exercise)} ${this.#noteSurface(session, note)}
      <ul>
        ${exercise.sets.map((set) => this.#set(exercise, set, loadings))}
      </ul>
    </section>`;
  }

  /**
   * The control that reveals a note box, and nothing else.
   *
   * Quiet, like the set editor's toggle beside it, and carrying `expanded` for
   * the same reason: a control that reveals something has to say whether it
   * already has. The word on it is one word; which note it is belongs in the
   * accessible name, because "Note, Back squat" printed under a heading that
   * reads "Back squat" is the heading twice.
   */
  #noteButton(key: string, name: string): TemplateResult {
    return html`<ptk-button
      variant="quiet"
      data-action=${NOTE_ACTION}
      data-note=${key}
      .expanded=${this.noting === key}
      accessible-name=${name}
      >${ACTIVE_NOTES.note}</ptk-button
    >`;
  }

  /**
   * A note: the box while it is open, one muted line once it is not, nothing
   * at all where none has been written.
   *
   * The line is the note itself and not a mark saying there is one. A lifter's
   * own sentence about how the second set went is worth the two lines it takes,
   * and the alternative asks them to open a fold to find out whether it was
   * worth opening. The history list's "has notes" is a different thing: that is
   * a summary of a session it is not showing.
   */
  #noteSurface(session: WorkoutSession, key: string): TemplateResult | typeof nothing {
    if (this.noting !== key) {
      const written = this.#noteAt(session, key);
      return written === '' ? nothing : html`<p class="written">${written}</p>`;
    }
    return this.#noteBox(session, key);
  }

  /**
   * The box itself, wherever it is drawn.
   *
   * The value is the draft when this is the box being typed in and the stored
   * note when it is not, which is the whole of what the finish panel needs to
   * pick up an unwritten note mid-keystroke. It is also what keeps the binding
   * from fighting the caret: the box adopts its own text before reporting it,
   * so the string handed back here is the one already in it and lit-html
   * commits nothing.
   */
  #noteBox(session: WorkoutSession, key: string): TemplateResult {
    const spoken = this.#noteName(session, key);
    return html`<ptk-text-area
      class="note-box"
      data-note=${key}
      label=${key === WORKOUT_NOTE_KEY ? ACTIVE_NOTES.workoutNote : ACTIVE_NOTES.note}
      accessible-name=${spoken ?? nothing}
      .value=${this.noting === key ? this.#noteText : this.#noteAt(session, key)}
    ></ptk-text-area>`;
  }

  /**
   * The longer name a note box is announced by, or `null` where the label on
   * it already says which note it is.
   *
   * A session with eight lifts draws eight boxes labelled "Note", so a visitor
   * tabbing into the fifth is told nothing about which lift it belongs to --
   * while a visible "Note, Back squat" printed under a heading already reading
   * "Back squat" is the heading twice. The eye gets the short name and the ear
   * gets the long one.
   *
   * It extends the visible label rather than replacing it, which is WCAG 2.5.3:
   * the words somebody can see have to reach the control they can see. The
   * workout's own box is already named for what it is, so it gets nothing back
   * and renders no `aria-label` at all.
   */
  #noteName(session: WorkoutSession, key: string): string | null {
    const exerciseId = exerciseNoteId(key);
    if (exerciseId === null) return null;
    const exercise = findWorkoutExercise(session, exerciseId);
    return exercise === null ? null : this.#exerciseName(ACTIVE_NOTES.note, exercise);
  }

  /**
   * The one line of history section 7.8 puts on the logging screen.
   *
   * Above the sets rather than below them. It is context for the numbers about to be
   * typed, and a lifter reading down the card should meet it before the first row
   * rather than after the last -- which on a phone is off the bottom of the screen by
   * the time it would matter.
   *
   * A class of its own. `.note` is the tool talking about itself and this is the
   * lifter's own record read back to them, and the layout check needs to be able to
   * name one without matching the other.
   */
  #previousLine(exercise: WorkoutExercise): TemplateResult | typeof nothing {
    const last = this.previous.get(exercise.exerciseId);
    if (last === undefined) return nothing;
    // The day as it was stored. `../element/ptk-workout-history.ts` explains at
    // length why a `YYYY-MM-DD` is shown as one here and not handed to `Date`.
    return html`<p class="previous">
      ${ACTIVE_NOTES.lastTime} ${last.localDate}: ${formatSetRun(last.sets)}
    </p>`;
  }

  /**
   * One row. `data-kind` is on it for a reader outside the shadow root, not for us.
   *
   * The kind is already on screen as a word in `.set-kind`, and nothing in here reads
   * the attribute. What has no other way to see it is the layout check: a ramp and a
   * working set render from the same tag with the same classes, so a check driving the
   * tool through its controls could press Start on a warm-up it asked for and then
   * measure a screen where none was generated, with every selector still matching.
   */
  #set(exercise: WorkoutExercise, set: WorkoutSet, loadings: Loadings): TemplateResult {
    const done = set.status !== 'planned';
    const shown = set.performed ?? set.planned;
    const loading = loadings?.get(set.id) ?? null;
    return html`<li data-set=${set.id} data-kind=${set.kind} class=${done ? 'done' : ''}>
      <div class="set-head">
        <div class="set-what">
          <span class="set-kind">${SET_KINDS[set.kind]}</span>
          <span class="set-plan">${formatPerformance(shown)}</span>
        </div>
        <div class="set-controls">
          ${
            done
              ? html`<ptk-button
                  variant="secondary"
                  data-action=${UNDO_ACTION}
                  accessible-name=${this.#name(ACTIVE_NOTES.undo, exercise, set)}
                  >${ACTIVE_NOTES.undo}</ptk-button
                >`
              : html`<ptk-button
                  variant="primary"
                  data-action=${COMPLETE_ACTION}
                  accessible-name=${this.#name(ACTIVE_NOTES.complete, exercise, set)}
                  >${ACTIVE_NOTES.complete}</ptk-button
                >`
          }
          <ptk-button
            variant="quiet"
            data-action=${EDIT_ACTION}
            .expanded=${this.editing === set.id}
            accessible-name=${this.#name(ACTIVE_NOTES.edit, exercise, set)}
            >${ACTIVE_NOTES.edit}</ptk-button
          >
        </div>
      </div>
      ${
        // Under the head and above everything else, because it answers the question the
        // head just asked. A diagram below the editor would be off the bottom of a phone
        // on the one row a lifter has open.
        loading === null || this.equipment === null
          ? nothing
          : renderLoading(loading, this.equipment.plateUnit)
      }
      ${setWasEdited(set) ? html`<p class="status">${ACTIVE_NOTES.edited}</p>` : nothing}
      ${this.editing === set.id ? this.#editor(exercise) : nothing}
    </li>`;
  }

  /**
   * The editor, rendered inside the row it belongs to.
   *
   * Inside rather than in a dialog, so the `data-set` on the row routes its fields
   * without the editor having to carry the identifier a second time -- and so a
   * lifter can see the plan they are correcting while they correct it.
   */
  #editor(exercise: WorkoutExercise): TemplateResult {
    const weighted = takesWeight(exercise.loading);
    return html`<div class="editor">
      <p class="note">${ACTIVE_NOTES.editNote}</p>
      <div class="numbers">
        ${
          weighted
            ? html`<div data-field=${DONE_WEIGHT_FIELD}>
                <ptk-number-field
                  label=${ACTIVE_NOTES.editWeightLabel}
                  unit=${this.unit}
                  .value=${this.editWeight}
                ></ptk-number-field>
              </div>`
            : nothing
        }
        <div data-field=${DONE_REPS_FIELD}>
          <ptk-number-field
            label=${ACTIVE_NOTES.editRepsLabel}
            .value=${this.editReps}
          ></ptk-number-field>
        </div>
      </div>
      <div>
        <ptk-button variant="primary" data-action=${SAVE_ACTION}>${ACTIVE_NOTES.save}</ptk-button>
      </div>
    </div>`;
  }

  /**
   * Section 7.12's finish flow, as one panel rather than two screens.
   *
   * The question about outstanding sets only appears when there are some, and neither
   * answer is preselected -- `FINISH_DISPOSITIONS` says why. With nothing outstanding
   * there is nothing to ask, so the panel is a confirmation and the disposition never
   * matters; `leave` is passed because it changes nothing.
   */
  #finishPanel(session: WorkoutSession): TemplateResult {
    const outstanding = outstandingSets(session);
    const choices: readonly Choice[] = Object.entries(FINISH_DISPOSITIONS).map(
      ([value, label]) => ({ value, label }),
    );
    const ready = outstanding.length === 0 || this.disposition !== null;

    return html`<div class="finish">
      <h3>${ACTIVE_NOTES.finishHeading}</h3>
      <p class="note">${ACTIVE_NOTES.finishFinal}</p>
      ${
        outstanding.length === 0
          ? html`<p class="note">${ACTIVE_NOTES.finishAllDone}</p>`
          : html`
              <p class="note">${ACTIVE_NOTES.outstandingHeading}</p>
              <ptk-choice-group
                label=${ACTIVE_NOTES.outstandingHeading}
                .choices=${choices}
                .value=${this.disposition}
              ></ptk-choice-group>
              ${
                this.disposition === null
                  ? nothing
                  : html`<p class="note">${FINISH_DISPOSITION_NOTES[this.disposition]}</p>`
              }
            `
      }
      ${
        // Section 7.12.4's last chance at a note, drawn open rather than behind
        // the toggle at the foot of the screen -- which is withdrawn while this
        // panel is up, so there is never a second box for the same note.
        this.#noteBox(session, WORKOUT_NOTE_KEY)
      }
      <div class="actions">
        <ptk-button variant="primary" data-action=${FINISH_CONFIRM_ACTION} ?disabled=${!ready}
          >${ACTIVE_NOTES.finishConfirm}</ptk-button
        >
        <ptk-button variant="secondary" data-action=${FINISH_CANCEL_ACTION}
          >${ACTIVE_NOTES.finishCancel}</ptk-button
        >
      </div>
    </div>`;
  }

  /**
   * A control's accessible name, because "Done" forty times over is not one.
   *
   * A screen reader moving by control on a session with eight exercises hears "Done,
   * Done, Done" with nothing to distinguish them. The exercise and the set's position
   * within it are what a sighted user reads off the row above the button.
   */
  #name(verb: string, exercise: WorkoutExercise, set: WorkoutSet): string {
    const position = exercise.sets.indexOf(set) + 1;
    return `${this.#exerciseName(verb, exercise)} set ${String(position)}`;
  }

  /** The same, for a control that belongs to the lift rather than to one set. */
  #exerciseName(verb: string, exercise: WorkoutExercise): string {
    return `${verb}, ${exercise.displayName}`;
  }

  readonly #onValue = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === DONE_WEIGHT_FIELD) this.editWeight = event.detail.value;
    if (field === DONE_REPS_FIELD) this.editReps = event.detail.value;
  };

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const { value } = event.detail;
    if (isDisposition(value)) this.disposition = value;
  };

  readonly #onText = (event: CustomEvent<TextAreaChangeDetail>): void => {
    const key = noteOf(event);
    if (key === null) return;
    // The box being typed in is the open one, whether or not a button opened
    // it: the finish panel draws its own and never toggles anything. Writing
    // whatever the last box held first, because two drafts at once is how one
    // of them gets written into the other's note.
    if (key !== this.noting) {
      this.#flushNote();
      this.noting = key;
    }
    this.#noteText = event.detail.value;
    this.#clearNoteTimer();
    this.#noteTimer = setTimeout(() => {
      this.#noteTimer = null;
      this.#flushNote();
    }, NOTE_DELAY_MILLIS);
  };

  /** Leaving a box writes it, and does not close it. */
  readonly #onFocusOut = (): void => {
    this.#flushNote();
  };

  readonly #onClick = (event: Event): void => {
    const action = actionOf(event);
    if (action === null) return;

    switch (action) {
      case COMPLETE_ACTION:
        this.#complete(event);
        return;
      case UNDO_ACTION:
        this.#undo(event);
        return;
      case EDIT_ACTION:
        this.#toggleEditor(event);
        return;
      case SAVE_ACTION:
        this.#saveEdit(event);
        return;
      case NOTE_ACTION:
        this.#toggleNote(event);
        return;
      case FINISH_ACTION:
        this.finishing = true;
        return;
      case FINISH_CANCEL_ACTION:
        this.finishing = false;
        this.disposition = null;
        return;
      case FINISH_CONFIRM_ACTION:
        this.#finish();
        return;
      default:
        return;
    }
  };

  #complete(event: Event): void {
    const session = this.#withDraft(this.session);
    const setId = setOf(event);
    if (session === null || setId === null || findSet(session, setId) === null) return;
    this.#changed(completeSet(session, setId, this.#context()), setId);
  }

  #undo(event: Event): void {
    const session = this.#withDraft(this.session);
    const setId = setOf(event);
    if (session === null || setId === null || findSet(session, setId) === null) return;
    // The editor closes with the undo. Leaving it open would show the numbers of a
    // performance that no longer exists, ready to be saved back.
    if (this.editing === setId) this.editing = null;
    this.#changed(undoSet(session, setId, this.#context()), null);
  }

  /**
   * Opens the editor on a set, seeded with whatever that set already says.
   *
   * Seeded rather than blank: the common edit is "five became four", and a blank pair
   * of boxes asks a lifter to retype the weight they did not change. What is shown is
   * `performed ?? planned`, which is the same rule `completeSet` follows -- the two
   * agreeing is what makes the one-tap path and the edited path one behaviour.
   */
  #toggleEditor(event: Event): void {
    const session = this.session;
    const setId = setOf(event);
    if (session === null || setId === null) return;
    if (this.editing === setId) {
      this.editing = null;
      return;
    }

    const found = findSet(session, setId);
    if (found === null) return;
    const shown = found.set.performed ?? found.set.planned;
    const load: SetLoad = shown === null ? { kind: 'none' } : shown.load;
    const reps = shown === null ? null : shown.repetitions;
    this.editing = setId;
    this.editWeight = load.kind === 'none' ? '' : String(load.weight.amount);
    this.editReps = reps === null ? '' : String(reps);
  }

  #saveEdit(event: Event): void {
    const session = this.#withDraft(this.session);
    const setId = setOf(event);
    if (session === null || setId === null) return;
    const found = findSet(session, setId);
    if (found === null) return;

    const performed = {
      load: loadFor(found.exercise.loading, this.#weight()),
      repetitions: readReps(this.editReps),
      // Effort is Milestone 3. Carried over rather than dropped, so a future editor
      // for it cannot be defeated by somebody correcting their reps.
      effort: found.set.performed?.effort ?? null,
    };

    const wasPlanned = found.set.status === 'planned';
    this.editing = null;
    this.#changed(recordSet(session, setId, performed, this.#context()), wasPlanned ? setId : null);
  }

  /** What the editor's weight box says, in the unit it was typed in. */
  #weight(): Weight | null {
    const text = this.editWeight.trim();
    if (text === '') return null;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount, unit: this.unit };
  }

  /**
   * Opens a note box, or closes the one already open.
   *
   * Whatever was in the previous box is written on the way, which is the same
   * rule the set editor follows for the same reason -- one box open at a time,
   * and closing one must not be how its contents are lost.
   */
  #toggleNote(event: Event): void {
    const key = noteOf(event);
    const session = this.session;
    if (key === null || session === null) return;
    this.#flushNote();
    if (this.noting === key) {
      this.noting = null;
      return;
    }
    this.noting = key;
    // Read from the session and not from the flush above: that wrote a
    // different note, and this one is unaffected by it.
    this.#noteText = this.#noteAt(session, key);
  }

  /** Writes the open draft, if there is one and if it says anything new. */
  #flushNote(): void {
    this.#clearNoteTimer();
    const session = this.session;
    const key = this.noting;
    if (session === null || key === null) return;
    const next = this.#applyNote(session, key, this.#noteText);
    // Identity, not deep equality: the core returns the session it was given
    // when the normalised text has not moved, and a debounced box fires
    // carrying what it already holds more often than it fires carrying a
    // change. Persisting that would rewrite storage for a keystroke undone.
    if (next === session) return;
    this.#changed(next, null);
  }

  /**
   * A session with the open draft already in it.
   *
   * Every other edit this screen makes goes through here, so that the order the
   * browser happens to deliver a blur and the tap that caused it in does not
   * decide whether a note survives. Idempotent by construction: applying text
   * the session already carries returns the session.
   */
  #withDraft(session: WorkoutSession | null): WorkoutSession | null {
    const key = this.noting;
    if (session === null || key === null) return session;
    return this.#applyNote(session, key, this.#noteText);
  }

  /** Which core setter a note key names. An unrecognised one changes nothing. */
  #applyNote(session: WorkoutSession, key: string, text: string): WorkoutSession {
    if (key === WORKOUT_NOTE_KEY) return setWorkoutNote(session, text, this.#context());
    const exerciseId = exerciseNoteId(key);
    if (exerciseId === null) return session;
    return setExerciseNote(session, exerciseId, text, this.#context());
  }

  /** What is stored against a note key, as the empty string where nothing is. */
  #noteAt(session: WorkoutSession, key: string): string {
    if (key === WORKOUT_NOTE_KEY) return session.note ?? '';
    const exerciseId = exerciseNoteId(key);
    if (exerciseId === null) return '';
    return findWorkoutExercise(session, exerciseId)?.note ?? '';
  }

  #clearNoteTimer(): void {
    if (this.#noteTimer === null) return;
    clearTimeout(this.#noteTimer);
    this.#noteTimer = null;
  }

  #finish(): void {
    // The one place the draft *has* to be folded in rather than merely being
    // safe to: this dispatches the finished session and no other, so a note
    // still sitting in the box when Finish is pressed exists nowhere else.
    const session = this.#withDraft(this.session);
    if (session === null) return;
    const outstanding = outstandingSets(session);
    if (outstanding.length > 0 && this.disposition === null) return;

    const finished = finishWorkout(session, this.disposition ?? 'leave', this.#context());
    this.#clearNoteTimer();
    this.noting = null;
    this.finishing = false;
    this.disposition = null;
    this.dispatchEvent(
      new CustomEvent<WorkoutFinishedDetail>(WORKOUT_FINISHED_EVENT, {
        detail: { session: finished },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #context(): { readonly nextId: () => LogbookId; readonly at: Instant } {
    return {
      // Nothing this screen does creates an object, so the identifier generator is
      // never called. It throws rather than returning a plausible string, because a
      // silent duplicate identifier is a set that overwrites another one.
      nextId: (): LogbookId => {
        throw new Error('The active workout screen does not create objects.');
      },
      at: this.now(),
    };
  }

  #changed(session: WorkoutSession, completedSetId: LogbookId | null): void {
    // Rendered from the property the root sets back, not from a local copy. A screen
    // that painted its own optimistic result would keep showing a ticked set after a
    // failed write, which is section 18.9's promise broken in the one way a lifter
    // cannot see.
    this.dispatchEvent(
      new CustomEvent<WorkoutChangedDetail>(WORKOUT_CHANGED_EVENT, {
        detail: { session, completedSetId },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/** A rep count from the editor, or `null` for blank and for anything unreadable. */
function readReps(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  // Zero is allowed here and refused in the planner: planning nought reps is a typo,
  // recording nought is "I got under the bar and did not move it", which is a fact.
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-active-workout': PtkActiveWorkout;
  }

  interface HTMLElementEventMap {
    [WORKOUT_CHANGED_EVENT]: CustomEvent<WorkoutChangedDetail>;
    [WORKOUT_FINISHED_EVENT]: CustomEvent<WorkoutFinishedDetail>;
  }
}
