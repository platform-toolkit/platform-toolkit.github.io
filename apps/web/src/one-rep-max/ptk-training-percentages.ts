// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The percentage table, and nothing said about what any row is for.
 *
 * §9.3 in one sentence: rows from 100% down to 50%, every load rounded to a step
 * the bar actually takes, and **no row labelled**. Ninety percent is not a
 * training max and eighty is not a working set -- those are programme decisions
 * belonging to whoever wrote the programme, and a label here would turn a
 * reference table into a prescription issued by a calculator that has never seen
 * the lifter.
 *
 * THE STEP HAS TO MATCH THE HEADLINE
 *
 * The estimate handed in must already be rounded, and `roundTo` must be the step
 * it was rounded to. Every row floors to that step, so a coarser one puts the
 * hundred percent row *below* the figure printed above it -- two numbers on one
 * screen that should be identical and are not, which reads as an arithmetic bug
 * in the tool rather than as a rounding choice.
 */
import { formatWeight, trainingPercentages, type Weight } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { percentageStepChoices } from './copy.js';
import { PERCENTAGE_STEP_FIELD } from './fields.js';

@customElement('ptk-training-percentages')
export class PtkTrainingPercentages extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .controls {
      margin-bottom: var(--ptk-space-md);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    caption {
      margin-bottom: var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      text-align: left;
    }

    th,
    td {
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      text-align: left;
      border-bottom: 1px solid var(--ptk-color-border);
      /*
       * A table sizes itself to the longest unbreakable word in each column and
       * then ignores the 100% above, so one word decides whether this fits. At
       * 200% text the word is the uppercase, letter-spaced "Percent" heading:
       * 349px of table in a 223px column, scrolling sideways with no scrollbar
       * to say so. Breaking a word is ugly; putting it off the edge of a phone
       * belonging to a reader who doubled their text is worse.
       *
       * Deliberately anywhere and not break-word. Only anywhere is counted in
       * min-content, and min-content is the number the table is sizing itself
       * from -- break-word here would leave the overflow exactly as it is.
       */
      overflow-wrap: anywhere;
    }

    th {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * Two columns of numbers is the one table shape that survives 320 px without
     * scrolling sideways, which is why this is a table and the formula
     * comparison is not. The row still gets the tap-target height, because a
     * thumb lands on a row whether or not anything happens when it does.
     */
    tbody th,
    tbody td {
      height: var(--ptk-tap-target-min);
      font-variant-numeric: tabular-nums;
    }

    tbody th {
      font-size: var(--ptk-font-size-md);
      color: var(--ptk-color-text);
      text-transform: none;
      letter-spacing: normal;
      font-weight: 600;
    }
  `;

  /** The already-rounded headline figure, or `null` when there is not one. */
  @property({ attribute: false }) estimate: Weight | null = null;

  /** The gap between rows, in whole percent. */
  @property({ type: Number }) step = 5;

  /** The step the headline figure was rounded to. Every row floors to it. */
  @property({ type: Number, attribute: 'round-to' }) roundTo = 0.5;

  override render(): TemplateResult | typeof nothing {
    const estimate = this.estimate;
    if (estimate === null) return nothing;
    const rows = trainingPercentages(estimate, { step: this.step, roundTo: this.roundTo });
    return html`
      <ptk-disclosure
        label="Training percentages"
        summary=${`Loads from 100% down to 50% of ${formatWeight(estimate)}, each rounded down to ${String(this.roundTo)} ${estimate.unit}.`}
      >
        <div class="controls">
          <ptk-choice-group
            data-field=${PERCENTAGE_STEP_FIELD}
            label="Rows every"
            .choices=${percentageStepChoices()}
            .value=${String(this.step)}
          ></ptk-choice-group>
        </div>
        <table>
          <caption>
            Percentages of the estimate. What any of them is for is a programming decision this tool
            does not make.
          </caption>
          <thead>
            <tr>
              <th scope="col">Percent</th>
              <th scope="col">Load</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) =>
                html`<tr>
                  <th scope="row">${String(row.percent)}%</th>
                  <td>${formatWeight(row.load)}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </ptk-disclosure>
    `;
  }

  /** Lit settles before the disclosure and the step chooser have rendered (§5.8). */
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
    'ptk-training-percentages': PtkTrainingPercentages;
  }
}
