/**
 * The whole published chart, reproduced and searchable.
 *
 * Not generated. Every row here is a row the federation printed, and the tool has
 * no code path that can add one -- see `filterRowsByStep`, which selects from the
 * published rows and returns nothing else. A "chart" assembled by multiplying by
 * 2.2046 would look identical for most of its length and be wrong in exactly the
 * places that matter, because the federation rounds its own pound column and a
 * meet runs on the federation's figure.
 *
 * FOLDED BY DEFAULT, AND EMPTY WHILE FOLDED
 *
 * The chart is 180 rows. On the screen this collection is actually used on -- a
 * phone, at a rack -- an unfolded 180-row table is the whole page, and the answer
 * the visitor came for is above it. So it lives behind a disclosure whose summary
 * states the whole of what is true while closed: how many rows and what range.
 *
 * The body is not merely hidden while folded, it is not rendered. A copy button per
 * row means several hundred custom elements, and building them for a section
 * nobody opened is a measurable cost paid on a phone on one bar of signal.
 */
import {
  chartColumnFor,
  filterRowsByStep,
  formatWeight,
  nearestRowIndex,
  parseWeightInput,
  rowWeight,
  type ChartColumn,
  type ConversionChart,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { ConversionRow } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  CHART_STEPS,
  chartStepLabel,
  leadingUnit,
  weightProblem,
  type ChartStatus,
  type ColumnOrder,
} from './session.js';

/** How close a figure has to be to a published one to be called found rather than nearest. */
const FOUND_TOLERANCE = 1e-9;

@customElement('ptk-conversion-table')
export class PtkConversionTable extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .controls {
      display: grid;
      gap: var(--ptk-space-md);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      margin-bottom: var(--ptk-space-md);
    }

    .found {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      /* Fixed rather than auto so the two figure columns keep their width as the
         digits change down the chart. An auto table reflows every row when the
         pound column crosses a thousand, which on a phone reads as the page
         jumping under a thumb mid-scroll. */
      table-layout: fixed;
    }

    caption {
      margin-bottom: var(--ptk-space-sm);
      text-align: left;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    th,
    td {
      padding: 0.25rem var(--ptk-space-sm);
      text-align: right;
      border-bottom: 1px solid var(--ptk-color-border);
      /* Tabular figures so the columns line up down the page; a lifter scanning
         for a value is reading the shape of the number as much as the number. */
      font-variant-numeric: tabular-nums;
    }

    th {
      position: sticky;
      top: 0;
      background-color: var(--ptk-color-surface-raised);
      border-bottom-color: var(--ptk-color-border-strong);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * The copy column is sized from the button, not from a guess.
     *
     * It was 3.5rem, and a copy button with the shared inline padding is wider
     * than that -- so every row's button overflowed its own cell, centred, and
     * the right-hand half of that bleed hung off the end of the table. At 320px
     * that is a sideways scroll on the whole page, which §5.7 forbids, and the
     * amount by which it overflowed depended on how wide the platform's default
     * font drew the word "Copy": macOS landed a third of a pixel over and rounded
     * away, Linux landed six pixels over and failed. A layout whose correctness
     * turns on a font metric is a layout that passes locally and breaks in CI,
     * which is exactly what it did for seven consecutive deploys.
     *
     * So the button is given table-column padding through the custom property
     * ptk-button exposes for it, and the column is widened to leave real
     * headroom on top of the result rather than a rounding error. The button
     * keeps its 44px minimum on both axes -- the padding shrinks, the tap target
     * does not.
     */
    td.action,
    th.action {
      width: 5rem;
      text-align: center;
      padding-left: 0;
      padding-right: 0;
      --ptk-button-padding-inline: var(--ptk-space-xs);
    }

    tr[aria-current] td {
      background-color: var(--ptk-color-surface-sunken);
      /* A weight as well as a background: the highlight is the answer to a search
         and must survive forced colours, where the background is discarded. */
      font-weight: 700;
    }

    .source {
      margin: var(--ptk-space-md) 0 0;
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
     * that §5.7 requires while it stays there. Vertical padding on an inline box
     * does grow the hit area, but it does not grow the line, so the target ends
     * up overlapping the sentence above it and a thumb aimed at prose opens a new
     * tab. Lifting it out is the only version where the target is the size it
     * looks. This is also the first inline link in the collection; the hub's tool
     * links and the back link had already been widened for the same reason.
     */
    .source-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      /* The accent, matching tokens.css, which styles links at document level
         and therefore cannot reach inside a shadow root. The underline stays:
         colour is never the only signal that something is a link. */
      color: var(--ptk-color-accent);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    @media print {
      /* A closed section prints closed, which is correct -- somebody who wants the
         chart on paper opens it first. Once open, drop the sticky header so it does
         not reprint over the rows on every page. */
      th {
        position: static;
      }
    }
  `;

  @property({ attribute: false }) chart: ConversionChart | null = null;

  @property({ type: String, attribute: 'chart-status' }) chartStatus: ChartStatus = 'loading';

  /** Published kilograms per shown row. `0` means every published row. */
  @property({ type: Number }) step = 0;

  @property({ type: String }) order: ColumnOrder = 'kilograms-first';

  /**
   * Search text.
   *
   * Local rather than remembered, and deliberately so: a search is a question
   * asked once, and restoring one on the next visit would open the chart scrolled
   * to a weight the visitor has no memory of asking about.
   */
  @state() private search = '';

  @state() private open = false;

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    return html`<ptk-disclosure
      label="Full conversion chart"
      summary=${this.#summary()}
      ?open=${this.open}
      @ptk-disclosure-toggle=${(event: CustomEvent<{ open: boolean }>) => {
        this.open = event.detail.open;
      }}
    >
      ${this.open ? this.#renderBody() : nothing}
    </ptk-disclosure>`;
  }

  protected override updated(): void {
    this.#scrollToMatch();
  }

  /** What stays visible while the section is closed. Never a promise it cannot keep. */
  #summary(): string {
    const chart = this.chart;
    if (chart === null) {
      return this.chartStatus === 'loading'
        ? 'Loading the published chart.'
        : 'No published chart is available.';
    }
    const lightest = formatWeight(rowWeight(chart.lightest, 'kg'));
    const heaviest = formatWeight(rowWeight(chart.heaviest, 'kg'));
    return `${String(chart.rows.length)} published rows, ${lightest} to ${heaviest}.`;
  }

  #renderBody(): TemplateResult {
    const chart = this.chart;
    if (chart === null) {
      return this.chartStatus === 'failed'
        ? html`<ptk-notice tone="error"
            >The conversion chart could not be loaded. Reloading may help.</ptk-notice
          >`
        : html`<ptk-notice tone="info"
            >No conversion chart is published for this federation.</ptk-notice
          >`;
    }

    const rows = filterRowsByStep(chart.rows, this.step);
    const match = this.#matchIn(rows);

    return html`
      <div class="controls">
        <ptk-number-field
          data-field="search"
          label="Find a weight"
          .value=${this.search}
          hint=${`A bare number is read as ${leadingUnit(this.order) === 'kg' ? 'kilograms' : 'pounds'}. Add lb or kg to say which.`}
          error=${weightProblem(this.search) ?? ''}
          @ptk-number-change=${(event: CustomEvent<{ value: string }>) => {
            this.search = event.detail.value;
          }}
        ></ptk-number-field>
        <ptk-choice-group
          data-field="chart-step"
          label="Rows to show"
          .choices=${CHART_STEPS.map((step) => ({
            value: String(step),
            label: chartStepLabel(step),
          }))}
          value=${String(this.step)}
        ></ptk-choice-group>
        <ptk-choice-group
          data-field="column-order"
          label="Column order"
          .choices=${[
            { value: 'kilograms-first', label: 'Kilograms first' },
            { value: 'pounds-first', label: 'Pounds first' },
          ]}
          value=${this.order}
        ></ptk-choice-group>
      </div>
      ${match === null ? nothing : html`<p class="found">${this.#matchSentence(rows, match)}</p>`}
      ${this.#renderTable(rows, match)}
      <footer class="source">
        <a class="source-link" href=${chart.source.url} rel="noreferrer noopener" target="_blank"
          >${chart.source.label}</a
        >
        <p>
          Every value above is reproduced from that chart, revision ${chart.source.revision}, last
          checked on ${chart.source.verifiedOn}. This is not a universal conversion table and is not
          a ${chart.label} product.
        </p>
      </footer>
    `;
  }

  #renderTable(rows: readonly ConversionRow[], match: number | null): TemplateResult {
    // A tuple, not an array. Under `noUncheckedIndexedAccess` an array element is
    // `WeightUnit | undefined` even when the literal plainly has two entries, so an
    // array annotation here makes every use below need a guard for a case that
    // cannot happen.
    const [first, second]: readonly [WeightUnit, WeightUnit] =
      this.order === 'kilograms-first' ? ['kg', 'lb'] : ['lb', 'kg'];
    return html`<table>
      <caption>
        ${
          this.step === 0
            ? `Every published row, ${String(rows.length)} in total.`
            : `Published rows on every ${String(this.step)} kg, ${String(rows.length)} of ${String(this.chart?.rows.length ?? 0)}.`
        }
      </caption>
      <thead>
        <tr>
          <th scope="col">${unitHeading(first)}</th>
          <th scope="col">${unitHeading(second)}</th>
          <th scope="col" class="action"><span class="visually-hidden">Copy</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, index) => {
          const text = `${formatWeight(rowWeight(row, first))} = ${formatWeight(rowWeight(row, second))}`;
          return html`<tr aria-current=${index === match ? 'true' : nothing}>
            <td>${figureOf(row, first)}</td>
            <td>${figureOf(row, second)}</td>
            <td class="action">
              <ptk-copy-button
                variant="quiet"
                label="Copy"
                .text=${text}
                accessible-name=${`Copy ${text}`}
              ></ptk-copy-button>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  /**
   * The row the search names, as an index into the rows on screen.
   *
   * An index rather than a row because the next thing that happens to it is a
   * scroll, and a row object cannot say which element to scroll to. `null` covers
   * an empty box, text that does not parse, and a step filter that left nothing --
   * all three are "no row to point at" and none is an error.
   */
  #matchIn(rows: readonly ConversionRow[]): number | null {
    const parsed = parseWeightInput(this.search);
    if (!parsed.ok) return null;
    const unit = parsed.unit ?? leadingUnit(this.order);
    return nearestRowIndex(rows, parsed.amount, chartColumnFor(unit));
  }

  /**
   * What the search found, said precisely.
   *
   * "Nearest row" and "found" are different answers and the difference is the
   * whole point of the tool: 137 lb is not on the chart, and a sentence that said
   * it was would be the manufactured row this file exists to refuse.
   */
  #matchSentence(rows: readonly ConversionRow[], index: number): string {
    const row = rows[index];
    const parsed = parseWeightInput(this.search);
    if (row === undefined || !parsed.ok) return '';
    const unit = parsed.unit ?? leadingUnit(this.order);
    const column: ChartColumn = chartColumnFor(unit);
    const pair = `${formatWeight(rowWeight(row, 'kg'))} = ${formatWeight(rowWeight(row, 'lb'))}`;
    return Math.abs(row[column] - parsed.amount) <= FOUND_TOLERANCE
      ? `Found: ${pair}`
      : `Nearest published row: ${pair}`;
  }

  /**
   * Moves the found row into view.
   *
   * `block: 'nearest'` rather than `'center'` so a row already on screen does not
   * scroll at all -- typing a second digit should not jerk the page when the answer
   * has not moved.
   */
  #scrollToMatch(): void {
    const row = this.shadowRoot?.querySelector('tbody tr[aria-current]');
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** The column heading, spelled out. `kg` and `lb` are abbreviations, not names. */
function unitHeading(unit: WeightUnit): string {
  return unit === 'kg' ? 'Kilograms' : 'Pounds';
}

/**
 * One published figure, without its unit.
 *
 * The unit is in the column heading, and repeating it in three hundred and sixty
 * cells is what turns a two-column table into a sideways scroll at 320 px. The
 * copied text carries units, because copied text arrives somewhere with no heading
 * above it.
 */
function figureOf(row: ConversionRow, unit: WeightUnit): string {
  return String(row[chartColumnFor(unit)]);
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-conversion-table': PtkConversionTable;
  }
}
