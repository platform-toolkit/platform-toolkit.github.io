// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The barbell lifts the warm-up calculator knows about.
 *
 * WHY THIS IS CODE AND NOT PUBLISHED DATA
 *
 * The rule elsewhere in this package is that federation numbers live in
 * published artifacts, because a federation can revise them between releases and
 * a lifter planning against a stale figure plans against the wrong target. None
 * of that applies here. This catalogue is product scope: which lifts the tool
 * supports, which four are pinned to the front, and which ramp each one uses.
 * Nobody outside this repository can change it, and adding a lift is a code
 * change in every sense already -- it needs a family chosen for it.
 *
 * THE FOUR ARE PINNED, DELIBERATELY
 *
 * Squat, bench press, deadlift, and overhead press are `primary: true` and
 * everything else is not. That flag is the whole of the hierarchy: the interface
 * reads it rather than hard-coding four identifiers, so a screen cannot drift out
 * of step with this list, and a variant cannot quietly acquire equal billing by
 * being added in the right place in the array.
 *
 * A CUSTOM LIFT IS NOT IN HERE
 *
 * A lifter may name their own movement, and when they do they must choose a
 * family. The calculator does not guess a ramp from a name -- guessing wrong
 * between the pull ramp and the press ramp changes what somebody does with a
 * loaded bar.
 */
import type { WarmupFamily } from './warmup.js';

/**
 * How the picker groups the catalogue.
 *
 * Movement families, because that is how a lifter looks for something: somebody
 * hunting for the pin squat looks under squats, not under S.
 */
export type LiftGroup =
  | 'primary'
  | 'core-additions'
  | 'squat-variants'
  | 'press-variants'
  | 'pull-variants'
  | 'olympic-variants'
  | 'ancillary';

export interface LiftDefinition {
  /** Stable identifier. Persisted in local preferences, so it must not be renamed casually. */
  readonly id: string;
  readonly name: string;
  readonly group: LiftGroup;
  readonly family: WarmupFamily;
  /** Whether the lift is one of the four shown without opening a picker. */
  readonly primary: boolean;
  /** Suggested working prescription. A suggestion: never written over a lifter's own entry. */
  readonly defaultSets: number;
  readonly defaultReps: number;
}

const THREE_BY_FIVE = { defaultSets: 3, defaultReps: 5 } as const;
const ONE_BY_FIVE = { defaultSets: 1, defaultReps: 5 } as const;
const FIVE_BY_THREE = { defaultSets: 5, defaultReps: 3 } as const;
const THREE_BY_EIGHT = { defaultSets: 3, defaultReps: 8 } as const;

/**
 * Every supported lift, in the order the picker shows them.
 *
 * Order is deliberate and not alphabetical: the four come first, then the lifts
 * a novice programme actually uses, then the variants. Sorting this list by name
 * would bury the power clean under the pin squat.
 */
export const LIFTS: readonly LiftDefinition[] = [
  {
    id: 'squat',
    name: 'Squat',
    group: 'primary',
    family: 'squat-press',
    primary: true,
    ...THREE_BY_FIVE,
  },
  {
    id: 'bench-press',
    name: 'Bench Press',
    group: 'primary',
    family: 'squat-press',
    primary: true,
    ...THREE_BY_FIVE,
  },
  // One work set of five. The deadlift is the one of the four whose default
  // differs, and it differs because three sets of five deadlifts is a different
  // session from three sets of five squats.
  {
    id: 'deadlift',
    name: 'Deadlift',
    group: 'primary',
    family: 'deadlift',
    primary: true,
    ...ONE_BY_FIVE,
  },
  {
    id: 'overhead-press',
    name: 'Overhead Press',
    group: 'primary',
    family: 'squat-press',
    primary: true,
    ...THREE_BY_FIVE,
  },

  {
    id: 'power-clean',
    name: 'Power Clean',
    group: 'core-additions',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },
  {
    id: 'power-snatch',
    name: 'Power Snatch',
    group: 'core-additions',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },
  {
    id: 'barbell-row',
    name: 'Barbell Row',
    group: 'core-additions',
    family: 'pull',
    primary: false,
    ...THREE_BY_FIVE,
  },

  {
    id: 'front-squat',
    name: 'Front Squat',
    group: 'squat-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'high-bar-squat',
    name: 'High-Bar Squat',
    group: 'squat-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'pause-squat',
    name: 'Pause Squat',
    group: 'squat-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'box-squat',
    name: 'Box Squat',
    group: 'squat-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'pin-squat',
    name: 'Pin Squat',
    group: 'squat-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },

  {
    id: 'close-grip-bench-press',
    name: 'Close-Grip Bench Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'wide-grip-bench-press',
    name: 'Wide-Grip Bench Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'incline-bench-press',
    name: 'Incline Bench Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'pin-bench-press',
    name: 'Pin Bench Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'pin-press',
    name: 'Pin Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'push-press',
    name: 'Push Press',
    group: 'press-variants',
    family: 'squat-press',
    primary: false,
    ...THREE_BY_FIVE,
  },

  {
    id: 'stiff-legged-deadlift',
    name: 'Stiff-Legged Deadlift',
    group: 'pull-variants',
    family: 'deadlift',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    group: 'pull-variants',
    family: 'deadlift',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'snatch-grip-deadlift',
    name: 'Snatch-Grip Deadlift',
    group: 'pull-variants',
    family: 'deadlift',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'deficit-deadlift',
    name: 'Deficit Deadlift',
    group: 'pull-variants',
    family: 'deadlift',
    primary: false,
    ...THREE_BY_FIVE,
  },
  {
    id: 'halting-deadlift',
    name: 'Halting Deadlift',
    group: 'pull-variants',
    family: 'deadlift',
    primary: false,
    ...THREE_BY_FIVE,
  },
  // The rack pull starts from pins, so the bar's height comes from the rack and
  // not from the plates. It uses the pull ramp without the full-diameter rule.
  {
    id: 'rack-pull',
    name: 'Rack Pull',
    group: 'pull-variants',
    family: 'pull',
    primary: false,
    ...THREE_BY_FIVE,
  },

  {
    id: 'clean',
    name: 'Clean',
    group: 'olympic-variants',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },
  {
    id: 'split-clean',
    name: 'Split Clean',
    group: 'olympic-variants',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },
  {
    id: 'split-snatch',
    name: 'Split Snatch',
    group: 'olympic-variants',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },
  {
    id: 'jerk',
    name: 'Jerk',
    group: 'olympic-variants',
    family: 'olympic',
    primary: false,
    ...FIVE_BY_THREE,
  },

  {
    id: 'barbell-shrug',
    name: 'Barbell Shrug',
    group: 'ancillary',
    family: 'pull',
    primary: false,
    ...THREE_BY_EIGHT,
  },
  {
    id: 'lying-triceps-extension',
    name: 'Lying Triceps Extension',
    group: 'ancillary',
    family: 'assistance',
    primary: false,
    ...THREE_BY_EIGHT,
  },
  {
    id: 'barbell-curl',
    name: 'Barbell Curl',
    group: 'ancillary',
    family: 'assistance',
    primary: false,
    ...THREE_BY_EIGHT,
  },
  {
    id: 'good-morning',
    name: 'Good Morning',
    group: 'ancillary',
    family: 'assistance',
    primary: false,
    ...THREE_BY_FIVE,
  },
];

/**
 * The four pinned lifts, in order.
 *
 * Derived from the flag rather than written out again, so the two cannot
 * disagree -- a second list is a second place to forget.
 */
export const PRIMARY_LIFTS: readonly LiftDefinition[] = LIFTS.filter((lift) => lift.primary);

const BY_ID: ReadonlyMap<string, LiftDefinition> = new Map(LIFTS.map((lift) => [lift.id, lift]));

/**
 * Looks a lift up by identifier, or `null` for one this build does not have.
 *
 * `null` and not a throw: identifiers come back from stored preferences written
 * by an older build, and a lifter opening the tool after a lift was renamed
 * should lose that lift's row, not the whole screen.
 */
export function findLift(id: string): LiftDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** The catalogue grouped for the picker, preserving the order above. */
export function liftsByGroup(): ReadonlyMap<LiftGroup, readonly LiftDefinition[]> {
  const grouped = new Map<LiftGroup, LiftDefinition[]>();
  for (const lift of LIFTS) {
    const existing = grouped.get(lift.group);
    if (existing === undefined) {
      grouped.set(lift.group, [lift]);
    } else {
      existing.push(lift);
    }
  }
  return grouped;
}
