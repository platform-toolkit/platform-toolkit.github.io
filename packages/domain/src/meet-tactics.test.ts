// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §18: what a placing arithmetically needs, and what the tool refuses to imply.
 *
 * The requirement figures are checked against the federation's own ladder rather
 * than against written-out numbers wherever the ladder is the point -- the fixture
 * loads the bar in multiples of 2 kg (§5.1), so an answer that came from a
 * hard-coded 2.5 anywhere shows up here as a wrong weight rather than as a passing
 * test.
 *
 * Two properties get more attention than the arithmetic, because they are the ones
 * a plausible-looking regression would quietly break. The first is that a weight
 * the placing needs is never described as a weight the lifter is going to make: the
 * advisory sweep at the bottom is mechanical for that reason. The second is that a
 * competitor's pending attempt is branched on rather than guessed at, so the tool
 * shows both the day where it goes up and the day where it does not.
 *
 * The tie tests patch `tieBreak` and nothing else. The two profiles therefore agree
 * on every weight, and the only thing that can differ between them is the answer to
 * "who has it if you land on the same total".
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { planAttempts, type AttemptPlan } from './attempt-plan.js';
import { liveChoicesFor } from './live-choices.js';
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
import { MEET_PROFILE_FIXTURE, rulesFor } from './meet-profile.fixture.js';
import type { MeetRules } from './meet-rules.js';
import {
  TOTAL_PLACING_SCALE,
  attemptChangeHistory,
  whatWins,
  type PlacingScale,
  type TacticalAnswer,
  type TacticalCompetitor,
} from './meet-tactics.js';

const RULES = rulesFor();

/** An invented instant. Nothing here reads the clock. */
const AT = 1_700_000_000_000;

/** The fixture's own increment, read rather than assumed. */
const STEP = RULES.profile.barMultipleKilograms;

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };
const MISSED: RecordedResult = { outcome: 'no-lift', reason: 'strength' };

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

function planFor(lift: PlatformLift, maximum: number): AttemptPlan {
  const result = planAttempts(RULES, { lift, meetDayMaximumKilograms: maximum, goal: 'balanced' });
  if (!result.ok) {
    throw new Error(`the fixture plan was refused: ${JSON.stringify(result.problems)}`);
  }
  return result.plan;
}

/** One competitor, named the way the platform announcer would and nowhere else. */
function rival(
  totalKilograms: number,
  extra: Partial<TacticalCompetitor> = {},
): TacticalCompetitor {
  return { label: 'A competitor', totalKilograms, hasATotal: true, ...extra };
}

function answer(
  timeline: MeetTimeline,
  options: {
    readonly lift?: PlatformLift;
    readonly competitors?: readonly TacticalCompetitor[];
    readonly desiredPlacing?: number;
    readonly userBodyweightKilograms?: number | null;
    readonly meetDayMaximumKilograms?: number | null;
    readonly plan?: AttemptPlan | null;
    readonly scale?: PlacingScale;
    readonly rules?: MeetRules;
  } = {},
): TacticalAnswer {
  return whatWins(options.rules ?? RULES, {
    document: timeline.present,
    lifter: only(timeline),
    lift: options.lift ?? 'bench',
    competitors: options.competitors ?? [],
    desiredPlacing: options.desiredPlacing ?? 1,
    userBodyweightKilograms: options.userBodyweightKilograms ?? null,
    meetDayMaximumKilograms: options.meetDayMaximumKilograms ?? null,
    plan: options.plan ?? null,
    scale: options.scale ?? TOTAL_PLACING_SCALE,
  });
}

function codes(found: TacticalAnswer): readonly string[] {
  return found.advisories.map((advisory) => advisory.code);
}

/** A lifter one bench in, in a meet where the bench is the whole contest. */
function benchOneIn(kilograms = 100, result: RecordedResult = GOOD): MeetTimeline {
  return take(meetWithLifter('bench-only'), 'bench', 1, kilograms, result);
}

describe('§18 what the placing needs', () => {
  it('reads the threshold off the competitor standing in the way of the placing', () => {
    const found = answer(benchOneIn(), {
      competitors: [rival(150), rival(120), rival(90)],
      desiredPlacing: 2,
    });

    // Second place has to get past the second best score, not the best.
    expect(found.outcomes[0]?.thresholdScore).toBe(120);
  });

  it('holds the placing outright when fewer lifters are in the way than it asks for', () => {
    const found = answer(benchOneIn(), { competitors: [rival(500)], desiredPlacing: 2 });
    const outcome = found.outcomes[0];

    expect(outcome?.thresholdScore).toBeNull();
    expect(outcome?.alreadyThere).toBe(true);
    expect(outcome?.toTie).toBeNull();
    expect(outcome?.toBeat).toBeNull();
    expect(outcome?.outOfReach).toBe(false);
  });

  it('finds the lightest legal weight that ties and the lightest that beats', () => {
    const found = answer(benchOneIn(), { competitors: [rival(150)] });
    const outcome = found.outcomes[0];

    expect(outcome?.toTie?.kilograms).toBe(150);
    expect(outcome?.toTie?.finalTotalKilograms).toBe(150);
    expect(outcome?.toBeat?.kilograms).toBe(150 + STEP);
    expect(outcome?.alreadyThere).toBe(false);
  });

  it('needs nothing more when what is banked already clears the threshold', () => {
    const found = answer(benchOneIn(), { competitors: [rival(90)] });
    const outcome = found.outcomes[0];

    expect(outcome?.scoreIfNothingMore).toBe(100);
    expect(outcome?.alreadyThere).toBe(true);
  });

  it('counts a tie as holding the placing only when the tie-break falls the user way', () => {
    const held = answer(benchOneIn(), {
      competitors: [rival(100, { bodyweightKilograms: 90 })],
      userBodyweightKilograms: 80,
    });
    const lost = answer(benchOneIn(), {
      competitors: [rival(100, { bodyweightKilograms: 80 })],
      userBodyweightKilograms: 95,
    });

    expect(held.outcomes[0]?.alreadyThere).toBe(true);
    expect(lost.outcomes[0]?.alreadyThere).toBe(false);
  });

  it('puts a repeat of a missed attempt at the front of the search', () => {
    // The bar can go back on at the missed weight, which is below the minimum
    // progression and would be lost to a ladder that starts one increment up.
    const found = answer(benchOneIn(100, MISSED), { competitors: [rival(100)] });
    const outcome = found.outcomes[0];

    expect(outcome?.toTie?.kilograms).toBe(100);
    expect(outcome?.toTie?.repeat).toBe(true);
    expect(outcome?.toBeat?.repeat).toBe(false);
  });

  it('clamps a placing below first back to first', () => {
    expect(answer(benchOneIn(), { desiredPlacing: 0 }).desiredPlacing).toBe(1);
    expect(answer(benchOneIn(), { desiredPlacing: 2.7 }).desiredPlacing).toBe(2);
  });

  it('names the attempt the weight would be declared on', () => {
    const found = answer(benchOneIn(), { competitors: [rival(150)] });

    expect(found.attemptNumber).toBe(2);
    expect(found.attemptId).toBe(attemptAt(benchOneIn(), 'bench', 2));
  });
});

describe('§18 a weight nobody can total is not an answer', () => {
  it('offers no requirement at all while a contested lift has nothing on it', () => {
    // A squat on the bar and a bench and deadlift still to come: no weight on this
    // lift produces a total, so no comparison can be settled.
    const timeline = take(meetWithLifter(), 'squat', 1, 100);
    const found = answer(timeline, { lift: 'squat', competitors: [rival(400)] });
    const outcome = found.outcomes[0];
    const advisory = found.advisories.find(
      (candidate) => candidate.code === 'no-total-without-the-other-lifts',
    );

    expect(outcome?.toTie).toBeNull();
    expect(outcome?.toBeat).toBeNull();
    expect(outcome?.scoreIfNothingMore).toBeNull();
    expect(outcome?.outOfReach).toBe(true);
    expect(advisory?.severity).toBe('strong');
    expect(codes(found)).toContain('beyond-the-search');
  });

  it('has nothing to declare once the lift is over', () => {
    let timeline = benchOneIn();
    timeline = take(timeline, 'bench', 2, 100 + STEP);
    timeline = take(timeline, 'bench', 3, 100 + STEP * 2);
    const found = answer(timeline, { competitors: [rival(150)] });

    expect(found.attemptId).toBeNull();
    expect(found.attemptNumber).toBeNull();
    expect(found.outcomes).toEqual([]);
    expect(codes(found)).toContain('nothing-left-to-declare');
  });
});

describe('§18 the weight is measured against the day the lifter is having', () => {
  it('grades a requirement only against a maximum that was confirmed', () => {
    const competitors = [rival(120)];
    const blind = answer(benchOneIn(), { competitors });
    const informed = answer(benchOneIn(), { competitors, meetDayMaximumKilograms: 130 });

    expect(blind.outcomes[0]?.toTie?.risk).toBeNull();
    expect(blind.outcomes[0]?.toTie?.aboveMaximumKilograms).toBeNull();
    expect(blind.outcomes[0]?.toTie?.percentOfMaximum).toBeNull();
    expect(codes(blind)).toContain('no-maximum-confirmed');

    expect(informed.outcomes[0]?.toTie?.risk).not.toBeNull();
    expect(informed.outcomes[0]?.toTie?.aboveMaximumKilograms).toBe(-10);
    expect(informed.outcomes[0]?.toTie?.percentOfMaximum).toBeCloseTo((120 / 130) * 100);
    expect(codes(informed)).not.toContain('no-maximum-confirmed');
  });

  it('says out loud that a necessary weight is not therefore a reachable one', () => {
    const found = answer(benchOneIn(), {
      competitors: [rival(150)],
      meetDayMaximumKilograms: 120,
    });
    const advisory = found.advisories.find(
      (candidate) => candidate.code === 'necessary-is-not-the-same-as-likely',
    );

    expect(found.outcomes[0]?.toTie?.aboveMaximumKilograms).toBe(30);
    expect(advisory?.severity).toBe('strong');
  });

  it('names the slot when the weight the placing needs is already on the lifter screen', () => {
    const timeline = benchOneIn();
    const plan = planFor('bench', 130);
    const choices = liveChoicesFor(RULES, {
      document: timeline.present,
      lifter: only(timeline),
      lift: 'bench',
      plan,
      meetDayMaximumKilograms: 130,
      ceilingKilograms: null,
    });
    const target = choices.choices.find((choice) => choice.slot === 'recommended')?.kilograms;
    if (target == null) throw new Error('the fixture plan offered no recommended attempt');

    const found = answer(timeline, {
      competitors: [rival(target)],
      plan,
      meetDayMaximumKilograms: 130,
    });

    expect(found.outcomes[0]?.toTie?.kilograms).toBe(target);
    expect(found.outcomes[0]?.toTie?.offeredSlot).toBe('recommended');
  });
});

describe('§18 a pending attempt is branched on, never guessed at', () => {
  it('shows the day it goes up and the day it does not, for each attempt on the platform', () => {
    const found = answer(benchOneIn(), {
      competitors: [
        rival(150, { pending: { kilograms: 60 } }),
        rival(140, { pending: { kilograms: 70 } }),
      ],
    });

    expect(found.outcomes).toHaveLength(4);
    for (const outcome of found.outcomes) {
      expect(outcome.assumptions).toHaveLength(2);
    }
  });

  it('does not branch on an attempt the referees have already judged', () => {
    const found = answer(benchOneIn(), {
      competitors: [rival(150, { pending: { kilograms: 60, result: 'good' } })],
    });

    expect(found.outcomes).toHaveLength(1);
    expect(found.outcomes[0]?.assumptions[0]?.outcome).toBe('makes-the-attempt');
  });

  it('adds only what the pending attempt would improve on', () => {
    const found = answer(benchOneIn(), {
      competitors: [rival(300, { pending: { kilograms: 180, bestSoFarKilograms: 170 } })],
    });

    expect(found.outcomes[0]?.assumptions[0]).toEqual({
      competitorLabel: 'A competitor',
      outcome: 'makes-the-attempt',
      totalKilograms: 310,
    });
    expect(found.outcomes[1]?.assumptions[0]?.totalKilograms).toBe(300);
  });

  it('leaves a competitor with no total where a miss would bomb them out', () => {
    const found = answer(benchOneIn(), {
      competitors: [
        rival(0, {
          hasATotal: false,
          pending: { kilograms: 180, missWouldBombThemOut: true },
        }),
      ],
    });

    expect(found.outcomes[1]?.assumptions[0]?.totalKilograms).toBeNull();
    expect(found.outcomes[1]?.thresholdScore).toBeNull();
    expect(codes(found)).toContain('competitor-has-no-total-yet');
  });

  it('collapses to the hardest case rather than draw a table nobody can read', () => {
    const found = answer(benchOneIn(), {
      competitors: [140, 141, 142, 143].map((total) =>
        rival(total, { pending: { kilograms: 60 } }),
      ),
    });

    expect(found.outcomes).toHaveLength(1);
    expect(
      found.outcomes[0]?.assumptions.every(
        (assumption) => assumption.outcome === 'makes-the-attempt',
      ),
    ).toBe(true);
    expect(codes(found)).toContain('too-many-pending-attempts-to-model');
  });
});

describe('§18 who has it on the same total', () => {
  function tieOn(
    tieBreak: MeetRules['profile']['tieBreak'],
    competitor: TacticalCompetitor,
    userBodyweightKilograms: number | null = null,
  ): TacticalAnswer['outcomes'][number]['tie'] {
    const found = answer(benchOneIn(), {
      rules: rulesFor({ tieBreak }),
      competitors: [competitor],
      userBodyweightKilograms,
    });
    const tie = found.outcomes[0]?.tie;
    if (tie === undefined) throw new Error('the answer had no outcome to read a tie from');
    return tie;
  }

  it('gives it to the lighter lifter', () => {
    expect(tieOn(['lighter-bodyweight'], rival(100, { bodyweightKilograms: 90 }), 80)).toEqual({
      favours: 'user',
      step: 'lighter-bodyweight',
      reason: 'user-is-lighter',
    });
    expect(tieOn(['lighter-bodyweight'], rival(100, { bodyweightKilograms: 80 }), 90)).toEqual({
      favours: 'competitor',
      step: 'lighter-bodyweight',
      reason: 'competitor-is-lighter',
    });
  });

  it('says a reweigh decides it where the rulebook calls for one', () => {
    expect(
      tieOn(['lighter-bodyweight', 'reweigh'], rival(100, { bodyweightKilograms: 85 }), 85),
    ).toEqual({ favours: 'unknown', step: 'reweigh', reason: 'decided-by-a-reweigh' });
  });

  it('names who reached the total first where the rulebook says so', () => {
    expect(tieOn(['first-to-total'], rival(100, { reachedTotalFirst: false }))).toEqual({
      favours: 'user',
      step: 'first-to-total',
      reason: 'user-reached-the-total-first',
    });
    expect(tieOn(['first-to-total'], rival(100, { reachedTotalFirst: true }))).toEqual({
      favours: 'competitor',
      step: 'first-to-total',
      reason: 'competitor-reached-the-total-first',
    });
  });

  it('declares a tie where the rulebook declares one', () => {
    expect(tieOn(['declared-tie'], rival(100))).toEqual({
      favours: 'declared-tie',
      step: 'declared-tie',
      reason: 'declared-a-tie',
    });
  });

  it('distinguishes a bodyweight nobody supplied from a rule that does not separate them', () => {
    expect(tieOn(['lighter-bodyweight'], rival(100))).toEqual({
      favours: 'unknown',
      step: null,
      reason: 'bodyweights-not-supplied',
    });
    expect(tieOn(['lighter-bodyweight'], rival(100, { bodyweightKilograms: 85 }), 85)).toEqual({
      favours: 'unknown',
      step: null,
      reason: 'no-rule-separates-them',
    });
  });
});

describe('§18 the tool is not the scoring table', () => {
  it('says so before it says anything else', () => {
    const found = answer(benchOneIn(), { competitors: [rival(150)] });

    expect(found.advisories[0]?.code).toBe('the-scoring-table-is-authoritative');
    expect(found.advisories[0]?.severity).toBe('note');
  });

  it('names the coefficient and its version when the placing is not decided on the total', () => {
    // Deliberately asymmetric, so a scale used for only one side shows up as a
    // wrong requirement rather than as a passing test.
    const points: PlacingScale = {
      basis: 'coefficient',
      label: 'Fixture points',
      scoreForUser: (kilograms) => kilograms * 2,
      scoreForCompetitor: (kilograms) => kilograms,
    };
    const found = answer(benchOneIn(), { competitors: [rival(150)], scale: points });
    const advisory = found.advisories.find(
      (candidate) => candidate.code === 'placing-decided-on-a-coefficient',
    );

    expect(advisory?.message).toContain('Fixture points');
    expect(found.outcomes[0]?.thresholdScore).toBe(150);
    expect(found.outcomes[0]?.toTie?.kilograms).toBe(100 + STEP);
    expect(found.outcomes[0]?.toTie?.scoreValue).toBe((100 + STEP) * 2);
  });

  it('warns that a figure below is not yet a total', () => {
    const found = answer(benchOneIn(), { competitors: [rival(0, { hasATotal: false })] });

    expect(codes(found)).toContain('competitor-has-no-total-yet');
  });

  it('never attaches a probability to a requirement', () => {
    const forbidden = /\b(?:probability|chance of|likelihood|odds|guaranteed to|likely)\b/i;
    const everyAdvisory = [
      answer(benchOneIn(), { competitors: [rival(150)], meetDayMaximumKilograms: 120 }),
      answer(benchOneIn(), { competitors: [rival(0, { hasATotal: false })] }),
      answer(take(meetWithLifter(), 'squat', 1, 100), {
        lift: 'squat',
        competitors: [rival(400)],
      }),
      answer(benchOneIn(), {
        competitors: [140, 141, 142, 143].map((total) =>
          rival(total, { pending: { kilograms: 60 } }),
        ),
      }),
    ].flatMap((found) => found.advisories);

    expect(everyAdvisory.length).toBeGreaterThan(6);
    for (const advisory of everyAdvisory) {
      expect(advisory.message, advisory.code).not.toMatch(forbidden);
    }
  });
});

describe('§18 what this attempt has been declared at', () => {
  /** A bench-only meet two rounds in, with the third attempt still to be declared. */
  function thirdRound(): { readonly timeline: MeetTimeline; readonly attemptId: string } {
    let timeline = benchOneIn();
    timeline = take(timeline, 'bench', 2, 100 + STEP);
    return { timeline, attemptId: attemptAt(timeline, 'bench', 3) };
  }

  function declare(timeline: MeetTimeline, attemptId: string, kilograms: number): MeetTimeline {
    return apply(timeline, { kind: 'set-attempt-weight', attemptId, kilograms });
  }

  it('reads every weight the attempt has carried out of the undo history', () => {
    const { attemptId } = thirdRound();
    let timeline = declare(thirdRound().timeline, attemptId, 110);
    timeline = declare(timeline, attemptId, 112);
    timeline = declare(timeline, attemptId, 114);
    const history = attemptChangeHistory(RULES, timeline, attemptId);

    expect(history?.originalKilograms).toBe(110);
    expect(history?.changes).toEqual([
      { kilograms: 112, original: false },
      { kilograms: 114, original: false },
    ]);
  });

  it('does not count a weight re-entered as the weight it already was', () => {
    const { attemptId } = thirdRound();
    let timeline = declare(thirdRound().timeline, attemptId, 110);
    timeline = declare(timeline, attemptId, 110);
    const history = attemptChangeHistory(RULES, timeline, attemptId);

    expect(history?.originalKilograms).toBe(110);
    expect(history?.changes).toEqual([]);
  });

  it('counts changes from the attempt rather than from the length of the list', () => {
    // Nothing is spent until the card is handed in, so three declarations before
    // submission are one opener and no changes at all.
    const { attemptId } = thirdRound();
    let timeline = declare(thirdRound().timeline, attemptId, 110);
    timeline = declare(timeline, attemptId, 112);
    expect(attemptChangeHistory(RULES, timeline, attemptId)?.changesUsed).toBe(0);

    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    timeline = declare(timeline, attemptId, 114);
    const history = attemptChangeHistory(RULES, timeline, attemptId);

    expect(history?.changesUsed).toBe(1);
    expect(history?.changesAllowed).toBe(2);
    expect(history?.changesRemaining).toBe(1);
    expect(history?.originalKilograms).toBe(110);
  });

  it('reports the allowance running out rather than letting a fourth card through', () => {
    const { attemptId } = thirdRound();
    let timeline = declare(thirdRound().timeline, attemptId, 110);
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId, to: 'submitted' });
    timeline = declare(timeline, attemptId, 112);
    timeline = declare(timeline, attemptId, 114);

    expect(attemptChangeHistory(RULES, timeline, attemptId)?.changesRemaining).toBe(0);

    const refused = applyMeetAction(
      RULES,
      timeline,
      { kind: 'set-attempt-weight', attemptId, kilograms: 116 },
      AT,
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.problems.map((problem) => problem.code)).toContain(
      'no-changes-remaining',
    );
  });

  it('carries the conditions the federation attaches to the change', () => {
    // The fixture puts both conditions on the deadlift and neither on the bench.
    const timeline = meetWithLifter();
    const attemptId = attemptAt(timeline, 'deadlift', 3);
    const history = attemptChangeHistory(RULES, declare(timeline, attemptId, 200), attemptId);

    expect(history?.conditions).toEqual([
      'lapses-once-called-to-a-loaded-bar',
      'not-below-the-preceding-lifter',
    ]);
    expect(history?.summary).toBeNull();
  });

  it('carries the summary a single-lift format overrides the rule with', () => {
    const { timeline, attemptId } = thirdRound();
    const history = attemptChangeHistory(RULES, timeline, attemptId);

    expect(history?.summary).toBe(MEET_PROFILE_FIXTURE.formatOverrides[0]?.summary);
    expect(history?.changesAllowed).toBe(2);
  });

  it('reports the floor the next declaration has to clear', () => {
    const { timeline, attemptId } = thirdRound();
    const history = attemptChangeHistory(RULES, timeline, attemptId);

    expect(history?.bounds.minimumKilograms).toBe(100 + STEP * 2);
    expect(history?.lift).toBe('bench');
    expect(history?.attemptNumber).toBe(3);
  });

  it('repeats what it was told about the bar being called, and invents nothing', () => {
    const { timeline, attemptId } = thirdRound();

    expect(attemptChangeHistory(RULES, timeline, attemptId)?.calledToTheBar).toBeNull();
    expect(
      attemptChangeHistory(RULES, timeline, attemptId, { calledToTheBar: true })?.calledToTheBar,
    ).toBe(true);
  });

  it('answers nothing for an attempt that is not in this meet', () => {
    const { timeline } = thirdRound();

    expect(attemptChangeHistory(RULES, timeline, 'lifter-9-bench-3')).toBeNull();
  });
});

describe('every state of the lift', () => {
  const COMPETITORS: readonly TacticalCompetitor[] = [
    rival(150),
    rival(120, { pending: { kilograms: 60, bestSoFarKilograms: 55 } }),
  ];

  function everyState(): readonly { readonly name: string; readonly timeline: MeetTimeline }[] {
    const start = meetWithLifter('bench-only');
    const oneMade = take(start, 'bench', 1, 100);
    const oneMissed = take(start, 'bench', 1, 100, MISSED);
    const twoMade = take(oneMade, 'bench', 2, 100 + STEP);
    return [
      { name: 'nothing yet', timeline: start },
      { name: 'one made', timeline: oneMade },
      { name: 'one missed', timeline: oneMissed },
      { name: 'two made', timeline: twoMade },
      { name: 'the lift is over', timeline: take(twoMade, 'bench', 3, 100 + STEP * 2) },
    ];
  }

  it('only ever names a weight the federation would load', () => {
    for (const { name, timeline } of everyState()) {
      const found = answer(timeline, { competitors: COMPETITORS, meetDayMaximumKilograms: 130 });
      for (const outcome of found.outcomes) {
        for (const requirement of [outcome.toTie, outcome.toBeat]) {
          if (requirement === null) continue;
          expect(RULES.isLegalBarWeight(requirement.kilograms), name).toBe(true);
        }
      }
    }
  });

  it('never asks for less to beat a score than to tie it', () => {
    for (const { name, timeline } of everyState()) {
      const found = answer(timeline, { competitors: COMPETITORS });
      for (const outcome of found.outcomes) {
        if (outcome.toTie === null || outcome.toBeat === null) continue;
        expect(outcome.toBeat.kilograms, name).toBeGreaterThanOrEqual(outcome.toTie.kilograms);
      }
    }
  });

  it('answers the same thing twice', () => {
    for (const { name, timeline } of everyState()) {
      expect(answer(timeline, { competitors: COMPETITORS }), name).toEqual(
        answer(timeline, { competitors: COMPETITORS }),
      );
    }
  });

  it('leaves the document exactly as it found it', () => {
    for (const { name, timeline } of everyState()) {
      const before = structuredClone(timeline.present);
      answer(timeline, { competitors: COMPETITORS, meetDayMaximumKilograms: 130 });
      expect(timeline.present, name).toEqual(before);
    }
  });
});
