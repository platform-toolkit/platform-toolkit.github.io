// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A set, in the shorthand it is written in on a piece of paper.
 *
 * Separate from `copy.ts` because that file holds sentences and this one holds a
 * rendering rule with a decision in it. Two decisions, in fact, and both are the kind
 * that is invisible until it is wrong.
 *
 * **A weight is shown in the unit it was recorded in, and never converted.** Section
 * 11.4, and `HOME_NOTES.unitNote` promises it in as many words: changing the display
 * unit changes what new entries are typed in and leaves the history alone. A logbook
 * that converted on the way out would show a lifter 220.46 lb for the 100 kg they
 * typed, and every repeat of that session afterwards would round it somewhere new.
 * The display unit is an input default here, not an output format.
 *
 * **The load shape is spelled out rather than reduced to a number.** An assisted
 * chin-up's 20 kg and a weighted chin-up's 20 kg are opposite facts, and a row that
 * printed both as "20 kg" would be the exact error section 6.2's four load shapes
 * exist to prevent -- visible only to somebody who already knew which movement they
 * were looking at.
 */

import { formatWeight } from '@platform-toolkit/domain';

import type { SetLoad, SetPerformance } from '../types.js';

/** How an assisted set's counterweight is labelled, so it cannot read as load. */
export const ASSIST_SUFFIX = 'assist';

/** What a lifter typing nothing yet gets instead of a blank row. */
export const NOT_SET = 'Not set';

/** The multiplication sign, as the letter a gym writes it with. */
const TIMES = 'x';

/**
 * The weight on a set, in its own recorded unit, or `null` where there is none.
 *
 * `null` rather than an empty string so a caller has to decide what an absent weight
 * looks like in its own context -- a bodyweight row says nothing, a half-filled
 * planned row says {@link NOT_SET}, and a formatter that guessed would be wrong on
 * one of them.
 */
export function formatLoad(load: SetLoad): string | null {
  switch (load.kind) {
    case 'none':
      return null;
    case 'implement':
      return formatWeight(load.weight);
    case 'added':
      // A leading plus rather than the bare number: this is weight hung off a body,
      // and "10 kg" on a weighted chin-up reads as a ten-kilogram chin-up.
      return `+${formatWeight(load.weight)}`;
    case 'assisted':
      return `${formatWeight(load.weight)} ${ASSIST_SUFFIX}`;
  }
}

/**
 * A count of sets across a count of reps, the way a plan is written down.
 *
 * Here rather than at its one call site so that the multiplication sign has one
 * definition in the package. Two files each choosing their own would eventually
 * disagree, and the disagreement would be between a plan and the sets it produced.
 */
export function formatVolume(sets: number, reps: number): string {
  return `${String(sets)} ${TIMES} ${String(reps)}`;
}

/**
 * A whole set as one line: what was on it and how many times.
 *
 * Reps with no weight is a complete answer -- that is every bodyweight set -- so the
 * two halves are joined only where both are there, and neither is invented.
 */
export function formatPerformance(performance: SetPerformance | null): string {
  if (performance === null) return NOT_SET;
  const load = formatLoad(performance.load);
  const reps = performance.repetitions;
  if (load === null) return reps === null ? NOT_SET : `${String(reps)} reps`;
  return reps === null ? load : `${load} ${TIMES} ${String(reps)}`;
}

/** The word between one weight and the several rep counts lifted at it. */
const FOR = 'for';

/**
 * A run of sets on one line, the way a lifter reads their own last entry.
 *
 * Two shapes, chosen by the sets rather than by the caller. Straight sets across one
 * weight collapse to "225 lb for 5, 5, 4", which is how that session would be written
 * on paper and is a third of the width of the alternative -- and width is the whole
 * constraint, because this sits inside an exercise card on a phone. Anything else
 * spells every set out, "225 lb x 5, 225 lb x 5, 220 lb x 5", because the moment two
 * loads differ the shared-weight form has to drop one of them to stay short.
 *
 * The test for "one weight" is the *formatted* load and not the recorded one. Section
 * 6.2's four load shapes already print differently, and comparing the strings is what
 * keeps 20 kg of assistance from collapsing into a line with 20 kg of added weight.
 *
 * A set with no rep count forces the long form even where every weight matches. There
 * is no honest place for it in "225 lb for 5, 5, ?", and {@link formatPerformance}
 * already has an answer for a half-filled set.
 */
export function formatSetRun(sets: readonly SetPerformance[]): string {
  const long = (): string => sets.map((set) => formatPerformance(set)).join(', ');
  if (sets.length === 0) return '';

  const reps: number[] = [];
  for (const set of sets) {
    if (set.repetitions === null) return long();
    reps.push(set.repetitions);
  }

  const loads = sets.map((set) => formatLoad(set.load));
  const [first] = loads;
  if (first === undefined || loads.some((load) => load !== first)) return long();

  const counts = reps.map((count) => String(count)).join(', ');
  // Bodyweight: no weight to hang the reps off, so the unit goes on the list itself.
  // "5, 5, 4" alone reads as three of something unnamed.
  return first === null ? `${counts} reps` : `${first} ${FOR} ${counts}`;
}
