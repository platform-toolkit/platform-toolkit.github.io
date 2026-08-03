// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
   * The figure the source's own pound column gives, when it contradicts the
   * kilogram column, or `null` when the two agree.
   *
   * Federations publish a record twice on one row -- once in kilograms and once
   * in pounds -- and on a corpus this size the two sometimes disagree by more
   * than any rounding can explain: a digit inserted into one cell, a decimal
   * point moved, a weight-class figure pasted into the weight column. Measured
   * on the real USPA corpus, 355 of 129,509 published rows.
   *
   * Kilograms govern, so `kilograms` is still the kilogram column and nothing
   * here re-enters the arithmetic. What this field buys is the difference
   * between a wrong number presented with total confidence and a wrong number a
   * lifter can see is wrong -- the screen says the source contradicts itself and
   * links to the table, which is the only place the question can be settled.
   *
   * Not a boolean, because "this may be wrong" with no figure attached is
   * unactionable: a reader shown 147.7 lb beside 670 kg can tell at a glance
   * which cell slipped, and a reader shown a warning icon cannot.
   *
   * Required rather than optional and defaulted, for the same reason
   * {@link FederationRecord.unclaimed} is. A publisher that has not compared the
   * two columns must not silently assert that they agree.
   */
  sourceDisagreement: v.nullable(
    v.object({
      /** The pound column, exactly as the source printed it. */
      pounds: v.pipe(
        v.number(),
        v.finite(),
        v.check((pounds) => pounds > 0, 'a figure above zero'),
      ),

      /**
       * What that pound figure comes to in kilograms.
       *
       * Carried rather than derived in the browser so that the two sides of the
       * comparison are the two the publisher actually compared. Deriving it
       * again needs the federation's own conversion factor, and a browser using
       * a different one would draw a disagreement the publisher did not find --
       * or fail to draw one it did.
       */
      impliedKilograms: v.pipe(
        v.number(),
        v.finite(),
        v.check((kilograms) => kilograms > 0, 'a weight above zero'),
      ),
    }),
  ),

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

/**
 * Where one published table of records can be read, and which records it holds.
 *
 * WHY A TABLE AND NOT A CERTIFICATE
 *
 * A lifter looking at a figure they intend to beat wants to see it in the
 * federation's own words -- who set it, at which meet, and whether the page has
 * moved on since this build read it. The obvious link for that is a certificate,
 * and there isn't one: no federation this project reads publishes a per-record
 * document, and the crawled corpus carries no per-record URL. Inventing one would
 * be a link that either 404s or, worse, resolves to somebody else's record.
 *
 * What does exist is the page the row was read from, which is addressed by the
 * axes below. So a record links to its table, and the tables are listed once per
 * book rather than once per record: a shard holds thousands of records across
 * about six tables, and a URL on every one of them would be most of the payload.
 *
 * The remaining axes -- weight class, division, lift -- are rows within a table
 * and deliberately absent. A scope matches a table when the five it does name
 * agree.
 */
export const RecordSourceTableSchema = v.object({
  levelId: Identifier,
  /** `null` for a level with no subdivision. Never "every region". */
  regionId: v.nullable(Identifier),
  tested: v.boolean(),
  equipmentId: Identifier,
  disciplineId: Identifier,

  /**
   * Where to read it.
   *
   * Checked here rather than trusted, because this is the one field in the
   * contract that becomes an `href`. `v.url()` alone accepts `javascript:`,
   * which is a string that validates, renders, and runs when a lifter taps it.
   *
   * The second check refuses embedded credentials. A URL carrying a user and
   * password puts them in the status bar of every lifter who hovers the link and
   * in the referrer of wherever they land -- and `https://records.example@evil`
   * is a link whose visible prefix is the federation and whose host is not.
   * Tested on the authority rather than by parsing, because this package targets
   * no runtime in particular and has no `URL` to reach for.
   */
  url: v.pipe(
    v.string(),
    v.url(),
    v.check((value) => value.startsWith('https://'), 'an https URL'),
    v.check((value) => !authorityOf(value).includes('@'), 'a URL with no embedded credentials'),
  ),
});
export type RecordSourceTable = v.InferOutput<typeof RecordSourceTableSchema>;

/**
 * The authority of an `https://` URL: everything between the scheme and the
 * first `/`, `?` or `#`.
 *
 * Only ever asked whether it contains an `@`, and only about a string `v.url()`
 * has already accepted, so it does not have to be a URL parser -- it has to
 * agree with one about where the host ends.
 */
function authorityOf(url: string): string {
  const rest = url.slice('https://'.length);
  const end = rest.search(/[/?#]/u);
  return end === -1 ? rest : rest.slice(0, end);
}

/** A published book of records, and the rules for taking one. */
export const RecordBookSchema = v.object({
  id: Identifier,
  label: Label,

  /**
   * How much a lift must exceed a record by to replace it, when the record being
   * claimed is at the meet's level or above it. The chip.
   *
   * Federations differ, and some require a margin rather than merely matching.
   * Assuming either would be wrong somewhere: a lifter told they had broken a
   * record by equalling it would find out otherwise on the platform, so the rule
   * comes from the source along with the records it governs. Zero means matching
   * is enough.
   *
   * This is also what makes a record attempt exempt from the ordinary rule that
   * every weight on the bar is a multiple of the loading increment -- the margin
   * being smaller than that increment is the whole point of the exemption. A
   * caller that rounds this figure up to a round jump has undone it, and it is
   * measured from the record as published rather than from the next bar multiple
   * above it.
   */
  minimumIncrementKilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),

  /**
   * The margin required instead when the record being claimed is **below** the
   * meet's level -- a state record at a national championship -- or `null` where
   * the federation draws no such distinction.
   *
   * Note the direction, because it is the half of the rule that gets written
   * backwards: a record *above* the meet's level is chipped like one at it, on
   * whatever terms that meet is sanctioned to allow. Only a record beneath the
   * meet costs the full increment.
   *
   * A separate figure rather than a flag, because it is a different number and
   * not merely the absence of the exemption: federations that have this rule
   * pin it to their loading increment, which is larger than the record margin
   * and need not equal it.
   *
   * Nothing here says which level is above which. It does not need to: the
   * question is answered by the meet a lifter has entered, which this tool does
   * not know and does not ask. Both figures are shown, each labelled with the
   * condition it holds under, and the lifter knows which meet they are at.
   */
  higherSanctionIncrementKilograms: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),

  /**
   * The levels at which a record still standing at its opening standard may be
   * taken by matching it exactly, rather than exceeding it.
   *
   * A list of levels and not a flag, because federations grant this unevenly:
   * one may let a lifter match a seeded national or world standard and still
   * require a margin over a seeded state one. A level absent from this list
   * falls back to {@link minimumIncrementKilograms}, which is the safe
   * direction -- being told to lift more than the rules demand costs a lifter an
   * attempt, and being told to lift less costs them the record.
   *
   * Applies only to records whose {@link FederationRecord.unclaimed} is true. A
   * record somebody holds is never matched into.
   */
  matchTakesUnclaimedLevelIds: v.array(Identifier),

  /**
   * Every table these records were read from, and where to read it.
   *
   * See {@link RecordSourceTableSchema}. May be empty for a source that
   * publishes no addressable tables; a record whose scope matches none of them
   * is shown without a link rather than with a guessed one.
   */
  sourceTables: v.array(RecordSourceTableSchema),

  records: v.array(FederationRecordSchema),
});
export type RecordBook = v.InferOutput<typeof RecordBookSchema>;

/**
 * The table a record is published in, or `null` if the book lists none for it.
 *
 * Here rather than in the domain because it is a fact about how the contract is
 * shaped -- which five axes address a table and which three address a row within
 * one -- and every reader of a book needs the same answer.
 */
export function findRecordSourceTable(
  book: Pick<RecordBook, 'sourceTables'>,
  scope: Pick<RecordScope, 'levelId' | 'regionId' | 'tested' | 'equipmentId' | 'disciplineId'>,
): RecordSourceTable | null {
  return (
    book.sourceTables.find(
      (table) =>
        table.levelId === scope.levelId &&
        table.regionId === scope.regionId &&
        table.tested === scope.tested &&
        table.equipmentId === scope.equipmentId &&
        table.disciplineId === scope.disciplineId,
    ) ?? null
  );
}
