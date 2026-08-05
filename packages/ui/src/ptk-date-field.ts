// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * One calendar day a person picks.
 *
 * The fourth member of the field family, after `ptk-number-field` (one number),
 * `ptk-text-area` (several lines) and `ptk-text-field` (one line). It exists
 * because the collection had no way at all to ask for a date, and the first thing
 * that needed one -- a qualifying window, and the day a lifter's result was set --
 * could not be asked with any sibling: a text field would have every tool writing
 * its own `YYYY-MM-DD` parser and its own error message, and a number field cannot
 * hold three numbers.
 *
 * Every other tool wants it the moment it records something that happened: the
 * training logbook's session date, the meet-preparation checklist's meet day, the
 * roadmap's target. Writing it four times is the section 5.8 fork -- four
 * keyboards, four tap targets, four answers to the iOS sizing question below.
 *
 * WHY A NATIVE `type="date"` AND NOT THREE SELECTS
 *
 * The native control is the only one that gets a phone's date wheel, the platform's
 * own locale ordering, and a keyboard-only path that already works. Three selects
 * would be nine tap targets to answer one question, would print month names this
 * project would have to translate, and would let somebody choose 31 February. The
 * cost is that the rendered *appearance* differs by browser, which is the one part
 * of a date that nobody needs to be consistent across machines.
 *
 * WHAT IT DOES NOT DO
 *
 * It holds a string in `YYYY-MM-DD` and reports one, like every other control here
 * reports what it holds. It does not parse to a `Date` -- section 5.5 forbids that
 * for a calendar day, and `new Date('1990-05-15')` is the previous day west of
 * Greenwich -- it does not compare two dates, and it has no opinion about whether
 * the day it holds is a sensible one. Those are rules, and rules live in the tool
 * or in `packages/domain`.
 */

/** Fired as the visitor picks. Never fired for a programmatic property set. */
export interface DateFieldChangeDetail {
  /**
   * The chosen day as `YYYY-MM-DD`, or the empty string for none.
   *
   * The empty string is what the browser reports for a partly-filled control -- a
   * month typed with no year yet -- and it is passed through rather than
   * suppressed, because a tool watching for the field to be cleared has no other
   * way to hear it.
   */
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const DATE_FIELD_CHANGE_EVENT = 'ptk-date-field-change';

/** Ids are scoped to the shadow root, so fixed strings are unique enough. */
const FIELD_ID = 'value';
const HINT_ID = 'hint';
const ERROR_ID = 'error';

@customElement('ptk-date-field')
export class PtkDateField extends LitElement {
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
       * Local, and it has to be: tokens.css sets box-sizing on a universal
       * selector, and a universal selector in a document stylesheet does not
       * cross a shadow boundary. Without the declaration the padding is added
       * outside the hundred percent and the box is wider than its column -- a
       * sideways scroll on a phone, from a rule that reads as already applied.
       * Same note as ptk-text-field; same reason.
       */
      box-sizing: border-box;
      width: 100%;
      /*
       * Inert at today's token values and stated anyway. Measured in Chromium:
       * 24px of line box, 8px of padding either side and the border come to
       * exactly 44, so removing this changes nothing any assertion can see --
       * the mutation survives and is documented rather than faked. It is here
       * for the day somebody tightens --ptk-space-sm, which is a change nobody
       * would otherwise connect to a date field becoming harder to hit. Do not
       * read it as the reason the box currently clears the floor.
       */
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
       * iOS Safari gives a date input an intrinsic width of its own and ignores
       * the width above until the platform styling is off, so without this the
       * field is a short box floating in a full-width column on exactly the
       * device this collection is designed for first.
       *
       * Unproven here, and knowingly so: Chromium honours the width without it,
       * so the mutation that removes these two lines passes every test in this
       * suite. The browser the declaration is for is not the browser the suite
       * runs in, and the end-to-end pass over the built site is where it would
       * be caught. Do not delete it on the strength of a green run.
       */
      -webkit-appearance: none;
      appearance: none;
    }

    /*
     * And then iOS centres the text inside the box it just stopped sizing. The
     * pseudo-element is WebKit-only and inert everywhere else, which is why it is
     * safe to state unconditionally.
     */
    input::-webkit-date-and-time-value {
      text-align: left;
    }

    /*
     * The picker glyph is the only affordance saying this is not a text box, and
     * the browser draws it near-black whatever the page is doing -- invisible on a
     * dark surface. The inversion is a token rather than a media query here
     * because a forced theme is an attribute on the root and a media query inside
     * a shadow root cannot see it; custom properties inherit across the boundary
     * and are the only thing that can. The fallback is the light-mode value, so
     * only the dark blocks in tokens.css declare the token at all.
     */
    input::-webkit-calendar-picker-indicator {
      filter: var(--ptk-date-picker-indicator-filter, none);
      cursor: pointer;
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

  /**
   * The chosen day as `YYYY-MM-DD`, or the empty string for none.
   *
   * A string, and it stays one, for the reason the file note gives: a `Date` is an
   * instant and this is a day, and the conversion between them is wrong by up to a
   * day depending on where the reader is standing.
   */
  @property({ type: String }) value = '';

  /**
   * The earliest day the control offers, as `YYYY-MM-DD`. Empty for no floor.
   *
   * Passed to the native control so its own picker greys the rest out, which is
   * worth far more than an error message after the fact. It is **not** enforcement
   * -- a value set through the property is shown whatever these say, and the
   * browser's own validity state is deliberately not read here, because a tool that
   * needs a rule about dates has one and this element must not have a second.
   */
  @property({ type: String }) min = '';

  /** The latest day the control offers, as `YYYY-MM-DD`. Empty for no ceiling. */
  @property({ type: String }) max = '';

  /** A standing note about what belongs here. Not a validation message. */
  @property({ type: String }) hint = '';

  /**
   * What is wrong with the current value, or empty for nothing.
   *
   * A description paired with `aria-invalid`, not a live region -- see
   * `ptk-number-field`, where the same choice is made for the same reason.
   */
  @property({ type: String }) error = '';

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
        type="date"
        class=${invalid ? 'invalid' : nothing}
        min=${this.min === '' ? nothing : this.min}
        max=${this.max === '' ? nothing : this.max}
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
    // field disagree, and the next render -- triggered by anything at all --
    // writes the stale value back and clears the day the visitor just chose. It
    // bites harder here than on a text field: a date control's own value setter
    // refuses anything that is not a full `YYYY-MM-DD`, so the stale write does
    // not merely rewind the field, it empties it.
    this.value = field.value;
    this.dispatchEvent(
      new CustomEvent<DateFieldChangeDetail>(DATE_FIELD_CHANGE_EVENT, {
        detail: { value: field.value },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-date-field': PtkDateField;
  }

  /** So a delegated listener gets the detail typed without an assertion. */
  interface HTMLElementEventMap {
    [DATE_FIELD_CHANGE_EVENT]: CustomEvent<DateFieldChangeDetail>;
  }
}
