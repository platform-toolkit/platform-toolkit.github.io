// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * One number a lifter types, with a unit beside it.
 *
 * Every tool in this collection needs this: a lifted total to read against
 * classification standards, a working weight to build warm-ups from, a set and
 * a rep count to estimate a maximum, a figure to convert. Making it shared
 * chrome is what keeps the keyboard, the tap target, and the error wiring the
 * same on all of them rather than four slightly different fields.
 *
 * The element is presentation only, in the same sense `ptk-choice-group` is: it
 * holds a string, reports the string back, and shows an error message the caller
 * hands it. It does not parse, does not know what a kilogram is, and has no
 * opinion about what makes a value valid -- all of which are rules, and rules
 * live in the tool or in `packages/domain`.
 *
 * TWO CHOICES HERE THAT LOOK LIKE MISTAKES AND ARE NOT
 *
 * `type="text"` with `inputmode="decimal"`, not `type="number"`. A number input
 * changes its value when a scroll wheel passes over it, and -- worse for this --
 * reports an empty string for anything the browser considers invalid, so a
 * lifter who typed `1o5` leaves the tool unable to show them what they typed or
 * say what is wrong with it. `inputmode` gets the numeric keypad on a phone,
 * which is the only part of `type="number"` actually wanted here.
 *
 * The value is a string and stays one. Parsing it into a number in this element
 * would mean deciding what to do with `12.` mid-keystroke, and every answer to
 * that either fights the caret or discards what the visitor typed.
 */

/** Fired as the visitor types. Never fired for a programmatic property set. */
export interface NumberFieldChangeDetail {
  /** Exactly what is in the field, untrimmed and unparsed. */
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const NUMBER_FIELD_CHANGE_EVENT = 'ptk-number-change';

/** Ids are scoped to the shadow root, so fixed strings are unique enough. */
const INPUT_ID = 'value';
const UNIT_ID = 'unit';
const HINT_ID = 'hint';
const ERROR_ID = 'error';

@customElement('ptk-number-field')
export class PtkNumberField extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    label {
      display: block;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * The border lives on the wrapper and the input fills it, rather than the
     * input carrying its own border with the unit floated beside it. That is
     * what makes a tap anywhere in the box -- including on the unit -- land on
     * the field, which at 320px is most of the row.
     */
    .box {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: stretch;
      margin-top: var(--ptk-space-xs);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .box.invalid {
      border-color: var(--ptk-color-negative);
    }

    /* The ring goes on the box, and the input's own is suppressed, or a focused
       field shows two of them nested one pixel apart. */
    .box:has(input:focus-visible) {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    input {
      min-width: 0;
      min-height: var(--ptk-tap-target-min);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 0;
      border-radius: inherit;
      background: none;
      color: var(--ptk-color-text);
      font-family: inherit;
      /*
       * Never below 16px. iOS Safari zooms the page when a smaller field takes
       * focus, and the layout jumps under the thumb that just tapped it. The
       * max() is not belt-and-braces: this is a rem, and an embedding page is
       * free to have shrunk the root font size.
       */
      font-size: max(var(--ptk-font-size-md), 16px);
      line-height: var(--ptk-line-height);
    }

    input:focus-visible {
      outline: none;
    }

    input:disabled {
      color: var(--ptk-color-text-muted);
      cursor: not-allowed;
    }

    .box:has(input:disabled) {
      background-color: var(--ptk-color-surface-sunken);
    }

    .unit {
      display: flex;
      align-items: center;
      padding-inline-end: var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-md);
    }

    .hint,
    .error {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
    }

    .hint {
      color: var(--ptk-color-text-muted);
    }

    .error {
      color: var(--ptk-color-negative);
    }
  `;

  /** The question. Becomes the field's accessible name, so it is not optional. */
  @property({ type: String }) label = '';

  /** What is in the field. A string, deliberately -- see the note above. */
  @property({ type: String }) value = '';

  /**
   * The unit, shown inside the box and read out as the field's description.
   *
   * A description rather than part of the name: "Squat, edit text, kg" is what
   * a screen reader should say, not "Squat kg, edit text". Empty means no unit,
   * which is the right shape for a rep count.
   */
  @property({ type: String }) unit = '';

  @property({ type: String }) placeholder = '';

  /** A standing note about what belongs here. Not a validation message. */
  @property({ type: String }) hint = '';

  /**
   * What is wrong with the current value, or empty for nothing.
   *
   * Rendered as a description and paired with `aria-invalid`, not as a live
   * region. This validates as the visitor types, and a live region would
   * announce a half-typed number as an error on every keystroke.
   */
  @property({ type: String }) error = '';

  @property({ type: Boolean, reflect: true }) disabled = false;

  override render(): TemplateResult {
    const invalid = this.error !== '';
    // Only ids that are actually rendered: a dangling `aria-describedby`
    // reference is silently dropped by some screen readers and read as the
    // literal id by others.
    const describedBy = [
      this.unit === '' ? null : UNIT_ID,
      this.hint === '' ? null : HINT_ID,
      invalid ? ERROR_ID : null,
    ]
      .filter((id) => id !== null)
      .join(' ');

    return html`
      <label for=${INPUT_ID}>${this.label}</label>
      <div class=${invalid ? 'box invalid' : 'box'}>
        <input
          id=${INPUT_ID}
          type="text"
          inputmode="decimal"
          enterkeyhint="done"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder=${this.placeholder}
          aria-describedby=${describedBy === '' ? nothing : describedBy}
          aria-invalid=${invalid ? 'true' : 'false'}
          ?disabled=${this.disabled}
          .value=${this.value}
          @input=${this.#onInput}
        />
        ${this.unit === '' ? nothing : html`<span id=${UNIT_ID} class="unit">${this.unit}</span>`}
      </div>
      ${this.hint === '' ? nothing : html`<p id=${HINT_ID} class="hint">${this.hint}</p>`}
      ${invalid ? html`<p id=${ERROR_ID} class="error">${this.error}</p>` : nothing}
    `;
  }

  readonly #onInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value === this.value) {
      return;
    }
    // Adopted before the event is dispatched. Without it the property and the
    // field disagree, and the next render -- triggered by anything at all --
    // sets the stale value back and deletes what the visitor just typed.
    this.value = input.value;
    this.dispatchEvent(
      new CustomEvent<NumberFieldChangeDetail>(NUMBER_FIELD_CHANGE_EVENT, {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-number-field': PtkNumberField;
  }

  /** So a delegated listener gets the detail typed without an assertion. */
  interface HTMLElementEventMap {
    [NUMBER_FIELD_CHANGE_EVENT]: CustomEvent<NumberFieldChangeDetail>;
  }
}
