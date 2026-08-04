// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * One line a person writes in their own words.
 *
 * The third member of the family, after `ptk-number-field` (one number) and
 * `ptk-text-area` (several lines). It exists because the collection had no way
 * to ask for a short piece of prose on one line, and the first thing that needed
 * one -- a lifter's name on the meet-day screen -- could not be asked with either
 * sibling: a numeric keypad is wrong for a name, and a three-row box whose Enter
 * key inserts a newline is wrong for an answer that is one line by definition.
 *
 * Every other tool in the collection wants the same control the moment it stores
 * anything a person names: the training logbook's session title, the roadmap's
 * goal, the meet-preparation checklist's event. Writing it three times is the
 * §5.8 fork -- three keyboards, three tap targets, three answers to the iOS zoom
 * question below.
 *
 * WHY IT IS NOT `ptk-text-area` WITH `rows="1"`
 *
 * A one-row textarea looks identical and behaves differently in the two places
 * that matter. Enter inserts a newline rather than committing, so the control
 * silently accepts a value its own contract calls one line; and the value can
 * then hold a character the caller never offered a way to type. §5.8 says widen
 * rather than fork when an element *nearly* fits -- a box whose defining feature
 * is that it holds several lines does not nearly fit an answer that must hold
 * one.
 *
 * WHAT IT DOES NOT DO
 *
 * It holds a string and reports a string, like every other control here. It does
 * not trim, does not validate, does not enforce a length, and has no opinion
 * about what belongs in it. Those are rules, and rules live in the tool or in
 * `packages/domain`.
 */

/** Fired as the visitor types. Never fired for a programmatic property set. */
export interface TextFieldChangeDetail {
  /** Exactly what is in the field, untrimmed. */
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const TEXT_FIELD_CHANGE_EVENT = 'ptk-text-field-change';

/**
 * How a soft keyboard should capitalise what is typed.
 *
 * A closed list rather than a passthrough of the HTML attribute, because the
 * attribute also accepts `characters`, which shouts, and `on`/`off`, which are
 * legacy spellings of two of these. Three values are the three real answers: a
 * person's name is `words`, a sentence is `sentences`, and an identifier somebody
 * has to type exactly is `none`.
 */
export type TextCapitalization = 'none' | 'sentences' | 'words';

/** Ids are scoped to the shadow root, so fixed strings are unique enough. */
const FIELD_ID = 'value';
const HINT_ID = 'hint';
const ERROR_ID = 'error';

@customElement('ptk-text-field')
export class PtkTextField extends LitElement {
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

    input {
      display: block;
      /*
       * The box-sizing is local and has to be: tokens.css sets it on a universal
       * selector, and a universal selector in a document stylesheet does not
       * cross a shadow boundary. Without the declaration the padding below is
       * added outside the hundred percent and the box is wider than its column
       * -- a sideways scroll on a phone, from a rule that reads as already
       * applied. Same note as ptk-text-area; same reason.
       */
      box-sizing: border-box;
      width: 100%;
      min-height: var(--ptk-tap-target-min);
      margin-top: var(--ptk-space-xs);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
      font-family: inherit;
      /*
       * Never below 16px, for ptk-number-field's reason: iOS Safari zooms the
       * page when a smaller field takes focus and the layout jumps under the
       * thumb that just tapped it. The max() is not belt-and-braces -- this is a
       * rem, and an embedding page is free to have shrunk the root font size.
       */
      font-size: max(var(--ptk-font-size-md), 16px);
      line-height: var(--ptk-line-height);
    }

    input.invalid {
      border-color: var(--ptk-color-negative);
    }

    input:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    input:disabled {
      background-color: var(--ptk-color-surface-sunken);
      color: var(--ptk-color-text-muted);
      cursor: not-allowed;
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

  /** What is in the field. A string, and it stays one. */
  @property({ type: String }) value = '';

  @property({ type: String }) placeholder = '';

  /** A standing note about what belongs here. Not a validation message. */
  @property({ type: String }) hint = '';

  /**
   * What is wrong with the current value, or empty for nothing.
   *
   * A description paired with `aria-invalid`, not a live region -- see
   * `ptk-number-field`, where the same choice is made for the same reason.
   */
  @property({ type: String }) error = '';

  /** See `TextCapitalization`. The default is the one that is never wrong twice. */
  @property({ type: String }) capitalize: TextCapitalization = 'sentences';

  /**
   * What the browser may fill in, as an HTML autocomplete token.
   *
   * Defaulted to `off` and opted into per field, which is the opposite of the
   * usual advice and is deliberate here: nothing in this collection is a sign-in
   * or a delivery address, so a browser offering a saved value is nearly always
   * offering it to the wrong box. The one field that wants it -- a person's name
   * -- says `name`, and says it because a lifter typing their own name into a
   * phone should not have to.
   */
  @property({ type: String }) autocomplete = 'off';

  @property({ type: Boolean, reflect: true }) disabled = false;

  override render(): TemplateResult {
    const invalid = this.error !== '';
    // Only ids that are actually rendered: a dangling `aria-describedby`
    // reference is silently dropped by some screen readers and read as the
    // literal id by others.
    const describedBy = [this.hint === '' ? null : HINT_ID, invalid ? ERROR_ID : null]
      .filter((id) => id !== null)
      .join(' ');

    return html`
      <label for=${FIELD_ID}>${this.label}</label>
      <input
        id=${FIELD_ID}
        type="text"
        class=${invalid ? 'invalid' : nothing}
        enterkeyhint="done"
        autocomplete=${this.autocomplete}
        autocapitalize=${this.capitalize}
        spellcheck="false"
        placeholder=${this.placeholder}
        aria-describedby=${describedBy === '' ? nothing : describedBy}
        aria-invalid=${invalid ? 'true' : 'false'}
        ?disabled=${this.disabled}
        .value=${this.value}
        @input=${this.#onInput}
      />
      ${this.hint === '' ? nothing : html`<p id=${HINT_ID} class="hint">${this.hint}</p>`}
      ${invalid ? html`<p id=${ERROR_ID} class="error">${this.error}</p>` : nothing}
    `;
  }

  readonly #onInput = (event: Event): void => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.value === this.value) {
      return;
    }
    // Adopted before the event is dispatched. Without it the property and the
    // field disagree, and the next render -- triggered by anything at all, and
    // on this element's first screen by a clock ticking four times a second --
    // writes the stale value back and deletes what the visitor just typed.
    this.value = field.value;
    this.dispatchEvent(
      new CustomEvent<TextFieldChangeDetail>(TEXT_FIELD_CHANGE_EVENT, {
        detail: { value: field.value },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-text-field': PtkTextField;
  }

  /** So a delegated listener gets the detail typed without an assertion. */
  interface HTMLElementEventMap {
    [TEXT_FIELD_CHANGE_EVENT]: CustomEvent<TextFieldChangeDetail>;
  }
}
