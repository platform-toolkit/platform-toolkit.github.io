// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  AthleteEntry,
  ClassificationRequirement,
  ClassificationTable,
  QualifyingFederationRules,
  QualifyingMeet,
  QualifyingMeetBook,
  QualifyingRoute,
  QualifyingWindow,
} from '@platform-toolkit/data-contracts';
import { findQualifyingFederationRules } from '@platform-toolkit/data-contracts';
import {
  ClassificationLadder,
  openAgeDivision,
  selectClassificationTable,
} from '@platform-toolkit/domain';

import type {
  BestPerformance,
  CalendarDay,
  CatalogVocabulary,
  DisregardedResult,
  EntryReading,
  MeetReading,
  MeetTiming,
  ObservedStanding,
  ResolvedRegistration,
  RouteAvailability,
  RouteOutcome,
  RouteReading,
  StandardReading,
  UncheckableCondition,
} from '../types.js';
import { collectStandings, performanceSourceOf } from './history.js';
import { windowContains } from './window.js';

/**
 * Way one: a transcribed meet's published criteria, read against one standing.
 *
 * The reading is deliberately thin. Every route resolves to arithmetic against a
 * published figure or to a named reason there is no arithmetic to do, and there is
 * no step after that -- no score, no ranking of the routes, and nothing that adds
 * up to a verdict. Section 29 puts the verdict with the federation, and the shape
 * of this file is what keeps it there: a caller wanting `eligible` would have to
 * write the fold itself, in the open, where somebody would ask why.
 *
 * Two properties of the criteria contract drive nearly all of the code below.
 *
 * **A route carries its own window.** One meet in the corpus has three tiers with
 * three different windows, so a single window per meet would have shortened two of
 * them. Every route therefore re-reads the lifter's history against its own dates
 * rather than against whatever window the screen is showing -- and the results that
 * fall outside are listed rather than dropped, because a lifter whose best total is
 * eleven days too old needs to see that sentence and not a blank.
 *
 * **A standard may not be a total at all.** The invite tiers ask for a coefficient
 * score, which compares lifters across bodyweight and cannot be read out of a
 * classification table. A screen that only understood totals would drop half of a
 * real meet's criteria without saying so, so `points-not-computed` is an outcome
 * with the threshold attached rather than a route quietly missing from the list.
 *
 * ## The one thing this file assumes, said out loud
 *
 * `ClassificationRequirement` names a standard and does not say which **lift** it
 * is read on. Every criterion transcribed so far is a total -- "Class 2 total or
 * above" -- and the total is what this reads. That is an assumption, and it is
 * wrong for a bench-only meet whose criteria name a bench standard. It is not
 * guessed around: the meet's own `offerings` are on {@link MeetReading.meet} so the
 * screen can print the disciplines beside the reading, and the gap in the contract
 * is backlog #89 rather than a translation invented here. Deriving the lift from a
 * discipline label would mean asserting that the announcement's word for an event
 * is this project's `Lift`, which is the assertion `category-match.ts` exists to
 * refuse.
 */

/**
 * The lift every transcribed criterion is read on. See the note above.
 *
 * A constant rather than an inline `'total'` so that the assumption has one name,
 * one place, and one comment -- and so that the day the contract carries a lift,
 * the compiler lists every site that has to change.
 */
const CRITERION_LIFT = 'total' as const;

/**
 * Reads one meet's published criteria against one settled registration.
 *
 * `rules` comes from the same book as the meet and is looked up here rather than
 * being the caller's errand, because the two are read together: a screen able to
 * load the criteria without the entry rules would show half of them while looking
 * complete.
 */
export function readMeetCriteria(
  meet: QualifyingMeet,
  standing: ObservedStanding,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): MeetReading {
  const rules = context.rules ?? null;

  return {
    meet,
    registration,
    offersThisEntry: offersEntry(meet.testedOffering, registration.tested),
    entry: readEntry(meet, standing, registration, context),
    conditions: [
      ...meet.conditions.map((condition): UncheckableCondition => ({ condition, from: 'meet' })),
      ...(rules?.conditions ?? []).map((condition): UncheckableCondition => ({
        condition,
        from: 'federation',
      })),
    ],
    rules,
  };
}

/** What a reading needs beyond the meet itself. */
export interface CriteriaContext {
  /** The federation's published classification tables. */
  readonly tables: readonly ClassificationTable[];
  /** The federation's own categories, for resolving an Open-table reading. */
  readonly vocabulary: CatalogVocabulary;
  /** The entry rules published for this meet's federation, where the book has any. */
  readonly rules: QualifyingFederationRules | null;
}

/**
 * Pulls a meet and its federation's rules out of a published book.
 *
 * Total, and `null` for a meet the book does not carry -- which is the fourth
 * state `QualifyingEntrySchema`'s comment names and the only one it cannot express:
 * a meet nobody has read at all is a meet that is not in the book, and it is way
 * three's case rather than an empty way one.
 */
export function findQualifyingMeet(
  book: QualifyingMeetBook,
  meetId: string,
): { readonly meet: QualifyingMeet; readonly rules: QualifyingFederationRules | null } | null {
  const meet = book.meets.find((candidate) => candidate.id === meetId);
  if (meet === undefined) {
    return null;
  }
  // The join is `data-contracts`', not this file's. Written again here it would be a
  // second answer to "which rules govern this meet", and the two would agree until
  // the day publication started keying federations on something else.
  return { meet, rules: findQualifyingFederationRules(book, meet.federationId) };
}

/**
 * Where a meet sits relative to a day the caller supplies.
 *
 * The day is an argument because this package holds no clock (section 15), and
 * because the ingestion adapter refused one for a sharper reason worth keeping on
 * this side too: a rule that depended on the current date would fail a scheduled
 * refresh, at two in the morning, for being correct.
 */
export function meetTiming(meet: QualifyingMeet, today: CalendarDay): MeetTiming {
  if (today > meet.held.to) {
    return 'held';
  }
  if (today >= meet.held.from) {
    return 'in-progress';
  }
  // An announcement with no closing day is not an announcement promising the entry
  // form stays open. It is a page that did not say, and `entry-open` is the reading
  // that leaves a lifter checking rather than one that tells them they are too late.
  if (meet.entryClosesOn !== null && today > meet.entryClosesOn) {
    return 'entry-closed';
  }
  return 'entry-open';
}

/**
 * Whether a staged route has opened yet, on a day the caller supplies.
 *
 * Beside {@link meetTiming} and taking the day the same way, for the same two
 * reasons: this package holds no clock (section 15), and a rule that read one
 * would be untestable at any date but today.
 *
 * The comparison is a string comparison and that is deliberate. Both sides are
 * `YYYY-MM-DD`, which sorts lexicographically in date order, and the alternative
 * -- parsing to a `Date` -- makes the answer depend on the reader's timezone on
 * exactly the day the route opens, which is the day somebody is refreshing the
 * page (section 5.5).
 */
export function routeAvailability(route: QualifyingRoute, today: CalendarDay): RouteAvailability {
  if (route.availability === null) {
    return 'unstaged';
  }
  // Inclusive, matching the contract: "registration opens up February 1st" admits
  // an entry on February 1st, and the exclusive reading shuts the route on the one
  // day the announcement is about.
  return today >= route.availability.opensOn ? 'open' : 'not-yet-open';
}

/** Whether a meet's sanction covers a tested or an untested registration. */
function offersEntry(offering: QualifyingMeet['testedOffering'], tested: boolean): boolean {
  if (offering === 'both') {
    return true;
  }
  return tested ? offering === 'tested' : offering === 'untested';
}

function readEntry(
  meet: QualifyingMeet,
  standing: ObservedStanding,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): EntryReading {
  switch (meet.entry.kind) {
    case 'open':
      return { kind: 'open', quotation: meet.entry.quotation };
    case 'unstated':
      return { kind: 'unstated', detail: meet.entry.detail };
    case 'standard':
      return {
        kind: 'routes',
        routes: meet.entry.routes.map((route) => readRoute(route, standing, registration, context)),
      };
  }
}

/** Reads one route against the history, in that route's own window. */
export function readRoute(
  route: QualifyingRoute,
  standing: ObservedStanding,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): RouteReading {
  const { kept, disregarded } = sift(route, standing.entries);
  const best = bestTotalOf(kept, route.window);

  return { route, best, disregarded, outcome: outcomeOf(route, best, registration, context) };
}

function outcomeOf(
  route: QualifyingRoute,
  best: BestPerformance | null,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): RouteOutcome {
  // Checked before the figures, because a route that opens the other competition
  // does not become applicable by the lifter having a heavier total.
  if (route.appliesToTested !== null && route.appliesToTested !== registration.tested) {
    return { kind: 'not-open-to-this-entry', opensTested: route.appliesToTested };
  }

  if (route.standard.kind === 'points') {
    // Before the result check rather than after it, so a lifter with no total in the
    // window still sees that this route was never one arithmetic could settle. The
    // other order would blame the window for a limit that is this tool's.
    return { kind: 'points-not-computed', requirement: route.standard };
  }

  if (best === null) {
    return { kind: 'no-result-in-window' };
  }

  return readClassificationRequirement(route.standard, best, registration, context);
}

function readClassificationRequirement(
  requirement: ClassificationRequirement,
  best: BestPerformance,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): RouteOutcome {
  if (requirement.divisionBasis !== null) {
    return {
      kind: 'read',
      basis: requirement.divisionBasis,
      reading: readOn(requirement.divisionBasis, requirement, best, registration, context),
    };
  }

  const open = readOn('open', requirement, best, registration, context);
  const liftersAgeDivision = readOn(
    'lifters-age-division',
    requirement,
    best,
    registration,
    context,
  );

  if (open.kind !== liftersAgeDivision.kind) {
    return { kind: 'two-readings', open, liftersAgeDivision };
  }
  if (open.kind === 'unreadable' && liftersAgeDivision.kind === 'unreadable') {
    // Two readings that both failed, for possibly different reasons. Reported as
    // one only where the reason is the same, so that "the Open table is missing"
    // and "your division's table is ambiguous" are never printed as one sentence.
    return open.reason === liftersAgeDivision.reason
      ? { kind: 'read', basis: 'either-table', reading: open }
      : { kind: 'two-readings', open, liftersAgeDivision };
  }

  // Both readings agree on the verdict and may still differ on the figures, because
  // the two tables are two ladders. The less flattering one is the one shown: a
  // lifter told they are clear by the wider margin, on criteria that never said
  // which table, has been handed the reading that is easiest to be wrong about.
  return { kind: 'read', basis: 'either-table', reading: lessFlattering(open, liftersAgeDivision) };
}

function readOn(
  basis: 'open' | 'lifters-age-division',
  requirement: ClassificationRequirement,
  best: BestPerformance,
  registration: ResolvedRegistration,
  context: CriteriaContext,
): StandardReading {
  const divisionId = divisionIdFor(basis, registration, context.vocabulary);
  if (divisionId === null) {
    return { kind: 'unreadable', reason: 'open-division-unknown' };
  }

  const selection = selectClassificationTable(
    {
      sex: registration.sex,
      lift: CRITERION_LIFT,
      equipmentId: registration.equipmentId,
      weightClassId: registration.weightClassId,
      divisionId,
      tested: registration.tested,
    },
    context.tables,
  );
  if (!selection.ok) {
    return {
      kind: 'unreadable',
      reason: selection.reason === 'ambiguous' ? 'ambiguous-standards' : 'no-standards',
    };
  }

  const ladder = ClassificationLadder.from(selection.table.standards);
  if (!ladder.ok) {
    // A published table that is not a ladder cannot grade anybody, and reads from
    // where the lifter is standing as the federation publishing no standards.
    return { kind: 'unreadable', reason: 'no-standards' };
  }

  const distance = ladder.ladder.distanceTo(requirement.standardId, best.kilograms);
  if (distance === null) {
    return { kind: 'unreadable', reason: 'standard-not-published' };
  }

  if (!distance.reached) {
    return { kind: 'short', distance, table: selection.table };
  }

  const achieved = ladder.ladder.classify(best.kilograms).achieved;
  if (!requirement.orAbove && achieved !== null && achieved.rank > distance.standard.rank) {
    return { kind: 'above-the-bracket', distance, table: selection.table, achieved };
  }

  return { kind: 'reaches', distance, table: selection.table };
}

/** The division a reading is taken in, or `null` where the Open one is not settled. */
function divisionIdFor(
  basis: 'open' | 'lifters-age-division',
  registration: ResolvedRegistration,
  vocabulary: CatalogVocabulary,
): string | null {
  if (basis === 'lifters-age-division') {
    return registration.divisionId;
  }
  const open = openAgeDivision(vocabulary.divisions);
  return open.ok ? open.division.id : null;
}

/**
 * The reading that claims least, where two of the same kind disagree on figures.
 *
 * Ties break to the first argument, which is the Open reading. That is arbitrary
 * and it is only ever reached when the two readings are identical in everything a
 * screen prints except the table's name, so nothing a lifter reads turns on it.
 */
function lessFlattering(left: StandardReading, right: StandardReading): StandardReading {
  if (left.kind === 'unreadable' || right.kind === 'unreadable') {
    return left;
  }
  if (left.kind === 'short' && right.kind === 'short') {
    return right.distance.kilogramsShort > left.distance.kilogramsShort ? right : left;
  }
  return right.distance.kilogramsClear < left.distance.kilogramsClear ? right : left;
}

/**
 * Splits a standing's entries into the ones a route may be read on and the rest.
 *
 * Three filters and one deliberate omission. `federationNames` and `tested` are
 * checkable against the archive's own columns; `territory` is not -- the archive
 * publishes a meet's federation and not the country it was held in -- and it is
 * carried on the route so a screen can say so. Dropping it would have this tool
 * quietly count an overseas result the meet has said it will not.
 */
function sift(
  route: QualifyingRoute,
  entries: readonly AthleteEntry[],
): { readonly kept: readonly AthleteEntry[]; readonly disregarded: readonly DisregardedResult[] } {
  const kept: AthleteEntry[] = [];
  const disregarded: DisregardedResult[] = [];

  for (const entry of entries) {
    const reason = disregardReason(route, entry);
    if (reason === null) {
      kept.push(entry);
    } else {
      disregarded.push({ source: performanceSourceOf(entry), reason });
    }
  }

  return { kept, disregarded };
}

function disregardReason(
  route: QualifyingRoute,
  entry: AthleteEntry,
): DisregardedResult['reason'] | null {
  // The route's window is used directly rather than being rebuilt through
  // `performanceWindow`. It reached here through `QualifyingWindowSchema`, whose
  // `isoDate` check is the same guarantee the constructor exists to give -- and
  // whose `from <= to` check is the one the constructor calls `inverted`.
  if (!windowContains(route.window, entry.date)) {
    return 'outside-the-route-window';
  }

  const { federationNames, tested } = route.performance;
  if (federationNames !== null && !namesFederation(federationNames, entry)) {
    return 'federation-not-named';
  }

  if (tested !== null && entry.tested !== tested) {
    // A blank is the archive not saying, and it is never read as `false`
    // (`RegistrationLabels.tested`). So an unrecorded meet fails a tested route,
    // and it fails it for a reason the lifter can do something about.
    return entry.tested === null ? 'drug-testing-unrecorded' : 'meet-not-drug-tested';
  }

  return null;
}

/**
 * Whether a route's named federations cover the body that sanctioned a result.
 *
 * Matched on spelling, which everywhere else in this package is refused -- and here
 * is the point rather than an exception. `QualifyingPerformanceSchema` requires
 * these to be spelled the way the results archive spells them, so a transcriber
 * wrote the archive's own string on purpose. The fold is the same one
 * `category-match.ts` uses, and for the same narrow reason: it forgives punctuation
 * and case, and it does not stem, abbreviate or translate.
 */
function namesFederation(federationNames: readonly string[], entry: AthleteEntry): boolean {
  const named = new Set(federationNames.map(fold));
  if (named.has(fold(entry.federation))) {
    return true;
  }
  return entry.parentFederation !== null && named.has(fold(entry.parentFederation));
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The best three-lift total in a route's window, or `null`.
 *
 * Delegated to `collectStandings` rather than computed here, and that is the whole
 * reason this function exists. The rule that a total must come from an entry
 * recording all three lifts lives in one place; a second implementation of it here
 * would grade a push/pull total against a three-lift standard the first time
 * somebody edited one copy -- and it errs upwards, which is the direction nobody
 * double-checks.
 */
function bestTotalOf(
  entries: readonly AthleteEntry[],
  window: QualifyingWindow,
): BestPerformance | null {
  const [standing, ...rest] = collectStandings(entries, window);
  if (standing === undefined || rest.length > 0) {
    // More than one standing means the caller mixed registrations, which
    // `ObservedStanding.entries` cannot produce. Reading the first would answer a
    // question about a registration nobody asked about.
    return null;
  }
  return standing.total;
}
