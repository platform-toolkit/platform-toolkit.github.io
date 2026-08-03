// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

import { slugSegment } from './artifact-naming.js';

/**
 * A federation's published kilogram/pound conversion chart.
 *
 * WHY THIS IS DATA AND NOT ARITHMETIC
 *
 * The exact relationship between a pound and a kilogram is a definition and
 * lives in code (`KILOGRAMS_PER_POUND` in `packages/domain`). This is a different
 * thing entirely: a table a federation publishes, printed at one decimal place,
 * at the increments that federation runs meets in. A lifter loading a bar at a
 * USPA meet is loading a chart row, not a conversion -- and the chart is what
 * the scoring table, the attempt cards and the announcer are working from.
 *
 * So the rows are transcribed from the published document and never computed.
 * Two consequences that the rest of the pipeline is built around:
 *
 *   - Nothing may add a row. A weight between two rows is answered with the two
 *     rows around it, because a value the federation does not publish is not an
 *     attempt anybody can take, however correct its arithmetic.
 *   - Charts are per federation and carry their source. Two federations publish
 *     different pound equivalents for the same kilogram, and merging them into
 *     an unlabelled universal table would produce numbers no federation stands
 *     behind.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/** Prefix every conversion-chart artifact identifier carries. */
const CONVERSION_ARTIFACT_PREFIX = 'conversions';

/**
 * A link that will end up in an `href`.
 *
 * The scheme is checked rather than assumed. This artifact is fetched and parsed
 * at runtime, and `v.url()` alone accepts `javascript:` -- which is a string that
 * validates, renders, and executes when a lifter taps the source citation.
 */
const CitationUrl = v.pipe(
  v.string(),
  v.url(),
  v.check(
    (value) => value.startsWith('https://'),
    'A citation URL must be https so that it cannot carry a script or be read in transit.',
  ),
);

/**
 * One published row: both figures exactly as the federation prints them.
 *
 * `pounds` is the federation's own number, not a conversion of `kilograms`. They
 * usually agree to the decimal place shown, and when they do not it is the
 * federation's figure that a meet runs on.
 */
export const ConversionRowSchema = v.object({
  kilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
  pounds: v.pipe(v.number(), v.finite(), v.minValue(0)),
});

export type ConversionRow = v.InferOutput<typeof ConversionRowSchema>;

/**
 * Where a chart came from, carried with it so a screen can cite it.
 *
 * All four fields are required because the alternative is a tool that shows a
 * federation's numbers without saying whose they are or how old the copy is,
 * which is the failure the attribution rules exist to prevent.
 */
export const ConversionSourceSchema = v.object({
  /** How the document names itself, e.g. "Official USPA Kilo Conversion Chart". */
  label: Label,

  /** The page a reader should be sent to, not the file the transcription came from. */
  url: CitationUrl,

  /**
   * Which published revision these rows are.
   *
   * A string, not a date, because a federation is free to version its chart
   * however it likes and this project does not get to impose a scheme. What it
   * must not be is absent: without it, two builds a year apart are
   * indistinguishable.
   */
  revision: Identifier,

  /** The day a person last checked these rows against the published document. */
  verifiedOn: v.pipe(v.string(), v.isoDate()),
});

export type ConversionSource = v.InferOutput<typeof ConversionSourceSchema>;

export const ConversionChartSchema = v.object({
  /** The federation this chart belongs to. Never merged with another's. */
  id: Identifier,
  label: Label,

  source: ConversionSourceSchema,

  /**
   * The published rows, ascending.
   *
   * Two is the smallest number that makes "the rows around this value" a
   * question with an answer. Ordering and uniqueness are checked where the chart
   * is built rather than here: they are rules about the table as a whole, and
   * the failure has to name which rows disagree.
   */
  rows: v.pipe(v.array(ConversionRowSchema), v.minLength(2)),
});

export type ConversionChartData = v.InferOutput<typeof ConversionChartSchema>;

/**
 * Names the artifact holding one federation's conversion chart.
 *
 * Returns `null` when the identifier contains nothing that can appear in a
 * filename, for the same reason `categoryCatalogArtifactId` does: the browser
 * calls it on the way to deciding whether an artifact exists, and "there is no
 * such file" is an answer it already knows how to render.
 */
export function conversionChartArtifactId(federationId: string): string | null {
  const federation = slugSegment(federationId);
  return federation === null ? null : `${CONVERSION_ARTIFACT_PREFIX}-${federation}`;
}
