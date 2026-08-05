// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Way three: what a lifter's own results come to, with nothing ruled on.
 *
 * The brief calls this "the common case" and says it "must be the best-designed
 * screen, not the fallback" -- because a tool that can only answer for the meets
 * somebody has ingested is unhelpful precisely when a lifter is filling in an
 * unfamiliar entry form. So this is the screen with no meet behind it: four
 * grades, the registration they were read under, and the evidence for that
 * registration, all on one surface with nothing folded away.
 *
 * WHY THE ASSUMPTION IS ON THE REPORT AND NOT BEHIND IT
 *
 * `StandingReport`'s own doc comment sets the rule: "A grade with no visible
 * statement of which class, division and tested status it was read under is a
 * number a lifter cannot check, and cannot correct." Four of the five answers
 * choose the table, so a grade is a statement about a lifter *under those
 * answers* and reads as a statement about the lifter. The band is therefore
 * rendered above the grades, unfolded, every time -- and so is the evidence
 * beside it, because the bodyweights and ages are how somebody checks that the
 * weight class and the division are the ones they would have entered.
 *
 * WHAT IT REFUSES TO SAY
 *
 * Section 29: the tool never rules on eligibility. Every word this element can
 * put on a screen comes from `copy.ts`, where the banned vocabulary can be read
 * in one pass -- "qualified", "eligible", "ineligible" appear nowhere, and a
 * grade is something a figure *reaches*, not something a lifter *is*.
 *
 * NO PROGRESS BAR, DELIBERATELY
 *
 * The distance to the next standard is the one figure here that begs to be drawn
 * as a filled track, and it cannot be: the production Content Security Policy
 * forbids an inline `style` attribute (section 5.8), so a width computed per
 * lifter has nowhere to live. It would work all through development and be
 * silently dropped on the deployed site. The figure is written out instead.
 */
import type { Lift } from '@platform-toolkit/data-contracts';
import { formatWeight } from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import { reportedLifts } from '../core/standing.js';
import type {
  BestPerformance,
  CatalogVocabulary,
  LiftStanding,
  ObservedStanding,
  PerformanceSource,
  SetAsideResult,
  StandingReport,
} from '../types.js';

import {
  LIFT_LABELS,
  REPORT_NOTES,
  SET_ASIDE_REASONS,
  STANDARDS_STATUS_NOTES,
  UNGRADED_REASONS,
  ageLabel,
} from './copy.js';
import { registrationLabels } from './labels.js';

/** Kilograms, written the way every other tool in the collection writes them. */
function kilograms(amount: number): string {
  return formatWeight({ amount, unit: 'kg' });
}

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
export const STANDING_REPORT_TAG = 'ptk-standing-report';

/**
 * How the read of this category's published standards is going.
 *
 * Three and not tool 4's four: there is no `unavailable`, because a partition that
 * published nothing is already said better one level down. `UNGRADED_REASONS`
 * reports "no standards for this combination" *per lift*, and per lift is the true
 * granularity -- a federation can publish a total table for a category and no bench
 * table, and one `unavailable` over the whole panel would flatten that into a
 * sentence that is wrong about three lifts to be right about one. `ready` therefore
 * means "these tables are all there are", whether that is four of them or none.
 *
 * `loading` and `failed` are here because neither is sayable from the tables: an
 * empty array is what both look like, and both would render as the federation
 * publishing nothing -- which tells a lifter their category has no standards when
 * the truth is that a request is in flight, or that reloading would fix it.
 */
export type StandardsStatus = 'loading' | 'ready' | 'failed';

export class PtkStandingReport extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .section + .section {
      margin-top: var(--ptk-space-lg);
    }

    h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-md);
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * A definition list rather than a table. Five pairs read down a 320 px column
     * without a single horizontal decision, and a table of two columns is a table
     * a phone has to scroll sideways the moment a division label is long.
     */
    .pairs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-sm);
      margin: 0;
    }

    .pair {
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .pair dt {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .pair dd {
      margin: 0;
      font-weight: 600;
      /* A federation's own division names run long, and a name is not worth a
         sideways scroll. Value anywhere, never break-word: only the first lowers
         the min-content size, and a grid track will not go under that. */
      overflow-wrap: anywhere;
    }

    .unknown {
      font-weight: 400;
      color: var(--ptk-color-text-muted);
    }

    .lifts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .lift {
      display: grid;
      align-content: start;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .lift-name {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * The figure a lifter came for. Not a viewport-relative size: the same card
     * sits in a 320 px embed column on a desktop page, where a viewport unit
     * would make the number on the screen the smallest thing on it.
     */
    .best {
      font-size: var(--ptk-font-size-xl);
      font-weight: 700;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }

    .achieved {
      font-weight: 600;
    }

    .toward-next,
    .source,
    .table-name,
    .reason {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .set-aside {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .struck {
      padding-left: var(--ptk-space-md);
      border-left: 3px solid var(--ptk-color-border);
    }

    .struck-source {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .struck-reason {
      display: block;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .caveat {
      margin: var(--ptk-space-lg) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /** The results this report was read from, for the evidence beside the grades. */
  @property({ attribute: false }) standing: ObservedStanding | null = null;

  /** The four grades and the registration they assume. */
  @property({ attribute: false }) report: StandingReport | null = null;

  /** This federation's own names for the identifiers a registration is keyed on. */
  @property({ attribute: false }) vocabulary: CatalogVocabulary | null = null;

  /**
   * Whether the tables the grades were read against are the ones that apply.
   *
   * Defaults to `ready`, which is the honest default for the way this element is
   * usually driven: a consumer that hands it a report has already decided what to
   * grade against, and every story and test below says so by saying nothing. Only a
   * consumer that fetches a partition per category -- the site does, because the
   * eight of them are the better part of eight megabytes -- has a `loading` to
   * report, and that consumer is the one that would otherwise show a lifter "no
   * standards published" for the second before the standards arrive.
   */
  @property({ attribute: false }) standardsStatus: StandardsStatus = 'ready';

  /**
   * One notice for three missing properties, and it is not a shortcut.
   *
   * The three arrive together or not at all -- a report is graded from a standing
   * against a catalogue -- so there is no state in which two are present and the
   * screen has something honest to say. Three separate sentences would be three
   * ways of writing the same one, and two of them would be unreachable.
   */
  override render(): TemplateResult {
    const standing = this.standing;
    const report = this.report;
    const vocabulary = this.vocabulary;
    if (standing === null || report === null || vocabulary === null) {
      return html`<ptk-notice tone="info">
        Add a result and answer the registration questions. The grades appear here.
      </ptk-notice>`;
    }

    return html`
      <div class="section">
        <h3>Read under</h3>
        <p class="note">${REPORT_NOTES.registration}</p>
        ${this.#renderRegistration(report, vocabulary)}
      </div>
      <div class="section">
        <h3>What these results record</h3>
        ${this.#renderEvidence(standing)}
      </div>
      <div class="section">
        <h3>Against this federation's standards</h3>
        ${
          this.standardsStatus === 'ready'
            ? html`<ul class="lifts">
                  ${reportedLifts().map(
                    (lift) => html`<li class="lift">${this.#renderLift(lift, report)}</li>`,
                  )}
                </ul>
                ${this.#renderPartialTotal(standing.partialTotal)}`
            : html`<ptk-notice tone=${this.standardsStatus === 'failed' ? 'error' : 'info'}>
                ${STANDARDS_STATUS_NOTES[this.standardsStatus]}
              </ptk-notice>`
        }
      </div>
      ${this.#renderSetAside(standing.setAside)}
      <p class="caveat">${REPORT_NOTES.notARuling}</p>
    `;
  }

  #renderRegistration(report: StandingReport, vocabulary: CatalogVocabulary): TemplateResult {
    return html`<dl class="pairs">
      ${registrationLabels(report.registration, vocabulary).map(
        (label) => html`
          <div class="pair">
            <dt>${label.axis}</dt>
            <dd>
              ${
                label.value ??
                html`<span class="unknown">Not in this federation's current catalogue</span>`
              }
            </dd>
          </div>
        `,
      )}
    </dl>`;
  }

  /**
   * The figures the registration above was chosen from.
   *
   * Here rather than folded because it is the only way to check the two answers
   * most easily got wrong: a weight class is chosen from a bodyweight and a
   * division from an age, and both of those are things the archive recorded on a
   * particular day rather than things that are true now. A lifter who weighed in
   * at 83.1 kg last spring and is at 80 kg today needs to see which figure the
   * class was read from.
   */
  #renderEvidence(standing: ObservedStanding): TemplateResult {
    const ages = standing.ages.map((age) => ageLabel(age.years, age.approximate));
    return html`<dl class="pairs">
      <div class="pair">
        <dt>Results counted</dt>
        <dd>${standing.entries.length}</dd>
      </div>
      <div class="pair">
        <dt>Bodyweight recorded</dt>
        <dd>${describeRange(standing.bodyweights)}</dd>
      </div>
      <div class="pair">
        <dt>Age recorded</dt>
        <dd>
          ${ages.length === 0 ? html`<span class="unknown">Not recorded</span>` : ages.join(', ')}
        </dd>
      </div>
    </dl>`;
  }

  #renderLift(lift: Lift, report: StandingReport): TemplateResult {
    const standing = report[lift];
    return html`
      <p class="lift-name">${LIFT_LABELS[lift]}</p>
      ${standing.kind === 'graded' ? this.#renderGraded(standing) : this.#renderUngraded(standing)}
    `;
  }

  /**
   * A figure, the standard it reaches, and how far the next one is.
   *
   * The table is named on every card rather than once above them, because the
   * four lifts are not necessarily read from one table -- scope is per lift
   * (`ClassificationScope` carries one), and a federation that publishes a
   * single-lift ladder at a different specificity from its total ladder produces
   * exactly that. A table named once at the top would be wrong for three cards
   * and there would be nothing on screen to show it.
   */
  #renderGraded(standing: Extract<LiftStanding, { kind: 'graded' }>): TemplateResult {
    const { achieved, next, kilogramsToNext } = standing.classification;
    return html`
      <span class="best">${kilograms(standing.best.kilograms)}</span>
      <span class="achieved">
        ${
          achieved === null
            ? html`<span class="unknown">${REPORT_NOTES.belowFirstStandard}</span>`
            : achieved.label
        }
      </span>
      ${
        next === null || kilogramsToNext === null
          ? nothing
          : html`<span class="toward-next">${kilograms(kilogramsToNext)} to ${next.label}</span>`
      }
      ${renderSource(standing.best.source)}
      <span class="table-name">Read from ${standing.table.label}</span>
    `;
  }

  /**
   * No grade, and whose gap it is.
   *
   * The figure is still shown when there is one, which is the whole reason
   * `LiftStanding`'s ungraded arm carries a `best`. A lifter with a 205 kg
   * deadlift in a category this federation publishes no ladder for has still
   * pulled 205 kg, and a card showing only the complaint reads as though the lift
   * did not happen.
   */
  #renderUngraded(standing: Extract<LiftStanding, { kind: 'ungraded' }>): TemplateResult {
    return html`
      ${
        standing.best === null
          ? html`<span class="best unknown">&mdash;</span>`
          : html`<span class="best">${kilograms(standing.best.kilograms)}</span>`
      }
      <span class="reason">${UNGRADED_REASONS[standing.reason]}</span>
      ${standing.best === null ? nothing : renderSource(standing.best.source)}
    `;
  }

  #renderPartialTotal(partialTotal: BestPerformance | null): TemplateResult | typeof nothing {
    if (partialTotal === null) return nothing;
    return html`<p class="note">
      ${kilograms(partialTotal.kilograms)} at ${partialTotal.source.meetName}.
      ${REPORT_NOTES.partialTotal}
    </p>`;
  }

  #renderSetAside(setAside: readonly SetAsideResult[]): TemplateResult | typeof nothing {
    if (setAside.length === 0) return nothing;
    return html`<div class="section">
      <h3>Set aside</h3>
      <p class="note">${REPORT_NOTES.setAside}</p>
      <ul class="set-aside">
        ${setAside.map(
          (result) =>
            html`<li class="struck">
              <span class="struck-source">${result.source.meetName}</span>
              <span class="struck-reason">
                ${SET_ASIDE_REASONS[result.reason]} The sheet reads ${result.place}.
              </span>
            </li>`,
        )}
      </ul>
    </div>`;
  }
}

/**
 * Where a figure came from, in the archive's own words.
 *
 * A free function rather than a method because it is called from two of the
 * card's three arms and neither reads anything off the host. The day is wrapped
 * in `<time>` so it is a machine-readable date rather than a string that looks
 * like one, and it is rendered as the `YYYY-MM-DD` the archive prints rather than
 * localised: a lifter is holding this up against a results sheet, and a sheet
 * that says 2026-03-14 is easier to match against 2026-03-14 than against
 * "14 March 2026".
 */
function renderSource(source: PerformanceSource): TemplateResult {
  return html`<span class="source">
    ${source.meetName}, <time datetime=${source.on}>${source.on}</time>
  </span>`;
}

/**
 * A set of recorded figures as one line.
 *
 * The range and not the latest, because the question the reader is asking is
 * which class these results support, and a lifter who has weighed in either side
 * of a boundary is the case the whole registration screen exists for. Showing one
 * figure would answer a question nobody asked and hide the one they did.
 */
function describeRange(ascending: readonly number[]): TemplateResult | string {
  const [lightest, ...rest] = ascending;
  if (lightest === undefined) return html`<span class="unknown">Not recorded</span>`;
  const heaviest = rest.at(-1);
  if (heaviest === undefined) return kilograms(lightest);
  return `${kilograms(lightest)} to ${kilograms(heaviest)}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-standing-report': PtkStandingReport;
  }
}
