// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The live meet document, and the one property everything else rests on.
 *
 * §13.9 asks that undo restore the whole world -- status, total, recommendation,
 * submission state, timer, warm-up, coach board. The implementation answers that
 * by storing one value and deriving the rest, so the tests that matter most here
 * are not the individual actions but the two that would catch the shape being
 * broken later: that undo restores a *document* rather than a list of fields, and
 * that nothing derived is ever stored.
 *
 * Every instant is supplied. Nothing in these tests reads the clock, for the same
 * reason nothing in the module does: a test that passed because a countdown was
 * measured twice in the same millisecond is a test that fails on a slow machine.
 */
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  UNDO_HISTORY_LIMIT,
  applyMeetAction,
  attemptsOn,
  bestGoodLift,
  bombOutRisk,
  changeAllowanceFor,
  createMeetDocument,
  findAttempt,
  jumpFromPrevious,
  liftsInFormat,
  nextAttemptOn,
  outstandingExtraAttempts,
  projectedTotalWith,
  startTimeline,
  submissionState,
  takenOn,
  totalSoFar,
  undo,
  undoableAction,
  type LiveAttempt,
  type LiveLifter,
  type MeetAction,
  type MeetActionProblemCode,
  type MeetDocument,
  type MeetTimeline,
  type RecordedResult,
} from './meet-document.js';
import { rulesFor } from './meet-profile.fixture.js';

const RULES = rulesFor();

/**
 * An invented instant, and every other time in the file is an offset from it.
 *
 * A round number so a countdown reads as arithmetic rather than as a date. It is
 * deliberately not "now": these tests must give the same answers in ten years.
 */
const AT = 1_700_000_000_000;

function seconds(count: number): number {
  return count * 1000;
}

function timelineFor(format: MeetFormat = 'full-power'): MeetTimeline {
  return startTimeline(createMeetDocument(RULES, format));
}

/** Applies an action that is expected to succeed, reporting the refusal if it does not. */
function apply(timeline: MeetTimeline, action: MeetAction, at = AT): MeetTimeline {
  const result = applyMeetAction(RULES, timeline, action, at);
  if (!result.ok) {
    throw new Error(
      `${action.kind} was refused: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.timeline;
}

/** The codes an action was refused with, or an empty list if it was accepted. */
function refusals(
  timeline: MeetTimeline,
  action: MeetAction,
  at = AT,
): readonly MeetActionProblemCode[] {
  const result = applyMeetAction(RULES, timeline, action, at);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

function withLifter(timeline: MeetTimeline = timelineFor(), name = 'Sam'): MeetTimeline {
  return apply(timeline, { kind: 'add-lifter', name });
}

/**
 * The single lifter, by position rather than by generated id.
 *
 * The ids are formed from an ordinal and are an implementation detail; a test
 * that spelled `lifter-1` would keep passing while quietly depending on it.
 */
function only(timeline: MeetTimeline): LiveLifter {
  const [lifter] = timeline.present.lifters;
  if (lifter === undefined) throw new Error('the meet has no lifters');
  return lifter;
}

function attemptAt(timeline: MeetTimeline, lift: PlatformLift, attemptNumber: number): LiveAttempt {
  const attempt = attemptsOn(only(timeline), lift).find(
    (candidate) => candidate.attemptNumber === attemptNumber && candidate.kind === 'competition',
  );
  if (attempt === undefined) {
    throw new Error(`no ${lift} attempt ${String(attemptNumber)}`);
  }
  return attempt;
}

/** Weigh, submit and judge one attempt, the way a round actually goes. */
function take(
  timeline: MeetTimeline,
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  result: RecordedResult,
  at = AT,
): MeetTimeline {
  const attemptId = attemptAt(timeline, lift, attemptNumber).id;
  let next = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms }, at);
  next = apply(next, { kind: 'advance-attempt', attemptId, to: 'submitted' }, at);
  return apply(next, { kind: 'record-result', attemptId, result }, at);
}

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };
const MISSED: RecordedResult = { outcome: 'no-lift', reason: 'strength' };

describe('liftsInFormat', () => {
  it('names the lifts each format is contested on', () => {
    expect(liftsInFormat('full-power')).toEqual(['squat', 'bench', 'deadlift']);
    expect(liftsInFormat('push-pull')).toEqual(['bench', 'deadlift']);
    expect(liftsInFormat('bench-only')).toEqual(['bench']);
    expect(liftsInFormat('deadlift-only')).toEqual(['deadlift']);
  });
});

describe('createMeetDocument', () => {
  it('records which rulebook the meet was run under', () => {
    // §30: a document saved today has to be readable after the federation
    // revises its rules, and the only way to know which rules produced an
    // attempt is to have written the revision down beside it.
    const document = createMeetDocument(RULES, 'full-power');
    expect(document.rulesProfileId).toBe(RULES.profile.id);
    expect(document.rulebookRevision).toBe(RULES.profile.source.revision);
  });

  it('starts with no lifters and nothing focused', () => {
    const document = createMeetDocument(RULES, 'full-power');
    expect(document.lifters).toEqual([]);
    expect(document.focusedLifterId).toBeNull();
  });
});

describe('add-lifter', () => {
  it('builds the attempts the format and the profile call for, and no others', () => {
    const pushPull = withLifter(timelineFor('push-pull'));
    const lifter = only(pushPull);
    expect(lifter.attempts).toHaveLength(RULES.profile.attemptsPerLift * 2);
    expect(attemptsOn(lifter, 'squat')).toHaveLength(0);
    expect(attemptsOn(lifter, 'bench').map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
  });

  it('leaves every attempt blank rather than guessing a weight', () => {
    // The opening ladder is `attempt-plan.ts` and it is a separate decision the
    // lifter makes. A document that arrived pre-filled would present the tool's
    // arithmetic as the coach's plan.
    const lifter = only(withLifter());
    expect(lifter.attempts.every((attempt) => attempt.kilograms === null)).toBe(true);
    expect(lifter.attempts.every((attempt) => attempt.status === 'planned')).toBe(true);
  });

  it('refuses a lifter with no name', () => {
    // §14 names submitting the correct weight for the wrong athlete as the
    // failure, and a board of blanks cannot prevent it.
    expect(refusals(timelineFor(), { kind: 'add-lifter', name: '   ' })).toEqual([
      'lifter-name-required',
    ]);
  });

  it('focuses the first lifter and leaves the focus where it is when a second arrives', () => {
    const one = withLifter();
    const focused = one.present.focusedLifterId;
    const two = withLifter(one, 'Alex');
    expect(two.present.focusedLifterId).toBe(focused);
    expect(two.present.lifters).toHaveLength(2);
  });
});

describe('set-attempt-weight', () => {
  it('refuses a weight that is not a weight', () => {
    const timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    expect(refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 0 })).toEqual([
      'weight-is-not-a-weight',
    ]);
    expect(
      refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: Number.NaN }),
    ).toEqual(['weight-is-not-a-weight']);
  });

  it('refuses an illegal weight on the attempt that is actually next', () => {
    const timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    // 101 is not a multiple of the fixture federation's 2 kg increment.
    expect(refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 101 })).toEqual([
      'weight-not-legal',
    ]);
  });

  it('accepts a later attempt the rules would refuse today, because a plan is not a declaration', () => {
    // A third sketched below the second is a ladder awaiting revision, and
    // refusing it here would stop a coach writing one down. The check that
    // matters runs again on the way to `submitted`, which the test below pins.
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const third = attemptAt(timeline, 'squat', 3).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId: third, kilograms: 90 });
    expect(attemptAt(timeline, 'squat', 3).kilograms).toBe(90);
  });

  it('refuses a weight on an attempt that has already been taken', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    expect(refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 102 })).toEqual([
      'attempt-already-resolved',
    ]);
  });

  it('counts a change only once the attempt has been submitted', () => {
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 104 });
    // Twice, and neither counts: nothing has been handed to the table.
    expect(attemptAt(timeline, 'squat', 1).changesUsed).toBe(0);

    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 106 });
    expect(attemptAt(timeline, 'squat', 1).changesUsed).toBe(1);
  });

  it('refuses a change the rulebook has no allowance left for', () => {
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 102 });
    expect(refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 104 })).toEqual([
      'no-changes-remaining',
    ]);
  });

  it('reports an illegal weight and an exhausted allowance together', () => {
    // §5.5. Told only that the allowance is gone, a coach corrects nothing;
    // told only that the weight is off the increment, they walk to the table
    // with a legal weight they are not allowed to declare.
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 102 });
    expect(refusals(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 103 })).toEqual([
      'weight-not-legal',
      'no-changes-remaining',
    ]);
  });
});

describe('advance-attempt', () => {
  it('refuses to move an attempt backwards through submission', () => {
    // Undo is the only way back. A status settable downwards would let a screen
    // "unsubmit" an attempt without the change being counted, and the lifter
    // arrives at the table having spent an allowance nobody recorded.
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    expect(refusals(timeline, { kind: 'advance-attempt', attemptId, to: 'selected' })).toEqual([
      'status-would-go-backwards',
    ]);
  });

  it('refuses to submit an attempt with no weight on it', () => {
    const timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    expect(refusals(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' })).toEqual([
      'weight-required-before-submitting',
    ]);
  });

  it('re-checks a planned weight against the rules at the moment it is submitted', () => {
    // The other half of the sketching rule. 100 kg on the second was legal to
    // write down while the opener was open; once the opener is made at 100 it is
    // not a legal declaration, and this is the last moment to say so.
    let timeline = withLifter();
    const second = attemptAt(timeline, 'squat', 2).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId: second, kilograms: 100 });
    timeline = take(timeline, 'squat', 1, 100, GOOD);
    expect(
      refusals(timeline, { kind: 'advance-attempt', attemptId: second, to: 'submitted' }),
    ).toEqual(['weight-not-legal']);
  });

  it('stamps the submission once and keeps the original instant', () => {
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' }, AT);
    timeline = apply(
      timeline,
      { kind: 'advance-attempt', attemptId, to: 'confirmed' },
      AT + seconds(20),
    );
    // The stamp says when the weight reached the table, not when the table
    // acknowledged it -- a screen saying "submitted 20 seconds ago" would
    // otherwise reset every time an official nodded.
    expect(attemptAt(timeline, 'squat', 1).submittedAt).toBe(AT);
  });
});

describe('record-result', () => {
  it('keeps the effort on a good lift and the reason on a miss, never both', () => {
    const good = take(withLifter(), 'squat', 1, 100, { outcome: 'good', effort: 'grind', rpe: 9 });
    expect(attemptAt(good, 'squat', 1)).toMatchObject({
      status: 'good',
      effort: 'grind',
      rpe: 9,
      missReason: null,
    });

    const missed = take(withLifter(), 'squat', 1, 100, MISSED);
    expect(attemptAt(missed, 'squat', 1)).toMatchObject({
      status: 'no-lift',
      effort: null,
      rpe: null,
      missReason: 'strength',
    });
  });

  it('refuses an RPE outside the scale it is recorded on', () => {
    const timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    const weighed = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    expect(
      refusals(weighed, {
        kind: 'record-result',
        attemptId,
        result: { outcome: 'good', effort: 'solid', rpe: 12 },
      }),
    ).toEqual(['rpe-out-of-range']);
  });

  it('refuses a second result on an attempt that already has one', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    expect(refusals(timeline, { kind: 'record-result', attemptId, result: MISSED })).toEqual([
      'attempt-already-resolved',
    ]);
  });

  it('starts the declaration clock on the next attempt', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(only(timeline).countdown).toEqual({
      attemptId: attemptAt(timeline, 'squat', 2).id,
      startedAt: AT,
      seconds: RULES.profile.submissionSeconds,
    });
  });

  it('starts no clock when the lift is over', () => {
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD, AT);
    timeline = take(timeline, 'squat', 2, 102, GOOD, AT + seconds(300));
    timeline = take(timeline, 'squat', 3, 104, GOOD, AT + seconds(600));
    expect(only(timeline).countdown).toBeNull();
    expect(nextAttemptOn(only(timeline), 'squat')).toBeNull();
  });
});

describe('extra attempts (§13.8)', () => {
  it('sets the disrupted attempt aside and offers another at the same weight', () => {
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED);
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'grant-extra-attempt', attemptId });

    expect(attemptAt(timeline, 'squat', 1).status).toBe('extra-attempt-granted');
    const [extra] = outstandingExtraAttempts(only(timeline), 'squat');
    expect(extra).toMatchObject({
      kind: 'extra',
      attemptNumber: 1,
      kilograms: 100,
      grantedFor: attemptId,
      status: 'planned',
    });
  });

  it('does not count the set-aside attempt as a miss or let it raise the floor', () => {
    // The whole of §13.8's "must not corrupt the planned round sequence". A
    // struck attempt that still counted would make the lifter's second a
    // progression above a lift that did not happen.
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED);
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'grant-extra-attempt', attemptId });

    expect(bombOutRisk(only(timeline), 'squat').misses).toBe(0);
    expect(takenOn(only(timeline), 'squat')).toEqual([
      { attemptNumber: 1, kilograms: 100, outcome: 'passed' },
    ]);
    expect(RULES.nextAttemptBounds(takenOn(only(timeline), 'squat')).minimumKilograms).toBe(
      RULES.profile.barMultipleKilograms,
    );
  });

  it('leaves the extra attempt out of the round sequence and reports it separately', () => {
    // Its timing is the expeditor's, not the application's. Slotting it in would
    // be the assumption §13.8 forbids.
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED);
    timeline = apply(timeline, {
      kind: 'grant-extra-attempt',
      attemptId: attemptAt(timeline, 'squat', 1).id,
    });
    expect(nextAttemptOn(only(timeline), 'squat')?.attemptNumber).toBe(2);
    expect(nextAttemptOn(only(timeline), 'squat')?.kind).toBe('competition');
    expect(outstandingExtraAttempts(only(timeline))).toHaveLength(1);
  });

  it('runs no clock against an extra attempt', () => {
    // A clock is the strongest possible assertion about when something is due,
    // and nothing here knows when this one lands.
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED);
    expect(only(timeline).countdown).not.toBeNull();
    timeline = apply(timeline, {
      kind: 'grant-extra-attempt',
      attemptId: attemptAt(timeline, 'squat', 1).id,
    });
    expect(only(timeline).countdown).toBeNull();
  });

  it('refuses to grant one against an attempt that was not missed', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(
      refusals(timeline, {
        kind: 'grant-extra-attempt',
        attemptId: attemptAt(timeline, 'squat', 1).id,
      }),
    ).toEqual(['not-a-missed-attempt']);
  });

  it('reaches the same state when the ruling arrives before the result is entered', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, { outcome: 'extra-attempt-granted' });
    expect(attemptAt(timeline, 'squat', 1).status).toBe('extra-attempt-granted');
    expect(outstandingExtraAttempts(only(timeline))).toHaveLength(1);
    expect(only(timeline).countdown).toBeNull();
  });
});

describe('totals', () => {
  it('is a subtotal until every contested lift has a good lift', () => {
    // §11. A lifter two lifts in has no total at all -- three misses on the
    // deadlift and they place nowhere. One number labelled "total" all day is
    // the screen that lets somebody believe the day is banked.
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    timeline = take(timeline, 'bench', 1, 60, GOOD);
    expect(totalSoFar(timeline.present, only(timeline))).toEqual({
      kilograms: 160,
      isTotal: false,
      liftsOutstanding: ['deadlift'],
    });

    timeline = take(timeline, 'deadlift', 1, 140, GOOD);
    expect(totalSoFar(timeline.present, only(timeline))).toEqual({
      kilograms: 300,
      isTotal: true,
      liftsOutstanding: [],
    });
  });

  it('counts the heaviest good lift and ignores the misses under it', () => {
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD, AT);
    timeline = take(timeline, 'squat', 2, 110, MISSED, AT + seconds(300));
    expect(bestGoodLift(only(timeline), 'squat')).toBe(100);
  });

  it('projects a candidate without storing it', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const projected = projectedTotalWith(timeline.present, only(timeline), 'bench', 60);
    expect(projected).toEqual({ kilograms: 160, isTotal: false, liftsOutstanding: ['deadlift'] });
    // Nothing was written down. A projected total that outlived the attempt it
    // was projecting is a plausible number nobody can trace.
    expect(totalSoFar(timeline.present, only(timeline)).kilograms).toBe(100);
  });

  it('never lets a candidate lower a lift already banked', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(projectedTotalWith(timeline.present, only(timeline), 'squat', 80).kilograms).toBe(100);
  });
});

describe('bombOutRisk', () => {
  it('counts the misses and the attempts left', () => {
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED, AT);
    timeline = take(timeline, 'squat', 2, 100, MISSED, AT + seconds(300));
    expect(bombOutRisk(only(timeline), 'squat')).toEqual({
      misses: 2,
      attemptsRemaining: 1,
      onTheLastChance: true,
    });
  });

  it('is not the last chance when a lift is already banked', () => {
    // §13.7's warning belongs on the lifter with nothing on the board, not on
    // the one taking a third for position.
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD, AT);
    timeline = take(timeline, 'squat', 2, 110, MISSED, AT + seconds(300));
    expect(bombOutRisk(only(timeline), 'squat')).toMatchObject({
      misses: 1,
      attemptsRemaining: 1,
      onTheLastChance: false,
    });
  });
});

describe('jumpFromPrevious', () => {
  it('measures the increase from the last attempt taken', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    let next = timeline;
    const second = attemptAt(next, 'squat', 2).id;
    next = apply(next, { kind: 'set-attempt-weight', attemptId: second, kilograms: 110 });
    expect(jumpFromPrevious(only(next), attemptAt(next, 'squat', 2))).toBe(10);
  });

  it('has no answer for the opener', () => {
    let timeline = withLifter();
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: 100 });
    expect(jumpFromPrevious(only(timeline), attemptAt(timeline, 'squat', 1))).toBeNull();
  });
});

describe('submissionState', () => {
  it('counts down from the instant the clock started', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const thirty = submissionState(RULES, timeline.present, only(timeline), AT + seconds(30));
    expect(thirty).toMatchObject({ secondsRemaining: 60, lapsed: false, submitted: false });
  });

  it('lapses at zero and stays there', () => {
    // A phone that slept through the minute reports the truth on waking, which
    // is what storing the instant rather than running a counter buys.
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const late = submissionState(RULES, timeline.present, only(timeline), AT + seconds(600));
    expect(late).toMatchObject({ secondsRemaining: 0, lapsed: true });
  });

  it('says what the officials will write down if nothing is declared', () => {
    // The single most useful thing this screen can say, because it is the rule
    // that applies when nobody is looking at it.
    const madeIt = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(submissionState(RULES, madeIt.present, only(madeIt), AT)?.automaticKilograms).toBe(102);

    const missed = take(withLifter(), 'squat', 1, 100, MISSED);
    expect(submissionState(RULES, missed.present, only(missed), AT)?.automaticKilograms).toBe(100);
  });

  it('reads "submitted" from the stamp rather than from the status', () => {
    // Reachable through §24 import rather than through an action: a document
    // arrives holding an attempt that was judged while its own clock still names
    // it. `submissionRank` answers -1 for every resolved status, so a rank
    // comparison would report that a lifted attempt was never submitted.
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    const lifter = only(timeline);
    const taken = attemptAt(timeline, 'squat', 1);
    const stale: LiveLifter = {
      ...lifter,
      countdown: { attemptId: taken.id, startedAt: AT, seconds: 90 },
    };
    const document: MeetDocument = { ...timeline.present, lifters: [stale] };
    expect(submissionState(RULES, document, stale, AT)?.submitted).toBe(true);
  });

  it('has nothing to report before a clock is running', () => {
    const timeline = withLifter();
    expect(submissionState(RULES, timeline.present, only(timeline), AT)).toBeNull();
  });
});

describe('changeAllowanceFor', () => {
  it('answers for the attempt’s own lift and number', () => {
    // The fixture federation allows two changes in the third deadlift and none
    // in the third squat, which is the kind of difference a single "changes
    // allowed" number would flatten.
    const timeline = withLifter();
    const deadlift = attemptAt(timeline, 'deadlift', 3).id;
    expect(changeAllowanceFor(RULES, timeline.present, deadlift)).toMatchObject({
      allowed: 2,
      remaining: 2,
      conditions: ['lapses-once-called-to-a-loaded-bar', 'not-below-the-preceding-lifter'],
    });
    expect(
      changeAllowanceFor(RULES, timeline.present, attemptAt(timeline, 'squat', 3).id),
    ).toMatchObject({ allowed: 0, remaining: 0, conditions: [] });
  });

  it('has no answer for an attempt that is not in the meet', () => {
    const timeline = withLifter();
    expect(changeAllowanceFor(RULES, timeline.present, 'no-such-attempt')).toBeNull();
  });
});

describe('add-record-attempt', () => {
  function throughThree(outcome: RecordedResult = GOOD): MeetTimeline {
    let timeline = take(withLifter(), 'squat', 1, 96, GOOD, AT);
    timeline = take(timeline, 'squat', 2, 98, GOOD, AT + seconds(300));
    return take(timeline, 'squat', 3, 100, outcome, AT + seconds(600));
  }

  it('refuses one before the last competition attempt has been taken', () => {
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(
      refusals(timeline, {
        kind: 'add-record-attempt',
        lifterId: only(timeline).id,
        lift: 'squat',
        kilograms: 110.25,
        recordKilograms: 110,
      }),
    ).toEqual(['record-attempt-not-available']);
  });

  it('refuses one after a third that was not good', () => {
    const timeline = throughThree(MISSED);
    expect(
      refusals(timeline, {
        kind: 'add-record-attempt',
        lifterId: only(timeline).id,
        lift: 'squat',
        kilograms: 110.25,
        recordKilograms: 110,
      }),
    ).toEqual(['record-attempt-not-available']);
  });

  it('refuses a weight that would not take the record', () => {
    const timeline = throughThree();
    expect(
      refusals(timeline, {
        kind: 'add-record-attempt',
        lifterId: only(timeline).id,
        lift: 'squat',
        kilograms: 110,
        recordKilograms: 110,
      }),
    ).toEqual(['weight-not-legal']);
  });

  it('adds it one past the third, and never lets it into the total', () => {
    // The one thing everybody knows about a fourth attempt and the one thing a
    // sum written the obvious way gets wrong.
    let timeline = throughThree();
    const before = totalSoFar(timeline.present, only(timeline)).kilograms;
    timeline = apply(timeline, {
      kind: 'add-record-attempt',
      lifterId: only(timeline).id,
      lift: 'squat',
      kilograms: 110.25,
      recordKilograms: 110,
    });
    const record = attemptsOn(only(timeline), 'squat').find((attempt) => attempt.kind === 'record');
    expect(record).toMatchObject({ attemptNumber: 4, kilograms: 110.25 });

    const recordId = record?.id ?? '';
    timeline = apply(timeline, {
      kind: 'record-result',
      attemptId: recordId,
      result: GOOD,
    });
    expect(bestGoodLift(only(timeline), 'squat')).toBe(100);
    expect(totalSoFar(timeline.present, only(timeline)).kilograms).toBe(before);
  });
});

describe('annotate-attempt', () => {
  it('keeps the lights and the note without touching the result', () => {
    let timeline = take(withLifter(), 'squat', 1, 100, MISSED);
    const attemptId = attemptAt(timeline, 'squat', 1).id;
    timeline = apply(timeline, {
      kind: 'annotate-attempt',
      attemptId,
      lights: ['red', 'white', 'red'],
      note: '  depth called  ',
    });
    expect(attemptAt(timeline, 'squat', 1)).toMatchObject({
      status: 'no-lift',
      missReason: 'strength',
      lights: ['red', 'white', 'red'],
      note: 'depth called',
    });
  });

  it('refuses a note it would otherwise have to truncate', () => {
    // A note cut at five hundred characters is a note whose last sentence was
    // the reason for writing it.
    const timeline = take(withLifter(), 'squat', 1, 100, GOOD);
    expect(
      refusals(timeline, {
        kind: 'annotate-attempt',
        attemptId: attemptAt(timeline, 'squat', 1).id,
        note: 'x'.repeat(501),
      }),
    ).toEqual(['note-too-long']);
  });
});

describe('unknown targets', () => {
  it('refuses every action that names something not in the meet', () => {
    const timeline = withLifter();
    expect(refusals(timeline, { kind: 'focus-lifter', lifterId: 'nobody' })).toEqual([
      'unknown-lifter',
    ]);
    expect(
      refusals(timeline, { kind: 'set-attempt-weight', attemptId: 'nothing', kilograms: 100 }),
    ).toEqual(['unknown-attempt']);
    expect(
      refusals(timeline, { kind: 'record-result', attemptId: 'nothing', result: GOOD }),
    ).toEqual(['unknown-attempt']);
    expect(findAttempt(timeline.present, 'nothing')).toBeNull();
  });
});

describe('undo (§13.9)', () => {
  it('restores the whole world, not a list of fields somebody remembered', () => {
    // The requirement names status, total, next recommendation, submission
    // state, timer, warm-up and the coach board. They are all one value here, so
    // this test checks the ones a mis-tapped "No Lift" would visibly corrupt and
    // trusts the shape for the rest.
    let timeline = take(withLifter(), 'squat', 1, 100, GOOD, AT);
    const before = timeline.present;
    const bankedTotal = totalSoFar(before, only(timeline)).kilograms;

    timeline = take(timeline, 'squat', 2, 110, MISSED, AT + seconds(300));
    expect(bombOutRisk(only(timeline), 'squat').misses).toBe(1);

    const undone = undo(timeline);
    if (!undone.ok) throw new Error('undo was refused');
    // Three actions went into taking that attempt, so three steps come back out.
    let restored = undone.timeline;
    restored = expectOk(undo(restored));
    restored = expectOk(undo(restored));

    expect(restored.present).toEqual(before);
    expect(totalSoFar(restored.present, only(restored)).kilograms).toBe(bankedTotal);
    expect(bombOutRisk(only(restored), 'squat').misses).toBe(0);
    expect(attemptAt(restored, 'squat', 2).kilograms).toBeNull();
    expect(only(restored).countdown).toEqual({
      attemptId: attemptAt(restored, 'squat', 2).id,
      startedAt: AT,
      seconds: RULES.profile.submissionSeconds,
    });
  });

  it('names the action it would reverse', () => {
    const timeline = withLifter();
    expect(undoableAction(timeline)).toEqual({ kind: 'add-lifter', name: 'Sam' });
  });

  it('refuses when there is nothing to undo', () => {
    const result = undo(timelineFor());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('undo should have been refused');
    expect(result.problems.map((problem) => problem.code)).toEqual(['nothing-to-undo']);
  });

  it('remembers nothing about an action that was refused', () => {
    // A refusal is not a step in the history. Undoing one would step back past
    // the last thing that actually happened.
    const timeline = withLifter();
    const before = timeline.past.length;
    expect(refusals(timeline, { kind: 'add-lifter', name: '' })).toHaveLength(1);
    expect(timeline.past).toHaveLength(before);
  });

  it('keeps a bounded history', () => {
    // Bounded because a coach board left open across a long meet would otherwise
    // grow a copy of the document per tap, on the phone running the timer.
    let timeline = withLifter();
    const lifterId = only(timeline).id;
    for (let index = 0; index < UNDO_HISTORY_LIMIT + 50; index += 1) {
      timeline = apply(timeline, { kind: 'focus-lifter', lifterId }, AT + index);
    }
    expect(timeline.past).toHaveLength(UNDO_HISTORY_LIMIT);
  });
});

describe('immutability', () => {
  it('leaves the earlier document exactly as it was', () => {
    // The history holds references, not copies, so an action that mutated in
    // place would corrupt every step behind it -- and undo would restore the
    // world it was supposed to be undoing.
    const timeline = withLifter();
    const before = timeline.present;
    const beforeAttempt = attemptAt(timeline, 'squat', 1);

    const after = take(timeline, 'squat', 1, 100, GOOD);

    expect(after.present).not.toBe(before);
    expect(before.lifters[0]?.attempts[0]).toBe(beforeAttempt);
    expect(beforeAttempt.kilograms).toBeNull();
    expect(beforeAttempt.status).toBe('planned');
  });
});

/** Unwraps a result that must have succeeded, keeping the undo test readable. */
function expectOk(result: ReturnType<typeof undo>): MeetTimeline {
  if (!result.ok) throw new Error('undo was refused');
  return result.timeline;
}
