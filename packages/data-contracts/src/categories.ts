import * as v from 'valibot';

/**
 * The competition categories that classes, records, and standards are indexed by.
 *
 * Nothing here is hard-coded to a particular federation's current values. The
 * shapes are fixed; the contents arrive as data. A federation that adds a weight
 * class, renames a division, or changes an age boundary should require a data
 * refresh and no code change at all -- and a lifter looking at a stale boundary
 * would draw a wrong conclusion about whether they qualify, so this is the axis
 * along which the project has to bend easily.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/**
 * The categories under which classes and records are published.
 *
 * This enumerates how the source data is organised, not a claim about who
 * competes. Sources that publish additional categories will need this widened
 * along with the records keyed by it.
 */
export const SexCategorySchema = v.picklist(['female', 'male']);
export type SexCategory = v.InferOutput<typeof SexCategorySchema>;

/** A single bodyweight class. */
export const WeightClassSchema = v.object({
  /** Stable identifier, e.g. "m-75". Used to key records and standards. */
  id: Identifier,

  /** How the class is written on a scoresheet, e.g. "75 kg" or "140+ kg". */
  label: Label,

  /**
   * The heaviest bodyweight that makes this class, or `null` for the top class.
   *
   * `null` rather than a large sentinel is deliberate. Every ladder ends in an
   * unbounded class, and encoding that as, say, `999` would make "is this lifter
   * in the top class" a comparison against a magic number that ingestion and the
   * interface would each have to know. Ingestion normalises "140+" to `null`.
   */
  maximumKilograms: v.nullable(
    v.pipe(
      v.number(),
      v.finite(),
      v.check((kilograms) => kilograms > 0, 'a weight above zero'),
    ),
  ),
});
export type WeightClass = v.InferOutput<typeof WeightClassSchema>;

/** The ordered set of weight classes published for one sex category. */
export const WeightClassLadderSchema = v.object({
  id: Identifier,
  label: Label,
  sex: SexCategorySchema,
  classes: v.pipe(v.array(WeightClassSchema), v.minLength(1)),
});
export type WeightClassLadderData = v.InferOutput<typeof WeightClassLadderSchema>;

/**
 * Which day's age decides a lifter's division.
 *
 * Federations differ, and the difference is not academic: a lifter born in
 * December who turns 40 two weeks after a March meet is a Master under
 * `age-in-calendar-year` and an Open lifter under `age-on-meet-date`. Choosing
 * one silently would put a lifter in the wrong division for half the year, so
 * the basis travels with the division set that depends on it.
 */
export const AgeBasisSchema = v.picklist(['age-on-meet-date', 'age-in-calendar-year']);
export type AgeBasis = v.InferOutput<typeof AgeBasisSchema>;

const Age = v.pipe(v.number(), v.integer(), v.minValue(0));

/** A single age division. */
export const AgeDivisionSchema = v.object({
  id: Identifier,
  label: Label,

  /** Youngest eligible age, inclusive. `null` means no lower bound. */
  minimumAge: v.nullable(Age),

  /** Oldest eligible age, inclusive. `null` means no upper bound. */
  maximumAge: v.nullable(Age),
});
export type AgeDivision = v.InferOutput<typeof AgeDivisionSchema>;

/**
 * The age divisions published by one federation, with the basis they are read on.
 *
 * Divisions overlap by design -- an Open division admits everyone, and a lifter
 * of 45 is eligible for both it and a Masters division -- so this is a set, not
 * a ladder.
 */
export const AgeDivisionSetSchema = v.object({
  id: Identifier,
  label: Label,
  basis: AgeBasisSchema,
  divisions: v.pipe(v.array(AgeDivisionSchema), v.minLength(1)),
});
export type AgeDivisionSet = v.InferOutput<typeof AgeDivisionSetSchema>;
