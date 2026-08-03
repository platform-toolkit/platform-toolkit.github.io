// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The five figures §17 refuses to let a screen collapse into one.
 *
 * A lifter halfway through a meet has a different number depending on what you
 * assume, and every one of them is true:
 *
 *   guaranteed   what is banked and cannot be lost
 *   subtotal     what is banked in lifts that are finished, which will not move
 *   secure       where they land taking the cautious option from here
 *   recommended  where they land taking the planned option from here
 *   stretch      where they land taking the aggressive option from here
 *
 * §17 says "always distinguish", and the reason is the failure of the single
 * number: a lifter with two lifts made and a deadlift to go, shown one figure
 * labelled "total", believes the day is banked. It is not -- three misses on the
 * deadlift and they place nowhere. So `guaranteed` and the three projections are
 * separate fields with separate names, and no function here returns "the total".
 *
 * HOW THE PROJECTIONS ARE MADE
 *
 * Not by percentages, and not by re-deriving a ladder. Each projection walks the
 * lift forward one attempt at a time through `live-choices.ts` -- the same module
 * the lifter is actually being shown -- assuming each projected attempt is made
 * solidly and asking again. Three consequences follow, and all three are the
 * point:
 *
 *   - The projection cannot disagree with the recommendation on screen. A lifter
 *     who takes every recommended option lands exactly on the recommended total,
 *     because the same code chose both.
 *   - Every projected weight is legal under the federation's own arithmetic,
 *     including the rising bar and the failed-attempt floor, because it came back
 *     through `MeetRules`.
 *   - A branch that offers no aggressive option offers none here either. After a
 *     lifter reports pain there is no push slot, so the stretch projection for
 *     that lift is the cautious one and says so rather than inventing a weight
 *     nobody would be offered.
 *
 * WHAT IS ASSUMED IS SAID OUT LOUD
 *
 * Every projection carries the count of attempts it assumed, and an advisory
 * states the assumption in words. A projected total is arithmetic about a
 * hypothetical, not a forecast, and nothing here attaches a probability to one
 * (§10.2). Where a remaining attempt could not be projected -- the branch offers a
 * pass, or the lift is over -- the attempt is counted as unprojected rather than
 * filled with a plausible figure.
 *
 * TARGETS
 *
 * `LiveTarget` is the same type `live-choices.ts` takes, deliberately: a target is
 * supplied by whatever knows about it (ingested qualifying totals, the published
 * record set, the other lifters in the session) and neither module computes one.
 * This file answers which of the five figures reaches it, and how much is missing
 * when none of them does.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { AttemptPlan } from './attempt-plan.js';
import {
  liveChoicesFor,
  type LiveChoice,
  type LiveChoiceSlot,
  type LiveTarget,
} from './live-choices.js';
import {
  attemptsOn,
  bestGoodLift,
  bombOutRisk,
  isResolved,
  liftsInFormat,
  nextAttemptOn,
  totalSoFar,
  type LiveLifter,
  type MeetDocument,
  type RunningTotal,
} from './meet-document.js';
import type { MeetRules } from './meet-rules.js';

/** The same tolerance the rest of the meet code compares kilograms with. */
const SAME_WEIGHT_SLACK = 0.000_5;

function isAtLeast(value: number, floor: number): boolean {
  return value >= floor - SAME_WEIGHT_SLACK;
}

/**
 * A backstop on the projection walk, not a rule.
 *
 * The loop ends when `live-choices.ts` reports no next attempt, which it does
 * once the numbered attempts are used up. This bound exists so that a profile
 * with a surprising attempt count, or a future branch that hands back an attempt
 * without consuming one, cannot spin -- it is deliberately well above any real
 * federation's three.
 */
const MAX_PROJECTED_ATTEMPTS_PER_LIFT = 12;

// -----------------------------------------------------------------------------
// The figures
// -----------------------------------------------------------------------------

/** Which of §17's figures, in order from what is certain to what is hoped for. */
export type ProjectionBasis = 'guaranteed' | 'secure' | 'recommended' | 'stretch';

/** `guaranteed` first, then the three projections in increasing aggression. */
export const PROJECTION_BASES: readonly ProjectionBasis[] = [
  'guaranteed',
  'secure',
  'recommended',
  'stretch',
];

/** Which choice slot each projection follows. `guaranteed` follows none. */
const SLOT_FOR_BASIS: Readonly<Record<Exclude<ProjectionBasis, 'guaranteed'>, LiveChoiceSlot>> = {
  secure: 'secure',
  recommended: 'recommended',
  stretch: 'push',
};

/**
 * What is banked in lifts that are over.
 *
 * A different figure from `guaranteed`, and §17 lists both because they answer
 * different questions. A lifter who has made a squat and still has two squats to
 * take has that squat guaranteed -- it cannot be taken away -- but the squat is
 * not settled, because the figure may still rise. The settled subtotal is the part
 * of the day that is finished with.
 */
export interface SettledSubtotal {
  readonly kilograms: number;
  /** Lifts with no competition attempt left. Their contribution cannot change. */
  readonly liftsSettled: readonly PlatformLift[];
  /** Lifts still open, whose banked figure may yet rise. */
  readonly liftsInProgress: readonly PlatformLift[];
  /**
   * Whether every contested lift is settled.
   *
   * True does not mean the lifter has a total: a lift settled with three misses
   * is settled and contributes nothing. Read `MeetTotals.guaranteed.isTotal` for
   * that question, which is the one field that answers it.
   */
  readonly everyLiftSettled: boolean;
}

/** Why a projection stopped short of a lift's remaining attempts. */
export type ProjectionStop =
  /** Every remaining attempt was projected. */
  | 'complete'
  /** The branch's answer in this slot was Pass, so nothing further was assumed. */
  | 'the-branch-offers-a-pass'
  /** The branch offered nothing at all in any slot. */
  | 'no-choice-was-offered';

/** One lift's contribution to one projection. */
export interface ProjectedLift {
  readonly lift: PlatformLift;
  /** The best good lift already made, or `null` when there is none yet. */
  readonly bankedKilograms: number | null;
  /**
   * The weights this projection assumed, in the order they would be taken.
   *
   * Empty when the lift is over or nothing could be assumed. Never a weight the
   * federation's rules would refuse: each one came back from the same code path
   * that would offer it to the lifter.
   */
  readonly assumedKilograms: readonly number[];
  /** What the lift contributes: the heaviest of the banked and assumed figures. */
  readonly contributionKilograms: number;
  /** Remaining competition attempts this projection did not assume a weight for. */
  readonly attemptsNotProjected: number;
  readonly stop: ProjectionStop;
  /** Whether the projection walked without a plan and followed the legal ladder instead. */
  readonly withoutAPlan: boolean;
}

export interface MeetProjection {
  readonly basis: Exclude<ProjectionBasis, 'guaranteed'>;
  readonly slot: LiveChoiceSlot;
  readonly total: RunningTotal;
  readonly lifts: readonly ProjectedLift[];
  /** How many attempts the figure assumes are made. Zero means it assumes nothing. */
  readonly attemptsAssumed: number;
  /** Whether every remaining attempt had a weight to assume. */
  readonly complete: boolean;
}

/** How far along one target is, across all five figures. */
export interface TargetProgress {
  readonly target: LiveTarget;
  /**
   * What counts towards it right now.
   *
   * The best good lift for a lift target; the banked total for a total target.
   * Zero rather than `null` when nothing counts yet: the figure is a sum, and an
   * empty sum is zero.
   */
  readonly guaranteedKilograms: number;
  /** What still has to be added. Zero once it is reached. */
  readonly shortfallKilograms: number;
  readonly reachedByGuaranteed: boolean;
  readonly reachedBySecure: boolean;
  readonly reachedByRecommended: boolean;
  readonly reachedByStretch: boolean;
  /** The least aggressive figure that reaches it, or `null` when none does. */
  readonly firstBasisThatReaches: ProjectionBasis | null;
}

/** Something the screen must say about the figures rather than about one of them. */
export type TotalsAdvisoryCode =
  /** Every projection assumes the attempts it names are made. Said once, always. */
  | 'projections-assume-every-attempt-is-made'
  /** A contested lift has no good lift, so there is no total yet at any figure. */
  | 'no-total-yet'
  /** A lift is on its last chance to stay in the meet. */
  | 'bomb-out-would-void-every-figure'
  /** No plan was supplied for a lift, so its projection followed the legal ladder. */
  | 'projected-without-a-plan'
  /** A projection could not assume a weight for every remaining attempt. */
  | 'projection-is-incomplete'
  /** Every lift is finished; nothing is projected because nothing is left. */
  | 'the-meet-is-over-for-this-lifter';

export type TotalsAdvisorySeverity = 'note' | 'strong';

export interface TotalsAdvisory {
  readonly code: TotalsAdvisoryCode;
  readonly severity: TotalsAdvisorySeverity;
  readonly message: string;
}

export interface MeetTotals {
  /** Best successful attempts only. What cannot be lost. */
  readonly guaranteed: RunningTotal;
  /** Best successful attempts in lifts that are over. What will not change. */
  readonly subtotal: SettledSubtotal;
  readonly secure: MeetProjection;
  readonly recommended: MeetProjection;
  readonly stretch: MeetProjection;
  /** In the order the caller supplied the targets. */
  readonly targets: readonly TargetProgress[];
  readonly advisories: readonly TotalsAdvisory[];
}

// -----------------------------------------------------------------------------
// The request
// -----------------------------------------------------------------------------

/** What the planner knows about one lift, for projecting the rest of it. */
export interface LiftProjectionInput {
  readonly plan?: AttemptPlan | null | undefined;
  /** `M` for this lift (§7). Absent means the projected attempts carry no risk label. */
  readonly meetDayMaximumKilograms?: number | null | undefined;
  /** §8.1's hard ceiling, honoured by the projection exactly as it is on screen. */
  readonly ceilingKilograms?: number | null | undefined;
}

export interface MeetTotalsRequest {
  readonly document: MeetDocument;
  /** The lifter, not an id: the caller has already done the lookup. */
  readonly lifter: LiveLifter;
  /** Keyed by lift, so a caller with a plan for one lift can supply just that one. */
  readonly lifts?: Partial<Record<PlatformLift, LiftProjectionInput>> | undefined;
  readonly targets?: readonly LiveTarget[] | undefined;
}

// -----------------------------------------------------------------------------
// The answer
// -----------------------------------------------------------------------------

/**
 * Every §17 figure for one lifter, from the document alone.
 *
 * Pure, like `liveChoicesFor` and for the same reason: undo has to restore the
 * totals along with everything else, and it does so for free because nothing here
 * is stored. Never mutates the document, and never reads a clock.
 */
export function meetTotals(rules: MeetRules, request: MeetTotalsRequest): MeetTotals {
  const { document, lifter } = request;
  const lifts = liftsInFormat(document.format);
  const targets = request.targets ?? [];

  const guaranteed = totalSoFar(document, lifter);
  const subtotal = settledSubtotal(document, lifter);

  const secure = project(rules, request, lifts, 'secure');
  const recommended = project(rules, request, lifts, 'recommended');
  const stretch = project(rules, request, lifts, 'stretch');

  const progress = targets.map((target) =>
    progressTowards(document, lifter, target, guaranteed, { secure, recommended, stretch }),
  );

  return {
    guaranteed,
    subtotal,
    secure,
    recommended,
    stretch,
    targets: progress,
    advisories: advisoriesFor(lifter, lifts, guaranteed, [secure, recommended, stretch]),
  };
}

function settledSubtotal(document: MeetDocument, lifter: LiveLifter): SettledSubtotal {
  const settled: PlatformLift[] = [];
  const inProgress: PlatformLift[] = [];
  let kilograms = 0;
  for (const lift of liftsInFormat(document.format)) {
    if (nextAttemptOn(lifter, lift) === null) {
      settled.push(lift);
      kilograms += bestGoodLift(lifter, lift) ?? 0;
    } else {
      inProgress.push(lift);
    }
  }
  return {
    kilograms,
    liftsSettled: settled,
    liftsInProgress: inProgress,
    everyLiftSettled: inProgress.length === 0,
  };
}

// -----------------------------------------------------------------------------
// Walking a projection forward
// -----------------------------------------------------------------------------

function project(
  rules: MeetRules,
  request: MeetTotalsRequest,
  lifts: readonly PlatformLift[],
  basis: Exclude<ProjectionBasis, 'guaranteed'>,
): MeetProjection {
  const slot = SLOT_FOR_BASIS[basis];
  const projected = lifts.map((lift) => projectLift(rules, request, lift, slot));

  let kilograms = 0;
  const outstanding: PlatformLift[] = [];
  for (const lift of projected) {
    if (lift.bankedKilograms === null && lift.assumedKilograms.length === 0) {
      outstanding.push(lift.lift);
      continue;
    }
    kilograms += lift.contributionKilograms;
  }

  return {
    basis,
    slot,
    total: { kilograms, isTotal: outstanding.length === 0, liftsOutstanding: outstanding },
    lifts: projected,
    attemptsAssumed: projected.reduce((sum, lift) => sum + lift.assumedKilograms.length, 0),
    complete: projected.every((lift) => lift.attemptsNotProjected === 0),
  };
}

/**
 * One lift, walked to the end of its attempts under one slot policy.
 *
 * The simulated lifter is a copy with the projected attempt marked good, which is
 * what makes the next call to `liveChoicesFor` answer the §13.2 branch rather than
 * the §13.1 one. `solid` is the effort assumed, and it is the neutral reading: it
 * is the branch that continues the plan, where `flew` would compound an increase
 * over three rounds and `grind` would talk the projection down into a pass.
 */
function projectLift(
  rules: MeetRules,
  request: MeetTotalsRequest,
  lift: PlatformLift,
  slot: LiveChoiceSlot,
): ProjectedLift {
  const input = request.lifts?.[lift];
  const plan = input?.plan ?? null;
  const banked = bestGoodLift(request.lifter, lift);

  let document = request.document;
  let lifter = request.lifter;
  const assumed: number[] = [];
  let stop: ProjectionStop = 'complete';

  for (let step = 0; step < MAX_PROJECTED_ATTEMPTS_PER_LIFT; step += 1) {
    const choices = liveChoicesFor(rules, {
      document,
      lifter,
      lift,
      plan,
      meetDayMaximumKilograms: input?.meetDayMaximumKilograms ?? null,
      ceilingKilograms: input?.ceilingKilograms ?? null,
      targets: request.targets ?? [],
    });
    if (choices.attemptId === null) break;

    const choice = choiceInSlot(choices.choices, slot);
    if (choice === null) {
      stop = 'no-choice-was-offered';
      break;
    }
    if (choice.kilograms === null) {
      stop = 'the-branch-offers-a-pass';
      break;
    }

    assumed.push(choice.kilograms);
    lifter = withAssumedGoodLift(lifter, choices.attemptId, choice.kilograms);
    document = withLifter(document, lifter);
  }

  const contribution = assumed.reduce((best, weight) => Math.max(best, weight), banked ?? 0);

  return {
    lift,
    bankedKilograms: banked,
    assumedKilograms: assumed,
    contributionKilograms: contribution,
    attemptsNotProjected: stop === 'complete' ? 0 : remainingAttempts(lifter, lift),
    stop,
    withoutAPlan: plan === null && assumed.length > 0,
  };
}

/**
 * The choice in a slot, or the highlighted one when that slot is not offered.
 *
 * §13.5 removes the push slot after a lifter reports pain, and the stretch
 * projection has to answer something for that lift. Falling back to the highlight
 * is the honest answer -- it is what the lifter would be shown -- and it is why the
 * stretch total can equal the secure one rather than exceeding it by construction.
 */
function choiceInSlot(choices: readonly LiveChoice[], slot: LiveChoiceSlot): LiveChoice | null {
  return choices.find((choice) => choice.slot === slot) ?? highlighted(choices);
}

function highlighted(choices: readonly LiveChoice[]): LiveChoice | null {
  return choices.find((choice) => choice.highlighted) ?? null;
}

/** Competition attempts still to be taken on a lift. */
function remainingAttempts(lifter: LiveLifter, lift: PlatformLift): number {
  return attemptsOn(lifter, lift).filter(
    (attempt) => attempt.kind === 'competition' && !isResolved(attempt),
  ).length;
}

/**
 * A copy of the lifter with one attempt marked good at a weight.
 *
 * Not routed through `applyMeetAction`, and the reason is the clock: every action
 * takes the instant it happened, and a projection has no instant to give. Nothing
 * is being recorded here -- the copy is thrown away when the walk ends -- so the
 * one thing that matters is that the copy is a legal shape for the readers that
 * see it, which is why the miss fields are cleared alongside the status.
 */
function withAssumedGoodLift(lifter: LiveLifter, attemptId: string, kilograms: number): LiveLifter {
  return {
    ...lifter,
    attempts: lifter.attempts.map((attempt) =>
      attempt.id === attemptId
        ? {
            ...attempt,
            kilograms,
            status: 'good' as const,
            effort: 'solid' as const,
            missReason: null,
            lights: null,
          }
        : attempt,
    ),
  };
}

function withLifter(document: MeetDocument, lifter: LiveLifter): MeetDocument {
  return {
    ...document,
    lifters: document.lifters.map((candidate) => (candidate.id === lifter.id ? lifter : candidate)),
  };
}

// -----------------------------------------------------------------------------
// Targets
// -----------------------------------------------------------------------------

function progressTowards(
  document: MeetDocument,
  lifter: LiveLifter,
  target: LiveTarget,
  guaranteed: RunningTotal,
  projections: Readonly<Record<Exclude<ProjectionBasis, 'guaranteed'>, MeetProjection>>,
): TargetProgress {
  const banked = bankedTowards(document, lifter, target, guaranteed);
  const reached: Record<ProjectionBasis, boolean> = {
    guaranteed: reachesGuaranteed(target, banked, guaranteed),
    secure: reachesProjection(target, projections.secure),
    recommended: reachesProjection(target, projections.recommended),
    stretch: reachesProjection(target, projections.stretch),
  };

  const first = PROJECTION_BASES.find((basis) => reached[basis]) ?? null;

  return {
    target,
    guaranteedKilograms: banked,
    shortfallKilograms: Math.max(0, target.kilograms - banked),
    reachedByGuaranteed: reached.guaranteed,
    reachedBySecure: reached.secure,
    reachedByRecommended: reached.recommended,
    reachedByStretch: reached.stretch,
    firstBasisThatReaches: first,
  };
}

function bankedTowards(
  document: MeetDocument,
  lifter: LiveLifter,
  target: LiveTarget,
  guaranteed: RunningTotal,
): number {
  if (target.measure !== 'lift') return guaranteed.kilograms;
  const lift = liftFor(document, target);
  if (lift === null) return 0;
  return bestGoodLift(lifter, lift) ?? 0;
}

/**
 * Which lift a lift-measured target sits on.
 *
 * `null` when the target named no lift and the format contests more than one:
 * §13 lets a target leave the lift implicit because there is one lift in front of
 * the user, and there is no such lift here. Guessing the heaviest would report a
 * squat personal record as reached by a deadlift.
 */
function liftFor(document: MeetDocument, target: LiveTarget): PlatformLift | null {
  const lifts = liftsInFormat(document.format);
  if (target.lift != null) return lifts.includes(target.lift) ? target.lift : null;
  return lifts.length === 1 ? (lifts[0] ?? null) : null;
}

function reachesGuaranteed(target: LiveTarget, banked: number, guaranteed: RunningTotal): boolean {
  if (target.measure !== 'lift') {
    // A total target is reached by a total and not by a subtotal: a figure that
    // clears a qualifying number with a lift still to come has qualified for
    // nothing, because a bomb-out on that lift leaves no total at all.
    return guaranteed.isTotal && isAtLeast(guaranteed.kilograms, target.kilograms);
  }
  return isAtLeast(banked, target.kilograms);
}

function reachesProjection(target: LiveTarget, projection: MeetProjection): boolean {
  if (target.measure !== 'lift') {
    return projection.total.isTotal && isAtLeast(projection.total.kilograms, target.kilograms);
  }
  // A target that named no lift is only answerable in a single-lift contest. In a
  // full-power meet the first lift that clears it would be whichever one the format
  // happens to list first, which is an answer about the squat dressed up as an
  // answer about the target.
  const lift =
    target.lift == null
      ? projection.lifts.length === 1
        ? projection.lifts[0]
        : undefined
      : projection.lifts.find((candidate) => candidate.lift === target.lift);
  if (lift === undefined) return false;
  return isAtLeast(lift.contributionKilograms, target.kilograms);
}

// -----------------------------------------------------------------------------
// Advisories
// -----------------------------------------------------------------------------

function advisoriesFor(
  lifter: LiveLifter,
  lifts: readonly PlatformLift[],
  guaranteed: RunningTotal,
  projections: readonly MeetProjection[],
): readonly TotalsAdvisory[] {
  const advisories: TotalsAdvisory[] = [];
  const assumesSomething = projections.some((projection) => projection.attemptsAssumed > 0);

  if (assumesSomething) {
    advisories.push({
      code: 'projections-assume-every-attempt-is-made',
      severity: 'note',
      message:
        'The projected figures assume each attempt they name is made. They are arithmetic about a plan, not a prediction.',
    });
  } else {
    advisories.push({
      code: 'the-meet-is-over-for-this-lifter',
      severity: 'note',
      message: 'There are no attempts left to project. Every figure below is settled.',
    });
  }

  if (!guaranteed.isTotal) {
    advisories.push({
      code: 'no-total-yet',
      severity: 'note',
      message: `There is no total yet: ${listLifts(guaranteed.liftsOutstanding)} still ${guaranteed.liftsOutstanding.length === 1 ? 'needs' : 'need'} a good lift.`,
    });
  }

  const lastChance = lifts.filter((lift) => bombOutRisk(lifter, lift).onTheLastChance);
  if (lastChance.length > 0) {
    advisories.push({
      code: 'bomb-out-would-void-every-figure',
      severity: 'strong',
      message: `The last attempt on ${listLifts(lastChance)} decides whether there is a total at all. Every figure here goes to nothing without it.`,
    });
  }

  const unplanned = new Set<PlatformLift>();
  for (const projection of projections) {
    for (const lift of projection.lifts) {
      if (lift.withoutAPlan) unplanned.add(lift.lift);
    }
  }
  if (unplanned.size > 0) {
    advisories.push({
      code: 'projected-without-a-plan',
      severity: 'note',
      message: `No plan was entered for ${listLifts([...unplanned])}, so the projection followed the smallest legal increases instead.`,
    });
  }

  const incomplete = projections.filter((projection) => !projection.complete);
  if (incomplete.length > 0) {
    advisories.push({
      code: 'projection-is-incomplete',
      severity: 'note',
      message: `Some remaining attempts have no weight to assume, so ${incomplete.map((projection) => projection.basis).join(', ')} ${incomplete.length === 1 ? 'covers' : 'cover'} fewer attempts than are left.`,
    });
  }

  return advisories;
}

const LIFT_WORDS: Readonly<Record<PlatformLift, string>> = {
  squat: 'the squat',
  bench: 'the bench press',
  deadlift: 'the deadlift',
};

function listLifts(lifts: readonly PlatformLift[]): string {
  const words = lifts.map((lift) => LIFT_WORDS[lift]);
  if (words.length <= 1) return words[0] ?? 'nothing';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}
