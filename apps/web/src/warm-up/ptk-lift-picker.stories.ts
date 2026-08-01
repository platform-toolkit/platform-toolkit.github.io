import { PRIMARY_LIFTS } from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkLiftPicker } from './ptk-lift-picker.js';
import './ptk-lift-picker.js';

/**
 * Choosing what today's session is.
 *
 * The picker reports an identifier and knows nothing else: whether a lift is
 * already on the list arrives as a property, because the tool owns the list. So
 * the state worth looking at is not "the catalogue" -- it is what the catalogue
 * looks like once some of it has been used, which is what a lifter sees on every
 * visit after the first.
 */

const CHOSEN_IDS = PRIMARY_LIFTS.map((lift) => lift.id);

const meta: Meta<PtkLiftPicker> = {
  title: 'Warm-up/Lift picker',
  component: 'ptk-lift-picker',
  tags: ['autodocs'],
  argTypes: {
    chosen: {
      control: 'object',
      description: 'Lift identifiers already on the session list, which cannot be added twice.',
    },
  },
  args: { chosen: [] },
  render: (args) => html`<ptk-lift-picker .chosen=${args.chosen}></ptk-lift-picker>`,
};

export default meta;

type Story = StoryObj<PtkLiftPicker>;

/** A fresh session: the pinned lifts in the open, the rest a search away. */
export const Empty: Story = {};

/**
 * Part-way through building a session.
 *
 * An added lift stays visible and goes disabled rather than disappearing. A
 * button that vanishes under a thumb moves whatever was below it up into the
 * finger that is still coming down -- and a lifter scanning for "squat" needs to
 * find it and see that it is handled, not fail to find it and wonder.
 */
export const SomeAlreadyAdded: Story = {
  args: { chosen: CHOSEN_IDS.slice(0, 2) },
};

/** Every pinned lift used. The accessible name changes with the state, not just the styling. */
export const EverythingPinnedAdded: Story = {
  args: { chosen: CHOSEN_IDS },
};

/**
 * A phone-width column. The catalogue is the widest thing in this tool and the
 * first place a fixed track minimum would push a button off the screen.
 */
export const Narrow: Story = {
  args: { chosen: CHOSEN_IDS.slice(0, 1) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-lift-picker .chosen=${args.chosen}></ptk-lift-picker>
    </div>
  `,
};
