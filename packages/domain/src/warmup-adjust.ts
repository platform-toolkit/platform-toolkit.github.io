// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A lifter's own figures, put back into a ramp the calculator produced.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THAT THE RAMP IS THE PRODUCT
 *
 * The spacing rules in `warmup.ts` are a good general answer and they are a
 * general answer. A lifter with a cranky shoulder wants an extra step on the
 * bench; somebody sharing a rack takes what is already loaded; a coach has a
 * number in mind and does not care where the percentage lands. None of that is
 * the calculator being wrong, and none of it is worth a preference screen.
 *
 * So an adjustment is not a setting. It names one set of one ramp, it lasts
 * exactly as long as that ramp does, and everything downstream of it is
 * recomputed rather than patched -- which is the whole reason this is arithmetic
 * in the domain instead of a number substituted in a template. A set moved by
 * hand changes what plates come off before the next one, and a checklist still
 * saying "add 20 per side" under a set the lifter just moved is worse than
 * having offered no adjustment at all.
 *
 * WHAT AN ADJUSTMENT IS NOT ALLOWED TO DO
 *
 * It cannot name a weight the rack cannot build: the request is resolved to the
 * nearest loadable total, the same search the ramp itself uses. It cannot touch
 * the working weight, which is the lifter's own figure already. And it cannot
 * reorder the ramp -- a set nudged past its neighbour stays where it is in the
 * list, and the plate change under it says to take weight off. That reads
 * strangely, and it reads strangely because it is strange; hiding it by
 * resorting would move a set the lifter is looking at.
 */
import {
  buildLoadingTable,
  findLoading,
  plateChange,
  type BarbellSetup,
  type Loading,
  type LoadingTable,
} from './plates.js';
import type { WarmupPlan, WarmupSet } from './warmup.js';

/** One warm-up set the lifter has given their own weight for. */
export interface WarmupAdjustment {
  /** Which set of `plan.warmups`. */
  readonly index: number;
  /** What they want on the bar, in the plate unit. Resolved to what loads. */
  readonly total: number;
}

/**
 * The least headroom worth building above the heaviest thing in play, so that a
 * nudge upwards has somewhere to go.
 *
 * A floor rather than the whole answer -- see `headroomFor`.
 */
const MINIMUM_SEARCH_HEADROOM = 50;

/**
 * How far above the ramp to enumerate loadings, so the step up is never missed.
 *
 * A fixed figure gets this wrong on exactly the racks that need the control
 * most. One step is as large as the coarsest plate on the rack, so a home gym
 * with nothing but 45 lb plates steps in ninetys -- and a table built fifty
 * above the working weight then holds nothing at all above the top warm-up, so
 * `Raise` draws itself disabled beside a rack with another plate plainly on it.
 * Two of the heaviest denomination is exactly one step from anywhere, and the
 * floor keeps a rack of nothing but small plates from enumerating a table that
 * stops between two of them.
 *
 * A denomination the lifter has none of is not on the rack, and sizing the
 * search from one would build a table reaching past every weight that can
 * actually be made.
 */
function headroomFor(setup: BarbellSetup): number {
  const available = setup.plates.filter((plate) => plate.pairs !== 0).map((plate) => plate.weight);
  return Math.max(MINIMUM_SEARCH_HEADROOM, 2 * Math.max(0, ...available));
}

function tableFor(plan: WarmupPlan, adjustments: readonly WarmupAdjustment[]): LoadingTable {
  const ceiling = Math.max(
    plan.working.total,
    ...plan.warmups.map((set) => set.loading.total),
    ...adjustments.map((adjustment) => adjustment.total),
  );
  return buildLoadingTable(plan.setup, ceiling + headroomFor(plan.setup));
}

/**
 * Whether a set may be given a weight of the lifter's own.
 *
 * The bar-only sets may not. There is nothing to adjust -- the weight is the
 * implement -- and offering a control that cannot move is worse than offering
 * none.
 */
export function isAdjustable(set: WarmupSet): boolean {
  return set.stage !== 'empty-implement';
}

/**
 * The ramp with the lifter's figures in it, and every plate change recomputed.
 *
 * An adjustment naming a set that is not there, or one the rack cannot get near,
 * is dropped rather than reported: these arrive from stored state written
 * against a ramp that has since changed shape, and a warning about a set the
 * lifter cannot see is a warning about nothing.
 */
export function adjustWarmups(
  plan: WarmupPlan,
  adjustments: readonly WarmupAdjustment[],
): WarmupPlan {
  if (adjustments.length === 0) return plan;

  const table = tableFor(plan, adjustments);
  const wanted = new Map(adjustments.map((adjustment) => [adjustment.index, adjustment.total]));

  let previous: Loading = plan.emptyImplement;
  const warmups: WarmupSet[] = [];
  for (const [index, set] of plan.warmups.entries()) {
    const request = wanted.get(index);
    const moved =
      request === undefined || !isAdjustable(set)
        ? set.loading
        : (findLoading(table, request) ?? set.loading);
    warmups.push({ ...set, loading: moved, change: plateChange(previous, moved) });
    previous = moved;
  }

  const load = plan.working.load;
  return {
    ...plan,
    warmups,
    working: {
      ...plan.working,
      // Still `null` where it was `null`. A working weight the plates cannot
      // build has no change to describe no matter what the ramp below it does.
      change: load.kind === 'loadable' ? plateChange(previous, load.loading) : null,
    },
  };
}

/** The next loadable weight either side of one warm-up set. */
export interface WarmupStep {
  /** Which set of `plan.warmups`. */
  readonly index: number;
  /** What is on the bar for it now. */
  readonly total: number;
  /** The next loadable total below, or `null` when the set is already the bar. */
  readonly down: number | null;
  /** The next loadable total above, or `null` when the rack has nothing more. */
  readonly up: number | null;
}

function stepsAround(table: LoadingTable, from: number): Pick<WarmupStep, 'down' | 'up'> {
  return {
    down: findLoading(table, from, { bound: 'at-most', below: from })?.total ?? null,
    up: findLoading(table, from, { bound: 'at-least', above: from })?.total ?? null,
  };
}

/**
 * The next loadable weight above or below one warm-up set, or `null` at the end.
 *
 * A step rather than a typed figure, because this is used between sets on a
 * phone: a stepper cannot be mistyped, cannot name an unloadable weight, and
 * does not summon a keyboard over the checklist being read. What counts as one
 * step is the rack's own answer -- the next total these plates can make -- so a
 * gym with quarter-pound plates steps in quarters and a gym with nothing under
 * ten steps in twenties, which is in both cases the smallest real change.
 */
export function nudgeWarmup(plan: WarmupPlan, index: number, direction: -1 | 1): number | null {
  const set = plan.warmups[index];
  if (set === undefined || !isAdjustable(set)) return null;

  const from = set.loading.total;
  const steps = stepsAround(tableFor(plan, [{ index, total: from }]), from);
  return direction === 1 ? steps.up : steps.down;
}

/**
 * Both steps for every set a lifter may move, from one search of the rack.
 *
 * `nudgeWarmup` answers a single press and enumerates the plates to do it, which
 * is the wrong shape for *drawing* the control: a seven-rung ramp asks fourteen
 * questions at once, and fourteen walks of every combination a rack can make is
 * work a phone does between a keystroke and a repaint. The answers are identical
 * -- both search the same table -- so a caller that has one of these may use it
 * for every row rather than calling the singular form in a loop.
 */
export function warmupSteps(plan: WarmupPlan): readonly WarmupStep[] {
  const table = tableFor(plan, []);
  const steps: WarmupStep[] = [];
  for (const [index, set] of plan.warmups.entries()) {
    if (!isAdjustable(set)) continue;
    const total = set.loading.total;
    steps.push({ index, total, ...stepsAround(table, total) });
  }
  return steps;
}
