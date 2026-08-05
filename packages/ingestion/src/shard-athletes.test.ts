// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  ATHLETE_SHARD_COUNT,
  AthleteShardSchema,
  athleteLookupKey,
  athleteShardBucket,
  findAthleteHistories,
  type AthleteEntry,
  type AthleteHistory,
} from '@platform-toolkit/data-contracts';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  DuplicateAthleteError,
  UnreachableAthleteError,
  shardAthleteMirror,
} from './shard-athletes.js';

const SCHEMA_VERSION = 1;

/**
 * One entry, with every axis invented.
 *
 * Nothing here is a real lifter and nothing here is a real meet. Section 5.1
 * forbids federation figures in source, and a mirror of competition results is
 * the one corpus where a plausible fixture would also be a person.
 */
function entry(overrides: Partial<AthleteEntry> = {}): AthleteEntry {
  return {
    date: '2026-03-14',
    federation: 'Invented Federation',
    parentFederation: null,
    meetName: 'Invented Open',
    event: 'SBD',
    equipment: 'Raw',
    division: null,
    ageClass: null,
    age: null,
    tested: null,
    sex: 'F',
    bodyweightKg: 60,
    weightClassKg: '60',
    squatKg: 100,
    benchKg: 60,
    deadliftKg: 120,
    totalKg: 280,
    place: '1',
    ...overrides,
  };
}

/** A history whose key really is the fold of its name, the way the adapter builds one. */
function history(name: string, entries: readonly AthleteEntry[] = [entry()]): AthleteHistory {
  const key = athleteLookupKey(name);
  if (key === null) {
    throw new Error(`Fixture name ${name} folds to nothing.`);
  }
  return { key, name, entries: [...entries] };
}

describe('shardAthleteMirror', () => {
  it('puts a lifter in the bucket their key hashes to', () => {
    const one = history('Ada Invented');
    const [shard] = shardAthleteMirror([one], SCHEMA_VERSION);

    expect(shard?.bucket).toBe(athleteShardBucket(one.key));
    expect(shard?.value.athletes).toEqual([one]);
  });

  it('publishes the bucket count beside the bucket', () => {
    // A browser on an older bundle computes a bucket under an older count. It
    // will usually resolve to no artifact at all and render "no results"; where
    // it does resolve, this pair is the only thing that turns a plausible wrong
    // answer into a detectable one.
    const [shard] = shardAthleteMirror([history('Ada Invented')], SCHEMA_VERSION);
    expect(shard?.value.bucketCount).toBe(ATHLETE_SHARD_COUNT);
  });

  it('names each shard after its bucket and emits them in bucket order', () => {
    const shards = shardAthleteMirror(
      Array.from({ length: 200 }, (_unused, index) => history(`Lifter Number ${String(index)}`)),
      SCHEMA_VERSION,
    );

    const buckets = shards.map((shard) => shard.bucket);
    expect([...buckets].sort((left, right) => left - right)).toEqual(buckets);
    for (const shard of shards) {
      expect(shard.id).toBe(`athletes-${String(shard.bucket).padStart(3, '0')}`);
    }
  });

  it('emits no empty bucket', () => {
    // With ninety thousand lifters none of them is empty. A smaller mirror -- a
    // test, a scoped rebuild -- would otherwise publish hundreds of files saying
    // nothing, and the schema refuses a shard with no lifters in it precisely so
    // that a fetched file always answers something.
    const shards = shardAthleteMirror([history('Ada Invented')], SCHEMA_VERSION);
    expect(shards).toHaveLength(1);
    for (const shard of shards) {
      expect(shard.value.athletes.length).toBeGreaterThan(0);
    }
  });

  it('sorts the lifters inside a bucket by key and then by name', () => {
    // Artifacts are content-addressed, so an archive that merely reordered its
    // rows would rewrite every filename and evict a cache that was still
    // correct. The names below are chosen to fold to one key, so the tie-break
    // is what is under test rather than the primary sort.
    const first = history('Zoe Invented');
    const second = { ...first, name: 'Zoe Invented ' };
    const third = { ...first, name: 'Zoe  Invented' };

    const [shard] = shardAthleteMirror([second, third, first], SCHEMA_VERSION);
    expect(shard?.value.athletes.map((athlete) => athlete.name)).toEqual([
      'Zoe  Invented',
      'Zoe Invented',
      'Zoe Invented ',
    ]);
  });

  it('is byte-stable under a reordering of its input', () => {
    // The same claim from the other side, and the one that actually costs money:
    // the input order is whatever the archive happened to list, which moves week
    // to week for reasons that are not changes to anybody's results.
    const athletes = Array.from({ length: 60 }, (_unused, index) =>
      history(`Lifter Number ${String(index)}`),
    );
    const forwards = shardAthleteMirror(athletes, SCHEMA_VERSION);
    const backwards = shardAthleteMirror([...athletes].reverse(), SCHEMA_VERSION);
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it('keeps two lifters who fold to one key as two histories', () => {
    // The reason a shard holds an array rather than a map. Merging them would
    // show one person the other's total on the screen that tells them whether
    // they may enter a meet.
    const one = history('Sam Invented');
    const two = { ...one, name: 'S. A. M. Invented' };
    expect(two.key).toBe(one.key);

    const [shard] = shardAthleteMirror([one, two], SCHEMA_VERSION);
    expect(shard?.value.athletes).toHaveLength(2);
    expect(findAthleteHistories(shard?.value ?? { athletes: [] }, one.key)).toHaveLength(2);
  });

  it('counts the lifters and the entries a bucket costs', () => {
    // The entry count is what the size budget is actually spent on, and it is
    // what `planPublication` reports against when a bucket does not fit.
    const [shard] = shardAthleteMirror(
      [
        history('Ada Invented', [entry(), entry({ date: '2026-04-11' })]),
        { ...history('Ada Invented'), name: 'Ada Invented #2' },
      ],
      SCHEMA_VERSION,
    );

    expect(shard?.athleteCount).toBe(2);
    expect(shard?.entryCount).toBe(3);
  });

  it('carries the schema the browser will parse the shard with', () => {
    const [shard] = shardAthleteMirror([history('Ada Invented')], SCHEMA_VERSION);
    expect(shard?.schema).toBe(AthleteShardSchema);
    expect(shard?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(v.safeParse(AthleteShardSchema, shard?.value).success).toBe(true);
  });

  it('refuses a key that is not the fold of itself', () => {
    // The silent failure this check exists for: the browser computes a key from
    // what a visitor typed, so a history published under a key the fold would
    // never produce is a lifter no input can reach. Nothing about the artifact
    // looks wrong, and the screen reads "no results for that name".
    expect(() =>
      shardAthleteMirror([{ key: 'Ada Invented', name: 'Ada Invented', entries: [entry()] }], 1),
    ).toThrow(UnreachableAthleteError);
  });

  it('names no lifter when it refuses one', () => {
    // Section 2.3. A key is a fold and is enough to find the pair in the source;
    // a name in a CI log is a person in a CI log, kept forever.
    let message = '';
    try {
      shardAthleteMirror(
        [{ key: 'AdaInvented', name: 'Ada Invented', entries: [entry()] }],
        SCHEMA_VERSION,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('AdaInvented');
    expect(message).not.toContain('Ada Invented');
  });

  it('refuses one lifter listed twice', () => {
    // Their entries would split across two records in the same shard, and every
    // screen showing "every result in this window" would show half of them --
    // with no error, and with the half it did show being perfectly correct.
    const one = history('Ada Invented');
    expect(() => shardAthleteMirror([one, one], SCHEMA_VERSION)).toThrow(DuplicateAthleteError);
  });

  it('reports a duplicate by key and not by name', () => {
    const one = history('Ada Invented');
    let thrown: unknown;
    try {
      shardAthleteMirror([one, one], SCHEMA_VERSION);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DuplicateAthleteError);
    expect((thrown as DuplicateAthleteError).key).toBe(one.key);
    expect((thrown as DuplicateAthleteError).message).not.toContain('Ada Invented');
  });

  it('does not mistake a shared key for a duplicate', () => {
    // The pair above differ in name and are two people; the pair here are the
    // same person. Keying the check on the fold alone would refuse every corpus
    // in which two lifters' names happen to collide, which is thousands of them.
    const one = history('Sam Invented');
    const two = { ...one, name: 'S A M Invented' };
    expect(two.key).toBe(one.key);
    expect(() => shardAthleteMirror([one, two], SCHEMA_VERSION)).not.toThrow();
  });

  it('does not run a key and a name together when deciding they are one lifter', () => {
    // The separator in the duplicate check, from the only side that can see it.
    // Concatenated plainly, `adainvent` + `ed` and `ada` + `invented` are one
    // string, so the second lifter is thrown out as a duplicate of the first --
    // and the shard that results is entirely valid, so nothing downstream has
    // anything to notice. The pair is contrived, because a boundary bug is only
    // ever visible on a contrived pair; the corpus has ninety thousand keys and
    // the collision it eventually finds will not be one anybody predicted.
    const first = { key: 'ada', name: 'invented', entries: [entry()] };
    const second = { key: 'adainvent', name: 'ed', entries: [entry()] };
    expect(first.key + first.name).toBe(second.key + second.name);

    const shards = shardAthleteMirror([first, second], SCHEMA_VERSION);
    expect(shards.reduce((total, shard) => total + shard.athleteCount, 0)).toBe(2);
  });

  it('publishes nothing for an empty mirror', () => {
    expect(shardAthleteMirror([], SCHEMA_VERSION)).toEqual([]);
  });
});
