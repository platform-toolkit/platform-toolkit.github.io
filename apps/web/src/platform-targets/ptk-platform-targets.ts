/**
 * The whole tool: the questions, and what the answers are measured against.
 *
 * Composition only. It holds no rules -- `selection.ts` and `standards.ts` have
 * those -- and it loads nothing, because loading needs a transport and this has
 * to be mountable in a test with none. What it does own is the one piece of
 * state both halves need: the answered category, which the questions produce and
 * the standards consume.
 *
 * The selection event is `composed`, so it crosses this element's shadow
 * boundary on its way out. That is what lets `view.ts` listen on this element
 * directly to know when to fetch a different partition of standards, rather than
 * needing a callback property threaded through -- and it keeps this file free of
 * any knowledge that a data source exists.
 */
import type {
  CategoryCatalog,
  ClassificationBook,
  RecordBook,
} from '@platform-toolkit/data-contracts';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-target-categories.js';
import './ptk-target-records.js';
import './ptk-target-standards.js';
import {
  SELECTION_CHANGE_EVENT,
  type CatalogStatus,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';
import {
  ENTRIES_CHANGE_EVENT,
  type EntriesChangeDetail,
  type StandardsStatus,
} from './ptk-target-standards.js';
import type { RecordsStatus } from './ptk-target-records.js';
import { NO_ENTRIES, type LiftEntries } from './standards.js';

@customElement('ptk-platform-targets')
export class PtkPlatformTargets extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    section + section {
      margin-block-start: var(--ptk-space-xl);
      padding-block-start: var(--ptk-space-xl);
      border-block-start: 1px solid var(--ptk-color-border);
    }
  `;

  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  @property({ type: String }) catalogStatus: CatalogStatus = 'loading';

  @property({ attribute: false }) book: ClassificationBook | null = null;

  @property({ type: String }) standardsStatus: StandardsStatus = 'idle';

  /** This partition's records, or `null` if the federation publishes none for it. */
  @property({ attribute: false }) records: RecordBook | null = null;

  @property({ type: String }) recordsStatus: RecordsStatus = 'idle';

  /**
   * The answered category, as the questions last reported it.
   *
   * Read-only from outside: it is derived from what the lifter chose, and a
   * caller setting it would put the two halves of the screen out of step with
   * each other in a way neither could detect.
   */
  @state() private selection: CategorySelection = NO_SELECTION;

  /**
   * The four weights, as the standards panel last reported them.
   *
   * Held here so the records panel can read the same numbers the classification
   * panel is reading. Mirrored downward into the records panel only, never back
   * into the panel that owns the fields -- a round trip would make a keystroke
   * depend on this element being present, and the standards panel is mounted on
   * its own in half its tests.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /** What the questions currently say the category is. */
  get currentSelection(): CategorySelection {
    return this.selection;
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const categories = this.shadowRoot?.querySelector('ptk-target-categories');
    const standards = this.shadowRoot?.querySelector('ptk-target-standards');
    const records = this.shadowRoot?.querySelector('ptk-target-records');
    await Promise.all([categories?.updateComplete, standards?.updateComplete]);
    // Awaited after the other two rather than alongside them. The records panel
    // renders from the entries this element mirrors out of the standards panel,
    // so its update is queued by the standards panel settling -- awaiting all
    // three at once resolves before that second render has been committed.
    await records?.updateComplete;
    return complete;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(SELECTION_CHANGE_EVENT, this.#onSelectionChange);
    this.addEventListener(ENTRIES_CHANGE_EVENT, this.#onEntriesChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(SELECTION_CHANGE_EVENT, this.#onSelectionChange);
    this.removeEventListener(ENTRIES_CHANGE_EVENT, this.#onEntriesChange);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    return html`
      <section>
        <ptk-target-categories
          .catalog=${this.catalog}
          .status=${this.catalogStatus}
        ></ptk-target-categories>
      </section>
      <section>
        <ptk-target-standards
          .book=${this.book}
          .status=${this.standardsStatus}
          .selection=${this.selection}
        ></ptk-target-standards>
      </section>
      <section>
        <ptk-target-records
          .catalog=${this.catalog}
          .book=${this.records}
          .status=${this.recordsStatus}
          .selection=${this.selection}
          .entries=${this.entries}
        ></ptk-target-records>
      </section>
    `;
  }

  /**
   * Records the answers and lets the event continue outward.
   *
   * Not stopped and not re-dispatched. Re-dispatching would give the page a
   * second event to reason about and lose the original's timing; stopping it
   * would leave `view.ts` with nothing to load a partition from.
   */
  readonly #onSelectionChange = (event: CustomEvent<SelectionChangeDetail>): void => {
    this.selection = event.detail.selection;
  };

  /** Same discipline: mirrored for the records panel, and left to keep travelling. */
  readonly #onEntriesChange = (event: CustomEvent<EntriesChangeDetail>): void => {
    this.entries = event.detail.entries;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-platform-targets': PtkPlatformTargets;
  }
}
