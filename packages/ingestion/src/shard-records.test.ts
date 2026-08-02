import {
  recordArtifactId,
  type FederationRecord,
  type RecordBook,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { ARTIFACT_BUDGET_BYTES, ArtifactTooLargeError, planPublication } from './publication.js';
import { DuplicateRecordError, ShardNamingError, shardRecordBook } from './shard-records.js';

const SCHEMA_VERSION = 1;

/** A published set always describes where its data came from; the index requires it. */
const SOURCES: readonly SourceFreshness[] = [
  {
    id: 'fixture-records',
    label: 'Fixture record source',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    status: 'ok',
  },
];

/**
 * Invented figures. Real federation numbers belong in published data, never in
 * a test, where a stale one would look authoritative for years.
 */
function record(id: string, overrides: Partial<FederationRecord['scope']> = {}): FederationRecord {
  return {
    id,
    scope: {
      levelId: 'state',
      regionId: 'iowa',
      sex: 'female',
      equipmentId: 'raw',
      disciplineId: 'full-power',
      weightClassId: 'wc-63',
      divisionId: 'open',
      tested: true,
      lift: 'total',
      ...overrides,
    },
    kilograms: 400,
    unclaimed: false,
    holderName: 'Fixture Lifter',
    achievedOn: '2024-03-02',
    meetName: 'Fixture Open',
  };
}

function book(records: readonly FederationRecord[]): RecordBook {
  return {
    id: 'uspa',
    label: 'Fixture Federation Records',
    minimumIncrementKilograms: 0.5,
    records: [...records],
  };
}

describe('shardRecordBook', () => {
  it('puts every scope one lifter looks at into a single artifact', () => {
    // The whole point of the partition: a screen showing squat, bench, deadlift
    // and total for one lifter, in the class they are in and the one they are
    // cutting to, and every division they are eligible for, must be one fetch.
    const shards = shardRecordBook(
      book([
        record('r-1', { lift: 'squat' }),
        record('r-2', { lift: 'bench' }),
        record('r-3'),
        record('r-4', { weightClassId: 'wc-69' }),
        record('r-5', { divisionId: 'master-1' }),
        record('r-6', { tested: false }),
      ]),
      SCHEMA_VERSION,
    );

    expect(shards).toHaveLength(1);
    expect(shards[0]?.id).toBe('records-uspa-state-iowa-female-raw');
    expect(shards[0]?.recordCount).toBe(6);
  });

  it('separates the sexes and equipment categories', () => {
    // The measured reason the key is four axes rather than two: on the real
    // corpus the national partition is 15,593 rows, 6.9 MB against a 2 MiB
    // budget, and level and region alone cannot divide it. See the note on
    // `RecordShardKey`.
    const shards = shardRecordBook(
      book([
        record('r-1'),
        record('r-2', { sex: 'male' }),
        record('r-3', { equipmentId: 'single-ply' }),
        record('r-4', { sex: 'male', equipmentId: 'single-ply' }),
      ]),
      SCHEMA_VERSION,
    );

    expect(shards.map((shard) => shard.id)).toEqual([
      'records-uspa-state-iowa-female-raw',
      'records-uspa-state-iowa-female-single-ply',
      'records-uspa-state-iowa-male-raw',
      'records-uspa-state-iowa-male-single-ply',
    ]);
    expect(shards.map((shard) => shard.recordCount)).toEqual([1, 1, 1, 1]);
  });

  it('separates levels and regions from each other', () => {
    const shards = shardRecordBook(
      book([
        record('r-1', { levelId: 'state', regionId: 'iowa' }),
        record('r-2', { levelId: 'state', regionId: 'ohio' }),
        record('r-3', { levelId: 'national', regionId: null }),
      ]),
      SCHEMA_VERSION,
    );

    expect(shards.map((shard) => shard.id)).toEqual([
      'records-uspa-national-female-raw',
      'records-uspa-state-iowa-female-raw',
      'records-uspa-state-ohio-female-raw',
    ]);
    expect(shards.map((shard) => shard.recordCount)).toEqual([1, 1, 1]);
  });

  it('carries the key so a caller can report what it published', () => {
    const [shard] = shardRecordBook(
      book([record('r-1', { levelId: 'national', regionId: null })]),
      SCHEMA_VERSION,
    );

    expect(shard?.key).toEqual({
      levelId: 'national',
      regionId: null,
      sex: 'female',
      equipmentId: 'raw',
    });
  });

  it('names each shard with the identifier the browser will compute', () => {
    // The reader does not read a manifest of shard names -- it derives one from
    // the level and region it wants. A producer that named files any other way
    // would publish artifacts nothing ever asks for, and every lookup would come
    // back empty, which reads on screen as "no records in this category".
    const shards = shardRecordBook(book([record('r-1')]), SCHEMA_VERSION);

    expect(shards[0]?.id).toBe(
      recordArtifactId('uspa', {
        levelId: 'state',
        regionId: 'iowa',
        sex: 'female',
        equipmentId: 'raw',
      }),
    );
  });

  it('gives the shard its own id, not the book id', () => {
    // A file fetched on its own should say what is in it. Copying the book id
    // into every shard would make three downloaded files all claim to be the
    // whole corpus.
    const shards = shardRecordBook(
      book([record('r-1'), record('r-2', { regionId: 'ohio' })]),
      SCHEMA_VERSION,
    );

    for (const shard of shards) {
      expect(shard.value.id).toBe(shard.id);
    }
  });

  it('keeps the rule for beating a record on every shard', () => {
    // It governs the records it ships with. A shard that lost it would leave the
    // reader guessing, and guessing wrong tells a lifter they broke a record by
    // matching it.
    const shards = shardRecordBook(book([record('r-1')]), SCHEMA_VERSION);

    expect(shards[0]?.value.minimumIncrementKilograms).toBe(0.5);
    expect(shards[0]?.value.label).toBe('Fixture Federation Records');
  });

  it('orders shards and their records deterministically, whatever order the source used', () => {
    // Artifacts are content-addressed, so the bytes decide the filename. A source
    // that reordered its rows without changing one of them would otherwise
    // rewrite every file and evict a cache that was still correct.
    const forwards = shardRecordBook(
      book([record('r-1'), record('r-2', { regionId: 'ohio' }), record('r-3')]),
      SCHEMA_VERSION,
    );
    const backwards = shardRecordBook(
      book([record('r-3'), record('r-2', { regionId: 'ohio' }), record('r-1')]),
      SCHEMA_VERSION,
    );

    expect(backwards).toEqual(forwards);
    expect(forwards[0]?.value.records.map((entry) => entry.id)).toEqual(['r-1', 'r-3']);
  });

  it('produces artifacts planPublication accepts unchanged', () => {
    // The sharder exists to feed publishing, not to be a second publishing
    // pipeline. If its output needed adapting, the budget check and the schema
    // check would both be somewhere else.
    const plan = planPublication({
      artifacts: shardRecordBook(
        book([record('r-1'), record('r-2', { regionId: 'ohio' })]),
        SCHEMA_VERSION,
      ),
      generatedAt: '2026-01-01T00:00:00.000Z',
      sources: SOURCES,
    });

    expect(Object.keys(plan.meta.artifacts)).toEqual([
      'records-uspa-state-iowa-female-raw',
      'records-uspa-state-ohio-female-raw',
    ]);
  });

  it('leaves an over-budget partition to fail at publish time, under its own name', () => {
    // The sharder cannot know a shard's size: that is the serialized bytes, and
    // only publishing has those. What it can do is make the failure legible --
    // the artifact id names the level and region that need splitting further.
    const oversized = book(
      Array.from({ length: 6000 }, (_unused, index) => record(`r-${String(index)}`)),
    );

    let thrown: unknown;
    try {
      planPublication({
        artifacts: shardRecordBook(oversized, SCHEMA_VERSION),
        generatedAt: '2026-01-01T00:00:00.000Z',
        sources: SOURCES,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ArtifactTooLargeError);
    const failure = thrown as ArtifactTooLargeError;
    expect(failure.artifactId).toBe('records-uspa-state-iowa-female-raw');
    expect(failure.byteLength).toBeGreaterThan(ARTIFACT_BUDGET_BYTES);
  });

  it('returns nothing for a corpus with no records', () => {
    // Not an error. A federation that publishes no records yet is a real state,
    // and it should produce no files rather than one empty one.
    expect(shardRecordBook(book([]), SCHEMA_VERSION)).toEqual([]);
  });

  it('rejects two records claiming the same identifier', () => {
    // Whichever the reader picked would be arbitrary and one of them is wrong.
    expect(() =>
      shardRecordBook(book([record('r-1'), record('r-1', { lift: 'squat' })]), 1),
    ).toThrow(DuplicateRecordError);
  });

  it('rejects a duplicate identifier even across partitions', () => {
    expect(() =>
      shardRecordBook(book([record('r-1'), record('r-1', { regionId: 'ohio' })]), 1),
    ).toThrow(DuplicateRecordError);
  });

  it('rejects two partitions that would slug to one filename', () => {
    // Reachable with ordinary source data: a source that spells one region "New
    // York" and another "new-york" reduces both to the same name. Filing the
    // second under the first would show a lifter another region's records with
    // nothing on screen to suggest it.
    expect(() =>
      shardRecordBook(
        book([record('r-1', { regionId: 'New York' }), record('r-2', { regionId: 'new-york' })]),
        SCHEMA_VERSION,
      ),
    ).toThrow(ShardNamingError);
  });

  it('names both colliding partitions, because either could be the wrong one', () => {
    expect(() =>
      shardRecordBook(
        book([
          record('r-1', { levelId: 'state-iowa', regionId: null }),
          record('r-2', { levelId: 'state', regionId: 'iowa' }),
        ]),
        SCHEMA_VERSION,
      ),
    ).toThrow(/"state-iowa".+"state"/s);
  });

  it('rejects an identifier that leaves nothing to name a file with', () => {
    expect(() =>
      shardRecordBook(book([record('r-1', { regionId: '///' })]), SCHEMA_VERSION),
    ).toThrow(ShardNamingError);
  });

  it('reports the whole partition on an unnameable one, not the record id', () => {
    // The fix is in the source's vocabulary, so that is what the message points
    // at. A record identifier would send whoever reads the log to the wrong row.
    // All four axes, even the ones that are fine: the message exists to locate
    // the rows that produced it, and a partial one makes that a search.
    expect(() =>
      shardRecordBook(book([record('r-1', { levelId: '--', regionId: 'iowa' })]), SCHEMA_VERSION),
    ).toThrow(/level "--" region "iowa" sex "female" equipment "raw"/);
  });

  it('never puts a record holder in a failure message', () => {
    // §2.3: an athlete's name stays out of anything that reaches a log, and a CI
    // transcript is forever. The partition is named by its identifiers, which are
    // published federation vocabulary and safe to print.
    let thrown: unknown;
    try {
      shardRecordBook(book([record('r-1', { regionId: '///' })]), SCHEMA_VERSION);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShardNamingError);
    expect((thrown as Error).message).not.toContain('Fixture Lifter');
  });
});
