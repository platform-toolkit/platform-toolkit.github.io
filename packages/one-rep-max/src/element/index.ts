// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The custom elements, and the one call that puts them in the registry.
 *
 * Section 15 asks every tool package for an explicit `define…()` rather than a
 * side-effecting import, and the reason is that the registry is a global which
 * throws on a second write. A package that registered its tags on import would hand
 * a consumer a `NotSupportedError` at module-evaluation time -- before a line of its
 * own code ran, from a file it did not write, naming a tag it has never heard of --
 * the first time a bundler failed to dedupe this package or a second copy arrived
 * through a transitive dependency. So no file here carries a `@customElement`
 * decorator, and this is the only module that touches `customElements`.
 *
 * All five tags are defined together, and that is not a convenience. Four of them
 * are inside the fifth's shadow root; defining only the root would leave a page of
 * unupgraded elements that render nothing and report no error, which is the worst
 * failure mode available -- a blank tool with a clean console.
 */
import type { LitElement } from 'lit';

import { ESTIMATE_RESULT_TAG, PtkEstimateResult } from './ptk-estimate-result.js';
import { FORMULA_COMPARISON_TAG, PtkFormulaComparison } from './ptk-formula-comparison.js';
import { CALCULATOR_TAG, PtkOneRepMaxCalculator } from './ptk-one-rep-max-calculator.js';
import { SET_REFINEMENTS_TAG, PtkSetRefinements } from './ptk-set-refinements.js';
import { TRAINING_PERCENTAGES_TAG, PtkTrainingPercentages } from './ptk-training-percentages.js';

export {
  CALCULATOR_TAG,
  ESTIMATE_RESULT_TAG,
  FORMULA_COMPARISON_TAG,
  PtkEstimateResult,
  PtkFormulaComparison,
  PtkOneRepMaxCalculator,
  PtkSetRefinements,
  PtkTrainingPercentages,
  SET_REFINEMENTS_TAG,
  TRAINING_PERCENTAGES_TAG,
};

/**
 * No custom event is re-exported here, and the absence is the tool's shape rather
 * than an omission. The four inner elements report through the shared controls'
 * own events -- `ptk-choice-group`, `ptk-number-field`, `ptk-toggle-group` -- which
 * bubble to the root and are routed by the `data-field` attribute the templates and
 * the delegated listener share. The root answers with properties, not events.
 */

/** Every tag this package owns, paired with what to register under it. */
const ELEMENTS: readonly (readonly [string, typeof LitElement])[] = [
  [ESTIMATE_RESULT_TAG, PtkEstimateResult],
  [FORMULA_COMPARISON_TAG, PtkFormulaComparison],
  [SET_REFINEMENTS_TAG, PtkSetRefinements],
  [TRAINING_PERCENTAGES_TAG, PtkTrainingPercentages],
  [CALCULATOR_TAG, PtkOneRepMaxCalculator],
];

/**
 * Registers the tool's elements, once.
 *
 * Safe to call any number of times, from any number of modules, in any order.
 * Returns the root constructor so a consumer can reach the property types without a
 * second import.
 *
 * A tag already held by *something else* is left alone rather than reported. There
 * is nothing useful to do about it here -- the page that defined it did so first and
 * this package cannot take it back -- and throwing would turn somebody else's naming
 * collision into this tool refusing to load at all.
 */
export function defineOneRepMax(): typeof PtkOneRepMaxCalculator {
  for (const [tag, constructor] of ELEMENTS) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
  return PtkOneRepMaxCalculator;
}
