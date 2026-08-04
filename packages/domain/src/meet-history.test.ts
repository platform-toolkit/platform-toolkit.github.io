// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §9.4, one figure at a time, and the rules that hold across all of them.
 *
 * The rules are what this module is for, so they are tested as rules rather than
 * as consequences of one fixture: no figure claims a trend from one meet, a scope
 * that does not combine equipment reads only its own group, and every figure
 * reports the number of observations behind it.
 *
 * Fixture weights are deliberately uneven -- 100/107.5/115 rather than
 * 100/110/120 -- so a figure that came from counting attempts rather than
 * measuring the gaps between them reads as a wrong number rather than as a
 * coincidence. Where a median is asserted the input arrives unsorted, so an
 * implementation that took the middle of the arrival order fails.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import type { MissReason } from './meet-document.js';
import {
  MEETS_BEFORE_A_TREND,
  NO_CALIBRATION,
  OBSERVATIONS_FOR_A_TREND,
  calibrateFrom,
  type CalibrationLift,
  type HistoricAttempt,
  type HistoricMeet,
  type HistoryEquipment,
  type HistoryScope,
} from './meet-history.js';

const RAW: HistoryScope = { equipment: 'raw', combineEquipment: false };
const COMBINED: HistoryScope = { equipment: 'raw', combineEquipment: true };

/** `100` for a good attempt, `115x` for a miss, `120p` for a pass. */
function attempts(...shorthand: readonly string[]): readonly HistoricAttempt[] {
  return shorthand.map((entry, index) => {
    const passed = entry.endsWith('p');
    const missed = entry.endsWith('x');
    const kilograms = Number.parseFloat(entry);
    if (Number.isNaN(kilograms)) throw new Error(`bad attempt shorthand: ${entry}`);
    const outcome = passed ? 'passed' : missed ? 'no-lift' : 'good';
    const missReason: MissReason | null = missed ? 'strength' : null;
    return { attemptNumber: index + 1, kilograms, outcome, missReason };
  });
}

/**
 * A meet from ordered lift entries.
 *
 * Tuples rather than an object keyed by lift, because report order is one of the
 * things under test and a fixture whose order came from key insertion would be
 * testing the fixture. It also keeps `PlatformLift` on the key without a cast.
 */
type LiftEntry = readonly [PlatformLift, readonly HistoricAttempt[]];

function meet(
  meetId: string,
  lifts: readonly LiftEntry[],
  options: { readonly equipment?: HistoryEquipment; readonly planned?: number | null } = {},
): HistoricMeet {
  const planned = options.planned === undefined ? 200 : options.planned;
  return {
    meetId,
    equipment: options.equipment ?? 'raw',
    lifts: lifts.map(([lift, taken]) => ({
      lift,
      attempts: taken,
      plannedMaximumKilograms: planned,
    })),
  };
}

function liftIn(report: { readonly lifts: readonly CalibrationLift[] }, lift: PlatformLift) {
  const found = report.lifts.find((entry) => entry.lift === lift);
  if (found === undefined) throw new Error(`no ${lift} in report`);
  return found;
}

/** Three identical squat meets: enough to clear the meet floor without saying so each time. */
function manyMeets(taken: readonly HistoricAttempt[]): readonly HistoricMeet[] {
  return Array.from({ length: 3 }, (_unused, index) => meet(`meet-${index}`, [['squat', taken]]));
}

describe('calibrateFrom -- typical jumps', () => {
  it('measures the gap into each attempt, not the attempt weight', () => {
    // 100 -> 107.5 -> 115. Gaps of 7.5 and 7.5, three meets over, so the median
    // is 7.5 and no reading of the weights themselves produces that number.
    const report = calibrateFrom(manyMeets(attempts('100', '107.5', '115')), RAW);

    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(7.5);
    expect(liftIn(report, 'squat').successfulJump.observations).toBe(6);
  });

  it('takes the middle jump rather than the mean, so one huge jump does not move it', () => {
    const steady = meet('a', [['squat', attempts('100', '105', '110')]]);
    const alsoSteady = meet('b', [['squat', attempts('100', '105', '110')]]);
    // A forty-kilogram opener correction. The mean of 5,5,5,5,40 is 12; the
    // median is 5, and the difference between them is the point of the module.
    const wild = meet('c', [['squat', attempts('100', '140')]]);

    const report = calibrateFrom([wild, steady, alsoSteady], RAW);

    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(5);
  });

  it('keeps missed jumps apart from successful ones', () => {
    const report = calibrateFrom(manyMeets(attempts('100', '110', '130x')), RAW);
    const squat = liftIn(report, 'squat');

    expect(squat.successfulJump.kilograms).toBe(10);
    expect(squat.missedJump.kilograms).toBe(20);
  });

  it('reports no missed jump for a lifter who has never missed, with the count to say so', () => {
    const report = calibrateFrom(manyMeets(attempts('100', '110', '120')), RAW);
    const squat = liftIn(report, 'squat');

    expect(squat.missedJump.kilograms).toBeNull();
    expect(squat.missedJump.observations).toBe(0);
    expect(squat.successfulJump.observations).toBe(6);
  });

  it('measures a third attempt from the last weight taken, skipping a passed second', () => {
    // 100 good, 120 passed, 130 good. The jump the lifter made is 30, not 10.
    const report = calibrateFrom(manyMeets(attempts('100', '120p', '130')), RAW);

    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(30);
  });

  it('ignores a non-positive gap, which is a correction rather than a jump', () => {
    const lowered = meet('a', [['squat', attempts('100', '100', '110')]]);
    const other = meet('b', [['squat', attempts('100', '110')]]);

    const report = calibrateFrom([lowered, other], RAW);

    // Gaps are 0 (dropped), 10, 10. Two observations, not three, and the zero
    // would have been the median of the three had it been counted.
    expect(liftIn(report, 'squat').successfulJump.observations).toBe(2);
    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(10);
  });
});

describe('calibrateFrom -- second and third attempt success', () => {
  it('counts what was taken and what went up, per attempt number', () => {
    const good = meet('a', [['squat', attempts('100', '110', '120')]]);
    const missedThird = meet('b', [['squat', attempts('100', '110', '125x')]]);
    const missedSecond = meet('c', [['squat', attempts('100', '112x', '112x')]]);

    const squat = liftIn(calibrateFrom([good, missedThird, missedSecond], RAW), 'squat');

    expect(squat.secondAttempts).toMatchObject({ taken: 3, made: 2 });
    expect(squat.thirdAttempts).toMatchObject({ taken: 3, made: 1 });
  });

  it('does not count a passed third as one that was taken and lost', () => {
    const squat = liftIn(calibrateFrom(manyMeets(attempts('100', '110', '120p')), RAW), 'squat');

    expect(squat.thirdAttempts).toMatchObject({ taken: 0, made: 0 });
    expect(squat.secondAttempts).toMatchObject({ taken: 3, made: 3 });
  });

  it('does not count a passed second either', () => {
    // The pass has to be tested at both attempt numbers: the two counters are
    // separate branches, and a fixture that only ever passes the third leaves the
    // second's guard unexercised.
    const squat = liftIn(calibrateFrom(manyMeets(attempts('100', '110p', '125')), RAW), 'squat');

    expect(squat.secondAttempts).toMatchObject({ taken: 0, made: 0 });
    expect(squat.thirdAttempts).toMatchObject({ taken: 3, made: 3 });
  });
});

describe('calibrateFrom -- performance against the planned maximum', () => {
  it('compares the best good lift with the maximum the plan was built from', () => {
    const under = meet('a', [['squat', attempts('160', '175', '190x')]], { planned: 200 });
    const over = meet('b', [['squat', attempts('160', '190', '210')]], { planned: 200 });
    const alsoOver = meet('c', [['squat', attempts('160', '190', '205')]], { planned: 200 });

    // 87.5, 105, 102.5 -> the middle one is 102.5. Note the best good lift at the
    // first meet is 175 rather than the 190 that was missed.
    const squat = liftIn(calibrateFrom([under, over, alsoOver], RAW), 'squat');

    expect(squat.reachedOfPlannedPercent.percent).toBe(102.5);
    expect(squat.reachedOfPlannedPercent.observations).toBe(3);
  });

  it('gives no credit for a weight that was loaded and missed', () => {
    // 190 was on the bar and did not go up, so the lifter reached 175 of a planned
    // 200. Every meet here reaches the same share, so the assertion is about which
    // attempt was read rather than about which one landed in the middle.
    const missedTop = meet('a', [['squat', attempts('160', '175', '190x')]], { planned: 200 });

    const squat = liftIn(calibrateFrom([missedTop, { ...missedTop, meetId: 'b' }], RAW), 'squat');

    expect(squat.reachedOfPlannedPercent.percent).toBe(87.5);
  });

  it('leaves the comparison out for a lift with no planned maximum, keeping the other figures', () => {
    const unplanned = manyMeets(attempts('100', '110', '120')).map((entry) => ({
      ...entry,
      lifts: entry.lifts.map((lift) => ({ ...lift, plannedMaximumKilograms: null })),
    }));

    const squat = liftIn(calibrateFrom(unplanned, RAW), 'squat');

    expect(squat.reachedOfPlannedPercent.percent).toBeNull();
    expect(squat.reachedOfPlannedPercent.observations).toBe(0);
    expect(squat.successfulJump.kilograms).toBe(10);
  });

  it('rounds the share to one decimal rather than reporting the arithmetic', () => {
    const meets = [
      meet('a', [['squat', attempts('185')]], { planned: 200 }),
      meet('b', [['squat', attempts('185')]], { planned: 210 }),
      meet('c', [['squat', attempts('185')]], { planned: 220 }),
    ];

    // 185/210 is 88.0952...; to one decimal, 88.1.
    expect(liftIn(calibrateFrom(meets, RAW), 'squat').reachedOfPlannedPercent.percent).toBe(88.1);
  });
});

describe('calibrateFrom -- where the misses cluster', () => {
  it('names the lift that takes more than its share of the strength misses', () => {
    const first = meet('a', [
      ['squat', attempts('100', '110')],
      ['bench', attempts('80', '90x', '90x')],
      ['deadlift', attempts('180', '200')],
    ]);
    const second = meet('b', [
      ['squat', attempts('100', '110')],
      ['bench', attempts('80', '92x', '92x')],
      ['deadlift', attempts('180', '205')],
    ]);

    expect(calibrateFrom([first, second], RAW).missCluster).toMatchObject({
      lift: 'bench',
      misses: 4,
      ofMisses: 4,
    });
  });

  it('names nothing when the misses are spread evenly across the lifts', () => {
    const even = meet('a', [
      ['squat', attempts('100', '115x')],
      ['bench', attempts('80', '92x')],
      ['deadlift', attempts('180', '215x')],
    ]);

    expect(calibrateFrom([even, { ...even, meetId: 'b' }], RAW).missCluster).toBeNull();
  });

  it('waits for enough misses to be a pattern rather than a bad day', () => {
    const lopsided = meet('a', [
      ['squat', attempts('100', '110')],
      ['bench', attempts('80', '90x')],
      ['deadlift', attempts('180', '200')],
    ]);
    const again = { ...lopsided, meetId: 'b' };

    // Two misses, both on the bench, and still under the floor. A third makes it
    // a pattern -- so this pair is the boundary the constant draws.
    expect(calibrateFrom([lopsided, again], RAW).missCluster).toBeNull();
    expect(
      calibrateFrom([lopsided, again, { ...lopsided, meetId: 'c' }], RAW).missCluster,
    ).toMatchObject({ lift: 'bench', misses: 3 });
  });

  it('does not count a miss that was not about strength', () => {
    const commands = meet('a', [
      ['squat', attempts('100', '110')],
      [
        'bench',
        [
          { attemptNumber: 1, kilograms: 80, outcome: 'good', missReason: null },
          { attemptNumber: 2, kilograms: 90, outcome: 'no-lift', missReason: 'command' },
          { attemptNumber: 3, kilograms: 90, outcome: 'no-lift', missReason: 'command' },
        ],
      ],
      ['deadlift', attempts('180', '200')],
    ]);

    expect(calibrateFrom([commands, { ...commands, meetId: 'b' }], RAW).missCluster).toBeNull();
  });
});

describe('calibrateFrom -- the equipment scope', () => {
  const MIXED: readonly HistoricMeet[] = [
    meet('a', [['squat', attempts('100', '110')]], { equipment: 'raw' }),
    meet('b', [['squat', attempts('100', '110')]], { equipment: 'raw' }),
    meet('c', [['squat', attempts('200', '260')]], { equipment: 'equipped' }),
    meet('d', [['squat', attempts('150', '190')]], { equipment: 'wraps' }),
  ];

  it('reads only its own group and says how many meets it left out', () => {
    const report = calibrateFrom(MIXED, RAW);

    expect(report.meetsRead).toBe(2);
    expect(report.meetsOutOfScope).toBe(2);
    expect(liftIn(report, 'squat').successfulJump.observations).toBe(2);
  });

  it('reads everything once the lifter combines them, and the evidence grows', () => {
    const report = calibrateFrom(MIXED, COMBINED);

    expect(report.meetsRead).toBe(4);
    expect(report.meetsOutOfScope).toBe(0);
    // Gaps of 10, 10, 60, 40; the middle pair is 10 and 40, and the lower is taken.
    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(10);
    expect(liftIn(report, 'squat').successfulJump.observations).toBe(4);
  });

  it('keeps an unstated meet out of a raw history rather than assuming it was raw', () => {
    const history = [
      meet('a', [['squat', attempts('100', '110')]], { equipment: 'raw' }),
      meet('b', [['squat', attempts('300', '400')]], { equipment: 'unstated' }),
    ];

    const report = calibrateFrom(history, RAW);

    expect(report.meetsRead).toBe(1);
    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(10);
  });

  it('carries the scope back so a screen can name what it read', () => {
    expect(calibrateFrom([], COMBINED).scope).toEqual(COMBINED);
  });
});

describe('calibrateFrom -- how much may be claimed', () => {
  it('calls nothing a trend after one meet, however many attempts it held', () => {
    const one = meet('a', [
      ['squat', attempts('100', '110', '120')],
      ['bench', attempts('80', '90', '100')],
      ['deadlift', attempts('180', '200', '220')],
    ]);

    const report = calibrateFrom([one], RAW);

    expect(MEETS_BEFORE_A_TREND).toBe(2);
    expect(report.strength).toBe('not-enough');
    expect(report.elevatable).toBe(false);
    for (const lift of report.lifts) {
      expect(lift.successfulJump.strength).toBe('not-enough');
      expect(lift.secondAttempts.strength).toBe('not-enough');
      expect(lift.thirdAttempts.strength).toBe('not-enough');
      expect(lift.reachedOfPlannedPercent.strength).toBe('not-enough');
    }
    // ...and the figures are still there to be shown, labelled.
    expect(liftIn(report, 'squat').successfulJump.kilograms).toBe(10);
  });

  it('calls a thin figure indicative even when the meet count is high', () => {
    // Five meets, but the bench was contested at only one of them: plenty of
    // meets and one observation is not a trend either.
    const history = Array.from({ length: 5 }, (_unused, index) => {
      const lifts: LiftEntry[] = [['squat', attempts('100', '110', '120')]];
      if (index === 0) lifts.push(['bench', attempts('80', '90')]);
      return meet(`meet-${index}`, lifts);
    });

    const report = calibrateFrom(history, RAW);

    expect(report.strength).toBe('established');
    expect(liftIn(report, 'squat').successfulJump.strength).toBe('established');
    expect(liftIn(report, 'bench').successfulJump).toMatchObject({
      observations: 1,
      strength: 'indicative',
    });
  });

  it('elevates only once the meet count clears the observation threshold', () => {
    const history = Array.from({ length: OBSERVATIONS_FOR_A_TREND }, (_unused, index) =>
      meet(`meet-${index}`, [['squat', attempts('100', '110')]]),
    );

    expect(calibrateFrom(history.slice(0, OBSERVATIONS_FOR_A_TREND - 1), RAW)).toMatchObject({
      strength: 'indicative',
      elevatable: false,
    });
    expect(calibrateFrom(history, RAW)).toMatchObject({
      strength: 'established',
      elevatable: true,
    });
  });
});

describe('calibrateFrom -- the shape of the report', () => {
  it('returns nothing to read for a lifter with no history', () => {
    expect(calibrateFrom([], RAW)).toMatchObject({
      meetsRead: 0,
      meetsOutOfScope: 0,
      lifts: [],
      missCluster: null,
      elevatable: false,
    });
  });

  it('leaves out a lift that was never contested rather than showing an empty row', () => {
    const squatOnly = meet('a', [
      ['squat', attempts('100', '110')],
      ['bench', []],
    ]);

    const report = calibrateFrom([squatOnly, { ...squatOnly, meetId: 'b' }], RAW);

    expect(report.lifts.map((lift) => lift.lift)).toEqual(['squat']);
  });

  it('keeps the lifts in the order the history first contested them', () => {
    const deadliftFirst = meet('a', [
      ['deadlift', attempts('180', '200')],
      ['squat', attempts('100', '110')],
    ]);

    const report = calibrateFrom([deadliftFirst, { ...deadliftFirst, meetId: 'b' }], RAW);

    expect(report.lifts.map((lift) => lift.lift)).toEqual(['deadlift', 'squat']);
  });

  it('offers an empty report that claims nothing', () => {
    expect(NO_CALIBRATION.elevatable).toBe(false);
    expect(NO_CALIBRATION.strength).toBe('not-enough');
    expect(NO_CALIBRATION.lifts).toEqual([]);
  });
});
