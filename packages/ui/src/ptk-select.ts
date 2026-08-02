import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * One question with a long list of answers, at most one of which may be chosen.
 *
 * {@link PtkChoiceGroup}'s sibling, and the two are not interchangeable. A group
 * of tiles is the better control right up to the point where the list stops
 * being scannable: five equipment categories read at a glance, and fifty states
 * do not -- they become a wall a lifter scrolls past to reach the thing they came
 * for. The screen this was built for asks for a state and an age division on the
 * same page as five short questions, and the two long lists were most of it.
 *
 * So: a native `<select>`, for the same reason `ptk-choice-group` renders native
 * radios. On a phone it opens the platform's own picker -- a spinner on iOS, a
 * full-screen list on Android -- which is a better long-list interaction than
 * anything that could be built here, is already familiar, and comes with type-
 * ahead, keyboard support and forced-colours rendering for free. Every custom
 * listbox is a reimplementation of that with a subset of its behaviour.
 *
 * The element is presentation only. It holds no notion of a state or a division,
 * takes its options from the caller, and reports the identifier it was given
 * back. Anything that knows what an option *means* belongs in the tool.
 */

/** One answer. `value` is an identifier from the data, never something to show. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /**
   * A heading to file this option under.
   *
   * Rendered as an `<optgroup>`, which is the one piece of structure a native
   * select offers and the reason a long list can stay one control: eighteen age
   * divisions are unreadable as a flat list and obvious under "Juniors" and
   * "Masters". Options are grouped in the order they first appear, so a caller
   * that hands them over already sorted gets what it asked for; interleaving two
   * groups would otherwise silently produce two headings with the same name,
   * which no engine renders as one.
   */
  readonly group?: string;
}

/** Fired when the visitor picks an option, including when they clear it. */
export interface SelectChangeDetail {
  /** `null` when the visitor chose the placeholder. */
  readonly value: string | null;
}

/** Event name, exported so a listener cannot misspell it. */
export const SELECT_CHANGE_EVENT = 'ptk-select-change';

/**
 * The value of the placeholder option in the DOM.
 *
 * The empty string, because a `<select>` option's value is a string and there is
 * no null to give it. Kept as a named constant used by both the template and the
 * change handler rather than written twice: the two spellings are the same typo
 * in two places, and the symptom would be a control that visibly clears while
 * the tool records the empty string as somebody's state.
 */
const PLACEHOLDER_VALUE = '';

@customElement('ptk-select')
export class PtkSelect extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
    }

    label {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .hint {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    select {
      /*
       * Never below 1rem. iOS Safari zooms the page when a control smaller than
       * 16px takes focus, and the layout jumps under the thumb that tapped it.
       */
      font-size: var(--ptk-font-size-md);
      font-family: inherit;
      min-height: var(--ptk-tap-target-min);
      /* Right padding leaves room for the engine's own disclosure arrow, which
         is drawn inside the control's box and would otherwise sit on the text. */
      padding: var(--ptk-space-sm) var(--ptk-space-xl) var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
      /* No color-scheme declaration here on purpose. It is an inherited
         property, tokens.css already sets it on the root for all three theme
         modes, and inheritance follows the flat tree into a shadow root -- so
         the popup the engine paints is themed without this element saying
         anything. A local declaration is the only thing that could disagree
         with the page. (No backticks in a comment inside a css template: they
         end the template and produce thirty syntax errors somewhere else.) */
      /* No appearance reset: the engine's arrow is the affordance that says this
         opens a list, and drawing a replacement means drawing it for every
         platform and every forced-colours mode. */
      width: 100%;
      /* A long option must not widen the control past its container. */
      max-width: 100%;
      box-sizing: border-box;
      cursor: pointer;
    }

    select:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    select:disabled {
      cursor: not-allowed;
      color: var(--ptk-color-text-muted);
      background-color: var(--ptk-color-surface-sunken);
    }

    /*
     * The placeholder reads as an absence, and the chosen value reads as an
     * answer. Applied to the control rather than to the option, because an
     * option's colour is ignored by most engines' native pickers.
     */
    select.unset {
      color: var(--ptk-color-text-muted);
    }

    .empty {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  /** The question. Becomes the control's accessible name, so it is not optional. */
  @property({ type: String }) label = '';

  @property({ attribute: false }) options: readonly SelectOption[] = [];

  /**
   * The chosen value, or `null` for none.
   *
   * A value that is not among the options selects nothing, the same rule
   * `ptk-choice-group` follows: when a lifter changes federation and their old
   * division no longer exists, quietly snapping to the first one would put an
   * answer on screen that they never gave and would plan against.
   */
  @property({ type: String }) value: string | null = null;

  /**
   * The label of the option that means "no answer".
   *
   * Always rendered, and always selectable, which is what makes every one of
   * these clearable. That is deliberate rather than an option: a native select
   * has no empty state of its own, so a control without this shows its first
   * option as though the visitor had picked it. For a question the tool requires
   * an answer to, going back to the placeholder is a real state -- unanswered --
   * and the tool renders it as such rather than the control refusing it.
   */
  @property({ type: String }) placeholder = 'Not selected';

  /** An optional second line under the label: what the answer is used for. */
  @property({ type: String }) hint = '';

  /** Shown in place of the control when there are no options. */
  @property({ type: String, attribute: 'empty-message' }) emptyMessage = 'No options available.';

  @property({ type: Boolean, reflect: true }) disabled = false;

  override render(): TemplateResult {
    // The hint is a description rather than part of the name: "State, combo box,
    // adds state records to the report", not "State adds state records to the
    // report, combo box". Only wired up when there is one, because an
    // `aria-describedby` pointing at nothing is announced as nothing by some
    // engines and as the literal id by others.
    const describedBy = this.hint === '' ? undefined : 'hint';

    return html`
      <div class="field">
        <label for="control">${this.label}</label>
        ${this.hint === '' ? nothing : html`<span class="hint" id="hint">${this.hint}</span>`}
        ${
          this.options.length === 0
            ? html`<p class="empty">${this.emptyMessage}</p>`
            : html`<select
                id="control"
                class=${this.#chosen() === null ? 'unset' : nothing}
                ?disabled=${this.disabled}
                aria-describedby=${describedBy ?? nothing}
                @change=${this.#onChange}
              >
                <option value=${PLACEHOLDER_VALUE}>${this.placeholder}</option>
                ${this.#renderOptions()}
              </select>`
        }
      </div>
    `;
  }

  /**
   * Selects the chosen option, after the options themselves exist.
   *
   * Not a `.value` binding in the template, which is the obvious way and does
   * not work: lit-html commits an element's own bindings before it creates that
   * element's children, so on first render the property is assigned to a
   * `<select>` holding nothing but the placeholder. A select silently refuses a
   * value it has no option for and keeps the one it has, so the control paints
   * as unanswered while `this.value` says otherwise -- and it self-corrects on
   * the next render, which is why it survives most manual testing and shows up
   * as a restored selection that is briefly, or permanently, not there.
   */
  protected override updated(): void {
    const select = this.shadowRoot?.querySelector('select');
    if (select === null || select === undefined) {
      return;
    }
    select.value = this.#chosen() ?? PLACEHOLDER_VALUE;
  }

  /**
   * The value if the options actually offer it, and `null` if they do not.
   *
   * A value with no option would leave the control showing whatever the engine
   * fell back to, which is the first option -- an answer nobody gave.
   */
  #chosen(): string | null {
    return this.options.some((option) => option.value === this.value) ? this.value : null;
  }

  /**
   * The options, with every grouped run under its own heading.
   *
   * Grouped by first appearance rather than sorted, so the caller's order is the
   * order on screen -- a division list runs Juniors then Masters because that is
   * how it was handed over, not because of how the strings compare.
   */
  #renderOptions(): readonly TemplateResult[] {
    const groups: { name: string | undefined; options: SelectOption[] }[] = [];
    for (const option of this.options) {
      const last = groups.at(-1);
      if (last !== undefined && last.name === option.group) {
        last.options.push(option);
      } else {
        groups.push({ name: option.group, options: [option] });
      }
    }

    return groups.map((group) => {
      const options = group.options.map(
        (option) => html`<option value=${option.value}>${option.label}</option>`,
      );
      return group.name === undefined
        ? html`${options}`
        : html`<optgroup label=${group.name}>${options}</optgroup>`;
    });
  }

  #onChange(event: Event): void {
    const { currentTarget } = event;
    // Narrowed rather than asserted: the listener is bound to the select in this
    // element's own template, so the cast would be correct today and would keep
    // compiling if it ever moved.
    if (!(currentTarget instanceof HTMLSelectElement)) {
      return;
    }

    // Adopt the control's value before dispatching. Without this the property
    // and the field disagree, and the next render -- triggered by anything at
    // all -- writes the stale value back and undoes the visitor's choice.
    const value = currentTarget.value === PLACEHOLDER_VALUE ? null : currentTarget.value;
    if (value === this.value) {
      return;
    }
    this.value = value;

    this.dispatchEvent(
      // `composed` so a page listening on a container hears it: the event would
      // otherwise stop at the shadow boundary and the tool would look inert.
      new CustomEvent<SelectChangeDetail>(SELECT_CHANGE_EVENT, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-select': PtkSelect;
  }

  /**
   * So that a delegated listener gets the detail typed without a cast.
   *
   * See the note on `ptk-choice-group`: a container reading several controls at
   * once is the normal shape here, and `addEventListener` would otherwise hand
   * back a bare `Event` that every caller narrows with an assertion.
   */
  interface HTMLElementEventMap {
    [SELECT_CHANGE_EVENT]: CustomEvent<SelectChangeDetail>;
  }
}
