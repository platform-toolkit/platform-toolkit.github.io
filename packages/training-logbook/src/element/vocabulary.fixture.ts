// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The words that would turn a record into advice, and the one subtraction that has to
 * happen before they are looked for.
 *
 * Sections 15.3 and 16.1. A logbook that calls a session good is making a claim about
 * work it did not see, and one that calls a set missed has renamed a lifter's own
 * decision a failure.
 *
 * IN A FILE OF ITS OWN BECAUSE THERE ARE TWO OUTPUTS
 *
 * The rule was asserted against the rendered screens for as long as screens were the
 * only thing this tool wrote. Section 10.5's Markdown document is the second, and it is
 * assembled from the same `copy.ts` by different code -- so a list kept inside the
 * browser test would leave the file covered by whichever words somebody remembered to
 * type out again. One list, both outputs, and adding a word to it tightens both at once.
 *
 * The assertion stays against generated output in both places rather than against
 * `copy.ts`, for the reason it always has: a sentence composed at render time counts too.
 *
 * Excluded from the package build by the `*.fixture.ts` pattern in `tsconfig.json`.
 */

import { CATALOG_EXERCISES } from '../core/catalog.js';

/** The vocabulary neither a screen nor a file may contain. */
export const FORBIDDEN: readonly string[] = [
  'great',
  'good',
  'well done',
  'nice',
  'easy',
  'hard',
  'ahead',
  'behind',
  'on track',
  'missed',
  'failed',
  'personal best',
];

/**
 * Takes the exercise names out before the words are looked for.
 *
 * The catalogue contains a Good Morning -- a real barbell movement, named that since
 * long before this tool. The rule is about the vocabulary the tool writes, not about the
 * vocabulary of the sport it is written for, so the exercise names are subtracted rather
 * than the word dropped: `good` is the single most valuable entry in the list, because
 * it is the one word a logbook drifts towards on its own.
 */
export function withoutExerciseNames(text: string): string {
  return CATALOG_EXERCISES.reduce(
    (remaining, exercise) => remaining.split(exercise.name.toLowerCase()).join(' '),
    text,
  );
}
