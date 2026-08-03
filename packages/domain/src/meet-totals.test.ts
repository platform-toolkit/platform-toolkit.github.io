// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §17, one figure at a time, plus the properties that hold across all of them.
 *
 * The figures are tested against each other rather than against written-out
 * numbers wherever a relationship is what the requirement is about: the settled
 * subtotal never exceeds the guaranteed total, no projection is below what is
 * banked, and a projection that walks the recommended slot lands exactly where the
 * lifter lands if they take the recommended option every time. That last one is
 * the whole design in a test -- if it ever fails, the projection has grown its own
 * opinion about what to lift.
 *
 * The fixture federation loads the bar in multiples of 2 kg (§5.1), so a figure
 * that came from a hard-coded 2.5 anywhere shows up as a wrong answer rather than
 * as a passing test.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { planAttempts, type AttemptPlan, type MeetGoal } from './attempt-plan.js';
import { liveChoicesFor, type LiveChoiceSlot, type LiveTarget } from './live-choices.js';
import {
  applyMeetAction,
  attemptsOn,
  createMeetDocument,
  startTimeline,
  type LiveLifter,
  type MeetAction,
  type MeetTimeline,
  type RecordedResult,
} from './meet-document.js';
import { rulesFor } from './meet-profile.fixture.js';
import {
  PROJECTION_BASES,
  meetTotals,
  type LiftProjectionInput,
  type MeetTotals,
  type ProjectionBasis,
} from './meet-totals.js';

const RULES = rulesFor();

/** An invented instant. Nothing here reads the clock. */
const AT = 1_700_000_000_000;

/** The fixture's own increment, read rather than assumed. */
const STEP = RULES.profile.barMultipleKilograms;

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };

function apply(timeline: MeetTimeline, action: MeetAction, at = AT): MeetTimeline {
  const result = applyMeetAction(RULES, timeline, action, at);
  if (!result.ok) {
    throw new Error(
      `${action.kind} was refused: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.timeline;
}

function meetWithLifter(format: 'full-power' | 'bench-only' = 'full-power'): MeetTimeline {
  return apply(startTimeline(createMeetDocument(RULES, format)), {
    kind: 'add-lifter',
    name: 'Sam',
  });
}

function only(timeline: MeetTimeline): LiveLifter {
  const [lifter] = timeline.present.lifters;
  if (lifter === undefined) throw new Error('the meet has no lifters');
  return lifter;
}

function attemptAt(timeline: MeetTimeline, lift: PlatformLift, attemptNumber: number): string {
  const attempt = attemptsOn(only(timeline), lift).find(
    (candidate) => candidate.attemptNumber === attemptNumber && candidate.kind === 'competition',
  );
  if (attempt === undefined) throw new Error(`no ${lift} attempt ${String(attemptNumber)}`);
  return attempt.id;
}

/** Weigh, submit and judge one attempt, the way a round actually goes. */
function take(
  timeline: MeetTimeline,
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  result: RecordedResult = GOOD,
): MeetTimeline {
  const attemptId = attemptAt(timeline, lift, attemptNumber);
  let next = apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms });
  next = apply(next, { kind: 'advance-attempt', attemptId, to: 'submitted' });
  return apply(next, { kind: 'record-result', attemptId, result });
}

function planFor(lift: PlatformLift, maximum: number, goal: MeetGoal = 'balanced'): AttemptPlan {
  const result = planAttempts(RULES, { lift, meetDayMaximumKilograms: maximum, goal });
  if (!result.ok) {
    throw new Error(`the fixture plan was refused: ${JSON.stringify(result.problems)}`);
  }
  return result.plan;
}

function totalsFor(
  timeline: MeetTimeline,
  options: {
    readonly lifts?: Partial<Record<PlatformLift, LiftProjectionInput>>;
    readonly targets?: readonly LiveTarget[];
  } = {},
): MeetTotals {
  return meetTotals(RULES, {
    document: timeline.present,
    lifter: only(timeline),
    lifts: options.lifts ?? {},
    targets: options.targets ?? [],
  });
}

/** A plan for every contested lift, so the projections have something to follow. */
function plans(maximum = 200): Partial<Record<PlatformLift, LiftProjectionInput>> {
  return {
    squat: { plan: planFor('squat', maximum) },
    bench: { plan: planFor('bench', maximum * 0.6) },
    deadlift: { plan: planFor('deadlift', maximum * 1.2) },
  };
}

function codes(totals: MeetTotals): readonly string[] {
  return totals.advisories.map((advisory) => advisory.code);
}

/**
 * Take every attempt the tool highlights in one slot, for real, through the rules.
 *
 * The independent implementation the projection is checked against. It goes
 * through `applyMeetAction`, so a weight the federation would refuse fails here
 * loudly rather than agreeing quietly with a projection that made the same
 * mistake.
 */
function playOut(
  timeline: MeetTimeline,
  slot: LiveChoiceSlot,
  lifts: Partial<Record<PlatformLift, LiftProjectionInput>>,
): MeetTimeline {
  let current = timeline;
  for (const lift of ['squat', 'bench', 'deadlift'] as const) {
    for (let guard = 0; guard < 5; guard += 1) {
      const choices = liveChoicesFor(RULES, {
        document: current.present,
        lifter: only(current),
        lift,
        plan: lifts[lift]?.plan ?? null,
      });
      if (choices.attemptId === null) break;
      const choice =
        choices.choices.find((candidate) => candidate.slot === slot) ??
        choices.choices.find((candidate) => candidate.highlighted);
      if (choice?.kilograms == null) break;
      current = take(current, lift, choices.attemptNumber ?? 1, choice.kilograms);
    }
  }
  return current;
}

describe('§17 the five figures are five figures', () => {
  it('separates what is banked from what is settled', () => {
    // One squat made with two squats still to come: banked, but not settled.
    const timeline = take(meetWithLifter(), 'squat', 1, 100);
    const totals = totalsFor(timeline, { lifts: plans() });

    expect(totals.guaranteed.kilograms).toBe(100);
    expect(totals.guaranteed.isTotal).toBe(false);
    expect(totals.subtotal.kilograms).toBe(0);
    expect(totals.subtotal.liftsInProgress).toEqual(['squat', 'bench', 'deadlift']);
    expect(totals.subtotal.everyLiftSettled).toBe(false);
  });

  it('settles a lift once its attempts are gone', () => {
    let timeline = take(meetWithLifter(), 'squat', 1, 100);
    timeline = take(timeline, 'squat', 2, 100 + STEP);
    timeline = take(timeline, 'squat', 3, 100 + STEP * 2);
    const totals = totalsFor(timeline, { lifts: plans() });

    expect(totals.subtotal.kilograms).toBe(100 + STEP * 2);
    expect(totals.subtotal.liftsSettled).toEqual(['squat']);
    expect(totals.subtotal.liftsInProgress).toEqual(['bench', 'deadlift']);
  });

  it('reports a settled lift that was bombed as settled and worth nothing', () => {
    const missed: RecordedResult = { outcome: 'no-lift', reason: 'strength' };
    let timeline = take(meetWithLifter('bench-only'), 'bench', 1, 100, missed);
    timeline = take(timeline, 'bench', 2, 100, missed);
    timeline = take(timeline, 'bench', 3, 100, missed);
    const totals = totalsFor(timeline);

    expect(totals.subtotal.everyLiftSettled).toBe(true);
    expect(totals.subtotal.kilograms).toBe(0);
    expect(totals.guaranteed.isTotal).toBe(false);
    expect(codes(totals)).toContain('no-total-yet');
  });

  it('orders the three projections from cautious to aggressive', () => {
    const totals = totalsFor(meetWithLifter(), { lifts: plans() });

    expect(totals.secure.total.kilograms).toBeLessThan(totals.recommended.total.kilograms);
    expect(totals.recommended.total.kilograms).toBeLessThan(totals.stretch.total.kilograms);
  });

  it('names the slot each projection follows', () => {
    const totals = totalsFor(meetWithLifter(), { lifts: plans() });

    expect(totals.secure.slot).toBe('secure');
    expect(totals.recommended.slot).toBe('recommended');
    expect(totals.stretch.slot).toBe('push');
  });
});

describe('§17 a projection is the same code the lifter is shown', () => {
  it('lands exactly where taking the recommended option every time lands', () => {
    const lifts = plans();
    const start = meetWithLifter();
    const projected = totalsFor(start, { lifts }).recommended;

    const played = playOut(start, 'recommended', lifts);
    const actual = totalsFor(played, { lifts });

    expect(actual.guaranteed.kilograms).toBe(projected.total.kilograms);
    expect(actual.guaranteed.isTotal).toBe(true);
  });

  it('lands exactly where taking the secure option every time lands', () => {
    const lifts = plans();
    const start = meetWithLifter();
    const projected = totalsFor(start, { lifts }).secure;

    const actual = totalsFor(playOut(start, 'secure', lifts), { lifts });

    expect(actual.guaranteed.kilograms).toBe(projected.total.kilograms);
  });

  it('projects every remaining attempt, not just the next one', () => {
    const totals = totalsFor(meetWithLifter(), { lifts: plans() });

    expect(totals.recommended.attemptsAssumed).toBe(9);
    expect(totals.recommended.complete).toBe(true);
    for (const lift of totals.recommended.lifts) {
      expect(lift.assumedKilograms).toHaveLength(3);
      expect(lift.attemptsNotProjected).toBe(0);
    }
  });

  it('assumes only what is left once a lift is part done', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, 100);
    const totals = totalsFor(timeline, { lifts: plans() });
    const squat = totals.recommended.lifts.find((lift) => lift.lift === 'squat');

    expect(squat?.bankedKilograms).toBe(100);
    expect(squat?.assumedKilograms).toHaveLength(2);
    expect(totals.recommended.attemptsAssumed).toBe(8);
  });

  it('assumes nothing once the meet is over for the lifter', () => {
    let timeline = meetWithLifter('bench-only');
    timeline = take(timeline, 'bench', 1, 100);
    timeline = take(timeline, 'bench', 2, 100 + STEP);
    timeline = take(timeline, 'bench', 3, 100 + STEP * 2);
    const totals = totalsFor(timeline);

    expect(totals.recommended.attemptsAssumed).toBe(0);
    expect(totals.recommended.total.kilograms).toBe(totals.guaranteed.kilograms);
    expect(codes(totals)).toContain('the-meet-is-over-for-this-lifter');
  });
});

describe('§17 no projection is below what is already banked', () => {
  it('holds when the plan is lighter than the lifts already made', () => {
    // A plan built for a 100 kg lifter, and a lifter who has already made 150.
    const timeline = take(meetWithLifter(), 'squat', 1, 150);
    const totals = totalsFor(timeline, {
      lifts: { squat: { plan: planFor('squat', 100) } },
    });
    const squat = totals.secure.lifts.find((lift) => lift.lift === 'squat');

    expect(squat?.contributionKilograms).toBeGreaterThanOrEqual(150);
    expect(totals.secure.total.kilograms).toBeGreaterThanOrEqual(totals.guaranteed.kilograms);
  });
});

describe('§13.5 an aggressive projection for a lifter in pain', () => {
  it('does not invent a push weight where no push is offered', () => {
    const hurt: RecordedResult = { outcome: 'good', effort: 'pain' };
    const timeline = take(meetWithLifter('bench-only'), 'bench', 1, 100, hurt);
    const totals = totalsFor(timeline, { lifts: { bench: { plan: planFor('bench', 120) } } });

    // The branch offers a pass and nothing above it, so the stretch figure is the
    // cautious one and the remaining attempts are reported as unprojected rather
    // than filled in.
    expect(totals.stretch.lifts[0]?.stop).toBe('the-branch-offers-a-pass');
    expect(totals.stretch.lifts[0]?.attemptsNotProjected).toBe(2);
    expect(totals.stretch.total.kilograms).toBe(100);
    expect(codes(totals)).toContain('projection-is-incomplete');
  });
});

describe('§17 what the figures assume is said out loud', () => {
  it('states the assumption whenever anything is projected', () => {
    expect(codes(totalsFor(meetWithLifter(), { lifts: plans() }))).toContain(
      'projections-assume-every-attempt-is-made',
    );
  });

  it('says when a lift was projected without a plan', () => {
    const totals = totalsFor(meetWithLifter(), {
      lifts: { squat: { plan: planFor('squat', 200) } },
    });

    expect(codes(totals)).toContain('projected-without-a-plan');
    expect(totals.recommended.lifts.find((lift) => lift.lift === 'bench')?.withoutAPlan).toBe(true);
    expect(totals.recommended.lifts.find((lift) => lift.lift === 'squat')?.withoutAPlan).toBe(
      false,
    );
  });

  it('warns strongly when a lift is one attempt from voiding every figure', () => {
    const missed: RecordedResult = { outcome: 'no-lift', reason: 'strength' };
    let timeline = take(meetWithLifter(), 'squat', 1, 100, missed);
    timeline = take(timeline, 'squat', 2, 100, missed);
    const totals = totalsFor(timeline, { lifts: plans() });
    const advisory = totals.advisories.find(
      (candidate) => candidate.code === 'bomb-out-would-void-every-figure',
    );

    expect(advisory?.severity).toBe('strong');
  });

  it('never attaches a probability to a projection', () => {
    const forbidden = /\b(?:probability|chance of|likelihood|odds|guaranteed to|likely)\b/i;
    const totals = totalsFor(meetWithLifter(), { lifts: plans() });

    for (const advisory of totals.advisories) {
      expect(advisory.message).not.toMatch(forbidden);
    }
  });
});

describe('§17 progress towards a target', () => {
  const qualifying: LiveTarget = {
    kind: 'qualification',
    measure: 'total',
    kilograms: 400,
    label: 'A qualifying total',
  };

  it('does not call a subtotal a reached total', () => {
    let timeline = take(meetWithLifter(), 'squat', 1, 200);
    timeline = take(timeline, 'bench', 1, 200);
    const totals = totalsFor(timeline, { lifts: plans(), targets: [qualifying] });
    const progress = totals.targets[0];

    // 400 kg is on the bar with a deadlift still to come, and a deadlift bomb-out
    // leaves no total at all.
    expect(progress?.guaranteedKilograms).toBe(400);
    expect(progress?.reachedByGuaranteed).toBe(false);
    expect(progress?.shortfallKilograms).toBe(0);
  });

  it('reports the least aggressive figure that reaches it', () => {
    const totals = totalsFor(meetWithLifter(), { lifts: plans(), targets: [qualifying] });
    const progress = totals.targets[0];
    const bases = PROJECTION_BASES.filter((basis) => reached(progress, basis));

    expect(progress?.firstBasisThatReaches).toBe(bases[0] ?? null);
    expect(progress?.reachedByStretch).toBe(true);
  });

  it('measures a lift target against the lift it names', () => {
    const squatRecord: LiveTarget = {
      kind: 'record',
      measure: 'lift',
      lift: 'squat',
      kilograms: 150,
      label: 'A squat record',
    };
    // A deadlift heavier than the squat target, and a squat that is not.
    let timeline = take(meetWithLifter(), 'squat', 1, 100);
    timeline = take(timeline, 'deadlift', 1, 200);
    const totals = totalsFor(timeline, { targets: [squatRecord] });

    expect(totals.targets[0]?.guaranteedKilograms).toBe(100);
    expect(totals.targets[0]?.reachedByGuaranteed).toBe(false);
    expect(totals.targets[0]?.shortfallKilograms).toBe(50);
  });

  it('declines to answer a lift target that names no lift in a full-power meet', () => {
    const vague: LiveTarget = {
      kind: 'personal-record',
      measure: 'lift',
      kilograms: 100,
      label: 'A lift somewhere',
    };
    const timeline = take(meetWithLifter(), 'squat', 1, 300);
    const totals = totalsFor(timeline, { lifts: plans(), targets: [vague] });

    expect(totals.targets[0]?.firstBasisThatReaches).toBeNull();
  });

  it('answers a lift target that names no lift in a single-lift meet', () => {
    const vague: LiveTarget = {
      kind: 'personal-record',
      measure: 'lift',
      kilograms: 100,
      label: 'A bench press',
    };
    const timeline = take(meetWithLifter('bench-only'), 'bench', 1, 100);
    const totals = totalsFor(timeline, { targets: [vague] });

    expect(totals.targets[0]?.reachedByGuaranteed).toBe(true);
    expect(totals.targets[0]?.firstBasisThatReaches).toBe('guaranteed');
  });

  it('keeps the caller’s order and never rewrites a target', () => {
    const second: LiveTarget = { ...qualifying, kilograms: 500, label: 'A higher one' };
    const totals = totalsFor(meetWithLifter(), { lifts: plans(), targets: [qualifying, second] });

    expect(totals.targets.map((progress) => progress.target)).toEqual([qualifying, second]);
  });
});

function reached(
  progress: MeetTotals['targets'][number] | undefined,
  basis: ProjectionBasis,
): boolean {
  if (progress === undefined) return false;
  switch (basis) {
    case 'guaranteed':
      return progress.reachedByGuaranteed;
    case 'secure':
      return progress.reachedBySecure;
    case 'recommended':
      return progress.reachedByRecommended;
    case 'stretch':
      return progress.reachedByStretch;
  }
}

describe('every state of the meet', () => {
  function everyState(): readonly { readonly name: string; readonly timeline: MeetTimeline }[] {
    const missed: RecordedResult = { outcome: 'no-lift', reason: 'strength' };
    const start = meetWithLifter();
    const oneMade = take(start, 'squat', 1, 100);
    const oneMissed = take(start, 'squat', 1, 100, missed);
    const squatDone = take(take(oneMade, 'squat', 2, 100 + STEP), 'squat', 3, 100 + STEP * 2);
    const twoLiftsIn = take(squatDone, 'bench', 1, 60);
    const nearlyBombed = take(oneMissed, 'squat', 2, 100, missed);
    return [
      { name: 'nothing yet', timeline: start },
      { name: 'one made', timeline: oneMade },
      { name: 'one missed', timeline: oneMissed },
      { name: 'a lift finished', timeline: squatDone },
      { name: 'two lifts in', timeline: twoLiftsIn },
      { name: 'two down on the squat', timeline: nearlyBombed },
    ];
  }

  it('never reports a settled subtotal above the guaranteed total', () => {
    for (const { name, timeline } of everyState()) {
      const totals = totalsFor(timeline, { lifts: plans() });
      expect(totals.subtotal.kilograms, name).toBeLessThanOrEqual(totals.guaranteed.kilograms);
    }
  });

  it('never projects below what is banked', () => {
    for (const { name, timeline } of everyState()) {
      const totals = totalsFor(timeline, { lifts: plans() });
      for (const projection of [totals.secure, totals.recommended, totals.stretch]) {
        expect(projection.total.kilograms, `${name}/${projection.basis}`).toBeGreaterThanOrEqual(
          totals.guaranteed.kilograms,
        );
      }
    }
  });

  it('only projects weights the federation would accept', () => {
    for (const { name, timeline } of everyState()) {
      const totals = totalsFor(timeline, { lifts: plans() });
      for (const projection of [totals.secure, totals.recommended, totals.stretch]) {
        for (const lift of projection.lifts) {
          for (const kilograms of lift.assumedKilograms) {
            expect(RULES.isLegalBarWeight(kilograms), `${name}/${lift.lift}/${kilograms}`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it('answers the same thing twice', () => {
    for (const { name, timeline } of everyState()) {
      expect(totalsFor(timeline, { lifts: plans() }), name).toEqual(
        totalsFor(timeline, { lifts: plans() }),
      );
    }
  });

  it('leaves the document exactly as it found it', () => {
    for (const { name, timeline } of everyState()) {
      const before = structuredClone(timeline.present);
      totalsFor(timeline, { lifts: plans() });
      expect(timeline.present, name).toEqual(before);
    }
  });
});
