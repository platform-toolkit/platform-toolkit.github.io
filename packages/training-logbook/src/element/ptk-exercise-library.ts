// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The movements a lifter added themselves. Section 6.4.
 *
 * One form and one list, and unlike `ptk-equipment-library` there is no live value
 * beside them -- nothing here is in force, so nothing is written without a press.
 * That makes the shape simpler and the form harder: an exercise is four answers, two
 * of which a lifter has never been asked before.
 *
 * WHY THE FORM ASKS FOR A LOADING MODEL AT ALL
 *
 * Because section 6.3 forbids guessing it, and because guessing it is what every
 * obvious shortcut amounts to. "Belt squat" contains `squat`, which is a barbell
 * total in the catalogue and a machine in most gyms; "chin-up" is bodyweight,
 * assisted or weighted depending on nothing that appears in the string. Getting it
 * wrong is not a cosmetic fault -- it decides which boxes the logging screen draws,
 * so a wrong model means a lifter cannot record what they did. So it is asked, once,
 * with a label written from the entry boxes' side rather than the taxonomy's.
 *
 * WHY THE WARM-UP TICK IS OFF AND THE FAMILY IS EXPLICIT
 *
 * Section 6.4, and it is the same rule stated twice because both halves get
 * "helpfully" automated. A family is never inferred from a name, and a custom
 * exercise never receives a ramp it was not asked to receive. The tick is therefore
 * off for a new exercise and the family select only appears once it is on -- an
 * exercise cannot end up with a family nobody chose, because the only control that
 * sets one is the one the lifter had to open.
 *
 * The tick appears for barbell exercises only, which is `canGenerateWarmup`'s other
 * half: the engine loads a bar, and there are no plates to put on a cable stack. A
 * non-barbell model gets the sentence saying so rather than a control that would
 * store an answer nothing reads.
 *
 * WHY EDITING REUSES THE ADD FORM
 *
 * One form, one set of validation, one place a name is trimmed. The alternative is a
 * row that expands into a second copy of every field, which is where the two drift:
 * the inline one grows a rule the top one does not have, and a lifter gets a
 * different answer depending on which control they reached for.
 */

import type { WarmupFamily, WeightUnit } from '@platform-toolkit/domain';
import {
  SEGMENTED_CHANGE_EVENT,
  SELECT_CHANGE_EVENT,
  TEXT_FIELD_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type Choice,
  type SegmentedChangeDetail,
  type SelectChangeDetail,
  type SelectOption,
  type TextFieldChangeDetail,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { draftFrom, findCustomExercise, type CustomExerciseDraft } from '../core/catalog.js';
import type { CustomExercise, LoadingModel, LogbookId } from '../types.js';

import { EXERCISE_NOTES, LOADING_LABELS, UNIT_LABELS, WARMUP_FAMILY_LABELS } from './copy.js';
import { actionOf, exerciseOf, fieldOf } from './dataset.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const EXERCISE_LIBRARY_TAG = 'ptk-exercise-library';

/** The lifter asked to keep a movement they described. */
export const EXERCISE_SAVED_EVENT = 'ptk-exercise-saved';
/** The lifter asked to forget one. Their workouts are not involved. */
export const EXERCISE_REMOVED_EVENT = 'ptk-exercise-removed';

/**
 * The answers, and which row they replace.
 *
 * The draft carries no identifier and no timestamps for the reason
 * `ProfileSavedDetail` carries none: this element has no clock and no id source, and
 * one that invented either would be minting identity out of a form. `id` is not an
 * exception to that -- it is echoed back from the list the root handed down, so it
 * names a row that already exists. `null` means the form was adding.
 */
export interface ExerciseSavedDetail {
  readonly id: LogbookId | null;
  readonly draft: CustomExerciseDraft;
}

/** Which saved exercise. */
export interface ExerciseIdDetail {
  readonly id: LogbookId;
}

const NAME_FIELD = 'exercise-name';
const LOADING_FIELD = 'exercise-loading';
const UNIT_FIELD = 'exercise-unit';
const WARMUP_FIELD = 'exercise-warmup';
const FAMILY_FIELD = 'exercise-family';

const SAVE_ACTION = 'save-exercise';
const EDIT_ACTION = 'edit-exercise';
const CANCEL_ACTION = 'cancel-exercise';
const REMOVE_ACTION = 'remove-exercise';

/** The same bound, and the same reasoning, as a gym name. */
const MAX_NAME_LENGTH = 200;

/**
 * What "follow the setting" is called in the segmented control.
 *
 * A third segment rather than a tick beside two, because it is the default and the
 * commonest answer: a lifter who has one exercise in the other unit is the exception,
 * and making them the only person who sees three choices would be the wrong way round.
 * Not a `WeightUnit`, hence a value of its own that {@link #unitFrom} maps to `null`.
 */
const UNIT_FOLLOWS = 'follows';

/** The model a new exercise opens on. The commonest answer, and the one 6.3 is about. */
const DEFAULT_LOADING: LoadingModel = 'barbell-total-weight';

/** The family a tick opens on. Chosen by the lifter the moment they see the select. */
const DEFAULT_FAMILY: WarmupFamily = 'squat-press';

function isLoadingModel(value: string): value is LoadingModel {
  return Object.hasOwn(LOADING_LABELS, value);
}

function isWarmupFamily(value: string): value is WarmupFamily {
  return Object.hasOwn(WARMUP_FAMILY_LABELS, value);
}

const LOADING_OPTIONS: readonly SelectOption[] = Object.entries(LOADING_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const FAMILY_OPTIONS: readonly SelectOption[] = Object.entries(WARMUP_FAMILY_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const UNIT_CHOICES: readonly Choice[] = [
  { value: UNIT_FOLLOWS, label: EXERCISE_NOTES.unitFollows },
  { value: 'kg', label: UNIT_LABELS.kg },
  { value: 'lb', label: UNIT_LABELS.lb },
];

const WARMUP_CHOICES: readonly Choice[] = [
  {
    value: WARMUP_FIELD,
    label: EXERCISE_NOTES.warmupLabel,
    description: EXERCISE_NOTES.warmupNote,
  },
];

export class PtkExerciseLibrary extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
    }

    .note {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    .library {
      margin-top: var(--ptk-space-lg);
    }

    ul {
      list-style: none;
      margin: 0 0 var(--ptk-space-sm);
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
    }

    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-xs) 0;
      border-block-end: 1px solid var(--ptk-color-border);
    }

    .name {
      flex: 1 1 8rem;
      overflow-wrap: anywhere;
    }

    .loading {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs);
    }
  `;

  @property({ attribute: false }) exercises: readonly CustomExercise[] = [];

  /**
   * Whether the library could be read at all.
   *
   * Separate from an empty list for the reason the gym one is, and with more at
   * stake: adding under a name already taken replaces a movement, and here the
   * replaced one may still be attached to sessions in the history.
   */
  @property({ type: Boolean, attribute: 'unreadable' }) unreadable = false;

  /** The row the form is replacing, or `null` where it is adding. */
  @state() private editing: LogbookId | null = null;

  @state() private name = '';

  @state() private loading: LoadingModel = DEFAULT_LOADING;

  @state() private unit: WeightUnit | null = null;

  @state() private warmup = false;

  @state() private family: WarmupFamily = DEFAULT_FAMILY;

  @state() private nameError = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onSelect);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText);
    this.removeEventListener(SELECT_CHANGE_EVENT, this.#onSelect);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  /** Waits for the form's children, for the reason `ptk-equipment-library` does. */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.renderRoot.querySelectorAll('*');
    await Promise.all(
      [...children].filter((node) => node instanceof LitElement).map((node) => node.updateComplete),
    );
    return done;
  }

  /** The saved exercises in a stable order the storage layer does not promise. */
  #sorted(): readonly CustomExercise[] {
    return [...this.exercises].sort((left, right) => left.name.localeCompare(right.name));
  }

  override render(): TemplateResult {
    return html`
      <h2>${EXERCISE_NOTES.heading}</h2>
      <p class="note">${EXERCISE_NOTES.intro}</p>

      <div class="stack">
        <ptk-text-field
          data-field=${NAME_FIELD}
          label=${EXERCISE_NOTES.nameLabel}
          placeholder=${EXERCISE_NOTES.namePlaceholder}
          hint=${EXERCISE_NOTES.nameHint}
          error=${this.nameError}
          .value=${this.name}
        ></ptk-text-field>

        <ptk-select
          data-field=${LOADING_FIELD}
          label=${EXERCISE_NOTES.loadingLabel}
          hint=${EXERCISE_NOTES.loadingHint}
          .options=${LOADING_OPTIONS}
          .value=${this.loading}
        ></ptk-select>

        <div data-field=${UNIT_FIELD}>
          <ptk-segmented
            label=${EXERCISE_NOTES.unitLabel}
            .choices=${UNIT_CHOICES}
            .value=${this.unit ?? UNIT_FOLLOWS}
          ></ptk-segmented>
        </div>
        <p class="note">${EXERCISE_NOTES.unitHint}</p>

        ${this.#renderWarmup()}

        <div class="buttons">
          <ptk-button variant="secondary" data-action=${SAVE_ACTION}
            >${this.editing === null ? EXERCISE_NOTES.add : EXERCISE_NOTES.saveEdit}</ptk-button
          >
          ${
            this.editing === null
              ? nothing
              : html`<ptk-button variant="quiet" data-action=${CANCEL_ACTION}
                  >${EXERCISE_NOTES.cancelEdit}</ptk-button
                >`
          }
        </div>
        ${
          this.editing === null
            ? html`<p class="note">${EXERCISE_NOTES.addOverwrites}</p>`
            : nothing
        }
      </div>

      <div class="library">
        <h3>${EXERCISE_NOTES.libraryHeading}</h3>
        ${this.#renderLibrary()}
      </div>
    `;
  }

  /**
   * The tick, and the family it opens.
   *
   * Both are `canGenerateWarmup`'s two halves drawn: no tick without a barbell, no
   * family without the tick. The `ptk-toggle-group` of one is the builder's trick and
   * for the builder's reason -- `packages/ui` has no standalone checkbox, and adding
   * one to draw a single tick would be a second control answering the same question.
   */
  #renderWarmup(): TemplateResult {
    if (this.loading !== 'barbell-total-weight') {
      return html`<p class="note">${EXERCISE_NOTES.warmupBarbellOnly}</p>`;
    }
    return html`
      <div data-field=${WARMUP_FIELD}>
        <ptk-toggle-group
          layout="list"
          label=${EXERCISE_NOTES.warmupLegend}
          .choices=${WARMUP_CHOICES}
          .values=${this.warmup ? [WARMUP_FIELD] : []}
        ></ptk-toggle-group>
      </div>
      ${
        this.warmup
          ? html`<ptk-select
              data-field=${FAMILY_FIELD}
              label=${EXERCISE_NOTES.familyLabel}
              .options=${FAMILY_OPTIONS}
              .value=${this.family}
            ></ptk-select>`
          : nothing
      }
    `;
  }

  /**
   * The lifter's own movements, or the sentence saying they could not be read.
   *
   * The refusal is in an always-present region rather than returned in the list's
   * place, for the reason `ptk-equipment-library` gives next door: it arrives from an
   * asynchronous read with nothing else on the screen moving, and a region built at the
   * moment it has something to say is not reliably announced.
   */
  #renderLibrary(): TemplateResult {
    const unreadable = this.unreadable;
    return html`
      <div class="unreadable" role="status">
        ${unreadable ? html`<p class="note">${EXERCISE_NOTES.libraryUnreadable}</p>` : nothing}
      </div>
      ${unreadable ? nothing : this.#renderExercises()}
    `;
  }

  #renderExercises(): TemplateResult {
    const exercises = this.#sorted();
    if (exercises.length === 0) return html`<p class="note">${EXERCISE_NOTES.libraryEmpty}</p>`;
    return html`
      <ul>
        ${exercises.map((exercise) => this.#renderRow(exercise))}
      </ul>
      <p class="note">${EXERCISE_NOTES.removeNote}</p>
    `;
  }

  #renderRow(exercise: CustomExercise): TemplateResult {
    return html`
      <li data-exercise=${exercise.id}>
        <span class="name">${exercise.name}</span>
        <span class="loading">${LOADING_LABELS[exercise.loading]}</span>
        <ptk-button
          variant="quiet"
          data-action=${EDIT_ACTION}
          accessible-name=${`${EXERCISE_NOTES.edit} ${exercise.name}`}
          >${EXERCISE_NOTES.edit}</ptk-button
        >
        <ptk-button
          variant="quiet"
          data-action=${REMOVE_ACTION}
          accessible-name=${`${EXERCISE_NOTES.remove} ${exercise.name}`}
          >${EXERCISE_NOTES.remove}</ptk-button
        >
      </li>
    `;
  }

  readonly #onText = (event: CustomEvent<TextFieldChangeDetail>): void => {
    if (fieldOf(event) !== NAME_FIELD) return;
    event.stopPropagation();
    this.name = event.detail.value;
    // Cleared as they type rather than re-validated, as on the gym form: the message
    // answers a press, and leaving it under a box being fixed reads as a second fault.
    this.nameError = '';
  };

  readonly #onSelect = (event: CustomEvent<SelectChangeDetail>): void => {
    const field = fieldOf(event);
    if (field !== LOADING_FIELD && field !== FAMILY_FIELD) return;
    event.stopPropagation();
    const value = event.detail.value;
    if (value === null) return;
    if (field === LOADING_FIELD) {
      if (isLoadingModel(value)) this.loading = value;
      return;
    }
    if (isWarmupFamily(value)) this.family = value;
  };

  readonly #onSegmented = (event: CustomEvent<SegmentedChangeDetail>): void => {
    if (fieldOf(event) !== UNIT_FIELD) return;
    event.stopPropagation();
    this.unit = this.#unitFrom(event.detail.value);
  };

  /** The third segment is an answer and not a unit, so it is stored as its absence. */
  #unitFrom(value: string): WeightUnit | null {
    return value === 'kg' || value === 'lb' ? value : null;
  }

  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    if (fieldOf(event) !== WARMUP_FIELD) return;
    event.stopPropagation();
    this.warmup = event.detail.values.includes(WARMUP_FIELD);
  };

  readonly #onClick = (event: Event): void => {
    switch (actionOf(event)) {
      case SAVE_ACTION:
        this.#save();
        return;
      case EDIT_ACTION:
        this.#edit(event);
        return;
      case CANCEL_ACTION:
        this.#reset();
        return;
      case REMOVE_ACTION:
        this.#remove(event);
        return;
      default:
        return;
    }
  };

  #save(): void {
    const name = this.name.trim();
    if (name === '') {
      this.nameError = EXERCISE_NOTES.nameRequired;
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      this.nameError = EXERCISE_NOTES.nameTooLong;
      return;
    }
    const id = this.editing;
    const draft: CustomExerciseDraft = {
      name,
      loading: this.loading,
      // Read off the model rather than off the tick, so a lifter who ticks the box and
      // then changes the model to a cable stack does not save a family the picker has
      // already stopped showing them. `canGenerateWarmup` would refuse it anyway; this
      // is so the stored row says the same thing the screen last did.
      warmupFamily: this.loading === 'barbell-total-weight' && this.warmup ? this.family : null,
      defaultUnit: this.unit,
    };
    this.#reset();
    this.dispatchEvent(
      new CustomEvent<ExerciseSavedDetail>(EXERCISE_SAVED_EVENT, {
        detail: { id, draft },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Loads a saved exercise back into the form.
   *
   * Local, and reported to nobody. Nothing has changed yet -- opening a row for
   * editing is not editing it, and a root told about this would have to decide what to
   * do with a change that has not happened.
   */
  #edit(event: Event): void {
    const id = exerciseOf(event);
    if (id === null) return;
    const exercise = findCustomExercise(this.exercises, id);
    if (exercise === null) return;
    const draft = draftFrom(exercise);
    this.editing = exercise.id;
    this.name = draft.name;
    this.loading = draft.loading;
    this.unit = draft.defaultUnit;
    this.warmup = draft.warmupFamily !== null;
    this.family = draft.warmupFamily ?? DEFAULT_FAMILY;
    this.nameError = '';
  }

  /**
   * Empties the form, on the way out rather than on the way back.
   *
   * The same rule the gym name follows: the form asked its questions and they have
   * been answered, and leaving the answers in would make the next save look like an
   * accidental second copy of this one.
   */
  #reset(): void {
    this.editing = null;
    this.name = '';
    this.loading = DEFAULT_LOADING;
    this.unit = null;
    this.warmup = false;
    this.family = DEFAULT_FAMILY;
    this.nameError = '';
  }

  #remove(event: Event): void {
    const id = exerciseOf(event);
    if (id === null) return;
    // A form left open on the row being removed would save changes to a movement that
    // is no longer there, which the root would have to write back as a new one.
    if (this.editing === id) this.#reset();
    this.dispatchEvent(
      new CustomEvent<ExerciseIdDetail>(EXERCISE_REMOVED_EVENT, {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-exercise-library': PtkExerciseLibrary;
  }

  interface HTMLElementEventMap {
    [EXERCISE_SAVED_EVENT]: CustomEvent<ExerciseSavedDetail>;
    [EXERCISE_REMOVED_EVENT]: CustomEvent<ExerciseIdDetail>;
  }
}
