// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One finished meet, in the states worth reading afterwards (§26).
 *
 * Extracted for the reason `live-fixture.ts` and `pack-fixture.ts` were: a
 * `MeetSummary` is a projection of a whole timeline plus a plan plus a rule book,
 * and a story that assembled its own three would drift away from the suite meant
 * to cover it -- silently, because both would keep rendering something
 * summary-shaped.
 *
 * Every meet here is walked with `live-fixture.ts`'s `take`, so the documents are
 * ones `applyMeetAction` can actually produce. That matters more here than
 * anywhere else in the directory: this module reads `MeetTimeline.past`, and a
 * hand-written timeline is precisely a timeline with no past.
 *
 * Nothing that ships may import this file.
 */
import { liveChoicesFor, type LiveTarget, type RecordedResult } from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { CHART, RULES, START, act, meetWith, onlyLifterIn, take } from './live-fixture.js';
import { buildPlan, type PlannerView } from './plan.js';
import { PLAN_CONTEXT } from './planner-fixture.js';
import { EMPTY_SESSION, confirmMaximum, withFigures, type PlannerSession } from './session.js';
import { summariseMeet, type MeetSummary, type SummaryRequest } from './summary.js';

const LIFTS: readonly PlatformLift[] = ['squat', 'bench', 'deadlift'];

/** A minute between recorded results, so §26's timing notes are not all zero. */
export const BETWEEN_ATTEMPTS_MS = 60_000;

/** A session with one confirmed maximum on every lift: enough for a plan to exist. */
export function plannedSession(kilograms = '200'): PlannerSession {
  const typed = LIFTS.reduce(
    (carry, lift) => withFigures(carry, lift, { expectedMaximum: kilograms }),
    EMPTY_SESSION,
  );
  return LIFTS.reduce((carry, lift) => confirmMaximum(carry, lift, true), typed);
}

export function plannedView(kilograms = '200'): PlannerView {
  return buildPlan(plannedSession(kilograms), PLAN_CONTEXT);
}

/** The plan's own weight for one attempt, so no test writes a weight out. */
export function plannedKilograms(
  view: PlannerView,
  lift: PlatformLift,
  attemptNumber: number,
): number {
  const planned = view.lifts.find((entry) => entry.lift === lift);
  const attempt = planned?.attempts.find((entry) => entry.attemptNumber === attemptNumber);
  if (attempt === undefined) throw new Error(`the plan has no ${lift} attempt ${attemptNumber}`);
  return attempt.weight.kilograms;
}

/** One attempt in a walked meet: which lift, what was declared, how it went. */
export interface Attempted {
  readonly lift: PlatformLift;
  readonly kilograms: number;
  readonly result: RecordedResult;
}

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };
const STRENGTH_MISS: RecordedResult = { outcome: 'no-lift', reason: 'strength' };

/**
 * A meet walked through the actions, one attempt at a time.
 *
 * Each attempt is recorded a minute after the one before, so `intervalsFrom` has
 * something to measure that is neither zero nor read from a clock.
 */
export function walk(attempts: readonly Attempted[]): ReturnType<typeof meetWith> {
  let timeline = meetWith('full-power');
  attempts.forEach((attempt, index) => {
    timeline = take(
      timeline,
      attempt.lift,
      attempt.kilograms,
      attempt.result,
      START + index * BETWEEN_ATTEMPTS_MS,
    );
  });
  return timeline;
}

/** Nine attempts, all made, at the weights the plan set out. */
export function toPlan(view: PlannerView = plannedView()): readonly Attempted[] {
  return LIFTS.flatMap((lift) =>
    [1, 2, 3].map((attemptNumber) => ({
      lift,
      kilograms: plannedKilograms(view, lift, attemptNumber),
      result: GOOD,
    })),
  );
}

/**
 * The ordinary meet: everything to plan, every lift made.
 *
 * Deliberately the boring one. The interesting summaries are built by patching
 * this in the test that is about them, so that the difference between "a good
 * day" and the case under test is one line and is visible.
 */
export function aGoodDay(): ReturnType<typeof meetWith> {
  return walk(toPlan());
}

/**
 * The day that ends with no total: everything to plan, and three misses on the bench.
 *
 * Here rather than assembled where it is needed, because it is the one meet whose
 * summary is a different *shape* rather than different figures -- no total, a lift
 * left outstanding, and the two lessons that only a lost lift produces -- and three
 * places now want it. Every other case in this file is one patched attempt, which
 * is cheap to write out beside the assertion it is about; this one is nine.
 */
export function bombedOnBench(view: PlannerView = plannedView()): ReturnType<typeof meetWith> {
  return walk([
    ...toPlan(view).filter((attempt) => attempt.lift !== 'bench'),
    ...[1, 2, 3].map((attemptNumber) => ({
      lift: 'bench' as const,
      kilograms: plannedKilograms(view, 'bench', attemptNumber),
      result: STRENGTH_MISS,
    })),
  ]);
}

/**
 * The weight on the highlighted card right now, which is what §26 recovers.
 *
 * The same call `summariseMeet` makes -- `liveChoicesFor` with a document, a lifter
 * and a lift, and nothing else -- rather than a reading through `buildLiveView`.
 * The two agree today, and a fixture routed through the view would start disagreeing
 * the moment live mode grew a planning input, silently, in the direction of a meet
 * nobody could have lifted.
 */
function pointedAtOn(timeline: ReturnType<typeof meetWith>, lift: PlatformLift): number {
  const lifter = timeline.present.lifters[0];
  if (lifter === undefined) throw new Error('fixture has no lifter');
  const offered = liveChoicesFor(RULES, { document: timeline.present, lifter, lift });
  const pointedAt = offered.choices.find((choice) => choice.highlighted);
  if (pointedAt === undefined) throw new Error(`nothing is highlighted on the ${lift}`);
  if (pointedAt.kilograms === null) throw new Error(`the tool points at a pass on the ${lift}`);
  return pointedAt.kilograms;
}

/**
 * A meet where every weight after an opener is the one the tool pointed at.
 *
 * Asked between attempts rather than listed, because the weight that follows the
 * advice is not knowable in advance -- it depends on how the attempt before it went,
 * which is the whole of §13. A hard-coded "followed the tool" list agrees with
 * today's branches and quietly stops agreeing the next time one of them moves, and
 * the test built on it would go on passing while asserting the opposite of its own
 * title.
 *
 * Openers come from the plan: §13 offers nothing before the first attempt of a lift,
 * so that is the one weight on this meet the lifter chose for themselves.
 */
export function followingTheTool(view: PlannerView = plannedView()): ReturnType<typeof meetWith> {
  let timeline = meetWith('full-power');
  let recorded = 0;
  for (const lift of LIFTS) {
    for (const attemptNumber of [1, 2, 3]) {
      const kilograms =
        attemptNumber === 1 ? plannedKilograms(view, lift, 1) : pointedAtOn(timeline, lift);
      timeline = take(timeline, lift, kilograms, GOOD, START + recorded * BETWEEN_ATTEMPTS_MS);
      recorded += 1;
    }
  }
  return timeline;
}

export function summaryOf(
  timeline: ReturnType<typeof meetWith>,
  patch: Partial<SummaryRequest> = {},
): MeetSummary {
  return summariseMeet({
    rules: RULES,
    chart: CHART,
    timeline,
    lifterId: onlyLifterIn(timeline),
    view: plannedView(),
    targets: [],
    equipment: 'raw',
    ...patch,
  });
}

/**
 * Two targets on either side of the day, at invented figures (§5.1).
 *
 * A hundred kilograms is under any total this file can produce and a thousand is
 * over every one of them, so the reached branch and the short branch are decided
 * by the fixture rather than by arithmetic that would have to be redone the day
 * the plan's percentages move.
 */
export const TARGETS: readonly LiveTarget[] = [
  { kind: 'minimum-acceptable', measure: 'total', kilograms: 100, label: 'the total you came for' },
  { kind: 'stretch', measure: 'total', kilograms: 1000, label: 'the total you hoped for' },
];

/**
 * One attempt's id, by position.
 *
 * Positional because the document creates all nine on `add-lifter` and never
 * renumbers them, so index 0 is the first squat and index 8 the last deadlift
 * whatever has been recorded since. This is the only way to reach `lights` and
 * `note`: `RecordedResult` has nowhere to put either, so both arrive through a
 * separate `annotate-attempt` action rather than through `take`.
 */
export function attemptIdAt(timeline: ReturnType<typeof meetWith>, index: number): string {
  const lifter = timeline.present.lifters[0];
  if (lifter === undefined) throw new Error('the fixture has no lifter');
  const attempt = lifter.attempts[index];
  if (attempt === undefined) throw new Error(`the fixture has no attempt ${String(index)}`);
  return attempt.id;
}

/**
 * A day with something in every section of §26, so the empty sentences have a
 * control to be measured against.
 *
 * The bomb-out is what puts a lesson on the page -- an ordinary day produces
 * none, by design -- and the note and the targets are the two remaining sections
 * that nothing about lifting fills in on its own.
 */
export function aFullPage(view: PlannerView = plannedView()): MeetSummary {
  const bombed = bombedOnBench(view);
  const noted = act(bombed, {
    kind: 'annotate-attempt',
    attemptId: attemptIdAt(bombed, 0),
    note: 'Belt was loose.',
  });
  return summaryOf(noted, { targets: TARGETS });
}
