import {
  RecordBookSchema,
  recordArtifactId,
  recordShardKey,
  sameRecordShard,
  type FederationRecord,
  type RecordBook,
  type RecordShardKey,
} from '@platform-toolkit/data-contracts';

import type { ArtifactSource } from './publication.js';

/**
 * Splitting a record corpus into the files a browser will actually fetch.
 *
 * ADR 2 measured a record row at about 440 bytes, which puts a complete set
 * somewhere past four hundred megabytes. This is the function that keeps that
 * off a phone: it partitions on the axes named by `RecordShardKey` -- level,
 * region, sex and equipment -- so that one question needs one file.
 *
 * The key is where the reasoning for those four lives, including the measurements
 * that ruled out the narrower pair. Nothing about the partitioning is decided
 * here; this function only applies it and refuses the two ways it can go wrong.
 *
 * It produces the list `planPublication` already accepts and changes nothing
 * about publishing. The size budget is enforced there, on the serialized bytes,
 * because that is the only place the real number is known; a shard that is still
 * too large fails the build under its own name, which is enough to say which
 * partition needs splitting further.
 *
 * Two hazards are checked rather than documented, because both are silent:
 *
 * 1. Two different scopes can slug to one artifact name, and the second would
 *    then be filed under the first. A lifter would be shown another region's
 *    records with nothing to indicate it.
 *
 * 2. A duplicated record identifier means two rows claim to be the same record.
 *    Whichever the reader picks is arbitrary, and one of them is wrong.
 */

/** Thrown when a partition cannot be given a name of its own. */
export class ShardNamingError extends Error {
  override readonly name = 'ShardNamingError';
}

/** Thrown when two records in one corpus claim the same identifier. */
export class DuplicateRecordError extends Error {
  override readonly name = 'DuplicateRecordError';

  constructor(readonly recordId: string) {
    super(`Two records share the identifier "${recordId}".`);
  }
}

/** One partition, ready to publish. */
export interface RecordShardArtifact extends ArtifactSource<RecordBook> {
  /** Which slice of the corpus this partition holds. */
  readonly key: RecordShardKey;
  /** How many records are in it. Worth logging: it is what the budget is spent on. */
  readonly recordCount: number;
  /**
   * Narrowed from the `unknown` a generic artifact carries.
   *
   * Publishing accepts anything and validates it, because it takes artifacts from
   * every source. This one is built here, from a value that is already a record
   * book, so a caller inspecting a shard should not have to re-establish that.
   */
  readonly value: RecordBook;
}

/**
 * Partitions a record book onto the axes `RecordShardKey` names.
 *
 * @param book          the whole corpus
 * @param schemaVersion version of {@link RecordBookSchema} to record in the index
 *
 * @throws {ShardNamingError} if a partition cannot be named, or if two would
 *   share a name.
 * @throws {DuplicateRecordError} if two records share an identifier.
 */
export function shardRecordBook(
  book: RecordBook,
  schemaVersion: number,
): readonly RecordShardArtifact[] {
  const partitions = new Map<string, { key: RecordShardKey; records: FederationRecord[] }>();
  const seenRecordIds = new Set<string>();

  for (const record of book.records) {
    if (seenRecordIds.has(record.id)) {
      throw new DuplicateRecordError(record.id);
    }
    seenRecordIds.add(record.id);

    const key = recordShardKey(record.scope);
    const artifactId = recordArtifactId(book.id, key);
    if (artifactId === null) {
      throw new ShardNamingError(
        `No artifact name can be formed for ${describe(key)} of book "${book.id}".`,
      );
    }

    const existing = partitions.get(artifactId);
    if (existing === undefined) {
      partitions.set(artifactId, { key, records: [record] });
      continue;
    }

    if (!sameRecordShard(existing.key, key)) {
      // Slugging is lossy, so this is reachable with ordinary source data --
      // "New York" and "new-york" reduce to the same thing. Filing the second
      // under the first would show a lifter another region's records with
      // nothing on screen to suggest it.
      throw new ShardNamingError(
        `Artifact name "${artifactId}" is claimed by two partitions: ` +
          `${describe(existing.key)} and ${describe(key)}.`,
      );
    }

    existing.records.push(record);
  }

  return [...partitions.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([artifactId, partition]) => ({
      id: artifactId,
      key: partition.key,
      recordCount: partition.records.length,
      schema: RecordBookSchema,
      schemaVersion,
      value: {
        // The partition, not the book, so a fetched file names what is in it.
        id: artifactId,
        label: book.label,
        minimumIncrementKilograms: book.minimumIncrementKilograms,
        // Sorted by identifier rather than left in source order. Artifacts are
        // content-addressed, so a source that reorders its rows without
        // changing any of them would otherwise rewrite every filename and evict
        // a cache that was still correct.
        records: [...partition.records].sort((left, right) => compare(left.id, right.id)),
      } satisfies RecordBook,
    }));
}

/**
 * A partition, in the words the source document uses for it.
 *
 * Every axis, always, even the ones that happen to be equal in a collision --
 * the whole point of the message is to send somebody to the two rows that
 * produced it, and a message naming only what differs makes them guess which
 * pair of rows those were. Identifiers only: a record carries a holder's name and
 * §2.3 keeps one out of anything that reaches a log or a CI transcript.
 */
function describe(key: RecordShardKey): string {
  return (
    `level "${key.levelId}" region "${key.regionId ?? '(none)'}" ` +
    `sex "${key.sex}" equipment "${key.equipmentId}"`
  );
}

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
