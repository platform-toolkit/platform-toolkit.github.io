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
  weightClassId: 'wc-63',
  divisionId: 'open',
  tested: true,
  lift: 'total',
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
    expect(recordShardKey(SCOPE)).toEqual({ levelId: 'state', regionId: 'iowa' });
  });

  it('gives one key to every scope in the same level and region', () => {
    // Sex, equipment, weight class, division, tested status and lift all narrow
    // within a view rather than replacing it. Splitting on them would make a
    // screen showing four lifts fetch four files.
    const other: RecordScope = { ...SCOPE, sex: 'male', lift: 'squat', tested: false };
    expect(sameRecordShard(recordShardKey(SCOPE), recordShardKey(other))).toBe(true);
  });
});

describe('sameRecordShard', () => {
  it.each([
    [
      { levelId: 'state', regionId: 'iowa' },
      { levelId: 'state', regionId: 'ohio' },
    ],
    [
      { levelId: 'state', regionId: 'iowa' },
      { levelId: 'national', regionId: 'iowa' },
    ],
    [
      { levelId: 'national', regionId: null },
      { levelId: 'national', regionId: 'usa' },
    ],
  ] satisfies [RecordShardKey, RecordShardKey][])('separates %o from %o', (left, right) => {
    expect(sameRecordShard(left, right)).toBe(false);
  });

  it('does not treat an absent region as a wildcard', () => {
    // `null` means the level has no subdivision, not "any region". A national
    // record compared against a state's would flatter or cheat a lifter.
    expect(
      sameRecordShard({ levelId: 'x', regionId: null }, { levelId: 'x', regionId: null }),
    ).toBe(true);
  });
});

describe('recordArtifactId', () => {
  it('names a regional partition after its level and region', () => {
    expect(recordArtifactId('uspa', { levelId: 'state', regionId: 'iowa' })).toBe(
      'records-uspa-state-iowa',
    );
  });

  it('omits the region where the level has no subdivision', () => {
    expect(recordArtifactId('uspa', { levelId: 'national', regionId: null })).toBe(
      'records-uspa-national',
    );
  });

  it('produces something the artifact index will accept as a key', () => {
    // The index key pattern is a separate contract, and a name this function
    // produced but the index rejected would fail the build at publish time with
    // no hint that the shard naming was at fault.
    const id = recordArtifactId('uspa', { levelId: 'state', regionId: 'iowa' });
    expect(id).not.toBeNull();
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each([
    ['New York', 'records-uspa-state-new-york'],
    ['  spaced  ', 'records-uspa-state-spaced'],
    ['Côte', 'records-uspa-state-c-te'],
    ['a/../b', 'records-uspa-state-a-b'],
    ['UPPER', 'records-uspa-state-upper'],
  ])('reduces %p to a usable name', (regionId, expected) => {
    const id = recordArtifactId('uspa', { levelId: 'state', regionId });
    expect(id).toBe(expected);
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each(['', '   ', '///', '..'])('returns null for an identifier of %p', (regionId) => {
    // Nothing survives slugging, so there is no name to give. The build treats
    // this as the data bug it is; the browser treats it as "no such artifact",
    // which it already knows how to render.
    expect(recordArtifactId('uspa', { levelId: 'state', regionId })).toBeNull();
  });

  it('returns null when the book or the level is unusable', () => {
    expect(recordArtifactId('', { levelId: 'state', regionId: 'iowa' })).toBeNull();
    expect(recordArtifactId('uspa', { levelId: '--', regionId: 'iowa' })).toBeNull();
  });

  it('is stable across calls, because the name is also the cache key', () => {
    const key: RecordShardKey = { levelId: 'state', regionId: 'iowa' };
    expect(recordArtifactId('uspa', key)).toBe(recordArtifactId('uspa', key));
  });

  it('can collide, which is why the partitioner checks', () => {
    // Slugging is lossy. This function sees one key at a time and cannot know
    // what else was published, so the check belongs where the whole corpus is
    // visible. Asserting the collision here keeps that reasoning honest.
    expect(recordArtifactId('uspa', { levelId: 'state', regionId: 'New York' })).toBe(
      recordArtifactId('uspa', { levelId: 'state', regionId: 'new-york' }),
    );
    expect(recordArtifactId('uspa', { levelId: 'state-iowa', regionId: null })).toBe(
      recordArtifactId('uspa', { levelId: 'state', regionId: 'iowa' }),
    );
  });
});
