import * as v from 'valibot';

/**
 * Freshness and provenance for a single upstream source.
 *
 * Every source in this project refreshes on a different cadence, and some
 * refresh in tiers (national records every few hours, state records daily).
 * Reporting one site-wide "current as of" timestamp would imply the slowest
 * data is as fresh as the fastest, so freshness is always tracked per source.
 */
export const SourceFreshnessSchema = v.object({
  /** Stable identifier, e.g. "uspa-classifications", "records:national". */
  id: v.pipe(v.string(), v.minLength(1)),

  /** Human-readable label for display alongside the data it describes. */
  label: v.pipe(v.string(), v.minLength(1)),

  /** When this source was last successfully retrieved. */
  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),

  /**
   * Outcome of the most recent refresh attempt.
   *
   * `stale` means the last attempt failed and the previous good data is still
   * being served. It is deliberately distinct from `ok` so the interface can
   * say so rather than presenting old data as current.
   */
  status: v.picklist(['ok', 'stale', 'unavailable']),

  /** Present when status is not `ok`; explains what went wrong, in plain language. */
  note: v.optional(v.pipe(v.string(), v.minLength(1))),
});

export type SourceFreshness = v.InferOutput<typeof SourceFreshnessSchema>;

/** Top-level metadata artifact describing every published data source. */
export const DataMetaSchema = v.object({
  /** Schema version of this artifact, incremented on breaking shape changes. */
  schemaVersion: v.literal(1),

  /** When the publishing pipeline produced this build. */
  generatedAt: v.pipe(v.string(), v.isoTimestamp()),

  sources: v.pipe(v.array(SourceFreshnessSchema), v.minLength(1)),
});

export type DataMeta = v.InferOutput<typeof DataMetaSchema>;
