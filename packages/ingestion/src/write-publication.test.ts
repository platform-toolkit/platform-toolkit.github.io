// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SourceFreshness } from '@platform-toolkit/data-contracts';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DATA_META_PATH, planPublication, type PublicationPlan } from './publication.js';
import { writePublication } from './write-publication.js';

const SOURCES: readonly SourceFreshness[] = [
  {
    id: 'example-source',
    label: 'Example source',
    retrievedAt: '2026-07-31T00:00:00.000Z',
    status: 'ok',
  },
];

function samplePlan(): PublicationPlan {
  return planPublication({
    generatedAt: '2026-07-31T00:00:00.000Z',
    sources: SOURCES,
    artifacts: [
      {
        id: 'widgets',
        schema: v.object({ widgets: v.array(v.number()) }),
        schemaVersion: 1,
        value: { widgets: [1, 2, 3] },
      },
    ],
  });
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ptk-publish-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writePublication', () => {
  it('writes every file in the plan, creating directories as needed', async () => {
    const plan = samplePlan();
    const summary = await writePublication(plan, directory);

    expect(summary.fileCount).toBe(2);
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['artifacts', DATA_META_PATH]));
    for (const file of plan.files) {
      await expect(readFile(join(directory, file.path), 'utf8')).resolves.toBe(file.contents);
    }
  });

  it('reports the byte total, which is what a hosting limit is measured in', async () => {
    const plan = samplePlan();
    const summary = await writePublication(plan, directory);
    expect(summary.totalBytes).toBe(
      plan.files.reduce((total, file) => total + file.contents.length, 0),
    );
  });

  it('refuses to overwrite an existing file', async () => {
    // A plan holds each path once, so a collision means either two artifacts
    // resolved to one name or the output directory is stale. Overwriting would
    // leave a file the index does not describe.
    const plan = samplePlan();
    await writePublication(plan, directory);
    await expect(writePublication(plan, directory)).rejects.toThrow();
  });

  it('refuses a path that would escape the output directory', async () => {
    // The plan builder validates paths too. This check is here because this is
    // where a path becomes a write.
    const escaping: PublicationPlan = {
      ...samplePlan(),
      files: [{ path: '../escaped.json', contents: '{}\n' }],
    };
    await expect(writePublication(escaping, directory)).rejects.toThrow(TypeError);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('refuses an absolute path', async () => {
    const escaping: PublicationPlan = {
      ...samplePlan(),
      files: [{ path: '/etc/hosts.json', contents: '{}\n' }],
    };
    await expect(writePublication(escaping, directory)).rejects.toThrow(TypeError);
  });
});
