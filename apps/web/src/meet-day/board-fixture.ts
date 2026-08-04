// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A flight of three, a warm-up room, and an instant, for §21's screens.
 *
 * Tool-local rather than reaching for the domain's `coach-board.fixture.ts`, for
 * the reason `meet-rules.fixture.ts` gives: the domain excludes `*.fixture.ts`
 * from `dist` and publishes a single `.` export, so its scaffolding is
 * unreachable from here and opening a subpath to it would ship test material to
 * every consumer to save one file. `estimate-fixture.ts` in tool 3 set the
 * precedent and `planner-fixture.ts` followed it.
 *
 * It shares `live-fixture.ts`'s rule book, chart and instant rather than
 * inventing a second set, so a board row and the live screen for the lifter in
 * it are the same meet read two ways -- which is the whole of what §21.1's
 * one-tap switch does, and the pair of screens most likely to drift.
 *
 * Every timeline comes out of `applyMeetAction` for the reason that file gives.
 * Every warm-up schedule comes out of `meetWarmup` for the matching one: a
 * hand-built `WarmupPlan` can hold a ramp the calculator would never produce,
 * and a board that copes with one proves nothing about the ramps it will get.
 * The item *times* are written by hand, because that is what each case is about.
 */
import {
  createMeetDocument,
  meetWarmup,
  nextAttemptOn,
  startTimeline,
  type BarbellSetup,
  type CoachBoardEntry,
  type MeetDocument,
  type MeetTimeline,
  type MeetWarmupSchedule,
  type PlateDenomination,
  type PlatformEstimate,
  type RecordedResult,
  type ScheduledItem,
  type WarmupTimeline,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import { buildBoardView, type BoardContext, type BoardView } from './board.js';
import { CHART, RULES, START, act } from './live-fixture.js';

/**
 * Three invented names, distinct in their first letter and their length.
 *
 * Both matter here in a way they do not on the live screen: this is the first
 * surface in the collection showing several lifters at once, so a test that
 * found "the name is on the row" against a single-lifter fixture would find it
 * against any row at all.
 */
export const BOARD_LIFTERS = ['Dana Okafor', 'Bo Adeyemi', 'Ines Vaszary'] as const;

export function minutes(count: number): number {
  return count * 60;
}

export function boardMeet(
  names: readonly string[] = BOARD_LIFTERS,
  format: MeetFormat = 'full-power',
): MeetTimeline {
  let timeline = startTimeline(createMeetDocument(RULES, format));
  for (const name of names) timeline = act(timeline, { kind: 'add-lifter', name });
  return timeline;
}

/** A lifter by position on the board, because the ids are generated. */
export function lifterIdAt(document: MeetDocument, index: number): string {
  const lifter = document.lifters[index];
  if (lifter === undefined) throw new Error(`fixture has no lifter at ${String(index)}`);
  return lifter.id;
}

/**
 * The next attempt on a lift, for a named lifter.
 *
 * `live-fixture.ts`'s version reads `lifters[0]`, which is right for a meet with
 * one lifter in it and silently wrong here -- every action would land on Dana
 * however the caller named it, and the board under test would show one lifter
 * three attempts in and two who never started.
 */
function nextAttemptIdFor(timeline: MeetTimeline, lifterId: string, lift: PlatformLift): string {
  const lifter = timeline.present.lifters.find((candidate) => candidate.id === lifterId);
  if (lifter === undefined) throw new Error(`fixture has no lifter ${lifterId}`);
  const next = nextAttemptOn(lifter, lift);
  if (next === null) throw new Error(`fixture lifter has no attempt left on the ${lift}`);
  return next.id;
}

/** One whole attempt for one named lifter, which is what starts their clock. */
export function takeFor(
  timeline: MeetTimeline,
  lifterId: string,
  lift: PlatformLift,
  kilograms: number,
  at = START,
  result: RecordedResult = { outcome: 'good', effort: 'solid' },
): MeetTimeline {
  const attemptId = nextAttemptIdFor(timeline, lifterId, lift);
  const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms }, at);
  const submitted = act(declared, { kind: 'advance-attempt', attemptId, to: 'submitted' }, at);
  return act(submitted, { kind: 'record-result', attemptId, result }, at);
}

/** A weight chosen and not yet handed over, for one named lifter. */
export function chooseFor(
  timeline: MeetTimeline,
  lifterId: string,
  lift: PlatformLift,
  kilograms: number,
  at = START,
): MeetTimeline {
  const attemptId = nextAttemptIdFor(timeline, lifterId, lift);
  const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms }, at);
  return act(declared, { kind: 'advance-attempt', attemptId, to: 'selected' }, at);
}

/*
 * ---------------------------------------------------------------------------
 * A warm-up room.
 * ---------------------------------------------------------------------------
 */

/** Invented (§5.1), and a full kilogram set so the plate changes come out uneven. */
const WARM_UP_PLATES: readonly PlateDenomination[] = [
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
  plates: WARM_UP_PLATES,
};

/** Far enough out that a whole ramp fits in front of it. */
export const ESTIMATE: PlatformEstimate = {
  attemptsBefore: 50,
  pace: { secondsPerAttempt: 60, source: 'observed' },
  earliestSeconds: 2520,
  latestSeconds: 3480,
  delaySeconds: 0,
  advisories: [],
};

/**
 * A real ramp, borrowed for its shape and never for its times.
 *
 * §21.4 reads the weights off it and §21 reads exactly one other thing -- how
 * many warm-up sets there are, which is what makes the last one final -- so a
 * genuine plan is cheaper than a hand-built fake and cannot drift out of the
 * type. Every start time below is written by hand.
 */
const RAMP = ((): MeetWarmupSchedule => {
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
export function timelineOf(items: readonly ScheduledItem[], builtAt = START): WarmupTimeline {
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

export function warmupAt(warmupIndex: number, startsInMinutes: number): ScheduledItem {
  return item('warm-up-set', startsInMinutes, { warmupIndex });
}

/** The last set of a `WARM_UP_SETS`-long ramp, which is the final warm-up. */
export function finalWarmupAt(startsInMinutes: number): ScheduledItem {
  return warmupAt(WARM_UP_SETS - 1, startsInMinutes);
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

/** A whole ramp, one set every three minutes from `firstAt`. */
export function rampFrom(firstAt: number): WarmupTimeline {
  return timelineOf(
    Array.from({ length: WARM_UP_SETS }, (_unused, index) => warmupAt(index, firstAt + index * 3)),
  );
}

/*
 * ---------------------------------------------------------------------------
 * The board.
 * ---------------------------------------------------------------------------
 */

/**
 * One lifter's per-device context.
 *
 * The identifier is supplied by default rather than left blank, because the
 * blank case is a real one -- `coachBoard` fills it with the row's position --
 * and a fixture that never supplied one would leave the *supplied* path with no
 * coverage at all, which is the path every real board takes.
 */
export function entryFor(
  lifterId: string,
  patch: Partial<Omit<CoachBoardEntry, 'lifterId'>> = {},
): CoachBoardEntry {
  return { lifterId, identifier: '1', ...patch };
}

export function contextAt(now: number, patch: Partial<BoardContext> = {}): BoardContext {
  return { rules: RULES, chart: CHART, entries: [], now, ...patch };
}

export function boardAt(timeline: MeetTimeline, context: BoardContext): BoardView {
  return buildBoardView(timeline.present, context);
}

/**
 * A board with every lifter set up, which is what a coach's phone looks like.
 *
 * Distinct identifiers and distinct colours, and the colours are there to be
 * ignored: §21's rule is that colour is never the only cue, and a fixture with
 * no colours in it cannot show whether a row obeys that or merely has nothing to
 * disobey with.
 */
export function threeLifters(now = START): { timeline: MeetTimeline; context: BoardContext } {
  const timeline = boardMeet();
  const document = timeline.present;
  return {
    timeline,
    context: contextAt(now, {
      entries: [
        entryFor(lifterIdAt(document, 0), {
          identifier: '12',
          colour: '#c2410c',
          warmup: rampFrom(2),
        }),
        entryFor(lifterIdAt(document, 1), {
          identifier: '31',
          colour: '#1d4ed8',
          warmup: rampFrom(6),
        }),
        entryFor(lifterIdAt(document, 2), {
          identifier: '48',
          colour: '#15803d',
          warmup: rampFrom(10),
        }),
      ],
    }),
  };
}

/** Invented, and deliberately not "the rack" -- a room with one bar needs no id. */
export const RACK = 'rack-a';

/**
 * Two lifters queueing for one bar, on ramps that interleave.
 *
 * The offset is four minutes against a three-minute cadence, so the two ramps
 * cross rather than run in step: the bar goes up, comes back down for the second
 * lifter's opening set, and goes up again. That is §21.4's whole subject, and a
 * fixture whose two lifters happened to want the same weight at the same moment
 * would exercise only the case where sharing is free.
 */
export function sharedRack(now = START): { timeline: MeetTimeline; context: BoardContext } {
  const timeline = boardMeet(BOARD_LIFTERS.slice(0, 2));
  const document = timeline.present;
  return {
    timeline,
    context: contextAt(now, {
      entries: [
        entryFor(lifterIdAt(document, 0), {
          identifier: '12',
          warmup: rampFrom(2),
          rackId: RACK,
        }),
        entryFor(lifterIdAt(document, 1), {
          identifier: '31',
          warmup: rampFrom(6),
          rackId: RACK,
        }),
      ],
    }),
  };
}
