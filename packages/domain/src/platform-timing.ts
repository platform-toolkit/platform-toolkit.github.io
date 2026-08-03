// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20.1: when is this lifter up?
 *
 * The answer is the input to everything a handler does in the twenty minutes
 * before an attempt -- when the wraps go on, when the last warm-up single is
 * taken, whether there is time for a sip of coffee -- and it is an estimate about
 * a room this application cannot see. So the shape of the answer matters more than
 * its accuracy, and three decisions here are about the shape.
 *
 * IT IS A RANGE, AND IT IS ROUNDED OUTWARD TO WHOLE MINUTES
 *
 * §20.1 asks for "Estimated platform time: 18-24 minutes" and says to avoid false
 * precision. A single figure would be false precision by construction: the pace of
 * a flight is not a constant, and a number carrying seconds implies a clock that
 * this tool is not reading. The range is widened by however uncertain the pace is
 * -- see {@link PACE_SPREAD} -- and then rounded outward, so the figures a lifter
 * reads are always at least as wide as the figures that were computed. Rounding a
 * range inward would be the only rounding here that could make it wrong.
 *
 * NO CLOCK IS READ, ANYWHERE
 *
 * Every figure in and out of this module is a duration in seconds, never a time of
 * day. That is the same property `live-choices.ts` has for the same reason: a pure
 * function of the meet's state can be recomputed after an undo, after a refresh,
 * and inside a test that runs in a millisecond, and none of those work if the
 * answer depends on when it was asked. The caller stamps a clock against the range
 * to draw it, which is a rendering decision and belongs on the other side of the
 * seam.
 *
 * A DELAY MOVES THE TIMELINE
 *
 * It is added to the estimate and it is said out loud, and it does nothing else.
 * §20.1 is explicit that a delay must not silently produce extra warm-up sets, and
 * the way to guarantee that is for the delay to be a number in this file and not a
 * branch in the file that builds the ramp.
 *
 * WHAT IT NEVER CLAIMS
 *
 * {@link MEET_STAFF_ARE_AUTHORITATIVE} is on every estimate. §20.1 says never to
 * imply the estimate overrides announcements from meet staff, and an advisory that
 * appears only when something looks wrong would be an implication by omission the
 * rest of the time.
 */

/** The sentence §20.1 requires on every estimate, verbatim. */
export const MEET_STAFF_ARE_AUTHORITATIVE =
  'This is an estimate. Announcements from meet staff are what actually happen.';

/** Where the figure for one attempt's duration came from. */
export type PaceSource =
  /** Measured from what this session has actually run. */
  | 'observed'
  /** The user or the meet supplied it. */
  | 'supplied'
  /** Nobody supplied one and nothing has been measured yet. */
  | 'assumed';

/** How long one attempt takes, and how much that figure is worth. */
export interface MeetPace {
  /** Bar loaded to bar cleared, including the change between lifters. */
  readonly secondsPerAttempt: number;
  readonly source: PaceSource;
}

/**
 * The pace to use before anything has been measured.
 *
 * A minute an attempt is the round figure every handler uses, and it is a product
 * decision rather than a measurement -- which is why an estimate resting on it is
 * given the widest spread of the three sources rather than being presented as
 * though it were observed.
 */
export const ASSUMED_SECONDS_PER_ATTEMPT = 60;

/**
 * How far either side of the estimate the range runs, by where the pace came from.
 *
 * The point of §20.1 is not to be right about the pace; it is not to sound right
 * about it. An assumed minute an attempt drawn as "18-24 minutes" claims exactly
 * as much as a pace measured over forty attempts of this session, and the second
 * one has earned it. So the spread is a property of the source.
 */
export const PACE_SPREAD: Readonly<Record<PaceSource, number>> = {
  observed: 0.15,
  supplied: 0.2,
  assumed: 0.35,
};

/**
 * Attempts that have to have run before a session's pace means anything.
 *
 * Fewer than this and the figure is one slow lifter and a loading error. The
 * fallback is not a narrower guess; it is the assumed pace, labelled as assumed.
 */
export const MIN_ATTEMPTS_FOR_OBSERVED_PACE = 5;

const MINUTE_SECONDS = 60;

/**
 * Where the lifter sits relative to the platform.
 *
 * Two cases rather than one set of fields with some of them ignored, because a
 * handler reads two completely different things off the board depending on whether
 * their lifter's flight is up. While an earlier flight is running, nobody knows or
 * cares which round it is in -- what is visible is how much of it is left. Once the
 * lifter's own flight is on the platform, the round and the position are the whole
 * picture and the flight-counting is over.
 */
export type FlightPosition =
  | {
      readonly kind: 'own-flight-running';
      /** The round now running in this flight, 1-based. */
      readonly currentRound: number;
      /**
       * The position now on the platform, 1-based.
       *
       * 0 before the round has started, which makes the whole round lie ahead.
       */
      readonly currentPosition: number;
    }
  | {
      readonly kind: 'earlier-flight-running';
      /** Attempts still to run in the flight now on the platform. */
      readonly attemptsLeftInTheRunningFlight: number;
      /** Whole flights between the one on the platform and the lifter's. */
      readonly wholeFlightsBetween: number;
    };

export interface PlatformEstimateRequest {
  readonly position: FlightPosition;

  /** Lifters in the user's flight. */
  readonly flightSize: number;

  /** Attempts each lifter takes on this lift, from the rule profile. */
  readonly attemptsPerLift: number;

  /** The round the lifter is asking about, 1-based. */
  readonly targetRound: number;

  /**
   * The lifter's estimated position in that round, 1-based.
   *
   * Estimated, and named so. Lifting order follows declared weights and those
   * change between rounds, which is why §20.1 asks for the estimate to be
   * recomputed rather than stored -- and why an estimate about a later round says
   * so in an advisory.
   */
  readonly targetPosition: number;

  readonly pace: MeetPace;

  /**
   * Scheduled breaks falling between now and the attempt, in seconds.
   *
   * Exact rather than paced: a twenty-minute break between the squat and the bench
   * is a number on the schedule, and widening the range on account of it would
   * blur a figure the meet has already published.
   */
  readonly plannedBreakSeconds?: number | undefined;

  /**
   * Delay already accumulated, in seconds.
   *
   * Moves the timeline and nothing else. A delay is not evidence that the pace
   * changed -- a broken monolift costs twenty minutes and then the flight runs at
   * exactly the speed it did before -- so it is added after the paced part and
   * left out of the spread.
   */
  readonly delaySeconds?: number | undefined;
}

export type TimingAdvisoryCode =
  /** Always present. */
  | 'meet-staff-are-authoritative'
  /** No pace has been measured, so the range is as wide as the guess behind it. */
  | 'pace-is-assumed'
  /** The estimate is about a later round, whose lifting order is not settled. */
  | 'lifting-order-can-change'
  /** The meet is behind and the whole timeline has moved with it. */
  | 'the-meet-is-running-late'
  /** The attempt asked about is not ahead of the lifter. */
  | 'the-attempt-is-not-ahead';

export type TimingAdvisorySeverity = 'note' | 'caution';

export interface TimingAdvisory {
  readonly code: TimingAdvisoryCode;
  readonly severity: TimingAdvisorySeverity;
  readonly message: string;
}

export interface PlatformEstimate {
  /** Attempts that have to run before this one. */
  readonly attemptsBefore: number;

  readonly pace: MeetPace;

  /**
   * The near end of the range, in seconds from now, rounded down to a whole minute.
   *
   * This is the figure to plan backward from. Being ready early costs a lifter a
   * few minutes standing about; being ready late costs the attempt, and §5.5's
   * rounding-as-a-safety-property argument applies to time exactly as it does to
   * weight.
   */
  readonly earliestSeconds: number;

  /** The far end, rounded up to a whole minute. Always at least a minute above. */
  readonly latestSeconds: number;

  /** Delay folded into both ends, carried so a screen can say where it came from. */
  readonly delaySeconds: number;

  readonly advisories: readonly TimingAdvisory[];
}

/**
 * The pace this session has actually run at, or `null` if it is too early to say.
 *
 * `secondsElapsed` is measured from the session start, which is §20.1's first
 * input, and it arrives as a duration rather than a timestamp so that nothing in
 * this file has to read a clock.
 *
 * Returns `null` rather than the assumed pace. The caller has to decide what to do
 * without a measurement, and a function that quietly substituted a guess would make
 * `source: 'observed'` mean "observed or not, who can say".
 */
export function observedPace(attemptsCompleted: number, secondsElapsed: number): MeetPace | null {
  if (!Number.isFinite(attemptsCompleted) || !Number.isFinite(secondsElapsed)) return null;
  if (attemptsCompleted < MIN_ATTEMPTS_FOR_OBSERVED_PACE || secondsElapsed <= 0) return null;
  return { secondsPerAttempt: secondsElapsed / attemptsCompleted, source: 'observed' };
}

/** The pace to fall back to, labelled so nothing downstream can mistake it. */
export function assumedPace(): MeetPace {
  return { secondsPerAttempt: ASSUMED_SECONDS_PER_ATTEMPT, source: 'assumed' };
}

/**
 * How many attempts run before the one being asked about.
 *
 * Negative results are clamped by the caller rather than here, because the sign is
 * the information: a lifter asking about a round that has already run needs to be
 * told that, and a function returning zero for both "you are up next" and "that
 * already happened" cannot.
 */
function attemptsBeforeTarget(request: PlatformEstimateRequest): number {
  const { position, flightSize, attemptsPerLift, targetRound, targetPosition } = request;

  if (position.kind === 'own-flight-running') {
    const rounds = targetRound - position.currentRound;
    return rounds * flightSize + (targetPosition - position.currentPosition);
  }

  // The lifter's flight has not started, so every attempt in it up to theirs lies
  // ahead of them, whichever round they are asking about.
  return (
    position.attemptsLeftInTheRunningFlight +
    position.wholeFlightsBetween * flightSize * attemptsPerLift +
    (targetRound - 1) * flightSize +
    (targetPosition - 1)
  );
}

/**
 * Rounds a span outward to whole minutes and keeps it a span.
 *
 * The floor and the ceiling are what stop the displayed range being narrower than
 * the computed one. The widening afterwards is what stops "4-4 minutes", which is
 * a range in shape and a point estimate in what it tells a reader -- and this
 * module exists to not do that.
 */
function toWholeMinuteRange(
  low: number,
  high: number,
): { readonly earliestSeconds: number; readonly latestSeconds: number } {
  const earliest = Math.max(0, Math.floor(low / MINUTE_SECONDS) * MINUTE_SECONDS);
  const ceiling = Math.ceil(high / MINUTE_SECONDS) * MINUTE_SECONDS;
  return {
    earliestSeconds: earliest,
    latestSeconds: Math.max(ceiling, earliest + MINUTE_SECONDS),
  };
}

function advisoriesFor(
  request: PlatformEstimateRequest,
  attemptsBefore: number,
  delaySeconds: number,
): readonly TimingAdvisory[] {
  const advisories: TimingAdvisory[] = [
    {
      code: 'meet-staff-are-authoritative',
      severity: 'note',
      message: MEET_STAFF_ARE_AUTHORITATIVE,
    },
  ];

  if (request.pace.source === 'assumed') {
    advisories.push({
      code: 'pace-is-assumed',
      severity: 'caution',
      message: 'Nothing has been timed yet, so this range is as wide as the guess behind it.',
    });
  }

  const laterRound =
    request.position.kind === 'earlier-flight-running' ||
    request.targetRound > request.position.currentRound;
  if (laterRound) {
    advisories.push({
      code: 'lifting-order-can-change',
      severity: 'note',
      message: 'Lifting order follows declared weights, so this position can still move.',
    });
  }

  if (delaySeconds > 0) {
    advisories.push({
      code: 'the-meet-is-running-late',
      severity: 'note',
      message: 'The meet is behind, so the whole warm-up timeline has moved with it.',
    });
  }

  if (attemptsBefore <= 0) {
    advisories.push({
      code: 'the-attempt-is-not-ahead',
      severity: 'caution',
      message: 'Nothing is between this lifter and the platform.',
    });
  }

  return advisories;
}

/**
 * When the lifter is up, as a range in seconds from now.
 *
 * Total: every combination of inputs produces an estimate, including the ones that
 * describe an attempt already behind the lifter. A screen at an expeditor's table
 * has nothing useful to do with a thrown error.
 */
export function platformEstimate(request: PlatformEstimateRequest): PlatformEstimate {
  const delaySeconds = Math.max(0, request.delaySeconds ?? 0);
  const breaks = Math.max(0, request.plannedBreakSeconds ?? 0);
  const raw = attemptsBeforeTarget(request);
  const attemptsBefore = Math.max(0, raw);

  const paced = attemptsBefore * request.pace.secondsPerAttempt;
  const spread = PACE_SPREAD[request.pace.source];
  // The spread applies to the paced part only. A scheduled break and an observed
  // delay are both facts rather than forecasts, so widening the range on their
  // account would blur two of the few figures here that are not guesses.
  const fixed = breaks + delaySeconds;

  return {
    attemptsBefore,
    pace: request.pace,
    ...toWholeMinuteRange(paced * (1 - spread) + fixed, paced * (1 + spread) + fixed),
    delaySeconds,
    advisories: advisoriesFor(request, raw, delaySeconds),
  };
}
