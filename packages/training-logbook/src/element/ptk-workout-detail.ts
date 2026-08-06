// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One workout that has already been done, opened from the history. Section 5.4.
 *
 * Read-only, and read-only in the strong sense: there is not a control on it. Editing
 * a finished session is its own sub-task with its own decisions about what an edit does
 * to a record, and section 0.4 forbids shipping the journey with a dead button in it.
 * The way back is drawn by the root, exactly as the finish screen's two buttons are,
 * because changing screen is the root's own business and needs nothing this element
 * knows.
 *
 * WHY IT TAKES A SESSION WHERE THE LIST TAKES SUMMARIES
 *
 * `ptk-workout-history` is handed `WorkoutSummary` and says at length why. This is the
 * opposite case and the same reasoning: the whole point of opening a workout is the
 * sets, a summary has none, and there is exactly one session on screen. The read is
 * one `getWorkout` for one identifier rather than a list read that got greedier.
 *
 * WHAT IT DOES NOT SAY
 *
 * No tonnage, no comparison against the session before, no adjective about the work.
 * Section 9.1 lists what a history has to answer and it is four questions, all of them
 * "what happened"; section 15.3 rules out the rest. The single derived thing on the
 * screen is the planned line under an edited set, and both of its numbers were already
 * on the row.
 *
 * A day is printed as it is stored, `YYYY-MM-DD`. `ptk-workout-history` has the long
 * version of why, and it applies once per screen here rather than once per row.
 */

import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import { setWasEdited, summarize } from '../core/summary.js';
import type { WorkoutExercise, WorkoutSession, WorkoutSet } from '../types.js';

import {
  DETAIL_NOTES,
  HISTORY_NOTES,
  SET_KINDS,
  SET_STATUSES,
  WORKOUT_STATUSES,
  formatDuration,
} from './copy.js';
import { formatEffort, formatPerformance } from './format.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const WORKOUT_DETAIL_TAG = 'ptk-workout-detail';

/**
 * "1 working set", "9 working sets". The list's rule, applied to one workout.
 *
 * Duplicated from `ptk-workout-history` rather than shared, at four words, because the
 * alternative is a module both elements import for a ternary. If a third screen ever
 * counts sets it can go in `copy.ts` beside the two words it chooses between.
 */
function setsLabel(count: number): string {
  return count === 1 ? HISTORY_NOTES.setsLabelOne : HISTORY_NOTES.setsLabel;
}

export class PtkWorkoutDetail extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h2 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
      overflow-wrap: anywhere;
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .note {
      margin: var(--ptk-space-xs) 0 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    /* The lifter's own words, which is a different thing from the tool's. */
    .written {
      margin: var(--ptk-space-xs) 0 0;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .facts {
      margin: var(--ptk-space-xs) 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .day {
      /* "2026-08-" on one line is not a date. */
      white-space: nowrap;
    }

    ul {
      list-style: none;
      margin: var(--ptk-space-sm) 0 0;
      padding: 0;
    }

    .lifts > li {
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      padding: var(--ptk-space-sm);
      background: var(--ptk-color-surface-raised);
    }

    .lifts > li + li {
      margin-top: var(--ptk-space-sm);
    }

    .sets > li {
      padding: var(--ptk-space-xs) 0;
      border-top: 1px solid var(--ptk-color-border);
    }

    .set-what {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .set-kind,
    .set-status,
    .set-effort {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .set-plan {
      overflow-wrap: anywhere;
    }
  `;

  /** The workout, or `null` where it could not be read. */
  @property({ attribute: false }) session: WorkoutSession | null = null;

  override render(): TemplateResult {
    const session = this.session;
    if (session === null) return html`<p class="note">${DETAIL_NOTES.unreadable}</p>`;

    const summary = summarize(session);
    return html`
      <h2>${session.title ?? DETAIL_NOTES.heading}</h2>
      <p class="facts">
        <span class="day">${session.localDate}</span>
        <span>${WORKOUT_STATUSES[session.status]}</span>
        <span
          >${String(summary.completedWorkingSets)} ${setsLabel(summary.completedWorkingSets)}</span
        >
        ${
          summary.durationMillis === null
            ? nothing
            : html`<span>${formatDuration(summary.durationMillis)}</span>`
        }
      </p>
      ${this.#written(session.note)}
      ${
        session.exercises.length === 0
          ? html`<p class="note">${DETAIL_NOTES.empty}</p>`
          : html`<ul class="lifts">
              ${session.exercises.map((exercise) => this.#lift(exercise))}
            </ul>`
      }
    `;
  }

  #lift(exercise: WorkoutExercise): TemplateResult {
    return html`<li data-exercise=${exercise.id}>
      <h3>${exercise.displayName}</h3>
      ${this.#written(exercise.note)}
      <ul class="sets">
        ${exercise.sets.map((set) => this.#set(set))}
      </ul>
    </li>`;
  }

  /**
   * One set: what it was for, what happened on it, and how that went.
   *
   * `performed ?? planned` is the logging screen's rule and this is the same row read
   * later, so a set nobody got to still shows the numbers it was written down with
   * rather than a blank. The status beside it is what keeps that honest -- "To do" on
   * a finished workout says plainly that the line is a plan and not a result.
   *
   * `data-kind` is here for the layout check, exactly as it is on the logging screen:
   * a warm-up and a working set render from the same tag with the same classes.
   */
  #set(set: WorkoutSet): TemplateResult {
    const shown = set.performed ?? set.planned;
    const effort = formatEffort(set.performed?.effort ?? null);
    return html`<li data-set=${set.id} data-kind=${set.kind}>
      <div class="set-what">
        <span class="set-kind">${SET_KINDS[set.kind]}</span>
        <span class="set-plan">${formatPerformance(shown)}</span>
        <span class="set-status">${SET_STATUSES[set.status]}</span>
        ${effort === null ? nothing : html`<span class="set-effort">${effort}</span>`}
      </div>
      ${
        setWasEdited(set)
          ? html`<p class="note">${DETAIL_NOTES.plannedLabel} ${formatPerformance(set.planned)}</p>`
          : nothing
      }
      ${this.#written(set.note)}
    </li>`;
  }

  /** A note the lifter wrote, or nothing at all where they wrote none. */
  #written(note: string | null): TemplateResult | typeof nothing {
    if (note === null) return nothing;
    return html`<p class="written">${note}</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-workout-detail': PtkWorkoutDetail;
  }
}
