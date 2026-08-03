// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';

import {
  DataMetaSchema,
  type ArtifactIndex,
  type ArtifactReference,
  type DataMeta,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import * as v from 'valibot';

import { canonicalJson } from './canonical-json.js';

/**
 * Turning gathered data into the exact set of files to upload.
 *
 * This module is pure: it takes values and returns file contents as strings.
 * Nothing here touches the disk or the network, which is what lets the whole
 * publishing decision -- what gets written, under what name, in what order --
 * be tested without a fixture directory. The thin part that writes the result
 * out is the caller's, and has no decisions left in it.
 *
 * Two rules are enforced rather than documented, because both fail silently:
 *
 * 1. Nothing is published that does not parse against the schema the browser
 *    will use to read it. The contract is single-sourced, so a producer and a
 *    consumer cannot drift; a build that would ship an unreadable artifact
 *    fails in CI instead.
 *
 * 2. `meta.json` is emitted last. It is the index, so a reader that sees the
 *    new one must be able to fetch everything it names. Upload order follows
 *    the array order for exactly that reason.
 */

/** Fixed name of the index. The one path in the published set that never changes. */
export const DATA_META_PATH = 'meta.json';

/** Directory the hashed artifacts are published under, relative to the data base URL. */
const ARTIFACT_DIRECTORY = 'artifacts';

/**
 * How much of the digest goes in the filename.
 *
 * Sixteen hex characters is 64 bits. For a published set numbering in the
 * hundreds, an accidental collision is far less likely than the build machine
 * failing mid-upload, and the full digest is recorded in the index for anyone
 * who wants to verify the bytes.
 */
const FILENAME_DIGEST_LENGTH = 16;

/**
 * How large one artifact may get, uncompressed.
 *
 * Not a platform limit. It is a judgement, recorded in ADR 2, that a phone on a
 * conference-centre network should not download more than this to answer one
 * question -- so raising it should be a decision someone makes, not a threshold
 * something drifts past. At the measured cost of a record row this is about
 * 4,800 rows, which is why published data is sharded.
 *
 * A hard ceiling sits above it regardless: `canonicalJson` returns a string,
 * and V8 caps a string at 512 MiB. Past that the build throws instead of
 * publishing something degraded, which is the right failure but a much less
 * informative one than this budget.
 */
export const ARTIFACT_BUDGET_BYTES = 2 * 1024 * 1024;

/** Thrown when data does not match the contract the browser will read it with. */
export class ArtifactValidationError extends Error {
  override readonly name = 'ArtifactValidationError';

  constructor(
    readonly artifactId: string,
    /** Where each problem is, and what was expected. Never what was received. */
    readonly problems: readonly string[],
  ) {
    super(`Artifact "${artifactId}" does not match its schema: ${problems.join('; ')}`);
  }
}

/**
 * Thrown when an artifact exceeds the size budget.
 *
 * Its own type rather than a generic error because this is the failure the
 * budget exists to catch, and a build log should name it as such. An artifact
 * that quietly grew to forty megabytes is not something anyone notices in a
 * diff.
 */
export class ArtifactTooLargeError extends Error {
  override readonly name = 'ArtifactTooLargeError';

  constructor(
    readonly artifactId: string,
    readonly byteLength: number,
    readonly budgetBytes: number,
  ) {
    super(
      `Artifact "${artifactId}" is ${byteLength} bytes, over the ${budgetBytes}-byte budget. ` +
        'Shard it, or raise the budget deliberately.',
    );
  }
}

/** One artifact to publish. */
export interface ArtifactSource<TValue> {
  /** Stable identifier, kebab-case, used as the index key and the filename stem. */
  readonly id: string;
  /** The contract the value must satisfy, and that the browser reads it with. */
  readonly schema: v.GenericSchema<unknown, TValue>;
  /** Version of that contract, carried into the index. */
  readonly schemaVersion: number;
  /** The data. Validated before anything is written. */
  readonly value: unknown;
}

/** A file to write, verbatim, as UTF-8. */
export interface PublishedFile {
  /** Path relative to the data base URL. */
  readonly path: string;
  readonly contents: string;
}

export interface PublicationPlan {
  /**
   * Every file to upload, in the order to upload them: artifacts first, then
   * `meta.json`.
   */
  readonly files: readonly PublishedFile[];
  /** The index, already validated and already serialized into the last file. */
  readonly meta: DataMeta;
}

export interface PublicationRequest {
  /**
   * Build timestamp, ISO 8601.
   *
   * Passed in rather than read from the clock so that a build is reproducible:
   * given the same inputs and the same timestamp, this function returns
   * byte-identical files. Using the source commit's timestamp makes a rebuild
   * of an old commit verifiable against what was published from it.
   */
  readonly generatedAt: string;
  readonly sources: readonly SourceFreshness[];
  readonly artifacts: readonly ArtifactSource<unknown>[];

  /**
   * Largest artifact to allow, in bytes. Defaults to {@link ARTIFACT_BUDGET_BYTES}.
   *
   * Overridable so that a deliberate exception is possible and visible at the
   * call site, rather than requiring the shared constant to be loosened for
   * everyone.
   */
  readonly maxArtifactBytes?: number;
}

/**
 * Validates every artifact, names each one after its own contents, and builds
 * the index that points at them.
 *
 * @throws {ArtifactValidationError} if an artifact or the resulting index does
 *   not match its schema.
 * @throws {ArtifactTooLargeError} if an artifact exceeds the size budget.
 * @throws {TypeError} if two artifacts share an identifier.
 */
export function planPublication(request: PublicationRequest): PublicationPlan {
  const budget = request.maxArtifactBytes ?? ARTIFACT_BUDGET_BYTES;
  const files: PublishedFile[] = [];
  const index: Record<string, ArtifactReference> = {};

  for (const artifact of request.artifacts) {
    if (artifact.id in index) {
      // The second one would overwrite the first in the index, and the first
      // would be uploaded as an orphan. Both are silent.
      throw new TypeError(`Two artifacts share the identifier "${artifact.id}".`);
    }
    const file = buildArtifact(artifact);
    if (file.reference.byteLength > budget) {
      throw new ArtifactTooLargeError(artifact.id, file.reference.byteLength, budget);
    }
    files.push(file.file);
    index[artifact.id] = file.reference;
  }

  const meta = buildMeta({
    schemaVersion: 1,
    generatedAt: request.generatedAt,
    sources: request.sources,
    artifacts: index,
  });

  // Last, deliberately. See the note at the top of this file.
  const metaContents = canonicalJson(meta);

  // The index is subject to the same budget as anything else, and is the one
  // file every visitor downloads. It grows with the shard count, so this is
  // where a corpus sharded into tens of thousands of pieces announces that the
  // index itself now needs sharding.
  const metaBytes = Buffer.byteLength(metaContents, 'utf8');
  if (metaBytes > budget) {
    throw new ArtifactTooLargeError(DATA_META_PATH, metaBytes, budget);
  }

  files.push({ path: DATA_META_PATH, contents: metaContents });

  return { files, meta };
}

function buildArtifact(artifact: ArtifactSource<unknown>): {
  readonly file: PublishedFile;
  readonly reference: ArtifactReference;
} {
  const parsed = v.safeParse(artifact.schema, artifact.value);
  if (!parsed.success) {
    throw new ArtifactValidationError(artifact.id, describeIssues(parsed.issues));
  }

  // Serialized from the parse output, not the input. Whatever the schema
  // normalized is what gets published, so the bytes and the contract cannot
  // disagree about what the data is.
  const contents = canonicalJson(parsed.output);
  const sha256 = createHash('sha256').update(contents, 'utf8').digest('hex');
  const path = `${ARTIFACT_DIRECTORY}/${artifact.id}.${sha256.slice(0, FILENAME_DIGEST_LENGTH)}.json`;

  return {
    file: { path, contents },
    reference: {
      path,
      sha256,
      byteLength: Buffer.byteLength(contents, 'utf8'),
      schemaVersion: artifact.schemaVersion,
    },
  };
}

function buildMeta(candidate: {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly sources: readonly SourceFreshness[];
  readonly artifacts: ArtifactIndex;
}): DataMeta {
  const parsed = v.safeParse(DataMetaSchema, candidate);
  if (!parsed.success) {
    // Reported under the index's own name so a malformed artifact path is not
    // mistaken for a problem in the artifact it points at.
    throw new ArtifactValidationError(DATA_META_PATH, describeIssues(parsed.issues));
  }
  return parsed.output;
}

/**
 * Turns schema issues into readable text carrying the path and the expectation
 * but never the value.
 *
 * Ingestion failures are read by maintainers, so this could afford to be
 * chattier than the browser-side equivalent. It is not, because these artifacts
 * will eventually include imported competition results, and a CI log is a place
 * an athlete's details would then sit indefinitely. Path and expectation are
 * enough to find the bug in the adapter that produced it.
 */
function describeIssues(issues: readonly v.BaseIssue<unknown>[]): readonly string[] {
  return issues.map((issue) => `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`);
}
