// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §13, one branch at a time, plus the four properties that hold across all of them.
 *
 * The branch tests are the requirements read back: after a grind the tool offers
 * a pass, after pain it recommends one, after a technical miss it repeats the
 * weight. The property tests are the ones that would catch a later branch being
 * added carelessly -- every choice is a legal declaration, exactly one is
 * highlighted, nothing is graded against a maximum that was never confirmed, and
 * undo restores the recommendation because the recommendation was never stored.
 *
 * The fixture federation loads the bar in multiples of 2 kg, which is nobody's
 * real rulebook and is the point (§5.1): a test that passed because 2.5 was
 * hard-coded somewhere would look identical to one that passed because the
 * profile was read.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { planAttempts, type AttemptPlan, type MeetGoal } from './attempt-plan.js';
import {
  liveChoicesFor,
  type LiveAdvisoryCode,
  type LiveChoice,
  type LiveChoiceSlot,
  type LiveChoices,
  type LiveTarget,
} from './live-choices.js';
import {
  applyMeetAction,
  attemptsOn,
  createMeetDocument,
  startTimeline,
  takenOn,
  undo,
  type LiveLifter,
  type MeetAction,
  type MeetDocument,
  type MeetTimeline,
  type RecordedResult,
} from './meet-document.js';
import { rulesFor } from './meet-profile.fixture.js';

const RULES = rulesFor();

/** An invented instant. Nothing here reads the clock. */
const AT = 1_700_000_000_000;

/** The fixture's own increment, read rather than assumed. */
const STEP = RULES.profile.barMultipleKilograms;

function apply(timeline: MeetTimeline, action: MeetAction, at = AT): MeetTimeline {
  const result = applyMeetAction(RULES, timeline, action, at);
  if (!result.ok) {
    throw new Error(
      `${action.kind} was refused: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.timeline;
}

function meetWithLifter(): MeetTimeline {
  return apply(startTimeline(createMeetDocument(RULES, 'full-power')), {
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
  result: RecordedResult,
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

function plannedAt(plan: AttemptPlan, attemptNumber: 1 | 2 | 3): number {
  const attempt = plan.attempts.find((candidate) => candidate.attemptNumber === attemptNumber);
  if (attempt === undefined) throw new Error('the plan has no such attempt');
  return attempt.kilograms;
}

interface ChoicesOptions {
  readonly lift?: PlatformLift;
  readonly plan?: AttemptPlan | null;
  readonly meetDayMaximumKilograms?: number | null;
  readonly ceilingKilograms?: number | null;
  readonly targets?: readonly LiveTarget[];
}

function choicesFor(timeline: MeetTimeline, options: ChoicesOptions = {}): LiveChoices {
  const lift = options.lift ?? 'squat';
  return liveChoicesFor(RULES, {
    document: timeline.present,
    lifter: only(timeline),
    lift,
    plan: options.plan ?? null,
    meetDayMaximumKilograms: options.meetDayMaximumKilograms ?? null,
    ceilingKilograms: options.ceilingKilograms ?? null,
    targets: options.targets ?? [],
  });
}

function slots(choices: LiveChoices): readonly LiveChoiceSlot[] {
  return choices.choices.map((choice) => choice.slot);
}

function highlighted(choices: LiveChoices): LiveChoice {
  const found = choices.choices.find((choice) => choice.highlighted);
  if (found === undefined) throw new Error('no choice was highlighted');
  return found;
}

function at(choices: LiveChoices, slot: LiveChoiceSlot): LiveChoice {
  const found = choices.choices.find((choice) => choice.slot === slot);
  if (found === undefined) throw new Error(`no choice in the ${slot} slot`);
  return found;
}

function codes(choices: LiveChoices): readonly LiveAdvisoryCode[] {
  return choices.advisories.map((advisory) => advisory.code);
}

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };

// -----------------------------------------------------------------------------

describe('the opener', () => {
  const plan = planFor('squat', 200);

  it('offers the planned opener, a step under and a step over', () => {
    const choices = choicesFor(meetWithLifter(), { plan });
    expect(choices.trigger).toBe('nothing-recorded-yet');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 1));
    expect(at(choices, 'secure').kilograms).toBe(plannedAt(plan, 1) - STEP);
    expect(at(choices, 'push').kilograms).toBe(plannedAt(plan, 1) + STEP);
  });

  it('names the attempt the choices would fill', () => {
    const timeline = meetWithLifter();
    const choices = choicesFor(timeline, { plan });
    expect(choices.attemptNumber).toBe(1);
    expect(choices.attemptId).toBe(attemptAt(timeline, 'squat', 1));
    expect(choices.previousKilograms).toBeNull();
  });

  it('falls back to the lightest legal attempt when there is no plan at all', () => {
    const choices = choicesFor(meetWithLifter());
    expect(highlighted(choices).kilograms).toBe(RULES.profile.barMultipleKilograms);
    // One card, not three identical ones: the floor cannot be reduced.
    expect(choices.choices).toHaveLength(2);
  });
});

describe('§13.1 good and flew', () => {
  // The Personal Record row is the one whose second attempt is a range rather
  // than a point, which is what gives "the upper end of the planned range"
  // something to be.
  const plan = planFor('squat', 200, 'personal-record');

  it('continues at the top of the planned range and pushes one step past it', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'flew',
    });
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(choices.trigger).toBe('flew');
    const top = highlighted(choices).kilograms ?? 0;
    expect(top).toBeGreaterThan(plannedAt(plan, 2));
    expect(at(choices, 'secure').kilograms).toBe(plannedAt(plan, 2));
    expect(at(choices, 'push').kilograms).toBe(top + STEP);
  });

  it('does not raise a third attempt on a reading taken from the opener', () => {
    // §13.1's last line. The second was passed, so the lightest thing the lifter
    // did is two rounds old -- and carrying it forward is the automatic increase
    // the requirement forbids by name.
    let timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'flew',
    });
    const second = attemptAt(timeline, 'squat', 2);
    timeline = apply(timeline, {
      kind: 'record-result',
      attemptId: second,
      result: { outcome: 'passed' },
    });

    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });
    expect(choices.attemptNumber).toBe(3);
    expect(choices.trigger).toBe('flew');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 3));
    expect(highlighted(choices).reason).toBe('continue-the-plan');
    expect(codes(choices)).not.toContain('third-attempt-not-raised');
  });
});

describe('§13.2 good and solid', () => {
  const plan = planFor('squat', 200);

  it('recommends the plan, with a step either side of it', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), GOOD);
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(choices.trigger).toBe('solid');
    expect(highlighted(choices).slot).toBe('recommended');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 2));
    expect(at(choices, 'secure').kilograms).toBe(plannedAt(plan, 2) - STEP);
    expect(at(choices, 'push').kilograms).toBe(plannedAt(plan, 2) + STEP);
  });

  it('offers no push on a plan whose goal was not to reach', () => {
    // "One sensible higher option when supported by the user's goal and limits"
    // is a condition, and a first meet does not meet it.
    const firstMeet = planFor('squat', 200, 'first-meet');
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(firstMeet, 1), GOOD);
    const choices = choicesFor(timeline, { plan: firstMeet, meetDayMaximumKilograms: 200 });

    expect(slots(choices)).not.toContain('push');
  });

  it('treats "not sure" as the plan rather than as a reading, and says so', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'unsure',
    });
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(choices.trigger).toBe('effort-not-recorded');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 2));
    expect(codes(choices)).toContain('effort-not-recorded');
  });
});

describe('§13.3 good but slow', () => {
  const plan = planFor('squat', 200);

  it('reduces the plan by a step and makes the plan itself the push', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'slow',
    });
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(choices.trigger).toBe('slow');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 2) - STEP);
    expect(highlighted(choices).reason).toBe('reduced-to-bank-the-lift');
    expect(at(choices, 'push').kilograms).toBe(plannedAt(plan, 2));
  });

  it('says so when the minimum progression leaves nothing to reduce to', () => {
    // The opener went in at one step under the planned second, so the floor and
    // the plan are the same weight and the reduction §13.3 asks for is not a
    // legal declaration.
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 2) - STEP, {
      outcome: 'good',
      effort: 'slow',
    });
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(codes(choices)).toContain('reduction-not-possible');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 2));
  });

  it('names the target the reduction gives up', () => {
    const target: LiveTarget = {
      kind: 'personal-record',
      measure: 'lift',
      kilograms: plannedAt(plan, 2),
      label: 'your squat PR',
    };
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'slow',
    });
    const choices = choicesFor(timeline, { plan, targets: [target] });

    expect(highlighted(choices).surrenders).toEqual([target]);
    expect(at(choices, 'push').reaches).toEqual([target]);
    expect(codes(choices)).toContain('target-surrendered');
  });
});

describe('§13.4 good but a grind', () => {
  const plan = planFor('squat', 200);

  function afterAGrind(targets: readonly LiveTarget[] = []): LiveChoices {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'grind',
    });
    return choicesFor(timeline, { plan, targets, meetDayMaximumKilograms: 200 });
  }

  it('recommends the smallest legal increase and offers a pass beside it', () => {
    const choices = afterAGrind();
    expect(choices.trigger).toBe('grind');
    expect(at(choices, 'secure').kilograms).toBeNull();
    expect(at(choices, 'secure').reason).toBe('pass-this-lift');
    expect(highlighted(choices).reason).toBe('smallest-legal-increase');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 1) + STEP);
  });

  it('offers a target as a tactical decision rather than a jump', () => {
    const target: LiveTarget = {
      kind: 'qualification',
      measure: 'lift',
      kilograms: plannedAt(plan, 1) + STEP * 2 - 1,
      label: 'the qualifying squat',
    };
    const choices = afterAGrind([target]);
    const push = at(choices, 'push');

    expect(push.tactical).toBe(true);
    expect(push.reason).toBe('reaches-a-target');
    // Rounded up onto the fixture's own multiple, and no further.
    expect(push.kilograms).toBe(plannedAt(plan, 1) + STEP * 2);
    expect(push.reaches).toEqual([target]);
  });

  it('leaves the plan as the tactical option when no target is in reach', () => {
    const push = at(afterAGrind(), 'push');
    expect(push.tactical).toBe(true);
    expect(push.kilograms).toBe(plannedAt(plan, 2));
  });
});

describe('§13.5 pain or unsafe', () => {
  const plan = planFor('squat', 200);

  it('recommends stopping after a good lift that hurt, and offers no push', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'pain',
    });
    const choices = choicesFor(timeline, { plan, meetDayMaximumKilograms: 200 });

    expect(choices.trigger).toBe('pain');
    expect(highlighted(choices).kilograms).toBeNull();
    expect(highlighted(choices).slot).toBe('secure');
    expect(slots(choices)).not.toContain('push');
    expect(codes(choices)).toContain('cannot-assess-injury');
  });

  it('recommends stopping after a miss from pain, with the repeat still available', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'pain',
    });
    const choices = choicesFor(timeline, { plan });

    expect(choices.trigger).toBe('pain-miss');
    expect(highlighted(choices).kilograms).toBeNull();
    expect(at(choices, 'recommended').kilograms).toBe(plannedAt(plan, 1));
    expect(at(choices, 'recommended').repeat).toBe(true);
  });
});

describe('§13.6 technical or command miss', () => {
  const plan = planFor('squat', 200);

  it('recommends the same weight again and says to check the call', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'command',
    });
    const choices = choicesFor(timeline, { plan });

    expect(choices.trigger).toBe('command-miss');
    expect(highlighted(choices).repeat).toBe(true);
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 1));
    expect(codes(choices)).toContain('confirm-the-technical-ruling');
  });

  it('emphasises the bomb-out risk when it was the opener', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'command',
    });
    const choices = choicesFor(timeline, { plan });
    const advisory = choices.advisories.find(
      (candidate) => candidate.code === 'bomb-out-risk-on-the-opener',
    );

    expect(advisory?.severity).toBe('strong');
  });

  it('still offers a higher legal attempt for a lifter who wants one', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'command',
    });
    const choices = choicesFor(timeline, { plan });
    expect(at(choices, 'recommended').kilograms).toBe(plannedAt(plan, 1) + STEP);
  });
});

describe('§13.7 strength miss', () => {
  const plan = planFor('squat', 200);

  it('does not recommend going up', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'strength',
    });
    const choices = choicesFor(timeline, { plan });

    expect(choices.trigger).toBe('strength-miss');
    expect(highlighted(choices).repeat).toBe(true);
  });

  it('warns prominently and withdraws the push on the last chance', () => {
    let timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'strength',
    });
    timeline = take(timeline, 'squat', 2, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'strength',
    });
    const choices = choicesFor(timeline, { plan });

    expect(choices.bombOut).toEqual({ misses: 2, attemptsRemaining: 1, onTheLastChance: true });
    expect(slots(choices)).not.toContain('push');
    const advisory = choices.advisories.find(
      (candidate) => candidate.code === 'final-attempt-and-bomb-out',
    );
    expect(advisory?.severity).toBe('strong');
  });
});

describe('§13.8 platform or official error', () => {
  const plan = planFor('squat', 200);

  it('sends the user to the officials rather than ruling on it', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'platform-error',
    });
    const choices = choicesFor(timeline, { plan });

    expect(choices.trigger).toBe('platform-error');
    const advisory = choices.advisories.find(
      (candidate) => candidate.code === 'confirm-the-extra-attempt',
    );
    expect(advisory?.severity).toBe('strong');
  });

  it('keeps a granted extra attempt out of the round sequence', () => {
    let timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), {
      outcome: 'no-lift',
      reason: 'platform-error',
    });
    timeline = apply(timeline, {
      kind: 'grant-extra-attempt',
      attemptId: attemptAt(timeline, 'squat', 1),
    });
    const choices = choicesFor(timeline, { plan });

    // The extra is reported, and it is reported beside the choices rather than
    // among them: the expeditor decides when it happens, not this tool.
    expect(choices.extraAttempts).toHaveLength(1);
    expect(codes(choices)).toContain('extra-attempt-timing-unknown');
    expect(choices.attemptNumber).toBe(2);

    // The struck attempt does not floor the next one, so the second attempt is
    // still offered at the weight it was planned at.
    expect(choices.trigger).toBe('attempt-set-aside');
    expect(highlighted(choices).kilograms).toBe(plannedAt(plan, 2));
  });
});

describe('§13.9 undo restores the recommendation', () => {
  const plan = planFor('squat', 200);

  it('gives the same choices after undoing a result as before recording it', () => {
    const before = meetWithLifter();
    const options: ChoicesOptions = { plan, meetDayMaximumKilograms: 200 };
    const original = choicesFor(before, options);

    const after = take(before, 'squat', 1, plannedAt(plan, 1), {
      outcome: 'good',
      effort: 'flew',
    });
    expect(choicesFor(after, options)).not.toEqual(original);

    // Three actions went in -- weight, submission, result -- so three come back.
    let restored = after;
    for (let step = 0; step < 3; step += 1) {
      const result = undo({ present: restored.present, past: restored.past });
      if (!result.ok) throw new Error('nothing to undo');
      restored = result.timeline;
    }

    expect(choicesFor(restored, options)).toEqual(original);
  });
});

describe('§10.2 risk and the absence of one', () => {
  const plan = planFor('squat', 200);

  it('grades nothing when the lifter never confirmed a maximum', () => {
    const choices = choicesFor(meetWithLifter(), { plan });
    for (const choice of choices.choices) {
      expect(choice.risk).toBeNull();
      expect(choice.percentOfMaximum).toBeNull();
    }
    expect(codes(choices)).toContain('no-maximum-confirmed');
  });

  it('grades every weight once there is a maximum to grade it against', () => {
    const choices = choicesFor(meetWithLifter(), { plan, meetDayMaximumKilograms: 200 });
    for (const choice of choices.choices) {
      expect(choice.risk).not.toBeNull();
      expect(choice.percentOfMaximum).toBeCloseTo(((choice.kilograms ?? 0) / 200) * 100, 9);
    }
    expect(codes(choices)).not.toContain('no-maximum-confirmed');
  });
});

describe('targets', () => {
  const plan = planFor('deadlift', 200);

  it('reaches a total target only once the total is complete', () => {
    const target: LiveTarget = {
      kind: 'qualification',
      measure: 'total',
      kilograms: 400,
      label: 'the qualifying total',
    };

    // Two lifts banked at 120 each, so a 160 kg deadlift makes the figure.
    let timeline = take(meetWithLifter(), 'squat', 1, 120, GOOD);
    timeline = take(timeline, 'bench', 1, 120, GOOD);

    const onTheDeadlift = choicesFor(timeline, {
      lift: 'deadlift',
      plan,
      targets: [target],
    });
    const reaching = onTheDeadlift.choices.filter((choice) => choice.reaches.length > 0);
    for (const choice of reaching) {
      expect(choice.projected.isTotal).toBe(true);
      expect(choice.kilograms ?? 0).toBeGreaterThanOrEqual(160);
    }

    // The same target, asked about on the squat, is reached by nothing: there is
    // no total to compare it with yet.
    const onTheSquat = choicesFor(meetWithLifter(), {
      lift: 'squat',
      plan: planFor('squat', 200),
      targets: [target],
    });
    expect(onTheSquat.choices.every((choice) => choice.reaches.length === 0)).toBe(true);
  });
});

describe('§8.1 the lifter’s ceiling', () => {
  const plan = planFor('squat', 200);

  it('holds every choice at the ceiling and collapses what lands on it', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), GOOD);
    const ceiling = plannedAt(plan, 2);
    const choices = choicesFor(timeline, { plan, ceilingKilograms: ceiling });

    for (const choice of choices.choices) {
      expect(choice.kilograms ?? 0).toBeLessThanOrEqual(ceiling);
    }
    expect(codes(choices)).toContain('ceiling-applied');
    // Recommended and Push both landed on the ceiling and became one card.
    expect(new Set(choices.choices.map((choice) => choice.kilograms)).size).toBe(
      choices.choices.length,
    );
    expect(choices.choices.some((choice) => choice.highlighted)).toBe(true);
  });

  it('says so rather than pretending when the ceiling is below the legal floor', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, plannedAt(plan, 1), GOOD);
    const choices = choicesFor(timeline, { plan, ceilingKilograms: 10 });
    expect(codes(choices)).toContain('ceiling-below-the-minimum');
  });
});

describe('a lift with nothing left', () => {
  it('offers no choices and says why', () => {
    let timeline = meetWithLifter();
    for (const attemptNumber of [1, 2, 3]) {
      timeline = take(timeline, 'squat', attemptNumber, 100 + attemptNumber * STEP, GOOD);
    }
    const choices = choicesFor(timeline);

    expect(choices.choices).toEqual([]);
    expect(choices.highlightedSlot).toBeNull();
    expect(choices.attemptId).toBeNull();
    expect(codes(choices)).toContain('lift-is-complete');
  });
});

// -----------------------------------------------------------------------------
// Properties that hold across every branch
// -----------------------------------------------------------------------------

/** One meet per §13 branch, each one round deep. */
function everyBranch(): readonly { readonly name: string; readonly timeline: MeetTimeline }[] {
  const plan = planFor('squat', 200);
  const opener = plannedAt(plan, 1);
  const results: readonly { readonly name: string; readonly result: RecordedResult }[] = [
    { name: 'flew', result: { outcome: 'good', effort: 'flew' } },
    { name: 'solid', result: { outcome: 'good', effort: 'solid' } },
    { name: 'slow', result: { outcome: 'good', effort: 'slow' } },
    { name: 'grind', result: { outcome: 'good', effort: 'grind' } },
    { name: 'pain', result: { outcome: 'good', effort: 'pain' } },
    { name: 'effort unsure', result: { outcome: 'good', effort: 'unsure' } },
    { name: 'command miss', result: { outcome: 'no-lift', reason: 'command' } },
    { name: 'strength miss', result: { outcome: 'no-lift', reason: 'strength' } },
    { name: 'pain miss', result: { outcome: 'no-lift', reason: 'pain' } },
    { name: 'platform error', result: { outcome: 'no-lift', reason: 'platform-error' } },
    { name: 'administrative miss', result: { outcome: 'no-lift', reason: 'administrative' } },
    { name: 'miss unsure', result: { outcome: 'no-lift', reason: 'unsure' } },
  ];

  return [
    { name: 'nothing yet', timeline: meetWithLifter() },
    ...results.map((entry) => ({
      name: entry.name,
      timeline: take(meetWithLifter(), 'squat', 1, opener, entry.result),
    })),
  ];
}

describe('every branch', () => {
  const plan = planFor('squat', 200);
  const options: ChoicesOptions = { plan, meetDayMaximumKilograms: 200 };

  it('highlights exactly one choice', () => {
    for (const branch of everyBranch()) {
      const choices = choicesFor(branch.timeline, options);
      const marked = choices.choices.filter((choice) => choice.highlighted);
      expect(marked, branch.name).toHaveLength(1);
      expect(choices.highlightedSlot, branch.name).toBe(marked[0]?.slot);
    }
  });

  it('only ever offers a weight the rules would accept', () => {
    for (const branch of everyBranch()) {
      const lifter = only(branch.timeline);
      const taken = takenOn(lifter, 'squat');
      for (const choice of choicesFor(branch.timeline, options).choices) {
        if (choice.kilograms === null) continue;
        expect(
          RULES.isLegalNextAttempt(taken, choice.kilograms),
          `${branch.name} offered ${String(choice.kilograms)}`,
        ).toEqual({ legal: true });
      }
    }
  });

  it('never offers the same weight twice', () => {
    for (const branch of everyBranch()) {
      const offered = choicesFor(branch.timeline, options).choices.map(
        (choice) => choice.kilograms,
      );
      expect(new Set(offered).size, branch.name).toBe(offered.length);
    }
  });

  it('never uses the language of probability', () => {
    // §10.2. The four risk words are the whole vocabulary, and nothing written
    // beside them may reintroduce what they were chosen to avoid.
    const forbidden =
      /\b(?:probability|chance of|likelihood|odds|guaranteed|safe bet|\d+% likely)\b/i;
    for (const branch of everyBranch()) {
      const choices = choicesFor(branch.timeline, options);
      for (const choice of choices.choices) {
        expect(choice.explanation, branch.name).not.toMatch(forbidden);
      }
      for (const advisory of choices.advisories) {
        expect(advisory.message, branch.name).not.toMatch(forbidden);
      }
    }
  });

  it('is a pure reading of the document', () => {
    // Nothing stored, nothing cached, no clock. Two calls on the same document
    // are the same answer, which is what §13.9's undo depends on.
    for (const branch of everyBranch()) {
      const first = choicesFor(branch.timeline, options);
      const second = choicesFor(branch.timeline, options);
      expect(second, branch.name).toEqual(first);
    }
  });
});

describe('the document is not touched', () => {
  it('leaves the lifter exactly as it found them', () => {
    const timeline = take(meetWithLifter(), 'squat', 1, 160, GOOD);
    const before: MeetDocument = structuredClone(timeline.present);
    choicesFor(timeline, { plan: planFor('squat', 200), meetDayMaximumKilograms: 200 });
    expect(timeline.present).toEqual(before);
  });
});
