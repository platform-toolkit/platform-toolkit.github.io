// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { parseCount, parseWeight } from './field-reading.js';

/*
 * These came over from the warm-up tool with the functions, unchanged. The two
 * ceilings they assert against -- 2000 and 20 -- are the parser's own, not a
 * federation figure, so they are stated as literals here on purpose: an
 * assertion reading `MAX_WEIGHT` would pass against any value the constant
 * happened to hold and would stop being a test of the sentence a lifter reads.
 */

describe('parseWeight', () => {
  it('reads an ordinary weight', () => {
    expect(parseWeight('102.5', 'kg')).toEqual({ ok: true, value: 102.5 });
  });

  it('reads a weight with spaces around it', () => {
    expect(parseWeight('  60 ', 'kg')).toEqual({ ok: true, value: 60 });
  });

  it('treats an empty field as unfinished rather than wrong', () => {
    // A lifter who has typed nothing has not made a mistake, and a red message
    // under every field on first load is a screen that looks broken.
    expect(parseWeight('', 'kg')).toEqual({ ok: false, message: null });
  });

  it('refuses a number with a letter in it instead of reading the digits', () => {
    // `parseFloat('1o5')` is 1. A ramp for one kilogram is a plausible-looking
    // answer to a question nobody asked.
    const reading = parseWeight('1o5', 'kg');
    expect(reading.ok).toBe(false);
    expect(reading.ok ? null : reading.message).toMatch(/digits/);
  });

  it('refuses zero and below', () => {
    expect(parseWeight('0', 'kg').ok).toBe(false);
    expect(parseWeight('-20', 'kg').ok).toBe(false);
  });

  it('refuses a figure past the point where a decimal point clearly went missing', () => {
    const reading = parseWeight('102500', 'kg');
    expect(reading.ok).toBe(false);
    expect(reading.ok ? null : reading.message).toMatch(/2000 kg/);
  });

  it('names the unit in force, so the limit reads as a weight and not a number', () => {
    const reading = parseWeight('102500', 'lb');
    expect(reading.ok ? null : reading.message).toMatch(/2000 lb/);
  });
});

describe('parseCount', () => {
  it('reads a whole count', () => {
    expect(parseCount('3', 'sets')).toEqual({ ok: true, value: 3 });
  });

  it('refuses a fractional one, because there is no half a rep', () => {
    expect(parseCount('2.5', 'reps').ok).toBe(false);
  });

  it('says which field is wrong', () => {
    const reading = parseCount('x', 'reps');
    expect(reading.ok ? null : reading.message).toMatch(/reps/);
  });

  it('treats an empty field as unfinished', () => {
    expect(parseCount('', 'sets')).toEqual({ ok: false, message: null });
  });
});
