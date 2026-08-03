// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { LIFTS } from '@platform-toolkit/domain';
import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import { CUSTOM_BAR_ID, DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import {
  SESSION_PREFERENCES,
  addCustomLift,
  addLift,
  convertEntryWeights,
  describeChange,
  loadCompletion,
  loadEntries,
  markKey,
  moveEntry,
  parseCount,
  parseWeight,
  planFor,
  removeEntry,
  saveCompletion,
  saveEntries,
  sessionRows,
  setupFor,
  toggleMark,
  updateEntry,
  type LiftEntry,
} from './session.js';

function store() {
  return createPreferenceStore(memoryPreferenceStorage());
}

function keys(entries: readonly LiftEntry[]): string[] {
  return entries.map((entry) => entry.key);
}

/** A ready-to-plan squat row, which most of the tests below start from. */
function squat(overrides: Partial<LiftEntry> = {}): LiftEntry {
  const [entry] = addLift([], 'squat');
  if (entry === undefined) throw new Error('The catalogue has no squat.');
  return { ...entry, weight: '100', ...overrides };
}

describe('adding lifts', () => {
  it('seeds a catalogue lift with its own suggested prescription', () => {
    const [entry] = addLift([], 'deadlift');
    expect(entry).toMatchObject({ key: 'deadlift', name: 'Deadlift', sets: '1', reps: '5' });
  });

  it('leaves the weight empty, because nobody else knows what it is', () => {
    expect(addLift([], 'squat')[0]?.weight).toBe('');
  });

  it('refuses a second row for a lift already on the list', () => {
    // Keys are lift identifiers, which is what lets one remembered working
    // weight belong to one lift. Two Squat rows would also be two ramps for one
    // movement.
    const once = addLift([], 'squat');
    expect(addLift(once, 'squat')).toBe(once);
  });

  it('ignores an identifier the catalogue does not have', () => {
    const entries = addLift([], 'atlas-stone');
    expect(entries).toEqual([]);
  });

  it('gives a custom lift the family the lifter chose for it', () => {
    // Never guessed from the name. Guessing wrong between the pull ramp and the
    // press ramp changes what somebody does with a loaded bar.
    const [entry] = addCustomLift([], 'Zercher Squat', 'squat-press');
    expect(entry).toMatchObject({ liftId: null, name: 'Zercher Squat', family: 'squat-press' });
  });

  it('gives each custom lift a key no other row is using', () => {
    const two = addCustomLift(addCustomLift([], 'One', 'assistance'), 'Two', 'assistance');
    expect(keys(two)).toEqual(['custom-1', 'custom-2']);
  });

  it('does not reuse a key freed by a removal', () => {
    // Reuse would hand the new row the previous one's completion marks, which
    // is a set nobody performed showing as ticked.
    const two = addCustomLift(addCustomLift([], 'One', 'assistance'), 'Two', 'assistance');
    const readded = addCustomLift(removeEntry(two, 'custom-1'), 'Three', 'assistance');
    expect(keys(readded)).toEqual(['custom-2', 'custom-3']);
  });

  it('refuses a custom lift with nothing but spaces for a name', () => {
    expect(addCustomLift([], '   ', 'assistance')).toEqual([]);
  });
});

describe('reordering', () => {
  const three = addLift(addLift(addLift([], 'squat'), 'bench-press'), 'deadlift');

  it('moves a row one place earlier', () => {
    expect(keys(moveEntry(three, 'deadlift', -1))).toEqual(['squat', 'deadlift', 'bench-press']);
  });

  it('moves a row one place later', () => {
    expect(keys(moveEntry(three, 'squat', 1))).toEqual(['bench-press', 'squat', 'deadlift']);
  });

  it('does nothing at the top rather than wrapping to the bottom', () => {
    // On a phone, a wrap is a reordering the lifter may not have seen happen and
    // then has to undo.
    expect(moveEntry(three, 'squat', -1)).toBe(three);
  });

  it('does nothing at the bottom', () => {
    expect(moveEntry(three, 'deadlift', 1)).toBe(three);
  });

  it('does nothing for a row that is not there', () => {
    expect(moveEntry(three, 'jerk', -1)).toBe(three);
  });
});

describe('updateEntry', () => {
  it('changes one field on one row', () => {
    const two = addLift(addLift([], 'squat'), 'bench-press');
    const changed = updateEntry(two, 'squat', { weight: '102.5' });
    expect(changed[0]?.weight).toBe('102.5');
    expect(changed[1]?.weight).toBe('');
  });

  it('leaves the list alone for a row that is not there', () => {
    const one = addLift([], 'squat');
    expect(updateEntry(one, 'jerk', { weight: '60' })).toEqual(one);
  });
});

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

describe('planFor', () => {
  it('answers nothing while the row is still being filled in', () => {
    expect(planFor(squat({ weight: '' }), DEFAULT_EQUIPMENT)).toBe(null);
    expect(planFor(squat({ sets: '' }), DEFAULT_EQUIPMENT)).toBe(null);
  });

  it('answers nothing for a value that is present and wrong', () => {
    // The message under the field says what is wrong. A half-built ramp beside
    // it would be a second, contradictory answer.
    expect(planFor(squat({ weight: '1o5' }), DEFAULT_EQUIPMENT)).toBe(null);
  });

  it('builds a ramp once the row is complete', () => {
    const result = planFor(squat(), DEFAULT_EQUIPMENT);
    expect(result?.ok).toBe(true);
    expect(result?.ok === true && result.plan.warmups.length).toBeGreaterThan(0);
  });

  it('uses the ramp for the lift, not one ramp for everything', () => {
    // The deadlift ramp has no bar-only sets: two sets of five with an empty bar
    // is not a warm-up for a pull, it is a warm-up for something else.
    const pull = planFor(
      { ...squat(), key: 'deadlift', liftId: 'deadlift', family: 'deadlift', weight: '140' },
      DEFAULT_EQUIPMENT,
    );
    const stages = pull?.ok === true ? pull.plan.warmups.map((set) => set.stage) : [];
    expect(stages).not.toContain('empty-implement');
  });
});

describe('setupFor', () => {
  it('follows the equipment default when the row has chosen no bar', () => {
    expect(setupFor(squat(), DEFAULT_EQUIPMENT).bar).toEqual({ amount: 20, unit: 'kg' });
  });

  it('uses the bar chosen on the row when it has one', () => {
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, barId: 'olympic-20' };
    expect(setupFor(squat({ barId: 'squat-25' }), equipment).bar).toEqual({
      amount: 25,
      unit: 'kg',
    });
  });

  it('changes the ramp, because the bar is part of every total', () => {
    const light = planFor(squat({ barId: 'technique-10' }), DEFAULT_EQUIPMENT);
    const heavy = planFor(squat({ barId: 'squat-25' }), DEFAULT_EQUIPMENT);
    const first = (result: ReturnType<typeof planFor>): number | null =>
      result?.ok === true ? (result.plan.warmups[0]?.loading.total ?? null) : null;
    expect(first(light)).not.toBe(first(heavy));
  });
});

describe('convertEntryWeights', () => {
  it('re-expresses what was typed in the new unit', () => {
    const converted = convertEntryWeights([squat()], 'kg', 'lb');
    expect(converted[0]?.weight).toBe('220.46');
  });

  it('returns to the original figure on the way back, however many times', () => {
    // The stated acceptance test, and the reason conversion works from the field
    // rather than from a running total: a drift of a pound per toggle is
    // invisible for three toggles and wrong by the tenth.
    let entries: readonly LiftEntry[] = [squat({ weight: '102.5' })];
    for (let round = 0; round < 6; round += 1) {
      entries = convertEntryWeights(entries, 'kg', 'lb');
      entries = convertEntryWeights(entries, 'lb', 'kg');
    }
    expect(entries[0]?.weight).toBe('102.5');
  });

  it('leaves a field alone when there is nothing readable in it', () => {
    // Converting a half-typed number would replace what the lifter is looking at
    // while their thumb is still on the keypad.
    const converted = convertEntryWeights(
      [squat({ weight: '10' }), squat({ weight: '' })],
      'kg',
      'lb',
    );
    expect(converted[1]?.weight).toBe('');
  });

  it('does nothing at all when the unit has not changed', () => {
    const entries = [squat()];
    expect(convertEntryWeights(entries, 'kg', 'kg')).toBe(entries);
  });
});

describe('sessionRows', () => {
  function rowsFor(entry: LiftEntry, equipment: Equipment = DEFAULT_EQUIPMENT) {
    const result = planFor(entry, equipment);
    if (result?.ok !== true) throw new Error('The row should have produced a plan.');
    return sessionRows(result.plan);
  }

  it('gives a repeated set one tickable row per performance', () => {
    // The bar for five, twice, is two rows. They happen minutes apart, and
    // knowing which of them has been done is the whole point of the checklist.
    const rows = rowsFor(squat());
    const barOnly = rows.filter((row) => row.stage === 'empty-implement');
    expect(barOnly).toHaveLength(2);
    expect(barOnly.map((row) => row.index)).toEqual([0, 1]);
  });

  it('gives every working set its own row too', () => {
    const rows = rowsFor(squat({ sets: '3' }));
    expect(rows.filter((row) => row.kind === 'working')).toHaveLength(3);
  });

  it('numbers the rows from zero without a gap', () => {
    // The index is half of a completion mark. A gap would mean a tick that
    // matches no row, which reads as a tick that silently failed to register.
    const rows = rowsFor(squat());
    expect(rows.map((row) => row.index)).toEqual(rows.map((_, index) => index));
  });

  it('mentions the plate change once for a repeated set, not on every row', () => {
    const rows = rowsFor(squat());
    expect(rows[1]?.change).toBe(null);
  });

  it('carries no plates for a working weight that cannot be built', () => {
    // A weight between two loadings. The row still exists -- the requirements
    // are explicit that this warns rather than blocks -- but it cannot show a
    // diagram for a load nothing can make.
    const coarse: Equipment = {
      ...DEFAULT_EQUIPMENT,
      inventory: {
        ...DEFAULT_EQUIPMENT.inventory,
        kg: [{ weight: 25, pairs: null, fullDiameter: true }],
      },
    };
    const rows = rowsFor(squat({ weight: '103' }), coarse);
    const working = rows.filter((row) => row.kind === 'working');
    expect(working).not.toHaveLength(0);
    for (const row of working) {
      expect(row.loading).toBe(null);
      expect(row.total).toBe(103);
    }
  });
});

describe('describeChange', () => {
  it('says what to add when nothing comes off', () => {
    expect(describeChange({ removed: [], added: [20] }, 'kg')).toBe('Add 20 kg per side');
  });

  it('says what to take off and what to put on when both happen', () => {
    // "Remove 10, add 25" and "add 20" are different amounts of work at the
    // rack, and only the first needs warning about.
    expect(describeChange({ removed: [10], added: [15] }, 'kg')).toBe(
      'Take off 10 kg, add 15 kg per side',
    );
  });

  it('says nothing when nothing moves', () => {
    expect(describeChange({ removed: [], added: [] }, 'kg')).toBe('');
  });
});

describe('remembering the list of lifts', () => {
  it('answers an empty list before anything has been saved', () => {
    expect(loadEntries(store(), 'kg')).toEqual([]);
  });

  it('round-trips a list in order', () => {
    const remembered = store();
    const entries = updateEntry(addLift(addLift([], 'deadlift'), 'squat'), 'squat', {
      weight: '102.5',
      sets: '3',
      reps: '5',
    });
    saveEntries(remembered, entries, 'kg');

    const loaded = loadEntries(remembered, 'kg');
    expect(keys(loaded)).toEqual(['deadlift', 'squat']);
    expect(loaded[1]).toMatchObject({ weight: '102.5', sets: '3', reps: '5' });
  });

  it('converts a remembered weight into the unit now in force', () => {
    // A lifter who last visited in pounds and now has kilograms selected must
    // not see 225 read back as 225 kg -- a plausible figure a hundred kilograms
    // out, with nothing on screen to indicate it.
    const remembered = store();
    saveEntries(remembered, [squat({ weight: '225' })], 'lb');
    expect(loadEntries(remembered, 'kg')[0]?.weight).toBe('102.06');
  });

  it('keeps an empty weight empty rather than remembering a zero', () => {
    const remembered = store();
    saveEntries(remembered, [squat({ weight: '' })], 'kg');
    expect(loadEntries(remembered, 'kg')[0]?.weight).toBe('');
  });

  it('remembers the bar chosen for a lift', () => {
    const remembered = store();
    saveEntries(remembered, [squat({ barId: CUSTOM_BAR_ID })], 'kg');
    expect(loadEntries(remembered, 'kg')[0]?.barId).toBe(CUSTOM_BAR_ID);
  });

  it('remembers no bar as no bar, so the row follows the default when it changes', () => {
    const remembered = store();
    saveEntries(remembered, [squat()], 'kg');
    expect(loadEntries(remembered, 'kg')[0]?.barId).toBe('');
  });

  it('does not remember a lift the lifter named themselves', () => {
    // The name is free text and there is deliberately nowhere in the preferences
    // package to put it. The interface says so where the lift is created.
    const remembered = store();
    saveEntries(remembered, addCustomLift([squat()], 'Zercher Squat', 'squat-press'), 'kg');
    expect(loadEntries(remembered, 'kg').map((entry) => entry.name)).toEqual(['Squat']);
  });

  it('survives a row saved mid-edit rather than throwing', () => {
    // These values come out of fields somebody is typing into, so half of them
    // are invalid half the time. A write that throws would take the screen down
    // over a partly typed rep count.
    const remembered = store();
    expect(() => {
      saveEntries(remembered, [squat({ weight: '1o5', sets: '', reps: 'x' })], 'kg');
    }).not.toThrow();
    expect(loadEntries(remembered, 'kg')[0]).toMatchObject({ weight: '', sets: '3', reps: '5' });
  });

  it('stores no more rows than the declared limit, rather than throwing', () => {
    // The list preference has a maximum length and a write that exceeds it
    // throws by design. Nothing in the interface stops a lifter adding lifts, so
    // the clamp has to be here or the thirtieth tap takes the screen down.
    const remembered = store();
    const many = LIFTS.slice(0, 30).reduce<readonly LiftEntry[]>(
      (entries, lift) => addLift(entries, lift.id),
      [],
    );
    expect(many.length).toBeGreaterThan(24);
    expect(() => {
      saveEntries(remembered, many, 'kg');
    }).not.toThrow();
    expect(remembered.read(SESSION_PREFERENCES.entries)).toHaveLength(24);
  });

  it('recovers to an empty list from an unreadable value', () => {
    const storage = memoryPreferenceStorage();
    storage.write('ptk.warm-up.entries', '{"not":"a list"}');
    expect(loadEntries(createPreferenceStore(storage), 'kg')).toEqual([]);
  });
});

describe('the completion marks', () => {
  const entries = [squat()];

  it('ticks and unticks one row at a time', () => {
    const key = markKey('squat', 2);
    const ticked = toggleMark(new Set<string>(), key);
    expect(ticked.has(key)).toBe(true);
    expect(toggleMark(ticked, key).has(key)).toBe(false);
  });

  it('leaves the neighbouring row alone', () => {
    const ticked = toggleMark(new Set<string>(), markKey('squat', 0));
    expect(ticked.has(markKey('squat', 1))).toBe(false);
  });

  it('round-trips through storage', () => {
    const remembered = store();
    const ticked = toggleMark(new Set<string>(), markKey('squat', 1));
    saveCompletion(remembered, ticked, entries, DEFAULT_EQUIPMENT);
    expect([...loadCompletion(remembered, entries, DEFAULT_EQUIPMENT)]).toEqual([
      markKey('squat', 1),
    ]);
  });

  it('drops the marks when the working weight changes underneath them', () => {
    // Change the working weight and every set below it changes too, so a mark
    // carried across would claim a set nobody performed.
    const remembered = store();
    saveCompletion(
      remembered,
      toggleMark(new Set<string>(), markKey('squat', 1)),
      entries,
      DEFAULT_EQUIPMENT,
    );
    const heavier = [squat({ weight: '110' })];
    expect([...loadCompletion(remembered, heavier, DEFAULT_EQUIPMENT)]).toEqual([]);
  });

  it('keeps the marks across a reload of the same session', () => {
    // The case the whole thing exists for: a phone locks at the rack and the tab
    // reloads an hour later.
    const remembered = store();
    const ticked = toggleMark(
      toggleMark(new Set<string>(), markKey('squat', 0)),
      markKey('squat', 1),
    );
    saveCompletion(remembered, ticked, entries, DEFAULT_EQUIPMENT);
    expect(loadCompletion(remembered, [squat()], DEFAULT_EQUIPMENT).size).toBe(2);
  });

  it('does not remember the marks against a lift the lifter named', () => {
    const remembered = store();
    const withCustom = addCustomLift(entries, 'Zercher Squat', 'squat-press');
    const ticked = toggleMark(new Set<string>(), markKey('custom-1', 0));
    saveCompletion(remembered, ticked, withCustom, DEFAULT_EQUIPMENT);
    expect(loadCompletion(remembered, withCustom, DEFAULT_EQUIPMENT).size).toBe(0);
  });

  it('answers nothing when there is no storage at all', () => {
    expect(loadCompletion(createPreferenceStore(null), entries, DEFAULT_EQUIPMENT).size).toBe(0);
  });
});
