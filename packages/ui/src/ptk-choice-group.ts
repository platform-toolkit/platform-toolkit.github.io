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

    .options {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-sm);
    }

    .option {
      display: flex;
      align-items: baseline;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
      cursor: pointer;
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
    return html`
      <fieldset ?disabled=${this.disabled}>
        <legend>${this.label}</legend>
        ${
          this.choices.length === 0
            ? html`<p class="empty">${this.emptyMessage}</p>`
            : html`<div class="options">
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
