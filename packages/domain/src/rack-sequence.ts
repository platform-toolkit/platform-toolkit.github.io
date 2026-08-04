// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One warm-up bar, several lifters, and the order to load it in (§21.4).
 *
 * TIMING DECIDES THE ORDER; EFFICIENCY ONLY BREAKS THE TIES
 *
 * The requirement asks for a sequence that minimises plate changes, preserves
 * every lifter's timing, and highlights where those two want different things.
 * Written the obvious way -- find the cheapest order and then check whether it
 * fits -- it becomes a scheduling search whose answer nobody can check, on a
 * screen a coach reads in three seconds while a bar is being loaded behind them.
 *
 * So the priority is fixed the other way round and stated here rather than
 * discovered per case. Sets go in the order they come due. Where the schedule
 * genuinely does not decide -- two sets that could be taken in either order
 * without moving anybody -- the lighter bar goes first, because that is the
 * order that strips no plates. What efficiency would have preferred, and could
 * not have, comes back as an advisory rather than as a silently different plan.
 *
 * THE WEIGHTS ARE NOT THIS MODULE'S TO CHANGE
 *
 * "Never changes a lifter's warm-up weight without approval" is not a check
 * here, it is the absence of a capability: nothing below constructs a `Loading`
 * or a `WarmupSet`. Every weight in the result is one that came in on a
 * schedule, and the only thing that gets decided is what order they happen in
 * and which of them are the same bar. A module that could reweight a set would
 * need that approval modelled, and the honest way to not need it is to not be
 * able to.
 *
 * SHARING IS SOMETHING THE CALLER ASSERTS
 *
 * A rack is a `rackId` on an entry, matched exactly after trimming, the same way
 * §21.2 matches one. A lifter with no rack is not on a shared bar and gets no
 * sequence, because the alternative -- treating "unspecified" as "everyone is on
 * one bar" -- would merge four lifters onto a bar in a room that has four of
 * them, and the result would be a plan that reads perfectly and cannot be
 * carried out. An empty rack list is the right answer to a room nobody has
 * described.
 */
import { plateChange, type Loading, type PlateChange } from './plates.js';
import { timelineWindows, type TimelineWindow, type WarmupTimeline } from './warmup-timeline.js';

/** A lifter queueing for a bar, and the schedule that says when. */
export interface RackEntry {
  readonly lifterId: string;
  readonly warmup?: WarmupTimeline | null | undefined;
  /** Which bar. Trimmed; blank and absent both mean "not on a shared bar". */
  readonly rackId?: string | undefined;
}

export interface RackSequenceRequest {
  readonly entries: readonly RackEntry[];
  readonly now: number;
  /**
   * How far ahead to plan, in seconds.
   *
   * The whole ramp by default. A caller showing one bar's next few loads passes
   * a shorter figure rather than slicing the result, so that the advisories are
   * about the run being displayed and not about loads nobody can see.
   */
  readonly horizonSeconds?: number | undefined;
}

/** One lifter's claim on one load of the bar. */
export interface RackTaker {
  readonly lifterId: string;
  /** Which set of that lifter's ramp this is. */
  readonly warmupIndex: number;
  /** Seconds from `now` until they could start. Negative once that moment has passed. */
  readonly startsInSeconds: number;
  /** Seconds from `now` until the last moment they could still be on the bar. */
  readonly endsInSeconds: number;
  readonly isFinalWarmup: boolean;
}

/** One weight on the bar, and everybody who takes it before it changes. */
export interface RackLoad {
  readonly loading: Loading;
  /**
   * Everyone taking this bar, earliest first.
   *
   * More than one is the saving this module exists to find: two lifters wanting
   * the same weight at overlapping moments is a plate change that never happens.
   */
  readonly takers: readonly RackTaker[];
  /** Plates to move to get here from the load before it. `null` for the first. */
  readonly change: PlateChange | null;
  /** How many plates move, per side, to reach this load. Zero only for the first. */
  readonly plateMoves: number;
  /**
   * Seconds from `now` by which the bar has to be at this weight.
   *
   * The earliest of the takers' starts, not the latest: a bar loaded when the
   * last of them is ready is a bar the first of them stood waiting for.
   */
  readonly dueInSeconds: number;
}

export const RACK_ADVISORIES = [
  /**
   * The bar comes back down. Somewhere in the run a lighter load follows a
   * heavier one, which means stripping plates that go back on afterwards.
   */
  'bar-goes-back-down',
  /**
   * Two lifters want the same weight and cannot have it as one load, because
   * one of them is due to be off the bar before the other can reach it.
   */
  'same-weight-twice',
] as const;

export type RackAdvisoryCode = (typeof RACK_ADVISORIES)[number];

export type RackAdvisorySeverity = 'note' | 'caution';

export interface RackAdvisory {
  readonly code: RackAdvisoryCode;
  readonly severity: RackAdvisorySeverity;
  /** The lifters this is about, in the order their loads occur. */
  readonly lifterIds: readonly string[];
  /**
   * Plates per side this costs that a free hand with the timing would not.
   *
   * The point of the advisory: the number is what a coach is being asked to pay
   * for keeping everybody's warm-up where it is.
   */
  readonly plateMoves: number;
}

/** One bar's worth of plan. */
export interface RackSequence {
  readonly rackId: string;
  readonly loads: readonly RackLoad[];
  /** Plates moved per side across the whole run. */
  readonly plateMoves: number;
  /**
   * What the same sets would cost with nobody sharing anything.
   *
   * Carried so the saving can be shown rather than asserted. Equal to
   * `plateMoves` when the run found nothing to merge, which is a fine answer and
   * not a failure.
   */
  readonly plateMovesUnshared: number;
  readonly advisories: readonly RackAdvisory[];
}

/** A warm-up set on a shared bar, aged and flattened out of its schedule. */
interface Claim {
  readonly lifterId: string;
  /** Where the lifter sat in the request, which is how takers are ordered. */
  readonly position: number;
  readonly warmupIndex: number;
  readonly loading: Loading;
  readonly startsInSeconds: number;
  readonly endsInSeconds: number;
  readonly isFinalWarmup: boolean;
}

/**
 * Every shared bar in the room, and how to load each one.
 *
 * Total: a request with no racks in it, or with racks nobody is warming up on,
 * produces an empty list rather than an error. Racks come back in the order the
 * entries first name them, so a board that lists its lifters in meet order gets
 * its bars in the order those lifters reach them.
 */
export function rackSequences(request: RackSequenceRequest): readonly RackSequence[] {
  const horizonSeconds = request.horizonSeconds ?? Number.POSITIVE_INFINITY;
  const byRack = new Map<string, Claim[]>();

  for (const [position, entry] of request.entries.entries()) {
    const rackId = entry.rackId?.trim() ?? '';
    if (rackId === '' || entry.warmup === null || entry.warmup === undefined) continue;
    for (const window of timelineWindows(entry.warmup, request.now)) {
      const claim = claimOf(entry.lifterId, position, window);
      if (claim === null || claim.startsInSeconds > horizonSeconds) continue;
      const claims = byRack.get(rackId);
      if (claims === undefined) byRack.set(rackId, [claim]);
      else claims.push(claim);
    }
  }

  return [...byRack].map(([rackId, claims]) => sequenceOf(rackId, claims));
}

/**
 * A window's claim on the bar, or `null` for the items that put nothing on it.
 *
 * Equipment and the platform attempt are on the schedule and are not sets, and
 * the test for that is `set`, not `kind`. `warmup-timeline.ts` already refuses to
 * hand a bar load to an item of the wrong kind and says why; asking the same
 * question a second time here would be a second answer to maintain, which is the
 * thing that module was extracted to stop. The index is read separately only
 * because the type cannot express that the two travel together.
 */
function claimOf(lifterId: string, position: number, window: TimelineWindow): Claim | null {
  const warmupIndex = window.item.warmupIndex;
  if (window.set === null || warmupIndex === null) return null;
  return {
    lifterId,
    position,
    warmupIndex,
    loading: window.set.loading,
    startsInSeconds: window.startsInSeconds,
    endsInSeconds: window.endsInSeconds,
    isFinalWarmup: window.isFinalWarmup,
  };
}

function sequenceOf(rackId: string, claims: readonly Claim[]): RackSequence {
  const ordered = [...claims].sort(byDueThenLightest);
  const groups = merge(ordered);

  const loads: RackLoad[] = [];
  let previous: Loading | null = null;
  let plateMoves = 0;
  for (const group of groups) {
    // The earliest taker's loading, not any other member's. One rack has one set
    // of plates, so equal totals are the same plates and the choice is usually
    // moot -- but a caller who built two of these schedules against different
    // implements could produce two ways to make one total, and the plates the
    // first lifter was planned to use are the ones that go on the bar.
    const first = group[0];
    if (first === undefined) continue;
    const change = previous === null ? null : plateChange(previous, first.loading);
    const moves = change === null ? 0 : change.removed.length + change.added.length;
    plateMoves += moves;
    loads.push({
      loading: first.loading,
      takers: [...group].sort(byPosition).map(takerOf),
      change,
      plateMoves: moves,
      dueInSeconds: Math.min(...group.map((claim) => claim.startsInSeconds)),
    });
    previous = first.loading;
  }

  return {
    rackId,
    loads,
    plateMoves,
    plateMovesUnshared: unsharedCost(ordered),
    advisories: advise(loads),
  };
}

/**
 * Due first; where neither is due before the other, the lighter bar first.
 *
 * The second half is the only place efficiency gets a vote, and it only gets one
 * where the schedule has abstained -- two sets sharing a start second can go in
 * either order, and going up rather than down strips no plates.
 */
function byDueThenLightest(left: Claim, right: Claim): number {
  if (left.startsInSeconds !== right.startsInSeconds) {
    return left.startsInSeconds - right.startsInSeconds;
  }
  // No third key. Two sets due the same second at the same weight are one load,
  // and their takers are put back into the caller's order by {@link byPosition}
  // afterwards, so a tiebreak here would decide nothing anybody can see. `sort`
  // is stable, which keeps the result the caller's order in any case.
  return left.loading.total - right.loading.total;
}

function byPosition(left: Claim, right: Claim): number {
  return left.position - right.position;
}

function takerOf(claim: Claim): RackTaker {
  return {
    lifterId: claim.lifterId,
    warmupIndex: claim.warmupIndex,
    startsInSeconds: claim.startsInSeconds,
    endsInSeconds: claim.endsInSeconds,
    isFinalWarmup: claim.isFinalWarmup,
  };
}

/**
 * Adjacent claims on the same weight, gathered into one load.
 *
 * Only adjacent ones, and only where the windows overlap. Reaching further down
 * the run for a third lifter on the same weight would be the cheaper plan and
 * would move somebody's set to get there, which is the one thing §21.4 forbids
 * outright -- so the reach is left undone and reported by {@link advise}.
 */
function merge(ordered: readonly Claim[]): readonly (readonly Claim[])[] {
  const groups: Claim[][] = [];
  let current: Claim[] | null = null;
  let windowEnds = 0;

  for (const claim of ordered) {
    if (current?.[0]?.loading.total === claim.loading.total && claim.startsInSeconds < windowEnds) {
      current.push(claim);
      // The shared window shrinks to whichever taker has to be off the bar
      // first. A third lifter is only on this load if they can reach it before
      // the earliest of the ones already on it has gone.
      windowEnds = Math.min(windowEnds, claim.endsInSeconds);
      continue;
    }
    current = [claim];
    windowEnds = claim.endsInSeconds;
    groups.push(current);
  }
  return groups;
}

/**
 * What the same sets cost if every lifter has the bar to themselves.
 *
 * Each lifter's own ramp, walked in its own order, which is what the plate
 * changes on a `WarmupSet` already describe -- recomputed here rather than
 * summed off the sets because a filtered schedule's first surviving set has a
 * `change` that refers to a set the lifter is no longer taking.
 */
function unsharedCost(ordered: readonly Claim[]): number {
  const previous = new Map<string, Loading>();
  let total = 0;
  for (const claim of ordered) {
    const last = previous.get(claim.lifterId);
    if (last !== undefined) {
      const change = plateChange(last, claim.loading);
      total += change.removed.length + change.added.length;
    }
    previous.set(claim.lifterId, claim.loading);
  }
  return total;
}

/**
 * Where the order that was taken costs more than the order that was not.
 *
 * Both codes are the same fact from two directions -- the schedule wanted a bar
 * somewhere the plate maths did not -- and both are reported, because a coach
 * reading "the bar comes back down" wants to know it is coming down for Bo, and
 * a coach reading "Bo and Cy both want 100" wants to know it is going to be
 * loaded twice.
 */
function advise(loads: readonly RackLoad[]): readonly RackAdvisory[] {
  const advisories: RackAdvisory[] = [];

  for (const [index, load] of loads.entries()) {
    const before = loads[index - 1];
    if (before === undefined) continue;
    if (load.loading.total >= before.loading.total) continue;
    advisories.push({
      code: 'bar-goes-back-down',
      severity: 'note',
      lifterIds: [...lifterIdsOf(before), ...lifterIdsOf(load)],
      plateMoves: load.plateMoves,
    });
  }

  const seen = new Map<number, RackLoad>();
  for (const load of loads) {
    const earlier = seen.get(load.loading.total);
    if (earlier === undefined) {
      seen.set(load.loading.total, load);
      continue;
    }
    advisories.push({
      code: 'same-weight-twice',
      severity: 'caution',
      lifterIds: [...lifterIdsOf(earlier), ...lifterIdsOf(load)],
      // What the second loading costs. Merging the two would have saved this and
      // the change back out of it, but the change out is somebody else's load and
      // is already counted against them.
      plateMoves: load.plateMoves,
    });
    seen.set(load.loading.total, load);
  }

  return advisories;
}

function lifterIdsOf(load: RackLoad): readonly string[] {
  return load.takers.map((taker) => taker.lifterId);
}
