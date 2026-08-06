// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a lifter has already done, listed newest first.
 *
 * Read-only about the past, deliberately and not provisionally. Editing history is a
 * later sub-task and section 0.4 is explicit that a milestone must not ship its journey
 * with dead controls in it, so there is no disabled Edit button here waiting to be
 * wired: a row that cannot be opened does not offer to open.
 *
 * Repeat is not an exception to that. It reads a row and writes a new workout dated
 * today, so nothing listed here changes -- which is also why the row it came from stays
 * exactly as it reads while the copy is being planned.
 *
 * WHY IT TAKES SUMMARIES AND NOT SESSIONS
 *
 * `WorkoutSummary` is what `listWorkouts` already returns, and it is a small object
 * per workout rather than every set of every exercise. A lifter with two years of
 * training has perhaps two hundred sessions and several thousand sets, and a list that
 * held the sets to count them would read the lot into memory to draw eight lines of
 * text. Section 17.2's large-history budget is the reason the repository summarises at
 * the storage layer, and this element exists to render that and nothing else.
 *
 * WHY THE DATE IS PRINTED AS IT IS STORED
 *
 * `localDate` is a `YYYY-MM-DD` string and it is shown as one. Handing it to `Date` to
 * get a prettier rendering would parse it as midnight UTC and print the day before to
 * every lifter west of Greenwich -- the failure `types.ts` chose the string
 * representation to make impossible, which a formatter here would reintroduce at the
 * last step. An ISO day is also unambiguous to read, which the alternatives are not.
 */

import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import type { WorkoutSummary } from '../core/summary.js';
import type { LogbookId } from '../types.js';

import { HISTORY_NOTES, HOME_NOTES, WORKOUT_STATUSES, formatDuration } from './copy.js';
import { actionOf, workoutOf } from './dataset.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const WORKOUT_HISTORY_TAG = 'ptk-workout-history';

/**
 * The lifter asked to do one of these again.
 *
 * Carries the identifier and nothing else. This element holds summaries, and a summary
 * has no sets in it -- the plan to copy has to be read back from storage by whoever can
 * read storage, which is the root. Sending the summary would only invite a caller to
 * believe it was enough.
 */
export const WORKOUT_REPEAT_EVENT = 'ptk-workout-repeat';

/** Which workout to do again. */
export interface WorkoutRepeatDetail {
  readonly id: LogbookId;
}

const REPEAT_ACTION = 'repeat-workout';

/**
 * "1 working set", "9 working sets".
 *
 * A function and not a ternary in the template, because a ternary there puts a newline
 * either side of the label -- Lit keeps the whitespace in a text node, and the row then
 * reads "9" and "working sets" with a line break between them.
 */
function setsLabel(count: number): string {
  return count === 1 ? HISTORY_NOTES.setsLabelOne : HISTORY_NOTES.setsLabel;
}

export class PtkWorkoutHistory extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    .note {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
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

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ptk-space-xs);
    }

    .name {
      font-size: var(--ptk-font-size-md);
      overflow-wrap: anywhere;
    }

    .day {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      /* The day never wraps mid-string: "2026-08-" on one line is not a date. */
      white-space: nowrap;
    }

    .what {
      margin: var(--ptk-space-xs) 0 0;
      overflow-wrap: anywhere;
    }

    .facts {
      margin: var(--ptk-space-xs) 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .actions {
      margin-top: var(--ptk-space-xs);
      display: flex;
      /* Trailing, so a column of rows puts every Repeat under the last one. */
      justify-content: flex-end;
    }
  `;

  /** Newest first. Ordered by the repository, which sorts with `byMostRecent`. */
  @property({ attribute: false }) workouts: readonly WorkoutSummary[] = [];

  /**
   * A session is already open, so no row can start one.
   *
   * The buttons are omitted rather than disabled. A disabled control gives no reason
   * and is skipped by a screen reader, which on a list of eight rows is eight silent
   * dead ends; one sentence above the list says the thing once and says why.
   */
  @property({ type: Boolean, attribute: 'busy' }) busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    return html`
      <h2>${HOME_NOTES.historyHeading}</h2>
      ${
        this.workouts.length === 0
          ? html`<p class="note">${HOME_NOTES.historyEmpty}</p>`
          : html`
              ${this.busy ? html`<p class="note">${HISTORY_NOTES.repeatBusy}</p>` : nothing}
              <ul>
                ${this.workouts.map((workout) => this.#row(workout))}
              </ul>
            `
      }
    `;
  }

  #row(workout: WorkoutSummary): TemplateResult {
    return html`<li data-workout=${workout.id}>
      <div class="head">
        <span class="name">${workout.title ?? HISTORY_NOTES.unnamed}</span>
        <span class="day">${workout.localDate}</span>
      </div>
      <p class="what">
        ${
          workout.exerciseNames.length === 0
            ? HISTORY_NOTES.noExercises
            : workout.exerciseNames.join(', ')
        }
      </p>
      <p class="facts">
        <span>${WORKOUT_STATUSES[workout.status]}</span>
        <span
          >${String(workout.completedWorkingSets)} ${setsLabel(workout.completedWorkingSets)}</span
        >
        ${
          workout.durationMillis === null
            ? nothing
            : html`<span>${formatDuration(workout.durationMillis)}</span>`
        }
        ${workout.hasNotes ? html`<span>${HISTORY_NOTES.hasNotes}</span>` : nothing}
      </p>
      ${
        this.busy
          ? nothing
          : html`<div class="actions">
              <ptk-button
                variant="quiet"
                data-action=${REPEAT_ACTION}
                accessible-name=${`${HISTORY_NOTES.repeat}: ${
                  workout.title ?? HISTORY_NOTES.unnamed
                }, ${workout.localDate}`}
                >${HISTORY_NOTES.repeat}</ptk-button
              >
            </div>`
      }
    </li>`;
  }

  readonly #onClick = (event: Event): void => {
    // `busy` again, and not only in the template. Withdrawing the buttons is a decision
    // about what is drawn; a press arriving from a stale frame, a synthetic click or a
    // consumer's own markup does not go through the template at all. The root guards
    // this too, but an element whose docblock says no row can start one has to be true
    // on its own rather than by arrangement with its caller.
    if (this.busy) return;
    if (actionOf(event) !== REPEAT_ACTION) return;
    const id = workoutOf(event);
    if (id === null) return;
    this.dispatchEvent(
      new CustomEvent<WorkoutRepeatDetail>(WORKOUT_REPEAT_EVENT, {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-workout-history': PtkWorkoutHistory;
  }

  interface HTMLElementEventMap {
    [WORKOUT_REPEAT_EVENT]: CustomEvent<WorkoutRepeatDetail>;
  }
}
