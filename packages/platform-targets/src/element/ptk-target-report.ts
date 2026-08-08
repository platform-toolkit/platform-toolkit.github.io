// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
 * Every published figure is a button, because every published figure is
 * something a lifter can commit to, and each carries the full name `report.ts`
 * composed. A button announced out of its row -- from a rotor, an element list, a
 * tab stop -- is a bare figure with no context at all, and the table semantics
 * that name it in place cannot reach any of those.
 *
 * NOTHING IS SAVED BY TAPPING A NUMBER
 *
 * A cell opens a panel; the panel has the button that saves. One tap saving a
 * goal would be shorter and would also mean a thumb dragging a matrix of fourteen
 * figures down the screen fills the tray by accident -- and a goal a lifter did
 * not set is worse than one that took two taps. It also gives both target types
 * the same shape: choose the figure, read what it is, commit.
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
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-segmented';
import { type Choice } from '@platform-toolkit/ui/ptk-choice-group';
import {
  SEGMENTED_CHANGE_EVENT,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui/ptk-segmented';
// Side-effect only, and it has to be written out: this file names `ptk-notice`,
// `ptk-segmented` and `ptk-disclosure` in templates and imports no value from
// the package other than types and one event name. An unregistered custom
// element still renders its children as plain text, so the sentence appears --
// unstyled, untoned, and with none of the error border §5.8 requires. The page
// happens to work today because a sibling element imports the package; a story
// or a test mounting this one alone does not, and that difference is the whole
// reason this line is explicit.
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { REFRESH_REQUEST_EVENT, categoryPhrase } from '../core/freshness.js';
import { describeGoal, goalKey, type GoalTarget } from '../core/goals.js';
import {
  buildReport,
  nextIn,
  reachedIn,
  type Figures,
  type LiftTargets,
  type Matrix,
  type MatrixCell,
  type MatrixRow,
  type RecordDetail,
  type RecordDisagreement,
  type RecordHolder,
  type Report,
  type TargetGroup,
} from '../core/report.js';
import { NO_SELECTION, resolveSelection } from '../core/selection.js';
import type { CategorySelection, RecordPartition, TargetType } from '../types.js';
import {
  LIFTS,
  NO_ENTRIES,
  lifterAxesFrom,
  readLiftEntries,
  type LiftEntries,
} from '../core/standards.js';

/** The tag this element registers under. Written to the registry only by `element/index.ts`. */
export const TARGET_REPORT_TAG = 'ptk-target-report';

/** Where the read of this category's classification standards has got to. */
export type StandardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Where one partition's record read has got to.
 *
 * There is deliberately no per-partition "this book may have been superseded"
 * state. It was written and removed: nothing could reach it, because a read is
 * only ever issued for a partition holding no book (`view.ts` says why), so the
 * notice was a screen no lifter could arrive at and a story that documented
 * fiction. Whether what is on screen is the newest publication is a question
 * about the whole of `meta.json` rather than about one level of records, and
 * `ptk-target-freshness` is where it is asked and answered.
 */
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

/**
 * Where the two navigation bars now stand.
 *
 * Both, on either bar's move, rather than only the one that moved. A listener
 * remembering this for the next visit wants the pair -- and a listener that had
 * to keep its own copy of the other half would be a second place for the answer
 * to live, out of step with this element the moment a seed changes.
 */
export interface ViewChangeDetail {
  readonly lift: Lift;
  readonly targetType: TargetType;
}

/**
 * Fired when the lifter moves either bar.
 *
 * The element still owns the answer -- the bars are `@state` here and the
 * incoming ones are seeds (see {@link PtkTargetReport.initialLift}). This is a
 * notification, not a handover: nothing above is expected to send the value
 * back, and a parent that did would put a bar back where the lifter moved it
 * away from.
 */
export const VIEW_CHANGE_EVENT = 'ptk-view-change';

/** A lifter has pressed the button under a figure. */
export interface GoalRequestDetail {
  readonly target: GoalTarget;
  /** Which way. `remove` is the immediate undo of a `save` in the same panel. */
  readonly action: 'save' | 'remove';
}

/**
 * Fired when a lifter commits to a figure, or takes the commitment back.
 *
 * A request rather than a change, and the distinction is the whole arrangement:
 * this element draws figures and does not own the list. The root above it holds
 * the goals, applies the rules that can refuse one -- the list is full, the
 * identifier is unstorable -- writes them to the device, and hands back
 * {@link PtkTargetReport.savedGoals} and a sentence. An element that saved its
 * own would have to be told what the tray beside it had already removed.
 */
export const GOAL_REQUEST_EVENT = 'ptk-goal-request';

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

export class PtkTargetReport extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-xl);
    }

    /*
     * Spelled out here because the document rule in tokens.css cannot reach
     * into a shadow root, and the heading is focusable (see focusHeading).
     *
     * (No backticks in this comment: they would end the css template -- see the
     * gotcha in CLAUDE.md 5.8.)
     *
     * The selector is :focus-visible and not :focus, which is the whole reason the heading
     * can be focused at all without looking wrong: a lifter who tapped "Show
     * targets" with a thumb gets no ring, and a lifter who pressed it with a
     * keyboard gets one and can see where they landed.
     */
    h2:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
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
    .notices,
    .updating {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * The shape of the table that is coming, so a reader can tell "on its way"
     * from "nothing here" without reading either sentence. Bars rather than a
     * spinner: a spinner says only that something is happening, where the wrong
     * conclusion available here is about what the answer will be.
     *
     * No animation at all. A shimmer at the foot of a report is motion a lifter
     * cannot dismiss, and it would need its own reduced-motion branch to be
     * honest about; a static block says the same thing and needs no exception.
     */
    .skeleton {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
      margin-block-end: var(--ptk-space-lg);
    }

    .skeleton-row {
      display: block;
      height: var(--ptk-tap-target-comfortable);
      border-radius: var(--ptk-radius-sm);
      background: var(--ptk-color-surface-raised);
      /*
       * A border as well as a fill, because a raised surface against a plain one
       * is a contrast a forced-colours mode discards entirely -- leaving three
       * invisible boxes where the placeholder was.
       */
      border: 1px solid var(--ptk-color-border);
    }

    /*
     * The notice and its action, kept together as one block so a second failure
     * below cannot come between a sentence and the button that answers it.
     */
    .failure {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--ptk-space-sm);
      margin-block-end: var(--ptk-space-md);
    }

    .failure ptk-notice {
      margin-block-end: 0;
    }

    /*
     * Always in the document, empty when there is nothing to say.
     *
     * A live region created at the moment its text appears is a live region a
     * screen reader has not been watching, and the announcement is lost. So the
     * paragraph is rendered on every pass and only its contents change -- which
     * is also why it collapses to nothing rather than reserving a line.
     */
    .goal-status {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text);
    }

    .goal-status:empty {
      margin: 0;
    }

    .detail-scope {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * The commitment, at the comfortable tap floor and full width.
     *
     * Full width because it is the one action in the panel and a narrow button
     * beside a wide one reads as the lesser of two choices; there is no second
     * choice here.
     */
    .goal-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--ptk-tap-target-comfortable);
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-sm);
      background: var(--ptk-color-surface);
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    /*
     * A saved button says so in words and is drawn differently as well. The
     * accent rule is the second signal and never the only one -- the label
     * changes too, so forced colours and a reader who cannot separate two hues
     * both still get the answer.
     */
    .goal-button[data-saved] {
      border-color: var(--ptk-color-accent);
      border-inline-start-width: 3px;
    }

    .attempt .goal-button {
      margin-block-start: var(--ptk-space-xs);
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
   * The keys of every goal this device has saved, from {@link goalKey}.
   *
   * Keys and not the goals themselves: this element asks one question of the set
   * -- is this figure already committed to -- and handing it the whole list would
   * let it read a saved weight and print that instead of the published one, which
   * is how a corrected standard comes to be shown as the figure it used to be.
   */
  @property({ attribute: false }) savedGoals: ReadonlySet<string> = new Set();

  /**
   * What just happened to the list, for the live region under the bars.
   *
   * Set by the root, because the root is what applied the change and is the only
   * thing that knows a save was refused. Empty means nothing to announce, which
   * is the ordinary state.
   */
  @property({ attribute: false }) goalMessage = '';

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

  /**
   * Puts focus on the result heading.
   *
   * Called by the composition root after a lifter presses "Show targets", which
   * replaces the whole screen: the button they pressed no longer exists, and
   * focus left on a removed element falls back to the document body, so a
   * keyboard user's next Tab starts again from the top of the page and a screen
   * reader is told nothing at all about the thing they just asked for.
   *
   * The heading rather than the first control, because the heading is the
   * announcement -- "Targets" and then the context under it -- and landing on a
   * control skips straight past what changed. It carries `tabindex="-1"` so it
   * can be focused without joining the tab order; a heading a lifter has to Tab
   * through on the way to the bars is a heading in the way.
   *
   * Silent when there is no heading. The catalogue can still be in flight, and
   * a root that had to know which of this element's branches rendered would be
   * a root that knows this element's template.
   */
  focusHeading(): void {
    this.shadowRoot?.querySelector<HTMLElement>('h2')?.focus();
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
        <h2 tabindex="-1">Targets</h2>
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
      <h2 tabindex="-1">Targets</h2>
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
      <p class="goal-status" role="status">${this.goalMessage}</p>
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
      notices.push(html`<ptk-notice>Updating the classification standards…</ptk-notice>`);
    }
    if (this.classificationsStatus === 'failed') {
      notices.push(
        this.#renderFailure(
          html`<ptk-notice tone="error">
            The published classification standards could not be loaded.
          </ptk-notice>`,
        ),
      );
    }

    const reads = [...this.recordReads.values()];
    const loading = reads.filter((read) => read.status === 'loading' || read.status === 'idle');
    const failed = reads.filter((read) => read.status === 'failed');
    if (loading.length > 0) {
      notices.push(
        html`<ptk-notice>Updating ${listed(loading.map(labelOf))} records…</ptk-notice>`,
      );
    }
    if (failed.length > 0) {
      notices.push(
        this.#renderFailure(
          html`<ptk-notice tone="error">
            The ${listed(failed.map(labelOf))} records could not be loaded.
          </ptk-notice>`,
        ),
      );
    }
    // There is deliberately no "we could not refresh these" notice beside those
    // two. Whether the figures on screen are the newest published ones is a
    // question about the whole of `meta.json` rather than about one partition --
    // a partition read is only ever issued for a partition holding no book, so a
    // failure here always leaves the cells empty and is already the sentence
    // above. The publication-level version of that sentence is the footer's.

    for (const notice of report.notices) {
      notices.push(html`<ptk-notice>${notice}</ptk-notice>`);
    }

    return html`${notices}`;
  }

  /**
   * A read that did not answer, with the one thing a lifter can do about it.
   *
   * "Reload the page to try again" is what these notices used to say, and it was
   * the wrong instruction twice over: a reload on gym signal costs the whole
   * shell and every artifact that *did* arrive, and it throws away the context,
   * the lift, the target type and the open detail -- so the price of retrying one
   * failed partition was re-answering the report. The button re-issues the reads
   * and nothing else. The event is composed and the transport listens on the
   * tool's host, so nothing between here and there has to forward it.
   */
  #renderFailure(notice: TemplateResult): TemplateResult {
    return html`
      <div class="failure">
        ${notice}
        <ptk-button class="retry" @click=${this.#onRetry}>Try again</ptk-button>
      </div>
    `;
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
            ? this.#renderEmpty(records)
            : groups.map((group) => this.#renderGroup(group, reached, next))
        }
      </section>
    `;
  }

  /**
   * Nothing to draw yet, or nothing to draw at all -- and never the same words.
   *
   * "No published target was found" is a *finding*, and printing it while the
   * artifact that would contradict it is still on the wire is the tool asserting
   * something it has not established. On gym signal that window is seconds long
   * and it lands on exactly the reader least able to check: they read that their
   * category is empty, put the phone away, and never see the figures arrive.
   *
   * So a read in flight gets the skeleton instead. It is matrix-shaped rather
   * than a spinner because the shape is the promise -- a reader can see that a
   * table is coming and roughly how much of one -- and it is `aria-hidden`
   * because grey bars have nothing to announce; the sentence above them carries
   * the whole meaning for anyone not looking at the layout.
   */
  #renderEmpty(records: boolean): TemplateResult {
    if (this.#reading(records)) {
      return html`
        <p class="updating">Updating targets…</p>
        <div class="skeleton" aria-hidden="true">
          ${[0, 1, 2].map(() => html`<span class="skeleton-row"></span>`)}
        </div>
      `;
    }
    return html`<p class="empty">${emptyPanelSentence(records, this.catalog?.label ?? null)}</p>`;
  }

  /**
   * Whether an artifact that could fill this panel is still on the wire.
   *
   * `idle` counts, and has to: it is the tick between a lifter pressing "Show
   * targets" and the transport issuing the read, and treating it as settled makes
   * the first paint of every visit assert that the category is empty. An empty
   * read map is the same tick arriving a moment earlier -- a resolved selection
   * always asks for the world and national partitions (requirement 3), so no
   * entries at all means the watcher has not run rather than that this federation
   * keeps no records.
   */
  #reading(records: boolean): boolean {
    if (!records) {
      return this.classificationsStatus === 'loading' || this.classificationsStatus === 'idle';
    }
    return (
      this.recordReads.size === 0 ||
      [...this.recordReads.values()].some(
        (read) => read.status === 'loading' || read.status === 'idle',
      )
    );
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
    // The open panel belongs to this matrix only when one of its own cells is the
    // open one, so a reader who opens a national record and scrolls to the state
    // table does not find the panel following them down the page.
    const open = matrix.rows
      .flatMap((row) => row.cells)
      .find((cell) => cell.id === this.openCellId);

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
        ${open === undefined ? nothing : this.#renderOpenCell(open)}
      </div>
    `;
  }

  /**
   * Whichever panel the open cell has.
   *
   * A record has a detail: the published figure, and the two weights that take
   * it. A classification has only itself, so its panel names the standard and
   * offers the one button. Both are the same box in the same place, because they
   * are the same interaction -- a figure, what it is, and whether to commit.
   */
  #renderOpenCell(cell: MatrixCell): TemplateResult | typeof nothing {
    if (cell.detail !== null) {
      return this.#renderDetail(cell.id, cell.detail);
    }
    if (cell.goal !== null && cell.value !== null) {
      return this.#renderStandard(cell.id, cell.goal, cell.value);
    }
    return nothing;
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
        ${flagFor(reached, next)}${this.#isSaved(cell) ? html`<span class="flag">Goal</span>` : nothing}
      </span>
    `;

    // Nothing published and nothing to commit to. Unreachable while every figure
    // is one or the other, and listed rather than assumed: a target type added
    // with neither would otherwise render a button that opens an empty box.
    if (cell.detail === null && cell.goal === null) {
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
   * Whether this figure is already committed to.
   *
   * A record cell asks about its *attempts* rather than about itself, because a
   * record is not a target and carries no goal of its own. Either attempt saved
   * marks the cell, so a lifter scanning a matrix can see which records they are
   * chasing without opening each one.
   */
  #isSaved(cell: MatrixCell): boolean {
    if (cell.goal !== null) {
      return this.savedGoals.has(goalKey(cell.goal));
    }
    return (
      cell.detail?.attempts.some((attempt) => this.savedGoals.has(goalKey(attempt.goal))) ?? false
    );
  }

  /**
   * One record, opened.
   *
   * The record itself is visually first and largest, because it is the published
   * fact; the attempts follow it, because each is conditional and a reader has to
   * know which condition they are under before either figure means anything --
   * and each carries its own button, because the goal is the attempt and not the
   * record.
   */
  #renderDetail(cellId: string, detail: RecordDetail): TemplateResult {
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
                ${this.#renderGoalButton(
                  attempt.goal,
                  `${attempt.label}, ${attempt.kilogramsText} kilograms, ${detail.scopeLabel}`,
                )}
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
   * One classification standard, opened.
   *
   * Named by {@link describeGoal} rather than by anything assembled here, so the
   * panel a lifter commits in and the tray listing it afterwards cannot call one
   * figure two things. There is nothing to disclose beyond the name and the
   * figure -- a standard is the same weight whatever meet it is hit at, which is
   * the whole difference between it and a record -- so the panel is short by
   * design and exists for the button.
   */
  #renderStandard(cellId: string, goal: GoalTarget, value: Figures): TemplateResult {
    const description = describeGoal(goal, {
      catalog: this.catalog,
      classifications: this.classifications,
    });
    const spoken = joinedName(description.title, description.scope);
    return html`
      <div class="detail" id=${domId(cellId)} role="group" aria-label=${spoken}>
        <p class="detail-title">${description.title}</p>
        <p class="detail-scope">${description.scope}</p>
        <p class="record-figure">
          <span class="kilograms">${value.kilogramsText} kg</span>
          (${value.poundsText} lb)
        </p>
        ${this.#renderGoalButton(goal, spoken)}
      </div>
    `;
  }

  /**
   * The commitment, and the way back out of it.
   *
   * One button rather than a button and a separate undo. The review asks for an
   * "Undo" after a save, and that word is right for the two seconds after a tap
   * and wrong on the next visit, when the same button is still there and the
   * lifter is not undoing anything. "Remove" is true at both moments; the
   * immediacy the review wanted comes from the button being in the same place
   * rather than from the word.
   */
  #renderGoalButton(target: GoalTarget, spoken: string): TemplateResult {
    const saved = this.savedGoals.has(goalKey(target));
    return html`
      <button
        type="button"
        class="goal-button"
        data-saved=${saved ? '' : nothing}
        aria-label=${saved ? `Remove goal: ${spoken}` : `Set as goal: ${spoken}`}
        @click=${() => {
          this.#requestGoal(target, saved ? 'remove' : 'save');
        }}
      >
        ${saved ? 'Saved · Remove' : 'Set as goal'}
      </button>
    `;
  }

  #requestGoal(target: GoalTarget, action: GoalRequestDetail['action']): void {
    this.dispatchEvent(
      new CustomEvent<GoalRequestDetail>(GOAL_REQUEST_EVENT, {
        detail: { target, action },
        bubbles: true,
        composed: true,
      }),
    );
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
      this.#announceView();
      return;
    }
    if (control.getAttribute(CONTROL_ATTRIBUTE) === 'target-type' && isTargetType(value)) {
      this.targetType = value;
      this.openCellId = null;
      this.#announceView();
    }
  };

  /**
   * Says where the bars now stand.
   *
   * Dispatched from the handler rather than from `updated()`, so it fires only
   * when a lifter moved something. In `updated()` it would also fire for the
   * seeds on first render, and a parent writing that to storage would record a
   * default as a decision -- the difference between "opens on the squat because
   * that is where I left it" and "opens on the squat because everything does".
   */
  #announceView(): void {
    this.dispatchEvent(
      new CustomEvent<ViewChangeDetail>(VIEW_CHANGE_EVENT, {
        detail: { lift: this.selectedLift, targetType: this.targetType },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Asks the transport to attempt every read again.
   *
   * No detail, and deliberately not "retry this partition". This element knows
   * which read failed and the transport knows how to issue one, and putting the
   * partition in the event would make the element's idea of the read set
   * authoritative over the watcher's -- which is the arrangement §5.8 keeps out
   * of every other event here. A retry of everything costs one conditional
   * request per artifact already in hand.
   */
  readonly #onRetry = (): void => {
    this.dispatchEvent(new CustomEvent(REFRESH_REQUEST_EVENT, { bubbles: true, composed: true }));
  };

  /** What the lifter entered for one lift, in kilograms, or `null`. */
  #liftedKilograms(lift: Lift): number | null {
    const entry = readLiftEntries(this.entries)[lift];
    return entry.kind === 'weight' ? entry.kilograms : null;
  }
}

/**
 * A title and its scope as one spoken string.
 *
 * "Class I, Squat · 56 kg · Open" rather than the two read separately, because a
 * button's accessible name is one string and a panel's label is one string, and
 * the pair has to survive being flattened into either.
 */
function joinedName(title: string, scope: string): string {
  return scope === '' ? title : `${title}, ${scope}`;
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

/**
 * The finding, once the reads have settled and there is nothing to show.
 *
 * One shape for both target types, because the review asks for one sentence and
 * because the difference a reader needs is already on the bar above -- they chose
 * Records or Classifications a moment ago. The records case keeps a second
 * sentence that the classifications case has no equivalent of: an empty record
 * category is an opening, and saying so is the difference between a dead end and
 * the most useful thing this panel prints.
 */
function emptyPanelSentence(records: boolean, federationLabel: string | null): string {
  const category = categoryPhrase(federationLabel, { exact: true });
  return records
    ? `No published record was found for ${category}. The first qualifying lift sets one.`
    : `No published target was found for ${category}.`;
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

  interface HTMLElementEventMap {
    [VIEW_CHANGE_EVENT]: CustomEvent<ViewChangeDetail>;
    [GOAL_REQUEST_EVENT]: CustomEvent<GoalRequestDetail>;
  }
}
