/**
 * The weights people actually say out loud, read against the federation's chart.
 *
 * "Three plates" is 315 lb everywhere on earth and 142.88 kg nowhere on a platform:
 * the nearest attempts a lifter can be given are 142.5 kg and 145 kg. That gap is
 * the entire reason this section exists. A lifter who has trained in pounds their
 * whole life and is filling in their first attempt card is not converting an
 * arbitrary number, they are converting one of about fifteen, and every one of them
 * lands between two published rows.
 *
 * So each landmark shows the *published* rows around it rather than a computed
 * figure, on the same rule the rest of the tool runs on: nothing here manufactures
 * a chart weight. The exact arithmetic is present, small, and labelled as
 * arithmetic.
 *
 * THE TWO BARS ARE NOT THE SAME BAR
 *
 * A 45 lb bar takes spring clips that weigh nothing worth counting. A 20 kg
 * competition bar takes 2.5 kg collars, so it is 25 kg before a plate goes on --
 * and that five kilograms is the single most common reason a lifter's arithmetic
 * is out. The requirements ask for it to be stated rather than implied, so the
 * assumption is printed above the rows it applies to and `emptyBar` comes from the
 * sequence rather than from a number typed in here.
 */
import {
  convertMilestones,
  formatWeight,
  formatWeightAt,
  milestonesFor,
  rowWeight,
  type ConversionChart,
  type MilestoneConversion,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ChartStatus } from './session.js';

@customElement('ptk-milestone-chart')
export class PtkMilestoneChart extends LitElement {
  static override styles = css`
    :host {
      display: block;
      /* Everything below sizes against the element, not the viewport: this
         renders in a 320 px phone and in a 320 px sidebar of a 1600 px page, and
         those are the same situation. */
      container-type: inline-size;
    }

    h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-lg);
    }

    .assumptions {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--ptk-space-sm);
      /* The min(100%, ...) is load-bearing: without it a container narrower than
         the track minimum overflows sideways instead of collapsing to one column.
         No backticks in here -- they would end the tagged template. */
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    }

    li {
      display: grid;
      gap: 0.25rem;
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    li.full {
      /* A word as well as a rule, because a border weight alone is a colour
         difference by another name and the requirement is that a full-plate row be
         distinguishable without one. */
      border-left: 4px solid var(--ptk-color-accent);
    }

    .heading {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ptk-space-sm);
    }

    .total {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
    }

    .chip {
      padding: 0.0625rem 0.375rem;
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .chart-value {
      font-weight: 600;
    }

    .note,
    .exact {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ptk-plate-stack {
      margin-top: 0.25rem;
    }
  `;

  /** Which sequence to show. The unit the visitor is entering weights in. */
  @property({ type: String }) unit: WeightUnit = 'lb';

  /** The federation's published chart, or `null` when there is none in hand. */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  /** How the read went, so an absent chart can say which kind of absent. */
  @property({ type: String, attribute: 'chart-status' }) chartStatus: ChartStatus = 'loading';

  /** The federation's name, for wording that quotes it. */
  @property({ type: String, attribute: 'chart-label' }) chartLabel = '';

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    const sequence = milestonesFor(this.unit);
    const rows = convertMilestones(sequence, this.chart);
    return html`
      <h3>Common barbell weights</h3>
      <p class="assumptions">
        ${sequence.barDescription}. Every total below includes the
        bar${this.unit === 'kg' ? ' and 5 kg of competition collars' : ''}. Plates shown are per
        side.
      </p>
      ${
        this.chart === null && this.chartStatus === 'failed'
          ? html`<ptk-notice tone="error"
              >The conversion chart could not be loaded, so these show the exact conversion
              only.</ptk-notice
            >`
          : nothing
      }
      <ul>
        ${rows.map((row) => this.#renderRow(row))}
      </ul>
    `;
  }

  #renderRow(row: MilestoneConversion): TemplateResult {
    const other: WeightUnit = this.unit === 'kg' ? 'lb' : 'kg';
    return html`<li class=${row.milestone.fullPlates ? 'full' : ''}>
      <span class="heading">
        <span class="total">${formatWeight(row.weight)}</span>
        ${row.milestone.fullPlates ? html`<span class="chip">Full plates</span>` : nothing}
      </span>
      ${this.#renderChartValue(row, other)}
      <span class="exact">Exactly ${formatWeightAt(row.exact, 2)}</span>
      <ptk-plate-stack
        .plates=${row.milestone.perSide}
        unit=${this.unit}
        empty-label="Bar only"
      ></ptk-plate-stack>
    </li>`;
  }

  /**
   * What the chart says about one landmark.
   *
   * Four shapes, and the common one on the pound sequence is "between" -- the chart
   * is indexed in 2.5 kg steps, so of the fifteen pound landmarks not one is a
   * published row. Showing a single rounded kilogram figure for them is the mistake
   * this whole tool exists to avoid, so both neighbours are named and the closer one
   * is said to be closer.
   */
  #renderChartValue(row: MilestoneConversion, other: WeightUnit): TemplateResult {
    const lookup = row.chart;
    if (lookup === null) {
      return html`<span class="note">No published chart weight available.</span>`;
    }
    switch (lookup.kind) {
      case 'exact':
        return html`<span class="chart-value"
          >${formatWeight(rowWeight(lookup.row, other))} on the ${this.#label()}chart</span
        >`;
      case 'between': {
        const below = formatWeight(rowWeight(lookup.below, other));
        const above = formatWeight(rowWeight(lookup.above, other));
        const closer =
          lookup.closest === 'tie'
            ? 'Exactly between the two.'
            : `Closest is ${lookup.closest === 'below' ? below : above}.`;
        return html`<span class="chart-value">${below} or ${above} on the chart</span>
          <span class="note">${closer}</span>`;
      }
      case 'below-range':
      case 'above-range':
        return html`<span class="note"
          >Outside the published chart. Nearest is
          ${formatWeight(rowWeight(lookup.nearest, other))}.</span
        >`;
    }
  }

  #label(): string {
    return this.chartLabel === '' ? '' : `${this.chartLabel} `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-milestone-chart': PtkMilestoneChart;
  }
}
