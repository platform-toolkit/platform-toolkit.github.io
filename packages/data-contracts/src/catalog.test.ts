// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { ArtifactIndexSchema } from './artifacts.js';
import { CategoryCatalogSchema, categoryCatalogArtifactId } from './catalog.js';

/**
 * Invented figures throughout. Real federation boundaries belong in published
 * data, where a stale one can be refreshed, not in a test where it would look
 * authoritative for years.
 */
const CATALOG = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single-ply' },
  ],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [
        { id: 'f-56', label: '56 kg', maximumKilograms: 56 },
        { id: 'f-plus', label: '56+ kg', maximumKilograms: null },
      ],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
    ],
  },
  levels: [
    { id: 'state', label: 'State', regions: [{ id: 'north', label: 'North' }] },
    // A level a federation does not subdivide carries an empty list rather than
    // a region standing for "everywhere", which would then need a name and be
    // selectable beside the real ones.
    { id: 'national', label: 'National', regions: [] },
  ],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
    { id: 'bench-only', label: 'Bench only', lifts: ['bench'] },
  ],
};

function parses(candidate: unknown): boolean {
  return v.safeParse(CategoryCatalogSchema, candidate).success;
}

describe('CategoryCatalogSchema', () => {
  it('accepts a complete catalogue', () => {
    expect(parses(CATALOG)).toBe(true);
  });

  it('keeps the age basis with the divisions that depend on it', () => {
    // A lifter born in December who turns 40 two weeks after a March meet is a
    // Master under one basis and an Open lifter under the other. Publishing the
    // divisions without saying which would put them in the wrong one for half
    // the year.
    const parsed = v.parse(CategoryCatalogSchema, CATALOG);
    expect(parsed.ageDivisions.basis).toBe('age-on-meet-date');
  });

  it.each([
    ['equipment', { ...CATALOG, equipment: [] }],
    ['weightClassLadders', { ...CATALOG, weightClassLadders: [] }],
    ['divisions', { ...CATALOG, ageDivisions: { ...CATALOG.ageDivisions, divisions: [] } }],
  ])('refuses an empty %s list', (_name, candidate) => {
    // An empty list renders as a question with no answers, which reads as a
    // broken page rather than as missing data. A federation with none of these
    // has no catalogue to publish.
    expect(parses(candidate)).toBe(false);
  });

  it('refuses a catalogue missing its divisions entirely', () => {
    const { ageDivisions: _omitted, ...withoutDivisions } = CATALOG;
    expect(parses(withoutDivisions)).toBe(false);
  });

  it('keeps the unbounded top class as null rather than a sentinel', () => {
    const parsed = v.parse(CategoryCatalogSchema, CATALOG);
    expect(parsed.weightClassLadders[0]?.classes[1]?.maximumKilograms).toBeNull();
  });

  it('does not carry records', () => {
    // The catalogue is fetched on first paint. Records are the hundreds of
    // thousands of rows the artifact budget exists to keep off a phone, and an
    // extra property here would be dropped silently rather than published.
    const parsed = v.parse(CategoryCatalogSchema, { ...CATALOG, records: [{ id: 'r-1' }] });
    expect(Object.hasOwn(parsed, 'records')).toBe(false);
  });
});

describe('categoryCatalogArtifactId', () => {
  it('names the artifact after the federation', () => {
    expect(categoryCatalogArtifactId('example')).toBe('categories-example');
  });

  it('produces something the artifact index will accept as a key', () => {
    // A name this function produced but the index rejected would fail the build
    // at publish time with no hint that the naming was at fault.
    const id = categoryCatalogArtifactId('Example Federation');
    expect(id).toBe('categories-example-federation');
    expect(
      v.safeParse(ArtifactIndexSchema, {
        [id ?? '']: {
          path: `artifacts/${id ?? ''}.0123456789abcdef.json`,
          sha256: 'a'.repeat(64),
          byteLength: 1,
          schemaVersion: 1,
        },
      }).success,
    ).toBe(true);
  });

  it.each(['', '   ', '///'])('returns null for an identifier of %p', (federationId) => {
    expect(categoryCatalogArtifactId(federationId)).toBeNull();
  });

  it('cannot collide with a record artifact', () => {
    // Both live in one flat index. A federation named "records" would be a
    // problem if the prefixes could ever produce the same string.
    expect(categoryCatalogArtifactId('records-uspa-state')).toBe('categories-records-uspa-state');
  });
});
