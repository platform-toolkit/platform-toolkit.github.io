// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §11's live screen, asserted without one.
 *
 * Everything here runs against a real timeline built by `applyMeetAction`, never
 * against a hand-written `MeetDocument`. A literal document can hold a state the
 * actions cannot produce -- an attempt marked submitted with no weight, a
 * countdown pointing at a resolved attempt -- and a test that asserts the screen
 * copes with one proves the screen copes with something that will never arrive,
 * while saying nothing about the states that will.
 *
 * The builders live in `live-fixture.ts` because §13's element and its stories
 * need the same meet; the reasoning about why they are builders and not literals
 * moved there with them.
 */

import { describe, expect, it } from 'vitest';
import {
  MEET_STAFF_ARE_AUTHORITATIVE,
  createMeetDocument,
  startTimeline,
  type MeetTimeline,
} from '@platform-toolkit/domain';

import {
  EMPTY_LIVE_VIEW,
  SUBMISSION_CRITICAL_SECONDS,
  SUBMISSION_HURRY_SECONDS,
  awaitingResult,
  buildLiveView,
  urgencyFor,
} from './live.js';
import {
  LIFTER,
  OPENER,
  RULES,
  SECOND,
  START,
  THIRD,
  act,
  contextAt,
  meetWith,
  nextAttemptIdOn,
  onlyLifterIn,
  submit,
  take,
  viewOf,
} from './live-fixture.js';

describe('buildLiveView', () => {
  it('answers null for a lifter who is not in this meet', () => {
    const timeline = meetWith();

    expect(buildLiveView(timeline, 'nobody', contextAt(START))).toBeNull();

    // The control: the same timeline and the same instant do build a view, so
    // the null above is about the identifier rather than about an empty meet.
    expect(buildLiveView(timeline, onlyLifterIn(timeline), contextAt(START))).not.toBeNull();
  });

  it('opens on the first contested lift with nothing recorded', () => {
    const view = viewOf(meetWith());

    expect(view.lifterName).toBe(LIFTER);
    expect(view.position.lift).toBe('squat');
    expect(view.position.attemptNumber).toBe(1);
    expect(view.position.liftsFinished).toStrictEqual([]);
    expect(view.position.meetOver).toBe(false);
    expect(view.nextAction).toBe('choose-the-next-attempt');
  });

  it('follows the format rather than assuming three lifts', () => {
    // A push-pull lifter never squats, and a screen that opened on the squat
    // would ask for a weight on a lift the meet is not scored on.
    expect(viewOf(meetWith('push-pull')).position.lift).toBe('bench');
    expect(viewOf(meetWith('deadlift-only')).position.lift).toBe('deadlift');
  });

  it('asks for a submission once a weight has been selected', () => {
    const opening = meetWith();
    const attemptId = nextAttemptIdOn(opening, 'squat');
    const declared = act(opening, { kind: 'set-attempt-weight', attemptId, kilograms: OPENER });

    // A weight on the card is not yet a weight the table has been told.
    expect(viewOf(declared).nextAction).toBe('choose-the-next-attempt');

    const selected = act(declared, { kind: 'advance-attempt', attemptId, to: 'selected' });
    expect(viewOf(selected).nextAction).toBe('submit-to-the-table');
  });

  it('asks for the result at every status that means the table has it', () => {
    for (const status of ['submitted', 'confirmed', 'locked'] as const) {
      const opening = meetWith();
      const attemptId = nextAttemptIdOn(opening, 'squat');
      const declared = act(opening, { kind: 'set-attempt-weight', attemptId, kilograms: OPENER });
      const advanced = act(declared, { kind: 'advance-attempt', attemptId, to: status });

      expect(viewOf(advanced).nextAction).toBe('record-the-result');
    }
  });

  it('moves to the next lift when a lift runs out of attempts', () => {
    let timeline = meetWith();
    for (const kilograms of [OPENER, SECOND, THIRD]) timeline = take(timeline, 'squat', kilograms);

    const view = viewOf(timeline);

    expect(view.position.lift).toBe('bench');
    expect(view.position.attemptNumber).toBe(1);
    expect(view.position.liftsFinished).toStrictEqual(['squat']);
    expect(view.position.meetOver).toBe(false);
  });

  it('counts a bombed lift as finished rather than waiting on it', () => {
    // Three misses end the squat as surely as three good lifts. A screen that
    // held position on a lift with no attempts left would ask for a fourth.
    let timeline = meetWith();
    for (let round = 0; round < 3; round += 1) {
      timeline = take(timeline, 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' });
    }

    const view = viewOf(timeline);

    expect(view.position.lift).toBe('bench');
    expect(view.position.liftsFinished).toStrictEqual(['squat']);
    expect(view.banked.kilograms).toBe(0);
    expect(view.banked.isTotal).toBe(false);
  });

  it('reports the meet over when every contested lift is finished', () => {
    let timeline = meetWith('bench-only');
    for (const kilograms of [OPENER, SECOND, THIRD]) timeline = take(timeline, 'bench', kilograms);

    const view = viewOf(timeline);

    expect(view.position.meetOver).toBe(true);
    expect(view.position.lift).toBeNull();
    expect(view.nextAction).toBe('the-meet-is-over');
    expect(view.nextAttempt).toBeNull();
    expect(view.choices).toBeNull();
    expect(view.bombOut).toBeNull();
    // Still a figure worth showing, and on a bench-only meet it is a total.
    expect(view.banked.kilograms).toBe(THIRD);
    expect(view.banked.isTotal).toBe(true);
  });
});

describe('buildLiveView totals', () => {
  it('does not call a subtotal a total while a lift is outstanding', () => {
    const timeline = take(meetWith(), 'squat', OPENER);
    const view = viewOf(timeline);

    expect(view.banked.kilograms).toBe(OPENER);
    expect(view.banked.isTotal).toBe(false);
    expect(view.banked.liftsOutstanding).toStrictEqual(['bench', 'deadlift']);
  });

  it('projects the highlighted choice rather than recomputing it', () => {
    const view = viewOf(take(meetWith('bench-only'), 'bench', OPENER));
    const highlighted = view.choices?.choices.find((choice) => choice.highlighted);

    expect(highlighted).toBeDefined();
    expect(view.projected).toStrictEqual(highlighted?.projected);
    // The control: it is a different figure from what is banked, so the
    // assertion above is not satisfied by two copies of the same total.
    expect(view.projected?.kilograms).toBeGreaterThan(view.banked.kilograms);
  });

  it('follows the highlight flag rather than the first card', () => {
    // §13.4 is where position and highlight come apart: after a grind the pass
    // sits in the secure slot -- first, where a thumb lands -- and the tool still
    // recommends the smallest legal increase beside it. Reading the projection
    // off the first card would report that lifter as projecting nothing, which is
    // the tool telling somebody who ground out an opener that their day is over.
    const ground = take(meetWith('bench-only'), 'bench', OPENER, {
      outcome: 'good',
      effort: 'grind',
    });
    const view = viewOf(ground);
    const [first] = view.choices?.choices ?? [];

    expect(first?.highlighted).toBe(false);
    expect(first?.kilograms).toBeNull();
    expect(view.projected?.kilograms).toBeGreaterThan(OPENER);
  });

  it('projects nothing when the highlighted choice is to stop the lift', () => {
    // §13.5. Showing the banked figure under "projected" would read as the pass
    // adding something, when what it does is close the lift.
    const hurt = take(meetWith('bench-only'), 'bench', OPENER, { outcome: 'good', effort: 'pain' });
    const hurtView = viewOf(hurt);

    expect(hurtView.choices?.choices.find((choice) => choice.highlighted)?.kilograms).toBeNull();
    expect(hurtView.projected).toBeNull();

    // The control: the identical attempt reported as solid does project, so the
    // null above is the pain branch rather than projection being broken.
    const solid = take(meetWith('bench-only'), 'bench', OPENER, {
      outcome: 'good',
      effort: 'solid',
    });
    expect(viewOf(solid).projected).not.toBeNull();
  });
});

describe('buildLiveView attempt card', () => {
  it('carries no jump on an opener and the increase on a second', () => {
    expect(viewOf(meetWith()).nextAttempt?.jumpKilograms).toBeNull();

    const opened = take(meetWith(), 'squat', OPENER);
    const declared = act(opened, {
      kind: 'set-attempt-weight',
      attemptId: nextAttemptIdOn(opened, 'squat'),
      kilograms: SECOND,
    });
    expect(viewOf(declared).nextAttempt?.jumpKilograms).toBe(SECOND - OPENER);
  });

  it('carries what the rules still allow to be changed', () => {
    const view = viewOf(meetWith());
    const allowance = view.nextAttempt?.changes;

    expect(allowance).not.toBeNull();
    // Derived from the profile rather than written out, so a fixture edit cannot
    // leave this asserting a number the rule book no longer says.
    expect(allowance?.allowed).toBe(RULES.profile.openerChange.allowed);
  });

  it('reads pounds off the chart rather than converting to them', () => {
    const view = viewOf(submit(meetWith(), 'squat', OPENER));
    const weight = view.nextAttempt?.weight;

    expect(weight?.kilograms).toBe(OPENER);
    expect(weight?.publishedPounds).toBe(396.9);
    // §16 in one assertion: the two figures differ, so a screen showing the
    // published one cannot have arrived at it by multiplying.
    expect(weight?.exactPounds).not.toBe(weight?.publishedPounds);
  });

  it('says why there is no pound figure when no chart is loaded', () => {
    const view = viewOf(submit(meetWith(), 'squat', OPENER), contextAt(START, { chart: null }));
    const weight = view.nextAttempt?.weight;

    expect(weight?.publishedPounds).toBeNull();
    expect(weight?.publishedPoundsReason).toBe('no-chart');
    // Still the attempt, which is the kilogram figure and always is.
    expect(weight?.kilograms).toBe(OPENER);
  });

  it('has no weight on a card nobody has filled in', () => {
    expect(viewOf(meetWith()).nextAttempt?.weight).toBeNull();
  });
});

describe('buildLiveView submission panel', () => {
  /** A meet where the squat opener has been judged, so a declaration clock runs. */
  function counting(): MeetTimeline {
    return take(meetWith(), 'squat', OPENER);
  }

  const WINDOW = RULES.profile.submissionSeconds;

  it('has no panel until a clock is running', () => {
    expect(viewOf(meetWith()).submission).toBeNull();

    // The control: one recorded result starts one, so the null above is the
    // absence of a clock rather than the panel never being built.
    expect(viewOf(counting()).submission).not.toBeNull();
  });

  it('names the lifter beside the weight', () => {
    // §14's failure is the correct weight submitted for the wrong athlete, and
    // the header that carries the name scrolls away from the control that does it.
    expect(viewOf(counting()).submission?.lifterName).toBe(LIFTER);
  });

  it('derives the seconds from the instant rather than counting them down', () => {
    // The same timeline read at two instants with nothing in between. This is
    // what a phone that slept through the minute does on waking, and a counter
    // decremented per tick would come back showing time the lifter does not have.
    const timeline = counting();

    expect(viewOf(timeline, contextAt(START + 30_000)).submission?.secondsRemaining).toBe(
      WINDOW - 30,
    );
    expect(
      viewOf(timeline, contextAt(START + (WINDOW - 1) * 1000)).submission?.secondsRemaining,
    ).toBe(1);
  });

  it('bands the urgency without ever dropping the number', () => {
    const timeline = counting();
    const at = (secondsRemaining: number): number => START + (WINDOW - secondsRemaining) * 1000;

    expect(viewOf(timeline, contextAt(at(WINDOW))).submission?.urgency).toBe('calm');
    expect(viewOf(timeline, contextAt(at(SUBMISSION_HURRY_SECONDS))).submission?.urgency).toBe(
      'hurry',
    );
    expect(viewOf(timeline, contextAt(at(SUBMISSION_CRITICAL_SECONDS))).submission?.urgency).toBe(
      'critical',
    );

    const lapsed = viewOf(timeline, contextAt(at(-5)));
    expect(lapsed.submission?.urgency).toBe('lapsed');
    expect(lapsed.submission?.lapsed).toBe(true);
    // Never a colour on its own: every band carries the seconds it was read from.
    expect(lapsed.submission?.secondsRemaining).toBe(0);
  });

  it('reports what the officials would write down if nothing is declared', () => {
    const automatic = viewOf(counting()).submission?.automatic;

    // Off the rule book, not off this test: the fixture opens with
    // `increase-by-increment`, and which increment that is belongs to the profile.
    expect(automatic?.kilograms).toBe(
      RULES.automaticAttemptAfter({ attemptNumber: 1, kilograms: OPENER, outcome: 'good' })
        ?.kilograms,
    );
    expect(automatic?.kilograms).toBeGreaterThan(OPENER);
  });

  it('knows whether the table has already been told', () => {
    const timeline = counting();
    expect(viewOf(timeline).submission?.submitted).toBe(false);

    const attemptId = nextAttemptIdOn(timeline, 'squat');
    const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: SECOND });
    const submitted = act(declared, { kind: 'advance-attempt', attemptId, to: 'submitted' });

    expect(viewOf(submitted).submission?.submitted).toBe(true);
  });

  it('reads both of the panel figures off the chart', () => {
    // The panel is where §16 costs the most: this is the number a handler reads
    // aloud at the table, so it has to be the federation's rendering of the
    // attempt and not this application's arithmetic. Asserted on the panel in
    // its own right because the attempt card's figure is built by a different
    // call, and a chart dropped from one of the two would look fine on the other.
    const timeline = counting();
    const attemptId = nextAttemptIdOn(timeline, 'squat');
    const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms: SECOND });
    const panel = viewOf(declared).submission;

    expect(panel?.weight?.kilograms).toBe(SECOND);
    expect(panel?.weight?.publishedPounds).toBe(418.9);
    expect(panel?.weight?.exactPounds).not.toBe(panel?.weight?.publishedPounds);

    // The automatic weight goes through the chart too, and here it lands between
    // two rows -- which is an answer with a reason on it, not a missing figure.
    expect(panel?.automatic?.publishedPounds).toBeNull();
    expect(panel?.automatic?.publishedPoundsReason).toBe('not-on-the-chart');
  });

  it('has no weight on the panel when the next attempt is blank', () => {
    // The control for the assertion above: the clock can be running before a
    // weight exists, and a panel showing the previous attempt's figure there
    // would be the tool proposing a declaration nobody made.
    expect(viewOf(counting()).submission?.weight).toBeNull();
  });
});

describe('buildLiveView carried-through facts', () => {
  it('passes the observed figures on untouched', () => {
    const observed = {
      attemptsBeforeCalled: 0,
      urgent: [{ kind: 'equipment', message: 'Knee wraps on.' }],
    } as const;

    expect(viewOf(meetWith(), contextAt(START, { observed })).observed).toStrictEqual(observed);
  });

  it('leaves the count unknown rather than guessing it', () => {
    // Nought means the lifter is up now, which is the most urgent thing this
    // screen can say. Nobody having counted has to be a different value.
    expect(viewOf(meetWith()).observed.attemptsBeforeCalled).toBeNull();
  });

  it('has nothing to undo before anything has happened, and names the last action after', () => {
    const fresh = startTimeline(createMeetDocument(RULES, 'full-power'));
    const added = act(fresh, { kind: 'add-lifter', name: LIFTER });

    expect(buildLiveView(fresh, 'nobody', contextAt(START))).toBeNull();
    expect(viewOf(added).undoable?.kind).toBe('add-lifter');

    const declared = act(added, {
      kind: 'set-attempt-weight',
      attemptId: nextAttemptIdOn(added, 'squat'),
      kilograms: OPENER,
    });
    expect(viewOf(declared).undoable?.kind).toBe('set-attempt-weight');
  });

  it('carries the sentence about who is authoritative on every view', () => {
    // Including the one where the meet is over, which is still a screen somebody
    // acts on -- §29 is a list of sentences that must appear, not a tone note.
    let finished = meetWith('bench-only');
    for (const kilograms of [OPENER, SECOND, THIRD]) finished = take(finished, 'bench', kilograms);

    expect(viewOf(meetWith()).notices).toContain(MEET_STAFF_ARE_AUTHORITATIVE);
    expect(viewOf(finished).notices).toContain(MEET_STAFF_ARE_AUTHORITATIVE);
  });

  it('reports a granted extra attempt beside the choices and not among them', () => {
    // §13.8: the round order belongs to the expeditor, so an extra is reported
    // rather than scheduled.
    const missed = take(meetWith(), 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' });
    const attempts = missed.present.lifters[0]?.attempts ?? [];
    const missedId = attempts.find((attempt) => attempt.status === 'no-lift')?.id;
    if (missedId === undefined) throw new Error('fixture recorded no miss');

    const granted = act(missed, { kind: 'grant-extra-attempt', attemptId: missedId });
    const view = viewOf(granted);

    expect(view.extraAttempts).toHaveLength(1);
    expect(view.choices?.choices.map((choice) => choice.kilograms)).not.toContain(
      view.extraAttempts[0]?.kilograms,
    );
  });
});

describe('urgencyFor', () => {
  it('bands on the thresholds inclusively', () => {
    expect(urgencyFor(SUBMISSION_HURRY_SECONDS + 1, false)).toBe('calm');
    expect(urgencyFor(SUBMISSION_HURRY_SECONDS, false)).toBe('hurry');
    expect(urgencyFor(SUBMISSION_CRITICAL_SECONDS + 1, false)).toBe('hurry');
    expect(urgencyFor(SUBMISSION_CRITICAL_SECONDS, false)).toBe('critical');
    expect(urgencyFor(0, false)).toBe('critical');
  });

  it('reports a lapsed clock as lapsed whatever the seconds say', () => {
    // `submissionState` floors at zero, so a lapsed clock and a clock with one
    // second left are the same number from some angles and never the same state.
    expect(urgencyFor(0, true)).toBe('lapsed');
    expect(urgencyFor(SUBMISSION_HURRY_SECONDS * 2, true)).toBe('lapsed');
  });
});

describe('awaitingResult', () => {
  it('is true only while an attempt is with the referees', () => {
    const planned = meetWith();
    const [plannedLifter] = planned.present.lifters;
    if (plannedLifter === undefined) throw new Error('fixture has no lifter');
    expect(awaitingResult(planned.present, plannedLifter)).toBe(false);

    const submitted = submit(planned, 'squat', OPENER);
    const [submittedLifter] = submitted.present.lifters;
    if (submittedLifter === undefined) throw new Error('fixture has no lifter');
    expect(awaitingResult(submitted.present, submittedLifter)).toBe(true);

    const judged = act(submitted, {
      kind: 'record-result',
      attemptId: nextAttemptIdOn(planned, 'squat'),
      result: { outcome: 'good', effort: 'solid' },
    });
    const [judgedLifter] = judged.present.lifters;
    if (judgedLifter === undefined) throw new Error('fixture has no lifter');
    expect(awaitingResult(judged.present, judgedLifter)).toBe(false);
  });

  it('is false once the meet is over', () => {
    let finished = meetWith('bench-only');
    for (const kilograms of [OPENER, SECOND, THIRD]) finished = take(finished, 'bench', kilograms);
    const [lifter] = finished.present.lifters;
    if (lifter === undefined) throw new Error('fixture has no lifter');

    expect(awaitingResult(finished.present, lifter)).toBe(false);
  });
});

describe('EMPTY_LIVE_VIEW', () => {
  it('is renderable and claims nothing', () => {
    // The binding fallback. It has to survive being drawn before a lifter exists,
    // which means every optional field is absent rather than plausible.
    expect(EMPTY_LIVE_VIEW.lifterName).toBe('');
    expect(EMPTY_LIVE_VIEW.nextAction).toBe('the-meet-is-over');
    expect(EMPTY_LIVE_VIEW.nextAttempt).toBeNull();
    expect(EMPTY_LIVE_VIEW.submission).toBeNull();
    expect(EMPTY_LIVE_VIEW.choices).toBeNull();
    expect(EMPTY_LIVE_VIEW.banked.isTotal).toBe(false);
    expect(EMPTY_LIVE_VIEW.notices).toStrictEqual([]);
  });
});
