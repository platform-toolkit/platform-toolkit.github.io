// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The bar, the collars, and the plates -- what a lifter actually has.
 *
 * The catalogue, not the math. `plates.ts` answers "what totals can this rack
 * build"; this file answers "what is on the rack in the first place", which is a
 * different kind of fact -- product scope, the way `lifts.ts` is, rather than a
 * calculation. Everything here is pure and takes an `Equipment` and gives back a
 * new one, so the whole of the equipment behaviour is testable in Node with no
 * browser and no storage at all.
 *
 * WHY IT IS HERE RATHER THAN BESIDE THE SCREEN THAT FIRST NEEDED IT
 *
 * It lived in `apps/web/src/warm-up/` while exactly one tool had a rack. Three
 * do now -- the warm-up calculator, meet day, and the training logbook -- and the
 * third is a package, which cannot import from an application. The alternative
 * was a second copy of the denominations and the full-diameter defaults, and a
 * second copy is how a 10 lb plate stops being full diameter in one tool and goes
 * on being full diameter in another, which changes where the bar sits off the
 * floor and therefore what a deadlift warm-up is.
 *
 * TWO INVENTORIES, ONE PER UNIT
 *
 * Denominations differ between units and so does what a gym owns, so switching
 * from kilograms to pounds must not edit the kilogram inventory -- a lifter who
 * looks at the pound view and switches back has to find their plates as they
 * left them. Keeping one list and converting it would also invent denominations:
 * a 25 kg plate is not a 55.1 lb plate, it is a plate that does not exist in a
 * pound gym.
 */
import { type BarbellSetup, type PlateDenomination } from './plates.js';
import { formatWeight, type Weight, type WeightUnit } from './weight.js';

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
  // The bar a great many home racks came with, and the one a lot of lifters --
  // women more often than not -- are actually standing under while the tool
  // assumes forty-five. It is near enough to the ten-kilogram technique bar to
  // look like a duplicate and is not one: a lifter loading in pounds should not
  // have to accept a bar quoted in kilograms to get the right number.
  { id: 'training-22', name: 'Training bar', weight: { amount: 22, unit: 'lb' } },
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

/**
 * The fractional plates, which are a set a lifter either owns or does not.
 *
 * They are singled out from the rest of the catalogue because that is how they
 * are sold and how they are thought about -- a bag of small plates that lives in
 * a gym bag, not part of the rack -- and because the useful control over them is
 * one switch rather than four. The individual switches remain, since the set
 * gets split and lost and lent out, and a lifter with three of the four should
 * not have to choose between claiming a plate they cannot find and giving up the
 * other three.
 *
 * They earn their keep on two lifts in particular: an odd bar, where a round
 * warm-up target is not reachable with two-and-a-halves, and the working weight,
 * which is the number the lifter typed and the one place a pound matters.
 */
export const MICRO_DENOMINATIONS: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [1, 0.5, 0.25],
  lb: [1, 0.75, 0.5, 0.25],
};

/** Every denomination a lifter may select, heaviest first. */
export const DENOMINATIONS: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1, 0.5, 0.25],
  lb: [45, 35, 25, 20, 15, 10, 5, 2.5, 1.25, 1, 0.75, 0.5, 0.25],
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
 * Not every denomination -- the odd sizes between are a specialty rack, and
 * offering a ramp built on plates nobody owns is a plan that cannot be loaded.
 *
 * The fractional plates are here anyway, which used to be the opposite of what
 * this list said. The old reasoning was that a ramp built on quarter-pound
 * plates is unloadable in most gyms, and it was right; what changed is that the
 * ramp is no longer built on them. Warm-up targets are rounded to a readable
 * step before the plates are searched, so a fractional plate can only ever be
 * called for by an odd bar or by the working weight -- the number the lifter
 * typed, where being told 102 instead of 102.5 is the tool getting it wrong.
 * Being wrong in the other direction costs a switch to find.
 */
const STOCKED_BY_DEFAULT: Readonly<Record<WeightUnit, readonly number[]>> = {
  kg: [25, 20, 15, 10, 5, 2.5, ...MICRO_DENOMINATIONS.kg],
  lb: [45, 25, 10, 5, 2.5, ...MICRO_DENOMINATIONS.lb],
};

/**
 * The denominations a broadly equipped gym in this unit has, ready to store.
 *
 * Exported because a consumer that persists its own equipment needs a starting
 * rack and must not hand-write one -- a second list of denominations is the
 * duplication this module was hoisted out of an application to prevent.
 */
export function defaultInventory(unit: WeightUnit): readonly PlateDenomination[] {
  return DENOMINATIONS[unit]
    .filter((weight) => STOCKED_BY_DEFAULT[unit].includes(weight))
    .map((weight) => ({
      weight,
      pairs: null,
      fullDiameter: FULL_DIAMETER_BY_DEFAULT[unit].includes(weight),
    }));
}

/** Whether this denomination is full diameter unless somebody says otherwise. */
export function fullDiameterByDefault(unit: WeightUnit, weight: number): boolean {
  return FULL_DIAMETER_BY_DEFAULT[unit].includes(weight);
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

/**
 * What the calculator assumes before anybody tells it anything.
 *
 * Pounds and a forty-five, which is not the unit the sport is scored in and is
 * the unit this screen is most often read in. The two populations sort
 * themselves: a lifter who competes in kilograms already knows the difference
 * between a twenty and a forty-five and will open the setup to say so, and a
 * lifter meeting a barbell calculator for the first time is in a pound gym and
 * will believe whatever the first screen says. Defaults should be right for the
 * person least equipped to notice they are wrong.
 */
export const DEFAULT_EQUIPMENT: Equipment = {
  plateUnit: 'lb',
  barId: 'standard-45',
  customBar: { amount: 45, unit: 'lb' },
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

/** The equipment as the plate math wants it, for one lift's bar. */
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
 * The one-line summary, from the three values it is actually made of.
 *
 * Separate from {@link describeEquipment} because a tool that stores a frozen
 * rack -- the training logbook keeps one per workout, so a history is not
 * redrawn with this month's plates -- has the bar and the collars as weights and
 * has no `Equipment` to hand. Both tools have to read the same, since a lifter
 * checking the calculator's summary against the logbook's is checking whether
 * the two agree about the bar.
 */
export function describeRack(plateUnit: WeightUnit, bar: Weight, collars: Weight): string {
  return [
    `${plateUnit} plates`,
    `${formatWeight(bar)} bar`,
    collars.amount === 0 ? 'no collar weight' : `${formatWeight(collars)} collars`,
  ].join(' • ');
}

/**
 * The one-line summary that stays on screen once setup is collapsed.
 *
 * `kg plates - 20 kg bar - no collar weight`, which is the whole of what a
 * lifter has to check before trusting a number on this screen.
 */
export function describeEquipment(equipment: Equipment): string {
  return describeRack(equipment.plateUnit, barWeight(equipment), collarWeight(equipment));
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

/** How much of the fractional set is on the rack. */
export type MicroPlateState = 'all' | 'some' | 'none';

export function microPlateState(equipment: Equipment, unit: WeightUnit): MicroPlateState {
  const owned = MICRO_DENOMINATIONS[unit].filter(
    (weight) => denomination(equipment, unit, weight) !== null,
  ).length;
  if (owned === 0) return 'none';
  return owned === MICRO_DENOMINATIONS[unit].length ? 'all' : 'some';
}

/**
 * Selects or deselects the whole fractional set at once.
 *
 * Idempotent per denomination, so the caller may pass the state it wants rather
 * than the change it wants and a half-selected set resolves either way in one
 * action. A plate already in the requested state is left alone, which keeps the
 * list order stable instead of removing and reinserting it.
 */
export function setMicroPlates(equipment: Equipment, unit: WeightUnit, on: boolean): Equipment {
  return MICRO_DENOMINATIONS[unit].reduce((current, weight) => {
    const present = denomination(current, unit, weight) !== null;
    return present === on ? current : toggleDenomination(current, unit, weight);
  }, equipment);
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
