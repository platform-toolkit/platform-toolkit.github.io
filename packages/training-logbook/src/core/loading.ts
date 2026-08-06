// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What to put on the bar for each set, and what to move between them.
 *
 * Section 8.6 asks for the calculator's plate display on this tool's cards -- the
 * same per-side loading, the same instruction about what to move, the same
 * nearest-loadable guidance where a rack cannot make a number. It also draws the
 * line this file is built around: **do not silently change the performed weight**.
 * So nothing here rounds, nudges, or substitutes. A weight the rack cannot build
 * is reported as a weight the rack cannot build, with the two it can build either
 * side of it, and the number the lifter entered stays exactly as they entered it.
 *
 * WHY A STORED PLAN WINS OVER A FRESH SEARCH
 *
 * Section 8.4 freezes per-side plate loading into the warm-up snapshot precisely
 * so a later algorithm change cannot rewrite a finished session. Recomputing every
 * card from today's search would defeat that in the one way nobody would notice:
 * the totals would still be right, and only the plates under them would have
 * quietly become a different gym's answer. So a set whose weight matches a row of
 * the exercise's stored plan reads its loading from that plan, and only a set with
 * no stored answer -- an edited weight, an exercise with no ramp, a rack that has
 * since changed -- is searched for fresh.
 *
 * The rack-has-changed case is worth stating on its own, because it looks like it
 * should be the other way round. A snapshot generated against a different gym is
 * not stale, it is *about something else*: its 25s were on a bar in another room.
 * Showing them beside today's plates would be the tool asserting something untrue,
 * so the whole frozen table is set aside at once rather than row by row.
 *
 * WHY THE CHAIN SKIPS A SKIPPED SET
 *
 * The instruction under a row is a difference from the row above it, which means
 * it depends on what is actually on the bar. A set marked `skipped` is one the
 * lifter said they did not do, so its plates never went on -- and a change
 * computed from it would tell somebody to take off a plate that is not there.
 * That is an instruction they can follow and be wrong. Leaving it out can at worst
 * repeat one they have already carried out, which they can see is already done.
 * `incomplete` stays in the chain: a set that was attempted and missed was a
 * loaded bar.
 */

import {
  buildLoadingTable,
  convertWeight,
  findLoading,
  plateChange,
  type BarbellSetup,
  type Loading,
  type LoadingTable,
  type PlateChange,
} from '@platform-toolkit/domain';

import type {
  EquipmentSnapshot,
  LogbookId,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { sameEquipment, toBarbellSetup } from './equipment.js';
import { loadWeight } from './summary.js';

/** The plates for one set, or the reason there are none to show. */
export type SetLoading =
  /**
   * Nothing to draw: not a barbell, or no weight recorded yet.
   *
   * Deliberately one answer rather than three. A screen does the same thing with
   * "this is a chin-up", "this set has no weight typed into it yet" and "the
   * number entered is not a weight" -- it draws no plates -- and splitting them
   * would invite a card to explain itself in three ways nobody asked for.
   */
  | { readonly kind: 'none' }
  /** The rack builds it. `change` is `null` when nothing has to move. */
  | { readonly kind: 'loaded'; readonly loading: Loading; readonly change: PlateChange | null }
  /**
   * The rack cannot build it. Both neighbours may be absent.
   *
   * `above` is `null` at the top of what the plates reach and `below` is `null`
   * under the empty bar, and a lifter who has typed a weight lighter than the bar
   * gets a card saying so rather than a card silently starting at the bar.
   */
  | {
      readonly kind: 'not-loadable';
      readonly below: Loading | null;
      readonly above: Loading | null;
    };

/**
 * The plates for every set in a workout, keyed by set.
 *
 * A map rather than a parallel array because the caller renders sets by identity
 * and an array would be one filtered list away from putting a warm-up's plates
 * under a working set. Every set in the session is present, so a missing key is a
 * caller that passed the wrong session and never a set with no plates.
 *
 * One search table is built for the whole workout rather than one per exercise:
 * the table is a subset-sum over the rack and is the only expensive thing here,
 * and a screen re-renders it on every keystroke in the weight box.
 */
export function sessionLoadings(
  session: WorkoutSession,
  equipment: EquipmentSnapshot,
): ReadonlyMap<LogbookId, SetLoading> {
  const answers = new Map<LogbookId, SetLoading>();
  const barbells: WorkoutExercise[] = [];
  for (const exercise of session.exercises) {
    if (exercise.loading === 'barbell-total-weight') {
      barbells.push(exercise);
    } else {
      for (const set of exercise.sets) answers.set(set.id, { kind: 'none' });
    }
  }
  // A bodyweight-only session never builds a table. The search is the one costly
  // thing in this module, and a lifter whose whole workout is chin-ups and
  // planks should not pay a subset-sum for a rack nothing on the card uses.
  if (barbells.length === 0) return answers;

  const setup = toBarbellSetup(equipment);
  const table = searchTable(barbells, setup);
  for (const exercise of barbells) fill(answers, exercise, equipment, setup, table);
  return answers;
}

function searchTable(exercises: readonly WorkoutExercise[], setup: BarbellSetup): LoadingTable {
  let heaviest = 0;
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      heaviest = Math.max(heaviest, target(set, setup) ?? 0);
    }
  }
  // One plate a side of headroom, so a weight the rack cannot build always has a
  // neighbour above it to name. A table stopping at the heaviest target would
  // answer "nothing heavier exists", which reads as "you are at the limit of
  // these plates" on a card where the lifter is 2.5 kg off a number it makes
  // easily.
  const largest = setup.plates.reduce(
    (found, plate) => (plate.pairs === 0 ? found : Math.max(found, plate.weight)),
    0,
  );
  return buildLoadingTable(setup, heaviest + largest * 2);
}

function fill(
  answers: Map<LogbookId, SetLoading>,
  exercise: WorkoutExercise,
  equipment: EquipmentSnapshot,
  setup: BarbellSetup,
  table: LoadingTable,
): void {
  const stored = frozen(exercise, equipment);
  // A bare bar, which is where every exercise starts. Assuming the last exercise
  // left its plates on would be a guess about a room this tool cannot see, and it
  // would be wrong every time somebody used a second bar.
  let previous: readonly number[] = [];

  for (const set of exercise.sets) {
    const answer = resolve(set, setup, table, stored, previous);
    answers.set(set.id, answer);
    if (answer.kind === 'loaded' && set.status !== 'skipped') previous = answer.loading.perSide;
  }
}

function resolve(
  set: WorkoutSet,
  setup: BarbellSetup,
  table: LoadingTable,
  stored: Frozen | null,
  previous: readonly number[],
): SetLoading {
  const total = target(set, setup);
  if (total === null) return { kind: 'none' };

  const held = stored?.loadable.get(hundredths(total));
  if (held !== undefined) return loaded(held, previous);

  const unbuildable = stored?.unbuildable.get(hundredths(total));
  if (unbuildable !== undefined) return unbuildable;

  const exact = findLoading(table, total, { bound: 'nearest' });
  if (exact !== null && Math.abs(exact.total - total) < LOADING_SLACK)
    return loaded(exact, previous);

  return {
    kind: 'not-loadable',
    below: findLoading(table, total, { bound: 'at-most' }),
    above: findLoading(table, total, { bound: 'at-least' }),
  };
}

/**
 * How close a searched loading has to be to count as the weight asked for.
 *
 * The domain's own tolerance is not exported for this, and it should not be: this
 * is the display asking "did the search find what I asked for", which is a
 * question about a rounding error and not about equipment. A tenth of the
 * smallest plate anybody sells, so it can absorb a conversion's last binary digit
 * and can never absorb a real quarter-pound difference.
 */
const LOADING_SLACK = 0.025;

function loaded(loading: Loading, previous: readonly number[]): SetLoading {
  const change = plateChange({ perSide: previous }, loading);
  const moves = change.removed.length > 0 || change.added.length > 0;
  return { kind: 'loaded', loading, change: moves ? change : null };
}

/** The plate loadings a stored plan already answered for, by total. */
interface Frozen {
  readonly loadable: ReadonlyMap<number, Loading>;
  readonly unbuildable: ReadonlyMap<number, SetLoading>;
}

function frozen(exercise: WorkoutExercise, equipment: EquipmentSnapshot): Frozen | null {
  const snapshot = exercise.warmup;
  if (snapshot === null) return null;
  if (!sameEquipment(snapshot.equipment, equipment)) return null;

  const loadable = new Map<number, Loading>();
  for (const warmup of snapshot.plan.warmups) {
    loadable.set(hundredths(warmup.loading.total), warmup.loading);
  }

  const unbuildable = new Map<number, SetLoading>();
  const { load, total } = snapshot.plan.working;
  if (load.kind === 'loadable') {
    loadable.set(hundredths(load.loading.total), load.loading);
  } else {
    unbuildable.set(hundredths(total), {
      kind: 'not-loadable',
      below: load.below,
      above: load.above,
    });
  }
  return { loadable, unbuildable };
}

/**
 * What this set puts on the bar, in the rack's own unit.
 *
 * Performed before planned, because section 8.6's rule is that the weight on the
 * card is the weight that happened. A lifter who planned 100 and did 95 wants the
 * plates for 95; showing the plan's would be the display disagreeing with the
 * record beside it.
 */
function target(set: WorkoutSet, setup: BarbellSetup): number | null {
  const performance = set.performed ?? set.planned;
  if (performance === null) return null;
  const weight = loadWeight(performance.load);
  if (weight === null) return null;
  // Converted rather than refused. Section 11.4 expects mixed units -- a lifter
  // reading in pounds may train on a kilogram rack -- and the honest answer for
  // 225 lb on kilogram plates is the two totals either side of it, which is what
  // a failed search here produces. The entered number is not touched.
  const { amount } = convertWeight(weight, setup.plateUnit);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Totals as whole hundredths, so a lookup is not a float comparison. */
function hundredths(total: number): number {
  return Math.round(total * 100);
}
