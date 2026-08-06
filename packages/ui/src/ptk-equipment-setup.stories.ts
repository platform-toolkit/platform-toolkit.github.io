// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { CUSTOM_BAR_ID, DEFAULT_EQUIPMENT, type Equipment } from '@platform-toolkit/domain';
import type { PtkEquipmentSetup } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry, not the relative path beside this file -- and note
// this is the opposite of what the test next door does. Storybook renders a
// workspace package from its built output, so a relative import here would load
// the source copy and define the tag a second time against the built one the
// preview already pulled in. The registry throws and the story still looks
// right, because the first definition won.
import '@platform-toolkit/ui';

/**
 * The rack, described once and remembered.
 *
 * This is the densest screen in the tool and the one a lifter sees least: it is
 * folded shut on arrival, answered once in a gym they train at, and then never
 * opened again. Which is exactly why it is storied -- the states worth looking
 * at are the ones nobody reaches twice. The folded summary is the whole of it,
 * because when it is shut that single line is the only claim on screen about
 * what the ramp below was calculated against.
 *
 * Every figure here is invented. Plate denominations are real numbers only
 * because the element checks a toggle against the list it offered.
 */

/**
 * A commercial gym: everything, no limits, and the fractional set in the bag.
 *
 * This is the shipped default -- pounds on a 45 lb bar -- because the lifter who
 * never opens this screen is the one who trains in pounds, and a story showing
 * something else documents a state nobody arrives in.
 */
const FULL_RACK: Equipment = DEFAULT_EQUIPMENT;

/**
 * A home rack: a few denominations, one of them nearly gone, no small plates.
 *
 * Pounds, and pinned rather than inherited: overriding the *kilogram* inventory
 * on a rack the element draws in pounds is a fixture that shows the defaults
 * while claiming to show limits.
 */
const HOME_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    lb: [
      { weight: 45, pairs: 1, fullDiameter: true },
      { weight: 25, pairs: 2, fullDiameter: true },
      { weight: 10, pairs: 2, fullDiameter: false },
      { weight: 5, pairs: 1, fullDiameter: false },
    ],
  },
};

/** The bag with one plate missing from it, which is the third state of the switch. */
const PART_MICRO: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    lb: DEFAULT_EQUIPMENT.inventory.lb.filter((plate) => plate.weight !== 0.25),
  },
};

const meta: Meta<PtkEquipmentSetup> = {
  title: 'Warm-up/Equipment setup',
  component: 'ptk-equipment-setup',
  tags: ['autodocs'],
  argTypes: {
    equipment: { control: 'object' },
    open: { control: 'boolean', description: 'Whether the section starts unfolded.' },
    remembers: {
      control: 'boolean',
      description: 'False when the device refuses storage, which the element says out loud.',
    },
  },
  args: { equipment: FULL_RACK, open: true, remembers: true },
  render: (args) => html`
    <ptk-equipment-setup
      .equipment=${args.equipment}
      ?open=${args.open}
      ?remembers=${args.remembers}
    ></ptk-equipment-setup>
  `,
};

export default meta;

type Story = StoryObj<PtkEquipmentSetup>;

/** Everything answered and open, which is the state a story is for. */
export const Open: Story = {};

/**
 * How it actually arrives.
 *
 * The summary line has to carry the whole of what the ramp assumed -- plate
 * unit, bar, collars -- because a lifter who never opens this section is still
 * entitled to know whether the numbers below were worked out for their bar.
 */
export const Folded: Story = {
  args: { open: false },
};

/**
 * A rack with limits on it. Pair counts and the full-diameter switches are the
 * two things that change what the ramp is allowed to build, and both live
 * inside the plate details fold.
 */
export const LimitedRack: Story = {
  args: { equipment: HOME_RACK },
};

/**
 * A bar the presets do not cover, carrying its own unit.
 *
 * The unit is separate from the plate unit on purpose: converting it would drift
 * a 20 kg bar to 20.0002 kg over two flicks, and re-labelling it would turn a
 * 20 kg bar into a 20 lb one.
 */
export const CustomBar: Story = {
  args: { equipment: { ...FULL_RACK, barId: CUSTOM_BAR_ID } },
};

/**
 * Kilogram plates, which are a different set of denominations rather than a label.
 *
 * The bar moves with them. A kilogram rack on a 45 lb bar is a real thing a
 * lifter can describe and a poor thing to open a story on, since the summary
 * line then reads as a mistake rather than as a configuration.
 */
export const KilogramPlates: Story = {
  args: {
    equipment: {
      ...FULL_RACK,
      plateUnit: 'kg',
      barId: 'olympic-20',
      customBar: { amount: 20, unit: 'kg' },
      collarId: 'competition',
    },
  },
};

/**
 * A bar that is neither 45 lb nor a 15 kg women's bar.
 *
 * Before this the only way to say so was the custom box. It is here as a story
 * because the preset list is the one part of this screen a lifter scans rather
 * than reads, and a bar that is not on it is a bar they conclude is unsupported.
 */
export const TrainingBar: Story = {
  args: { equipment: { ...FULL_RACK, barId: 'training-22' } },
};

/**
 * Every fractional plate on the rack, which is how the tool arrives.
 *
 * The switch above the chips is a shortcut past four taps and never a mode --
 * so this state and the two below it are all reachable by the chips alone, and
 * the switch only ever reports what they say.
 */
export const AllFractionalPlates: Story = {};

/**
 * The bag with one plate lost out of it.
 *
 * The master switch cannot describe this rack with a tick or a blank, and
 * drawing it as either is a lie about what is on the rack. Indeterminate is the
 * third state the platform has for exactly this, and it is the only one of the
 * three that cannot be checked by reading the code.
 */
export const SomeFractionalPlates: Story = {
  args: { equipment: PART_MICRO },
};

/** A rack with nothing small on it, so the ramp's last step is a long one. */
export const NoFractionalPlates: Story = {
  args: { equipment: HOME_RACK },
};

/**
 * A private window, or an embedder that blocked storage.
 *
 * Said plainly rather than hidden: a lifter who sets a rack up and comes back to
 * the defaults deserves to have been warned, and the store knows before anything
 * is typed.
 */
export const NotRemembering: Story = {
  args: { remembers: false },
};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting,
 * because the element keys its layout to its own width. This stands in for an
 * embed column as much as for a handset.
 */
export const Narrow: Story = {
  args: { equipment: { ...HOME_RACK, barId: CUSTOM_BAR_ID } },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-equipment-setup
        .equipment=${args.equipment}
        ?open=${args.open}
        ?remembers=${args.remembers}
      ></ptk-equipment-setup>
    </div>
  `,
};
