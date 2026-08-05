// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The remembering half. The catalogue itself is tested in
 * `packages/domain/src/equipment.test.ts`, beside where it now lives.
 */

import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  CUSTOM_BAR_ID,
  DEFAULT_EQUIPMENT,
  DENOMINATIONS,
  EQUIPMENT_PREFERENCES,
  loadEquipment,
  saveEquipment,
  type Equipment,
} from './equipment.js';

function store() {
  return createPreferenceStore(memoryPreferenceStorage());
}

describe('the catalogue against what storage will hold', () => {
  it('keeps every offered denomination inside the stored list cap', () => {
    // `PLATE_LIST` caps the stored list at sixteen. A catalogue that outgrew the
    // cap would save nothing at all rather than save most of the rack -- and the
    // catalogue is now in another package, where nothing knows this cap exists.
    for (const unit of ['kg', 'lb'] as const) {
      expect(DENOMINATIONS[unit].length, unit).toBeLessThanOrEqual(16);
    }
  });

  it('keeps every offered denomination inside the stored weight bounds', () => {
    // `STORED_PLATE` bounds a weight to 0.25 .. 100. A denomination outside that
    // throws on write, which would lose the whole rack rather than one plate.
    for (const unit of ['kg', 'lb'] as const) {
      for (const weight of DENOMINATIONS[unit]) {
        expect(weight, `${unit} ${String(weight)}`).toBeGreaterThanOrEqual(0.25);
        expect(weight, `${unit} ${String(weight)}`).toBeLessThanOrEqual(100);
      }
    }
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
