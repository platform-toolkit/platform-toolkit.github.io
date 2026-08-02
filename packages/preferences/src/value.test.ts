import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { PreferenceValue } from './value.js';

/** Runs a shape's schema the way the store does, without involving the store. */
function accepts(value: PreferenceValue<unknown>, candidate: unknown): boolean {
  return v.is(value.schema, candidate);
}

describe('choice', () => {
  const unit = PreferenceValue.choice(['kg', 'lb']);

  it('accepts a listed value', () => {
    expect(accepts(unit, 'kg')).toBe(true);
    expect(accepts(unit, 'lb')).toBe(true);
  });

  it('rejects anything else, including near misses', () => {
    // The whole reason a unit is a `choice` and not a string: a stored "KG"
    // would otherwise reach a lookup table and come back undefined somewhere far
    // from here.
    for (const candidate of ['KG', 'kgs', '', 'stone', 0, null, ['kg']]) {
      expect(accepts(unit, candidate), JSON.stringify(candidate)).toBe(false);
    }
  });
});

describe('flag', () => {
  it('accepts only real booleans', () => {
    const flag = PreferenceValue.flag();
    expect(accepts(flag, true)).toBe(true);
    expect(accepts(flag, false)).toBe(true);
    // `JSON.parse('"true"')` is a string, and a truthiness check downstream
    // would read it as yes. So would `1`.
    expect(accepts(flag, 'true')).toBe(false);
    expect(accepts(flag, 1)).toBe(false);
  });
});

describe('publishedId', () => {
  const id = PreferenceValue.publishedId();

  it('accepts the identifier shapes federations actually publish', () => {
    // Every one of these is lifted from a live catalogue rather than invented:
    // a plain word, a hyphenated one, a sex-prefixed weight class, and the
    // fractional classes that are the reason a dot is in the pattern at all.
    for (const candidate of [
      'raw',
      'single-ply',
      'f-75',
      'f-67.5',
      'master-50-54',
      'ipl-world',
      'alabama',
    ]) {
      expect(accepts(id, candidate), candidate).toBe(true);
    }
  });

  it('accepts the empty string, which is how an unanswered question is stored', () => {
    // Not a near miss to be tightened later. A `shape` refuses a missing key
    // outright, so the four optional answers on the Platform Targets context
    // need a value that means "not picked" -- and without one, clearing the age
    // division would reset the required answers beside it.
    expect(accepts(id, '')).toBe(true);
  });

  it('rejects the things a free-text builder would have let through', () => {
    // The charset is the weaker of the two guarantees this builder makes -- the
    // stronger one is that a caller must resolve the value against published
    // data and discard what the source does not offer -- but it is the one that
    // can be asserted here, and it does exclude an address, an account and a
    // name as anybody would write one.
    for (const candidate of [
      'https://example.test/lifter/1',
      'lifter@example.test',
      'Jason Smathers',
      'Raw',
      'f 75',
      'a/b',
      'a_b',
      'a--b',
      '-raw',
      'raw-',
      'raw..classic',
      'x'.repeat(65),
      42,
      null,
      ['raw'],
    ]) {
      expect(accepts(id, candidate), JSON.stringify(candidate)).toBe(false);
    }
  });
});

describe('quantity', () => {
  const barWeight = PreferenceValue.quantity({ min: 5, max: 40 });

  it('accepts a decimal inside the bounds', () => {
    expect(accepts(barWeight, 20)).toBe(true);
    expect(accepts(barWeight, 15.5)).toBe(true);
  });

  it('accepts the bounds themselves', () => {
    expect(accepts(barWeight, 5)).toBe(true);
    expect(accepts(barWeight, 40)).toBe(true);
  });

  it('rejects anything outside them', () => {
    expect(accepts(barWeight, 4.99)).toBe(false);
    expect(accepts(barWeight, 41)).toBe(false);
  });

  it('rejects the values that make every downstream total meaningless', () => {
    // A bar weight of Infinity does not fail anywhere: it produces a ramp of
    // Infinity with no error at all.
    expect(accepts(barWeight, Number.POSITIVE_INFINITY)).toBe(false);
    expect(accepts(barWeight, Number.NaN)).toBe(false);
  });

  it('refuses to be defined with unusable bounds', () => {
    expect(() => PreferenceValue.quantity({ min: 40, max: 5 })).toThrow(RangeError);
    expect(() => PreferenceValue.quantity({ min: 0, max: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });
});

describe('count', () => {
  const pairs = PreferenceValue.count({ min: 0, max: 10 });

  it('accepts whole numbers in range', () => {
    expect(accepts(pairs, 0)).toBe(true);
    expect(accepts(pairs, 10)).toBe(true);
  });

  it('rejects a fraction of a pair of plates', () => {
    expect(accepts(pairs, 1.5)).toBe(false);
  });
});

describe('listOf', () => {
  const denominations = PreferenceValue.listOf(PreferenceValue.quantity({ min: 0.25, max: 50 }), {
    maxLength: 4,
  });

  it('accepts a list within the limit, including an empty one', () => {
    expect(accepts(denominations, [])).toBe(true);
    expect(accepts(denominations, [25, 20, 2.5])).toBe(true);
  });

  it('rejects a longer one', () => {
    expect(accepts(denominations, [25, 20, 15, 10, 5])).toBe(false);
  });

  it('rejects a list holding one bad entry', () => {
    // Not "keeps the good ones". A partially restored inventory is a lifter
    // planning against plates they do not have.
    expect(accepts(denominations, [25, 500])).toBe(false);
  });

  it('refuses to be defined without a usable limit', () => {
    const item = PreferenceValue.flag();
    expect(() => PreferenceValue.listOf(item, { maxLength: 0 })).toThrow(RangeError);
    expect(() => PreferenceValue.listOf(item, { maxLength: 2.5 })).toThrow(RangeError);
  });
});

describe('shape', () => {
  const plate = PreferenceValue.shape({
    weight: PreferenceValue.quantity({ min: 0.25, max: 50 }),
    pairs: PreferenceValue.count({ min: 0, max: 20 }),
  });

  it('accepts a complete record', () => {
    expect(accepts(plate, { weight: 25, pairs: 2 })).toBe(true);
  });

  it('rejects a record missing a field', () => {
    // Half a plate denomination has no honest reading: a weight with no count is
    // not "as many as needed", it is a value nobody wrote.
    expect(accepts(plate, { weight: 25 })).toBe(false);
  });

  it('rejects a record whose field is the wrong shape', () => {
    expect(accepts(plate, { weight: 25, pairs: 1.5 })).toBe(false);
  });

  it('drops an unknown field instead of throwing the record away', () => {
    // A newer build added a field and the visitor went back. Keeping the fields
    // this build understands preserves the rack; refusing would silently reset
    // it.
    const parsed = v.safeParse(plate.schema, { weight: 25, pairs: 2, colour: 'red' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.output).toEqual({ weight: 25, pairs: 2 });
  });

  it('nests inside a list', () => {
    const inventory = PreferenceValue.listOf(plate, { maxLength: 3 });
    expect(
      accepts(inventory, [
        { weight: 25, pairs: 2 },
        { weight: 20, pairs: 1 },
      ]),
    ).toBe(true);
    expect(accepts(inventory, [{ weight: 25, pairs: 2 }, { weight: 20 }])).toBe(false);
  });
});
