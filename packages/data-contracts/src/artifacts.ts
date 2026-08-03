// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

/**
 * The index of published data files, and the rules a published path must obey.
 *
 * Only one file in the published set has a fixed name: `meta.json`. Every other
 * artifact carries a hash of its own contents in its filename, and `meta.json`
 * is what maps a stable identifier onto the current hashed path. That split is
 * what makes the data cacheable: a hashed file can never change, so it can be
 * served immutable and forever, while the small unhashed index is the only
 * request that has to reach the network on every load. It also makes a deploy
 * atomic in the way that matters -- the new index appears complete or not at
 * all, and the artifacts it names were uploaded before it.
 *
 * The path rules below exist because this index is a trust boundary. The
 * application fetches whatever `meta.json` names, so a path is not a display
 * string: it is an instruction to make a request. Validating it here, in the
 * contract both the publisher and the browser share, means the browser refuses
 * a bad path even if something upstream produced one.
 */

/**
 * A path to a published artifact, relative to the data base URL.
 *
 * The character allowlist is doing the security work, not the individual
 * checks that follow it -- with no colon, no backslash and no uppercase, a
 * value here cannot express a scheme, a Windows path, or a host. The explicit
 * leading-slash and `..` checks are kept anyway because a reader should be able
 * to see the two escapes being refused without deriving them from a regex.
 */
export const ArtifactPathSchema = v.pipe(
  v.string(),
  v.regex(/^[a-z0-9][a-z0-9._/-]*$/, 'a lowercase relative path'),
  v.check((path) => !path.startsWith('/'), 'a path relative to the data base URL'),
  v.check((path) => !path.includes('..'), 'a path with no parent segment'),
  v.check((path) => !path.includes('//'), 'a path with no empty segment'),
  v.check((path) => path.endsWith('.json'), 'a path ending in .json'),
);

/** Where one artifact lives and what it should contain. */
export const ArtifactReferenceSchema = v.object({
  path: ArtifactPathSchema,

  /**
   * SHA-256 of the exact bytes served, lowercase hex.
   *
   * Present so that a consumer can verify what it received rather than trust
   * the filename. The hash is also what the filename is derived from, so the
   * two disagreeing means the file was rewritten after it was indexed.
   */
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/, 'a lowercase hex SHA-256 digest')),

  /** Size of the artifact in bytes, for budgeting and for progress reporting. */
  byteLength: v.pipe(v.number(), v.integer(), v.minValue(0)),

  /**
   * Schema version of this artifact's contents.
   *
   * Per artifact rather than site-wide: the records artifact can move to a new
   * shape without forcing every other artifact to be republished under a
   * version it did not change for.
   */
  schemaVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export type ArtifactReference = v.InferOutput<typeof ArtifactReferenceSchema>;

/**
 * Every published artifact, keyed by a stable identifier.
 *
 * A lookup returns `undefined` for an unknown key, which callers must handle --
 * an artifact can legitimately be absent from a build that had nothing to
 * publish for it, and that is a different situation from a failed fetch.
 */
export const ArtifactIndexSchema = v.record(
  v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]*$/, 'a lowercase kebab-case identifier')),
  ArtifactReferenceSchema,
);
export type ArtifactIndex = v.InferOutput<typeof ArtifactIndexSchema>;
