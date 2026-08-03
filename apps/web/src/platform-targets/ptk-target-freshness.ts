// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One line at the foot of the tool saying how old the figures above it are.
 *
 * The 2026-08-02 review puts "data date, method, source, disclaimer" last in the
 * canonical phone order, and it is last for a reason: it is the answer to a
 * question a reader asks *after* reading a number, not before. So this is a
 * footnote and is drawn as one -- muted, small, and never in the way of the
 * matrices.
 *
 * WHY IT IS AN ELEMENT AND NOT A PARAGRAPH IN THE ROOT
 *
 * Four states, one of which is an error with an action attached, and each of them
 * has to be seen at 320 px before it ships. An element can be storied; a branch
 * inside a 700-line composition root cannot, and the state that would go unlooked
 * at is the offline one -- the state that only ever happens where nobody is
 * watching.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not decide anything. `freshness.ts` reads the published index and
 * returns the sentence; this places it. The split is what makes "offline with a
 * stale publisher" a test rather than a screenshot, and it is why this file
 * cannot invent a date -- it has no access to one.
 *
 * The retry is offered here only for the offline-with-nothing state, because that
 * is the only state the footer describes where trying again could change
 * anything. A failed read of one record partition is offered its own "Try again"
 * beside the notice that reports it, where the reader is already looking.
 */
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  REFRESH_REQUEST_EVENT,
  readFreshness,
  type Connection,
  type DataMetaStatus,
} from './freshness.js';
import type { DataMeta } from '@platform-toolkit/data-contracts';

@customElement('ptk-target-freshness')
export class PtkTargetFreshness extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * A footnote, with a rule above it because it belongs to the whole tool
     * rather than to the panel it happens to follow.
     *
     * (No backticks in this comment: they would end the css template -- see the
     * gotcha in CLAUDE.md 5.8.)
     */
    .line {
      margin: 0;
      padding-block-start: var(--ptk-space-md);
      border-block-start: 1px solid var(--ptk-color-border);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * Caution and error are full-strength text, not a colour swap. A muted
     * sentence saying the data is a week old is a sentence sized like a
     * disclaimer, and a reader skims it exactly as they skim a disclaimer.
     */
    .line[data-tone='caution'],
    .line[data-tone='error'] {
      color: var(--ptk-color-text);
      font-weight: 600;
    }

    .retry {
      display: block;
      margin-block-start: var(--ptk-space-sm);
    }
  `;

  /*
   * Every input is a property with no attribute, deliberately. Nothing writes
   * this element in markup -- the composition root is the only caller -- and an
   * attribute would be a second spelling of each name that a template could set
   * without the compiler having an opinion.
   */
  @property({ attribute: false }) connection: Connection = 'online';

  @property({ attribute: false }) meta: DataMeta | null = null;

  @property({ attribute: false }) metaStatus: DataMetaStatus = 'loading';

  /** Whether any published figure is on screen. See {@link readFreshness}. */
  @property({ attribute: false }) showingData = false;

  /** What the federation calls itself, once the catalogue has said. */
  @property({ attribute: false }) federationLabel: string | null = null;

  override render(): TemplateResult | typeof nothing {
    const freshness = readFreshness({
      connection: this.connection,
      meta: this.meta,
      metaStatus: this.metaStatus,
      showingData: this.showingData,
      federationLabel: this.federationLabel,
    });

    if (freshness.sentence === null) {
      // Nothing true to say yet. An empty bordered line at the foot of the page
      // reads as a section that failed to render.
      return nothing;
    }

    return html`
      <p class="line" data-tone=${freshness.tone}>
        ${
          freshness.verifiedOn === null
            ? freshness.sentence
            : html`<time datetime=${freshness.verifiedOn}>${freshness.sentence}</time>`
        }
      </p>
      ${
        freshness.tone === 'error'
          ? html`<ptk-button class="retry" @click=${this.#onRetry}>Try again</ptk-button>`
          : nothing
      }
    `;
  }

  /**
   * Settles once the retry has rendered too.
   *
   * Lit's default settles when this template is committed, which is before the
   * `ptk-button` inside it has drawn anything -- so a caller measuring the tap
   * target immediately after `updateComplete` measures a zero-height host (§5.8).
   */
  override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const button = this.shadowRoot?.querySelector('.retry');
    if (button instanceof LitElement) {
      await button.updateComplete;
    }
    return complete;
  }

  readonly #onRetry = (): void => {
    this.dispatchEvent(new CustomEvent(REFRESH_REQUEST_EVENT, { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-freshness': PtkTargetFreshness;
  }
}
