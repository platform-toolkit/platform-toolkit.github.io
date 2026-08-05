// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  AgeDivision,
  AthleteEntry,
  ClassificationStandard,
  ClassificationTable,
  EquipmentCategory,
  PointsRequirement,
  QualifyingCondition,
  QualifyingFederationRules,
  QualifyingMeet,
  QualifyingRoute,
  SexCategory,
  StandardDivisionBasis,
  WeightClassLadderData,
} from '@platform-toolkit/data-contracts';
import type { Classification, StandardDistance } from '@platform-toolkit/domain';

/**
 * The vocabulary this tool answers in.
 *
 * One rule shapes every type in this file, and it is the rule the whole tool
 * exists under: **nothing here rules on eligibility**. A federation decides who
 * may enter its meets; this package reads published figures against published
 * criteria and hands a person the pieces. So there is no `eligible: boolean`
 * anywhere below, and there must never be one. What there is instead is a set of
 * observations, each carrying where it came from, and an explicit name for every
 * way the question can fail to have an answer.
 *
 * The second rule follows from the first. A lifter's competition history arrives
 * from an archive that keeps **its own vocabulary** rather than any federation's
 * (`data-contracts/athletes.ts`), and a federation's standards are keyed on **the
 * federation's own identifiers** (`data-contracts/categories.ts`). Getting from
 * one to the other is a claim somebody has to make, and this package will not
 * make it silently: see {@link CategoryProposal}.
 */

/**
 * A calendar day, `YYYY-MM-DD`.
 *
 * A string rather than a `Date`, for the reason in the root notes' section 5.5:
 * `new Date('1990-05-15')` is midnight UTC, which is the fourteenth west of
 * Greenwich, and a qualifying window that shifts by a day either side of the
 * Atlantic is a lifter told they missed a deadline they made. Well-formed values
 * also compare correctly with `<` and `>`, which is what {@link
 * import('./core/window.js').windowContains} relies on -- and is exactly why the
 * only way to build a window here runs the strings through a parser first.
 */
export type CalendarDay = string;

/**
 * How a result was registered, in the words the archive printed.
 *
 * Every field is the source's own spelling and none of it has been mapped onto a
 * federation's identifiers. These are the axes a lifter registers under, so two
 * entries that differ on any of them are two different standings and are reported
 * separately -- which is the user's requirement that if somebody crossed a weight
 * class or competed once tested and once not, every possibility is shown.
 */
export interface RegistrationLabels {
  /** `M`, `F`, `Mx`, as printed. */
  readonly sex: string;
  /** `Raw`, `Wraps`, `Single-ply`, as printed. */
  readonly equipment: string;
  /** The division the meet entered them in, or `null` where the source omits it. */
  readonly division: string | null;
  /** The meet's own age band, such as `40-44`, or `null`. */
  readonly ageClass: string | null;
  /** The class entered, as printed: `90`, `90+`, `SHW`. `null` where omitted. */
  readonly weightClassKg: string | null;
  /**
   * `true` where the archive records the meet as drug tested, `null` where it
   * says nothing -- which is an absence of information and not a statement that
   * the meet was untested. Never collapsed to `false`.
   */
  readonly tested: boolean | null;
  /** `SBD`, `B`, `BD`, as printed. Deliberately never parsed; see `history.ts`. */
  readonly event: string;
}

/** A figure, and the meet it was made at. */
export interface PerformanceSource {
  readonly on: CalendarDay;
  readonly meetName: string;
  /** The sanctioning federation, in the archive's words. */
  readonly federation: string;
  /** The parent body, or `null` where the archive names none. */
  readonly parentFederation: string | null;
  /** Where they placed, as printed. `null` where the archive records none. */
  readonly place: string | null;
}

/** The best figure of its kind inside a window, and where it came from. */
export interface BestPerformance {
  readonly kilograms: number;
  readonly source: PerformanceSource;
}

/**
 * A result the tool has taken out of the reckoning, and the reason in full.
 *
 * Listed rather than filtered. A history that quietly loses a result is a history
 * a lifter cannot check against their own memory of the day, and the one thing
 * this screen has to be is checkable.
 */
export interface SetAsideResult {
  readonly source: PerformanceSource;
  readonly reason: 'disqualified';
  /** The place code the archive printed, which is the whole of the evidence. */
  readonly place: string;
}

/**
 * One registration a lifter's history supports, with the figures made under it.
 *
 * "Supports" rather than "qualifies for": a standing is a description of results
 * that have already happened, not a permission to enter anything.
 */
export interface ObservedStanding {
  /**
   * A stable key for this combination of {@link RegistrationLabels}.
   *
   * Used to key a list and to make a test's expectation legible. Never shown.
   */
  readonly key: string;
  readonly registration: RegistrationLabels;

  /** Every entry that fell under this registration, oldest first. */
  readonly entries: readonly AthleteEntry[];

  /** Best successful lift of each kind, or `null` where the window holds none. */
  readonly squat: BestPerformance | null;
  readonly bench: BestPerformance | null;
  readonly deadlift: BestPerformance | null;

  /**
   * The best total made from all three lifts, or `null`.
   *
   * Restricted to entries recording a squat, a bench *and* a deadlift, because a
   * classification standard for `total` is the sum of three (`LiftSchema`), and a
   * push/pull total read against it would tell a lifter they had reached a grade
   * they have not. The archive's `event` column says which lifts were contested
   * and this deliberately does not read it -- see `history.ts`.
   */
  readonly total: BestPerformance | null;

  /**
   * A heavier total that was not made from three lifts, or `null`.
   *
   * Carried so the screen can answer the question the omission provokes. A lifter
   * whose best number is a push/pull total will look for it, and "it is not here"
   * reads as a bug; "it is here, and it is not read against the three-lift
   * standard" reads as the rule it is.
   */
  readonly partialTotal: BestPerformance | null;

  /** Ages the archive recorded under this registration, lightest reading first. */
  readonly ages: readonly ObservedAge[];

  /** Bodyweights recorded, ascending. Empty where the archive weighed nobody in. */
  readonly bodyweights: readonly number[];

  /** Results excluded from every figure above, with the reason. */
  readonly setAside: readonly SetAsideResult[];
}

/**
 * An age the archive recorded, keeping the uncertainty it recorded it with.
 *
 * `approximate` means the lifter was `years` **or one year older**, because the
 * meet published a birth year rather than a birth date. That lands on a division
 * boundary often enough to matter -- an approximate 39 is a Submaster or an Open
 * lifter and nothing here can tell which -- so it is carried, never rounded.
 */
export interface ObservedAge {
  readonly years: number;
  readonly approximate: boolean;
  readonly on: CalendarDay;
}

/**
 * How much weight a proposed identifier can bear.
 *
 * The distinction this package turns on. A **measured** proposal comes from
 * arithmetic against a published boundary: a bodyweight of 108.4 kg makes the
 * 110 kg class because 108.4 is at or under 110, and no vocabulary was crossed to
 * say so. A **spelled** proposal comes from two documents using the same word,
 * which is not evidence that they mean the same thing -- the archive and this
 * federation both print "Raw", and they do not agree about knee wraps. Only a
 * measured proposal may be pre-selected for somebody; see {@link
 * import('./core/category-match.js').mayPreselect}.
 */
export type ProposalBasis = 'measured' | 'spelled' | 'none';

/**
 * A federation identifier this tool suggests for something the archive printed.
 *
 * Never an answer, always a starting point the reader can override. The candidate
 * list is published in full even when it is empty, because "nothing in this
 * federation's catalogue is spelled the way your archive entry is" is a sentence a
 * lifter can act on and a blank control is not.
 */
export interface CategoryProposal<T> {
  /** What the archive printed, shown beside whatever the reader chooses. */
  readonly observed: string | null;
  /** Everything that matched. More than one is a tie, and ties are not broken. */
  readonly candidates: readonly T[];
  /** The single candidate, or `null` when there were none or more than one. */
  readonly proposed: T | null;
  readonly basis: ProposalBasis;
}

/** Whether a division is reachable on both readings of an approximate age. */
export type AgeReadingSupport = 'either-reading' | 'younger-reading-only' | 'older-reading-only';

/** A division an age admits, and which reading of the age admits it. */
export interface DivisionCandidate {
  readonly division: AgeDivision;
  readonly support: AgeReadingSupport;
}

/**
 * The answers a classification table is selected with, all of them settled.
 *
 * Every field is a federation identifier and none of them is nullable, because
 * `selectClassificationTable` matches a lifter's concrete answers against tables
 * that may decline to distinguish on an axis -- the `null`s live on the table, not
 * on the lifter. Producing this from an archive entry is the reader's decision,
 * not this package's: {@link import('./core/registration.js').proposeRegistration}
 * offers defaults and names what it could not settle.
 */
export interface ResolvedRegistration {
  readonly sex: SexCategory;
  readonly equipmentId: string;
  readonly weightClassId: string;
  readonly divisionId: string;
  readonly tested: boolean;
}

/** Why a lift has no grade against it. */
export type UngradedReason =
  /** No successful lift of this kind inside the window. */
  | 'no-result'
  /** The federation publishes no standards for this combination. */
  | 'no-standards'
  /**
   * Two published tables are equally specific for this lifter.
   *
   * Reported rather than resolved by document order (section 5.5). Two tables
   * disagreeing about a grade is a question about the data, and answering it with
   * whichever was transcribed first puts a coin toss in front of somebody
   * deciding whether to pay an entry fee.
   */
  | 'ambiguous-standards';

/** What this lifter's best in one lift comes to against the published ladder. */
export type LiftStanding =
  | {
      readonly kind: 'graded';
      readonly best: BestPerformance;
      readonly classification: Classification;
      /** The table the grade was read from, so the screen can name it. */
      readonly table: ClassificationTable;
    }
  | {
      readonly kind: 'ungraded';
      readonly reason: UngradedReason;
      readonly best: BestPerformance | null;
    };

/**
 * Everything way three shows: the four grades, and the registration they assume.
 *
 * Named for what the user asked for -- "show the user everything they would need
 * to see to determine qualifications" -- and shaped so that the assumption is on
 * the report rather than behind it. A grade with no visible statement of which
 * class, division and tested status it was read under is a number a lifter cannot
 * check, and cannot correct.
 */
export interface StandingReport {
  readonly registration: ResolvedRegistration;
  readonly squat: LiftStanding;
  readonly bench: LiftStanding;
  readonly deadlift: LiftStanding;
  readonly total: LiftStanding;
}

/** The federation vocabulary a proposal is made against. */
export interface CatalogVocabulary {
  readonly equipment: readonly EquipmentCategory[];

  /**
   * The weight classes, still separated by sex, the way the catalogue publishes them.
   *
   * One list per sex and never one merged list, and the distinction is not
   * bookkeeping. The two ladders differ at both ends and in the middle, so a merged
   * list contains classes this lifter's federation does not offer this lifter --
   * and the weight-class axis is *measured*, which means `mayPreselect` lets it be
   * filled in without being confirmed. Merged, a bodyweight would be resolved
   * against the union before the reader has said which sex they compete in, and the
   * form would open with a class from the other ladder already selected. That is the
   * exact failure `category-match.ts` is written to prevent: a plausible number, on
   * the right screen, under the right heading.
   *
   * Reading one of these is {@link import('./core/category-match.js').weightClassesFor},
   * which is the only thing that should index into this list.
   */
  readonly weightClassLadders: readonly WeightClassLadderData[];

  readonly divisions: readonly AgeDivision[];
}

/**
 * Way one: a meet's published criteria, read against what a lifter has done.
 *
 * The same rule governs everything below that governs everything above -- nothing
 * here rules on eligibility. A route reading says what the published sentence asks
 * for and what the archive records, and stops. The words are chosen to keep it
 * stopping: a route is `reaches` or `short`, never `qualified` or `not qualified`,
 * because the second pair is a ruling and the first is arithmetic.
 */

/** Why one entry was left out of the figures a route is read on. */
export type DisregardReason =
  /** Set before the route's own qualifying window opened, or after it closed. */
  | 'outside-the-route-window'
  /** The route names the federations whose meets count, and this is not one. */
  | 'federation-not-named'
  /** The route requires a tested meet and the archive records this one as not. */
  | 'meet-not-drug-tested'
  /**
   * The route requires a tested meet and the archive records nothing either way.
   *
   * Its own reason rather than folded into the one above, because the two are
   * opposite facts about this project: one is a result that does not count, and one
   * is a result nobody here can say either way. A lifter can act on the second by
   * showing the meet their own paperwork, and cannot act on the first at all.
   */
  | 'drug-testing-unrecorded';

/** A result a route could not be read on, and the reason in full. */
export interface DisregardedResult {
  readonly source: PerformanceSource;
  readonly reason: DisregardReason;
}

/** Why one reading of a route's standard produced no answer. */
export type UnreadableStandardReason =
  /** No table this federation publishes covers this registration and lift. */
  | 'no-standards'
  /** Two equally specific tables cover it, and they are not the same ladder. */
  | 'ambiguous-standards'
  /**
   * The covering table publishes no standard under the id the route names.
   *
   * The failure `packages/ingestion` orders its publishing steps to prevent, seen
   * from the browser: a withheld row is a standard nobody can be shown as having
   * met, so a route naming one resolves to nothing. Rendered as "you have not
   * qualified" that is a real answer nobody investigates, and every lifter who
   * could have entered is turned away by a transcription fault.
   */
  | 'standard-not-published'
  /**
   * The route reads out of the Open table and no Open division could be identified.
   *
   * `openAgeDivision` reports a tie rather than breaking one, and a catalogue with
   * two equally wide divisions is a catalogue this tool must not choose between.
   */
  | 'open-division-unknown';

/** What one reading of a route's named standard comes to. */
export type StandardReading =
  | {
      readonly kind: 'reaches';
      readonly distance: StandardDistance;
      readonly table: ClassificationTable;
    }
  | {
      readonly kind: 'short';
      readonly distance: StandardDistance;
      readonly table: ClassificationTable;
    }
  | {
      /**
       * The figure is above a standard the route admits only exactly.
       *
       * `orAbove: false` is rare and is carried rather than assumed for a reason
       * that only bites in this direction: a criterion admitting one standard and
       * not the ones above it is a bracket, and a tool that quietly accepted a
       * higher total would tell a lifter they may enter a meet that will turn them
       * away for being too strong for it.
       */
      readonly kind: 'above-the-bracket';
      readonly distance: StandardDistance;
      readonly table: ClassificationTable;
      /** The standard the figure does reach, so the screen can name the gap. */
      readonly achieved: ClassificationStandard | null;
    }
  | {
      readonly kind: 'unreadable';
      readonly reason: UnreadableStandardReason;
    };

/**
 * Which table a reading was taken out of.
 *
 * `either-table` is not a fourth basis. It is the answer when the criteria did not
 * say and both readings came to the same thing, which is the common case and the
 * one worth collapsing -- an Open lifter's two readings are the same table. Where
 * they differ, the outcome is {@link RouteOutcome}'s `two-readings` and no basis is
 * claimed at all.
 */
export type ReadingBasis = StandardDivisionBasis | 'either-table';

/** What a route comes to for one registration. */
export type RouteOutcome =
  | {
      readonly kind: 'read';
      readonly basis: ReadingBasis;
      readonly reading: StandardReading;
    }
  | {
      /**
       * The criteria name a standard and never say which table it is read out of,
       * and the two tables disagree.
       *
       * The gap between them is a Masters lifter's whole entry: the same total is
       * an Elite total in one and short of it in the other. Assuming `open` fails a
       * lifter who qualified and assuming `lifters-age-division` admits one who did
       * not, so both are shown and the meet is asked.
       */
      readonly kind: 'two-readings';
      readonly open: StandardReading;
      readonly liftersAgeDivision: StandardReading;
    }
  | {
      /**
       * The route opens the other competition.
       *
       * Reported rather than hidden. A lifter deciding between the tested and
       * untested platform needs to see the route they are not taking, especially
       * where -- as at one meet in the corpus -- it asks a different standard.
       */
      readonly kind: 'not-open-to-this-entry';
      readonly opensTested: boolean;
    }
  | {
      /** No three-lift total inside this route's own window survived its filters. */
      readonly kind: 'no-result-in-window';
    }
  | {
      /**
       * The route asks for a coefficient score, and nothing here computes one.
       *
       * A score is a claim about the scoring system as much as about the lifter,
       * and this project does not get to decide which coefficient a federation
       * quotes. The threshold is carried so the screen can print what was asked for
       * beside the bodyweight and total the archive holds, and let a person do the
       * arithmetic the meet will do.
       */
      readonly kind: 'points-not-computed';
      readonly requirement: PointsRequirement;
    };

/** One published way into a meet, read against one lifter's registration. */
export interface RouteReading {
  readonly route: QualifyingRoute;

  /** The best three-lift total the route could be read on, or `null`. */
  readonly best: BestPerformance | null;

  /** Results the route's own window and filters excluded, each with its reason. */
  readonly disregarded: readonly DisregardedResult[];

  readonly outcome: RouteOutcome;
}

/** An entry condition no arithmetic can settle, and which document states it. */
export interface UncheckableCondition {
  readonly condition: QualifyingCondition;
  readonly from: 'meet' | 'federation';
}

/**
 * What a meet asks of this registration, as a positive statement in every case.
 *
 * Mirrors `QualifyingEntrySchema`'s three states rather than flattening them,
 * because the flattening is the failure: "this meet requires no qualifying total"
 * and "nobody has transcribed this meet's criteria" are opposite facts, and the
 * wrong one of them rendered tells a lifter they may enter a national championship
 * on the strength of a gap in a repository.
 */
export type EntryReading =
  | { readonly kind: 'open'; readonly quotation: string }
  | { readonly kind: 'unstated'; readonly detail: string }
  | { readonly kind: 'routes'; readonly routes: readonly RouteReading[] };

/** Everything way one shows for one meet and one registration. */
export interface MeetReading {
  readonly meet: QualifyingMeet;
  readonly registration: ResolvedRegistration;

  /**
   * Whether the meet sanctions the competition this registration is for.
   *
   * A statement about the meet's sanction and not about the lifter, and it
   * deliberately does not suppress the routes below it. Somebody reading this
   * screen may still be deciding which platform to enter, and a page that hid half
   * a `both` meet would be answering that for them.
   */
  readonly offersThisEntry: boolean;

  readonly entry: EntryReading;

  /** Every condition that decides entry and that no arithmetic can check. */
  readonly conditions: readonly UncheckableCondition[];

  /**
   * The federation entry rules the criteria are read beside, or `null`.
   *
   * `null` where the book carries no rules for the meet's federation, which is a
   * real state: whether a lifter may enter turns on the weight-class and gear rules
   * as much as on the total, and a screen showing the criteria alone while looking
   * complete is the half-answer this field exists to make visible.
   */
  readonly rules: QualifyingFederationRules | null;
}

/** Where a meet sits relative to a day the caller supplies. */
export type MeetTiming =
  /** Entry is open, or the announcement names no closing day. */
  | 'entry-open'
  /** Past the published closing day, and the meet has not been held. */
  | 'entry-closed'
  /** The meet is being held on the given day. */
  | 'in-progress'
  /** The meet has been held. */
  | 'held';
