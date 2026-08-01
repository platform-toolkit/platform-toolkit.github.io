/**
 * The manual selection path: the questions a lifter answers to identify the
 * category everything else is measured against.
 *
 * This is a tool component rather than shared chrome. It knows that a weight
 * class belongs to a sex category and that a division has an age band;
 * `ptk-choice-group` knows none of that and is repeated once per question here.
 *
 * It does no loading. The catalogue and the state of the read arrive as
 * properties, which is what lets the whole interface be exercised in a browser
 * test without a transport, and what keeps "we are still fetching", "this
 * federation is not published", and "the read failed" as three separate things
 * the screen can say. Rendering an empty question set for all three is the
 * failure this avoids -- it looks like a working page that is asking nothing.
 */
import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import { CHOICE_CHANGE_EVENT, type ChoiceChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  NO_SELECTION,
  resolveSelection,
  type CategorySelection,
  type SelectionField,
  type SelectionQuestion,
} from './selection.js';

/** Where the catalogue read has got to. */
export type CatalogStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

/** Fired whenever the answered category changes. */
export interface SelectionChangeDetail {
  readonly selection: CategorySelection;
  /** Every question answered, so downstream reads have a category to use. */
  readonly complete: boolean;
}

/** Event name, exported so a listener cannot misspell it. */
export const SELECTION_CHANGE_EVENT = 'ptk-selection-change';

@customElement('ptk-target-categories')
export class PtkTargetCategories extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .questions {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-lg);
    }

    .outstanding {
      margin: var(--ptk-space-lg) 0 0;
      color: var(--ptk-color-text-muted);
    }
  `;

  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  @property({ type: String }) status: CatalogStatus = 'loading';

  /**
   * What the lifter asked for, before the catalogue is consulted.
   *
   * Kept separate from the resolved answers on purpose. `resolveSelection`
   * discards anything this catalogue does not offer, and storing its output
   * would make that discard permanent -- a lifter who picked a class, switched
   * sex category to look at the other ladder, and switched back would find their
   * class silently gone. Re-resolving from the request each render restores it.
   */
  @state() private requested: CategorySelection = NO_SELECTION;

  override connectedCallback(): void {
    super.connectedCallback();
    // Delegated rather than bound per group: the event is composed, so it
    // reaches this host from any of them, and one listener cannot fall out of
    // step with the list of questions.
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
    super.disconnectedCallback();
  }

  /**
   * Resolves once the choice groups have rendered too, not just this element.
   *
   * Lit's default `updateComplete` settles when the host's own template has been
   * committed. That commit sets `.choices` on a group and leaves the group's own
   * render queued, so a caller awaiting the host is reading a subtree that
   * happens to have caught up rather than one that is guaranteed to have. It
   * usually has -- which is the problem: the guarantee is what a caller assumes,
   * and the day the timing shifts the failure is an assertion against last
   * render's weight classes, in a test that has passed for months.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const groups = this.shadowRoot?.querySelectorAll('ptk-choice-group') ?? [];
    await Promise.all([...groups].map((group) => group.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading this federation's categories…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The published categories could not be loaded. Reload the page to try again.
      </ptk-notice>`;
    }
    if (this.catalog === null) {
      // Covers `unavailable`, and covers `ready` arriving without a catalogue,
      // which is a wiring mistake that should still render something true. Not
      // an error tone: nothing failed, and a reload will not change it.
      return html`<ptk-notice>
        This federation's categories have not been published yet.
      </ptk-notice>`;
    }

    const resolved = resolveSelection(this.catalog, this.requested);
    return html`
      <div class="questions">
        ${resolved.questions.map((question) => this.#renderQuestion(question))}
      </div>
      <p class="outstanding" role="status">${outstandingMessage(resolved.questions)}</p>
    `;
  }

  #renderQuestion(question: SelectionQuestion): TemplateResult {
    return html`
      <ptk-choice-group
        data-field=${question.field}
        .label=${question.label}
        .choices=${question.choices}
        .value=${question.value}
        empty-message=${question.emptyMessage}
      ></ptk-choice-group>
    `;
  }

  /**
   * Bound once as a field so that `removeEventListener` is given the same
   * function it was added with. A method reference would be a new bound
   * function each time and the listener would outlive the element.
   */
  readonly #onChoiceChange = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) {
      return;
    }

    const requested: Record<SelectionField, string | null> = { ...this.requested };
    requested[field] = event.detail.value;
    this.requested = requested;

    if (this.catalog === null) {
      return;
    }
    const resolved = resolveSelection(this.catalog, this.requested);
    this.dispatchEvent(
      new CustomEvent<SelectionChangeDetail>(SELECTION_CHANGE_EVENT, {
        detail: { selection: resolved.selection, complete: resolved.complete },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

const FIELDS: readonly SelectionField[] = ['sex', 'equipment', 'weightClass', 'division', 'tested'];

/**
 * Which question an event came from, or `null` if it did not come from one.
 *
 * Read from the composed path, not from `event.target`. A listener on the host
 * sees the target retargeted to the host itself -- the group that fired lives in
 * a different tree, and the platform hides that from the outside on purpose --
 * so `event.target.dataset` is empty and every answer is dropped. The symptom is
 * a page whose radios visibly respond while nothing is ever recorded, which
 * looks like a rendering bug rather than an event one.
 *
 * The value is checked against the known fields rather than trusted: `dataset`
 * is a string from the DOM, and a typo in the template would otherwise write a
 * fifth key into the selection that no question ever reads back.
 */
function fieldOf(event: Event): SelectionField | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const field = FIELDS.find((candidate) => candidate === node.dataset['field']);
    if (field !== undefined) {
      return field;
    }
  }
  return null;
}

/**
 * A live-region line naming what is still missing.
 *
 * The radios announce their own selection, so this deliberately says something
 * else: what remains. Its text only changes when the outstanding set changes, so
 * it does not re-announce on every click.
 */
function outstandingMessage(questions: readonly SelectionQuestion[]): string {
  const unanswered = questions.filter((question) => question.value === null);
  if (unanswered.length === 0) {
    return 'Category complete.';
  }
  const labels = unanswered.map((question) => question.label.toLowerCase());
  // `join` rather than an index: `noUncheckedIndexedAccess` would otherwise make
  // reading the last label a `string | undefined` for no gain.
  const list =
    labels.length === 1
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1).join('')}`;
  return `Still to choose: ${list}.`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-categories': PtkTargetCategories;
  }

  interface HTMLElementEventMap {
    [SELECTION_CHANGE_EVENT]: CustomEvent<SelectionChangeDetail>;
  }
}
