// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { NonSerializableValueError, canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('produces the same bytes regardless of key order', () => {
    // The property the whole content-addressed scheme rests on: a scraper that
    // assembles the same facts in a different order must not republish the file.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts keys at every depth, including inside arrays', () => {
    expect(canonicalJson({ z: [{ y: 1, x: 2 }], a: 3 })).toBe(
      [
        '{',
        '  "a": 3,',
        '  "z": [',
        '    {',
        '      "x": 2,',
        '      "y": 1',
        '    }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('leaves array order alone', () => {
    // Order is data in an array: a weight class ladder is ascending, and sorting
    // it would be silent corruption rather than normalization.
    expect(canonicalJson([3, 1, 2])).toBe('[\n  3,\n  1,\n  2\n]\n');
  });

  it('ends with exactly one newline', () => {
    expect(canonicalJson({ a: 1 }).endsWith('}\n')).toBe(true);
    expect(canonicalJson({ a: 1 }).endsWith('}\n\n')).toBe(false);
  });

  it('keeps null, which is a published value', () => {
    expect(canonicalJson({ holderName: null })).toBe('{\n  "holderName": null\n}\n');
  });

  it('refuses undefined rather than dropping the key', () => {
    expect(() => canonicalJson({ kilograms: undefined })).toThrow(NonSerializableValueError);
  });

  it('refuses non-finite numbers rather than writing null', () => {
    // `JSON.stringify` turns these into `null`. A record total that became null
    // is a row that vanishes from a lifter's screen with nothing logged.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalJson({ kilograms: value })).toThrow(NonSerializableValueError);
    }
  });

  it('refuses values JSON cannot hold', () => {
    expect(() => canonicalJson({ n: 1n })).toThrow(NonSerializableValueError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(NonSerializableValueError);
    expect(() => canonicalJson({ s: Symbol('x') })).toThrow(NonSerializableValueError);
  });

  it('refuses a Date instead of silently stringifying it', () => {
    // A date that became a string is the difference between a published
    // `YYYY-MM-DD` and a timestamp in whatever zone the build machine used.
    expect(() => canonicalJson({ achievedOn: new Date(0) })).toThrow(NonSerializableValueError);
  });

  it('refuses a Map, which JSON.stringify would write as an empty object', () => {
    expect(() => canonicalJson({ byId: new Map([['a', 1]]) })).toThrow(NonSerializableValueError);
  });

  it('accepts a null-prototype object', () => {
    const hardened = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(canonicalJson(hardened)).toBe('{\n  "a": 1\n}\n');
  });

  it('names where the offending value is', () => {
    expect(() => canonicalJson({ records: [{ kilograms: Number.NaN }] })).toThrow(
      /records\[0\]\.kilograms/,
    );
  });

  it('reports a cycle instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/refers back to itself/);
  });

  it('allows the same object to appear in two branches', () => {
    // Sharing a scope object across records is normal assembly, not a cycle.
    const shared = { sex: 'female' };
    expect(canonicalJson({ a: shared, b: shared })).toBe(
      '{\n  "a": {\n    "sex": "female"\n  },\n  "b": {\n    "sex": "female"\n  }\n}\n',
    );
  });
});
