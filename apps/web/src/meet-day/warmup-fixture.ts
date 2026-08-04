// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The answers §20's screen is drawn from, shared by its tests and its stories.
 *
 * The same rule `live-fixture.ts` follows: every state here is built by the
 * writers in `warmup.ts`, never as a `MeetWarmupState` literal. A literal can
 * hold a shape the writers cannot produce -- two set answers at one index, a
 * `place` that is not one of the two, a prep row with a `when` and no minutes --
 * and a screen proved to cope with one of those is proved against nothing.
 *
 * WHY THE STATES ARE FUNCTIONS AND NOT CONSTANTS
 *
 * `MeetWarmupState` is deeply readonly and every writer returns a fresh object,
 * so a shared constant could not be corrupted. They are functions anyway,
 * because a story that mutated one would corrupt the *element* it was handed to
 * rather than the fixture, and the failure would surface three stories later as
 * a screen nobody built. One call per consumer costs nothing and removes the
 * question.
 *
 * THE FIGURES ARE PICKED SO THAT NO TWO CAN BE CONFUSED
 *
 * No two of the twelve position and pace answers share a value. The flight ahead
 * has 12 attempts left, one whole flight sits between, the lifter's own flight
 * holds 10, the session has run 30 attempts in 45 minutes, the break is 6
 * minutes and the delay is 8. So an assertion that reads "12" off the screen
 * knows which field it came from -- which matters more here than usual, because
 * §20.1's estimate is a sum of most of them and a test reading the wrong one
 * still gets a plausible answer.
 *
 * The opener is 160 kg against a 20 kg bar and 5 kg of competition collars,
 * which puts the empty implement at 25 and gives a six-set ramp with two
 * half-kilogram rungs on it. Deliberately not a round ramp: a fixture whose
 * every rung is a multiple of five cannot tell a kilogram figure from a
 * converted pound one, which is §13.17's lesson arriving on a different screen.
 */
import type { MeetFormat } from '@platform-toolkit/data-contracts';

import { DEFAULT_EQUIPMENT } from '../warm-up/equipment.js';
import {
  EMPTY_WARMUP_STATE,
  withPreferences,
  withPrep,
  withProgress,
  withRoom,
  withSetReps,
  withSetWeight,
  type MeetWarmupState,
  type WarmupSubject,
} from './warmup.js';

/** The instant every fixture is stamped with. Never consulted, only recorded. */
export const NOW = 1_764_000_000_000;

/** Full power, which is the format every prep row is reachable under. */
export const FORMAT: MeetFormat = 'full-power';

/**
 * A squat opener, in the unit the platform is scored in.
 *
 * 160 rather than a personal best figure because this is an *opener*: the ramp
 * is counted back from the first attempt, and a fixture opening at somebody's
 * maximum would produce a warm-up nobody would take.
 */
export const SQUAT: WarmupSubject = {
  lift: 'squat',
  opener: { amount: 160, unit: 'kg' },
  attemptsPerLift: 3,
};

/**
 * The same lifter with no opener chosen.
 *
 * Zero rather than a negative or a NaN because zero is what an unanswered
 * weight field reads as, and `collectProblems` refuses it on
 * `working-weight-not-positive` -- the one refusal a lifter can actually reach
 * from the screens, and therefore the one the timeline's error sentence has to
 * be right about. See `warmupProblemSentence` in `copy.ts`.
 */
export const NO_OPENER: WarmupSubject = {
  lift: 'squat',
  opener: { amount: 0, unit: 'kg' },
  attemptsPerLift: 3,
};

/** A screen nobody has answered. The estimate still renders; §20.1 says it must. */
export function nothingAnswered(): MeetWarmupState {
  return EMPTY_WARMUP_STATE;
}

/**
 * The common case: an earlier flight is running and the session has a pace.
 *
 * Thirty attempts in forty-five minutes clears `MIN_ATTEMPTS_FOR_OBSERVED_PACE`,
 * so the estimate is drawn from a measurement rather than from the assumption --
 * which is a different `PaceSource` and therefore a visibly narrower spread. A
 * fixture that fell short of the floor would document the assumed screen under a
 * name saying otherwise.
 */
export function anEarlierFlight(): MeetWarmupState {
  return withProgress(EMPTY_WARMUP_STATE, {
    place: 'earlier-flight-running',
    attemptsLeftInTheRunningFlight: '12',
    wholeFlightsBetween: '1',
    flightSize: '10',
    attemptsCompleted: '30',
    minutesSinceSessionStart: '45',
    targetRound: '1',
    targetPosition: '4',
  });
}

/**
 * The lifter's own flight, mid-round.
 *
 * The other half of §20.1's position question, and the reason the two pairs of
 * fields are rendered one at a time. Note that the earlier-flight figures are
 * still in the record underneath: `warmup.ts` stores the discriminant rather
 * than the union, so flipping the control back must not have lost them, and a
 * fixture that cleared them could not prove it.
 *
 * The target moves with the place, and it has to. `anEarlierFlight` asks about
 * round 1 position 4, which is *behind* a lifter whose own flight has reached
 * round 2 -- so keeping it produces the "the attempt is not ahead" screen, an
 * estimate of nothing at all, and a fixture that documents that screen under a
 * name saying it is mid-flight. Round 3 position 8 is ahead of round 2 position
 * 5, which is what makes this state a live estimate rather than a refusal.
 *
 * It is also close enough to be a second interesting screen: thirteen attempts
 * away at the measured pace is sixteen to twenty-three minutes, which is shorter
 * than the ramp, so the schedule carries `behind-the-warm-up-timeline` and the
 * first warm-up set is already overdue. That is the state §20.1 exists for and
 * `anEarlierFlight` -- forty-five attempts out -- cannot reach.
 */
export function ownFlightRunning(): MeetWarmupState {
  return withProgress(anEarlierFlight(), {
    place: 'own-flight-running',
    currentRound: '2',
    currentPosition: '5',
    targetRound: '3',
    targetPosition: '8',
  });
}

/**
 * A session running behind, with a published break still to come.
 *
 * Two facts rather than one because they behave differently and read alike: a
 * break is scheduled and a delay is not, and neither of them widens the spread
 * (§13.3). Eight minutes of delay is enough to reach `schedule.delay`, which is
 * the notice the timeline renders under the list.
 */
export function runningLate(): MeetWarmupState {
  return withProgress(anEarlierFlight(), { breakMinutes: '6', delayMinutes: '8' });
}

/**
 * Knee wraps, timed, on the side of the ramp §20 puts them.
 *
 * Nine minutes is under the ten-to-twelve-minute lead, so it is *not* charged
 * twice -- the prep fits inside the gap the ramp already leaves. A figure over
 * the lead widens it and says so, which is a different screen; `longPreparation`
 * below is that one.
 */
export function withKneeWraps(): MeetWarmupState {
  return withPrep(anEarlierFlight(), 'knee-wraps', {
    minutes: '9',
    when: 'after-the-final-warm-up',
  });
}

/** Preparation that does not fit the lead, which widens it and announces itself. */
export function longPreparation(): MeetWarmupState {
  return withPrep(anEarlierFlight(), 'squat-suit', {
    minutes: '25',
    when: 'before-the-ramp',
  });
}

/**
 * A lifter who has overridden two rungs of the calculated ramp.
 *
 * Indices 3 and 4 rather than 0 and 1, because index 0 is the empty implement
 * and is not adjustable -- an answer filed against it is dropped by
 * `warmup-adjust.ts` and the fixture would document a screen with no overrides
 * on it.
 *
 * Both figures are chosen not to collide with anything the ramp already prints:
 * the calculated rungs off this opener are 25, 65, 87.5, 110, 127.5 and 145 at
 * 5, 5, 5, 3, 2 and 1 repetitions, so 112.5 and 4 appear nowhere else. An
 * override that happens to equal the rung it replaced is invisible on screen and
 * would leave every assertion about it measuring the calculator.
 */
export function withAdjustedSets(): MeetWarmupState {
  return withSetReps(withSetWeight(anEarlierFlight(), 3, '112.5'), 4, '4');
}

/** Four lifters queueing for one bar, which §20 says costs a set's time per gap. */
export function sharingARack(): MeetWarmupState {
  return withPreferences(anEarlierFlight(), { sharedRackLifters: '4' });
}

/**
 * A room loaded in pounds.
 *
 * The ramp is printed in the room's plate unit and the opener is declared in the
 * meet's, so this is the state that proves the two are read separately -- a
 * lifter can plan in kilograms and warm up on a pound bar, and printing the ramp
 * in the document's unit sends them hunting for a plate nobody painted.
 */
export function aPoundRoom(): MeetWarmupState {
  return withRoom(anEarlierFlight(), {
    ...DEFAULT_EQUIPMENT,
    plateUnit: 'lb',
    barId: 'standard-45',
    collarId: 'none',
  });
}
