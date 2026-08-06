// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rack a workout was done on, and the library of racks a lifter trains on.
 *
 * WHY THIS IS NOT JUST THE DOMAIN'S `Equipment`
 *
 * `@platform-toolkit/domain` owns the catalogue -- which bars exist, which
 * denominations exist, which of them are competition diameter -- and this file
 * owns none of that and must never restate any of it. What it owns is the shape
 * that gets *written down*. An `Equipment` is a lifter's current selection,
 * complete with a bar identifier and an inventory per unit, and it is the right
 * value for a setup screen. An {@link EquipmentSnapshot} is what a completed
 * workout keeps: the three values the plate math actually consumed, resolved.
 *
 * The flattening is the point. A stored bar *identifier* is a reference into a
 * catalogue that a later build may reword, retire, or reweigh -- and a history
 * that resolved `standard-45` afresh on every read would redraw a lifter's
 * February squats against whatever that identifier means in November. A stored
 * bar *weight* cannot move. Section 8.4 asks for exactly this, and gives the
 * reason: it prevents future algorithm changes from rewriting the historical
 * record. A catalogue change is an algorithm change wearing a different hat.
 *
 * WHAT IS LOST GOING IN, AND WHY IT IS THE RIGHT THING TO LOSE
 *
 * A snapshot holds one unit's plates, not both. An `Equipment` keeps a kilogram
 * rack and a pound rack side by side so that flicking the unit does not destroy
 * the other list; a workout was done in one unit, on one set of plates, and the
 * other rack was not in the building. {@link equipmentFrom} therefore refills
 * the unused unit from the catalogue defaults rather than pretending to
 * remember it, which is honest and is also why the round trip is only lossless
 * in the direction that matters -- snapshot to equipment to snapshot.
 */

import {
  CUSTOM_BAR_ID,
  CUSTOM_COLLAR_ID,
  DEFAULT_EQUIPMENT as CATALOGUE_DEFAULT,
  barWeight,
  collarWeight,
  defaultInventory,
  describeRack,
  type BarbellSetup,
  type Equipment,
  type PlateDenomination,
  type Weight,
} from '@platform-toolkit/domain';

import type { EquipmentProfile, EquipmentSnapshot, LogbookId } from '../types.js';

import type { SessionContext } from './session.js';

/**
 * The rack a lifter is assumed to be standing at before they say otherwise.
 *
 * Derived from the catalogue's own default rather than restated, so the two
 * tools open on the same bar. A lifter who set their plates up in the warm-up
 * calculator and then opened the logbook and found a different bar would have
 * no way to tell which of the two was lying.
 */
export const DEFAULT_EQUIPMENT: EquipmentSnapshot = snapshotFrom(CATALOGUE_DEFAULT);

/**
 * Freezes a lifter's current selection into the form a workout keeps.
 *
 * `barId` is separate because the bar belongs to the lift and not to the gym:
 * somebody squats with a specialty bar and benches with a standard one, and the
 * equipment holds only what a new lift starts with.
 */
export function snapshotFrom(
  equipment: Equipment,
  barId: string = equipment.barId,
): EquipmentSnapshot {
  return {
    barWeight: barWeight(equipment, barId),
    collarWeight: collarWeight(equipment),
    plateUnit: equipment.plateUnit,
    plates: heaviestFirst(equipment.inventory[equipment.plateUnit]),
  };
}

/**
 * Opens a stored rack back up for editing.
 *
 * The bar and the collars come back as custom values rather than as identifiers
 * the catalogue would have to be searched for. Searching would find the wrong
 * answer in the one case that matters -- a bar whose preset weight has since
 * been corrected would silently take its new weight, which is the drift the
 * snapshot exists to stop -- and finding nothing would lose the bar outright.
 */
export function equipmentFrom(snapshot: EquipmentSnapshot): Equipment {
  return {
    plateUnit: snapshot.plateUnit,
    barId: CUSTOM_BAR_ID,
    customBar: snapshot.barWeight,
    collarId: CUSTOM_COLLAR_ID,
    customCollars: snapshot.collarWeight,
    inventory: {
      kg: snapshot.plateUnit === 'kg' ? snapshot.plates : defaultInventory('kg'),
      lb: snapshot.plateUnit === 'lb' ? snapshot.plates : defaultInventory('lb'),
    },
  };
}

/** The snapshot as the plate math wants it. */
export function toBarbellSetup(snapshot: EquipmentSnapshot): BarbellSetup {
  return {
    plateUnit: snapshot.plateUnit,
    bar: snapshot.barWeight,
    collars: snapshot.collarWeight,
    plates: snapshot.plates,
  };
}

/**
 * The one-line summary a lifter checks a number against.
 *
 * Delegated to the catalogue's own formatter rather than written here, because
 * a lifter comparing the warm-up calculator's summary line with the logbook's is
 * checking whether the two tools agree about the bar -- and two formatters that
 * disagree about punctuation would make an agreement look like a disagreement.
 */
export function describeEquipment(snapshot: EquipmentSnapshot): string {
  return describeRack(snapshot.plateUnit, snapshot.barWeight, snapshot.collarWeight);
}

/**
 * Whether two racks are the same rack.
 *
 * What section 8.5 branches on: a warm-up generated against one rack and
 * displayed beside another is a plate loading nobody can follow, so the tool has
 * to know when to offer a recalculation. A false negative costs an offer the
 * lifter declines; a false positive shows last month's plates under this month's
 * bar. So this errs towards saying no.
 *
 * Weights are compared as they were entered, not as mass. A 20 kg bar and a
 * 44.1 lb bar weigh the same and are not the same answer: the summary line reads
 * differently, so a lifter who retyped their bar in the other unit and was told
 * nothing had changed would be watching the screen contradict itself. Section
 * 11.4 is the rule -- preserve the entered unit and value, and never silently
 * reinterpret a number when the unit changes.
 */
export function sameEquipment(left: EquipmentSnapshot, right: EquipmentSnapshot): boolean {
  return (
    left.plateUnit === right.plateUnit &&
    sameWeight(left.barWeight, right.barWeight) &&
    sameWeight(left.collarWeight, right.collarWeight) &&
    rackKey(left.plates) === rackKey(right.plates)
  );
}

/** Saves the rack in front of the lifter under a name. */
export function createProfile(
  name: string,
  equipment: EquipmentSnapshot,
  context: SessionContext,
): EquipmentProfile {
  return {
    id: context.nextId(),
    name: name.trim(),
    equipment,
    createdAt: context.at,
    updatedAt: context.at,
  };
}

/**
 * Renames a saved rack, keeping its identity.
 *
 * The identifier does not move, which is section 11.3: a workout that recorded
 * where it was done keeps pointing at the same gym after the lifter decides that
 * "Gym" should have said "the garage".
 */
export function renameProfile(
  profile: EquipmentProfile,
  name: string,
  context: SessionContext,
): EquipmentProfile {
  return { ...profile, name: name.trim(), updatedAt: context.at };
}

/** Records that the plates at a saved gym have changed. */
export function updateProfileEquipment(
  profile: EquipmentProfile,
  equipment: EquipmentSnapshot,
  context: SessionContext,
): EquipmentProfile {
  return { ...profile, equipment, updatedAt: context.at };
}

/** The saved rack a setup matches, where one does. */
export function findProfileFor(
  profiles: readonly EquipmentProfile[],
  equipment: EquipmentSnapshot,
): EquipmentProfile | null {
  return profiles.find((profile) => sameEquipment(profile.equipment, equipment)) ?? null;
}

/** A saved rack by identifier. */
export function findProfile(
  profiles: readonly EquipmentProfile[],
  id: LogbookId,
): EquipmentProfile | null {
  return profiles.find((profile) => profile.id === id) ?? null;
}

/**
 * A copy of the rack in canonical order, heaviest first.
 *
 * Copied rather than sorted in place, because the source is somebody else's
 * inventory.
 */
function heaviestFirst(plates: readonly PlateDenomination[]): readonly PlateDenomination[] {
  return [...plates].sort((left, right) => right.weight - left.weight);
}

function sameWeight(left: Weight, right: Weight): boolean {
  return left.amount === right.amount && left.unit === right.unit;
}

/**
 * The whole rack as one comparable string.
 *
 * Sorted first, because a snapshot does not have to have come from this file --
 * a restored backup arrives from a JSON document written by who knows what, and
 * a rack listed lightest first is the same rack. All three fields go in: two of
 * them decide what the ramp does, so a key of weights alone would call a gym
 * that has run out of 25s identical to one that has not.
 */
function rackKey(plates: readonly PlateDenomination[]): string {
  return heaviestFirst(plates)
    .map((plate) => [plate.weight, plate.pairs, plate.fullDiameter].map(String).join(':'))
    .join('|');
}
