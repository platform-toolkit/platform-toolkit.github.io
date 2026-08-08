// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Way one: one meet's published criteria, read against one lifter's results.
 *
 * The screen that decides whether somebody pays an entry fee, which is why almost
 * every design decision in it is about refusing to compress. A meet's criteria are a
 * set of alternatives, each with its own window, its own idea of what counts as a
 * qualifying meet, and sometimes its own competition -- and the tempting screen is
 * the one that folds all of that into a single green tick. That screen would be
 * wrong for the lifter it matters most to: the Masters lifter whose total is an
 * Elite total in one table and short of it in the other, the lifter whose best is
 * eleven days outside a window, the lifter whose meet the route's federation list
 * does not name.
 *
 * So every route is printed, in full, with its own dates and its own reasons, and
 * the results a route could not read are listed rather than dropped.
 *
 * NOTHING HERE IS A RULING
 *
 * Section 29 puts the verdict with the federation. `criteria.ts` keeps it there by
 * having nowhere to put one -- there is no `eligible` on any type it produces -- and
 * this element keeps it there by having nothing to say that is not either a
 * published figure, a published sentence, or arithmetic between the two. The words
 * come from `copy.ts`, where the banned vocabulary can be read in one pass.
 *
 * THE QUOTATION IS THE POINT, NOT DECORATION
 *
 * Every route carries the announcement's own words and they are rendered as text --
 * `Sentence` in the contract, into a text binding here, never as markup (section
 * 2.3). A lifter who disagrees with this tool's reading needs the sentence the
 * reading came from, because the argument they will have is with the meet and not
 * with a web page.
 */
import type {
  PointsRequirement,
  QualifyingCondition,
  QualifyingRoute,
} from '@platform-toolkit/data-contracts';
import { formatWeight } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-notice';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import { routeAvailability } from '../core/criteria.js';
import type {
  CalendarDay,
  CatalogVocabulary,
  DisregardedResult,
  MeetReading,
  MeetTiming,
  RouteOutcome,
  RouteReading,
  StandardReading,
  UncheckableCondition,
} from '../types.js';

import {
  CONDITION_SOURCE,
  DISREGARD_REASONS,
  MEET_NOTES,
  MEET_TIMING,
  READING_BASIS,
  ROUTE_AVAILABILITY,
  REPORT_NOTES,
  TESTED_OFFERING,
  UNREADABLE_STANDARD_REASONS,
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
export const MEET_READING_TAG = 'ptk-meet-reading';

export class PtkMeetReading extends LitElement {
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

    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    h5 {
      margin: var(--ptk-space-sm) 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .meet-name {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }

    .note,
    .where,
    .detail {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    /*
     * The status word, in a pill that is a border and not a fill. A meet past its
     * closing day is a fact and not a warning, and a filled amber chip would read as
     * one -- next to a figure a lifter is already anxious about.
     */
    .timing,
    .availability {
      display: inline-block;
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-sm);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
    }

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
      overflow-wrap: anywhere;
    }

    .unknown {
      font-weight: 400;
      color: var(--ptk-color-text-muted);
    }

    .routes,
    .conditions,
    .disregarded,
    .readings {
      display: grid;
      gap: var(--ptk-space-md);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .disregarded {
      gap: var(--ptk-space-xs);
    }

    .route {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    /*
     * The announcement's own words, set apart so they are visibly not this tool's.
     * A quotation folded into the prose would let a reader attribute a paraphrase to
     * the meet, which is the argument this screen exists to keep them out of.
     */
    blockquote {
      margin: 0;
      padding-left: var(--ptk-space-md);
      border-left: 3px solid var(--ptk-color-border-strong);
      overflow-wrap: anywhere;
    }

    .figure {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }

    .verdict {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .small {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      overflow-wrap: anywhere;
    }

    .caveat {
      margin: var(--ptk-space-lg) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .source p {
      margin: 0;
    }

    /*
     * The citation is a link on its own line, not a link inside the sentence.
     *
     * A link set in running text is exactly as tall as its line box -- seventeen
     * pixels here -- and there is no honest way to give it the 44px tap target
     * section 5.7 requires while it stays there. Vertical padding on an inline
     * box grows the hit area without growing the line, so the target ends up
     * overlapping the prose above it and a thumb aimed at a sentence opens a new
     * tab. Same shape as the conversion chart's citation, which is where the
     * collection settled this the first time.
     *
     * Found by the narrow-layout check rather than by reading: nine failures across the
     * five passes, all of them "a" at 115x17. Nothing else on this screen is a
     * link, so nothing else had already paid for the lesson.
     */
    .source-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      /* The accent, matching tokens.css, which styles links at document level
         and therefore cannot reach inside a shadow root. The underline stays:
         colour is never the only signal that something is a link. */
      color: var(--ptk-color-accent);
      overflow-wrap: anywhere;
    }
  `;

  /** The meet, the registration it was read under, and every route. */
  @property({ attribute: false }) reading: MeetReading | null = null;

  /**
   * Where the meet sits relative to today.
   *
   * Passed in rather than computed, because this package holds no clock (section
   * 15) and an element that read one would be untestable at any date but today.
   */
  @property({ attribute: false }) timing: MeetTiming | null = null;

  /**
   * The day a staged route's opening date is read against.
   *
   * A date and not a clock, which is the distinction section 15 draws: this
   * element may be handed a day, and it may not go and find one. `null` leaves a
   * staged route printing its opening date with no claim about whether it has
   * arrived -- the honest answer for a consumer that has not said what day it is,
   * and better than assuming today.
   */
  @property({ attribute: false }) today: CalendarDay | null = null;

  /** This federation's own names for the identifiers a registration is keyed on. */
  @property({ attribute: false }) vocabulary: CatalogVocabulary | null = null;

  override render(): TemplateResult {
    const { reading, vocabulary } = this;
    if (reading === null || vocabulary === null) {
      return html`<ptk-notice tone="info">
        Pick a meet and answer the registration questions. Its criteria appear here.
      </ptk-notice>`;
    }

    const { meet } = reading;
    return html`
      <div class="section">
        <p class="meet-name">${meet.label}</p>
        <p class="where">
          ${meet.sanctionedBy} &middot; ${meet.location} &middot;
          <time datetime=${meet.held.from}>${meet.held.from}</time>
          ${
            meet.held.from === meet.held.to
              ? nothing
              : html`&ndash; <time datetime=${meet.held.to}>${meet.held.to}</time>`
          }
        </p>
        ${
          this.timing === null
            ? nothing
            : html`<p><span class="timing">${MEET_TIMING[this.timing]}</span></p>`
        }
        <p class="note">${MEET_NOTES.intro}</p>
        ${this.#renderMeetFacts(reading)}
      </div>

      <div class="section">
        <h3>Read under</h3>
        <p class="note">${REPORT_NOTES.registration}</p>
        <dl class="pairs">
          ${registrationLabels(reading.registration, vocabulary).map(
            (label) =>
              html`<div class="pair">
                <dt>${label.axis}</dt>
                <dd>
                  ${
                    label.value ??
                    html`<span class="unknown">Not in this federation's current catalogue</span>`
                  }
                </dd>
              </div>`,
          )}
        </dl>
      </div>

      ${this.#renderEntry(reading)} ${this.#renderConditions(reading.conditions)}
      ${this.#renderSource(reading)}
      <p class="caveat">${REPORT_NOTES.notARuling}</p>
    `;
  }

  #renderMeetFacts(reading: MeetReading): TemplateResult {
    const { meet } = reading;
    return html`
      <dl class="pairs">
        <div class="pair">
          <dt>Competition</dt>
          <dd>${TESTED_OFFERING[meet.testedOffering]}</dd>
        </div>
        <div class="pair">
          <dt>Entry closes</dt>
          <dd>
            ${
              meet.entryClosesOn === null
                ? html`<span class="unknown">Not published</span>`
                : html`<time datetime=${meet.entryClosesOn}>${meet.entryClosesOn}</time>`
            }
          </dd>
        </div>
        <div class="pair">
          <dt>Sanction</dt>
          <dd>${meet.sanctionNumber ?? html`<span class="unknown">Not published</span>`}</dd>
        </div>
      </dl>
      <p class="note">
        ${reading.offersThisEntry ? MEET_NOTES.offersThisEntry : MEET_NOTES.offersOtherEntry}
      </p>
      <p class="note">
        ${meet.offerings
          .map((offering) => `${offering.discipline} (${offering.equipment.join(', ')})`)
          .join(' · ')}
      </p>
    `;
  }

  /**
   * The three states of a meet's criteria, kept apart.
   *
   * `open` and `unstated` render as two visibly different things because they are
   * opposite facts: one is a meet that asks for no total, and one is a meet nobody
   * has transcribed. `unstated` is an info notice and not an error, for the reason
   * `ptk-notice` documents -- unavailable is not a fault, and an error tone here
   * would read as the meet having refused the lifter.
   */
  #renderEntry(reading: MeetReading): TemplateResult {
    const { entry } = reading;
    switch (entry.kind) {
      case 'open':
        return html`<div class="section">
          <h3>${MEET_NOTES.entryOpenHeading}</h3>
          <blockquote>${entry.quotation}</blockquote>
        </div>`;
      case 'unstated':
        return html`<div class="section">
          <h3>${MEET_NOTES.entryUnstatedHeading}</h3>
          <ptk-notice tone="info">${entry.detail}</ptk-notice>
        </div>`;
      case 'routes':
        return html`<div class="section">
          <h3>Ways in</h3>
          <p class="note">${MEET_NOTES.routesAreAlternatives}</p>
          <ul class="routes">
            ${entry.routes.map((route) => html`<li class="route">${this.#renderRoute(route)}</li>`)}
          </ul>
        </div>`;
    }
  }

  #renderRoute(reading: RouteReading): TemplateResult {
    const { route } = reading;
    return html`
      <h4>${route.label}</h4>
      ${this.#renderRouteTerms(route)}
      ${
        reading.best === null
          ? nothing
          : html`<div>
              <span class="figure">${kilograms(reading.best.kilograms)}</span>
              <span class="small">
                ${reading.best.source.meetName},
                <time datetime=${reading.best.source.on}>${reading.best.source.on}</time>
              </span>
            </div>`
      }
      ${this.#renderOutcome(reading.outcome)}
      <h5>${MEET_NOTES.quotationHeading}</h5>
      <blockquote>${route.quotation}</blockquote>
      ${
        route.dispute === null
          ? nothing
          : html`<ptk-notice tone="info">
              ${MEET_NOTES.disputeHeading} ${route.dispute.summary}
              <ul class="readings">
                ${route.dispute.readings.map(
                  (found) =>
                    html`<li>
                      <span class="small">${found.where}</span>
                      <blockquote>${found.quotation}</blockquote>
                    </li>`,
                )}
              </ul>
            </ptk-notice>`
      }
      ${this.#renderDisregarded(reading.disregarded)}
    `;
  }

  /**
   * When a staged route starts taking entries, and what else the meet attaches.
   *
   * Rendered above the window rather than below it because the two are different
   * dates about different things -- this one is when the entry form opens, the
   * window is when the total had to be set -- and a reader who meets the window
   * first reads this as a correction to it.
   */
  #renderAvailability(route: QualifyingRoute): TemplateResult | typeof nothing {
    const { availability } = route;
    if (availability === null) return nothing;

    const state = this.today === null ? null : routeAvailability(route, this.today);
    return html`
      <p class="small">
        ${MEET_NOTES.routeOpensOnHeading}
        <time datetime=${availability.opensOn}>${availability.opensOn}</time>.
        ${
          state === null || state === 'unstaged'
            ? nothing
            : html`<span class="availability">${ROUTE_AVAILABILITY[state]}</span>`
        }
      </p>
      ${
        availability.contingency === null
          ? nothing
          : html`<p class="small">${MEET_NOTES.routeContingencyHeading}</p>
              <blockquote>${availability.contingency}</blockquote>`
      }
    `;
  }

  /** What a route asks of the meet the qualifying total was set at. */
  #renderRouteTerms(route: QualifyingRoute): TemplateResult {
    const { performance } = route;
    return html`
      <p class="detail">${performance.description}</p>
      ${this.#renderAvailability(route)}
      <p class="small">
        ${MEET_NOTES.windowHeading}
        <time datetime=${route.window.from}>${route.window.from}</time> and
        <time datetime=${route.window.to}>${route.window.to}</time>.
      </p>
      ${
        performance.federationNames === null
          ? nothing
          : html`<p class="small">
              ${MEET_NOTES.federationsHeading} ${performance.federationNames.join(', ')}
            </p>`
      }
      ${
        performance.territory === null
          ? nothing
          : html`<p class="small">${MEET_NOTES.territoryHeading} ${performance.territory}</p>`
      }
    `;
  }

  #renderOutcome(outcome: RouteOutcome): TemplateResult {
    switch (outcome.kind) {
      case 'read':
        return html`
          <p class="small">${READING_BASIS[outcome.basis]}</p>
          ${renderStandardReading(outcome.reading)}
        `;
      case 'two-readings':
        // Both, side by side, and no basis claimed. Choosing one would fail a
        // lifter who qualified or admit one who did not, and the criteria are what
        // is silent -- so the silence is what is shown.
        return html`
          <div>
            <h5>${READING_BASIS.open}</h5>
            ${renderStandardReading(outcome.open)}
          </div>
          <div>
            <h5>${READING_BASIS['lifters-age-division']}</h5>
            ${renderStandardReading(outcome.liftersAgeDivision)}
          </div>
        `;
      case 'not-open-to-this-entry':
        return html`<p class="verdict">
          ${outcome.opensTested ? MEET_NOTES.routeOpensTested : MEET_NOTES.routeOpensUntested}
        </p>`;
      case 'no-result-in-window':
        return html`<p class="verdict">${MEET_NOTES.noResultInWindow}</p>`;
      case 'points-not-computed':
        return this.#renderPoints(outcome.requirement);
    }
  }

  /**
   * A coefficient threshold, printed rather than computed.
   *
   * Which coefficient a federation quotes is the federation's decision, and a tool
   * that guessed DOTS where the meet meant Wilks would produce a number that looks
   * authoritative and is not. The threshold for this lifter's sex is picked out --
   * the others are for other lifters and printing them all is a table nobody reads.
   */
  #renderPoints(requirement: PointsRequirement): TemplateResult {
    const sex = this.reading?.registration.sex;
    const threshold = requirement.thresholds.find((candidate) => candidate.sex === sex);
    return html`
      <p class="verdict">
        ${
          threshold === undefined
            ? `Asks for a ${requirement.systemId} score. The criteria publish no threshold for this category.`
            : `Asks for a ${requirement.systemId} score of ${String(threshold.minimumPoints)}.`
        }
      </p>
      <p class="small">${MEET_NOTES.pointsNotComputed}</p>
    `;
  }

  #renderDisregarded(disregarded: readonly DisregardedResult[]): TemplateResult | typeof nothing {
    if (disregarded.length === 0) return nothing;
    return html`
      <h5>${MEET_NOTES.disregardedHeading}</h5>
      <ul class="disregarded">
        ${disregarded.map(
          (result) =>
            html`<li class="small">
              ${result.source.meetName},
              <time datetime=${result.source.on}>${result.source.on}</time>.
              ${DISREGARD_REASONS[result.reason]}
            </li>`,
        )}
      </ul>
    `;
  }

  /**
   * Conditions no arithmetic settles, with the document each one comes from.
   *
   * Named by source rather than merged, because "the meet says" and "the federation
   * says" are answerable in different places: one is an email to a meet director and
   * one is a rulebook clause. A merged list makes every condition the meet's.
   */
  #renderConditions(conditions: readonly UncheckableCondition[]): TemplateResult | typeof nothing {
    if (conditions.length === 0) return nothing;
    return html`<div class="section">
      <h3>${MEET_NOTES.conditionsHeading}</h3>
      <ul class="conditions">
        ${conditions.map((entry) => this.#renderCondition(entry))}
      </ul>
    </div>`;
  }

  #renderCondition(entry: UncheckableCondition): TemplateResult {
    const condition: QualifyingCondition = entry.condition;
    return html`<li>
      <h4>${condition.label}</h4>
      <p class="small">${CONDITION_SOURCE[entry.from]}</p>
      <p class="detail">${condition.detail}</p>
      ${
        condition.quotation === null
          ? nothing
          : html`<blockquote>${condition.quotation}</blockquote>`
      }
    </li>`;
  }

  /**
   * The document this reading was transcribed from, and the day somebody checked it.
   *
   * A citation and not a convenience link. Every figure above is a transcription,
   * transcriptions go stale, and the honest thing a screen can do about that is name
   * its source and the date it was last verified. `rel="noreferrer"` keeps the
   * lifter's presence on this tool out of the federation's logs (section 2.3).
   *
   * The link leads the block rather than sitting in the sentence, which is a tap
   * target decision and not a typographic one -- see `.source-link` above.
   */
  #renderSource(reading: MeetReading): TemplateResult {
    const { source } = reading.meet;
    return html`<div class="small source">
      <a class="source-link" href=${source.url} rel="noreferrer noopener" target="_blank"
        >${source.label}</a
      >
      <p>
        Every figure above is transcribed from that document, checked on
        <time datetime=${source.verifiedOn}>${source.verifiedOn}</time>.
      </p>
    </div>`;
  }
}

/**
 * What one reading of a route's standard comes to.
 *
 * A free function because it is called from three arms of the outcome switch and
 * reads nothing off the host. The verbs are the ones `types.ts` insists on: a figure
 * `reaches` a standard or is `short` of it, and neither of those is a word about the
 * lifter.
 */
function renderStandardReading(reading: StandardReading): TemplateResult {
  switch (reading.kind) {
    case 'reaches':
      return html`
        <p class="verdict">
          Reaches ${reading.distance.standard.label}, by
          ${kilograms(reading.distance.kilogramsClear)}.
        </p>
        <p class="small">Read from ${reading.table.label}.</p>
      `;
    case 'short':
      return html`
        <p class="verdict">
          ${kilograms(reading.distance.kilogramsShort)} short of ${reading.distance.standard.label}.
        </p>
        <p class="small">Read from ${reading.table.label}.</p>
      `;
    case 'above-the-bracket':
      return html`
        <p class="verdict">
          Above ${reading.distance.standard.label}, which this route names on its own.
        </p>
        <p class="small">
          ${MEET_NOTES.aboveTheBracket}
          ${reading.achieved === null ? '' : `The figure reaches ${reading.achieved.label}.`} Read
          from ${reading.table.label}.
        </p>
      `;
    case 'unreadable':
      return html`<p class="verdict">${UNREADABLE_STANDARD_REASONS[reading.reason]}</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-reading': PtkMeetReading;
  }
}
