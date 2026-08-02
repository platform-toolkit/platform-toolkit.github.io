/**
 * The report. Everything a lifter in this category could be aiming at, in order.
 *
 * This element is the tool. The questions above it exist to choose which ladders
 * to draw, the lift entry below it exists to mark which rungs are behind them,
 * and this is the thing they came for -- stated by the user as "we want to get
 * as quickly as possible to a very nice looking report that is perfect for a
 * lifter to see what they might be able to hit".
 *
 * ARRANGEMENT, NOT ARITHMETIC
 *
 * Every figure, every sentence and every ordering decision is made in
 * `report.ts`, which is pure. This file places them: a section per lift, a
 * column per weight class, an ordered ladder per cell. That split is what makes
 * "the state where the federation publishes two conflicting tables" a test
 * rather than a screenshot.
 *
 * WHAT REPLACED THE OLD PANELS
 *
 * There were two -- classifications under the lift entry, records under a second
 * set of questions asking which level and which event. They showed one
 * combination at a time and made a lifter re-answer to see the next. This shows
 * every classification level (requirement 7), every level of record and every
 * event at once (requirements 3 and 4), for Open and for a chosen masters or
 * juniors division side by side (requirement 2), in one or two weight classes
 * (requirement 8), in kilograms and pounds (requirement 5).
 *
 * It renders from whatever has arrived. Classifications and each record
 * partition are separate reads that settle in any order, and a report that
 * showed nothing until the last one landed would be blank for the whole time a
 * phone on gym signal is doing the work.
 */
import type {
  CategoryCatalog,
  ClassificationBook,
  Lift,
  RecordBook,
  WeightClass,
} from '@platform-toolkit/data-contracts';
// Side-effect only, and it has to be written out: this file names `ptk-notice`
// in a template and imports no value from the package, so nothing else here
// registers it. An unregistered custom element still renders its children as
// plain text, so the sentence appears -- unstyled, untoned, and with none of the
// error border §5.8 requires. The page happens to work today because a sibling
// element imports the package; a story or a test mounting this one alone does
// not, and that difference is the whole reason this line is explicit.
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  buildReport,
  nextIn,
  reachedIn,
  type RecordDetail,
  type RecordHolder,
  type Report,
  type ReportCell,
  type ReportRow,
  type ReportSection,
} from './report.js';
import {
  NO_SELECTION,
  resolveSelection,
  type CategorySelection,
  type RecordPartition,
} from './selection.js';
import { NO_ENTRIES, lifterAxesFrom, readLiftEntries, type LiftEntries } from './standards.js';

/** Where the read of this category's classification standards has got to. */
export type StandardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Where one partition's record read has got to. */
export type RecordsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * One partition's record read.
 *
 * The book *and* the state of the read, for the reason §5.8 gives: "still
 * fetching", "this federation publishes none for this level", and "the read
 * failed" are three different sentences, and a bare `RecordBook | null` can only
 * say one of them.
 */
export interface PartitionRead {
  readonly partition: RecordPartition;
  readonly status: RecordsStatus;
  readonly book: RecordBook | null;
}

@customElement('ptk-target-report')
export class PtkTargetReport extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-xl);
    }

    .context {
      margin: 0 0 var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    ptk-notice {
      margin-block-end: var(--ptk-space-md);
    }

    .section {
      margin-block-start: var(--ptk-space-lg);
    }

    .section h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-lg);
      padding-block-end: var(--ptk-space-2xs);
      border-block-end: 1px solid var(--ptk-color-border);
    }

    /*
     * One column per weight class, side by side when there is room and stacked
     * when there is not. Keyed to this element's own width rather than the
     * viewport's, so a report in a narrow embed column behaves like one on a
     * phone with no media query. The min() is load-bearing: without it a
     * container narrower than the track minimum overflows sideways instead of
     * collapsing to a single column.
     */
    .columns {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .column h4 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
      color: var(--ptk-color-text-muted);
    }

    .ladder {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-2xs);
    }

    .row {
      display: grid;
      /*
       * The weight column sizes to its content down to a floor, so every rung
       * in a cell lines up and a reader can scan the numbers without reading
       * the labels. An auto track alone lets one three-digit row shift the
       * whole column in against the two-digit rows above it.
       */
      grid-template-columns: minmax(5.5rem, auto) 1fr;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border-radius: var(--ptk-radius-sm);
      border-inline-start: 3px solid transparent;
      background: var(--ptk-color-surface-raised);
    }

    .row.record {
      background: var(--ptk-color-surface-sunken);
    }

    /*
     * A passed rung stays in the ladder, dimmed. Removing it would shorten the
     * list under a thumb and move the next row up into a finger already
     * travelling -- and a lifter needs to see what they have already got as
     * much as what is ahead.
     */
    .row.reached .weight,
    .row.reached .what {
      opacity: 0.55;
    }

    .row.next {
      border-inline-start-color: var(--ptk-color-accent);
    }

    .weight {
      display: flex;
      flex-direction: column;
      font-variant-numeric: tabular-nums;
    }

    .kilograms {
      font-weight: 600;
    }

    /*
     * Never smaller than the small step. The pound figure is the one most
     * readers here will actually use, and shrinking a converted number until it
     * reads as a footnote is how a unit becomes decoration.
     */
    .pounds {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .what {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }

    .title {
      margin: 0;
      font-weight: 600;
      /* Wrapping rather than truncation: a record's level is the whole point
         of the row, and an ellipsis at 320 px hides which one it is. */
      overflow-wrap: anywhere;
    }

    /*
     * The title doubles as the link to the federation's own table
     * (requirement 12). It is a tap target rather than an inline link inside a
     * sentence -- the row is already this tall, so the floor costs no height,
     * and the accent token is set explicitly because the document-level link
     * colour in tokens.css cannot reach inside a shadow root and the UA blue
     * has poor contrast in dark mode.
     */
    .title a {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      color: var(--ptk-color-accent);
    }

    .tags,
    .detail,
    .holder {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .flag {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-accent);
    }

    .empty,
    .notices {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .notices {
      margin-block-start: var(--ptk-space-2xs);
    }
  `;

  /** The published vocabulary. Without it there is nothing to resolve against. */
  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  /** The answered category. Half-answered is normal and has its own sentence. */
  @property({ attribute: false }) selection: CategorySelection = NO_SELECTION;

  /** This sex and equipment category's standards, or `null` if none are published. */
  @property({ attribute: false }) classifications: ClassificationBook | null = null;

  @property({ type: String }) classificationsStatus: StandardsStatus = 'idle';

  /**
   * One entry per partition the selection asks for, keyed by {@link partitionKey}.
   *
   * A map rather than one book and one status, because the reads settle
   * independently: national may arrive while the state artifact is still in
   * flight, and a report that waited for all of them would be blank for the
   * whole time a phone on gym signal is doing the work.
   */
  @property({ attribute: false }) recordReads: ReadonlyMap<string, PartitionRead> = new Map();

  /** What the lifter has entered, if anything. Only marks rungs; never adds one. */
  @property({ attribute: false }) entries: LiftEntries = NO_ENTRIES;

  override render(): TemplateResult {
    if (this.catalog === null) {
      // The categories panel above already says why -- loading, unpublished, or
      // failed -- and repeating its three-way status here would put two
      // different sentences about one read on one screen.
      return html`${nothing}`;
    }

    const resolved = resolveSelection(this.catalog, this.selection);
    if (!resolved.ready) {
      return html`
        <h2>Your report</h2>
        <ptk-notice>
          Choose ${listed(resolved.outstanding)} above and your targets appear here.
        </ptk-notice>
      `;
    }

    const report = buildReport({
      resolved,
      axes: lifterAxesFrom(resolved.selection),
      classifications: this.classifications,
      recordBooks: new Map([...this.recordReads].map(([key, read]) => [key, read.book] as const)),
    });

    return html`
      <h2>Your report</h2>
      <p class="context">
        ${contextLine(
          report,
          resolved.divisions.map((d) => d.label),
        )}
      </p>
      ${this.#renderNotices(report)}
      ${report.sections.map((section) => this.#renderSection(section, report.weightClasses))}
      ${this.#renderSourceNote(report)}
    `;
  }

  /**
   * Everything that is true about the report as a whole rather than one rung.
   *
   * Kept above the ladders and never folded. A report missing its national
   * records because one read failed looks exactly like a category the federation
   * keeps no national records in, and the difference is the difference between
   * reloading and planning around it.
   */
  #renderNotices(report: Report): TemplateResult {
    const notices: TemplateResult[] = [];

    if (this.classificationsStatus === 'loading') {
      notices.push(html`<ptk-notice>Loading the classification standards…</ptk-notice>`);
    }
    if (this.classificationsStatus === 'failed') {
      notices.push(
        html`<ptk-notice tone="error">
          The published classification standards could not be loaded. Reload the page to try again.
        </ptk-notice>`,
      );
    }

    const reads = [...this.recordReads.values()];
    const loading = reads.filter((read) => read.status === 'loading' || read.status === 'idle');
    const failed = reads.filter((read) => read.status === 'failed');
    if (loading.length > 0) {
      notices.push(html`<ptk-notice>Loading ${listed(loading.map(labelOf))} records…</ptk-notice>`);
    }
    if (failed.length > 0) {
      notices.push(
        html`<ptk-notice tone="error">
          The ${listed(failed.map(labelOf))} records could not be loaded. Reload the page to try
          again.
        </ptk-notice>`,
      );
    }

    for (const notice of report.notices) {
      notices.push(html`<ptk-notice>${notice}</ptk-notice>`);
    }

    return html`${notices}`;
  }

  #renderSection(
    section: ReportSection,
    weightClasses: readonly WeightClass[],
  ): TemplateResult | typeof nothing {
    // A lift no cell has anything for is dropped whole rather than shown as four
    // empty columns. A federation that contests no deadlift-only event still has
    // deadlift records inside full power, so this is rare -- and when it happens
    // an empty heading is noise between two sections that do have content.
    if (section.cells.every((cell) => cell.rows.length === 0 && cell.notices.length === 0)) {
      return nothing;
    }

    const lifted = this.#liftedKilograms(section.lift);
    return html`
      <section class="section">
        <h3>${section.label}</h3>
        <div class="columns">
          ${section.cells.map((cell) => this.#renderCell(cell, weightClasses.length > 1, lifted))}
        </div>
      </section>
    `;
  }

  #renderCell(cell: ReportCell, named: boolean, lifted: number | null): TemplateResult {
    const reached = reachedIn(cell.rows, lifted);
    const next = nextIn(cell.rows, lifted);

    return html`
      <div class="column">
        ${named ? html`<h4>${cell.weightClass.label}</h4>` : nothing}
        ${
          cell.rows.length === 0
            ? html`<p class="empty">Nothing is published for this lift in this category.</p>`
            : html`<ol class="ladder">
                ${cell.rows.map((row) => renderRow(row, reached.has(row.id), row.id === next))}
              </ol>`
        }
        ${cell.notices.map((notice) => html`<p class="notices">${notice}</p>`)}
      </div>
    `;
  }

  /**
   * A note about what the record links point at.
   *
   * Rendered only when at least one row carries a link, and worded carefully:
   * no federation this project reads publishes a per-record certificate, so a
   * link goes to the *table* the record lives in. Saying "certificate" over a
   * table link, or assembling a per-record URL from the axes, would produce a
   * link that resolves and shows somebody else's category.
   */
  #renderSourceNote(report: Report): TemplateResult | typeof nothing {
    const anyLinked = report.sections.some((section) =>
      section.cells.some((cell) =>
        cell.rows.some((row) => row.kind === 'record' && row.detail.sourceUrl !== null),
      ),
    );
    if (!anyLinked) {
      return nothing;
    }
    return html`<p class="context">
      Each record name links to the table the federation publishes it in, where the full category
      and every other record in it can be checked.
    </p>`;
  }

  /** What the lifter entered for one lift, in kilograms, or `null`. */
  #liftedKilograms(lift: Lift): number | null {
    const entry = readLiftEntries(this.entries)[lift];
    return entry.kind === 'weight' ? entry.kilograms : null;
  }
}

function renderRow(row: ReportRow, reached: boolean, next: boolean): TemplateResult {
  const classes = ['row', row.kind, reached ? 'reached' : '', next ? 'next' : '']
    .filter((name) => name !== '')
    .join(' ');

  return html`
    <li class=${classes}>
      <div class="weight">
        <span class="kilograms">${row.kilogramsText} kg</span>
        <span class="pounds">${row.poundsText} lb</span>
      </div>
      <div class="what">
        <p class="title">${renderTitle(row)}</p>
        ${renderTags(row, reached, next)}
        ${row.kind === 'record' ? renderRecord(row.detail) : nothing}
      </div>
    </li>
  `;
}

/**
 * The row's name, as a link when the federation publishes a table for it.
 *
 * `rel="noreferrer"` as well as `noopener`: the referrer would carry the page a
 * lifter is reading, and these tools are embedded on third-party sites where
 * that is the embedder's URL rather than ours to send.
 */
function renderTitle(row: ReportRow): TemplateResult | string {
  if (row.kind !== 'record' || row.detail.sourceUrl === null) {
    return row.title;
  }
  return html`<a href=${row.detail.sourceUrl} target="_blank" rel="noopener noreferrer"
    >${row.title}</a
  >`;
}

function renderTags(row: ReportRow, reached: boolean, next: boolean): TemplateResult {
  const tags = [row.divisionLabel, row.eventLabel].filter((tag) => tag !== null);
  return html`
    <p class="tags">
      ${tags.join(' · ')}${next ? html` <span class="flag">Next</span>` : nothing}${
        reached ? html` <span class="flag">Reached</span>` : nothing
      }
    </p>
  `;
}

/**
 * What is under a record row.
 *
 * The record itself comes first, because the headline figure above it is the
 * weight that *takes* the record and not the record -- a reader who assumes
 * otherwise plans an attempt half a kilo light. Then each condition and the
 * weight it needs, which is requirement 6: the rule turns on the level of the
 * meet, this application cannot see which meet a lifter has entered, and naming
 * one figure with no condition attached is the wrong number at every meet held
 * above the record's own level.
 */
function renderRecord(detail: RecordDetail): TemplateResult {
  return html`
    <p class="detail">Record: ${detail.record.kilogramsText} kg (${detail.record.poundsText} lb)</p>
    ${detail.targets.map(
      (target) =>
        html`<p class="detail">
          ${target.condition}: ${target.kilogramsText} kg (${target.poundsText} lb) —
          ${target.basis}.
        </p>`,
    )}
    ${
      detail.unclaimed
        ? html`<p class="holder">No lifter has claimed this record yet.</p>`
        : renderHolder(detail.holder)
    }
  `;
}

/**
 * Who holds it.
 *
 * The date stays in the published `YYYY-MM-DD`, inside a `<time datetime>`, and
 * is deliberately not localised: these tools are read wherever the federation
 * runs meets, and `03/04/2022` is two different days depending on who is holding
 * the phone.
 */
function renderHolder(holder: RecordHolder | null): TemplateResult | typeof nothing {
  if (holder === null) {
    return nothing;
  }
  const parts: (TemplateResult | string)[] = [];
  if (holder.name !== null) {
    parts.push(holder.name);
  }
  if (holder.achievedOn !== null) {
    parts.push(html`<time datetime=${holder.achievedOn}>${holder.achievedOn}</time>`);
  }
  if (holder.meetName !== null) {
    parts.push(holder.meetName);
  }
  return html`<p class="holder">
    ${parts.map((part, index) => (index === 0 ? part : html` · ${part}`))}
  </p>`;
}

/**
 * The axes the whole report shares, in one line.
 *
 * Every column below is drawn for these, and they are answered by tiles that
 * scroll off the top of a phone. Without the line, a lifter who scrolled down
 * has a screen full of figures and nothing saying whose they are.
 */
function contextLine(report: Report, divisionLabels: readonly string[]): string {
  const classes = report.weightClasses.map((weightClass) => weightClass.label);
  return `${listed(classes)} · ${listed(divisionLabels)}`;
}

function labelOf(read: PartitionRead): string {
  return read.partition.label;
}

/** "a", "a and b", "a, b and c". Shared so three call sites cannot word it three ways. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  // `join` on a slice rather than an index: `noUncheckedIndexedAccess` would
  // otherwise make reading the last item a `string | undefined` for no gain.
  return `${items.slice(0, -1).join(', ')} and ${items.slice(-1).join('')}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-report': PtkTargetReport;
  }
}
