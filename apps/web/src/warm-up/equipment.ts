/**
 * The bar, the collars, and the plates -- what the lifter has, and how it is
 * remembered.
 *
 * Everything here is pure. The components below take an `Equipment` and give
 * back a new one; only `loadEquipment` and `saveEquipment` touch a store, and
 * they take it as an argument. That is what lets the whole of the equipment
 * behaviour be tested in Node with no browser and no storage at all.
 *
 * TWO INVENTORIES, ONE PER UNIT
 *
 * Denominations differ between units and so does what a gym owns, so switching
 * from kilograms to pounds must not edit the kilogram inventory -- a lifter who
 * looks at the pound view and switches back has to find their plates as they
 * left them. Keeping one list and converting it would also invent denominations:
 * a 25 kg plate is not a 55.1 lb plate, it is a plate that does not exist in a
 * pound gym.
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
  formatWeight,
  type BarbellSetup,
  type PlateDenomination,
  type Weight,
  type WeightUnit,
} from '@platform-toolkit/domain';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

/** A bar somebody might actually be standing under. */
export interface BarPreset {
  readonly id: string;
  readonly name: string;
  readonly weight: Weight;
}

/**
 * The bar presets, by weight and type rather than by brand.
 *
 * Presets, not claims: no two squat bars weigh the same and the requirements say
 * so. `custom` is always available beside these, which is what makes the list a
 * convenience instead of a constraint.
 */
export const BAR_PRESETS: readonly BarPreset[] = [
  { id: 'olympic-20', name: 'Olympic bar', weight: { amount: 20, unit: 'kg' } },
  { id: 'standard-45', name: 'Standard bar', weight: { amount: 45, unit: 'lb' } },
  { id: 'womens-15', name: "Women's Olympic bar", weight: { amount: 15, unit: 'kg' } },
  { id: 'squat-25', name: 'Squat bar', weight: { amount: 25, unit: 'kg' } },
  { id: 'safety-squat-65', name: 'Safety squat bar', weight: { amount: 65, unit: 'lb' } },
  { id: 'technique-10', name: 'Technique bar', weight: { amount: 10, unit: 'kg' } },
  { id: 'light-technique-15', name: 'Light technique bar', weight: { amount: 15, unit: 'lb' } },
];

/** The identifier that means "not one of the presets". */
export const CUSTOM_BAR_ID = 'custom';

/** What the collars contribute to the total, which is usually nothing. */
export interface CollarPreset {
  readonly id: string;
  readonly name: string;
  /** The pair, not one of them. A lifter reads the total off the bar, not off one end. */
  readonly weight: Weight;
}

export const COLLAR_PRESETS: readonly CollarPreset[] = [
  // The default, and it is the default because most collars are clips that
  // nobody counts. Counting five kilograms nobody put on the bar is the error
  // this screen exists to prevent, so the safe answer is the one preselected.
  { id: 'none', name: 'No collar weight', weight: { amount: 0, unit: 'kg' } },
  { id: 'competition', name: 'Competition collars', weight: { amount: 5, unit: 'kg' } },
];

export const CUSTOM_COLLAR_ID = 'custom';

/** Every denomination a lifter may select, heaviest first. */
export const DENOMINATIONS: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1, 0.5],
  lb: [45, 35, 25, 20, 15, 10, 5, 2.5, 1.25],
};

/**
 * Which denominations are full diameter unless the lifter says otherwise.
 *
 * This decides where the bar sits off the floor, and therefore whether a pull
 * warm-up is the movement being warmed up for. In kilograms the 25 and the 20
 * are competition-diameter iron in most gyms and everything below is smaller; in
 * pounds the 45 is, with the 25 and the 10 as the requested fallbacks -- those
 * being bumpers in the gyms that have them.
 */
const FULL_DIAMETER_BY_DEFAULT: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20],
  lb: [45, 25, 10],
};

/**
 * What a broadly equipped gym has out on the rack.
 *
 * Not every denomination: the change plates below a kilogram are a competition
 * item, and offering a ramp built on them to somebody who does not own them is
 * a plan that cannot be loaded.
 */
const STOCKED_BY_DEFAULT: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5],
  lb: [45, 25, 10, 5, 2.5],
};

function defaultInventory(unit: WeightUnit): readonly PlateDenomination[] {
  return DENOMINATIONS[unit]
    .filter((weight) => STOCKED_BY_DEFAULT[unit].includes(weight))
    .map((weight) => ({
      weight,
      pairs: null,
      fullDiameter: FULL_DIAMETER_BY_DEFAULT[unit].includes(weight),
    }));
}

/** Everything the calculator needs to know about the rack. */
export interface Equipment {
  readonly plateUnit: WeightUnit;
  /** A preset id, or `custom`. */
  readonly barId: string;
  readonly customBar: Weight;
  readonly collarId: string;
  readonly customCollars: Weight;
  /** The selected denominations, per unit, heaviest first. */
  readonly inventory: Readonly<Record<WeightUnit, readonly PlateDenomination[]>>;
}

export const DEFAULT_EQUIPMENT: Equipment = {
  plateUnit: 'kg',
  barId: 'olympic-20',
  customBar: { amount: 20, unit: 'kg' },
  collarId: 'none',
  customCollars: { amount: 5, unit: 'kg' },
  inventory: { kg: defaultInventory('kg'), lb: defaultInventory('lb') },
};

function presetBar(id: string): BarPreset | null {
  return BAR_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * What the bar weighs, in its own unit.
 *
 * `barId` is passed separately because a lifter may squat with a specialty bar
 * and bench with a standard one, so the bar is a property of today's lift and
 * the equipment holds only the default. An id nothing recognises falls back to
 * the default rather than throwing: ids come out of stored preferences written
 * by an older build, and losing the bar is better than losing the screen.
 */
export function barWeight(equipment: Equipment, barId: string = equipment.barId): Weight {
  if (barId === CUSTOM_BAR_ID) return equipment.customBar;
  return presetBar(barId)?.weight ?? equipment.customBar;
}

export function collarWeight(equipment: Equipment): Weight {
  if (equipment.collarId === CUSTOM_COLLAR_ID) return equipment.customCollars;
  return (
    COLLAR_PRESETS.find((preset) => preset.id === equipment.collarId)?.weight ??
    equipment.customCollars
  );
}

/** The equipment as the domain wants it, for one lift's bar. */
export function toBarbellSetup(
  equipment: Equipment,
  barId: string = equipment.barId,
): BarbellSetup {
  return {
    plateUnit: equipment.plateUnit,
    bar: barWeight(equipment, barId),
    collars: collarWeight(equipment),
    plates: equipment.inventory[equipment.plateUnit],
  };
}

/** The bar's name for a picker, with its weight, since two presets share a name in no unit. */
export function barLabel(equipment: Equipment, barId: string): string {
  const preset = presetBar(barId);
  const weight = formatWeight(barWeight(equipment, barId));
  return preset === null ? `Custom bar, ${weight}` : `${preset.name}, ${weight}`;
}

/**
 * The one-line summary that stays on screen once setup is collapsed.
 *
 * `kg plates - 20 kg bar - no collar weight`, which is the whole of what a
 * lifter has to check before trusting a number on this screen.
 */
export function describeEquipment(equipment: Equipment): string {
  const collars = collarWeight(equipment);
  return [
    `${equipment.plateUnit} plates`,
    `${formatWeight(barWeight(equipment))} bar`,
    collars.amount === 0 ? 'no collar weight' : `${formatWeight(collars)} collars`,
  ].join(' • ');
}

/** Selects or deselects one denomination, keeping the list heaviest first. */
export function toggleDenomination(
  equipment: Equipment,
  unit: WeightUnit,
  weight: number,
): Equipment {
  const present = equipment.inventory[unit].some((plate) => plate.weight === weight);
  const kept = equipment.inventory[unit].filter((plate) => plate.weight !== weight);
  const next = present
    ? kept
    : [
        ...kept,
        {
          weight,
          pairs: null,
          fullDiameter: FULL_DIAMETER_BY_DEFAULT[unit].includes(weight),
        },
      ].sort((left, right) => right.weight - left.weight);

  return { ...equipment, inventory: { ...equipment.inventory, [unit]: next } };
}

/**
 * Changes one denomination in place, or does nothing if it is not selected.
 *
 * Doing nothing rather than inserting is deliberate: the only callers are the
 * pair count and the full-diameter switch, both of which are rendered beside a
 * selected denomination, so an edit arriving for an unselected one means the
 * interface and the inventory have gone out of step and silently adding a plate
 * would hide it.
 */
export function updateDenomination(
  equipment: Equipment,
  unit: WeightUnit,
  weight: number,
  patch: Partial<Omit<PlateDenomination, 'weight'>>,
): Equipment {
  const next = equipment.inventory[unit].map((plate) =>
    plate.weight === weight ? { ...plate, ...patch } : plate,
  );
  return { ...equipment, inventory: { ...equipment.inventory, [unit]: next } };
}

/** Whether this denomination is on the rack, and how many pairs of it. */
export function denomination(
  equipment: Equipment,
  unit: WeightUnit,
  weight: number,
): PlateDenomination | null {
  return equipment.inventory[unit].find((plate) => plate.weight === weight) ?? null;
}

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
