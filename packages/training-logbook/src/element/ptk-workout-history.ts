// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a lifter has already done, listed newest first.
 *
 * Read-only, deliberately and not provisionally. Editing history is Milestone 3 and
 * section 0.4 is explicit that a milestone must not ship its journey with dead
 * controls in it, so there is no disabled Edit button here waiting to be wired: a row
 * that cannot be opened does not offer to open.
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

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import type { WorkoutSummary } from '../core/summary.js';

import { HISTORY_NOTES, HOME_NOTES, WORKOUT_STATUSES, formatDuration } from './copy.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const WORKOUT_HISTORY_TAG = 'ptk-workout-history';

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
  `;

  /** Newest first. Ordered by the repository, which sorts with `byMostRecent`. */
  @property({ attribute: false }) workouts: readonly WorkoutSummary[] = [];

  override render(): TemplateResult {
    return html`
      <h2>${HOME_NOTES.historyHeading}</h2>
      ${
        this.workouts.length === 0
          ? html`<p class="note">${HOME_NOTES.historyEmpty}</p>`
          : html`<ul>
              ${this.workouts.map((workout) => this.#row(workout))}
            </ul>`
      }
    `;
  }

  #row(workout: WorkoutSummary): TemplateResult {
    return html`<li>
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
        <span>${String(workout.completedWorkingSets)} ${HISTORY_NOTES.setsLabel}</span>
        ${
          workout.durationMillis === null
            ? nothing
            : html`<span>${formatDuration(workout.durationMillis)}</span>`
        }
        ${workout.hasNotes ? html`<span>${HISTORY_NOTES.hasNotes}</span>` : nothing}
      </p>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-workout-history': PtkWorkoutHistory;
  }
}
