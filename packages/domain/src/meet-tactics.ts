// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * "What wins?" -- §18's tactical mode, and the line it must not cross.
 *
 * The arithmetic is the easy half: given what a competitor has, what is the
 * lightest legal weight on the attempt about to be declared that ties them, and
 * what is the lightest that beats them. The hard half is the sentence §18 ends on
 * -- a tactically necessary lift "must not be described as physiologically likely
 * merely because it is mathematically necessary". So this file answers the
 * arithmetic and then says, in the same breath, how far above the lifter's own
 * confirmed maximum the answer sits and which of §10.2's four words describes it.
 * The necessity and the difficulty are two facts and they are reported as two
 * facts.
 *
 * Nothing here refuses a weight and nothing here recommends one. It reports what
 * each weight would achieve. `live-choices.ts` remains the only module that
 * highlights an option, and a weight this file surfaces is marked with the slot it
 * was already offered in when it happens to be one -- so a tactical answer that
 * agrees with the plan reads as agreement rather than as a second opinion.
 *
 * SCENARIOS, NOT A FORECAST
 *
 * A competitor with a bar loaded and no lights yet is two futures, and §18 asks
 * for both: the result if they make it and the result if they miss. Both are
 * returned, neither is weighted, and no probability is attached to either -- the
 * one thing a coach at the table knows for certain is that nobody knows.
 *
 * WHAT IS SUPPLIED AND WHAT IS DERIVED
 *
 * The competitor's figures are typed in by the user, off the board. This file
 * never derives them, never fetches them, and treats the label as private text of
 * the same kind as an attempt note: never logged, never in an error payload. What
 * it derives is the user's own side, from the meet document, so the two halves of
 * every comparison cannot drift apart.
 *
 * THE SCORING TABLE IS AUTHORITATIVE
 *
 * §18 says so outright and an advisory says so on every answer. A coefficient is
 * supplied as a mapping rather than computed here, for the same reason a target
 * is: the formula and its version belong to the federation, they change, and a
 * placing decided on a stale coefficient is worse than one the tool declined to
 * compute.
 */
import type { PlatformLift, TieBreakStep } from '@platform-toolkit/data-contracts';

import type { AttemptPlan } from './attempt-plan.js';
import { classifyAttemptRisk, type AttemptRisk } from './attempt-risk.js';
import { liveChoicesFor, type LiveChoiceSlot } from './live-choices.js';
import {
  bestGoodLift,
  findAttempt,
  nextAttemptOn,
  projectedTotalWith,
  takenOn,
  type LiveLifter,
  type MeetDocument,
  type MeetTimeline,
} from './meet-document.js';
import type { ChangeConditionCode, MeetRules, NextAttemptBounds } from './meet-rules.js';

/** The same tolerance the rest of the meet code compares kilograms with. */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

/**
 * How far up the legal ladder a required weight is looked for.
 *
 * A bound rather than a rule. The answer is normally within a few rungs, and a
 * ladder this long only matters when a lifter asks what it would take to catch
 * somebody far ahead -- which §18 wants answered honestly rather than hidden, so
 * that the "how far above your maximum" figure can be the thing that ends the
 * conversation. Beyond it the answer is `null` and an advisory says the search
 * stopped, which is not the same as saying no weight would do it.
 */
const SEARCH_LADDER_LENGTH = 400;

/**
 * How many unresolved competitor attempts are modelled at once.
 *
 * Each one doubles the scenarios. Three is eight scenarios, which is already more
 * than a screen at the expeditor's table can carry; past that the answer is one
 * scenario with every pending attempt assumed made, which is the pessimistic
 * reading, plus an advisory saying so.
 */
const MAX_PENDING_ATTEMPTS_MODELLED = 3;

// -----------------------------------------------------------------------------
// What the placing is decided on
// -----------------------------------------------------------------------------

/**
 * The figure two lifters are ranked by.
 *
 * `total` is the ordinary case and the identity mapping. A coefficient is the
 * caller's function because it depends on bodyweight, sex, equipment and a
 * formula version this module has no business knowing -- and because a federation
 * that changes its formula must be able to change one artifact rather than this
 * file. The mapping must not decrease as the total rises; the search takes the
 * first weight that clears, which is only the minimum if that holds.
 */
export interface PlacingScale {
  readonly basis: 'total' | 'coefficient';
  /** How the interface names it. Shown, never logged. */
  readonly label: string;
  /** The user's placing figure for a competition total of this many kilograms. */
  readonly scoreForUser: (totalKilograms: number) => number;
  /** The same, for the competitor whose bodyweight is their own. */
  readonly scoreForCompetitor: (totalKilograms: number) => number;
}

function identity(totalKilograms: number): number {
  return totalKilograms;
}

/** Ranking on the competition total itself, which is what most contests do. */
export const TOTAL_PLACING_SCALE: PlacingScale = {
  basis: 'total',
  label: 'Total',
  scoreForUser: identity,
  scoreForCompetitor: identity,
};

// -----------------------------------------------------------------------------
// The competitor
// -----------------------------------------------------------------------------

/**
 * An attempt a competitor has declared and not yet been judged on.
 *
 * `kilograms` is what is going on the bar. The competitor's `totalKilograms` is
 * read as *not* including it, whatever its result -- so a caller updates one field
 * when the lights come up rather than reconciling two.
 */
export interface CompetitorPendingAttempt {
  readonly kilograms: number;
  /** Their best good lift on that same lift so far, or `null` when they have none. */
  readonly bestSoFarKilograms?: number | null | undefined;
  /**
   * Whether missing it leaves them with no total at all.
   *
   * Their third attempt on a lift they have not yet made. Supplied rather than
   * inferred: this module has the user's document and not the competitor's.
   */
  readonly missWouldBombThemOut?: boolean | undefined;
  /** `null` while the bar is still on the platform. */
  readonly result?: 'good' | 'no-lift' | null | undefined;
}

/**
 * Somebody the user is placing against, as typed in off the board.
 *
 * The label is private text of the same kind as an attempt note (§12.1): shown to
 * the person who typed it and never logged, never in an error payload, never sent
 * to an embedding page.
 */
export interface TacticalCompetitor {
  readonly label: string;
  /** What they have banked, not counting any pending attempt. */
  readonly totalKilograms: number;
  /** Whether that figure is a total -- every contested lift made. */
  readonly hasATotal: boolean;
  readonly bodyweightKilograms?: number | null | undefined;
  /** Whether they reached their total before the user, where the meet knows. */
  readonly reachedTotalFirst?: boolean | null | undefined;
  readonly pending?: CompetitorPendingAttempt | null | undefined;
}

// -----------------------------------------------------------------------------
// Ties
// -----------------------------------------------------------------------------

/** Which way a tie goes, when the rules say. */
export type TieFavours = 'user' | 'competitor' | 'declared-tie' | 'unknown';

/** Why a tie goes the way it does, in one code an interface can route on. */
export type TieReasonCode =
  | 'user-is-lighter'
  | 'competitor-is-lighter'
  | 'decided-by-a-reweigh'
  | 'user-reached-the-total-first'
  | 'competitor-reached-the-total-first'
  | 'declared-a-tie'
  | 'bodyweights-not-supplied'
  | 'no-rule-separates-them';

export interface TieAssessment {
  readonly favours: TieFavours;
  /** The first step in the profile's sequence that separates them, or `null`. */
  readonly step: TieBreakStep | null;
  readonly reason: TieReasonCode;
}

// -----------------------------------------------------------------------------
// A required weight
// -----------------------------------------------------------------------------

export interface TacticalRequirement {
  readonly kilograms: number;
  /** What the user's competition total becomes if it is made. */
  readonly finalTotalKilograms: number;
  /** The placing figure that total produces, on the supplied scale. */
  readonly scoreValue: number;
  /** How far it is above the confirmed meet-day maximum. Negative below it. */
  readonly aboveMaximumKilograms: number | null;
  readonly percentOfMaximum: number | null;
  /** §10.2's four words, or `null` when no maximum was ever confirmed. */
  readonly risk: AttemptRisk | null;
  /** The slot this weight already sits in on the lifter's own screen, if any. */
  readonly offeredSlot: LiveChoiceSlot | null;
  /** Whether it is the exact weight of the attempt just missed, taken again. */
  readonly repeat: boolean;
}

/** What one competitor is assumed to do in a scenario. */
export interface ScenarioAssumption {
  readonly competitorLabel: string;
  readonly outcome: 'makes-the-attempt' | 'misses-the-attempt' | 'nothing-pending';
  /** Their total under this assumption, or `null` when it leaves them without one. */
  readonly totalKilograms: number | null;
}

export interface TacticalOutcome {
  /** One entry per competitor, in the order they were supplied. */
  readonly assumptions: readonly ScenarioAssumption[];
  /**
   * The placing figure that has to be reached, or `null` when the desired placing
   * is already secure because too few competitors are in the way.
   */
  readonly thresholdScore: number | null;
  /** The user's placing figure if they add nothing further. `null` without a total. */
  readonly scoreIfNothingMore: number | null;
  /** Whether the desired placing is already held without taking the attempt. */
  readonly alreadyThere: boolean;
  /** The lightest legal weight that draws level on the placing figure. */
  readonly toTie: TacticalRequirement | null;
  /** The lightest legal weight that goes past it. */
  readonly toBeat: TacticalRequirement | null;
  /** Whether a tie at the threshold goes to the user. */
  readonly tie: TieAssessment;
  /** Whether the search reached the top of the ladder without finding a weight. */
  readonly outOfReach: boolean;
}

// -----------------------------------------------------------------------------
// Advisories
// -----------------------------------------------------------------------------

export type TacticalAdvisoryCode =
  /** §18's closing line, on every answer. */
  | 'the-scoring-table-is-authoritative'
  /** A required weight is above the lifter's own confirmed maximum. */
  | 'necessary-is-not-the-same-as-likely'
  /** The lifter has a lift with no good attempt, so no weight here makes a total. */
  | 'no-total-without-the-other-lifts'
  /** No maximum was confirmed, so nothing is graded (§10.2). */
  | 'no-maximum-confirmed'
  /** The competitor's figure is not yet a total either. */
  | 'competitor-has-no-total-yet'
  /** More pending attempts than the scenarios cover. */
  | 'too-many-pending-attempts-to-model'
  /** The search stopped before finding a weight that would do it. */
  | 'beyond-the-search'
  /** There is no attempt left on this lift to declare. */
  | 'nothing-left-to-declare'
  /** A coefficient decides the placing and the mapping came from the caller. */
  | 'placing-decided-on-a-coefficient';

export type TacticalAdvisorySeverity = 'note' | 'strong';

export interface TacticalAdvisory {
  readonly code: TacticalAdvisoryCode;
  readonly severity: TacticalAdvisorySeverity;
  readonly message: string;
}

// -----------------------------------------------------------------------------
// The request and the answer
// -----------------------------------------------------------------------------

export interface TacticalRequest {
  readonly document: MeetDocument;
  readonly lifter: LiveLifter;
  readonly lift: PlatformLift;
  readonly competitors: readonly TacticalCompetitor[];
  /**
   * The placing the user is trying to hold. 1 is the win, which is the default.
   *
   * With `n` competitors supplied and a desired placing of `p`, the figure to beat
   * is the `p`-th best competitor score: the ones above it may stay above it and
   * the user still places `p`-th.
   */
  readonly desiredPlacing?: number | undefined;
  readonly userBodyweightKilograms?: number | null | undefined;
  readonly meetDayMaximumKilograms?: number | null | undefined;
  readonly plan?: AttemptPlan | null | undefined;
  readonly ceilingKilograms?: number | null | undefined;
  /** Defaults to ranking on the total itself. */
  readonly scale?: PlacingScale | undefined;
}

export interface TacticalAnswer {
  readonly lift: PlatformLift;
  /** The attempt these figures are about, or `null` when the lift is over. */
  readonly attemptId: string | null;
  readonly attemptNumber: number | null;
  readonly desiredPlacing: number;
  readonly scale: PlacingScale;
  /** One per combination of pending results, in a stable order. */
  readonly outcomes: readonly TacticalOutcome[];
  readonly advisories: readonly TacticalAdvisory[];
}

/**
 * What each weight on the next attempt would achieve against the competition.
 *
 * Pure, like everything else that reads the live document: nothing is stored, so
 * an undo restores the tactical answer along with the attempt it was about.
 */
export function whatWins(rules: MeetRules, request: TacticalRequest): TacticalAnswer {
  const { document, lifter, lift } = request;
  const scale = request.scale ?? TOTAL_PLACING_SCALE;
  const desiredPlacing = Math.max(1, Math.trunc(request.desiredPlacing ?? 1));
  const next = nextAttemptOn(lifter, lift);
  const advisories: TacticalAdvisory[] = [];

  advisories.push({
    code: 'the-scoring-table-is-authoritative',
    severity: 'note',
    message:
      'The official scoring table and the meet staff decide the placing. These figures are for choosing an attempt, not for settling one.',
  });

  if (scale.basis === 'coefficient') {
    advisories.push({
      code: 'placing-decided-on-a-coefficient',
      severity: 'note',
      message: `Placing is compared on ${scale.label}, using the formula the federation publishes. Check the version against the table before acting on a close call.`,
    });
  }

  if (request.meetDayMaximumKilograms == null) {
    advisories.push({
      code: 'no-maximum-confirmed',
      severity: 'note',
      message:
        'No meet-day maximum was confirmed, so these weights carry no Secure, Recommended, Push or Long Shot label.',
    });
  }

  if (request.competitors.some((competitor) => !competitor.hasATotal)) {
    advisories.push({
      code: 'competitor-has-no-total-yet',
      severity: 'note',
      message:
        'A competitor figure below is not yet a total. If they finish without one they place nowhere, whatever it says here.',
    });
  }

  if (next === null) {
    advisories.push({
      code: 'nothing-left-to-declare',
      severity: 'note',
      message: 'There is no attempt left on this lift to declare.',
    });
    return {
      lift,
      attemptId: null,
      attemptNumber: null,
      desiredPlacing,
      scale,
      outcomes: [],
      advisories,
    };
  }

  const scenarios = scenariosFor(request.competitors);
  if (scenarios.truncated) {
    advisories.push({
      code: 'too-many-pending-attempts-to-model',
      severity: 'note',
      message:
        'More attempts are on the platform than can be shown side by side, so every one of them is assumed to be made. That is the hardest case, not the likeliest.',
    });
  }

  const candidates = candidateWeights(rules, lifter, lift);
  const context: RequirementContext = {
    rules,
    document,
    lifter,
    lift,
    attemptNumber: next.attemptNumber,
    maximum: request.meetDayMaximumKilograms ?? null,
    scale,
    candidates,
    offered: offeredWeights(rules, request, next.attemptNumber),
    repeatKilograms: rules.nextAttemptBounds(takenOn(lifter, lift)).repeatKilograms,
  };

  const outcomes = scenarios.assumptions.map((assumptions) =>
    outcomeFor(context, request, assumptions, desiredPlacing),
  );

  if (outcomes.some((outcome) => outcome.outOfReach)) {
    advisories.push({
      code: 'beyond-the-search',
      severity: 'note',
      message:
        'No legal weight within the range searched reaches that placing on this attempt. That is the search stopping, not a rule saying it cannot be done.',
    });
  }

  if (!projectedTotalWith(document, lifter, lift, candidates[0] ?? 0).isTotal) {
    advisories.push({
      code: 'no-total-without-the-other-lifts',
      severity: 'strong',
      message:
        'A contested lift still has no good attempt, so no weight here produces a total and none of these comparisons can be settled yet.',
    });
  }

  if (
    outcomes.some(
      (outcome) => aboveMaximum(outcome.toTie) || aboveMaximum(outcome.toBeat) || longShot(outcome),
    )
  ) {
    advisories.push({
      code: 'necessary-is-not-the-same-as-likely',
      severity: 'strong',
      message:
        'A weight below is what the placing needs, which is not a statement that it is within reach today. Weigh it against the day you are having.',
    });
  }

  return {
    lift,
    attemptId: next.id,
    attemptNumber: next.attemptNumber,
    desiredPlacing,
    scale,
    outcomes,
    advisories,
  };
}

function aboveMaximum(requirement: TacticalRequirement | null): boolean {
  return requirement !== null && (requirement.aboveMaximumKilograms ?? 0) > 0;
}

function longShot(outcome: TacticalOutcome): boolean {
  return outcome.toBeat?.risk === 'long-shot' || outcome.toTie?.risk === 'long-shot';
}

// -----------------------------------------------------------------------------
// Scenarios
// -----------------------------------------------------------------------------

interface Scenarios {
  readonly assumptions: readonly (readonly ScenarioAssumption[])[];
  readonly truncated: boolean;
}

/**
 * Every combination of the unresolved attempts on the platform.
 *
 * A competitor with no pending attempt, or one already judged, contributes a
 * single fixed assumption rather than a branch -- there is nothing to be unsure
 * about. The branches come only from bars that are still loaded.
 */
function scenariosFor(competitors: readonly TacticalCompetitor[]): Scenarios {
  const unresolved = competitors.filter(
    (competitor) => competitor.pending != null && competitor.pending.result == null,
  );
  const truncated = unresolved.length > MAX_PENDING_ATTEMPTS_MODELLED;
  const branching = truncated ? [] : unresolved;

  let combinations: (readonly ScenarioAssumption[])[] = [[]];
  for (const competitor of competitors) {
    const options = branching.includes(competitor)
      ? [
          assumptionFor(competitor, 'makes-the-attempt'),
          assumptionFor(competitor, 'misses-the-attempt'),
        ]
      : [fixedAssumption(competitor, truncated)];
    combinations = combinations.flatMap((prefix) => options.map((option) => [...prefix, option]));
  }

  return { assumptions: combinations, truncated };
}

function fixedAssumption(competitor: TacticalCompetitor, assumeMade: boolean): ScenarioAssumption {
  const pending = competitor.pending ?? null;
  if (pending === null) return assumptionFor(competitor, 'nothing-pending');
  if (pending.result === 'good') return assumptionFor(competitor, 'makes-the-attempt');
  if (pending.result === 'no-lift') return assumptionFor(competitor, 'misses-the-attempt');
  return assumptionFor(competitor, assumeMade ? 'makes-the-attempt' : 'nothing-pending');
}

function assumptionFor(
  competitor: TacticalCompetitor,
  outcome: ScenarioAssumption['outcome'],
): ScenarioAssumption {
  return {
    competitorLabel: competitor.label,
    outcome,
    totalKilograms: competitorTotal(competitor, outcome),
  };
}

/**
 * What a competitor's total is under one assumption.
 *
 * A made attempt adds only what it improves on: a second at 180 after a first at
 * 170 is ten kilograms on the total, not a hundred and eighty. `null` is the
 * competitor who ends with no total, which is not the same as a total of zero --
 * they place nowhere, so no weight is needed to beat them.
 */
function competitorTotal(
  competitor: TacticalCompetitor,
  outcome: ScenarioAssumption['outcome'],
): number | null {
  const pending = competitor.pending ?? null;
  if (outcome === 'makes-the-attempt' && pending !== null) {
    const gain = Math.max(0, pending.kilograms - (pending.bestSoFarKilograms ?? 0));
    return competitor.totalKilograms + gain;
  }
  if (outcome === 'misses-the-attempt' && pending?.missWouldBombThemOut === true) return null;
  return competitor.hasATotal ? competitor.totalKilograms : null;
}

// -----------------------------------------------------------------------------
// One scenario
// -----------------------------------------------------------------------------

interface RequirementContext {
  readonly rules: MeetRules;
  readonly document: MeetDocument;
  readonly lifter: LiveLifter;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  readonly maximum: number | null;
  readonly scale: PlacingScale;
  readonly candidates: readonly number[];
  readonly offered: ReadonlyMap<number, LiveChoiceSlot>;
  readonly repeatKilograms: number | null;
}

function outcomeFor(
  context: RequirementContext,
  request: TacticalRequest,
  assumptions: readonly ScenarioAssumption[],
  desiredPlacing: number,
): TacticalOutcome {
  const scores = assumptions
    .map((assumption) =>
      assumption.totalKilograms === null
        ? null
        : context.scale.scoreForCompetitor(assumption.totalKilograms),
    )
    .filter((score): score is number => score !== null)
    .sort((left, right) => right - left);

  // Placing `p` needs the user past the `p`-th best competitor. With fewer than
  // `p` competitors in the way the placing is held whatever happens on this bar.
  const threshold = scores[desiredPlacing - 1] ?? null;

  const banked = projectedTotalWith(
    context.document,
    context.lifter,
    context.lift,
    bestGoodLift(context.lifter, context.lift) ?? 0,
  );
  const scoreIfNothingMore = banked.isTotal ? context.scale.scoreForUser(banked.kilograms) : null;

  const tie = assessTie(context, request, assumptions, threshold);
  const tieHolds = tie.favours === 'user';

  if (threshold === null) {
    return {
      assumptions,
      thresholdScore: null,
      scoreIfNothingMore,
      alreadyThere: true,
      toTie: null,
      toBeat: null,
      tie,
      outOfReach: false,
    };
  }

  const alreadyThere =
    scoreIfNothingMore !== null &&
    (scoreIfNothingMore > threshold || (tieHolds && scoreIfNothingMore >= threshold));

  const toTie = findRequirement(context, (score) => score >= threshold);
  const toBeat = findRequirement(context, (score) => score > threshold);

  return {
    assumptions,
    thresholdScore: threshold,
    scoreIfNothingMore,
    alreadyThere,
    toTie,
    toBeat,
    tie,
    outOfReach: !alreadyThere && toBeat === null,
  };
}

/**
 * The lightest candidate whose resulting score clears a test.
 *
 * A linear walk up the ladder rather than arithmetic on the total, because the
 * placing figure may be a coefficient the caller supplied and this module cannot
 * invert a function it was handed. The ladder is already only legal weights, so
 * the first one that clears is the answer and no rounding decision is made here.
 */
function findRequirement(
  context: RequirementContext,
  clears: (score: number) => boolean,
): TacticalRequirement | null {
  for (const kilograms of context.candidates) {
    const projected = projectedTotalWith(context.document, context.lifter, context.lift, kilograms);
    if (!projected.isTotal) return null;
    const score = context.scale.scoreForUser(projected.kilograms);
    if (!clears(score)) continue;
    return {
      kilograms,
      finalTotalKilograms: projected.kilograms,
      scoreValue: score,
      aboveMaximumKilograms: context.maximum === null ? null : kilograms - context.maximum,
      percentOfMaximum: context.maximum === null ? null : (kilograms / context.maximum) * 100,
      risk: gradeRisk(context.lift, context.attemptNumber, kilograms, context.maximum),
      offeredSlot: context.offered.get(kilograms) ?? null,
      repeat: context.repeatKilograms !== null && isSameWeight(kilograms, context.repeatKilograms),
    };
  }
  return null;
}

/**
 * §10.2's label, or nothing at all.
 *
 * The same refusal `live-choices.ts` makes and for the same reason: the classifier
 * is total and answers Long Shot for a maximum it cannot use, and putting the
 * harshest of four words on a weight nobody was graded against would be a
 * judgement made out of an absence.
 */
function gradeRisk(
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  maximum: number | null,
): AttemptRisk | null {
  if (maximum === null) return null;
  if (attemptNumber !== 1 && attemptNumber !== 2 && attemptNumber !== 3) return null;
  return classifyAttemptRisk({ lift, attemptNumber, kilograms, meetDayMaximumKilograms: maximum });
}

/** Every legal weight the next attempt could be, lightest first. */
function candidateWeights(
  rules: MeetRules,
  lifter: LiveLifter,
  lift: PlatformLift,
): readonly number[] {
  const taken = takenOn(lifter, lift);
  const bounds = rules.nextAttemptBounds(taken);
  const ladder = rules.legalLadder(taken, SEARCH_LADDER_LENGTH);
  // A repeat sits below the minimum progression and is legal where the profile
  // allows it, so it belongs at the front rather than being lost to a ladder that
  // starts one increment higher.
  if (bounds.repeatAllowed && bounds.repeatKilograms !== null) {
    return [bounds.repeatKilograms, ...ladder];
  }
  return ladder;
}

/**
 * The weights already on the lifter's own screen, by slot.
 *
 * So a tactical answer can say "this is your recommended attempt" rather than
 * presenting the same number a second time as though it were a different idea.
 */
function offeredWeights(
  rules: MeetRules,
  request: TacticalRequest,
  attemptNumber: number,
): ReadonlyMap<number, LiveChoiceSlot> {
  const choices = liveChoicesFor(rules, {
    document: request.document,
    lifter: request.lifter,
    lift: request.lift,
    plan: request.plan ?? null,
    meetDayMaximumKilograms: request.meetDayMaximumKilograms ?? null,
    ceilingKilograms: request.ceilingKilograms ?? null,
  });
  const offered = new Map<number, LiveChoiceSlot>();
  if (choices.attemptNumber !== attemptNumber) return offered;
  for (const choice of choices.choices) {
    if (choice.kilograms !== null) offered.set(choice.kilograms, choice.slot);
  }
  return offered;
}

// -----------------------------------------------------------------------------
// Ties
// -----------------------------------------------------------------------------

/**
 * Whether drawing level is worth doing, under this federation's own sequence.
 *
 * §18 asks the question because the answer changes the attempt. Under a rulebook
 * that gives a tie to the lighter lifter, a lifter who weighed in two kilograms
 * under their rival can take the weight that ties and win; under one that declares
 * a tie, or re-weighs afterwards, drawing level settles nothing and the attempt
 * has to go up.
 */
function assessTie(
  context: RequirementContext,
  request: TacticalRequest,
  assumptions: readonly ScenarioAssumption[],
  threshold: number | null,
): TieAssessment {
  const rival = rivalAtThreshold(request.competitors, assumptions, context.scale, threshold);
  const userBodyweight = request.userBodyweightKilograms ?? null;
  const rivalBodyweight = rival?.bodyweightKilograms ?? null;
  const bodyweightsKnown = userBodyweight !== null && rivalBodyweight !== null;
  const reachedFirst = rival?.reachedTotalFirst ?? null;

  const step = context.rules.firstSeparatingTieBreak({
    bodyweightsDiffer: bodyweightsKnown && userBodyweight !== rivalBodyweight,
    reachedTotalFirstIsKnown: reachedFirst !== null,
  });

  if (step === 'lighter-bodyweight') {
    // `bodyweightsDiffer` was true to select this step, so the two figures are
    // known and unequal; the comparison below cannot come out even.
    const userIsLighter = (userBodyweight ?? 0) < (rivalBodyweight ?? 0);
    return {
      favours: userIsLighter ? 'user' : 'competitor',
      step,
      reason: userIsLighter ? 'user-is-lighter' : 'competitor-is-lighter',
    };
  }
  if (step === 'reweigh') {
    return { favours: 'unknown', step, reason: 'decided-by-a-reweigh' };
  }
  if (step === 'first-to-total') {
    return {
      favours: reachedFirst === true ? 'competitor' : 'user',
      step,
      reason:
        reachedFirst === true
          ? 'competitor-reached-the-total-first'
          : 'user-reached-the-total-first',
    };
  }
  if (step === 'declared-tie') {
    return { favours: 'declared-tie', step, reason: 'declared-a-tie' };
  }
  return {
    favours: 'unknown',
    step: null,
    reason: bodyweightsKnown ? 'no-rule-separates-them' : 'bodyweights-not-supplied',
  };
}

/** Whoever holds the score the user has to reach, so the tie is assessed against them. */
function rivalAtThreshold(
  competitors: readonly TacticalCompetitor[],
  assumptions: readonly ScenarioAssumption[],
  scale: PlacingScale,
  threshold: number | null,
): TacticalCompetitor | null {
  if (threshold === null) return null;
  for (const [index, assumption] of assumptions.entries()) {
    if (assumption.totalKilograms === null) continue;
    if (scale.scoreForCompetitor(assumption.totalKilograms) !== threshold) continue;
    return competitors[index] ?? null;
  }
  return null;
}

// -----------------------------------------------------------------------------
// §18's third-attempt change tracking
// -----------------------------------------------------------------------------

/** One weight this attempt has carried, in the order it was declared. */
export interface DeclaredWeight {
  readonly kilograms: number;
  /** Whether it was the first figure handed over, rather than a change to it. */
  readonly original: boolean;
}

export interface AttemptChangeHistory {
  readonly attemptId: string;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  /** The first weight declared, or `null` when nothing has been declared yet. */
  readonly originalKilograms: number | null;
  /** Every weight since, in order. §18's "first change" and "second change". */
  readonly changes: readonly DeclaredWeight[];
  readonly changesUsed: number;
  readonly changesAllowed: number;
  readonly changesRemaining: number;
  /**
   * Conditions the application cannot observe and must state (§18).
   *
   * Whether the lifter has been called to a loaded bar, and whether the preceding
   * lifter has set a floor, are facts about a room this tool is not in.
   */
  readonly conditions: readonly ChangeConditionCode[];
  /** What the user told us about being called, or `null` when they have not said. */
  readonly calledToTheBar: boolean | null;
  /** The floor under the next declaration, and which rules put it there. */
  readonly bounds: NextAttemptBounds;
  /** The rule in the rulebook's own words, where the profile gave one. */
  readonly summary: string | null;
}

/**
 * Every weight one attempt has carried, read back out of the undo history.
 *
 * §18 wants the original third and each change shown side by side, and the
 * document does not store a list -- it stores the weight, and the timeline stores
 * every earlier document. Deriving the list rather than adding a field is what
 * keeps undo correct for free: step back one action and the history reported here
 * steps back with it, because it was never anything but a reading of the past.
 *
 * `UNDO_HISTORY_LIMIT` bounds the past, so a very long meet can drop the earliest
 * declarations. When that happens the earliest weight still visible is reported as
 * the original, which is why `changesUsed` comes from the attempt itself rather
 * than from the length of this list.
 */
export function attemptChangeHistory(
  rules: MeetRules,
  timeline: MeetTimeline,
  attemptId: string,
  observed: { readonly calledToTheBar?: boolean | null | undefined } = {},
): AttemptChangeHistory | null {
  const found = findAttempt(timeline.present, attemptId);
  if (found === null) return null;
  const { lifter, attempt } = found;

  const declared: number[] = [];
  for (const step of timeline.past) {
    const earlier = findAttempt(step.document, attemptId);
    const kilograms = earlier?.attempt.kilograms ?? null;
    if (kilograms === null) continue;
    if (declared.length === 0 || !isSameWeight(kilograms, declared[declared.length - 1] ?? 0)) {
      declared.push(kilograms);
    }
  }
  if (
    attempt.kilograms !== null &&
    (declared.length === 0 || !isSameWeight(attempt.kilograms, declared[declared.length - 1] ?? 0))
  ) {
    declared.push(attempt.kilograms);
  }

  const [original = null, ...rest] = declared;
  const allowance = rules.changeAllowance({
    lift: attempt.lift,
    attemptNumber: attempt.attemptNumber,
    format: timeline.present.format,
    used: attempt.changesUsed,
  });

  return {
    attemptId,
    lift: attempt.lift,
    attemptNumber: attempt.attemptNumber,
    originalKilograms: original,
    changes: rest.map((kilograms) => ({ kilograms, original: false })),
    changesUsed: allowance.used,
    changesAllowed: allowance.allowed,
    changesRemaining: allowance.remaining,
    conditions: allowance.conditions,
    calledToTheBar: observed.calledToTheBar ?? null,
    bounds: rules.nextAttemptBounds(takenOn(lifter, attempt.lift)),
    summary: allowance.summary,
  };
}
