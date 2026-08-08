// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { ConversionDirection, EnteredWeight, WeightUnit } from '@platform-toolkit/domain';

/**
 * The vocabulary this tool answers in.
 *
 * One rule shapes it: **the exact arithmetic and the federation's published row
 * are two different numbers and are never conflated**. Neither appears here,
 * because both belong to `@platform-toolkit/domain` -- `ConversionAnswer` carries
 * them side by side and this package's job is to decide what is asked and how it
 * is read, not to invent a third figure. What is here is the state of the field,
 * the state of the read, and what survives a refresh.
 */

/**
 * How the read of the published chart is going. Rendered as three sentences, not one.
 *
 * Four states and not two. `unavailable` is not an error and does not get the error
 * tone: the read succeeded and the federation publishes no chart, so a reload
 * changes nothing. Collapsing them is how somebody reloads a page that will never
 * load, and how a lifter concludes their weight is simply not on the chart.
 */
export type ChartStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

/**
 * Which column the full chart leads with.
 *
 * The requirements ask for "pounds-first or kilograms-first order", and on this
 * data that is a question about column order rather than sort order: both columns
 * ascend together, so sorting by one sorts by the other. Modelling it as a sort
 * direction would offer a control that visibly does nothing.
 */
export type ColumnOrder = 'kilograms-first' | 'pounds-first';

/** The converter's whole editable state. */
export interface ConverterEntry {
  /** Which way round the conversion is running. */
  readonly direction: ConversionDirection;
  /** Exactly what is in the field. A string until something parses it. */
  readonly text: string;
  /**
   * The drift-free origin behind the field, or `null` when nothing parses.
   *
   * Separate from `text` rather than derived from it, because the two answer
   * different questions: `text` is what the visitor can see and edit, and this is
   * what a reversal converts. A half-typed `12.` has a text and no origin.
   */
  readonly entry: EnteredWeight | null;
}

/** Everything the converter reads back on start-up. */
export interface ConverterSettings {
  readonly entry: ConverterEntry;
  readonly precision: number;
  readonly step: number;
  readonly order: ColumnOrder;
}

/**
 * The remembered value, and whether there was one.
 *
 * Three fields where two look sufficient, and the third is the one that matters.
 * `unit` is the unit the number was *typed* in and `shownIn` is the unit it is
 * currently being read in, and after a reversal those differ -- the origin is
 * never rewritten, which is the whole basis of the drift-free field. Storing
 * only the origin brings back 315 lb with the direction reset; storing only the
 * displayed figure brings back a rounded 142.88 kg and starts the drift the type
 * exists to prevent. Both, and a reload is exactly where the visitor left off.
 *
 * The `present` flag is not redundant with a zero amount either: zero is a
 * legitimate thing to convert -- the requirements say so explicitly -- so
 * encoding "empty" as zero, the way tool 2's weights do, would turn a typed `0`
 * into an empty field on the next visit.
 */
export interface StoredValue {
  readonly amount: number;
  /** The unit it was typed in. Never rewritten. */
  readonly unit: WeightUnit;
  /** The unit it is currently displayed in. Differs after a reversal. */
  readonly shownIn: WeightUnit;
  readonly present: boolean;
}
