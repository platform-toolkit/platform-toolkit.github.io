// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

/**
 * A mirror of published competition results, one lifter at a time.
 *
 * Every other dataset in this project answers a question about a *category*: what
 * the record is, what a class-one total comes to, which divisions exist. This one
 * answers a question about a *person* -- what they have actually lifted, and when
 * -- which is what a qualification check needs and what nothing else here can
 * supply.
 *
 * WHAT IS AND IS NOT MIRRORED
 *
 * The upstream corpus is a general-purpose archive of every federation on earth.
 * This mirror is not that; it is the subset this collection is for. See
 * `ingestion/src/sources/athlete-mirror.ts` for the rule and the measurements
 * behind it. A lifter who is not in the mirror gets an honest "no results found"
 * and the manual route, which stays fully usable on its own -- so the scope of
 * the mirror can never be the difference between a right answer and a wrong one,
 * only between a fast answer and a slower one.
 *
 * THE UPSTREAM VOCABULARY IS KEPT, NOT TRANSLATED
 *
 * `federation`, `equipment`, `event`, `division` and `weightClassKg` are carried
 * in the source's own words and are deliberately not mapped onto the identifiers
 * the category catalogues use (section 5.1). Two reasons, and the second is the
 * real one:
 *
 * 1. The corpus spans hundreds of federations and no catalogue covers them.
 * 2. A mapping would be this project asserting that an upstream `Division` string
 *    is the same thing as a federation's own division -- an assertion nobody has
 *    checked, on the one screen whose entire job is to be checkable. An unmapped
 *    string shown as the source printed it is something a lifter can read against
 *    their own entry form. A mapped one is a claim.
 *
 * WHAT NEVER APPEARS IN A LOG
 *
 * A lifter's name. It belongs on the screen beside their results and nowhere near
 * a CI transcript or an error payload (section 2.3). Every failure raised while
 * building this data names a row position, a count, or a bucket -- never a
 * person, and never a profile URL.
 */

const NonEmpty = v.pipe(v.string(), v.minLength(1));

/** A weight in kilograms, as the source recorded it. */
const Kilograms = v.pipe(
  v.number(),
  v.finite(),
  v.check((kilograms) => kilograms > 0, 'a weight above zero'),
);

/**
 * How old the lifter was, in whole years, and whether the source is sure.
 *
 * The upstream corpus writes a half year to mean "one of these two": a lifter
 * recorded as 23.5 was either 23 or 24 on the day, because the meet published a
 * birth year rather than a birth date. That is a real ambiguity and it decides
 * which age division somebody may enter, so it is carried rather than rounded --
 * section 5.5, ambiguity is a first-class outcome, and a rounded age is a
 * confident answer to a question the source declined to answer.
 *
 * Spelled as two fields rather than kept as `23.5`. A fractional age reads as a
 * measurement, and the first thing any consumer would do with it is round.
 */
export const AthleteAgeSchema = v.object({
  years: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** `true` when the lifter was either {@link years} or one year older. */
  approximate: v.boolean(),
});
export type AthleteAge = v.InferOutput<typeof AthleteAgeSchema>;

/**
 * One lifter's result at one meet.
 *
 * Only the columns a qualification or progress question needs. The attempt-by-
 * attempt columns, the several scoring formulae, and the meet's town are all
 * dropped: at roughly six hundred thousand entries each one costs megabytes
 * across the published set, and none of them changes an answer this collection
 * gives. Scores in particular are computed by `packages/domain` from the lifts,
 * so mirroring somebody else's arithmetic would create a second source of truth
 * that could disagree with the one on screen.
 */
export const AthleteEntrySchema = v.object({
  /** The day of the meet, `YYYY-MM-DD`. Never a `Date` (section 5.5). */
  date: v.pipe(v.string(), v.isoDate()),

  /** The sanctioning federation, in the source's own words. */
  federation: NonEmpty,

  /**
   * The federation the sanctioning body belongs to, or `null` where the source
   * names none.
   *
   * This is the axis the mirror is scoped along and the reason a lifter's
   * affiliate meets and their international ones both appear. `null` means the
   * source does not place this federation under a parent, not that it has none.
   */
  parentFederation: v.nullable(NonEmpty),

  meetName: NonEmpty,

  /** `SBD`, `B`, `BD` and so on, in the source's own words. */
  event: NonEmpty,

  /** `Raw`, `Wraps`, `Single-ply` and so on, in the source's own words. */
  equipment: NonEmpty,

  /** The division as the meet entered it, or `null` where the source omits it. */
  division: v.nullable(NonEmpty),

  /** The meet's own age division, such as `24-34`, or `null` where it names none. */
  ageClass: v.nullable(NonEmpty),

  /** See {@link AthleteAgeSchema}. `null` where the source records no age. */
  age: v.nullable(AthleteAgeSchema),

  /**
   * `true` where the source records the meet as drug tested, `null` where it says
   * nothing.
   *
   * Deliberately not a plain boolean. The upstream column only ever asserts the
   * positive -- it is either "Yes" or blank -- and a blank is an absence of
   * information, not a statement that the meet was untested. Collapsing the two
   * would put "untested" beside results from meets that were tested and simply
   * not annotated, and drug-test status is the axis a lifter is turned away at
   * weigh-in over. `false` is legal here and is reserved for a source that one
   * day says so.
   */
  tested: v.nullable(v.boolean()),

  /** `M`, `F`, `Mx`, in the source's own words. */
  sex: NonEmpty,

  /** Weighed-in bodyweight, or `null` where the source omits it. */
  bodyweightKg: v.nullable(Kilograms),

  /**
   * The class entered, as printed: `90`, `90+`, `SHW`. A string, not a number,
   * because the unbounded class has no number and is the one every heavyweight
   * is in.
   */
  weightClassKg: v.nullable(NonEmpty),

  /**
   * Best of three, or `null` where no successful lift is recorded.
   *
   * The two ways to get a `null` are worth spelling out because they look the
   * same here and are not the same thing to a reader: the lifter did not contest
   * the lift at all (a single-lift meet, a push-pull), or they contested it and
   * missed all three. Nothing downstream may treat either as a zero -- a lifter
   * who bombed the squat still made every other lift at that meet, and a zero
   * would put them at the bottom of a ladder they were never on.
   */
  squatKg: v.nullable(Kilograms),
  benchKg: v.nullable(Kilograms),
  deadliftKg: v.nullable(Kilograms),

  /** The total, or `null` for a bomb-out or a single-lift event with no total. */
  totalKg: v.nullable(Kilograms),

  /**
   * Where they placed, as printed: `1`, `DQ`, `NS`, `G`.
   *
   * A string because most of the interesting values are not numbers, and the
   * non-numeric ones carry the information a reader needs -- a disqualified
   * total is not a total anybody qualifies on.
   */
  place: v.nullable(NonEmpty),
});
export type AthleteEntry = v.InferOutput<typeof AthleteEntrySchema>;

/**
 * Everything the mirror holds about one lifter.
 *
 * `name` is the source's own spelling, including the `#2` suffix it appends when
 * two lifters share a name. It is what a screen shows so that a reader can tell
 * which of two matches is theirs, and it is the only reason the suffix is worth
 * keeping.
 */
export const AthleteHistorySchema = v.object({
  /** The fold of {@link name}. See `athleteLookupKey`. */
  key: NonEmpty,
  name: NonEmpty,

  /**
   * Every mirrored entry, oldest first, and never empty.
   *
   * Ordered here rather than in the browser because artifacts are content-
   * addressed: a source that merely reordered its rows would rewrite every
   * filename and evict a cache that was still correct.
   */
  entries: v.pipe(v.array(AthleteEntrySchema), v.minLength(1)),
});
export type AthleteHistory = v.InferOutput<typeof AthleteHistorySchema>;

/**
 * One published bucket of the mirror.
 *
 * A bucket is a hash partition and means nothing to a reader -- see
 * `athlete-shards.ts` for why the corpus is split that way rather than along an
 * axis anybody would recognise.
 */
export const AthleteShardSchema = v.object({
  /**
   * Which bucket this is, and how many there were when it was published.
   *
   * Both carried so that a shard can be checked against the reader that fetched
   * it. A browser running an older bundle computes a bucket under an older count
   * and will usually resolve to no artifact at all, which renders as "no results
   * found"; where it does resolve, this pair is what turns a plausible wrong
   * answer into a detectable one.
   */
  bucket: v.pipe(v.number(), v.integer(), v.minValue(0)),
  bucketCount: v.pipe(v.number(), v.integer(), v.minValue(1)),

  /**
   * The lifters in it, ordered by key and never empty.
   *
   * An array rather than a map keyed by {@link AthleteHistory.key}, because two
   * different lifters can fold to one key and both of them belong here. See
   * `findAthleteHistories`.
   */
  athletes: v.pipe(v.array(AthleteHistorySchema), v.minLength(1)),
});
export type AthleteShard = v.InferOutput<typeof AthleteShardSchema>;

/**
 * The one artifact of the mirror whose name is a constant.
 *
 * There are hundreds of shards and nothing outside them, so without this a
 * reader has no way to ask the prior question -- is there a mirror in this build
 * at all -- except by fetching a bucket and reading "no" into a missing file.
 * That conflates two sentences a screen has to keep apart: "this build published
 * no results archive", which means stop offering to search it, and "nobody in
 * the archive is called that", which means try another spelling.
 */
export const ATHLETE_MIRROR_ARTIFACT_ID = 'athlete-mirror';

/**
 * What the mirror is, said in the words a screen has to print.
 *
 * Small and fetched before any lookup, so everything on it earns its place.
 */
export const AthleteMirrorInfoSchema = v.object({
  id: NonEmpty,
  label: NonEmpty,

  /**
   * The credit the upstream licence asks for, verbatim.
   *
   * Published rather than written into a component, because it is somebody
   * else's sentence about their own work and a build that changes the data must
   * not be able to leave the old credit on the page.
   */
  attribution: NonEmpty,

  /** Where the archive can be read in full. Shown as a link. */
  sourceUrl: v.pipe(
    v.string(),
    v.url(),
    v.check((value) => value.startsWith('https://'), 'an https URL'),
  ),

  /**
   * Who is in the mirror, in a sentence a lifter can check themselves against.
   *
   * The mirror is a subset and a visitor has no way to know that from a "no
   * results" screen -- which is indistinguishable, without this, from "you have
   * never competed". Section 7: say what is covered, say plainly what is not.
   */
  scopeNote: NonEmpty,

  /** How many lifters and entries this build published. Shown beside the credit. */
  athleteCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
  entryCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type AthleteMirrorInfo = v.InferOutput<typeof AthleteMirrorInfoSchema>;

/**
 * Every lifter in a shard whose key matches, in the order the shard holds them.
 *
 * Usually one. Sometimes none -- a shard holds every lifter whose key hashes into
 * it, not only the one that was asked for. Occasionally more than one: folding a
 * name to a lookup key is lossy, so two people genuinely collide, and on the real
 * corpus about two and a half thousand of ninety-seven thousand names do.
 *
 * Returning all of them is the point. Picking the first would merge two people's
 * competition histories into one, and a lifter shown somebody else's total on a
 * qualification screen has been given a confident wrong answer about whether they
 * may enter a meet. The caller shows the matches and asks; section 5.5's
 * ambiguity rule applied to a person.
 *
 * Here rather than in the domain because it is a fact about how this contract is
 * shaped, and every reader of a shard needs the same answer.
 */
export function findAthleteHistories(
  shard: Pick<AthleteShard, 'athletes'>,
  key: string,
): readonly AthleteHistory[] {
  return shard.athletes.filter((athlete) => athlete.key === key);
}
