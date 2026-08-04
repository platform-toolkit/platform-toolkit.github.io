// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §26's summary, as a value. The rendered element is `ptk-meet-summary.browser.test.ts`.
 *
 * Most of this module is projection, and projection is tested here only where
 * something is decided. What is genuinely this module's own, and therefore where
 * the tests are:
 *
 * - **The recommendation comparison is recovered from the history, not re-derived.**
 *   Asserted by walking a meet where the lifter took a weight the tool did not
 *   recommend and checking that the recovered figure is the one `liveChoicesFor`
 *   gave at that moment -- which is a *different* answer from what it gives now.
 *   If this file ever grew arithmetic of its own, that is what breaks.
 * - **What happens when the history runs out.** A gap code, never a silent absence.
 * - **The §9.4 entry.** Round-tripped through `calibrateFrom`, because an entry
 *   that is subtly wrong is invisible until somebody's calibration is wrong.
 * - **The lessons.** Each one asserted both ways -- the meet that produces it and
 *   the near-identical meet that does not -- since a lesson that always fires and
 *   a lesson that never fires both look like a working feature from one direction.
 *
 * No weight below is written out. The plan supplies them, so an assertion that
 * passed against a hard-coded increment fails against the fixture's half-kilogram
 * bar (§5.1).
 */
import { calibrateFrom, liveChoicesFor, type RecordedResult } from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { RULES, START, act, meetWith, onlyLifterIn, take } from './live-fixture.js';
import {
  BETWEEN_ATTEMPTS_MS,
  aGoodDay,
  bombedOnBench,
  followingTheTool,
  plannedKilograms,
  plannedView,
  summaryOf,
  toPlan,
  walk,
  type Attempted,
} from './summary-fixture.js';
import { EMPTY_SUMMARY, type MeetSummary, type SummaryAttempt } from './summary.js';

const VIEW = plannedView();
const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };
const FLEW: RecordedResult = { outcome: 'good', effort: 'flew' };
const PASSED: RecordedResult = { outcome: 'passed' };
const STRENGTH_MISS: RecordedResult = { outcome: 'no-lift', reason: 'strength' };
const COMMAND_MISS: RecordedResult = { outcome: 'no-lift', reason: 'command' };

function liftIn(summary: MeetSummary, lift: PlatformLift) {
  const found = summary.lifts.find((entry) => entry.lift === lift);
  if (found === undefined) throw new Error(`the summary has no ${lift}`);
  return found;
}

function attemptIn(summary: MeetSummary, lift: PlatformLift, number_: number): SummaryAttempt {
  const found = liftIn(summary, lift).attempts.find((entry) => entry.attemptNumber === number_);
  if (found === undefined) throw new Error(`no ${lift} attempt ${number_}`);
  return found;
}

/** One attempt's id, for a test that has to act on an attempt out of order. */
function attemptIdOn(
  timeline: ReturnType<typeof meetWith>,
  lift: PlatformLift,
  attemptNumber: number,
): string {
  const lifter = timeline.present.lifters[0];
  if (lifter === undefined) throw new Error('fixture has no lifter');
  const found = lifter.attempts.find(
    (attempt) => attempt.lift === lift && attempt.attemptNumber === attemptNumber,
  );
  if (found === undefined) throw new Error(`fixture has no ${lift} attempt ${attemptNumber}`);
  return found.id;
}

/** The plan, with one attempt's outcome or weight replaced. */
function planExcept(
  lift: PlatformLift,
  attemptNumber: number,
  patch: Partial<Attempted>,
): readonly Attempted[] {
  const planned = plannedKilograms(VIEW, lift, attemptNumber);
  return toPlan(VIEW).map((attempt) =>
    attempt.lift === lift && attempt.kilograms === planned ? { ...attempt, ...patch } : attempt,
  );
}

describe('summariseMeet -- the figures §26 asks for', () => {
  it('reports the successful total and the best lift on each lift', () => {
    const summary = summaryOf(aGoodDay());

    expect(summary.total.isTotal).toBe(true);
    expect(summary.total.kilograms).toBe(
      (['squat', 'bench', 'deadlift'] as const).reduce(
        (sum, lift) => sum + plannedKilograms(VIEW, lift, 3),
        0,
      ),
    );
    expect(liftIn(summary, 'squat').best?.kilograms).toBe(plannedKilograms(VIEW, 'squat', 3));
  });

  it('does not call a meet with a bombed lift a total, and says which lift is missing', () => {
    const bombed = bombedOnBench(VIEW);

    const summary = summaryOf(bombed);

    expect(summary.total.isTotal).toBe(false);
    expect(summary.total.liftsOutstanding).toEqual(['bench']);
    expect(liftIn(summary, 'bench').best).toBeNull();
    expect(liftIn(summary, 'bench')).toMatchObject({ taken: 3, made: 0 });
  });

  it('reports the jump into each attempt, measured from the weight before it', () => {
    const summary = summaryOf(aGoodDay());

    expect(attemptIn(summary, 'squat', 1).jumpKilograms).toBeNull();
    expect(attemptIn(summary, 'squat', 2).jumpKilograms).toBe(
      plannedKilograms(VIEW, 'squat', 2) - plannedKilograms(VIEW, 'squat', 1),
    );
  });

  it('reports no jump into a pass, and measures the attempt after it from the last one taken', () => {
    // A pass declares no weight the lifter took, so there is no jump into it and it
    // is not the floor the next jump is measured from. `meet-history.ts` applies the
    // same rule to a lifter's own history, and the two modules would disagree about
    // the same meet if either broke it -- one reading a third attempt as a small rise
    // off a passed second, the other as the large one the lifter actually made.
    const summary = summaryOf(walk(planExcept('squat', 2, { result: PASSED })));

    expect(attemptIn(summary, 'squat', 2).outcome).toBe('passed');
    expect(attemptIn(summary, 'squat', 2).jumpKilograms).toBeNull();
    expect(attemptIn(summary, 'squat', 3).jumpKilograms).toBe(
      plannedKilograms(VIEW, 'squat', 3) - plannedKilograms(VIEW, 'squat', 1),
    );
    // The control: the same third attempt on a meet where the second was taken is
    // measured from the second, so neither figure above is what this fixture would
    // report whatever the rule was.
    expect(attemptIn(summaryOf(aGoodDay()), 'squat', 3).jumpKilograms).toBe(
      plannedKilograms(VIEW, 'squat', 3) - plannedKilograms(VIEW, 'squat', 2),
    );
  });

  it('reports what was planned beside what was declared', () => {
    const heavier = plannedKilograms(VIEW, 'squat', 2) + 5;
    const summary = summaryOf(walk(planExcept('squat', 2, { kilograms: heavier })));

    expect(attemptIn(summary, 'squat', 2)).toMatchObject({
      plannedKilograms: plannedKilograms(VIEW, 'squat', 2),
      againstPlanKilograms: 5,
    });
    expect(attemptIn(summary, 'squat', 1).againstPlanKilograms).toBe(0);
  });

  it('carries the miss reason and the effort through rather than reducing them to a verdict', () => {
    const summary = summaryOf(walk(planExcept('bench', 3, { result: COMMAND_MISS })));

    expect(attemptIn(summary, 'bench', 3)).toMatchObject({
      outcome: 'no-lift',
      missReason: 'command',
      effort: null,
    });
    expect(attemptIn(summary, 'bench', 2)).toMatchObject({
      outcome: 'good',
      effort: 'solid',
      missReason: null,
    });
  });

  it('counts the lights that were entered and says how many attempts had none', () => {
    const walked = aGoodDay();
    const lifter = walked.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const first = lifter.attempts[0];
    if (first === undefined) throw new Error('fixture has no attempts');
    const lit = act(walked, {
      kind: 'annotate-attempt',
      attemptId: first.id,
      lights: ['white', 'white', 'red'],
    });

    const summary = summaryOf(lit);

    expect(summary.whiteLights).toBe(2);
    expect(summary.redLights).toBe(1);
    // Eight of the nine resolved attempts still carry nothing, and a lights count
    // read without that number reads as a meet with two white lights in it.
    expect(summary.attemptsWithoutLights).toBe(8);
  });

  it('collects the notes the lifter wrote, with the attempt each was on', () => {
    const walked = aGoodDay();
    const lifter = walked.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const second = lifter.attempts[1];
    if (second === undefined) throw new Error('fixture has no second attempt');
    const noted = act(walked, {
      kind: 'annotate-attempt',
      attemptId: second.id,
      note: 'Belt was loose.',
    });

    expect(summaryOf(noted).notes).toEqual([
      { lift: 'squat', attemptNumber: 2, note: 'Belt was loose.' },
    ]);
  });

  it('names the two sections it has no source for rather than leaving them out', () => {
    expect(summaryOf(aGoodDay()).omissions).toEqual(['personal-records', 'qualifying-standards']);
  });
});

describe('summariseMeet -- recommendation against choice', () => {
  it('recovers what the tool offered at the time, which is not what it offers now', () => {
    const heavier = plannedKilograms(VIEW, 'squat', 2) + 5;
    const timeline = walk(planExcept('squat', 2, { kilograms: heavier }));
    const summary = summaryOf(timeline);
    const recovered = attemptIn(summary, 'squat', 2).recommendation;

    // What the finished document would say if asked now: the squat is over, so
    // nothing is highlighted and there is no card at all. That is the wrong
    // answer, and it is the answer a re-derivation would give.
    const lifter = timeline.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const asked = liveChoicesFor(RULES, { document: timeline.present, lifter, lift: 'squat' });

    expect(asked.choices).toEqual([]);
    expect(asked.highlightedSlot).toBeNull();
    expect(recovered).not.toBeNull();
    expect(recovered?.kilograms).toEqual(expect.any(Number));
    expect(recovered?.followed).toBe(false);
    // And the slot it came back under is Secure, not Recommended. On this rule
    // book the minimum progression is small enough that §13's Recommended weight
    // and its Secure weight are the same figure after a solid opener, so
    // `collapseDuplicates` emits one card and carries the highlight onto it. A
    // summary that reported every recovered card as "Recommended" would be
    // inventing a heading the lifter was never shown.
    expect(recovered?.slot).toBe('secure');
  });

  it('does not call a weight unfollowed over floating-point noise', () => {
    // The two figures arrive by different routes -- one off §13's arithmetic, the
    // other off whatever was declared -- and `MeetRules` accepts a weight sitting
    // on the grid to within its own slack. So a declaration can differ from the
    // card it came from in the fourteenth place, and reporting that lifter as
    // having ignored the card they pressed is a wrong fact about their meet.
    let timeline = take(
      meetWith('full-power'),
      'squat',
      plannedKilograms(VIEW, 'squat', 1),
      GOOD,
      START,
    );
    const lifter = timeline.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const pointedAt = liveChoicesFor(RULES, {
      document: timeline.present,
      lifter,
      lift: 'squat',
    }).choices.find((choice) => choice.highlighted)?.kilograms;
    if (pointedAt === null || pointedAt === undefined) throw new Error('nothing was highlighted');

    timeline = take(timeline, 'squat', pointedAt + 1e-11, GOOD, START + BETWEEN_ATTEMPTS_MS);

    const recovered = attemptIn(summaryOf(timeline), 'squat', 2).recommendation;
    expect(recovered?.kilograms).not.toBe(pointedAt + 1e-11);
    expect(recovered?.followed).toBe(true);
  });

  it('recovers the choice offered when the weight was last set, not when it was first set', () => {
    // A planned meet reaches the platform with every attempt's weight already on the
    // board (`seedLiveMeet`), so an ordinary second attempt has *two* declarations
    // behind it: the one the plan wrote before anything had been lifted, and the one
    // the lifter made after their opener. §26's question is about the second -- the
    // first was not a decision taken at the platform.
    //
    // A history walked forwards answers with the first, and the failure is not a
    // missing card but a wrong one: `liveChoicesFor` on a document where nothing has
    // been recorded still points at something, so the summary would report a lifter
    // as having ignored advice they were never given.
    let timeline = act(meetWith('full-power'), {
      kind: 'set-attempt-weight',
      attemptId: attemptIdOn(meetWith('full-power'), 'squat', 2),
      kilograms: plannedKilograms(VIEW, 'squat', 2),
    });
    timeline = take(timeline, 'squat', plannedKilograms(VIEW, 'squat', 1), GOOD, START);

    const lifter = timeline.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const pointedAt = liveChoicesFor(RULES, {
      document: timeline.present,
      lifter,
      lift: 'squat',
    }).choices.find((choice) => choice.highlighted)?.kilograms;
    if (pointedAt === null || pointedAt === undefined) throw new Error('nothing was highlighted');

    // The control, and the document a forwards walk would read. Asserted to be a
    // different figure rather than written out: without this the test would pass
    // against either reading the day the two happened to agree.
    const fresh = meetWith('full-power');
    const freshLifter = fresh.present.lifters[0];
    if (freshLifter === undefined) throw new Error('fixture has no lifter');
    const beforeAnything = liveChoicesFor(RULES, {
      document: fresh.present,
      lifter: freshLifter,
      lift: 'squat',
    }).choices.find((choice) => choice.highlighted)?.kilograms;
    expect(beforeAnything).not.toBe(pointedAt);

    timeline = take(timeline, 'squat', pointedAt, GOOD, START + BETWEEN_ATTEMPTS_MS);

    expect(attemptIn(summaryOf(timeline), 'squat', 2)).toMatchObject({
      recommendation: { kilograms: pointedAt, followed: true },
      recommendationGap: null,
    });
  });

  it('says the recommendation was followed when the lifter took it', () => {
    // Every weight after the openers on this meet is the one that was highlighted
    // when it was declared, asked for at the time rather than listed -- see
    // `followingTheTool`. So each second and third has to come back followed.
    const summary = summaryOf(followingTheTool(VIEW));

    for (const lift of ['squat', 'bench', 'deadlift'] as const) {
      for (const attemptNumber of [2, 3]) {
        const recovered = attemptIn(summary, lift, attemptNumber).recommendation;
        expect(recovered?.followed, `${lift} ${attemptNumber}`).toBe(true);
        expect(recovered?.kilograms).toBe(
          attemptIn(summary, lift, attemptNumber).weight?.kilograms,
        );
      }
    }

    // The control, and the reason this needs its own fixture: walking the plan is
    // *not* following the tool. After a solid opener §13 offers the smallest legal
    // increase, which is nothing like the plan's jump -- so a version of this test
    // built on `toPlan` would be asserting the plan against itself.
    const toThePlan = summaryOf(walk(toPlan(VIEW)));
    expect(attemptIn(toThePlan, 'squat', 2).recommendation?.followed).toBe(false);
    expect(attemptIn(summary, 'squat', 2).weight?.kilograms).not.toBe(
      plannedKilograms(VIEW, 'squat', 2),
    );
  });

  it('reports a gap rather than nothing when the history has been trimmed', () => {
    let timeline = aGoodDay();
    const lifter = timeline.present.lifters[0];
    if (lifter === undefined) throw new Error('fixture has no lifter');
    const last = lifter.attempts.at(-1);
    if (last === undefined) throw new Error('fixture has no attempts');
    // Push every weight-setting step off the end of the undo history by annotating
    // one attempt over and over. Nothing about the meet changes; only the record
    // of how it was reached.
    for (let step = 0; step < 220; step += 1) {
      timeline = act(timeline, {
        kind: 'annotate-attempt',
        attemptId: last.id,
        note: `step ${step}`,
      });
    }

    const summary = summaryOf(timeline);

    expect(summary.historyTruncated).toBe(true);
    expect(attemptIn(summary, 'squat', 1)).toMatchObject({
      recommendation: null,
      recommendationGap: 'history-truncated',
    });
    // The figures that do not depend on the history survive it.
    expect(summary.total.isTotal).toBe(true);
  });

  it('does not claim truncation for an attempt that was never given a weight', () => {
    const summary = summaryOf(walk([{ lift: 'squat', kilograms: 100, result: GOOD }]));

    expect(attemptIn(summary, 'bench', 1)).toMatchObject({
      outcome: 'not-taken',
      weight: null,
      recommendationGap: 'no-choice-was-offered',
    });
    expect(summary.historyTruncated).toBe(false);
  });
});

describe('summariseMeet -- timing notes', () => {
  it('measures the gap between recorded results, in seconds', () => {
    const summary = summaryOf(aGoodDay());

    expect(summary.intervals).toHaveLength(9);
    expect(summary.intervals[0]).toMatchObject({
      lift: 'squat',
      attemptNumber: 1,
      sincePreviousSeconds: null,
    });
    expect(summary.intervals[1]?.sincePreviousSeconds).toBe(BETWEEN_ATTEMPTS_MS / 1000);
  });

  it('reads the recorded results and not the weight declarations', () => {
    // `take` stamps three actions at the same instant, two of which are not
    // results. Counting all of them would produce 27 intervals, most of them zero.
    const intervals = summaryOf(aGoodDay()).intervals;

    expect(intervals.every((interval) => interval.attemptNumber <= 3)).toBe(true);
    expect(intervals.filter((interval) => interval.sincePreviousSeconds === 0)).toEqual([]);
  });
});

describe('summariseMeet -- what it hands to §9.4', () => {
  it('produces a history entry that calibrates to the meet that was lifted', () => {
    const summary = summaryOf(aGoodDay());
    const report = calibrateFrom([summary.historyEntry, summary.historyEntry], {
      equipment: 'raw',
      combineEquipment: false,
    });

    expect(report.meetsRead).toBe(2);
    // The plan's two squat jumps are not equal, and two meets of it therefore
    // give four observations of two values -- so §9.4's median takes the lower
    // middle. Derived from the plan rather than written out, per the header:
    // the assertion has to say "the smaller of the plan's jumps", not "8".
    const squat = report.lifts.find((lift) => lift.lift === 'squat');
    const jumps = [2, 3].map(
      (attemptNumber) =>
        plannedKilograms(VIEW, 'squat', attemptNumber) -
        plannedKilograms(VIEW, 'squat', attemptNumber - 1),
    );
    expect(squat?.successfulJump.kilograms).toBe(Math.min(...jumps));
    expect(squat?.thirdAttempts).toMatchObject({ taken: 2, made: 2 });
  });

  it('files the meet under the equipment it was told, and under nothing by default', () => {
    expect(summaryOf(aGoodDay(), { equipment: 'wraps' }).historyEntry.equipment).toBe('wraps');
    expect(
      calibrateFrom([summaryOf(aGoodDay(), { equipment: 'wraps' }).historyEntry], {
        equipment: 'raw',
        combineEquipment: false,
      }).meetsRead,
    ).toBe(0);
  });

  it('carries the planned maximum through, so §9.4 can measure against it', () => {
    const entry = summaryOf(aGoodDay()).historyEntry;
    const squat = entry.lifts.find((lift) => lift.lift === 'squat');

    expect(squat?.plannedMaximumKilograms).toBe(
      VIEW.lifts.find((lift) => lift.lift === 'squat')?.maximumKilograms,
    );
  });
});

describe('summariseMeet -- lessons', () => {
  it('names a bomb-out, and does not name one on a meet with a total', () => {
    const bombed = bombedOnBench(VIEW);

    expect(summaryOf(bombed).lessons.map((lesson) => lesson.code)).toContain('bombed-out');
    expect(summaryOf(aGoodDay()).lessons.map((lesson) => lesson.code)).not.toContain('bombed-out');
  });

  it('names a missed opener and says which lift it was on', () => {
    const missed = walk(planExcept('deadlift', 1, { result: STRENGTH_MISS }));

    const lesson = summaryOf(missed).lessons.find((entry) => entry.code === 'opener-was-missed');

    expect(lesson?.lifts).toEqual(['deadlift']);
    expect(
      summaryOf(aGoodDay()).lessons.find((entry) => entry.code === 'opener-was-missed'),
    ).toBeUndefined();
  });

  it('names a meet where every third was missed, and not one where a single third was', () => {
    const allThirds = walk(
      toPlan(VIEW).map((attempt) =>
        attempt.kilograms === plannedKilograms(VIEW, attempt.lift, 3)
          ? { ...attempt, result: STRENGTH_MISS }
          : attempt,
      ),
    );
    const oneThird = walk(planExcept('squat', 3, { result: STRENGTH_MISS }));

    expect(summaryOf(allThirds).lessons.map((lesson) => lesson.code)).toContain(
      'every-third-was-missed',
    );
    expect(summaryOf(oneThird).lessons.map((lesson) => lesson.code)).not.toContain(
      'every-third-was-missed',
    );
  });

  it('names a meet where nothing was hard, from the effort the lifter recorded', () => {
    const easy = walk(toPlan(VIEW).map((attempt) => ({ ...attempt, result: FLEW })));

    expect(summaryOf(easy).lessons.map((lesson) => lesson.code)).toContain('nothing-was-hard');
    // One grind is enough for it not to have been an easy day, and the weights are
    // identical -- so this pair is the effort field doing the work and nothing else.
    const notQuite = walk(
      toPlan(VIEW).map((attempt, index) =>
        index === 0
          ? { ...attempt, result: { outcome: 'good' as const, effort: 'grind' as const } }
          : { ...attempt, result: FLEW },
      ),
    );
    expect(summaryOf(notQuite).lessons.map((lesson) => lesson.code)).not.toContain(
      'nothing-was-hard',
    );
  });

  it('separates a meet lost to commands from one lost to strength', () => {
    const technical = walk(planExcept('bench', 3, { result: COMMAND_MISS }));
    const strength = walk(planExcept('bench', 3, { result: STRENGTH_MISS }));

    expect(summaryOf(technical).lessons.map((lesson) => lesson.code)).toContain(
      'misses-were-technical',
    );
    expect(summaryOf(strength).lessons.map((lesson) => lesson.code)).toContain(
      'misses-were-strength',
    );
    // The distinction is the point, so neither may carry the other's code.
    expect(summaryOf(technical).lessons.map((lesson) => lesson.code)).not.toContain(
      'misses-were-strength',
    );
  });

  it('says nothing about the misses when they came from more than one cause', () => {
    const mixed = walk([
      ...planExcept('bench', 3, { result: COMMAND_MISS }).filter(
        (attempt) => attempt.lift !== 'deadlift',
      ),
      ...[1, 2, 3].map((number_) => ({
        lift: 'deadlift' as const,
        kilograms: plannedKilograms(VIEW, 'deadlift', number_),
        result: number_ === 3 ? STRENGTH_MISS : GOOD,
      })),
    ]);

    const codes = summaryOf(mixed).lessons.map((lesson) => lesson.code);

    expect(codes).not.toContain('misses-were-technical');
    expect(codes).not.toContain('misses-were-strength');
  });

  it('names a meet the lifter took above the plan, and not one taken to it', () => {
    const above = walk(
      toPlan(VIEW).map((attempt) =>
        attempt.kilograms >= plannedKilograms(VIEW, attempt.lift, 2)
          ? { ...attempt, kilograms: attempt.kilograms + 5 }
          : attempt,
      ),
    );

    const lesson = summaryOf(above).lessons.find((entry) => entry.code === 'went-above-the-plan');

    expect(lesson?.attempts).toBe(6);
    expect(
      summaryOf(aGoodDay()).lessons.find((entry) => entry.code === 'went-above-the-plan'),
    ).toBeUndefined();
  });

  it('has nothing to say about a meet nobody lifted in', () => {
    expect(summaryOf(meetWith('full-power')).lessons).toEqual([]);
  });
});

describe('summariseMeet -- the shape of the answer', () => {
  it('reads a lifter who is not in the document as a wiring mistake, not a state', () => {
    expect(summariseFor('nobody')).toEqual(EMPTY_SUMMARY);
  });

  it('carries the lifter name and the format from the document', () => {
    const summary = summaryOf(aGoodDay());

    expect(summary.format).toBe('full-power');
    expect(summary.lifterName).not.toBe('');
    expect(summary.lifts.map((lift) => lift.lift)).toEqual(['squat', 'bench', 'deadlift']);
  });

  it('offers an empty summary that claims nothing', () => {
    expect(EMPTY_SUMMARY.total.isTotal).toBe(false);
    expect(EMPTY_SUMMARY.lessons).toEqual([]);
    expect(EMPTY_SUMMARY.omissions).toHaveLength(2);
  });
});

function summariseFor(lifterId: string): MeetSummary {
  return summaryOf(aGoodDay(), { lifterId });
}

describe('summariseMeet -- the fixture itself', () => {
  it('walks a meet whose history holds the steps this module reads', () => {
    // If `take` ever stopped going through `applyMeetAction`, every recommendation
    // above would come back as a gap and the suite would still pass on the codes.
    const timeline = take(meetWith('full-power'), 'squat', 100, GOOD, START);

    expect(timeline.past.some((step) => step.action.kind === 'set-attempt-weight')).toBe(true);
    expect(onlyLifterIn(timeline)).not.toBe('');
  });
});
