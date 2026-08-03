// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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

/**
 * The lift a figure is about. `total` is the sum of the three.
 *
 * A fixed list rather than data, unlike everything else in this file. The three
 * competition lifts and their sum are what a powerlifting meet is; a federation
 * that contested a fourth movement would be a different sport, and every formula
 * and every screen in this project would need widening alongside the vocabulary.
 * Federations disagree about categories, not about what a squat is.
 */
export const LiftSchema = v.picklist(['squat', 'bench', 'deadlift', 'total']);
export type Lift = v.InferOutput<typeof LiftSchema>;

/**
 * An equipment category, such as the one a raw lifter competes in.
 *
 * Left as data rather than a fixed list because federations disagree about both
 * the names and the boundaries -- what counts as raw in one is a separate
 * category in another -- and because a lifter comparing themselves against a
 * record needs the source's own category, not this project's translation of it.
 */
export const EquipmentCategorySchema = v.object({
  id: Identifier,
  label: Label,
});
export type EquipmentCategory = v.InferOutput<typeof EquipmentCategorySchema>;

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

/** One subdivision of a level, such as a state within a national federation. */
export const CompetitionRegionSchema = v.object({
  id: Identifier,
  label: Label,
});
export type CompetitionRegion = v.InferOutput<typeof CompetitionRegionSchema>;

/**
 * A level records are kept at, and the regions it is divided into.
 *
 * `regions` is empty for a level that is not subdivided -- there is one national
 * record, not one per state -- and a record at such a level carries
 * `regionId: null`. An empty list rather than an absent field, because "this
 * level has no subdivisions" is a statement the source makes and a reader has to
 * render, and a missing field is indistinguishable from a transcription that
 * forgot them.
 *
 * This is here rather than in the record artifact because a lifter chooses a
 * level and a region *before* anything knows which record file to fetch. Records
 * are partitioned on exactly those two axes (see `record-shards.ts`), so a
 * vocabulary that lived inside a partition could only be read by somebody who
 * already knew which partition they wanted.
 */
export const CompetitionLevelSchema = v.object({
  id: Identifier,
  label: Label,
  regions: v.array(CompetitionRegionSchema),
});
export type CompetitionLevel = v.InferOutput<typeof CompetitionLevelSchema>;

/**
 * A contested event, and which lifts it holds records in.
 *
 * A full-power meet contests all three lifts and a total; a bench-only meet
 * contests one lift and has no total. Without this axis two records collide: the
 * best raw bench by an open man at a full-power meet and the best at a bench-only
 * meet are two different records the federation keeps separately, and on the real
 * corpus merging them loses twenty thousand rows to apparent duplication.
 *
 * `lifts` is carried rather than inferred from a name. "Deadlift Only" is a
 * caption, and a project that read the caption would be guessing in the
 * federation's language about a fact the federation states.
 */
export const DisciplineSchema = v.object({
  id: Identifier,
  label: Label,
  lifts: v.pipe(v.array(LiftSchema), v.minLength(1)),
});
export type Discipline = v.InferOutput<typeof DisciplineSchema>;
