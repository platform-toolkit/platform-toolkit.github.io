// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { Choice } from './ptk-choice-group.js';

/**
 * One question with a fixed set of answers, any number of which may be chosen.
 *
 * The multi-select twin of `ptk-choice-group`, and it exists for the same
 * reason: a lifter's answers should look and behave the same on every screen,
 * and the accessibility work should live in one place. Which plate
 * denominations are on the rack is the first case; anything else that is a set
 * rather than a pick is the next.
 *
 * Native `<input type="checkbox">` inside a `<fieldset>`, for the reasons
 * `ptk-choice-group` gives for radios. A checkbox is not a radio with different
 * behaviour: it is announced differently, it is not arrow-key navigable as a
 * group, and it has no "3 of 7" position -- all of which the platform gets right
 * and a shared `role="group"` reimplementation would have to be told.
 *
 * The element holds no notion of what an option means. It takes `Choice[]` from
 * the caller and reports identifiers back.
 */

/** Which option changed, whether it is now selected, and the whole selection. */
export interface ToggleGroupChangeDetail {
  readonly value: string;
  readonly selected: boolean;
  /** The full selection afterwards, in the order the choices were given. */
  readonly values: readonly string[];
}

export const TOGGLE_GROUP_CHANGE_EVENT = 'ptk-toggle-change';

@customElement('ptk-toggle-group')
export class PtkToggleGroup extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
    }

    legend {
      padding: 0;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * The same intrinsic grid as the single-choice group, and the min() around
     * the track minimum is load-bearing for the same reason: without it a
     * container narrower than the track overflows instead of collapsing to one
     * column. The track is narrower here because these options are short --
     * a denomination is three characters and a unit.
     */
    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--options-min-width)), 1fr));
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-sm);
      --options-min-width: 5.5rem;
    }

    .options.described {
      --options-min-width: 13rem;
    }

    .option {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: baseline;
      align-content: center;
      gap: var(--ptk-space-sm);
      min-height: var(--ptk-tap-target-min);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
      cursor: pointer;
    }

    .option:has(input:focus-visible) {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    .option:has(input:checked) {
      border-color: var(--ptk-color-accent);
      background-color: var(--ptk-color-surface-raised);
    }

    .option:has(input:disabled) {
      cursor: not-allowed;
      color: var(--ptk-color-text-muted);
      background-color: var(--ptk-color-surface-sunken);
    }

    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .description {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .empty {
      margin: var(--ptk-space-sm) 0 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  /** The question. Becomes the group's accessible name, so it is not optional. */
  @property({ type: String }) label = '';

  @property({ attribute: false }) choices: readonly Choice[] = [];

  /**
   * The chosen values.
   *
   * A value that is not among the choices selects nothing and is left alone --
   * it is not silently dropped from the selection, because the caller may be
   * holding answers for a set of options it has not rendered yet.
   */
  @property({ attribute: false }) values: readonly string[] = [];

  @property({ type: String, attribute: 'empty-message' }) emptyMessage = 'No options available.';

  @property({ type: Boolean, reflect: true }) disabled = false;

  override render(): TemplateResult {
    const described = this.choices.some((choice) => choice.description !== undefined);
    return html`
      <fieldset ?disabled=${this.disabled}>
        <legend>${this.label}</legend>
        ${
          this.choices.length === 0
            ? html`<p class="empty">${this.emptyMessage}</p>`
            : html`<div class=${described ? 'options described' : 'options'}>
                ${this.choices.map((choice) => this.#renderChoice(choice))}
              </div>`
        }
      </fieldset>
    `;
  }

  #renderChoice(choice: Choice): TemplateResult {
    return html`
      <label class="option">
        <input
          type="checkbox"
          .value=${choice.value}
          .checked=${this.values.includes(choice.value)}
          @change=${(event: Event) => {
            this.#toggle(choice.value, event);
          }}
        />
        <span class="text">
          <span>${choice.label}</span>
          ${
            choice.description === undefined
              ? nothing
              : html`<span class="description">${choice.description}</span>`
          }
        </span>
      </label>
    `;
  }

  #toggle(value: string, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const selected = input.checked;

    /*
     * The selection is rebuilt in the order of the choices, not in the order
     * they were tapped. A caller comparing this list against a stored one -- to
     * decide whether anything changed, or to write it back -- would otherwise
     * see a different list every time the same set was reached by a different
     * route.
     */
    const chosen = new Set(this.values);
    if (selected) chosen.add(value);
    else chosen.delete(value);
    const values = this.choices
      .map((choice) => choice.value)
      .filter((candidate) => chosen.has(candidate));

    this.values = values;
    this.dispatchEvent(
      new CustomEvent<ToggleGroupChangeDetail>(TOGGLE_GROUP_CHANGE_EVENT, {
        detail: { value, selected, values },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-toggle-group': PtkToggleGroup;
  }

  interface HTMLElementEventMap {
    [TOGGLE_GROUP_CHANGE_EVENT]: CustomEvent<ToggleGroupChangeDetail>;
  }
}
