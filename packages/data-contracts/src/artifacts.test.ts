// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { ArtifactIndexSchema, ArtifactPathSchema } from './artifacts.js';

const accepts = (schema: v.GenericSchema, value: unknown): boolean =>
  v.safeParse(schema, value).success;

describe('ArtifactPathSchema', () => {
  it('accepts a hashed artifact path', () => {
    expect(accepts(ArtifactPathSchema, 'artifacts/uspa-records.0123456789abcdef.json')).toBe(true);
  });

  it('refuses anything that would leave the data base URL', () => {
    // This value is an instruction to make a request, not a label. The
    // application fetches whatever the index names, so each of these has to be
    // impossible to express rather than merely unlikely to occur.
    for (const path of [
      'https://example.invalid/a.json', // an absolute URL to another origin
      '//example.invalid/a.json', // protocol-relative: inherits the page scheme
      '/absolute.json', // escapes the base path
      'artifacts/../../secret.json', // traversal
      'artifacts//a.json', // empty segment, which some servers collapse
      'artifacts\\a.json', // backslash, treated as a separator by some clients
      'javascript:alert(1)', // not a path at all
    ]) {
      expect(accepts(ArtifactPathSchema, path), path).toBe(false);
    }
  });

  it('refuses a path that is not JSON', () => {
    expect(accepts(ArtifactPathSchema, 'artifacts/records.js')).toBe(false);
  });

  it('refuses an empty path', () => {
    expect(accepts(ArtifactPathSchema, '')).toBe(false);
  });
});

describe('ArtifactIndexSchema', () => {
  const reference = {
    path: 'artifacts/a.0123456789abcdef.json',
    sha256: 'a'.repeat(64),
    byteLength: 12,
    schemaVersion: 1,
  };

  it('accepts an empty index, which is what a build with nothing to publish has', () => {
    expect(accepts(ArtifactIndexSchema, {})).toBe(true);
  });

  it('accepts a kebab-case identifier', () => {
    expect(accepts(ArtifactIndexSchema, { 'uspa-records': reference })).toBe(true);
  });

  it('refuses an identifier that is not kebab-case', () => {
    for (const id of ['Records', 'records_2', '-leading', 'has space', '']) {
      expect(accepts(ArtifactIndexSchema, { [id]: reference }), id).toBe(false);
    }
  });

  it('refuses a digest that is not lowercase hex of the right length', () => {
    for (const sha256 of ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64)]) {
      expect(accepts(ArtifactIndexSchema, { a: { ...reference, sha256 } }), sha256).toBe(false);
    }
  });

  it('refuses a fractional or negative byte length', () => {
    expect(accepts(ArtifactIndexSchema, { a: { ...reference, byteLength: 1.5 } })).toBe(false);
    expect(accepts(ArtifactIndexSchema, { a: { ...reference, byteLength: -1 } })).toBe(false);
  });
});
