// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20 as a value: the answers, and what the two engines make of them.
 *
 * The engines have their own tests and are not re-tested here. What is tested is
 * every place this file *decides* something on the lifter's behalf, because each
 * of those is a figure appearing on a warm-up room wall that nobody typed:
 *
 * - **What a blank means.** Almost every field on this screen is optional, so
 *   the fallbacks are the common path rather than the edge. Each is asserted for
 *   the value it produces *and* for the direction it errs in -- §5.5 says early,
 *   and a fallback that drifted late would still look reasonable in a diff.
 * - **Both ends of the lead or neither.** One end supplied against the domain's
 *   default for the other is a window whose late end can precede its early one,
 *   which `meetWarmup` silently repairs by discarding what was typed.
 * - **Nothing here reads a clock.** Pinned by building the same state at two
 *   instants and diffing everything except the stamp.
 *
 * Two claims that look like they belong in that list are pinned here as the
 * engine's behaviour rather than this file's, because mutation testing showed
 * they were: a rack of one widens no gap, and a per-set answer that will not
 * read changes nothing. Both were guarded twice at first, and the second guard
 * was the §5.8 mistake in miniature.
 */
import { describe, expect, it } from 'vitest';

import {
  ASSUMED_SECONDS_PER_ATTEMPT,
  MIN_ATTEMPTS_FOR_OBSERVED_PACE,
  type Weight,
} from '@platform-toolkit/domain';

import { DEFAULT_EQUIPMENT } from '../warm-up/equipment.js';
import {
  DEFAULT_LEAD_MINUTES,
  DEFAULT_WARM_UP_ROOM,
  EMPTY_WARMUP_STATE,
  EMPTY_WARMUP_STATES,
  PREP_KINDS,
  buildMeetWarmup,
  delayPreferenceFromValue,
  estimateFor,
  hasSetAnswers,
  meetPlaceFromValue,
  paceFor,
  positionFor,
  prepFor,
  prepKindsFor,
  prepWhenFromValue,
  scheduleOf,
  setAnswerFor,
  withCalculatedSets,
  withPreferences,
  withPrep,
  withProgress,
  withRoom,
  withSetReps,
  withSetWeight,
  withWarmupFor,
  type MeetWarmupResultView,
  type MeetWarmupState,
  type WarmupSubject,
} from './warmup.js';

const OPENER: Weight = { amount: 160, unit: 'kg' };

const SQUAT: WarmupSubject = { lift: 'squat', opener: OPENER, attemptsPerLift: 3 };

/** A meet in progress: an earlier flight running, and a measured pace. */
const RUNNING: MeetWarmupState = withProgress(EMPTY_WARMUP_STATE, {
  place: 'earlier-flight-running',
  attemptsLeftInTheRunningFlight: '12',
  wholeFlightsBetween: '1',
  flightSize: '10',
  attemptsCompleted: '30',
  minutesSinceSessionStart: '30',
  targetRound: '1',
  targetPosition: '4',
});

function build(state: MeetWarmupState, now = 1_000): MeetWarmupResultView {
  return buildMeetWarmup(state, SQUAT, 'full-power', now);
}

/** The ramp's own sets, which is what §20's "number of warm-ups" counts. */
function weightedSets(result: MeetWarmupResultView): number {
  const schedule = scheduleOf(result);
  return (schedule?.plan.warmups ?? []).filter((set) => set.stage !== 'empty-implement').length;
}

describe('the warm-up room', () => {
  it('is a kilogram platform, not the pound gym tool 2 opens on', () => {
    expect(DEFAULT_WARM_UP_ROOM.plateUnit).toBe('kg');
    expect(DEFAULT_WARM_UP_ROOM.barId).toBe('olympic-20');
  });

  it('has competition collars on the bar, which move every reachable total', () => {
    expect(DEFAULT_WARM_UP_ROOM.collarId).toBe('competition');
  });

  it('shares tool 2 s inventory rather than restating it', () => {
    // Restated, the two lists disagree the day one of them gains a plate size.
    expect(DEFAULT_WARM_UP_ROOM.inventory).toBe(DEFAULT_EQUIPMENT.inventory);
  });
});

describe('which preparations are offered', () => {
  it('offers wraps and a suit where the squat is contested', () => {
    expect(prepKindsFor('full-power')).toContain('knee-wraps');
    expect(prepKindsFor('full-power')).toContain('squat-suit');
  });

  it('offers neither at a bench-only meet', () => {
    expect(prepKindsFor('bench-only')).not.toContain('knee-wraps');
    expect(prepKindsFor('bench-only')).not.toContain('squat-suit');
  });

  it('offers a shirt only where the bench is contested', () => {
    expect(prepKindsFor('bench-only')).toContain('bench-shirt');
    expect(prepKindsFor('deadlift-only')).not.toContain('bench-shirt');
  });

  it('offers a deadlift suit only where the deadlift is contested', () => {
    expect(prepKindsFor('push-pull')).toContain('deadlift-suit');
    expect(prepKindsFor('bench-only')).not.toContain('deadlift-suit');
  });

  it('always offers the unnamed one, because gear this tool has not heard of exists', () => {
    for (const format of ['full-power', 'push-pull', 'bench-only', 'deadlift-only'] as const) {
      expect(prepKindsFor(format)).toContain('other');
    }
  });

  it('keeps §20 s order rather than the order the filter happens to run in', () => {
    expect(prepKindsFor('full-power')).toEqual(PREP_KINDS);
  });
});

describe('reading the preparations', () => {
  it('leaves out a row nobody filled in', () => {
    expect(prepFor(EMPTY_WARMUP_STATE.preferences, 'full-power', 'squat')).toEqual([]);
  });

  it('leaves out a row typed as zero rather than scheduling a nothing', () => {
    // A zero-second item is drawn on the timeline and read as an instruction.
    const state = withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', { minutes: '0' });
    expect(prepFor(state.preferences, 'full-power', 'squat')).toEqual([]);
  });

  it('names the item by its kind, so a screen can label it without a lookup', () => {
    const state = withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', { minutes: '4' });
    expect(prepFor(state.preferences, 'full-power', 'squat')).toEqual([
      { id: 'knee-wraps', seconds: 240, when: 'after-the-final-warm-up' },
    ]);
  });

  it('puts knee wraps inside the lead and gear before the ramp', () => {
    const state = withPrep(
      withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', { minutes: '4' }),
      'squat-suit',
      {
        minutes: '6',
      },
    );
    const items = prepFor(state.preferences, 'full-power', 'squat');
    expect(items.find((item) => item.id === 'knee-wraps')?.when).toBe('after-the-final-warm-up');
    expect(items.find((item) => item.id === 'squat-suit')?.when).toBe('before-the-ramp');
  });

  it('takes the lifter s side over the default when they move one', () => {
    const state = withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', {
      minutes: '4',
      when: 'before-the-ramp',
    });
    expect(prepFor(state.preferences, 'full-power', 'squat')[0]?.when).toBe('before-the-ramp');
  });

  it('drops a row the meet does not contest even when it holds a time', () => {
    // A session switched from full power to bench only keeps what was typed;
    // scheduling it would put a squat suit on at a bench meet.
    const state = withPrep(EMPTY_WARMUP_STATE, 'squat-suit', { minutes: '6' });
    expect(prepFor(state.preferences, 'bench-only', 'bench')).toEqual([]);
  });

  it('drops a half-typed time rather than treating it as a figure', () => {
    const state = withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', { minutes: 'four' });
    expect(prepFor(state.preferences, 'full-power', 'squat')).toEqual([]);
  });

  it('charges gear to the lift it goes on and to no other', () => {
    // The rows are the meet's, so a full-power lifter has a shirt on record
    // while reading their squat ramp. Charging it would start the squat warm-up
    // ten minutes early for gear that goes on two lifts later. Both halves are
    // asserted from one state: dropping every kind would satisfy the first.
    const state = withPrep(
      withPrep(EMPTY_WARMUP_STATE, 'knee-wraps', { minutes: '4' }),
      'bench-shirt',
      { minutes: '10' },
    );
    expect(prepFor(state.preferences, 'full-power', 'squat').map((item) => item.id)).toEqual([
      'knee-wraps',
    ]);
    expect(prepFor(state.preferences, 'full-power', 'bench').map((item) => item.id)).toEqual([
      'bench-shirt',
    ]);
  });

  it('charges the unnamed row to whichever lift is on screen', () => {
    // A catch-all the tool cannot identify cannot be assigned to a lift, and
    // silently dropping it everywhere would make the one row a lifter reaches
    // for their unusual gear the one row that does nothing.
    const state = withPrep(EMPTY_WARMUP_STATE, 'other', { minutes: '3' });
    for (const lift of ['squat', 'bench', 'deadlift'] as const) {
      expect(prepFor(state.preferences, 'full-power', lift).map((item) => item.id)).toEqual([
        'other',
      ]);
    }
  });
});

describe('the pace', () => {
  it('is the measured one when both halves of the measurement are there', () => {
    expect(paceFor(RUNNING.progress)).toEqual({ secondsPerAttempt: 60, source: 'observed' });
  });

  it('is assumed when only half the measurement was supplied', () => {
    // Attempts without elapsed time is not a slow meet, it is no measurement.
    const half = withProgress(RUNNING, { minutesSinceSessionStart: '' });
    expect(paceFor(half.progress).source).toBe('assumed');
  });

  it('is assumed before enough attempts have run to mean anything', () => {
    const early = withProgress(RUNNING, {
      attemptsCompleted: String(MIN_ATTEMPTS_FOR_OBSERVED_PACE - 1),
      minutesSinceSessionStart: '4',
    });
    expect(paceFor(early.progress)).toEqual({
      secondsPerAttempt: ASSUMED_SECONDS_PER_ATTEMPT,
      source: 'assumed',
    });
  });

  it('is assumed on an empty session, and says so rather than looking confident', () => {
    expect(paceFor(EMPTY_WARMUP_STATE.progress).source).toBe('assumed');
  });

  it('reports a slow meet as slow', () => {
    const slow = withProgress(RUNNING, { minutesSinceSessionStart: '45' });
    expect(paceFor(slow.progress).secondsPerAttempt).toBe(90);
  });
});

describe('the position in the meet', () => {
  it('reads an earlier flight as attempts left plus whole flights between', () => {
    expect(positionFor(RUNNING.progress)).toEqual({
      kind: 'earlier-flight-running',
      attemptsLeftInTheRunningFlight: 12,
      wholeFlightsBetween: 1,
    });
  });

  it('reads the lifter s own flight as a round and a place in it', () => {
    const own = withProgress(RUNNING, {
      place: 'own-flight-running',
      currentRound: '2',
      currentPosition: '5',
    });
    expect(positionFor(own.progress)).toEqual({
      kind: 'own-flight-running',
      currentRound: 2,
      currentPosition: 5,
    });
  });

  it('treats a blank flight ahead as one that is finishing now', () => {
    // Early rather than late: standing about costs minutes, missing costs the lift.
    expect(positionFor(EMPTY_WARMUP_STATE.progress)).toEqual({
      kind: 'earlier-flight-running',
      attemptsLeftInTheRunningFlight: 0,
      wholeFlightsBetween: 0,
    });
  });

  it('treats a blank round as the first and a blank place as before it starts', () => {
    const own = withProgress(EMPTY_WARMUP_STATE, { place: 'own-flight-running' });
    expect(positionFor(own.progress)).toEqual({
      kind: 'own-flight-running',
      currentRound: 1,
      currentPosition: 0,
    });
  });

  it('keeps what was typed under the other answer when the flight is called', () => {
    // Two shapes, one set of answers: flipping the control mid-meet is normal.
    const flipped = withProgress(RUNNING, { place: 'own-flight-running' });
    expect(flipped.progress.attemptsLeftInTheRunningFlight).toBe('12');
  });
});

describe('the platform estimate', () => {
  it('counts everything in front of the lifter', () => {
    // 12 left in the running flight, a whole flight of ten taking three attempts
    // each, and three lifters ahead in the target round.
    expect(estimateFor(RUNNING, 3).attemptsBefore).toBe(12 + 30 + 3);
  });

  it('carries the measured pace through, spread and all', () => {
    expect(estimateFor(RUNNING, 3).pace.source).toBe('observed');
  });

  it('holds a flight of nobody at one rather than collapsing the later rounds', () => {
    // `attemptsBeforeTarget` multiplies by the flight size; a zero would report
    // every round after the first as happening now.
    const later = withProgress(EMPTY_WARMUP_STATE, { flightSize: '', targetRound: '2' });
    expect(estimateFor(later, 3).attemptsBefore).toBeGreaterThan(0);
  });

  it('adds a scheduled break to both ends without widening the range', () => {
    const withBreak = withProgress(RUNNING, { breakMinutes: '20' });
    const before = estimateFor(RUNNING, 3);
    const after = estimateFor(withBreak, 3);
    expect(after.earliestSeconds - before.earliestSeconds).toBe(20 * 60);
    expect(after.latestSeconds - before.latestSeconds).toBe(20 * 60);
  });

  it('carries a delay through as a delay, so the ramp can say what to do about it', () => {
    const late = withProgress(RUNNING, { delayMinutes: '15' });
    expect(estimateFor(late, 3).delaySeconds).toBe(15 * 60);
  });

  it('is available with nothing typed at all', () => {
    const estimate = estimateFor(EMPTY_WARMUP_STATE, 3);
    expect(estimate.attemptsBefore).toBe(0);
    expect(estimate.latestSeconds).toBeGreaterThan(estimate.earliestSeconds);
  });
});

describe('building the warm-up', () => {
  it('produces a ramp and the estimate it was counted back from', () => {
    const result = build(RUNNING);
    expect(result.ok).toBe(true);
    expect(scheduleOf(result)?.items.length).toBeGreaterThan(0);
  });

  it('keeps the estimate on the screen when the opener will not read', () => {
    // The range is what a handler acts on and it does not depend on the opener.
    const result = buildMeetWarmup(
      RUNNING,
      { ...SQUAT, opener: { amount: 0, unit: 'kg' } },
      'full-power',
      1,
    );
    expect(result.ok).toBe(false);
    expect(result.estimate.attemptsBefore).toBe(45);
    if (!result.ok) expect(result.problems.length).toBeGreaterThan(0);
  });

  it('reads no clock -- two instants differ only in the stamp', () => {
    const early = build(RUNNING, 1_000);
    const late = build(RUNNING, 9_999_000);
    expect(scheduleOf(late)).toEqual(scheduleOf(early));
    if (early.ok && late.ok) {
      expect(early.timeline.builtAt).toBe(1_000);
      expect(late.timeline.builtAt).toBe(9_999_000);
    }
  });
});

describe('the lead before the platform', () => {
  it('is pre-filled with §20 s ten to twelve minutes', () => {
    expect(EMPTY_WARMUP_STATE.preferences.leadMinimumMinutes).toBe(DEFAULT_LEAD_MINUTES.minimum);
    expect(EMPTY_WARMUP_STATE.preferences.leadMaximumMinutes).toBe(DEFAULT_LEAD_MINUTES.maximum);
  });

  it('moves the final warm-up earlier when the lifter asks for a longer one', () => {
    const longer = withPreferences(RUNNING, {
      leadMinimumMinutes: '20',
      leadMaximumMinutes: '25',
    });
    const before = scheduleOf(build(RUNNING))?.startsInSeconds.earliestSeconds ?? 0;
    const after = scheduleOf(build(longer))?.startsInSeconds.earliestSeconds ?? 0;
    expect(after).toBeLessThan(before);
  });

  it('takes both ends or neither, so one end cannot vanish against a default', () => {
    // A minimum of fifteen against the default maximum of twelve is a window
    // whose late end precedes its early one, and `meetWarmup` repairs that by
    // widening the minimum back out -- discarding what was typed, silently.
    const half = withPreferences(RUNNING, { leadMinimumMinutes: '15', leadMaximumMinutes: '' });
    const neither = withPreferences(RUNNING, { leadMinimumMinutes: '', leadMaximumMinutes: '' });
    expect(scheduleOf(build(half))).toEqual(scheduleOf(build(neither)));
  });

  it('reads a window typed backwards as the window it describes', () => {
    const backwards = withPreferences(RUNNING, {
      leadMinimumMinutes: '15',
      leadMaximumMinutes: '12',
    });
    const forwards = withPreferences(RUNNING, {
      leadMinimumMinutes: '12',
      leadMaximumMinutes: '15',
    });
    expect(scheduleOf(build(backwards))).toEqual(scheduleOf(build(forwards)));
  });
});

describe('the shared bar', () => {
  it('is not shared by one lifter', () => {
    // The engine's rule, pinned through this seam rather than restated in it:
    // a rack of one widens no gap and raises no advisory.
    const alone = withPreferences(RUNNING, { sharedRackLifters: '1' });
    expect(scheduleOf(build(alone))).toEqual(scheduleOf(build(RUNNING)));
  });

  it('announces the allowance when there really is a queue', () => {
    const queue = withPreferences(RUNNING, { sharedRackLifters: '3' });
    const codes = (scheduleOf(build(queue))?.advisories ?? []).map((advisory) => advisory.code);
    expect(codes).toContain('sharing-a-rack');
  });

  it('starts the ramp earlier for a queue than for a bar of one', () => {
    const queue = withPreferences(RUNNING, { sharedRackLifters: '3' });
    const alone = scheduleOf(build(RUNNING))?.startsInSeconds.earliestSeconds ?? 0;
    const shared = scheduleOf(build(queue))?.startsInSeconds.earliestSeconds ?? 0;
    expect(shared).toBeLessThan(alone);
  });
});

describe('§20 s customisation', () => {
  it('shortens the ramp to the number of warm-ups asked for', () => {
    const short = withPreferences(RUNNING, { maximumSets: '2' });
    expect(weightedSets(build(short))).toBe(2);
  });

  it('says the ramp was shortened rather than letting it look calculated', () => {
    const short = withPreferences(RUNNING, { maximumSets: '2' });
    const codes = (scheduleOf(build(short))?.advisories ?? []).map((advisory) => advisory.code);
    expect(codes).toContain('the-ramp-was-shortened');
  });

  it('leaves the ramp its own length when the field is blank', () => {
    expect(weightedSets(build(RUNNING))).toBeGreaterThan(2);
  });

  it('takes a weight the lifter typed for one set', () => {
    const state = withSetWeight(RUNNING, 1, '100');
    const set = scheduleOf(build(state))?.plan.warmups[1];
    // The nearest total the room's plates can build, which is what was asked for.
    expect(set?.loading.total).toBeCloseTo(100, 5);
  });

  it('takes repetitions the lifter typed for one set, and only that set', () => {
    // Eight rather than five, and the neighbours checked as well. The ramp opens
    // on three sets of five and descends, so an assertion naming one of those
    // with the figure already in it agrees with an off-by-one index, a dropped
    // answer, and a correct one alike -- which is what the first version of this
    // test did.
    const before = scheduleOf(build(RUNNING))?.plan.warmups ?? [];
    const after = scheduleOf(build(withSetReps(RUNNING, 3, '8')))?.plan.warmups ?? [];
    expect(before[3]?.reps).not.toBe(8);
    expect(after[3]?.reps).toBe(8);
    for (const [index, set] of after.entries()) {
      if (index !== 3) expect(set.reps).toBe(before[index]?.reps);
    }
  });

  it('ignores an answer left over from a longer ramp', () => {
    // The index names a row that is no longer on screen; a warning about it
    // would be a warning about nothing.
    const stale = withSetWeight(RUNNING, 40, '100');
    expect(scheduleOf(build(stale))).toEqual(scheduleOf(build(RUNNING)));
  });

  it('does not flicker the ramp while a weight is half typed', () => {
    // "102." is a keystroke on the way to 102.5, not a request for a set. The
    // field under it shows its own sentence; the ramp above it does not move.
    const typing = withSetWeight(RUNNING, 1, '102.');
    expect(scheduleOf(build(typing))).toEqual(scheduleOf(build(RUNNING)));
    const typed = withSetWeight(RUNNING, 1, '102.5');
    expect(scheduleOf(build(typed))).not.toEqual(scheduleOf(build(RUNNING)));
  });

  it('trims before it adjusts, so an index means the row being looked at', () => {
    // Documented on the engine; asserted here because this file is what supplies
    // both at once, and the two orders disagree about which set gets the weight.
    const state = withSetWeight(withPreferences(RUNNING, { maximumSets: '2' }), 1, '140');
    const warmups = scheduleOf(build(state))?.plan.warmups ?? [];
    expect(warmups[1]?.loading.total).toBeCloseTo(140, 5);
  });
});

describe('the room', () => {
  it('changes every total when the collars come off', () => {
    const noCollars = withRoom(RUNNING, { ...RUNNING.room, collarId: 'none' });
    expect(scheduleOf(build(noCollars))).not.toEqual(scheduleOf(build(RUNNING)));
  });
});

describe('the delay', () => {
  it('says nothing when the meet is on time', () => {
    expect(scheduleOf(build(RUNNING))?.delay).toBeNull();
  });

  it('gives the lifter back the answer they chose in advance', () => {
    const late = withPreferences(withProgress(RUNNING, { delayMinutes: '15' }), {
      delayPreference: 'repeat-a-light-movement',
    });
    expect(scheduleOf(build(late))?.delay?.action).toBe('repeat-a-light-movement');
  });

  it('waits by default, which is the answer that costs nothing', () => {
    const late = withProgress(RUNNING, { delayMinutes: '15' });
    expect(scheduleOf(build(late))?.delay?.action).toBe('wait');
  });
});

describe('the per-set answers', () => {
  it('reads back what was typed for a set', () => {
    const state = withSetWeight(EMPTY_WARMUP_STATE, 2, '100');
    expect(setAnswerFor(state.weights, 2)).toBe('100');
    expect(setAnswerFor(state.weights, 3)).toBe('');
  });

  it('replaces rather than accumulating when a set is retyped', () => {
    const state = withSetWeight(withSetWeight(EMPTY_WARMUP_STATE, 2, '100'), 2, '110');
    expect(state.weights).toEqual([{ index: 2, text: '110' }]);
  });

  it('forgets a set that was cleared rather than holding an empty answer', () => {
    // An entry with nothing in it is indistinguishable downstream from one that
    // never existed, and would accumulate one row per set ever touched.
    const state = withSetWeight(withSetWeight(EMPTY_WARMUP_STATE, 2, '100'), 2, '   ');
    expect(state.weights).toEqual([]);
  });

  it('keeps the list in index order however it was typed', () => {
    // §24 saves this; an order that depended on typing makes every save a change.
    const typed = withSetWeight(withSetWeight(EMPTY_WARMUP_STATE, 3, 'c'), 1, 'a');
    const other = withSetWeight(withSetWeight(EMPTY_WARMUP_STATE, 1, 'a'), 3, 'c');
    expect(typed.weights).toEqual(other.weights);
  });

  it('keeps weights and repetitions apart', () => {
    const state = withSetReps(withSetWeight(EMPTY_WARMUP_STATE, 1, '100'), 1, '5');
    expect(state.weights).toEqual([{ index: 1, text: '100' }]);
    expect(state.reps).toEqual([{ index: 1, text: '5' }]);
  });

  it('knows whether the ramp on screen is still the calculated one', () => {
    expect(hasSetAnswers(EMPTY_WARMUP_STATE)).toBe(false);
    expect(hasSetAnswers(withSetReps(EMPTY_WARMUP_STATE, 1, '5'))).toBe(true);
  });

  it('goes back to the calculated ramp in one move', () => {
    const state = withSetReps(withSetWeight(RUNNING, 1, '100'), 2, '5');
    expect(withCalculatedSets(state)).toEqual(RUNNING);
  });
});

describe('recording one lift s answers', () => {
  it('carries the room, the preferences and the platform to every lift', () => {
    // One bar in the warm-up room and one flight on the platform. Asked three
    // times, the second and third answers drift from the first.
    const answered = withPreferences(withRoom(EMPTY_WARMUP_STATE, DEFAULT_EQUIPMENT), {
      restSeconds: '150',
    });
    const states = withWarmupFor(
      EMPTY_WARMUP_STATES,
      'squat',
      withProgress(answered, {
        flightSize: '14',
      }),
    );
    for (const lift of ['squat', 'bench', 'deadlift'] as const) {
      expect(states[lift].room).toBe(answered.room);
      expect(states[lift].preferences.restSeconds).toBe('150');
      expect(states[lift].progress.flightSize).toBe('14');
    }
  });

  it('leaves a per-set answer on the lift it was typed against', () => {
    // A SetAnswer is an index into the ramp on screen, and the squat ramp is a
    // different length off a different opener. Copied across, 112.5 arrives on
    // the bench timeline as whatever that ramp's fourth rung happens to be.
    const states = withWarmupFor(
      EMPTY_WARMUP_STATES,
      'squat',
      withSetWeight(EMPTY_WARMUP_STATE, 3, '112.5'),
    );
    expect(states.squat.weights).toEqual([{ index: 3, text: '112.5' }]);
    expect(states.bench.weights).toEqual([]);
    expect(states.deadlift.weights).toEqual([]);
  });

  it('does not lose what another lift was already holding', () => {
    // The lifter compares two ramps before the session starts. Clearing the
    // per-set answers on every change of lift was the rejected alternative, and
    // this is who it would have cost.
    const withBench = withWarmupFor(
      EMPTY_WARMUP_STATES,
      'bench',
      withSetReps(EMPTY_WARMUP_STATE, 1, '4'),
    );
    const then = withWarmupFor(withBench, 'squat', withSetWeight(EMPTY_WARMUP_STATE, 3, '112.5'));
    expect(then.bench.reps).toEqual([{ index: 1, text: '4' }]);
    expect(then.squat.weights).toEqual([{ index: 3, text: '112.5' }]);
  });

  it('records the named lift s answers exactly as they were given', () => {
    const state = withSetWeight(withProgress(EMPTY_WARMUP_STATE, { delayMinutes: '8' }), 2, '90');
    expect(withWarmupFor(EMPTY_WARMUP_STATES, 'deadlift', state).deadlift).toBe(state);
  });
});

describe('reading a control s value', () => {
  it('takes the three delay answers', () => {
    expect(delayPreferenceFromValue('continue')).toBe('continue');
    expect(delayPreferenceFromValue('repeat-a-light-movement')).toBe('repeat-a-light-movement');
  });

  it('falls back to an answer the control can show back', () => {
    expect(delayPreferenceFromValue('sprint')).toBe('wait');
    expect(meetPlaceFromValue('')).toBe('earlier-flight-running');
    expect(prepWhenFromValue('whenever')).toBe('before-the-ramp');
  });

  it('takes the two places in the meet', () => {
    expect(meetPlaceFromValue('own-flight-running')).toBe('own-flight-running');
    expect(prepWhenFromValue('after-the-final-warm-up')).toBe('after-the-final-warm-up');
  });
});
