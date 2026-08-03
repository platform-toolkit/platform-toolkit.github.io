// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Several lines a person writes in their own words.
 *
 * `ptk-number-field`'s sibling, and deliberately here rather than in the tool
 * that needed it first. The meet-day planner wants it for §12.1's note beside a
 * recorded attempt -- what the referees said, what the bar felt like -- and the
 * training logbook wants the same box for a session note. Two of them would be
 * two fonts, two tap targets, and two answers to the iOS zoom question below.
 *
 * WHY IT IS NOT `ptk-number-field` WITH A FLAG
 *
 * A widened field would be one element answering to two keyboards
 * (`inputmode="decimal"` against free prose), two `enterkeyhint` values, two
 * autocapitalisation rules and two spellcheck settings -- and every one of those
 * is wrong for the other use. §5.8 says widen rather than fork when an element
 * *nearly* fits; nothing about a numeric keypad nearly fits a sentence.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not grow to fit its content. An auto-sizing box measures on every
 * keystroke and moves everything below it while a thumb is aiming at that, and
 * on the one screen this was built for the thing below is a button that records
 * a result. `rows` sets the height, the box scrolls, and nothing on the page
 * moves while somebody types.
 *
 * It holds a string and reports a string, like every other control here. It does
 * not trim, does not validate, and has no opinion about what belongs in it.
 */

/** Fired as the visitor types. Never fired for a programmatic property set. */
export interface TextAreaChangeDetail {
  /** Exactly what is in the box, untrimmed. */
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const TEXT_AREA_CHANGE_EVENT = 'ptk-text-change';

/** Ids are scoped to the shadow root, so fixed strings are unique enough. */
const FIELD_ID = 'value';
const HINT_ID = 'hint';
const ERROR_ID = 'error';

@customElement('ptk-text-area')
export class PtkTextArea extends LitElement {
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

    textarea {
      display: block;
      /*
       * A textarea's default width comes from its cols attribute, not from its
       * container, so without this it is a fixed twenty-character box that
       * overflows a 320px column rather than fitting it. (No backticks in a
       * comment inside a css template: they end the template and produce a pile
       * of syntax errors somewhere else.)
       *
       * The box-sizing is local and has to be: tokens.css sets it on a
       * universal selector, and a universal selector in a document stylesheet
       * does not cross a shadow boundary. Without the declaration the padding
       * below is added *outside* the hundred percent and the box is wider than
       * its column -- a sideways scroll on a phone, from a rule that reads as
       * already applied.
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
      /*
       * Vertical only. A textarea a visitor can drag wider than its column is a
       * sideways scroll on a phone that no layout rule can prevent (§5.7).
       */
      resize: vertical;
    }

    textarea.invalid {
      border-color: var(--ptk-color-negative);
    }

    textarea:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    textarea:disabled {
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

  /** The question. Becomes the box's accessible name, so it is not optional. */
  @property({ type: String }) label = '';

  /** What is in the box. A string, and it stays one. */
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

  /** How tall the box starts. It does not grow; see the note above. */
  @property({ type: Number }) rows = 3;

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
      <textarea
        id=${FIELD_ID}
        class=${invalid ? 'invalid' : nothing}
        rows=${this.rows}
        placeholder=${this.placeholder}
        aria-describedby=${describedBy === '' ? nothing : describedBy}
        aria-invalid=${invalid ? 'true' : 'false'}
        ?disabled=${this.disabled}
        .value=${this.value}
        @input=${this.#onInput}
      ></textarea>
      ${this.hint === '' ? nothing : html`<p id=${HINT_ID} class="hint">${this.hint}</p>`}
      ${invalid ? html`<p id=${ERROR_ID} class="error">${this.error}</p>` : nothing}
    `;
  }

  readonly #onInput = (event: Event): void => {
    const field = event.target;
    if (!(field instanceof HTMLTextAreaElement) || field.value === this.value) {
      return;
    }
    // Adopted before the event is dispatched. Without it the property and the
    // box disagree, and the next render -- triggered by anything at all, and on
    // this element's first screen by a clock ticking four times a second --
    // writes the stale value back and deletes what the visitor just typed.
    this.value = field.value;
    this.dispatchEvent(
      new CustomEvent<TextAreaChangeDetail>(TEXT_AREA_CHANGE_EVENT, {
        detail: { value: field.value },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-text-area': PtkTextArea;
  }

  /** So a delegated listener gets the detail typed without an assertion. */
  interface HTMLElementEventMap {
    [TEXT_AREA_CHANGE_EVENT]: CustomEvent<TextAreaChangeDetail>;
  }
}
