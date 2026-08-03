// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The report: one lift, one target type, one compact matrix at a time.
 *
 * This is the thing the tool is for. Everything above it -- the questions, the
 * pickers, the fold holding the lift entry -- exists to narrow down which
 * matrices to draw.
 *
 * WHY THIS IS NOT ONE LADDER ANY MORE
 *
 * The first version of this file merged classifications and records into a
 * single ascending list per weight class, on the argument that a lifter planning
 * a meet meets them in weight order. Measured on the real corpus that produced
 * **182 rows and roughly 11,900 CSS pixels** for one ordinary category, arranged
 * as two independent columns -- so the two things a lifter asked to compare were
 * the two things they could not see at once, and the comparison was left to them
 * to do by scrolling.
 *
 * The unit of presentation is now a **matrix**: the weight classes across the
 * columns, the divisions (or the classification levels) down the rows, one lift
 * and one target type at a time. Two figures a lifter wants to compare are
 * always on one line, and the arrangement answers "which is nearer" instead of
 * making them work it out across two lists.
 *
 * TWO GROUPING DECISIONS THAT COULD HAVE GONE OTHER WAYS
 *
 * 1. **Classifications are one matrix per lift, keyed on the standard's own
 *    identifier.** The obvious alternative -- one matrix per classification
 *    level -- produces seven single-cell tables in the commonest case (one
 *    class, Open only), which is the sprawl this rebuild exists to remove. And
 *    the standard id is the only key that works: the published tables are per
 *    (weight class x division), so keying on the table *object* -- which is what
 *    the previous version did, correctly, for a different question -- yields one
 *    group per class per division, exactly the arrangement a comparison matrix
 *    is meant to replace. The seven ids (`class-iv` through
 *    `international-elite`) are stable across all 720 published tables, and the
 *    figures behind them genuinely differ per division, which is what makes the
 *    Age row and the Open row worth putting side by side.
 * 2. **A discipline is a group heading, not part of every caption.** Repeating
 *    "Full power" in three captions under a heading that already says it is the
 *    kind of duplication a reader has to skip past on every scope. The heading
 *    appears only when more than one discipline actually contributes a matrix
 *    for that lift, because for the squat -- contested by one discipline -- it
 *    would otherwise be a heading over a single item.
 *
 * A CELL PRINTS THE OFFICIAL FIGURE, AND MEASURES AGAINST ANOTHER
 *
 * `MatrixCell.value` is the number on screen: for a classification the standard,
 * for a record **the record itself**. `MatrixCell.thresholdKilograms` is what a
 * lifter's own weight is measured against, which for a record is the lowest
 * weight that actually takes it. They differ by the margin the rules require,
 * and collapsing them either prints a figure the federation did not publish or
 * marks a record reached by a lift that only equalled it.
 *
 * PURE, AND ENTRY-FREE
 *
 * No DOM, no data source, no Lit -- the same discipline as `standards.ts` and
 * `record-standings.ts`, and for the same reason: every awkward shape here (a
 * federation with no Open division, two tables for one category, a record whose
 * table is not listed) is reachable as data rather than by driving a page.
 *
 * It also deliberately takes **no lift entries**. What a lifter has already
 * lifted decides which cells are behind them, and nothing else -- not which
 * cells exist, not their order, not their text. Keeping it out means a keystroke
 * cannot invalidate the report, which matters because building one walks every
 * weight class by every division by every partition by every event, and doing
 * that on each keypress is the kind of cost that only shows up on the phone it
 * was written for. {@link reachedIn} is the cheap second pass that answers the
 * lifter's own question.
 *
 * BOTH UNITS, ALWAYS
 *
 * Every figure carries kilograms and pounds (requirement 5), converted with the
 * exact factor rather than the federation's own truncated one -- see
 * {@link figuresFor}.
 */
import type {
  AgeDivision,
  ClassificationBook,
  ClassificationStandard,
  Discipline,
  FederationRecord,
  Lift,
  RecordBook,
  WeightClass,
} from '@platform-toolkit/data-contracts';

import type { GoalTarget } from './goals.js';
import {
  recordCategoryFrom,
  recordTargetLines,
  resolveRecordStandings,
  type LiftRecordStanding,
} from './record-standings.js';
import { partitionKey, type RecordPartition, type ResolvedSelection } from './selection.js';
import {
  LIFTS,
  LIFT_LABELS,
  NO_ENTRIES,
  amountAsUnit,
  formatKilograms,
  lifterCategoryFor,
  resolveStandards,
  type LifterAxes,
  type LiftStandards,
} from './standards.js';

/** One weight, written both ways, because requirement 5 asks for both. */
export interface Figures {
  readonly kilograms: number;
  readonly kilogramsText: string;
  readonly poundsText: string;
}

/**
 * One weight that takes a record, named, conditioned, and explained.
 *
 * Straight from {@link recordTargetLines}, so the choice a lifter taps and the
 * sentence beside it cannot disagree about what the rules say.
 */
export interface RecordAttempt extends Figures {
  /** Two or three words, short enough to be the label on a tap target. */
  readonly label: string;
  /** When this figure is the one that counts. */
  readonly condition: string;
  /** Why it is that figure and not the record itself. */
  readonly basis: string;
  /**
   * This attempt, as something a lifter can commit to.
   *
   * On the attempt and not on the cell, because the cell prints the *record* and
   * a record is not a target -- equalling it takes nothing. Which of the two
   * attempts applies depends on the meet, which this application cannot see, so
   * the choice is the lifter's and the goal is attached to whichever one they
   * pick. See the review's rule: choose the record, choose the attempt, then set
   * the goal.
   */
  readonly goal: GoalTarget;
}

/** Who set a record, as much of it as the federation published. */
export interface RecordHolder {
  readonly name: string | null;
  /** Left in the published `YYYY-MM-DD`; see {@link recordHolder}. */
  readonly achievedOn: string | null;
  readonly meetName: string | null;
}

/**
 * The source contradicting itself about one record, ready to print.
 *
 * A federation publishes each record twice on one row, in kilograms and in
 * pounds, and on a corpus of this size the two sometimes disagree by more than
 * rounding can explain. Kilograms govern, so the figure above is still the
 * kilogram column and nothing here re-enters the arithmetic — this exists so the
 * screen can say the table contradicts itself rather than print one of two
 * irreconcilable numbers with total confidence.
 *
 * Both figures, not a warning. A reader shown 147.7 lb beside 670 kg can tell at
 * a glance which cell slipped; a reader shown a caution icon cannot, and has
 * been given a reason to distrust a figure with no way to resolve it.
 */
export interface RecordDisagreement {
  /** The pound column, as the source printed it. */
  readonly poundsText: string;
  /** What that pound figure comes to in kilograms, by the source's own factor. */
  readonly impliedKilogramsText: string;
}

/**
 * Everything about one record beyond the figure in the cell.
 *
 * Behind a disclosure rather than printed under every cell. The two attempt
 * conditions are one rule, and a rule explained seventy times on one screen is
 * seventy rows a reader has to look past to find the numbers.
 */
export interface RecordDetail {
  /** The record as it stands, which is *not* the weight that takes it. */
  readonly record: Figures;
  /** Every weight that takes it, by condition. One entry, or two. */
  readonly attempts: readonly RecordAttempt[];
  /** Nobody holds it: the federation seeded it as an opening standard. */
  readonly unclaimed: boolean;
  /** `null` when the source's two columns agree, which is nearly always. */
  readonly disagreement: RecordDisagreement | null;
  /** `null` when the source published none of the three fields. */
  readonly holder: RecordHolder | null;
  /** The federation's own table for this record's scope. Never assembled here. */
  readonly sourceUrl: string | null;
  /**
   * The whole scope, spelled out, for the disclosure's own heading and for the
   * accessible name of the link out to the federation's table.
   *
   * Seventy links all named "National record" is a screen-reader link list with
   * no way to tell one from another, which is the P1 this field exists to fix.
   */
  readonly scopeLabel: string;
}

/**
 * One value in a matrix: one row heading crossed with one weight class.
 *
 * `value` is `null` when the federation publishes nothing here, and
 * {@link emptyLabel} is what the cell says instead. Never zero, never a bare
 * dash, and never a figure inferred from a neighbouring category.
 */
export interface MatrixCell {
  /**
   * Stable across renders, and built from the loop that produced the cell rather
   * than from anything in the published data.
   *
   * A record's own identifier looks like the obvious key and is the wrong one:
   * nothing in the contract makes it unique *across* two partitions' artifacts,
   * and a duplicate key silently drops a cell from a keyed render.
   */
  readonly id: string;
  readonly weightClass: WeightClass;
  /** The figure printed. For a record this is the record, never the attempt. */
  readonly value: Figures | null;
  /** What the cell says when there is no figure. See {@link NOT_PUBLISHED}. */
  readonly emptyLabel: string;
  /**
   * The weight that actually earns it -- the standard, or the **lowest** weight
   * that takes the record. Never printed.
   *
   * Separate from `value` because a record is taken by beating it, so measuring
   * a lifter against the printed figure would mark a record reached by a lift
   * that merely equalled it.
   */
  readonly thresholdKilograms: number | null;
  /** `null` for a classification, which has nothing to disclose. */
  readonly detail: RecordDetail | null;
  /**
   * This figure, as something a lifter can commit to, or `null`.
   *
   * `null` in two situations that are not the same and do not need to be told
   * apart here: a cell with nothing published (there is no figure to aim at) and
   * a **record** cell (the figure is the record, and the goal belongs to one of
   * the two attempts under it -- see {@link RecordAttempt.goal}). So in practice
   * this is set for exactly the published classification standards, which is the
   * review's "every classification target is selectable".
   */
  readonly goal: GoalTarget | null;
  /**
   * The whole context, spoken.
   *
   * A cell in a table is announced with its row and column headings, but the
   * lift, the scope and the division live in the caption and the tabs above it,
   * and a reader who jumps straight to a value hears none of them.
   */
  readonly accessibleName: string;
}

/** One row of a matrix: a heading, and one value per weight class. */
export interface MatrixRow {
  readonly id: string;
  /**
   * Rows sharing a `groupId` are one `<tbody>`.
   *
   * Which is how the Age division row and the Open row of one classification
   * level end up adjacent and visibly bound together rather than interleaved by
   * weight -- the arrangement the previous version produced, where a lifter
   * comparing their own division against Open had to find both halves first.
   */
  readonly groupId: string;
  /** "Class I", or the scope of a record. */
  readonly label: string;
  /** `null` when only one division is on show and the label would be noise. */
  readonly divisionLabel: string | null;
  /** One per weight class, in the same order as {@link Matrix.weightClasses}. */
  readonly cells: readonly MatrixCell[];
}

/** One small comparison table. A real `<table>`; see the element. */
export interface Matrix {
  readonly id: string;
  /** Rendered visibly, and as the table's `<caption>`. */
  readonly caption: string;
  /** The columns, in ladder order. One, or two when a comparison was asked for. */
  readonly weightClasses: readonly WeightClass[];
  readonly rows: readonly MatrixRow[];
}

/** Matrices that share a heading. A discipline, for records; nothing, for standards. */
export interface TargetGroup {
  readonly id: string;
  /** `null` when a heading would sit alone over a single matrix. */
  readonly heading: string | null;
  readonly matrices: readonly Matrix[];
}

/** Everything on screen when one lift is selected. */
export interface LiftTargets {
  readonly lift: Lift;
  readonly label: string;
  readonly classifications: readonly TargetGroup[];
  readonly classificationNotices: readonly string[];
  readonly records: readonly TargetGroup[];
  readonly recordNotices: readonly string[];
}

export interface Report {
  /** The columns, in ladder order. One, or two when a comparison was asked for. */
  readonly weightClasses: readonly WeightClass[];
  /**
   * The rows' divisions, **chosen age division first**. See {@link orderedDivisions}.
   *
   * Carried on the report rather than re-derived by the element, so the context
   * line above the matrices and the row headings inside them cannot end up
   * naming the divisions in two different orders.
   */
  readonly divisions: readonly AgeDivision[];
  /** One per lift, in platform order. Always four, so the tab set never moves. */
  readonly lifts: readonly LiftTargets[];
  /** Statements about the whole report rather than about one matrix. */
  readonly notices: readonly string[];
}

export interface ReportInput {
  /** The answered questions, already reconciled against the catalogue. */
  readonly resolved: ResolvedSelection;
  /** The three axes every column shares, or `null` while one is unanswered. */
  readonly axes: LifterAxes | null;
  /** This sex and equipment category's standards, or `null` if none are published. */
  readonly classifications: ClassificationBook | null;
  /**
   * One record book per partition, keyed by {@link partitionKey}.
   *
   * A map rather than a list, because the reads settle independently and a
   * report drawn while two of three have arrived should show those two rather
   * than nothing. A missing key and a `null` value are deliberately the same
   * thing here -- "no records to draw from" -- because they are the same to a
   * reader, and the *reason* is the panel's business, not the matrix's.
   */
  readonly recordBooks: ReadonlyMap<string, RecordBook | null>;
}

/**
 * What a cell says when the federation publishes nothing for it.
 *
 * Not a zero and not a dash: both read as a figure, and a zero is a target every
 * lifter has already beaten.
 */
export const NOT_PUBLISHED = 'Not published';

/**
 * What a record cell says when the book holds none for that category.
 *
 * A different sentence from {@link NOT_PUBLISHED} on purpose, and the more
 * useful of the two: a category with no record standing is one where the first
 * qualifying lift sets it.
 */
export const NO_RECORD_YET = 'None yet';

/** The caption over every classification matrix. */
const CLASSIFICATIONS_CAPTION = 'Classification standards';

/**
 * Builds the whole report.
 *
 * Returns an empty one rather than throwing when the shared axes are
 * unanswered: half-answered is the normal state of this screen on first paint,
 * and the panel says so itself.
 */
export function buildReport(input: ReportInput): Report {
  const { resolved, axes, classifications, recordBooks } = input;
  if (axes === null) {
    return { weightClasses: [], divisions: [], lifts: emptyLifts(), notices: [] };
  }

  const weightClasses = resolved.weightClasses;
  const divisions = orderedDivisions(resolved);
  // A set, because the same sentence arrives once per division and once per
  // event, and three identical lines under one lift reads as three problems.
  const classificationNotices = perLift<Set<string>>(() => new Set());
  const recordNotices = perLift<Set<string>>(() => new Set());

  const classificationGroups = classificationGroupsPerLift(
    weightClasses,
    divisions,
    axes,
    classifications,
    classificationNotices,
  );
  const recordGroups = recordGroupsPerLift(
    weightClasses,
    divisions,
    axes,
    resolved,
    recordBooks,
    recordNotices,
  );

  return {
    weightClasses,
    divisions,
    lifts: LIFTS.map((lift) => ({
      lift,
      label: LIFT_LABELS[lift],
      classifications: classificationGroups[lift],
      classificationNotices: [...classificationNotices[lift]],
      records: recordGroups[lift],
      recordNotices: [...recordNotices[lift]],
    })),
    notices: reportNotices(resolved),
  };
}

/**
 * Which cells are already behind the lifter, by cell identifier.
 *
 * The second pass the header describes. A set rather than a flag on each cell so
 * that {@link buildReport}'s output stays a function of the published data alone
 * and can be reused across keystrokes; the caller does one lookup per cell,
 * which is what a render can afford to do on every character typed.
 *
 * `null` for the lifted weight means nothing usable was typed, which is not the
 * same as zero -- an empty set is the honest answer and it renders as a report
 * with nothing marked, rather than as a lifter who has reached nothing.
 */
export function reachedIn(
  groups: readonly TargetGroup[],
  liftedKilograms: number | null,
): ReadonlySet<string> {
  if (liftedKilograms === null) {
    return new Set();
  }
  // `>=` because every threshold here is a floor: a standard is earned by
  // reaching it, and a record target is the weight that takes the record rather
  // than the first weight past it. `record-standings.ts` and `classification.ts`
  // both already round in the safe direction, so an exact hit is a real hit.
  return new Set(
    cellsOf(groups)
      .filter(
        (cell) => cell.thresholdKilograms !== null && liftedKilograms >= cell.thresholdKilograms,
      )
      .map((cell) => cell.id),
  );
}

/**
 * The nearest cell the lifter has not reached, **one per weight class**.
 *
 * A set rather than a single identifier, which is the change the matrix forced:
 * with two classes compared side by side each column has its own next rung, and
 * marking one of them would point a lifter at the class they are cutting to
 * while their own column said nothing.
 *
 * Ties break on the cell identifier so the choice is stable across renders. A
 * mark that moves between two equal cells under a thumb is one a reader has to
 * re-find after every keystroke.
 */
export function nextIn(
  groups: readonly TargetGroup[],
  liftedKilograms: number | null,
): ReadonlySet<string> {
  if (liftedKilograms === null) {
    return new Set();
  }
  const nearest = new Map<string, { readonly id: string; readonly kilograms: number }>();
  for (const cell of cellsOf(groups)) {
    const threshold = cell.thresholdKilograms;
    if (threshold === null || liftedKilograms >= threshold) {
      continue;
    }
    const current = nearest.get(cell.weightClass.id);
    if (
      current === undefined ||
      threshold < current.kilograms ||
      (threshold === current.kilograms && cell.id < current.id)
    ) {
      nearest.set(cell.weightClass.id, { id: cell.id, kilograms: threshold });
    }
  }
  return new Set([...nearest.values()].map((entry) => entry.id));
}

/** Every cell in a family of groups, flattened, in render order. */
function cellsOf(groups: readonly TargetGroup[]): readonly MatrixCell[] {
  return groups.flatMap((group) =>
    group.matrices.flatMap((matrix) => matrix.rows.flatMap((row) => row.cells)),
  );
}

/**
 * A weight, written in both units.
 *
 * **The pound figure uses the exact conversion**, by way of `amountAsUnit` and
 * `weightIn` -- that is, `KILOGRAMS_PER_POUND = 0.45359237` -- and deliberately
 * **not** `USPA_POUNDS_PER_KILOGRAM = 2.2046226`. The two look interchangeable
 * and are not: the truncated factor exists to reproduce one federation's own
 * classification calculator, so using it here would put that federation's
 * arithmetic on another federation's records the day a second one is published,
 * and the disagreement (about a tenth of a pound at meet weights) is far too
 * small to notice and far too large to explain afterwards.
 *
 * Records and standards are published in kilograms and only ever compared in
 * kilograms; the pound figure is a reading aid and is rounded to one decimal for
 * the reason `formatAsUnit` gives at length.
 */
export function figuresFor(kilograms: number): Figures {
  return {
    kilograms,
    kilogramsText: formatKilograms(kilograms),
    poundsText: amountAsUnit(kilograms, 'lb'),
  };
}

/** Four empty lifts, so a caller can draw the tab set before anything is answered. */
function emptyLifts(): readonly LiftTargets[] {
  return LIFTS.map((lift) => ({
    lift,
    label: LIFT_LABELS[lift],
    classifications: [],
    classificationNotices: [],
    records: [],
    recordNotices: [],
  }));
}

/**
 * The chosen age division first, then Open.
 *
 * `resolved.divisions` puts Open first, which is right for a list of divisions
 * and wrong for a comparison: the row a lifter came to read is their own, and a
 * matrix that opens on Open makes them look past it every time. Reordered by
 * matching the answer they actually gave, rather than by reversing -- a reversal
 * would silently become wrong the day a third division is shown.
 */
function orderedDivisions(resolved: ResolvedSelection): readonly AgeDivision[] {
  const chosenId = resolved.selection.division;
  if (chosenId === null) {
    return resolved.divisions;
  }
  return [
    ...resolved.divisions.filter((division) => division.id === chosenId),
    ...resolved.divisions.filter((division) => division.id !== chosenId),
  ];
}

function reportNotices(resolved: ResolvedSelection): readonly string[] {
  switch (resolved.openDivisionProblem) {
    case null:
      return [];
    case 'none':
      // Worth saying plainly. Open is the division most lifters enter, and its
      // silent absence from a report that otherwise looks complete is the sort
      // of gap somebody plans around without noticing it is a gap.
      return [
        'No Open division could be identified in the published divisions, so only the division you chose is shown.',
      ];
    case 'ambiguous':
      return [
        'More than one published division is as wide as every other, so the Open division cannot be identified.',
      ];
  }
}

/** Somewhere to accumulate per lift, written out for the reason `readLiftEntries` gives. */
function perLift<T>(make: () => T): Record<Lift, T> {
  return { squat: make(), bench: make(), deadlift: make(), total: make() };
}

/**
 * The whole context of one cell, spoken.
 *
 * Built here rather than in the element because it has to name the same things
 * the caption and the headings name, and two files agreeing about that by
 * convention is two files that will stop agreeing.
 */
function cellName(
  context: readonly (string | null)[],
  weightClass: WeightClass,
  value: Figures | null,
  emptyLabel: string,
): string {
  const spoken = [...context.filter((part): part is string => part !== null), weightClass.label];
  const figure = value === null ? emptyLabel.toLowerCase() : `${value.kilogramsText} kilograms`;
  return `${spoken.join(', ')}: ${figure}`;
}

/**
 * Every published standard for every class and division on show, as one matrix
 * per lift.
 *
 * Requirement 7 in one function: *all* the levels, not just the next one. A
 * lifter deciding what to open with wants the whole ladder in front of them, and
 * the "next classification" sentence the old panel showed is one rung of it.
 */
function classificationGroupsPerLift(
  weightClasses: readonly WeightClass[],
  divisions: readonly AgeDivision[],
  axes: LifterAxes,
  classifications: ClassificationBook | null,
  notices: Record<Lift, Set<string>>,
): Record<Lift, readonly TargetGroup[]> {
  // Division down the outer axis, weight class across the inner one, which is
  // the shape the matrices are drawn in. Resolved once per (division, class)
  // rather than once per cell, because `resolveStandards` answers for all four
  // lifts at a time and calling it per lift would resolve the same book four
  // times over.
  const grid = divisions.map((division) =>
    weightClasses.map((weightClass) => {
      const byLift = perLift<LiftStandards>(() => ({ kind: 'unselected' }));
      for (const standing of resolveStandards(
        classifications,
        lifterCategoryFor(axes, weightClass.id, division.id),
      )) {
        byLift[standing.lift] = standing.standards;
        noteStandardsProblem(
          notices,
          standing.lift,
          standing.standards,
          division,
          weightClass,
          weightClasses.length > 1,
        );
      }
      return byLift;
    }),
  );

  const groups = perLift<readonly TargetGroup[]>(() => []);
  for (const lift of LIFTS) {
    const rows = classificationRows(lift, grid, weightClasses, divisions);
    if (rows.length === 0) {
      continue;
    }
    groups[lift] = [
      {
        id: `classifications:${lift}`,
        heading: null,
        matrices: [
          {
            id: `classifications:${lift}`,
            caption: CLASSIFICATIONS_CAPTION,
            weightClasses,
            rows,
          },
        ],
      },
    ];
  }
  return groups;
}

function noteStandardsProblem(
  notices: Record<Lift, Set<string>>,
  lift: Lift,
  standards: LiftStandards,
  division: AgeDivision,
  weightClass: WeightClass,
  manyClasses: boolean,
): void {
  // Only named when there is more than one class on screen. With one, the
  // sentence would repeat the class the whole report is about.
  const scope = manyClasses
    ? `${division.label} in the ${weightClass.label} class`
    : division.label;
  switch (standards.kind) {
    case 'ambiguous':
      notices[lift].add(
        `More than one set of standards applies to ${scope}, so none can be shown.`,
      );
      break;
    case 'unreadable':
      notices[lift].add(`The published standards for ${scope} could not be read.`);
      break;
    // `none` is not a notice: a federation that publishes no bench standard for
    // a masters division is the ordinary case, and a line saying so under every
    // empty cell would be most of the report. `unselected` is unreachable,
    // because the category is total here. Both are listed rather than defaulted
    // so a new member of the union stops compiling.
    case 'none':
    case 'unselected':
    case 'ladder':
      break;
  }
}

/**
 * One row per (classification level x division), levels ascending.
 *
 * The level is the row key rather than the published table, because the tables
 * are per (weight class x division) -- see the header. Two divisions therefore
 * contribute two rows under one level, which is exactly the adjacency the
 * comparison needs, and the figures in them genuinely differ.
 */
function classificationRows(
  lift: Lift,
  grid: readonly (readonly Record<Lift, LiftStandards>[])[],
  weightClasses: readonly WeightClass[],
  divisions: readonly AgeDivision[],
): readonly MatrixRow[] {
  const levels = classificationLevels(lift, grid);
  const rows: MatrixRow[] = [];

  for (const [standardId, level] of levels) {
    for (const [divisionIndex, division] of divisions.entries()) {
      const cells = weightClasses.map((weightClass, classIndex): MatrixCell => {
        const standard = standardAt(grid, divisionIndex, classIndex, lift, standardId);
        const value = standard === null ? null : figuresFor(standard.requiredKilograms);
        return {
          id: `classification:${lift}:${standardId}:${division.id}:${weightClass.id}`,
          weightClass,
          value,
          emptyLabel: NOT_PUBLISHED,
          thresholdKilograms: standard?.requiredKilograms ?? null,
          detail: null,
          goal:
            standard === null
              ? null
              : {
                  lift,
                  kind: 'classification',
                  kilograms: standard.requiredKilograms,
                  standardId,
                  weightClassId: weightClass.id,
                  divisionId: division.id,
                  // A classification has no level, region or event: the standard
                  // is the same figure whatever meet it is hit at, which is the
                  // whole difference between it and a record.
                  levelId: '',
                  regionId: '',
                  disciplineId: '',
                  attempt: 'none',
                },
          accessibleName: cellName(
            [level.label, divisions.length > 1 ? division.label : null],
            weightClass,
            value,
            NOT_PUBLISHED,
          ),
        };
      });
      // A row with nothing published anywhere on it is dropped rather than
      // printed as a line of "Not published" -- a federation that keeps no
      // Elite standard for a masters division is the ordinary case, and saying
      // so once per division per level would be most of the table.
      if (cells.some((cell) => cell.value !== null)) {
        rows.push({
          id: `classification:${lift}:${standardId}:${division.id}`,
          groupId: `classification:${lift}:${standardId}`,
          label: level.label,
          divisionLabel: divisions.length > 1 ? division.label : null,
          cells,
        });
      }
    }
  }
  return rows;
}

interface ClassificationLevelSeen {
  readonly label: string;
  /** The lowest rank seen for this identifier, across every cell of the grid. */
  readonly rank: number;
  /** Where it first appeared, so equal ranks keep a stable order. */
  readonly seen: number;
}

/**
 * Every classification level any cell of the grid publishes, ascending.
 *
 * The union rather than one cell's ladder: a division that publishes six levels
 * and one that publishes seven have to line up on the six they share, and taking
 * the order from whichever resolved first would reshuffle the table when the
 * lifter changed nothing but their comparison class.
 */
function classificationLevels(
  lift: Lift,
  grid: readonly (readonly Record<Lift, LiftStandards>[])[],
): ReadonlyMap<string, ClassificationLevelSeen> {
  const levels = new Map<string, ClassificationLevelSeen>();
  let seen = 0;
  for (const row of grid) {
    for (const byLift of row) {
      const standards = byLift[lift];
      if (standards.kind !== 'ladder') {
        continue;
      }
      for (const standard of standards.ladder.standards) {
        const existing = levels.get(standard.id);
        if (existing === undefined) {
          levels.set(standard.id, { label: standard.label, rank: standard.rank, seen });
          seen += 1;
        } else if (standard.rank < existing.rank) {
          levels.set(standard.id, { ...existing, rank: standard.rank });
        }
      }
    }
  }
  return new Map(
    [...levels].sort(([, left], [, right]) => left.rank - right.rank || left.seen - right.seen),
  );
}

function standardAt(
  grid: readonly (readonly Record<Lift, LiftStandards>[])[],
  divisionIndex: number,
  classIndex: number,
  lift: Lift,
  standardId: string,
): ClassificationStandard | null {
  const standards = grid[divisionIndex]?.[classIndex]?.[lift];
  if (standards?.kind !== 'ladder') {
    return null;
  }
  return standards.ladder.standards.find((standard) => standard.id === standardId) ?? null;
}

/**
 * Every record this lifter could be aiming at, across every level and every event.
 *
 * Requirements 3 and 4 together. The old panel asked which level and which event
 * and then showed one combination; a lifter planning a meet wants the state
 * record, the national record and the world record side by side, for the event
 * they are entered in *and* the ones they might enter. Nothing here is filtered
 * by a question -- what narrows it is which artifacts have actually arrived.
 */
function recordGroupsPerLift(
  weightClasses: readonly WeightClass[],
  divisions: readonly AgeDivision[],
  axes: LifterAxes,
  resolved: ResolvedSelection,
  recordBooks: ReadonlyMap<string, RecordBook | null>,
  notices: Record<Lift, Set<string>>,
): Record<Lift, readonly TargetGroup[]> {
  const groups = perLift<TargetGroup[]>(() => []);

  for (const discipline of resolved.disciplines) {
    const matrices = perLift<Matrix[]>(() => []);

    for (const partition of resolved.partitions) {
      const book = recordBooks.get(partitionKey(partition)) ?? null;
      // A partition whose artifact has not arrived contributes nothing at all,
      // rather than a table of "None yet". `recordFor` cannot tell a book that
      // is still loading from one that holds no record, and a matrix drawn from
      // the first says the federation keeps no record here -- a real answer, and
      // the wrong one, which then flips as the read lands.
      if (book === null) {
        continue;
      }
      const rows = perLift<MatrixRow[]>(() => []);

      for (const division of divisions) {
        const cells = perLift<MatrixCell[]>(() => []);
        for (const weightClass of weightClasses) {
          const category = recordCategoryFrom(
            lifterCategoryFor(axes, weightClass.id, division.id),
            partition,
            discipline.id,
          );
          // The discipline's own lifts, never all four: a bench-only event has
          // no squat record, and a cell saying none stands would be true of a
          // record that cannot exist -- which reads as a hole in the data.
          const standings = resolveRecordStandings(book, category, discipline.lifts, NO_ENTRIES);
          for (const standing of standings) {
            if (standing.record.kind === 'ambiguous') {
              notices[standing.lift].add(
                `More than one ${partition.label} record is published for ${division.label} ${discipline.label}, so none can be shown.`,
              );
            }
            cells[standing.lift].push(
              recordCell(standing, weightClass, partition, division, discipline, divisions.length),
            );
          }
        }
        for (const lift of discipline.lifts) {
          rows[lift].push({
            id: `record:${lift}:${partition.levelId}:${partition.regionId ?? ''}:${discipline.id}:${division.id}`,
            groupId: `record:${lift}:${partition.levelId}:${partition.regionId ?? ''}:${discipline.id}`,
            label: `${partition.label} record`,
            divisionLabel: divisions.length > 1 ? division.label : null,
            cells: cells[lift],
          });
        }
      }

      for (const lift of discipline.lifts) {
        // A whole scope with no record anywhere in it is dropped. Otherwise
        // three levels by three disciplines is nine tables of "None yet" for a
        // lifter whose category simply has no state records -- the sprawl this
        // rebuild exists to remove, and the element says it in one sentence when
        // nothing at all survives.
        if (rows[lift].some((row) => row.cells.some((cell) => cell.value !== null))) {
          matrices[lift].push({
            id: `records:${lift}:${discipline.id}:${partition.levelId}:${partition.regionId ?? ''}`,
            caption: `${partition.label} records`,
            weightClasses,
            rows: rows[lift],
          });
        }
      }
    }

    for (const lift of discipline.lifts) {
      if (matrices[lift].length > 0) {
        groups[lift].push({
          id: `records:${lift}:${discipline.id}`,
          heading: discipline.label,
          matrices: matrices[lift],
        });
      }
    }
  }

  return withoutLoneHeadings(groups);
}

/**
 * Drops the discipline heading when only one discipline contests the lift.
 *
 * Decided after the fact rather than up front, because "how many disciplines are
 * on screen" is not the same question as "how many disciplines exist": the squat
 * is contested by one of the three, so a heading chosen from
 * `resolved.disciplines.length` would print "Full power" over the squat's only
 * group and nothing over the bench's first of two.
 */
function withoutLoneHeadings(
  groups: Record<Lift, TargetGroup[]>,
): Record<Lift, readonly TargetGroup[]> {
  const trimmed = perLift<readonly TargetGroup[]>(() => []);
  for (const lift of LIFTS) {
    const list = groups[lift];
    trimmed[lift] = list.length > 1 ? list : list.map((group) => ({ ...group, heading: null }));
  }
  return trimmed;
}

function recordCell(
  standing: LiftRecordStanding,
  weightClass: WeightClass,
  partition: RecordPartition,
  division: AgeDivision,
  discipline: Discipline,
  divisionsShown: number,
): MatrixCell {
  const id = `record:${weightClass.id}:${partition.levelId}:${partition.regionId ?? ''}:${division.id}:${discipline.id}:${standing.lift}`;
  const context = [
    `${partition.label} record`,
    discipline.label,
    divisionsShown > 1 ? division.label : null,
  ];
  const emptyLabel = standing.record.kind === 'ambiguous' ? NOT_PUBLISHED : NO_RECORD_YET;

  if (standing.record.kind !== 'record') {
    return {
      id,
      weightClass,
      value: null,
      emptyLabel,
      thresholdKilograms: null,
      detail: null,
      goal: null,
      accessibleName: cellName(context, weightClass, null, emptyLabel),
    };
  }

  const record = standing.record.record;
  const attempts = recordTargetLines(standing).map((line) => ({
    label: line.label,
    condition: line.condition,
    basis: line.basis,
    goal: {
      lift: standing.lift,
      kind: 'record',
      kilograms: line.kilograms,
      // A record has no classification standard behind it. The five axes below
      // are what address one, and they are taken from the loop that found it
      // rather than parsed back out of the cell identifier.
      standardId: '',
      weightClassId: weightClass.id,
      divisionId: division.id,
      levelId: partition.levelId,
      regionId: partition.regionId ?? '',
      disciplineId: discipline.id,
      // The assignment that keeps `GoalAttempt` honest: a fourth basis in the
      // domain stops compiling here rather than storing as an unknown string.
      attempt: line.basisId,
    } satisfies GoalTarget,
    ...figuresFor(line.kilograms),
  }));
  const value = figuresFor(record.kilograms);

  return {
    id,
    weightClass,
    value,
    emptyLabel,
    // The lowest weight that takes it, which is the chip figure wherever the
    // book draws the distinction. Measuring against the record itself would mark
    // it reached by a lift that only equalled it, and against the higher figure
    // would hide a record a lifter can already take at their own meet.
    thresholdKilograms: attempts.reduce<number | null>(
      (lowest, attempt) =>
        lowest === null || attempt.kilograms < lowest ? attempt.kilograms : lowest,
      null,
    ),
    detail: {
      record: value,
      attempts,
      unclaimed: record.unclaimed,
      disagreement: recordDisagreement(record),
      holder: recordHolder(record),
      sourceUrl: standing.sourceUrl,
      scopeLabel: [...context, weightClass.label].filter((part) => part !== null).join(', '),
    },
    // The record itself is not a goal: equalling it takes nothing, and which of
    // the two attempts under it applies is a fact about the meet. See the
    // attempts above.
    goal: null,
    accessibleName: cellName(context, weightClass, value, emptyLabel),
  };
}

/**
 * The source's own pound column when it contradicts the kilogram one, formatted.
 *
 * Both figures come straight from the publisher and neither is recomputed here.
 * Deriving the implied kilograms in the browser would need the federation's own
 * conversion factor, and a browser using a different one would draw a
 * disagreement the publisher did not find — or fail to draw one it did.
 *
 * The pound figure is rounded to a tenth, matching every other pound figure on
 * the screen. A published cell is not made more truthful by printing more of its
 * digits, and the disagreements worth showing are tens of kilograms wide.
 */
function recordDisagreement(record: FederationRecord): RecordDisagreement | null {
  const disagreement = record.sourceDisagreement;
  if (disagreement === null) {
    return null;
  }
  return {
    poundsText: String(Math.round(disagreement.pounds * 10) / 10),
    impliedKilogramsText: formatKilograms(disagreement.impliedKilograms),
  };
}

/**
 * Who holds it, or `null` when the source published none of it.
 *
 * A record holder's name is federation-published and belongs beside their lift;
 * it is not the same kind of value as an imported athlete's details, which stay
 * out of logs and error reports (§2.3).
 *
 * The three fields are dropped for an unclaimed record by the publisher, and
 * `null` here rather than a placeholder line, because "nobody holds this yet"
 * and "the source did not say who holds this" are opposite situations and the
 * panel says different things about them.
 *
 * `achievedOn` stays in the published `YYYY-MM-DD`. These tools are read
 * wherever the federation runs meets, and `03/04/2022` is two different days
 * depending on who is holding the phone.
 */
function recordHolder(record: FederationRecord): RecordHolder | null {
  const { holderName, achievedOn, meetName } = record;
  if (holderName === null && achievedOn === null && meetName === null) {
    return null;
  }
  return { name: holderName, achievedOn, meetName };
}
