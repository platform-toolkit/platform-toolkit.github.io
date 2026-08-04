// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21: who needs me next, and what do I need to do?
 *
 * A coach handling four lifters across two platforms is reading one screen
 * between attempts, one-handed, and the only question that screen has to answer
 * is which name to tap. Everything else on a coach board is there to justify the
 * order. So this module produces an order, and a row that says why it is where
 * it is.
 *
 * IT IS A PROJECTION, AND IT HOLDS NOTHING
 *
 * `meet-document.ts` says the coach board is a projection of the lifters array,
 * and this is that projection. Nothing here is stored, nothing is cached, and
 * every figure is recomputed from the document and the instant. That is what
 * makes undo total: a mis-tapped No Lift restores the document and the board
 * re-derives, rather than leaving last round's ranking on screen while somebody
 * walks to the expeditor's table.
 *
 * THE LADDER RANKS WHAT IS DUE, NOT WHAT EXISTS
 *
 * §21's seven levels read as a list of kinds, and taken literally as kinds they
 * invert: equipment prep is third and the final warm-up is fourth, so a lifter
 * with a squat suit to get into in forty minutes would outrank a lifter whose
 * last single is three minutes away. Every lifter has equipment prep somewhere
 * ahead of them, so every lifter would sit at level three all day and the board
 * would rank nothing.
 *
 * The reading that works is that a level applies when its thing is **due** --
 * within {@link DEFAULT_ATTENTION_LEAD_SECONDS} of starting, or already started
 * -- and the ladder is the tie-break among the things that are. A lifter with
 * nothing due is at level six or seven whatever is on their schedule. Time then
 * breaks ties inside a level, so two lifters both wrapping are ordered by who is
 * late first.
 *
 * COLOUR CANNOT BE THE ONLY CUE, AND THAT IS STRUCTURAL
 *
 * §21 says colour must not be the only identity cue. That is not enforced by a
 * rule here, it is enforced by the shape: {@link CoachBoardRow.identifier} is a
 * non-empty string on every row -- normalised, and filled from the lifter's
 * position when the caller left it blank -- while `colour` is nullable. There is
 * no representable row carrying a colour and nothing else, so a view cannot
 * produce one by forgetting.
 *
 * WHAT THE CALLER HAS TO SUPPLY, AND WHY IT IS NOT IN THE DOCUMENT
 *
 * A bib number, a colour, a handler's name, a pin, and whether the lifter has
 * been called are all facts about a room this application cannot see (§15), or
 * facts about this device rather than about the meet. Putting them in
 * `MeetDocument` would make them undoable and replayable, which is wrong for a
 * pin and actively misleading for a call: undoing a result would take a lifter
 * off deck. They arrive per render, as {@link CoachBoardEntry}.
 *
 * The warm-up schedule arrives with the instant it was counted from, because
 * `meet-warmup.ts` measures in seconds from now and "now" was some earlier
 * paint. Ageing it here is the only reason `now` is load-bearing on levels three
 * to six, and a schedule handed over without its instant would rank a warm-up
 * that finished twenty minutes ago as the thing due next.
 *
 * A PIN IS NOT A RANK
 *
 * §21.1 asks for pinned lifters, and pinning does not move a row. A coach who
 * pins their three athletes out of a session of forty wants the other
 * thirty-seven out of the way, not their own three reordered by something other
 * than urgency -- and {@link CoachBoard.focusLifterId}, which is §21.1's
 * automatic return to the highest-priority action, would otherwise return to
 * whoever was pinned rather than to whoever needs the coach. The flag is carried
 * so a view can filter on it, and the order is the honest one either way.
 *
 * CONFLICTS ARE NOT HERE
 *
 * §21 lists conflict warnings among a row's fields and §21.2 defines them across
 * *pairs* of lifters. A per-row function cannot see a pair, so they live in
 * their own module keyed by lifter id, and a view merges the two. Folding them
 * in here would mean building the board twice: once to know where everyone is,
 * and again to say where they collide.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import {
  attemptsOn,
  findAttempt,
  isResolved,
  liftsInFormat,
  submissionState,
  totalSoFar,
  type AttemptKind,
  type AttemptStatus,
  type LiveLifter,
  type MeetDocument,
  type RunningTotal,
  type SubmissionState,
} from './meet-document.js';
import type { MeetRules } from './meet-rules.js';
import { nextWindow, type TimelineWindow, type WarmupTimeline } from './warmup-timeline.js';

/**
 * How far ahead of a start time something counts as needing the coach now.
 *
 * A round figure rather than a measurement, the same standing as
 * `DEFAULT_SET_SECONDS`: three minutes is roughly how long it takes to cross a
 * warm-up room, find the lifter, and get a bar loaded. Deliberately not zero --
 * a board that only raises a warm-up at the moment it should already have begun
 * is a board that is always three minutes late.
 */
export const DEFAULT_ATTENTION_LEAD_SECONDS = 3 * 60;

/**
 * §21's seven levels, most urgent first.
 *
 * Exported as the array rather than as a rank table so that the order has one
 * source: a view grouping the board into sections and the sort below cannot
 * disagree about which of two levels comes first.
 */
export const URGENCY_LADDER = [
  /** A declaration clock is running and the weight is not with the table yet. */
  'submission-deadline',
  /** Called, on deck, or in the hole. */
  'called-or-on-deck',
  /** Wrapping or equipment is due to go on. */
  'equipment-or-wrapping',
  /** The last single before the platform is due. */
  'final-warm-up',
  /** An earlier warm-up set is due. */
  'other-warm-ups',
  /** Something is ahead of this lifter and none of it is due yet. */
  'upcoming-flight',
  /** Nothing on this lifter is timed. */
  'non-urgent-preparation',
] as const satisfies readonly string[];

export type CoachBoardUrgency = (typeof URGENCY_LADDER)[number];

function urgencyRank(urgency: CoachBoardUrgency): number {
  return URGENCY_LADDER.indexOf(urgency);
}

/**
 * Where the lifter stands relative to the bar, as announced.
 *
 * Supplied rather than derived, and there is no fourth case for "lifting": the
 * application does not know when the bar leaves the rack, and a state it cannot
 * leave is worse than one it never enters.
 */
export type PlatformCall = 'called' | 'on-deck' | 'in-the-hole';

/** §21.3's list of what a handler can be asked to cover. */
export type HandlerResponsibility =
  | 'attempt-submission'
  | 'warm-up-loading'
  | 'wrapping-or-equipment'
  | 'platform-escort'
  | 'food-or-hydration'
  | 'video'
  | 'general';

/**
 * A person, on this device only.
 *
 * §21.3 says outright that this does not require user accounts in the first
 * release, and the name is typed by whoever is holding the phone. Same privacy
 * boundary as a lifter's name and an attempt note: never logged, never in an
 * error payload, never sent to an embedding page.
 */
export interface HandlerAssignment {
  readonly name: string;
  readonly responsibilities: readonly HandlerResponsibility[];
}

/** What this device knows about a lifter that the meet document does not. */
export interface CoachBoardEntry {
  readonly lifterId: string;
  /**
   * A short cue that is not a colour -- a bib number, a squad, a nickname.
   *
   * Trimmed, and replaced with the lifter's position on the board when it is
   * blank. See the module header: a row without one is not representable.
   */
  readonly identifier?: string | undefined;
  /** A CSS colour, or `null`. Always an addition to the identifier, never a substitute. */
  readonly colour?: string | null | undefined;
  readonly platformCall?: PlatformCall | null | undefined;
  readonly warmup?: WarmupTimeline | null | undefined;
  readonly handlers?: readonly HandlerAssignment[] | undefined;
  /**
   * Which warm-up bar this lifter is on, when the room has more than one.
   *
   * Nothing on the board reads it. It is here because §21.2 cannot see a loading
   * clash without knowing who is queueing for the same bar, and §21.4 cannot
   * sequence one -- and a caller assembling a second array in parallel with this
   * one, keyed by the same ids, is a way to get them out of step.
   */
  readonly rackId?: string | undefined;
  readonly pinned?: boolean | undefined;
}

export interface CoachBoardRequest {
  readonly rules: MeetRules;
  readonly document: MeetDocument;
  /**
   * Per-lifter context, in any order.
   *
   * A lifter with no entry still gets a row, because a board that dropped a
   * lifter for want of a bib number would hide the one athlete nobody had got
   * round to setting up. An entry naming a lifter who is not in the meet is
   * ignored rather than refused.
   */
  readonly entries?: readonly CoachBoardEntry[] | undefined;
  readonly now: number;
  readonly attentionLeadSeconds?: number | undefined;
}

/** The attempt the coach is working towards. */
export interface CurrentAttempt {
  readonly attemptId: string;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  readonly kind: AttemptKind;
  readonly status: AttemptStatus;
  /** §21's "proposed next attempt". `null` until a weight is chosen. */
  readonly proposedKilograms: number | null;
}

/**
 * The one thing to do about this lifter, as a code.
 *
 * A code rather than a sentence, because the sentence belongs to whichever
 * screen is showing it -- the meet-day tool's `copy.ts` renders these beside
 * the refusal codes it already renders, and a board embedded elsewhere is free
 * to say it differently.
 */
export type CoachBoardActionCode =
  /** No weight is on the next attempt and something is waiting for one. */
  | 'declare-the-next-attempt'
  /** A weight is chosen and the table has not been given it. */
  | 'hand-the-weight-to-the-table'
  | 'get-to-the-platform'
  | 'start-equipment-or-wrapping'
  | 'take-the-final-warm-up'
  | 'start-the-warm-up'
  /** Something is ahead and none of it is due. */
  | 'wait-for-the-flight'
  | 'nothing-time-bound';

/**
 * §21's "time or attempts remaining", kept as the two separate facts it is.
 *
 * A single field would have to choose, and the choice is wrong in both
 * directions: a lifter with forty seconds on the clock and one attempt left is
 * not described by either number alone, and the board would report whichever
 * one the last branch happened to pick.
 */
export interface CoachBoardRemaining {
  /**
   * Seconds until the next action, or `null` when nothing about this lifter is
   * timed. Negative when the moment has passed, which is the information.
   *
   * Rounded down, so the board never reports more time than there is (§5.5).
   */
  readonly seconds: number | null;
  /** Competition attempts left on the current lift. */
  readonly attemptsOnThisLift: number;
  /** Competition attempts left across every lift this format is scored on. */
  readonly attemptsInTheMeet: number;
}

export interface CoachBoardRow {
  readonly lifterId: string;
  readonly name: string;
  /** Never blank. See the module header. */
  readonly identifier: string;
  readonly colour: string | null;
  readonly urgency: CoachBoardUrgency;
  /** 1-based position on the board, after sorting. */
  readonly rank: number;
  readonly pinned: boolean;
  readonly platformCall: PlatformCall | null;
  /** `null` once every competition attempt has been taken. */
  readonly current: CurrentAttempt | null;
  readonly nextAction: CoachBoardActionCode;
  readonly remaining: CoachBoardRemaining;
  /** The declaration clock, or `null` when none is running. */
  readonly submission: SubmissionState | null;
  /**
   * What is banked, and whether it is yet a total (§17).
   *
   * Banked only. A projected total depends on a candidate weight, and the board
   * is not the screen that chooses one -- printing a projection here would put a
   * number beside a name with nothing on the row saying which attempt it assumed.
   */
  readonly total: RunningTotal;
  readonly handlers: readonly HandlerAssignment[];
}

export interface CoachBoard {
  /** Most urgent first. */
  readonly rows: readonly CoachBoardRow[];
  /**
   * The top row's lifter, which is where §21.1's automatic return goes.
   *
   * `null` for a meet with nobody in it. Deliberately not the document's
   * `focusedLifterId`: that is where the coach *is*, and this is where the board
   * says they should be.
   */
  readonly focusLifterId: string | null;
}

const EMPTY_ENTRY: CoachBoardEntry = { lifterId: '' };

/**
 * The attempt a coach is working towards, or `null` when the lifter is done.
 *
 * The countdown wins when there is one, because a running clock is by
 * definition about the attempt that needs declaring. Otherwise it is the
 * earliest unresolved competition attempt, scanning lifts in the order the
 * format contests them.
 *
 * Extra attempts are not candidates, for `nextAttemptOn`'s reason: §13.8 says
 * not to assume when one will occur, and putting one here would have the board
 * assert a position in the running order that the expeditor has not set.
 */
function currentAttemptOf(document: MeetDocument, lifter: LiveLifter): CurrentAttempt | null {
  const countdownAttempt =
    lifter.countdown === null ? null : findAttempt(document, lifter.countdown.attemptId)?.attempt;
  const chosen = countdownAttempt ?? firstOutstanding(document, lifter);
  if (chosen == null) return null;
  return {
    attemptId: chosen.id,
    lift: chosen.lift,
    attemptNumber: chosen.attemptNumber,
    kind: chosen.kind,
    status: chosen.status,
    proposedKilograms: chosen.kilograms,
  };
}

function firstOutstanding(document: MeetDocument, lifter: LiveLifter) {
  for (const lift of liftsInFormat(document.format)) {
    for (const attempt of attemptsOn(lifter, lift)) {
      if (attempt.kind !== 'competition' || isResolved(attempt)) continue;
      return attempt;
    }
  }
  return null;
}

function attemptsLeftOn(lifter: LiveLifter, lift: PlatformLift): number {
  return attemptsOn(lifter, lift).filter(
    (attempt) => attempt.kind === 'competition' && !isResolved(attempt),
  ).length;
}

/** Which level a due schedule item sits at. */
function urgencyOfItem(window: TimelineWindow): CoachBoardUrgency {
  switch (window.item.kind) {
    case 'equipment':
      return 'equipment-or-wrapping';
    case 'warm-up-set':
      return window.isFinalWarmup ? 'final-warm-up' : 'other-warm-ups';
    case 'platform':
      // The ramp is finished and the lifter is waiting to be called. That the
      // schedule expects them on the platform is not the same as somebody having
      // said so, and §15 is clear that a condition the application cannot see
      // stays a condition to state rather than one to assume.
      return 'upcoming-flight';
  }
}

const ACTION_BY_URGENCY: Readonly<Record<CoachBoardUrgency, CoachBoardActionCode>> = {
  'submission-deadline': 'hand-the-weight-to-the-table',
  'called-or-on-deck': 'get-to-the-platform',
  'equipment-or-wrapping': 'start-equipment-or-wrapping',
  'final-warm-up': 'take-the-final-warm-up',
  'other-warm-ups': 'start-the-warm-up',
  'upcoming-flight': 'wait-for-the-flight',
  'non-urgent-preparation': 'nothing-time-bound',
};

/**
 * What to do about this lifter, given where they are on the ladder.
 *
 * The one place the level does not settle it is when no weight has been chosen:
 * a lifter who is called or whose clock is running and who has nothing declared
 * does not need escorting or handing in, they need a number. That branch is why
 * this is not a bare table lookup.
 */
function actionFor(
  urgency: CoachBoardUrgency,
  current: CurrentAttempt | null,
): CoachBoardActionCode {
  const pressing = urgency === 'submission-deadline' || urgency === 'called-or-on-deck';
  if (pressing && current !== null && current.proposedKilograms === null) {
    return 'declare-the-next-attempt';
  }
  return ACTION_BY_URGENCY[urgency];
}

interface Placement {
  readonly urgency: CoachBoardUrgency;
  readonly seconds: number | null;
}

function placementOf(
  entry: CoachBoardEntry,
  current: CurrentAttempt | null,
  submission: SubmissionState | null,
  now: number,
  attentionLeadSeconds: number,
): Placement {
  // 1. A declaration clock that has not been answered. First on §21's list, and
  //    the only level with a deadline the rulebook enforces.
  if (submission !== null && !submission.submitted) {
    return { urgency: 'submission-deadline', seconds: submission.secondsRemaining };
  }

  // 2. Called, on deck, or in the hole. No seconds: an announcement is not a
  //    clock, and a countdown invented from one would be this tool guessing at
  //    the pace of a flight it is not watching.
  if (entry.platformCall != null) {
    return { urgency: 'called-or-on-deck', seconds: null };
  }

  // 3. Nothing left to do. Not the same as nothing due -- a lifter who has taken
  //    all nine attempts has no next action at all.
  if (current === null) {
    return { urgency: 'non-urgent-preparation', seconds: null };
  }

  const timeline = entry.warmup ?? null;
  if (timeline === null) {
    // §22's setup information -- rack heights, food, kit -- is what is left when
    // nothing about the lifter is on a clock.
    return { urgency: 'non-urgent-preparation', seconds: null };
  }

  // `null` once even the platform estimate has run out, which says nothing about
  // where the lifter actually is -- the two things that do know, the declaration
  // clock and the call, are both checked above this.
  const due = nextWindow(timeline, now);
  if (due === null) {
    return { urgency: 'upcoming-flight', seconds: null };
  }

  const seconds = Math.floor(due.startsInSeconds);
  if (due.startsInSeconds > attentionLeadSeconds) {
    return { urgency: 'upcoming-flight', seconds };
  }
  return { urgency: urgencyOfItem(due), seconds };
}

/**
 * The board, ranked.
 *
 * Total: every document and every set of entries produces a board, including a
 * meet with nobody in it. A screen at an expeditor's table has nothing useful to
 * do with a thrown error, and a coach board is the last screen in this tool that
 * should be the one to go blank.
 */
export function coachBoard(request: CoachBoardRequest): CoachBoard {
  const { rules, document, now } = request;
  const attentionLeadSeconds = Math.max(
    0,
    request.attentionLeadSeconds ?? DEFAULT_ATTENTION_LEAD_SECONDS,
  );
  const byLifter = new Map<string, CoachBoardEntry>();
  for (const entry of request.entries ?? []) byLifter.set(entry.lifterId, entry);

  const lifts = liftsInFormat(document.format);

  const inMeetOrder = document.lifters.map((lifter, index) => {
    const entry = byLifter.get(lifter.id) ?? EMPTY_ENTRY;
    const submission = submissionState(rules, document, lifter, now);
    const current = currentAttemptOf(document, lifter);
    const placement = placementOf(entry, current, submission, now, attentionLeadSeconds);

    const identifier = (entry.identifier ?? '').trim();
    return {
      lifterId: lifter.id,
      name: lifter.name,
      identifier: identifier === '' ? String(index + 1) : identifier,
      colour: entry.colour ?? null,
      urgency: placement.urgency,
      rank: 0,
      pinned: entry.pinned ?? false,
      platformCall: entry.platformCall ?? null,
      current,
      nextAction: actionFor(placement.urgency, current),
      remaining: {
        seconds: placement.seconds,
        attemptsOnThisLift: current === null ? 0 : attemptsLeftOn(lifter, current.lift),
        attemptsInTheMeet: lifts.reduce((total, lift) => total + attemptsLeftOn(lifter, lift), 0),
      },
      submission,
      total: totalSoFar(document, lifter),
      handlers: entry.handlers ?? [],
    } satisfies CoachBoardRow;
  });

  // Level first, then whoever is closest to their moment. A third clause pinning
  // ties to the meet order was written here and then deleted: the list above is
  // built in meet order and `sort` has been stable since ES2019, so the clause
  // was unreachable by any input and survived every mutation put to it. The
  // property it was defending is still a property -- a board that reshuffled two
  // idle lifters between repaints would move a name under a coach's thumb -- and
  // the test for it now covers the language rather than a line of dead code.
  const ranked = [...inMeetOrder].sort((left, right) => {
    const byUrgency = urgencyRank(left.urgency) - urgencyRank(right.urgency);
    if (byUrgency !== 0) return byUrgency;
    return compareSeconds(left.remaining.seconds, right.remaining.seconds);
  });

  const rows = ranked.map((row, position) => ({ ...row, rank: position + 1 }));
  return { rows, focusLifterId: rows[0]?.lifterId ?? null };
}

/** Soonest first, with "nothing timed" last rather than treated as zero. */
function compareSeconds(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}
