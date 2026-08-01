import type { RecordScope } from './records.js';

/**
 * How a record corpus is partitioned, and what each partition is called.
 *
 * A complete set of records runs to hundreds of thousands of rows, which is far
 * past what any browser should be handed to answer one question. ADR 2 records
 * the measurements and the decision: the corpus is split, and it is split on the
 * axes a lifter actually asks along, so that one question needs one file.
 *
 * The naming lives here, in the contracts package, for the same reason every
 * other shape does. The build writes these names into the index and the browser
 * computes them again to decide what to fetch. If the two ever disagreed the
 * symptom would be a lookup that finds nothing -- indistinguishable, on screen,
 * from a category with no records in it, which is a real and unremarkable
 * answer. Sharing one function is what makes that failure impossible rather
 * than merely unlikely.
 *
 * Nothing above the data-access seam sees any of this. Callers name a level and
 * a region because that is what they know; the shard is an implementation
 * detail of where those records happen to be stored.
 */

/** Prefix every record artifact identifier carries, so the index reads sorted. */
const RECORD_ARTIFACT_PREFIX = 'records';

/**
 * The axes a record corpus is partitioned on.
 *
 * Level and region, and nothing finer. A lifter looks at one level at a time --
 * their state's records, then the national ones -- and every other axis (sex,
 * equipment, weight class, division, tested, lift) narrows within that view
 * rather than replacing it. Splitting on those too would mean a screen showing
 * a lifter their four lifts had to fetch four files.
 */
export interface RecordShardKey {
  readonly levelId: string;
  /** `null` where the level has no subdivision, as on a national record. */
  readonly regionId: string | null;
}

/** The partition a record belongs to. */
export function recordShardKey(scope: RecordScope): RecordShardKey {
  return { levelId: scope.levelId, regionId: scope.regionId };
}

/** Whether two keys name the same partition. */
export function sameRecordShard(left: RecordShardKey, right: RecordShardKey): boolean {
  return left.levelId === right.levelId && left.regionId === right.regionId;
}

/**
 * Names the artifact holding one partition of one book.
 *
 * Returns `null` when an identifier contains nothing that can appear in a
 * filename -- punctuation only, or an empty string. Total rather than throwing
 * because the browser calls this too, on its way to deciding whether an
 * artifact exists, and "there is no such file" is an answer it already knows how
 * to render. The build treats the same `null` as the data bug it is.
 *
 * Slugging is lossy, so two different identifiers can produce one name. That is
 * checked where the corpus is partitioned, not here: this function sees one key
 * at a time and cannot know what else was published.
 */
export function recordArtifactId(bookId: string, key: RecordShardKey): string | null {
  const book = toSlug(bookId);
  const level = toSlug(key.levelId);
  if (book === null || level === null) {
    return null;
  }

  if (key.regionId === null) {
    return `${RECORD_ARTIFACT_PREFIX}-${book}-${level}`;
  }

  const region = toSlug(key.regionId);
  return region === null ? null : `${RECORD_ARTIFACT_PREFIX}-${book}-${level}-${region}`;
}

/**
 * Reduces a source identifier to the character set an artifact name allows.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the same corpus must produce
 * the same filenames on a build machine in any locale, and the Turkish dotless
 * i would otherwise make that untrue.
 */
function toSlug(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? null : slug;
}
