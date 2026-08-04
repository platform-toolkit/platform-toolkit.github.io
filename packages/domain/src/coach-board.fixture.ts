// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A meet, a warm-up schedule, and an instant, for the two modules that read all
 * three.
 *
 * `coach-board.ts` and `coach-board-conflicts.ts` are separate projections over
 * the same request, and their tests need the same scaffolding: a document with
 * some lifters in it, attempts taken and judged so a declaration clock is
 * running, and schedules whose items sit exactly where the case wants them.
 * Sharing it here rather than copying it means the two files cannot drift into
 * disagreeing about what a fixture ramp looks like -- which would make a warning
 * about the board and a warning about a conflict impossible to compare.
 *
 * Every instant is supplied and nothing reads the clock, for the reason
 * `meet-document.test.ts` gives: a test that passed because two figures were
 * measured in the same millisecond is a test that fails on a slow machine.
 */
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import type { WarmupTimeline } from './warmup-timeline.js';
import {
  applyMeetAction,
  attemptsOn,
  createMeetDocument,
  startTimeline,
  type MeetAction,
  type MeetDocument,
  type MeetTimeline,
  type RecordedResult,
} from './meet-document.js';
import { meetWarmup, type MeetWarmupSchedule, type ScheduledItem } from './meet-warmup.js';
import { rulesFor } from './meet-profile.fixture.js';
import type { PlatformEstimate } from './platform-timing.js';
import type { BarbellSetup, PlateDenomination } from './plates.js';

export const RULES = rulesFor();

/** An invented instant. Every other time in these files is an offset from it. */
export const AT = 1_700_000_000_000;

export function minutes(count: number): number {
  return count * 60;
}

// -----------------------------------------------------------------------------
// A meet
// -----------------------------------------------------------------------------

export function apply(timeline: MeetTimeline, action: MeetAction, at = AT): MeetTimeline {
  const result = applyMeetAction(RULES, timeline, action, at);
  if (!result.ok) {
    throw new Error(
      `${action.kind} was refused: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.timeline;
}

export function meetWith(
  names: readonly string[],
  format: MeetFormat = 'full-power',
): MeetTimeline {
  let timeline = startTimeline(createMeetDocument(RULES, format));
  for (const name of names) timeline = apply(timeline, { kind: 'add-lifter', name });
  return timeline;
}

/** The lifter at a position, by position rather than by generated id. */
export function lifterId(document: MeetDocument, index: number): string {
  const lifter = document.lifters[index];
  if (lifter === undefined) throw new Error(`no lifter at ${String(index)}`);
  return lifter.id;
}

export function attemptId(
  document: MeetDocument,
  index: number,
  lift: PlatformLift,
  attemptNumber: number,
): string {
  const lifter = document.lifters[index];
  if (lifter === undefined) throw new Error(`no lifter at ${String(index)}`);
  const attempt = attemptsOn(lifter, lift).find(
    (candidate) => candidate.attemptNumber === attemptNumber && candidate.kind === 'competition',
  );
  if (attempt === undefined) throw new Error(`no ${lift} attempt ${String(attemptNumber)}`);
  return attempt.id;
}

/** Weigh, submit and judge one attempt, which is what starts the next clock. */
export function take(
  timeline: MeetTimeline,
  index: number,
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  result: RecordedResult = { outcome: 'good', effort: 'solid' },
  at = AT,
): MeetTimeline {
  const id = attemptId(timeline.present, index, lift, attemptNumber);
  let next = apply(timeline, { kind: 'set-attempt-weight', attemptId: id, kilograms }, at);
  next = apply(next, { kind: 'advance-attempt', attemptId: id, to: 'submitted' }, at);
  return apply(next, { kind: 'record-result', attemptId: id, result }, at);
}

/** Put a weight on an attempt and leave it there, without handing it in. */
export function declare(
  timeline: MeetTimeline,
  index: number,
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  at = AT,
): MeetTimeline {
  const id = attemptId(timeline.present, index, lift, attemptNumber);
  return apply(timeline, { kind: 'set-attempt-weight', attemptId: id, kilograms }, at);
}

/**
 * Hand a weight to the table without waiting for the officials to judge it.
 *
 * The countdown is not cleared by handing the card in -- it keeps running until
 * the attempt is resolved -- so this is the state in which a lifter has a live
 * clock and nothing left to do about it, which is a state both projections have
 * to recognise and neither can reach through `take`.
 */
export function submit(
  timeline: MeetTimeline,
  index: number,
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number,
  at = AT,
): MeetTimeline {
  const id = attemptId(timeline.present, index, lift, attemptNumber);
  const next = apply(timeline, { kind: 'set-attempt-weight', attemptId: id, kilograms }, at);
  return apply(next, { kind: 'advance-attempt', attemptId: id, to: 'submitted' }, at);
}

// -----------------------------------------------------------------------------
// A warm-up schedule
// -----------------------------------------------------------------------------

const KILOGRAM_PLATES: readonly PlateDenomination[] = [
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 20, pairs: null, fullDiameter: true },
  { weight: 15, pairs: null, fullDiameter: false },
  { weight: 10, pairs: null, fullDiameter: true },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1.25, pairs: null, fullDiameter: false },
];

export const WARM_UP_ROOM: BarbellSetup = {
  plateUnit: 'kg',
  bar: { amount: 20, unit: 'kg' },
  collars: { amount: 5, unit: 'kg' },
  plates: KILOGRAM_PLATES,
};

export const ESTIMATE: PlatformEstimate = {
  attemptsBefore: 50,
  pace: { secondsPerAttempt: 60, source: 'observed' },
  earliestSeconds: 2520,
  latestSeconds: 3480,
  delaySeconds: 0,
  advisories: [],
};

/**
 * A real ramp, borrowed for its shape and never for its numbers.
 *
 * The board reads exactly one thing off a plan -- how many warm-up sets there
 * are, which is what makes the last one the final one -- so a genuine plan is
 * cheaper than a hand-built fake and carries no risk of drifting out of the
 * type. Every start time below is written by hand.
 */
export const RAMP = ((): MeetWarmupSchedule => {
  const built = meetWarmup({
    lift: 'squat',
    opener: { amount: 160, unit: 'kg' },
    setup: WARM_UP_ROOM,
    estimate: ESTIMATE,
  });
  if (!built.ok) throw new Error('the fixture ramp did not build');
  return built.schedule;
})();

/** How many warm-up sets a scheduled fixture pretends to have. */
export const WARM_UP_SETS = 4;

export function item(
  kind: ScheduledItem['kind'],
  startsInMinutes: number,
  patch: Partial<ScheduledItem> = {},
): ScheduledItem {
  return {
    kind,
    warmupIndex: null,
    equipmentId: null,
    seconds: 45,
    startsInSeconds: {
      earliestSeconds: minutes(startsInMinutes),
      latestSeconds: minutes(startsInMinutes) + 60,
    },
    ...patch,
  };
}

/** A schedule carrying exactly the items a case is about, counted from `builtAt`. */
export function timelineOf(items: readonly ScheduledItem[], builtAt = AT): WarmupTimeline {
  if (RAMP.plan.warmups.length < WARM_UP_SETS) {
    throw new Error('the fixture ramp is shorter than the fixture pretends');
  }
  return {
    schedule: {
      ...RAMP,
      plan: { ...RAMP.plan, warmups: RAMP.plan.warmups.slice(0, WARM_UP_SETS) },
      items,
    },
    builtAt,
  };
}

/** The last warm-up set of a `WARM_UP_SETS`-long ramp, which is the final one. */
export function finalWarmupAt(startsInMinutes: number): ScheduledItem {
  return item('warm-up-set', startsInMinutes, { warmupIndex: WARM_UP_SETS - 1 });
}

export function firstWarmupAt(startsInMinutes: number): ScheduledItem {
  return item('warm-up-set', startsInMinutes, { warmupIndex: 0 });
}

export function equipmentAt(startsInMinutes: number): ScheduledItem {
  return item('equipment', startsInMinutes, { equipmentId: 'knee-wraps' });
}

/** What a warm-up set of the fixture ramp puts on the bar. */
export function rampKilogramsAt(warmupIndex: number): number {
  const set = RAMP.plan.warmups[warmupIndex];
  if (set === undefined) throw new Error(`the fixture ramp has no set ${String(warmupIndex)}`);
  return set.loading.total;
}
