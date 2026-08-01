import {
  ClassificationBookSchema,
  classificationArtifactId,
  classificationShardKey,
  sameClassificationShard,
  type ClassificationBook,
  type ClassificationShardKey,
  type ClassificationTable,
} from '@platform-toolkit/data-contracts';

import type { ArtifactSource } from './publication.js';

/**
 * Splitting a corpus of classification standards into the files a browser fetches.
 *
 * The partition is (sex, equipment) and nothing finer, for the reason ADR 2 gives
 * about records: a screen shows one lifter, and a lifter is one sex lifting in one
 * equipment category -- but across all four lifts, in both the weight class they
 * are in and the one they are cutting to, and in every division they are eligible
 * for at once. Splitting on any of those would turn one screen into a dozen
 * requests, which is the opposite of what sharding is for.
 *
 * Sex alone would be the tidier key and is the wrong one. A federation publishing
 * four lifts across four equipment categories, twelve classes and a dozen
 * divisions runs to a couple of thousand tables per sex, which lands close enough
 * to the 2 MiB budget that the next division added would break the build.
 *
 * As with records, size is not checked here. `planPublication` has the serialized
 * bytes and throws under the shard's own name, which says which sex and which
 * equipment category needs splitting further.
 */

/** Thrown when a partition cannot be given a name of its own. */
export class ClassificationShardNamingError extends Error {
  override readonly name = 'ClassificationShardNamingError';
}

/** Thrown when two tables in one corpus claim the same identifier. */
export class DuplicateClassificationTableError extends Error {
  override readonly name = 'DuplicateClassificationTableError';

  constructor(readonly tableId: string) {
    super(`Two classification tables share the identifier "${tableId}".`);
  }
}

/** One partition, ready to publish. */
export interface ClassificationShardArtifact extends ArtifactSource<ClassificationBook> {
  /** The sex and equipment category this partition holds. */
  readonly key: ClassificationShardKey;
  /** How many tables are in it. Worth logging: it is what the budget is spent on. */
  readonly tableCount: number;
  /**
   * Narrowed from the `unknown` a generic artifact carries.
   *
   * Publishing accepts anything and validates it, because it takes artifacts from
   * every source. This one is built here from a value that is already a
   * classification book, so a caller inspecting a shard should not have to
   * re-establish that.
   */
  readonly value: ClassificationBook;
}

/**
 * Partitions a classification book by sex and equipment category.
 *
 * @param book         the whole corpus
 * @param equipmentIds every equipment category the federation defines, from its
 *   catalogue. Required, not inferred from the tables: a table that declines to
 *   distinguish on equipment has to be written into every partition, and the
 *   corpus itself cannot say what "every" means -- inferring it from the tables
 *   present would silently drop a category that happens to have no standards of
 *   its own yet.
 * @param schemaVersion version of {@link ClassificationBookSchema} for the index
 *
 * @throws {ClassificationShardNamingError} if a partition cannot be named, if two
 *   would share a name, or if `equipmentIds` is empty while a table needs it.
 * @throws {DuplicateClassificationTableError} if two tables share an identifier.
 */
export function shardClassificationBook(
  book: ClassificationBook,
  equipmentIds: readonly string[],
  schemaVersion: number,
): readonly ClassificationShardArtifact[] {
  const partitions = new Map<
    string,
    { key: ClassificationShardKey; tables: ClassificationTable[] }
  >();
  const seenTableIds = new Set<string>();

  for (const table of book.tables) {
    if (seenTableIds.has(table.id)) {
      throw new DuplicateClassificationTableError(table.id);
    }
    seenTableIds.add(table.id);

    for (const key of keysFor(book, table, equipmentIds)) {
      const artifactId = classificationArtifactId(book.id, key);
      if (artifactId === null) {
        throw new ClassificationShardNamingError(
          `No artifact name can be formed for ${key.sex} lifters in equipment ` +
            `category "${key.equipmentId}" of book "${book.id}".`,
        );
      }

      const existing = partitions.get(artifactId);
      if (existing === undefined) {
        partitions.set(artifactId, { key, tables: [table] });
        continue;
      }

      if (!sameClassificationShard(existing.key, key)) {
        // Slugging is lossy, so this is reachable with ordinary source data --
        // "Single Ply" and "single-ply" reduce to the same thing. Filing the
        // second under the first would hold a lifter to another equipment
        // category's standards with nothing on screen to suggest it.
        throw new ClassificationShardNamingError(
          `Artifact name "${artifactId}" is claimed by two partitions: ` +
            `${existing.key.sex} / "${existing.key.equipmentId}" and ` +
            `${key.sex} / "${key.equipmentId}".`,
        );
      }

      existing.tables.push(table);
    }
  }

  return [...partitions.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([artifactId, partition]) => ({
      id: artifactId,
      key: partition.key,
      tableCount: partition.tables.length,
      schema: ClassificationBookSchema,
      schemaVersion,
      value: {
        // The partition, not the book, so a fetched file names what is in it.
        id: artifactId,
        label: book.label,
        // Sorted by identifier rather than left in source order. Artifacts are
        // content-addressed, so a source that reorders its rows without changing
        // any of them would otherwise rewrite every filename and evict a cache
        // that was still correct.
        tables: [...partition.tables].sort((left, right) => compare(left.id, right.id)),
      } satisfies ClassificationBook,
    }));
}

/**
 * Which partitions one table belongs in.
 *
 * Usually exactly one. A table whose scope leaves equipment `null` -- the source
 * saying it does not distinguish -- belongs in all of them, because the browser
 * builds a shard key from the lifter's own concrete answers and can never ask for
 * a partition of tables that declined to answer. The scope is left as it was: the
 * `null` still means "does not distinguish", and it is what keeps such a table
 * ranked below a specific one when both match.
 */
function keysFor(
  book: ClassificationBook,
  table: ClassificationTable,
  equipmentIds: readonly string[],
): readonly ClassificationShardKey[] {
  const key = classificationShardKey(table.scope);
  if (key !== null) {
    return [key];
  }
  if (equipmentIds.length === 0) {
    throw new ClassificationShardNamingError(
      `Table "${table.id}" of book "${book.id}" does not distinguish on equipment, but no ` +
        'equipment categories were supplied to expand it into.',
    );
  }
  return equipmentIds.map((equipmentId) => ({ sex: table.scope.sex, equipmentId }));
}

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
