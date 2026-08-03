// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  BAR_PRESETS,
  COLLAR_PRESETS,
  CUSTOM_BAR_ID,
  CUSTOM_COLLAR_ID,
  DEFAULT_EQUIPMENT,
  DENOMINATIONS,
  EQUIPMENT_PREFERENCES,
  MICRO_DENOMINATIONS,
  barLabel,
  barWeight,
  collarWeight,
  denomination,
  describeEquipment,
  loadEquipment,
  microPlateState,
  saveEquipment,
  setMicroPlates,
  toBarbellSetup,
  toggleDenomination,
  updateDenomination,
  type Equipment,
} from './equipment.js';

function store() {
  return createPreferenceStore(memoryPreferenceStorage());
}

describe('the bar presets', () => {
  it('names every preset by weight and type rather than by brand', () => {
    // The requirements ask for descriptive labels. A brand name would also be an
    // endorsement this project has no basis for making, and the same list is
    // read out by a screen reader with no weight beside it unless the label
    // carries the type.
    for (const preset of BAR_PRESETS) {
      expect(preset.name).not.toBe('');
      expect(preset.weight.amount).toBeGreaterThan(0);
    }
  });

  it('offers a bar in each unit, because a gym is not obliged to pick one', () => {
    const units = new Set(BAR_PRESETS.map((preset) => preset.weight.unit));
    expect([...units].sort()).toEqual(['kg', 'lb']);
  });

  it('gives every preset a distinct identifier', () => {
    // Identifiers are stored, and two presets sharing one means a lifter's
    // remembered squat bar silently becomes whichever the lookup finds first.
    const ids = BAR_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(CUSTOM_BAR_ID);
  });
});

describe('barWeight', () => {
  it('answers the preset for the equipment default', () => {
    expect(barWeight(DEFAULT_EQUIPMENT)).toEqual({ amount: 45, unit: 'lb' });
  });

  it('answers a per-lift bar without changing the default', () => {
    // A lifter may squat with a specialty bar and bench with a standard one, so
    // the bar belongs to the lift and the equipment holds only what a new lift
    // starts with.
    expect(barWeight(DEFAULT_EQUIPMENT, 'safety-squat-65')).toEqual({ amount: 65, unit: 'lb' });
    expect(DEFAULT_EQUIPMENT.barId).toBe('standard-45');
  });

  it('offers the light bar a lot of lifters are actually under, in pounds', () => {
    // The gap the requirements named: a twenty-two pound bar was reachable only
    // by typing a custom weight, and the custom field opened on a kilogram bar.
    expect(barWeight(DEFAULT_EQUIPMENT, 'training-22')).toEqual({ amount: 22, unit: 'lb' });
  });

  it('answers the custom bar for the custom identifier', () => {
    const equipment: Equipment = {
      ...DEFAULT_EQUIPMENT,
      barId: CUSTOM_BAR_ID,
      customBar: { amount: 17.5, unit: 'kg' },
    };
    expect(barWeight(equipment)).toEqual({ amount: 17.5, unit: 'kg' });
  });

  it('falls back rather than throwing on an identifier it does not know', () => {
    // Identifiers arrive from stored preferences written by an older build. A
    // throw here takes the whole screen down over a bar somebody renamed; losing
    // the bar is recoverable in one tap.
    expect(barWeight(DEFAULT_EQUIPMENT, 'a-bar-from-a-later-build')).toEqual(
      DEFAULT_EQUIPMENT.customBar,
    );
  });
});

describe('collarWeight', () => {
  it('contributes nothing by default', () => {
    // The default has to be zero. Counting five kilograms nobody put on the bar
    // is the error this screen exists to prevent, and most collars are clips
    // that weigh nothing worth counting.
    expect(collarWeight(DEFAULT_EQUIPMENT).amount).toBe(0);
  });

  it('counts competition collars as the pair, not as one of them', () => {
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, collarId: 'competition' };
    // 2.5 kg each, and a lifter reads the total off the bar rather than off one
    // end -- so a preset holding 2.5 here would be half the weight on the bar.
    expect(collarWeight(equipment)).toEqual({ amount: 5, unit: 'kg' });
  });

  it('answers the custom pair total for the custom identifier', () => {
    const equipment: Equipment = {
      ...DEFAULT_EQUIPMENT,
      collarId: CUSTOM_COLLAR_ID,
      customCollars: { amount: 1, unit: 'lb' },
    };
    expect(collarWeight(equipment)).toEqual({ amount: 1, unit: 'lb' });
  });

  it('offers no-weight first, so the safe answer is the preselected one', () => {
    expect(COLLAR_PRESETS[0]?.id).toBe('none');
  });
});

describe('toBarbellSetup', () => {
  it('hands the domain the plate unit, the bar, the collars, and the rack', () => {
    const setup = toBarbellSetup(DEFAULT_EQUIPMENT);
    expect(setup.plateUnit).toBe('lb');
    expect(setup.bar).toEqual({ amount: 45, unit: 'lb' });
    expect(setup.collars.amount).toBe(0);
    expect(setup.plates).toBe(DEFAULT_EQUIPMENT.inventory.lb);
  });

  it('takes the plates for the selected unit and not the other one', () => {
    // The two inventories are separate on purpose. Handing over the pound rack
    // while the unit says kilograms produces a ramp of totals that look
    // reasonable and cannot be loaded.
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, plateUnit: 'kg' };
    expect(toBarbellSetup(equipment).plates).toBe(DEFAULT_EQUIPMENT.inventory.kg);
  });

  it('keeps a bar in the other unit in its own unit', () => {
    // A kilogram bar in a pound gym is ordinary, and the requirements say the
    // bar's native weight must stay visible. Converting here would round it into
    // the plate unit and the setup summary would stop matching the sticker.
    const setup = toBarbellSetup(DEFAULT_EQUIPMENT, 'olympic-20');
    expect(setup.bar).toEqual({ amount: 20, unit: 'kg' });
    expect(setup.plateUnit).toBe('lb');
  });
});

describe('describeEquipment', () => {
  it('summarises the whole setup in one line', () => {
    expect(describeEquipment(DEFAULT_EQUIPMENT)).toBe('lb plates • 45 lb bar • no collar weight');
  });

  it('says what the collars weigh once they weigh something', () => {
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, collarId: 'competition' };
    expect(describeEquipment(equipment)).toBe('lb plates • 45 lb bar • 5 kg collars');
  });

  it('names a mixed setup in both units', () => {
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, barId: 'olympic-20' };
    expect(describeEquipment(equipment)).toBe('lb plates • 20 kg bar • no collar weight');
  });
});

describe('barLabel', () => {
  it('carries the weight, because two bars share a name in no unit', () => {
    expect(barLabel(DEFAULT_EQUIPMENT, 'womens-15')).toBe("Women's Olympic bar, 15 kg");
  });

  it('labels the custom bar with whatever it currently weighs', () => {
    const equipment: Equipment = { ...DEFAULT_EQUIPMENT, customBar: { amount: 12.5, unit: 'kg' } };
    expect(barLabel(equipment, CUSTOM_BAR_ID)).toBe('Custom bar, 12.5 kg');
  });
});

describe('the plate inventory', () => {
  it('stocks a broadly equipped gym and not every size ever made', () => {
    // The odd sizes between are a specialty rack. Building a ramp on plates the
    // lifter does not own is a plan that cannot be loaded, and the screen would
    // give no clue why.
    const weights = DEFAULT_EQUIPMENT.inventory.lb.map((plate) => plate.weight);
    expect(weights).not.toContain(35);
    expect(weights).not.toContain(20);
    expect(weights).not.toContain(15);
  });

  it('assumes the fractional set is in the bag', () => {
    // The ramp is rounded to a readable step before the plates are searched, so
    // these can only be called for by an odd bar or by the working weight -- and
    // the working weight is the number the lifter typed, where rounding it off
    // is the tool getting the one figure that matters wrong.
    for (const unit of ['kg', 'lb'] as const) {
      expect(microPlateState(DEFAULT_EQUIPMENT, unit), unit).toBe('all');
    }
  });

  it('marks the competition-diameter plates in each unit', () => {
    const full = (unit: 'kg' | 'lb'): number[] =>
      DEFAULT_EQUIPMENT.inventory[unit]
        .filter((plate) => plate.fullDiameter)
        .map((plate) => plate.weight);
    expect(full('kg')).toEqual([25, 20]);
    expect(full('lb')).toEqual([45, 25, 10]);
  });

  it('assumes plenty of every stocked denomination until told otherwise', () => {
    // `null` and a large number are different claims. "I did not count" must not
    // let the calculator promise a loading it has no basis for, which is exactly
    // what a default of ninety-nine pairs would do.
    for (const plate of DEFAULT_EQUIPMENT.inventory.kg) {
      expect(plate.pairs).toBe(null);
    }
  });

  it('offers every denomination the two units actually come in', () => {
    expect(DENOMINATIONS.kg).toContain(0.5);
    expect(DENOMINATIONS.lb).toContain(1.25);
  });

  it('offers the fractional set the requirements named, down to the quarter', () => {
    expect(MICRO_DENOMINATIONS.lb).toEqual([1, 0.75, 0.5, 0.25]);
    for (const unit of ['kg', 'lb'] as const) {
      for (const weight of MICRO_DENOMINATIONS[unit]) {
        expect(DENOMINATIONS[unit], unit).toContain(weight);
      }
    }
  });

  it('keeps every offered denomination inside what storage will hold', () => {
    // `PLATE_LIST` caps the stored list. A catalogue that outgrew the cap would
    // save nothing at all rather than save most of the rack.
    for (const unit of ['kg', 'lb'] as const) {
      expect(DENOMINATIONS[unit].length, unit).toBeLessThanOrEqual(16);
    }
  });
});

describe('the fractional set as one switch', () => {
  it('reports the set as partly on once one plate is missing', () => {
    // The state the switch has to be able to show. Anything else makes a lifter
    // who owns three of the four look like a lifter who owns all of them.
    const partial = toggleDenomination(DEFAULT_EQUIPMENT, 'lb', 0.75);
    expect(microPlateState(partial, 'lb')).toBe('some');
  });

  it('clears the whole set in one action', () => {
    const cleared = setMicroPlates(DEFAULT_EQUIPMENT, 'lb', false);
    expect(microPlateState(cleared, 'lb')).toBe('none');
    for (const weight of MICRO_DENOMINATIONS.lb) {
      expect(denomination(cleared, 'lb', weight), String(weight)).toBe(null);
    }
  });

  it('clears the rest of a set somebody has already broken up', () => {
    // Partly on counts as on for the switch, so a lifter who unticked one plate
    // can still clear the rest rather than having to finish the job by hand.
    const partial = toggleDenomination(DEFAULT_EQUIPMENT, 'lb', 0.75);
    expect(microPlateState(setMicroPlates(partial, 'lb', false), 'lb')).toBe('none');
  });

  it('restores the whole set in one action', () => {
    const cleared = setMicroPlates(DEFAULT_EQUIPMENT, 'lb', false);
    expect(microPlateState(setMicroPlates(cleared, 'lb', true), 'lb')).toBe('all');
  });

  it('leaves the ordinary plates and the other unit alone', () => {
    const cleared = setMicroPlates(DEFAULT_EQUIPMENT, 'lb', false);
    expect(denomination(cleared, 'lb', 45)).not.toBe(null);
    expect(denomination(cleared, 'lb', 2.5)).not.toBe(null);
    expect(cleared.inventory.kg).toBe(DEFAULT_EQUIPMENT.inventory.kg);
  });

  it('keeps the list heaviest first after the set comes back', () => {
    const restored = setMicroPlates(setMicroPlates(DEFAULT_EQUIPMENT, 'lb', false), 'lb', true);
    const weights = restored.inventory.lb.map((plate) => plate.weight);
    expect(weights).toEqual([...weights].sort((left, right) => right - left));
  });
});

describe('toggleDenomination', () => {
  it('adds a denomination in weight order rather than at the end', () => {
    const next = toggleDenomination(DEFAULT_EQUIPMENT, 'lb', 1.25);
    expect(next.inventory.lb.map((plate) => plate.weight)).toEqual([
      45, 25, 10, 5, 2.5, 1.25, 1, 0.75, 0.5, 0.25,
    ]);
  });

  it('keeps the list descending when the addition is not the smallest', () => {
    const before = DEFAULT_EQUIPMENT.inventory.kg.map((plate) => plate.weight);
    const without = toggleDenomination(DEFAULT_EQUIPMENT, 'kg', 15);
    const restored = toggleDenomination(without, 'kg', 15);
    expect(restored.inventory.kg.map((plate) => plate.weight)).toEqual(before);
  });

  it('removes a denomination that is already selected', () => {
    const next = toggleDenomination(DEFAULT_EQUIPMENT, 'kg', 2.5);
    expect(denomination(next, 'kg', 2.5)).toBe(null);
  });

  it('leaves the inventory for the other unit alone', () => {
    // A lifter who looks at the pound view and switches back has to find their
    // kilogram plates as they left them, so the two lists never touch.
    const next = toggleDenomination(DEFAULT_EQUIPMENT, 'lb', 35);
    expect(next.inventory.kg).toBe(DEFAULT_EQUIPMENT.inventory.kg);
  });

  it('gives a re-added plate the default diameter for its size', () => {
    const readded = toggleDenomination(toggleDenomination(DEFAULT_EQUIPMENT, 'kg', 20), 'kg', 20);
    expect(denomination(readded, 'kg', 20)?.fullDiameter).toBe(true);
  });
});

describe('updateDenomination', () => {
  it('records a counted number of pairs', () => {
    const next = updateDenomination(DEFAULT_EQUIPMENT, 'kg', 20, { pairs: 2 });
    expect(denomination(next, 'kg', 20)?.pairs).toBe(2);
    expect(denomination(next, 'kg', 25)?.pairs).toBe(null);
  });

  it('records that a plate is not competition diameter after all', () => {
    const next = updateDenomination(DEFAULT_EQUIPMENT, 'kg', 20, { fullDiameter: false });
    expect(denomination(next, 'kg', 20)?.fullDiameter).toBe(false);
  });

  it('does nothing for a denomination that is not on the rack', () => {
    // Silently inserting would hide the fact that the interface and the
    // inventory have gone out of step -- a plate would appear in every ramp with
    // no control anywhere to take it back off.
    const next = updateDenomination(DEFAULT_EQUIPMENT, 'lb', 35, { pairs: 1 });
    expect(denomination(next, 'lb', 35)).toBe(null);
  });
});

describe('remembering the equipment', () => {
  it('answers the defaults when nothing has been stored', () => {
    expect(loadEquipment(store())).toEqual(DEFAULT_EQUIPMENT);
  });

  it('answers the defaults when there is no storage at all', () => {
    // The framed case, which is the normal one for these tools. It must be a
    // configured screen with nothing remembered, not an error path.
    expect(loadEquipment(createPreferenceStore(null))).toEqual(DEFAULT_EQUIPMENT);
  });

  it('round-trips a whole setup', () => {
    const equipment: Equipment = {
      plateUnit: 'lb',
      barId: CUSTOM_BAR_ID,
      customBar: { amount: 33, unit: 'lb' },
      collarId: 'competition',
      customCollars: { amount: 4, unit: 'lb' },
      inventory: {
        kg: [{ weight: 25, pairs: 1, fullDiameter: true }],
        lb: [
          { weight: 45, pairs: null, fullDiameter: true },
          { weight: 10, pairs: 3, fullDiameter: false },
        ],
      },
    };

    const remembered = store();
    saveEquipment(remembered, equipment);

    expect(loadEquipment(remembered)).toEqual(equipment);
  });

  it('round-trips "as many as needed" as itself and not as a count', () => {
    // `pairs: null` crosses the boundary as zero because no builder is nullable.
    // Reading it back as `0` would tell the plate search there are none of that
    // plate, and every ramp would quietly route around a full rack.
    const remembered = store();
    saveEquipment(remembered, DEFAULT_EQUIPMENT);
    for (const plate of loadEquipment(remembered).inventory.kg) {
      expect(plate.pairs).toBe(null);
    }
  });

  it('drops a stored denomination this build no longer offers', () => {
    // It would render as a plate with no control beside it, unremovable, and
    // every ramp would keep using it.
    const remembered = store();
    remembered.write(EQUIPMENT_PREFERENCES.platesKg, [
      { weight: 20, pairs: 0, full: true },
      { weight: 3, pairs: 0, full: false },
    ]);
    expect(loadEquipment(remembered).inventory.kg.map((plate) => plate.weight)).toEqual([20]);
  });

  it('recovers to the defaults from an unreadable value', () => {
    // Requirement 9: unreadable settings recover rather than break the screen.
    const storage = memoryPreferenceStorage();
    storage.write('ptk.warm-up.plate-unit', '"furlongs"');
    storage.write('ptk.warm-up.custom-bar', 'not json at all');
    expect(loadEquipment(createPreferenceStore(storage))).toEqual(DEFAULT_EQUIPMENT);
  });

  it('refuses a bar weight nothing could be standing under', () => {
    // The bounds are load-bearing, not defensive: a bar of 1e308 produces a ramp
    // of `Infinity` with no error anywhere downstream.
    const remembered = store();
    expect(() =>
      remembered.write(EQUIPMENT_PREFERENCES.customBar, { amount: 1e308, unit: 'kg' }),
    ).toThrow(RangeError);
  });

  it('forgets everything on request, back to the defaults', () => {
    const remembered = store();
    saveEquipment(remembered, { ...DEFAULT_EQUIPMENT, plateUnit: 'lb', collarId: 'competition' });
    remembered.forgetAll();
    expect(loadEquipment(remembered)).toEqual(DEFAULT_EQUIPMENT);
  });
});
