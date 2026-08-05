// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  AgeDivision,
  AthleteEntry,
  ClassificationTable,
  EquipmentCategory,
  SexCategory,
  WeightClass,
} from '@platform-toolkit/data-contracts';
import type { Classification } from '@platform-toolkit/domain';

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
  readonly weightClasses: readonly WeightClass[];
  readonly divisions: readonly AgeDivision[];
}
