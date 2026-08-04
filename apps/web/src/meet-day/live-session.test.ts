// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { attemptsOn, undoableAction, type MeetTimeline } from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { livePlanningFrom, liveTargetsFrom, seedLiveMeet } from './live-session.js';
import { rulesFor } from './meet-rules.fixture.js';
import { buildPlan, type PlanContext, type PlannerView } from './plan.js';
import {
  EMPTY_SESSION,
  confirmMaximum,
  withFigures,
  withSetup,
  withTargets,
  type PlannerSession,
} from './session.js';

const LIFTS: readonly PlatformLift[] = ['squat', 'bench', 'deadlift'];

/** No chart, which is the state every screen paints in first (§16). */
const CONTEXT: PlanContext = { rules: rulesFor(), chart: null };

/** A whole session with one maximum on every lift, agreed to. */
function planned(kilograms = '200'): PlannerSession {
  const typed = LIFTS.reduce(
    (carry, lift) => withFigures(carry, lift, { expectedMaximum: kilograms }),
    EMPTY_SESSION,
  );
  return LIFTS.reduce((carry, lift) => confirmMaximum(carry, lift, true), typed);
}

function viewOf(session: PlannerSession): PlannerView {
  return buildPlan(session, CONTEXT);
}

/** The weights the plan drew for one lift, in attempt order. */
function plannedWeights(view: PlannerView, lift: PlatformLift): readonly number[] {
  const entry = view.lifts.find((candidate) => candidate.lift === lift);
  if (entry === undefined) throw new Error(`the session does not contest the ${lift}`);
  return entry.attempts.map((attempt) => attempt.weight.kilograms);
}

/** The weights on the board for one lift, in attempt order. */
function boardWeights(timeline: MeetTimeline, lift: PlatformLift): readonly (number | null)[] {
  const lifter = timeline.present.lifters.at(0);
  if (lifter === undefined) throw new Error('the seeded meet has nobody in it');
  return attemptsOn(lifter, lift).map((attempt) => attempt.kilograms);
}

const AT = 1_700_000_000_000;

function seedOf(session: PlannerSession, name = 'Dana Okafor'): MeetTimeline {
  const result = seedLiveMeet({
    rules: CONTEXT.rules,
    session,
    view: viewOf(session),
    lifterName: name,
    at: AT,
  });
  if (!result.ok) throw new Error(`the seed was refused: ${result.problems[0]?.code ?? 'none'}`);
  return result.timeline;
}

describe('livePlanningFrom', () => {
  it('hands live mode the same plan object the screen was drawn from', () => {
    // Identity rather than equality, deliberately: the requirement is that the
    // choices at the platform are anchored to the plan the lifter agreed to, and
    // an equal-but-rebuilt plan satisfies a deep comparison while being exactly
    // the second opinion this function exists to prevent.
    const view = viewOf(planned());
    const squat = view.lifts.find((lift) => lift.lift === 'squat');

    expect(livePlanningFrom(view).squat.plan).toBe(squat?.plan);
    expect(livePlanningFrom(view).squat.plan).not.toBeNull();
  });

  it('carries the confirmed maximum and the ceiling as two separate figures', () => {
    const session = LIFTS.reduce(
      (carry, lift) => withFigures(carry, lift, { ceiling: '215' }),
      planned('200'),
    );

    const bench = livePlanningFrom(viewOf(session)).bench;

    expect(bench.meetDayMaximumKilograms).toBe(200);
    expect(bench.ceilingKilograms).toBe(215);
  });

  it('keeps the ceiling for a lift whose plan never got drawn', () => {
    // A lifter who typed a limit and then left the maximum unconfirmed has still
    // said what their limit is, and live mode clamps to it whatever produced the
    // weights. This is the case that would be lost by reading the ceiling off
    // the plan object instead of off the view.
    const session = confirmMaximum(
      withFigures(planned('200'), 'deadlift', { ceiling: '230' }),
      'deadlift',
      false,
    );

    const deadlift = livePlanningFrom(viewOf(session)).deadlift;

    expect(deadlift.plan).toBeNull();
    expect(deadlift.ceilingKilograms).toBe(230);
  });

  it('answers for a lift the format does not contest', () => {
    // Total over every platform lift, so no branch downstream has to decide what
    // a missing key means -- and a squat figure typed before the format was
    // corrected is simply not planning, rather than an absent record entry.
    const session = withSetup(planned(), { format: 'push-pull' });

    const planning = livePlanningFrom(viewOf(session));

    expect(planning.squat.plan).toBeNull();
    expect(planning.squat.meetDayMaximumKilograms).toBeNull();
    expect(planning.bench.plan).not.toBeNull();
  });
});

describe('liveTargetsFrom', () => {
  it('reads the four totals §8.3 asks for', () => {
    const session = withTargets(planned(), {
      personalRecordTotal: '600',
      qualifyingTotal: '565',
      minimumAcceptableTotal: '520',
      stretchTotal: '630',
    });

    const totals = liveTargetsFrom(session).filter((target) => target.measure === 'total');

    expect(totals.map((target) => [target.kind, target.kilograms])).toEqual([
      ['personal-record', 600],
      ['qualification', 565],
      ['minimum-acceptable', 520],
      ['stretch', 630],
    ]);
  });

  it('keeps the lifters own floor and their stretch apart', () => {
    // The two kinds the domain union had to grow for. Mapping either onto
    // `qualification` would report a figure the lifter chose as one a federation
    // set, on the screen where that difference decides whether they take another
    // attempt.
    const session = withTargets(planned(), {
      minimumAcceptableTotal: '520',
      stretchTotal: '630',
    });

    const kinds = liveTargetsFrom(session).map((target) => target.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('reads a target typed in pounds as kilograms', () => {
    // Pinned against a hand-computed figure rather than against a second call to
    // the reader: 500 lb is 226.796 kg, and a target left at 500 would sit under
    // every total the lifter makes without ever looking wrong.
    const session = withTargets(withSetup(planned(), { unit: 'lb' }), {
      qualifyingTotal: '500',
    });

    const qualifying = liveTargetsFrom(session).find((target) => target.kind === 'qualification');

    expect(qualifying?.kilograms).toBeCloseTo(226.796, 2);
  });

  it('says which lift a personal record sits on', () => {
    const session = withFigures(planned(), 'bench', { personalRecord: '140' });

    const record = liveTargetsFrom(session).find((target) => target.measure === 'lift');

    expect(record?.lift).toBe('bench');
    expect(record?.kilograms).toBe(140);
  });

  it('offers a lift target before a total, because a lift target can move next', () => {
    const session = withTargets(withFigures(planned(), 'deadlift', { personalRecord: '250' }), {
      personalRecordTotal: '600',
    });

    const measures = liveTargetsFrom(session).map((target) => target.measure);

    expect(measures).toEqual(['lift', 'total']);
  });

  it('leaves out a record on a lift this meet does not run', () => {
    // A target no attempt today can reach reads on the live screen as one the
    // lifter is failing to reach.
    const session = withFigures(withSetup(planned(), { format: 'bench-only' }), 'squat', {
      personalRecord: '250',
    });

    expect(liveTargetsFrom(session).some((target) => target.lift === 'squat')).toBe(false);
  });

  it('leaves out a target nobody typed', () => {
    expect(liveTargetsFrom(planned())).toEqual([]);
  });

  it('names every target differently', () => {
    // Asserted as a difference rather than against the wording, which lives in
    // `copy.ts` and would move the expected value with the code. One literal
    // fragment is pinned so a labeller returning the same word for everything
    // cannot pass by being uniformly wrong.
    const session = withTargets(
      LIFTS.reduce((carry, lift) => withFigures(carry, lift, { personalRecord: '150' }), planned()),
      { personalRecordTotal: '600', stretchTotal: '630' },
    );

    const labels = liveTargetsFrom(session).map((target) => target.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => label.includes('personal record'))).toHaveLength(4);
  });
});

describe('seedLiveMeet', () => {
  it('puts the planned weights on the board', () => {
    const session = planned();

    expect(boardWeights(seedOf(session), 'squat')).toEqual(
      plannedWeights(viewOf(session), 'squat'),
    );
  });

  it('seeds every contested lift and no others', () => {
    const session = withSetup(planned(), { format: 'push-pull' });
    const timeline = seedOf(session);

    expect(boardWeights(timeline, 'squat')).toEqual([]);
    expect(boardWeights(timeline, 'deadlift')).toHaveLength(3);
  });

  it('leaves nothing to undo', () => {
    // §13.9's undo is for correcting a result at the expeditor's table. Without
    // the restart the first thing it offers a lifter at their opener is "Undo
    // choosing 180 kg" -- an action they did not take -- and ten presses walk the
    // plan back off the board one weight at a time.
    const timeline = seedOf(planned());

    expect(undoableAction(timeline)).toBeNull();
    expect(timeline.past).toEqual([]);
  });

  it('carries the name the submission panel shows', () => {
    // §14's named failure is the correct weight submitted for the wrong athlete.
    expect(seedOf(planned(), 'Sam Whitlock').present.lifters.at(0)?.name).toBe('Sam Whitlock');
  });

  it('refuses a meet with nobody in it', () => {
    const session = planned();
    const result = seedLiveMeet({
      rules: CONTEXT.rules,
      session,
      view: viewOf(session),
      lifterName: '   ',
      at: AT,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual([
      'lifter-name-required',
    ]);
  });

  it('opens live mode for a lifter who confirmed nothing', () => {
    // No plan is a supported state, not a missing one. Refusing to start would
    // strand somebody at the platform over weights they can simply type.
    const session = LIFTS.reduce((carry, lift) => confirmMaximum(carry, lift, false), planned());
    const result = seedLiveMeet({
      rules: CONTEXT.rules,
      session,
      view: viewOf(session),
      lifterName: 'Dana Okafor',
      at: AT,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? boardWeights(result.timeline, 'squat') : []).toEqual([null, null, null]);
    expect(result.ok ? result.unplaced : ['not reached']).toEqual([]);
  });

  it('skips a manually typed attempt the rules already refused', () => {
    // Manual entry is the one method whose weights can be illegal, and `plan.ts`
    // has already put the refusal on the attempt and on the screen. Pushing it
    // into the document would collect the same sentence a second time and file
    // it as a defect.
    const session = withFigures(withSetup(planned(), { method: 'manual' }), 'squat', {
      // A half-kilogram rise, under the fixture's one-kilogram progression.
      attempts: ['180', '180.5', '190'],
    });
    const result = seedLiveMeet({
      rules: CONTEXT.rules,
      session,
      view: viewOf(session),
      lifterName: 'Dana Okafor',
      at: AT,
    });

    expect(result.ok ? result.unplaced : ['not reached']).toEqual([]);
    expect(result.ok ? boardWeights(result.timeline, 'squat') : []).toEqual([180, null, 190]);
  });

  it('builds the same document twice from the same answers', () => {
    // Nothing here reads a clock, which is what lets a test seed a meet and a
    // countdown be replayed at two instants with nothing in between.
    const first = seedOf(planned());
    const second = seedOf(planned());

    expect(first.present).toEqual(second.present);
  });
});
