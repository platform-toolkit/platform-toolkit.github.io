// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen a session is written down on, before any of it is done.
 *
 * Section 4.1 steps 3 to 7. It has one job and it is measured on how fast that job
 * finishes: a lifter standing in a gym with their phone out wants four taps between
 * opening the tool and starting to squat, and every control here is arranged around
 * that number.
 *
 * WHY THE FOUR COMPETITION LIFTS ARE BUTTONS AND EVERYTHING ELSE IS A LIST
 *
 * Section 6.1 says the four are shown "without opening a picker", and the shape that
 * makes true is a button per lift: one tap adds a squat with its own default sets and
 * reps already filled in. The other thirty-odd movements sit behind a disclosure with
 * a select, because thirty-eight radio tiles is a screen you scroll rather than a
 * screen you read -- and the split is not a hierarchy of importance so much as a
 * measurement of how often each is reached for.
 *
 * The select is deliberately paired with an explicit Add button rather than adding on
 * change. Two reasons, and the second is the one that decided it. A select that acts
 * on change cannot add the same movement twice -- choosing the value it already holds
 * fires no event -- and a lifter doing heavy singles and then back-off sets is
 * planning two squats. And an accidental scroll of a native picker on a phone would
 * otherwise write an exercise into the session.
 *
 * WHAT LEAVES HERE, AND WHAT DOES NOT
 *
 * A read plan and nothing else. This element never builds a `WorkoutSession`, never
 * touches storage, and has no clock: the root owns all three. Section 12.3's rule is
 * that the core is pure, and the way that stays true is that the screen which cannot
 * be pure hands over data rather than objects with identifiers and timestamps in
 * them.
 */

import type { WeightUnit } from '@platform-toolkit/domain';
import {
  DATE_FIELD_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  SELECT_CHANGE_EVENT,
  TEXT_FIELD_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type Choice,
  type DateFieldChangeDetail,
  type NumberFieldChangeDetail,
  type SelectChangeDetail,
  type SelectOption,
  type TextFieldChangeDetail,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import {
  CATALOG_EXERCISES,
  PRIMARY_EXERCISES,
  canGenerateWarmup,
  takesWeight,
} from '../core/catalog.js';
import type { CalendarDay, EquipmentSnapshot, ExerciseOption, LoadingModel } from '../types.js';

import { BUILDER_NOTES, LOADING_LABELS } from './copy.js';
import {
  DATE_FIELD,
  REPS_FIELD,
  SETS_FIELD,
  TITLE_FIELD,
  WARMUP_FIELD,
  WEIGHT_FIELD,
  actionOf,
  exerciseOf,
  fieldOf,
  rowOf,
} from './dataset.js';
import {
  newPlanRow,
  planProblem,
  problemFor,
  readPlan,
  type PlanDraftRow,
  type PlanProblem,
  type PlannedExercise,
} from './plan.js';

/** A session as planned, with every number already read. */
export interface WorkoutPlannedDetail {
  readonly localDate: CalendarDay;
  /** `null` rather than an empty string, so "unnamed" has one representation. */
  readonly title: string | null;
  readonly exercises: readonly PlannedExercise[];
}

/** Fired when the plan reads cleanly. Never for a form still being filled. */
export const WORKOUT_PLANNED_EVENT = 'ptk-workout-planned';

/** The tag `defineTrainingLogbook()` registers this under. */
export const WORKOUT_BUILDER_TAG = 'ptk-workout-builder';

const ADD_PRIMARY_ACTION = 'add-primary';
const ADD_PICKED_ACTION = 'add-picked';
const REMOVE_ACTION = 'remove-row';
const START_ACTION = 'start';

/**
 * The order the picker's groups appear in, most reached-for first.
 *
 * A total record rather than an array, so a loading model added to the union is a
 * compile error here rather than an exercise that silently sorts to the top of the
 * list under a heading of its own.
 */
const LOADING_ORDER: Readonly<Record<LoadingModel, number>> = {
  'barbell-total-weight': 0,
  'machine-or-cable-weight': 1,
  'bodyweight-plus-added-weight': 2,
  bodyweight: 3,
  'assisted-bodyweight': 4,
  'repetitions-only': 5,
  'custom-weight-reps': 6,
};

/**
 * Groups in that order, and names alphabetically inside each.
 *
 * Alphabetical inside a group and not the catalogue's own order, because the
 * catalogue is ordered by lift family -- every squat variant together -- and that is
 * an order you can only use if you already know which family a movement is in. Under
 * one heading of thirty-five barbell movements, the alphabet is the only order
 * somebody can search without reading all of it.
 *
 * The sort has to be stable across groups or `ptk-select` renders one heading twice:
 * it opens a new `optgroup` whenever the group changes, so two runs of "Barbell"
 * would become two headings that no engine merges.
 */
function byLoadingThenName(a: ExerciseOption, b: ExerciseOption): number {
  const order = LOADING_ORDER[a.loading] - LOADING_ORDER[b.loading];
  return order === 0 ? a.name.localeCompare(b.name) : order;
}

export class PtkWorkoutBuilder extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .section + .section {
      margin-top: var(--ptk-space-lg);
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
    }

    h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    /*
     * Sets, reps and weight are three short numbers read as one line. Sized at the
     * width three of them need rather than at a label's width, so the row stays a
     * row on a phone instead of dropping one number onto a line of its own.
     */
    .numbers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    /*
     * The four lifts, one tap each. The track floor is the comfortable tap target
     * rather than a text measurement, because what has to fit is a thumb.
     */
    .primary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .primary ptk-button,
    .actions ptk-button {
      max-width: 100%;
    }

    ul {
      list-style: none;
      margin: var(--ptk-space-md) 0 0;
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

    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ptk-space-xs);
      margin-bottom: var(--ptk-space-xs);
    }

    .row-head h3 {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-md);
    }

    .picker {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .warmup {
      margin-top: var(--ptk-space-sm);
    }
  `;

  /**
   * The lifter's own calendar day, supplied rather than read from a clock.
   *
   * `types.ts` has the whole argument; the short version is that this element has no
   * business knowing what a time zone is, and a screen that computed its own default
   * date would compute it from UTC and offer yesterday to everybody west of
   * Greenwich after four in the afternoon.
   */
  @property({ attribute: false }) today: CalendarDay = '';

  /** The unit new weights are typed in. Section 11.4: entry unit, not storage unit. */
  @property({ attribute: false }) unit: WeightUnit = 'lb';

  /**
   * Everything that can be planned, catalogue and custom together.
   *
   * A property rather than a read of {@link CATALOG_EXERCISES}, because a lifter's
   * own movements live in storage and storage is the root's business. The default is
   * the catalogue so the element is usable with nothing supplied.
   */
  @property({ attribute: false }) exercises: readonly ExerciseOption[] = CATALOG_EXERCISES;

  /**
   * The rack a ramp would be built out of, or `null` where none has been chosen.
   *
   * Read here only to decide whether the warm-up tick is drawn at all -- this element
   * generates nothing, and the root is where a plan is actually composed. Offering the
   * tick without a rack would be a control that reads as available and does nothing,
   * which root 0.4 rules out; the section note says what to do instead.
   */
  @property({ attribute: false }) equipment: EquipmentSnapshot | null = null;

  @state() private localDate = '';
  @state() private sessionTitle = '';
  @state() private rows: readonly PlanDraftRow[] = [];
  @state() private picked = '';
  @state() private problems: readonly PlanProblem[] = [];

  /**
   * Row keys, from a counter rather than from the exercise.
   *
   * Two squats in one session are two rows of the same exercise, so the identifier
   * cannot be the key -- see {@link PlanDraftRow}. A counter is enough because these
   * never leave the element: the root generates the identifiers that get stored.
   */
  #keys = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(DATE_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onPick);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onValue);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onValue);
    this.removeEventListener(DATE_FIELD_CHANGE_EVENT, this.#onValue);
    this.removeEventListener(SELECT_CHANGE_EVENT, this.#onPick);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  /**
   * Waits for the controls as well as for this element.
   *
   * `updateComplete` resolves when this element's own template has been written, and
   * says nothing about the fields inside it. A test that read a field's value on the
   * host's promise would read it before the field had rendered (section 5.8).
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.renderRoot.querySelectorAll('*');
    await Promise.all(
      [...children].filter((node) => node instanceof LitElement).map((node) => node.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult {
    return html`
      <section class="section">
        <h2>${BUILDER_NOTES.heading}</h2>
        <div class="fields">
          <div data-field=${DATE_FIELD}>
            <ptk-date-field
              label=${BUILDER_NOTES.dateLabel}
              hint=${BUILDER_NOTES.dateNote}
              .value=${this.#date()}
            ></ptk-date-field>
          </div>
          <div data-field=${TITLE_FIELD}>
            <ptk-text-field
              label=${BUILDER_NOTES.titleLabel}
              placeholder=${BUILDER_NOTES.titlePlaceholder}
              .value=${this.sessionTitle}
            ></ptk-text-field>
          </div>
        </div>
      </section>

      <section class="section">
        <h3>${BUILDER_NOTES.exercisesHeading}</h3>
        <p class="note">${BUILDER_NOTES.primaryNote}</p>
        <div class="primary">${PRIMARY_EXERCISES.map((option) => this.#primary(option))}</div>
        ${this.#picker()} ${this.#rows()}
      </section>

      <section class="section">
        ${this.#warmupNote()}
        ${
          this.rows.length === 0
            ? html`<p class="note">${BUILDER_NOTES.startNeedsExercise}</p>`
            : nothing
        }
        <div class="actions">
          <ptk-button
            variant="primary"
            data-action=${START_ACTION}
            ?disabled=${this.rows.length === 0}
            >${BUILDER_NOTES.start}</ptk-button
          >
        </div>
      </section>
    `;
  }

  /** One of section 6.1's four, as a single tap. */
  #primary(option: ExerciseOption): TemplateResult {
    return html`<ptk-button
      variant="secondary"
      data-action=${ADD_PRIMARY_ACTION}
      data-exercise=${option.id}
      >${option.name}</ptk-button
    >`;
  }

  /**
   * Everything else, behind one tap of a disclosure.
   *
   * Sorted into loading-model groups and not left flat. Forty-odd movements in one
   * list is a control somebody scrolls past rather than reads, and `optgroup` is the
   * only structure a native select offers -- which is the reason to keep it a native
   * select rather than reimplement one (section 5.8).
   */
  #picker(): TemplateResult {
    const options: readonly SelectOption[] = [...this.exercises]
      .sort(byLoadingThenName)
      .map((option) => ({
        value: option.id,
        label: option.name,
        group: LOADING_LABELS[option.loading],
      }));
    return html`<ptk-disclosure label=${BUILDER_NOTES.addLabel}>
      <div class="picker">
        <ptk-select
          label=${BUILDER_NOTES.addLabel}
          placeholder=${BUILDER_NOTES.addPlaceholder}
          .options=${options}
          .value=${this.picked}
        ></ptk-select>
        <ptk-button variant="secondary" data-action=${ADD_PICKED_ACTION} ?disabled=${!this.#found()}
          >${BUILDER_NOTES.addLabel}</ptk-button
        >
      </div>
    </ptk-disclosure>`;
  }

  #rows(): TemplateResult {
    if (this.rows.length === 0) return html`<p class="note">${BUILDER_NOTES.empty}</p>`;
    return html`<ul>
      ${this.rows.map((row, index) => this.#row(row, index))}
    </ul>`;
  }

  #row(row: PlanDraftRow, index: number): TemplateResult {
    const weighted = takesWeight(row.option.loading);
    return html`<li data-row=${String(index)}>
      <div class="row-head">
        <h3>${row.option.name}</h3>
        <ptk-button
          variant="quiet"
          data-action=${REMOVE_ACTION}
          accessible-name="${BUILDER_NOTES.remove} ${row.option.name}"
          >${BUILDER_NOTES.remove}</ptk-button
        >
      </div>
      <div class="numbers">
        <div data-field=${SETS_FIELD}>
          <ptk-number-field
            label=${BUILDER_NOTES.setsLabel}
            .value=${row.sets}
            error=${this.#error(index, SETS_FIELD)}
          ></ptk-number-field>
        </div>
        <div data-field=${REPS_FIELD}>
          <ptk-number-field
            label=${BUILDER_NOTES.repsLabel}
            .value=${row.reps}
            error=${this.#error(index, REPS_FIELD)}
          ></ptk-number-field>
        </div>
        ${
          weighted
            ? html`<div data-field=${WEIGHT_FIELD}>
                <ptk-number-field
                  label=${BUILDER_NOTES.weightLabel}
                  unit=${this.unit}
                  hint=${BUILDER_NOTES.weightNote}
                  .value=${row.weight}
                  error=${this.#error(index, WEIGHT_FIELD)}
                ></ptk-number-field>
              </div>`
            : html`<p class="note">${BUILDER_NOTES.noWeightNote}</p>`
        }
      </div>
      ${this.#warmupTick(row)}
    </li>`;
  }

  /**
   * The one tick a row may carry, drawn only where it could be honoured.
   *
   * Both halves of the condition are load-bearing and neither is about tidiness. The
   * catalogue half is section 8.2: a movement with no warm-up family has no ramp to
   * generate, and a tick that composed nothing would be a dead control. The rack half
   * is the same argument one step out -- a ramp is plates on a bar, and without a bar
   * there is nothing to work up. What the lifter gets instead is the section note,
   * which says where to set one up rather than leaving a control that does nothing.
   *
   * A `ptk-toggle-group` of one rather than a checkbox, because `packages/ui` has no
   * standalone checkbox and adding one to draw a single tick would be the second
   * control answering the same question -- root 5.8's fork, in the package whose whole
   * job is to not have one.
   */
  #warmupTick(row: PlanDraftRow): TemplateResult | typeof nothing {
    if (!canGenerateWarmup(row.option) || this.equipment === null) return nothing;
    const choices: readonly Choice[] = [
      {
        value: WARMUP_FIELD,
        label: BUILDER_NOTES.warmupLabel,
        description: BUILDER_NOTES.warmupNote,
      },
    ];
    return html`<div class="warmup" data-field=${WARMUP_FIELD}>
      <ptk-toggle-group
        layout="list"
        label=${BUILDER_NOTES.warmupLegend}
        .choices=${choices}
        .values=${row.warmup ? [WARMUP_FIELD] : []}
      ></ptk-toggle-group>
    </div>`;
  }

  /**
   * Why a row that could have a ramp has no tick on it, said once for the screen.
   *
   * Once rather than per row, because the reason is never about the row: a lifter with
   * no rack sees it under every barbell lift they add, and eight copies of the same
   * sentence is how a note stops being read. Silent when every row can be ramped and a
   * rack exists -- the tick and its own description are the whole explanation then.
   */
  #warmupNote(): TemplateResult | typeof nothing {
    if (this.rows.length === 0) return nothing;
    const any = this.rows.some((row) => canGenerateWarmup(row.option));
    // Ordered so the sentence that names an action comes first. A lifter with no rack
    // and a mixed list can act on the rack; being told that accessories have no ramp
    // is true and gets them nowhere.
    if (!any) return html`<p class="note">${BUILDER_NOTES.warmupNotEveryLift}</p>`;
    if (this.equipment === null) return html`<p class="note">${BUILDER_NOTES.warmupNeedsRack}</p>`;
    if (this.rows.some((row) => !canGenerateWarmup(row.option)))
      return html`<p class="note">${BUILDER_NOTES.warmupNotEveryLift}</p>`;
    return nothing;
  }

  #error(
    index: number,
    field: typeof SETS_FIELD | typeof REPS_FIELD | typeof WEIGHT_FIELD,
  ): string {
    const problem = problemFor(this.problems, index, field);
    return problem === null ? '' : planProblem(problem);
  }

  /** The date the field shows: what was typed, or today until something is. */
  #date(): string {
    return this.localDate === '' ? this.today : this.localDate;
  }

  /** The exercise the picker is on, or `null` for the placeholder. */
  #found(): ExerciseOption | null {
    return this.exercises.find((option) => option.id === this.picked) ?? null;
  }

  readonly #onValue = (
    event: CustomEvent<TextFieldChangeDetail | NumberFieldChangeDetail | DateFieldChangeDetail>,
  ): void => {
    const field = fieldOf(event);
    if (field === null) return;
    const { value } = event.detail;

    if (field === DATE_FIELD) {
      this.localDate = value;
      return;
    }
    if (field === TITLE_FIELD) {
      this.sessionTitle = value;
      return;
    }

    const index = rowOf(event, this.rows.length);
    if (index === null) return;
    if (field !== SETS_FIELD && field !== REPS_FIELD && field !== WEIGHT_FIELD) return;

    // Spelt out rather than written as a computed key. `{ ...row, [field]: value }`
    // with a union-typed key does not narrow to the three properties it can be, so it
    // would need the cast section 2.4 forbids.
    this.rows = this.rows.map((row, position) => {
      if (position !== index) return row;
      if (field === SETS_FIELD) return { ...row, sets: value };
      if (field === REPS_FIELD) return { ...row, reps: value };
      return { ...row, weight: value };
    });
    // Complaints are dropped on any edit and come back on the next press. Section
    // 5.5's reasoning seen from the screen: revalidating per keystroke puts an error
    // under a control somebody is still using, and the first character of a two-digit
    // number is always wrong.
    this.problems = [];
  };

  readonly #onPick = (event: CustomEvent<SelectChangeDetail>): void => {
    this.picked = event.detail.value ?? '';
  };

  /**
   * The warm-up tick, read off the group's whole selection rather than its `selected`.
   *
   * `detail.values` is the state afterwards and `detail.selected` is the transition; a
   * one-option group makes them equivalent today, and reading the state is what keeps
   * this correct the day a second tick joins the group.
   */
  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    if (fieldOf(event) !== WARMUP_FIELD) return;
    const index = rowOf(event, this.rows.length);
    if (index === null) return;
    const warmup = event.detail.values.includes(WARMUP_FIELD);
    this.rows = this.rows.map((row, position) => (position === index ? { ...row, warmup } : row));
    // Cleared like any other edit. Unticking is the fix the 'warmup-needs-weight'
    // message offers, so leaving the complaint up would leave it pointing at a box
    // that no longer has to be filled in.
    this.problems = [];
  };

  readonly #onClick = (event: Event): void => {
    const action = actionOf(event);
    if (action === ADD_PRIMARY_ACTION) {
      const id = exerciseOf(event);
      const option = this.exercises.find((candidate) => candidate.id === id);
      if (option !== undefined) this.#add(option);
      return;
    }
    if (action === ADD_PICKED_ACTION) {
      const option = this.#found();
      if (option !== null) this.#add(option);
      return;
    }
    if (action === REMOVE_ACTION) {
      const index = rowOf(event, this.rows.length);
      if (index === null) return;
      this.rows = this.rows.filter((_row, position) => position !== index);
      // Dropped rather than reindexed. A complaint carries a row number, and the row
      // numbers below the removed one have all just moved up by one -- keeping them
      // would paint the error onto the wrong exercise.
      this.problems = [];
      return;
    }
    if (action === START_ACTION) this.#start();
  };

  #add(option: ExerciseOption): void {
    this.#keys += 1;
    this.rows = [...this.rows, newPlanRow(option, `row-${String(this.#keys)}`)];
    this.problems = [];
  }

  #start(): void {
    // Refused rather than dispatched as an empty plan. The logging screen for a
    // workout with no sets in it has nothing to tick and no way back that is not
    // finishing a session nobody did.
    if (this.rows.length === 0) return;

    const reading = readPlan(this.rows, this.unit);
    if (!reading.ok) {
      this.problems = reading.problems;
      return;
    }

    const title = this.sessionTitle.trim();
    this.dispatchEvent(
      new CustomEvent<WorkoutPlannedDetail>(WORKOUT_PLANNED_EVENT, {
        detail: {
          localDate: this.#date(),
          title: title === '' ? null : title,
          exercises: reading.exercises,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-workout-builder': PtkWorkoutBuilder;
  }

  interface HTMLElementEventMap {
    [WORKOUT_PLANNED_EVENT]: CustomEvent<WorkoutPlannedDetail>;
  }
}
