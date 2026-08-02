/**
 * Reads what the lifter typed against the records their category holds.
 *
 * `standards.ts`'s sibling, and deliberately shaped the same way: pure, two axes
 * kept apart, every sentence written here rather than in the component so it can
 * be asserted without a browser. What differs is the matching rule, and the
 * difference is the whole reason this is a separate file.
 *
 * A CLASSIFICATION FALLS BACK; A RECORD DOES NOT
 *
 * `selectClassificationTable` picks the most specific published table and is
 * happy to use a general one -- a federation may publish one set of standards for
 * every division. Records have no such thing. A record is a fact about a lift
 * that happened in exactly one category, so {@link findRecord} matches on all
 * nine axes and reports `no-match` rather than widening. That is not a
 * limitation to work around: a broader record would tell a lifter their squat is
 * short of a figure nobody in their category has ever made.
 *
 * NO RECORD IS AN ANSWER WORTH SHOWING
 *
 * The most useful thing this panel says is often that nothing stands yet, and
 * what it would take. `none` therefore gets a sentence of its own rather than an
 * empty row, and a record with no entry beside it still prints the figure that
 * would replace it -- the target is useful before the lifter has typed anything.
 */
import type {
  FederationRecord,
  Lift,
  RecordBook,
  RecordScope,
} from '@platform-toolkit/data-contracts';
import {
  findRecord,
  standingAgainstRecord,
  type RecordStanding,
  type WeightUnit,
} from '@platform-toolkit/domain';

import type { RecordPartition } from './record-scope.js';
import {
  LIFT_LABELS,
  formatAsUnit,
  readLiftEntries,
  type LifterCategory,
  type LiftEntries,
  type LiftEntry,
} from './standards.js';

/**
 * Every axis of a record except the lift.
 *
 * The lifter half and the record-book half of the screen, joined. Built by
 * {@link recordCategoryFrom} and nowhere else, so that the two halves cannot be
 * combined with one of them half-answered.
 */
export type RecordCategory = Omit<RecordScope, 'lift'>;

/** Which record applies to this lifter and this lift, if any. */
export type LiftRecord =
  /** The category or the record scope is not fully answered yet. */
  | { readonly kind: 'unselected' }
  /** Nothing stands in this category. A real answer, and often the interesting one. */
  | { readonly kind: 'none' }
  /** The source published two records for one category. Reported, never resolved. */
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'record'; readonly record: FederationRecord };

export interface LiftRecordStanding {
  readonly lift: Lift;
  readonly label: string;
  readonly entry: LiftEntry;
  readonly record: LiftRecord;
  /**
   * Where the entry sits against the record.
   *
   * `null` unless there is both a record and a usable weight. Kept beside the
   * record rather than folded into it for the reason `standards.ts` gives at
   * length: a lifter who mistypes their squat in a category with a record should
   * be told both things, and one union has to pick one.
   */
  readonly standing: RecordStanding | null;
  /**
   * The lift that would replace the record: the record plus the required margin.
   *
   * Present whenever there is a record, entry or no entry, because it is the
   * number a lifter came to find out and it does not depend on them having typed
   * anything. `null` only when there is no record to beat.
   */
  readonly kilogramsToReplace: number | null;
  /** The unit every figure in this standing is written in. Carried, never passed alongside. */
  readonly unit: WeightUnit;
}

/**
 * The full record category, or `null` while any part of it is unanswered.
 *
 * All-or-nothing for the same reason `lifterCategoryFrom` is, and more sharply:
 * a record lookup matches exactly, so a missing axis does not select a broader
 * record -- it selects nothing, and the panel would report that the federation
 * keeps no record in a category it certainly does.
 *
 * The partition arrives already settled (see {@link RecordPartition}), which is
 * what lets `regionId: null` mean "this level is not subdivided" here without
 * being confused with an unanswered question.
 */
export function recordCategoryFrom(
  lifter: LifterCategory | null,
  partition: RecordPartition | null,
  disciplineId: string | null,
): RecordCategory | null {
  if (lifter === null || partition === null || disciplineId === null) {
    return null;
  }
  return {
    levelId: partition.levelId,
    regionId: partition.regionId,
    sex: lifter.sex,
    equipmentId: lifter.equipmentId,
    disciplineId,
    weightClassId: lifter.weightClassId,
    divisionId: lifter.divisionId,
    tested: lifter.tested,
  };
}

/**
 * Reads every lift the chosen event contests.
 *
 * `lifts` comes from the discipline rather than from {@link LIFT_LABELS}, so a
 * bench-only event produces one card and not four -- three of which would say
 * that no record stands, which is true of a record that cannot exist and reads
 * as a hole in the data.
 */
export function resolveRecordStandings(
  book: RecordBook | null,
  category: RecordCategory | null,
  lifts: readonly Lift[],
  entries: LiftEntries,
): readonly LiftRecordStanding[] {
  const read = readLiftEntries(entries);

  return lifts.map((lift) => {
    const entry = read[lift];
    const record = recordFor(book, category, lift);
    if (record.kind !== 'record') {
      return {
        lift,
        label: LIFT_LABELS[lift],
        entry,
        record,
        standing: null,
        kilogramsToReplace: null,
        unit: entries.unit,
      };
    }

    // From the book, never assumed. A federation that requires a margin and one
    // that does not disagree about whether equalling a record breaks it, and a
    // lifter told the wrong answer finds out on the platform. The book is
    // non-null here because `recordFor` only returns a record when it had one.
    const increment = book?.minimumIncrementKilograms ?? 0;

    // Measured against the record's own figure when nothing has been typed. The
    // target does not depend on the lift handed in -- it is the record plus the
    // margin, rounded up -- so this reaches the same arithmetic rather than
    // repeating it, and the two sentences on the card cannot round differently.
    const measured = standingAgainstRecord(
      entry.kind === 'weight' ? entry.kilograms : record.record.kilograms,
      record.record,
      increment,
    );

    return {
      lift,
      label: LIFT_LABELS[lift],
      entry,
      record,
      standing: entry.kind === 'weight' ? measured : null,
      kilogramsToReplace: measured.kilogramsToReplace,
      unit: entries.unit,
    };
  });
}

function recordFor(
  book: RecordBook | null,
  category: RecordCategory | null,
  lift: Lift,
): LiftRecord {
  if (category === null) {
    return { kind: 'unselected' };
  }
  if (book === null) {
    return { kind: 'none' };
  }
  const found = findRecord({ ...category, lift }, book.records);
  if (found.ok) {
    return { kind: 'record', record: found.record };
  }
  return found.reason === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'none' };
}

/**
 * The record itself, as a figure, or `null` when there is none to print.
 *
 * Separate from the status line because it is the largest thing on the card and
 * the status line is the smallest. Folding them into one sentence would put the
 * number a lifter came to read inside a paragraph about their own lift.
 */
export function recordFigure(standing: LiftRecordStanding): string | null {
  if (standing.record.kind !== 'record') {
    return null;
  }
  return formatAsUnit(standing.record.record.kilograms, standing.unit);
}

/**
 * The status line under one record.
 *
 * Ordered the same way `standingSummary` is: what is wrong with the entry comes
 * before what is missing from the data, because the lifter can fix the first and
 * can only report the second.
 */
export function recordSummary(standing: LiftRecordStanding): string {
  if (standing.entry.kind === 'invalid') {
    return standing.entry.message;
  }

  switch (standing.record.kind) {
    case 'unselected':
      return 'Answer every question above to see the records for this category.';
    case 'none':
      // Stated as an opportunity rather than as an absence. A category with no
      // record standing is a category where the first qualifying lift sets one,
      // which is the single most useful thing this panel can tell somebody.
      return 'No record stands in this category. The first qualifying lift sets one.';
    case 'ambiguous':
      return 'More than one record is published for this category, so none can be shown.';
    case 'record':
      break;
  }

  const { standing: against, kilogramsToReplace, unit } = standing;
  if (against === null || kilogramsToReplace === null) {
    // No usable weight yet, so there is nothing to measure -- but the target is
    // still worth printing. It is what the lifter came to find out and it does
    // not depend on them having typed anything.
    return `${formatAsUnit(kilogramsToReplace ?? 0, unit)} replaces it.`;
  }

  const prefix =
    standing.entry.kind === 'weight' && standing.entry.derived ? 'From your three lifts. ' : '';
  if (against.wouldReplace) {
    // Conditional on purpose. This application does not adjudicate a lift, and
    // "you have broken this record" claims an authority it does not have: the
    // record stands until a meet is held under the federation's own officials.
    return `${prefix}This would replace the record, at ${formatAsUnit(kilogramsToReplace, unit)}.`;
  }
  return `${prefix}${formatAsUnit(against.kilogramsRemaining ?? 0, unit)} more replaces it, at ${formatAsUnit(kilogramsToReplace, unit)}.`;
}
