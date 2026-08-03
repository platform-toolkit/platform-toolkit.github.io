// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The converter: one field, one answer, and the federation's chart behind both.
 *
 * The root holds all of the tool's state and the four children below it hold none,
 * for the reason tool 2 gives at greater length -- every state this tool can be in
 * has to be reachable from a story and a test by setting properties, including the
 * ones no interaction produces: a chart that failed to load, a federation that
 * publishes none, a value off the end of the published range.
 *
 * WHAT THE ANSWER IS COMPUTED FROM
 *
 * From `entryWeight` -- the drift-free origin converted into the unit currently on
 * screen -- and not from the rounded figure in the field. The two differ in the
 * fourth decimal place after a reversal, and taking the rounded one would mean the
 * exact mathematical equivalent, the one number here whose entire job is to be
 * exact, was computed from a number that had already been rounded once.
 *
 * The field's *text* is a separate thing again, and stays exactly what was typed.
 * See `session.ts`.
 */
import {
  directionInputUnit,
  directionOutputUnit,
  entryWeight,
  convertAgainstChart,
  type ConversionAnswer,
  type ConversionChart,
  type ConversionDirection,
} from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { SELECT_WEIGHT_EVENT, type SelectWeightDetail } from './ptk-conversion-result.js';
import './ptk-conversion-result.js';
import './ptk-conversion-table.js';
import './ptk-milestone-chart.js';
import {
  CHART_STEPS,
  CONVERTER_PREFERENCES,
  DEFAULT_PRECISION,
  EMPTY_ENTRY,
  RESULT_PRECISIONS,
  clearValue,
  entryProblem,
  loadSettings,
  reverse,
  saveEntry,
  selectValue,
  setDirection,
  typeInto,
  type ChartStatus,
  type ColumnOrder,
  type ConverterEntry,
} from './session.js';

/**
 * The names the delegated handlers match on.
 *
 * Constants rather than literals in two places, because `dataset` is a string
 * from the DOM: a typo in a template writes a key nothing reads back, the control
 * visibly responds, and nothing happens.
 */
const DIRECTION_FIELD = 'direction';
const WEIGHT_FIELD = 'weight';
const PRECISION_FIELD = 'precision';
const STEP_FIELD = 'chart-step';
const ORDER_FIELD = 'column-order';

@customElement('ptk-converter')
export class PtkConverter extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    section {
      margin-bottom: var(--ptk-space-lg);
    }

    section:last-child {
      margin-bottom: 0;
    }

    .entry {
      display: grid;
      gap: var(--ptk-space-md);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
    }

    .identity {
      margin: var(--ptk-space-sm) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /**
   * Where the direction, the last value and the chart controls are kept.
   *
   * Defaulted to a store with no backing so the element works standing on its own
   * in a story or a test, and so the one configuration these tools actually ship
   * into -- an iframe whose embedder blocked storage -- needs no branch anywhere.
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /** The federation's published chart, or `null` when there is none in hand. */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  @property({ type: String, attribute: 'chart-status' }) chartStatus: ChartStatus = 'loading';

  @state() private entry: ConverterEntry = EMPTY_ENTRY;

  @state() private precision = DEFAULT_PRECISION;

  @state() private step = 0;

  @state() private order: ColumnOrder = 'kilograms-first';

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(SELECT_WEIGHT_EVENT, this.#onSelect);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(SELECT_WEIGHT_EVENT, this.#onSelect);
    super.disconnectedCallback();
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  /**
   * Reads the store whenever it is handed in or swapped out.
   *
   * Not in `connectedCallback`: Lit records the class-field default as changed on
   * the first update, so this fires once before the first render either way, and
   * it *also* fires when `view.ts` or a story replaces the store afterwards.
   * Restoring only on connect shows defaults over a device that remembers
   * something else, on some visits and not others.
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings')) {
      const settings = loadSettings(this.settings);
      this.entry = settings.entry;
      this.precision = settings.precision;
      this.step = settings.step;
      this.order = settings.order;
    }
  }

  override render(): TemplateResult {
    const unit = directionInputUnit(this.entry.direction);
    /*
     * The landmarks are listed in the unit being converted *to*, which is the
     * opposite of everything else on the screen and is the point of them.
     *
     * Somebody on "pounds to kilograms" is on their way to a kilogram platform.
     * The list they need there is the kilogram loadings -- what a 20 kg bar with
     * collars and a pair of 25s actually comes to -- with the pound reading
     * beside each one, because the pound reading is the thing they already have
     * a feel for. Listing the pound sequence instead answers a question they did
     * not ask: it tells a lifter what three plates a side is in kilograms, which
     * is the *other* radio button, and draws a rack of 45s for a meet that has
     * none. The mirror holds going the other way.
     */
    const landmarkUnit = directionOutputUnit(this.entry.direction);
    const answer = this.#answer();
    return html`
      <section class="entry">
        <ptk-choice-group
          data-field=${DIRECTION_FIELD}
          label="Convert"
          .choices=${[
            { value: 'lb-to-kg', label: 'Pounds to kilograms' },
            { value: 'kg-to-lb', label: 'Kilograms to pounds' },
          ]}
          value=${this.entry.direction}
        ></ptk-choice-group>

        <ptk-number-field
          data-field=${WEIGHT_FIELD}
          label=${unit === 'lb' ? 'Weight in pounds' : 'Weight in kilograms'}
          unit=${unit}
          placeholder=${unit === 'lb' ? '315' : '142.5'}
          .value=${this.entry.text}
          error=${entryProblem(this.entry) ?? ''}
        ></ptk-number-field>

        <div class="actions">
          <ptk-button
            variant="secondary"
            accessible-name="Reverse the conversion, converting the current value"
            @click=${() => {
              this.#setEntry(reverse(this.entry));
            }}
            >Reverse</ptk-button
          >
          ${
            this.entry.text === ''
              ? nothing
              : html`<ptk-button
                  variant="quiet"
                  accessible-name="Clear the weight"
                  @click=${() => {
                    this.#setEntry(clearValue(this.entry));
                  }}
                  >Clear</ptk-button
                >`
          }
        </div>
      </section>

      <section>
        <ptk-conversion-result
          .answer=${answer}
          chart-status=${this.chartStatus}
          chart-label=${this.chart?.label ?? ''}
          .precision=${this.precision}
          direction=${this.entry.direction}
        ></ptk-conversion-result>
        ${this.#renderIdentity()}
      </section>

      <section>
        <ptk-disclosure
          label="Result precision"
          summary=${`Showing ${String(this.precision)} decimal places on the exact conversion.`}
        >
          <ptk-choice-group
            data-field=${PRECISION_FIELD}
            label="Decimal places"
            .choices=${RESULT_PRECISIONS.map((places) => ({
              value: String(places),
              label: `${String(places)} decimal places`,
            }))}
            value=${String(this.precision)}
          ></ptk-choice-group>
        </ptk-disclosure>
      </section>

      <section>
        <ptk-milestone-chart
          unit=${landmarkUnit}
          .chart=${this.chart}
          chart-status=${this.chartStatus}
          chart-label=${this.chart?.label ?? ''}
        ></ptk-milestone-chart>
      </section>

      <section>
        <ptk-conversion-table
          .chart=${this.chart}
          chart-status=${this.chartStatus}
          .step=${this.step}
          order=${this.order}
        ></ptk-conversion-table>
      </section>
    `;
  }

  /**
   * Which chart is answering, said plainly and always on screen.
   *
   * A conversion tool that shows a federation's rounded figures without naming the
   * federation is a tool whose numbers cannot be checked against anything, and the
   * day a second federation ships it becomes a tool that is quietly wrong for half
   * its visitors.
   */
  #renderIdentity(): TemplateResult | typeof nothing {
    const chart = this.chart;
    if (chart === null) return nothing;
    return html`<p class="identity">
      Chart weights come from the ${chart.label} conversion chart, revision
      ${chart.source.revision}.
    </p>`;
  }

  #answer(): ConversionAnswer | null {
    const held = this.entry.entry;
    if (held === null) return null;
    return convertAgainstChart(entryWeight(held), this.chart);
  }

  #setEntry(entry: ConverterEntry): void {
    this.entry = entry;
    saveEntry(this.settings, entry);
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const field = node.dataset['field'];
      if (field === undefined) continue;
      this.#applyChoice(field, event.detail.value);
      return;
    }
  };

  /**
   * Applies one control's answer.
   *
   * Every value is checked against the list it came from rather than trusted.
   * `dataset` and a choice value are both strings out of the DOM, and the failure
   * of believing one is a stored preference the interface has no control for --
   * which reads back as a setting that silently will not stick.
   */
  #applyChoice(field: string, value: string): void {
    switch (field) {
      case DIRECTION_FIELD: {
        if (value !== 'lb-to-kg' && value !== 'kg-to-lb') return;
        const direction: ConversionDirection = value;
        this.#setEntry(setDirection(this.entry, direction));
        return;
      }
      case PRECISION_FIELD: {
        const places = Number(value);
        if (!RESULT_PRECISIONS.includes(places)) return;
        this.precision = places;
        this.settings.write(CONVERTER_PREFERENCES.precision, places);
        return;
      }
      case STEP_FIELD: {
        const step = Number(value);
        if (!CHART_STEPS.includes(step)) return;
        this.step = step;
        this.settings.write(CONVERTER_PREFERENCES.step, step);
        return;
      }
      case ORDER_FIELD: {
        if (value !== 'kilograms-first' && value !== 'pounds-first') return;
        this.order = value;
        this.settings.write(CONVERTER_PREFERENCES.order, value);
        return;
      }
      default:
        // The full chart's own search field and anything a child adds later.
        // Ignored rather than warned about: this listener sees every composed
        // event in the tree by design.
        return;
    }
  }

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const field = node.dataset['field'];
      if (field === undefined) continue;
      if (field === WEIGHT_FIELD) {
        this.#setEntry(typeInto(this.entry, event.detail.value));
      }
      return;
    }
  };

  readonly #onSelect = (event: CustomEvent<SelectWeightDetail>): void => {
    this.#setEntry(selectValue(this.entry, event.detail.amount));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-converter': PtkConverter;
  }
}
