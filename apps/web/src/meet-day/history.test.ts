// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the shelf contributes to §9.4, and what it deliberately leaves out.
 *
 * Every assertion here is about the join rather than about the arithmetic:
 * `calibrateFrom` has its own suite in the domain and is not re-tested. What can
 * only go wrong here is which meets were read, in what order, and under whose id --
 * and each of those failures produces a report that looks entirely reasonable,
 * which is why they are asserted one at a time rather than through one big fixture.
 *
 * The weights are invented (§5.1) and, more importantly, chosen so that no two
 * meets in a fixture could be confused for each other: a jump of 5 kg in one and
 * 11 kg in the other means a median that reads 5 says which meets were counted.
 */
import { describe, expect, it } from 'vitest';

import { calibrateLibrary, historicMeetsIn } from './history.js';
import {
  EMPTY_LIBRARY,
  EMPTY_SAVED_STATE,
  type MeetLibrary,
  type SavedHistory,
  type SavedMeet,
} from './saved-meet.js';

import type { HistoricLift, HistoryScope } from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

const RAW: HistoryScope = { equipment: 'raw', combineEquipment: false };
const COMBINED: HistoryScope = { equipment: 'raw', combineEquipment: true };

/**
 * One lift with three made attempts, rising by `jump` each time.
 *
 * Three good lifts rather than a mixture because every figure this suite reads is
 * a count of meets or an order of lifts; a miss would add a second thing the
 * numbers could be explaining.
 */
function liftOf(lift: PlatformLift, opening: number, jump: number): HistoricLift {
  return {
    lift,
    plannedMaximumKilograms: opening + jump * 3,
    attempts: [1, 2, 3].map((attemptNumber) => ({
      attemptNumber,
      kilograms: opening + jump * (attemptNumber - 1),
      outcome: 'good' as const,
      missReason: null,
    })),
  };
}

function historyOf(lifts: readonly HistoricLift[], equipment: 'raw' | 'wraps'): SavedHistory {
  return { equipment, lifts };
}

interface MeetOptions {
  readonly id: string;
  readonly createdAt: number;
  readonly history?: SavedHistory;
  readonly archived?: boolean;
}

function meetOf(options: MeetOptions): SavedMeet {
  return {
    id: options.id,
    name: options.id,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    archived: options.archived ?? false,
    rulesProfileId: 'uspa-2026',
    rulebookRevision: '2026-01',
    methodologyVersion: 'attempt-plan-2026.1',
    state: { ...EMPTY_SAVED_STATE, history: options.history ?? null },
  };
}

function shelf(meets: readonly SavedMeet[], activeMeetId: string | null = null): MeetLibrary {
  return { ...EMPTY_LIBRARY, meets, activeMeetId };
}

/** Two comparable raw meets, newest first the way the shelf holds them. */
const SQUAT_ONLY = meetOf({
  id: 'meet-old',
  createdAt: 1000,
  history: historyOf([liftOf('squat', 150, 5)], 'raw'),
});
const FULL_POWER = meetOf({
  id: 'meet-new',
  createdAt: 2000,
  history: historyOf([liftOf('bench', 100, 5), liftOf('squat', 160, 5)], 'raw'),
});

describe('reading the shelf as a history', () => {
  it('leaves out a meet that never finished', () => {
    // A planned meet is on the shelf for the week before the day, so this is the
    // common case rather than an edge one -- and `calibrateFrom` counts what it is
    // handed as meets read, so an empty entry passed through is a history that
    // crosses the two-meet floor on the strength of a meet nobody contested.
    const planned = meetOf({ id: 'meet-planned', createdAt: 3000 });

    expect(historicMeetsIn([SQUAT_ONLY, planned]).map((meet) => meet.meetId)).toStrictEqual([
      'meet-old',
    ]);
  });

  it('names each meet by the saved meet it came from', () => {
    // `SavedHistory` deliberately stores no meet id, so this is the only place the
    // two can be joined -- and the entry `summariseMeet` produces on its own is the
    // profile and the lifter, which is one string for every meet under a federation.
    expect(historicMeetsIn([FULL_POWER, SQUAT_ONLY]).map((meet) => meet.meetId)).toStrictEqual([
      'meet-old',
      'meet-new',
    ]);
  });

  it('reads oldest first, whatever order the shelf holds', () => {
    // Not cosmetic: `calibrateFrom` reports lifts in the order it first meets them,
    // so shelf order (newest first) opens the report on the most recent meet's
    // lifts. The two fixtures contest the lifts in opposite orders, so squat-first
    // is only reachable by reading the older meet first.
    const report = calibrateLibrary(shelf([FULL_POWER, SQUAT_ONLY]), {
      exceptMeetId: null,
      scope: RAW,
    });

    expect(report.lifts.map((lift) => lift.lift)).toStrictEqual(['squat', 'bench']);
  });

  it('sorts by when the meet was created, not by where it sits on the shelf', () => {
    // The control for the test above, and the reason the sort is not a reverse: an
    // imported meet lands where the import put it, which is when the file was read.
    // Here the older meet is already at the front, so a reverse would answer bench.
    const report = calibrateLibrary(shelf([SQUAT_ONLY, FULL_POWER]), {
      exceptMeetId: null,
      scope: RAW,
    });

    expect(report.lifts.map((lift) => lift.lift)).toStrictEqual(['squat', 'bench']);
  });

  it('counts an archived meet, because tidying a shelf is not disowning a meet', () => {
    // A season put away in March is the history §9.4 wants read in June, and a
    // calibration that shrank when somebody tidied up would be a figure moving for
    // a reason nobody could see. Asserted as "archiving changed nothing", with the
    // unarchived pair beside it as the control -- a filter that dropped *both*
    // would satisfy a bare count of the archived shelf on its own.
    const archived: SavedMeet = { ...FULL_POWER, archived: true };
    const request = { exceptMeetId: null, scope: RAW };

    expect(calibrateLibrary(shelf([SQUAT_ONLY, FULL_POWER]), request).meetsRead).toBe(2);
    expect(calibrateLibrary(shelf([SQUAT_ONLY, archived]), request).meetsRead).toBe(2);
  });
});

describe('the meet being looked at', () => {
  it('is left out of its own comparison', () => {
    // §26's panel sits under the reading of the meet that has just finished, and
    // that meet's entry is already on the shelf. Left in, a lifter's first meet
    // produces a full set of figures that are that meet's own numbers handed back.
    const both = shelf([FULL_POWER, SQUAT_ONLY], 'meet-new');

    const withIt = calibrateLibrary(both, { exceptMeetId: null, scope: RAW });
    const withoutIt = calibrateLibrary(both, { exceptMeetId: 'meet-new', scope: RAW });

    expect(withIt.meetsRead).toBe(2);
    expect(withoutIt.meetsRead).toBe(1);
    // The figure, not just the count: the excluded meet is the only one contesting
    // the bench, so a report that still has a bench row read it anyway.
    expect(withoutIt.lifts.map((lift) => lift.lift)).toStrictEqual(['squat']);
  });

  it('leaves nothing at all for a first meet', () => {
    // The honest empty answer, and the one the panel has to be able to draw. Its
    // control is the same shelf read without the exclusion.
    const first = shelf([FULL_POWER], 'meet-new');

    expect(calibrateLibrary(first, { exceptMeetId: null, scope: RAW }).lifts).toHaveLength(2);
    expect(calibrateLibrary(first, { exceptMeetId: 'meet-new', scope: RAW }).lifts).toStrictEqual(
      [],
    );
  });
});

describe('the equipment scope', () => {
  const WRAPPED = meetOf({
    id: 'meet-wraps',
    createdAt: 1500,
    history: historyOf([liftOf('squat', 170, 11)], 'wraps'),
  });

  it('reports what it did not read rather than dropping it silently', () => {
    const report = calibrateLibrary(shelf([WRAPPED, SQUAT_ONLY, FULL_POWER]), {
      exceptMeetId: null,
      scope: RAW,
    });

    expect(report.meetsRead).toBe(2);
    expect(report.meetsOutOfScope).toBe(1);
    // 5 rather than 11: the wrapped meet's jumps are the only 11s anywhere in this
    // fixture, so a scope that quietly combined would move this figure.
    expect(report.lifts[0]?.successfulJump.kilograms).toBe(5);
  });

  it('combines only when the lifter said so', () => {
    const report = calibrateLibrary(shelf([WRAPPED, SQUAT_ONLY, FULL_POWER]), {
      exceptMeetId: null,
      scope: COMBINED,
    });

    expect(report.meetsRead).toBe(3);
    expect(report.meetsOutOfScope).toBe(0);
  });

  it('carries the scope it was asked about through an empty shelf', () => {
    // The lifter with no history is the one most likely to wonder why the panel is
    // empty, so the panel has to be able to say which meets it was looking for. A
    // short circuit returning `NO_CALIBRATION` would answer 'unstated' here.
    const report = calibrateLibrary(EMPTY_LIBRARY, { exceptMeetId: null, scope: RAW });

    expect(report.scope).toStrictEqual(RAW);
    expect(report.meetsRead).toBe(0);
    expect(report.strength).toBe('not-enough');
  });
});
