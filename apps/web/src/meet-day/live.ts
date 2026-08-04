// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §11's live screen, as one value: what is happening, what to do about it, and
 * how long there is to do it.
 *
 * The sibling of `plan.ts` and the same kind of thing -- a pure builder that
 * turns state plus a rule book into something renderable, so that everything
 * worth asserting about the live screen can be asserted without a browser. The
 * transport stays in `view.ts`; nothing here touches the DOM, reads a clock or
 * keeps a value between calls.
 *
 * WHY IT IS REBUILT FROM THE TIMELINE EVERY TIME, AND WHAT THAT BUYS
 *
 * §13.9 asks that every live action be undoable and that undo restore attempt
 * status, total, next recommendation, submission state and the warm-up
 * arithmetic. There is no code here answering that requirement, and that is the
 * design rather than an omission: this function is a pure function of the
 * timeline's present document and the instant, `liveChoicesFor` is a pure
 * function of the document, and undo replaces the document. So the recommendation
 * the lifter sees after pressing undo is not restored -- it is recomputed, and
 * cannot disagree with the document it came from.
 *
 * A cached view would be correct in every test that rebuilt it and wrong for the
 * one person who matters, standing at the expeditor's table having just corrected
 * a result. Do not memoise this. If it ever becomes expensive, the answer is to
 * make the domain cheaper, not to keep a copy.
 *
 * WHY `now` IS AN ARGUMENT
 *
 * Everything below it in the stack already takes the instant as a parameter, and
 * this is the last place that stays true. `apps/web/src/clock.ts` is the only
 * thing in the repository that reads the device clock; it supplies this argument
 * and says when to build again. One consequence is worth stating because it is
 * the whole reason the seam is shaped that way: the countdown is *derived* from
 * `now - startedAt` on every build, so a phone that slept through the minute
 * reports the truth on waking rather than resuming a paused counter (§14.1).
 *
 * WHAT THIS MODULE REFUSES TO GUESS
 *
 * Two of §11's headline figures are facts about a room the application is not in
 * -- how many attempts remain before the lifter is called, and whether there is
 * an urgent warm-up or equipment action. Both arrive as observed input and are
 * carried through untouched. Neither is inferred from the document, because a
 * plausible guess about how far away the platform is would be indistinguishable
 * on screen from somebody having looked, and it is the kind of number a handler
 * acts on immediately.
 *
 * CODES, NOT SENTENCES
 *
 * Every state this reports is a member of a closed union, and `copy.ts` turns it
 * into words. Same split as `plan.ts` and for the reason recorded there: the
 * wording changes for reasons of wording alone, and a builder that returned
 * prose could not be asserted against without asserting the prose.
 */
import {
  MEET_STAFF_ARE_AUTHORITATIVE,
  attemptWeightFor,
  changeAllowanceFor,
  findLifter,
  isResolved,
  jumpFromPrevious,
  liftsInFormat,
  liveChoicesFor,
  nextAttemptOn,
  submissionState,
  totalSoFar,
  undoableAction,
  type AttemptPlan,
  type AttemptStatus,
  type AttemptWeight,
  type BombOutRisk,
  type ChangeAllowance,
  type ConversionChart,
  type LiveAdvisory,
  type LiveAttempt,
  type LiveChoice,
  type LiveChoices,
  type LiveLifter,
  type LiveTarget,
  type MeetAction,
  type MeetDocument,
  type MeetRules,
  type MeetTimeline,
  type RunningTotal,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

/*
 * ---------------------------------------------------------------------------
 * What the caller supplies.
 * ---------------------------------------------------------------------------
 */

/**
 * What the planner worked out for one lift, carried into live mode.
 *
 * Three separate figures rather than the `LiftPlanView` `plan.ts` produces,
 * because `liveChoicesFor` wants exactly these three and nothing else -- and
 * because the live screen has to keep working for a lifter who arrived without a
 * plan at all. Every field is nullable for that reason: no plan is a supported
 * state, not a missing one, and each null costs a specific thing rather than
 * breaking the screen. Without a maximum there is no risk label and no percentage
 * (`live-choices.ts` refuses to grade on evidence nobody supplied); without a plan
 * the choices come off the legal increments rather than off a planned band;
 * without a ceiling nothing is clamped.
 */
export interface LiftPlanning {
  readonly plan: AttemptPlan | null;
  /** `M`, as the lifter confirmed it (§7). */
  readonly meetDayMaximumKilograms: number | null;
  /** §8.1's hard ceiling. */
  readonly ceilingKilograms: number | null;
}

export const NO_PLANNING: LiftPlanning = {
  plan: null,
  meetDayMaximumKilograms: null,
  ceilingKilograms: null,
};

/**
 * Keyed by every platform lift, not only the contested ones.
 *
 * `session.ts` keeps its figures the same way and for the same reason: a format
 * corrected mid-session must not delete what the lifter said about a lift that is
 * briefly off screen. Total lookup also means no branch here has to answer what a
 * missing key means.
 */
export type LivePlanning = Readonly<Record<PlatformLift, LiftPlanning>>;

export const NO_PLANNING_AT_ALL: LivePlanning = {
  squat: NO_PLANNING,
  bench: NO_PLANNING,
  deadlift: NO_PLANNING,
};

/**
 * §11's two observed figures, and the reason they are separate from everything
 * else the caller passes.
 *
 * `attemptsBeforeCalled` is `null` when nobody has counted, and `null` is what a
 * screen must render as "not known" rather than as zero -- zero means the lifter
 * is up now, which is the most urgent thing the screen can say.
 */
export interface LiveObservation {
  readonly attemptsBeforeCalled: number | null;
  /** Warm-up and equipment actions the handler has been given, in the order to do them. */
  readonly urgent: readonly UrgentNote[];
}

/** One thing to do away from the platform, urgent enough for §11's headline. */
export interface UrgentNote {
  readonly kind: 'warm-up' | 'equipment';
  readonly message: string;
}

export const NOTHING_OBSERVED: LiveObservation = { attemptsBeforeCalled: null, urgent: [] };

export interface LiveContext {
  readonly rules: MeetRules;
  /**
   * The federation's published kilogram-to-pound chart, or `null`.
   *
   * §16: a pound figure beside an attempt is read off the chart and never
   * computed. `null` is a supported state -- `attemptWeightFor` answers with the
   * reason `no-chart` and the screen says so -- and it is what a federation with
   * no published chart looks like.
   */
  readonly chart: ConversionChart | null;
  readonly planning: LivePlanning;
  /** §17's targets, already resolved to kilograms by the caller. */
  readonly targets: readonly LiveTarget[];
  readonly observed: LiveObservation;
  /** From `apps/web/src/clock.ts`. Never read here. */
  readonly now: number;
}

/*
 * ---------------------------------------------------------------------------
 * What it produces.
 * ---------------------------------------------------------------------------
 */

/**
 * §11's "current lift and round".
 *
 * Derived on every build and never stored, which is what makes a lift ending
 * advance the screen with no transition to write: the current lift is simply the
 * first contested one with an attempt left in it.
 */
export interface LivePosition {
  /** `null` only when every contested lift is over. */
  readonly lift: PlatformLift | null;
  readonly attemptNumber: number | null;
  readonly attemptId: string | null;
  /** Lifts with no attempt left, in platform order. Includes a lift that was bombed. */
  readonly liftsFinished: readonly PlatformLift[];
  readonly meetOver: boolean;
}

/**
 * §11's "next action", which is the largest thing on the screen.
 *
 * One code rather than a set, because the requirement is that the lifter be told
 * the next thing to do -- a list of everything currently possible is the screen
 * this one replaces. Everything else remains reachable; it is just not the
 * headline.
 */
export type NextActionCode =
  /** A result is in and no weight has been chosen for the next attempt yet (§13). */
  | 'choose-the-next-attempt'
  /** A weight is chosen and the table has not been told (§14). */
  | 'submit-to-the-table'
  /**
   * The table has it. The next thing the tool needs is what the referees said.
   *
   * Deliberately one code covering submitted, confirmed and locked. The tool
   * cannot see whether the bar has been lifted, and inventing a "wait" state
   * would mean a screen that has to be tapped through before the result can be
   * recorded -- §12 allows the whole result flow three or four taps and none of
   * them can be spent acknowledging that time passed.
   */
  | 'record-the-result'
  /** Every contested lift is over. */
  | 'the-meet-is-over';

/** §11's "next attempt", with §16's two figures. */
export interface NextAttemptView {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly status: AttemptStatus;
  /** `null` when the attempt exists but no weight has been chosen. */
  readonly weight: AttemptWeight | null;
  /** §11's "jump from the previous attempt". `null` on an opener. */
  readonly jumpKilograms: number | null;
  /** What the rules still allow to be changed about it, or `null` when it is not on the card. */
  readonly changes: ChangeAllowance | null;
}

/**
 * How close the declaration deadline is, in words that are not a colour.
 *
 * A band rather than the raw seconds, computed here so that one set of thresholds
 * exists rather than one per element that wants to look urgent. The seconds are
 * always carried alongside and are always shown: §5.8's rule that colour is never
 * the sole carrier of meaning applies to urgency too, and a red panel with no
 * number on it tells a handler nothing they can act on.
 */
export type SubmissionUrgency = 'calm' | 'hurry' | 'critical' | 'lapsed';

/** Under this many seconds, the panel starts insisting. */
export const SUBMISSION_HURRY_SECONDS = 30;
/** Under this many, it is the only thing on the screen worth reading. */
export const SUBMISSION_CRITICAL_SECONDS = 10;

export function urgencyFor(secondsRemaining: number, lapsed: boolean): SubmissionUrgency {
  if (lapsed) return 'lapsed';
  if (secondsRemaining <= SUBMISSION_CRITICAL_SECONDS) return 'critical';
  if (secondsRemaining <= SUBMISSION_HURRY_SECONDS) return 'hurry';
  return 'calm';
}

/**
 * The minute, on the attempts that have one.
 *
 * Three fields in one object rather than three nullable fields beside each
 * other, because they only mean anything together: seconds with no band is a
 * number nobody has been told how to read, and a band with no seconds is §5.8's
 * colour-only signal wearing a word. Grouping them makes "there is no clock" one
 * null the panel has to answer for, instead of three the panel could answer
 * inconsistently.
 */
export interface SubmissionClock {
  readonly secondsRemaining: number;
  readonly urgency: SubmissionUrgency;
  readonly lapsed: boolean;
}

/** §14.1's panel: what is owed, to whom, and what happens if nothing is said. */
export interface SubmissionView {
  readonly attemptId: string;
  /**
   * The lifter's name, on this panel specifically.
   *
   * §14 asks for the name and the weight shown together at the moment of
   * submission, and names the failure: the correct weight submitted for the wrong
   * athlete. It is on the panel rather than only in the header because the header
   * scrolls and this is the control that does the damage.
   */
  readonly lifterName: string;
  readonly weight: AttemptWeight | null;
  /**
   * `null` on the opener of a lift, which is an answer rather than an omission.
   *
   * `startCountdown` in the domain runs off a recorded result and looks for the
   * next attempt *on the same lift*, so nothing is running before squat one,
   * bench one or deadlift one. Three of the nine attempts therefore have no
   * deadline this tool can know, and they are exactly the three whose deadline
   * belongs to weigh-in and to the round the platform is in. The panel is still
   * the control that marks the weight handed in -- that is what it is for -- so
   * the clock is what goes missing and not the panel.
   */
  readonly clock: SubmissionClock | null;
  readonly submitted: boolean;
  /**
   * What the officials write down if the deadline passes (§14.1).
   *
   * `null` where the rules have nothing to apply -- there is no preceding result
   * to derive a fallback from -- which is a different sentence from "the same
   * weight" and must not be rendered as one.
   */
  readonly automatic: AttemptWeight | null;
}

/**
 * Everything §11 asks to be prominent, plus what sits behind it.
 *
 * Flat rather than nested by prominence. Which of these is largest is a layout
 * decision and belongs to the element; encoding it in the shape here would mean a
 * redesign could not be done without changing a type that tests assert against.
 */
export interface LiveView {
  /** §11's first line. Never logged, never in an error payload (§2.3). */
  readonly lifterName: string;
  readonly position: LivePosition;
  readonly nextAction: NextActionCode;
  readonly nextAttempt: NextAttemptView | null;
  readonly submission: SubmissionView | null;
  /** §11's "current successful subtotal or total". `isTotal` is the difference. */
  readonly banked: RunningTotal;
  /**
   * §11's "projected total if the recommendation succeeds".
   *
   * `null` when the highlighted choice is a pass, and that is not the same as the
   * banked figure. After a lifter reports pain the tool highlights stopping the
   * lift; showing the banked total under the heading "projected" would read as the
   * pass adding something, when what it does is close the lift.
   */
  readonly projected: RunningTotal | null;
  /** §13's three, or `null` once the lift is over. */
  readonly choices: LiveChoices | null;
  readonly advisories: readonly LiveAdvisory[];
  readonly bombOut: BombOutRisk | null;
  /** §13.8: granted and not yet taken. Beside the choices, never among them. */
  readonly extraAttempts: readonly LiveAttempt[];
  readonly observed: LiveObservation;
  /** §13.9: what pressing undo would take back, or `null` at the start of the meet. */
  readonly undoable: MeetAction | null;
  /** §29's sentences that must be on the screen, from the domain that owns them. */
  readonly notices: readonly string[];
}

/**
 * A live view of nothing, for the binding that has not got a lifter yet.
 *
 * Exported for the reason task #47 recorded the hard way: a lit-html property
 * binding *assigns* the bound value over the child's class-field default, so
 * binding a nullable view into an element that declares a non-null one puts the
 * null on the property and the first render throws. Nothing type-checks a
 * lit-html binding. Bind `.view=${live ?? EMPTY_LIVE_VIEW}`.
 */
export const EMPTY_LIVE_VIEW: LiveView = {
  lifterName: '',
  position: {
    lift: null,
    attemptNumber: null,
    attemptId: null,
    liftsFinished: [],
    meetOver: true,
  },
  nextAction: 'the-meet-is-over',
  nextAttempt: null,
  submission: null,
  banked: { kilograms: 0, isTotal: false, liftsOutstanding: [] },
  projected: null,
  choices: null,
  advisories: [],
  bombOut: null,
  extraAttempts: [],
  observed: NOTHING_OBSERVED,
  undoable: null,
  notices: [],
};

/*
 * ---------------------------------------------------------------------------
 * Building it.
 * ---------------------------------------------------------------------------
 */

/**
 * Where one lifter is, without building the rest of the screen.
 *
 * `buildLiveView` needs a rule book, a chart, a plan, targets, observations and
 * an instant, and answers a whole `LiveView`. A caller that only wants to know
 * whether the day is done -- §9.4's history is filed off exactly that, and it is
 * filed from a save handler with no clock in it -- would otherwise have to
 * assemble all six to read one boolean, or ask the question again in its own
 * words. The second is the one that goes wrong: "the meet is over" is a rule
 * about extra attempts and uncontested lifts (below), and a second reading of it
 * would file a history entry for a lifter still owed a deadlift.
 *
 * `null` for a lifter who is not in the document, the way `buildLiveView` is.
 */
export function positionOf(document: MeetDocument, lifterId: string): LivePosition | null {
  const lifter = findLifter(document, lifterId);
  return lifter === null ? null : positionIn(document, lifter);
}

/**
 * Where the lifter is, in platform order.
 *
 * A lift is finished when it has no unresolved competition attempt left, which
 * covers all three made, all three missed and a lift closed by passing. An
 * outstanding extra attempt does not hold a lift open (§13.8): its timing belongs
 * to the expeditor, so treating it as the current round would put the screen on a
 * bar nobody has scheduled.
 */
function positionIn(document: MeetDocument, lifter: LiveLifter): LivePosition {
  const finished: PlatformLift[] = [];
  for (const lift of liftsInFormat(document.format)) {
    const next = nextAttemptOn(lifter, lift);
    if (next === null) {
      finished.push(lift);
      continue;
    }
    return {
      lift,
      attemptNumber: next.attemptNumber,
      attemptId: next.id,
      liftsFinished: finished,
      meetOver: false,
    };
  }
  return {
    lift: null,
    attemptNumber: null,
    attemptId: null,
    liftsFinished: finished,
    meetOver: true,
  };
}

/**
 * What the tool is waiting for the user to do.
 *
 * Keyed off the attempt's own status rather than off the countdown, because the
 * countdown is about *when* and this is about *what*: a lifter who has already
 * submitted with forty seconds left is not being asked to submit again, and a
 * lifter whose clock has lapsed without submitting still owes the table a weight.
 */
function actionFor(attempt: LiveAttempt | null): NextActionCode {
  if (attempt === null) return 'the-meet-is-over';
  switch (attempt.status) {
    case 'planned':
    case 'proposed':
      return 'choose-the-next-attempt';
    case 'selected':
      return 'submit-to-the-table';
    case 'submitted':
    case 'confirmed':
    case 'locked':
      return 'record-the-result';
    // An attempt that is over is never the next one -- `nextAttemptOn` skips it --
    // so these arms exist to keep the switch total rather than to be reached.
    case 'good':
    case 'no-lift':
    case 'passed':
    case 'extra-attempt-granted':
      return 'record-the-result';
  }
}

/**
 * The one choice the tool is pointing at, or `null` when the lift is over.
 *
 * Read off the `highlighted` flag, never off the position in the list. The two
 * agree on most branches and §13.4 is where they do not: after a grind the pass
 * sits first, in the secure slot where a thumb lands, and the tool still
 * recommends the smallest legal increase beside it. Taking the first card would
 * report that lifter as projecting nothing -- the tool telling somebody who
 * ground out an opener that their day is over.
 *
 * A mutation swapping the flag for `choices[0]` passed the whole suite until a
 * grind was in it, because every other branch highlights its first card. Anything
 * added here that leans on ordering wants a grind case beside it.
 */
function highlightedChoice(choices: LiveChoices | null): LiveChoice | null {
  if (choices === null) return null;
  return choices.choices.find((choice) => choice.highlighted) ?? null;
}

/**
 * §14.1's panel, which the clock does not decide the existence of.
 *
 * Two ways to reach it, and the second one is the whole reason the panel is not
 * simply the countdown. A running deadline puts it up from the moment the
 * previous result lands, weight or no weight, because the minute is what it is
 * about. With no deadline running the panel has one job -- marking the weight
 * handed in -- so it appears once there is a weight to mark and not before: the
 * headline is already asking the lifter to choose, and a second panel repeating
 * that under a disabled button is the screen competing with itself, which §11
 * forbids by name.
 *
 * Without the second branch the meet cannot be run at all. The mark control
 * lives here and nowhere else, `advance-attempt` to `submitted` has no other
 * caller in the tool, and `startCountdown` never fires before the first result
 * of a lift -- so the opener of every lift sat at `submit-to-the-table` with
 * nothing on screen able to move it. Found by the §26 test that tried to finish
 * a meet through the screens; every test above this one had reached `submitted`
 * by applying the action directly.
 *
 * `submitted` keeps the panel up rather than withdrawing it, matching what the
 * clock branch already does for the other six attempts. A panel that vanished
 * under the thumb that pressed it reads as the press having failed, on the one
 * control in the tool a lifter would repeat if they were unsure.
 */
function submissionViewFor(
  context: LiveContext,
  document: MeetDocument,
  lifter: LiveLifter,
  attempt: LiveAttempt | null,
): SubmissionView | null {
  const state = submissionState(context.rules, document, lifter, context.now);
  if (state !== null) {
    return {
      attemptId: state.attempt.id,
      lifterName: lifter.name,
      weight: weightFor(context, state.attempt.kilograms),
      clock: {
        secondsRemaining: state.secondsRemaining,
        urgency: urgencyFor(state.secondsRemaining, state.lapsed),
        lapsed: state.lapsed,
      },
      submitted: state.submitted,
      automatic: weightFor(context, state.automaticKilograms),
    };
  }
  if (attempt === null || (attempt.status !== 'selected' && attempt.status !== 'submitted')) {
    return null;
  }
  return {
    attemptId: attempt.id,
    lifterName: lifter.name,
    weight: weightFor(context, attempt.kilograms),
    clock: null,
    submitted: attempt.submittedAt !== null,
    // No result on this lift yet, so the rules have no previous attempt to
    // derive a fallback from -- which `automaticSentence` already words as its
    // own sentence rather than as a missing line.
    automatic: null,
  };
}

/** §16's reading of a kilogram figure, or nothing where there is no figure. */
function weightFor(context: LiveContext, kilograms: number | null): AttemptWeight | null {
  return kilograms === null ? null : attemptWeightFor(kilograms, context.chart);
}

function nextAttemptViewFor(
  context: LiveContext,
  document: MeetDocument,
  lifter: LiveLifter,
  attempt: LiveAttempt,
): NextAttemptView {
  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    weight: attempt.kilograms === null ? null : attemptWeightFor(attempt.kilograms, context.chart),
    jumpKilograms: jumpFromPrevious(lifter, attempt),
    changes: changeAllowanceFor(context.rules, document, attempt.id),
  };
}

/**
 * §11, from a timeline and an instant.
 *
 * `null` for a lifter who is not in the meet, rather than an empty view. The two
 * are different faults -- a meet with nobody focused is a screen that has not been
 * set up, a lifter id that resolves to nothing is a bug in the caller -- and
 * collapsing them would hide the second behind the first's rendering.
 */
export function buildLiveView(
  timeline: MeetTimeline,
  lifterId: string,
  context: LiveContext,
): LiveView | null {
  const document = timeline.present;
  const lifter = document.lifters.find((candidate) => candidate.id === lifterId) ?? null;
  if (lifter === null) return null;

  const position = positionIn(document, lifter);
  const attempt =
    position.attemptId === null
      ? null
      : (lifter.attempts.find((candidate) => candidate.id === position.attemptId) ?? null);

  const lift = position.lift;
  const planning = lift === null ? NO_PLANNING : context.planning[lift];
  const choices =
    lift === null
      ? null
      : liveChoicesFor(context.rules, {
          document,
          lifter,
          lift,
          meetDayMaximumKilograms: planning.meetDayMaximumKilograms,
          plan: planning.plan,
          ceilingKilograms: planning.ceilingKilograms,
          targets: context.targets,
        });

  const highlighted = highlightedChoice(choices);

  return {
    lifterName: lifter.name,
    position,
    nextAction: actionFor(attempt),
    nextAttempt: attempt === null ? null : nextAttemptViewFor(context, document, lifter, attempt),
    submission: submissionViewFor(context, document, lifter, attempt),
    banked: totalSoFar(document, lifter),
    // Taken off the highlighted choice rather than recomputed. `live-choices.ts`
    // already answered exactly this question when it built the card, and a second
    // computation here would be free to disagree with the figure printed on the
    // card it sits beside -- which is the disagreement §13.2 records as the reason
    // projections walk the same module rather than applying percentages.
    projected:
      highlighted !== null && highlighted.kilograms !== null ? highlighted.projected : null,
    choices,
    advisories: choices?.advisories ?? [],
    bombOut: choices?.bombOut ?? null,
    extraAttempts: choices?.extraAttempts ?? [],
    observed: context.observed,
    undoable: undoableAction(timeline),
    notices: [MEET_STAFF_ARE_AUTHORITATIVE],
  };
}

/**
 * Whether the lifter has an attempt on the platform that nobody has judged.
 *
 * Exported because two screens ask it and neither should re-derive it: the live
 * screen decides whether to offer the result controls, and the coach board (#49)
 * marks a lifter as up. `isResolved` is the domain's answer to the same question
 * about one attempt; this is the same question about a lifter.
 */
export function awaitingResult(document: MeetDocument, lifter: LiveLifter): boolean {
  const position = positionIn(document, lifter);
  if (position.attemptId === null) return false;
  const attempt = lifter.attempts.find((candidate) => candidate.id === position.attemptId);
  if (attempt === undefined || isResolved(attempt)) return false;
  return (
    attempt.status === 'submitted' || attempt.status === 'confirmed' || attempt.status === 'locked'
  );
}
