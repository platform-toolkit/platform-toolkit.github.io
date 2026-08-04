// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21.4, one bar at a time.
 *
 * The fixture ramp's four sets are 25, 65, 87.5 and 110 kilograms, and the plate
 * changes between them are all different sizes -- so a case can say what a load
 * cost without the assertion being true of any other pair of sets. Every weight
 * below is named by its index into that ramp for the same reason the other files
 * do it: the numbers are invented and nothing should read as a federation's.
 */
import { describe, expect, it } from 'vitest';

import { AT, item, minutes, rampKilogramsAt, timelineOf, warmupAt } from './coach-board.fixture.js';
import {
  rackSequences,
  type RackAdvisoryCode,
  type RackEntry,
  type RackSequence,
} from './rack-sequence.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function only(sequences: readonly RackSequence[]): RackSequence {
  const [first, ...rest] = sequences;
  if (first === undefined) throw new Error('no rack was sequenced');
  if (rest.length > 0) throw new Error(`${String(sequences.length)} racks were sequenced`);
  return first;
}

/** The weights on the bar, in the order the bar wears them. */
function weights(sequence: RackSequence): readonly number[] {
  return sequence.loads.map((load) => load.loading.total);
}

/** Who takes each load, load by load. */
function takers(sequence: RackSequence): readonly (readonly string[])[] {
  return sequence.loads.map((load) => load.takers.map((taker) => taker.lifterId));
}

function codes(sequence: RackSequence): readonly RackAdvisoryCode[] {
  return sequence.advisories.map((advisory) => advisory.code);
}

/** One lifter on one bar, taking the named ramp sets at the named minutes. */
function on(
  lifterId: string,
  rackId: string,
  sets: readonly (readonly [warmupIndex: number, startsInMinutes: number])[],
): RackEntry {
  return {
    lifterId,
    rackId,
    warmup: timelineOf(sets.map(([warmupIndex, at]) => warmupAt(warmupIndex, at))),
  };
}

function sequenced(entries: readonly RackEntry[], now = AT): readonly RackSequence[] {
  return rackSequences({ entries, now });
}

// -----------------------------------------------------------------------------
// What counts as a shared bar
// -----------------------------------------------------------------------------

describe('a room nobody has described', () => {
  it('is not sequenced', () => {
    // Naming no rack is not the same as everyone being on one. A room with four
    // bars and nobody labelling them would otherwise get a plan that reads
    // perfectly and cannot be carried out, and the coach would find out at the
    // rack.
    expect(
      sequenced([
        { lifterId: 'ama', warmup: timelineOf([warmupAt(1, 1)]) },
        { lifterId: 'bo', warmup: timelineOf([warmupAt(1, 1)]) },
      ]),
    ).toEqual([]);
  });

  it('is not sequenced for a rack named with spaces', () => {
    expect(
      sequenced([{ lifterId: 'ama', rackId: '  ', warmup: timelineOf([warmupAt(1, 1)]) }]),
    ).toEqual([]);
  });

  it('matches one bar written two ways', () => {
    // Trimmed on the way in, because a caller reading rack labels off a form has
    // no reason to have tidied them and two bars is the wrong answer.
    const sequence = only(
      sequenced([on('ama', 'bar-1', [[1, 1]]), on('bo', '  bar-1  ', [[1, 1]])]),
    );

    expect(sequence.rackId).toBe('bar-1');
    expect(takers(sequence)).toEqual([['ama', 'bo']]);
  });

  it('keeps two bars apart', () => {
    const sequences = sequenced([on('ama', 'bar-1', [[1, 1]]), on('bo', 'bar-2', [[1, 1]])]);

    expect(sequences.map((sequence) => sequence.rackId)).toEqual(['bar-1', 'bar-2']);
    expect(sequences.map(takers)).toEqual([[['ama']], [['bo']]]);
  });

  it('names the bars in the order the entries reach them', () => {
    const sequences = sequenced([on('ama', 'bar-2', [[1, 1]]), on('bo', 'bar-1', [[1, 1]])]);

    expect(sequences.map((sequence) => sequence.rackId)).toEqual(['bar-2', 'bar-1']);
  });

  it('leaves out a lifter on the bar with no schedule', () => {
    // A rack whose only lifter has no warm-up is a rack with nothing to plan, and
    // an empty sequence for it would be a heading over no rows.
    expect(sequenced([{ lifterId: 'ama', rackId: 'bar-1' }])).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// What goes on the bar
// -----------------------------------------------------------------------------

describe('one lifter on their own bar', () => {
  it('loads their ramp in the order they take it', () => {
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [1, 3],
          [2, 6],
          [3, 9],
        ]),
      ]),
    );

    expect(weights(sequence)).toEqual([0, 1, 2, 3].map(rampKilogramsAt));
    expect(sequence.loads.map((load) => load.plateMoves)).toEqual([0, 1, 4, 4]);
    expect(sequence.plateMoves).toBe(9);
  });

  it('costs the same shared as unshared, because nothing is shared', () => {
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [1, 3],
        ]),
      ]),
    );

    expect(sequence.plateMoves).toBe(sequence.plateMovesUnshared);
    expect(codes(sequence)).toEqual([]);
  });

  it('has no plate change to report for the first load', () => {
    // `null` rather than an empty change: there is no previous bar, which is a
    // different fact from a previous bar that happened to match, and a screen
    // showing "no plates to move" for the first load would be telling a coach
    // the bar was already right.
    const sequence = only(sequenced([on('ama', 'bar-1', [[2, 0]])]));

    expect(sequence.loads[0]?.change).toBeNull();
    expect(sequence.loads[0]?.plateMoves).toBe(0);
  });

  it('reports the plates to move rather than the difference in weight', () => {
    // 65 to 87.5 is a rise of 22.5 and is four plates: the twenty comes off
    // before the twenty-five goes on. A caller subtracting totals could only ever
    // have said "add 22.5", which is not a plate and not a job.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [1, 0],
          [2, 3],
        ]),
      ]),
    );

    expect(sequence.loads[1]?.change).toEqual({ removed: [20], added: [25, 5, 1.25] });
  });

  it('leaves out the wraps and the walk to the platform', () => {
    // Only a warm-up set puts weight on the bar. Equipment and the platform
    // attempt are on the same schedule and are somebody else's business.
    const sequence = only(
      sequenced([
        {
          lifterId: 'ama',
          rackId: 'bar-1',
          warmup: timelineOf([
            item('equipment', 0, { equipmentId: 'knee-wraps' }),
            warmupAt(2, 3),
            item('platform', 6),
          ]),
        },
      ]),
    );

    expect(weights(sequence)).toEqual([rampKilogramsAt(2)]);
  });

  it('leaves out a set that points past the end of its own ramp', () => {
    // A schedule and the plan it counts against are two objects, and a caller is
    // free to hand over a schedule whose items have been filtered or whose plan
    // has been trimmed. A set with no set behind it has no weight, and the only
    // thing to do with it is nothing -- putting it on the bar would need a weight
    // invented, and §21.4's whole promise is that it invents none.
    const sequence = only(
      sequenced([
        {
          lifterId: 'ama',
          rackId: 'bar-1',
          warmup: timelineOf([warmupAt(9, 1), warmupAt(2, 4)]),
        },
      ]),
    );

    expect(weights(sequence)).toEqual([rampKilogramsAt(2)]);
  });

  it('drops a set the schedule has already run past', () => {
    // The ageing rule lives in `warmup-timeline.ts` and is the same one the board
    // and the warnings read, which is the point of it being there. Checked here
    // because a plan that keeps offering a bar the lifter finished with ten
    // minutes ago never stops offering it.
    const sequence = only(
      sequenced(
        [
          on('ama', 'bar-1', [
            [0, 0],
            [3, 12],
          ]),
        ],
        AT + minutes(10) * 1000,
      ),
    );

    expect(weights(sequence)).toEqual([rampKilogramsAt(3)]);
  });
});

// -----------------------------------------------------------------------------
// Sharing
// -----------------------------------------------------------------------------

describe('two lifters who want the same weight', () => {
  it('load the bar once', () => {
    const sequence = only(sequenced([on('ama', 'bar-1', [[2, 0]]), on('bo', 'bar-1', [[2, 1]])]));

    expect(weights(sequence)).toEqual([rampKilogramsAt(2)]);
    expect(takers(sequence)).toEqual([['ama', 'bo']]);
    expect(codes(sequence)).toEqual([]);
  });

  it('are counted against what two bars would have cost', () => {
    // The saving is the point and is shown rather than asserted: one loading of
    // 87.5 from 25 is three plates, and the two lifters doing it separately would
    // each have paid that.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [2, 3],
        ]),
        on('bo', 'bar-1', [
          [0, 0],
          [2, 4],
        ]),
      ]),
    );

    expect(sequence.plateMoves).toBe(3);
    expect(sequence.plateMovesUnshared).toBe(6);
  });

  it('are compared against their own ramps, not against the bar', () => {
    // The comparison is per lifter and it can come out against sharing, which is
    // an answer worth having rather than one to hide. Ama goes 25 to 110 and Bo
    // goes 87.5 to 65; on their own bars that is three plates and four. Interleaved
    // on one bar it is eleven, because each of them keeps arriving at a bar the
    // other has just set to something else. A coach reading that should go and
    // find a second rack.
    //
    // Both halves of the figure are load-bearing. Measuring each change against
    // whatever was last on the bar rather than against that lifter's own previous
    // set gives eleven for both numbers and the comparison says nothing; counting
    // only the plates that go on gives four, because the strip back down from 87.5
    // to 65 is three plates coming off and one going on.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [3, 6],
        ]),
        on('bo', 'bar-1', [
          [2, 3],
          [1, 9],
        ]),
      ]),
    );

    expect(weights(sequence)).toEqual([0, 2, 3, 1].map(rampKilogramsAt));
    expect(sequence.plateMoves).toBe(11);
    expect(sequence.plateMovesUnshared).toBe(7);
  });

  it('are due when the first of them is ready, not the last', () => {
    // A bar loaded when the second lifter arrives is a bar the first one stood
    // waiting for, and the whole point of the figure is to say when to load it.
    const sequence = only(sequenced([on('ama', 'bar-1', [[2, 2]]), on('bo', 'bar-1', [[2, 1]])]));

    expect(sequence.loads[0]?.dueInSeconds).toBe(minutes(1));
  });

  it('are listed in the order the caller gave them', () => {
    // Not in the order they reach the bar. The caller's order is the board's row
    // order, and a load whose takers are shuffled against the rows above it is a
    // load a coach has to read twice.
    const sequence = only(sequenced([on('bo', 'bar-1', [[2, 2]]), on('ama', 'bar-1', [[2, 1]])]));

    expect(takers(sequence)).toEqual([['bo', 'ama']]);
  });

  it('do not share when the first is off the bar before the second arrives', () => {
    // The one thing §21.4 will not do. Merging these would mean holding Ama's set
    // back or pulling Bo's forward, and the requirement says the weights and the
    // timing are the lifters', not the tool's. So the bar is loaded twice and the
    // cost of that is reported.
    const sequence = only(sequenced([on('ama', 'bar-1', [[2, 0]]), on('bo', 'bar-1', [[2, 5]])]));

    expect(takers(sequence)).toEqual([['ama'], ['bo']]);
    expect(codes(sequence)).toEqual(['same-weight-twice']);
  });

  it('do not share a bar they touch at one instant', () => {
    // Ama's set could still be running at 1:45 and Bo could start at 1:45, and
    // that is not two lifters on one bar, it is one lifter walking away as the
    // other walks up. Merging them would put both names on a load and let a coach
    // walk off, and the same instant is where `warmup-timeline.ts` draws its own
    // line: an item ending exactly now has ended.
    const closes = 1.75;
    const sequence = only(
      sequenced([on('ama', 'bar-1', [[2, 0]]), on('bo', 'bar-1', [[2, closes]])]),
    );

    expect(sequence.loads[0]?.takers[0]?.endsInSeconds).toBe(minutes(closes));
    expect(takers(sequence)).toEqual([['ama'], ['bo']]);
  });

  it('do not take a third lifter who arrives after the first has gone', () => {
    // Ama at 0:00 is off the bar at 1:45; Bo at 1:00 can join her; Cy at 2:00
    // cannot, because the bar Cy would be joining is one Ama has finished with.
    // The shared window is the earliest end, not the latest.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [[2, 0]]),
        on('bo', 'bar-1', [[2, 1]]),
        on('cy', 'bar-1', [[2, 2]]),
      ]),
    );

    expect(takers(sequence)).toEqual([['ama', 'bo'], ['cy']]);
  });
});

// -----------------------------------------------------------------------------
// Where efficiency and timing disagree
// -----------------------------------------------------------------------------

describe('the order the schedule asks for', () => {
  it('is kept even when it strips the bar back down', () => {
    // The cheap plan is 65 then 110. The schedule says 110 then 65, because Bo is
    // on the platform first. §21.4 keeps the timing and says what it cost.
    const sequence = only(sequenced([on('bo', 'bar-1', [[3, 0]]), on('ama', 'bar-1', [[1, 3]])]));

    expect(weights(sequence)).toEqual([rampKilogramsAt(3), rampKilogramsAt(1)]);
    expect(sequence.advisories).toEqual([
      { code: 'bar-goes-back-down', severity: 'note', lifterIds: ['bo', 'ama'], plateMoves: 4 },
    ]);
  });

  it('names everybody on a shared load, not just the first of them', () => {
    // The advisory is a request to go and move plates, and a coach reading it
    // works out who is affected from the names. A load two lifters are sharing
    // that names one of them sends the coach to talk to Ama about a bar Bo is
    // also standing at.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [[3, 0]]),
        on('bo', 'bar-1', [[3, 1]]),
        on('cy', 'bar-1', [[1, 5]]),
      ]),
    );

    expect(takers(sequence)).toEqual([['ama', 'bo'], ['cy']]);
    expect(sequence.advisories).toEqual([
      {
        code: 'bar-goes-back-down',
        severity: 'note',
        lifterIds: ['ama', 'bo', 'cy'],
        plateMoves: 4,
      },
    ]);
  });

  it('breaks a genuine tie towards the lighter bar', () => {
    // Two sets due the same second can go in either order without moving anybody,
    // so this is the one place efficiency gets a vote: going up strips no plates
    // and going down strips them twice.
    const sequence = only(sequenced([on('bo', 'bar-1', [[3, 1]]), on('ama', 'bar-1', [[1, 1]])]));

    expect(weights(sequence)).toEqual([rampKilogramsAt(1), rampKilogramsAt(3)]);
    expect(codes(sequence)).toEqual([]);
  });

  it('says what a second loading of the same weight costs', () => {
    // 25, then 87.5 for Bo, then 25 again for Cy: the empty bar has to be stripped
    // back to nothing, and that is the price of Cy's set staying where it is.
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [[0, 0]]),
        on('bo', 'bar-1', [[2, 3]]),
        on('cy', 'bar-1', [[0, 6]]),
      ]),
    );

    expect(sequence.advisories).toEqual([
      { code: 'bar-goes-back-down', severity: 'note', lifterIds: ['bo', 'cy'], plateMoves: 3 },
      { code: 'same-weight-twice', severity: 'caution', lifterIds: ['ama', 'cy'], plateMoves: 3 },
    ]);
  });

  it('says nothing about a ramp that only goes up', () => {
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [1, 3],
          [2, 6],
          [3, 9],
        ]),
      ]),
    );

    expect(codes(sequence)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The horizon
// -----------------------------------------------------------------------------

describe('a caller showing only the next few loads', () => {
  it('is planned to its own horizon', () => {
    // Sliced here rather than by the caller so that the advisories are about the
    // run being shown. A "bar goes back down" about a load off the bottom of the
    // panel is a warning with nothing to point at.
    const sequence = only(
      rackSequences({
        entries: [
          on('ama', 'bar-1', [
            [0, 0],
            [3, 10],
          ]),
          on('bo', 'bar-1', [[1, 20]]),
        ],
        now: AT,
        horizonSeconds: minutes(15),
      }),
    );

    expect(weights(sequence)).toEqual([rampKilogramsAt(0), rampKilogramsAt(3)]);
    expect(codes(sequence)).toEqual([]);
  });

  it('plans the whole ramp when it asks for no horizon', () => {
    const sequence = only(
      sequenced([
        on('ama', 'bar-1', [
          [0, 0],
          [3, 10],
        ]),
        on('bo', 'bar-1', [[1, 20]]),
      ]),
    );

    expect(weights(sequence)).toEqual([rampKilogramsAt(0), rampKilogramsAt(3), rampKilogramsAt(1)]);
  });
});
