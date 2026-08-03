// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What can actually be loaded on a bar, and which plates make it.
 *
 * This is the part of a warm-up calculator that has to be right. A ramp that
 * suggests 87.5 kg when the gym's smallest plate is 5 kg is not a rounding
 * error; it is a lifter standing at a bar unable to build the number on the
 * screen. So nothing here returns a target and hopes: every total this module
 * produces comes with the plates that make it, and a total with no plates behind
 * it is not returned at all.
 *
 * ARITHMETIC IS INTEGER, DELIBERATELY
 *
 * Plate weights are exact multiples of a hundredth of their unit -- 1.25 lb,
 * 0.5 kg -- and the sums are compared for equality constantly. In binary
 * floating point 0.1 + 0.2 is not 0.3, and a plate table built by repeated
 * addition drifts far enough to make two identical loadings compare unequal and
 * appear twice in a ramp. Everything on the plate side of the calculation is
 * therefore an integer count of hundredths.
 *
 * The bar is the exception and cannot be one. A 45 lb bar with kilogram plates
 * weighs 20.41165665 kg, which is not a multiple of anything, so the bar and the
 * collars stay a real number and are added once at the end. That single addition
 * cannot accumulate.
 *
 * SYMMETRY IS ASSUMED THROUGHOUT
 *
 * Every loading is the same on both sides, so the search is over one side and
 * the total is the bar plus twice the side. There is no asymmetric loading in
 * this collection and there should not be one: it is a way to injure somebody.
 */
import { convertWeight, type Weight, type WeightUnit } from './weight.js';

/** One size of plate, and how many pairs of it exist. */
export interface PlateDenomination {
  /** The weight of a single plate, in the setup's plate unit. */
  readonly weight: number;
  /**
   * Pairs available, or `null` for "as many as needed".
   *
   * `null` rather than a large number, because "I did not count" and "I counted
   * ninety-nine" are different claims and only one of them should let the
   * calculator promise a loading.
   */
  readonly pairs: number | null;
  /**
   * Whether this plate stands the bar at competition height.
   *
   * Only the deadlift family cares, and only about the first warm-up: a pull
   * from a bar sitting two inches low is a different movement. A gym with
   * nothing but small iron cannot make a full-diameter light set, and the
   * honest answer there is to say so rather than to pretend.
   */
  readonly fullDiameter: boolean;
}

/** A bar, its collars, and the plates available for it. */
export interface BarbellSetup {
  /** The unit the plates are marked in, and the unit totals are computed in. */
  readonly plateUnit: WeightUnit;
  /** The bar, which may legitimately be marked in the other unit. */
  readonly bar: Weight;
  /**
   * The collar pair's total contribution, which is commonly zero.
   *
   * Zero is the default because most collars are spring clips weighing nothing
   * worth counting. Competition collars are 2.5 kg each and change every
   * reachable combination, which is why this is part of the setup rather than a
   * note beside it.
   */
  readonly collars: Weight;
  readonly plates: readonly PlateDenomination[];
}

/** A total that can be loaded, and the plates on one side that make it. */
export interface Loading {
  /** The total, in the plate unit, including bar and collars. */
  readonly total: number;
  /**
   * Plates on **one** side, heaviest first.
   *
   * Heaviest first is both the loading order -- big plates nearest the collar --
   * and the order the display uses, so there is one order and not two.
   */
  readonly perSide: readonly number[];
}

/**
 * Every loadable total from the empty implement up to a ceiling.
 *
 * Built once and queried many times: a single ramp asks for the nearest loadable
 * total half a dozen times, and rebuilding the search for each would be the same
 * work repeated.
 */
export interface LoadingTable {
  readonly setup: BarbellSetup;
  /** Ascending by total. The first entry is always the empty implement. */
  readonly loadings: readonly Loading[];
}

const HUNDREDTHS = 100;

/**
 * The most plates this will put on one side.
 *
 * Not a performance guard -- the search is small either way -- but a statement
 * about what counts as an answer. Twenty plates a side is already past anything
 * a person loads; a total reachable only beyond that is reported as unreachable,
 * which is closer to the truth than a diagram nobody could build before the gym
 * closed.
 */
const MAX_PLATES_PER_SIDE = 20;

function toHundredths(value: number, what: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Expected a finite ${what}, received ${String(value)}`);
  }
  // Rounded rather than truncated: 1.25 * 100 is 124.99999999999999 in binary
  // floating point, and truncation would turn a 1.25 lb plate into 1.24 lb.
  const scaled = Math.round(value * HUNDREDTHS);
  if (Math.abs(scaled - value * HUNDREDTHS) > 1e-6) {
    throw new RangeError(`A ${what} must be a whole number of hundredths, received ${value}`);
  }
  return scaled;
}

/**
 * The bar plus any accounted-for collars, in the plate unit.
 *
 * The floor of everything else here. No warm-up is ever below it, because there
 * is no way to put less than this on the platform.
 */
export function emptyImplement(setup: BarbellSetup): number {
  return (
    convertWeight(setup.bar, setup.plateUnit).amount +
    convertWeight(setup.collars, setup.plateUnit).amount
  );
}

/** A per-side plate multiset under construction, in hundredths, descending. */
interface Combination {
  readonly perSide: readonly number[];
}

/**
 * Whether `candidate` is the better way to reach a total than `incumbent`.
 *
 * Two rules, in order. Fewer plates wins, because every plate is a plate to
 * fetch, lift, and put back. Among equal counts, the combination using bigger
 * plates wins -- 25 + 5 over 20 + 10 -- which is both what a lifter reaches for
 * and what keeps the heavy plates against the collar where they belong.
 *
 * No third rule is needed, and that is worth stating rather than leaving to be
 * rediscovered: two *different* multisets of the same size, both sorted
 * descending, cannot compare equal, because the first position where they differ
 * decides it. The comparison is total, so the result is deterministic without a
 * tie-breaker bolted on the end.
 */
function isBetter(candidate: Combination, incumbent: Combination): boolean {
  if (candidate.perSide.length !== incumbent.perSide.length) {
    return candidate.perSide.length < incumbent.perSide.length;
  }
  for (let index = 0; index < candidate.perSide.length; index += 1) {
    const left = candidate.perSide[index] ?? 0;
    const right = incumbent.perSide[index] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return false;
}

/**
 * Builds the table of loadable totals.
 *
 * A layered search, largest denomination first: each layer decides how many
 * pairs of one size to use and keeps only the best combination found so far for
 * each reachable side total.
 *
 * Keeping only the best per total is safe, and the reason is not obvious. A
 * later layer appends only smaller plates, and it appends the *same* suffix
 * whichever prefix it is extending, since only the remaining side total decides
 * what the suffix must be. Appending equal suffixes to two combinations does not
 * reorder them under the comparison above: a shorter one stays shorter, and two
 * of equal length still differ first at the position they differed at before.
 * So a combination that loses here cannot win later, and discarding it loses
 * nothing.
 */
export function buildLoadingTable(setup: BarbellSetup, maxTotal: number): LoadingTable {
  const base = emptyImplement(setup);
  // The most one side may hold. Everything above this is beyond what was asked
  // for, and searching it would be work with nothing to show for it.
  const sideCap = Math.max(0, Math.floor(((maxTotal - base) / 2) * HUNDREDTHS));

  // Descending, so combinations are built heaviest-first and stay sorted with no
  // sort step -- which is also what makes the lexicographic comparison valid.
  const denominations = [...setup.plates]
    .filter((plate) => plate.weight > 0 && plate.pairs !== 0)
    .map((plate) => ({
      hundredths: toHundredths(plate.weight, 'plate weight'),
      pairs: plate.pairs,
    }))
    .sort((left, right) => right.hundredths - left.hundredths);

  let reachable = new Map<number, Combination>([[0, { perSide: [] }]]);

  for (const denomination of denominations) {
    const next = new Map<number, Combination>();
    for (const [sideTotal, combination] of reachable) {
      const limit = denomination.pairs ?? Number.POSITIVE_INFINITY;
      for (let used = 0; used <= limit; used += 1) {
        const total = sideTotal + used * denomination.hundredths;
        if (total > sideCap || combination.perSide.length + used > MAX_PLATES_PER_SIDE) {
          break;
        }
        const candidate: Combination =
          used === 0
            ? combination
            : {
                perSide: [
                  ...combination.perSide,
                  ...Array.from({ length: used }, () => denomination.hundredths),
                ],
              };
        const incumbent = next.get(total);
        if (incumbent === undefined || isBetter(candidate, incumbent)) {
          next.set(total, candidate);
        }
      }
    }
    reachable = next;
  }

  const loadings = [...reachable.entries()]
    .sort(([left], [right]) => left - right)
    .map(([sideTotal, combination]) => ({
      total: base + (sideTotal * 2) / HUNDREDTHS,
      perSide: combination.perSide.map((hundredths) => hundredths / HUNDREDTHS),
    }));

  return { setup, loadings };
}

/** Which side of the target an answer may fall on. */
export type LoadingBound =
  /** Closest in either direction; a tie goes to the lighter load. */
  | 'nearest'
  /** Closest without going over. */
  | 'at-most'
  /** Closest without going under. */
  | 'at-least';

export interface FindLoadingOptions {
  readonly bound?: LoadingBound;
  /** Reject anything at or below this total. Used to keep a ramp increasing. */
  readonly above?: number;
  /** Reject anything at or above this total. Used to keep warm-ups under work. */
  readonly below?: number;
  /**
   * Require at least one full-diameter plate per side.
   *
   * The deadlift's first warm-up only. A bar sitting low is a different pull,
   * and a calculator that silently substitutes small plates has changed the
   * exercise without saying so.
   */
  readonly fullDiameter?: boolean;
}

/**
 * A tolerance for comparing totals that came from different arithmetic.
 *
 * A target is usually a percentage of a typed number and a total is a bar plus
 * an integer count of hundredths, so two figures that represent the same weight
 * can differ in the last bits. A tenth of a hundredth is far below any plate and
 * far above the error.
 *
 * Exported because the ramp rules compare the same totals -- a warm-up that must
 * be strictly above the last one and strictly below the working weight is the
 * same comparison arriving from outside. Two modules comparing the same numbers
 * with two different tolerances would disagree about whether a set is a
 * duplicate, and only for the handful of weights that land between the two.
 */
export const LOADING_TOLERANCE = 1e-3;
const COMPARISON_SLACK = LOADING_TOLERANCE;

/**
 * The loadable total closest to a target, subject to the given constraints, or
 * `null` when the constraints admit nothing.
 *
 * `null` is a real answer here and callers must handle it: a gym with no plates
 * has exactly one loadable weight, and asking for something above it should say
 * so rather than return the bar and let a ramp show it three times.
 */
export function findLoading(
  table: LoadingTable,
  target: number,
  options: FindLoadingOptions = {},
): Loading | null {
  const { bound = 'nearest', above, below, fullDiameter = false } = options;
  const fullDiameterWeights = fullDiameter ? fullDiameterHundredths(table.setup) : null;

  let best: Loading | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const loading of table.loadings) {
    if (above !== undefined && loading.total <= above + COMPARISON_SLACK) continue;
    if (below !== undefined && loading.total >= below - COMPARISON_SLACK) continue;
    if (bound === 'at-most' && loading.total > target + COMPARISON_SLACK) continue;
    if (bound === 'at-least' && loading.total < target - COMPARISON_SLACK) continue;
    if (fullDiameterWeights !== null && !hasFullDiameter(loading, fullDiameterWeights)) continue;

    const distance = Math.abs(loading.total - target);
    // Strictly closer, so an exact tie keeps the first match. The table is
    // ascending, so the first match is the lighter one -- which is the rule: a
    // warm-up exists to prepare the working set, not to compete with it.
    if (distance < bestDistance - COMPARISON_SLACK) {
      best = loading;
      bestDistance = distance;
    }
  }

  return best;
}

function fullDiameterHundredths(setup: BarbellSetup): ReadonlySet<number> {
  return new Set(
    setup.plates
      .filter((plate) => plate.fullDiameter && plate.pairs !== 0)
      .map((plate) => toHundredths(plate.weight, 'plate weight')),
  );
}

function hasFullDiameter(loading: Loading, weights: ReadonlySet<number>): boolean {
  return loading.perSide.some((weight) => weights.has(Math.round(weight * HUNDREDTHS)));
}

/** What to take off and what to put on, per side, to get from one load to another. */
export interface PlateChange {
  /** Plates to remove from each side, heaviest first. */
  readonly removed: readonly number[];
  /** Plates to add to each side, heaviest first. */
  readonly added: readonly number[];
}

/**
 * The difference between two loadings, as plates to move.
 *
 * A multiset difference rather than a subtraction of totals, because "add 20 per
 * side" and "remove 10, add 25 per side" are different amounts of work and the
 * second is the one a lifter needs warning about. Plates common to both sides of
 * the change stay on the bar and are not mentioned.
 */
export function plateChange(from: Loading, to: Loading): PlateChange {
  const remaining = new Map<number, number>();
  for (const weight of from.perSide) {
    const key = Math.round(weight * HUNDREDTHS);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const added: number[] = [];
  for (const weight of to.perSide) {
    const key = Math.round(weight * HUNDREDTHS);
    const available = remaining.get(key) ?? 0;
    if (available > 0) {
      remaining.set(key, available - 1);
    } else {
      added.push(weight);
    }
  }

  const removed: number[] = [];
  for (const [key, count] of remaining) {
    for (let index = 0; index < count; index += 1) {
      removed.push(key / HUNDREDTHS);
    }
  }

  const heaviestFirst = (left: number, right: number): number => right - left;
  return { removed: removed.sort(heaviestFirst), added: added.sort(heaviestFirst) };
}
