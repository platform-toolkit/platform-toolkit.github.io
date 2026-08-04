// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21.2: the seven ways two of a coach's lifters get in each other's way.
 *
 * `coach-board.ts` ranks lifters one at a time, and a coach's real problem is
 * rarely one lifter. It is two clocks running at once, or one handler who has
 * been given the wrapping for both of the equipped lifters, or a final single
 * that lands while the other athlete is being called. None of that is visible
 * from a row, so it is not computed there.
 *
 * A CONFLICT IS A PAIR
 *
 * Every warning here names at least two lifters, which is why this is a second
 * projection over the same request rather than a field on a row. The result
 * carries {@link CoachBoardConflicts.byLifter} so that a view drawing forty rows
 * does not filter the whole list once per row, four times a second, to find the
 * two entries that mention it.
 *
 * The board is deliberately not an input. Passing it would save recomputing a
 * declaration clock and it would also let a caller hand over a board built from
 * a different instant, or from a document one action older, and get warnings
 * about a collision that had already been resolved. The two projections take the
 * same request and are true at the same moment or not at all.
 *
 * ONLY WHAT IS DUE CAN COLLIDE
 *
 * The same reading that makes §21's ladder work makes this work. Two schedules
 * that both contain knee wraps do not collide; two lifters whose wraps go on in
 * the next few minutes do. Everything below is filtered to what is due, so
 * {@link CoachBoardConflictRequest.proximitySeconds} does two jobs with one
 * number: it decides what is close enough to be the coach's problem now, and it
 * decides how close two demands have to be to count as §21.2's "nearly the same
 * time". Those are the same idea and giving them separate knobs would invite a
 * caller to set them so that a thing could be urgent and simultaneous with
 * nothing, or simultaneous with something that was not urgent.
 *
 * A lifter who has taken every competition attempt raises nothing, whatever is
 * still on their schedule. The board carries the same guard for the same reason:
 * a schedule outlives the lifting it was built for, and a stale ramp would have
 * this module warning about a bar that nobody is going to load.
 *
 * A SUGGESTED PRIORITY IS A CHOICE BETWEEN TWO NAMES
 *
 * §21.2 asks for a suggested priority and an explanation of why. The priority is
 * one lifter id -- who to go to first -- and the explanation is a code, in
 * keeping with the rest of this package: the sentence belongs to whichever
 * screen is showing it. Where there is no basis to prefer either lifter the
 * reason is `either-order` and it says so, rather than presenting the order two
 * names happened to be entered in as advice.
 *
 * A HANDLER IN TWO PLACES IS A CLASH ON ONE PLATFORM TOO
 *
 * §21.2 words this one as "simultaneous platforms", and the module does not
 * carry a platform. A handler who has to hand in two cards at the same moment is
 * stuck whether the two lifters are on one platform or two, and the coach's move
 * -- give one of them to somebody else -- is the same. Carrying a field that
 * changed nothing would only invite a screen to draw a distinction the warning
 * does not make.
 *
 * What does vary is the responsibility. Attempt submission, warm-up loading,
 * wrapping and escorting are all on a clock and two of them at once is a clash.
 * Food, hydration and video are not: a reminder given ten minutes late is a
 * reminder given, and a missed video is a missed video. A handler holding only
 * those never appears here.
 *
 * A PROPOSED CHANGE IS A QUESTION, NOT AN EDIT
 *
 * The last warning takes a weight that has not been entered and answers what it
 * would do to the running order. Nothing is applied, and legality is not
 * checked -- `meet-rules.ts` refuses an illegal weight when it is actually
 * declared, and refusing to answer "what would this do" would make the screen
 * that asks it useless for exactly the weights worth asking about.
 *
 * Lifting order within a round is by weight ascending, and this tool has never
 * been told a lot number. Two lifters declaring the same weight are left in the
 * document's order, which is a guess -- the meet breaks that tie by lot and the
 * warning says nothing about which of the two moved.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import {
  DEFAULT_ATTENTION_LEAD_SECONDS,
  type CoachBoardEntry,
  type HandlerResponsibility,
  type PlatformCall,
  type WarmupTimeline,
} from './coach-board.js';
import {
  attemptsOn,
  isResolved,
  liftsInFormat,
  submissionState,
  type LiveLifter,
  type MeetDocument,
  type SubmissionState,
} from './meet-document.js';
import type { ScheduledItem } from './meet-warmup.js';
import type { MeetRules } from './meet-rules.js';

/**
 * How long it takes to get a weight to the table and come back.
 *
 * A round figure of the same standing as the attention lead: half a minute is a
 * walk to the expeditor, a card, and a walk back. Two declaration clocks that
 * expire further apart than this are two errands; two that expire closer
 * together are one errand that cannot be run twice.
 */
export const DEFAULT_HANDOVER_SECONDS = 30;

/** §21.2's seven warnings, most pressing first. */
export const COACH_BOARD_CONFLICTS = [
  /** Two declaration clocks run out too close together to answer both. */
  'submission-deadlines-overlap',
  /** Two lifters are at the platform, or due there, at once. */
  'called-at-the-same-time',
  /** One handler is wanted by two lifters at the same moment. */
  'handler-in-two-places',
  /** Two lifters need wrapping or equipment help at once. */
  'wrapping-at-the-same-time',
  /** Two lifters want the same bar at different weights. */
  'shared-rack-loading-clash',
  /** A final warm-up lands during another lifter's attempt. */
  'warm-up-during-another-attempt',
  /** A weight that has not been declared yet would move the running order. */
  'change-moves-the-order',
] as const satisfies readonly string[];

export type CoachBoardConflictCode = (typeof COACH_BOARD_CONFLICTS)[number];

function conflictRank(code: CoachBoardConflictCode): number {
  return COACH_BOARD_CONFLICTS.indexOf(code);
}

/** Why the suggested lifter is the one to go to first. */
export type ConflictPriorityReason =
  /** Their clock runs out first, and the rulebook enforces that one. */
  | 'sooner-deadline'
  /** They have been called, or called earlier. The platform does not wait. */
  | 'already-called'
  /**
   * Their moment comes first, whatever kind of moment it is -- a bar to be
   * loaded, wraps to go on, a card to be handed in. Serving them first is the
   * order that costs the other lifter the least.
   */
  | 'needed-sooner'
  /** Their moment cannot be moved and the other lifter's can. */
  | 'fixed-versus-movable'
  /** Nothing here separates them. The coach picks, and the tool says as much. */
  | 'either-order';

export interface ConflictPriority {
  /**
   * Who to go to first.
   *
   * Set even when the reason is `either-order`, because a screen has to draw
   * something -- but in that case it is the lifter who appears first in the meet
   * document, and the reason is there to stop a view presenting that as advice.
   */
  readonly lifterId: string;
  readonly reason: ConflictPriorityReason;
}

export interface CoachBoardConflict {
  readonly code: CoachBoardConflictCode;
  /** Everyone caught in it, in the document's order. Never fewer than two. */
  readonly lifterIds: readonly string[];
  readonly priority: ConflictPriority;
  /**
   * Seconds between the two demands, or `null` when there is no gap to measure.
   *
   * Never negative: which of the two is earlier is what `priority` says, and a
   * signed figure here would have a screen deciding whose subtraction it was.
   */
  readonly separationSeconds: number | null;
  /** The handler both lifters are relying on, or `null`. */
  readonly handlerName: string | null;
}

/**
 * A weight a coach is considering, before anything is entered.
 *
 * `kilograms` may be `null`, which asks what clearing the declaration would do
 * -- an undeclared weight has no place in the running order, so the answer is
 * usually that the lifter drops out of it and everyone behind them moves up.
 */
export interface ProposedAttemptChange {
  readonly lifterId: string;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  readonly kilograms: number | null;
}

export interface CoachBoardConflictRequest {
  readonly rules: MeetRules;
  readonly document: MeetDocument;
  /** Per-lifter context, in any order. Same array the board is given. */
  readonly entries?: readonly CoachBoardEntry[] | undefined;
  readonly now: number;
  /** What counts as due, and as "nearly the same time". See the module header. */
  readonly proximitySeconds?: number | undefined;
  readonly handoverSeconds?: number | undefined;
  readonly proposedChange?: ProposedAttemptChange | null | undefined;
}

export interface CoachBoardConflicts {
  /** Most pressing first. */
  readonly conflicts: readonly CoachBoardConflict[];
  /** Every conflict a lifter is named in, keyed by lifter id, in the same order. */
  readonly byLifter: ReadonlyMap<string, readonly CoachBoardConflict[]>;
}

const EMPTY_ENTRY: CoachBoardEntry = { lifterId: '' };

/** Which responsibility, if any, puts a handler on the hook for a kind of demand. */
const RESPONSIBILITY_BY_ITEM: Readonly<Record<ScheduledItem['kind'], HandlerResponsibility>> = {
  equipment: 'wrapping-or-equipment',
  'warm-up-set': 'warm-up-loading',
  platform: 'platform-escort',
};

/** Furthest along first. */
const CALL_ORDER: Readonly<Record<PlatformCall, number>> = {
  called: 0,
  'on-deck': 1,
  'in-the-hole': 2,
};

/** A scheduled item, aged against the instant its schedule was counted from. */
interface DueWindow {
  readonly item: ScheduledItem;
  /** Earliest start, from now. Negative once that moment has passed. */
  readonly startsInSeconds: number;
  /** Latest finish, from now. Always above zero: an item past it is dropped. */
  readonly endsInSeconds: number;
  /** The bar weight for a warm-up set, or `null` for anything else. */
  readonly kilograms: number | null;
  /** Whether this is the last single before the platform. */
  readonly isFinalWarmup: boolean;
}

/** Something that wants the coach, or a handler, at a particular moment. */
interface Demand {
  readonly responsibility: HandlerResponsibility;
  readonly startsInSeconds: number;
  readonly endsInSeconds: number;
}

interface Standing {
  readonly lifter: LiveLifter;
  readonly entry: CoachBoardEntry;
  /** Live, unanswered and not yet lapsed, or `null`. */
  readonly submission: SubmissionState | null;
  readonly call: PlatformCall | null;
  readonly due: readonly DueWindow[];
  readonly demands: readonly Demand[];
  readonly rackId: string | null;
}

/**
 * Whether anything is still ahead of this lifter.
 *
 * A finished lifter's warm-up schedule does not disappear, and neither does the
 * entry carrying it, so without this a coach whose athlete deadlifted an hour
 * ago would still be warned that their bar clashes with somebody else's.
 */
function stillLifting(document: MeetDocument, lifter: LiveLifter): boolean {
  for (const lift of liftsInFormat(document.format)) {
    for (const attempt of attemptsOn(lifter, lift)) {
      if (attempt.kind === 'competition' && !isResolved(attempt)) return true;
    }
  }
  return false;
}

/** Everything on the schedule that has not gone past, aged and priced. */
function dueWindows(timeline: WarmupTimeline, now: number): DueWindow[] {
  const elapsedSeconds = (now - timeline.builtAt) / 1000;
  const finalIndex = timeline.schedule.plan.warmups.length - 1;
  const windows: DueWindow[] = [];
  for (const item of timeline.schedule.items) {
    const endsInSeconds = item.startsInSeconds.latestSeconds + item.seconds - elapsedSeconds;
    if (endsInSeconds <= 0) continue;
    const set =
      item.warmupIndex === null ? undefined : timeline.schedule.plan.warmups[item.warmupIndex];
    windows.push({
      item,
      startsInSeconds: item.startsInSeconds.earliestSeconds - elapsedSeconds,
      endsInSeconds,
      kilograms: set?.loading.total ?? null,
      isFinalWarmup: item.kind === 'warm-up-set' && item.warmupIndex === finalIndex,
    });
  }
  return windows;
}

function standingsOf(request: CoachBoardConflictRequest, proximitySeconds: number): Standing[] {
  const { rules, document, now } = request;
  const byLifter = new Map<string, CoachBoardEntry>();
  for (const entry of request.entries ?? []) byLifter.set(entry.lifterId, entry);

  return document.lifters.map((lifter) => {
    const entry = byLifter.get(lifter.id) ?? EMPTY_ENTRY;
    const lifting = stillLifting(document, lifter);
    const state = submissionState(rules, document, lifter, now);
    // A lapsed clock is not a conflict. The automatic weight stands (§13), and
    // warning a coach to hurry to a table they can no longer help at would put
    // the loudest thing on the board on the one lifter nothing can be done for.
    const submission = state !== null && !state.submitted && !state.lapsed ? state : null;
    const call = lifting ? (entry.platformCall ?? null) : null;
    const timeline = lifting ? (entry.warmup ?? null) : null;
    const due = timeline === null ? [] : dueWindows(timeline, now);

    const demands: Demand[] = [];
    if (submission !== null) {
      demands.push({
        responsibility: 'attempt-submission',
        startsInSeconds: 0,
        endsInSeconds: submission.secondsRemaining,
      });
    }
    if (call !== null) {
      demands.push({ responsibility: 'platform-escort', startsInSeconds: 0, endsInSeconds: 0 });
    }
    for (const window of due) {
      if (window.startsInSeconds > proximitySeconds) continue;
      demands.push({
        responsibility: RESPONSIBILITY_BY_ITEM[window.item.kind],
        startsInSeconds: window.startsInSeconds,
        endsInSeconds: window.endsInSeconds,
      });
    }

    const rackId = (entry.rackId ?? '').trim();
    return {
      lifter,
      entry,
      submission,
      call,
      due,
      demands,
      rackId: rackId === '' ? null : rackId,
    } satisfies Standing;
  });
}

/** The first thing of a kind that is due, or `null`. */
function dueOfKind(
  standing: Standing,
  kind: ScheduledItem['kind'],
  proximitySeconds: number,
): DueWindow | null {
  for (const window of standing.due) {
    if (window.item.kind !== kind) continue;
    if (window.startsInSeconds > proximitySeconds) continue;
    return window;
  }
  return null;
}

/** Two moments are at once when they overlap, or when they start close enough together. */
function atOnce(
  left: { startsInSeconds: number; endsInSeconds: number },
  right: { startsInSeconds: number; endsInSeconds: number },
  proximitySeconds: number,
): boolean {
  if (Math.abs(left.startsInSeconds - right.startsInSeconds) <= proximitySeconds) return true;
  return left.startsInSeconds <= right.endsInSeconds && right.startsInSeconds <= left.endsInSeconds;
}

/** Whoever is on the smaller figure, or neither when the two are equal. */
function whicheverIsSooner(
  left: Standing,
  right: Standing,
  leftSeconds: number,
  rightSeconds: number,
  reason: ConflictPriorityReason,
): ConflictPriority {
  if (leftSeconds === rightSeconds) return { lifterId: left.lifter.id, reason: 'either-order' };
  return { lifterId: leftSeconds < rightSeconds ? left.lifter.id : right.lifter.id, reason };
}

function separation(left: number, right: number): number {
  // Floored, in keeping with §5.5: the warning reports the two demands as closer
  // together than they are rather than further apart, so a coach is never told
  // they have a minute of daylight that turns out to be fifty-one seconds.
  return Math.floor(Math.abs(left - right));
}

function pairIds(left: Standing, right: Standing): readonly string[] {
  return [left.lifter.id, right.lifter.id];
}

/** Two clocks that cannot both be answered. */
function submissionOverlap(
  left: Standing,
  right: Standing,
  handoverSeconds: number,
): CoachBoardConflict | null {
  const a = left.submission;
  const b = right.submission;
  if (a === null || b === null) return null;
  const gap = separation(a.secondsRemaining, b.secondsRemaining);
  if (gap > handoverSeconds) return null;
  return {
    code: 'submission-deadlines-overlap',
    lifterIds: pairIds(left, right),
    priority: whicheverIsSooner(
      left,
      right,
      a.secondsRemaining,
      b.secondsRemaining,
      'sooner-deadline',
    ),
    separationSeconds: gap,
    handlerName: null,
  };
}

interface PlatformMoment {
  readonly startsInSeconds: number;
  readonly endsInSeconds: number;
  /** Set when the moment is an announcement rather than an estimate. */
  readonly call: PlatformCall | null;
}

/**
 * When this lifter is due at the bar, announced or estimated.
 *
 * A call is a moment now, with no width: it has been said out loud and the
 * schedule that predicted it is no longer the better source. This is the one
 * place the two are interchangeable, and only because the question -- are these
 * two going to be at the platform together -- has the same answer either way.
 */
function platformMoment(standing: Standing, proximitySeconds: number): PlatformMoment | null {
  if (standing.call !== null) {
    return { startsInSeconds: 0, endsInSeconds: 0, call: standing.call };
  }
  const due = dueOfKind(standing, 'platform', proximitySeconds);
  if (due === null) return null;
  return { startsInSeconds: due.startsInSeconds, endsInSeconds: due.endsInSeconds, call: null };
}

/** Two lifters at the platform, or heading there together. */
function platformOverlap(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
): CoachBoardConflict | null {
  const a = platformMoment(left, proximitySeconds);
  const b = platformMoment(right, proximitySeconds);
  if (a === null || b === null) return null;
  if (!atOnce(a, b, proximitySeconds)) return null;

  const gap = separation(a.startsInSeconds, b.startsInSeconds);
  const shared = {
    code: 'called-at-the-same-time',
    lifterIds: pairIds(left, right),
    handlerName: null,
  } as const;

  // Both announced: rank by how far along each one is, and report no gap. The
  // tool is not watching the flight closely enough to say how many seconds sit
  // between a lifter on deck and a lifter in the hole, and a figure invented
  // from the pace estimate would read as though it were.
  if (a.call !== null && b.call !== null) {
    return {
      ...shared,
      priority: whicheverIsSooner(
        left,
        right,
        CALL_ORDER[a.call],
        CALL_ORDER[b.call],
        'already-called',
      ),
      separationSeconds: null,
    };
  }
  // One announced and one estimated. The announcement is the fact.
  if (a.call !== null || b.call !== null) {
    return {
      ...shared,
      priority: {
        lifterId: a.call !== null ? left.lifter.id : right.lifter.id,
        reason: 'already-called',
      },
      separationSeconds: gap,
    };
  }
  return {
    ...shared,
    priority: whicheverIsSooner(left, right, a.startsInSeconds, b.startsInSeconds, 'needed-sooner'),
    separationSeconds: gap,
  };
}

function covers(responsibilities: readonly HandlerResponsibility[], wanted: HandlerResponsibility) {
  return responsibilities.includes(wanted) || responsibilities.includes('general');
}

/**
 * The closest pair of demands one shared handler is wanted for.
 *
 * One conflict per pair of lifters per handler, reported at the tightest gap
 * found: a handler wanted for a warm-up and a card at nearly the same time is
 * one person with one problem, and splitting it into a warning per errand would
 * bury the pair that matters under the pair that happens to be listed first.
 */
function handlerClash(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
): CoachBoardConflict[] {
  const conflicts: CoachBoardConflict[] = [];
  // One warning per person, not per row of a list somebody typed twice. Matched
  // without regard to case, because the same handler entered as "Sam" against one
  // lifter and "sam" against another is one person who can still only be in one
  // place, and the name reported back is the one on this lifter's entry.
  const seen = new Set<string>();
  for (const handler of left.entry.handlers ?? []) {
    const name = handler.name.trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    const match = (right.entry.handlers ?? []).find(
      (other) => other.name.trim().toLowerCase() === key,
    );
    if (match === undefined) continue;

    let tightest: { gap: number; a: Demand; b: Demand } | null = null;
    for (const a of left.demands) {
      if (!covers(handler.responsibilities, a.responsibility)) continue;
      for (const b of right.demands) {
        if (!covers(match.responsibilities, b.responsibility)) continue;
        if (!atOnce(a, b, proximitySeconds)) continue;
        const gap = separation(a.startsInSeconds, b.startsInSeconds);
        if (tightest === null || gap < tightest.gap) tightest = { gap, a, b };
      }
    }
    if (tightest === null) continue;

    conflicts.push({
      code: 'handler-in-two-places',
      lifterIds: pairIds(left, right),
      priority: whicheverIsSooner(
        left,
        right,
        tightest.a.startsInSeconds,
        tightest.b.startsInSeconds,
        'needed-sooner',
      ),
      separationSeconds: tightest.gap,
      handlerName: name,
    });
  }
  return conflicts;
}

/** Two lifters who both need a hand getting into kit. */
function wrappingClash(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
): CoachBoardConflict | null {
  const a = dueOfKind(left, 'equipment', proximitySeconds);
  const b = dueOfKind(right, 'equipment', proximitySeconds);
  if (a === null || b === null) return null;
  if (!atOnce(a, b, proximitySeconds)) return null;
  return {
    code: 'wrapping-at-the-same-time',
    lifterIds: pairIds(left, right),
    priority: whicheverIsSooner(left, right, a.startsInSeconds, b.startsInSeconds, 'needed-sooner'),
    separationSeconds: separation(a.startsInSeconds, b.startsInSeconds),
    handlerName: null,
  };
}

/**
 * One bar, two lifters, two weights.
 *
 * Equal weights are not a clash. Two lifters taking the same single off the same
 * bar is the arrangement working, and §21.4's whole point is that plates only
 * have to move when the weights differ.
 */
function rackClash(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
): CoachBoardConflict | null {
  if (left.rackId === null || left.rackId !== right.rackId) return null;
  const a = dueOfKind(left, 'warm-up-set', proximitySeconds);
  const b = dueOfKind(right, 'warm-up-set', proximitySeconds);
  if (a === null || b === null) return null;
  if (a.kilograms === null || b.kilograms === null || a.kilograms === b.kilograms) return null;
  if (!atOnce(a, b, proximitySeconds)) return null;

  // Whoever is on the platform first gets the bar first: their warm-up is the one
  // with nowhere to move to. When neither is due out yet there is nothing here to
  // choose between them and §21.4's sequencing, not this warning, is the answer.
  const platformLeft = dueOfKind(left, 'platform', Number.POSITIVE_INFINITY);
  const platformRight = dueOfKind(right, 'platform', Number.POSITIVE_INFINITY);
  const priority =
    platformLeft === null || platformRight === null
      ? ({ lifterId: left.lifter.id, reason: 'either-order' } satisfies ConflictPriority)
      : whicheverIsSooner(
          left,
          right,
          platformLeft.startsInSeconds,
          platformRight.startsInSeconds,
          'needed-sooner',
        );

  return {
    code: 'shared-rack-loading-clash',
    lifterIds: pairIds(left, right),
    priority,
    separationSeconds: separation(a.startsInSeconds, b.startsInSeconds),
    handlerName: null,
  };
}

/**
 * A last single that lands while the other lifter is on the platform.
 *
 * Checked both ways round, because the pair is unordered and only one of the two
 * is holding the fixed appointment. The priority is always the lifter on the
 * platform: an attempt happens when the expeditor says it happens, and a warm-up
 * can be taken a minute later at the cost of a minute.
 */
function warmupDuringAttempt(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
): CoachBoardConflict | null {
  const clash =
    oneWayWarmupClash(left, right, proximitySeconds) ??
    oneWayWarmupClash(right, left, proximitySeconds);
  if (clash === null) return null;
  return {
    code: 'warm-up-during-another-attempt',
    // Built here rather than inside the one-way check so that the pair reads in
    // the document's order whichever way round the clash was found.
    lifterIds: pairIds(left, right),
    priority: { lifterId: clash.liftingId, reason: 'fixed-versus-movable' },
    separationSeconds: clash.gap,
    handlerName: null,
  };
}

function oneWayWarmupClash(
  warmingUp: Standing,
  lifting: Standing,
  proximitySeconds: number,
): { liftingId: string; gap: number } | null {
  const single = warmingUp.due.find(
    (window) => window.isFinalWarmup && window.startsInSeconds <= proximitySeconds,
  );
  if (single === undefined) return null;
  const platform = platformMoment(lifting, proximitySeconds);
  if (platform === null) return null;
  if (!atOnce(single, platform, proximitySeconds)) return null;
  return {
    liftingId: lifting.lifter.id,
    gap: separation(single.startsInSeconds, platform.startsInSeconds),
  };
}

interface OrderPlace {
  readonly lifterId: string;
  readonly kilograms: number | null;
  readonly position: number;
}

/**
 * Who lifts in what order in one round, lightest bar first.
 *
 * An undeclared weight goes last rather than first. It is not a light attempt,
 * it is an attempt with no place in the order yet, and sorting it to the front
 * would have the tool announce a lifter as opening the round on the strength of
 * a blank field.
 */
function roundOrder(
  document: MeetDocument,
  lift: PlatformLift,
  attemptNumber: number,
  override: ProposedAttemptChange | null,
): readonly OrderPlace[] {
  const places: OrderPlace[] = [];
  for (const [position, lifter] of document.lifters.entries()) {
    const attempt = attemptsOn(lifter, lift).find(
      (candidate) =>
        candidate.kind === 'competition' &&
        candidate.attemptNumber === attemptNumber &&
        !isResolved(candidate),
    );
    if (attempt === undefined) continue;
    const kilograms =
      override !== null && override.lifterId === lifter.id ? override.kilograms : attempt.kilograms;
    places.push({ lifterId: lifter.id, kilograms, position });
  }
  return places.sort((a, b) => {
    if (a.kilograms === b.kilograms) return a.position - b.position;
    if (a.kilograms === null) return 1;
    if (b.kilograms === null) return -1;
    return a.kilograms - b.kilograms;
  });
}

/**
 * What a weight nobody has entered yet would do to the running order.
 *
 * Only the changing lifter's position is checked, and that is enough: everyone
 * else keeps their place relative to each other whatever this one weight does,
 * so if this lifter has not moved then nobody has.
 */
function orderChange(
  document: MeetDocument,
  change: ProposedAttemptChange,
): CoachBoardConflict | null {
  const before = roundOrder(document, change.lift, change.attemptNumber, null);
  const after = roundOrder(document, change.lift, change.attemptNumber, change);
  const from = before.findIndex((place) => place.lifterId === change.lifterId);
  const to = after.findIndex((place) => place.lifterId === change.lifterId);
  if (from === -1 || to === -1 || from === to) return null;

  const crossed = new Set<string>();
  const [low, high] = from < to ? [from, to] : [to, from];
  for (let index = low; index <= high; index += 1) {
    const wasThere = before[index];
    const isThere = after[index];
    if (wasThere !== undefined) crossed.add(wasThere.lifterId);
    if (isThere !== undefined) crossed.add(isThere.lifterId);
  }

  const inDocumentOrder = document.lifters
    .filter((lifter) => crossed.has(lifter.id))
    .map((lifter) => lifter.id);
  const first = after.find((place) => crossed.has(place.lifterId));
  return {
    code: 'change-moves-the-order',
    lifterIds: inDocumentOrder,
    priority: {
      lifterId: first?.lifterId ?? change.lifterId,
      reason: 'needed-sooner',
    },
    separationSeconds: null,
    handlerName: null,
  };
}

function between(
  left: Standing,
  right: Standing,
  proximitySeconds: number,
  handoverSeconds: number,
): CoachBoardConflict[] {
  const found: CoachBoardConflict[] = [];
  const push = (conflict: CoachBoardConflict | null): void => {
    if (conflict !== null) found.push(conflict);
  };
  push(submissionOverlap(left, right, handoverSeconds));
  push(platformOverlap(left, right, proximitySeconds));
  found.push(...handlerClash(left, right, proximitySeconds));
  push(wrappingClash(left, right, proximitySeconds));
  push(rackClash(left, right, proximitySeconds));
  push(warmupDuringAttempt(left, right, proximitySeconds));
  return found;
}

/**
 * Every way this coach's lifters are about to get in each other's way.
 *
 * Total, like the board: a document with nobody in it, or with nobody colliding,
 * produces an empty result rather than an error. Every pair of lifters is
 * considered, which is quadratic and is fine -- a coach handling forty athletes
 * is not a coach, and eight hundred pairs of a handful of comparisons is less
 * work than one of the warm-up ramps this module reads.
 */
export function coachBoardConflicts(request: CoachBoardConflictRequest): CoachBoardConflicts {
  const proximitySeconds = Math.max(0, request.proximitySeconds ?? DEFAULT_ATTENTION_LEAD_SECONDS);
  const handoverSeconds = Math.max(0, request.handoverSeconds ?? DEFAULT_HANDOVER_SECONDS);
  const standings = standingsOf(request, proximitySeconds);

  const found: CoachBoardConflict[] = [];
  for (const [index, left] of standings.entries()) {
    for (const right of standings.slice(index + 1)) {
      found.push(...between(left, right, proximitySeconds, handoverSeconds));
    }
  }

  const change = request.proposedChange ?? null;
  if (change !== null) {
    const moved = orderChange(request.document, change);
    if (moved !== null) found.push(moved);
  }

  // Kind first, then how little room there is, which is the board's rule with
  // one deliberate difference: a missing figure sorts first here rather than
  // last. On the board `null` seconds means nothing about this lifter is timed,
  // and that is the least urgent thing there is. Here it means the two demands
  // are simultaneous and there is no gap to measure, which is the most.
  const conflicts = found.sort((a, b) => {
    const byCode = conflictRank(a.code) - conflictRank(b.code);
    if (byCode !== 0) return byCode;
    if (a.separationSeconds === b.separationSeconds) return 0;
    if (a.separationSeconds === null) return -1;
    if (b.separationSeconds === null) return 1;
    return a.separationSeconds - b.separationSeconds;
  });

  const byLifter = new Map<string, CoachBoardConflict[]>();
  for (const conflict of conflicts) {
    for (const lifterId of conflict.lifterIds) {
      const existing = byLifter.get(lifterId);
      if (existing === undefined) byLifter.set(lifterId, [conflict]);
      else existing.push(conflict);
    }
  }

  return { conflicts, byLifter };
}
