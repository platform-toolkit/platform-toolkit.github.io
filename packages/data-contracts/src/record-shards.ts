import type { SexCategory } from './categories.js';
import { slugSegment } from './artifact-naming.js';
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
 * Level and region choose which competition's records these are; sex and
 * equipment narrow it to a file a phone can hold. Every remaining axis --
 * weight class, division, tested, lift -- stays *inside* a partition, because a
 * lifter wants all of them at once: four lifts, the class they are in and the
 * one they are cutting to, and every division they are eligible for, on one
 * screen. Splitting on any of those turns that screen into a dozen requests,
 * which is the opposite of what sharding is for.
 *
 * WHY SEX AND EQUIPMENT, MEASURED RATHER THAN GUESSED
 *
 * Level and region alone were the original design and they are not enough. On
 * the real corpus the national partition is 15,593 rows and the world one
 * 12,275; at the ~440 bytes a record serializes to (ADR 2) those are 6.9 MB and
 * 5.4 MB against a 2 MiB budget, and two states clear it as well. Adding sex and
 * equipment divides each by eight.
 *
 * What makes that a fix rather than a reprieve is that the result is **bounded,
 * not extrapolated**. A record exists per distinct scope, so a partition can
 * hold at most (weight classes × divisions × lifts × tested) rows however many
 * meets are held -- for the corpus this was measured on, 14 × 25 × 4 × 2, about
 * 2,800 rows or 1.2 MB. Records replace each other; they do not accumulate. A
 * federation would have to add weight classes or divisions to threaten the
 * budget again, and that is a change somebody makes deliberately.
 *
 * The same pair as `ClassificationShardKey`, for the same reason, and that is
 * not a coincidence worth removing: a lifter is one sex in one equipment
 * category, and both screens are about one lifter.
 */
export interface RecordShardKey {
  readonly levelId: string;
  /** `null` where the level has no subdivision, as on a national record. */
  readonly regionId: string | null;
  readonly sex: SexCategory;
  readonly equipmentId: string;
}

/**
 * The partition a record belongs to.
 *
 * Total, unlike `classificationShardKey`, which returns `null` for a table that
 * declines to name an equipment category. A record cannot decline: it is a fact
 * about a lift that actually happened, so every axis is pinned (see
 * `RecordScopeSchema`) and there is no "applies to everyone" case to expand.
 */
export function recordShardKey(scope: RecordScope): RecordShardKey {
  return {
    levelId: scope.levelId,
    regionId: scope.regionId,
    sex: scope.sex,
    equipmentId: scope.equipmentId,
  };
}

/** Whether two keys name the same partition. */
export function sameRecordShard(left: RecordShardKey, right: RecordShardKey): boolean {
  return (
    left.levelId === right.levelId &&
    left.regionId === right.regionId &&
    left.sex === right.sex &&
    left.equipmentId === right.equipmentId
  );
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
  const book = slugSegment(bookId);
  const level = slugSegment(key.levelId);
  // The sex is slugged like everything else even though today's picklist holds two
  // words that are already slugs. It costs nothing, and it means a federation
  // vocabulary that later admits a value with a space or a slash in it is named
  // correctly rather than producing a filename the index refuses.
  const sex = slugSegment(key.sex);
  const equipment = slugSegment(key.equipmentId);
  if (book === null || level === null || sex === null || equipment === null) {
    return null;
  }

  // Built as a list so the region is *absent* rather than empty for a level with
  // no subdivision. Interpolating a blank would give `...-national--female-raw`,
  // which is a filename that works and reads as a bug in every listing it
  // appears in.
  const place: string[] = [level];
  if (key.regionId !== null) {
    const region = slugSegment(key.regionId);
    if (region === null) {
      return null;
    }
    place.push(region);
  }

  return [RECORD_ARTIFACT_PREFIX, book, ...place, sex, equipment].join('-');
}
