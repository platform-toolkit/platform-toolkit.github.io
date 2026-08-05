// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The results a reading is built from, listed so they can be checked and undone.
 *
 * Every figure this tool prints is the best of something across this list, and a
 * list that is not on screen makes each of those figures unaccountable: a lifter
 * looking at a squat they do not recognise has no way to find the meet it came from,
 * and a typo in a bodyweight moves a whole weight class with no visible cause. So
 * the results are shown in full, in the archive's own terms, with the one control
 * that can correct a mistake.
 *
 * REMOVING, AND NOT EDITING
 *
 * There is no edit control, and that is a choice rather than a gap. An edit form
 * would have to re-open a result as a draft, which means holding a half-typed copy
 * of it beside the finished one and deciding which the grades are read from while it
 * is open. Remove-and-retype has one state, and the retyping is four fields the form
 * carries forward anyway.
 *
 * WHY A ROW SAYS SO LITTLE
 *
 * A row prints the meet, the day, the lifts and the total, and stops. It does not
 * print the class, the division or the tested status, even though the entry carries
 * all three -- those belong to the registration screen, where they are shown next to
 * what this federation would call them and next to the control that answers them.
 * Printed here as well they would read as a second, disagreeing answer.
 */
import type { AthleteEntry, Lift } from '@platform-toolkit/data-contracts';
import { formatWeight } from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import { LIFT_LABELS, RESULT_LOG_NOTES, testedLabel } from './copy.js';

/** Fired when the reader takes a result back out of the reading. */
export interface ResultRemovedDetail {
  /**
   * Which result, by position in the list that was rendered.
   *
   * By position and not by identity, because an entry has none -- the contract has
   * no identifier field, and inventing one here would mean this element deciding
   * that two identical results are one result. Two genuinely identical rows are
   * possible (a lifter with two same-day meets, or a duplicate somebody typed
   * twice), and the honest answer to "remove this one" is the one at this index.
   */
  readonly index: number;
}

/** Event name, exported so a listener cannot misspell it. */
export const RESULT_REMOVED_EVENT = 'ptk-result-removed';

/** The `data-` key naming which row a remove button belongs to. */
const INDEX_DATASET_KEY = 'index';

/** The lifts a row prints, in the order a scoresheet prints them. */
const ROW_LIFTS: readonly Lift[] = ['squat', 'bench', 'deadlift', 'total'];

/**
 * The tag this element is registered under by `defineQualificationCheck()`.
 *
 * Declared here and registered there, rather than by a `@customElement`
 * decorator, because the decorator writes to the registry the instant this module
 * is evaluated -- and the registry is a global that throws on a second write.
 * A consumer whose bundler failed to dedupe this package, or that imports it
 * alongside another copy, would get a `NotSupportedError` from a file it did not
 * write before a line of its own code ran (section 15).
 */
export const RESULT_LOG_TAG = 'ptk-result-log';

export class PtkResultLog extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .results {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .result {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .meet {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .where {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      overflow-wrap: anywhere;
    }

    /*
     * Four short figures across, wrapping to two and two before they wrap to one.
     * A 5rem track is what "Deadlift" plus "182.5 kg" needs at 200% text, and the
     * min() wrapper keeps a track from outgrowing a 320px column.
     */
    .lifts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 5rem), 1fr));
      gap: var(--ptk-space-xs);
      margin: 0;
    }

    .lift dt {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .lift dd {
      margin: 0;
      font-weight: 600;
    }

    .missed {
      font-weight: 400;
      color: var(--ptk-color-text-muted);
    }

    /*
     * The button is placed after the figures in both the source and the layout, so
     * that reaching the destructive control means passing what it destroys -- and so
     * that a tab through the list never lands on Remove before the row it removes
     * has been read out.
     */
    .actions {
      display: flex;
      justify-content: flex-end;
    }

    .actions ptk-button {
      max-width: 100%;
    }
  `;

  /** The results a reading is built from, newest last. */
  @property({ attribute: false }) entries: readonly AthleteEntry[] = [];

  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    // One tag rather than a comma-separated list, so the nodes come back typed
    // through the tag-name map and no `instanceof` filter is needed to reach
    // `updateComplete`.
    const buttons = this.shadowRoot?.querySelectorAll('ptk-button') ?? [];
    await Promise.all([...buttons].map((button) => button.updateComplete));
    return done;
  }

  override render(): TemplateResult {
    const [first] = this.entries;
    if (first === undefined) {
      return html`<ptk-notice tone="info">${RESULT_LOG_NOTES.empty}</ptk-notice>`;
    }

    return html`
      <p class="note">${RESULT_LOG_NOTES.notSaved}</p>
      <ul class="results">
        ${this.entries.map((entry, index) => this.#renderResult(entry, index))}
      </ul>
    `;
  }

  #renderResult(entry: AthleteEntry, index: number): TemplateResult {
    return html`<li class="result">
      <span class="meet">${entry.meetName}</span>
      <span class="where">
        <time datetime=${entry.date}>${entry.date}</time> &middot; ${describeFederation(entry)}
        &middot; ${testedLabel(entry.tested)}
      </span>
      <dl class="lifts">
        ${ROW_LIFTS.map(
          (lift) =>
            html`<div class="lift">
              <dt>${LIFT_LABELS[lift]}</dt>
              <dd>${renderKilograms(kilogramsOf(entry, lift))}</dd>
            </div>`,
        )}
      </dl>
      <div class="actions" data-index=${String(index)}>
        <ptk-button
          variant="quiet"
          accessible-name=${`${RESULT_LOG_NOTES.remove} ${entry.meetName}, ${entry.date}`}
          @click=${this.#remove}
        >
          ${RESULT_LOG_NOTES.remove}
        </ptk-button>
      </div>
    </li>`;
  }

  /**
   * Reads the row off the composed path rather than off the event's target.
   *
   * A click inside a `ptk-button` is retargeted to the button host on its way out,
   * so `event.target` is the same element for every row and the dataset it carries
   * is empty. The symptom would be every Remove button taking out the first result
   * (section 5.8).
   */
  readonly #remove = (event: Event): void => {
    const index = indexOn(event);
    if (index === null) return;
    this.dispatchEvent(
      new CustomEvent<ResultRemovedDetail>(RESULT_REMOVED_EVENT, {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

/** The row a click came from, or `null` where the path carries no row. */
function indexOn(event: Event): number | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const raw = target.dataset[INDEX_DATASET_KEY];
    if (raw === undefined) continue;
    // Written by this element from an array index, so it is a whole number or
    // something has gone wrong that removing an arbitrary result would not fix.
    // `Number.parseInt` would read "3px" as 3, which is the failure mode a
    // destructive control should not have.
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }
  return null;
}

/**
 * Which body sanctioned the meet, naming the parent only where one was given.
 *
 * The parent is what decides whether a route naming it accepts an affiliate's meet,
 * so it belongs on the row -- and when it is absent that absence is the answer,
 * which is why nothing is printed in its place.
 */
function describeFederation(entry: AthleteEntry): string {
  if (entry.parentFederation === null) return entry.federation;
  return `${entry.federation} (${entry.parentFederation})`;
}

/** One lift off an entry, in the contract's own spelling. */
function kilogramsOf(entry: AthleteEntry, lift: Lift): number | null {
  switch (lift) {
    case 'squat':
      return entry.squatKg;
    case 'bench':
      return entry.benchKg;
    case 'deadlift':
      return entry.deadliftKg;
    case 'total':
      return entry.totalKg;
  }
}

/**
 * A figure, or a visible absence.
 *
 * An em dash rather than a blank cell or a nought. A blank reads as a rendering
 * fault and a nought reads as a lift attempted at no weight; what is true is that
 * this lift was not contested or not made, and a dash is how a results sheet says
 * so.
 */
function renderKilograms(kilograms: number | null): TemplateResult | string {
  if (kilograms === null) return html`<span class="missed">&mdash;</span>`;
  return formatWeight({ amount: kilograms, unit: 'kg' });
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-result-log': PtkResultLog;
  }

  interface HTMLElementEventMap {
    [RESULT_REMOVED_EVENT]: CustomEvent<ResultRemovedDetail>;
  }
}
