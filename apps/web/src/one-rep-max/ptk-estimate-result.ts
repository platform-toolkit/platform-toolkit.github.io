/**
 * The answer, in the order §9.1 fixes: the figure, the grade, the two
 * scenarios, one sentence of interpretation, and then the reasons.
 *
 * The order is the requirement, not a layout preference. A lifter opens this
 * tool for one number; putting the research in front of it is how a calculator
 * becomes a paper. Putting the number alone is how an estimate becomes a
 * prediction. So: number, then what the number is worth, then why.
 *
 * WHAT THIS ELEMENT REFUSES TO SAY
 *
 * The two scenarios are drawn from where published equations disagree, and
 * every tempting shorthand for that is banned by name -- confidence interval,
 * margin of error, probability, safe attempt, opener, guaranteed max (§7.5,
 * §11, §14). Nothing here claims a lifter can complete a weight today (§17).
 * The wording lives in `copy.ts` so the whole vocabulary can be read at once.
 *
 * THREE STATES FROM TWO PROPERTIES
 *
 * No `status` attribute: a set that has not been described yet, a set the
 * domain refused, and a set with an answer are exactly "no estimate and no
 * problems", "problems", and "an estimate". A fourth combination does not
 * exist, and an attribute would let one be spelled.
 */
import {
  formatWeight,
  type OneRepMaxEstimate,
  type OneRepMaxProblem,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  SCENARIO_NOTES,
  advisoryText,
  describeSet,
  effectLabel,
  gradeLabel,
  interpretation,
  problemSentence,
} from './copy.js';

@customElement('ptk-estimate-result')
export class PtkEstimateResult extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .panel {
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .kind {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * Large enough to read at a rack with the phone on the floor, which §12 asks
     * for in those words. Not a viewport-relative size: the same element sits in
     * a 320 px embed column on a desktop page, where a viewport unit would make
     * the one number on the screen the smallest thing on it.
     */
    .headline {
      margin: 0;
      font-size: 2.25rem;
      font-weight: 700;
      line-height: 1.1;
      /* A long pound figure at 2.25rem is wider than a 320 px column minus the
         gutters; wrapping is better than a number running off the side. */
      overflow-wrap: anywhere;
    }

    .grade {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      margin: var(--ptk-space-sm) 0 0;
      font-weight: 600;
    }

    .describes,
    .interpretation {
      margin: var(--ptk-space-sm) 0 0;
    }

    .interpretation {
      color: var(--ptk-color-text-muted);
    }

    /*
     * The two scenarios, side by side where there is room and stacked where
     * there is not. The min() is load-bearing: without it a container narrower
     * than the track minimum overflows instead of collapsing to one column.
     */
    .scenarios {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-md);
      padding: 0;
      list-style: none;
    }

    .scenario {
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .scenario-name {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .scenario-weight {
      font-size: var(--ptk-font-size-lg);
      font-weight: 600;
    }

    .scenario-note {
      display: block;
      margin-top: var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .advisories {
      margin: var(--ptk-space-md) 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .advisory {
      display: grid;
      gap: var(--ptk-space-xs);
      padding-left: var(--ptk-space-md);
      border-left: 3px solid var(--ptk-color-border);
    }

    .effect {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .caveat {
      margin: var(--ptk-space-md) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .problems {
      margin: var(--ptk-space-sm) 0 0;
      padding-left: var(--ptk-space-lg);
      display: grid;
      gap: var(--ptk-space-xs);
    }
  `;

  /** The domain's answer, or `null` when there is not yet a set to describe. */
  @property({ attribute: false }) estimate: OneRepMaxEstimate | null = null;

  /** Everything wrong with the input, all at once. Empty when nothing is. */
  @property({ attribute: false }) problems: readonly OneRepMaxProblem[] = [];

  override render(): TemplateResult {
    if (this.problems.length > 0) {
      return html`<ptk-notice tone="error">
        <p>That set cannot be read as described.</p>
        <ul class="problems">
          ${this.problems.map((problem) => html`<li>${problemSentence(problem.code)}</li>`)}
        </ul>
      </ptk-notice>`;
    }

    const estimate = this.estimate;
    if (estimate === null) {
      return html`<ptk-notice tone="info">
        Enter a weight and a repetition count. The estimate appears here and updates as you change
        anything.
      </ptk-notice>`;
    }

    return html`<div class="panel">
      ${this.#renderHeadline(estimate)}
      <p class="describes">${describeSet(estimate)}</p>
      ${this.#renderScenarios(estimate)}
      <p class="interpretation">${interpretation(estimate)}</p>
      ${this.#renderAdvisories(estimate)}
      <p class="caveat">
        An estimate from published equations, not a statement about what you will lift today.
      </p>
    </div>`;
  }

  /**
   * The figure, or the reason there is not one.
   *
   * An observed single is labelled as observed rather than estimated, because
   * it is the one number on this screen that was actually lifted -- and several
   * equations answer more than the load at one repetition, so a tool that let
   * them through would tell somebody who just missed a second attempt that they
   * had in fact lifted more than they lifted.
   */
  #renderHeadline(estimate: OneRepMaxEstimate): TemplateResult {
    switch (estimate.kind) {
      case 'observed-single':
        return html`
          <p class="kind">Observed single</p>
          <p class="headline">${formatWeight(estimate.observed)}</p>
        `;
      case 'withheld':
        return html`
          <p class="kind">No estimate</p>
          <p class="headline">&mdash;</p>
        `;
      case 'estimated':
        return html`
          <p class="kind">Estimated max</p>
          <p class="headline">${formatWeight(estimate.toolkit)}</p>
          <p class="grade">${gradeLabel(estimate.grade)}</p>
        `;
    }
  }

  #renderScenarios(estimate: OneRepMaxEstimate): TemplateResult | typeof nothing {
    if (estimate.kind !== 'estimated') return nothing;
    const scenarios = [
      { name: 'Conservative', weight: estimate.conservative, note: SCENARIO_NOTES.conservative },
      { name: 'Middle', weight: estimate.toolkit, note: SCENARIO_NOTES.toolkit },
      { name: 'Optimistic', weight: estimate.optimistic, note: SCENARIO_NOTES.optimistic },
    ];
    return html`<ul class="scenarios">
      ${scenarios.map(
        (scenario) =>
          html`<li class="scenario">
            <span class="scenario-name">${scenario.name}</span>
            <span class="scenario-weight">${formatWeight(scenario.weight)}</span>
            <span class="scenario-note">${scenario.note}</span>
          </li>`,
      )}
    </ul>`;
  }

  /**
   * Every finding, with how it moved the grade said in words.
   *
   * Not folded away. The grade is an assertion about a lifter's set and the
   * advisories are the whole of the evidence for it; a fold would leave the
   * assertion on screen with its reasons one tap away, which is the shape of a
   * verdict rather than of a calculation.
   */
  #renderAdvisories(estimate: OneRepMaxEstimate): TemplateResult | typeof nothing {
    if (estimate.advisories.length === 0) return nothing;
    return html`<ul class="advisories">
      ${estimate.advisories.map(
        (advisory) =>
          html`<li class="advisory">
            <span class="effect">${effectLabel(advisory)}</span>
            <span>${advisoryText(advisory, estimate)}</span>
          </li>`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-estimate-result': PtkEstimateResult;
  }
}
