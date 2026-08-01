import { slugSegment } from './artifact-naming.js';
import type { ClassificationScope } from './classification.js';
import type { SexCategory } from './categories.js';

/**
 * How a federation's classification standards are partitioned.
 *
 * One federation publishes a standard for every combination of sex, lift,
 * equipment category, weight class, and age division, which runs to thousands of
 * tables and past the 2 MiB an artifact is budgeted at. So they are split, on the
 * same principle as the records in `record-shards.ts`: on the axes a reader holds
 * fixed, never on the ones a single screen varies.
 *
 * A lifter has one sex and competes in one equipment category. Within that, the
 * screen moves freely -- their squat and their total, this weight class and the
 * one they are cutting to, the Open division and their Masters division -- and
 * every one of those is one file away rather than another download.
 */

/**
 * The axes a classification corpus is partitioned on.
 *
 * Both are required, which is a constraint on what may be published rather than
 * a claim about how federations write their rulebooks. `ClassificationScope`
 * allows a null equipment category, meaning "the same standards apply to all",
 * and that is a perfectly good thing for a federation to publish -- but a reader
 * arrives knowing which category they lift in, not which categories a table
 * declined to distinguish, so it could not work out which file to ask for. The
 * publisher resolves it instead, by writing such a table into every equipment
 * category's partition.
 */
export interface ClassificationShardKey {
  readonly sex: SexCategory;
  readonly equipmentId: string;
}

/**
 * The partition a table belongs to, or `null` if it does not name an equipment
 * category and so belongs to all of them at once.
 *
 * The `null` is the publisher's problem, not the browser's: the browser only
 * ever builds a key from a lifter's own answers, both of which it has.
 */
export function classificationShardKey(scope: ClassificationScope): ClassificationShardKey | null {
  return scope.equipmentId === null ? null : { sex: scope.sex, equipmentId: scope.equipmentId };
}

/** Whether two keys name the same partition. */
export function sameClassificationShard(
  left: ClassificationShardKey,
  right: ClassificationShardKey,
): boolean {
  return left.sex === right.sex && left.equipmentId === right.equipmentId;
}

/** Prefix every classification artifact identifier carries, so the index reads sorted. */
const CLASSIFICATION_ARTIFACT_PREFIX = 'classifications';

/**
 * Names the artifact holding one partition of one federation's standards.
 *
 * Returns `null` when an identifier contains nothing that can appear in a
 * filename. Total for the same reason `recordArtifactId` is: the browser calls
 * it on the way to deciding whether an artifact exists, and "there is no such
 * file" is an answer it already knows how to render.
 */
export function classificationArtifactId(
  federationId: string,
  key: ClassificationShardKey,
): string | null {
  const federation = slugSegment(federationId);
  const sex = slugSegment(key.sex);
  const equipment = slugSegment(key.equipmentId);
  if (federation === null || sex === null || equipment === null) {
    return null;
  }
  return `${CLASSIFICATION_ARTIFACT_PREFIX}-${federation}-${sex}-${equipment}`;
}
