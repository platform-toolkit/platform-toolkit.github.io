// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Warm-up ramps: turning a planned working weight into sets a lifter can load.
 *
 * The rules here are product rules. Published warm-up guidance varies widely
 * -- some examples finish on a double, some on a single -- and the requirements
 * settle those variations deliberately rather than leaving the calculator to
 * pick differently on different days. Where this file names a percentage, that
 * percentage is a decision, not a measurement, and it is written as a named
 * constant so it can be found and changed in one place.
 *
 * WHAT THIS MODULE GUARANTEES
 *
 * Four properties hold for every plan it returns, and the shape of the code is
 * arranged so none of them can be broken by adding a family later:
 *
 *   1. Every warm-up is loadable with the equipment given. Not "close to
 *      loadable" -- the plates come back with it.
 *   2. Warm-ups strictly increase. A ramp that steps down is a lifter unracking
 *      a bar lighter than the one they just did.
 *   3. Every warm-up is strictly below the working weight.
 *   4. The same inputs give the same plan, always.
 *
 * All four fall out of one place: `add` below resolves every stage through
 * `findLoading` with `above` pinned to the previous set and `below` pinned to
 * the working weight. A stage that cannot satisfy that is dropped, which is also
 * how the requirements say to handle a plate set too coarse to fit a stage into
 * -- fewer sets, never a repeated one.
 *
 * THE WORKING WEIGHT IS NOT A WARM-UP
 *
 * It is what the lifter typed, and it is shown exactly as typed even when the
 * plates cannot make it. That is deliberate: silently moving somebody's planned
 * weight by a kilogram and a half is worse than telling them it will not load
 * and offering the two totals either side of it.
 */
import {
  LOADING_TOLERANCE,
  buildLoadingTable,
  emptyImplement,
  findLoading,
  plateChange,
  type BarbellSetup,
  type Loading,
  type LoadingBound,
  type LoadingTable,
  type PlateChange,
} from './plates.js';
import { roundToIncrement } from './rounding.js';
import type { WeightUnit } from './weight.js';

/**
 * The code that builds a ramp.
 *
 * Two constants rather than one, because a stored plan is asked two different
 * questions later and a single number answers neither well. This one moves when
 * the *shape* of the output can change for unchanged rules -- a fixed search, a
 * new stage, a different tie-break -- and {@link WARMUP_RULESET_VERSION} moves
 * when a percentage, a cap, a share or a rep scheme changes. A lifter looking at
 * a plan generated last spring wants to know which of those happened: the second
 * means the recommendation itself was revised, the first means it was not.
 *
 * Whichever one an edit here touches, move it in the same commit. A stored plan
 * that claims a version it was not produced under is worse than one claiming
 * none, because it will be believed.
 */
export const WARMUP_ENGINE_VERSION = 'warmup-engine-2026.1';

/**
 * The numbers the ramp is built from.
 *
 * Every named constant below this line is in scope: the family caps, the shares,
 * the ramp bounds, the step, the rep schemes and the defaults. They are product
 * decisions rather than measurements -- see the header -- so a change to one of
 * them changes what the tool recommends, and a consumer that froze a plan is
 * entitled to know that its advice is no longer the current advice.
 */
export const WARMUP_RULESET_VERSION = 'warmup-rules-2026.1';

/**
 * Which ramp a lift uses.
 *
 * Families rather than per-lift formulas, because the sources do not publish a
 * unique warm-up percentage for every assistance movement and inventing one per
 * lift would be dressing a guess up as a rule.
 */
export type WarmupFamily =
  /** Squat, bench press, overhead press, and their variants. Two bar-only sets, then 5/3/1. */
  | 'squat-press'
  /** Deadlift and floor-pull variants. No bar-only sets, a full-diameter start, capped jumps. */
  | 'deadlift'
  /** Rows and shrugs: deadlift-style jumps, but the bar's height off the floor does not matter. */
  | 'pull'
  /** Power clean, snatch, jerk. Technique work: light implement, then 3 - 2 - 1. */
  | 'olympic'
  /** Curls, extensions, good mornings. One light set, one intermediate, then work. */
  | 'assistance';

/** Where a set sits in the ramp. Used for wording, not for arithmetic. */
export type WarmupStage =
  /** Bar and collars, no plates. */
  | 'empty-implement'
  /** The first weighted set. */
  | 'first'
  /** A set between the first and the last. */
  | 'middle'
  /** A single added only to keep a jump within one full plate per side. */
  | 'inserted'
  /** The last warm-up before the working sets. */
  | 'final';

/** One set of the ramp, with the plates that make it. */
export interface WarmupSet {
  readonly stage: WarmupStage;
  readonly loading: Loading;
  readonly reps: number;
  /**
   * How many times to perform this identical set.
   *
   * Only the empty implement ever exceeds one. Named `count` rather than `sets`
   * to keep it distinct from the working prescription: this number is the
   * calculator's decision, that one is the lifter's.
   */
  readonly count: number;
  /**
   * Plates to move, per side, to get here from the previous set.
   *
   * Carried on the set rather than left to the caller because "remove 10, add
   * 25" and "add 20" are different amounts of work at the rack, and a caller
   * subtracting totals could only ever produce the second wording.
   */
  readonly change: PlateChange;
}

/**
 * Whether the entered working weight can actually be built.
 *
 * A union rather than a nullable `loading` beside two nullable neighbours, so a
 * caller cannot render plates for a weight that has none.
 */
export type WorkingSetLoad =
  | { readonly kind: 'loadable'; readonly loading: Loading }
  | {
      readonly kind: 'not-loadable';
      /** The nearest loadable total strictly below, or `null` if there is none. */
      readonly below: Loading | null;
      /** The nearest loadable total strictly above, or `null` if there is none. */
      readonly above: Loading | null;
    };

/** The working sets: exactly what was entered, plus whether it will load. */
export interface WorkingSetPlan {
  /** The total the lifter entered, unmodified. */
  readonly total: number;
  readonly sets: number;
  readonly reps: number;
  readonly load: WorkingSetLoad;
  /** Plates to move, per side, from the last warm-up -- when the weight loads. */
  readonly change: PlateChange | null;
}

/**
 * Something the lifter should be told, which is not a reason to refuse a plan.
 *
 * Distinct from `WarmupProblem` on purpose. A problem means there is no plan; an
 * advisory means there is a plan and something about it is worth a sentence. The
 * requirements are explicit that an unloadable working weight is warned about
 * and not blocked.
 */
export type WarmupAdvisoryCode =
  /** The entered weight cannot be built. `WorkingSetLoad` carries the neighbours. */
  | 'working-weight-not-loadable'
  /** The entered weight is at or below the bar and collars, so there is nothing to ramp. */
  | 'working-weight-at-or-below-implement'
  /** No plates are available, so the empty implement is the only loadable weight. */
  | 'no-plates-available'
  /** No full-diameter plate could start the pull, so the bar will sit low. */
  | 'full-diameter-unavailable'
  /** The plates are too coarse to keep every jump within one full plate per side. */
  | 'jump-exceeds-full-plate';

export interface WarmupAdvisory {
  readonly code: WarmupAdvisoryCode;
}

export interface WarmupPlan {
  readonly family: WarmupFamily;
  readonly setup: BarbellSetup;
  /** The bar and collars with no plates: the floor of everything in the plan. */
  readonly emptyImplement: Loading;
  readonly warmups: readonly WarmupSet[];
  readonly working: WorkingSetPlan;
  readonly advisories: readonly WarmupAdvisory[];
}

/** Why no plan could be produced at all. Always input, never equipment. */
export type WarmupProblemCode =
  | 'working-weight-not-a-number'
  | 'working-weight-not-positive'
  | 'working-sets-not-a-positive-whole-number'
  | 'working-reps-not-a-positive-whole-number'
  | 'equipment-weight-not-a-number';

export interface WarmupProblem {
  readonly code: WarmupProblemCode;
}

export interface WarmupRequest {
  readonly setup: BarbellSetup;
  readonly family: WarmupFamily;
  /** The planned total, in the setup's plate unit, including bar and collars. */
  readonly workingWeight: number;
  /** Working sets. Optional in the interface, defaulted here. */
  readonly workingSets?: number;
  readonly workingReps?: number;
}

export type WarmupPlanResult =
  | { readonly ok: true; readonly plan: WarmupPlan }
  | { readonly ok: false; readonly problems: readonly WarmupProblem[] };

/**
 * One full plate per side, by unit.
 *
 * The requirements define the term: 25 kg or 45 lb. It is the preferred first
 * warm-up, and it is also the largest jump a pull may take -- the same plate
 * playing both parts, which is why it is one constant.
 */
const FULL_PLATE: Readonly<Record<WeightUnit, number>> = { kg: 25, lb: 45 };

/**
 * Full-diameter starting plates, heaviest first.
 *
 * The pull starts from a bar at competition height, so the first warm-up is
 * chosen by plate diameter first and percentage second. A lighter start built
 * from small plates puts the bar two inches low, which makes the first pull a
 * different movement from the one being warmed up for.
 */
const DEADLIFT_START_PLATES: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 10],
  lb: [45, 25, 10],
};

/** Above this share of the working weight, one full plate is too heavy to open with. */
const SQUAT_PRESS_FIRST_CAP = 0.4;

/** Above this share of the working weight, the pull opens on a smaller plate. */
const DEADLIFT_FIRST_CAP = 0.5;

/** The last warm-up, everywhere it exists. */
const FINAL_WARMUP_SHARE = 0.9;

/**
 * HOW THE BARBELL RAMPS ARE SPACED, AND WHY IT IS NOT A LIST OF PERCENTAGES
 *
 * The slow lifts and the pulls used to warm up in a fixed three sets aimed at
 * shares of the working weight. That is right in the middle of the range and
 * wrong at both ends, because a share of the working weight is not a share of
 * the work: the bar is already on the lifter's back before the first plate goes
 * on. A 100 lb working weight on a 45 lb bar has 55 lb of ramp in it, and
 * dividing the 100 into thirds names openers below the bar. A 400 lb working
 * weight has 355 lb of ramp and three sets leave 80 lb jumps in it.
 *
 * So the ramp is spaced over what is actually being ramped -- the distance from
 * the empty implement to the last warm-up -- and the number of sets is drawn
 * from how far that is in full plates. Three sets for a short ramp, seven for
 * the longest one, and the bounds are there because a warm-up with two sets has
 * not warmed anything up and one with eight has become the workout.
 *
 * The spacing itself is deliberately uneven. Jumps get smaller as the weight
 * gets heavier, which is what every lifter does by hand and the reason is
 * mechanical rather than aesthetic: the ramp exists to prepare for the top set,
 * so the sets near the top are the informative ones. An exponent below one bends
 * the even spacing that way; 0.7 is the value that reproduces the ladders
 * lifters write for themselves at the weights they most often write them for.
 */
const RAMP_CURVE_EXPONENT = 0.7;

/** Fewer than this and nothing has been warmed up; more and it is the session. */
const MIN_RAMP_SETS = 3;
const MAX_RAMP_SETS = 7;

/**
 * The step every warm-up target is rounded to before the plates are searched.
 *
 * A warm-up is a round number. Nobody loads 65.75 lb on the way to a hundred,
 * and the reason is not fussiness -- a ramp is read and loaded between sets, and
 * every extra digit is a plate to find and a sum to check while the previous set
 * is still being recovered from. The percentages that generate these targets are
 * accurate to nothing much anyway, so rounding them costs no information.
 *
 * It matters more than it used to. Fractional plates make almost every weight
 * loadable, so without this the search would answer each percentage exactly and
 * a lifter who bought a set of quarter-pound plates would be punished for it
 * with a ramp of 65.75 and 78.75. The plates are for the working weight, which
 * is the number the lifter chose and the one place a pound matters.
 *
 * The working weight itself is never rounded. It is what the lifter typed.
 */
const RAMP_STEP: Readonly<Record<WeightUnit, number>> = { kg: 2.5, lb: 5 };

interface RampShare {
  readonly share: number;
  readonly reps: number;
}

/**
 * The technique ramp for explosive lifts, as shares of the working weight.
 *
 * A product decision, and worth saying so plainly: the sources give no
 * percentages for these. What they do give is the shape -- light, then heavier,
 * with reps coming down as the weight goes up, and never fives.
 */
const OLYMPIC_SHARES: readonly RampShare[] = [
  { share: 0.55, reps: 3 },
  { share: 0.75, reps: 2 },
  { share: FINAL_WARMUP_SHARE, reps: 1 },
];

/**
 * The minimal ramp for small assistance work.
 *
 * One light set of five and one intermediate set of three, and deliberately no
 * heavy single: a 90% single on a barbell curl is a rule applied where it does
 * not belong.
 */
const ASSISTANCE_SHARES: readonly RampShare[] = [
  { share: 0.5, reps: 5 },
  { share: 0.75, reps: 3 },
];

const DEFAULT_WORKING_SETS = 3;
const DEFAULT_WORKING_REPS = 5;

/** Reps in a bar-only set: fives for the slow lifts, threes for the explosive ones. */
const EMPTY_IMPLEMENT_REPS = 5;
const OLYMPIC_EMPTY_IMPLEMENT_REPS = 3;
const EMPTY_IMPLEMENT_SETS = 2;

/**
 * How far above the working weight the table is built.
 *
 * One full plate per side, so a working weight that does not load still has a
 * neighbour above it to offer. Building only up to the working weight would
 * leave `above` permanently `null` and the lifter with one option instead of
 * two.
 */
const TABLE_HEADROOM_PLATES = 1;

/**
 * A ceiling on inserted singles.
 *
 * Not a performance guard. It is a statement that a ramp needing more than this
 * many extra sets has stopped being a warm-up, and it makes the insertion loop
 * terminating by construction rather than by argument.
 */
const MAX_INSERTED_STEPS = 12;

function isPositiveWholeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function collectProblems(request: WarmupRequest): readonly WarmupProblem[] {
  // Every problem at once. A form that reports one field at a time makes the
  // lifter fix, submit, and discover the next one.
  const problems: WarmupProblem[] = [];
  if (!Number.isFinite(request.workingWeight)) {
    problems.push({ code: 'working-weight-not-a-number' });
  } else if (request.workingWeight <= 0) {
    problems.push({ code: 'working-weight-not-positive' });
  }
  if (request.workingSets !== undefined && !isPositiveWholeNumber(request.workingSets)) {
    problems.push({ code: 'working-sets-not-a-positive-whole-number' });
  }
  if (request.workingReps !== undefined && !isPositiveWholeNumber(request.workingReps)) {
    problems.push({ code: 'working-reps-not-a-positive-whole-number' });
  }
  if (
    !Number.isFinite(request.setup.bar.amount) ||
    !Number.isFinite(request.setup.collars.amount)
  ) {
    problems.push({ code: 'equipment-weight-not-a-number' });
  }
  return problems;
}

/**
 * A stage the ramp is asked for.
 *
 * Every field is required, including the two that would naturally be optional.
 * `exactOptionalPropertyTypes` is on, so an omitted field and an explicitly
 * undefined one are different types, and threading optionality through to
 * `findLoading` buys a conditional object literal at every call site in exchange
 * for nothing.
 */
interface StageRequest {
  readonly stage: WarmupStage;
  readonly target: number;
  readonly reps: number;
  readonly count: number;
  readonly bound: LoadingBound;
  readonly fullDiameter: boolean;
  /**
   * The weight this stage must stay under.
   *
   * The working weight for almost every stage, and the whole reason guarantee 3
   * holds. An intermediate set passes the last warm-up instead, because
   * `nearest` is allowed to round up and a middle set that rounds past 90% of
   * the working weight leaves the last warm-up with nowhere above it to sit --
   * which drops the one set the ramp exists to arrive at.
   */
  readonly below: number;
}

interface Ramp {
  /** Resolves a stage and appends it, or returns `null` if nothing distinct fits. */
  readonly add: (request: StageRequest) => Loading | null;
  /** Appends the bar-only set, which is not subject to the increase constraint. */
  readonly addEmptyImplement: (reps: number, count: number) => void;
  readonly sets: () => readonly WarmupSet[];
  readonly advisories: () => readonly WarmupAdvisory[];
  readonly warn: (code: WarmupAdvisoryCode) => void;
}

/**
 * The one place a set is ever added, and therefore the one place the four
 * guarantees at the top of this file are enforced.
 *
 * `maxJump` is `null` for the families with no cap. Passing `Infinity` instead
 * would read the same and behave the same right up until somebody compared
 * against it.
 */
function createRamp(table: LoadingTable, emptyLoading: Loading, maxJump: number | null): Ramp {
  const sets: WarmupSet[] = [];
  const advisories: WarmupAdvisory[] = [];
  const seenAdvisories = new Set<WarmupAdvisoryCode>();
  let previous: Loading = emptyLoading;

  const warn = (code: WarmupAdvisoryCode): void => {
    // Deduplicated: a coarse plate set trips the same rule at several stages, and
    // five copies of one sentence read as five different problems.
    if (seenAdvisories.has(code)) return;
    seenAdvisories.add(code);
    advisories.push({ code });
  };

  const push = (stage: WarmupStage, loading: Loading, reps: number, count: number): void => {
    sets.push({ stage, loading, reps, count, change: plateChange(previous, loading) });
    previous = loading;
  };

  const insertUpTo = (target: number, below: number): void => {
    if (maxJump === null) return;
    let inserted = 0;
    while (target - previous.total > maxJump + LOADING_TOLERANCE) {
      if (inserted >= MAX_INSERTED_STEPS) {
        warn('jump-exceeds-full-plate');
        return;
      }
      const step = findLoading(table, previous.total + maxJump, {
        bound: 'at-most',
        above: previous.total,
        below,
        fullDiameter: false,
      });
      // Nothing loadable between here and a full plate up: the plates are too
      // coarse for this rule, and the lifter is told rather than the rule being
      // quietly abandoned.
      if (step === null) {
        warn('jump-exceeds-full-plate');
        return;
      }
      push('inserted', step, 1, 1);
      inserted += 1;
    }
  };

  const add = (request: StageRequest): Loading | null => {
    const constraints = {
      bound: request.bound,
      below: request.below,
      fullDiameter: request.fullDiameter,
    };

    // Probe before inserting anything. A stage that cannot be satisfied must
    // leave the ramp exactly as it found it -- otherwise a rejected candidate
    // (the pull tries three starting plates in turn) leaves its inserted singles
    // behind, and the ramp acquires sets belonging to a set that was never added.
    if (findLoading(table, request.target, { ...constraints, above: previous.total }) === null) {
      return null;
    }

    insertUpTo(request.target, request.below);
    const from = previous.total;
    const found = findLoading(table, request.target, { ...constraints, above: previous.total });

    if (found === null) {
      // The inserted singles reached the target: there is no distinct load left
      // between the last one and the working weight. The requirements cover this
      // exactly -- an inserted step is a single unless it becomes the stage --
      // so relabel it rather than adding a duplicate load or dropping the stage.
      const last = sets.at(-1);
      if (last?.stage !== 'inserted') return null;
      sets[sets.length - 1] = {
        ...last,
        stage: request.stage,
        reps: request.reps,
        count: request.count,
      };
      return last.loading;
    }

    if (maxJump !== null && found.total - from > maxJump + LOADING_TOLERANCE) {
      warn('jump-exceeds-full-plate');
    }
    push(request.stage, found, request.reps, request.count);
    return found;
  };

  return {
    add,
    addEmptyImplement: (reps, count) => {
      push('empty-implement', emptyLoading, reps, count);
    },
    sets: () => sets,
    advisories: () => advisories,
    warn,
  };
}

/**
 * How many warm-up sets a ramp gets, counting its opener and its last set.
 *
 * Measured in full plates of ramp, not in kilograms or in percentages, because
 * one plate a side is the unit a lifter thinks and loads in. Two sets for the
 * first plate of range and one for each plate after it, then clamped.
 */
function rampSetCount(range: number, fullPlate: number): number {
  const wanted = 2 + Math.round(range / (2 * fullPlate));
  return Math.min(MAX_RAMP_SETS, Math.max(MIN_RAMP_SETS, wanted));
}

/**
 * Reps for one warm-up set, counted back from the last one.
 *
 * Counted from the end because the end is the part that is fixed: the last
 * warm-up is a single and the one before it is light enough to be a triple, no
 * matter how many sets came before. Everything earlier is a set of five, which
 * is where a ramp does its actual warming.
 *
 * A three-set ramp skips the double. There is no room for a 3 - 2 - 1 ladder
 * when the whole ramp is 3 - 2 - 1, and 5 - 3 - 1 is what a short ramp has
 * always been here.
 */
function rampReps(fromEnd: number, count: number): number {
  if (fromEnd === 0) return 1;
  if (fromEnd === 1) return count >= 4 ? 2 : 3;
  if (fromEnd === 2 && count >= 4) return 3;
  return EMPTY_IMPLEMENT_REPS;
}

/**
 * The sets between the opener and the last warm-up, and the last warm-up itself.
 *
 * `first` is the opening set if one was placed, and `null` if there was none or
 * none would load -- in which case the ramp is spread from the empty implement
 * instead and the first set it places becomes the opener. Either way the ramp
 * ends up with `rampSetCount` sets, so the two cases differ in where the spread
 * starts and not in how much of it there is.
 */
function addGradedRamp(
  ramp: Ramp,
  first: Loading | null,
  base: number,
  workingWeight: number,
  unit: WeightUnit,
): void {
  const fullPlate = FULL_PLATE[unit];
  const step = RAMP_STEP[unit];
  const finalTarget = roundToIncrement(workingWeight * FINAL_WARMUP_SHARE, step);
  const count = rampSetCount(workingWeight - base, fullPlate);
  const from = first?.total ?? base;
  const placed = first === null ? 0 : 1;
  const middles = count - placed - 1;

  for (let index = 0; index < middles; index += 1) {
    const share = ((index + 1) / (middles + 1)) ** RAMP_CURVE_EXPONENT;
    ramp.add({
      stage: placed + index === 0 ? 'first' : 'middle',
      target: roundToIncrement(from + share * (finalTarget - from), step),
      reps: rampReps(count - 1 - (placed + index), count),
      count: 1,
      bound: 'nearest',
      fullDiameter: false,
      below: finalTarget,
    });
  }

  ramp.add({
    stage: 'final',
    target: finalTarget,
    reps: rampReps(0, count),
    count: 1,
    bound: 'nearest',
    fullDiameter: false,
    below: workingWeight,
  });
}

function hasFullDiameterPlate(setup: BarbellSetup, weight: number): boolean {
  return setup.plates.some(
    (plate) =>
      plate.fullDiameter &&
      plate.pairs !== 0 &&
      Math.abs(plate.weight - weight) < LOADING_TOLERANCE,
  );
}

/** The opening pull: chosen by plate diameter, then constrained by percentage. */
function addPullFirstSet(
  ramp: Ramp,
  setup: BarbellSetup,
  base: number,
  workingWeight: number,
  requireFullDiameter: boolean,
): Loading | null {
  if (requireFullDiameter) {
    for (const plate of DEADLIFT_START_PLATES[setup.plateUnit]) {
      if (!hasFullDiameterPlate(setup, plate)) continue;
      const target = base + 2 * plate;
      if (target > workingWeight * DEADLIFT_FIRST_CAP) continue;
      const found = ramp.add({
        stage: 'first',
        target,
        reps: EMPTY_IMPLEMENT_REPS,
        count: 1,
        bound: 'nearest',
        fullDiameter: true,
        below: workingWeight,
      });
      if (found !== null) return found;
    }

    // Every listed diameter is either too heavy for this working weight or not in
    // the gym. Take the heaviest full-diameter loading still under the cap rather
    // than abandoning the height requirement at the first refusal.
    const capped = ramp.add({
      stage: 'first',
      target: workingWeight * DEADLIFT_FIRST_CAP,
      reps: EMPTY_IMPLEMENT_REPS,
      count: 1,
      bound: 'at-most',
      fullDiameter: true,
      below: workingWeight,
    });
    if (capped !== null) return capped;
    ramp.warn('full-diameter-unavailable');
  }

  return ramp.add({
    stage: 'first',
    target: Math.min(base + 2 * FULL_PLATE[setup.plateUnit], workingWeight * DEADLIFT_FIRST_CAP),
    reps: EMPTY_IMPLEMENT_REPS,
    count: 1,
    bound: 'at-most',
    fullDiameter: false,
    below: workingWeight,
  });
}

/**
 * The opener for the squat, bench press, and overhead press.
 *
 * One full plate a side is the preferred opener and is what most lifters
 * actually do. It stops being an opener when it is most of the working weight,
 * which is the case the cap catches: a 90 kg squatter opening at 70 kg has done
 * a working set, not a warm-up. `null` there rather than a smaller invented
 * opener, because the graded ramp already knows how to start from the bar and
 * will space the whole thing rather than bolt a lighter first set onto a shape
 * built for a heavier one.
 */
function addSquatPressFirstSet(
  ramp: Ramp,
  setup: BarbellSetup,
  base: number,
  workingWeight: number,
): Loading | null {
  const target = base + 2 * FULL_PLATE[setup.plateUnit];
  if (target > workingWeight * SQUAT_PRESS_FIRST_CAP) return null;
  return ramp.add({
    stage: 'first',
    target,
    reps: EMPTY_IMPLEMENT_REPS,
    count: 1,
    bound: 'nearest',
    fullDiameter: false,
    below: workingWeight,
  });
}

function addSquatPressRamp(
  ramp: Ramp,
  setup: BarbellSetup,
  base: number,
  workingWeight: number,
): void {
  ramp.addEmptyImplement(EMPTY_IMPLEMENT_REPS, EMPTY_IMPLEMENT_SETS);
  const first = addSquatPressFirstSet(ramp, setup, base, workingWeight);
  addGradedRamp(ramp, first, base, workingWeight, setup.plateUnit);
}

function addPullRamp(
  ramp: Ramp,
  setup: BarbellSetup,
  base: number,
  workingWeight: number,
  requireFullDiameter: boolean,
): void {
  const first = addPullFirstSet(ramp, setup, base, workingWeight, requireFullDiameter);
  addGradedRamp(ramp, first, base, workingWeight, setup.plateUnit);
}

function shareStage(index: number, length: number): WarmupStage {
  if (index === length - 1) return 'final';
  if (index === 0) return 'first';
  return 'middle';
}

function addSharesRamp(
  ramp: Ramp,
  workingWeight: number,
  unit: WeightUnit,
  shares: readonly RampShare[],
): void {
  for (const [index, step] of shares.entries()) {
    ramp.add({
      stage: shareStage(index, shares.length),
      // The shares themselves are untouched -- they are the product decision.
      // Only the weight they name is made loadable-and-readable, for the reason
      // given at `RAMP_STEP`.
      target: roundToIncrement(workingWeight * step.share, RAMP_STEP[unit]),
      reps: step.reps,
      count: 1,
      bound: 'nearest',
      fullDiameter: false,
      below: workingWeight,
    });
  }
}

function planWorkingSet(
  table: LoadingTable,
  workingWeight: number,
  sets: number,
  reps: number,
  lastWarmup: Loading | null,
): WorkingSetPlan {
  const nearest = findLoading(table, workingWeight, { bound: 'nearest', fullDiameter: false });
  const loadable =
    nearest !== null && Math.abs(nearest.total - workingWeight) <= LOADING_TOLERANCE
      ? nearest
      : null;

  if (loadable !== null) {
    return {
      total: workingWeight,
      sets,
      reps,
      load: { kind: 'loadable', loading: loadable },
      change: lastWarmup === null ? null : plateChange(lastWarmup, loadable),
    };
  }

  return {
    total: workingWeight,
    sets,
    reps,
    load: {
      kind: 'not-loadable',
      below: findLoading(table, workingWeight, {
        bound: 'at-most',
        below: workingWeight,
        fullDiameter: false,
      }),
      above: findLoading(table, workingWeight, {
        bound: 'at-least',
        above: workingWeight,
        fullDiameter: false,
      }),
    },
    // Null rather than an empty change: there is no loading to move plates into,
    // and an empty change would render as "no plates to move", which is wrong in
    // the one direction that matters.
    change: null,
  };
}

/**
 * Builds the warm-up plan for one lift.
 *
 * Returns problems only for input that cannot be interpreted. Equipment that
 * cannot build the weight is an outcome, not a failure: the requirements ask for
 * the entered weight to be shown with a warning and the neighbours offered, and
 * a refused plan would leave the lifter with nothing on the screen to correct.
 */
export function planWarmup(request: WarmupRequest): WarmupPlanResult {
  const problems = collectProblems(request);
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const { setup, family, workingWeight } = request;
  const sets = request.workingSets ?? DEFAULT_WORKING_SETS;
  const reps = request.workingReps ?? DEFAULT_WORKING_REPS;
  const base = emptyImplement(setup);
  const emptyLoading: Loading = { total: base, perSide: [] };
  const fullPlate = FULL_PLATE[setup.plateUnit];

  const table = buildLoadingTable(setup, workingWeight + TABLE_HEADROOM_PLATES * 2 * fullPlate);

  // The pull's jump cap, which is a fact about pulling a bar off the floor and
  // not a spacing rule -- the graded ramp already keeps the jumps sane. It stays
  // as the backstop for the case the spacing cannot help with: plates so coarse
  // that the nearest loadable set is a long way from where the ramp asked for
  // one. The slow lifts have no cap, because a squatter who has to take a bigger
  // jump takes it out of the rack rather than off the floor.
  const maxJump = family === 'deadlift' || family === 'pull' ? 2 * fullPlate : null;
  const ramp = createRamp(table, emptyLoading, maxJump);
  const emptyReps = family === 'olympic' ? OLYMPIC_EMPTY_IMPLEMENT_REPS : EMPTY_IMPLEMENT_REPS;

  // At or below the bar there is nothing to ramp through, and inventing weighted
  // sets would mean inventing ones below the implement -- the one thing the
  // requirements say never to display. Show the preparation that is possible and
  // say why there is nothing else.
  if (workingWeight <= base + LOADING_TOLERANCE) {
    ramp.addEmptyImplement(emptyReps, EMPTY_IMPLEMENT_SETS);
    ramp.warn('working-weight-at-or-below-implement');
  } else {
    switch (family) {
      case 'squat-press':
        addSquatPressRamp(ramp, setup, base, workingWeight);
        break;
      case 'deadlift':
        addPullRamp(ramp, setup, base, workingWeight, true);
        break;
      case 'pull':
        addPullRamp(ramp, setup, base, workingWeight, false);
        break;
      case 'olympic':
        ramp.addEmptyImplement(OLYMPIC_EMPTY_IMPLEMENT_REPS, EMPTY_IMPLEMENT_SETS);
        addSharesRamp(ramp, workingWeight, setup.plateUnit, OLYMPIC_SHARES);
        break;
      case 'assistance':
        addSharesRamp(ramp, workingWeight, setup.plateUnit, ASSISTANCE_SHARES);
        break;
    }
  }

  if (table.loadings.length === 1) {
    ramp.warn('no-plates-available');
  }

  const warmups = ramp.sets();
  const working = planWorkingSet(table, workingWeight, sets, reps, warmups.at(-1)?.loading ?? null);
  if (working.load.kind === 'not-loadable') {
    ramp.warn('working-weight-not-loadable');
  }

  return {
    ok: true,
    plan: {
      family,
      setup,
      emptyImplement: emptyLoading,
      warmups,
      working,
      advisories: ramp.advisories(),
    },
  };
}
