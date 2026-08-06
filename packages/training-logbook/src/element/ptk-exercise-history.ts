// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One exercise, read back across every session it appears in. Section 5.5.
 *
 * Read-only, like the workout screen next door, and for the same reason: the way back
 * is drawn by the root, because changing screen is the root's business and needs
 * nothing this element knows. What it draws is `ExerciseHistory` exactly as
 * `core/records.ts` computed it -- the sessions in the order they came, the marks on
 * the sets that hold them, and no arithmetic of its own.
 *
 * WHAT THE MARKS ARE ALLOWED TO BE
 *
 * Words on a row, in the same register as the weight beside them. Not a badge, not a
 * colour a lifter has to have learned, and not a count of how many they have. Section
 * 15.3 rules out the tool having an opinion, and a marker is the place that is hardest
 * to hold: everything that makes one feel like a reward also makes it a judgement about
 * the sessions that did not earn one.
 *
 * They are text and not only a colour for the ordinary accessibility reason as well.
 * A mark that reads as an emphasis to one lifter and as nothing at all to another is
 * not a mark.
 *
 * WHY THE HEAVIEST IS A LIST
 *
 * `ExerciseHistory.heaviest` holds one entry per load kind, because a weighted chin-up
 * and an assisted one have no single heaviest between them. Nearly every history has
 * one entry and the screen still loops, rather than reaching for `[0]` and being wrong
 * on the one movement where it matters.
 *
 * A day is printed as it is stored, `YYYY-MM-DD`. `ptk-workout-history` has the long
 * version of why.
 */

import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import type {
  ExerciseBest,
  ExerciseHistory,
  ExerciseSessionEntry,
  ExerciseSetEntry,
} from '../core/records.js';

import { RECORDS_NOTES, SET_KINDS, SET_STATUSES } from './copy.js';
import { formatEffort, formatPerformance } from './format.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const EXERCISE_HISTORY_TAG = 'ptk-exercise-history';

/**
 * The lifter asked to see one exercise's history.
 *
 * Declared here, on the screen it opens, rather than on either of the two screens that
 * ask for it. Section 5.5 puts the way in on both the logging screen and a workout read
 * back, so neither of them owns the event; what they have in common is where it lands.
 *
 * Carries `exerciseId` -- the catalogue entry -- and not the identifier of the row that
 * was pressed. A history is about a movement across every session, and the row is one
 * appearance of it. `dataset.ts` has the long version of why the two are different.
 */
export const EXERCISE_HISTORY_EVENT = 'ptk-exercise-history-open';

/** Which exercise to read back. */
export interface ExerciseHistoryOpenDetail {
  readonly exerciseId: string;
}

export class PtkExerciseHistory extends LitElement {
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

    .day {
      /* "2026-08-" on one line is not a date. */
      white-space: nowrap;
    }

    ul {
      list-style: none;
      margin: var(--ptk-space-sm) 0 0;
      padding: 0;
    }

    .best > li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .best-label {
      font-weight: 600;
    }

    .best-day {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      white-space: nowrap;
    }

    .sessions > li {
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      padding: var(--ptk-space-sm);
      background: var(--ptk-color-surface-raised);
    }

    .sessions > li + li {
      margin-top: var(--ptk-space-sm);
    }

    .session-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .session-title {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
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

    /*
     * A mark is a word, and this is the whole of what makes it look like one. No
     * background, no icon: a row already carries a kind, a load, a status and
     * sometimes an effort, and a fifth thing shouting is a row nobody reads.
     */
    .marks {
      margin: var(--ptk-space-xs) 0 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
    }
  `;

  /** The history, or `null` where it could not be read. */
  @property({ attribute: false }) history: ExerciseHistory | null = null;

  override render(): TemplateResult {
    const history = this.history;
    if (history === null) return html`<p class="note">${RECORDS_NOTES.unreadable}</p>`;

    return html`
      <h2>${history.displayName ?? RECORDS_NOTES.heading}</h2>
      ${
        history.heaviest.length === 0
          ? nothing
          : html`<ul class="best">
              ${history.heaviest.map((best) => this.#best(best))}
            </ul>`
      }
      ${
        history.sessions.length === 0
          ? html`<p class="note">${RECORDS_NOTES.empty}</p>`
          : html`
              <ul class="sessions">
                ${history.sessions.map((session) => this.#session(session))}
              </ul>
              ${history.truncated ? html`<p class="note">${RECORDS_NOTES.truncated}</p>` : nothing}
            `
      }
    `;
  }

  /**
   * The heaviest set of one load kind, and when it was.
   *
   * Stated at the top as well as marked on its row, because the row may be off the
   * list: the sessions are capped and the marks are not, so a lifter whose best day
   * was two years ago would otherwise see the mark nowhere at all.
   */
  #best(best: ExerciseBest): TemplateResult {
    return html`<li>
      <span class="best-label">${RECORDS_NOTES.heaviestLabel}</span>
      <span>${formatPerformance(best.performance)}</span>
      <span class="best-day">${best.localDate}</span>
    </li>`;
  }

  #session(session: ExerciseSessionEntry): TemplateResult {
    return html`<li data-workout=${session.workoutId}>
      <div class="session-head">
        <h3 class="day">${session.localDate}</h3>
        ${
          session.title === null
            ? nothing
            : html`<span class="session-title">${session.title}</span>`
        }
      </div>
      ${this.#written(session.note)}
      <ul class="sets">
        ${session.sets.map((set) => this.#set(set))}
      </ul>
    </li>`;
  }

  /**
   * One performed set, and whatever it is the record of.
   *
   * `performed` and never `planned`, unlike the workout screen: a set with no result
   * is not in this list at all, so there is no case here where a plan is the only
   * thing there is to draw. The status is still on the row, because an incomplete set
   * is listed and "three of five" next to "Not finished" is the honest pair.
   *
   * `data-kind` is here for the layout check, exactly as it is on the two screens
   * before this one.
   */
  #set(set: ExerciseSetEntry): TemplateResult {
    const effort = formatEffort(set.performed.effort);
    return html`<li data-set=${set.id} data-kind=${set.kind}>
      <div class="set-what">
        <span class="set-kind">${SET_KINDS[set.kind]}</span>
        <span>${formatPerformance(set.performed)}</span>
        <span class="set-status">${SET_STATUSES[set.status]}</span>
        ${effort === null ? nothing : html`<span class="set-effort">${effort}</span>`}
      </div>
      ${
        set.markers.length === 0
          ? nothing
          : html`<p class="marks">
              ${set.markers.map(
                (marker) =>
                  html`<span data-marker=${marker}>${RECORDS_NOTES.markers[marker]}</span>`,
              )}
            </p>`
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
    'ptk-exercise-history': PtkExerciseHistory;
  }

  interface HTMLElementEventMap {
    [EXERCISE_HISTORY_EVENT]: CustomEvent<ExerciseHistoryOpenDetail>;
  }
}
