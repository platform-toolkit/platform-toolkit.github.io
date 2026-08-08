// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { entryAmount, entryWeight } from '@platform-toolkit/domain';
import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  CHART_STEPS,
  CONVERTER_PREFERENCES,
  EMPTY_ENTRY,
  RESULT_PRECISIONS,
  chartStepLabel,
  clearValue,
  entryProblem,
  leadingUnit,
  loadSettings,
  reverse,
  saveEntry,
  selectValue,
  setDirection,
  typeInto,
} from './session.js';

function store(): PreferenceStore {
  return createPreferenceStore(memoryPreferenceStorage());
}

describe('typeInto', () => {
  it('reads a bare number in the direction s input unit', () => {
    const entry = typeInto(EMPTY_ENTRY, '315');
    expect(entry.direction).toBe('lb-to-kg');
    expect(entry.entry?.origin).toEqual({ amount: 315, unit: 'lb' });
    expect(entry.text).toBe('315');
  });

  it('keeps the text exactly as typed, including what will not parse', () => {
    // A field that eats a character the visitor typed is a field they cannot
    // correct, because they cannot see what is wrong with it.
    const entry = typeInto(EMPTY_ENTRY, '31o5');
    expect(entry.text).toBe('31o5');
    expect(entry.entry).toBeNull();
  });

  it('follows a unit suffix rather than reinterpreting the number', () => {
    // Somebody converting kilograms to pounds who types "225 lb" has said which
    // unit their number is in. Reading it as 225 kg is a hundred kilograms out.
    const entry = typeInto({ ...EMPTY_ENTRY, direction: 'kg-to-lb' }, '225 lb');
    expect(entry.direction).toBe('lb-to-kg');
    expect(entry.entry?.origin).toEqual({ amount: 225, unit: 'lb' });
  });

  it('leaves the direction alone for a suffix that agrees with it', () => {
    const entry = typeInto({ ...EMPTY_ENTRY, direction: 'kg-to-lb' }, '102.5kg');
    expect(entry.direction).toBe('kg-to-lb');
    expect(entry.entry?.origin).toEqual({ amount: 102.5, unit: 'kg' });
  });

  it('accepts a pasted thousands separator', () => {
    expect(typeInto(EMPTY_ENTRY, '1,000').entry?.origin.amount).toBe(1000);
  });

  it('treats zero as a weight, not as an empty field', () => {
    // Stated explicitly in the requirements: zero converts to zero.
    const entry = typeInto(EMPTY_ENTRY, '0');
    expect(entry.entry?.origin.amount).toBe(0);
  });
});

describe('reverse', () => {
  it('converts the value instead of rereading the digits', () => {
    // The requirement in one line. 315 lb reversed is 142.88 kg, never 315 kg.
    const entry = reverse(typeInto(EMPTY_ENTRY, '315'));
    expect(entry.direction).toBe('kg-to-lb');
    expect(entry.text).toBe('142.88');
  });

  it('does not drift over repeated reversals', () => {
    // The reason the field is backed by an origin rather than by its own text.
    // Converting the *displayed* number each time compounds the rounding.
    let entry = typeInto(EMPTY_ENTRY, '315');
    for (let flick = 0; flick < 50; flick += 1) {
      entry = reverse(entry);
    }
    expect(entry.direction).toBe('lb-to-kg');
    expect(entry.text).toBe('315');
    expect(entry.entry?.origin).toEqual({ amount: 315, unit: 'lb' });
  });

  it('empties a field whose contents never parsed', () => {
    // Keeping the text would leave "31o5" sitting under a label that now says
    // kilograms, as though it had been converted.
    const entry = reverse(typeInto(EMPTY_ENTRY, '31o5'));
    expect(entry.text).toBe('');
    expect(entry.entry).toBeNull();
  });

  it('is what setting the opposite direction does', () => {
    const typed = typeInto(EMPTY_ENTRY, '315');
    expect(setDirection(typed, 'kg-to-lb')).toStrictEqual(reverse(typed));
  });

  it('changes nothing when the direction is already the one asked for', () => {
    const typed = typeInto(EMPTY_ENTRY, '315');
    expect(setDirection(typed, 'lb-to-kg')).toBe(typed);
  });
});

describe('selectValue', () => {
  it('puts a published figure in the field in the unit being typed in', () => {
    const entry = selectValue(typeInto(EMPTY_ENTRY, '500'), 499.1);
    expect(entry.text).toBe('499.1');
    expect(entryWeight(entry.entry ?? fail()).unit).toBe('lb');
  });
});

describe('clearValue', () => {
  it('empties the field and keeps the direction', () => {
    const entry = clearValue(typeInto({ ...EMPTY_ENTRY, direction: 'kg-to-lb' }, '102.5'));
    expect(entry.text).toBe('');
    expect(entry.entry).toBeNull();
    expect(entry.direction).toBe('kg-to-lb');
  });
});

describe('entryProblem', () => {
  it('says nothing about an empty field', () => {
    // Where every visit starts. An error here is the tool telling somebody off
    // for opening it.
    expect(entryProblem(EMPTY_ENTRY)).toBeNull();
    expect(entryProblem(typeInto(EMPTY_ENTRY, '   '))).toBeNull();
  });

  it.each([
    { text: '-5', fragment: 'above zero' },
    { text: 'abc', fragment: 'using digits' },
    { text: '100 stone', fragment: 'pounds or kilograms' },
    { text: '999999999', fragment: 'or less' },
  ])('explains $text', ({ text, fragment }) => {
    expect(entryProblem(typeInto(EMPTY_ENTRY, text))).toContain(fragment);
  });

  it('says nothing about a value it accepted', () => {
    expect(entryProblem(typeInto(EMPTY_ENTRY, '142.5 kg'))).toBeNull();
  });
});

describe('remembered settings', () => {
  it('answers with defaults on a device that has nothing stored', () => {
    const settings = loadSettings(store());
    expect(settings.entry).toStrictEqual(EMPTY_ENTRY);
    expect(settings.precision).toBe(2);
    expect(settings.step).toBe(0);
    expect(settings.order).toBe('kilograms-first');
  });

  it('answers with defaults on a device with no storage at all', () => {
    // The configuration these tools ship into: a third-party iframe whose
    // embedder blocked storage. No branch anywhere, and nothing throws.
    const settings = loadSettings(createPreferenceStore(null));
    expect(settings.entry).toStrictEqual(EMPTY_ENTRY);
  });

  it('brings back the value in the unit it was typed in', () => {
    const remembering = store();
    saveEntry(remembering, typeInto(EMPTY_ENTRY, '315'));

    const settings = loadSettings(remembering);
    expect(settings.entry.direction).toBe('lb-to-kg');
    expect(settings.entry.entry?.origin).toEqual({ amount: 315, unit: 'lb' });
  });

  it('brings back a reversed value as the unit it now stands in', () => {
    const remembering = store();
    saveEntry(remembering, reverse(typeInto(EMPTY_ENTRY, '315')));

    const settings = loadSettings(remembering);
    expect(settings.entry.direction).toBe('kg-to-lb');
    expect(entryAmount(settings.entry.entry ?? fail())).toBe(142.88);
  });

  it('keeps the origin across a reload, so the drift-free reversal survives it', () => {
    // The reason the stored shape carries both units. Restoring from the
    // displayed 142.88 kg would make the next reversal 314.99 lb rather than 315,
    // and the drift would restart on every visit.
    const remembering = store();
    saveEntry(remembering, reverse(typeInto(EMPTY_ENTRY, '315')));

    const restored = loadSettings(remembering).entry;
    expect(restored.entry?.origin).toEqual({ amount: 315, unit: 'lb' });
    expect(reverse(restored).text).toBe('315');
  });

  it('remembers a typed zero rather than reading it back as an empty field', () => {
    // Why the stored shape carries a `present` flag instead of encoding empty as
    // zero the way tool 2's weights do: here zero is a real answer.
    const remembering = store();
    saveEntry(remembering, typeInto(EMPTY_ENTRY, '0'));
    expect(loadSettings(remembering).entry.text).toBe('0');
    expect(loadSettings(remembering).entry.entry?.origin.amount).toBe(0);
  });

  it('stores nothing for a field that does not parse', () => {
    // This runs on every keystroke, so half the values are mid-edit. A write that
    // violated the definition would throw and take the screen down.
    const remembering = store();
    expect(() => {
      saveEntry(remembering, typeInto(EMPTY_ENTRY, '12.'));
    }).not.toThrow();
    expect(loadSettings(remembering).entry.entry).toBeNull();
  });

  it('takes the stored unit over the stored direction when the two disagree', () => {
    // Only reachable if one write landed and the other did not. Believing the
    // direction would reinterpret 315 lb as 315 kg.
    const remembering = store();
    remembering.write(CONVERTER_PREFERENCES.direction, 'kg-to-lb');
    remembering.write(CONVERTER_PREFERENCES.value, {
      amount: 315,
      unit: 'lb',
      shownIn: 'lb',
      present: true,
    });

    const settings = loadSettings(remembering);
    expect(settings.entry.direction).toBe('lb-to-kg');
    expect(settings.entry.entry?.origin).toEqual({ amount: 315, unit: 'lb' });
  });

  it('falls back for a stored precision or step this build does not offer', () => {
    // The bounds admit values the interface has no control for -- 3 places, a
    // 7 kg step -- so the picklist is re-checked on the way out. Otherwise a
    // stored 3 selects no radio and the screen looks like it has forgotten.
    const remembering = store();
    remembering.write(CONVERTER_PREFERENCES.precision, 3);
    remembering.write(CONVERTER_PREFERENCES.step, 7);

    const settings = loadSettings(remembering);
    expect(settings.precision).toBe(2);
    expect(settings.step).toBe(0);
  });
});

describe('chart controls', () => {
  it('offers every row as the default step', () => {
    expect(CHART_STEPS[0]).toBe(0);
    expect(chartStepLabel(0)).toBe('Every row');
    expect(chartStepLabel(25)).toBe('Every 25 kg');
  });

  it('offers only precisions the formatter accepts', () => {
    expect(RESULT_PRECISIONS).toStrictEqual([2, 4]);
  });

  it('names the unit each column order leads with', () => {
    expect(leadingUnit('kilograms-first')).toBe('kg');
    expect(leadingUnit('pounds-first')).toBe('lb');
  });
});

function fail(): never {
  throw new Error('Expected an entry.');
}
