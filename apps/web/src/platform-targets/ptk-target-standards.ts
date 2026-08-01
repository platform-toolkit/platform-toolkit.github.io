/**
 * What the lifter has lifted, read against the standards for their category.
 *
 * A tool component, like `ptk-target-categories`: it knows what a lift is and
 * what a classification means, neither of which belongs in `packages/ui`. The
 * arithmetic and every sentence it displays come from `standards.ts`, which is
 * pure, so this file is only the arrangement -- four fields, four status lines,
 * and the wiring between them.
 *
 * It does no loading. The book and the state of the read arrive as properties,
 * for the same reason the categories element takes its catalogue that way: it
 * keeps "still fetching", "this federation publishes none", and "the read
 * failed" as three different sentences instead of one empty panel that reads as
 * a working page with nothing to say.
 */
import type { ClassificationBook, Lift } from '@platform-toolkit/data-contracts';
import { NUMBER_FIELD_CHANGE_EVENT, type NumberFieldChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  LIFTS,
  NO_ENTRIES,
  formatKilograms,
  lifterCategoryFrom,
  resolveStandards,
  standingSummary,
  type LiftEntries,
  type LiftStanding,
} from './standards.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';

/** Where the read of this category's standards has got to. */
export type StandardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

@customElement('ptk-target-standards')
export class PtkTargetStandards extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
    }

    ptk-notice {
      margin-block-end: var(--ptk-space-lg);
    }

    /*
     * One column on a phone, two once the element itself is wide enough --
     * keyed to this element's width rather than the viewport's, so a widget in
     * a narrow sidebar behaves like one on a phone with no media query. The
     * min() is load-bearing: without it a container narrower than the track
     * minimum overflows instead of collapsing to a single column.
     */
    .lifts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
      gap: var(--ptk-space-lg);
    }

    .lift {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
    }

    .summary {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .summary.placed {
      color: var(--ptk-color-text);
    }

    .derived {
      font-variant-numeric: tabular-nums;
    }
  `;

  /** This category's standards, or `null` if the federation publishes none. */
  @property({ attribute: false }) book: ClassificationBook | null = null;

  @property({ type: String }) status: StandardsStatus = 'idle';

  /** The answered category. Incomplete is normal and has its own sentence. */
  @property({ attribute: false }) selection: CategorySelection = NO_SELECTION;

  /**
   * What is in the four fields.
   *
   * Owned here rather than by the page, because these are the only values on
   * the screen that nothing outside the element reads. Deliberately **not**
   * persisted: §2.3 forbids storing imported athlete data by default, and a
   * lifter's competition results are exactly that whether they were imported or
   * typed. A field that survived a reload would be a quiet exception to it.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /**
   * Resolves once the fields have rendered too.
   *
   * Lit's default settles when this element's template is committed, which sets
   * `.value` on a child and leaves the child's own render queued. A caller
   * awaiting the host would be reading a subtree that happens to have caught up.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const fields = this.shadowRoot?.querySelectorAll('ptk-number-field') ?? [];
    await Promise.all([...fields].map((field) => field.updateComplete));
    return complete;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // One delegated listener rather than four bound ones: the event is composed,
    // so it reaches this host from any field, and a single listener cannot fall
    // out of step with the list of lifts.
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumberChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumberChange);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const standings = resolveStandards(this.book, lifterCategoryFrom(this.selection), this.entries);

    return html`
      <h2>Your lifts</h2>
      ${this.#renderNotice()}
      <div class="lifts">${standings.map((standing) => this.#renderLift(standing))}</div>
    `;
  }

  /**
   * The one sentence that is about the whole panel rather than one lift.
   *
   * Only rendered when it says something the per-lift lines cannot. While the
   * standards are loading, every lift would otherwise claim the federation
   * publishes none -- which is a different and alarming statement.
   */
  #renderNotice(): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading the standards for this category…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The published standards could not be loaded. Reload the page to try again.
      </ptk-notice>`;
    }
    return html`<ptk-notice>
      Enter what you have lifted, in kilograms, to see where it places.
    </ptk-notice>`;
  }

  #renderLift(standing: LiftStanding): TemplateResult {
    const { entry } = standing;
    // A derived total is shown in the field so the number a lifter reads is the
    // number the status line is about. Leaving the field blank under a sentence
    // about 250 kg is the kind of gap that gets read as a bug.
    const value =
      entry.kind === 'weight' && entry.derived
        ? formatKilograms(entry.kilograms)
        : this.entries[standing.lift];

    return html`
      <div class="lift">
        <ptk-number-field
          data-lift=${standing.lift}
          .label=${standing.label}
          .value=${value}
          unit="kg"
          placeholder="0"
          .error=${entry.kind === 'invalid' ? entry.message : ''}
        ></ptk-number-field>
        <p class=${standing.classification === null ? 'summary' : 'summary placed'}>
          ${standingSummary(standing)}
        </p>
      </div>
    `;
  }

  /**
   * Bound once as a field so `removeEventListener` gets the same function it was
   * given. A method reference would be a fresh bound function and the listener
   * would outlive the element.
   */
  readonly #onNumberChange = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const lift = liftOf(event);
    if (lift === null) {
      return;
    }
    this.entries = { ...this.entries, [lift]: event.detail.value };
  };
}

/**
 * Which field an event came from, or `null` if it came from somewhere else.
 *
 * From the composed path, never `event.target`. A listener on this host sees the
 * target retargeted to the host itself for anything fired inside a child's own
 * shadow tree, so `event.target.dataset` is empty and every keystroke is
 * dropped. The symptom is a panel whose fields accept typing while no number
 * ever reaches the standards -- a rendering bug, to look at.
 *
 * The value is checked against the known lifts rather than trusted: `dataset` is
 * a string from the DOM, and a typo in the template would otherwise write a
 * fifth key into the entries that nothing reads back.
 */
function liftOf(event: Event): Lift | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const lift = LIFTS.find((candidate) => candidate === node.dataset['lift']);
    if (lift !== undefined) {
      return lift;
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-standards': PtkTargetStandards;
  }
}
