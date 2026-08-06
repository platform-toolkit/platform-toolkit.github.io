// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * How a control says which row of a repeated list it belongs to.
 *
 * Both screens here are lists of near-identical rows -- one per planned exercise, one
 * per set -- and every row carries the same three or four controls. A handler bound
 * per row would be one closure per set per render, which on a session with forty sets
 * is forty closures thrown away on every keystroke. So each screen listens once and
 * reads the row off the event, and this file is where the attribute name is written
 * so the template and the walk cannot disagree.
 *
 * **The walk reads `event.composedPath()` and never `event.target`.** Section 5.8, and
 * it is not a style preference: a `composed` event crossing a shadow boundary is
 * retargeted to the host, whose dataset is empty. A handler reading `event.target`
 * therefore finds nothing, every control on the screen visibly responds, and nothing
 * is recorded -- which is the failure mode that looks like a working form.
 */

/** The row an exercise control belongs to, as an index into the plan. */
export const ROW_DATASET_KEY = 'row';

/** Which field of that row. */
export const FIELD_DATASET_KEY = 'field';

/** The set a logging control acts on, by identifier. */
export const SET_DATASET_KEY = 'set';

/** Which exercise a control names, by catalogue or custom identifier. */
export const EXERCISE_DATASET_KEY = 'exercise';

/** Which saved gym a control acts on, by identifier. */
export const PROFILE_DATASET_KEY = 'profile';

/** Which stored workout a control acts on, by identifier. */
export const WORKOUT_DATASET_KEY = 'workout';

/** Which note a control acts on, as a key naming both the kind and the target. */
export const NOTE_DATASET_KEY = 'note';

/** What a button does, where a button does something other than write a field. */
export const ACTION_DATASET_KEY = 'action';

/** The three things a planned exercise row asks for. */
export const SETS_FIELD = 'sets';
export const REPS_FIELD = 'reps';
export const WEIGHT_FIELD = 'weight';

/**
 * The fourth, which only some rows have and which is a tick rather than a number.
 *
 * Separate from the three above because it is not read by {@link readCount} and
 * carries no complaint of its own: a warm-up asked for without a weight is reported
 * against {@link WEIGHT_FIELD}, where the empty box the lifter has to fill in is.
 */
export const WARMUP_FIELD = 'warmup';

/** The two the whole session asks for, which belong to no row. */
export const DATE_FIELD = 'date';
export const TITLE_FIELD = 'title';

/** The two the logging screen's editor asks for. */
export const DONE_WEIGHT_FIELD = 'done-weight';
export const DONE_REPS_FIELD = 'done-reps';

/**
 * The innermost `data-` value of one key on an event's path, or `null`.
 *
 * Innermost rather than outermost, because a set row sits inside an exercise block and
 * both carry attributes. Reading outward-first would attribute every tap in a session
 * to the first exercise.
 */
function attributeOn(event: Event, key: string): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const value = target.dataset[key];
    if (value !== undefined) return value;
  }
  return null;
}

/**
 * The index of the plan row a control belongs to, or `null`.
 *
 * Parsed and range-checked here rather than by each caller. An index is the one
 * routing key in this package that is not opaque -- it is a position in an array the
 * lifter is editing -- so a stale one from a row removed mid-render would otherwise
 * write into whichever exercise slid up into its place.
 */
export function rowOf(event: Event, length: number): number | null {
  const raw = attributeOn(event, ROW_DATASET_KEY);
  if (raw === null) return null;
  const index = Number.parseInt(raw, 10);
  if (!Number.isInteger(index) || index < 0 || index >= length) return null;
  return index;
}

/** Which field of a plan row reported, unnarrowed. */
export function fieldOf(event: Event): string | null {
  return attributeOn(event, FIELD_DATASET_KEY);
}

/**
 * The set a logging control acts on, or `null`.
 *
 * Not range-checked, and deliberately unlike {@link rowOf}: a set identifier is
 * opaque, so the only check worth making is whether the session still holds one --
 * which the core's `findSet` already does, and doing it twice would leave two
 * definitions of "a set that is not there".
 */
export function setOf(event: Event): string | null {
  return attributeOn(event, SET_DATASET_KEY);
}

/** The exercise a control names, or `null`. Opaque, so unchecked like {@link setOf}. */
export function exerciseOf(event: Event): string | null {
  return attributeOn(event, EXERCISE_DATASET_KEY);
}

/** The saved gym a control acts on, or `null`. Opaque, so unchecked like {@link setOf}. */
export function profileOf(event: Event): string | null {
  return attributeOn(event, PROFILE_DATASET_KEY);
}

/** The stored workout a control acts on, or `null`. Opaque, so unchecked like {@link setOf}. */
export function workoutOf(event: Event): string | null {
  return attributeOn(event, WORKOUT_DATASET_KEY);
}

/**
 * The note the workout as a whole carries. Section 7.9.
 *
 * A note key names its kind as well as its target, and one attribute carries
 * both. Three attributes would not do: an exercise's note box sits inside the
 * exercise block, so `data-exercise` is already on the path above it, and a
 * handler reading that could not tell a note about the lift from a note the
 * whole session carries -- which is the pair section 7.9 makes distinct.
 */
export const WORKOUT_NOTE_KEY = 'workout';

const EXERCISE_NOTE_PREFIX = 'exercise:';

/**
 * The key naming one exercise's note.
 *
 * The identifier is `WorkoutExercise.id`, the row in this session, and not the
 * `exerciseId` naming the catalogue entry it came from. The core's
 * `setExerciseNote` matches on the row and it has to: a session with squats in
 * it twice is two rows sharing one catalogue identifier, and a note keyed by
 * the catalogue would land on both.
 */
export function exerciseNoteKey(id: string): string {
  return `${EXERCISE_NOTE_PREFIX}${id}`;
}

/** The exercise row a note key names, or `null` where it names something else. */
export function exerciseNoteId(key: string): string | null {
  if (!key.startsWith(EXERCISE_NOTE_PREFIX)) return null;
  const id = key.slice(EXERCISE_NOTE_PREFIX.length);
  return id === '' ? null : id;
}

/** Which note a control acts on, or `null`. Opaque, so unchecked like {@link setOf}. */
export function noteOf(event: Event): string | null {
  return attributeOn(event, NOTE_DATASET_KEY);
}

/**
 * What the pressed button was for, or `null`.
 *
 * Unnarrowed on purpose. Narrowing it here would need a list of every action on
 * every screen in this one file, and the screens do not share actions -- each one
 * compares against its own constants and ignores what it does not recognise, which
 * is also what makes a stray click on a container harmless.
 */
export function actionOf(event: Event): string | null {
  return attributeOn(event, ACTION_DATASET_KEY);
}
