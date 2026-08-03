// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Every equation, what it answered, and whether it counted.
 *
 * §9.2 puts this behind a disclosure and §16 requires it to exist: each formula
 * named, its equation shown, its source cited, its result given, and the reason
 * it did or did not contribute. A tool that produces one number from a score of
 * models and never shows them is asking to be trusted; showing them is the
 * difference between a calculator and an oracle. The count in the summary is
 * read off `FORMULAS` rather than written out, because a sentence that says
 * twenty over a list of twenty-two is the tool being wrong about itself.
 *
 * WHY CARDS AND NOT A TABLE
 *
 * This is five columns of data, and five columns at 320 px is either a sideways
 * scroll or four-character truncation -- both forbidden by §5.7, and the second
 * one silently. Cards in an intrinsic grid are a table on a laptop and a stack on
 * a phone with no media query and no second markup path. The reading order is
 * the same either way, which is what makes the stacked form usable rather than
 * merely present.
 *
 * WHY THERE IS A LEGEND, AND WHY IT SAYS WHAT IS *NOT* AN INPUT
 *
 * The cards printed twenty-two notations with nothing on the page defining a
 * symbol in any of them. `1RM = 7.24 + 1.05w` is a regression on a weight, and
 * which weight is the entire question -- a lifter read this section and
 * concluded the tool was using a body weight it had never asked for. So the
 * legend names `w` as the load lifted and then says outright that no equation
 * here uses body weight, because a reader who has just formed that impression
 * needs it contradicted rather than merely not confirmed.
 *
 * WHAT THE SPREAD IS NOT
 *
 * The disagreement figures are how far apart published models are on this set.
 * They are not a confidence interval, a margin of error, or a probability, and
 * the copy here says so in as many words -- §7.5 and §11 make that a product
 * constraint rather than a matter of tone, because a reader who takes the spread
 * for a probability will plan a third attempt out of it.
 */
import {
  FORMULAS,
  formatWeight,
  type FormulaOutcome,
  type OneRepMaxEstimate,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { BODY_WEIGHT_NOTE, NOTATION_LEGEND, reasonLabel } from './copy.js';

@customElement('ptk-formula-comparison')
export class PtkFormulaComparison extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .spread,
    .legend {
      margin: 0 0 var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-sunken);
    }

    .spread h3,
    .legend h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ptk-color-text-muted);
    }

    /*
     * Wider tracks than the figures grid above, because these values are
     * sentences rather than weights: at 12rem a definition wraps to four lines
     * and the legend is taller than the cards it explains.
     */
    .terms {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
      gap: var(--ptk-space-sm);
      margin: 0;
    }

    /* The symbol in the same face the notation is set in, or a reader has to
       decide for themselves that the w here and the w there are the same
       letter. (No backticks in a css comment -- they end the template.) */
    .term dt {
      font-family: var(--ptk-font-family-mono);
      font-weight: 700;
    }

    .term dd {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * A description list laid out as label-and-value pairs, collapsing to one
     * pair per row when the element is narrow. Each pair is its own grid so a
     * long label cannot drag its value away from it.
     */
    .figures {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--ptk-space-sm);
      margin: 0;
    }

    .figure dt {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .figure dd {
      margin: 0;
      font-weight: 600;
    }

    .caveat {
      margin: var(--ptk-space-sm) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* A zero minimum width is what keeps a card inside its track. A grid item's
       automatic minimum size is its min-content width, so without this the
       widest unbreakable run of text on the card -- a notation, a surname, a
       year -- becomes a floor the track cannot go under, and the whole page
       scrolls sideways at 320px. The overflow-wrap rules below are the other
       half: this lets the box shrink, those let the text follow it. */
    .card {
      display: grid;
      min-width: 0;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      overflow-wrap: anywhere;
    }

    /* An equation that did not count is drawn quieter by its surface and its
       border, never by dimming the text -- the reason it was excluded is the
       most useful sentence on the card. */
    .card.excluded {
      border-style: dashed;
      background-color: var(--ptk-color-surface-sunken);
    }

    .name {
      font-weight: 600;
    }

    .result {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .notation {
      font-family: var(--ptk-font-family-mono);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .reason,
    .source {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .version {
      margin: var(--ptk-space-md) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  @property({ attribute: false }) estimate: OneRepMaxEstimate | null = null;

  override render(): TemplateResult | typeof nothing {
    const estimate = this.estimate;
    if (estimate === null) return nothing;
    // An assisted set is refused before any equation is evaluated, so there are
    // no outcomes to show. The fold has to go with them: a summary promising
    // what each equation answered, over an empty list, reads as a section that
    // failed to load rather than as a set nothing was computed from.
    if (estimate.outcomes.length === 0) return nothing;
    return html`
      <ptk-disclosure
        label="Every equation"
        summary=${`${String(FORMULAS.length)} published equations, what each answered for this set, and why it did or did not count.`}
      >
        ${this.#renderSpread(estimate)}${this.#renderLegend()}
        <ul class="cards">
          ${estimate.outcomes.map((outcome) => this.#renderOutcome(outcome))}
        </ul>
        <p class="version">Methodology version ${estimate.methodologyVersion}.</p>
      </ptk-disclosure>
    `;
  }

  /** The five figures §8.4 asks for by name, and the sentence saying what they are not. */
  #renderSpread(estimate: OneRepMaxEstimate): TemplateResult | typeof nothing {
    if (estimate.kind !== 'estimated') return nothing;
    const disagreement = estimate.disagreement;
    const figures = [
      { term: 'Lowest equation', value: formatWeight(disagreement.lowest) },
      { term: 'Highest equation', value: formatWeight(disagreement.highest) },
      {
        term: 'Full spread',
        value: `${formatWeight(disagreement.spread)} (${percent(disagreement.fullRatio)})`,
      },
      {
        term: 'Middle half',
        value: `${formatWeight(disagreement.interquartileSpread)} (${percent(disagreement.interquartileRatio)})`,
      },
      {
        term: 'Independent families counted',
        value: String(estimate.familyCount),
      },
    ];
    return html`<section class="spread">
      <h3>How far apart the equations are</h3>
      <dl class="figures">
        ${figures.map(
          (figure) =>
            html`<div class="figure">
              <dt>${figure.term}</dt>
              <dd>${figure.value}</dd>
            </div>`,
        )}
      </dl>
      <p class="caveat">
        This is disagreement between published models on the set you described. It is not a margin
        of error and it says nothing about how likely any of these figures is.
      </p>
    </section>`;
  }

  /**
   * What the letters mean, above the cards that use them.
   *
   * Above rather than below: a reader meeting `1RM = 7.24 + 1.05w` with no
   * legend has already decided what `w` is by the time they reach the bottom of
   * twenty-two cards, and a definition arriving after the decision does not
   * undo it. Rendered for every kind of estimate, including the observed single
   * where no equation voted -- the notations are still on screen.
   */
  #renderLegend(): TemplateResult {
    return html`<section class="legend">
      <h3>Reading the equations</h3>
      <dl class="terms">
        ${NOTATION_LEGEND.map(
          (term) =>
            html`<div class="term">
              <dt>${term.symbol}</dt>
              <dd>${term.meaning}</dd>
            </div>`,
        )}
      </dl>
      <p class="caveat">${BODY_WEIGHT_NOTE}</p>
    </section>`;
  }

  #renderOutcome(outcome: FormulaOutcome): TemplateResult {
    const estimate = outcome.estimate;
    return html`<li class=${outcome.included ? 'card' : 'card excluded'}>
      <span class="name">${outcome.formula.name}</span>
      <span class="result">${estimate === null ? 'No answer' : formatWeight(estimate)}</span>
      <span class="notation">${outcome.formula.notation}</span>
      <span class="reason">${reasonLabel(outcome.reasonCode)}</span>
      <span class="source">${outcome.formula.source}</span>
    </li>`;
  }

  /**
   * Lit settles before the disclosure it just handed a summary to has rendered
   * one (§5.8), so a test that reads the folded sentence would read the previous
   * render's.
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

/**
 * A ratio as a percentage, to one place.
 *
 * One place because these run from about two percent to about ten, and a whole
 * number would collapse the 2.5 that earns an upgrade and the 3.4 that does not
 * into the same figure on screen.
 */
function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-formula-comparison': PtkFormulaComparison;
  }
}
