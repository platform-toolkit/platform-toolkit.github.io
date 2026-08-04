// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The coach board, and the one thing it is easy to get wrong.
 *
 * §21's seven levels are a list of kinds, and a board that ranked by kind alone
 * would put every lifter in the session at level three all day -- everybody has
 * equipment prep somewhere ahead of them. So the tests that matter most here are
 * the ones that pin *due* against *exists*: a final warm-up forty minutes out
 * must sit below a first warm-up that is due now, even though the ladder lists
 * final warm-ups higher.
 *
 * The meet, the instants and the schedules come from `coach-board.fixture.ts`,
 * shared with the conflict tests: the warm-up schedules there are hand-built
 * from a real ramp rather than produced by `meetWarmup`, so that a change to the
 * ramp spacing cannot move a figure in a file that has nothing to say about
 * ramps.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ATTENTION_LEAD_SECONDS,
  URGENCY_LADDER,
  coachBoard,
  type CoachBoard,
  type CoachBoardEntry,
  type CoachBoardRow,
} from './coach-board.js';
import {
  AT,
  RULES,
  apply,
  attemptId,
  equipmentAt,
  finalWarmupAt,
  firstWarmupAt,
  item,
  lifterId,
  meetWith,
  minutes,
  take,
  timelineOf,
} from './coach-board.fixture.js';
import { createMeetDocument, type MeetDocument } from './meet-document.js';

// -----------------------------------------------------------------------------
// The board
// -----------------------------------------------------------------------------

function board(
  document: MeetDocument,
  entries: readonly CoachBoardEntry[] = [],
  now = AT,
): CoachBoard {
  return coachBoard({ rules: RULES, document, entries, now });
}

function names(result: CoachBoard): readonly string[] {
  return result.rows.map((row) => row.name);
}

function rowFor(result: CoachBoard, name: string): CoachBoardRow {
  const row = result.rows.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

// -----------------------------------------------------------------------------

describe('the urgency ladder', () => {
  it('puts a running declaration clock above a lifter who has been called', () => {
    // The clock is the only deadline in this tool that a rulebook enforces; a
    // call is an announcement about a bar somebody else is loading.
    const timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    const document = timeline.present;

    const result = board(document, [{ lifterId: lifterId(document, 1), platformCall: 'called' }]);

    expect(names(result)).toEqual(['Ama', 'Bo']);
    expect(rowFor(result, 'Ama').urgency).toBe('submission-deadline');
    expect(rowFor(result, 'Bo').urgency).toBe('called-or-on-deck');
  });

  it('puts equipment that is due above a final warm-up that is due', () => {
    const timeline = meetWith(['Ama', 'Bo']);
    const document = timeline.present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([finalWarmupAt(1)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([equipmentAt(2)]) },
    ]);

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Bo').urgency).toBe('equipment-or-wrapping');
    expect(rowFor(result, 'Ama').urgency).toBe('final-warm-up');
  });

  it('puts a final warm-up that is due above an earlier warm-up that is due', () => {
    const timeline = meetWith(['Ama', 'Bo']);
    const document = timeline.present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(1)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([finalWarmupAt(2)]) },
    ]);

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Bo').urgency).toBe('final-warm-up');
    expect(rowFor(result, 'Ama').urgency).toBe('other-warm-ups');
  });

  it('does not let a kind that is not due climb the ladder', () => {
    // The case the whole design turns on: ranking by kind alone would put Bo
    // first, because §21 lists final warm-ups above other warm-ups -- and Bo has
    // forty minutes to stand about while Ama's bar needs loading now.
    const timeline = meetWith(['Ama', 'Bo']);
    const document = timeline.present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([finalWarmupAt(40)]) },
    ]);

    expect(names(result)).toEqual(['Ama', 'Bo']);
    expect(rowFor(result, 'Ama').urgency).toBe('other-warm-ups');
    expect(rowFor(result, 'Bo').urgency).toBe('upcoming-flight');
  });

  it('takes the clock off the top of the board once the weight is with the table', () => {
    let timeline = take(meetWith(['Ama', 'Bo']), 0, 'squat', 1, 150);
    const second = attemptId(timeline.present, 0, 'squat', 2);
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId: second, kilograms: 160 });
    timeline = apply(timeline, { kind: 'advance-attempt', attemptId: second, to: 'submitted' });
    const document = timeline.present;

    const result = board(document, [{ lifterId: lifterId(document, 1), platformCall: 'on-deck' }]);

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Ama').urgency).toBe('non-urgent-preparation');
    // The clock is still running and is still reported -- it stopped ranking,
    // which is not the same as stopping.
    expect(rowFor(result, 'Ama').submission?.submitted).toBe(true);
  });

  it('leaves a lifter with nothing timed at the bottom', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 1), warmup: timelineOf([firstWarmupAt(90)]) },
    ]);

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Ama').urgency).toBe('non-urgent-preparation');
  });

  it('calls a finished lifter non-urgent and gives them no current attempt', () => {
    let timeline = meetWith(['Ama'], 'bench-only');
    for (const number of [1, 2, 3]) {
      timeline = take(timeline, 0, 'bench', number, 100 + number * 10);
    }
    const document = timeline.present;

    const row = rowFor(board(document), 'Ama');

    expect(row.current).toBeNull();
    expect(row.urgency).toBe('non-urgent-preparation');
    expect(row.nextAction).toBe('nothing-time-bound');
    expect(row.remaining.attemptsInTheMeet).toBe(0);
  });

  it('does not offer a warm-up to a lifter who has finished', () => {
    // Nothing clears an entry when the last attempt is judged, so the schedule
    // built for it is still there and still says a final single is due now.
    // Without the finished check the board would send a coach to a warm-up rack
    // for somebody whose day is over.
    let timeline = meetWith(['Ama'], 'bench-only');
    for (const number of [1, 2, 3]) {
      timeline = take(timeline, 0, 'bench', number, 100 + number * 10);
    }
    const document = timeline.present;

    const row = rowFor(
      board(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([finalWarmupAt(0)]) },
      ]),
      'Ama',
    );

    expect(row.urgency).toBe('non-urgent-preparation');
    expect(row.nextAction).toBe('nothing-time-bound');
  });

  it('keeps a lifter whose schedule has run out ahead of one with no schedule', () => {
    // A schedule the estimate has run past says nothing about where the lifter
    // is -- but it does say somebody built one, which is more than is known
    // about a lifter nobody has set up.
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(
      document,
      [{ lifterId: lifterId(document, 1), warmup: timelineOf([firstWarmupAt(1)]) }],
      AT + minutes(200) * 1000,
    );

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Bo').urgency).toBe('upcoming-flight');
    expect(rowFor(result, 'Bo').remaining.seconds).toBeNull();
  });

  it('does not read the platform item as a call nobody made', () => {
    const document = meetWith(['Ama']).present;

    const row = rowFor(
      board(document, [
        { lifterId: lifterId(document, 0), warmup: timelineOf([item('platform', 1)]) },
      ]),
      'Ama',
    );

    expect(row.urgency).toBe('upcoming-flight');
    expect(row.platformCall).toBeNull();
  });

  it('lists the seven levels once each, most urgent first', () => {
    expect(URGENCY_LADDER).toEqual([
      'submission-deadline',
      'called-or-on-deck',
      'equipment-or-wrapping',
      'final-warm-up',
      'other-warm-ups',
      'upcoming-flight',
      'non-urgent-preparation',
    ]);
    expect(new Set(URGENCY_LADDER).size).toBe(URGENCY_LADDER.length);
  });
});

describe('ageing a schedule', () => {
  it('promotes a warm-up as the instant it was counted from recedes', () => {
    const document = meetWith(['Ama']).present;
    const entry = { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(30)]) };

    expect(rowFor(board(document, [entry]), 'Ama').urgency).toBe('upcoming-flight');

    const later = AT + minutes(29) * 1000;
    expect(rowFor(board(document, [entry], later), 'Ama').urgency).toBe('other-warm-ups');
  });

  it('reports less time than there is rather than more', () => {
    // Four tenths of a second into a two-minute-and-one-second wait. Rounding to
    // the nearest second would report 121 and hand a coach a second that has
    // already gone; §5.5 says the rounding goes the safe way.
    const document = meetWith(['Ama']).present;
    const entry: CoachBoardEntry = {
      lifterId: lifterId(document, 0),
      warmup: timelineOf([item('warm-up-set', 0, { warmupIndex: 0, seconds: 45 })]),
    };
    const withOffset: CoachBoardEntry = {
      ...entry,
      warmup: timelineOf([
        {
          ...item('warm-up-set', 0, { warmupIndex: 0 }),
          startsInSeconds: { earliestSeconds: 121, latestSeconds: 181 },
        },
      ]),
    };

    const row = rowFor(board(document, [withOffset], AT + 400), 'Ama');

    expect(row.remaining.seconds).toBe(120);
  });

  it('reports a start time that has passed as a negative, not as zero', () => {
    const document = meetWith(['Ama']).present;

    const row = rowFor(
      board(
        document,
        [{ lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) }],
        AT + 30_000,
      ),
      'Ama',
    );

    expect(row.remaining.seconds).toBe(-30);
  });

  it('keeps an item on the board while it could still be the one in progress', () => {
    // The item starts between one and two minutes from now and takes 45 seconds,
    // so at three minutes it is behind the lifter and at two it is not.
    const document = meetWith(['Ama']).present;
    const entry = {
      lifterId: lifterId(document, 0),
      warmup: timelineOf([firstWarmupAt(1), finalWarmupAt(4)]),
    };

    expect(rowFor(board(document, [entry], AT + minutes(2) * 1000), 'Ama').urgency).toBe(
      'other-warm-ups',
    );
    expect(rowFor(board(document, [entry], AT + minutes(3) * 1000), 'Ama').urgency).toBe(
      'final-warm-up',
    );
  });

  it('takes the attention lead from the caller when one is given', () => {
    const document = meetWith(['Ama']).present;
    const entries = [{ lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(10)]) }];

    expect(rowFor(board(document, entries), 'Ama').urgency).toBe('upcoming-flight');
    expect(
      coachBoard({
        rules: RULES,
        document,
        entries,
        now: AT,
        attentionLeadSeconds: minutes(15),
      }).rows[0]?.urgency,
    ).toBe('other-warm-ups');
  });

  it('reads a nonsense attention lead as no lead', () => {
    // Clamped rather than trusted, and for the same reason
    // `coach-board-conflicts.ts` clamps its own: a negative lead inverts the
    // test, so a warm-up starting this second reads as not yet worth looking at
    // and the row goes quiet at precisely the moment it should not.
    const document = meetWith(['Ama']).present;

    expect(
      coachBoard({
        rules: RULES,
        document,
        entries: [{ lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(0)]) }],
        now: AT,
        attentionLeadSeconds: -60,
      }).rows[0]?.urgency,
    ).toBe('other-warm-ups');
  });

  it('defaults the attention lead to three minutes', () => {
    expect(DEFAULT_ATTENTION_LEAD_SECONDS).toBe(180);

    const document = meetWith(['Ama']).present;
    const justInside = timelineOf([firstWarmupAt(0)]).schedule.items;
    expect(justInside).toHaveLength(1);

    const inside = rowFor(
      board(document, [
        {
          lifterId: lifterId(document, 0),
          warmup: timelineOf([
            {
              ...firstWarmupAt(0),
              startsInSeconds: { earliestSeconds: 179, latestSeconds: 240 },
            },
          ]),
        },
      ]),
      'Ama',
    );
    const outside = rowFor(
      board(document, [
        {
          lifterId: lifterId(document, 0),
          warmup: timelineOf([
            {
              ...firstWarmupAt(0),
              startsInSeconds: { earliestSeconds: 181, latestSeconds: 240 },
            },
          ]),
        },
      ]),
      'Ama',
    );

    expect(inside.urgency).toBe('other-warm-ups');
    expect(outside.urgency).toBe('upcoming-flight');
  });
});

describe('the next action', () => {
  it('asks for a weight before it asks for anything else', () => {
    const timeline = take(meetWith(['Ama']), 0, 'squat', 1, 150);
    const document = timeline.present;

    expect(rowFor(board(document), 'Ama').nextAction).toBe('declare-the-next-attempt');
  });

  it('asks for the weight to be handed in once one has been chosen', () => {
    let timeline = take(meetWith(['Ama']), 0, 'squat', 1, 150);
    const second = attemptId(timeline.present, 0, 'squat', 2);
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId: second, kilograms: 160 });

    const row = rowFor(board(timeline.present), 'Ama');

    expect(row.nextAction).toBe('hand-the-weight-to-the-table');
    expect(row.current?.proposedKilograms).toBe(160);
  });

  it('asks a called lifter with nothing declared for a weight, not for the platform', () => {
    const document = meetWith(['Ama']).present;

    expect(
      rowFor(board(document, [{ lifterId: lifterId(document, 0), platformCall: 'called' }]), 'Ama')
        .nextAction,
    ).toBe('declare-the-next-attempt');
  });

  it('sends a called lifter with a weight to the platform', () => {
    let timeline = meetWith(['Ama']);
    const opener = attemptId(timeline.present, 0, 'squat', 1);
    timeline = apply(timeline, { kind: 'set-attempt-weight', attemptId: opener, kilograms: 150 });
    const document = timeline.present;

    expect(
      rowFor(board(document, [{ lifterId: lifterId(document, 0), platformCall: 'called' }]), 'Ama')
        .nextAction,
    ).toBe('get-to-the-platform');
  });

  it('names the warm-up level it came from', () => {
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([equipmentAt(0)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([finalWarmupAt(0)]) },
      { lifterId: lifterId(document, 2), warmup: timelineOf([firstWarmupAt(0)]) },
    ]);

    expect(rowFor(result, 'Ama').nextAction).toBe('start-equipment-or-wrapping');
    expect(rowFor(result, 'Bo').nextAction).toBe('take-the-final-warm-up');
    expect(rowFor(result, 'Cy').nextAction).toBe('start-the-warm-up');
  });
});

describe('identity', () => {
  it('never leaves a row without a cue that is not a colour', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), colour: 'rebeccapurple' },
      { lifterId: lifterId(document, 1), identifier: '  ', colour: '#ff0000' },
    ]);

    for (const row of result.rows) {
      expect(row.identifier).not.toBe('');
      expect(row.colour).not.toBeNull();
    }
    // Filled from the lifter's position in the meet, so two lifters cannot be
    // handed the same fallback.
    expect(rowFor(result, 'Ama').identifier).toBe('1');
    expect(rowFor(result, 'Bo').identifier).toBe('2');
  });

  it('numbers the fallback by the meet order, not by where the row landed', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 1), warmup: timelineOf([finalWarmupAt(0)]) },
    ]);

    expect(names(result)).toEqual(['Bo', 'Ama']);
    expect(rowFor(result, 'Bo').identifier).toBe('2');
    expect(rowFor(result, 'Bo').rank).toBe(1);
  });

  it('keeps the identifier the caller gave, trimmed', () => {
    const document = meetWith(['Ama']).present;

    expect(
      rowFor(board(document, [{ lifterId: lifterId(document, 0), identifier: ' 47 ' }]), 'Ama')
        .identifier,
    ).toBe('47');
  });

  it('leaves the colour null when nobody chose one', () => {
    const document = meetWith(['Ama']).present;

    expect(rowFor(board(document), 'Ama').colour).toBeNull();
  });
});

describe('the order', () => {
  it('breaks a tie inside a level by whoever is closest to their moment', () => {
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(2)]) },
      { lifterId: lifterId(document, 1), warmup: timelineOf([firstWarmupAt(0)]) },
      { lifterId: lifterId(document, 2), warmup: timelineOf([firstWarmupAt(1)]) },
    ]);

    expect(names(result)).toEqual(['Bo', 'Cy', 'Ama']);
  });

  it('breaks a remaining tie by the order the meet added them', () => {
    // Deterministic on purpose: a board that reshuffled two equally idle lifters
    // between repaints would move a name under a coach's thumb.
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    expect(names(board(document))).toEqual(['Ama', 'Bo', 'Cy']);
  });

  it('puts a lifter with no timed action behind one with a time, inside a level', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(
      document,
      [
        // Ama's whole schedule is behind her, so there is no figure to sort on.
        { lifterId: lifterId(document, 0), warmup: timelineOf([firstWarmupAt(1)]) },
        { lifterId: lifterId(document, 1), warmup: timelineOf([firstWarmupAt(300)]) },
      ],
      AT + minutes(200) * 1000,
    );

    expect(rowFor(result, 'Ama').urgency).toBe('upcoming-flight');
    expect(rowFor(result, 'Bo').urgency).toBe('upcoming-flight');
    expect(names(result)).toEqual(['Bo', 'Ama']);
  });

  it('numbers the ranks from one, in board order', () => {
    const document = meetWith(['Ama', 'Bo', 'Cy']).present;

    expect(board(document).rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('points the automatic return at the top row', () => {
    const timeline = take(meetWith(['Ama', 'Bo']), 1, 'squat', 1, 150);
    const document = timeline.present;

    const result = board(document);

    expect(result.focusLifterId).toBe(lifterId(document, 1));
    expect(result.focusLifterId).toBe(result.rows[0]?.lifterId);
  });

  it('points nowhere when nobody is in the meet', () => {
    const result = board(createMeetDocument(RULES, 'full-power'));

    expect(result.rows).toEqual([]);
    expect(result.focusLifterId).toBeNull();
  });

  it('does not let a pin move a row past a lifter who needs the coach', () => {
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(document, [
      { lifterId: lifterId(document, 1), pinned: true },
      { lifterId: lifterId(document, 0), warmup: timelineOf([finalWarmupAt(0)]) },
    ]);

    expect(names(result)).toEqual(['Ama', 'Bo']);
    expect(rowFor(result, 'Bo').pinned).toBe(true);
    expect(rowFor(result, 'Ama').pinned).toBe(false);
  });

  it('does not let a pin reorder two lifters on the same level', () => {
    // The case a level difference hides: with both rows at the bottom of the
    // ladder, a pin that ranked would be §21.1 quietly overruling §21, and the
    // automatic return would go to whoever was pinned rather than to whoever
    // needs the coach.
    const document = meetWith(['Ama', 'Bo']).present;

    const result = board(document, [{ lifterId: lifterId(document, 1), pinned: true }]);

    expect(names(result)).toEqual(['Ama', 'Bo']);
    expect(result.focusLifterId).toBe(lifterId(document, 0));
  });
});

describe('what a row carries', () => {
  it('gives a lifter nobody set up a row anyway', () => {
    const document = meetWith(['Ama']).present;

    const result = board(document, []);

    expect(result.rows).toHaveLength(1);
    expect(rowFor(result, 'Ama').identifier).toBe('1');
  });

  it('ignores an entry for somebody who is not in the meet', () => {
    const document = meetWith(['Ama']).present;

    const result = board(document, [{ lifterId: 'lifter-99', platformCall: 'called' }]);

    expect(result.rows).toHaveLength(1);
    expect(rowFor(result, 'Ama').platformCall).toBeNull();
  });

  it('counts attempts left on the lift and in the meet as two separate figures', () => {
    const timeline = take(meetWith(['Ama']), 0, 'squat', 1, 150);

    const row = rowFor(board(timeline.present), 'Ama');

    expect(row.current?.lift).toBe('squat');
    expect(row.remaining.attemptsOnThisLift).toBe(2);
    expect(row.remaining.attemptsInTheMeet).toBe(8);
  });

  it('reports what is banked and says it is not yet a total', () => {
    const timeline = take(meetWith(['Ama']), 0, 'squat', 1, 150);

    const row = rowFor(board(timeline.present), 'Ama');

    expect(row.total.kilograms).toBe(150);
    expect(row.total.isTotal).toBe(false);
    expect(row.total.liftsOutstanding).toEqual(['bench', 'deadlift']);
  });

  it('carries the current attempt as the one the clock is about', () => {
    const timeline = take(meetWith(['Ama']), 0, 'squat', 1, 150);
    const document = timeline.present;

    const row = rowFor(board(document), 'Ama');

    expect(row.current?.attemptId).toBe(attemptId(document, 0, 'squat', 2));
    expect(row.current?.attemptNumber).toBe(2);
    expect(row.current?.status).toBe('planned');
    expect(row.submission?.secondsRemaining).toBe(RULES.profile.submissionSeconds);
  });

  it('carries the handlers the caller assigned', () => {
    const document = meetWith(['Ama']).present;

    const row = rowFor(
      board(document, [
        {
          lifterId: lifterId(document, 0),
          handlers: [
            { name: 'Rae', responsibilities: ['attempt-submission', 'wrapping-or-equipment'] },
          ],
        },
      ]),
      'Ama',
    );

    expect(row.handlers).toEqual([
      { name: 'Rae', responsibilities: ['attempt-submission', 'wrapping-or-equipment'] },
    ]);
  });

  it('leaves the handlers empty rather than absent when nobody was assigned', () => {
    const document = meetWith(['Ama']).present;

    expect(rowFor(board(document), 'Ama').handlers).toEqual([]);
  });
});
