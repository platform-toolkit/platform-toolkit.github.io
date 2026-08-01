import {
  ConversionChartSchema,
  type ConversionChartData,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import { ConversionChart } from '@platform-toolkit/domain';
import * as v from 'valibot';

/**
 * Turning a transcribed conversion chart into the artifact the browser reads.
 *
 * The document this reads is a hand transcription of a federation's published
 * chart, so every check here is aimed at the same failure: a row that is not what
 * the federation printed. Nothing in this file can add, remove, or adjust a row.
 * It validates and it reports, and a document it will not accept is a document
 * somebody has to go and read against the source again.
 *
 * TWO CHECKS THAT ARE NOT THE SAME CHECK
 *
 * A chart prints its own conversion factor, and it is usually possible to
 * reproduce every row from it. That is worth checking -- a transposed digit will
 * not reproduce -- but the result is a *report*, not a veto. If a revision prints
 * a row its own factor does not reproduce, that row is still what the meet will
 * run on, and a build that refused it would be a build insisting the federation
 * is wrong about its own chart.
 *
 * A gap in the increments is the opposite: the build stops. A chart in uniform
 * 2.5 kg steps with one 5 kg step is either a federation that changed increments
 * or a row lost during transcription, and the two are indistinguishable from here.
 * Publishing on the assumption that it is the former would put a hole in the
 * lookup that shows up as an attempt weight nobody can take. So a gap has to be
 * acknowledged in the document by a person who has looked, which is what
 * `chart.acknowledgedGaps` is for -- the requirement is that a missing increment
 * be flagged for review, never generated.
 */

/**
 * How far a row may sit from the factor the chart prints before it is reported.
 *
 * Published pounds are given to one decimal, so a row and its recomputation can
 * differ by half of the last place purely from where the federation's own
 * rounding fell. Anything past that is a discrepancy worth a person's attention.
 */
const FACTOR_TOLERANCE = 0.05;

/**
 * Where a transcription came from and when.
 *
 * The same shape the other curated documents use. `retrievedAt` is the day the
 * document was read, not the day the build ran.
 */
const ProvenanceSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  /** The upstream document, named as it names itself. */
  document: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  sections: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/**
 * A gap somebody has looked at and vouched for.
 *
 * Both endpoints are written out rather than just the lower one, so that a row
 * inserted between them stops matching and the acknowledgement expires instead of
 * silently covering a different gap than the one it was written for.
 */
const AcknowledgedGapSchema = v.object({
  belowKilograms: v.pipe(v.number(), v.finite()),
  aboveKilograms: v.pipe(v.number(), v.finite()),
  /** Why this is the published increment and not a missing row. Required. */
  reason: v.pipe(v.string(), v.minLength(1)),
});

const ChartSchema = v.object({
  /**
   * Which published revision this is, as the document versions itself.
   *
   * A string because a federation is free to use a date, a year, or nothing at
   * all -- but not absent, or two transcriptions a decade apart look alike.
   */
  revision: v.pipe(v.string(), v.minLength(1)),

  /**
   * The digest of the exact bytes this was transcribed from, and where they live.
   *
   * Nothing here fetches them. `check:upstream` does, on a schedule, and reports
   * a revision that the repository has not caught up with. This pair is why the
   * source document does not have to be committed: a chart that carries a
   * federation's logo can be pinned without being redistributed.
   */
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u, 'a lowercase sha-256 digest')),
  url: v.pipe(v.string(), v.url()),

  /** The factor the chart itself prints, used as a check and never as a source. */
  statedFactor: v.pipe(v.number(), v.finite(), v.minValue(0)),

  rows: v.pipe(
    v.array(
      v.object({
        kilograms: v.pipe(v.number(), v.finite(), v.minValue(0)),
        pounds: v.pipe(v.number(), v.finite(), v.minValue(0)),
      }),
    ),
    v.minLength(2),
  ),

  /** Gaps a person has checked against the document. Absent means none. */
  acknowledgedGaps: v.optional(v.array(AcknowledgedGapSchema), []),
});

/**
 * The curated form of one federation's conversion chart.
 *
 * `$comment` keys are tolerated wherever they appear and dropped rather than
 * published, for the same reason as everywhere else: JSON has no comments, and a
 * 180-row transcription that cannot explain how it was verified is one nobody
 * will dare touch.
 */
export const ConversionSourceDocumentSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  provenance: ProvenanceSchema,
  chart: ChartSchema,
});

export type ConversionSourceDocument = v.InferOutput<typeof ConversionSourceDocumentSchema>;

/** Thrown when a transcribed chart is unusable. Carries every problem, not the first. */
export class ConversionSourceError extends Error {
  override readonly name = 'ConversionSourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Conversion chart source document is unusable:\n  ${problems.join('\n  ')}`);
  }
}

/** A row the chart's own printed factor does not reproduce. Reported, never fixed. */
export interface ConversionAnomaly {
  readonly kilograms: number;
  /** What the chart prints. */
  readonly publishedPounds: number;
  /** What the chart's own factor gives. Never published, never substituted. */
  readonly factorPounds: number;
}

export interface ConversionSourceResult {
  readonly chart: ConversionChartData;
  readonly freshness: SourceFreshness;
  /**
   * Rows that disagree with the chart's printed factor.
   *
   * Empty in the normal case. Non-empty is a signal to re-read those rows against
   * the document, and the publish step prints them for exactly that reason.
   */
  readonly anomalies: readonly ConversionAnomaly[];
}

/**
 * Validates a transcribed chart and produces the artifact and its freshness entry.
 *
 * @throws {ConversionSourceError} if the document does not parse, or parses but
 *   describes a table that could not be looked up in safely.
 */
export function buildConversionChart(document: unknown): ConversionSourceResult {
  const parsed = v.safeParse(ConversionSourceDocumentSchema, document);
  if (!parsed.success) {
    throw new ConversionSourceError(
      parsed.issues.map(
        (issue) => `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }
  const source = parsed.output;

  const candidate = {
    id: source.id,
    label: source.label,
    source: {
      label: source.provenance.document,
      url: source.provenance.url,
      revision: source.chart.revision,
      // The day the document was read is the day these rows were last checked
      // against it. Two fields for one fact would eventually disagree, and the
      // one that drifted would be the one on screen.
      verifiedOn: source.provenance.retrievedAt.slice(0, 'YYYY-MM-DD'.length),
    },
    rows: source.chart.rows,
  };

  // Against the contract the browser reads it with, before the domain sees it.
  const contract = v.safeParse(ConversionChartSchema, candidate);
  if (!contract.success) {
    throw new ConversionSourceError(
      contract.issues.map(
        (issue) => `built chart: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }

  // The domain holds the rules about the table as a whole -- ordering, duplicates
  // -- and they are checked here rather than only in the browser because this is
  // where the failure can name the file somebody has to edit.
  const built = ConversionChart.from(contract.output);
  if (!built.ok) {
    throw new ConversionSourceError(built.problems.map((problem) => problem.message));
  }

  const problems = unacknowledgedGaps(built.chart.gaps, source.chart.acknowledgedGaps);
  if (problems.length > 0) {
    throw new ConversionSourceError(problems);
  }

  return {
    chart: contract.output,
    freshness: {
      id: source.provenance.id,
      label: `${source.provenance.label} (${source.provenance.document})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. Whether upstream has revised the chart is `check:upstream`'s
      // question, and it has the digest to answer it with; guessing here would
      // put a claim on screen that nothing backs.
      status: 'ok',
    },
    anomalies: findAnomalies(source.chart.rows, source.chart.statedFactor),
  };
}

/**
 * Reads the pin without validating the rest of the document.
 *
 * `check:upstream` needs the digest and the URL and nothing else, and it has to
 * keep working on a document the build is currently rejecting -- a chart that
 * failed to publish is precisely when knowing whether upstream moved is most
 * useful.
 */
export function readConversionSourceReferences(document: unknown): {
  readonly federationId: string;
  readonly chartSha256: string;
  readonly chartUrl: string;
} {
  const PinSchema = v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    chart: v.object({
      sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u, 'a lowercase sha-256 digest')),
      url: v.pipe(v.string(), v.url()),
    }),
  });

  const parsed = v.safeParse(PinSchema, document);
  if (!parsed.success) {
    throw new ConversionSourceError(
      parsed.issues.map(
        (issue) => `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }
  return {
    federationId: parsed.output.id,
    chartSha256: parsed.output.chart.sha256,
    chartUrl: parsed.output.chart.url,
  };
}

function unacknowledgedGaps(
  gaps: readonly { below: { kilograms: number }; above: { kilograms: number } }[],
  acknowledged: readonly v.InferOutput<typeof AcknowledgedGapSchema>[],
): readonly string[] {
  const problems: string[] = [];
  for (const gap of gaps) {
    const vouched = acknowledged.some(
      (entry) =>
        entry.belowKilograms === gap.below.kilograms &&
        entry.aboveKilograms === gap.above.kilograms,
    );
    if (!vouched) {
      problems.push(
        `chart: the increment changes between ${String(gap.below.kilograms)} kg and ` +
          `${String(gap.above.kilograms)} kg. If the document really skips there, say so in ` +
          '`chart.acknowledgedGaps`; otherwise a row is missing. Nothing will fill it in.',
      );
    }
  }

  // The other direction: an acknowledgement that no longer describes a gap. Left
  // alone, it would sit in the document vouching for nothing and would be read as
  // a fact about the chart by the next person.
  for (const entry of acknowledged) {
    const stillThere = gaps.some(
      (gap) =>
        gap.below.kilograms === entry.belowKilograms &&
        gap.above.kilograms === entry.aboveKilograms,
    );
    if (!stillThere) {
      problems.push(
        `chart.acknowledgedGaps: there is no longer a gap between ` +
          `${String(entry.belowKilograms)} kg and ${String(entry.aboveKilograms)} kg. Remove it.`,
      );
    }
  }

  return problems;
}

function findAnomalies(
  rows: readonly { kilograms: number; pounds: number }[],
  factor: number,
): readonly ConversionAnomaly[] {
  const anomalies: ConversionAnomaly[] = [];
  for (const row of rows) {
    const factorPounds = Math.round(row.kilograms * factor * 10) / 10;
    if (Math.abs(factorPounds - row.pounds) > FACTOR_TOLERANCE) {
      anomalies.push({
        kilograms: row.kilograms,
        publishedPounds: row.pounds,
        factorPounds,
      });
    }
  }
  return anomalies;
}
