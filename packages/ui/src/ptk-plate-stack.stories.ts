// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';

/**
 * The plates on one end of a barbell.
 *
 * Shared chrome rather than a warm-up component: it is handed a list of numbers
 * and a unit, and knows nothing about ramps or working sets. The stories below
 * are the states a tool actually puts it in -- an empty bar, an odd plate
 * nobody's table has, and a loading long enough to wrap on a phone.
 */

interface Args {
  readonly plates: readonly number[];
  readonly unit: string;
}

const meta: Meta<Args> = {
  title: 'Shared/Plate stack',
  component: 'ptk-plate-stack',
  tags: ['autodocs'],
  argTypes: {
    unit: { control: 'inline-radio', options: ['kg', 'lb'] },
  },
  args: { plates: [25, 10, 2.5], unit: 'kg' },
  render: (args) =>
    html`<ptk-plate-stack .plates=${args.plates} unit=${args.unit}></ptk-plate-stack>`,
};

export default meta;

type Story = StoryObj<Args>;

/** A hundred kilograms on a twenty-kilogram bar. */
export const Kilograms: Story = {};

/** Every kilogram denomination, in the international colour code. */
export const EveryKilogramPlate: Story = {
  args: { plates: [25, 20, 15, 10, 5, 2.5, 1.25, 1, 0.5, 0.25] },
};

/**
 * Pounds, sized by relative diameter and not colour-coded.
 *
 * Inventing a palette for pound plates would teach a lifter a convention that
 * matches nothing on the rack in front of them.
 */
export const Pounds: Story = {
  args: { plates: [45, 25, 10, 5], unit: 'lb' },
};

/** The first two sets of every squat ramp, and a state easy to forget to draw. */
export const BarOnly: Story = {
  args: { plates: [] },
};

/**
 * A denomination the colour table has no entry for.
 *
 * Drawn at a middle size rather than dropped: a plate missing from the picture
 * is the one error this element could make that a lifter would not notice.
 */
export const UnknownDenomination: Story = {
  args: { plates: [25, 1.75] },
};

/**
 * A long loading in a phone-width column.
 *
 * It wraps to a second row. That reads oddly; a diagram running off the side of
 * the screen reads as a broken page, which is the trade being made.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 288px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-plate-stack .plates=${[25, 25, 25, 20, 15, 10, 5, 2.5, 1.25]}></ptk-plate-stack>
    </div>
  `,
};
