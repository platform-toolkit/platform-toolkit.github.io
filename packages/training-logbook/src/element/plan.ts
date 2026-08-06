// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading the builder's form.
 *
 * Its own module, and not private to the element, for the reason tool 9 split
 * `typed-result.ts` out of its form: what a form does with three strings is
 * arithmetic with edge cases, and arithmetic with edge cases wants a Node test rather
 * than a browser one. Everything here is pure and total.
 *
 * It sits in `./element` rather than in `./core` on purpose. A draft row is a fact
 * about a screen mid-edit -- three strings, one of which may be half-typed -- and
 * section 12.3's core is the rules a consumer gets when they want the rules without a
 * user interface. A form reader in there would be a screen's private business
 * published as a contract.
 */

import type { Weight, WeightUnit } from '@platform-toolkit/domain';

import { canGenerateWarmup, takesWeight } from '../core/catalog.js';
import type { ExerciseOption } from '../types.js';

/**
 * The most sets one exercise may be planned for.
 *
 * A limit rather than no limit, because the number is typed on a phone keyboard and
 * "50" is one slip away from "500" -- which is five hundred set rows to scroll past,
 * on the screen a lifter is holding between sets. Thirty is far above any real
 * prescription and far below the number that makes the screen unusable.
 */
export const MAX_PLANNED_SETS = 30;

/** The most reps one set may be planned for, on the same argument. */
export const MAX_PLANNED_REPS = 100;

/** One exercise being planned, as the three strings the controls hold. */
export interface PlanDraftRow {
  /**
   * Row identity, distinct from the exercise.
   *
   * Squatting twice in one session is ordinary -- heavy singles then back-off sets --
   * so two rows can carry the same exercise and the exercise id cannot be the key.
   * Without a separate one, removing the first of two squats removes both.
   */
  readonly key: string;
  readonly option: ExerciseOption;
  readonly sets: string;
  readonly reps: string;
  /** Blank is allowed and means "I will fill it in as I go". */
  readonly weight: string;
  /** Whether the lifter asked for a ramp up to this weight. */
  readonly warmup: boolean;
}

/**
 * A row filled in from an exercise's own defaults, with no warm-up asked for.
 *
 * Off, on a screen whose whole design is about tap count, and that is the one
 * default here that was argued rather than assumed. Three things decided it. A ramp
 * needs a working weight, and the weight box is deliberately optional -- so a row
 * that defaulted to on would fail to generate for every lifter who meant to fill the
 * number in at the rack, silently, on the screen after this one. It needs a rack, and
 * a lifter who has not set one up would be offered something the tool cannot do.
 * And section 15.3: sets nobody asked for, appearing on a card, are the tool deciding
 * how somebody ought to train. One visible tick beside the numbers costs the lifter
 * who wants warm-ups a tap and costs the lifter who does not exactly nothing.
 */
export function newPlanRow(option: ExerciseOption, key: string): PlanDraftRow {
  return {
    key,
    option,
    sets: String(option.defaultSets),
    reps: String(option.defaultReps),
    weight: '',
    warmup: false,
  };
}

/** One exercise, read. */
export interface PlannedExercise {
  readonly option: ExerciseOption;
  readonly sets: number;
  readonly reps: number;
  /** `null` where the lifter left it blank, or where the movement takes no weight. */
  readonly weight: Weight | null;
  /**
   * Whether a ramp was asked for.
   *
   * A request and not a promise: false wherever the catalogue says the movement has
   * no family, whatever the row held. Whether one is actually generated still depends
   * on a rack this module does not see and on the engine's own answer, both of which
   * are settled where the session is built.
   */
  readonly warmup: boolean;
}

/** Which of a row's three controls is wrong. */
export type PlanField = 'sets' | 'reps' | 'weight';

/** What is wrong with it. */
export type PlanProblemCode =
  'unreadable' | 'not-whole' | 'not-positive' | 'too-many' | 'warmup-needs-weight';

/** One complaint, against one control of one row. */
export interface PlanProblem {
  readonly row: number;
  readonly field: PlanField;
  readonly code: PlanProblemCode;
}

/** Either every row read, or every complaint at once. */
export type PlanReading =
  | { readonly ok: true; readonly exercises: readonly PlannedExercise[] }
  | { readonly ok: false; readonly problems: readonly PlanProblem[] };

/** What is wrong with one control, in the words it is shown in. */
export function planProblem(problem: PlanProblem): string {
  switch (problem.code) {
    case 'unreadable':
      return 'Give a number.';
    case 'not-whole':
      return 'Whole numbers only.';
    case 'not-positive':
      // Named rather than merely refused. A nought here is somebody meaning "none of
      // this", and "must be above zero" leaves them retyping instead of removing.
      return 'Above zero. Remove the exercise to plan none of it.';
    case 'too-many':
      return 'More than this screen can show. Split it into two entries.';
    case 'warmup-needs-weight':
      // Named against the empty box rather than against the tick, because the box is
      // the thing to fill in and a lifter who wanted the ramp does not want to be
      // talked out of it. Untick and the row reads cleanly again, which the second
      // sentence says so that nobody has to discover it.
      return 'A warm-up needs the weight you are working up to. Untick it to decide at the rack.';
  }
}

/** A whole count within a bound, or the reason it is not one. */
function readCount(text: string, max: number): number | PlanProblemCode {
  const trimmed = text.trim();
  if (trimmed === '') return 'unreadable';
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 'unreadable';
  if (!Number.isInteger(value)) return 'not-whole';
  if (value <= 0) return 'not-positive';
  if (value > max) return 'too-many';
  return value;
}

/**
 * The weight typed into a row, in the unit it was typed in.
 *
 * The unit is the display unit at the moment of entry and it is stored rather than
 * converted, which is section 11.4: a lifter who typed 100 in a kilogram session has
 * a 100 kg entry forever, and switching the display to pounds later changes what is
 * shown and not what is recorded.
 */
function readWeight(text: string, unit: WeightUnit): Weight | null | PlanProblemCode {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) return 'unreadable';
  if (amount <= 0) return 'not-positive';
  return { amount, unit };
}

/**
 * Reads the whole form, reporting every problem rather than the first.
 *
 * Every problem, for the reason section 5.5 gives for the domain's smart
 * constructors: a form that reports one complaint per press is a form somebody
 * submits four times, and on the fourth they have stopped reading the message.
 */
export function readPlan(rows: readonly PlanDraftRow[], unit: WeightUnit): PlanReading {
  const problems: PlanProblem[] = [];
  const exercises: PlannedExercise[] = [];

  for (const [row, draft] of rows.entries()) {
    const sets = readCount(draft.sets, MAX_PLANNED_SETS);
    const reps = readCount(draft.reps, MAX_PLANNED_REPS);
    // Read only where the movement has one to read. A weight typed into a chin-up row
    // and then made bodyweight would otherwise refuse the whole form over a control
    // that is no longer on the screen.
    const weight = takesWeight(draft.option.loading) ? readWeight(draft.weight, unit) : null;

    // Gated on the catalogue and not only on the tick. A row for a movement with no
    // warm-up family cannot have asked for one from the screen -- the control is not
    // drawn -- and honouring the flag anyway would let a caller building rows by hand
    // send a request the rest of the tool would drop in silence.
    const warmup = draft.warmup && canGenerateWarmup(draft.option);

    if (typeof sets === 'string') problems.push({ row, field: 'sets', code: sets });
    if (typeof reps === 'string') problems.push({ row, field: 'reps', code: reps });
    if (typeof weight === 'string') problems.push({ row, field: 'weight', code: weight });
    // Only against a box that read cleanly and came back empty. A blank weight is
    // ordinary and is refused here for one reason: the ramp has nothing to work up to.
    if (warmup && weight === null) {
      problems.push({ row, field: 'weight', code: 'warmup-needs-weight' });
    }

    if (typeof sets === 'number' && typeof reps === 'number' && typeof weight !== 'string') {
      exercises.push({ option: draft.option, sets, reps, weight, warmup });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, exercises };
}

/** The complaint against one control, or `null`. */
export function problemFor(
  problems: readonly PlanProblem[],
  row: number,
  field: PlanField,
): PlanProblem | null {
  return problems.find((problem) => problem.row === row && problem.field === field) ?? null;
}
