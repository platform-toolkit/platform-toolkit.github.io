// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { RegistrationAxis } from '../core/registration.js';
import type { TypedTestedAnswer } from '../core/typed-result.js';
import { AXIS_QUESTIONS, RESULT_FIELD_LABELS, TESTED_ANSWERS } from './copy.js';
import type { TypedResultTextField } from './copy.js';

/**
 * How a control on the registration form says which question it answers.
 *
 * The form is five controls of three different kinds reporting two different
 * events, and the root reads all of them through one listener per event name that
 * walks `event.composedPath()` (section 5.8 -- `event.target` is retargeted to the
 * host and its dataset is empty, which produces a form whose controls visibly
 * respond while nothing is recorded). So the attribute on the element and the
 * string in the switch are one contract written twice, and this file is where the
 * second copy is not written.
 *
 * The routing key is the {@link RegistrationAxis} itself rather than a field name
 * invented for the DOM. There is nothing to map: an axis is exactly what a control
 * here answers, the union is already published by the core, and a second vocabulary
 * would be five rows of `case 'sex-field': return 'sex'` with nothing to check them
 * against.
 */

/**
 * The `data-` key, written once so the template and the walk cannot disagree.
 *
 * Read as `dataset[AXIS_DATASET_KEY]` rather than `dataset.axis`, which
 * `noPropertyAccessFromIndexSignature` refuses -- a dataset is an index signature
 * and a dotted read of one is a typo the compiler cannot see.
 */
export const AXIS_DATASET_KEY = 'axis';

/**
 * Narrows a `data-axis` string read off the DOM onto an axis.
 *
 * Checked against {@link AXIS_QUESTIONS} and not against a list of its own, which
 * is the whole reason that record is a `Record` over the union. Two lists would be
 * two things to update, and the one that got missed would be this one -- an axis
 * the form draws a control for and the router silently drops, which looks like a
 * control that does nothing rather than like a missing case.
 *
 * `Object.hasOwn` rather than `in`: the record is a literal in source, so a
 * prototype lookup is not the hazard here, but `in` would answer `true` for
 * `constructor` and the habit is what matters when the same shape arrives from
 * `JSON.parse` (section 5.3).
 */
export function isRegistrationAxis(value: string): value is RegistrationAxis {
  return Object.hasOwn(AXIS_QUESTIONS, value);
}

/**
 * The axis a control that reported belongs to, or `null`.
 *
 * `null` covers two different things on purpose: no `data-axis` anywhere on the
 * path, and one carrying a string that is not an axis. Both mean the same thing to
 * a caller -- there is no answer to record -- and distinguishing them would offer a
 * second branch whose only use is recording the answer anyway.
 *
 * The attribute is carried by the block wrapping each control rather than by the
 * control itself, so it covers whatever else that block grows. A composed path runs
 * outward from the innermost target, so the block is on it either way.
 */
export function axisOf(event: Event): RegistrationAxis | null {
  const axis = attributeOn(event, AXIS_DATASET_KEY);
  if (axis === null || !isRegistrationAxis(axis)) return null;
  return axis;
}

/**
 * The innermost `data-` value of one key on an event's path, or `null`.
 *
 * The walk stops at the first element carrying the key rather than continuing to
 * the outermost, so a block nested inside another answers for itself. Nothing in
 * this package nests two today; the alternative is a routing rule that changes
 * meaning the first time one does, which is not a thing to discover from a
 * misfiled answer.
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
 * The two answers to the drug-tested question, as strings a radio can carry.
 *
 * A boolean has no DOM spelling, and the two obvious ones are both traps: `"true"`
 * and `"false"` read as a serialisation detail leaking onto a form, and an empty
 * string for `false` is indistinguishable from a control that was never answered.
 * Named constants because the template and the parser are the same two spellings of
 * one string, and a typo in either gives a tile that visibly selects while the
 * answer stays unrecorded.
 */
export const TESTED_YES = 'yes';
export const TESTED_NO = 'no';

/**
 * How a control on the result-entry form says which field it fills in.
 *
 * A second key rather than a second vocabulary under the first, because the two
 * forms answer different questions and are read by different elements -- an axis
 * chooses a table and a field records what a results sheet says. One key would let
 * a stray attribute route a meet name into the sex answer, and the failure would be
 * a registration nobody typed.
 */
export const FIELD_DATASET_KEY = 'field';

/**
 * Narrows a `data-field` string onto one of the form's string-valued fields.
 *
 * Checked against {@link RESULT_FIELD_LABELS} for the reason
 * {@link isRegistrationAxis} is checked against the questions: the labels are
 * already a `Record` over the union, so a field added to the form stops the build at
 * the label rather than arriving here as a control that silently records nothing.
 */
export function isTextualResultField(value: string): value is TypedResultTextField {
  return Object.hasOwn(RESULT_FIELD_LABELS, value);
}

/**
 * The raw `data-field` of the control that reported, or `null`.
 *
 * Unnarrowed on purpose, unlike {@link axisOf}. Two of this form's fields are not
 * strings, so a caller has to be able to see the value that
 * {@link isTextualResultField} refuses -- narrowing here would make the boolean and
 * the picklist indistinguishable from a typo, and both would silently stop
 * recording.
 */
export function fieldOf(event: Event): string | null {
  return attributeOn(event, FIELD_DATASET_KEY);
}

/**
 * The two fields whose answer is not a string, as `data-field` values.
 *
 * Named here rather than spelled in the templates because they are the two the
 * narrowing above deliberately refuses: `tested` is a three-valued picklist and
 * `ageApproximate` is a boolean, and routing either through the string writer would
 * put the word "unstated" into a field typed `boolean`.
 */
export const TESTED_FIELD = 'tested';
export const AGE_APPROXIMATE_FIELD = 'ageApproximate';

/** Whether a string off the DOM is one of the three drug-tested answers. */
export function isTypedTestedAnswer(value: string): value is TypedTestedAnswer {
  return Object.hasOwn(TESTED_ANSWERS, value);
}

/** The two answers to "was the age exact", as strings a radio can carry. */
export const AGE_EXACT = 'exact';
export const AGE_APPROXIMATE = 'approximate';
