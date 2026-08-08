// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The pure core of the converter.
 *
 * No Lit, no DOM, no storage, no network, and no clock -- section 15's first
 * requirement for a tool package. The `PreferenceStore` named below is a *port*,
 * handed in by the caller: this module defines what may be remembered and reads
 * and writes it through whatever the host supplies, so a run in bare Node covers
 * the same code the browser runs. Nothing here reaches for `localStorage`.
 *
 * The published chart is not here either. It arrives as data
 * (`@platform-toolkit/data-contracts`) and the arithmetic that reads it lives in
 * `@platform-toolkit/domain`, because a conversion is not this tool's to own --
 * every tool in the collection converts weights and there is exactly one
 * implementation of it.
 */

export {
  CHART_STEPS,
  CONVERTER_PREFERENCES,
  DEFAULT_PRECISION,
  EMPTY_ENTRY,
  RESULT_PRECISIONS,
  chartStepLabel,
  clearValue,
  entryProblem,
  leadingUnit,
  loadSettings,
  reverse,
  saveEntry,
  selectValue,
  setDirection,
  typeInto,
  weightProblem,
} from './session.js';
