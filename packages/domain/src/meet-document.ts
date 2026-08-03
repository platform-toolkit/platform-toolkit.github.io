// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The live meet as one immutable document, and every earlier version of it.
 *
 * §13.9 asks that every live action be undoable and that undo restore *the whole
 * world*: attempt status, total, next recommendation, submission state, timer,
 * warm-up and the coach board. That requirement is unimplementable as a feature
 * bolted onto a screen, and it is nearly free as a consequence of one decision --
 * so this file makes the decision and nothing above it has to think about undo
 * again.
 *
 * THE DECISION: ONE WORLD, AND EVERYTHING ELSE IS DERIVED
 *
 * There is exactly one mutable thing in live mode, a `MeetDocument`, and it is
 * not mutated -- every action produces a new one and the old one is pushed onto a
 * stack. Nothing else may hold state. The total is not stored, it is summed. The
 * next recommendation is not stored, it is computed from the attempts. The
 * submission deadline is not a running timer, it is a start instant plus a
 * duration. The coach board is a projection of the lifters array.
 *
 * That is what makes undo total. If the recommendation were held in a component,
 * undoing a mis-tapped "No Lift" would restore the attempt and leave last round's
 * recommendation on screen -- a correct-looking weight for a world that no longer
 * exists, at the moment somebody is walking to the expeditor's table. Storing a
 * derived value is not an optimisation here, it is the bug.
 *
 * WHY THE CLOCK IS AN ARGUMENT
 *
 * Nothing in this file reads the clock. Every action takes the instant it
 * happened as a parameter, the same discipline `planPublication` uses for
 * `generatedAt`: the same document plus the same actions must produce the same
 * document, or a saved meet replays differently than it was lived and no test can
 * pin a countdown. Epoch milliseconds rather than `Date`, and deliberately not a
 * `PlainDate` -- this is an instant on a platform, not a calendar day (§5.5).
 *
 * WHAT THIS FILE REFUSES TO DECIDE
 *
 * It does not choose weights. §13's three choices are `live-choices.ts`; the
 * planner's opening ladder is `attempt-plan.ts`. It records what a person did and
 * answers what the rules now permit. The one thing it will refuse outright is an
 * action the arithmetic in the rulebook forbids -- a weight below one already
 * missed, a fourth change to a third attempt -- because a coach turned away at the
 * table in the round where there is no time to recover is the failure
 * `meet-rules.ts` exists to prevent. Conditions the application cannot see stay
 * conditions to state (§15), never conditions to assume.
 */
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import type { AttemptOutcome, ChangeAllowance, MeetRules, TakenAttempt } from './meet-rules.js';

/**
 * How many earlier worlds to keep.
 *
 * A full-power meet is nine attempts and perhaps five actions each, so this holds
 * an entire day for one lifter and most of one for a handful. Bounded at all
 * because a coach board left open across a long meet would otherwise grow a copy
 * of the document per tap, and the phone this runs on is the same phone running
 * the timer.
 */
export const UNDO_HISTORY_LIMIT = 200;

/** The longest note that may be attached to an attempt. */
export const MAX_ATTEMPT_NOTE_LENGTH = 500;

/**
 * Where an attempt has got to, from planned to resolved.
 *
 * §14's list of states, as one field rather than a status plus a result. Two
 * fields would make "submitted and also a good lift" representable, and every
 * reader would then need a rule for which one wins -- so the illegal combination
 * is removed instead of being documented.
 */
export type AttemptStatus = SubmissionStatus | ResolvedStatus;

/** The states an attempt passes through before it is taken. */
export type SubmissionStatus =
  /** A weight the plan holds. Nobody has declared anything. */
  | 'planned'
  /** The tool put it forward after the preceding result. */
  | 'proposed'
  /** The lifter or handler chose it. */
  | 'selected'
  /** Handed to the expeditor or the scoring table. */
  | 'submitted'
  /** The table acknowledged it. */
  | 'confirmed'
  /** No longer changeable. */
  | 'locked';

/** The states an attempt ends in. */
export type ResolvedStatus =
  | 'good'
  | 'no-lift'
  | 'passed'
  /**
   * The officials set this attempt aside and granted another.
   *
   * Deliberately not `no-lift`: it did not count against the lifter, it must not
   * raise the floor under later attempts, and it must not appear in a miss count
   * that drives a bomb-out warning. §13.8 asks for the extra attempt to be
   * tracked separately from the normal three, and a status of its own is how that
   * survives every reader written later.
   */
  | 'extra-attempt-granted';

const SUBMISSION_ORDER: readonly SubmissionStatus[] = [
  'planned',
  'proposed',
  'selected',
  'submitted',
  'confirmed',
  'locked',
];

const RESOLVED_STATUSES: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  'good',
  'no-lift',
  'passed',
  'extra-attempt-granted',
]);

/** Whether an attempt is over, however it ended. */
export function isResolved(attempt: LiveAttempt): boolean {
  return RESOLVED_STATUSES.has(attempt.status);
}

function submissionRank(status: AttemptStatus): number {
  const index = SUBMISSION_ORDER.indexOf(status as SubmissionStatus);
  return index;
}

/**
 * Which of the three kinds of attempt this is.
 *
 * `competition` attempts are the numbered ones every lifter gets. `extra` is one
 * granted after a platform or official error, sharing the number of the attempt
 * it replaces so the round sequence is not renumbered under the lifter (§13.8).
 * `record` is a fourth attempt, which counts for a record and not for the total.
 */
export type AttemptKind = 'competition' | 'extra' | 'record';

/** How the lift felt, asked after a good lift (§12.2). */
export type AttemptEffort = 'flew' | 'solid' | 'slow' | 'grind' | 'pain' | 'unsure';

/**
 * Why the lift was missed (§12.3).
 *
 * A coded field and not a note, because §12.3 says outright that these reasons
 * materially affect the next recommendation and must not be hidden in a notes
 * field. `live-choices.ts` branches on this; nothing branches on the note.
 */
export type MissReason =
  /** A command or technical error; the strength was there. */
  | 'command'
  | 'strength'
  | 'pain'
  /** Loading, spotter, platform or official error. */
  | 'platform-error'
  /** A timeout or another administrative issue. */
  | 'administrative'
  | 'unsure';

export type RefereeLight = 'white' | 'red';

/** The three lights, in the order the lifter sees them: left, head, right. */
export type AttemptLights = readonly [RefereeLight, RefereeLight, RefereeLight];

/**
 * The scale RPE is recorded on, exported because a screen has to ask for it.
 *
 * `recordResult` refuses anything outside this, and a field that let a lifter
 * type 12 and then reported a refusal from the document layer would be a form
 * that validates by being submitted. Exported rather than restated in the tool
 * so the two cannot drift: a screen that accepted more than the document does
 * would surface as a recorded attempt silently missing its RPE.
 */
export const RPE_BOUNDS = { min: 6, max: 10 } as const;

/**
 * What was recorded about a completed attempt.
 *
 * The effort and the miss reason are **required** on their branches, with
 * `unsure` in both lists. §12 forbids demanding light-by-light entry before the
 * next choices appear, and it requires the reason -- so the question that changes
 * the recommendation is compulsory and has an honest way out, while the questions
 * that only decorate the record are separate and optional.
 */
export type RecordedResult =
  | { readonly outcome: 'good'; readonly effort: AttemptEffort; readonly rpe?: number | null }
  | { readonly outcome: 'no-lift'; readonly reason: MissReason }
  | { readonly outcome: 'passed' }
  | { readonly outcome: 'extra-attempt-granted' };

export interface LiveAttempt {
  /** Stable for the life of the document; actions and history refer to it. */
  readonly id: string;
  readonly lift: PlatformLift;
  /** 1, 2 or 3; an extra shares the number it replaces; a record attempt is one past the last. */
  readonly attemptNumber: number;
  readonly kind: AttemptKind;
  /** `null` until a weight is chosen. A plan may reach the platform with a blank third. */
  readonly kilograms: number | null;
  readonly status: AttemptStatus;
  readonly effort: AttemptEffort | null;
  readonly rpe: number | null;
  readonly missReason: MissReason | null;
  readonly lights: AttemptLights | null;
  /**
   * Anything the lifter wanted written down.
   *
   * Free text, which nothing else in this collection has -- `packages/preferences`
   * has no builder that would admit it (§5.12) and that is deliberate. It is here
   * because §12.1 asks for it and a meet document is a thing a person authors,
   * not a setting a device remembers. It must never reach a log, an error payload,
   * or anything sent to an embedding page.
   */
  readonly note: string | null;
  /** How many times the weight has been changed after being submitted. */
  readonly changesUsed: number;
  /** When it was marked submitted, so a screen can say how long ago. */
  readonly submittedAt: number | null;
  /** For an extra attempt, the attempt it was granted against. */
  readonly grantedFor: string | null;
}

/**
 * The clock running on the next attempt's declaration.
 *
 * The start instant is stored and the remaining time is computed, so undo
 * restores the clock along with everything else -- and so a phone that slept
 * through the minute reports the truth on waking rather than resuming a paused
 * counter. §14.1 is explicit that the official clock is authoritative and this one
 * may start late; storing the instant the *result was recorded* rather than the
 * instant the bar was racked is that lateness, made visible instead of hidden.
 */
export interface SubmissionCountdown {
  /** The attempt that must be declared before it runs out. */
  readonly attemptId: string;
  readonly startedAt: number;
  /**
   * The window in force when the clock started.
   *
   * Stored rather than re-read from the profile so that nothing about the attempt
   * changing mid-minute can move the deadline underneath the person watching it.
   */
  readonly seconds: number;
}

export interface LiveLifter {
  readonly id: string;
  /**
   * The name shown at the moment of submission (§14), and the reason it is here.
   *
   * Submitting the correct weight for the wrong athlete is the failure that
   * requirement names, and a board of initials does not prevent it. Same privacy
   * boundary as an attempt note: never logged, never in an error payload, never
   * sent to an embedding page.
   */
  readonly name: string;
  readonly attempts: readonly LiveAttempt[];
  readonly countdown: SubmissionCountdown | null;
  /** Next ordinal for a generated attempt id, so a removed attempt's id is never reused. */
  readonly nextAttemptOrdinal: number;
}

export interface MeetDocument {
  /** Which rules this meet was run under, recorded so a saved document can say (§30). */
  readonly rulesProfileId: string;
  readonly rulebookRevision: string;
  readonly format: MeetFormat;
  readonly lifters: readonly LiveLifter[];
  readonly focusedLifterId: string | null;
  readonly nextLifterOrdinal: number;
}

/** One step backwards: the world before an action, and the action that left it. */
export interface UndoStep {
  readonly document: MeetDocument;
  readonly action: MeetAction;
  readonly at: number;
}

/**
 * The present world and every earlier one.
 *
 * There is no redo, and the omission is deliberate. An undo in live mode is
 * followed within seconds by the corrected action -- the coach tapped No Lift on
 * the wrong lifter and is about to tap it on the right one -- so a redo control
 * sitting beside undo at the expeditor's table is a one-tap way to re-apply a
 * result somebody has just decided was wrong. Multi-step undo is kept because it
 * costs nothing and covers the case where the mistake is noticed two taps late.
 */
export interface MeetTimeline {
  readonly present: MeetDocument;
  /** Most recent last. */
  readonly past: readonly UndoStep[];
}

/** Which lifts a contest of this format is scored on. */
export function liftsInFormat(format: MeetFormat): readonly PlatformLift[] {
  switch (format) {
    case 'full-power':
      return ['squat', 'bench', 'deadlift'];
    case 'push-pull':
      return ['bench', 'deadlift'];
    case 'bench-only':
      return ['bench'];
    case 'deadlift-only':
      return ['deadlift'];
  }
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export type MeetAction =
  | { readonly kind: 'add-lifter'; readonly name: string }
  | { readonly kind: 'focus-lifter'; readonly lifterId: string }
  | { readonly kind: 'set-attempt-weight'; readonly attemptId: string; readonly kilograms: number }
  | { readonly kind: 'advance-attempt'; readonly attemptId: string; readonly to: SubmissionStatus }
  | { readonly kind: 'record-result'; readonly attemptId: string; readonly result: RecordedResult }
  | { readonly kind: 'grant-extra-attempt'; readonly attemptId: string }
  | {
      readonly kind: 'annotate-attempt';
      readonly attemptId: string;
      readonly lights?: AttemptLights | null;
      readonly note?: string | null;
    }
  | {
      readonly kind: 'add-record-attempt';
      readonly lifterId: string;
      readonly lift: PlatformLift;
      readonly kilograms: number;
      readonly recordKilograms: number;
    };

export type MeetActionProblemCode =
  | 'unknown-lifter'
  | 'unknown-attempt'
  | 'lifter-name-required'
  | 'attempt-already-resolved'
  | 'status-would-go-backwards'
  | 'weight-is-not-a-weight'
  | 'weight-not-legal'
  | 'weight-required-before-submitting'
  | 'no-changes-remaining'
  | 'not-a-missed-attempt'
  | 'record-attempt-not-available'
  | 'rpe-out-of-range'
  | 'note-too-long'
  | 'nothing-to-undo';

export interface MeetActionProblem {
  readonly code: MeetActionProblemCode;
  readonly message: string;
}

export type MeetActionResult =
  | { readonly ok: true; readonly timeline: MeetTimeline }
  | { readonly ok: false; readonly problems: readonly MeetActionProblem[] };

// -----------------------------------------------------------------------------
// Building a document
// -----------------------------------------------------------------------------

/** An empty meet under one federation's rules, with no lifters yet. */
export function createMeetDocument(rules: MeetRules, format: MeetFormat): MeetDocument {
  return {
    rulesProfileId: rules.profile.id,
    rulebookRevision: rules.profile.source.revision,
    format,
    lifters: [],
    focusedLifterId: null,
    nextLifterOrdinal: 1,
  };
}

export function startTimeline(document: MeetDocument): MeetTimeline {
  return { present: document, past: [] };
}

function blankAttempt(id: string, lift: PlatformLift, attemptNumber: number): LiveAttempt {
  return {
    id,
    lift,
    attemptNumber,
    kind: 'competition',
    kilograms: null,
    status: 'planned',
    effort: null,
    rpe: null,
    missReason: null,
    lights: null,
    note: null,
    changesUsed: 0,
    submittedAt: null,
    grantedFor: null,
  };
}

// -----------------------------------------------------------------------------
// Reading a document
// -----------------------------------------------------------------------------

export function findLifter(document: MeetDocument, lifterId: string): LiveLifter | null {
  return document.lifters.find((lifter) => lifter.id === lifterId) ?? null;
}

/** The attempt and the lifter it belongs to, since an attempt id is unique across the meet. */
export function findAttempt(
  document: MeetDocument,
  attemptId: string,
): { readonly lifter: LiveLifter; readonly attempt: LiveAttempt } | null {
  for (const lifter of document.lifters) {
    const attempt = lifter.attempts.find((candidate) => candidate.id === attemptId);
    if (attempt !== undefined) return { lifter, attempt };
  }
  return null;
}

export function attemptsOn(lifter: LiveLifter, lift: PlatformLift): readonly LiveAttempt[] {
  return lifter.attempts.filter((attempt) => attempt.lift === lift);
}

/**
 * The attempts on one lift as the rules engine wants them.
 *
 * A passed attempt and an attempt set aside by the officials both map to
 * `passed`, which `nextAttemptBounds` filters out. That is the whole of §13.8's
 * "must not corrupt the planned round sequence" in one line: an attempt the
 * officials struck does not raise the floor, does not become a repeatable weight,
 * and does not make the lifter's next attempt a progression above a lift that did
 * not count.
 */
export function takenOn(lifter: LiveLifter, lift: PlatformLift): readonly TakenAttempt[] {
  const taken: TakenAttempt[] = [];
  for (const attempt of attemptsOn(lifter, lift)) {
    if (!isResolved(attempt) || attempt.kilograms === null) continue;
    const outcome: AttemptOutcome =
      attempt.status === 'good' ? 'good' : attempt.status === 'no-lift' ? 'no-lift' : 'passed';
    taken.push({ attemptNumber: attempt.attemptNumber, kilograms: attempt.kilograms, outcome });
  }
  return taken;
}

/**
 * The next competition attempt due on a lift, or `null` when the lift is done.
 *
 * Extra attempts are **not** candidates. §13.8 says not to assume when an extra
 * attempt will occur, and slotting it into the sequence here would be exactly
 * that assumption -- the round order is the expeditor's, and an extra granted in
 * round two may be taken after round three. `outstandingExtraAttempts` reports
 * them separately, which is how a screen can show one without pretending to know
 * when it lands.
 */
export function nextAttemptOn(lifter: LiveLifter, lift: PlatformLift): LiveAttempt | null {
  let next: LiveAttempt | null = null;
  for (const attempt of attemptsOn(lifter, lift)) {
    if (attempt.kind !== 'competition' || isResolved(attempt)) continue;
    if (next === null || attempt.attemptNumber < next.attemptNumber) next = attempt;
  }
  return next;
}

/** Extra attempts granted and not yet taken, whose timing the application does not know. */
export function outstandingExtraAttempts(
  lifter: LiveLifter,
  lift?: PlatformLift,
): readonly LiveAttempt[] {
  return lifter.attempts.filter(
    (attempt) =>
      attempt.kind === 'extra' &&
      !isResolved(attempt) &&
      (lift === undefined || attempt.lift === lift),
  );
}

/** The heaviest good lift on a lift, ignoring record attempts, or `null` if there is none. */
export function bestGoodLift(lifter: LiveLifter, lift: PlatformLift): number | null {
  let best: number | null = null;
  for (const attempt of attemptsOn(lifter, lift)) {
    if (attempt.status !== 'good' || attempt.kilograms === null) continue;
    // A fourth attempt counts for a record and never for the total, which is the
    // one thing about it everybody knows and the one thing a sum written the
    // obvious way gets wrong.
    if (attempt.kind === 'record') continue;
    if (best === null || attempt.kilograms > best) best = attempt.kilograms;
  }
  return best;
}

export interface RunningTotal {
  /** The sum of the best good lift on each contested lift. Zero before anything is made. */
  readonly kilograms: number;
  /** Whether every contested lift has a good lift, which is what makes it a total. */
  readonly isTotal: boolean;
  /** The lifts still without a good lift, so a screen can say what the figure is missing. */
  readonly liftsOutstanding: readonly PlatformLift[];
}

/**
 * What the lifter has banked, and whether it is yet a total.
 *
 * §11 asks for "current successful subtotal or total" and the difference is not
 * cosmetic: a lifter with two lifts made and a deadlift to go has no total at all
 * -- they bomb out on three misses and place nowhere. A single number labelled
 * "total" all day is the screen that lets somebody believe the day is banked.
 */
export function totalSoFar(document: MeetDocument, lifter: LiveLifter): RunningTotal {
  const lifts = liftsInFormat(document.format);
  let kilograms = 0;
  const outstanding: PlatformLift[] = [];
  for (const lift of lifts) {
    const best = bestGoodLift(lifter, lift);
    if (best === null) outstanding.push(lift);
    else kilograms += best;
  }
  return { kilograms, isTotal: outstanding.length === 0, liftsOutstanding: outstanding };
}

/**
 * The total the lifter would have if a candidate weight were made (§11, §13).
 *
 * Takes the candidate as an argument rather than reading a stored recommendation,
 * for the reason the header gives: a projected total that outlived the attempt it
 * was projecting is a plausible number nobody can trace.
 */
export function projectedTotalWith(
  document: MeetDocument,
  lifter: LiveLifter,
  lift: PlatformLift,
  kilograms: number,
): RunningTotal {
  const lifts = liftsInFormat(document.format);
  let total = 0;
  const outstanding: PlatformLift[] = [];
  for (const candidate of lifts) {
    const best = bestGoodLift(lifter, candidate);
    const value = candidate === lift ? Math.max(best ?? 0, kilograms) : best;
    if (value === null) outstanding.push(candidate);
    else total += value;
  }
  return { kilograms: total, isTotal: outstanding.length === 0, liftsOutstanding: outstanding };
}

/** The increase from the last attempt taken on this lift, or `null` when it is the first. */
export function jumpFromPrevious(lifter: LiveLifter, attempt: LiveAttempt): number | null {
  if (attempt.kilograms === null) return null;
  let previous: LiveAttempt | null = null;
  for (const candidate of attemptsOn(lifter, attempt.lift)) {
    if (candidate.id === attempt.id || candidate.kilograms === null) continue;
    if (candidate.attemptNumber > attempt.attemptNumber) continue;
    if (candidate.attemptNumber === attempt.attemptNumber && candidate.kind !== 'competition') {
      continue;
    }
    if (!isResolved(candidate)) continue;
    if (previous === null || candidate.attemptNumber > previous.attemptNumber) previous = candidate;
  }
  if (previous?.kilograms == null) return null;
  return attempt.kilograms - previous.kilograms;
}

export interface BombOutRisk {
  /** Attempts missed on this lift, not counting any the officials set aside. */
  readonly misses: number;
  /** Competition attempts left. */
  readonly attemptsRemaining: number;
  /** True when the lifter has no good lift here and one attempt left. */
  readonly onTheLastChance: boolean;
}

/**
 * How close the lifter is to no total at all on this lift.
 *
 * §13.7 asks for a prominent warning after two misses. Reported as the three
 * numbers behind that judgement rather than as a boolean, because the same
 * situation reads differently on the opener (§13.6 wants bomb-out risk emphasised
 * there) and on a third attempt with two lifts already banked.
 */
export function bombOutRisk(lifter: LiveLifter, lift: PlatformLift): BombOutRisk {
  let misses = 0;
  let remaining = 0;
  for (const attempt of attemptsOn(lifter, lift)) {
    if (attempt.kind === 'record') continue;
    if (attempt.status === 'no-lift') misses += 1;
    else if (!isResolved(attempt)) remaining += 1;
  }
  return {
    misses,
    attemptsRemaining: remaining,
    onTheLastChance: bestGoodLift(lifter, lift) === null && remaining === 1,
  };
}

export interface SubmissionState {
  readonly attempt: LiveAttempt;
  readonly countdown: SubmissionCountdown;
  /** Whole seconds left, floored at zero. */
  readonly secondsRemaining: number;
  readonly lapsed: boolean;
  /**
   * Whether the weight has been handed to the table.
   *
   * Read from `submittedAt` rather than from the status, because the status
   * moves on once the attempt is judged and `submissionRank` answers `-1` for
   * every resolved one -- so a rank comparison says a lifted attempt was never
   * submitted. The timestamp is set once and never cleared, which is the honest
   * record of the thing this field claims to report.
   */
  readonly submitted: boolean;
  /** What the officials write down if nothing is declared, or `null` when there is no rule to apply. */
  readonly automaticKilograms: number | null;
}

/**
 * The state of the declaration clock for one lifter (§14.1).
 *
 * `now` is a parameter for the same reason every action's instant is. The
 * automatic fallback is recomputed here rather than frozen when the clock
 * started, because it depends on the preceding attempt's result, and that is the
 * one thing that cannot change while this clock runs.
 */
export function submissionState(
  rules: MeetRules,
  document: MeetDocument,
  lifter: LiveLifter,
  now: number,
): SubmissionState | null {
  const { countdown } = lifter;
  if (countdown === null) return null;
  const found = findAttempt(document, countdown.attemptId);
  if (found === null) return null;
  const { attempt } = found;

  const elapsed = Math.max(0, (now - countdown.startedAt) / 1000);
  const secondsRemaining = Math.max(0, Math.floor(countdown.seconds - elapsed));

  const previous = lastResolvedOn(lifter, attempt.lift);
  const automatic =
    previous === null
      ? null
      : rules.automaticAttemptAfter({
          attemptNumber: previous.attemptNumber,
          kilograms: previous.kilograms ?? 0,
          outcome:
            previous.status === 'good'
              ? 'good'
              : previous.status === 'no-lift'
                ? 'no-lift'
                : 'passed',
        });

  return {
    attempt,
    countdown,
    secondsRemaining,
    lapsed: secondsRemaining === 0,
    submitted: attempt.submittedAt !== null,
    automaticKilograms: automatic?.kilograms ?? null,
  };
}

function lastResolvedOn(lifter: LiveLifter, lift: PlatformLift): LiveAttempt | null {
  let last: LiveAttempt | null = null;
  for (const attempt of attemptsOn(lifter, lift)) {
    if (!isResolved(attempt) || attempt.kilograms === null) continue;
    if (attempt.status === 'extra-attempt-granted' || attempt.status === 'passed') continue;
    if (last === null || attempt.attemptNumber >= last.attemptNumber) last = attempt;
  }
  return last;
}

/** How many changes remain on an attempt, and the conditions an official has to confirm. */
export function changeAllowanceFor(
  rules: MeetRules,
  document: MeetDocument,
  attemptId: string,
): ChangeAllowance | null {
  const found = findAttempt(document, attemptId);
  if (found === null) return null;
  return rules.changeAllowance({
    lift: found.attempt.lift,
    attemptNumber: found.attempt.attemptNumber,
    format: document.format,
    used: found.attempt.changesUsed,
  });
}

// -----------------------------------------------------------------------------
// Applying an action
// -----------------------------------------------------------------------------

function refuse(code: MeetActionProblemCode, message: string): MeetActionResult {
  return { ok: false, problems: [{ code, message }] };
}

function withLifters(document: MeetDocument, lifters: readonly LiveLifter[]): MeetDocument {
  return { ...document, lifters };
}

function replaceLifter(document: MeetDocument, updated: LiveLifter): MeetDocument {
  return withLifters(
    document,
    document.lifters.map((lifter) => (lifter.id === updated.id ? updated : lifter)),
  );
}

function replaceAttempt(lifter: LiveLifter, updated: LiveAttempt): LiveLifter {
  return {
    ...lifter,
    attempts: lifter.attempts.map((attempt) => (attempt.id === updated.id ? updated : attempt)),
  };
}

function commit(
  timeline: MeetTimeline,
  action: MeetAction,
  at: number,
  next: MeetDocument,
): MeetActionResult {
  const past = [...timeline.past, { document: timeline.present, action, at }];
  return {
    ok: true,
    timeline: {
      present: next,
      past: past.length > UNDO_HISTORY_LIMIT ? past.slice(past.length - UNDO_HISTORY_LIMIT) : past,
    },
  };
}

/**
 * Apply one action, producing a new timeline or every reason it was refused.
 *
 * Never mutates its argument, and never reads the clock: `at` is the instant the
 * action happened, supplied by whatever is holding the timeline.
 */
export function applyMeetAction(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: MeetAction,
  at: number,
): MeetActionResult {
  const document = timeline.present;

  switch (action.kind) {
    case 'add-lifter':
      return addLifter(rules, timeline, action, at);
    case 'focus-lifter': {
      if (findLifter(document, action.lifterId) === null) {
        return refuse('unknown-lifter', 'That lifter is not in this meet.');
      }
      return commit(timeline, action, at, { ...document, focusedLifterId: action.lifterId });
    }
    case 'set-attempt-weight':
      return setAttemptWeight(rules, timeline, action, at);
    case 'advance-attempt':
      return advanceAttempt(rules, timeline, action, at);
    case 'record-result':
      return recordResult(rules, timeline, action, at);
    case 'grant-extra-attempt':
      return grantExtraAttempt(timeline, action, at);
    case 'annotate-attempt':
      return annotateAttempt(timeline, action, at);
    case 'add-record-attempt':
      return addRecordAttempt(rules, timeline, action, at);
  }
}

function addLifter(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'add-lifter' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const name = action.name.trim();
  if (name === '') {
    return refuse(
      'lifter-name-required',
      'A lifter needs a name, because the submission screen shows it to stop the right weight being submitted for the wrong athlete.',
    );
  }

  const id = `lifter-${String(document.nextLifterOrdinal)}`;
  const attempts: LiveAttempt[] = [];
  let ordinal = 1;
  for (const lift of liftsInFormat(document.format)) {
    for (let number = 1; number <= rules.profile.attemptsPerLift; number += 1) {
      attempts.push(blankAttempt(`${id}-${lift}-${String(number)}`, lift, number));
      ordinal += 1;
    }
  }

  const lifter: LiveLifter = {
    id,
    name,
    attempts,
    countdown: null,
    nextAttemptOrdinal: ordinal,
  };

  return commit(timeline, action, at, {
    ...document,
    lifters: [...document.lifters, lifter],
    focusedLifterId: document.focusedLifterId ?? id,
    nextLifterOrdinal: document.nextLifterOrdinal + 1,
  });
}

function setAttemptWeight(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'set-attempt-weight' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const found = findAttempt(document, action.attemptId);
  if (found === null) return refuse('unknown-attempt', 'That attempt is not in this meet.');
  const { lifter, attempt } = found;

  if (isResolved(attempt)) {
    return refuse(
      'attempt-already-resolved',
      'That attempt has already been taken. Undo the result first if it was recorded by mistake.',
    );
  }
  if (!Number.isFinite(action.kilograms) || action.kilograms <= 0) {
    return refuse('weight-is-not-a-weight', 'An attempt has to be a weight above zero.');
  }

  const problems: MeetActionProblem[] = [];

  // Checked against the attempts already **resolved** on this lift, and nothing
  // else. A third attempt planned below a second that has not happened yet is a
  // plan awaiting revision, not an illegal declaration -- refusing it here would
  // stop a coach from sketching a ladder, and the check that matters runs again
  // on the way to `submitted`.
  const legality = rules.isLegalNextAttempt(takenOn(lifter, attempt.lift), action.kilograms);
  if (!legality.legal && nextAttemptOn(lifter, attempt.lift)?.id === attempt.id) {
    problems.push({
      code: 'weight-not-legal',
      message: describeRefusal(legality.reasons, action.kilograms),
    });
  }

  // A change after submission is a change the rulebook counts, and both published
  // profiles allow very few of them. The count is arithmetic and is enforced; the
  // conditions attached to it are not, because the application cannot see whether
  // the bar has been called (§15).
  const submitted = submissionRank(attempt.status) >= submissionRank('submitted');
  if (submitted) {
    const allowance = rules.changeAllowance({
      lift: attempt.lift,
      attemptNumber: attempt.attemptNumber,
      format: document.format,
      used: attempt.changesUsed,
    });
    if (allowance.remaining <= 0) {
      problems.push({
        code: 'no-changes-remaining',
        message: `These rules allow ${String(allowance.allowed)} change${allowance.allowed === 1 ? '' : 's'} to this attempt once it has been submitted, and ${String(attempt.changesUsed)} ${attempt.changesUsed === 1 ? 'has' : 'have'} been made.`,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  const updated: LiveAttempt = {
    ...attempt,
    kilograms: action.kilograms,
    changesUsed: submitted ? attempt.changesUsed + 1 : attempt.changesUsed,
  };
  return commit(timeline, action, at, replaceLifter(document, replaceAttempt(lifter, updated)));
}

function describeRefusal(reasons: readonly string[], kilograms: number): string {
  const clauses = reasons.map((reason) => {
    switch (reason) {
      case 'not-a-legal-bar-weight':
        return 'the bar cannot be loaded to it under these rules';
      case 'below-a-failed-attempt':
        return 'it is below a weight already missed';
      default:
        return 'it is less than the minimum progression above the last attempt';
    }
  });
  return `${String(kilograms)} kg is not a legal next attempt: ${clauses.join('; ')}.`;
}

function advanceAttempt(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'advance-attempt' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const found = findAttempt(document, action.attemptId);
  if (found === null) return refuse('unknown-attempt', 'That attempt is not in this meet.');
  const { lifter, attempt } = found;

  if (isResolved(attempt)) {
    return refuse('attempt-already-resolved', 'That attempt has already been taken.');
  }
  if (submissionRank(action.to) <= submissionRank(attempt.status)) {
    // Undo is the way back, and it is the only way back. A status that could be
    // set downwards would let a screen "unsubmit" an attempt without the change
    // being counted, which is how a lifter arrives at the table having used a
    // change nobody recorded.
    return refuse(
      'status-would-go-backwards',
      'An attempt does not move backwards through submission. Undo the last action instead.',
    );
  }
  if (submissionRank(action.to) >= submissionRank('submitted') && attempt.kilograms === null) {
    return refuse(
      'weight-required-before-submitting',
      'Choose a weight before marking the attempt submitted.',
    );
  }
  if (
    submissionRank(action.to) >= submissionRank('submitted') &&
    attempt.kilograms !== null &&
    nextAttemptOn(lifter, attempt.lift)?.id === attempt.id
  ) {
    const legality = rules.isLegalNextAttempt(takenOn(lifter, attempt.lift), attempt.kilograms);
    if (!legality.legal) {
      return refuse('weight-not-legal', describeRefusal(legality.reasons, attempt.kilograms));
    }
  }

  const updated: LiveAttempt = {
    ...attempt,
    status: action.to,
    submittedAt:
      submissionRank(action.to) >= submissionRank('submitted') && attempt.submittedAt === null
        ? at
        : attempt.submittedAt,
  };
  return commit(timeline, action, at, replaceLifter(document, replaceAttempt(lifter, updated)));
}

function recordResult(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'record-result' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const found = findAttempt(document, action.attemptId);
  if (found === null) return refuse('unknown-attempt', 'That attempt is not in this meet.');
  const { lifter, attempt } = found;

  if (isResolved(attempt)) {
    return refuse(
      'attempt-already-resolved',
      'That attempt already has a result. Undo it first if it was recorded by mistake.',
    );
  }
  const { result } = action;
  if (result.outcome === 'good' && result.rpe != null) {
    // §12.2 lets an advanced user give RPE instead of the plain-language effort.
    // Bounded because an out-of-range figure would feed a comparison in
    // `live-choices.ts` that has no answer for it.
    if (
      !Number.isFinite(result.rpe) ||
      result.rpe < RPE_BOUNDS.min ||
      result.rpe > RPE_BOUNDS.max
    ) {
      return refuse(
        'rpe-out-of-range',
        `RPE is recorded on the usual ${String(RPE_BOUNDS.min)} to ${String(RPE_BOUNDS.max)} scale.`,
      );
    }
  }

  let updatedLifter = replaceAttempt(lifter, {
    ...attempt,
    status: result.outcome,
    effort: result.outcome === 'good' ? result.effort : null,
    rpe: result.outcome === 'good' ? (result.rpe ?? null) : null,
    missReason: result.outcome === 'no-lift' ? result.reason : null,
  });

  if (result.outcome === 'extra-attempt-granted') {
    updatedLifter = appendExtraAttempt(updatedLifter, attempt);
    // No countdown. §13.8 says not to assume when an extra attempt will occur,
    // and a clock is the strongest possible assumption about when something is
    // due -- one running here would have a coach declaring against a deadline
    // the expeditor never set.
    updatedLifter = { ...updatedLifter, countdown: null };
  } else {
    updatedLifter = startCountdown(rules, updatedLifter, attempt.lift, at);
  }

  return commit(timeline, action, at, replaceLifter(document, updatedLifter));
}

function appendExtraAttempt(lifter: LiveLifter, original: LiveAttempt): LiveLifter {
  const extra: LiveAttempt = {
    ...blankAttempt(
      `${lifter.id}-extra-${String(lifter.nextAttemptOrdinal)}`,
      original.lift,
      original.attemptNumber,
    ),
    kind: 'extra',
    // The weight carries over: an extra attempt is a second go at the attempt
    // that was disrupted, so pre-filling it is describing what happened rather
    // than recommending anything.
    kilograms: original.kilograms,
    grantedFor: original.id,
  };
  return {
    ...lifter,
    attempts: [...lifter.attempts, extra],
    nextAttemptOrdinal: lifter.nextAttemptOrdinal + 1,
  };
}

function startCountdown(
  rules: MeetRules,
  lifter: LiveLifter,
  lift: PlatformLift,
  at: number,
): LiveLifter {
  const next = nextAttemptOn(lifter, lift);
  if (next === null) return { ...lifter, countdown: null };
  return {
    ...lifter,
    countdown: {
      attemptId: next.id,
      startedAt: at,
      seconds:
        next.kind === 'record'
          ? (rules.profile.fourthAttempt?.submissionSeconds ?? rules.profile.submissionSeconds)
          : rules.profile.submissionSeconds,
    },
  };
}

function grantExtraAttempt(
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'grant-extra-attempt' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const found = findAttempt(document, action.attemptId);
  if (found === null) return refuse('unknown-attempt', 'That attempt is not in this meet.');
  const { lifter, attempt } = found;

  // The ruling normally arrives after the miss has been recorded, which is why
  // this is an action of its own rather than only an outcome: the coach taps No
  // Lift when the lights go up and the referee's decision follows.
  if (attempt.status !== 'no-lift') {
    return refuse(
      'not-a-missed-attempt',
      'An extra attempt replaces one that was recorded as a no lift.',
    );
  }

  const updated = appendExtraAttempt(
    replaceAttempt(lifter, { ...attempt, status: 'extra-attempt-granted', missReason: null }),
    attempt,
  );
  return commit(timeline, action, at, replaceLifter(document, { ...updated, countdown: null }));
}

function annotateAttempt(
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'annotate-attempt' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const found = findAttempt(document, action.attemptId);
  if (found === null) return refuse('unknown-attempt', 'That attempt is not in this meet.');
  const { lifter, attempt } = found;

  const note = action.note === undefined ? attempt.note : (action.note?.trim() ?? null);
  if (note !== null && note.length > MAX_ATTEMPT_NOTE_LENGTH) {
    // Refused rather than truncated. A note silently cut at five hundred
    // characters is a note whose last sentence was the point of writing it.
    return refuse(
      'note-too-long',
      `A note is limited to ${String(MAX_ATTEMPT_NOTE_LENGTH)} characters.`,
    );
  }

  const updated: LiveAttempt = {
    ...attempt,
    lights: action.lights === undefined ? attempt.lights : action.lights,
    note: note === '' ? null : note,
  };
  return commit(timeline, action, at, replaceLifter(document, replaceAttempt(lifter, updated)));
}

function addRecordAttempt(
  rules: MeetRules,
  timeline: MeetTimeline,
  action: Extract<MeetAction, { kind: 'add-record-attempt' }>,
  at: number,
): MeetActionResult {
  const document = timeline.present;
  const lifter = findLifter(document, action.lifterId);
  if (lifter === null) return refuse('unknown-lifter', 'That lifter is not in this meet.');

  const third = attemptsOn(lifter, action.lift)
    .filter((attempt) => attempt.kind === 'competition')
    .reduce<LiveAttempt | null>(
      (latest, attempt) =>
        latest === null || attempt.attemptNumber > latest.attemptNumber ? attempt : latest,
      null,
    );
  if (third?.kilograms == null || !isResolved(third)) {
    return refuse(
      'record-attempt-not-available',
      'A record attempt follows the last competition attempt on the lift, which has not been taken yet.',
    );
  }

  const eligibility = rules.fourthAttemptEligibility({
    thirdAttempt: {
      attemptNumber: third.attemptNumber,
      kilograms: third.kilograms,
      outcome: third.status === 'good' ? 'good' : third.status === 'no-lift' ? 'no-lift' : 'passed',
    },
    recordKilograms: action.recordKilograms,
  });
  if (!eligibility.eligible) {
    return refuse('record-attempt-not-available', describeFourthRefusal(eligibility.reasons));
  }
  if (action.kilograms < eligibility.minimumKilograms) {
    return refuse(
      'weight-not-legal',
      `A record attempt has to be at least ${String(eligibility.minimumKilograms)} kg to beat the record supplied.`,
    );
  }

  const attempt: LiveAttempt = {
    ...blankAttempt(
      `${lifter.id}-record-${String(lifter.nextAttemptOrdinal)}`,
      action.lift,
      third.attemptNumber + 1,
    ),
    kind: 'record',
    kilograms: action.kilograms,
  };
  const updated: LiveLifter = {
    ...lifter,
    attempts: [...lifter.attempts, attempt],
    nextAttemptOrdinal: lifter.nextAttemptOrdinal + 1,
  };
  return commit(timeline, action, at, replaceLifter(document, updated));
}

function describeFourthRefusal(reasons: readonly string[]): string {
  const clauses = reasons.map((reason) => {
    switch (reason) {
      case 'not-offered':
        return 'these rules do not have fourth attempts';
      case 'third-attempt-not-successful':
        return 'the last competition attempt was not a good lift';
      case 'no-record-supplied':
        return 'no record was given to measure against';
      default:
        return 'the lifter is further from the record than these rules allow';
    }
  });
  return `No record attempt is available: ${clauses.join('; ')}.`;
}

// -----------------------------------------------------------------------------
// Undo
// -----------------------------------------------------------------------------

/** The action the next undo would reverse, so a control can name it. */
export function undoableAction(timeline: MeetTimeline): MeetAction | null {
  return timeline.past.at(-1)?.action ?? null;
}

/**
 * Step back to the world before the last action.
 *
 * Restores everything at once because everything is one value -- there is no list
 * of things to remember to reverse, which is the only way §13.9's list stays
 * complete as features are added above it.
 */
export function undo(timeline: MeetTimeline): MeetActionResult {
  const step = timeline.past.at(-1);
  if (step === undefined) {
    return refuse('nothing-to-undo', 'There is nothing to undo.');
  }
  return {
    ok: true,
    timeline: { present: step.document, past: timeline.past.slice(0, -1) },
  };
}
