// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One meet, built the only way a meet can be built.
 *
 * Every timeline here comes out of `applyMeetAction`, never out of a literal
 * `MeetDocument`. A hand-written document can hold a state the actions cannot
 * produce -- an attempt marked submitted with no weight, a countdown pointing at
 * a resolved attempt -- and a test or a story that shows the screen coping with
 * one proves the screen copes with something that will never arrive, while
 * saying nothing about the states that will.
 *
 * Shared by `live.test.ts`, the §13 choices element and its stories, so that all
 * three are looking at the same meet. Two copies of this file is the fork worth
 * avoiding: the interesting cases here are sequences (a grind on the second, a
 * miss on the third, a bomb-out one attempt away), and a story built on its own
 * private sequence drifts away from the test that was supposed to cover it.
 *
 * No figure below is written out where it can be derived. Both the rule book and
 * the chart are invented (§5.1), and the fixture's bar multiple is a half
 * kilogram with a one-kilogram minimum progression -- unlike anything published,
 * so an assertion that passed against a hard-coded real increment fails here.
 */
import {
  applyMeetAction,
  createMeetDocument,
  nextAttemptOn,
  startTimeline,
  type MeetAction,
  type MeetTimeline,
  type RecordedResult,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import {
  NOTHING_OBSERVED,
  NO_PLANNING,
  NO_PLANNING_AT_ALL,
  buildLiveView,
  type LiveContext,
  type LivePlanning,
} from './live.js';
import { CHARTED_CONTEXT } from './planner-fixture.js';
import { rulesFor } from './meet-rules.fixture.js';

export const RULES = rulesFor();
export const CHART = CHARTED_CONTEXT.chart;

/** Invented, and the point of the panel it appears on (§14). */
export const LIFTER = 'Dana Okafor';

/** Every action lands here, so the whole suite has one clock and no `Date`. */
export const START = 1_700_000_000_000;

/** Chart rows are 5 kg apart from 150, so these three all have a published pound figure. */
export const OPENER = 180;
export const SECOND = 190;
export const THIRD = 200;

export function act(timeline: MeetTimeline, action: MeetAction, at = START): MeetTimeline {
  const result = applyMeetAction(RULES, timeline, action, at);
  if (!result.ok) {
    throw new Error(
      `fixture action ${action.kind} was refused: ${result.problems.map((p) => p.code).join(', ')}`,
    );
  }
  return result.timeline;
}

export function meetWith(format: MeetFormat = 'full-power'): MeetTimeline {
  return act(startTimeline(createMeetDocument(RULES, format)), {
    kind: 'add-lifter',
    name: LIFTER,
  });
}

export function onlyLifterIn(timeline: MeetTimeline): string {
  const [first] = timeline.present.lifters;
  if (first === undefined) throw new Error('fixture has no lifter');
  return first.id;
}

export function nextAttemptIdOn(timeline: MeetTimeline, lift: PlatformLift): string {
  const [lifter] = timeline.present.lifters;
  if (lifter === undefined) throw new Error('fixture has no lifter');
  const next = nextAttemptOn(lifter, lift);
  if (next === null) throw new Error(`fixture has no attempt left on the ${lift}`);
  return next.id;
}

/**
 * Chooses a weight and stops short of the table, which is §11's `submit-to-the-table`.
 *
 * The one state between choosing and the table, and the only way to reach it:
 * `submit` below advances past it in the same call, so a caller that wanted the
 * screen mid-declaration would otherwise have to hand-write a document, which is
 * the thing the header of this file rules out.
 *
 * It takes **two** actions and the second one is the whole point. `set-attempt-weight`
 * writes the kilograms and deliberately leaves the status alone -- an attempt with a
 * weight on it is still `planned`, because the plan holds weights nobody has declared
 * -- so a fixture that stopped after it is indistinguishable from one that chose
 * nothing, and `actionFor` still reads `choose-the-next-attempt`. It is `selected`
 * that says a human picked this, and `selected` is the state the table has not been
 * told about yet. Written the short way first, and the test asserting the four
 * headlines are four distinct sentences is what caught it.
 */
export function choose(
  timeline: MeetTimeline,
  lift: PlatformLift,
  kilograms: number,
  at = START,
): MeetTimeline {
  const attemptId = nextAttemptIdOn(timeline, lift);
  const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms }, at);
  return act(declared, { kind: 'advance-attempt', attemptId, to: 'selected' }, at);
}

/** Declares a weight and gets it as far as the table, without a result. */
export function submit(
  timeline: MeetTimeline,
  lift: PlatformLift,
  kilograms: number,
  at = START,
): MeetTimeline {
  const attemptId = nextAttemptIdOn(timeline, lift);
  const declared = act(timeline, { kind: 'set-attempt-weight', attemptId, kilograms }, at);
  return act(declared, { kind: 'advance-attempt', attemptId, to: 'submitted' }, at);
}

/** One whole attempt, from declaring the weight to the lights. */
export function take(
  timeline: MeetTimeline,
  lift: PlatformLift,
  kilograms: number,
  result: RecordedResult = { outcome: 'good', effort: 'solid' },
  at = START,
): MeetTimeline {
  const attemptId = nextAttemptIdOn(timeline, lift);
  return act(
    submit(timeline, lift, kilograms, at),
    { kind: 'record-result', attemptId, result },
    at,
  );
}

/**
 * A confirmed meet-day maximum on one lift, and nothing else.
 *
 * Two of §13's eight facts per card -- the risk band and the share of the
 * maximum -- are `null` unless a maximum was confirmed (§13.1), so a fixture
 * built on `NO_PLANNING_AT_ALL` produces cards that document the ungraded
 * screen and only that one. Every story or test that is about a graded card has
 * to supply this, and supplying it is deliberately one call rather than a
 * default: the ungraded screen is a real state a lifter reaches by declining
 * §7's confirmation, and a fixture that quietly graded everything would leave it
 * with no coverage at all.
 *
 * No plan and no ceiling, because neither is needed for the grading and both
 * would put a second source of weights into a fixture whose figures are already
 * derived from the previous attempt.
 */
export function maximumOn(lift: PlatformLift, kilograms: number): LivePlanning {
  return { ...NO_PLANNING_AT_ALL, [lift]: { ...NO_PLANNING, meetDayMaximumKilograms: kilograms } };
}

export function contextAt(now: number, patch: Partial<LiveContext> = {}): LiveContext {
  return {
    rules: RULES,
    chart: CHART,
    planning: NO_PLANNING_AT_ALL,
    targets: [],
    observed: NOTHING_OBSERVED,
    now,
    ...patch,
  };
}

/** Throws rather than returning null, so no caller below has to unwrap. */
export function viewOf(timeline: MeetTimeline, context = contextAt(START)) {
  const view = buildLiveView(timeline, onlyLifterIn(timeline), context);
  if (view === null) throw new Error('fixture lifter was not found in the meet');
  return view;
}

/**
 * §14.1's panel, unwrapped.
 *
 * Every band the panel can be in comes out of one sequence and a different
 * `now`: the fixture profile allows ninety seconds, so the same recorded opener
 * reads calm, then hurry under thirty, then critical under ten, then lapsed.
 * That is the fixture worth having, because the thresholds are absolute seconds
 * and a rule profile that allowed sixty would move every band boundary in a test
 * that hard-coded an offset from the deadline instead of from the start.
 */
export function submissionOf(timeline: MeetTimeline, context = contextAt(START)) {
  const submission = viewOf(timeline, context).submission;
  if (submission === null) throw new Error('fixture lifter has no deadline running');
  return submission;
}

/**
 * The choices on a lift, unwrapped.
 *
 * `LiveView.choices` is nullable because a lifter whose meet is over has none,
 * and every §13 caller wants the object rather than the possibility. Throwing
 * here means a fixture that stopped producing choices fails at the fixture
 * instead of rendering an empty screen that a story would happily show.
 */
export function choicesOf(timeline: MeetTimeline, context = contextAt(START)) {
  const choices = viewOf(timeline, context).choices;
  if (choices === null) throw new Error('fixture lifter has no lift under way');
  return choices;
}
