// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The answered context, as a two-line control that opens the editor.
 *
 * WHY A SUMMARY EXISTS AT ALL
 *
 * The questions used to sit above the report permanently. Seven controls, four
 * of them required, none of which a lifter's answer changes between one week
 * and the next -- so the first screenful of the tool was a form somebody had
 * already filled in, and the thing they came for started below it. The
 * 2026-08-02 review measured the consequence and the fix is this: the answers
 * collapse to two short lines, and the questions come back only when asked for.
 *
 * WHY IT IS ONE BUTTON AND NOT A ROW OF THEM
 *
 * Per-answer edit affordances read well on a laptop and fail at a rack: seven
 * targets in the space of two lines is either seven things under 44 px or two
 * lines that are no longer a summary. One target, the whole width, opens
 * everything -- and the editor batches, which is what lets a lifter change their
 * class and their division as one move rather than as two reflows of the report.
 *
 * It resolves the selection itself rather than taking rendered strings. Which
 * answers this catalogue offers and what they are called is a decision with a
 * resolver behind it; a caller formatting the lines would be a second copy of
 * that decision, and the failure is a summary naming a class the report is not
 * drawn for.
 */
import type { CategoryCatalog } from '@platform-toolkit/data-contracts';

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

import {
  NO_SELECTION,
  contextSummary,
  resolveSelection,
  type ContextSummary,
} from '../core/selection.js';
import type { CategorySelection } from '../types.js';

/** The tag this element registers under. Written to the registry only by `element/index.ts`. */
export const TARGET_CONTEXT_TAG = 'ptk-target-context';

/** Fired when the lifter asks to change the context. */
export const CONTEXT_EDIT_EVENT = 'ptk-context-edit';

export class PtkTargetContext extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * A real button, full width, two lines of text inside it.
     *
     * (No backticks in this comment: they would end the css template -- see the
     * gotcha in CLAUDE.md 5.8.)
     *
     * Not a ptk-button: that element is built around a single slotted label
     * and centres it, and what is wanted here is a block of left-aligned text
     * with an affordance at the end. Wrapping one would mean fighting its
     * layout from outside a shadow boundary.
     */
    button {
      display: flex;
      gap: var(--ptk-space-md);
      align-items: center;
      width: 100%;
      min-height: var(--ptk-tap-target-comfortable);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      color: inherit;
      font: inherit;
      text-align: start;
      background-color: var(--ptk-color-surface-raised);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      cursor: pointer;
    }

    button:hover {
      border-color: var(--ptk-color-accent);
    }

    .lines {
      display: grid;
      /* The two lines are one column so a long class list wraps within its own
         line rather than pushing the action off the end of the row. */
      gap: var(--ptk-space-xs);
      min-width: 0;
      flex: 1 1 auto;
    }

    .competition {
      font-weight: 600;
    }

    .scope {
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * The word "Edit", not a pencil.
     *
     * A glyph would need an accessible name anyway, and the whole control is
     * one target -- so the name would have to carry the summary as well, which
     * is a sentence nobody wants read out on every focus. A word costs four
     * characters and says the same thing to everybody.
     */
    .edit {
      flex: 0 0 auto;
      color: var(--ptk-color-accent);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
    }
  `;

  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  @property({ attribute: false }) selection: CategorySelection = NO_SELECTION;

  /**
   * Puts focus back on the summary, for a caller returning from the editor.
   *
   * Silent when there is no button, and that is deliberate rather than an
   * oversight -- the catalogue can be absent, in which case this element renders
   * nothing at all and there is no invoker to return to. Throwing would make a
   * root that wants to restore focus into a root that has to know this element's
   * render conditions. Same contract as the report's focusHeading.
   */
  focusSummary(): void {
    this.shadowRoot?.querySelector<HTMLElement>('button')?.focus();
  }

  override render(): TemplateResult | typeof nothing {
    if (this.catalog === null) {
      // Nothing to summarise and nothing an editor could offer. Rendering an
      // empty control would be a button that opens a screen of empty questions.
      return nothing;
    }
    const summary = contextSummary(resolveSelection(this.catalog, this.selection));
    return html`
      <button type="button" aria-label=${accessibleName(summary)} @click=${this.#onClick}>
        <span class="lines">
          <span class="competition">${summary.competition}</span>
          <span class="scope">${summary.scope}</span>
        </span>
        <span class="edit" aria-hidden="true">Edit</span>
      </button>
    `;
  }

  readonly #onClick = (): void => {
    this.dispatchEvent(new CustomEvent(CONTEXT_EDIT_EVENT, { bubbles: true, composed: true }));
  };
}

/**
 * What the button is called, which is the verb first and the summary after.
 *
 * The button's own contents read as three fragments -- "Female · Raw · Tested",
 * "75 kg and 82.5 kg · Master 50-54 and Open", "Edit" -- and announced in that
 * order they bury what the control *does* at the end of a long string. Leading
 * with "Edit context" means a reader arriving on it knows within two words
 * whether this is the thing they were looking for, and can leave before the
 * rest. The visible "Edit" is `aria-hidden` because it is already here.
 *
 * The middle dots are left in. They are announced as a pause by every engine
 * tested against and as nothing by the rest, which is the reading wanted --
 * "female, raw, tested" rather than one run-on word.
 */
function accessibleName(summary: ContextSummary): string {
  const detail = [summary.competition, summary.scope].filter((line) => line !== '').join('. ');
  return detail === '' ? 'Edit context' : `Edit context: ${detail}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-context': PtkTargetContext;
  }

  interface HTMLElementEventMap {
    [CONTEXT_EDIT_EVENT]: CustomEvent<void>;
  }
}
