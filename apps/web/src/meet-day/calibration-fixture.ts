// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Histories for §9.4's panel, and the reports they calibrate to.
 *
 * Every report here comes out of `calibrateFrom`, never written as a literal. A
 * `CalibrationReport` literal can hold a state the domain cannot produce -- a
 * median with no observations behind it, an `established` grade off one meet, a
 * cluster of four misses out of three -- and a panel proved to cope with one of
 * those is proved against nothing. It is the same rule `live-fixture.ts` follows
 * for the meet document and for the same reason.
 *
 * The weights are invented (§5.1) and picked so that no two figures on the panel
 * can be confused. Every one of the eight figures a full report carries is
 * distinct: the squat jumps 10 into a made attempt, the bench 5, the deadlift
 * 7.5, and the one missed jump in the history is 12.5 -- so a row reading 12.5
 * says both which lift it came from and which of the two jump questions it
 * answers. The two half-kilogram figures are deliberate: a fixture whose every
 * figure is a round number cannot tell a converted pound reading from a kilogram
 * one, and cannot tell the made jump from the missed one on the lift that has
 * both.
 *
 * WHY THE HISTORIES REPEAT ONE MEET RATHER THAN VARYING
 *
 * Five identical meets put five observations behind every figure, which is
 * `OBSERVATIONS_FOR_A_TREND` exactly, and a sixth would not change a median. So
 * the count is the thing being varied and it is the only thing -- a report that
 * grades `established` in these fixtures does so because of how many meets were
 * read, which is what §9.4's floor is about, rather than because the numbers
 * happened to settle.
 */
import {
  calibrateFrom,
  type CalibrationReport,
  type HistoricLift,
  type HistoricMeet,
  type HistoryScope,
} from '@platform-toolkit/domain';

import type { PlatformLift } from '@platform-toolkit/data-contracts';

export const RAW_ONLY: HistoryScope = { equipment: 'raw', combineEquipment: false };

/** One attempt, as `[kilograms, made]`. A `false` is a strength miss. */
type Take = readonly [number, boolean];

function liftOf(lift: PlatformLift, planned: number | null, takes: readonly Take[]): HistoricLift {
  return {
    lift,
    plannedMaximumKilograms: planned,
    attempts: takes.map(([kilograms, made], index) => ({
      attemptNumber: index + 1,
      kilograms,
      outcome: made ? ('good' as const) : ('no-lift' as const),
      // Every miss here is a strength miss, because that is the only kind
      // `clusterFrom` counts and a fixture mixing the two would have a cluster
      // that moves for a reason no assertion names.
      missReason: made ? null : ('strength' as const),
    })),
  };
}

/**
 * One meet, contested the same way every time.
 *
 * `benchThird` is the one thing that varies, because it is the difference between
 * a lifter with missed jumps and a cluster and a lifter with neither -- and both
 * of those are states the panel has its own sentence for.
 */
function aMeet(meetId: string, benchThird: boolean): HistoricMeet {
  return {
    meetId,
    equipment: 'raw',
    lifts: [
      liftOf('squat', 175, [
        [150, true],
        [160, true],
        [170, true],
      ]),
      liftOf('bench', 117.5, [
        [100, true],
        [105, true],
        [117.5, benchThird],
      ]),
      liftOf('deadlift', 200, [
        [180, true],
        [190, true],
        [197.5, true],
      ]),
    ],
  };
}

/** A meet under wraps, so a raw scope has something to leave out. */
function aWrappedMeet(meetId: string): HistoricMeet {
  return {
    meetId,
    equipment: 'wraps',
    lifts: [
      liftOf('squat', 200, [
        [170, true],
        [185, true],
        [200, true],
      ]),
    ],
  };
}

function meets(count: number, benchThird: boolean): readonly HistoricMeet[] {
  return Array.from({ length: count }, (_unused, index) =>
    aMeet(`meet-${String(index)}`, benchThird),
  );
}

/**
 * A lifter on their first day.
 *
 * Not `NO_CALIBRATION`: the scope has to be the one that was asked about, or the
 * panel tells a raw lifter it found no meets with no equipment recorded.
 */
export function noHistory(): CalibrationReport {
  return calibrateFrom([], RAW_ONLY);
}

/** One earlier meet, which is under §9.4's floor and still carries every figure. */
export function oneMeet(): CalibrationReport {
  return calibrateFrom(meets(1, false), RAW_ONLY);
}

/**
 * Five comparable meets: every figure `established`, and the bench holds the
 * misses.
 *
 * Five strength misses across three contested lifts is an even share of 1.67, so
 * the bench's five clears `CLUSTER_MULTIPLE` comfortably rather than by a
 * rounding, and the cluster sentence is reachable without tuning a threshold.
 */
export function aRecord(): CalibrationReport {
  return calibrateFrom(meets(5, false), RAW_ONLY);
}

/**
 * The same history from a lifter who has never missed.
 *
 * Three of the five figures per lift change: the missed jump has nothing behind
 * it, the third attempts read five of five, and no lift holds a cluster. It is
 * the state whose empty rows most need a sentence -- an absent missed jump is a
 * fact about the lifter, and a blank reads as a figure that failed to load.
 */
export function neverMissed(): CalibrationReport {
  return calibrateFrom(meets(5, true), RAW_ONLY);
}

/** Five raw meets read and two under wraps left on the shelf. */
export function withMeetsOutOfScope(): CalibrationReport {
  return calibrateFrom(
    [...meets(5, false), aWrappedMeet('meet-wraps-a'), aWrappedMeet('meet-wraps-b')],
    RAW_ONLY,
  );
}

/*
 * The lifts of the two meets above, for a caller filing them onto a shelf rather
 * than handing them straight to `calibrateFrom`.
 *
 * A `SavedHistory` is an equipment word and a list of lifts and carries no meet
 * id -- `saved-meet.ts` argues that the saved meet's own id is the meet id and
 * two identifiers that can disagree is one too many -- so the id these builders
 * take is discarded here rather than exposed. What is exported is the part a
 * shelf can hold.
 *
 * Exported so the planner's wiring test seeds its shelf out of the same meets
 * this panel's own suite reads. A second history written by hand in the test
 * file would be a fixture nothing checks against the domain, and the figures it
 * produced could not be compared with anything above.
 */
export function liftsOfAMeet(): readonly HistoricLift[] {
  return aMeet('discarded', false).lifts;
}

/** The wrapped meet's one lift, for a shelf that needs something out of scope. */
export function liftsOfAWrappedMeet(): readonly HistoricLift[] {
  return aWrappedMeet('discarded').lifts;
}
