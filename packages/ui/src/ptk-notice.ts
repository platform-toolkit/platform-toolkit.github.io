import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A sentence a tool says instead of showing content.
 *
 * Every screen in this collection reads published data over a network, so every
 * screen has the same four things to say and only one of them is the content:
 * still fetching, nothing published for this, the read failed, and here it is.
 * The first three are what this element is for. Each tool having its own
 * paragraph for them is how "could not be loaded" ends up rendered in the same
 * muted grey as "loading" -- which is what happened here before this existed,
 * and which is a real difference to a reader, not a styling detail.
 *
 * WHY IT IS AN ELEMENT AND NOT A CLASS NAME
 *
 * Shadow DOM. A `.notice` rule in `tokens.css` cannot reach inside a tool's
 * shadow root, so the alternative to an element is the same five declarations
 * copied into every component that has a loading state -- which is four tools
 * from now a set of five that have quietly drifted apart. Tools 2, 3 and 4 all
 * load data and all need this.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It is not a live region. Whether an announcement is right depends on what the
 * notice replaced and whether the element survived the swap, and both are facts
 * only the tool has -- a live region that is *inserted* rather than updated is
 * announced by some assistive technology and not others, so guessing here would
 * be wrong in a way that is invisible in every manual test. A tool that needs an
 * announcement keeps its own `role="status"` line, as `ptk-target-categories`
 * does for the questions still outstanding.
 *
 * It also carries no icon. An icon that is not text is one more thing to
 * translate, and the tone is already carried by the wording.
 */

/** How much of a problem this is. */
export type NoticeTone = 'info' | 'error';

@customElement('ptk-notice')
export class PtkNotice extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    p {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-md);
      line-height: var(--ptk-line-height);
    }

    /*
     * Colour and a rule down the side, not colour alone. The distinction has to
     * survive a forced-colours mode and a reader who cannot tell the two hues
     * apart, and a border is the cheapest thing that does both.
     */
    :host([tone='error']) p {
      padding-inline-start: var(--ptk-space-md);
      border-inline-start: 3px solid var(--ptk-color-negative);
      color: var(--ptk-color-negative);
    }
  `;

  /** Reflected, because the styling above selects on the host attribute. */
  @property({ type: String, reflect: true }) tone: NoticeTone = 'info';

  override render(): TemplateResult {
    return html`<p><slot></slot></p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-notice': PtkNotice;
  }
}
