// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading what was typed into a field.
 *
 * These came out of the warm-up tool when `ptk-equipment-setup` was promoted
 * into this package: a package cannot import from `apps/web`, and the element
 * counts plate pairs with `parseCount`.
 *
 * They live here rather than in `packages/domain` because they return
 * sentences, and `weight-input.ts` states the rule that would forbid it there
 * -- a code, not a sentence, because the wording of an error belongs to the
 * screen showing it. This package is the screen layer, so the sentences are at
 * home in it.
 *
 * NOT THE SAME PARSER AS `parseWeightInput`
 *
 * `@platform-toolkit/domain` exports a weight parser with a deliberately
 * different contract: it reports a `WeightInputProblem` code rather than a
 * sentence, and its ceiling is `MAX_WEIGHT_INPUT = 100_000` against the 2000
 * here. Two parsers a grep apart with near-identical names is the trap this
 * move created, so: reach for the domain one when the caller must choose its
 * own wording, and for this one when a field needs the sentence to print
 * underneath it.
 *
 * Tools 4 and 5 keep their own third copy on purpose -- `meet-day/session.ts`
 * says why, and its `parseCount` takes a bounds object rather than a maximum,
 * so the two are not interchangeable. Do not unify them by making this one
 * accept both shapes.
 */
import type { WeightUnit } from '@platform-toolkit/domain';

/** A parsed field, or the sentence to show under it. */
export type FieldReading =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string }
  /** Nothing typed yet. Not an error: an empty field is where every row starts. */
  | { readonly ok: false; readonly message: null };

const EMPTY: FieldReading = { ok: false, message: null };

/**
 * The largest weight this will accept, in either unit.
 *
 * Not a judgement about anybody's squat. It is the point past which a typo has
 * clearly happened -- a missed decimal point turns 102.5 into 1025 -- and the
 * plate search would otherwise walk a table of tens of thousands of loadings to
 * answer a question nobody asked.
 *
 * Exported, unlike when these were private to the warm-up tool, because the
 * tool's own preference schema states the same ceilings and would otherwise
 * restate them as literals -- two numbers that agree today and drift the first
 * time one of them is raised.
 */
export const MAX_WEIGHT = 2000;
export const MAX_COUNT = 20;

/**
 * Reads a typed weight.
 *
 * Deliberately strict about what a number looks like: `Number('')` is zero and
 * `Number(' 12 ')` is twelve, so a field cleared by a lifter mid-thought would
 * otherwise parse as a bar-only session, and `parseFloat` would read `1o5` as one.
 */
export function parseWeight(text: string, unit: WeightUnit): FieldReading {
  const trimmed = text.trim();
  if (trimmed === '') return EMPTY;
  if (!/^\d*\.?\d+$/.test(trimmed)) {
    return { ok: false, message: 'Enter a weight using digits, for example 102.5.' };
  }
  const value = Number(trimmed);
  if (value <= 0) {
    return { ok: false, message: 'Enter a weight above zero.' };
  }
  if (value > MAX_WEIGHT) {
    return { ok: false, message: `Enter a weight of ${String(MAX_WEIGHT)} ${unit} or less.` };
  }
  return { ok: true, value };
}

/**
 * Reads a typed count of something. Whole numbers only -- there is no half a rep.
 *
 * `what` is the plural noun the messages are written around, and `max` is the
 * ceiling. Both are arguments because the equipment screen counts pairs of
 * plates against a different limit than a working set counts reps, and a second
 * copy of this function would be a second set of error sentences to keep in step.
 */
export function parseCount(text: string, what: string, max: number = MAX_COUNT): FieldReading {
  const trimmed = text.trim();
  if (trimmed === '') return EMPTY;
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `Enter how many ${what} as a whole number.` };
  }
  const value = Number(trimmed);
  if (value < 1) {
    return { ok: false, message: `Enter at least one of the ${what}.` };
  }
  if (value > max) {
    return { ok: false, message: `Enter ${String(max)} ${what} or fewer.` };
  }
  return { ok: true, value };
}
