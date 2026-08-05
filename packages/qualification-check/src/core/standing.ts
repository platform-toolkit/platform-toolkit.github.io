// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { ClassificationTable, Lift } from '@platform-toolkit/data-contracts';
import { ClassificationLadder, selectClassificationTable } from '@platform-toolkit/domain';

import type {
  BestPerformance,
  LiftStanding,
  ObservedStanding,
  ResolvedRegistration,
  StandingReport,
} from '../types.js';

/**
 * Reading a standing against the federation's published classification ladder.
 *
 * This is the whole of way three -- the case the brief calls out as the one that
 * has to be designed best rather than treated as a fallback: "for meets not
 * ingested or not specified, it should show the user everything they would need to
 * know to make the determination such as classification for each individual lift,
 * classification for total, and drug test status". Four grades and the assumptions
 * they were read under, and no verdict of any kind on top of them.
 *
 * Nothing here reaches for a broader table when a narrow one is missing.
 * `selectClassificationTable` ranks by specificity and reports a tie rather than
 * breaking it, and both of its failure modes surface intact: `no-standards` is a
 * category this federation publishes nothing for, and `ambiguous-standards` is two
 * equally specific tables that disagree. Collapsing either into "you have not
 * qualified" would be the failure mode section 5.16 names -- a real answer nobody
 * investigates.
 */

/** Every lift a report covers, in the order a scoresheet prints them. */
const REPORTED_LIFTS: readonly Lift[] = ['squat', 'bench', 'deadlift', 'total'];

/**
 * Grades one standing's four bests under one settled registration.
 *
 * The registration is an argument rather than something derived here, because
 * deriving it would mean this package deciding which division a lifter enters --
 * see `registration.ts` for why that is the reader's decision and not one the
 * archive settles.
 */
export function gradeStanding(
  standing: ObservedStanding,
  registration: ResolvedRegistration,
  tables: readonly ClassificationTable[],
): StandingReport {
  return {
    registration,
    squat: gradeLift(standing.squat, 'squat', registration, tables),
    bench: gradeLift(standing.bench, 'bench', registration, tables),
    deadlift: gradeLift(standing.deadlift, 'deadlift', registration, tables),
    total: gradeLift(standing.total, 'total', registration, tables),
  };
}

/** The lifts {@link gradeStanding} reports on, for a caller iterating a report. */
export function reportedLifts(): readonly Lift[] {
  return REPORTED_LIFTS;
}

/** Reads one figure against the table that covers it. */
export function gradeLift(
  best: BestPerformance | null,
  lift: Lift,
  registration: ResolvedRegistration,
  tables: readonly ClassificationTable[],
): LiftStanding {
  // Checked before the table is looked up, so a lifter with no bench sees "no
  // bench in this window" rather than a complaint about the federation's data.
  // The two read identically on screen and only one of them is theirs to fix.
  if (best === null) {
    return { kind: 'ungraded', reason: 'no-result', best: null };
  }

  const selection = selectClassificationTable(
    {
      sex: registration.sex,
      lift,
      equipmentId: registration.equipmentId,
      weightClassId: registration.weightClassId,
      divisionId: registration.divisionId,
      tested: registration.tested,
    },
    tables,
  );
  if (!selection.ok) {
    return {
      kind: 'ungraded',
      reason: selection.reason === 'ambiguous' ? 'ambiguous-standards' : 'no-standards',
      best,
    };
  }

  const ladder = ClassificationLadder.from(selection.table.standards);
  if (!ladder.ok) {
    // A published table that does not form a ladder cannot grade anybody, and this
    // screen is not where a data fault gets reported. It reads as "no standards",
    // which is what it is from where the lifter is standing.
    return { kind: 'ungraded', reason: 'no-standards', best };
  }

  return {
    kind: 'graded',
    best,
    classification: ladder.ladder.classify(best.kilograms),
    table: selection.table,
  };
}
