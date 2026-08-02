import type { FederationRecord, RecordScope } from '@platform-toolkit/data-contracts';

import { ceilToHundredths } from './rounding.js';

/**
 * Finding the record that applies to a lifter, and measuring the distance to it.
 *
 * Matching is exact on every axis. A record is a fact about one category, so
 * unlike a classification table there is no general record that stands in when a
 * specific one is missing -- falling back to a broader category would compare a
 * lifter against a lift nobody in their category has made.
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

/** Where a lift sits against a record. */
export interface RecordStanding {
  readonly record: FederationRecord;

  /** The lift that would replace the record: the record plus the required margin. */
  readonly kilogramsToReplace: number;

  /** Whether the lift given is enough to replace it. */
  readonly wouldReplace: boolean;

  /** How much more is needed. `null` once the record would be replaced. */
  readonly kilogramsRemaining: number | null;
}

/**
 * Measures a lift against a record.
 *
 * @param minimumIncrementKilograms The margin the record book requires, which
 *   comes from the book rather than being assumed. Zero means matching the record
 *   is enough to replace it.
 * @throws {RangeError} if the lift is not a positive finite number, or the
 *   increment is negative.
 */
export function standingAgainstRecord(
  liftedKilograms: number,
  record: FederationRecord,
  minimumIncrementKilograms: number,
): RecordStanding {
  if (!Number.isFinite(liftedKilograms) || liftedKilograms <= 0) {
    throw new RangeError(
      `Expected a positive finite lift in kilograms, received ${String(liftedKilograms)}`,
    );
  }
  if (!Number.isFinite(minimumIncrementKilograms) || minimumIncrementKilograms < 0) {
    throw new RangeError(
      `Expected a non-negative finite increment in kilograms, received ${String(minimumIncrementKilograms)}`,
    );
  }

  // Both figures are work the lifter has left, so both round up. See `rounding.ts`.
  const kilogramsToReplace = ceilToHundredths(record.kilograms + minimumIncrementKilograms);
  const remaining = ceilToHundredths(kilogramsToReplace - liftedKilograms);

  // Rounding before the comparison, rather than testing the raw difference
  // against zero, is what stops a lift that exactly matches the target from
  // reading as short of it when the subtraction lands a fraction above zero.
  return {
    record,
    kilogramsToReplace,
    wouldReplace: remaining <= 0,
    kilogramsRemaining: remaining <= 0 ? null : remaining,
  };
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
