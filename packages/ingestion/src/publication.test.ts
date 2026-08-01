import { DataMetaSchema, type SourceFreshness } from '@platform-toolkit/data-contracts';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_BUDGET_BYTES,
  ArtifactTooLargeError,
  ArtifactValidationError,
  DATA_META_PATH,
  planPublication,
  type ArtifactSource,
} from './publication.js';

const SOURCES: readonly SourceFreshness[] = [
  {
    id: 'example-source',
    label: 'Example source',
    retrievedAt: '2026-07-31T00:00:00.000Z',
    status: 'ok',
  },
];

/** A deliberately trivial contract: this module's job is the pipeline, not the shape. */
const WidgetSchema = v.object({ widgets: v.array(v.pipe(v.number(), v.finite())) });

function widgets(value: unknown, id = 'widgets'): ArtifactSource<unknown> {
  return { id, schema: WidgetSchema, schemaVersion: 1, value };
}

function plan(artifacts: readonly ArtifactSource<unknown>[] = [widgets({ widgets: [1, 2] })]) {
  return planPublication({ generatedAt: '2026-07-31T00:00:00.000Z', sources: SOURCES, artifacts });
}

describe('planPublication', () => {
  it('emits one file per artifact plus the index', () => {
    const { files } = plan([widgets({ widgets: [1] }, 'a'), widgets({ widgets: [2] }, 'b')]);
    expect(files).toHaveLength(3);
  });

  it('emits the index last, after everything it names', () => {
    // Upload order follows array order. A reader that sees the new index must be
    // able to fetch every artifact in it.
    const { files } = plan([widgets({ widgets: [1] }, 'a'), widgets({ widgets: [2] }, 'b')]);
    expect(files.at(-1)?.path).toBe(DATA_META_PATH);
    expect(files.slice(0, -1).map((file) => file.path)).not.toContain(DATA_META_PATH);
  });

  it('names each artifact after a prefix of its own digest', () => {
    const { files, meta } = plan();
    const reference = meta.artifacts['widgets'];
    expect(reference).toBeDefined();
    expect(reference?.path).toBe(`artifacts/widgets.${reference?.sha256.slice(0, 16)}.json`);
    expect(files[0]?.path).toBe(reference?.path);
  });

  it('records a digest of the exact bytes it emits', async () => {
    const { files, meta } = plan();
    const contents = files[0]?.contents ?? '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contents));
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    expect(meta.artifacts['widgets']?.sha256).toBe(hex);
    expect(meta.artifacts['widgets']?.byteLength).toBe(contents.length);
  });

  it('produces byte-identical output for the same input', () => {
    // What makes an unchanged artifact keep its URL, and its cache entry.
    expect(plan().files).toEqual(plan().files);
  });

  it('gives an artifact a new path when its data changes', () => {
    const before = plan([widgets({ widgets: [1] })]).meta.artifacts['widgets']?.path;
    const after = plan([widgets({ widgets: [2] })]).meta.artifacts['widgets']?.path;
    expect(before).not.toBe(after);
  });

  it('keeps the path stable when only key order changes', () => {
    const schema = v.object({ a: v.number(), b: v.number() });
    const build = (value: unknown) =>
      planPublication({
        generatedAt: '2026-07-31T00:00:00.000Z',
        sources: SOURCES,
        artifacts: [{ id: 'pair', schema, schemaVersion: 1, value }],
      }).meta.artifacts['pair']?.path;
    expect(build({ a: 1, b: 2 })).toBe(build({ b: 2, a: 1 }));
  });

  it('publishes what the schema produced, not what was handed in', () => {
    // Extra keys are stripped by the object schema, so they must not reach the
    // published bytes -- otherwise the file and the contract disagree.
    const { files } = plan([widgets({ widgets: [1], scratch: 'internal' })]);
    expect(files[0]?.contents).not.toContain('scratch');
  });

  it('refuses to publish data the browser could not read', () => {
    expect(() => plan([widgets({ widgets: ['heavy'] })])).toThrow(ArtifactValidationError);
  });

  it('reports where a validation problem is without quoting the value', () => {
    // These artifacts will eventually carry imported competition results, and a
    // CI log is a place athlete details would then sit indefinitely.
    try {
      plan([widgets({ widgets: [Number.NaN] })]);
      expect.unreachable('expected a validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactValidationError);
      expect((error as ArtifactValidationError).problems.join()).toContain('widgets.0');
      expect((error as Error).message).not.toContain('NaN');
    }
  });

  it('refuses two artifacts under one identifier', () => {
    // The second would overwrite the first in the index and orphan its file.
    expect(() => plan([widgets({ widgets: [1] }), widgets({ widgets: [2] })])).toThrow(TypeError);
  });

  it('produces an index that parses as the contract the browser reads', () => {
    expect(v.safeParse(DataMetaSchema, plan().meta).success).toBe(true);
  });

  it('round-trips the index through its own serialized bytes', () => {
    const { files, meta } = plan();
    const written: unknown = JSON.parse(files.at(-1)?.contents ?? '');
    expect(v.parse(DataMetaSchema, written)).toEqual(meta);
  });

  it('accepts a build with nothing to publish', () => {
    // A refresh that produced no artifacts still has freshness to report, and
    // an empty index is the honest way to say so.
    const { files, meta } = plan([]);
    expect(files.map((file) => file.path)).toEqual([DATA_META_PATH]);
    expect(meta.artifacts).toEqual({});
  });

  it('requires at least one source', () => {
    expect(() =>
      planPublication({ generatedAt: '2026-07-31T00:00:00.000Z', sources: [], artifacts: [] }),
    ).toThrow(ArtifactValidationError);
  });

  it('refuses an artifact over the size budget', () => {
    // The failure ADR 2 exists to catch. An artifact that quietly grew to forty
    // megabytes is not something anyone notices in a diff.
    const big = { widgets: Array.from({ length: 200_000 }, (_, index) => index) };
    expect(() => plan([widgets(big)])).toThrow(ArtifactTooLargeError);
  });

  it('allows a deliberate exception at the call site', () => {
    expect(() =>
      planPublication({
        generatedAt: '2026-07-31T00:00:00.000Z',
        sources: SOURCES,
        artifacts: [widgets({ widgets: [1] })],
        maxArtifactBytes: 1,
      }),
    ).toThrow(ArtifactTooLargeError);
    expect(ARTIFACT_BUDGET_BYTES).toBeGreaterThan(1);
  });

  it('holds the index to the same budget', () => {
    // It grows with the shard count, and it is the one file every visitor
    // downloads.
    const many = Array.from({ length: 400 }, (_, index) =>
      widgets({ widgets: [index] }, `widgets-${index}`),
    );
    expect(() =>
      planPublication({
        generatedAt: '2026-07-31T00:00:00.000Z',
        sources: SOURCES,
        artifacts: many,
        maxArtifactBytes: 4096,
      }),
    ).toThrow(new RegExp(`"${DATA_META_PATH}"`));
  });

  it('rejects an identifier that would make an unsafe path', () => {
    // The index tells the browser what to request, so an identifier is not just
    // a label. A traversal or an absolute path has to fail here, in the build.
    for (const id of ['../escape', '/absolute', 'Upper', 'has space']) {
      expect(() => plan([widgets({ widgets: [1] }, id)]), id).toThrow(ArtifactValidationError);
    }
  });
});
