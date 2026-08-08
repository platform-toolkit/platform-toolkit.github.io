// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The plan: three attempts a lift, and everything the tool knows about them.
 *
 * TWO AXES, AND THE LAYOUT IS HOW THEY STAY APART
 *
 * §10 forbids fusing attempt risk and data confidence into one score, and the
 * way that rule is broken on a screen is not by writing a formula -- it is by
 * putting the two words next to each other and letting a reader average them. So
 * risk is a per-attempt label inside the attempt row, data confidence is a
 * per-lift block below the attempts with its own heading and its own reasons,
 * and there is no element anywhere in this file that renders both. The one place
 * they meet is the explanation at the top, which exists to say that they are
 * different questions.
 *
 * NO PROBABILITY, AND THE ABSENCE HAS TO BE ACTIVE
 *
 * §10.2 bans a displayed probability of success. Four risk words with no gloss
 * invite a lifter to read "Long shot" as one, so `RISK_EXPLANATION` says what the
 * word measures and, in its last clause, what it does not. Leaving that unsaid
 * would satisfy the letter of the ban and none of it.
 *
 * KILOGRAMS ARE THE ATTEMPT; POUNDS ARE A READING (§16)
 *
 * Every attempt on this screen is written in kilograms regardless of the unit
 * the lifter is typing in, because that is what goes on the card. The pound
 * figure beside it comes off the federation's published chart, and where the
 * chart has no row -- or no chart is loaded at all -- the screen says so and
 * marks the conversion approximate rather than printing a figure the expeditor's
 * table has never seen.
 *
 * This element is presentation. It renders a `PlannerView` and reports nothing:
 * there is no control on it, because every answer that could change this plan is
 * asked on the screens above it.
 */
import '@platform-toolkit/ui/ptk-notice';
import type { JumpAdvisory, RoundingNote, TargetTotalProposal } from '@platform-toolkit/domain';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  CONFIDENCE_EXPLANATION,
  PROVISIONAL_NOTE,
  RISK_EXPLANATION,
  approximatePoundsText,
  attemptKilogramsText,
  attemptLabel,
  attemptPoundsText,
  confidenceLabel,
  jumpEvidenceNote,
  liftLabel,
  poundsAbsenceSentence,
  problemSentence,
  refusalSentence,
  riskLabel,
  weightText,
} from './copy.js';
import { EMPTY_VIEW, type AttemptView, type LiftPlanView, type PlannerView } from './plan.js';
import { EMPTY_SESSION, type PlannerSession } from './session.js';

@customElement('ptk-plan-screen')
export class PtkPlanScreen extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    h3,
    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    h4 {
      font-size: var(--ptk-font-size-sm);
    }

    p {
      margin: 0;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .panel {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .lift {
      display: grid;
      gap: var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .list {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /*
     * One attempt a row at any width, rather than three across once there is
     * room. Each attempt carries a weight, a pound reading, a risk word and up to
     * three sentences of annotation, and a three-column version at 320px either
     * clips the sentences or turns each column into a two-word ribbon. The card a
     * lifter writes from is a list, so this is one too (§5.7).
     */
    .attempts {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .attempt {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-sm);
    }

    /*
     * The name, the weight and the risk word on one line while they fit, wrapping
     * rather than overflowing when they do not. A wrapping flex row and not a
     * grid, because the three are different natural widths and a track wide
     * enough for the longest risk word leaves a gap beside the shortest.
     */
    .attempt-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .attempt-name {
      font-weight: 600;
    }

    .weight {
      font-size: var(--ptk-font-size-lg);
      font-variant-numeric: tabular-nums;
    }

    /*
     * The risk word, tinted by band and never by tint alone. tokens.css says the
     * status colours are "never the sole carrier of meaning", and here the word
     * itself is the meaning -- the tint only says which of the two aggressive
     * bands it is, which the reader already has in the word beside it.
     */
    .risk {
      padding: var(--ptk-space-xs);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-sm);
      font-size: var(--ptk-font-size-sm);
    }

    .risk[data-risk='push'],
    .risk[data-risk='long-shot'] {
      border-color: var(--ptk-color-caution);
      color: var(--ptk-color-caution);
    }

    .confidence-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .grade {
      font-weight: 600;
    }

    .totals {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .total-figure {
      font-size: var(--ptk-font-size-lg);
      font-variant-numeric: tabular-nums;
    }
  `;

  /** The unit the lifter is typing in. Attempts ignore it; totals follow it. */
  @property({ attribute: false }) session: PlannerSession = EMPTY_SESSION;

  @property({ attribute: false }) view: PlannerView = EMPTY_VIEW;

  override render(): TemplateResult {
    return html`
      ${this.#renderHowToRead()} ${this.#renderProposal()}
      ${this.view.lifts.map((lift) => this.#renderLift(lift))} ${this.#renderTotal()}
    `;
  }

  /**
   * §10's two axes, described once, before anything is graded.
   *
   * Not behind a disclosure, which is where a paragraph of framing would
   * ordinarily go. The mistake this prevents -- reading a risk word as a forecast,
   * or averaging the two grades into one impression -- is made by a lifter who
   * scans the plan and never opens anything, so a fold would hide the text from
   * exactly the reader it is written for.
   */
  #renderHowToRead(): TemplateResult {
    return html`
      <section class="panel">
        <h3>How to read this plan</h3>
        <p class="muted">${RISK_EXPLANATION}</p>
        <p class="muted">${CONFIDENCE_EXPLANATION}</p>
      </section>
    `;
  }

  /** §7.5's split of one total between the lifts, with what it cost to reach it. */
  #renderProposal(): TemplateResult | typeof nothing {
    const proposal = this.view.proposal;
    if (proposal === null) return nothing;
    const unit = this.session.setup.unit;
    return html`
      <section class="panel">
        <h3>Target total: ${weightText(proposal.targetTotalKilograms, unit)}</h3>
        ${this.#renderShares(proposal)}
        ${
          proposal.shortfallKilograms > 0
            ? html`<p class="muted">
                The ceilings leave the plan ${weightText(proposal.shortfallKilograms, unit)} short
                of the target.
              </p>`
            : nothing
        }
        <ul class="list">
          ${proposal.advisories.map(
            (advisory) => html`
              <li>
                <ptk-notice tone=${advisory.severity === 'strong' ? 'error' : 'info'}>
                  ${advisory.message}
                </ptk-notice>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }

  #renderShares(proposal: TargetTotalProposal): TemplateResult {
    const unit = this.session.setup.unit;
    return html`
      <ul class="list muted">
        ${proposal.shares.map(
          (share) => html`
            <li>
              ${liftLabel(share.lift)}: a best attempt of
              ${weightText(share.requiredBestKilograms, unit)}, which is a maximum of
              ${weightText(share.proposedMaximumKilograms, unit)}.
            </li>
          `,
        )}
      </ul>
    `;
  }

  #renderLift(lift: LiftPlanView): TemplateResult {
    return html`
      <section class="lift" data-lift=${lift.lift}>
        <h3>${liftLabel(lift.lift)}</h3>
        ${this.#renderMaximum(lift)} ${this.#renderProblems(lift)} ${this.#renderAttempts(lift)}
        ${this.#renderAdvisories(lift)} ${this.#renderConfidence(lift)}
        ${this.#renderSubtotal(lift)}
      </section>
    `;
  }

  /**
   * The figure everything below is a percentage of, or why there is nothing yet.
   *
   * Three states, and only one of them is a fault. A lift nobody has typed in is
   * waiting, a lift with a figure on screen is waiting for the lifter to
   * underwrite it (§7), and both are ordinary -- a screen that greeted an
   * unanswered form with a warning would open by telling the lifter off.
   */
  #renderMaximum(lift: LiftPlanView): TemplateResult {
    if (lift.maximumKilograms === null) {
      return html`<p class="muted">
        ${
          lift.awaiting
            ? 'Nothing planned yet. Fill in the figures above and this fills in with you.'
            : 'No planning maximum has been reached from the figures above.'
        }
      </p>`;
    }

    const figure = weightText(lift.maximumKilograms, this.session.setup.unit);
    if (lift.awaitingConfirmation) {
      return html`<p class="muted">
        Planned from ${figure} once you agree to it above. Nothing below is settled until then.
      </p>`;
    }
    return html`<p class="muted">Planned from ${figure}.</p>`;
  }

  #renderProblems(lift: LiftPlanView): TemplateResult | typeof nothing {
    if (lift.problems.length === 0) return nothing;
    return html`<ul class="list">
      ${lift.problems.map(
        (problem) =>
          html`<li><ptk-notice tone="error">${problemSentence(problem)}</ptk-notice></li>`,
      )}
    </ul>`;
  }

  #renderAttempts(lift: LiftPlanView): TemplateResult | typeof nothing {
    if (lift.attempts.length === 0) return nothing;
    return html`
      <ol class="attempts">
        ${lift.attempts.map((attempt) => this.#renderAttempt(attempt))}
      </ol>
      ${this.#renderPoundsAbsence(lift)}
    `;
  }

  /**
   * Why a pound figure is missing, said once per distinct reason for the lift.
   *
   * Deduplicated rather than printed under each attempt, and read off every
   * attempt rather than the first. Both matter: "no published pound chart is
   * loaded" is one fact about the read and would otherwise appear nine times on a
   * full-power screen, while "the chart has no row for this weight" can be true
   * of the second attempt and not the opener -- so taking the opener's reason and
   * calling it the lift's would explain the wrong absence, or none.
   */
  #renderPoundsAbsence(lift: LiftPlanView): TemplateResult | typeof nothing {
    const sentences = [
      ...new Set(
        lift.attempts.flatMap((attempt) => {
          const sentence = poundsAbsenceSentence(attempt.weight.publishedPoundsReason);
          return sentence === null ? [] : [sentence];
        }),
      ),
    ];
    if (sentences.length === 0) return nothing;
    return html`<ul class="list muted">
      ${sentences.map((sentence) => html`<li>${sentence}</li>`)}
    </ul>`;
  }

  #renderAttempt(attempt: AttemptView): TemplateResult {
    const pounds = attemptPoundsText(attempt.weight);
    return html`
      <li class="attempt" data-attempt=${attempt.attemptNumber}>
        <div class="attempt-line">
          <span class="attempt-name">${attemptLabel(attempt.attemptNumber)}</span>
          <span class="weight">${attemptKilogramsText(attempt.weight)}</span>
          ${
            attempt.risk === null
              ? nothing
              : html`<span class="risk" data-risk=${attempt.risk}>${riskLabel(attempt.risk)}</span>`
          }
        </div>
        <p class="muted">${pounds ?? approximatePoundsText(attempt.weight)}</p>
        ${
          attempt.jumpKilograms === null
            ? nothing
            : html`<p class="muted">
                Up ${weightText(attempt.jumpKilograms, 'kg')} from the attempt before.
              </p>`
        }
        ${this.#renderRounding(attempt.rounding)}
        ${attempt.provisional ? html`<p class="muted">${PROVISIONAL_NOTE}</p>` : nothing}
        ${
          attempt.refusals.length === 0
            ? nothing
            : html`<ul class="list">
                ${attempt.refusals.map(
                  (code) =>
                    html`<li><ptk-notice tone="error">${refusalSentence(code)}</ptk-notice></li>`,
                )}
              </ul>`
        }
      </li>
    `;
  }

  /**
   * §9.1's "show when rounding changed the original target".
   *
   * The domain's own sentence, because it names both figures and the reason. A
   * second telling here would either drop one of them or repeat the whole thing
   * in this tool's voice, and the direction is the part that must not drift --
   * §5.5 makes rounding a safety property, and a note saying "down" beside a
   * weight that went up is worse than no note.
   */
  #renderRounding(rounding: RoundingNote | null): TemplateResult | typeof nothing {
    if (rounding === null) return nothing;
    return html`<p class="muted">${rounding.message}</p>`;
  }

  /**
   * §9.2 and §9.3's jump guidance, each caveated with what it was measured on.
   *
   * The evidence note rides with every advisory rather than being said once for
   * the lift, because the label is per advisory: a relative anchor and an
   * absolute research range can appear on the same lift with different evidence
   * grades, and one shared footnote would apply the better of the two to both.
   */
  #renderAdvisories(lift: LiftPlanView): TemplateResult | typeof nothing {
    if (lift.advisories.length === 0) return nothing;
    return html`<ul class="list">
      ${lift.advisories.map((advisory) => this.#renderAdvisory(advisory))}
    </ul>`;
  }

  #renderAdvisory(advisory: JumpAdvisory): TemplateResult {
    return html`
      <li>
        <ptk-notice tone=${advisory.severity === 'strong' ? 'error' : 'info'}>
          ${advisory.message}
          <span class="muted">${jumpEvidenceNote(advisory.evidence)}</span>
        </ptk-notice>
      </li>
    `;
  }

  /**
   * §10.1's grade and every ceiling that held it there.
   *
   * All the reasons, not only the binding one, because the list doubles as the
   * answer to "what would I have to do to improve this?" -- a lifter shown only
   * the ceiling that bit fixes it and is graded the same way again on the next
   * one.
   */
  #renderConfidence(lift: LiftPlanView): TemplateResult {
    return html`
      <section>
        <div class="confidence-line">
          <h4>Data confidence</h4>
          <span class="grade">${confidenceLabel(lift.confidence.level)}</span>
        </div>
        ${
          lift.confidence.reasons.length === 0
            ? nothing
            : html`<ul class="list muted">
                ${lift.confidence.reasons.map((reason) => html`<li>${reason.message}</li>`)}
              </ul>`
        }
      </section>
    `;
  }

  #renderSubtotal(lift: LiftPlanView): TemplateResult | typeof nothing {
    if (lift.subtotalKilograms === null) return nothing;
    return html`<p class="muted">
      All three: ${weightText(lift.subtotalKilograms, this.session.setup.unit)}.
    </p>`;
  }

  /**
   * The sum of the planned thirds, which is a scenario made of scenarios.
   *
   * Said in the same breath as the figure rather than in a footnote below it.
   * §9 calls the planned third a scenario per lift; three of them added together
   * is the most optimistic reading on the screen, and it is the number a lifter
   * screenshots.
   */
  #renderTotal(): TemplateResult | typeof nothing {
    if (this.view.plannedTotalKilograms === null) return nothing;
    return html`
      <section class="panel totals">
        <h3>Planned total</h3>
        <p class="total-figure">
          ${weightText(this.view.plannedTotalKilograms, this.session.setup.unit)}
        </p>
        <p class="muted">
          Every planned third made. Each one is a scenario you decide after the second attempt, so
          treat this as the top of the range rather than the plan.
        </p>
      </section>
    `;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * notices it just handed content to have rendered any (§5.8). A caller awaiting
   * `updateComplete` and then reading text out of one would otherwise read the
   * previous render's -- usually not, which is what makes it expensive.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-plan-screen': PtkPlanScreen;
  }
}
