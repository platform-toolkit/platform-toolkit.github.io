// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rest timer as arithmetic, which is the only place it can be tested honestly.
 *
 * Every assertion here hands the functions an instant it chose. That is the whole
 * reason the timer holds an end rather than a count: a test can put a three-minute
 * rest in a pocket for four minutes and assert what comes back, and the same test on a
 * decrementing counter would have to wait four real minutes to find out.
 */

import { describe, expect, it } from 'vitest';

import type { Instant, RestTimerSettings } from '../types.js';

import {
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  REST_STEP_SECONDS,
  adjustRest,
  clampRestSeconds,
  pauseRest,
  resetRest,
  restIsUp,
  restRemainingMillis,
  restSecondsFor,
  resumeRest,
  startRest,
  startRestFor,
} from './rest.js';

/** An invented instant, matching the fixtures the rest of the core is tested against. */
const AT: Instant = '2026-03-10T17:00:00.000Z';

/** An invented rest, long enough that a step either way lands somewhere distinct. */
const REST_SECONDS = 180;

const SQUAT = 'squat';

/** Instants relative to {@link AT}, so a test says how long has passed and not when. */
function after(seconds: number): Instant {
  return new Date(Date.parse(AT) + seconds * 1000).toISOString();
}

function settings(overrides: Partial<RestTimerSettings> = {}): RestTimerSettings {
  return { enabled: true, defaultSeconds: REST_SECONDS, perExerciseSeconds: {}, ...overrides };
}

describe('the duration a rest is configured for', () => {
  it('takes the exercise-specific entry over the default', () => {
    const chosen = settings({ perExerciseSeconds: { [SQUAT]: 300 } });
    expect(restSecondsFor(chosen, SQUAT)).toBe(300);
    expect(restSecondsFor(chosen, 'bench-press')).toBe(REST_SECONDS);
  });

  it('holds a stored number to something a screen can show', () => {
    // Section 10.7: a restored backup is not trusted. `CountSchema` accepts any
    // non-negative integer, so both of these are shapes a hand-edited file can carry
    // and neither is a rest -- one is up before it is drawn, the other outlasts the
    // session it is in.
    expect(restSecondsFor(settings({ defaultSeconds: 0 }), SQUAT)).toBe(MIN_REST_SECONDS);
    expect(restSecondsFor(settings({ defaultSeconds: 99_999 }), SQUAT)).toBe(MAX_REST_SECONDS);
    expect(clampRestSeconds(Number.NaN)).toBe(MIN_REST_SECONDS);
    expect(clampRestSeconds(90.4)).toBe(90);
  });
});

describe('starting a rest after a set', () => {
  it('ends the configured distance from the instant it was started at', () => {
    const timer = startRest(REST_SECONDS, AT);
    expect(timer).toStrictEqual({
      kind: 'running',
      endsAt: after(REST_SECONDS),
      totalSeconds: REST_SECONDS,
    });
  });

  it('is nothing at all when the lifter has the timer switched off', () => {
    // Not a stopped timer. Section 7.11 makes the feature optional and off has to mean
    // absent, or the logging screen draws a control that can do nothing.
    expect(startRestFor(settings({ enabled: false }), SQUAT, AT)).toBeNull();
  });

  it('starts the lift its own rest when it has one', () => {
    const timer = startRestFor(settings({ perExerciseSeconds: { [SQUAT]: 300 } }), SQUAT, AT);
    expect(timer).toStrictEqual({ kind: 'running', endsAt: after(300), totalSeconds: 300 });
  });
});

describe('what is left of a rest', () => {
  it('is the subtraction and not a count of ticks', () => {
    const timer = startRest(REST_SECONDS, AT);
    expect(restRemainingMillis(timer, AT)).toBe(REST_SECONDS * 1000);
    expect(restRemainingMillis(timer, after(60))).toBe(120_000);
    expect(restIsUp(timer, after(60))).toBe(false);
  });

  it('is zero rather than negative for a phone that came back out of a pocket late', () => {
    // The case the end timestamp exists for. A backgrounded tab is throttled to one
    // tick a minute and then to none, so this is the ordinary way a rest ends -- not
    // an edge case -- and the answer has to be "the rest is up", not minus a minute.
    const timer = startRest(REST_SECONDS, AT);
    expect(restRemainingMillis(timer, after(240))).toBe(0);
    expect(restIsUp(timer, after(240))).toBe(true);
  });
});

describe('the controls a lifter has over a running rest', () => {
  it('pauses at what was left and resumes with that much still to go', () => {
    const paused = pauseRest(startRest(REST_SECONDS, AT), after(60));
    expect(paused).toStrictEqual({
      kind: 'paused',
      remainingMillis: 120_000,
      totalSeconds: REST_SECONDS,
    });

    // The point of pausing: the clock ran for a minute and the timer did not.
    expect(restRemainingMillis(paused, after(600))).toBe(120_000);
    expect(resumeRest(paused, after(600))).toStrictEqual({
      kind: 'running',
      endsAt: after(720),
      totalSeconds: REST_SECONDS,
    });
  });

  it('extends and shortens by a step without moving what a reset goes back to', () => {
    const timer = startRest(REST_SECONDS, AT);
    const longer = adjustRest(timer, REST_STEP_SECONDS, after(60));
    expect(longer).toStrictEqual({
      kind: 'running',
      endsAt: after(60 + 150),
      totalSeconds: REST_SECONDS,
    });

    const shorter = adjustRest(longer, -REST_STEP_SECONDS, after(60));
    expect(restRemainingMillis(shorter, after(60))).toBe(120_000);
    expect(resetRest(longer, after(60))).toStrictEqual({
      kind: 'running',
      endsAt: after(60 + REST_SECONDS),
      totalSeconds: REST_SECONDS,
    });
  });

  it('lands on zero rather than owing the lifter time', () => {
    const timer = startRest(REST_SECONDS, AT);
    const shorter = adjustRest(adjustRest(timer, -300, AT), -300, AT);
    expect(restIsUp(shorter, AT)).toBe(true);
    // And the next press is still a shorten and not an underflow the reset inherits.
    expect(resetRest(shorter, AT).totalSeconds).toBe(REST_SECONDS);
  });

  it('adjusts a paused rest where it stands', () => {
    // Shorten must not be a resume. The lifter pressed one control.
    const paused = pauseRest(startRest(REST_SECONDS, AT), after(60));
    expect(adjustRest(paused, REST_STEP_SECONDS, after(600))).toStrictEqual({
      kind: 'paused',
      remainingMillis: 150_000,
      totalSeconds: REST_SECONDS,
    });
  });

  it('resets a paused rest into a running one', () => {
    // Reset is pressed by somebody taking the rest again, and one that came back
    // paused would need a second press to do what the first one asked for.
    const paused = pauseRest(startRest(REST_SECONDS, AT), after(60));
    expect(resetRest(paused, after(60))).toStrictEqual({
      kind: 'running',
      endsAt: after(60 + REST_SECONDS),
      totalSeconds: REST_SECONDS,
    });
  });

  it('leaves a timer alone when handed a clock it cannot read', () => {
    // Nothing in the shell produces one; a consumer supplying its own `now` can, and
    // the failure to defend against is an end of `NaN`, which shows a blank forever.
    const unreadable = 'not an instant';
    expect(startRest(REST_SECONDS, unreadable)).toStrictEqual({
      kind: 'paused',
      remainingMillis: REST_SECONDS * 1000,
      totalSeconds: REST_SECONDS,
    });

    const timer = startRest(REST_SECONDS, AT);
    expect(adjustRest(timer, REST_STEP_SECONDS, unreadable)).toStrictEqual(timer);
    expect(adjustRest(timer, Number.NaN, AT)).toStrictEqual(timer);
    expect(restRemainingMillis(timer, unreadable)).toBe(0);
  });
});
