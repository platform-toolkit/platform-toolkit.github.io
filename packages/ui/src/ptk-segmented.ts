// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { Choice } from './ptk-choice-group.js';

/**
 * One question with a few short answers, laid out as a single bar.
 *
 * `ptk-choice-group`'s compact sibling. The two answer the same kind of question
 * and are not interchangeable: a choice group draws a tile per option, with room
 * for a second line and a visible radio, and is the right control for a question
 * a lifter answers once -- sex, equipment, tested status. This is the right
 * control for a switch a lifter flips repeatedly while reading, where the tiles'
 * height is the thing standing between them and the numbers.
 *
 * The cases it exists for are navigation-shaped: which lift is on screen, which
 * family of targets, which unit is written first. Every one of them is a small
 * closed set of one-word answers that has to sit above the content without
 * pushing it off a phone.
 *
 * NATIVE RADIOS, FOR THE REASONS `ptk-choice-group` GIVES
 *
 * Same refusal of a hand-rolled `role="radiogroup"`, same free arrow-key
 * navigation, same group name from the legend, same "2 of 4" announcement. What
 * differs is only that the radio's own dot is not drawn -- the segment's fill is
 * -- and that is why the input is moved out of sight rather than removed: an
 * element with `display: none` is not focusable and reports no checked state, so
 * hiding it that way would trade the entire reason for using a radio for a
 * layout convenience.
 *
 * NOT A TAB LIST
 *
 * Deliberately. The ARIA tabs pattern brings obligations -- roving tabindex,
 * `aria-controls`, arrow keys that move selection but not focus, Home and End --
 * and a partial implementation of it is worse for a screen reader than no
 * implementation at all, because the announcement promises behaviour that is not
 * there. A radio group is honest about what it is, and the panel below is an
 * ordinary region with a heading.
 */

/** Fired when the visitor picks a segment. Never fired for a programmatic change. */
export interface SegmentedChangeDetail {
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const SEGMENTED_CHANGE_EVENT = 'ptk-segmented-change';

@customElement('ptk-segmented')
export class PtkSegmented extends LitElement {
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
      padding: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * Hidden from sight, not from the accessibility tree.
     *
     * The legend is the group's accessible name, so it cannot be dropped when a
     * heading beside the control already says the same thing to a sighted
     * reader. The usual clip rectangle rather than display:none, which would
     * take the name with it.
     */
    legend.hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    /*
     * Equal tracks that wrap, never a row that scrolls sideways.
     *
     * A scrolling tab strip hides its own last option, and at a rack the option
     * a lifter wants is as often the last as the first. Wrapping to two rows of
     * two on a 320px phone costs one line of height and hides nothing.
     *
     * auto-fit against this element's own width rather than the viewport's, so a
     * bar inside a narrow embed column behaves like one on a handset. The min()
     * is load-bearing: without it a container narrower than the track minimum
     * overflows instead of collapsing.
     */
    .segments {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr));
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-xs);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .segment {
      display: flex;
      align-items: center;
      justify-content: center;
      /* Positioned so the clipped radio inside resolves against this label
         rather than against whatever ancestor happens to be positioned. */
      position: relative;
      /* The comfortable floor, not the 44px minimum: this is a control a lifter
         hits repeatedly, one-handed, while reading. See tokens.css. */
      min-height: var(--ptk-tap-target-comfortable);
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border-radius: var(--ptk-radius-sm);
      color: var(--ptk-color-text);
      font-size: var(--ptk-font-size-md);
      text-align: center;
      cursor: pointer;
    }

    /* See the note on legend.hidden: out of sight, still focusable, still
       reporting its checked state. */
    .segment input {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .segment:has(input:focus-visible) {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: calc(-1 * var(--ptk-focus-ring-width));
    }

    /*
     * The selected segment differs by fill *and* by weight.
     *
     * Weight is the part that survives: a fill is discarded under forced colours
     * and is invisible to a reader who cannot separate the two hues, and which
     * lift is on screen is the single most consequential thing this bar says.
     * The checked radio underneath carries it for assistive technology; these
     * two carry it for everyone reading the pixels.
     */
    .segment:has(input:checked) {
      background-color: var(--ptk-color-accent);
      color: var(--ptk-color-accent-text);
      font-weight: 700;
    }

    .segment:has(input:disabled) {
      cursor: not-allowed;
      color: var(--ptk-color-text-muted);
    }

    /*
     * Forced colours throws the fill away, so the border comes back to say the
     * same thing. Inset, so a selected segment does not grow and shift its
     * neighbours the moment a reader turns high contrast on.
     */
    @media (forced-colors: active) {
      .segment:has(input:checked) {
        outline: 3px solid CanvasText;
        outline-offset: -3px;
      }
    }

    .empty {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  /** The question. Becomes the group's accessible name, so it is not optional. */
  @property({ type: String }) label = '';

  /**
   * Draw the legend off-screen.
   *
   * For the case where a heading immediately above already says it. The name
   * stays in the accessibility tree either way -- this only decides whether it
   * is also printed, and printing it twice is noise a sighted reader has to skip
   * past on every screen.
   */
  @property({ type: Boolean, attribute: 'hide-label' }) hideLabel = false;

  @property({ attribute: false }) choices: readonly Choice[] = [];

  /**
   * The chosen value, or `null`.
   *
   * A value that is not among the choices selects nothing, for the reason
   * `ptk-choice-group` gives: snapping to the nearest option would put a screen
   * in front of a lifter that they did not ask for and cannot tell they did not
   * ask for.
   */
  @property({ type: String }) value: string | null = null;

  /** Shown in place of the segments when there are none. */
  @property({ type: String, attribute: 'empty-message' }) emptyMessage = 'No options available.';

  @property({ type: Boolean, reflect: true }) disabled = false;

  /** Scoped to this shadow root, so a fixed string is unique enough. */
  readonly #groupName = 'ptk-segmented';

  override render(): TemplateResult {
    return html`
      <fieldset ?disabled=${this.disabled}>
        <legend class=${this.hideLabel ? 'hidden' : nothing}>${this.label}</legend>
        ${
          this.choices.length === 0
            ? html`<p class="empty">${this.emptyMessage}</p>`
            : html`<div class="segments">
                ${this.choices.map((choice) => this.#renderSegment(choice))}
              </div>`
        }
      </fieldset>
    `;
  }

  #renderSegment(choice: Choice): TemplateResult {
    return html`
      <label class="segment">
        <input
          type="radio"
          name=${this.#groupName}
          .value=${choice.value}
          .checked=${choice.value === this.value}
          @change=${() => {
            this.#choose(choice.value);
          }}
        />
        <span>${choice.label}</span>
      </label>
    `;
  }

  #choose(value: string): void {
    if (value === this.value) {
      return;
    }
    this.value = value;
    this.dispatchEvent(
      new CustomEvent<SegmentedChangeDetail>(SEGMENTED_CHANGE_EVENT, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-segmented': PtkSegmented;
  }

  /** So a delegated listener gets the detail typed without an assertion. */
  interface HTMLElementEventMap {
    [SEGMENTED_CHANGE_EVENT]: CustomEvent<SegmentedChangeDetail>;
  }
}
