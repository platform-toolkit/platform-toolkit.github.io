// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

import { SexCategorySchema } from './categories.js';
import { LiftSchema } from './records.js';

/**
 * Classification standards: the total a lifter must reach to earn a title.
 *
 * As with the categories, none of the published figures live here. What lives
 * here is the shape they arrive in and the description of which lifters a given
 * table applies to, because that second part is where the real difficulty is. A
 * federation may publish one table for everyone, or split it by equipment, by
 * drug-tested status, by age division, or by any combination -- and a lifter
 * shown the wrong table is told they have achieved something they have not.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/** A single title and the total that earns it. */
export const ClassificationStandardSchema = v.object({
  id: Identifier,
  label: Label,

  /**
   * Position in the table, ascending from the least demanding standard at zero.
   *
   * Carried explicitly rather than inferred from the totals so that the intended
   * order survives a table whose totals were transcribed wrongly: the two
   * disagreeing is a fault to report, not a tie to break silently.
   */
  rank: v.pipe(v.number(), v.integer(), v.minValue(0)),

  /**
   * The weight that earns this standard, in the lift named by the scope. A
   * floor -- the lifter must reach it, not come close to it.
   */
  requiredKilograms: v.pipe(
    v.number(),
    v.finite(),
    v.check((kilograms) => kilograms > 0, 'a weight above zero'),
  ),
});
export type ClassificationStandard = v.InferOutput<typeof ClassificationStandardSchema>;

/**
 * Which lifters a table of standards applies to.
 *
 * `null` on any axis means the table does not distinguish on it. That is not the
 * same as "unknown": a federation publishing one set of standards for tested and
 * untested lifters alike is stating a fact, and recording it as `null` lets the
 * lookup prefer a more specific table where one exists without this project
 * having to assert which axes any particular federation splits on.
 */
export const ClassificationScopeSchema = v.object({
  sex: SexCategorySchema,

  /**
   * Which lift the standards are read against, and never `null`.
   *
   * Unlike the axes below, this one is constitutive rather than a narrowing: a
   * squat standard and a full-power total standard are different things, not a
   * general table and a more specific one. Federations publish separate tables
   * for the single lifts, and a `null` here would let a lifter's squat be read
   * against a total.
   */
  lift: LiftSchema,

  /** Equipment category id, or `null` if the same standards apply to all. */
  equipmentId: v.nullable(Identifier),

  /** Weight class id, or `null` if the same standards apply across the ladder. */
  weightClassId: v.nullable(Identifier),

  /** Age division id, or `null` if the same standards apply across divisions. */
  divisionId: v.nullable(Identifier),

  /** Drug-tested status, or `null` if the same standards apply either way. */
  tested: v.nullable(v.boolean()),
});
export type ClassificationScope = v.InferOutput<typeof ClassificationScopeSchema>;

/** One published table of standards, and the lifters it covers. */
export const ClassificationTableSchema = v.object({
  id: Identifier,
  label: Label,
  scope: ClassificationScopeSchema,
  standards: v.pipe(v.array(ClassificationStandardSchema), v.minLength(1)),
});
export type ClassificationTable = v.InferOutput<typeof ClassificationTableSchema>;

/**
 * One federation's published standards, as a single downloadable artifact.
 *
 * Partitioned -- see `classification-shards.ts` -- so this is one partition of
 * one federation's tables rather than all of them. The federation is named on
 * every partition because a partition is what a reader actually holds, and a
 * document that cannot say whose standards it contains is a document that can be
 * shown against the wrong federation's records.
 */
export const ClassificationBookSchema = v.object({
  /** The federation these standards belong to. */
  id: Identifier,
  label: Label,
  tables: v.pipe(v.array(ClassificationTableSchema), v.minLength(1)),
});
export type ClassificationBook = v.InferOutput<typeof ClassificationBookSchema>;
