/**
 * The records that stand in the lifter's category, and how far away they are.
 *
 * A tool component, like `ptk-target-categories` and `ptk-target-standards`: it
 * knows that a record belongs to a level, a region and an event, none of which
 * `packages/ui` has any business knowing. The arithmetic and every sentence come
 * from `record-standings.ts` and `record-scope.ts`, both pure, so this file is
 * only the arrangement.
 *
 * IT ASKS ITS OWN QUESTIONS
 *
 * Level, region and event are asked here rather than added to the category
 * questions above, because they describe *which records* and not *who the lifter
 * is*. Folding them into `CategorySelection` would leave the classification panel
 * permanently incomplete for anyone who never scrolled this far -- `complete` is
 * what that panel uses to decide it may select a table at all. `record-scope.ts`
 * says the same thing at greater length.
 *
 * IT OWNS NO LIFTS
 *
 * The four weights come in as a property, from the standards panel by way of the
 * page. A lifter enters what they have lifted once; a second set of fields here
 * would be four more numbers to keep in step, and the failure would be two panels
 * quietly disagreeing about the same total.
 */
import type { CategoryCatalog, RecordBook } from '@platform-toolkit/data-contracts';
import { CHOICE_CHANGE_EVENT, type ChoiceChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  NO_RECORD_SCOPE,
  resolveRecordScope,
  type RecordPartition,
  type RecordScopeField,
  type RecordScopeQuestion,
  type RecordScopeSelection,
} from './record-scope.js';
import {
  recordCategoryFrom,
  recordFigure,
  recordSummary,
  resolveRecordStandings,
  type LiftRecordStanding,
} from './record-standings.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';
import { NO_ENTRIES, lifterCategoryFrom, type LiftEntries } from './standards.js';

/** Where the read of this partition's records has got to. */
export type RecordsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Fired whenever the answered record scope changes. */
export interface RecordScopeChangeDetail {
  readonly scope: RecordScopeSelection;
  /**
   * Which artifact the answers now point at, or `null` while they point at none.
   *
   * Carried on the event rather than recomputed by the listener. The resolver
   * is the only thing that knows a level with no regions is settled without one,
   * and a listener re-deriving that from the three strings would ask for a
   * partition that was never published the moment a federation subdivides a
   * level it used not to.
   */
  readonly partition: RecordPartition | null;
}

/** Event name, exported so a listener cannot misspell it. */
export const RECORD_SCOPE_CHANGE_EVENT = 'ptk-record-scope-change';

@customElement('ptk-target-records')
export class PtkTargetRecords extends LitElement {
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

    .questions {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-lg);
      margin-block-end: var(--ptk-space-xl);
    }

    /*
     * The same intrinsic grid the standards panel uses, and for the same reason:
     * one column on a phone, more once this element itself is wide enough, keyed
     * to the element rather than the viewport so a widget in a narrow sidebar
     * behaves like one on a phone with no media query. The min() is load-bearing
     * -- without it a container narrower than the track minimum overflows
     * instead of collapsing to a single column.
     *
     * A grid of cards rather than a table. A record has five things to say about
     * it, and five columns at 320 pixels is either a sideways scroll or a
     * four-character truncation.
     */
    .records {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
      gap: var(--ptk-space-lg);
    }

    .record {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-2xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .figure {
      margin: 0;
      font-size: var(--ptk-font-size-xl);
      font-variant-numeric: tabular-nums;
    }

    .holder {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
    }

    .summary {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .summary.measured {
      color: var(--ptk-color-text);
    }
  `;

  /** The vocabulary the questions are drawn from. */
  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  /** This partition's records, or `null` if the federation publishes none for it. */
  @property({ attribute: false }) book: RecordBook | null = null;

  @property({ type: String }) status: RecordsStatus = 'idle';

  /** Who the lifter is. Incomplete is normal and has its own sentence. */
  @property({ attribute: false }) selection: CategorySelection = NO_SELECTION;

  /** What the standards panel's four fields hold. Read-only here; see the header. */
  @property({ attribute: false }) entries: LiftEntries = NO_ENTRIES;

  /**
   * What the lifter asked for, before the catalogue is consulted.
   *
   * Kept separate from the resolved answers for the reason `ptk-target-categories`
   * gives: `resolveRecordScope` drops anything this catalogue cannot offer, and
   * storing its output would make the drop permanent -- somebody who looks at the
   * national tables and comes back to their state would find the region gone.
   */
  @state() private requested: RecordScopeSelection = NO_RECORD_SCOPE;

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const groups = this.shadowRoot?.querySelectorAll('ptk-choice-group') ?? [];
    await Promise.all([...groups].map((group) => group.updateComplete));
    return complete;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    if (this.catalog === null) {
      // Covers a catalogue that is still loading, one that failed, and one that
      // was never published: all three are already stated by the categories
      // panel above, and repeating them here would put the same sentence on the
      // screen twice with nothing to distinguish the two.
      return html`
        <h2>Records</h2>
        <ptk-notice>Records appear once this federation's categories have loaded.</ptk-notice>
      `;
    }

    const scope = resolveRecordScope(this.catalog, this.requested);
    const category = recordCategoryFrom(
      lifterCategoryFrom(this.selection),
      scope.partition,
      scope.selection.discipline,
    );
    const standings = resolveRecordStandings(this.book, category, scope.lifts, this.entries);

    return html`
      <h2>Records</h2>
      ${this.#renderNotice(category === null, standings.length === 0)}
      <div class="questions">
        ${scope.questions.map((question) => this.#renderQuestion(question))}
      </div>
      ${
        standings.length === 0
          ? nothing
          : html`<div class="records">
              ${standings.map((standing) => this.#renderRecord(standing))}
            </div>`
      }
    `;
  }

  /**
   * The one sentence that is about the whole panel rather than one record.
   *
   * While the read is in flight every card would otherwise claim the federation
   * keeps no record in this category, which is a different and much more
   * interesting statement than "not loaded yet" -- and it is the statement a
   * lifter would act on.
   */
  #renderNotice(incomplete: boolean, noCards: boolean): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading the records for this category…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The published records could not be loaded. Reload the page to try again.
      </ptk-notice>`;
    }
    if (noCards) {
      // Said once, above the questions, rather than as a row of empty cards. The
      // event decides which lifts even have records, so there is nothing honest
      // to draw a card for until it is chosen.
      return html`<ptk-notice>
        Choose a record level and event to see what stands in your category.
      </ptk-notice>`;
    }
    if (incomplete) {
      return html`<ptk-notice>
        Answer every question above to see the records that apply to you.
      </ptk-notice>`;
    }
    return html`<ptk-notice>
      Records are matched to your exact category. Your lifts, as entered above, are measured against
      them.
    </ptk-notice>`;
  }

  #renderQuestion(question: RecordScopeQuestion): TemplateResult {
    return html`
      <ptk-choice-group
        data-record-field=${question.field}
        .label=${question.label}
        .choices=${question.choices}
        .value=${question.value}
        empty-message=${question.emptyMessage}
      ></ptk-choice-group>
    `;
  }

  #renderRecord(standing: LiftRecordStanding): TemplateResult {
    const figure = recordFigure(standing);
    return html`
      <div class="record">
        <h3>${standing.label}</h3>
        ${figure === null ? nothing : html`<p class="figure">${figure}</p>`}
        ${this.#renderHolder(standing)}
        <p class=${standing.standing === null ? 'summary' : 'summary measured'}>
          ${recordSummary(standing)}
        </p>
      </div>
    `;
  }

  /**
   * Who holds it and when, when the source says so.
   *
   * A record holder's name is published by the federation and belongs beside
   * their lift; it is not the same kind of value as an imported athlete's
   * details, which stay out of logs and error reports (section 2.3). Every one of
   * these three fields is nullable in the contract and any of them can be absent
   * for a real record, so the line is assembled from what is there rather than
   * printed with gaps.
   *
   * The date is left in the published `YYYY-MM-DD` rather than localised. These
   * tools are read in every region the federation runs meets in, and `03/04/2022`
   * is two different days depending on who is holding the phone.
   */
  #renderHolder(standing: LiftRecordStanding): TemplateResult | typeof nothing {
    if (standing.record.kind !== 'record') {
      return nothing;
    }
    const { unclaimed, holderName, achievedOn, meetName } = standing.record.record;
    if (unclaimed) {
      // Its own line rather than a missing one. A record nobody holds is the
      // federation's opening standard, and saying so is the most encouraging
      // thing on the card -- there is a name-shaped gap here that a lifter can
      // put their own name in. Silence would read as a holder the source failed
      // to publish, which is the same screen for the opposite situation.
      return html`<p class="holder unclaimed">No lifter has claimed this record yet.</p>`;
    }
    if (holderName === null && achievedOn === null && meetName === null) {
      return nothing;
    }
    return html`<p class="holder">
      ${holderName ?? 'Holder not published'}${
        achievedOn === null ? nothing : html` · <time datetime=${achievedOn}>${achievedOn}</time>`
      }${meetName === null ? nothing : html` · ${meetName}`}
    </p>`;
  }

  /**
   * Bound once as a field so `removeEventListener` gets the same function it was
   * given. A method reference would be a fresh bound function and the listener
   * would outlive the element.
   */
  readonly #onChoiceChange = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) {
      // Not one of this panel's questions. The unit radio in the standards panel
      // fires the same composed event, and this element is a sibling of it
      // rather than an ancestor -- but a future arrangement that nests them
      // would deliver it here, and silently writing it into the scope would set
      // the record level to "lb".
      return;
    }

    const requested: Record<RecordScopeField, string | null> = { ...this.requested };
    requested[field] = event.detail.value;
    this.requested = requested;

    if (this.catalog === null) {
      return;
    }
    const resolved = resolveRecordScope(this.catalog, this.requested);
    this.dispatchEvent(
      new CustomEvent<RecordScopeChangeDetail>(RECORD_SCOPE_CHANGE_EVENT, {
        detail: { scope: resolved.selection, partition: resolved.partition },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

const FIELDS: readonly RecordScopeField[] = ['level', 'region', 'discipline'];

/**
 * Which question an event came from, or `null` if it did not come from one.
 *
 * From the composed path, never `event.target`: a listener on this host sees the
 * target retargeted to the host itself for anything fired inside a child's own
 * shadow tree, so the dataset would be empty and every answer dropped. The
 * symptom is a panel whose radios visibly respond while nothing is recorded.
 *
 * The attribute is `data-record-field` and not `data-field`, which the categories
 * panel already uses. The two panels are separate elements today and the names
 * could not collide -- but they are read out of a *composed path*, which crosses
 * every boundary between the radio and whoever is listening, so the day one is
 * rendered inside the other the collision is silent and picks by depth.
 */
function fieldOf(event: Event): RecordScopeField | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const field = FIELDS.find((candidate) => candidate === node.dataset['recordField']);
    if (field !== undefined) {
      return field;
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-records': PtkTargetRecords;
  }

  interface HTMLElementEventMap {
    [RECORD_SCOPE_CHANGE_EVENT]: CustomEvent<RecordScopeChangeDetail>;
  }
}
