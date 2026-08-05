// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Which control on this screen a change event came from.
 *
 * Every control in this tool is inside `ptk-qualification-check`'s shadow tree, and
 * `ptk-choice-group` and `ptk-select` both dispatch `composed` change events -- so a
 * weight-class selection made three elements down arrives at the root's handler
 * looking exactly like the root's own meet picker reporting. That is not
 * hypothetical: it shipped once. Picking a meet and *then* answering an age question
 * overwrote the meet identifier with a weight-class identifier, `findQualifyingMeet`
 * found nothing, and the screen told a lifter the meet they had just chosen was not
 * in the published list -- because they had answered a question about their age.
 * Twenty-two browser tests missed it, because every one of them answered the
 * registration axes before touching the meet book.
 *
 * The fix is that a handler reads which picker reported and ignores the rest. The
 * names live here, together, rather than beside the handler that reads them, so that
 * a new picker cannot be given a name an existing handler already answers to -- the
 * one mistake that would reintroduce the bug in a form no test currently covers.
 *
 * Find a control in a test by its `[data-picker="..."]` wrapper and not by its label.
 * The label is copy and changes with the wording; this attribute is what the code
 * reads.
 */

/** The `data-` key every picker wrapper carries. */
export const PICKER_DATASET_KEY = 'picker';

/** Which registration of the lifter's the reading is built from. */
export const PICKER_STANDING = 'standing';

/** Which transcribed meet's criteria to read as well. */
export const PICKER_MEET = 'meet';

/** Which of the archive's colliding namesakes the reader meant. */
export const PICKER_ATHLETE = 'athlete';

/**
 * The innermost `data-` value of one key on an event's path, or `null`.
 *
 * The composed path and never `event.target`: a change from inside a child
 * component is retargeted to the child's host on its way out, so the target is the
 * same element for every control the child owns and carries none of the wrapper's
 * dataset.
 */
export function datasetOn(event: Event, key: string): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const value = target.dataset[key];
    if (value !== undefined) return value;
  }
  return null;
}
