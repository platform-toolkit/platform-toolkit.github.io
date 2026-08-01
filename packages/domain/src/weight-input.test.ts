import { describe, expect, it } from 'vitest';

import { MAX_WEIGHT_INPUT, parseWeightInput } from './weight-input.js';

function amountOf(text: string): number | null {
  const parsed = parseWeightInput(text);
  return parsed.ok ? parsed.amount : null;
}

function codeOf(text: string): string | null {
  const parsed = parseWeightInput(text);
  return parsed.ok ? null : parsed.code;
}

describe('parseWeightInput', () => {
  it('reads a plain figure', () => {
    expect(parseWeightInput('405')).toStrictEqual({ ok: true, amount: 405, unit: null });
  });

  it('reads a decimal', () => {
    expect(amountOf('183.7')).toBe(183.7);
  });

  it('reads a leading-point decimal, which a numeric keypad makes easy to type', () => {
    expect(amountOf('.5')).toBe(0.5);
  });

  it('reads zero, which converts to zero rather than being a mistake', () => {
    expect(parseWeightInput('0')).toStrictEqual({ ok: true, amount: 0, unit: null });
  });

  it('ignores surrounding whitespace', () => {
    expect(amountOf('  102.5  ')).toBe(102.5);
  });

  it('reads a pasted figure with group separators', () => {
    expect(amountOf('1,000')).toBe(1000);
    expect(amountOf('12,345.6')).toBe(12345.6);
  });

  it('refuses a comma that is not a group separator, rather than guessing', () => {
    // `1,5` is one and a half to much of Europe and malformed to the rest, and the
    // string cannot say which. Guessing turns 1.5 into 15 with nothing on screen to
    // show it happened.
    expect(codeOf('1,5')).toBe('not-a-number');
    expect(codeOf('1,50')).toBe('not-a-number');
    expect(codeOf('1,0000')).toBe('not-a-number');
  });

  it('reports nothing typed as its own outcome, not as a mistake', () => {
    expect(codeOf('')).toBe('empty');
    expect(codeOf('   ')).toBe('empty');
  });

  it('reports a negative separately from gibberish', () => {
    // A typo and a person who has understood the field and asked for something it
    // does not do need different wording.
    expect(codeOf('-5')).toBe('negative');
    expect(codeOf('-')).toBe('negative');
  });

  it('refuses the letter-for-digit typo a phone keyboard produces', () => {
    expect(codeOf('1o5')).toBe('not-a-number');
  });

  it('refuses a half-typed decimal rather than reading it as a whole number', () => {
    // `12.` is mid-keystroke. Reading it as 12 makes the answer flicker between two
    // values while a thumb is still moving.
    expect(codeOf('12.')).toBe('not-a-number');
  });

  it('refuses more than one decimal point', () => {
    expect(codeOf('1.2.3')).toBe('not-a-number');
  });

  it('refuses exponent notation, which nobody types at a rack', () => {
    // `Number('1e400')` is `Infinity`, so this is the one rejection that keeps a
    // non-finite figure out of every calculation downstream.
    expect(codeOf('1e5')).toBe('not-a-number');
    expect(codeOf('1e400')).toBe('not-a-number');
  });

  it('never returns a non-finite amount', () => {
    for (const text of ['Infinity', '-Infinity', 'NaN', '1e999']) {
      const parsed = parseWeightInput(text);
      expect(parsed.ok).toBe(false);
    }
  });

  it('reads a unit written after the number', () => {
    expect(parseWeightInput('183.7 kg')).toStrictEqual({ ok: true, amount: 183.7, unit: 'kg' });
    expect(parseWeightInput('405lb')).toStrictEqual({ ok: true, amount: 405, unit: 'lb' });
  });

  it('accepts the spellings people actually write', () => {
    for (const text of ['100 kgs', '100 kilos', '100 KILOGRAMS', '100Kg']) {
      const parsed = parseWeightInput(text);
      expect(parsed.ok && parsed.unit).toBe('kg');
    }
    for (const text of ['100 lbs', '100 pounds', '100 LB']) {
      const parsed = parseWeightInput(text);
      expect(parsed.ok && parsed.unit).toBe('lb');
    }
  });

  it('refuses a unit it does not know instead of dropping it', () => {
    // Dropping it would read `100 stone` as 100 of whatever the field is in.
    expect(codeOf('100 stone')).toBe('unknown-unit');
  });

  it('reports a bare word as gibberish, not as an unrecognised unit', () => {
    // Telling somebody who typed no digits that their *unit* is wrong sends them
    // looking in the wrong place.
    expect(codeOf('abc')).toBe('not-a-number');
    expect(codeOf('kg')).toBe('not-a-number');
  });

  it('refuses a figure past the bound', () => {
    expect(codeOf(String(MAX_WEIGHT_INPUT + 1))).toBe('too-large');
  });

  it('accepts the bound itself', () => {
    expect(amountOf(String(MAX_WEIGHT_INPUT))).toBe(MAX_WEIGHT_INPUT);
  });

  it('bounds the value so a remembered setting can never come back infinite', () => {
    // The reason the bound exists at all: this value is persisted, and a corrupted
    // entry that parses would make every derived figure on the screen `Infinity`.
    const parsed = parseWeightInput('999999999');
    expect(parsed.ok).toBe(false);
  });
});
