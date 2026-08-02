import * as v from 'valibot';

import { LiftSchema, SexCategorySchema } from './categories.js';

/**
 * Records, and the exact category each one belongs to.
 *
 * A record is not like a classification standard. Standards can be published
 * once for a broad group of lifters; a record belongs to precisely one category,
 * because it is a fact about a lift that actually happened. So there is no
 * "applies to everyone" here -- every axis is pinned, and a lookup that finds no
 * record has found that no record exists for that category, which is itself
 * something worth showing a lifter.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/**
 * The lift a record is set in.
 *
 * Re-exported from `categories.js`, where it moved once disciplines needed to say
 * which lifts they hold. Kept exported here because a record's lift is the first
 * place most callers meet it, and moving the name would be churn in every import.
 */
export { LiftSchema } from './categories.js';
export type { Lift } from './categories.js';

/** Exactly which category a record belongs to. */
export const RecordScopeSchema = v.object({
  /**
   * The level the record is kept at: state, national, world, and so on.
   *
   * An identifier rather than a fixed list, because the set of levels differs
   * between federations and a lifter comparing themselves against a record needs
   * the source's own name for it.
   */
  levelId: Identifier,

  /**
   * The region the level is scoped to -- a state for a state record -- or `null`
   * for a level that has no subdivision.
   *
   * Two states hold separate records under the same level, so this is part of the
   * identity of a record and not a display detail.
   */
  regionId: v.nullable(Identifier),

  sex: SexCategorySchema,
  equipmentId: Identifier,

  /**
   * The event the record was set at: a full-power meet, or a single-lift one.
   *
   * Part of a record's identity and not a display detail. A federation keeps the
   * best raw bench at a full-power meet and the best at a bench-only meet as two
   * separate records, and on the real corpus a scope without this axis makes
   * twenty thousand rows collide -- which surfaces as `ambiguous` from
   * `findRecord`, or as one record silently overwriting another.
   */
  disciplineId: Identifier,

  weightClassId: Identifier,
  divisionId: Identifier,
  tested: v.boolean(),
  lift: LiftSchema,
});
export type RecordScope = v.InferOutput<typeof RecordScopeSchema>;

/**
 * A single record.
 *
 * Named for the federation rather than `Record`, which is a TypeScript utility
 * type and would shadow it in every file that imports both.
 */
export const FederationRecordSchema = v.object({
  id: Identifier,
  scope: RecordScopeSchema,

  /** The lift, in kilograms. */
  kilograms: v.pipe(
    v.number(),
    v.finite(),
    v.check((kilograms) => kilograms > 0, 'a lift above zero'),
  ),

  /**
   * Whether the figure is the federation's own opening standard rather than a
   * lift somebody made.
   *
   * A federation founding a record book seeds every category with a bar to
   * clear, so that the first lifter in a category has something to beat. That
   * figure is a real record in every way that matters to a lifter -- clearing it
   * takes the record -- but nobody holds it.
   *
   * Not derivable from `holderName === null`, which is why it is its own field.
   * That says the source did not name a holder, and the two want opposite
   * sentences: an unnamed holder is a gap in the data, an unclaimed record is an
   * invitation. Collapsing them loses the more useful one.
   *
   * Required rather than optional and defaulted. A publisher that has not
   * considered the question must not silently claim somebody holds the record.
   */
  unclaimed: v.boolean(),

  /**
   * Who holds it, as the source publishes it, or `null` if the source omits it
   * or nobody holds it yet.
   *
   * A record holder's name is published by the federation and belongs on the
   * screen next to their lift. It is not the same kind of value as an imported
   * athlete's details, which stay out of logs and error reports.
   */
  holderName: v.nullable(Label),

  /** The date it was set, `YYYY-MM-DD`, or `null` if the source omits it. */
  achievedOn: v.nullable(v.pipe(v.string(), v.isoDate())),

  /** The meet it was set at, or `null` if the source omits it. */
  meetName: v.nullable(Label),
});
export type FederationRecord = v.InferOutput<typeof FederationRecordSchema>;

/** A published book of records, and the rule for beating one. */
export const RecordBookSchema = v.object({
  id: Identifier,
  label: Label,

  /**
   * How much a lift must exceed a record by to replace it.
   *
   * Federations differ, and some require a margin rather than merely matching.
   * Assuming either would be wrong somewhere: a lifter told they had broken a
   * record by equalling it would find out otherwise on the platform, so the rule
   * comes from the source along with the records it governs. Zero means matching
   * is enough.
   */
  minimumIncrementKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),

  records: v.array(FederationRecordSchema),
});
export type RecordBook = v.InferOutput<typeof RecordBookSchema>;
