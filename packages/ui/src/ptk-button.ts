// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * The button every tool uses, wherever a tap does something.
 *
 * WHY THIS IS AN ELEMENT AND NOT A CLASS IN THE STYLESHEET
 *
 * A class would be the obvious answer and it does not work here. Every control
 * in this collection lives inside a shadow root, and the site's stylesheet does
 * not cross one -- so a `.button` rule in `styles.css` styles the hub's install
 * prompt and nothing inside any tool. The alternatives are a shared element or
 * the same forty lines of CSS copied into every component that has a button,
 * which is how the tap target ends up right in four places and wrong in the
 * fifth.
 *
 * It renders a real `<button>`. Enter and Space, the disabled state, the
 * accessible role, and forced-colours rendering all come from the platform;
 * every hand-rolled `role="button"` on a div loses at least one of them.
 *
 * THE LABEL IS SLOTTED, THE VARIANT IS AN ATTRIBUTE
 *
 * `<ptk-button>Add another lift</ptk-button>` puts the light-DOM text through a
 * slot, so it stays selectable, translatable, and searchable by the browser's
 * own find-in-page. A `label` property would render it inside the shadow root
 * where find-in-page reaches it in some engines and not others.
 */

/** How much attention the action deserves. Never the only signal of what it does. */
export type ButtonVariant =
  /** The one action a screen exists for. At most one per surface. */
  | 'primary'
  /** An ordinary action: add, edit, reset. The default. */
  | 'secondary'
  /** Chrome-level: remove a row, reorder, dismiss. Reads as text until touched. */
  | 'quiet';

@customElement('ptk-button')
export class PtkButton extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      /* Without this a long label does not wrap -- it widens the whole page.
         A form control is not sized like a div: Chromium gives a button a
         min-content inline size equal to its *max-content* size, so shrink-to-fit
         hands the host the full width of the label however narrow the column is,
         and the surplus becomes document scroll. It cost a deploy. "Use the
         calculated weights", inside three nested rem paddings, measured 227px in
         a 114px fold at 200% text and the warm-up page scrolled sideways on CI --
         and only on CI, because this machine's fonts are narrower. Capping the
         host is what turns the inner width declaration below from an intrinsic
         size into a definite one, which is what lets the words wrap.

         A maximum rather than a fixed width: a button should still be as wide as
         its label, which is most of them, and only stop at the column. */
      max-width: 100%;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--ptk-space-sm);
      width: 100%;
      /* A minimum on both axes, never a fixed size: a button whose label wraps
         at 320px has to grow, and a height would clip the second line. */
      min-height: var(--ptk-tap-target-min);
      min-width: var(--ptk-tap-target-min);
      /* The inline padding is a knob because a button in a dense table column is
         a different shape from a button on its own line, and there is no way to
         reach across the shadow boundary to say so. A custom property inherits
         through it; a part would let a caller restyle anything. The block
         padding is not a knob -- shrinking it is how the 44px floor above stops
         being reached by the content rather than by the minimum. */
      padding: var(--ptk-space-sm) var(--ptk-button-padding-inline, var(--ptk-space-md));
      border: 1px solid transparent;
      border-radius: var(--ptk-radius-sm);
      /* Buttons do not inherit the page font family, and 16px is the floor a
         control needs beside an input for the row to look like one row. */
      font: inherit;
      font-size: var(--ptk-font-size-md);
      font-weight: 600;
      line-height: var(--ptk-line-height);
      text-align: center;
      cursor: pointer;
    }

    button:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    button:disabled {
      cursor: not-allowed;
      /* Opacity rather than a muted colour, so the disabled state survives
         forced colours -- where the colours are replaced and the contrast
         between them is not this component's to choose. */
      opacity: 0.55;
    }

    :host([variant='primary']) button {
      background-color: var(--ptk-color-accent);
      color: var(--ptk-color-accent-text);
    }

    :host([variant='secondary']) button {
      border-color: var(--ptk-color-border-strong);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
    }

    :host([variant='quiet']) button {
      background-color: transparent;
      color: var(--ptk-color-accent);
      /* Underlined, because a quiet button on a card is otherwise a coloured
         word -- and colour alone is discarded under forced colours and lost to
         a reader who cannot separate the hues. */
      text-decoration: underline;
    }
  `;

  /** Reflected so the variant rules above can select on the host. */
  @property({ type: String, reflect: true }) variant: ButtonVariant = 'secondary';

  @property({ type: Boolean, reflect: true }) disabled = false;

  /**
   * An accessible name that replaces the slotted text.
   *
   * For the small controls a lift card is full of: "↑" is a fine thing to see
   * and a useless thing to hear. Empty -- the normal case, and the one to
   * prefer -- leaves the visible text as the name.
   *
   * Deliberately not called `ariaLabel`. That name already exists on every
   * element as a reflecting accessor, and a class field of the same name is the
   * one case where the decorator configuration this project uses produces a
   * property that appears to work and reflects to the wrong node.
   */
  @property({ type: String, attribute: 'accessible-name' }) accessibleName = '';

  /**
   * Whether the thing this button expands is currently open.
   *
   * `null` -- the default -- renders no attribute at all, because
   * `aria-expanded="false"` on a button that expands nothing announces a
   * collapsed section that does not exist.
   */
  @property({ type: Boolean }) expanded: boolean | null = null;

  override render(): TemplateResult {
    return html`
      <button
        type="button"
        ?disabled=${this.disabled}
        aria-label=${this.accessibleName === '' ? nothing : this.accessibleName}
        aria-expanded=${this.expanded === null ? nothing : String(this.expanded)}
      >
        <slot></slot>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-button': PtkButton;
  }
}
