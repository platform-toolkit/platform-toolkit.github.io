// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading a warm-up schedule at an instant that is not the one it was built at.
 *
 * ONE PLACE, BECAUSE THREE READERS
 *
 * `meet-warmup.ts` is deliberately clock-free: it reports everything as seconds
 * from a now it never asks for. Three modules need to know where a schedule has
 * got to -- the board (§21), the conflict warnings (§21.2), and the shared rack
 * sequence (§21.4) -- and each one of them would otherwise subtract the same two
 * numbers in its own way. They did, twice, and the arithmetic agreed by luck
 * rather than by construction: a board that thought an item was behind the
 * lifter while a warning still thought it was ahead would put a red mark on a row
 * that had nothing on it, and there is no test that could catch it in either
 * module alone.
 *
 * BEHIND IS MEASURED AT THE LATEST FINISH, DUE AT THE EARLIEST START
 *
 * The two ends of an item are deliberately read from opposite ends of its range.
 * An item stays visible for as long as it could still be the thing the lifter is
 * doing, so the drop test uses the latest moment it could be running. The figure
 * that comes back is the earliest moment it could start, because being ready
 * early costs a lifter a few minutes standing about and being ready late costs
 * them the attempt.
 */
import type { WarmupSet } from './warmup.js';
import type { MeetWarmupSchedule, ScheduledItem } from './meet-warmup.js';

/**
 * A warm-up schedule and the instant its seconds were counted from.
 *
 * Rebuilding the schedule every paint instead would be correct and would re-run
 * the ramp, the plate maths and the platform estimate four times a second for
 * every lifter on the board.
 */
export interface WarmupTimeline {
  readonly schedule: MeetWarmupSchedule;
  readonly builtAt: number;
}

/** A scheduled item, aged against the instant its schedule was counted from. */
export interface TimelineWindow {
  readonly item: ScheduledItem;
  /** Seconds until it could start. Negative once that moment has passed. */
  readonly startsInSeconds: number;
  /** Seconds until the last moment it could still be running. Always above zero. */
  readonly endsInSeconds: number;
  /** The warm-up set this item performs, or `null` for the items that perform none. */
  readonly set: WarmupSet | null;
  /**
   * Whether this is the last set of the ramp.
   *
   * Read from the plan rather than from a count of the items, because a caller
   * is free to hand over a schedule whose items have been filtered -- and the
   * final warm-up is the one §21 and §21.2 both single out, so getting it from
   * the shorter list would quietly promote whatever set happened to survive.
   */
  readonly isFinalWarmup: boolean;
}

/**
 * Everything on the schedule that is not behind the lifter, soonest first.
 *
 * Total and allocation-only: a schedule whose every item has gone by produces an
 * empty list rather than an error, which is the honest answer for a lifter who
 * has finished.
 */
export function timelineWindows(timeline: WarmupTimeline, now: number): readonly TimelineWindow[] {
  const elapsedSeconds = (now - timeline.builtAt) / 1000;
  const finalIndex = timeline.schedule.plan.warmups.length - 1;
  const windows: TimelineWindow[] = [];
  for (const item of timeline.schedule.items) {
    const endsInSeconds = item.startsInSeconds.latestSeconds + item.seconds - elapsedSeconds;
    if (endsInSeconds <= 0) continue;
    // Read once and used twice, because the two fields below both answer a
    // question about the same index and answering it in two places is how they
    // come to disagree. An item that is not a warm-up set has no business
    // pointing at one -- `ScheduledItem` says so -- but the field is a plain
    // number on a plain interface, so the guard belongs here rather than in the
    // hope that every caller honours the doc comment. Guarding only the final-set
    // test, which is how this started, gives a wraps item a bar load out of
    // `set` while denying it the urgency that load implies: the rack sequence
    // would plan plate changes for a set nobody is lifting.
    const warmupIndex = item.kind === 'warm-up-set' ? item.warmupIndex : null;
    windows.push({
      item,
      startsInSeconds: item.startsInSeconds.earliestSeconds - elapsedSeconds,
      endsInSeconds,
      set: warmupIndex === null ? null : (timeline.schedule.plan.warmups[warmupIndex] ?? null),
      isFinalWarmup: warmupIndex === finalIndex,
    });
  }
  return windows;
}

/** The first thing on the schedule that is not behind the lifter, or `null`. */
export function nextWindow(timeline: WarmupTimeline, now: number): TimelineWindow | null {
  return timelineWindows(timeline, now)[0] ?? null;
}
