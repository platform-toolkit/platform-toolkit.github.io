// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §9.4: what the meets before this one say, beside the meet that just ended.
 *
 * `history.ts` decided which meets were read, `calibrateFrom` decided every
 * figure and `copy.ts` holds every sentence, so this file lays out a
 * `CalibrationReport` and computes nothing -- no median, no count, no strength
 * grade, no cluster.
 *
 * WHY THIS IS NOT A PROPERTY ON `ptk-meet-summary`
 *
 * The two sit one above the other and are about opposite spans. `MeetSummary` is
 * one meet, and its whole design -- the one-meet caveat above the lessons, the
 * omissions it declares, the attempts it lists -- is written around that being
 * true. A `CalibrationReport` is every meet *except* that one. Folding the second
 * into the first would put a section under a heading naming the lifter and the
 * day, carrying figures drawn from days that are not it, and the first thing to
 * go wrong would be `SUMMARY_ONE_MEET_CAVEAT` sitting above a trend measured
 * across five. Two elements is also what lets the caller render the summary with
 * no shelf behind it, which is what an imported meet looks like.
 *
 * WHY NO SECTION IS EVER DROPPED
 *
 * The same argument `ptk-meet-summary` makes, and it is sharper here: every
 * section on this panel can legitimately be empty, and the empty ones flatter.
 * A missed-jump figure is absent because the lifter has never missed; a cluster
 * is absent because no lift stands out. Rendered as nothing, both read as a tool
 * that has not finished loading. Each heading is therefore always on screen with
 * either its content or a sentence saying why there is none.
 *
 * WHAT IT DOES NOT SHOW
 *
 * **No advice, anywhere.** Not one sentence says what to open with or how far to
 * jump. `meet-history.ts`'s own header is explicit that nothing consults a
 * calibration yet and that picking the threshold to consult it at would invent
 * the confidence the module exists to report honestly -- so a panel that phrased
 * a median as a suggestion would be making a claim the domain deliberately
 * declined to make.
 *
 * **`CalibrationReport.elevatable` is deliberately not rendered.** It answers
 * "may this history become a recommendation factor", which is a question about a
 * caller that does not exist. On screen it would be a badge saying the tool is
 * now confident, next to figures nothing acts on -- a promise the day cannot
 * keep. It stays a flag for the module that eventually gates on it.
 *
 * **No percentage of attempts made** (§10.2). `calibrationSuccessText` prints two
 * counts, and the one line on the panel that carries a percent sign is a share of
 * a weight against another weight.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  NO_CALIBRATION,
  type CalibrationLift,
  type CalibrationReport,
  type HistoryStrength,
  type WeightUnit,
} from '@platform-toolkit/domain';

import {
  CALIBRATION_CLUSTER_HEADING,
  CALIBRATION_HEADING,
  CALIBRATION_LIFTS_HEADING,
  CALIBRATION_MISSED_JUMP_LABEL,
  CALIBRATION_NOT_A_PLAN,
  CALIBRATION_NOT_ENOUGH,
  CALIBRATION_NO_CLUSTER,
  CALIBRATION_NO_FIGURE,
  CALIBRATION_NO_LIFTS,
  CALIBRATION_REACHED_LABEL,
  CALIBRATION_SECOND_ATTEMPTS_LABEL,
  CALIBRATION_SUCCESSFUL_JUMP_LABEL,
  CALIBRATION_THIRD_ATTEMPTS_LABEL,
  calibrationClusterText,
  calibrationEvidenceText,
  calibrationFigureText,
  calibrationOutOfScopeText,
  calibrationReadText,
  calibrationShareText,
  calibrationSuccessText,
  liftLabel,
} from './copy.js';

/** One row of a lift: what was measured, the figure, and what it was drawn from. */
interface FigureRow {
  /**
   * Which of the five questions this row answers, as a class on the row itself
   * rather than on the figure.
   *
   * Three of the five can be empty, and an empty one renders a sentence instead
   * of a value -- so a class on the figure names only the rows that happen to
   * have one, and the rows a reader most wants to point at become unaddressable
   * exactly when they are interesting.
   */
  readonly field: string;
  readonly label: string;
  readonly value: string | null;
  readonly observations: number;
  readonly strength: HistoryStrength;
}

@customElement('ptk-meet-calibration')
export class PtkMeetCalibration extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .calibration {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    section {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    header {
      display: grid;
      gap: var(--ptk-space-xs);
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

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--ptk-space-xs);
    }

    /*
     * One figure a row, stacked, deliberately not a label-and-value pair on one
     * line. Three of the five labels here are a short sentence rather than a word
     * ("Best lift against the maximum you planned"), so a two-column row is a
     * wrapped label beside a two-character figure at 320px -- and every one of the
     * five carries a third line of evidence underneath, which a pair has nowhere
     * to put.
     */
    .row {
      display: grid;
      gap: 0.15rem;
      padding: var(--ptk-space-xs) 0 var(--ptk-space-xs) var(--ptk-space-sm);
      border-left: 2px solid var(--ptk-color-border);
    }

    .value {
      font-weight: 600;
    }
  `;

  @property({ attribute: false }) report: CalibrationReport = NO_CALIBRATION;

  /**
   * The unit the lifter set.
   *
   * Every weight on this panel is a *difference* between two attempts rather than
   * an attempt, so it goes through `weightText` and converts (§16's rule that a
   * pound figure is read off the published chart is about the weight called to
   * the table, and no figure here is one).
   */
  @property({ attribute: false }) unit: WeightUnit = 'kg';

  override render(): TemplateResult {
    const { report } = this;
    const outOfScope = calibrationOutOfScopeText(report);
    return html`
      <article class="calibration">
        <header>
          <h3>${CALIBRATION_HEADING}</h3>
          <p class="read">${calibrationReadText(report)}</p>
          ${outOfScope === null ? nothing : html`<p class="muted out-of-scope">${outOfScope}</p>`}
          ${
            report.strength === 'not-enough'
              ? html`<p class="muted floor">${CALIBRATION_NOT_ENOUGH}</p>`
              : nothing
          }
          <p class="muted caveat">${CALIBRATION_NOT_A_PLAN}</p>
        </header>
        ${this.#renderLifts()} ${this.#renderCluster()}
      </article>
    `;
  }

  #renderLifts(): TemplateResult {
    const { lifts } = this.report;
    return html`
      <section class="lifts">
        <h4>${CALIBRATION_LIFTS_HEADING}</h4>
        ${
          lifts.length === 0
            ? html`<p class="muted empty">${CALIBRATION_NO_LIFTS}</p>`
            : lifts.map((lift) => this.#renderLift(lift))
        }
      </section>
    `;
  }

  #renderLift(lift: CalibrationLift): TemplateResult {
    return html`
      <section class="lift">
        <h5>${liftLabel(lift.lift)}</h5>
        <ul>
          ${this.#rowsFor(lift).map(
            (row) => html`<li class="row ${row.field}">${renderRow(row)}</li>`,
          )}
        </ul>
      </section>
    `;
  }

  /*
   * The five figures in the order §9.4 lists them, built as data rather than as
   * five near-identical template branches -- the difference between them is which
   * copy function formats the value and which field carries the observation
   * count, and spelling that out five times is where a strength grade ends up
   * printed under the wrong figure.
   */
  #rowsFor(lift: CalibrationLift): readonly FigureRow[] {
    return [
      {
        field: 'successful-jump',
        label: CALIBRATION_SUCCESSFUL_JUMP_LABEL,
        value: calibrationFigureText(lift.successfulJump, this.unit),
        observations: lift.successfulJump.observations,
        strength: lift.successfulJump.strength,
      },
      {
        field: 'missed-jump',
        label: CALIBRATION_MISSED_JUMP_LABEL,
        value: calibrationFigureText(lift.missedJump, this.unit),
        observations: lift.missedJump.observations,
        strength: lift.missedJump.strength,
      },
      {
        field: 'second-attempts',
        label: CALIBRATION_SECOND_ATTEMPTS_LABEL,
        value: calibrationSuccessText(lift.secondAttempts),
        observations: lift.secondAttempts.taken,
        strength: lift.secondAttempts.strength,
      },
      {
        field: 'third-attempts',
        label: CALIBRATION_THIRD_ATTEMPTS_LABEL,
        value: calibrationSuccessText(lift.thirdAttempts),
        observations: lift.thirdAttempts.taken,
        strength: lift.thirdAttempts.strength,
      },
      {
        field: 'reached-of-planned',
        label: CALIBRATION_REACHED_LABEL,
        value: calibrationShareText(lift.reachedOfPlannedPercent),
        observations: lift.reachedOfPlannedPercent.observations,
        strength: lift.reachedOfPlannedPercent.strength,
      },
    ];
  }

  /*
   * Always rendered, including for a lifter who has missed nothing at all --
   * which is the case the heading is least obviously needed for and most easily
   * misread. `missCluster` is null both when the misses are spread and when there
   * are none, and one sentence answers both: a separate "you have missed nothing"
   * line would be a compliment on a panel with no business paying one.
   */
  #renderCluster(): TemplateResult {
    const { missCluster } = this.report;
    return html`
      <section class="cluster">
        <h4>${CALIBRATION_CLUSTER_HEADING}</h4>
        <p class="what">
          ${missCluster === null ? CALIBRATION_NO_CLUSTER : calibrationClusterText(missCluster)}
        </p>
      </section>
    `;
  }

  /*
   * NO `getUpdateComplete` OVERRIDE, DELIBERATELY.
   *
   * The same call `ptk-meet-summary` makes for the same reason: this element
   * renders no custom element at all, so the override §§13.6-13.9 require of a
   * composing element would await an empty list. Add it with the first child
   * element, not before.
   */
}

/**
 * One measured figure.
 *
 * The evidence line is dropped where the value is, rather than printed as "From
 * 0 observations -- not enough yet": that sentence is the same fact as "Nothing
 * recorded yet" said twice, and the second telling reads as a figure the tool
 * had and lost.
 */
function renderRow(row: FigureRow): TemplateResult {
  if (row.value === null) {
    return html`
      <span class="label">${row.label}</span>
      <span class="value none">${CALIBRATION_NO_FIGURE}</span>
    `;
  }
  return html`
    <span class="label">${row.label}</span>
    <span class="value">${row.value}</span>
    <span class="evidence muted">${calibrationEvidenceText(row.observations, row.strength)}</span>
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-calibration': PtkMeetCalibration;
  }
}
