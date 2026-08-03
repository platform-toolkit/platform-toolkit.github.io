// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { FederationRecord, RecordBook, RecordScope } from '@platform-toolkit/data-contracts';

import { ceilToHundredths, ceilToIncrement } from './rounding.js';

/**
 * Finding the record that applies to a lifter, and measuring the distance to it.
 *
 * Matching is exact on every axis. A record is a fact about one category, so
 * unlike a classification table there is no general record that stands in when a
 * specific one is missing -- falling back to a broader category would compare a
 * lifter against a lift nobody in their category has made.
 *
 * WHY TAKING A RECORD IS NOT ONE NUMBER
 *
 * It reads like one -- the record plus the margin -- and for a long time this
 * file computed exactly that. It is the answer to only the commonest of three
 * cases, and it is the wrong answer to the other two in the direction that costs
 * a lifter something.
 *
 * The rule the federations actually state, in one sentence: **chip by the small
 * increment when the record being claimed is at the meet's level or above it;
 * add the full loading increment when the record is below the meet's level.** So
 * a state record is chipped at a state meet and at a local meet, and costs the
 * full increment at nationals. A national record is chipped at nationals, and at
 * a state meet too where that meet is sanctioned to allow one. That asymmetry is
 * why the condition is stated about the record relative to the meet, and never
 * about the record alone.
 *
 * A record still standing at the figure the federation seeded the book with is
 * not a lift anybody made. Where the rules say so, clearing it means putting that
 * figure on the bar, not that figure plus a margin. Told otherwise, a lifter
 * loads a heavier attempt than the record needs, and a heavier attempt is a
 * likelier miss.
 *
 * The chip is measured from the record as published, not from the next ordinary
 * bar multiple: a 200.5 kg record is chipped at 201 kg, not 202.5. Record
 * attempts are the exemption from the multiple-of-the-increment rule, so
 * rounding that figure up to a round jump undoes the exemption and asks for
 * weight the rules do not.
 *
 * The full increment is the other way round, and it is the half of this that is
 * easy to get wrong in both directions at once. A record below the meet's level
 * is taken *without* the exemption, so two conditions apply together: the bar
 * has to hold an ordinary multiple of the loading increment, and the attempt has
 * to clear the record by at least the full increment. Against that same 200.5 kg
 * record the answer is 205, because 203 satisfies the margin but is not a legal
 * load, and 202.5 is a legal load but only clears the record by 2. Adding the
 * increment without rounding names a weight the bar cannot make; rounding up to
 * the next multiple without adding it names a weight that does not take the
 * record. Both mistakes cost the lifter the record, so the figure is the first
 * ordinary multiple at or above the record plus the full increment.
 *
 * All three figures come from the book, because they are the federation's rules
 * and not this project's. Nothing here knows which level outranks which, and it
 * does not need to: the condition is the meet the lifter has entered, which this
 * code cannot see. Both figures are produced, each labelled with when it holds,
 * and the lifter knows which meet they are at.
 *
 * Everything here is kilograms, and that is not an implementation detail. Records
 * and attempts are governed in kilograms; a pound figure is a conversion for
 * reading and never a number to compute a target from.
 */

/** The category to look a record up in. Every axis is required, as records are exact. */
export type RecordQuery = RecordScope;

export type RecordLookup =
  | { readonly ok: true; readonly record: FederationRecord }
  | { readonly ok: false; readonly reason: 'no-match' | 'ambiguous' };

/**
 * The one record for this category, if there is one.
 *
 * `no-match` is a real answer rather than an error: a category with no record
 * standing is a category where the first qualifying lift sets one, which is worth
 * telling a lifter. `ambiguous` means the source published two records for one
 * category, which cannot both be current.
 */
export function findRecord(query: RecordQuery, records: readonly FederationRecord[]): RecordLookup {
  const matches = records.filter((record) => scopeEquals(record.scope, query));
  const [first, second] = matches;
  if (first === undefined) {
    return { ok: false, reason: 'no-match' };
  }
  if (second !== undefined) {
    return { ok: false, reason: 'ambiguous' };
  }
  return { ok: true, record: first };
}

/**
 * The parts of a record book that say what taking a record costs.
 *
 * Taken as its own type rather than the whole book, so that a caller holding one
 * record and the three rules governing it does not have to carry several thousand
 * others alongside them.
 */
export type RecordMarginRules = Pick<
  RecordBook,
  'minimumIncrementKilograms' | 'higherSanctionIncrementKilograms' | 'matchTakesUnclaimedLevelIds'
>;

/** Why one target figure is the figure it is. */
export type RecordTargetBasis =
  /** The record plus the small increment a record attempt may be chipped by. */
  | 'chip'
  /** The federation's own opening standard, which this book lets a lifter match. */
  | 'match'
  /** The record plus the full loading increment, required for a lower-level record. */
  | 'full-increment';

/** One weight that takes a record, and the reason it is that weight. */
export interface RecordTarget {
  readonly kilograms: number;
  readonly basis: RecordTargetBasis;
}

/**
 * Every weight that takes one record, by the condition each holds under.
 *
 * Both fields are named for the record's level *relative to the meet*, because
 * that relation is the whole rule and every shorter name for it has been read
 * backwards at least once. "At its own level" sounds like it covers one case and
 * silently covers two: a record is chipped both at a meet of its own level and
 * at a meet below it.
 */
export interface RecordTargets {
  readonly record: FederationRecord;

  /**
   * When the record being claimed is at the meet's level or above it.
   *
   * Always present. A record can always be taken where it is kept, and this is
   * also the figure for a record above the meet's level -- a national record at
   * a state meet -- which is chipped on the same terms wherever that meet is
   * sanctioned to allow the claim. Whether it is so sanctioned is a fact about
   * the meet and not about the record, so nothing here can decide it.
   */
  readonly recordAtOrAboveMeetLevel: RecordTarget;

  /**
   * When the record being claimed is below the meet's level -- a state record
   * at a national championship.
   *
   * `null` when the book draws no such distinction, and also when the figure
   * would equal the one above -- two identical weights on screen under two
   * conditions reads as a rule the lifter has failed to understand rather than
   * as one that does not bite here.
   */
  readonly recordBelowMeetLevel: RecordTarget | null;
}

/**
 * What has to go on the bar to take a record, under each condition the book
 * distinguishes.
 *
 * @throws {RangeError} if either margin is negative or not finite.
 */
export function recordTargets(record: FederationRecord, rules: RecordMarginRules): RecordTargets {
  assertMargin(rules.minimumIncrementKilograms, 'minimum increment');
  if (rules.higherSanctionIncrementKilograms !== null) {
    assertMargin(rules.higherSanctionIncrementKilograms, 'higher-sanction increment');
  }

  // Matching applies only to a figure nobody has lifted, and only where the book
  // grants it for that level. Absent from the list means the ordinary margin, not
  // an omission to be filled in: being asked for more than the rules demand costs
  // an attempt, being asked for less costs the record.
  const mayMatch =
    record.unclaimed && rules.matchTakesUnclaimedLevelIds.includes(record.scope.levelId);

  // The chip is measured from the record exactly as published, never from the
  // next ordinary bar multiple above it: a 200.5 kg record is chipped at 201.
  const recordAtOrAboveMeetLevel: RecordTarget = mayMatch
    ? { kilograms: ceilToHundredths(record.kilograms), basis: 'match' }
    : {
        // Work the lifter has left, so it rounds up. See `rounding.ts`.
        kilograms: ceilToHundredths(record.kilograms + rules.minimumIncrementKilograms),
        basis: 'chip',
      };

  // Not the record plus the increment. The rule that costs the full increment is
  // the same rule that withdraws the fractional-plate exemption, so the weight
  // has to be an ordinary multiple of that increment as well as clear of the
  // record by it. The two conditions are stated in one sentence of the rulebook
  // and they are the same number, which is why one field can express both: the
  // first legal load at or above record + increment.
  const fullIncrement = rules.higherSanctionIncrementKilograms;
  const below =
    fullIncrement === null || fullIncrement === 0
      ? null
      : ceilToIncrement(record.kilograms + fullIncrement, fullIncrement);

  return {
    record,
    recordAtOrAboveMeetLevel,
    recordBelowMeetLevel:
      // The stricter figure wins where the two rules overlap: a seeded record
      // that may be matched where it is kept is still a record below the
      // sanction level of a meet held above it, and a preset carries no
      // exemption from that.
      below === null || below <= recordAtOrAboveMeetLevel.kilograms
        ? null
        : { kilograms: below, basis: 'full-increment' },
  };
}

/** Where a lift sits against a record. */
export interface RecordStanding {
  readonly record: FederationRecord;

  /** Every weight that takes it, by condition. */
  readonly targets: RecordTargets;

  /**
   * The lift that would replace the record at a meet whose level the record is
   * at or above, which is the case a lifter is in unless they say otherwise.
   */
  readonly kilogramsToReplace: number;

  /** Whether the lift given is enough to replace it, under that same condition. */
  readonly wouldReplace: boolean;

  /** How much more is needed. `null` once the record would be replaced. */
  readonly kilogramsRemaining: number | null;
}

/**
 * Measures a lift against a record.
 *
 * @param rules The margins the record book publishes, which come from the book
 *   rather than being assumed. See {@link recordTargets}.
 * @throws {RangeError} if the lift is not a positive finite number, or a margin
 *   is negative.
 */
export function standingAgainstRecord(
  liftedKilograms: number,
  record: FederationRecord,
  rules: RecordMarginRules,
): RecordStanding {
  if (!Number.isFinite(liftedKilograms) || liftedKilograms <= 0) {
    throw new RangeError(
      `Expected a positive finite lift in kilograms, received ${String(liftedKilograms)}`,
    );
  }

  const targets = recordTargets(record, rules);
  const kilogramsToReplace = targets.recordAtOrAboveMeetLevel.kilograms;
  const remaining = ceilToHundredths(kilogramsToReplace - liftedKilograms);

  // Rounding before the comparison, rather than testing the raw difference
  // against zero, is what stops a lift that exactly matches the target from
  // reading as short of it when the subtraction lands a fraction above zero.
  return {
    record,
    targets,
    kilogramsToReplace,
    wouldReplace: remaining <= 0,
    kilogramsRemaining: remaining <= 0 ? null : remaining,
  };
}

function assertMargin(kilograms: number, what: string): void {
  if (!Number.isFinite(kilograms) || kilograms < 0) {
    throw new RangeError(
      `Expected a non-negative finite ${what} in kilograms, received ${String(kilograms)}`,
    );
  }
}

/**
 * Every axis of a scope, compared one by one.
 *
 * Written out rather than derived from the schema's keys, so that adding an axis
 * is a compile error somewhere rather than a silent widening here. An axis left
 * out of this function does not fail: the lookup merely stops distinguishing on
 * it, and two records that differ only in the forgotten axis come back as
 * `ambiguous` -- or worse, one of them is returned as if it were the only one.
 */
function scopeEquals(left: RecordScope, right: RecordScope): boolean {
  return (
    left.levelId === right.levelId &&
    left.regionId === right.regionId &&
    left.sex === right.sex &&
    left.equipmentId === right.equipmentId &&
    left.disciplineId === right.disciplineId &&
    left.weightClassId === right.weightClassId &&
    left.divisionId === right.divisionId &&
    left.tested === right.tested &&
    left.lift === right.lift
  );
}
