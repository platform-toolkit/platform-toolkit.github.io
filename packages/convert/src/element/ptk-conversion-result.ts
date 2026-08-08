// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The answer: what the federation's chart says, and -- quietly, underneath -- what
 * the arithmetic says.
 *
 * TWO NUMBERS THAT MUST NEVER MERGE
 *
 * 500 lb is 226.796 kg exactly, and there is no such attempt. The chart runs in
 * 2.5 kg steps, so the platform offers 226.4 kg or 228.9 kg and nothing between
 * them. A converter that prints 226.8 kg and stops has answered a question about
 * shipping labels, not about a meet: the number it gave cannot be loaded, cannot
 * be declared, and will be silently replaced by whichever attempt the loaders
 * actually put on the bar.
 *
 * So the chart answer is the answer here, and the exact figure is a secondary
 * line labelled as arithmetic. The exact figure is never offered as an attempt,
 * never fills a gap between two rows, and never appears alone where a chart is
 * available. When no chart is in hand at all -- offline, or a federation that
 * publishes none -- the element says so in a sentence rather than promoting the
 * arithmetic into the space the chart would have occupied.
 *
 * NEITHER NEIGHBOUR IS RECOMMENDED
 *
 * When a weight falls between two rows, both are shown, whichever is
 * mathematically closer is marked as closer, and that is the whole of the
 * opinion offered. The requirements are explicit that the heavier option must not
 * be described as safe, achievable, or recommended, and that the tool must not
 * quietly pick one -- an opener is a coaching decision made with information this
 * tool does not have.
 */
import type { ConversionRow } from '@platform-toolkit/data-contracts';
import {
  directionInputUnit,
  formatWeight,
  formatWeightAt,
  rowWeight,
  type ChartLookup,
  type ConversionAnswer,
  type ConversionDirection,
  type Weight,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-copy-button';
import '@platform-toolkit/ui/ptk-notice';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import type { ChartStatus } from '../types.js';

/** Asks the tool to put a published figure in the field. */
export interface SelectWeightDetail {
  /** The figure, in the unit currently being typed in. */
  readonly amount: number;
}

export const SELECT_WEIGHT_EVENT = 'ptk-select-weight';

/** One published row offered beside the answer, with why it is being offered. */
interface Option {
  readonly row: ConversionRow;
  /** Purely directional. Never an endorsement -- see the note at the top. */
  readonly heading: string;
  readonly closest: boolean;
}

/** The tag this element registers under. Written to the registry only by `element/index.ts`. */
export const CONVERSION_RESULT_TAG = 'ptk-conversion-result';

export class PtkConversionResult extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .panel {
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .empty {
      margin: 0;
      color: var(--ptk-color-text-muted);
    }

    .answer {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-sm);
      margin: 0;
      /* Readable at arm's length with a phone on the floor beside a rack, which
         is the stated distance this number has to carry. */
      font-size: 1.75rem;
      line-height: 1.2;
      font-weight: 700;
    }

    .answer .entered {
      font-size: var(--ptk-font-size-lg);
      font-weight: 400;
      color: var(--ptk-color-text-muted);
    }

    .badge {
      display: inline-block;
      margin: var(--ptk-space-sm) 0 0;
      padding: 0.125rem 0.5rem;
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      font-size: var(--ptk-font-size-sm);
      /* A border as well as a colour: forced-colours mode discards the
         background, and this is the line that says the number is official. */
      background-color: var(--ptk-color-surface-sunken);
    }

    .lead {
      margin: 0 0 var(--ptk-space-sm);
      font-weight: 600;
    }

    ul {
      list-style: none;
      margin: var(--ptk-space-md) 0 0;
      padding: 0;
      display: grid;
      gap: var(--ptk-space-sm);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    }

    li {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    li.closest {
      border-color: var(--ptk-color-accent);
      border-left-width: 4px;
    }

    .option-heading {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .option-value {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
    }

    .option-pair {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .option-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
    }

    .exact {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ptk-space-sm);
      margin: var(--ptk-space-md) 0 0;
      padding-top: var(--ptk-space-md);
      border-top: 1px solid var(--ptk-color-border);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .secondary {
      margin: var(--ptk-space-md) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /** The conversion, or `null` when the field is empty or does not parse. */
  @property({ attribute: false }) answer: ConversionAnswer | null = null;

  /** How the read of the published chart went. */
  @property({ type: String, attribute: 'chart-status' }) chartStatus: ChartStatus = 'loading';

  /**
   * Which federation's chart is being quoted.
   *
   * Named in the labels rather than baked into them, because §5.1's rule applies
   * to wording as much as to numbers: "USPA chart value" written into a template
   * is still correct the day a second federation ships, and still wrong.
   */
  @property({ type: String, attribute: 'chart-label' }) chartLabel = '';

  /** Decimal places for the exact mathematical equivalent. */
  @property({ type: Number }) precision = 2;

  /** Only used to word the empty state, so the example is in the right unit. */
  @property({ type: String }) direction: ConversionDirection = 'lb-to-kg';

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    const answer = this.answer;
    if (answer === null) {
      return html`<div class="panel">
        <p class="empty">${this.#emptyMessage()}</p>
      </div>`;
    }
    return html`<div class="panel">${this.#renderChart(answer)} ${this.#renderExact(answer)}</div>`;
  }

  /**
   * The neutral starting state.
   *
   * An example rather than an instruction, and in the unit the visitor is about
   * to type in. Never an error: an empty field is where every visit begins.
   */
  #emptyMessage(): string {
    return directionInputUnit(this.direction) === 'lb'
      ? 'Enter a weight in pounds. For example, 315.'
      : 'Enter a weight in kilograms. For example, 142.5.';
  }

  #renderChart(answer: ConversionAnswer): TemplateResult {
    if (answer.chart === null) {
      return this.#renderWithoutChart();
    }
    const lookup = answer.chart;
    switch (lookup.kind) {
      case 'exact':
        return this.#renderExactMatch(answer, lookup);
      case 'between':
        return this.#renderBetween(answer, lookup);
      case 'below-range':
      case 'above-range':
        return this.#renderOutside(answer, lookup);
    }
  }

  /**
   * What is said when there is no chart to quote.
   *
   * Three different sentences for three different situations, and none of them
   * is "here is the arithmetic, treat it as an attempt". A federation that
   * publishes no chart and a read that failed look identical if both render as
   * an empty space, and one of them is worth reloading.
   */
  #renderWithoutChart(): TemplateResult {
    switch (this.chartStatus) {
      case 'loading':
        return html`<ptk-notice tone="info">Loading the conversion chart.</ptk-notice>`;
      case 'unavailable':
        return html`<ptk-notice tone="info"
          >No official conversion chart is published for this federation, so only the exact
          conversion is shown.</ptk-notice
        >`;
      case 'failed':
        return html`<ptk-notice tone="error"
          >The conversion chart could not be loaded, so only the exact conversion is shown.
          Reloading may help.</ptk-notice
        >`;
      case 'ready':
        // Ready with nothing in hand means the chart itself was rejected by the
        // domain's validation. Same sentence as unavailable: to the visitor the
        // situation is identical, and the reason is in the console.
        return html`<ptk-notice tone="info"
          >No official conversion chart is available, so only the exact conversion is
          shown.</ptk-notice
        >`;
    }
  }

  #renderExactMatch(
    answer: ConversionAnswer,
    lookup: Extract<ChartLookup, { kind: 'exact' }>,
  ): TemplateResult {
    const other = otherUnit(answer.entered.unit);
    const value = rowWeight(lookup.row, other);
    // Two spellings, because the requirements ask for two: a pound figure that
    // lands on a row is an exact *match* against the chart, and a kilogram figure
    // that lands on a row simply *is* a chart value.
    const badge =
      answer.entered.unit === 'lb'
        ? `Exact ${this.#label()}chart match`
        : `Official ${this.#label()}chart value`;
    return html`
      <p class="answer">
        <span class="entered">${formatWeight(answer.entered)} =</span>
        <span>${formatWeight(value)}</span>
      </p>
      <p class="badge">${badge}</p>
      ${this.#renderOptions(answer.entered.unit, [
        ...(lookup.below === null
          ? []
          : [{ row: lookup.below, heading: 'Next weight down', closest: false }]),
        ...(lookup.above === null
          ? []
          : [{ row: lookup.above, heading: 'Next weight up', closest: false }]),
      ])}
    `;
  }

  #renderBetween(
    answer: ConversionAnswer,
    lookup: Extract<ChartLookup, { kind: 'between' }>,
  ): TemplateResult {
    const entered = formatWeight(answer.entered);
    // Again two spellings for two situations. A pound figure between rows is the
    // ordinary case -- the chart is indexed in kilograms, so almost every round
    // pound number falls between two rows -- while a kilogram figure between rows
    // means the visitor named an increment the federation does not run.
    const lead =
      answer.entered.unit === 'lb'
        ? `${entered} falls between two ${this.#label()}chart attempts.`
        : `${entered} is not listed as a standard ${this.#label()}chart increment.`;
    return html`
      <p class="lead">${lead}</p>
      ${this.#renderOptions(answer.entered.unit, [
        {
          row: lookup.below,
          heading: 'Next weight down',
          closest: lookup.closest === 'below' || lookup.closest === 'tie',
        },
        {
          row: lookup.above,
          heading: 'Next weight up',
          closest: lookup.closest === 'above' || lookup.closest === 'tie',
        },
      ])}
      ${
        lookup.closest === 'tie'
          ? html`<p class="secondary">
              Both are exactly the same distance away. Neither is closer than the other.
            </p>`
          : nothing
      }
    `;
  }

  #renderOutside(
    answer: ConversionAnswer,
    lookup: Extract<ChartLookup, { kind: 'below-range' | 'above-range' }>,
  ): TemplateResult {
    const side = lookup.kind === 'below-range' ? 'below the lightest' : 'above the heaviest';
    return html`
      <p class="lead">
        ${formatWeight(answer.entered)} is ${side} weight on the ${this.#label()}chart.
      </p>
      ${this.#renderOptions(answer.entered.unit, [
        {
          row: lookup.nearest,
          heading:
            lookup.kind === 'below-range' ? 'Lightest on the chart' : 'Heaviest on the chart',
          closest: false,
        },
      ])}
    `;
  }

  /**
   * The published rows on offer, each copyable and each selectable in one tap.
   *
   * Selecting one puts *the row's own figure in the entered unit* back in the
   * field, which lands the next lookup on an exact match. That is why the action
   * exists rather than leaving somebody to retype a number off the screen: a
   * transposed digit here produces a different attempt.
   */
  #renderOptions(unit: WeightUnit, options: readonly Option[]): TemplateResult | typeof nothing {
    if (options.length === 0) return nothing;
    const other = otherUnit(unit);
    return html`<ul>
      ${options.map((option) => {
        const own = rowWeight(option.row, unit);
        const paired = rowWeight(option.row, other);
        const text = `${formatWeight(own)} = ${formatWeight(paired)}`;
        return html`<li class=${option.closest ? 'closest' : ''}>
          <span class="option-heading">${option.heading}${option.closest ? ' — closest' : ''}</span>
          <span class="option-value">${formatWeight(paired)}</span>
          <span class="option-pair">${text}</span>
          <span class="option-actions">
            <ptk-button
              variant="secondary"
              accessible-name=${`Convert ${formatWeight(own)} instead`}
              @click=${() => {
                this.#select(own);
              }}
              >Use ${formatWeight(own)}</ptk-button
            >
            <ptk-copy-button
              variant="quiet"
              .text=${text}
              accessible-name=${`Copy ${text}`}
            ></ptk-copy-button>
          </span>
        </li>`;
      })}
    </ul>`;
  }

  /**
   * The arithmetic, kept where arithmetic belongs.
   *
   * Below a rule, in the small size, labelled as a mathematical equivalent and
   * never as a chart value. It is always present -- it is a real answer to a real
   * question, and it is the only answer when no chart loaded -- and it is never
   * the prominent one when a chart did.
   */
  #renderExact(answer: ConversionAnswer): TemplateResult {
    const text = `${formatWeight(answer.entered)} = ${formatWeightAt(answer.exact, this.precision)}`;
    return html`<p class="exact">
      <span>Exact mathematical equivalent: ${formatWeightAt(answer.exact, this.precision)}</span>
      <ptk-copy-button
        variant="quiet"
        .text=${text}
        accessible-name=${`Copy ${text}`}
      ></ptk-copy-button>
    </p>`;
  }

  /** The federation's name with a trailing space, or nothing at all. */
  #label(): string {
    return this.chartLabel === '' ? '' : `${this.chartLabel} `;
  }

  #select(weight: Weight): void {
    this.dispatchEvent(
      new CustomEvent<SelectWeightDetail>(SELECT_WEIGHT_EVENT, {
        detail: { amount: weight.amount },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function otherUnit(unit: WeightUnit): WeightUnit {
  return unit === 'kg' ? 'lb' : 'kg';
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-conversion-result': PtkConversionResult;
  }

  interface HTMLElementEventMap {
    [SELECT_WEIGHT_EVENT]: CustomEvent<SelectWeightDetail>;
  }
}
