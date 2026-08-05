// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

import { SexCategorySchema } from './categories.js';

/**
 * What a meet publishes about who may enter it.
 *
 * WHAT A QUALIFICATION CRITERION ACTUALLY IS
 *
 * It is not a total. Every national-level criterion read while this was written
 * has the same four parts, and a shape that carried only the number would lose
 * three of them:
 *
 *   a *standard* -- "a Class II total", "an Elite total", "475 DOTS";
 *   a *provenance* for the performance -- "from a USPA event", "from an IPL
 *     affiliate event", "from any drug tested meet within the U.S.";
 *   a *window* -- "January 1, 2025 to April 26, 2026";
 *   and the *entry it opens* -- tested, untested, or either.
 *
 * The standard is a reference and not a figure. A federation that publishes both
 * a classification ladder and a qualifying criterion publishes the criterion
 * *against* the ladder, so the totals already ingested under
 * `classification.ts` are the same totals, and copying them here would create a
 * second copy to keep in step -- one of which would eventually be a year old on
 * the screen that tells a lifter whether they may enter.
 *
 * WHY SO MUCH VERBATIM TEXT
 *
 * Section 29: this project never rules on eligibility. A meet's own paperwork is
 * the authority and the entry secretary is the arbiter, so every route carries
 * the sentence it was read from and every screen is expected to show it. What the
 * structured fields buy is a tool that can narrow the reading down to the two or
 * three lines that apply to *this* lifter, which is the actual difficulty: the
 * criteria are published as a wall of prose covering every division at once.
 *
 * WHAT THE SOURCES ARE ACTUALLY LIKE, SAID PLAINLY
 *
 * They contradict themselves. One page read for this contract states a
 * non-tested requirement two ways in two sections, and another prints a year that
 * cannot be right. That is not a transcription problem to be tidied away -- it is
 * the state of the published criteria, and a lifter deciding whether to book a
 * flight needs to know the page disagrees with itself. Hence
 * {@link QualifyingDisputeSchema}, which is carried *on the route it makes
 * uncertain* rather than in a bag of notes, so that nothing can render the route
 * without also having the dispute in hand.
 *
 * WHAT IS DELIBERATELY NOT MODELLED
 *
 * Anything about running the meet: weigh-in times, platform assignments, warm-up
 * rooms, refunds. They are on the same pages and they are not about who may
 * enter. Each field here is one a person has to re-verify every time a meet
 * announcement moves, and the set is kept to what changes an entry decision.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/** Prose a person wrote, shown to the user verbatim. Never assembled from parts. */
const Sentence = v.pipe(v.string(), v.minLength(1));

/**
 * A link that will end up in an `href`.
 *
 * Checked for scheme rather than trusted, for the reason `conversions.ts` gives:
 * `v.url()` alone accepts `javascript:`, which is a string that validates,
 * renders, and executes when somebody taps the citation under a meet's criteria.
 */
const CitationUrl = v.pipe(
  v.string(),
  v.url(),
  v.check(
    (value) => value.startsWith('https://'),
    'A citation URL must be https so that it cannot carry a script or be read in transit.',
  ),
);

/** The single artifact identifier holding every published meet's criteria. */
export const QUALIFYING_MEETS_ARTIFACT_ID = 'qualifying-meets';

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * Never a `Date` (section 5.5). A qualifying window closes on a day in the meet's
 * own jurisdiction, and an instant would drag a timezone into a comparison that
 * has none -- turning "qualified on the last day" into "did not qualify" for
 * every lifter east of the build machine.
 */
const CalendarDay = v.pipe(v.string(), v.isoDate());

/**
 * A range of calendar days, both ends inclusive.
 *
 * Inclusive because the sources are: "January 1, 2025 to April 26, 2026" admits a
 * total set on April 26. An exclusive end would exclude the last day of every
 * window in the corpus, which is precisely the day a lifter chasing a qualifying
 * total competes on.
 */
export const QualifyingWindowSchema = v.pipe(
  v.object({
    from: CalendarDay,
    to: CalendarDay,
  }),
  v.check(
    (window) => window.from <= window.to,
    'A window must not end before it begins; both ends are inclusive.',
  ),
);
export type QualifyingWindow = v.InferOutput<typeof QualifyingWindowSchema>;

/**
 * Which classification table a referenced standard is read out of.
 *
 * `open` and `lifters-age-division` are genuinely different answers and the gap
 * between them is a Masters lifter's whole entry: the same total is an Elite
 * total in one table and short of it in the other.
 *
 * `null` is the third answer and the common one -- the published criteria name a
 * standard and never say which table. A screen must show that it does not say,
 * because assuming `open` fails a Masters lifter who qualified and assuming
 * `lifters-age-division` admits an Open lifter who did not.
 */
export const StandardDivisionBasisSchema = v.picklist(['open', 'lifters-age-division'] as const);
export type StandardDivisionBasis = v.InferOutput<typeof StandardDivisionBasisSchema>;

/**
 * A standard named by reference to the federation's own classification ladder.
 *
 * `standardId` is an id from `ClassificationStandardSchema` -- `class-ii`,
 * `elite`, `international-elite`. The totals stay where they are published.
 */
export const ClassificationRequirementSchema = v.object({
  kind: v.literal('classification'),

  /** The ladder entry that must be reached, e.g. `class-ii`. */
  standardId: Identifier,

  /**
   * Whether reaching a *higher* standard also satisfies this one.
   *
   * True everywhere it has been read -- "Class 2 total or above" -- and carried
   * anyway rather than assumed, because a criterion admitting exactly one
   * standard is a criterion, not a mistake, and a tool that silently accepted a
   * higher one would tell a lifter they qualify for a meet that will turn them
   * away for being over its bracket.
   */
  orAbove: v.boolean(),

  /** Which table it is read out of, or `null` where the criteria do not say. */
  divisionBasis: v.nullable(StandardDivisionBasisSchema),
});
export type ClassificationRequirement = v.InferOutput<typeof ClassificationRequirementSchema>;

/** A DOTS threshold for one sex. */
export const PointsThresholdSchema = v.object({
  sex: SexCategorySchema,

  /**
   * The score that must be reached, a floor rather than a target.
   *
   * Above zero and unbounded above, for the reason every other figure in this
   * project is: a ceiling here is a contract that eventually refuses a real
   * result.
   */
  minimumPoints: v.pipe(v.number(), v.finite(), v.minValue(0.000_1)),
});
export type PointsThreshold = v.InferOutput<typeof PointsThresholdSchema>;

/**
 * A standard expressed as a coefficient score rather than a total.
 *
 * The invite-only tiers use these, and they are a different kind of claim: a
 * score compares lifters across bodyweight, so it admits nobody by weight class
 * and cannot be read out of a classification table at all.
 *
 * `systemId` is data because there is more than one such coefficient in use and
 * this project does not get to decide which a federation quotes. Nothing here
 * computes a score -- the archive publishes the lifter's own figures and the
 * screen shows what the meet asked for beside what the lifter has.
 */
export const PointsRequirementSchema = v.object({
  kind: v.literal('points'),

  /** The scoring system the criteria name, e.g. `dots`. */
  systemId: Identifier,

  /**
   * The threshold per sex, at least one and never two for the same sex.
   *
   * Per sex because every published pair differs -- and a single figure applied
   * to both would be wrong in the direction that turns a woman away at
   * registration for a meet she qualified for.
   */
  thresholds: v.pipe(
    v.array(PointsThresholdSchema),
    v.minLength(1),
    v.check(
      (thresholds) =>
        new Set(thresholds.map((threshold) => threshold.sex)).size === thresholds.length,
      'A points requirement must not state two thresholds for one sex.',
    ),
  ),
});
export type PointsRequirement = v.InferOutput<typeof PointsRequirementSchema>;

/** What a lifter must have achieved to take a route in. */
export const QualifyingStandardSchema = v.variant('kind', [
  ClassificationRequirementSchema,
  PointsRequirementSchema,
]);
export type QualifyingStandard = v.InferOutput<typeof QualifyingStandardSchema>;

/**
 * Which past meets a qualifying performance may have been set at.
 *
 * Three fields the tool can check against the results archive and one it cannot.
 * `territory` is the one it cannot: the archive publishes a meet's federation and
 * not the country it was held in, so "any drug tested meet within the U.S."
 * narrows nothing this project can compute. It is carried in order to be *said*,
 * which is the same treatment `meet-rules.ts` gives a deadline the planner cannot
 * observe -- and the alternative, dropping it, would have the tool quietly count
 * an overseas result the meet has said it will not.
 */
export const QualifyingPerformanceSchema = v.object({
  /**
   * Federations whose meets count, spelled as the results archive spells them.
   *
   * The archive's own `federation` and `parentFederation` columns are the only
   * record this project has of which body sanctioned a past result, so they are
   * what a route has to be matched against. These are therefore the archive's
   * strings and not this project's identifiers -- §5.15's rule that an upstream
   * vocabulary is carried rather than translated, applied from the other side.
   *
   * `null` is not "any federation". It is "the published criteria do not restrict
   * by federation", which is what the invite tiers say -- and the difference
   * matters because a screen may not turn the absence of a restriction into a
   * claim that some particular meet counts.
   */
  federationNames: v.nullable(v.pipe(v.array(Label), v.minLength(1))),

  /** Whether the qualifying meet had to be drug tested. `null` where unstated. */
  tested: v.nullable(v.boolean()),

  /** Where the qualifying meet had to be held, as published. Shown, not matched. */
  territory: v.nullable(Label),

  /** How the criteria describe the qualifying meet, in their own words. */
  description: Sentence,
});
export type QualifyingPerformance = v.InferOutput<typeof QualifyingPerformanceSchema>;

/** One reading of a criterion, and where on the page it was found. */
export const DisputedReadingSchema = v.object({
  /** Which part of the document this reading came from. */
  where: Label,

  /** The document's own words, verbatim. */
  quotation: Sentence,
});
export type DisputedReading = v.InferOutput<typeof DisputedReadingSchema>;

/**
 * A published criterion that states itself two incompatible ways.
 *
 * Real, and not rare. One page read for this contract requires an "Elite Total"
 * in one section and an "International Elite Total" in another for the same
 * non-tested entry -- two standards a division apart, on the page a lifter reads
 * before buying a flight.
 *
 * Carried on the route rather than beside it, so a renderer cannot draw the route
 * without the dispute in its hand. The route still names the reading this project
 * encoded, because a route with no standard could not be checked at all; what the
 * dispute adds is that the encoded reading is *one* reading, and which one is
 * right is a question for the meet and not for this tool (section 29).
 */
export const QualifyingDisputeSchema = v.object({
  /** Why the readings cannot both be encoded, in a sentence a lifter can act on. */
  summary: Sentence,

  /** Every reading found, including the one this project encoded. */
  readings: v.pipe(v.array(DisputedReadingSchema), v.minLength(2)),
});
export type QualifyingDispute = v.InferOutput<typeof QualifyingDisputeSchema>;

/**
 * One published way into a meet.
 *
 * Routes are *alternatives*: a lifter satisfying any one of them has met the
 * published criteria. That is how every multi-route criterion read for this
 * contract works -- a class total from within the federation, or a coefficient
 * score from anywhere in the country -- and it is why a route carries its own
 * window. The tiers at one meet had three different windows for three different
 * standards, and a single window per meet would have shortened two of them.
 */
export const QualifyingRouteSchema = v.object({
  id: Identifier,
  label: Label,

  standard: QualifyingStandardSchema,
  performance: QualifyingPerformanceSchema,

  /** When the qualifying performance must have been set. */
  window: QualifyingWindowSchema,

  /**
   * Whether this route opens tested entry, untested entry, or either.
   *
   * `true` and `false` are both used: one meet asks a lower standard of its
   * tested entrants than its non-tested ones, so the same lifter's total takes
   * one route and not the other. `null` means the route opens whatever the meet
   * offers.
   */
  appliesToTested: v.nullable(v.boolean()),

  /** The published sentence this route was read from. */
  quotation: Sentence,

  /** Set where the document states this route two incompatible ways. */
  dispute: v.nullable(QualifyingDisputeSchema),
});
export type QualifyingRoute = v.InferOutput<typeof QualifyingRouteSchema>;

/**
 * How the class a lifter qualified in constrains the class they may enter.
 *
 * Both directions, because they are not symmetrical and the asymmetry is the
 * whole rule: at a meet requiring a qualifying total, moving *up* is a matter of
 * having reached the heavier class's standard, and moving *down* requires having
 * qualified there separately. A tool that modelled one flag would offer the wrong
 * half to half its users.
 */
export const WeightClassEntryRuleSchema = v.object({
  /** Whether a lifter may enter a class above the one they qualified in. */
  mayMoveUp: v.boolean(),

  /**
   * Whether moving up also requires reaching the heavier class's own standard.
   *
   * The half that is easy to drop and expensive to drop. Heavier classes ask
   * larger totals, so a move-up offered without this check sends a lifter to a
   * bracket they are short of -- and they find out at registration, having
   * already booked the travel.
   */
  moveUpRequiresHigherStandard: v.boolean(),

  /** Whether a lifter may enter a class below without qualifying there. */
  mayMoveDown: v.boolean(),

  /**
   * Whether a move-up also depends on the meet having room in the heavier class.
   *
   * Carried in order to be *said*, never enforced -- this project cannot see a
   * roster. It is the difference between a screen that says "you may move up"
   * and one that says "you may move up if the meet has space", and the second is
   * the true sentence.
   */
  moveUpRequiresVacancy: v.boolean(),

  /** The rulebook's own words. */
  quotation: Sentence,
});
export type WeightClassEntryRule = v.InferOutput<typeof WeightClassEntryRuleSchema>;

/**
 * One row of the ladder saying which gear categories a qualifying total opens.
 *
 * The axis a first reading of these criteria misses entirely. A lifter's gear
 * category at the qualifying meet is not the only category their total can buy
 * them: equipped standards are larger than raw ones, so a raw total that reaches
 * the single-ply standard opens single-ply entry as well -- and the federation
 * publishes the whole ladder as a table rather than as a rule, because the
 * categories are not a simple ordering.
 *
 * Carried as the rulebook's own category names rather than catalogue identifiers,
 * for the reason {@link QualifyingMeetSchema} gives about the same strings.
 */
export const GearQualificationSchema = v.object({
  /** The category the lifter competed in at their qualifying meet. */
  competedIn: Label,

  /** The category whose qualifying standard their total reached. */
  standardReachedIn: Label,

  /**
   * Every category that opens, including the one competed in where it does.
   *
   * Listed in full rather than as "and everything below", because the table is
   * what the federation publishes and a derivation from it would be this project
   * inferring a rule the rulebook states as rows.
   */
  opens: v.pipe(v.array(Label), v.minLength(1)),
});
export type GearQualification = v.InferOutput<typeof GearQualificationSchema>;

/**
 * Which entries a meet is open to.
 *
 * A `both` meet runs two competitions on one platform, and the distinction
 * reaches the qualifying criteria: a tested lifter at a `both` meet may be held
 * to a different standard than the lifter after them.
 */
export const TestedOfferingSchema = v.picklist(['tested', 'untested', 'both'] as const);
export type TestedOffering = v.InferOutput<typeof TestedOfferingSchema>;

/**
 * One discipline a meet contests, and the gear categories it contests it in.
 *
 * Paired rather than held as two flat lists, and the pairing was forced by the
 * first real announcement read into this contract: it offers Full Power in raw,
 * classic raw and single ply, and its two single-lift disciplines in raw, single
 * ply and multi ply. Flattened to a union of disciplines and a union of
 * categories, that page would publish an equipped full power competition it does
 * not run -- an offering nobody announced, on the screen whose entire job is to
 * be checkable against the entry form.
 *
 * Both sides are the announcement's own words, for the reason
 * {@link QualifyingMeetSchema} gives about the same strings.
 */
export const MeetOfferingSchema = v.object({
  discipline: Label,
  equipment: v.pipe(v.array(Label), v.minLength(1)),
});
export type MeetOffering = v.InferOutput<typeof MeetOfferingSchema>;

/**
 * What a meet asks of an entrant, as a positive statement in every case.
 *
 * A discriminated union rather than a possibly-empty list of routes, and this is
 * the most load-bearing decision in the file. "This meet requires no qualifying
 * total" and "nobody has transcribed this meet's criteria" are opposite facts
 * that an empty array states identically -- and the wrong one of them, rendered,
 * tells a lifter they may enter a national championship on the strength of a
 * gap in this repository.
 *
 * There are three states and not two, which the second announcement read into
 * this contract established. A page can *say* no total is required, and a page
 * can simply never mention one, and those are different: the first is the
 * federation's statement and the second is the absence of a statement, which for
 * a meet where entry does turn on a total is the announcement's omission rather
 * than the meet's rule. Collapsing them would have made this project the author
 * of a permission nobody granted. A meet nobody has read at all is a fourth
 * state, expressed by not being in the book.
 */
export const QualifyingEntrySchema = v.variant('kind', [
  v.object({
    kind: v.literal('open'),

    /** The document's own words saying entry is not gated on a total. */
    quotation: Sentence,
  }),
  v.object({
    kind: v.literal('unstated'),

    /**
     * What the announcement says about entry instead, in a sentence.
     *
     * Required, so that "the page names no qualifying total" is something a
     * transcriber went looking for and wrote down rather than a default a
     * half-finished document falls into. A bare marker would be reachable by
     * giving up, and giving up is exactly the state this variant must not be
     * confused with.
     */
    detail: Sentence,
  }),
  v.object({
    kind: v.literal('standard'),

    /** Alternatives. Meeting any one of them meets the published criteria. */
    routes: v.pipe(v.array(QualifyingRouteSchema), v.minLength(1)),
  }),
]);
export type QualifyingEntry = v.InferOutput<typeof QualifyingEntrySchema>;

/**
 * An entry condition that is not a qualifying total.
 *
 * Not a dumping ground, the same way `MeetRuleProfile.notes` is not: this is for
 * conditions that decide whether a lifter can enter and that no arithmetic can
 * check -- a membership that must exist before the entry form is submitted, a
 * per-day cap that closes the meet early, an invitation that arrives by email.
 * Every one of those has turned somebody away, and none of them is a number.
 */
export const QualifyingConditionSchema = v.object({
  id: Identifier,
  label: Label,

  /** What the condition means for an entrant, in a sentence. */
  detail: Sentence,

  /** The document's own words, where it states the condition outright. */
  quotation: v.nullable(Sentence),
});
export type QualifyingCondition = v.InferOutput<typeof QualifyingConditionSchema>;

/**
 * Which document a meet's criteria were read from, and when.
 *
 * The same shape `meet-rules.ts` carries and required for the same reason, with
 * one difference that matters: a meet announcement is edited in place. There is
 * no revision on it, so `verifiedOn` is the only thing standing between a screen
 * and a criterion that changed last Tuesday, and it is why nothing here is
 * published without a reader's date on it.
 */
export const QualifyingSourceSchema = v.object({
  /** How the page names itself. */
  label: Label,

  url: CitationUrl,

  /** The day a person last read these criteria against that page. */
  verifiedOn: CalendarDay,
});
export type QualifyingSource = v.InferOutput<typeof QualifyingSourceSchema>;

/**
 * The rulebook a federation's entry rules were read out of.
 *
 * A meet announcement's citation and a rulebook's citation are the same four
 * fields plus a revision, and the revision is exactly what separates them: a
 * rulebook says which edition it is and can therefore be pinned and re-digested
 * on a schedule, which is what `check:upstream` already does for the copy this
 * project reads. An announcement can do neither, which is why the two are not one
 * schema with a nullable field -- a nullable revision invites a rulebook citation
 * with the pin left off, and the pin is the whole mechanism.
 */
export const QualifyingRulebookSchema = v.object({
  label: Label,
  url: CitationUrl,

  /** The revision as the document versions itself, e.g. a year and a version. */
  revision: Identifier,

  /** The sections the rules below were read from, for a person checking them. */
  sections: v.pipe(v.array(Label), v.minLength(1)),

  /** The day a person last read these rules against that document. */
  verifiedOn: CalendarDay,
});
export type QualifyingRulebook = v.InferOutput<typeof QualifyingRulebookSchema>;

/** One meet, and everything published about who may enter it. */
export const QualifyingMeetSchema = v.object({
  id: Identifier,
  label: Label,

  /**
   * The federation whose published data this meet's criteria are read against.
   *
   * Not the same question as who sanctions the meet, and the pair below is the
   * case that forced them apart. An international championship announced by its
   * national affiliate tells that affiliate's members to qualify at the
   * affiliate's meets and points them at the affiliate's own classification
   * calculator -- so the ladder a route resolves against is the affiliate's,
   * which is the ladder this project publishes. Recording the sanctioning body
   * here instead would make every route reference a set of standards nobody has
   * transcribed, and inventing that vocabulary in order to have one would be the
   * unchecked claim §5.15 already refuses for the results archive.
   *
   * A federation named here must have a published category catalogue and
   * published classification standards, because a route that cannot resolve its
   * standard renders as "you have not qualified".
   */
  federationId: Identifier,

  /**
   * How the announcement names the body sanctioning the meet, in its own words.
   *
   * Carried rather than translated, and required rather than nullable: a lifter
   * reading a screen that says "USPA" about the IPL's own championship has been
   * told something false about which membership card they need at the door.
   */
  sanctionedBy: Label,

  /** The days it is held, inclusive. A one-day meet has `from` equal to `to`. */
  held: QualifyingWindowSchema,

  /** Where it is held, as the announcement writes it. */
  location: Label,

  /**
   * The federation's sanction number, or `null` where the page prints none.
   *
   * Worth carrying because it is the one identifier a lifter can quote to the
   * federation, and worth being nullable because roughly half the announcements
   * read for this contract omit it.
   */
  sanctionNumber: v.nullable(Label),

  /**
   * What is contested and in what gear, as the announcement lists them.
   *
   * The announcement's own words, not catalogue identifiers. §5.15's rule again:
   * a meet writing "Classic Raw" has named a category, and this project deciding
   * that string means the identifier its catalogue happens to spell the same way
   * is an assertion nobody checked -- on the screen whose entire job is to be
   * checked. What a visitor needs from these is to read them against the entry
   * form, which is exactly what an unmodified quotation supports.
   *
   * One discipline may not appear twice: two rows for one discipline are two
   * answers to "what gear can I lift this in", and the tool would show whichever
   * it reached first.
   */
  offerings: v.pipe(
    v.array(MeetOfferingSchema),
    v.minLength(1),
    v.check(
      (offerings) =>
        new Set(offerings.map((offering) => offering.discipline)).size === offerings.length,
      'A meet must not list one discipline twice.',
    ),
  ),

  /** Whether it runs a tested competition, an untested one, or both. */
  testedOffering: TestedOfferingSchema,

  /**
   * The last day the announcement accepts entries, or `null` where it prints none.
   *
   * The most decisive criterion on the page and the one a qualifying window says
   * nothing about: a lifter who meets every standard and reads this a day late
   * has not qualified for anything. Nullable because plenty of announcements
   * print only a lifter cap and fill instead.
   */
  entryClosesOn: v.nullable(CalendarDay),

  entry: QualifyingEntrySchema,

  conditions: v.array(QualifyingConditionSchema),

  source: QualifyingSourceSchema,
});
export type QualifyingMeet = v.InferOutput<typeof QualifyingMeetSchema>;

/**
 * The rules a federation applies to every meet of its that requires a total.
 *
 * Separated from the meet, and the separation is not tidiness. These live in the
 * rulebook -- "in any competition requiring a qualifying total" is the rulebook's
 * own scoping of them -- and a meet announcement that quotes one is quoting, not
 * legislating. Copied onto each meet they would be one transcription per
 * announcement of a rule with a single source, they would drift, and a lifter
 * comparing two meets would be shown two versions of one sentence.
 *
 * It also fixes what they are checkable against. A meet announcement is edited in
 * place and expires; a rulebook has a revision and a digest, which is why
 * {@link QualifyingRulebookSchema} carries both and {@link QualifyingSourceSchema}
 * cannot.
 */
export const QualifyingFederationRulesSchema = v.object({
  /** The federation these are the rules of. */
  federationId: Identifier,
  label: Label,

  weightClass: WeightClassEntryRuleSchema,

  /**
   * The published gear ladder, or an empty list where the federation has none.
   *
   * Empty is a real answer and means every category is qualified for separately.
   * It is distinguishable from an absent federation, which is the case where
   * nobody has transcribed these rules at all.
   */
  gearLadder: v.array(GearQualificationSchema),

  /**
   * Whether a tested result may qualify a lifter for untested entry, or the
   * reverse. `null` where the published rules do not say.
   *
   * `null` in the first corpus published from this contract, and the reason is
   * worth recording because it looks like an omission. The federation read here
   * states the parallel rule for *records* -- tested records only in tested
   * competitions, and the reverse -- and states nothing at all about whether a
   * tested total qualifies a lifter for untested entry. A rule about records is
   * not a rule about qualification, and inferring one from the other is a claim
   * with a rulebook citation on it and no rulebook behind it. Where a meet
   * announces the split itself, it is on that meet's routes instead.
   *
   * It is the rule most likely to be assumed the wrong way round by a lifter with
   * one tested meet behind them, which is why the honest `null` is carried and
   * rendered rather than the field being dropped.
   */
  testedCrossoverAllowed: v.nullable(v.boolean()),

  /** Entry conditions of the federation's own, not of any one meet. */
  conditions: v.array(QualifyingConditionSchema),

  source: QualifyingRulebookSchema,
});
export type QualifyingFederationRules = v.InferOutput<typeof QualifyingFederationRulesSchema>;

/**
 * Every meet whose criteria have been read, in one artifact.
 *
 * One file rather than one per federation, for the reason the meet-rule book
 * gives: the tool's first question is which meet, so it needs the whole list
 * before it can draw a control, and the whole list is a few kilobytes.
 *
 * It will not stay a few kilobytes if this ever grows to every sanctioned meet in
 * a season, and that is fine -- `planPublication` measures the serialized bytes
 * against the artifact budget and fails the build naming this artifact. The day
 * it does, this splits on the axis a visitor picks first, the same way records
 * and classifications did. It is not split *now* on a guess about which axis that
 * would be.
 */
export const QualifyingMeetBookSchema = v.object({
  /**
   * The entry rules of every federation a meet below is read against.
   *
   * Listed before the meets and required to be non-empty, because a meet whose
   * federation is missing from here is a meet whose weight-class and gear rules
   * nobody can look up -- and those decide whether a lifter's total lets them
   * enter at all, so a screen drawing the criteria without them is drawing a
   * fraction of the answer while looking complete.
   */
  federations: v.pipe(v.array(QualifyingFederationRulesSchema), v.minLength(1)),

  meets: v.pipe(v.array(QualifyingMeetSchema), v.minLength(1)),
});
export type QualifyingMeetBook = v.InferOutput<typeof QualifyingMeetBookSchema>;

/**
 * The entry rules that apply to a meet, or `null` if the book carries none.
 *
 * Here rather than in a caller, so that the join between a meet and its
 * federation is written once. Publication refuses a meet whose federation is
 * absent, so `null` means the browser is holding an artifact from a build that
 * did not -- an older deploy, a cached file -- and the honest rendering is the
 * criteria without the entry rules and a line saying so, rather than the criteria
 * with the strictest rules guessed in.
 */
export function findQualifyingFederationRules(
  book: QualifyingMeetBook,
  federationId: string,
): QualifyingFederationRules | null {
  return book.federations.find((rules) => rules.federationId === federationId) ?? null;
}
