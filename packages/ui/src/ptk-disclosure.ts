import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A section that folds away, with a summary line that stays visible.
 *
 * Every tool here has the same shape: a small amount of setup a lifter changes
 * once, and the answer they came for. On a phone the setup cannot sit above the
 * answer permanently -- the warm-up calculator's equipment section alone is a
 * unit, a bar, collars and nine plate denominations, which is a screenful before
 * a single number appears. So it folds, and the summary line is what makes that
 * safe: the whole of what a lifter has to check before trusting the numbers
 * below stays on screen while the controls do not.
 *
 * It wraps native `<details>` / `<summary>` for the same reason
 * `ptk-choice-group` wraps `<fieldset>`: the expanded state, the announcement,
 * keyboard operation, and find-in-page opening a collapsed section all come free
 * and correct, and every hand-rolled version of them misses one.
 */

/** Fired when the visitor opens or closes the section. */
export interface DisclosureToggleDetail {
  readonly open: boolean;
}

export const DISCLOSURE_TOGGLE_EVENT = 'ptk-disclosure-toggle';

@customElement('ptk-disclosure')
export class PtkDisclosure extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    details {
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    summary {
      display: flex;
      align-items: center;
      gap: var(--ptk-space-sm);
      min-height: var(--ptk-tap-target-min);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      cursor: pointer;
      /* The default marker is a few pixels wide and sits outside the padding on
         some engines, so the row's own chevron below is drawn instead. Removing
         it changes nothing that is announced -- the open state comes from the
         details element. */
      list-style: none;
    }

    summary::-webkit-details-marker {
      display: none;
    }

    summary:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: calc(var(--ptk-focus-ring-offset) * -1);
      border-radius: var(--ptk-radius-md);
    }

    .text {
      display: flex;
      flex-direction: column;
      /* So a long summary wraps inside the row instead of pushing the chevron
         off the end of a 320px screen. */
      min-width: 0;
      flex: 1;
    }

    .label {
      font-weight: 600;
    }

    .summary-line {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * A chevron drawn from a rotated border, not a character.
     *
     * A glyph would come from whichever font resolved it and change size between
     * platforms; a rotated square is the same shape everywhere and inherits the
     * text colour, so it survives forced colours.
     */
    .chevron {
      flex: none;
      width: 0.5rem;
      height: 0.5rem;
      margin-inline-end: var(--ptk-space-xs);
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: rotate(45deg);
      transition: transform 120ms ease;
    }

    details[open] .chevron {
      transform: rotate(-135deg);
    }

    .body {
      padding: 0 var(--ptk-space-md) var(--ptk-space-md);
    }
  `;

  /** The section's name. Becomes the accessible name of the toggle. */
  @property({ type: String }) label = '';

  /** The one line that stays visible when the section is closed. */
  @property({ type: String }) summary = '';

  @property({ type: Boolean, reflect: true }) open = false;

  /**
   * Puts focus on the toggle.
   *
   * For the case where something *else* on the page sends a visitor here -- a
   * link, a secondary action, a summary that says "add your lifts below". Setting
   * `open` alone expands a section somewhere off the bottom of a phone and leaves
   * focus where it was, so a keyboard user has to hunt for what just happened and
   * a screen reader is told nothing at all.
   *
   * The toggle rather than the first control inside, because the toggle is what
   * announces the state: a reader lands on "Add current lifts, expanded" and
   * knows both what opened and how to close it again. Focusing past it skips
   * that, and skips the section's own name.
   *
   * `focus()` on the host would be the tidier call and does nothing useful: this
   * element does not delegate focus, so the summary inside the shadow root has to
   * be reached directly. Silent when there is nothing to focus, which happens
   * only before the first render.
   */
  focusToggle(): void {
    this.shadowRoot?.querySelector('summary')?.focus();
  }

  override render(): TemplateResult {
    return html`
      <details
        ?open=${this.open}
        @toggle=${(event: Event) => {
          this.#toggled(event);
        }}
      >
        <summary>
          <span class="text">
            <span class="label">${this.label}</span>
            ${
              this.summary === ''
                ? nothing
                : html`<span class="summary-line">${this.summary}</span>`
            }
          </span>
          <span class="chevron" aria-hidden="true"></span>
        </summary>
        <div class="body"><slot></slot></div>
      </details>
    `;
  }

  #toggled(event: Event): void {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement) || details.open === this.open) {
      return;
    }
    this.open = details.open;
    this.dispatchEvent(
      new CustomEvent<DisclosureToggleDetail>(DISCLOSURE_TOGGLE_EVENT, {
        detail: { open: details.open },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-disclosure': PtkDisclosure;
  }

  interface HTMLElementEventMap {
    [DISCLOSURE_TOGGLE_EVENT]: CustomEvent<DisclosureToggleDetail>;
  }
}
