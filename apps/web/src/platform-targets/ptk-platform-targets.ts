/**
 * The whole tool: the questions, the report, and the optional lift entry.
 *
 * Composition only. It holds no rules -- `selection.ts`, `standards.ts` and
 * `report.ts` have those -- and it loads nothing, because loading needs a
 * transport and this has to be mountable in a test with none. What it does own
 * are the two pieces of state that cross between its children: the answered
 * category, which the questions produce and the report consumes, and the four
 * entered weights, which the lift panel produces and the report consumes.
 *
 * THE ORDER IS THE POINT
 *
 * Questions, then report, then lift entry -- and the lift entry is folded shut.
 * It used to be questions, entry, classifications, more questions, records, so
 * the thing a lifter came for was below two forms and could not be seen without
 * answering both. Requirement 10 in the user's words: "make the whole focus of
 * the tool to be the report, getting as much as possible out of the way."
 *
 * The selection event is `composed`, so it crosses this element's shadow
 * boundary on its way out. That is what lets `view.ts` listen on this element
 * directly to know when to read a different partition, rather than needing a
 * callback property threaded through -- and it keeps this file free of any
 * knowledge that a data source exists.
 */
import type { CategoryCatalog, ClassificationBook } from '@platform-toolkit/data-contracts';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-target-categories.js';
import './ptk-target-lifts.js';
import './ptk-target-report.js';
import {
  SELECTION_CHANGE_EVENT,
  type CatalogStatus,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import { ENTRIES_CHANGE_EVENT, type EntriesChangeDetail } from './ptk-target-lifts.js';
import type { PartitionRead, StandardsStatus } from './ptk-target-report.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';
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

  /**
   * One entry per record artifact the selection asks for, keyed by
   * `partitionKey`.
   *
   * Replaced wholesale by the transport rather than mutated in place. Lit
   * compares properties by identity, so a `Map` that is filled in as reads
   * settle is the same `Map` every time and nothing re-renders -- the symptom is
   * a report that stays on "Loading the state records" while every read has
   * already succeeded.
   */
  @property({ attribute: false }) recordReads: ReadonlyMap<string, PartitionRead> = new Map();

  /**
   * The answered category, as the questions last reported it.
   *
   * Read-only from outside: it is derived from what the lifter chose, and a
   * caller setting it would put the questions and the report out of step with
   * each other in a way neither could detect.
   */
  @state() private selection: CategorySelection = NO_SELECTION;

  /**
   * The four weights, as the lift panel last reported them.
   *
   * Mirrored downward into the report only, never back into the panel that owns
   * the fields -- a round trip would make a keystroke depend on this element
   * being present, and the lift panel is mounted on its own in half its tests.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /** What the questions currently say the category is. */
  get currentSelection(): CategorySelection {
    return this.selection;
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const categories = this.shadowRoot?.querySelector('ptk-target-categories');
    const lifts = this.shadowRoot?.querySelector('ptk-target-lifts');
    const report = this.shadowRoot?.querySelector('ptk-target-report');
    await Promise.all([categories?.updateComplete, lifts?.updateComplete]);
    // Awaited after the other two rather than alongside them. The report renders
    // from state this element mirrors out of both of them, so its update is
    // queued by their settling -- awaiting all three at once resolves before that
    // second render has been committed, and a test then reads the report drawn
    // for the answer before last.
    await report?.updateComplete;
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
        <ptk-target-report
          .catalog=${this.catalog}
          .selection=${this.selection}
          .classifications=${this.book}
          .classificationsStatus=${this.standardsStatus}
          .recordReads=${this.recordReads}
          .entries=${this.entries}
        ></ptk-target-report>
      </section>
      <section>
        <ptk-target-lifts></ptk-target-lifts>
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

  /** Same discipline: mirrored into the report, and left to keep travelling. */
  readonly #onEntriesChange = (event: CustomEvent<EntriesChangeDetail>): void => {
    this.entries = event.detail.entries;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-platform-targets': PtkPlatformTargets;
  }
}
