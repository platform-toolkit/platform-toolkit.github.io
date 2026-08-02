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
import {
  findRecordSourceTable,
  type FederationRecord,
  type Lift,
  type RecordBook,
  type RecordScope,
} from '@platform-toolkit/data-contracts';
import {
  findRecord,
  standingAgainstRecord,
  type RecordMarginRules,
  type RecordStanding,
  type RecordTargets,
  type WeightUnit,
} from '@platform-toolkit/domain';

import type { RecordPartition } from './selection.js';
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
   * Every weight that takes this record, by the condition each holds under.
   *
   * Present whenever there is a record, entry or no entry, because it is the
   * number a lifter came to find out and it does not depend on them having typed
   * anything. `null` only when there is no record to beat.
   *
   * The whole {@link RecordTargets}, not one figure out of it. A single
   * "replaces it" number is the commonest case and the wrong answer to the other
   * two: a state record costs the full loading increment at a national meet, and
   * a federation-seeded figure can sometimes be matched exactly. Both were
   * previously collapsed into the chip figure, so the panel told a lifter at
   * nationals to load two kilos less than the record needs -- which reads as a
   * successful record attempt right up until the scoring table says otherwise.
   */
  readonly targets: RecordTargets | null;
  /**
   * The table the federation publishes this record in, or `null` when the book
   * lists none for its scope.
   *
   * Carried on the standing so the link and the figure cannot disagree about
   * which record they describe. Never guessed: a table URL assembled from the
   * axes would resolve, and would show somebody else's category.
   */
  readonly sourceUrl: string | null;
  /** The unit every figure in this standing is written in. Carried, never passed alongside. */
  readonly unit: WeightUnit;
}

/**
 * The full record category, or `null` while any part of it is unanswered.
 *
 * All-or-nothing for the same reason `lifterAxesFrom` is, and more sharply:
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
        targets: null,
        sourceUrl: null,
        unit: entries.unit,
      };
    }

    // From the book, never assumed. Federations disagree about whether equalling
    // a record breaks it, about what a record kept below the meet's own sanction
    // level costs, and about whether a figure nobody has lifted may be matched --
    // and a lifter told the wrong answer finds out on the platform. The book is
    // non-null here because `recordFor` only returns a record when it had one.
    const rules: RecordMarginRules = {
      minimumIncrementKilograms: book?.minimumIncrementKilograms ?? 0,
      higherSanctionIncrementKilograms: book?.higherSanctionIncrementKilograms ?? null,
      matchTakesUnclaimedLevelIds: book?.matchTakesUnclaimedLevelIds ?? [],
    };

    // Measured against the record's own figure when nothing has been typed. The
    // target does not depend on the lift handed in, so this reaches the same
    // arithmetic rather than repeating it, and the two sentences on the card
    // cannot round differently.
    const measured = standingAgainstRecord(
      entry.kind === 'weight' ? entry.kilograms : record.record.kilograms,
      record.record,
      rules,
    );

    return {
      lift,
      label: LIFT_LABELS[lift],
      entry,
      record,
      standing: entry.kind === 'weight' ? measured : null,
      targets: measured.targets,
      // From the book's own list, matched on the five axes that address a table.
      // `book` is non-null here for the same reason the rules above are: this
      // branch only runs when `recordFor` found a record in it.
      sourceUrl:
        book === null ? null : (findRecordSourceTable(book, record.record.scope)?.url ?? null),
      unit: entries.unit,
    };
  });
}

/**
 * Every weight that takes one record, each with the condition it holds under.
 *
 * Two rows rather than a sentence, and this is the shape requirement 6 needs:
 * the condition is about the meet the lifter has entered, which this application
 * cannot see and must not guess. Prose forces a guess -- "203 kg replaces it"
 * names one figure with no condition attached, and it is the wrong figure at
 * every meet held above the record's own level.
 *
 * Empty when there is no record. One entry when the book draws no distinction,
 * or when both rules land on the same weight ({@link recordTargets} collapses
 * that case rather than printing one number twice under two conditions).
 */
export function recordTargetLines(
  standing: LiftRecordStanding,
): readonly { readonly condition: string; readonly kilograms: number; readonly basis: string }[] {
  if (standing.targets === null) {
    return [];
  }
  const { recordAtOrAboveMeetLevel, recordBelowMeetLevel } = standing.targets;
  const lines = [
    {
      // Named for the record's level relative to the meet, because that relation
      // is the whole rule and every shorter phrasing has been read backwards at
      // least once. A national record is chipped at nationals *and* at a state
      // meet sanctioned to allow the claim -- one condition, two situations.
      condition: 'At a meet of this level or below',
      kilograms: recordAtOrAboveMeetLevel.kilograms,
      basis: BASIS_NOTES[recordAtOrAboveMeetLevel.basis],
    },
  ];
  if (recordBelowMeetLevel !== null) {
    lines.push({
      condition: 'At a meet above this level',
      kilograms: recordBelowMeetLevel.kilograms,
      basis: BASIS_NOTES[recordBelowMeetLevel.basis],
    });
  }
  return lines;
}

/**
 * Why each figure is the figure it is, in a phrase.
 *
 * Written here rather than in the component so the three can be asserted without
 * a browser, and so that "match" cannot quietly acquire a margin: it is the one
 * basis where the target *equals* the record, and a reader who assumes every
 * target is record-plus-something loads a heavier bar than the rules ask for.
 */
const BASIS_NOTES: Readonly<Record<RecordTargets['recordAtOrAboveMeetLevel']['basis'], string>> = {
  chip: 'record plus the record-attempt margin',
  match: 'matching the opening standard takes it, as nobody holds it yet',
  'full-increment': 'record plus the full loading increment',
};

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
 * What is wrong with the entry comes before what is missing from the data,
 * because the lifter can fix the first and can only report the second.
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

  const { standing: against, targets, unit } = standing;
  const kilogramsToReplace = targets?.recordAtOrAboveMeetLevel.kilograms ?? null;
  if (against === null || kilogramsToReplace === null) {
    // No usable weight yet, so there is nothing to measure. The targets are
    // printed by {@link recordTargetLines} rather than named here, because each
    // of them holds under a condition and a bare figure in a sentence carries
    // none.
    return 'Enter a lift to see how close you are.';
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
