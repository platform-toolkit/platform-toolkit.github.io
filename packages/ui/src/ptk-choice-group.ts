// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * One question with a fixed set of answers, exactly one of which may be chosen.
 *
 * Every tool in this collection is mostly this element repeated: sex, equipment,
 * weight class, division, tested status. Making it shared chrome rather than
 * per-tool markup is what keeps a lifter's answers looking and behaving the same
 * on every screen, and keeps the accessibility work in one place instead of
 * five.
 *
 * It renders native `<fieldset>`, `<legend>`, and `<input type="radio">`. That is
 * a deliberate refusal of the usual custom `role="radiogroup"` implementation:
 * arrow-key navigation, the group's accessible name, the "3 of 7" announcement,
 * forced-colours rendering, and the browser's own focus behaviour all come free
 * and correct, and every hand-rolled version of them is a bug waiting for the
 * one screen reader nobody tested. Radios group by `name` within their tree, and
 * a shadow root is a tree, so two of these on a page cannot interfere.
 *
 * The element is presentation only. It holds no notion of a weight class or a
 * division, takes its options from the caller, and reports the identifier it was
 * given back. Anything that knows what an option *means* belongs in the tool.
 */

/** One answer. `value` is an identifier from the data, never something to show. */
export interface Choice {
  readonly value: string;
  readonly label: string;
  /** Optional second line: a weight range, an age band, a caveat. */
  readonly description?: string;
  /**
   * Available, but not one of the answers most visitors want.
   *
   * Drawn quieter than its neighbours and nothing else -- still a radio, still
   * in the same group, still reachable by the same arrow keys. Order alone does
   * not carry this: a list of five tiles reads as five equal answers whichever
   * way round they are, and the requirement being met here is a tool naming
   * three lifts as the expected answers while keeping two more available.
   *
   * Never use it to hide an option a visitor is likely to need. A quieter tile
   * is still measured against the tap-target floor and still has to pass
   * contrast, which is why this changes the border and the surface rather than
   * the text colour.
   */
  readonly secondary?: boolean;
}

/** Fired when the visitor picks an option. Never fired for a programmatic change. */
export interface ChoiceChangeDetail {
  readonly value: string;
}

/** Event name, exported so a listener cannot misspell it. */
export const CHOICE_CHANGE_EVENT = 'ptk-choice-change';

@customElement('ptk-choice-group')
export class PtkChoiceGroup extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    fieldset {
      /* A fieldset's default border and padding are inconsistent between
         engines, and the grouping is already conveyed to assistive technology
         by the element itself. Removing them changes nothing that is announced. */
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
     * A grid of equal columns, as many as fit, rather than a wrapping row.
     *
     * Wrapping put every option at its own intrinsic width, which on a phone
     * produced a ragged left-aligned column -- seventeen age divisions each a
     * different length, which is the hardest thing on this screen to scan and
     * the easiest to mis-tap. Equal tracks make the list a list.
     *
     * auto-fit is what makes this responsive without a media query: the column
     * count follows the element's own width, so a widget in a narrow sidebar on
     * a desktop page behaves like one on a phone, which is exactly what a
     * viewport query would get wrong. The min() around the track minimum is
     * load-bearing -- without it a container narrower than that minimum
     * overflows instead of collapsing to a single column.
     *
     * (No backticks in a comment inside this template: it is a tagged template
     * literal, and one would end it.)
     */
    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--options-min-width)), 1fr));
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-sm);
      --options-min-width: 7rem;
    }

    /*
     * Options carrying a second line need room for it before they are worth
     * splitting into columns. Set from the choices rather than by the caller:
     * whether a description exists is a fact about the data this element was
     * handed, not something a tool should have to remember to configure.
     */
    .options.described {
      --options-min-width: 13rem;
    }

    .option {
      /*
       * Grid rather than flex so the row can be centred inside a tile that is
       * taller than its contents. Baseline alignment keeps the radio on the
       * first line of text; centred align-content centres the pair when the
       * tap-target minimum makes the tile taller than they are.
       */
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

    /*
     * A quieter tile: a dashed border and the sunken surface, never dimmer text.
     * Lowering the text contrast is the obvious way to say "secondary" and it is
     * the one thing that must not happen -- the option stays fully readable and
     * fully selectable, it just stops competing with its neighbours.
     */
    .option.secondary {
      border-style: dashed;
      background-color: var(--ptk-color-surface-sunken);
    }

    /* The whole tile reacts to focus, because the radio itself is small and a
       ring around it alone is easy to lose against a wrapped row of options. */
    .option:has(input:focus-visible) {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    .option:has(input:checked) {
      border-color: var(--ptk-color-accent);
      background-color: var(--ptk-color-surface-raised);
    }

    /* Selection is carried by the radio's own checked state, which assistive
       technology reads and forced-colours mode renders. The border is decoration
       on top of that, never the only signal. */
    .option:has(input:disabled) {
      cursor: not-allowed;
      color: var(--ptk-color-text-muted);
      background-color: var(--ptk-color-surface-sunken);
    }

    .text {
      display: flex;
      flex-direction: column;
      /* The tile is a fixed grid track, so a long label wraps inside it rather
         than pushing the track wider and the row off the screen. */
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
   * The chosen value, or `null`.
   *
   * A value that is not among the choices selects nothing. That is the honest
   * rendering: when a lifter changes federation and their old weight class no
   * longer exists, quietly snapping to the nearest one would put a number on
   * screen that they never chose and would plan against.
   */
  @property({ type: String }) value: string | null = null;

  /** Shown in place of the options when there are none. */
  @property({ type: String, attribute: 'empty-message' }) emptyMessage = 'No options available.';

  @property({ type: Boolean, reflect: true }) disabled = false;

  /**
   * Distinguishes this group's radios from another's.
   *
   * Scoped to the shadow root, so it only has to be unique within one element
   * and a fixed string is enough.
   */
  readonly #groupName = 'ptk-choice';

  override render(): TemplateResult {
    // Any description, not every: one option with a second line makes the whole
    // row of tiles taller, so the width they need is set by the widest case.
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
      <label class=${choice.secondary === true ? 'option secondary' : 'option'}>
        <input
          type="radio"
          name=${this.#groupName}
          .value=${choice.value}
          .checked=${choice.value === this.value}
          @change=${() => {
            this.#choose(choice.value);
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

  #choose(value: string): void {
    if (value === this.value) {
      return;
    }
    this.value = value;
    this.dispatchEvent(
      // `composed` so a page listening on a container hears it: the event would
      // otherwise stop at the shadow boundary and the tool would look inert.
      new CustomEvent<ChoiceChangeDetail>(CHOICE_CHANGE_EVENT, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-choice-group': PtkChoiceGroup;
  }

  /**
   * So that a delegated listener gets the detail typed without a cast.
   *
   * A container listening for this event is the normal way to read several
   * groups at once, and `addEventListener` would otherwise hand back a bare
   * `Event`. The alternative every caller reaches for is `as CustomEvent<…>`,
   * which is an assertion that would keep compiling after the detail changed
   * shape.
   */
  interface HTMLElementEventMap {
    [CHOICE_CHANGE_EVENT]: CustomEvent<ChoiceChangeDetail>;
  }
}
