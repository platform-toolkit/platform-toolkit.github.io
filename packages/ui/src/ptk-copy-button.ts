// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-button.js';

/**
 * Copies a short piece of text, and says so without interrupting anything.
 *
 * Every tool here ends in a number somebody has to take somewhere else -- onto an
 * attempt card, into a message to a coach, into a registration form. Typing it out
 * again is where a transposed digit comes from, so the copy affordance is part of
 * the answer rather than a nicety, and it is shared chrome for the same reason
 * `ptk-button` is: the confirmation, the timer, and the failure path are three
 * things that are easy to get subtly wrong once and impossible to keep consistent
 * four times.
 *
 * WHY FAILURE IS A FIRST-CLASS STATE
 *
 * The clipboard is the one browser API in this collection that routinely refuses.
 * `navigator.clipboard` is undefined outside a secure context, and inside an
 * iframe it is gated by a permission policy the *embedding* page controls -- so a
 * widget that copies perfectly on its own site can be dropped into somebody's
 * article and never copy again. A caught-and-ignored rejection there is a button
 * that visibly does nothing, repeatedly, with no way for the visitor to tell
 * whether it worked. So a refusal is shown, in the same place the confirmation
 * appears, and it tells the visitor to select the text instead.
 *
 * WHY THE CONFIRMATION IS A LIVE REGION AND `ptk-notice` IS NOT
 *
 * The two look like the same decision and are not. A notice replaces content, and
 * whether that warrants an announcement depends on what it replaced -- only the
 * tool knows. This is the opposite case: nothing on the screen changes, so a
 * visitor who cannot see the tick has no other way to learn the copy happened.
 * `role="status"` is polite, so it waits its turn and never cuts across whatever
 * is being read.
 */

/** Fired after every attempt, so a tool can react to a refusal it cares about. */
export interface CopyDetail {
  /** Whether the text reached the clipboard. */
  readonly copied: boolean;
}

/** Event name, exported so a listener cannot misspell it. */
export const COPY_EVENT = 'ptk-copy';

/**
 * How long the confirmation stays.
 *
 * Long enough to be read at arm's length on a phone, short enough that it is gone
 * before the next copy -- otherwise a second press produces no visible change at
 * all and reads as a button that has stopped working.
 */
const CONFIRMATION_MS = 4000;

type Outcome = 'idle' | 'copied' | 'refused';

/**
 * Reads the clipboard API without promising it is there.
 *
 * The DOM lib declares `navigator.clipboard` as always present and it is not:
 * outside a secure context the property does not exist at all, and inside an
 * iframe whose embedder withheld the permission it exists and its methods
 * reject. Both end in the same sentence for the visitor, so both are handled.
 *
 * A function rather than an annotated local, and that is not a style choice.
 * `const { clipboard }: { clipboard?: Clipboard } = navigator` compiles, but
 * TypeScript narrows a declaration to its initializer's type, so the property
 * comes back as `Clipboard` and the guard reads as dead code -- which is how the
 * real check gets deleted by somebody tidying up, and the deletion looks correct
 * in review. A parameter is not narrowed by the argument at the call site, so the
 * widening survives and the guard stays honest. No assertion, per §2.4.
 */
function clipboardOf(source: { readonly clipboard?: Clipboard }): Clipboard | undefined {
  return source.clipboard;
}

@customElement('ptk-copy-button')
export class PtkCopyButton extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ptk-space-sm);
    }

    .outcome {
      font-size: var(--ptk-font-size-sm);
      /* Never the only signal: each outcome is a different sentence, so a reader
         who cannot separate the hues still gets the whole answer from the words. */
      color: var(--ptk-color-text-muted);
    }

    .outcome.refused {
      color: var(--ptk-color-negative);
      font-weight: 600;
    }
  `;

  /**
   * Exactly the characters that go on the clipboard.
   *
   * A string and not a node reference on purpose. What a lifter wants to paste is
   * almost never what a region reads as text -- "183.7 kg" rather than "Chart
   * value 183.7 kg Exact 183.71 kg" -- and deriving it from the DOM would make
   * every layout change silently change what gets copied.
   */
  @property({ type: String }) text = '';

  /** The visible label. */
  @property({ type: String }) label = 'Copy';

  /** Announced and shown after a successful copy. */
  @property({ type: String, attribute: 'copied-label' }) copiedLabel = 'Copied';

  /** Announced and shown when the clipboard refuses. */
  @property({ type: String, attribute: 'error-label' }) errorLabel =
    'Copying is blocked here. Select the value to copy it.';

  /**
   * A fuller name for assistive technology.
   *
   * Several of these sit on one screen -- one per chart row -- and four buttons
   * all named "Copy" are four identical entries in a list of controls. Passed
   * straight through to `ptk-button`, which is where the rule lives.
   */
  @property({ type: String, attribute: 'accessible-name' }) accessibleName = '';

  @property({ type: String }) variant: 'primary' | 'secondary' | 'quiet' = 'secondary';

  @property({ type: Boolean, reflect: true }) disabled = false;

  @state() private outcome: Outcome = 'idle';

  #timer: ReturnType<typeof setTimeout> | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // A pending timer on a removed element fires into nothing useful and keeps the
    // element alive until it does. Tool 4 renders one of these per chart row and
    // re-renders the whole table when the step filter changes, so this is a real
    // hundred-timer leak rather than a tidiness point.
    this.#clearTimer();
  }

  override render(): TemplateResult {
    return html`
      <ptk-button
        variant=${this.variant}
        ?disabled=${this.disabled}
        accessible-name=${this.accessibleName === '' ? nothing : this.accessibleName}
        @click=${() => {
          void this.#copy();
        }}
        >${this.label}</ptk-button
      >
      <!--
        Rendered whether or not there is anything to say. A live region added to the
        document at the same moment its text appears is not reliably announced --
        the platform has nothing to compare against -- and the bug shows up on one
        screen reader months later.
      -->
      <span class=${this.outcome === 'refused' ? 'outcome refused' : 'outcome'} role="status"
        >${this.#outcomeText()}</span
      >
    `;
  }

  /** Awaits the button as well, so a caller measuring the control sees it laid out. */
  override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    // A single known tag, so `querySelectorAll` already types this as `PtkButton`
    // and no `instanceof` filter is wanted. Narrowing to `LitElement` here would
    // be a widening, which is a compile error rather than a subtle one -- but the
    // sibling overrides elsewhere in the collection do need the filter, because a
    // comma-separated or `*` selector types as `Element`.
    const children = this.shadowRoot?.querySelectorAll('ptk-button') ?? [];
    await Promise.all([...children].map(async (child) => child.updateComplete));
    return complete;
  }

  #outcomeText(): string {
    switch (this.outcome) {
      case 'copied':
        return this.copiedLabel;
      case 'refused':
        return this.errorLabel;
      case 'idle':
        return '';
    }
  }

  async #copy(): Promise<void> {
    const clipboard = clipboardOf(navigator);
    if (clipboard === undefined) {
      this.#settle('refused');
      return;
    }
    try {
      await clipboard.writeText(this.text);
      this.#settle('copied');
    } catch {
      // Deliberately not rethrown and deliberately not silent. A refusal is an
      // ordinary answer from this API -- the visitor is told, and the tool is told
      // through the event, and neither needs the exception object, which on some
      // engines carries the page URL.
      this.#settle('refused');
    }
  }

  #settle(outcome: Outcome): void {
    this.outcome = outcome;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.outcome = 'idle';
      this.#timer = null;
    }, CONFIRMATION_MS);
    this.dispatchEvent(
      new CustomEvent<CopyDetail>(COPY_EVENT, {
        detail: { copied: outcome === 'copied' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-copy-button': PtkCopyButton;
  }

  interface HTMLElementEventMap {
    [COPY_EVENT]: CustomEvent<CopyDetail>;
  }
}
