/**
 * The report. One lift, one target type, one compact matrix at a time.
 *
 * This element is the tool. The questions above it exist to choose which
 * matrices to draw, the lift entry below it exists to mark which figures are
 * behind the lifter, and this is the thing they came for.
 *
 * WHAT REPLACED THE LADDERS, AND WHY
 *
 * The first version of this element drew every lift, every classification level
 * and every record on one page, as two independent ordered lists side by side --
 * one per weight class. Measured on an ordinary category that came to **182 rows
 * and roughly 11,900 CSS pixels**, with the two figures a lifter asked to compare
 * in two separate columns and the two-sentence record-attempt rule repeated
 * under all seventy records.
 *
 * Three changes, and each is a change to the *unit of presentation* rather than
 * to the styling:
 *
 * 1. **One lift at a time**, chosen with a bar that stays put. Four lifts on one
 *    page is four times the scrolling to reach the one being planned.
 * 2. **One target type at a time.** Classification standards and records answer
 *    different questions -- "where do I place" and "what would I take" -- and
 *    interleaving them by weight makes a reader sort them mentally before they
 *    can read either.
 * 3. **A matrix, not two lists.** Weight classes across the columns, divisions
 *    (or classification levels) down the rows, so the two numbers a lifter is
 *    comparing are on one line. The chosen age division comes first and Open sits
 *    directly under it, in the same block -- adjacency is the whole point, and
 *    the old arrangement interleaved them by weight so a lifter had to find both
 *    halves before they could compare anything.
 *
 * THE TABLES ARE REAL TABLES
 *
 * `<table>` with a `<caption>`, `th scope="col"` for the classes and
 * `th scope="row"` for the rows, one `<tbody>` per level. Not a CSS grid of
 * `div`s -- and this is not a purity argument. A grid of divs announces a naked
 * "100" with no row and no column, so the accessible name of every cell would
 * have to be duplicated into a hidden string per cell, which is both a second
 * copy of the same context and a far more verbose reading than the table
 * semantics give for free.
 *
 * That is also why classification cells carry no `aria-label`: the row heading
 * and the column heading already name them, and a label would *replace* that
 * with a hand-written string. Record cells are buttons, and a button announced
 * out of its row -- from a rotor, an element list, a tab stop -- is a bare figure
 * with no context at all, so those do carry the full name `report.ts` composed.
 *
 * THE RECORD RULE IS EXPLAINED ONCE
 *
 * The two attempt conditions are one rule about the meet a lifter has entered,
 * and this application cannot see which meet that is. It used to say so under
 * every record. Now: one short note above the matrices, one fold explaining the
 * rule, and the two figures themselves on the record a lifter actually taps.
 *
 * ARRANGEMENT, NOT ARITHMETIC
 *
 * Every figure, every sentence and every ordering decision is made in
 * `report.ts`, which is pure. This file places them. That split is what makes
 * "the federation publishes two conflicting tables" a test rather than a
 * screenshot.
 */
import type {
  CategoryCatalog,
  ClassificationBook,
  Lift,
  RecordBook,
} from '@platform-toolkit/data-contracts';
import {
  SEGMENTED_CHANGE_EVENT,
  type Choice,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui';
// Side-effect only, and it has to be written out: this file names `ptk-notice`,
// `ptk-segmented` and `ptk-disclosure` in templates and imports no value from
// the package other than types and one event name. An unregistered custom
// element still renders its children as plain text, so the sentence appears --
// unstyled, untoned, and with none of the error border §5.8 requires. The page
// happens to work today because a sibling element imports the package; a story
// or a test mounting this one alone does not, and that difference is the whole
// reason this line is explicit.
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  buildReport,
  nextIn,
  reachedIn,
  type LiftTargets,
  type Matrix,
  type MatrixCell,
  type MatrixRow,
  type RecordDetail,
  type RecordDisagreement,
  type RecordHolder,
  type Report,
  type TargetGroup,
} from './report.js';
import {
  NO_SELECTION,
  resolveSelection,
  type CategorySelection,
  type RecordPartition,
} from './selection.js';
import {
  LIFTS,
  NO_ENTRIES,
  lifterAxesFrom,
  readLiftEntries,
  type LiftEntries,
} from './standards.js';

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

/** Which family of targets is on screen. */
export type TargetType = 'classifications' | 'records';

/**
 * The two families, as the bar's options.
 *
 * Two and not three: qualification totals are a real target type and this tool
 * reads none yet, and an option that answers nothing is worse than an option
 * that is missing -- a reader taps it, gets an empty panel, and concludes the
 * federation publishes nothing rather than that the tool does not know.
 */
const TARGET_TYPE_CHOICES: readonly Choice[] = [
  { value: 'classifications', label: 'Classifications' },
  { value: 'records', label: 'Records' },
];

/** The attribute a delegated listener reads to tell the two bars apart. */
const CONTROL_ATTRIBUTE = 'data-control';

/**
 * Said once, above the matrices, instead of under all seventy records.
 *
 * Deliberately qualitative. The margins come from the published book, so naming
 * a figure here would be a second copy of the arithmetic that the day a
 * federation publishes a different increment quietly becomes false.
 */
const RECORDS_NOTE =
  'Meet level affects the attempt needed to break a record. Check which option applies at your meet.';

const RECORDS_FOLD_SUMMARY = 'How record attempts work';

/**
 * Who decides, said in the fold and again in every record detail.
 *
 * Repeated on purpose, and it is the one sentence that is: a reader who opens a
 * record without reading the fold is about to plan an attempt, and the note that
 * this application does not adjudicate one has to be where the attempt is
 * chosen.
 */
const RESPONSIBILITY_NOTE =
  'Meet sanction level and eligibility decide which record attempt is permitted. Confirm with your meet director or the federation rulebook in force.';

const CLASSIFICATIONS_NOTE =
  'Every classification level published for this category, in the classes and divisions you chose.';

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

    /*
     * The two bars sit together and stay in the same place as the panel below
     * them changes. A control that moves when it is used is a control a reader
     * has to re-find on every tap, which on a phone is most of the interaction.
     */
    .controls {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
      margin-block-end: var(--ptk-space-md);
    }

    .panel h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ptk-disclosure {
      display: block;
      margin-block-end: var(--ptk-space-md);
    }

    .fold p {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
    }

    .fold p:last-child {
      margin-block-end: 0;
    }

    .group {
      margin-block-start: var(--ptk-space-md);
    }

    .group h4 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-md);
      font-weight: 700;
    }

    .matrix {
      margin-block-end: var(--ptk-space-lg);
    }

    /*
     * Fixed layout, so a long holder-free figure cannot widen a column past the
     * phone. With the columns fixed and the text allowed to wrap, the worst case
     * is an ugly two-line number rather than a document that scrolls sideways --
     * and sideways scrolling is the failure §5.7 will not accept.
     */
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    caption {
      margin-block-end: var(--ptk-space-xs);
      text-align: start;
      font-size: var(--ptk-font-size-md);
      font-weight: 700;
    }

    th,
    td {
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      text-align: start;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    thead th {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      border-block-end: 1px solid var(--ptk-color-border-strong);
    }

    /*
     * A rule between levels, not a stripe on alternate rows. The pairing that
     * matters here is the age division with Open, and alternating colour would
     * split exactly the two rows this arrangement exists to bind together --
     * besides being invisible under forced colours and to a reader who cannot
     * separate two hues.
     */
    tbody + tbody th,
    tbody + tbody td {
      border-block-start: 1px solid var(--ptk-color-border);
    }

    tbody th {
      font-weight: 400;
    }

    .level {
      display: block;
      font-weight: 700;
    }

    .division {
      display: block;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * Tabular figures, because the whole reason for the matrix is that a reader
     * can compare two numbers by their shape without reading them digit by
     * digit. Proportional numerals put the same digit in a different place on
     * every row and quietly undo that.
     */
    .figure {
      display: flex;
      flex-direction: column;
      font-variant-numeric: tabular-nums;
    }

    .kilograms {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
      line-height: 1.2;
    }

    /*
     * Never smaller than the small step. A lifter who trains in pounds is
     * reading this column, and shrinking a converted number until it looks like
     * a footnote is how a unit becomes decoration (requirement 5).
     */
    .pounds {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .empty-figure {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * A record cell is a button, because there is more to say about it than
     * fits. The comfortable floor rather than the 44px minimum: this is tapped
     * repeatedly, one-handed, while reading (see tokens.css).
     */
    .cell-button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--ptk-space-xs);
      width: 100%;
      min-height: var(--ptk-tap-target-comfortable);
      margin: 0;
      padding: var(--ptk-space-xs);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-sm);
      background: var(--ptk-color-surface-raised);
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }

    .caret {
      flex: none;
      color: var(--ptk-color-text-muted);
    }

    /*
     * A reached figure stays where it is, dimmed. Removing it would shorten the
     * table under a thumb, and a lifter needs to see what they already have as
     * much as what is ahead.
     */
    .reached .figure {
      opacity: 0.55;
    }

    /*
     * The mark is a word, not a colour. The accent is the second signal and
     * never the only one -- forced colours discards it, and so does a reader who
     * cannot separate the two hues.
     */
    .flag {
      display: inline-block;
      font-size: var(--ptk-font-size-sm);
      font-weight: 700;
      color: var(--ptk-color-accent);
    }

    /*
     * The record detail, immediately below its own matrix.
     *
     * An inline disclosure rather than a dialog. A dialog here would have to
     * move focus, trap it, restore it and make the page behind it inert, and a
     * partial implementation of that is worse for a screen reader than none --
     * it promises behaviour that is not there. A disclosure leaves focus on the
     * button that opened it, which is both correct and what a thumb expects.
     */
    .detail {
      margin-block-end: var(--ptk-space-md);
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface-raised);
    }

    .detail-title {
      margin: 0 0 var(--ptk-space-xs);
      font-weight: 700;
    }

    .record-figure {
      margin: 0 0 var(--ptk-space-sm);
      font-variant-numeric: tabular-nums;
    }

    .record-figure .kilograms {
      display: inline;
    }

    .attempts {
      list-style: none;
      margin: 0 0 var(--ptk-space-sm);
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    .attempt {
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border-inline-start: 3px solid var(--ptk-color-accent);
      background: var(--ptk-color-surface);
    }

    .attempt-label {
      display: block;
      font-weight: 700;
    }

    .attempt-weight {
      display: block;
      font-variant-numeric: tabular-nums;
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
    }

    .attempt-condition,
    .attempt-basis {
      display: block;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .responsibility,
    .holder {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * A rule down the side as well as a colour, for the reason the flag gives.
     * This is the one sentence in a detail that changes what the figure above it
     * means, so it has to be distinguishable without colour, and it keeps the
     * full text colour rather than the muted tone.
     */
    .caution {
      margin: 0 0 var(--ptk-space-sm);
      padding-inline-start: var(--ptk-space-xs);
      border-inline-start: 2px solid var(--ptk-color-accent);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text);
    }

    /*
     * Its own line, not inside a sentence. An inline link is exactly as tall as
     * its line box, and vertical padding on an inline box grows the hit area
     * without growing the line -- so the only way to reach the tap floor from
     * inside a paragraph is to overlap the prose above it. The accent is set
     * explicitly because the document-level link colour cannot reach into a
     * shadow root.
     */
    .source-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      color: var(--ptk-color-accent);
    }

    .empty,
    .notices {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
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
   * One entry per partition the selection asks for, keyed by `partitionKey`.
   *
   * A map rather than one book and one status, because the reads settle
   * independently: national may arrive while the state artifact is still in
   * flight, and a report that waited for all of them would be blank for the
   * whole time a phone on gym signal is doing the work.
   */
  @property({ attribute: false }) recordReads: ReadonlyMap<string, PartitionRead> = new Map();

  /** What the lifter has entered, if anything. Only marks figures; never adds one. */
  @property({ attribute: false }) entries: LiftEntries = NO_ENTRIES;

  /**
   * Which lift and which target type a fresh report opens on.
   *
   * Seeds -- read once, on the first update, and never again. Two bars decide
   * these afterwards and the element owns the answer, so binding them as live
   * properties would let the next parent render put the bar back where the
   * lifter moved it away from, on a screen whose whole navigation is those two
   * bars. A seed cannot do that and is still enough for a story to open on the
   * records half of the tool, and later for a returning visit to open where the
   * last one left off.
   */
  @property({ attribute: false }) initialLift: Lift = 'squat';

  @property({ attribute: false }) initialTargetType: TargetType = 'classifications';

  /**
   * Which lift is on screen.
   *
   * In-session state rather than a persisted preference, for now. Remembering it
   * across visits is worth doing and is a different change: it needs the same
   * treatment as the rest of the context, and a half-restored screen -- the lift
   * remembered, the category not -- is more confusing than a fresh one.
   */
  @state() private selectedLift: Lift = 'squat';

  @state() private targetType: TargetType = 'classifications';

  /**
   * The one record whose detail is open, by cell identifier.
   *
   * One at a time. Several open folds push the matrices apart until the
   * comparison the layout exists for is off the screen, and a reader who opened
   * three has lost the arrangement rather than gained three answers.
   */
  @state() private openCellId: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmentedChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmentedChange);
    super.disconnectedCallback();
  }

  /**
   * Apply the seeds, once.
   *
   * In `willUpdate` rather than `firstUpdated` so the first paint is already on
   * the right lift: assigning after the first render would draw the squat's
   * classifications, then replace them, which on a slow phone is a visible flash
   * of somebody else's numbers. Guarded by `hasUpdated` rather than by comparing
   * values, because a lifter who moves the bar back to the seeded value has made
   * a choice and a value comparison cannot tell that from never having moved.
   */
  protected override willUpdate(): void {
    if (!this.hasUpdated) {
      this.selectedLift = this.initialLift;
      this.targetType = this.initialTargetType;
    }
  }

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
        <h2>Targets</h2>
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

    const lift = report.lifts.find((entry) => entry.lift === this.selectedLift) ?? report.lifts[0];

    return html`
      <h2>Targets</h2>
      <p class="context">${contextLine(report)}</p>
      ${this.#renderNotices(report)}
      <div class="controls">
        <ptk-segmented
          data-control="lift"
          label="Lift"
          .choices=${report.lifts.map((entry) => ({ value: entry.lift, label: entry.label }))}
          .value=${this.selectedLift}
        ></ptk-segmented>
        <ptk-segmented
          data-control="target-type"
          label="Targets"
          .choices=${TARGET_TYPE_CHOICES}
          .value=${this.targetType}
        ></ptk-segmented>
      </div>
      ${lift === undefined ? nothing : this.#renderPanel(lift)}
    `;
  }

  /**
   * Everything that is true about the report as a whole rather than one figure.
   *
   * Kept above the matrices and never folded. A report missing its national
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

  /** One lift, one target type: the whole of what is on screen below the bars. */
  #renderPanel(lift: LiftTargets): TemplateResult {
    const records = this.targetType === 'records';
    const groups = records ? lift.records : lift.classifications;
    const notices = records ? lift.recordNotices : lift.classificationNotices;
    const lifted = this.#liftedKilograms(lift.lift);
    const reached = reachedIn(groups, lifted);
    const next = nextIn(groups, lifted);

    return html`
      <section class="panel" aria-labelledby="panel-heading">
        <h3 id="panel-heading">${lift.label}</h3>
        ${records ? this.#renderRecordsHelp() : html`<p class="note">${CLASSIFICATIONS_NOTE}</p>`}
        ${notices.map((notice) => html`<p class="notices">${notice}</p>`)}
        ${
          groups.length === 0
            ? html`<p class="empty">${emptyPanelSentence(records)}</p>`
            : groups.map((group) => this.#renderGroup(group, reached, next))
        }
      </section>
    `;
  }

  /** The rule, once: a short note and a fold, above every record matrix. */
  #renderRecordsHelp(): TemplateResult {
    return html`
      <p class="note">${RECORDS_NOTE}</p>
      <ptk-disclosure label=${RECORDS_FOLD_SUMMARY} summary=${RECORDS_FOLD_SUMMARY}>
        <div class="fold">
          <p>
            A record is taken by beating it, and by how much depends on the level of the meet you
            enter compared with the level of the record. Tap a record to see both figures.
          </p>
          <p>
            <strong>Chip target</strong> applies at a meet of the record's own level or below it.
            <strong>Full increment</strong> applies at a meet above it, and is the larger of the
            two.
          </p>
          <p>
            Records are set in kilograms. A pound figure is only a conversion and is never used to
            work out an attempt.
          </p>
          <p>${RESPONSIBILITY_NOTE}</p>
        </div>
      </ptk-disclosure>
    `;
  }

  #renderGroup(
    group: TargetGroup,
    reached: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ): TemplateResult {
    return html`
      <div class="group">
        ${group.heading === null ? nothing : html`<h4>${group.heading}</h4>`}
        ${group.matrices.map((matrix) => this.#renderMatrix(matrix, reached, next))}
      </div>
    `;
  }

  #renderMatrix(
    matrix: Matrix,
    reached: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ): TemplateResult {
    // The open detail belongs to this matrix only when one of its own cells is
    // the open one, so a reader who opens a national record and scrolls to the
    // state table does not find the panel following them down the page.
    //
    // The predicate narrows rather than merely filtering so that the render below
    // asks one question instead of two. Asking twice is not just longer: the
    // second question reads as though a cell could be open and detail-less, which
    // is exactly the state this `find` exists to exclude.
    const open = matrix.rows
      .flatMap((row) => row.cells)
      .find(
        (cell): cell is MatrixCell & { readonly detail: RecordDetail } =>
          cell.id === this.openCellId && cell.detail !== null,
      );

    return html`
      <div class="matrix">
        <table>
          <caption>
            ${matrix.caption}
          </caption>
          <thead>
            <tr>
              <td></td>
              ${matrix.weightClasses.map(
                (weightClass) => html`<th scope="col">${weightClass.label}</th>`,
              )}
            </tr>
          </thead>
          ${groupRows(matrix.rows).map(
            (rows) => html`
              <tbody>
                ${rows.map((row) => this.#renderRow(row, reached, next))}
              </tbody>
            `,
          )}
        </table>
        ${open === undefined ? nothing : renderDetail(open.id, open.detail)}
      </div>
    `;
  }

  #renderRow(
    row: MatrixRow,
    reached: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ): TemplateResult {
    return html`
      <tr>
        <th scope="row">
          <span class="level">${row.label}</span>
          ${
            row.divisionLabel === null
              ? nothing
              : html`<span class="division">${row.divisionLabel}</span>`
          }
        </th>
        ${row.cells.map((cell) => this.#renderCell(cell, reached.has(cell.id), next.has(cell.id)))}
      </tr>
    `;
  }

  #renderCell(cell: MatrixCell, reached: boolean, next: boolean): TemplateResult {
    if (cell.value === null) {
      return html`<td><span class="empty-figure">${cell.emptyLabel}</span></td>`;
    }

    const figure = html`
      <span class="figure">
        <span class="kilograms">${cell.value.kilogramsText} kg</span>
        <span class="pounds">${cell.value.poundsText} lb</span>
        ${flagFor(reached, next)}
      </span>
    `;

    if (cell.detail === null) {
      return html`<td class=${reached ? 'reached' : nothing}>${figure}</td>`;
    }

    const open = this.openCellId === cell.id;
    return html`
      <td class=${reached ? 'reached' : nothing}>
        <button
          type="button"
          class="cell-button"
          aria-label=${cell.accessibleName}
          aria-expanded=${open ? 'true' : 'false'}
          aria-controls=${open ? domId(cell.id) : nothing}
          @click=${() => {
            this.#toggleCell(cell.id);
          }}
        >
          ${figure}<span class="caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
      </td>
    `;
  }

  #toggleCell(id: string): void {
    this.openCellId = this.openCellId === id ? null : id;
  }

  /**
   * Both bars, one listener.
   *
   * `composedPath()` and not `event.target`: a listener on a Lit host sees the
   * target **retargeted to the host itself** for anything fired inside a child's
   * own shadow tree, so reading `target.dataset` finds nothing and every answer
   * is silently dropped -- a page whose controls visibly respond while nothing
   * changes, which reads as a rendering bug rather than an event one.
   *
   * The value is checked against a known list before it is stored. It arrives as
   * a string from the DOM, and a typo in a template would otherwise select a
   * lift that does not exist and blank the panel.
   */
  #onSegmentedChange = (event: CustomEvent<SegmentedChangeDetail>): void => {
    const control = event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.hasAttribute(CONTROL_ATTRIBUTE),
      );
    if (control === undefined) {
      return;
    }
    const value = event.detail.value;
    if (control.getAttribute(CONTROL_ATTRIBUTE) === 'lift' && isLift(value)) {
      this.selectedLift = value;
      // A detail belongs to a record in the lift that was on screen. Leaving it
      // open would draw somebody else's record under a table it is not in.
      this.openCellId = null;
      return;
    }
    if (control.getAttribute(CONTROL_ATTRIBUTE) === 'target-type' && isTargetType(value)) {
      this.targetType = value;
      this.openCellId = null;
    }
  };

  /** What the lifter entered for one lift, in kilograms, or `null`. */
  #liftedKilograms(lift: Lift): number | null {
    const entry = readLiftEntries(this.entries)[lift];
    return entry.kind === 'weight' ? entry.kilograms : null;
  }
}

/**
 * One record, opened.
 *
 * The record itself is visually first and largest, because it is the published
 * fact; the attempts follow it, because each is conditional and a reader has to
 * know which condition they are under before either figure means anything.
 */
function renderDetail(cellId: string, detail: RecordDetail): TemplateResult {
  return html`
    <div class="detail" id=${domId(cellId)} role="group" aria-label=${detail.scopeLabel}>
      <p class="detail-title">${detail.scopeLabel}</p>
      <p class="record-figure">
        Current record
        <span class="kilograms">${detail.record.kilogramsText} kg</span>
        (${detail.record.poundsText} lb)
      </p>
      <ul class="attempts">
        ${detail.attempts.map(
          (attempt) => html`
            <li class="attempt">
              <span class="attempt-label">${attempt.label}</span>
              <span class="attempt-weight">${attempt.kilogramsText} kg</span>
              <span class="attempt-condition">
                ${attempt.condition} · ${attempt.poundsText} lb
              </span>
              <span class="attempt-basis">${attempt.basis}</span>
            </li>
          `,
        )}
      </ul>
      <p class="responsibility">${RESPONSIBILITY_NOTE}</p>
      ${renderDisagreement(detail.disagreement)}
      ${
        detail.unclaimed
          ? html`<p class="holder">No lifter has claimed this record yet.</p>`
          : renderHolder(detail.holder)
      }
      ${renderSourceLink(detail)}
    </div>
  `;
}

/**
 * The link out to the federation's own table (requirement 12).
 *
 * The accessible name carries the record's whole scope. Seventy links all named
 * "National record" is a link list with no way to tell one from another, which
 * is a real failure and not a theoretical one -- and this is why the detail
 * carries `scopeLabel` rather than the element reassembling it.
 *
 * `rel="noreferrer"` as well as `noopener`: the referrer would carry the page a
 * lifter is reading, and these tools are embedded on third-party sites where
 * that is the embedder's URL rather than ours to send.
 *
 * No federation this project reads publishes a per-record certificate, so this
 * goes to the *table* the record lives in. Assembling a per-record URL from the
 * axes would produce a link that resolves and shows somebody else's category.
 */
function renderSourceLink(detail: RecordDetail): TemplateResult | typeof nothing {
  if (detail.sourceUrl === null) {
    return nothing;
  }
  return html`<a
    class="source-link"
    href=${detail.sourceUrl}
    target="_blank"
    rel="noopener noreferrer"
    aria-label=${`Published table for ${detail.scopeLabel}`}
    >Published table</a
  >`;
}

/**
 * The caution shown when the federation's own two columns disagree.
 *
 * It names both numbers and then says which one this application used. A caution
 * that only said "this figure may be wrong" would give a lifter a reason to
 * distrust a record with no way to resolve it — and the link below is the only
 * place the question can be settled.
 *
 * Not a `ptk-notice`: this is a sentence inside a panel, and the notice element
 * draws a bordered box meant to stand in for content that is absent. The content
 * here is present; what is uncertain is one of its two spellings.
 */
function renderDisagreement(
  disagreement: RecordDisagreement | null,
): TemplateResult | typeof nothing {
  if (disagreement === null) {
    return nothing;
  }
  return html`<p class="caution">
    The federation's table also prints this record as ${disagreement.poundsText} lb, which is
    ${disagreement.impliedKilogramsText} kg. Records are set in kilograms, so the kilogram figure is
    the one shown above — check the table before planning against either.
  </p>`;
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

/** "Reached" or "Next", as a word. Never a colour on its own. */
function flagFor(reached: boolean, next: boolean): TemplateResult | typeof nothing {
  if (reached) {
    return html`<span class="flag">Reached</span>`;
  }
  if (next) {
    return html`<span class="flag">Next</span>`;
  }
  return nothing;
}

/**
 * Consecutive rows that share a `groupId`, as one `<tbody>` each.
 *
 * Consecutive rather than collected, because the order `report.ts` produced is
 * the order to render: gathering by identifier would silently reorder the table
 * if a group ever appeared twice, and the reordering is the kind of thing that
 * looks fine until somebody compares two divisions that are no longer adjacent.
 */
function groupRows(rows: readonly MatrixRow[]): readonly (readonly MatrixRow[])[] {
  const groups: MatrixRow[][] = [];
  let currentId: string | null = null;
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last === undefined || row.groupId !== currentId) {
      groups.push([row]);
      currentId = row.groupId;
    } else {
      last.push(row);
    }
  }
  return groups;
}

/**
 * A cell identifier, made safe to put in an `id` and an `aria-controls`.
 *
 * The identifiers carry colons and slugs straight from the published data.
 * Colons are legal in an HTML identifier and are a nuisance everywhere else --
 * a CSS selector, a test's `querySelector` -- so they are flattened once, here,
 * rather than escaped at every reader.
 */
function domId(cellId: string): string {
  return `detail-${cellId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function emptyPanelSentence(records: boolean): string {
  return records
    ? 'No records are published for this lift in this category. The first qualifying lift sets one.'
    : 'No classification standards are published for this lift in this category.';
}

/**
 * The axes the whole report shares, in one line.
 *
 * Every matrix below is drawn for these, and they are answered by controls that
 * scroll off the top of a phone. Without the line, a lifter who scrolled down
 * has a screen full of figures and nothing saying whose they are.
 */
function contextLine(report: Report): string {
  const classes = report.weightClasses.map((weightClass) => weightClass.label);
  return `${listed(classes)} · ${listed(report.divisions.map((division) => division.label))}`;
}

function labelOf(read: PartitionRead): string {
  return read.partition.label;
}

function isLift(value: string): value is Lift {
  return LIFTS.some((lift) => lift === value);
}

function isTargetType(value: string): value is TargetType {
  return value === 'classifications' || value === 'records';
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
