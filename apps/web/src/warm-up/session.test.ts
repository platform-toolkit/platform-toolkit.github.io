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
  adjustableWarmups,
  convertEntryWeights,
  loadCompletion,
  loadEntries,
  markKey,
  moveEntry,
  planFor,
  removeEntry,
  saveCompletion,
  saveEntries,
  sessionRows,
  setupFor,
  toggleMark,
  updateEntry,
  withAdjustment,
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

/** The ramp a row produces, for the tests that read something off it. */
function planOf(entry: LiftEntry, equipment: Equipment = DEFAULT_EQUIPMENT) {
  const result = planFor(entry, equipment);
  if (result?.ok !== true) throw new Error('The row should have produced a plan.');
  return result.plan;
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

  const adjusted = [squat({ adjustments: [{ index: 2, total: 65 }] })];

  it('throws away the hand-set weights when the working weight changes', () => {
    // An adjustment names a position, and after a new working weight position
    // two is a different set. Carrying it over would put a weight chosen for
    // 100 lb into the middle of a ramp for 135 and present it as the lifter's.
    expect(updateEntry(adjusted, 'squat', { weight: '135' })[0]?.adjustments).toEqual([]);
  });

  it('throws them away when the bar changes, for the same reason', () => {
    expect(updateEntry(adjusted, 'squat', { barId: 'squat-25' })[0]?.adjustments).toEqual([]);
  });

  it('keeps them across a change to the set and rep counts', () => {
    // Those change how many times each rung is performed, never what the rungs
    // are, so the set the lifter moved is still the set they moved.
    const kept = updateEntry(adjusted, 'squat', { sets: '5', reps: '3' });
    expect(kept[0]?.adjustments).toEqual([{ index: 2, total: 65 }]);
  });

  it('lets a patch that names the adjustments set them outright', () => {
    // Both halves of the stepper go through this: the press that adds one, and
    // the button that puts every set back to the calculated weight.
    const set = updateEntry(adjusted, 'squat', { adjustments: [{ index: 3, total: 80 }] });
    expect(set[0]?.adjustments).toEqual([{ index: 3, total: 80 }]);
    expect(updateEntry(adjusted, 'squat', { adjustments: [] })[0]?.adjustments).toEqual([]);
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
    expect(setupFor(squat(), DEFAULT_EQUIPMENT).bar).toEqual({ amount: 45, unit: 'lb' });
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

  it('carries a hand-set warm-up over, in the new unit', () => {
    // Not discarded: the lifter chose that rung, and the unit they read it in
    // is not the rung. Safe to convert because an adjustment is resolved to the
    // nearest weight the rack can build before it is shown.
    const converted = convertEntryWeights(
      [squat({ adjustments: [{ index: 2, total: 60 }] })],
      'kg',
      'lb',
    );
    expect(converted[0]?.adjustments[0]?.total).toBeCloseTo(132.28, 2);
  });
});

describe('sessionRows', () => {
  function rowsFor(entry: LiftEntry, equipment: Equipment = DEFAULT_EQUIPMENT) {
    return sessionRows(planOf(entry, equipment));
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
      plateUnit: 'kg',
      barId: 'olympic-20',
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

describe('adjustableWarmups', () => {
  it('numbers the movable sets from one, past the bar-only ones', () => {
    // The squat ramp opens with the empty bar twice. Numbering from the plan
    // would offer "warm-up 3" as the first row a lifter can move, against a
    // checklist whose third row is the first weighted one.
    const plan = planOf(squat());
    expect(plan.warmups[0]?.stage).toBe('empty-implement');

    const movable = adjustableWarmups(plan, []);
    expect(movable).not.toHaveLength(0);
    expect(movable.map((row) => row.ordinal)).toEqual(movable.map((_, at) => at + 1));
  });

  it('keeps the position in the plan beside it, which is what an adjustment names', () => {
    const plan = planOf(squat());
    for (const row of adjustableWarmups(plan, [])) {
      expect(plan.warmups[row.index]?.loading.total).toBe(row.total);
      expect(plan.warmups[row.index]?.stage).not.toBe('empty-implement');
    }
  });

  it('arrives with both steps found, so drawing the control searches the rack once', () => {
    const rows = adjustableWarmups(planOf(squat()), []);
    for (const row of rows) {
      expect(row.down).not.toBe(null);
      expect(row.up).not.toBe(null);
    }
  });

  it('marks the set the lifter named, and only that one', () => {
    const plan = planOf(squat());
    const [first] = adjustableWarmups(plan, []);
    if (first === undefined) throw new Error('The ramp should have a movable set.');

    const marked = adjustableWarmups(plan, [{ index: first.index, total: first.total }]);
    expect(marked.filter((row) => row.adjusted).map((row) => row.ordinal)).toEqual([1]);
  });

  it('still marks a set given back the weight it already had', () => {
    // `adjusted` asks whether the lifter chose the weight, not whether it
    // differs from the calculated one. A mark that vanished when the two
    // coincided would make the reset button look like it had nothing to do.
    const plan = planOf(squat());
    const [first] = adjustableWarmups(plan, []);
    if (first === undefined) throw new Error('The ramp should have a movable set.');

    const same = adjustableWarmups(plan, [{ index: first.index, total: first.total }])[0];
    expect(same?.total).toBe(first.total);
    expect(same?.adjusted).toBe(true);
  });
});

describe('withAdjustment', () => {
  it('gives a set a weight', () => {
    expect(withAdjustment([], 2, 65)).toEqual([{ index: 2, total: 65 }]);
  });

  it('replaces the weight on a set rather than listing it twice', () => {
    // Every press of a stepper comes through here, so an appending version
    // would reach the storage cap after a dozen taps on one row.
    expect(withAdjustment([{ index: 2, total: 65 }], 2, 70)).toEqual([{ index: 2, total: 70 }]);
  });

  it('keeps the list in ramp order', () => {
    // Nothing reading it requires the order -- `adjustWarmups` builds a map --
    // but `saveEntries` stops at its limit, so an append-ordered list would
    // drop whichever sets were adjusted last rather than the ones highest up.
    const list = withAdjustment(withAdjustment([], 4, 90), 2, 65);
    expect(list.map((adjustment) => adjustment.index)).toEqual([2, 4]);
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

  it('remembers a warm-up the lifter set themselves', () => {
    const remembered = store();
    saveEntries(remembered, [squat({ adjustments: [{ index: 2, total: 65 }] })], 'lb');
    expect(loadEntries(remembered, 'lb')[0]?.adjustments).toEqual([{ index: 2, total: 65 }]);
  });

  it('converts a remembered warm-up into the unit now in force', () => {
    // Same trap as the working weight, one layer down: 65 read back as 65 kg is
    // a warm-up heavier than the work it is warming up for.
    const remembered = store();
    saveEntries(remembered, [squat({ adjustments: [{ index: 2, total: 65 }] })], 'lb');
    expect(loadEntries(remembered, 'kg')[0]?.adjustments[0]?.total).toBeCloseTo(29.48, 2);
  });

  it('drops an adjustment it cannot store rather than clamping it', () => {
    // Clamped, it would put a weight the lifter never chose on a set the
    // checklist then labels as theirs. Dropped, they see the calculated figure,
    // which is the honest answer.
    const remembered = store();
    saveEntries(remembered, [squat({ adjustments: [{ index: 4000, total: 65 }] })], 'lb');
    expect(loadEntries(remembered, 'lb')[0]?.adjustments).toEqual([]);
  });

  it('keeps the hand-set warm-ups with the lift they belong to', () => {
    const remembered = store();
    const two = [
      squat({ adjustments: [{ index: 2, total: 65 }] }),
      squat({ key: 'deadlift', liftId: 'deadlift', adjustments: [{ index: 1, total: 95 }] }),
    ];
    saveEntries(remembered, two, 'lb');

    const loaded = loadEntries(remembered, 'lb');
    expect(loaded[0]?.adjustments).toEqual([{ index: 2, total: 65 }]);
    expect(loaded[1]?.adjustments).toEqual([{ index: 1, total: 95 }]);
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
