// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  ClassificationScope,
  ClassificationStandard,
  ClassificationTable,
} from '@platform-toolkit/data-contracts';

import { ceilToHundredths } from './rounding.js';

/**
 * Reading a lifted weight against a table of classification standards.
 *
 * Standards are floors. A lifter earns a title by reaching the weight, not by
 * coming close to it, and every comparison in this file is `>=` for that reason.
 * The question the tool exists to answer is the one after that: given what a
 * lifter already has, what is the next title and how far away is it.
 *
 * Which lift is being read is the caller's business, not this file's. A table
 * names its lift in its scope, and {@link selectClassificationTable} matches on
 * it, so a squat is never read against a full-power total.
 */

/** Why a table of standards could not be accepted. */
export type ClassificationLadderProblemCode =
  'empty' | 'duplicate-id' | 'duplicate-rank' | 'rank-disagrees-with-total';

export interface ClassificationLadderProblem {
  readonly code: ClassificationLadderProblemCode;
  /** Plain-language description, addressed to whoever maintains the data feed. */
  readonly message: string;
}

export type ClassificationLadderResult =
  | { readonly ok: true; readonly ladder: ClassificationLadder }
  | { readonly ok: false; readonly problems: readonly ClassificationLadderProblem[] };

/** Where a lifted weight sits in a table of standards. */
export interface Classification {
  /** The most demanding standard the weight reaches, or `null` if it reaches none. */
  readonly achieved: ClassificationStandard | null;

  /** The next standard up, or `null` once the most demanding one is reached. */
  readonly next: ClassificationStandard | null;

  /** Kilograms still to find for `next`. `null` when there is no next. */
  readonly kilogramsToNext: number | null;
}

/**
 * A table of standards ordered from least to most demanding.
 *
 * Built through {@link ClassificationLadder.from}, which rejects a table whose
 * declared ranks disagree with its totals. That disagreement is the failure worth
 * catching: sorting by either one alone would produce a plausible order from a
 * mistranscribed table and tell a lifter they had earned a title they had not.
 */
export class ClassificationLadder {
  private constructor(readonly standards: readonly ClassificationStandard[]) {}

  /** Checks a table as published and accepts it, or reports every problem found. */
  static from(standards: readonly ClassificationStandard[]): ClassificationLadderResult {
    const problems = findProblems(standards);
    if (problems.length > 0) {
      return { ok: false, problems };
    }
    const ordered = [...standards].sort((left, right) => left.rank - right.rank);
    return { ok: true, ladder: new ClassificationLadder(ordered) };
  }

  /**
   * Reads a lifted weight against the table.
   *
   * @throws {RangeError} if the weight is not a positive finite number.
   */
  classify(achievedKilograms: number): Classification {
    if (!Number.isFinite(achievedKilograms)) {
      throw new RangeError(
        `Expected a finite weight in kilograms, received ${String(achievedKilograms)}`,
      );
    }
    if (achievedKilograms <= 0) {
      throw new RangeError(
        `Expected a positive weight in kilograms, received ${achievedKilograms}`,
      );
    }

    // The standards ascend, so the last one reached is the most demanding one.
    let achieved: ClassificationStandard | null = null;
    let next: ClassificationStandard | null = null;
    for (const standard of this.standards) {
      if (achievedKilograms >= standard.requiredKilograms) {
        achieved = standard;
      } else {
        next = standard;
        break;
      }
    }

    return {
      achieved,
      next,
      // Work left, so it rounds up: a lifter told they need 2.49 kg who adds
      // exactly that has not reached the standard. See `rounding.ts`.
      kilogramsToNext:
        next === null ? null : ceilToHundredths(next.requiredKilograms - achievedKilograms),
    };
  }
}

function findProblems(
  standards: readonly ClassificationStandard[],
): readonly ClassificationLadderProblem[] {
  if (standards.length === 0) {
    return [{ code: 'empty', message: 'A classification table must have at least one standard.' }];
  }

  const problems: ClassificationLadderProblem[] = [];
  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();

  for (const standard of standards) {
    if (seenIds.has(standard.id)) {
      problems.push({
        code: 'duplicate-id',
        message: `Classification standard id "${standard.id}" appears more than once.`,
      });
    }
    seenIds.add(standard.id);

    if (seenRanks.has(standard.rank)) {
      problems.push({
        code: 'duplicate-rank',
        message: `Two classification standards share rank ${standard.rank}, so their order is undefined.`,
      });
    }
    seenRanks.add(standard.rank);
  }

  const byRank = [...standards].sort((left, right) => left.rank - right.rank);
  for (const [index, standard] of byRank.entries()) {
    const lower = index === 0 ? undefined : byRank[index - 1];
    if (lower !== undefined && standard.requiredKilograms <= lower.requiredKilograms) {
      problems.push({
        code: 'rank-disagrees-with-total',
        message: `Classification standard "${standard.id}" ranks above "${lower.id}" but does not require a larger weight.`,
      });
    }
  }

  return problems;
}

/** A lifter, as far as choosing a table of standards is concerned. */
export interface ClassificationQuery {
  readonly sex: ClassificationScope['sex'];
  readonly lift: ClassificationScope['lift'];
  readonly equipmentId: string;
  readonly weightClassId: string;
  readonly divisionId: string;
  readonly tested: boolean;
}

export type ClassificationTableSelection =
  | { readonly ok: true; readonly table: ClassificationTable }
  | { readonly ok: false; readonly reason: 'no-match' | 'ambiguous' };

/**
 * Picks the table that applies to a lifter, preferring the most specific.
 *
 * A federation may publish a general table and override it for, say, equipped
 * lifters. Both match an equipped lifter, and the override is the answer -- so
 * matches are ranked by how many axes they pin down. Two equally specific matches
 * are reported as ambiguous rather than resolved by document order: the data has
 * two answers, and picking the earlier one would hide that from whoever can fix
 * it while quietly showing one of them to a lifter.
 */
export function selectClassificationTable(
  query: ClassificationQuery,
  tables: readonly ClassificationTable[],
): ClassificationTableSelection {
  const [first, ...rest] = tables.filter((table) => scopeMatches(table.scope, query));
  if (first === undefined) {
    return { ok: false, reason: 'no-match' };
  }

  let best = first;
  let bestSpecificity = specificityOf(best.scope);
  let tied = false;

  for (const candidate of rest) {
    const specificity = specificityOf(candidate.scope);
    if (specificity > bestSpecificity) {
      best = candidate;
      bestSpecificity = specificity;
      tied = false;
    } else if (specificity === bestSpecificity) {
      tied = true;
    }
  }

  return tied ? { ok: false, reason: 'ambiguous' } : { ok: true, table: best };
}

function scopeMatches(scope: ClassificationScope, query: ClassificationQuery): boolean {
  // Sex and lift are constitutive: neither is nullable, so neither can widen a
  // table to cover a lifter it was not published for.
  if (scope.sex !== query.sex || scope.lift !== query.lift) {
    return false;
  }
  // A null axis is the source saying it does not distinguish on that axis, so it
  // matches every lifter rather than none.
  return (
    (scope.equipmentId === null || scope.equipmentId === query.equipmentId) &&
    (scope.weightClassId === null || scope.weightClassId === query.weightClassId) &&
    (scope.divisionId === null || scope.divisionId === query.divisionId) &&
    (scope.tested === null || scope.tested === query.tested)
  );
}

/** How many axes the scope pins down. Sex and lift are always pinned, so neither counts. */
function specificityOf(scope: ClassificationScope): number {
  return [scope.equipmentId, scope.weightClassId, scope.divisionId, scope.tested].filter(
    (axis) => axis !== null,
  ).length;
}
