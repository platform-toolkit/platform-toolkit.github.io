// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  ASSUMED_SECONDS_PER_ATTEMPT,
  MEET_STAFF_ARE_AUTHORITATIVE,
  MIN_ATTEMPTS_FOR_OBSERVED_PACE,
  PACE_SPREAD,
  assumedPace,
  observedPace,
  platformEstimate,
  type FlightPosition,
  type MeetPace,
  type PlatformEstimate,
  type PlatformEstimateRequest,
} from './platform-timing.js';

/**
 * Every figure here is derived, and the two paces differ only in their label.
 *
 * The claim the module makes is that the spread is a property of where the pace
 * came from rather than of the number it carries, so the observed and assumed
 * paces below are the same seconds-per-attempt. A test that compared a measured
 * 48 seconds against an assumed 60 would widen for the wrong reason and would go
 * on passing if the spread table were deleted.
 */
const MINUTE = 60;

const OBSERVED: MeetPace = { secondsPerAttempt: ASSUMED_SECONDS_PER_ATTEMPT, source: 'observed' };
const SUPPLIED: MeetPace = { secondsPerAttempt: ASSUMED_SECONDS_PER_ATTEMPT, source: 'supplied' };

/** A flight partway through its first round, with the lifter two places back. */
const OWN_FLIGHT: FlightPosition = {
  kind: 'own-flight-running',
  currentRound: 1,
  currentPosition: 3,
};

const FLIGHT_SIZE = 10;
const ATTEMPTS_PER_LIFT = 3;

function request(patch: Partial<PlatformEstimateRequest> = {}): PlatformEstimateRequest {
  return {
    position: OWN_FLIGHT,
    flightSize: FLIGHT_SIZE,
    attemptsPerLift: ATTEMPTS_PER_LIFT,
    targetRound: 2,
    targetPosition: 5,
    pace: OBSERVED,
    ...patch,
  };
}

function codes(estimate: PlatformEstimate): readonly string[] {
  return estimate.advisories.map((advisory) => advisory.code);
}

function width(estimate: PlatformEstimate): number {
  return estimate.latestSeconds - estimate.earliestSeconds;
}

describe('observedPace', () => {
  it('refuses to call a handful of attempts a measurement', () => {
    const tooFew = MIN_ATTEMPTS_FOR_OBSERVED_PACE - 1;
    expect(observedPace(tooFew, tooFew * 55)).toBeNull();

    // The control: one more attempt over the same pace is a measurement, and it
    // is the measured figure rather than the assumed one.
    const enough = observedPace(
      MIN_ATTEMPTS_FOR_OBSERVED_PACE,
      MIN_ATTEMPTS_FOR_OBSERVED_PACE * 55,
    );
    expect(enough).toEqual({ secondsPerAttempt: 55, source: 'observed' });
    expect(enough?.secondsPerAttempt).not.toBe(ASSUMED_SECONDS_PER_ATTEMPT);
  });

  it('never substitutes a guess for a measurement it does not have', () => {
    for (const answer of [
      observedPace(0, 0),
      observedPace(MIN_ATTEMPTS_FOR_OBSERVED_PACE, 0),
      observedPace(MIN_ATTEMPTS_FOR_OBSERVED_PACE, -600),
      observedPace(Number.NaN, 600),
      observedPace(MIN_ATTEMPTS_FOR_OBSERVED_PACE, Number.POSITIVE_INFINITY),
    ]) {
      expect(answer).toBeNull();
    }
    // If any of those had fallen back, this is the value it would have fallen
    // back to, and it would have been labelled as observed.
    expect(assumedPace()).toEqual({
      secondsPerAttempt: ASSUMED_SECONDS_PER_ATTEMPT,
      source: 'assumed',
    });
  });
});

describe('platformEstimate', () => {
  it('says the meet staff are authoritative on every estimate, including the odd ones', () => {
    const everyShape = [
      request(),
      request({ pace: assumedPace() }),
      request({ delaySeconds: 20 * MINUTE }),
      // The attempt is behind the lifter, which is the estimate most likely to be
      // treated as an error case and quietly stripped of its advisories.
      request({ targetRound: 1, targetPosition: 1 }),
    ];
    for (const shape of everyShape) {
      const estimate = platformEstimate(shape);
      expect(codes(estimate)).toContain('meet-staff-are-authoritative');
      expect(estimate.advisories[0]?.message).toBe(MEET_STAFF_ARE_AUTHORITATIVE);
    }
  });

  it('answers with a range rounded outward that never collapses to a point', () => {
    // Deliberately including the case with nothing ahead of the lifter, where the
    // computed span is zero seconds wide and honest rounding alone would print
    // "0-0 minutes".
    for (const shape of [request(), request({ targetRound: 1, targetPosition: 3 })]) {
      const estimate = platformEstimate(shape);
      expect(estimate.earliestSeconds % MINUTE).toBe(0);
      expect(estimate.latestSeconds % MINUTE).toBe(0);
      expect(estimate.earliestSeconds).toBeGreaterThanOrEqual(0);
      expect(width(estimate)).toBeGreaterThanOrEqual(MINUTE);
    }
  });

  it('rounds the ends outward rather than to the nearest minute', () => {
    // Chosen so nearest-minute rounding would move both ends the wrong way: seven
    // attempts at 40 s is 280 s, and 15% either side is 238 and 322. Rounded to
    // the nearest minute that reads 4-5 minutes; rounded outward it reads 3-6, and
    // the difference is a warm-up single taken a minute too late.
    const pace: MeetPace = { secondsPerAttempt: 40, source: 'observed' };
    const estimate = platformEstimate(
      request({
        pace,
        position: { kind: 'own-flight-running', currentRound: 1, currentPosition: 8 },
      }),
    );
    expect(estimate.attemptsBefore).toBe(7);

    const paced = estimate.attemptsBefore * pace.secondsPerAttempt;
    const spread = PACE_SPREAD.observed;
    const low = paced * (1 - spread);
    const high = paced * (1 + spread);
    expect(estimate.earliestSeconds).toBe(Math.floor(low / MINUTE) * MINUTE);
    expect(estimate.latestSeconds).toBe(Math.ceil(high / MINUTE) * MINUTE);
    // The assertions that fail if either end is rounded to the nearest minute
    // instead, which is the mistake that looks tidier and reports a narrower
    // range than the one that was computed.
    expect(estimate.earliestSeconds).toBeLessThan(Math.round(low / MINUTE) * MINUTE);
    expect(estimate.latestSeconds).toBeGreaterThan(Math.round(high / MINUTE) * MINUTE);
  });

  it('keeps the paced figure inside the range it draws', () => {
    const estimate = platformEstimate(request());
    const paced = estimate.attemptsBefore * OBSERVED.secondsPerAttempt;
    expect(estimate.earliestSeconds).toBeLessThanOrEqual(paced);
    expect(estimate.latestSeconds).toBeGreaterThanOrEqual(paced);
  });

  it('widens the range for a pace nobody measured, and says which it used', () => {
    const measured = platformEstimate(request({ pace: OBSERVED }));
    const supplied = platformEstimate(request({ pace: SUPPLIED }));
    const guessed = platformEstimate(request({ pace: assumedPace() }));

    // Same position, same seconds per attempt, three different labels.
    expect(measured.attemptsBefore).toBe(guessed.attemptsBefore);
    expect(OBSERVED.secondsPerAttempt).toBe(assumedPace().secondsPerAttempt);
    expect(PACE_SPREAD.observed).toBeLessThan(PACE_SPREAD.supplied);
    expect(PACE_SPREAD.supplied).toBeLessThan(PACE_SPREAD.assumed);
    expect(width(measured)).toBeLessThan(width(supplied));
    expect(width(supplied)).toBeLessThan(width(guessed));

    expect(codes(guessed)).toContain('pace-is-assumed');
    // The control: a measured pace does not carry the caution.
    expect(codes(measured)).not.toContain('pace-is-assumed');
    expect(measured.pace).toEqual(OBSERVED);
  });

  it('moves the timeline for a delay and does not widen it', () => {
    const onTime = platformEstimate(request());
    const late = platformEstimate(request({ delaySeconds: 5 * MINUTE }));

    expect(late.earliestSeconds).toBe(onTime.earliestSeconds + 5 * MINUTE);
    expect(late.latestSeconds).toBe(onTime.latestSeconds + 5 * MINUTE);
    // A delay is a fact rather than a forecast, so it buys no extra uncertainty.
    expect(width(late)).toBe(width(onTime));
    expect(late.delaySeconds).toBe(5 * MINUTE);
    expect(late.attemptsBefore).toBe(onTime.attemptsBefore);
    expect(codes(late)).toContain('the-meet-is-running-late');
    expect(codes(onTime)).not.toContain('the-meet-is-running-late');
  });

  it('treats a scheduled break as a published figure, not as a delay', () => {
    const straight = platformEstimate(request());
    const withBreak = platformEstimate(request({ plannedBreakSeconds: 20 * MINUTE }));

    expect(withBreak.earliestSeconds).toBe(straight.earliestSeconds + 20 * MINUTE);
    expect(width(withBreak)).toBe(width(straight));
    // A break on the schedule is not the meet running late, and saying so would
    // send a handler looking for a problem that does not exist.
    expect(codes(withBreak)).not.toContain('the-meet-is-running-late');
    expect(withBreak.delaySeconds).toBe(0);
  });

  it('counts the attempts ahead within the lifter own flight', () => {
    const estimate = platformEstimate(request());
    // Hand-derived: one whole round of ten, then from third on the platform to
    // fifth in the next round.
    expect(estimate.attemptsBefore).toBe(FLIGHT_SIZE + (5 - 3));

    // Same round, further down the order: only the places between count.
    const sameRound = platformEstimate(request({ targetRound: 1, targetPosition: 9 }));
    expect(sameRound.attemptsBefore).toBe(9 - 3);
  });

  it('counts whole flights of every attempt when an earlier flight is on the platform', () => {
    const position: FlightPosition = {
      kind: 'earlier-flight-running',
      attemptsLeftInTheRunningFlight: 7,
      wholeFlightsBetween: 1,
    };
    const estimate = platformEstimate(request({ position, targetRound: 1, targetPosition: 4 }));
    // Hand-derived: 7 left in the flight on the platform, a whole flight of ten
    // lifters taking three attempts each in between, then three lifters ahead in
    // the opening round of the lifter's own flight.
    expect(estimate.attemptsBefore).toBe(7 + FLIGHT_SIZE * ATTEMPTS_PER_LIFT + 3);

    // The control, which is what proves `attemptsPerLift` is read rather than
    // assumed: dropping the flight in between removes a whole flight of attempts.
    const adjacent = platformEstimate(
      request({
        position: { ...position, wholeFlightsBetween: 0 },
        targetRound: 1,
        targetPosition: 4,
      }),
    );
    expect(estimate.attemptsBefore - adjacent.attemptsBefore).toBe(FLIGHT_SIZE * ATTEMPTS_PER_LIFT);
  });

  it('warns that the order can still move, and stops once it cannot', () => {
    expect(codes(platformEstimate(request({ targetRound: 2 })))).toContain(
      'lifting-order-can-change',
    );
    expect(
      codes(
        platformEstimate(
          request({
            position: {
              kind: 'earlier-flight-running',
              attemptsLeftInTheRunningFlight: 4,
              wholeFlightsBetween: 0,
            },
            targetRound: 1,
          }),
        ),
      ),
    ).toContain('lifting-order-can-change');
    // The control: the round now running has a settled order.
    expect(codes(platformEstimate(request({ targetRound: 1, targetPosition: 9 })))).not.toContain(
      'lifting-order-can-change',
    );
  });

  it('says an attempt is not ahead rather than counting backwards to it', () => {
    const behind = platformEstimate(request({ targetRound: 1, targetPosition: 1 }));
    expect(behind.attemptsBefore).toBe(0);
    expect(behind.earliestSeconds).toBe(0);
    expect(codes(behind)).toContain('the-attempt-is-not-ahead');

    // The control: one place ahead is ahead, and says nothing.
    const ahead = platformEstimate(request({ targetRound: 1, targetPosition: 4 }));
    expect(ahead.attemptsBefore).toBe(1);
    expect(codes(ahead)).not.toContain('the-attempt-is-not-ahead');
  });

  it('reads no clock, so the same question twice is the same answer', () => {
    // The property `live-choices.ts` has for the same reason: an estimate that
    // moved between two calls could not survive an undo or a refresh.
    const shape = request({ delaySeconds: 90, plannedBreakSeconds: 300 });
    expect(platformEstimate(shape)).toEqual(platformEstimate(shape));
  });
});
