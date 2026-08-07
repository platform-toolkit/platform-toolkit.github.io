// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rest timer, as a value.
 *
 * Section 7.11 asks for something simple that starts when a set is completed and can
 * be paused, reset, extended, shortened or dismissed, and it says twice over what it
 * does not want: not an interval engine, not a supersets engine, not workout
 * automation. So there is no schedule here and no sequence -- one duration, one end,
 * and six functions that turn one timer into the next.
 *
 * WHY AN END RATHER THAN A COUNT
 *
 * A running timer holds the instant it ends at, never a number of seconds left.
 * Section 7.11 asks for that in as many words ("uses a target end timestamp so app
 * suspension does not make the timer inaccurate") and the reason is the device this
 * runs on: a phone goes in a pocket between sets, the tab is backgrounded, and the
 * browser throttles its timers to one a second, then to one a minute, then stops them.
 * A counter decremented on a tick would come back from a three-minute rest showing two
 * minutes left and send a lifter back to the bar early. A subtraction from the clock
 * cannot drift, and a missed tick costs a repaint rather than a number.
 *
 * A paused timer is the other half of the same idea: there is no end to subtract from
 * while nothing is running, so it holds what was left when the lifter pressed pause.
 * The two shapes are what make {@link restRemainingMillis} total -- every timer has an
 * answer, and neither state has a field the other has to ignore.
 *
 * Nothing here reads a clock. `at` is passed in, like everywhere else in this package.
 */

import type { Instant, RestTimerSettings } from '../types.js';

/**
 * The shortest rest that can be configured, in seconds.
 *
 * Not a limit on what a lifter may do -- {@link adjustRest} will take a running timer
 * all the way to zero -- but on what can be *stored* as a duration. A settings record
 * carrying zero is a timer that is up the instant it starts, which reads on screen as
 * the feature being broken rather than as a setting somebody chose, and section 10.7
 * says a restored backup is not trusted: `CountSchema` accepts any non-negative
 * integer, so this is where a hand-edited file meets a number the screen can show.
 */
export const MIN_REST_SECONDS = 15;

/** The longest, for the same reason. An hour between sets is already not a rest. */
export const MAX_REST_SECONDS = 3600;

/** What one press of extend or shorten is worth. */
export const REST_STEP_SECONDS = 30;

/**
 * A rest that is running down, or one a lifter stopped.
 *
 * `totalSeconds` is on both because reset means "this rest again from the top", and
 * after an extend the timer no longer knows what the top was. It is deliberately not
 * moved by {@link adjustRest}: a lifter who takes another thirty seconds today has not
 * changed what a rest is, and if extend edited the total then reset would be the same
 * button pressed twice.
 */
export type RestTimer =
  | {
      readonly kind: 'running';
      readonly endsAt: Instant;
      readonly totalSeconds: number;
    }
  | {
      readonly kind: 'paused';
      readonly remainingMillis: number;
      readonly totalSeconds: number;
    };

/**
 * A configured duration held to something a screen can show.
 *
 * Rounded as well as clamped, because the arithmetic below is in milliseconds and a
 * fractional second would print as a whole one and then be off by less than one for
 * the rest of the rest -- long enough for the last second to sit on screen twice.
 */
export function clampRestSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_REST_SECONDS;
  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, Math.round(seconds)));
}

/**
 * How long the lifter rests after this lift.
 *
 * The per-exercise entry when there is one, the default otherwise. Section 7.11's
 * "optional exercise-specific duration" is optional in both directions: most lifts
 * never get an entry, and one that does is a number about that movement rather than a
 * setting the whole logbook now carries.
 */
export function restSecondsFor(settings: RestTimerSettings, exerciseId: string): number {
  const specific = settings.perExerciseSeconds[exerciseId];
  return clampRestSeconds(specific ?? settings.defaultSeconds);
}

/** A rest of this length, starting now. */
export function startRest(seconds: number, at: Instant): RestTimer {
  const totalSeconds = clampRestSeconds(seconds);
  const from = millis(at);
  // A clock this runtime cannot read leaves the timer paused at its full length rather
  // than running towards an end computed from `NaN`, which would show a blank forever.
  // Nothing in the shell can produce one; a consumer supplying its own `now` can.
  if (from === null) return { kind: 'paused', remainingMillis: totalSeconds * 1000, totalSeconds };
  return {
    kind: 'running',
    endsAt: new Date(from + totalSeconds * 1000).toISOString(),
    totalSeconds,
  };
}

/**
 * The rest this lift asks for, or `null` when the lifter has the timer switched off.
 *
 * `null` and not a stopped timer, so that a screen with no rest timer on it is a screen
 * with nothing there rather than one drawing a control at zero. Section 7.11 makes the
 * whole feature optional, and off has to mean absent.
 */
export function startRestFor(
  settings: RestTimerSettings,
  exerciseId: string,
  at: Instant,
): RestTimer | null {
  if (!settings.enabled) return null;
  return startRest(restSecondsFor(settings, exerciseId), at);
}

/**
 * How much rest is left, in whole milliseconds, never below zero.
 *
 * Clamped rather than allowed to go negative, because this package has no opinion
 * about a rest that ran over. The screen says the rest is up and goes on saying it
 * until the lifter dismisses it or does the next set; counting the overrun would be a
 * second number to read at the exact moment a lifter is not reading.
 */
export function restRemainingMillis(timer: RestTimer, at: Instant): number {
  if (timer.kind === 'paused') return Math.max(0, timer.remainingMillis);
  const now = millis(at);
  const end = millis(timer.endsAt);
  if (now === null || end === null) return 0;
  return Math.max(0, end - now);
}

/** Whether the rest has run out. */
export function restIsUp(timer: RestTimer, at: Instant): boolean {
  return restRemainingMillis(timer, at) === 0;
}

/**
 * Stops the clock, keeping what was left.
 *
 * A timer already up pauses at zero rather than refusing, so pause is a control that
 * always does the same thing. Pausing a paused timer is the timer.
 */
export function pauseRest(timer: RestTimer, at: Instant): RestTimer {
  if (timer.kind === 'paused') return timer;
  // A clock this runtime cannot read would pause at zero, throwing away a rest the
  // lifter is in the middle of. Leaving it running is the smaller wrong answer.
  if (millis(at) === null) return timer;
  return {
    kind: 'paused',
    remainingMillis: restRemainingMillis(timer, at),
    totalSeconds: timer.totalSeconds,
  };
}

/** Starts it again from where it stopped. */
export function resumeRest(timer: RestTimer, at: Instant): RestTimer {
  if (timer.kind === 'running') return timer;
  const from = millis(at);
  if (from === null) return timer;
  return {
    kind: 'running',
    endsAt: new Date(from + Math.max(0, timer.remainingMillis)).toISOString(),
    totalSeconds: timer.totalSeconds,
  };
}

/**
 * This rest again from the top, running.
 *
 * Running even when the timer was paused. Reset is pressed by somebody who has decided
 * to take the rest again, and one that came back paused would need a second press to do
 * the thing the first press was asking for.
 */
export function resetRest(timer: RestTimer, at: Instant): RestTimer {
  return startRest(timer.totalSeconds, at);
}

/**
 * Extend or shorten, by a signed number of seconds.
 *
 * One function for both because they are one operation with a sign, and a shorten that
 * takes the remainder past zero lands on zero -- a lifter pressing it twice at the end
 * of a rest means "I am going now", not "the rest ran over by forty seconds".
 *
 * A paused timer is adjusted where it stands and stays paused. Anything else would make
 * shorten a resume, which is not what the lifter pressed.
 */
export function adjustRest(timer: RestTimer, deltaSeconds: number, at: Instant): RestTimer {
  if (!Number.isFinite(deltaSeconds)) return timer;
  const remaining = Math.max(0, restRemainingMillis(timer, at) + Math.round(deltaSeconds) * 1000);
  if (timer.kind === 'paused') {
    return { kind: 'paused', remainingMillis: remaining, totalSeconds: timer.totalSeconds };
  }
  const from = millis(at);
  if (from === null) return timer;
  return {
    kind: 'running',
    endsAt: new Date(from + remaining).toISOString(),
    totalSeconds: timer.totalSeconds,
  };
}

/** An instant as milliseconds, or `null` where this runtime cannot read it. */
function millis(at: Instant): number | null {
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : null;
}
