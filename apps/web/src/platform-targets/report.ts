/**
 * The report: every figure a lifter could be aiming at, in one ascending ladder.
 *
 * This is the thing the tool is for. Everything above it -- the questions, the
 * pickers, the fold holding the lift entry -- exists to narrow down which
 * ladders to draw, and the whole point of the rebuild was to get out of the way
 * of this file.
 *
 * ONE LADDER, TWO KINDS OF RUNG
 *
 * A classification standard and a record are different things administratively
 * and the same thing to somebody planning a meet: a weight, and what reaching it
 * gets you. So they are merged and sorted by weight rather than split into two
 * panels. A lifter reading down a cell sees Class II, then the state record, then
 * Class I, then the national record, in the order they would actually meet them
 * -- which is the question "what is next?" answered by the arrangement instead of
 * by arithmetic done across two tables.
 *
 * PURE, AND ENTRY-FREE
 *
 * No DOM, no data source, no Lit -- the same discipline as `standards.ts` and
 * `record-standings.ts`, and for the same reason: every awkward shape here (a
 * federation with no Open division, two tables for one category, a record whose
 * table is not listed) is reachable as data rather than by driving a page.
 *
 * It also deliberately takes **no lift entries**. What a lifter has already
 * lifted decides which rungs are behind them, and nothing else -- not which rungs
 * exist, not their order, not their text. Keeping it out means a keystroke cannot
 * invalidate the report, which matters because building one walks every weight
 * class by every division by every partition by every event, and doing that on
 * each keypress is the kind of cost that only shows up on the phone it was
 * written for. {@link reachedIn} is the cheap second pass that answers the
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
  ClassificationTable,
  Discipline,
  FederationRecord,
  Lift,
  RecordBook,
  WeightClass,
} from '@platform-toolkit/data-contracts';
import type { ClassificationLadder } from '@platform-toolkit/domain';

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
} from './standards.js';

/** One weight, written both ways, because requirement 5 asks for both. */
export interface Figures {
  readonly kilograms: number;
  readonly kilogramsText: string;
  readonly poundsText: string;
}

/** One weight that takes a record, and the condition it holds under. */
export interface ReportTarget extends Figures {
  /** When this figure is the one that counts. From {@link recordTargetLines}. */
  readonly condition: string;
  /** Why it is that figure and not the record itself. */
  readonly basis: string;
}

/** Who set a record, as much of it as the federation published. */
export interface RecordHolder {
  readonly name: string | null;
  /** Left in the published `YYYY-MM-DD`; see {@link recordHolder}. */
  readonly achievedOn: string | null;
  readonly meetName: string | null;
}

/** Everything about a record beyond the weight that takes it. */
export interface RecordDetail {
  /** The record as it stands, which is *not* the weight that takes it. */
  readonly record: Figures;
  /**
   * Every weight that takes it, by condition. One entry, or two.
   *
   * Straight from {@link recordTargetLines}, so the row and the sentence under it
   * cannot disagree about what the rules say.
   */
  readonly targets: readonly ReportTarget[];
  /** Nobody holds it: the federation seeded it as an opening standard. */
  readonly unclaimed: boolean;
  /** `null` when the source published none of the three fields. */
  readonly holder: RecordHolder | null;
  /** The federation's own table for this record's scope. Never assembled here. */
  readonly sourceUrl: string | null;
}

interface ReportRowBase extends Figures {
  /**
   * Stable across renders, and built from the loop that produced the row rather
   * than from anything in the published data.
   *
   * A record's own identifier looks like the obvious key and is the wrong one:
   * nothing in the contract makes it unique *across* two partitions' artifacts,
   * and a duplicate key silently drops a row from a keyed render -- a record
   * that is simply missing from a report whose whole job is completeness.
   */
  readonly id: string;
  /** What reaching this weight gets: "Class I", "Nevada State record". */
  readonly title: string;
  /**
   * Which division this rung belongs to, or `null` for "every division shown".
   *
   * `null` is the common case for a classification: a federation that publishes
   * one table for everybody produces the identical ladder under Open and under
   * Masters 45-49, and printing it twice with two labels reads as two different
   * standards a lifter has to tell apart.
   */
  readonly divisionLabel: string | null;
  /** Which event contests it. `null` for a classification, which is event-free. */
  readonly eventLabel: string | null;
}

export interface ClassificationRow extends ReportRowBase {
  readonly kind: 'classification';
}

export interface RecordRow extends ReportRowBase {
  readonly kind: 'record';
  readonly detail: RecordDetail;
}

/**
 * One rung.
 *
 * `kilograms` is the weight that *takes* it, which for a record is the record
 * plus whatever margin the rules require and never the record itself. Sorting on
 * the record would put a rung in the ladder at a weight that does not claim it.
 */
export type ReportRow = ClassificationRow | RecordRow;

/** One weight class's ladder for one lift. */
export interface ReportCell {
  readonly weightClass: WeightClass;
  /** Ascending. Empty is a real answer: the federation publishes nothing here. */
  readonly rows: readonly ReportRow[];
  /**
   * What could not be shown, and why.
   *
   * Separate from the rows because these are statements about the published
   * data rather than about the lifter, and folding them in as rows with no
   * weight would put them in an ordering they have no place in.
   */
  readonly notices: readonly string[];
}

export interface ReportSection {
  readonly lift: Lift;
  readonly label: string;
  /** One per weight class, in ladder order, aligned with {@link Report.weightClasses}. */
  readonly cells: readonly ReportCell[];
}

export interface Report {
  /** The columns, in ladder order. One, or two when a comparison was asked for. */
  readonly weightClasses: readonly WeightClass[];
  /** One per lift, in platform order. Always four, even where a cell is empty. */
  readonly sections: readonly ReportSection[];
  /** Statements about the whole report rather than about one cell. */
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
   * reader, and the *reason* is the panel's business, not the ladder's.
   */
  readonly recordBooks: ReadonlyMap<string, RecordBook | null>;
}

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
    return { weightClasses: [], sections: emptySections(), notices: [] };
  }

  const cells = resolved.weightClasses.map((weightClass) =>
    cellsFor(weightClass, axes, resolved, classifications, recordBooks),
  );

  return {
    weightClasses: resolved.weightClasses,
    sections: LIFTS.map((lift) => ({
      lift,
      label: LIFT_LABELS[lift],
      cells: cells.map((byLift) => byLift[lift]),
    })),
    notices: reportNotices(resolved),
  };
}

/**
 * Which rungs are already behind the lifter, by row identifier.
 *
 * The second pass the header describes. A set rather than a flag on each row so
 * that {@link buildReport}'s output stays a function of the published data alone
 * and can be reused across keystrokes; the caller does one lookup per row, which
 * is what a render can afford to do on every character typed.
 *
 * `null` for the lifted weight means nothing usable was typed, which is not the
 * same as zero -- an empty set is the honest answer and it renders as a report
 * with nothing struck through, rather than as a lifter who has reached nothing.
 */
export function reachedIn(
  rows: readonly ReportRow[],
  liftedKilograms: number | null,
): ReadonlySet<string> {
  if (liftedKilograms === null) {
    return new Set();
  }
  // `>=` because every figure here is a floor: a standard is earned by reaching
  // it, and a record target is the weight that takes the record rather than the
  // first weight past it. `record-standings.ts` and `classification.ts` both
  // already round in the safe direction, so an exact hit is a real hit.
  return new Set(rows.filter((row) => liftedKilograms >= row.kilograms).map((row) => row.id));
}

/**
 * The first rung the lifter has not reached, or `null` when they are past them all.
 *
 * Exists so the panel can point at one thing. A ladder of twenty-five rungs with
 * nothing marked is a table; the same ladder with "next" on one row is a plan.
 */
export function nextIn(rows: readonly ReportRow[], liftedKilograms: number | null): string | null {
  if (liftedKilograms === null) {
    return null;
  }
  return rows.find((row) => liftedKilograms < row.kilograms)?.id ?? null;
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
function figuresFor(kilograms: number): Figures {
  return {
    kilograms,
    kilogramsText: formatKilograms(kilograms),
    poundsText: amountAsUnit(kilograms, 'lb'),
  };
}

/** Four empty sections, so a caller can render headings before anything is answered. */
function emptySections(): readonly ReportSection[] {
  return LIFTS.map((lift) => ({ lift, label: LIFT_LABELS[lift], cells: [] }));
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

function cellsFor(
  weightClass: WeightClass,
  axes: LifterAxes,
  resolved: ResolvedSelection,
  classifications: ClassificationBook | null,
  recordBooks: ReadonlyMap<string, RecordBook | null>,
): Record<Lift, ReportCell> {
  const rows = perLift<ReportRow[]>(() => []);
  // A set, because the same sentence arrives once per division and once per
  // event, and three identical lines under one lift reads as three problems.
  const notices = perLift<Set<string>>(() => new Set());

  addClassificationRows(rows, notices, weightClass, axes, resolved, classifications);
  addRecordRows(rows, notices, weightClass, axes, resolved, recordBooks);

  return perLiftCells(weightClass, rows, notices);
}

function perLiftCells(
  weightClass: WeightClass,
  rows: Record<Lift, ReportRow[]>,
  notices: Record<Lift, Set<string>>,
): Record<Lift, ReportCell> {
  const cellFor = (lift: Lift): ReportCell => ({
    weightClass,
    rows: rows[lift].toSorted(compareRows),
    notices: [...notices[lift]],
  });
  return {
    squat: cellFor('squat'),
    bench: cellFor('bench'),
    deadlift: cellFor('deadlift'),
    total: cellFor('total'),
  };
}

/**
 * Ascending by weight, with a total order under it.
 *
 * The tie-breaks are not cosmetic. Two rungs at the same weight in an order that
 * depends on which loop ran first would reshuffle between renders, and a list
 * that reorders under a thumb is one a reader has to re-find their place in
 * after every keystroke.
 */
function compareRows(left: ReportRow, right: ReportRow): number {
  if (left.kilograms !== right.kilograms) {
    return left.kilograms - right.kilograms;
  }
  if (left.kind !== right.kind) {
    // The classification first: it is the cheaper claim, and reading "Class I,
    // and at the same weight the state record" is the order a lifter thinks in.
    return left.kind === 'classification' ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Every published standard for this class, across the divisions on show.
 *
 * Requirement 7 in one function: *all* the levels, not just the next one. A
 * lifter deciding what to open with wants the whole ladder in front of them, and
 * the "next classification" sentence the old panel showed is one rung of it.
 */
function addClassificationRows(
  rows: Record<Lift, ReportRow[]>,
  notices: Record<Lift, Set<string>>,
  weightClass: WeightClass,
  axes: LifterAxes,
  resolved: ResolvedSelection,
  classifications: ClassificationBook | null,
): void {
  /**
   * Which divisions each distinct table serves.
   *
   * Keyed on the table *object*, which is the identity that matters: a
   * federation publishing one table for everybody hands back the same object
   * for every division, and that is precisely the case that must collapse to
   * one set of rows. Keying on anything derived -- a scope, a label -- would
   * either merge two genuinely different tables or fail to merge one.
   */
  const tables = perLift<Map<ClassificationTable, TableGroup>>(() => new Map());

  for (const division of resolved.divisions) {
    const standings = resolveStandards(
      classifications,
      lifterCategoryFor(axes, weightClass.id, division.id),
      NO_ENTRIES,
    );

    for (const standing of standings) {
      const { standards, lift } = standing;
      switch (standards.kind) {
        case 'ladder': {
          const group = tables[lift].get(standards.table);
          if (group === undefined) {
            tables[lift].set(standards.table, { ladder: standards.ladder, divisions: [division] });
          } else {
            group.divisions.push(division);
          }
          break;
        }
        case 'ambiguous':
          notices[lift].add(
            `More than one set of standards applies to ${division.label}, so none can be shown.`,
          );
          break;
        case 'unreadable':
          notices[lift].add(`The published standards for ${division.label} could not be read.`);
          break;
        // `none` is not a notice: a federation that publishes no bench standard
        // for a masters division is the ordinary case, and a line saying so
        // under every empty cell would be most of the report. `unselected` is
        // unreachable, because the category is total here. Both are listed
        // rather than defaulted so a new member of the union stops compiling.
        case 'none':
        case 'unselected':
          break;
      }
    }
  }

  for (const lift of LIFTS) {
    for (const [, group] of tables[lift]) {
      for (const standard of group.ladder.standards) {
        rows[lift].push(
          classificationRow(
            weightClass,
            lift,
            standard,
            group.divisions,
            resolved.divisions.length,
          ),
        );
      }
    }
  }
}

interface TableGroup {
  readonly ladder: ClassificationLadder;
  readonly divisions: AgeDivision[];
}

function classificationRow(
  weightClass: WeightClass,
  lift: Lift,
  standard: ClassificationStandard,
  divisions: readonly AgeDivision[],
  divisionsShown: number,
): ClassificationRow {
  return {
    kind: 'classification',
    id: `classification:${weightClass.id}:${lift}:${divisions.map((division) => division.id).join('+')}:${standard.id}`,
    ...figuresFor(standard.requiredKilograms),
    title: standard.label,
    divisionLabel: divisions.length === divisionsShown ? null : labelsOf(divisions),
    eventLabel: null,
  };
}

function labelsOf(divisions: readonly AgeDivision[]): string {
  return divisions.map((division) => division.label).join(', ');
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
function addRecordRows(
  rows: Record<Lift, ReportRow[]>,
  notices: Record<Lift, Set<string>>,
  weightClass: WeightClass,
  axes: LifterAxes,
  resolved: ResolvedSelection,
  recordBooks: ReadonlyMap<string, RecordBook | null>,
): void {
  for (const partition of resolved.partitions) {
    const book = recordBooks.get(partitionKey(partition)) ?? null;
    for (const division of resolved.divisions) {
      for (const discipline of resolved.disciplines) {
        const category = recordCategoryFrom(
          lifterCategoryFor(axes, weightClass.id, division.id),
          partition,
          discipline.id,
        );
        // The discipline's own lifts, never all four: a bench-only event has no
        // squat record, and a row saying none stands would be true of a record
        // that cannot exist -- which reads as a hole in the data.
        const standings = resolveRecordStandings(book, category, discipline.lifts, NO_ENTRIES);

        for (const standing of standings) {
          if (standing.record.kind === 'ambiguous') {
            notices[standing.lift].add(
              `More than one ${partition.label} record is published for ${division.label} ${discipline.label}, so none can be shown.`,
            );
            continue;
          }
          if (standing.record.kind !== 'record') {
            continue;
          }
          const row = recordRow(
            standing,
            standing.record.record,
            weightClass,
            partition,
            division,
            discipline,
          );
          if (row !== null) {
            rows[standing.lift].push(row);
          }
        }
      }
    }
  }
}

function recordRow(
  standing: LiftRecordStanding,
  record: FederationRecord,
  weightClass: WeightClass,
  partition: RecordPartition,
  division: AgeDivision,
  discipline: Discipline,
): RecordRow | null {
  const targets = recordTargetLines(standing).map((line) => ({
    condition: line.condition,
    basis: line.basis,
    ...figuresFor(line.kilograms),
  }));
  const [primary] = targets;
  if (primary === undefined) {
    // Only reachable for a standing with no targets, which is a standing with no
    // record -- already excluded by the caller. Returning `null` rather than
    // asserting keeps the impossible case out of the ladder instead of into it
    // at `NaN` kilograms, which sorts first and reads as the easiest rung.
    return null;
  }

  return {
    kind: 'record',
    // Built from the loop rather than from `record.id`; see {@link ReportRowBase.id}.
    id: `record:${weightClass.id}:${partition.levelId}:${partition.regionId ?? ''}:${division.id}:${discipline.id}:${standing.lift}`,
    ...figuresFor(primary.kilograms),
    title: `${partition.label} record`,
    divisionLabel: division.label,
    eventLabel: discipline.label,
    detail: {
      record: figuresFor(record.kilograms),
      targets,
      unclaimed: record.unclaimed,
      holder: recordHolder(record),
      sourceUrl: standing.sourceUrl,
    },
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
