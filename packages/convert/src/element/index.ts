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
 * All four tags are defined together, and that is not a convenience. Three of them
 * are inside the fourth's shadow root; defining only the root would leave a page of
 * unupgraded elements that render nothing and report no error, which is the worst
 * failure mode available -- a blank tool with a clean console.
 */
import type { LitElement } from 'lit';

import { CONVERSION_RESULT_TAG, PtkConversionResult } from './ptk-conversion-result.js';
import { CONVERSION_TABLE_TAG, PtkConversionTable } from './ptk-conversion-table.js';
import { CONVERTER_TAG, PtkConverter } from './ptk-converter.js';
import { MILESTONE_CHART_TAG, PtkMilestoneChart } from './ptk-milestone-chart.js';

export {
  CONVERSION_RESULT_TAG,
  CONVERSION_TABLE_TAG,
  CONVERTER_TAG,
  MILESTONE_CHART_TAG,
  PtkConversionResult,
  PtkConversionTable,
  PtkConverter,
  PtkMilestoneChart,
};

export { SELECT_WEIGHT_EVENT, type SelectWeightDetail } from './ptk-conversion-result.js';

/** Every tag this package owns, paired with what to register under it. */
const ELEMENTS: readonly (readonly [string, typeof LitElement])[] = [
  [CONVERSION_RESULT_TAG, PtkConversionResult],
  [CONVERSION_TABLE_TAG, PtkConversionTable],
  [MILESTONE_CHART_TAG, PtkMilestoneChart],
  [CONVERTER_TAG, PtkConverter],
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
export function defineConvert(): typeof PtkConverter {
  for (const [tag, constructor] of ELEMENTS) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
  return PtkConverter;
}
