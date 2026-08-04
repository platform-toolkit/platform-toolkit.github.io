// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21.2's seven warnings, and the two things that are easy to get wrong.
 *
 * The first is that a warning has to be about something that is *due*. Two
 * schedules that both contain knee wraps will always both contain knee wraps,
 * and a module that read them as a clash would put a permanent red mark against
 * every equipped lifter in the session. Several tests below exist only to hold
 * that line: the same pair of entries, moved further apart in time, has to stop
 * warning.
 *
 * The second is the suggested priority. §21.2 asks for one, and the honest
 * answer is sometimes that there is nothing to choose between two lifters. The
 * tests pin `either-order` where that is true, because a reason code that
 * quietly became "whoever was added to the meet first" would read as advice.
 *
 * The meet, the instants and the schedules come from `coach-board.fixture.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  COACH_BOARD_CONFLICTS,
  DEFAULT_HANDOVER_SECONDS,
  coachBoardConflicts,
  type CoachBoardConflict,
  type CoachBoardConflictCode,
  type CoachBoardConflicts,
  type ProposedAttemptChange,
} from './coach-board-conflicts.js';
import type { CoachBoardEntry } from './coach-board.js';
import {
  AT,
  RULES,
  WARM_UP_SETS,
  declare,
  equipmentAt,
  finalWarmupAt,
  firstWarmupAt,
  item,
  lifterId,
  meetWith,
  minutes,
  rampKilogramsAt,
  submit,
  take,
  timelineOf,
} from './coach-board.fixture.js';
import { createMeetDocument, type MeetDocument } from './meet-document.js';

function found(
  document: MeetDocument,
  entries: readonly CoachBoardEntry[] = [],
  now = AT,
): CoachBoardConflicts {
  return coachBoardConflicts({ rules: RULES, document, entries, now });
}

function codes(result: CoachBoardConflicts): readonly CoachBoardConflictCode[] {
  return result.conflicts.map((conflict) => conflict.code);
}

function only(result: CoachBoardConflicts, code: CoachBoardConflictCode): CoachBoardConflict {
  const matches = result.conflicts.filter((conflict) => conflict.code === code);
  if (matches.length !== 1) {
    throw new Error(`expected one ${code}, found ${String(matches.length)}`);
  }
  const first = matches[0];
  if (first === undefined) throw new Error('unreachable');
  return first;
}

/** A second warm-up set of the fixture ramp, which is a different weight. */
function secondWarmupAt(startsInMinutes: number) {
  return item('warm-up-set', startsInMinutes, { warmupIndex: 1 });
}

// -----------------------------------------------------------------------------

describe('two declaration clocks', () => {
  it('warns when neither errand can be run before the other expires', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(
      timeline,
      1,
      'squat',
      1,
      150,
      { outcome: 'good', effort: 'solid' },
      AT + 20_000,
    );
    const document = timeline.present;

    const conflict = only(found(document, [], AT + 20_000), 'submission-deadlines-overlap');

    // Ama is twenty seconds ahead of Bo and a walk to the table is thirty.
    expect(conflict.separationSeconds).toBe(20);
    expect(conflict.lifterIds).toEqual([lifterId(document, 0), lifterId(document, 1)]);
    expect(conflict.priority).toEqual({
      lifterId: lifterId(document, 0),
      reason: 'sooner-deadline',
    });
  });

  it('says nothing when there is time to answer one and get to the other', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(
      timeline,
      1,
      'squat',
      1,
      150,
      { outcome: 'good', effort: 'solid' },
      AT + 60_000,
    );

    expect(codes(found(timeline.present, [], AT + 60_000))).toEqual([]);
  });

  it('offers no order when both clocks run out together', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(timeline, 1, 'squat', 1, 150);
    const document = timeline.present;

    const conflict = only(found(document), 'submission-deadlines-overlap');

    expect(conflict.separationSeconds).toBe(0);
    expect(conflict.priority.reason).toBe('either-order');
  });

  it('drops a clock that has already lapsed', () => {
    // Nothing can be done at the table for a lapsed clock -- the automatic weight
    // stands (§13) -- so hurrying a coach towards one would put the loudest thing
    // on the board against the one lifter nobody can help.
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(
      timeline,
      1,
      'squat',
      1,
      150,
      { outcome: 'good', effort: 'solid' },
      AT + 10_000,
    );
    const document = timeline.present;

    // Ama's clock ran out five seconds ago and Bo has five left: without the
    // lapsed check the gap between them would read as zero and warn.
    expect(codes(found(document, [], AT + 95_000))).toEqual([]);
  });

  it('drops a clock whose card is already at the table', () => {
    // Handing the card in does not stop the countdown -- it runs until the
    // officials judge the attempt -- so a lifter who has declared still looks,
    // from the clock alone, exactly like one who has not. Sending a coach to a
    // table twice would cost the errand they were actually needed for.
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(timeline, 1, 'squat', 1, 150);
    timeline = submit(timeline, 0, 'squat', 2, 160);

    expect(codes(found(timeline.present))).toEqual([]);
  });

  it('takes the handover figure from the caller', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(
      timeline,
      1,
      'squat',
      1,
      150,
      { outcome: 'good', effort: 'solid' },
      AT + 60_000,
    );
    const document = timeline.present;
    const at = AT + 60_000;

    expect(codes(found(document, [], at))).toEqual([]);
    expect(
      codes(coachBoardConflicts({ rules: RULES, document, now: at, handoverSeconds: minutes(2) })),
    ).toEqual(['submission-deadlines-overlap']);
  });

  it('walks to the table in half a minute unless told otherwise', () => {
    expect(DEFAULT_HANDOVER_SECONDS).toBe(30);
  });
});

describe('two lifters at the platform', () => {
  it('warns when both have been called, and ranks by how far along they are', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), platformCall: 'on-deck' },
        { lifterId: lifterId(document, 1), platformCall: 'called' },
      ]),
      'called-at-the-same-time',
    );

    expect(conflict.priority).toEqual({
      lifterId: lifterId(document, 1),
      reason: 'already-called',
    });
    // No gap: this tool is not watching the flight closely enough to say how many
    // seconds sit between on deck and called.
    expect(conflict.separationSeconds).toBeNull();
  });

  it('offers no order when both are at the same point in the queue', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), platformCall: 'in-the-hole' },
        { lifterId: lifterId(document, 1), platformCall: 'in-the-hole' },
      ]),
      'called-at-the-same-time',
    );

    expect(conflict.priority.reason).toBe('either-order');
  });

  it('prefers an announcement over an estimate', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([item('platform', 2)]) },
        { lifterId: lifterId(document, 1), platformCall: 'called' },
      ]),
      'called-at-the-same-time',
    );

    expect(conflict.priority).toEqual({
      lifterId: lifterId(document, 1),
      reason: 'already-called',
    });
    expect(conflict.separationSeconds).toBe(120);
  });

  it('warns on two estimates that land together, and ranks by the earlier one', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([item('platform', 2)]) },
        { lifterId: lifterId(document, 1), warmup: timelineOf([item('platform', 0)]) },
      ]),
      'called-at-the-same-time',
    );

    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 1), reason: 'needed-sooner' });
    expect(conflict.separationSeconds).toBe(120);
  });

  it('says nothing about a flight that is nowhere near', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([item('platform', 0)]) },
          { lifterId: lifterId(document, 1), warmup: timelineOf([item('platform', 20)]) },
        ]),
      ),
    ).toEqual([]);
  });

  it('reports the gap as smaller than it is rather than larger', () => {
    // Two minutes less four tenths of a second. Rounding to the nearest second
    // would report 120 and hand a coach four tenths that have already gone;
    // §5.5 says the rounding goes the safe way.
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([item('platform', 0)]) },
        { lifterId: lifterId(document, 1), warmup: timelineOf([item('platform', 2)], AT - 400) },
      ]),
      'called-at-the-same-time',
    );

    expect(conflict.separationSeconds).toBe(119);
  });
});

describe('one handler, two lifters', () => {
  const RAE_SUBMITS = { name: 'Rae', responsibilities: ['attempt-submission'] } as const;
  const RAE_WRAPS = { name: 'Rae', responsibilities: ['wrapping-or-equipment'] } as const;

  function withRae() {
    const timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    return timeline.present;
  }

  it('warns when the same person is wanted for two errands at once', () => {
    const document = withRae();

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), handlers: [RAE_SUBMITS] },
        {
          lifterId: lifterId(document, 1),
          handlers: [RAE_WRAPS],
          warmup: timelineOf([equipmentAt(2)]),
        },
      ]),
      'handler-in-two-places',
    );

    expect(conflict.handlerName).toBe('Rae');
    expect(conflict.separationSeconds).toBe(120);
    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 0), reason: 'needed-sooner' });
  });

  it('matches a name without regard to case', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), handlers: [RAE_SUBMITS] },
          {
            lifterId: lifterId(document, 1),
            handlers: [{ name: '  rae ', responsibilities: ['wrapping-or-equipment'] }],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual(['handler-in-two-places']);
  });

  it('says nothing about two different people', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), handlers: [RAE_SUBMITS] },
          {
            lifterId: lifterId(document, 1),
            handlers: [{ name: 'Sam', responsibilities: ['wrapping-or-equipment'] }],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('says nothing when the shared responsibility is not on a clock', () => {
    // A reminder given ten minutes late is a reminder given. Filming two lifters
    // in the same minute is a problem for the footage and not for the meet, and a
    // warning here would compete with the ones that are about a deadline.
    const document = withRae();

    expect(
      codes(
        found(document, [
          {
            lifterId: lifterId(document, 0),
            handlers: [{ name: 'Rae', responsibilities: ['video'] }],
          },
          {
            lifterId: lifterId(document, 1),
            handlers: [{ name: 'Rae', responsibilities: ['video', 'food-or-hydration'] }],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('treats a general responsibility as covering whatever comes up', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          {
            lifterId: lifterId(document, 0),
            handlers: [{ name: 'Rae', responsibilities: ['general'] }],
          },
          {
            lifterId: lifterId(document, 1),
            handlers: [{ name: 'Rae', responsibilities: ['general'] }],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual(['handler-in-two-places']);
  });

  it('matches the person who loads bars against a bar that needs loading', () => {
    // The errand a scheduled item asks for is decided by the kind of item it is,
    // and a warm-up set asks for somebody to load a bar. Reading it as any other
    // errand would let a coach list one person on the bars and another on the
    // floor and be told nothing when the bars person is wanted at two of them.
    const document = meetWith(['Ama', 'Bo']).present;
    const loader = { name: 'Rae', responsibilities: ['warm-up-loading'] } as const;

    const conflict = only(
      found(document, [
        {
          lifterId: lifterId(document, 0),
          handlers: [loader],
          warmup: timelineOf([firstWarmupAt(1)]),
        },
        {
          lifterId: lifterId(document, 1),
          handlers: [loader],
          warmup: timelineOf([firstWarmupAt(2)]),
        },
      ]),
      'handler-in-two-places',
    );

    expect(conflict.separationSeconds).toBe(60);
    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 0), reason: 'needed-sooner' });
  });

  it('says nothing when one of the two errands is not due', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), handlers: [RAE_SUBMITS] },
          {
            lifterId: lifterId(document, 1),
            handlers: [RAE_WRAPS],
            warmup: timelineOf([equipmentAt(40)]),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('ignores a handler with no name', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          {
            lifterId: lifterId(document, 0),
            handlers: [{ name: '  ', responsibilities: ['general'] }],
          },
          {
            lifterId: lifterId(document, 1),
            handlers: [{ name: '', responsibilities: ['general'] }],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('reports the tightest of the errands this person could be wanted for', () => {
    // Ama needs Rae twice: at the table now, and at the bar in two and a half
    // minutes. Bo needs Rae for wraps in two. The warning is about the half
    // minute between the bar and the wraps, not the two minutes between the
    // table and the wraps -- reporting the roomier of the two would describe a
    // clash the coach has time for and hide the one they do not, and it would
    // name the wrong lifter to see to first into the bargain.
    const document = withRae();

    const conflict = only(
      found(document, [
        {
          lifterId: lifterId(document, 0),
          handlers: [{ name: 'Rae', responsibilities: ['general'] }],
          warmup: timelineOf([firstWarmupAt(2.5)]),
        },
        {
          lifterId: lifterId(document, 1),
          handlers: [{ name: 'Rae', responsibilities: ['general'] }],
          warmup: timelineOf([equipmentAt(2)]),
        },
      ]),
      'handler-in-two-places',
    );

    expect(conflict.separationSeconds).toBe(30);
    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 1), reason: 'needed-sooner' });
  });

  it('warns once about a person somebody typed in twice', () => {
    const document = withRae();

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), handlers: [RAE_SUBMITS, RAE_WRAPS] },
          {
            lifterId: lifterId(document, 1),
            handlers: [RAE_WRAPS],
            warmup: timelineOf([equipmentAt(2)]),
          },
        ]),
      ),
    ).toEqual(['handler-in-two-places']);
  });
});

describe('two lifters in kit', () => {
  it('warns when both need a hand at the same moment', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(2)]) },
        { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(0)]) },
      ]),
      'wrapping-at-the-same-time',
    );

    expect(conflict.separationSeconds).toBe(120);
    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 1), reason: 'needed-sooner' });
  });

  it('says nothing about wraps that are an hour away', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(60)]) },
          { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(61)]) },
        ]),
      ),
    ).toEqual([]);
  });

  it('says nothing about wraps that went on ten minutes ago', () => {
    // A schedule is counted from the instant it was built and nothing rewrites
    // it as the session runs, so ten minutes later every item in it is still
    // there. Read without ageing them off, a pair of wraps that both happened
    // before the coach opened the screen reads as a pair of wraps happening
    // now -- and it never stops reading that way, because the item never moves.
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(
          document,
          [
            { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(2)]) },
            { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(0)]) },
          ],
          AT + minutes(10) * 1000,
        ),
      ),
    ).toEqual([]);
  });
});

describe('one bar', () => {
  function sharing(a: CoachBoardEntry, b: CoachBoardEntry): readonly CoachBoardEntry[] {
    return [
      { ...a, rackId: 'bar-1' },
      { ...b, rackId: 'bar-1' },
    ];
  }

  it('warns when two lifters want the same bar at different weights', () => {
    const document = meetWith(['Ama', 'Bo']).present;
    expect(rampKilogramsAt(0)).not.toBe(rampKilogramsAt(1));

    const conflict = only(
      found(
        document,
        sharing(
          { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) },
          { lifterId: lifterId(document, 1), warmup: timelineOf([secondWarmupAt(1)]) },
        ),
      ),
      'shared-rack-loading-clash',
    );

    expect(conflict.separationSeconds).toBe(60);
    // Neither is due out, so §21.4's sequencing is the answer and this warning
    // does not pretend to have one.
    expect(conflict.priority.reason).toBe('either-order');
  });

  it('gives the bar to whoever is on the platform first', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(
        document,
        sharing(
          {
            lifterId: lifterId(document, 0),
            warmup: timelineOf([firstWarmupAt(0), item('platform', 30)]),
          },
          {
            lifterId: lifterId(document, 1),
            warmup: timelineOf([secondWarmupAt(1), item('platform', 20)]),
          },
        ),
      ),
      'shared-rack-loading-clash',
    );

    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 1), reason: 'needed-sooner' });
  });

  it('says nothing when the two want the same weight', () => {
    // Two lifters taking the same single off the same bar is the arrangement
    // working. §21.4's whole point is that plates only move when weights differ.
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(
          document,
          sharing(
            { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) },
            { lifterId: lifterId(document, 1), warmup: timelineOf([firstWarmupAt(1)]) },
          ),
        ),
      ),
    ).toEqual([]);
  });

  it('says nothing about two lifters on two bars', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(document, [
          {
            lifterId: lifterId(document, 0),
            rackId: 'bar-1',
            warmup: timelineOf([firstWarmupAt(0)]),
          },
          {
            lifterId: lifterId(document, 1),
            rackId: 'bar-2',
            warmup: timelineOf([secondWarmupAt(1)]),
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('says nothing when nobody said which bar anyone is on', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) },
          {
            lifterId: lifterId(document, 1),
            rackId: '  ',
            warmup: timelineOf([secondWarmupAt(1)]),
          },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("a last single during another lifter's attempt", () => {
  it('warns, and gives the platform the priority', () => {
    // The attempt happens when the expeditor says it happens. The single can be
    // taken a minute later at the cost of a minute.
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([finalWarmupAt(1)]) },
        { lifterId: lifterId(document, 1), platformCall: 'called' },
      ]),
      'warm-up-during-another-attempt',
    );

    expect(conflict.priority).toEqual({
      lifterId: lifterId(document, 1),
      reason: 'fixed-versus-movable',
    });
    expect(conflict.separationSeconds).toBe(60);
  });

  it('names the pair in the meet order whichever way round it was found', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const conflict = only(
      found(document, [
        { lifterId: lifterId(document, 0), platformCall: 'called' },
        { lifterId: lifterId(document, 1), warmup: timelineOf([finalWarmupAt(1)]) },
      ]),
      'warm-up-during-another-attempt',
    );

    expect(conflict.lifterIds).toEqual([lifterId(document, 0), lifterId(document, 1)]);
    expect(conflict.priority.lifterId).toBe(lifterId(document, 0));
  });

  it('says nothing about wraps that happen to point at the last warm-up', () => {
    // This is the one place that asks a due window whether it is the final
    // warm-up without first asking what kind of thing it is, so it is the one
    // place where an item of another kind carrying a `warmupIndex` could be
    // mistaken for a single. `ScheduledItem` says the index belongs to a warm-up
    // set and to nothing else, but it is a plain number on a plain interface and
    // this module does not build the schedules it reads. Putting wraps on while
    // somebody else is called is not a clash: the wraps can go on in the corner.
    const document = meetWith(['Ama', 'Bo']).present;
    const wraps = item('equipment', 1, {
      equipmentId: 'knee-wraps',
      warmupIndex: WARM_UP_SETS - 1,
    });

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([wraps]) },
          { lifterId: lifterId(document, 1), platformCall: 'called' },
        ]),
      ),
    ).toEqual([]);
  });

  it('says nothing about an earlier warm-up', () => {
    // §21.2 names the final warm-up, and it means it: an early ramp set can be
    // taken whenever, and warning about every one of them would bury the single
    // that actually cannot move.
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(1)]) },
          { lifterId: lifterId(document, 1), platformCall: 'called' },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('a weight nobody has entered', () => {
  function roundOfThree(): MeetDocument {
    let timeline = meetWith(['Ama', 'Bo', 'Cy']);
    timeline = declare(timeline, 0, 'squat', 1, 100);
    timeline = declare(timeline, 1, 'squat', 1, 150);
    timeline = declare(timeline, 2, 'squat', 1, 200);
    return timeline.present;
  }

  function asking(document: MeetDocument, change: ProposedAttemptChange): CoachBoardConflicts {
    return coachBoardConflicts({ rules: RULES, document, now: AT, proposedChange: change });
  }

  it('warns when the weight would move the lifter down the running order', () => {
    const document = roundOfThree();

    const conflict = only(
      asking(document, {
        lifterId: lifterId(document, 0),
        lift: 'squat',
        attemptNumber: 1,
        kilograms: 180,
      }),
      'change-moves-the-order',
    );

    // Ama passes Bo and now lifts second. Cy, at 200, never moves.
    expect(conflict.lifterIds).toEqual([lifterId(document, 0), lifterId(document, 1)]);
    expect(conflict.priority).toEqual({ lifterId: lifterId(document, 1), reason: 'needed-sooner' });
    expect(conflict.separationSeconds).toBeNull();
  });

  it('says nothing when the lifter keeps their place', () => {
    const document = roundOfThree();

    expect(
      codes(
        asking(document, {
          lifterId: lifterId(document, 0),
          lift: 'squat',
          attemptNumber: 1,
          kilograms: 120,
        }),
      ),
    ).toEqual([]);
  });

  it('puts a cleared declaration at the back rather than the front', () => {
    // An undeclared weight is not a light attempt, it is an attempt with no place
    // in the order. Sorting it first would have the tool announce Ama as opening
    // the round on the strength of a blank field.
    const document = roundOfThree();

    const conflict = only(
      asking(document, {
        lifterId: lifterId(document, 0),
        lift: 'squat',
        attemptNumber: 1,
        kilograms: null,
      }),
      'change-moves-the-order',
    );

    expect(conflict.lifterIds).toEqual([
      lifterId(document, 0),
      lifterId(document, 1),
      lifterId(document, 2),
    ]);
    expect(conflict.priority.lifterId).toBe(lifterId(document, 1));
  });

  it('leaves a round alone when nobody asked about one', () => {
    expect(codes(found(roundOfThree()))).toEqual([]);
  });

  it('ignores a round the lifter has already taken', () => {
    let timeline = meetWith(['Ama', 'Bo']);
    timeline = take(timeline, 0, 'squat', 1, 150);
    timeline = declare(timeline, 1, 'squat', 1, 100);
    const document = timeline.present;

    expect(
      codes(
        asking(document, {
          lifterId: lifterId(document, 0),
          lift: 'squat',
          attemptNumber: 1,
          kilograms: 300,
        }),
      ).filter((code) => code === 'change-moves-the-order'),
    ).toEqual([]);
  });
});

describe('the list itself', () => {
  it('lists the seven warnings once each, most pressing first', () => {
    expect(COACH_BOARD_CONFLICTS).toEqual([
      'submission-deadlines-overlap',
      'called-at-the-same-time',
      'handler-in-two-places',
      'wrapping-at-the-same-time',
      'shared-rack-loading-clash',
      'warm-up-during-another-attempt',
      'change-moves-the-order',
    ]);
    expect(new Set(COACH_BOARD_CONFLICTS).size).toBe(COACH_BOARD_CONFLICTS.length);
  });

  it('puts the kinds in the order §21.2 lists them', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    timeline = take(timeline, 1, 'squat', 1, 150);
    const document = timeline.present;

    const result = found(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(0)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(0)]) },
    ]);

    expect(codes(result)).toEqual(['submission-deadlines-overlap', 'wrapping-at-the-same-time']);
  });

  it('puts the tighter of two warnings of a kind first', () => {
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    const result = found(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(0)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(2)]) },
      { lifterId: lifterId(document, 2), warmup: timelineOf([equipmentAt(1)]) },
    ]);

    expect(result.conflicts.map((conflict) => conflict.separationSeconds)).toEqual([60, 60, 120]);
  });

  it('puts a warning with no gap to measure ahead of one with a gap', () => {
    // The opposite of the board's rule, on purpose. There `null` seconds means
    // nothing about the lifter is timed, which is the least urgent thing there
    // is; here it means the two demands are simultaneous, which is the most.
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    const result = found(document, [
      { lifterId: lifterId(document, 0), platformCall: 'called' },
      { lifterId: lifterId(document, 1), platformCall: 'called' },
      { lifterId: lifterId(document, 2), warmup: timelineOf([item('platform', 2)]) },
    ]);

    expect(codes(result)).toEqual([
      'called-at-the-same-time',
      'called-at-the-same-time',
      'called-at-the-same-time',
    ]);
    expect(result.conflicts.map((conflict) => conflict.separationSeconds)).toEqual([
      null,
      120,
      120,
    ]);
  });

  it('files a warning under every lifter it names', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = found(document, [
      { lifterId: lifterId(document, 0), platformCall: 'called' },
      { lifterId: lifterId(document, 1), platformCall: 'called' },
    ]);

    const conflict = only(result, 'called-at-the-same-time');
    expect(result.byLifter.get(lifterId(document, 0))).toEqual([conflict]);
    expect(result.byLifter.get(lifterId(document, 1))).toEqual([conflict]);
  });

  it('raises nothing about a lifter who has finished', () => {
    // Nothing clears an entry when the last attempt is judged, so both schedules
    // still say wraps are due now. One of the two lifters went home an hour ago.
    let timeline = meetWith(['Ama', 'Bo'], 'bench-only');
    for (const number of [1, 2, 3]) {
      timeline = take(timeline, 0, 'bench', number, 100 + number * 10);
    }
    const document = timeline.present;

    expect(
      codes(
        found(document, [
          { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(0)]) },
          { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(0)]) },
        ]),
      ),
    ).toEqual([]);
  });

  it('takes the proximity figure from the caller', () => {
    const document = meetWith(['Ama', 'Bo']).present;
    const entries = [
      { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(10)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(11)]) },
    ];

    expect(codes(found(document, entries))).toEqual([]);
    expect(
      codes(
        coachBoardConflicts({
          rules: RULES,
          document,
          entries,
          now: AT,
          proximitySeconds: minutes(15),
        }),
      ),
    ).toEqual(['wrapping-at-the-same-time']);
  });

  it('reads a nonsense head start as no head start', () => {
    // A negative figure would otherwise invert the test: "due" would come to mean
    // "started more than a minute ago", and the two lifters below -- both wanted
    // for wraps this second -- would produce silence. Silence is the one answer a
    // caller cannot tell apart from a session with nothing wrong in it.
    const document = meetWith(['Ama', 'Bo']).present;

    expect(
      codes(
        coachBoardConflicts({
          rules: RULES,
          document,
          entries: [
            { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(0)]) },
            { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(0)]) },
          ],
          now: AT,
          proximitySeconds: -60,
        }),
      ),
    ).toEqual(['wrapping-at-the-same-time']);
  });

  it('answers for a meet with nobody in it', () => {
    const result = found(createMeetDocument(RULES, 'full-power'));

    expect(result.conflicts).toEqual([]);
    expect(result.byLifter.size).toBe(0);
  });

  it('ignores an entry for somebody who is not in the meet', () => {
    const document = meetWith(['Ama']).present;

    expect(codes(found(document, [{ lifterId: 'lifter-99', platformCall: 'called' }]))).toEqual([]);
  });
});
