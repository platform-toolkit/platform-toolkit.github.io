// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19: planning a record attempt on meet day.
 *
 * `records.ts` already answers what a record costs -- it reads the record book's
 * own margins and produces the weight that takes the record under each condition
 * the book distinguishes. `meet-rules.ts` already answers whether a fourth attempt
 * is available. Neither of them knows about the other, and the gap between them is
 * where a lifter loses a record.
 *
 * TWO ROUTES, AND THEY ARE NOT THE SAME WEIGHT
 *
 * A record can be taken inside the competition -- an ordinary first, second or
 * third attempt heavy enough to clear it -- or as a fourth attempt after the lift
 * is over. §19 asks for "the smallest legal attempt that would break or establish
 * the record" as though that were one number, and it is two, because the record
 * exemption from the loading increment belongs to the record attempt and not to
 * the competition attempt beside it. A 200.5 kg record is taken at 200.75 as a
 * fourth attempt and at 202 in the competition on a 2 kg bar multiple. Showing one
 * figure means showing the wrong one to whichever lifter is on the other route,
 * and the fourth-attempt figure shown as a competition attempt is the direction
 * that costs something: the expeditor refuses the card.
 *
 * The two routes differ in what they are worth as well as in what they weigh, and
 * that difference is the reason §19 lists "whether the lift counts toward the
 * competition total" as something to track. A competition attempt is a lift and a
 * record. A fourth attempt is a record and, where the profile says so, nothing
 * else -- not the total, not placing, not best lifter. A lifter one attempt away
 * from both a record and a placing has to know that taking the record on the
 * fourth does not move them up the sheet.
 *
 * A TOTAL RECORD CANNOT BE TAKEN ON A FOURTH ATTEMPT
 *
 * Not as a rule written here -- as an arithmetic consequence of the profile
 * excluding the fourth attempt from the total. If the lift does not count toward
 * the total then it cannot raise the total past a total record, so that route is
 * refused with the reason rather than offered with a weight nobody can use. This
 * falls out of two fields that are published separately and are never read
 * together anywhere else, which is exactly the kind of interaction that reaches a
 * platform intact.
 *
 * THE RULEBOOK AND THE RECORD BOOK BOTH NAME A MARGIN
 *
 * `RecordBook.minimumIncrementKilograms` says how much a lift must exceed a record
 * by to replace it. `MeetRuleProfile.fourthAttempt.minimumExcessKilograms` says how
 * much a fourth attempt must exceed a record by to be accepted. They are the same
 * rule read from two published sources, they are maintained by different people on
 * different schedules, and nothing makes them agree.
 *
 * When they disagree this module takes the heavier and says so. The asymmetry is
 * the one `records.ts` already states: being asked for more than the rules demand
 * costs a lifter an attempt, and being asked for less costs them the record. An
 * attempt is recoverable within the meet and a record is not.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * It does not decide which condition the record sits under. Whether a record is at,
 * above or below the level of the meet being lifted at is a fact about the meet,
 * which this code cannot see -- `records.ts` says so at length and produces both
 * figures for that reason. The default here is the same default
 * `standingAgainstRecord` already uses, and the caller says otherwise by setting
 * one flag.
 *
 * It does not verify anything. {@link VERIFY_WITH_OFFICIALS} is on every plan this
 * module returns, including the refusals, because a refusal is also an answer a
 * lifter might act on.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { FourthAttemptBlockCode, MeetRules, TakenAttempt } from './meet-rules.js';
import {
  recordTargets,
  type RecordMarginRules,
  type RecordTargets,
  type RecordUnderAttempt,
} from './records.js';
import { ceilToHundredths, ceilToIncrement } from './rounding.js';

/**
 * The sentence §19 requires beside every record figure, verbatim.
 *
 * Exported as a constant rather than written into each screen so that there is one
 * copy to keep verbatim, and so a test can assert it is present on a plan without
 * asserting the wording twice.
 */
export const VERIFY_WITH_OFFICIALS =
  'Verify this record and fourth-attempt eligibility with meet officials before submitting the attempt.';

/** Which attempt takes the record. */
export type RecordRouteVia =
  /** An ordinary first, second or third attempt, heavy enough to clear the record. */
  | 'competition-attempt'
  /** A record attempt after the lift is over, on the profile's terms. */
  | 'fourth-attempt';

/** Which published source set the margin a route clears the record by. */
export type RecordMarginSource =
  /** Both sources name the same figure. */
  | 'they-agree'
  /** The record book's margin is the heavier one. */
  | 'record-book'
  /** The rulebook's fourth-attempt margin is the heavier one. */
  | 'rulebook';

/** Why a route to the record is not available. */
export type RecordRouteBlockCode =
  /** Nothing was supplied to measure against, which is not the same as being far away. */
  | 'no-record-supplied'
  /** Every competition attempt on this lift has been taken. */
  | 'no-competition-attempts-left'
  /** The third attempt has not happened, so there is nothing to be eligible after. */
  | 'no-third-attempt-yet'
  /** The profile excludes the fourth attempt from the total, so it cannot take a total record. */
  | 'fourth-attempt-excluded-from-the-total'
  /** A total record needs the rest of the total, and none was supplied. */
  | 'total-so-far-not-supplied'
  /** The rules refuse the weight this route would need. */
  | 'no-legal-attempt-reaches-it'
  /** A `MeetRules` refusal, or a fourth-attempt block, passed through unchanged. */
  | FourthAttemptBlockCode;

/** One way to take the record, and everything that comes with it. */
export interface RecordRoute {
  readonly via: RecordRouteVia;

  /**
   * The lightest weight that takes the record by this route.
   *
   * For a total record this is the weight on the bar, not the total -- the total
   * it produces is {@link reachesTotalKilograms}.
   */
  readonly kilograms: number;

  /** The total that weight produces, for a total record. `null` for a lift record. */
  readonly reachesTotalKilograms: number | null;

  /** Which published margin this weight clears the record by. */
  readonly marginSource: RecordMarginSource;

  /**
   * Whether a good lift here counts toward the competition total.
   *
   * §19 lists this as something to track, and it is the field that separates the
   * two routes in what they are worth rather than in what they weigh.
   */
  readonly countsTowardTotal: boolean;

  /**
   * Everything the profile excludes this attempt from, in the profile's own words.
   *
   * Empty for a competition attempt. Passed through rather than interpreted: the
   * list is a federation's vocabulary and this layer has no business translating
   * "team-points" into a sentence.
   */
  readonly excludedFrom: readonly string[];

  /** Seconds to submit it, from the profile. */
  readonly submissionSeconds: number;

  /** Whether the attempt has to be granted before it can be taken. */
  readonly requiresPermission: boolean;

  /** Whether the equipment is checked after the lift rather than before it. */
  readonly requiresPostLiftEquipmentCheck: boolean;
}

export type RecordRouteAnswer =
  | { readonly available: true; readonly route: RecordRoute }
  | { readonly available: false; readonly reasons: readonly RecordRouteBlockCode[] };

/**
 * Whether the attempt before a fourth attempt earned the lifter the right to one.
 *
 * §19 asks for this by name and it is deliberately not folded into the route's
 * refusal. A lifter whose third was a miss and a lifter who is simply too far from
 * the record are both ineligible and want opposite advice -- one has lost the
 * chance and the other never had it -- so the qualifying attempt is reported as its
 * own fact whether or not the route came back available.
 */
export interface QualifyingAttempt {
  /** The third attempt, or `null` if the lift is not over. */
  readonly attempt: TakenAttempt | null;
  readonly qualified: boolean;
  /** Why not, in the profile's own vocabulary. Empty when it qualified. */
  readonly reasons: readonly FourthAttemptBlockCode[];
}

/**
 * Where a record was read from, and when.
 *
 * "Verification date" in §19, and the honest name is not that. This project knows
 * when its pipeline last retrieved the federation's table; it does not know when a
 * person last checked the record, and the two are far enough apart to matter for a
 * record set last weekend. So the field says retrieved, the mandatory sentence
 * asks for the verification, and nothing here claims to have done it.
 */
export interface RecordProvenance {
  /** The federation's own table, from `findRecordSourceTable`. `null` if unlisted. */
  readonly sourceUrl: string | null;
  /** An ISO timestamp, from the published `SourceFreshness`. `null` if unknown. */
  readonly retrievedAt: string | null;
}

export type RecordAdvisoryCode =
  /** The two published margins disagree; the heavier one was used. */
  | 'published-margins-disagree'
  /** The record supplied is for a different lift from the one being planned. */
  | 'record-is-for-another-lift'
  /** No provenance was supplied, so nothing on screen can cite the source. */
  | 'source-unknown'
  /** The record is the federation's seeded standard, so nobody holds it yet. */
  | 'record-is-unclaimed'
  /** The record's own two published columns contradict each other. */
  | 'source-contradicts-itself'
  /** This route takes the record and does not move the lifter up the sheet. */
  | 'fourth-attempt-is-excluded-from-placing'
  /** Both routes are closed, so there is nothing to plan on this lift today. */
  | 'no-route-to-the-record';

export type RecordAdvisorySeverity = 'note' | 'caution';

export interface RecordAdvisory {
  readonly code: RecordAdvisoryCode;
  readonly severity: RecordAdvisorySeverity;
  readonly message: string;
}

export interface RecordPlanRequest {
  /** `null` when the user has not told the tool what the record is. A real answer. */
  readonly record: RecordUnderAttempt | null;

  /** The margins from the book the record came out of. */
  readonly marginRules: RecordMarginRules;

  readonly rules: MeetRules;

  /** The lift being planned, which the record is checked against. */
  readonly lift: PlatformLift;

  /** Every attempt already taken on that lift, in any order. */
  readonly taken: readonly TakenAttempt[];

  /**
   * Set when the record being claimed sits **below** the level of the meet -- a
   * state record at a national championship.
   *
   * Defaults to false, which is the same default `standingAgainstRecord` takes and
   * for the same reason: it is the case a lifter is in unless they say otherwise,
   * and nothing in this repository can work out which case that is.
   */
  readonly recordIsBelowMeetLevel?: boolean | undefined;

  /**
   * The total the other lifts have already banked, for a total record.
   *
   * Required for a total record and ignored for a lift record. `null` rather than
   * a default of zero: a total of zero is a lifter who has bombed every other
   * lift, and offering them a record attempt would be arithmetic dressed as advice.
   */
  readonly totalFromOtherLiftsKilograms?: number | null | undefined;

  readonly provenance?: RecordProvenance | null | undefined;
}

export interface RecordPlan {
  /** The record being planned against, or `null` if none was supplied. */
  readonly record: RecordUnderAttempt | null;

  /** Every weight that takes it, by condition. `null` if no record was supplied. */
  readonly targets: RecordTargets | null;

  /** The weight this plan is measured against, after the condition is chosen. */
  readonly targetKilograms: number | null;

  readonly inCompetition: RecordRouteAnswer;
  readonly asFourthAttempt: RecordRouteAnswer;

  readonly qualifyingAttempt: QualifyingAttempt;

  readonly provenance: RecordProvenance;

  /** §19's mandatory sentence. Always {@link VERIFY_WITH_OFFICIALS}. */
  readonly verifyWithOfficials: string;

  readonly advisories: readonly RecordAdvisory[];
}

/** The same tolerance the rest of the meet code compares kilograms with. */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

/**
 * What a plan looks like when there is no record to plan against.
 *
 * Both routes refuse with the same reason and the mandatory sentence is still on
 * it. A screen showing "no record supplied" is a screen a lifter may act on by
 * typing one in, and the sentence is what stops them typing in a figure they
 * half-remember and treating the result as settled.
 */
function withoutARecord(provenance: RecordProvenance): RecordPlan {
  const refused: RecordRouteAnswer = { available: false, reasons: ['no-record-supplied'] };
  return {
    record: null,
    targets: null,
    targetKilograms: null,
    inCompetition: refused,
    asFourthAttempt: refused,
    qualifyingAttempt: { attempt: null, qualified: false, reasons: ['no-record-supplied'] },
    provenance,
    verifyWithOfficials: VERIFY_WITH_OFFICIALS,
    advisories: [],
  };
}

/**
 * The attempt a fourth attempt would follow.
 *
 * The last competition attempt by number rather than the last one recorded, because
 * `taken` is documented as unordered everywhere else in this code and an array
 * order that happens to be right in every test is the sort of dependency that
 * survives until the day a caller sorts by weight.
 */
function competitionAttempts(
  taken: readonly TakenAttempt[],
  attemptsPerLift: number,
): readonly TakenAttempt[] {
  return taken.filter((attempt) => attempt.attemptNumber <= attemptsPerLift);
}

function finalAttempt(
  taken: readonly TakenAttempt[],
  attemptsPerLift: number,
): TakenAttempt | null {
  return (
    competitionAttempts(taken, attemptsPerLift).find(
      (attempt) => attempt.attemptNumber === attemptsPerLift,
    ) ?? null
  );
}

/**
 * The lightest legal next attempt at or above a weight, or the rules' refusal.
 *
 * Every floor is already in `nextAttemptBounds`, so the candidate is legal by
 * construction and the check afterwards should never refuse. It is here anyway
 * rather than as a comment: `isLegalNextAttempt` is the authority on what may be
 * loaded, and a module that computes a weight and then declines to ask is a module
 * that will keep answering after the rule it duplicated has moved.
 */
function lightestLegalAtOrAbove(
  rules: MeetRules,
  taken: readonly TakenAttempt[],
  wanted: number,
): { readonly kilograms: number } | { readonly reasons: readonly RecordRouteBlockCode[] } {
  const bounds = rules.nextAttemptBounds(taken);
  const floor = Math.max(wanted, bounds.minimumKilograms, bounds.failedFloorKilograms ?? 0);
  const kilograms = rules.ceilToLegal(floor);
  const legality = rules.isLegalNextAttempt(taken, kilograms);
  if (!legality.legal) return { reasons: ['no-legal-attempt-reaches-it'] };
  return { kilograms };
}

/**
 * The record margin, taking the heavier of the two published sources.
 *
 * The rounding at the end is not cosmetic. The rulebook's figure sits on the
 * record progression grid because `fourthAttemptEligibility` put it there; the
 * record book's figure sits wherever the book's own margin lands. Taking the
 * larger of the two without rounding can name a weight between two grid steps --
 * a bar nobody can load -- so the winner goes back onto the grid the fourth
 * attempt is actually loaded in.
 */
function heavierMargin(
  bookKilograms: number,
  rulebookKilograms: number,
  recordProgressionKilograms: number,
): { readonly kilograms: number; readonly source: RecordMarginSource } {
  if (isSameWeight(bookKilograms, rulebookKilograms)) {
    return { kilograms: bookKilograms, source: 'they-agree' };
  }
  if (bookKilograms > rulebookKilograms) {
    return {
      kilograms: ceilToIncrement(bookKilograms, recordProgressionKilograms),
      source: 'record-book',
    };
  }
  return { kilograms: rulebookKilograms, source: 'rulebook' };
}

/**
 * The weight on the bar that reaches a target, and the total it reaches.
 *
 * One function for both kinds of record because the difference is one subtraction.
 * A lift record wants the target on the bar; a total record wants whatever is left
 * of the target once the other lifts are counted.
 */
function barWeightFor(
  request: RecordPlanRequest,
  targetKilograms: number,
): { readonly wanted: number } | { readonly reasons: readonly RecordRouteBlockCode[] } {
  if (request.record?.scope.lift !== 'total') return { wanted: targetKilograms };
  const others = request.totalFromOtherLiftsKilograms;
  if (others == null) return { reasons: ['total-so-far-not-supplied'] };
  return { wanted: ceilToHundredths(targetKilograms - others) };
}

function totalReachedBy(request: RecordPlanRequest, kilograms: number): number | null {
  if (request.record?.scope.lift !== 'total') return null;
  const others = request.totalFromOtherLiftsKilograms ?? 0;
  return ceilToHundredths(others + kilograms);
}

/**
 * The competition route: an ordinary attempt heavy enough to take the record.
 *
 * No exemption applies here, which is the whole reason this is not the same figure
 * as the fourth attempt. The weight is rounded up onto the ordinary bar multiple
 * and then checked against every rule that governs a next attempt.
 */
function competitionRoute(request: RecordPlanRequest, targetKilograms: number): RecordRouteAnswer {
  const { rules, taken } = request;
  const attemptsPerLift = rules.profile.attemptsPerLift;
  if (competitionAttempts(taken, attemptsPerLift).length >= attemptsPerLift) {
    return { available: false, reasons: ['no-competition-attempts-left'] };
  }

  const bar = barWeightFor(request, targetKilograms);
  if ('reasons' in bar) return { available: false, reasons: bar.reasons };

  const found = lightestLegalAtOrAbove(rules, taken, bar.wanted);
  if ('reasons' in found) return { available: false, reasons: found.reasons };

  return {
    available: true,
    route: {
      via: 'competition-attempt',
      kilograms: found.kilograms,
      reachesTotalKilograms: totalReachedBy(request, found.kilograms),
      // The competition attempt clears the record by whatever the record book
      // says, and then by however much more the bar multiple forces. The
      // rulebook's fourth-attempt margin has no jurisdiction here, so there is
      // nothing for it to disagree with.
      marginSource: 'they-agree',
      countsTowardTotal: true,
      excludedFrom: [],
      submissionSeconds: rules.profile.submissionSeconds,
      requiresPermission: false,
      requiresPostLiftEquipmentCheck: false,
    },
  };
}

/**
 * The attempt the eligibility window is measured from.
 *
 * For a lift record it is the third attempt itself, which is what the rule is
 * written about. For a total record it cannot be: the window asks how far the
 * lifter finished from the record, and the third deadlift is not a total. Handing
 * the raw third attempt to a rule comparing it against a total record would
 * refuse every lifter alive as hundreds of kilograms short, and the refusal would
 * carry `outside-the-record-window` -- a sentence that reads as a fact about the
 * lifter rather than as a unit mismatch in this file.
 *
 * So the total record is measured against the total, and the outcome rides along
 * unchanged so `requiresSuccessfulThird` still asks about the actual third lift.
 */
function windowAttemptFor(request: RecordPlanRequest, third: TakenAttempt): TakenAttempt {
  if (request.record?.scope.lift !== 'total') return third;
  const others = request.totalFromOtherLiftsKilograms ?? 0;
  const best = request.taken
    .filter((attempt) => attempt.outcome === 'good')
    .reduce((heaviest, attempt) => Math.max(heaviest, attempt.kilograms), 0);
  return { ...third, kilograms: ceilToHundredths(others + best) };
}

/**
 * The fourth-attempt route, on the profile's terms.
 *
 * `MeetRules` owns eligibility and its refusals are passed through unchanged --
 * every one of them at once, as it reports them, because a lifter whose third was
 * a miss *and* who is fifteen kilograms short has two things to be told and
 * fixing one of them changes nothing.
 */
function fourthAttemptRoute(
  request: RecordPlanRequest,
  targetKilograms: number,
): RecordRouteAnswer {
  const { record, rules, taken } = request;
  const rule = rules.profile.fourthAttempt;
  if (rule === null || record === null) {
    return { available: false, reasons: ['not-offered'] };
  }

  // A fourth attempt excluded from the total cannot raise the total, so it cannot
  // take a total record. Two published fields, read together nowhere else.
  if (record.scope.lift === 'total' && rule.excludedFrom.includes('total')) {
    return { available: false, reasons: ['fourth-attempt-excluded-from-the-total'] };
  }

  const third = finalAttempt(taken, rules.profile.attemptsPerLift);
  if (third === null) {
    return { available: false, reasons: ['no-third-attempt-yet'] };
  }

  const eligibility = rules.fourthAttemptEligibility({
    thirdAttempt: windowAttemptFor(request, third),
    recordKilograms: record.kilograms,
  });
  if (!eligibility.eligible) {
    return { available: false, reasons: eligibility.reasons };
  }

  const margin = heavierMargin(
    targetKilograms,
    eligibility.minimumKilograms,
    rules.profile.recordProgressionKilograms ?? rules.profile.barMultipleKilograms,
  );

  const bar = barWeightFor(request, margin.kilograms);
  if ('reasons' in bar) return { available: false, reasons: bar.reasons };

  return {
    available: true,
    route: {
      via: 'fourth-attempt',
      kilograms: bar.wanted,
      reachesTotalKilograms: totalReachedBy(request, bar.wanted),
      marginSource: margin.source,
      countsTowardTotal: !eligibility.excludedFrom.includes('total'),
      excludedFrom: eligibility.excludedFrom,
      submissionSeconds: eligibility.submissionSeconds,
      requiresPermission: eligibility.requiresPermission,
      requiresPostLiftEquipmentCheck: eligibility.requiresPostLiftEquipmentCheck,
    },
  };
}

/**
 * Whether the third attempt earned a fourth, reported whatever the route decided.
 *
 * Asks `MeetRules` the same question the route asks and keeps only the reasons
 * that are about the attempt. `not-offered` is about the federation and
 * `no-record-supplied` is about the user, and neither is something the lifter did
 * on the platform.
 */
function qualifyingAttemptFor(request: RecordPlanRequest): QualifyingAttempt {
  const { record, rules, taken } = request;
  const third = finalAttempt(taken, rules.profile.attemptsPerLift);
  if (third === null) {
    return { attempt: null, qualified: false, reasons: [] };
  }
  if (rules.profile.fourthAttempt === null) {
    return { attempt: third, qualified: false, reasons: ['not-offered'] };
  }

  const eligibility = rules.fourthAttemptEligibility({
    thirdAttempt: windowAttemptFor(request, third),
    recordKilograms: record?.kilograms ?? null,
  });
  return eligibility.eligible
    ? { attempt: third, qualified: true, reasons: [] }
    : { attempt: third, qualified: false, reasons: eligibility.reasons };
}

function advisoriesFor(
  request: RecordPlanRequest,
  record: RecordUnderAttempt,
  inCompetition: RecordRouteAnswer,
  asFourthAttempt: RecordRouteAnswer,
  provenance: RecordProvenance,
): readonly RecordAdvisory[] {
  const advisories: RecordAdvisory[] = [];

  if (record.scope.lift !== 'total' && record.scope.lift !== request.lift) {
    // The bug §17 turned up in `live-choices.ts`, in its other clothes: a figure
    // measured on one lift and shown against another is wrong in the flattering
    // direction, and flattering is the direction that gets acted on.
    advisories.push({
      code: 'record-is-for-another-lift',
      severity: 'caution',
      message: `This record is for the ${record.scope.lift} and the lift being planned is the ${request.lift}.`,
    });
  }

  if (asFourthAttempt.available && asFourthAttempt.route.marginSource !== 'they-agree') {
    const source =
      asFourthAttempt.route.marginSource === 'record-book' ? 'record book' : 'rulebook';
    advisories.push({
      code: 'published-margins-disagree',
      severity: 'caution',
      message: `The record book and the rulebook name different margins over this record. The heavier one, from the ${source}, is the figure shown.`,
    });
  }

  if (asFourthAttempt.available && asFourthAttempt.route.excludedFrom.includes('placing')) {
    advisories.push({
      code: 'fourth-attempt-is-excluded-from-placing',
      severity: 'note',
      message: 'A fourth attempt takes the record without changing where the lifter places.',
    });
  }

  if (record.unclaimed) {
    advisories.push({
      code: 'record-is-unclaimed',
      severity: 'note',
      message: 'Nobody holds this record yet: the figure is the standard the federation seeded.',
    });
  }

  if (record.sourceDisagreement !== null) {
    advisories.push({
      code: 'source-contradicts-itself',
      severity: 'caution',
      message: `The source prints ${String(record.kilograms)} kg and ${String(record.sourceDisagreement.pounds)} lb for this record, which are not the same weight.`,
    });
  }

  if (provenance.sourceUrl === null || provenance.retrievedAt === null) {
    advisories.push({
      code: 'source-unknown',
      severity: 'note',
      message: 'This record cannot be shown with the table and date it was read from.',
    });
  }

  if (!inCompetition.available && !asFourthAttempt.available) {
    advisories.push({
      code: 'no-route-to-the-record',
      severity: 'note',
      message: 'There is no attempt left today that would take this record.',
    });
  }

  return advisories;
}

/**
 * Everything §19 asks to be tracked about one record attempt.
 *
 * Total, in the sense that every input produces a plan: no record, no attempts, a
 * federation with no fourth attempt and a record nobody can reach today all come
 * back as a plan carrying the reason. There is nothing here a screen has to guard
 * against before rendering, which matters because the screen this feeds is being
 * read at an expeditor's table.
 */
export function recordPlan(request: RecordPlanRequest): RecordPlan {
  const provenance: RecordProvenance = request.provenance ?? {
    sourceUrl: null,
    retrievedAt: null,
  };

  const { record } = request;
  if (record === null) return withoutARecord(provenance);

  const targets = recordTargets(record, request.marginRules);
  const chosen =
    (request.recordIsBelowMeetLevel ?? false) && targets.recordBelowMeetLevel !== null
      ? targets.recordBelowMeetLevel
      : targets.recordAtOrAboveMeetLevel;

  const inCompetition = competitionRoute(request, chosen.kilograms);
  const asFourthAttempt = fourthAttemptRoute(request, chosen.kilograms);

  return {
    record,
    targets,
    targetKilograms: chosen.kilograms,
    inCompetition,
    asFourthAttempt,
    qualifyingAttempt: qualifyingAttemptFor(request),
    provenance,
    verifyWithOfficials: VERIFY_WITH_OFFICIALS,
    advisories: advisoriesFor(request, record, inCompetition, asFourthAttempt, provenance),
  };
}
