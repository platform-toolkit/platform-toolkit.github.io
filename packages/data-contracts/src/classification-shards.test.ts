// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import { ArtifactIndexSchema } from './artifacts.js';
import {
  classificationArtifactId,
  classificationShardKey,
  sameClassificationShard,
  type ClassificationShardKey,
} from './classification-shards.js';
import type { ClassificationScope } from './classification.js';

const SCOPE: ClassificationScope = {
  sex: 'female',
  lift: 'total',
  equipmentId: 'raw',
  weightClassId: 'f-60',
  divisionId: 'open',
  tested: null,
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

describe('classificationShardKey', () => {
  it('keeps only the axes a corpus is partitioned on', () => {
    expect(classificationShardKey(SCOPE)).toEqual({ sex: 'female', equipmentId: 'raw' });
  });

  it('gives one key to every table a single lifter reads', () => {
    // One screen shows a lifter their squat and their total, their current class
    // and the one they are cutting to, Open and their Masters division. All of
    // that is one file, which is the entire point of partitioning here and not
    // finer.
    const other: ClassificationScope = {
      ...SCOPE,
      lift: 'squat',
      weightClassId: 'f-67-5',
      divisionId: 'master-40-44',
    };
    const key = classificationShardKey(SCOPE);
    const otherKey = classificationShardKey(other);
    if (key === null || otherKey === null) {
      throw new Error('Both fixtures name an equipment category, so both have a key.');
    }
    expect(sameClassificationShard(key, otherKey)).toBe(true);
  });

  it('has no key for a table that does not name an equipment category', () => {
    // A reader knows which category they lift in, not which categories a table
    // declined to distinguish, so there is no file for them to ask for. The
    // publisher resolves this by writing such a table into every category.
    expect(classificationShardKey({ ...SCOPE, equipmentId: null })).toBeNull();
  });
});

describe('sameClassificationShard', () => {
  it.each([
    [
      { sex: 'female', equipmentId: 'raw' },
      { sex: 'male', equipmentId: 'raw' },
    ],
    [
      { sex: 'female', equipmentId: 'raw' },
      { sex: 'female', equipmentId: 'single-ply' },
    ],
  ] satisfies [ClassificationShardKey, ClassificationShardKey][])(
    'separates %o from %o',
    (left, right) => {
      expect(sameClassificationShard(left, right)).toBe(false);
    },
  );
});

describe('classificationArtifactId', () => {
  it('names a partition after its federation, sex, and equipment category', () => {
    expect(classificationArtifactId('uspa', { sex: 'female', equipmentId: 'raw' })).toBe(
      'classifications-uspa-female-raw',
    );
  });

  it('produces something the artifact index will accept as a key', () => {
    const id = classificationArtifactId('uspa', { sex: 'male', equipmentId: 'classic-raw' });
    expect(id).toBe('classifications-uspa-male-classic-raw');
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each([
    ['Single Ply', 'classifications-uspa-male-single-ply'],
    ['  spaced  ', 'classifications-uspa-male-spaced'],
    ['MULTI_PLY', 'classifications-uspa-male-multi-ply'],
  ])('reduces %p to a usable name', (equipmentId, expected) => {
    const id = classificationArtifactId('uspa', { sex: 'male', equipmentId });
    expect(id).toBe(expected);
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it.each(['', '   ', '///'])('returns null for an equipment category of %p', (equipmentId) => {
    expect(classificationArtifactId('uspa', { sex: 'male', equipmentId })).toBeNull();
  });

  it('returns null when the federation is unusable', () => {
    expect(classificationArtifactId('--', { sex: 'male', equipmentId: 'raw' })).toBeNull();
  });

  it('is stable across calls, because the name is also the cache key', () => {
    const key: ClassificationShardKey = { sex: 'female', equipmentId: 'raw' };
    expect(classificationArtifactId('uspa', key)).toBe(classificationArtifactId('uspa', key));
  });

  it('can collide, which is why the partitioner checks', () => {
    // Slugging is lossy and this function sees one key at a time, so the check
    // belongs where the whole corpus is visible. Asserting it here keeps that
    // reasoning honest.
    expect(classificationArtifactId('uspa', { sex: 'female', equipmentId: 'Classic Raw' })).toBe(
      classificationArtifactId('uspa', { sex: 'female', equipmentId: 'classic-raw' }),
    );
  });
});
