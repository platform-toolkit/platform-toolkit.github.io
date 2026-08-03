// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  ClassificationBookSchema,
  type ClassificationBook,
  type ClassificationTable,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  ClassificationShardNamingError,
  DuplicateClassificationTableError,
  shardClassificationBook,
} from './shard-classifications.js';

/**
 * Every figure below is invented. Real standards live in `data/sources/`, and a
 * test asserting them would be a second place they are written down.
 */

const SCHEMA_VERSION = 1;

const EQUIPMENT = ['raw', 'single-ply'];

function table(id: string, scope: Partial<ClassificationTable['scope']> = {}): ClassificationTable {
  return {
    id,
    label: `Table ${id}`,
    scope: {
      sex: 'female',
      lift: 'total',
      equipmentId: 'raw',
      weightClassId: 'f-40',
      divisionId: 'open',
      tested: null,
      ...scope,
    },
    standards: [{ id: 'bronze', label: 'Bronze', rank: 0, requiredKilograms: 100 }],
  };
}

function book(tables: readonly ClassificationTable[]): ClassificationBook {
  return { id: 'example', label: 'Example Federation', tables: [...tables] };
}

describe('shardClassificationBook', () => {
  it('partitions on sex and equipment and names each partition', () => {
    const shards = shardClassificationBook(
      book([
        table('a'),
        table('b', { sex: 'male', weightClassId: 'm-60' }),
        table('c', { equipmentId: 'single-ply' }),
      ]),
      EQUIPMENT,
      SCHEMA_VERSION,
    );

    expect(shards.map((shard) => shard.id)).toEqual([
      'classifications-example-female-raw',
      'classifications-example-female-single-ply',
      'classifications-example-male-raw',
    ]);
    expect(shards.map((shard) => shard.tableCount)).toEqual([1, 1, 1]);
  });

  it('keeps one lifter to one file across lifts, classes and divisions', () => {
    const shards = shardClassificationBook(
      book([
        table('total'),
        table('squat', { lift: 'squat' }),
        table('bench', { lift: 'bench' }),
        table('deadlift', { lift: 'deadlift' }),
        table('next-class', { weightClassId: 'f-47.5' }),
        table('master', { divisionId: 'master-1' }),
      ]),
      EQUIPMENT,
      SCHEMA_VERSION,
    );

    // The whole point of the key. A screen shows one lifter across all four
    // lifts, the class they are in and the one they are cutting to, and every
    // division they are eligible for -- splitting on any of those would turn
    // one screen into six requests.
    expect(shards).toHaveLength(1);
    expect(shards[0]?.tableCount).toBe(6);
  });

  it('renames the partition after itself so a fetched file says what is in it', () => {
    const [shard] = shardClassificationBook(book([table('a')]), EQUIPMENT, SCHEMA_VERSION);

    expect(shard?.value.id).toBe('classifications-example-female-raw');
    expect(shard?.value.label).toBe('Example Federation');
    expect(shard?.schema).toBe(ClassificationBookSchema);
    expect(shard?.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('sorts shards and their tables, so a reordered source rewrites nothing', () => {
    const tables = [
      table('c', { equipmentId: 'single-ply' }),
      table('a'),
      table('b', { lift: 'squat' }),
    ];
    const forwards = shardClassificationBook(book(tables), EQUIPMENT, SCHEMA_VERSION);
    const backwards = shardClassificationBook(
      book([...tables].reverse()),
      EQUIPMENT,
      SCHEMA_VERSION,
    );

    // Artifacts are content-addressed. A source that merely reordered its rows
    // would otherwise rewrite every filename and evict a cache still correct.
    expect(backwards).toEqual(forwards);
    expect(forwards[0]?.value.tables.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('refuses two tables claiming one identifier', () => {
    expect(() =>
      shardClassificationBook(book([table('a'), table('a', { lift: 'squat' })]), EQUIPMENT, 1),
    ).toThrow(DuplicateClassificationTableError);
  });

  it('refuses two partitions that slug to one name', () => {
    // Reachable with ordinary source data: slugging is lossy, and filing the
    // second under the first would hold a lifter to another equipment
    // category's standards with nothing on screen to suggest it.
    expect(() =>
      shardClassificationBook(
        book([
          table('a', { equipmentId: 'single-ply' }),
          table('b', { equipmentId: 'Single Ply' }),
        ]),
        EQUIPMENT,
        SCHEMA_VERSION,
      ),
    ).toThrow(ClassificationShardNamingError);
  });

  it('refuses a partition that cannot be named at all', () => {
    expect(() =>
      shardClassificationBook(
        book([table('a', { equipmentId: '///' })]),
        EQUIPMENT,
        SCHEMA_VERSION,
      ),
    ).toThrow(ClassificationShardNamingError);
  });
});

describe('shardClassificationBook, with a table that does not distinguish on equipment', () => {
  it('writes it into every equipment category', () => {
    const shards = shardClassificationBook(
      book([table('general', { equipmentId: null })]),
      EQUIPMENT,
      SCHEMA_VERSION,
    );

    // The browser builds a shard key from a lifter's own concrete answers, so
    // it can never ask for a partition of tables that declined to answer.
    expect(shards.map((shard) => shard.id)).toEqual([
      'classifications-example-female-raw',
      'classifications-example-female-single-ply',
    ]);
    expect(shards.every((shard) => shard.tableCount === 1)).toBe(true);
  });

  it('leaves the scope alone, so it still ranks below a specific table', () => {
    const [shard] = shardClassificationBook(
      book([table('general', { equipmentId: null })]),
      EQUIPMENT,
      SCHEMA_VERSION,
    );

    // Rewriting `null` to the partition's category would make the general table
    // as specific as an override and the selection ambiguous instead.
    expect(shard?.value.tables[0]?.scope.equipmentId).toBeNull();
  });

  it('refuses to guess what "every category" means', () => {
    expect(() =>
      shardClassificationBook(book([table('general', { equipmentId: null })]), [], SCHEMA_VERSION),
    ).toThrow(ClassificationShardNamingError);
  });
});
