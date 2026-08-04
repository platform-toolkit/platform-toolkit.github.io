// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §26: the meet, once the last attempt is over.
 *
 * `summary.ts` decided every figure and `copy.ts` holds every sentence, so this
 * file lays out a `MeetSummary` and computes nothing -- no total, no count, no
 * comparison, no lesson. It is the last screen in the tool and the only one read
 * after the fact, which changes two habits the rest of the directory has:
 *
 * WHY NO SECTION IS EVER DROPPED
 *
 * Everywhere else here an empty list renders nothing, because a screen a lifter
 * is working from should not carry headings over blanks. This screen is read once,
 * by somebody with no way to check it against anything, so a section that quietly
 * vanishes is indistinguishable from one the tool got wrong -- and the sections
 * most likely to be empty (targets, notes, lessons) are exactly the ones whose
 * absence flatters. Every heading is therefore always on screen with either its
 * content or a sentence saying why there is none. `summary.ts`'s header makes the
 * same argument about `omissions`; this is that argument applied to the layout.
 *
 * WHY IT IS FLAT RATHER THAN FOLDED
 *
 * The same reason `ptk-meet-pack` is (§23.1), arriving from the other direction:
 * a fold is how a reader of a small window chooses what to look at *next*, and
 * this screen has no next. A lifter scrolls it once, and a shut fold is a section
 * they will not know was there. The one thing this costs is length, which is the
 * cheap half of the trade on a page nobody is acting from.
 *
 * WHAT IT DOES NOT SHOW
 *
 * No advice. Not one sentence here says what to do at the next meet, and
 * `summaryLessonSentence` is written to keep it that way -- §9.4's floor is two
 * meets and this is one. The lessons carry their own derivation beside them and
 * `SUMMARY_ONE_MEET_CAVEAT` sits above the list rather than beside each line,
 * because a reader who has already taken one observation as a pattern has stopped
 * reading the qualifiers.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { AttemptWeight, WeightUnit } from '@platform-toolkit/domain';

import {
  SUMMARY_FIRST_RESULT,
  SUMMARY_HISTORY_TRUNCATED,
  SUMMARY_LESSONS_HEADING,
  SUMMARY_LIFTS_HEADING,
  SUMMARY_LIGHTS_HEADING,
  SUMMARY_NOTES_HEADING,
  SUMMARY_NO_GOOD_LIFT,
  SUMMARY_NO_INTERVALS,
  SUMMARY_NO_LESSONS,
  SUMMARY_NO_LIFTS,
  SUMMARY_NO_NOTES,
  SUMMARY_NO_TARGETS,
  SUMMARY_NO_WEIGHT,
  SUMMARY_OMISSIONS_HEADING,
  SUMMARY_ONE_MEET_CAVEAT,
  SUMMARY_TARGETS_HEADING,
  SUMMARY_TIMING_CAVEAT,
  SUMMARY_TIMING_HEADING,
  SUMMARY_TOTAL_HEADING,
  attemptKilogramsText,
  attemptPoundsText,
  jumpText,
  liftLabel,
  summaryAgainstPlanText,
  summaryAttemptLabel,
  summaryBestText,
  summaryEffortText,
  summaryFollowedText,
  summaryFormatText,
  summaryGapSentence,
  summaryIntervalText,
  summaryLessonEvidenceText,
  summaryLessonSentence,
  summaryLightCountsText,
  summaryLightsMissingText,
  summaryAttemptHeading,
  summaryLightsText,
  summaryMadeText,
  summaryMissReasonText,
  summaryOmissionSentence,
  summaryOutcomeLabel,
  summaryPlannedText,
  summaryRecommendationText,
  summaryRpeText,
  summaryTargetText,
  summaryTitle,
  summaryTotalText,
} from './copy.js';
import {
  EMPTY_SUMMARY,
  type MeetSummary,
  type SummaryAttempt,
  type SummaryInterval,
  type SummaryLesson,
  type SummaryLift,
} from './summary.js';

@customElement('ptk-meet-summary')
export class PtkMeetSummary extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .summary {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    section {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    h5 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
    }

    p {
      margin: 0;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ul,
    ol {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .total .figure {
      font-size: var(--ptk-font-size-lg);
      font-weight: 600;
    }

    /*
     * One attempt a row, deliberately not a table. An attempt here carries up to
     * nine facts -- weight, pound reading, outcome, effort, RPE, miss reason,
     * lights, jump, and what the tool had suggested -- and a nine-column table is
     * a sideways scroll at 320px, which §27 forbids for the live screens and which
     * is no more readable here just because nobody is acting on it.
     */
    .attempt {
      display: grid;
      gap: 0.15rem;
      padding: var(--ptk-space-xs) 0 var(--ptk-space-xs) var(--ptk-space-sm);
      border-left: 2px solid var(--ptk-color-border);
    }

    .headline {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      align-items: baseline;
    }

    .weight {
      font-weight: 600;
    }

    .notes .text {
      white-space: pre-wrap;
    }
  `;

  @property({ attribute: false }) summary: MeetSummary = EMPTY_SUMMARY;

  /** The unit the lifter set. Attempts stay in kilograms; totals follow it (§16). */
  @property({ attribute: false }) unit: WeightUnit = 'kg';

  override render(): TemplateResult {
    const { summary } = this;
    return html`
      <article class="summary">
        <header>
          <h3>${summaryTitle(summary.lifterName)}</h3>
          <p class="muted format">${summaryFormatText(summary.format)}</p>
        </header>
        ${this.#renderTotal()} ${this.#renderLifts()} ${this.#renderLights()}
        ${this.#renderTargets()} ${this.#renderTiming()} ${this.#renderNotes()}
        ${this.#renderLessons()} ${this.#renderOmissions()}
        ${
          summary.historyTruncated
            ? html`<p class="muted truncated">${SUMMARY_HISTORY_TRUNCATED}</p>`
            : nothing
        }
      </article>
    `;
  }

  #renderTotal(): TemplateResult {
    return html`
      <section class="total">
        <h4>${SUMMARY_TOTAL_HEADING}</h4>
        <p class="figure">${summaryTotalText(this.summary.total, this.unit)}</p>
      </section>
    `;
  }

  #renderLifts(): TemplateResult {
    const { lifts } = this.summary;
    return html`
      <section class="lifts">
        <h4>${SUMMARY_LIFTS_HEADING}</h4>
        ${
          lifts.length === 0
            ? html`<p class="muted empty">${SUMMARY_NO_LIFTS}</p>`
            : lifts.map((lift) => this.#renderLift(lift))
        }
      </section>
    `;
  }

  #renderLift(lift: SummaryLift): TemplateResult {
    return html`
      <section class="lift">
        <h5>${liftLabel(lift.lift)}</h5>
        <p class="best">
          ${lift.best === null ? SUMMARY_NO_GOOD_LIFT : summaryBestText(lift.best)}
        </p>
        <p class="muted made">${summaryMadeText(lift.made, lift.taken)}</p>
        <ol>
          ${lift.attempts.map((attempt) => html`<li>${renderAttempt(attempt)}</li>`)}
        </ol>
      </section>
    `;
  }

  /*
   * The count and the caveat are one section rather than a figure with a footnote,
   * because §12.1 makes light entry optional and behind a fold -- so most meets
   * have attempts with none, and a bare tally read without the caveat is read as
   * the whole day. The missing-attempt line is `null` at zero, which is the one
   * case where the count really is the whole meet.
   */
  #renderLights(): TemplateResult {
    const { whiteLights, redLights, attemptsWithoutLights } = this.summary;
    const missing = summaryLightsMissingText(attemptsWithoutLights);
    return html`
      <section class="lights">
        <h4>${SUMMARY_LIGHTS_HEADING}</h4>
        <p class="counts">${summaryLightCountsText(whiteLights, redLights)}</p>
        ${missing === null ? nothing : html`<p class="muted missing">${missing}</p>`}
      </section>
    `;
  }

  #renderTargets(): TemplateResult {
    const { targets } = this.summary;
    return html`
      <section class="targets">
        <h4>${SUMMARY_TARGETS_HEADING}</h4>
        ${
          targets.length === 0
            ? html`<p class="muted empty">${SUMMARY_NO_TARGETS}</p>`
            : html`<ul>
                ${targets.map(
                  (progress) =>
                    html`<li class="target">${summaryTargetText(progress, this.unit)}</li>`,
                )}
              </ul>`
        }
      </section>
    `;
  }

  #renderTiming(): TemplateResult {
    const { intervals } = this.summary;
    return html`
      <section class="timing">
        <h4>${SUMMARY_TIMING_HEADING}</h4>
        <p class="muted caveat">${SUMMARY_TIMING_CAVEAT}</p>
        ${
          intervals.length === 0
            ? html`<p class="muted empty">${SUMMARY_NO_INTERVALS}</p>`
            : html`<ul>
                ${intervals.map((interval) => html`<li class="interval">${renderInterval(interval)}</li>`)}
              </ul>`
        }
      </section>
    `;
  }

  #renderNotes(): TemplateResult {
    const { notes } = this.summary;
    return html`
      <section class="notes">
        <h4>${SUMMARY_NOTES_HEADING}</h4>
        ${
          notes.length === 0
            ? html`<p class="muted empty">${SUMMARY_NO_NOTES}</p>`
            : notes.map(
                (note) => html`
                  <div class="note">
                    <h5>${summaryAttemptHeading(note.lift, note.attemptNumber)}</h5>
                    <p class="text">${note.note}</p>
                  </div>
                `,
              )
        }
      </section>
    `;
  }

  #renderLessons(): TemplateResult {
    const { lessons } = this.summary;
    return html`
      <section class="lessons">
        <h4>${SUMMARY_LESSONS_HEADING}</h4>
        <p class="muted caveat">${SUMMARY_ONE_MEET_CAVEAT}</p>
        ${
          lessons.length === 0
            ? html`<p class="muted empty">${SUMMARY_NO_LESSONS}</p>`
            : html`<ul>
                ${lessons.map((lesson) => html`<li class="lesson">${renderLesson(lesson)}</li>`)}
              </ul>`
        }
      </section>
    `;
  }

  /*
   * Last, and rendered even when the list is empty -- which it never is today,
   * because `summary.ts` declares the same two omissions on every summary it
   * builds. The guard is here so the section cannot become a heading over nothing
   * the day one of them gets a source.
   */
  #renderOmissions(): TemplateResult | typeof nothing {
    const { omissions } = this.summary;
    if (omissions.length === 0) return nothing;
    return html`
      <section class="omissions">
        <h4>${SUMMARY_OMISSIONS_HEADING}</h4>
        <ul>
          ${omissions.map((code) => html`<li>${summaryOmissionSentence(code)}</li>`)}
        </ul>
      </section>
    `;
  }

  /*
   * NO `getUpdateComplete` OVERRIDE, DELIBERATELY.
   *
   * Every composing element in this directory has one, and §§13.6-13.9 and 13.14
   * each record it as a documented mutation survivor. This element renders no
   * custom element at all -- it is plain markup over a decided value, the way
   * `ptk-meet-pack` is -- so the override would await an empty list and the
   * survivor would be a line of code that provably does nothing. Add it with the
   * first child element, not before.
   */
}

function renderAttempt(attempt: SummaryAttempt): TemplateResult {
  return html`
    <div class="attempt">
      <div class="headline">
        <span class="name">${summaryAttemptLabel(attempt.attemptNumber, attempt.kind)}</span>
        ${renderWeight(attempt.weight)}
        <span class="outcome">${summaryOutcomeLabel(attempt.outcome)}</span>
      </div>
      ${renderLine('effort', attempt.effort === null ? null : summaryEffortText(attempt.effort))}
      ${renderLine('rpe', attempt.rpe === null ? null : summaryRpeText(attempt.rpe))}
      ${renderLine(
        'miss',
        attempt.missReason === null ? null : summaryMissReasonText(attempt.missReason),
      )}
      ${renderLine('lights', attempt.lights === null ? null : summaryLightsText(attempt.lights))}
      ${renderLine('jump', jumpText(attempt.jumpKilograms))}
      ${renderLine(
        'planned',
        attempt.plannedKilograms === null ? null : summaryPlannedText(attempt.plannedKilograms),
      )}
      ${renderLine(
        'against-plan',
        attempt.againstPlanKilograms === null
          ? null
          : summaryAgainstPlanText(attempt.againstPlanKilograms),
      )}
      ${renderRecommendation(attempt)}
    </div>
  `;
}

/**
 * The declared weight, in kilograms with the published pound figure beside it.
 *
 * `.pounds` is its own class for the reason §13.9 gave it one: `deepText` reads
 * every descendant, so an assertion about the published figure has to be scoped
 * to the span that carries it or it is satisfied by any other pound reading on
 * the page. There are three other sections here that could produce one.
 */
function renderWeight(weight: AttemptWeight | null): TemplateResult {
  if (weight === null) return html`<span class="weight none">${SUMMARY_NO_WEIGHT}</span>`;
  const pounds = attemptPoundsText(weight);
  return html`
    <span class="weight">${attemptKilogramsText(weight)}</span>
    ${pounds === null ? nothing : html`<span class="pounds muted">${pounds}</span>`}
  `;
}

/**
 * What the tool had suggested, or why there is nothing to compare against.
 *
 * Exactly one of the two is always rendered: `summary.ts` sets `recommendation`
 * or `recommendationGap` and never neither, and an attempt with no line here is
 * indistinguishable from one where the lifter took the tool's advice -- which is
 * the flattering reading and the reason the gap codes exist at all.
 */
function renderRecommendation(attempt: SummaryAttempt): TemplateResult | typeof nothing {
  const { recommendation, recommendationGap } = attempt;
  if (recommendation !== null) {
    return html`
      <p class="muted suggested">${summaryRecommendationText(recommendation)}</p>
      <p class="muted followed">${summaryFollowedText(recommendation.followed)}</p>
    `;
  }
  if (recommendationGap !== null) {
    return html`<p class="muted gap">${summaryGapSentence(recommendationGap)}</p>`;
  }
  return nothing;
}

function renderLine(field: string, text: string | null): TemplateResult | typeof nothing {
  return text === null ? nothing : html`<p class="muted ${field}">${text}</p>`;
}

function renderInterval(interval: SummaryInterval): TemplateResult {
  const { sincePreviousSeconds } = interval;
  return html`
    <span class="name">${summaryAttemptHeading(interval.lift, interval.attemptNumber)}</span>
    <span class="gap muted"
      >${
        sincePreviousSeconds === null
          ? SUMMARY_FIRST_RESULT
          : summaryIntervalText(sincePreviousSeconds)
      }</span
    >
  `;
}

function renderLesson(lesson: SummaryLesson): TemplateResult {
  const evidence = summaryLessonEvidenceText(lesson);
  return html`
    <span class="what">${summaryLessonSentence(lesson.code)}</span>
    ${evidence === null ? nothing : html`<span class="evidence muted">${evidence}</span>`}
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-summary': PtkMeetSummary;
  }
}
