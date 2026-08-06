// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  CUSTOM_BAR_ID,
  DEFAULT_EQUIPMENT as CATALOGUE_DEFAULT,
  defaultInventory,
  describeEquipment as describeCatalogueEquipment,
  toggleDenomination,
  updateDenomination,
} from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type { EquipmentSnapshot } from '../types.js';

import { AT_LATER, AT_START, testContext } from './context.fixture.js';
import {
  DEFAULT_EQUIPMENT,
  createProfile,
  describeEquipment,
  equipmentFrom,
  findProfile,
  findProfileFor,
  renameProfile,
  sameEquipment,
  snapshotFrom,
  toBarbellSetup,
  updateProfileEquipment,
} from './equipment.js';

/** A rack that is nobody's default, so nothing can pass by resembling one. */
function aGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 5, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: 2, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: false },
    ],
  };
}

describe('the default rack', () => {
  it('opens on the same bar the calculator opens on', () => {
    // Two tools disagreeing about the default bar gives a lifter no way to tell
    // which of them is lying, and the number they are checking is the one they
    // are about to stand under.
    expect(DEFAULT_EQUIPMENT.barWeight).toEqual({ amount: 45, unit: 'lb' });
    expect(DEFAULT_EQUIPMENT.plateUnit).toBe('lb');
    expect(DEFAULT_EQUIPMENT.collarWeight.amount).toBe(0);
  });

  it('reads the same on both tools word for word', () => {
    expect(describeEquipment(DEFAULT_EQUIPMENT)).toBe(
      describeCatalogueEquipment(CATALOGUE_DEFAULT),
    );
  });
});

describe('snapshotFrom', () => {
  it('resolves the bar to a weight rather than storing its name', () => {
    // The whole reason section 8.4 asks for a snapshot. A stored identifier is
    // resolved afresh on every read, so a preset whose weight is corrected next
    // year would silently reweigh every workout already done under it.
    const snapshot = snapshotFrom(CATALOGUE_DEFAULT, 'olympic-20');
    expect(snapshot.barWeight).toEqual({ amount: 20, unit: 'kg' });
    expect(Object.keys(snapshot)).not.toContain('barId');
  });

  it('takes the bar for the lift, not the bar for the gym', () => {
    // Somebody squats with a specialty bar and benches with a standard one, so a
    // per-lift bar must not write itself back into the equipment.
    expect(snapshotFrom(CATALOGUE_DEFAULT, 'safety-squat-65').barWeight).toEqual({
      amount: 65,
      unit: 'lb',
    });
    expect(CATALOGUE_DEFAULT.barId).toBe('standard-45');
  });

  it('keeps only the plates for the unit the workout was done in', () => {
    // The other unit's rack was not in the building. Carrying it would suggest a
    // loading the lifter could not have made.
    const snapshot = snapshotFrom({ ...CATALOGUE_DEFAULT, plateUnit: 'kg' });
    expect(snapshot.plates.map((plate) => plate.weight)).toEqual(
      defaultInventory('kg').map((plate) => plate.weight),
    );
  });

  it('does not hold on to the inventory it was handed', () => {
    // A snapshot that shares an array with a live setup screen is a history that
    // changes when the lifter unticks a plate.
    expect(snapshotFrom(CATALOGUE_DEFAULT).plates).not.toBe(CATALOGUE_DEFAULT.inventory.lb);
  });

  it('records that a plate runs out, and that it is not competition diameter', () => {
    // Both fields decide what the ramp does: `fullDiameter` is how high the bar
    // sits off the floor, `pairs` is whether the plate lasts to the top set. A
    // snapshot of bare weights would lose the difference between a deadlift and
    // a rack pull.
    const counted = updateDenomination(CATALOGUE_DEFAULT, 'lb', 45, {
      pairs: 1,
      fullDiameter: false,
    });
    const plate = snapshotFrom(counted).plates.find((each) => each.weight === 45);
    expect(plate).toEqual({ weight: 45, pairs: 1, fullDiameter: false });
  });
});

describe('equipmentFrom', () => {
  it('round-trips a rack back through an editable setup unchanged', () => {
    expect(snapshotFrom(equipmentFrom(aGym()))).toEqual(aGym());
  });

  it('brings the bar back as a custom weight rather than hunting for a preset', () => {
    // Matching the weight back to `olympic-20` would re-attach the snapshot to a
    // catalogue entry that can move, which is the drift it was frozen to escape.
    const opened = equipmentFrom(aGym());
    expect(opened.barId).toBe(CUSTOM_BAR_ID);
    expect(opened.customBar).toEqual({ amount: 20, unit: 'kg' });
  });

  it('refills the unit the snapshot never held rather than inventing one', () => {
    // A pound rack is not a converted kilogram rack -- a 25 kg plate is not a
    // 55.1 lb plate, it is a plate a pound gym does not have.
    expect(equipmentFrom(aGym()).inventory.lb).toEqual(defaultInventory('lb'));
  });
});

describe('toBarbellSetup', () => {
  it('hands the plate math the three values it consumes', () => {
    const setup = toBarbellSetup(aGym());
    expect(setup.plateUnit).toBe('kg');
    expect(setup.bar).toEqual({ amount: 20, unit: 'kg' });
    expect(setup.collars).toEqual({ amount: 5, unit: 'kg' });
    expect(setup.plates).toEqual(aGym().plates);
  });

  it('keeps a bar in the other unit in its own unit', () => {
    // A kilogram bar in a pound gym is ordinary, and converting it here would
    // round it into the plate unit and stop it matching the sticker.
    const setup = toBarbellSetup({ ...aGym(), plateUnit: 'lb' });
    expect(setup.bar).toEqual({ amount: 20, unit: 'kg' });
    expect(setup.plateUnit).toBe('lb');
  });
});

describe('describeEquipment', () => {
  it('summarises the rack in one line', () => {
    expect(describeEquipment(aGym())).toBe('kg plates • 20 kg bar • 5 kg collars');
  });

  it('says so when the collars weigh nothing', () => {
    const snapshot: EquipmentSnapshot = { ...aGym(), collarWeight: { amount: 0, unit: 'kg' } };
    expect(describeEquipment(snapshot)).toBe('kg plates • 20 kg bar • no collar weight');
  });
});

describe('sameEquipment', () => {
  it('recognises the same rack described twice', () => {
    expect(sameEquipment(aGym(), aGym())).toBe(true);
  });

  it('does not care what order the plates were listed in', () => {
    // A restored backup arrives from a JSON document this package did not write.
    // A rack listed lightest first is the same rack, and reading it as a
    // different one would offer a recalculation nobody asked for on every load.
    const reversed: EquipmentSnapshot = { ...aGym(), plates: [...aGym().plates].reverse() };
    expect(sameEquipment(aGym(), reversed)).toBe(true);
  });

  it('notices a bar that changed', () => {
    const other: EquipmentSnapshot = { ...aGym(), barWeight: { amount: 25, unit: 'kg' } };
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('notices collars that stopped being counted', () => {
    const other: EquipmentSnapshot = { ...aGym(), collarWeight: { amount: 0, unit: 'kg' } };
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('notices a plate that is no longer on the rack', () => {
    const other: EquipmentSnapshot = { ...aGym(), plates: aGym().plates.slice(0, 1) };
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('notices a plate that ran out', () => {
    const other = snapshotFrom(updateDenomination(equipmentFrom(aGym()), 'kg', 25, { pairs: 1 }));
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('notices a plate that stopped being competition diameter', () => {
    // This one decides how high the bar sits off the floor, which is the whole
    // difference between a deadlift warm-up and a rack pull. A comparison that
    // only read weights would call the two racks identical.
    const other = snapshotFrom(
      updateDenomination(equipmentFrom(aGym()), 'kg', 25, { fullDiameter: false }),
    );
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('notices a denomination that was added', () => {
    const other = snapshotFrom(toggleDenomination(equipmentFrom(aGym()), 'kg', 5));
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('reads the same mass entered in another unit as another answer', () => {
    // Section 11.4: preserve the entered unit and value. A 20 kg bar and a
    // 44.1 lb bar weigh the same and read differently, so calling them equal
    // would have the tool tell a lifter nothing changed while the summary line
    // changed under them.
    const other: EquipmentSnapshot = { ...aGym(), barWeight: { amount: 44.1, unit: 'lb' } };
    expect(sameEquipment(aGym(), other)).toBe(false);
  });

  it('reads a different plate unit as a different rack', () => {
    expect(sameEquipment(aGym(), { ...aGym(), plateUnit: 'lb' })).toBe(false);
  });

  it('reads no collars and no collars as the same bar, whichever unit the zero is in', () => {
    // The exception to the rule above, and it is the common case rather than a
    // curiosity: the catalogue's "none" preset is zero *kilograms*, so a pound rack
    // that has been through the custom-collar box and back carries zero pounds for
    // the identical bar. Comparing the unit of a zero would unmark the saved gym the
    // lifter is standing in and, through section 8.4, discard a warm-up plan for a
    // rack nothing has been added to or taken off.
    const bare: EquipmentSnapshot = { ...aGym(), collarWeight: { amount: 0, unit: 'kg' } };
    const alsoBare: EquipmentSnapshot = { ...aGym(), collarWeight: { amount: 0, unit: 'lb' } };
    expect(sameEquipment(bare, alsoBare)).toBe(true);
    expect(sameEquipment(bare, aGym())).toBe(false);
  });
});

describe('the profile library', () => {
  it('saves the rack in front of the lifter under a name', () => {
    const profile = createProfile('The garage', aGym(), testContext());
    expect(profile.id).toBe('id-1');
    expect(profile.name).toBe('The garage');
    expect(profile.equipment).toEqual(aGym());
    expect(profile.createdAt).toBe(AT_START);
    expect(profile.updatedAt).toBe(AT_START);
  });

  it('trims a name, because a trailing space is invisible in a picker', () => {
    // Two rows reading "The garage" and one of them being a different gym is a
    // lifter picking the wrong plates and having no way to see why.
    expect(createProfile('  The garage  ', aGym(), testContext()).name).toBe('The garage');
    expect(
      renameProfile(createProfile('a', aGym(), testContext()), ' b ', testContext()).name,
    ).toBe('b');
  });

  it('keeps a renamed gym pointing at the same identity', () => {
    // Section 11.3. A workout that recorded where it was done must survive the
    // lifter deciding that "Gym" should have said "the garage".
    const profile = createProfile('Gym', aGym(), testContext());
    const renamed = renameProfile(profile, 'The garage', testContext(AT_LATER));
    expect(renamed.id).toBe(profile.id);
    expect(renamed.createdAt).toBe(AT_START);
    expect(renamed.updatedAt).toBe(AT_LATER);
  });

  it('records that the plates at a saved gym have changed', () => {
    const profile = createProfile('Gym', aGym(), testContext());
    const restocked = updateProfileEquipment(profile, DEFAULT_EQUIPMENT, testContext(AT_LATER));
    expect(restocked.equipment).toEqual(DEFAULT_EQUIPMENT);
    expect(restocked.id).toBe(profile.id);
    expect(restocked.updatedAt).toBe(AT_LATER);
  });

  it('finds the saved gym a setup matches', () => {
    const garage = createProfile('The garage', aGym(), testContext());
    const home = createProfile('Home', DEFAULT_EQUIPMENT, testContext());
    expect(findProfileFor([home, garage], aGym())?.name).toBe('The garage');
  });

  it('answers nothing rather than guessing when no saved gym matches', () => {
    // A builder that highlighted the nearest profile would tell a lifter their
    // plates are saved when they are not, and the next session would open on the
    // wrong rack.
    const home = createProfile('Home', DEFAULT_EQUIPMENT, testContext());
    expect(findProfileFor([home], aGym())).toBe(null);
  });

  it('finds a saved gym by identifier, and answers nothing for one that is gone', () => {
    const home = createProfile('Home', DEFAULT_EQUIPMENT, testContext());
    expect(findProfile([home], home.id)?.name).toBe('Home');
    expect(findProfile([home], 'id-deleted')).toBe(null);
  });
});
