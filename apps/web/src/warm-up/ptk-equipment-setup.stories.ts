// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { CUSTOM_BAR_ID, DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import type { PtkEquipmentSetup } from './ptk-equipment-setup.js';
import './ptk-equipment-setup.js';

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

/** A commercial gym: everything, no limits. */
const FULL_RACK: Equipment = DEFAULT_EQUIPMENT;

/** A home rack: two denominations, one of them nearly gone. */
const HOME_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    kg: [
      { weight: 25, pairs: 1, fullDiameter: true },
      { weight: 10, pairs: 2, fullDiameter: false },
      { weight: 2.5, pairs: 1, fullDiameter: false },
    ],
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

/** Pound plates, which are a different set of denominations rather than a label. */
export const PoundPlates: Story = {
  args: { equipment: { ...FULL_RACK, plateUnit: 'lb', collarId: 'competition' } },
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
