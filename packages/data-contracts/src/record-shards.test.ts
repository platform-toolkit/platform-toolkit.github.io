// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  recordArtifactId,
  recordShardKey,
  sameRecordShard,
  type RecordShardKey,
} from './record-shards.js';
import { ArtifactIndexSchema } from './artifacts.js';
import type { RecordScope } from './records.js';
import * as v from 'valibot';

const SCOPE: RecordScope = {
  levelId: 'state',
  regionId: 'iowa',
  sex: 'female',
  equipmentId: 'raw',
  disciplineId: 'full-power',
  weightClassId: 'wc-63',
  divisionId: 'open',
  tested: true,
  lift: 'total',
};

/** The four axes, spelled once so a case can vary one of them and nothing else. */
const KEY: RecordShardKey = {
  levelId: 'state',
  regionId: 'iowa',
  sex: 'female',
  equipmentId: 'raw',
};

/** Asserts an identifier is one the artifact index will actually accept as a key. */
function isUsableIndexKey(id: string): boolean {
  return v.safeParse(ArtifactIndexSchema, {
    [id]: {
      path: `artifacts/${id}.0123456789abcdef.json`,
      sha256: 'a'.repeat(64),
      byteLength: 1,
      schemaVersion: 1,
    },
  }).success;
}

describe('recordShardKey', () => {
  it('keeps only the axes a corpus is partitioned on', () => {
    expect(recordShardKey(SCOPE)).toEqual(KEY);
  });

  it('gives one key to every scope a lifter sees at once', () => {
    // Discipline, weight class, division, tested status and lift all narrow
    // *within* a partition rather than replacing it: one screen shows four lifts,
    // the class the lifter is in and the one they are cutting to, every division
    // they are eligible for, and the bench-only book beside the full-power one.
    // Splitting on any of them makes that screen a dozen requests, which is the
    // opposite of what sharding is for.
    const other: RecordScope = {
      ...SCOPE,
      disciplineId: 'bench-only',
      weightClassId: 'wc-69',
      divisionId: 'master-1',
      tested: false,
      lift: 'squat',
    };
    expect(sameRecordShard(recordShardKey(SCOPE), recordShardKey(other))).toBe(true);
  });

  it('separates the axes the corpus is too large to hold together', () => {
    // The measured reason the key is four axes and not two: level and region
    // alone put 15,593 rows in the national partition, 6.9 MB against a 2 MiB
    // budget. See the note on `RecordShardKey`.
    expect(sameRecordShard(recordShardKey(SCOPE), recordShardKey({ ...SCOPE, sex: 'male' }))).toBe(
      false,
    );
    expect(
      sameRecordShard(
        recordShardKey(SCOPE),
        recordShardKey({ ...SCOPE, equipmentId: 'single-ply' }),
      ),
    ).toBe(false);
  });

  it('is total, because a record leaves no axis unanswered', () => {
    // Unlike `classificationShardKey`, which returns `null` for a table that
    // declines to name an equipment category. A record is a fact about a lift
    // that happened, so there is no "applies to everyone" case to expand.
    expect(recordShardKey({ ...SCOPE, levelId: 'national', regionId: null })).toEqual({
      levelId: 'national',
      regionId: null,
      sex: 'female',
      equipmentId: 'raw',
    });
  });
});

describe('sameRecordShard', () => {
  it.each([
    [KEY, { ...KEY, regionId: 'ohio' }],
    [KEY, { ...KEY, levelId: 'national' }],
    [KEY, { ...KEY, sex: 'male' }],
    [KEY, { ...KEY, equipmentId: 'single-ply' }],
    [
      { ...KEY, levelId: 'national', regionId: null },
      { ...KEY, levelId: 'national', regionId: 'usa' },
    ],
  ] satisfies [RecordShardKey, RecordShardKey][])('separates %o from %o', (left, right) => {
    expect(sameRecordShard(left, right)).toBe(false);
  });

  it('does not treat an absent region as a wildcard', () => {
    // `null` means the level has no subdivision, not "any region". A national
    // record compared against a state's would flatter or cheat a lifter.
    expect(sameRecordShard({ ...KEY, regionId: null }, { ...KEY, regionId: null })).toBe(true);
  });
});

describe('recordArtifactId', () => {
  it('names a regional partition after every axis it is partitioned on', () => {
    expect(recordArtifactId('uspa', KEY)).toBe('records-uspa-state-iowa-female-raw');
  });

  it('omits the region where the level has no subdivision', () => {
    // Absent, not blank. Interpolating an empty region would give
    // `records-uspa-national--female-raw`, a name that works and reads as a bug
    // in every listing it appears in.
    expect(recordArtifactId('uspa', { ...KEY, levelId: 'national', regionId: null })).toBe(
      'records-uspa-national-female-raw',
    );
  });

  it('gives the eight partitions of one region eight names', () => {
    // The whole point of widening the key. Before this, all eight collided on
    // one filename -- and the sharder would have refused every corpus rather
    // than publish seven partitions over one file, which is the right failure
    // but not a useful one.
    const names = new Set(
      (['female', 'male'] as const).flatMap((sex) =>
        ['raw', 'classic', 'single-ply', 'multi-ply'].map((equipmentId) =>
          recordArtifactId('uspa', { ...KEY, sex, equipmentId }),
        ),
      ),
    );
    expect(names.size).toBe(8);
    expect(names.has(null)).toBe(false);
  });

  it('produces something the artifact index will accept as a key', () => {
    // The index key pattern is a separate contract, and a name this function
    // produced but the index rejected would fail the build at publish time with
    // no hint that the shard naming was at fault.
    const id = recordArtifactId('uspa', KEY);
    expect(id).not.toBeNull();
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each([
    ['New York', 'records-uspa-state-new-york-female-raw'],
    ['  spaced  ', 'records-uspa-state-spaced-female-raw'],
    ['Côte', 'records-uspa-state-c-te-female-raw'],
    ['a/../b', 'records-uspa-state-a-b-female-raw'],
    ['UPPER', 'records-uspa-state-upper-female-raw'],
  ])('reduces %p to a usable name', (regionId, expected) => {
    const id = recordArtifactId('uspa', { ...KEY, regionId });
    expect(id).toBe(expected);
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each([
    ['Single Ply', 'records-uspa-state-iowa-female-single-ply'],
    ['MULTI-PLY', 'records-uspa-state-iowa-female-multi-ply'],
  ])('reduces an equipment identifier of %p too', (equipmentId, expected) => {
    const id = recordArtifactId('uspa', { ...KEY, equipmentId });
    expect(id).toBe(expected);
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each(['', '   ', '///', '..'])('returns null for a region of %p', (regionId) => {
    // Nothing survives slugging, so there is no name to give. The build treats
    // this as the data bug it is; the browser treats it as "no such artifact",
    // which it already knows how to render.
    expect(recordArtifactId('uspa', { ...KEY, regionId })).toBeNull();
  });

  it.each(['', '   ', '///', '..'])('returns null for an equipment id of %p', (equipmentId) => {
    expect(recordArtifactId('uspa', { ...KEY, equipmentId })).toBeNull();
  });

  it('returns null when the book or the level is unusable', () => {
    expect(recordArtifactId('', KEY)).toBeNull();
    expect(recordArtifactId('uspa', { ...KEY, levelId: '--' })).toBeNull();
  });

  it('is stable across calls, because the name is also the cache key', () => {
    expect(recordArtifactId('uspa', KEY)).toBe(recordArtifactId('uspa', KEY));
  });

  it('can collide, which is why the partitioner checks', () => {
    // Slugging is lossy. This function sees one key at a time and cannot know
    // what else was published, so the check belongs where the whole corpus is
    // visible. Asserting the collision here keeps that reasoning honest.
    expect(recordArtifactId('uspa', { ...KEY, regionId: 'New York' })).toBe(
      recordArtifactId('uspa', { ...KEY, regionId: 'new-york' }),
    );
    expect(recordArtifactId('uspa', { ...KEY, levelId: 'state-iowa', regionId: null })).toBe(
      recordArtifactId('uspa', KEY),
    );
    // Widening the key added an axis to collide across, not just to separate on:
    // a region and an equipment category can trade a segment between them.
    expect(
      recordArtifactId('uspa', {
        ...KEY,
        regionId: 'iowa-female',
        sex: 'male',
        equipmentId: 'raw',
      }),
    ).toBe(
      recordArtifactId('uspa', {
        ...KEY,
        regionId: 'iowa',
        sex: 'female',
        equipmentId: 'male-raw',
      }),
    );
  });
});
