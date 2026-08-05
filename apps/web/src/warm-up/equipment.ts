// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the lifter has, and how it is remembered.
 *
 * The "what they have" half now lives in `@platform-toolkit/domain` and is
 * re-exported below unchanged. It moved when the training logbook became the
 * third consumer of the same rack -- a package, which cannot import from an
 * application -- and the only alternative was a second copy of the denominations
 * and the full-diameter defaults. Two copies is how a 10 lb plate stops being
 * full diameter in one tool and goes on being full diameter in another, which
 * changes where the bar sits off the floor and therefore what a deadlift warm-up
 * is. The re-export is deliberate rather than a migration step: eighteen call
 * sites in this application read the catalogue from here, and pointing them all
 * at the package would be eighteen edits that change nothing.
 *
 * What is left here is the half that cannot move -- remembering. `packages/domain`
 * takes no dependency on `packages/preferences` and must not start: a script that
 * wants to know what a 20 kg bar plus two 25s weighs should not pull a browser
 * storage layer into its module graph.
 *
 * WHAT "NO QUANTITY" MEANS, AND WHY IT IS ZERO IN STORAGE
 *
 * `pairs: null` is the domain's word for "enough of these"; the preferences
 * package has no nullable builder on purpose (§5.12), so zero carries it across
 * the boundary. Zero pairs is not a state the interface can otherwise produce --
 * an unselected denomination is absent from the list rather than present with
 * none -- so the encoding cannot collide with a real answer.
 */
import {
  BAR_PRESETS,
  COLLAR_PRESETS,
  CUSTOM_BAR_ID,
  CUSTOM_COLLAR_ID,
  DEFAULT_EQUIPMENT,
  DENOMINATIONS,
  type Equipment,
  type PlateDenomination,
  type WeightUnit,
} from '@platform-toolkit/domain';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

export {
  BAR_PRESETS,
  COLLAR_PRESETS,
  CUSTOM_BAR_ID,
  CUSTOM_COLLAR_ID,
  DEFAULT_EQUIPMENT,
  DENOMINATIONS,
  MICRO_DENOMINATIONS,
  barLabel,
  barWeight,
  collarWeight,
  defaultInventory,
  denomination,
  describeEquipment,
  microPlateState,
  setMicroPlates,
  toBarbellSetup,
  toggleDenomination,
  updateDenomination,
  type BarPreset,
  type CollarPreset,
  type Equipment,
  type MicroPlateState,
} from '@platform-toolkit/domain';

/*
 * ---------------------------------------------------------------------------
 * What is remembered, and in what shape.
 * ---------------------------------------------------------------------------
 */

/**
 * Turns a list into the non-empty tuple `PreferenceValue.choice` requires.
 *
 * A runtime check rather than an assertion, because the lists below are derived
 * from other modules: a catalogue that emptied itself would otherwise produce a
 * schema accepting nothing, and every read would silently answer the fallback.
 */
function nonEmpty(values: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new RangeError('A preference choice needs at least one value.');
  }
  return [first, ...rest];
}

const UNIT = PreferenceValue.choice(['kg', 'lb']);

const BAR_IDS = nonEmpty([...BAR_PRESETS.map((preset) => preset.id), CUSTOM_BAR_ID]);
const COLLAR_IDS = nonEmpty([...COLLAR_PRESETS.map((preset) => preset.id), CUSTOM_COLLAR_ID]);

/**
 * Bounds on a custom bar and custom collars.
 *
 * Required by the preferences package, and load-bearing rather than defensive: a
 * corrupted bar weight is not caught anywhere downstream, because a ramp built
 * on a bar of 1e308 is a ramp of `Infinity` with no error at all.
 */
const CUSTOM_BAR = PreferenceValue.shape({
  amount: PreferenceValue.quantity({ min: 1, max: 200 }),
  unit: UNIT,
});
const CUSTOM_COLLARS = PreferenceValue.shape({
  amount: PreferenceValue.quantity({ min: 0, max: 50 }),
  unit: UNIT,
});

/** One denomination as stored. `pairs: 0` is the domain's `null` -- see the note above. */
const STORED_PLATE = PreferenceValue.shape({
  weight: PreferenceValue.quantity({ min: 0.25, max: 100 }),
  pairs: PreferenceValue.count({ min: 0, max: 40 }),
  full: PreferenceValue.flag(),
});

const PLATE_LIST = PreferenceValue.listOf(STORED_PLATE, {
  // One entry per offered denomination and no more. A list that grew past this
  // is a list something is appending to on every save.
  maxLength: 16,
});

/**
 * Declared once at module load, so a fallback that fails its own shape fails here.
 *
 * The type is inferred rather than annotated. Writing it out means restating the
 * shape each builder already produces, and the two spellings differ in exactly
 * one way that matters -- `shape` produces readonly fields, a hand-written
 * annotation almost never does -- so the annotation is an assignability error
 * that reads as a bug in the preferences package.
 */
export const EQUIPMENT_PREFERENCES = {
  plateUnit: definePreference({
    name: 'warm-up.plate-unit',
    value: UNIT,
    fallback: DEFAULT_EQUIPMENT.plateUnit,
  }),
  bar: definePreference({
    name: 'warm-up.bar',
    value: PreferenceValue.choice(BAR_IDS),
    fallback: DEFAULT_EQUIPMENT.barId,
  }),
  customBar: definePreference({
    name: 'warm-up.custom-bar',
    value: CUSTOM_BAR,
    fallback: { ...DEFAULT_EQUIPMENT.customBar },
  }),
  collars: definePreference({
    name: 'warm-up.collars',
    value: PreferenceValue.choice(COLLAR_IDS),
    fallback: DEFAULT_EQUIPMENT.collarId,
  }),
  customCollars: definePreference({
    name: 'warm-up.custom-collars',
    value: CUSTOM_COLLARS,
    fallback: { ...DEFAULT_EQUIPMENT.customCollars },
  }),
  platesKg: definePreference({
    name: 'warm-up.plates-kg',
    value: PLATE_LIST,
    fallback: encodePlates(DEFAULT_EQUIPMENT.inventory.kg),
  }),
  platesLb: definePreference({
    name: 'warm-up.plates-lb',
    value: PLATE_LIST,
    fallback: encodePlates(DEFAULT_EQUIPMENT.inventory.lb),
  }),
};

function encodePlates(
  plates: readonly PlateDenomination[],
): readonly { weight: number; pairs: number; full: boolean }[] {
  return plates.map((plate) => ({
    weight: plate.weight,
    pairs: plate.pairs ?? 0,
    full: plate.fullDiameter,
  }));
}

/**
 * Reads a stored inventory back, dropping anything this build does not offer.
 *
 * A denomination that is no longer in the catalogue is discarded rather than
 * kept: it would render as a plate with no checkbox beside it, unremovable, and
 * every ramp would keep using it.
 */
function decodePlates(
  unit: WeightUnit,
  stored: readonly { weight: number; pairs: number; full: boolean }[],
): readonly PlateDenomination[] {
  return DENOMINATIONS[unit].flatMap((weight) => {
    const entry = stored.find((plate) => plate.weight === weight);
    if (entry === undefined) return [];
    return [{ weight, pairs: entry.pairs === 0 ? null : entry.pairs, fullDiameter: entry.full }];
  });
}

/** The remembered equipment, or the defaults -- never a failure and never a wait. */
export function loadEquipment(store: PreferenceStore): Equipment {
  const stored = {
    plateUnit: store.read(EQUIPMENT_PREFERENCES.plateUnit),
    barId: store.read(EQUIPMENT_PREFERENCES.bar),
    customBar: store.read(EQUIPMENT_PREFERENCES.customBar),
    collarId: store.read(EQUIPMENT_PREFERENCES.collars),
    customCollars: store.read(EQUIPMENT_PREFERENCES.customCollars),
  };
  return {
    plateUnit: stored.plateUnit,
    barId: stored.barId,
    customBar: { ...stored.customBar },
    collarId: stored.collarId,
    customCollars: { ...stored.customCollars },
    inventory: {
      kg: decodePlates('kg', store.read(EQUIPMENT_PREFERENCES.platesKg)),
      lb: decodePlates('lb', store.read(EQUIPMENT_PREFERENCES.platesLb)),
    },
  };
}

/**
 * Writes the equipment back.
 *
 * The result of each write is deliberately ignored. There is exactly one thing
 * a caller could do with it -- stop promising to remember -- and `remembers`
 * already answers that before anything is written, without waiting for a lifter
 * to change a setting to find out.
 */
export function saveEquipment(store: PreferenceStore, equipment: Equipment): void {
  store.write(EQUIPMENT_PREFERENCES.plateUnit, equipment.plateUnit);
  store.write(EQUIPMENT_PREFERENCES.bar, equipment.barId);
  store.write(EQUIPMENT_PREFERENCES.customBar, { ...equipment.customBar });
  store.write(EQUIPMENT_PREFERENCES.collars, equipment.collarId);
  store.write(EQUIPMENT_PREFERENCES.customCollars, { ...equipment.customCollars });
  store.write(EQUIPMENT_PREFERENCES.platesKg, encodePlates(equipment.inventory.kg));
  store.write(EQUIPMENT_PREFERENCES.platesLb, encodePlates(equipment.inventory.lb));
}
