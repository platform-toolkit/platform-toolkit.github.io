// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  ATHLETE_SHARD_COUNT,
  AthleteShardSchema,
  athleteArtifactId,
  athleteLookupKey,
  athleteShardBucket,
  type AthleteHistory,
  type AthleteShard,
} from '@platform-toolkit/data-contracts';

import type { ArtifactSource } from './publication.js';

/**
 * Splitting the athlete mirror into the files a browser will actually fetch.
 *
 * The whole mirror is a couple of hundred megabytes; a lifter's screen needs one
 * lifter. `athlete-shards.ts` in the contracts package holds the reasoning for
 * partitioning on a hash of the lookup key rather than on anything a reader would
 * recognise, and the measurements behind the bucket count. Nothing about the
 * partitioning is decided here.
 *
 * Two hazards are checked rather than documented, because both are silent:
 *
 * 1. A key that is not its own fold. The browser computes a key from what a
 *    visitor typed and looks for a shard under it; a shard published under a key
 *    the fold would never produce is a lifter who cannot be found by any input.
 *
 * 2. Two histories for one person. Their entries would be split across two
 *    records in the same shard, and every screen showing "every result in this
 *    window" would show half of them -- with no error, and with the half it did
 *    show being perfectly correct.
 */

/** Thrown when a history is published under a key nobody could look it up by. */
export class UnreachableAthleteError extends Error {
  override readonly name = 'UnreachableAthleteError';
}

/** Thrown when one lifter appears twice in the mirror. */
export class DuplicateAthleteError extends Error {
  override readonly name = 'DuplicateAthleteError';

  constructor(readonly key: string) {
    // The key and never the name (section 2.3). A key is a fold and is enough to
    // find the pair in the source; a name in a CI log is a person in a CI log.
    super(`Two histories are published for one lifter under key "${key}".`);
  }
}

/** One bucket, ready to publish. */
export interface AthleteShardArtifact extends ArtifactSource<AthleteShard> {
  readonly bucket: number;
  /** How many lifters are in it. */
  readonly athleteCount: number;
  /** How many entries are in it. What the size budget is actually spent on. */
  readonly entryCount: number;
  /** Narrowed from the `unknown` a generic artifact carries. See `shard-records.ts`. */
  readonly value: AthleteShard;
}

/**
 * Partitions a mirror into buckets.
 *
 * Empty buckets are not emitted. With ninety thousand lifters across five hundred
 * buckets none of them is empty in practice, but a smaller mirror -- a test, or a
 * scoped rebuild -- would otherwise publish hundreds of files saying nothing, and
 * `AthleteShardSchema` refuses a shard with no lifters in it precisely so that a
 * fetched file always answers something.
 *
 * @throws {UnreachableAthleteError} if a key is not the fold of itself.
 * @throws {DuplicateAthleteError} if two histories share a key and a name.
 */
export function shardAthleteMirror(
  athletes: readonly AthleteHistory[],
  schemaVersion: number,
): readonly AthleteShardArtifact[] {
  const buckets = new Map<number, AthleteHistory[]>();
  const seen = new Set<string>();

  for (const athlete of athletes) {
    if (athleteLookupKey(athlete.key) !== athlete.key) {
      throw new UnreachableAthleteError(
        `Key "${athlete.key}" is not the fold of itself, so no input a visitor can type ` +
          'will ever resolve to it.',
      );
    }

    // Keyed on both, because a shared key is expected -- two people can fold
    // together and both belong in the mirror -- and a shared key *and* name is
    // one person listed twice.
    //
    // The separator is load-bearing and is spelled as an escape (section 2.4;
    // the literal character reads as nothing at all and a file holding one has
    // been classified binary by git before now, which stops its diff being
    // printed). Concatenated without it, a lifter keyed `ab` named `c` and one
    // keyed `a` named `bc` are one identity, and the second of them is dropped
    // as a duplicate -- silently, with the shard still valid. U+001F is the unit
    // separator and cannot occur in a key, which is `[a-z0-9]` by construction.
    const identity = `${athlete.key}\u001f${athlete.name}`;
    if (seen.has(identity)) {
      throw new DuplicateAthleteError(athlete.key);
    }
    seen.add(identity);

    const bucket = athleteShardBucket(athlete.key);
    const existing = buckets.get(bucket);
    if (existing === undefined) {
      buckets.set(bucket, [athlete]);
      continue;
    }
    existing.push(athlete);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucket, held]) => {
      const artifactId = athleteArtifactId(bucket);
      if (artifactId === null) {
        // Unreachable through `athleteShardBucket`, which returns a remainder of
        // the same constant. Checked anyway because the alternative to a thrown
        // error here is `null` reaching the index as a filename.
        throw new UnreachableAthleteError(`Bucket ${String(bucket)} cannot be named.`);
      }

      return {
        id: artifactId,
        bucket,
        athleteCount: held.length,
        entryCount: held.reduce((total, athlete) => total + athlete.entries.length, 0),
        schema: AthleteShardSchema,
        schemaVersion,
        value: {
          bucket,
          bucketCount: ATHLETE_SHARD_COUNT,
          // Sorted by key, then by name to separate two lifters who fold
          // together. Artifacts are content-addressed, so a source that merely
          // reordered its rows would otherwise rewrite every filename and evict
          // a cache that was still correct.
          athletes: [...held].sort(
            (left, right) => compare(left.key, right.key) || compare(left.name, right.name),
          ),
        } satisfies AthleteShard,
      };
    });
}

/** Code-unit ordering, so the result does not depend on the build machine's locale. */
function compare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
