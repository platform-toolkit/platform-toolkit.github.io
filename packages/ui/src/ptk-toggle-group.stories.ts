import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';
import type { Choice } from './ptk-choice-group.js';

/**
 * One question with a fixed set of answers, any number of which may be chosen.
 *
 * The stories below are the states a tool puts it in rather than the filled-in
 * happy path: nothing chosen, nothing to choose from, a set held for options
 * that are not on screen, and a phone-width column.
 */

const PLATES: readonly Choice[] = [
  { value: '25', label: '25 kg' },
  { value: '20', label: '20 kg' },
  { value: '15', label: '15 kg' },
  { value: '10', label: '10 kg' },
  { value: '5', label: '5 kg' },
  { value: '2.5', label: '2.5 kg' },
  { value: '1.25', label: '1.25 kg' },
  { value: '0.5', label: '0.5 kg' },
  { value: '0.25', label: '0.25 kg' },
];

interface Args {
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly values: readonly string[];
  readonly emptyMessage: string;
  readonly disabled: boolean;
}

const meta: Meta<Args> = {
  title: 'Shared/Toggle group',
  component: 'ptk-toggle-group',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    emptyMessage: { control: 'text' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Plates on the rack',
    choices: PLATES,
    values: ['25', '20', '10', '5', '2.5', '1.25'],
    emptyMessage: 'No options available.',
    disabled: false,
  },
  render: (args) => html`
    <ptk-toggle-group
      label=${args.label}
      .choices=${args.choices}
      .values=${args.values}
      empty-message=${args.emptyMessage}
      ?disabled=${args.disabled}
    ></ptk-toggle-group>
  `,
};

export default meta;

type Story = StoryObj<Args>;

/** A typical rack: the common denominations, the fractional ones absent. */
export const Selected: Story = {};

/** Nothing chosen. A real state — a lifter clearing the list to start again. */
export const NothingChosen: Story = {
  args: { values: [] },
};

/** Second lines widen the tracks, exactly as they do in the single-choice group. */
export const Described: Story = {
  args: {
    label: 'Competition-diameter plates',
    choices: [
      { value: '25', label: '25 kg', description: '450 mm — reaches the floor' },
      { value: '20', label: '20 kg', description: '450 mm — reaches the floor' },
      { value: '15', label: '15 kg', description: 'Smaller than competition' },
    ],
    values: ['25'],
  },
};

/**
 * A value chosen that is not among the options.
 *
 * The caller is holding a pound inventory while the unit is kg. Nothing is
 * checked and nothing is discarded — dropping it would erase settings on a
 * control the lifter never touched.
 */
export const HoldsAnUnofferedValue: Story = {
  args: { values: ['45', '35'] },
};

/** No options at all, which is what a unit with no configured plates looks like. */
export const Empty: Story = {
  args: { choices: [], emptyMessage: 'No plate denominations for this unit.' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * A phone-width column.
 *
 * The intrinsic grid drops to as many columns as fit rather than overflowing;
 * the wrapper is the constraint, not a viewport setting, because the element
 * responds to its own width.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 288px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-toggle-group
        label="Plates on the rack"
        .choices=${PLATES}
        .values=${['25', '20', '10', '5', '2.5']}
      ></ptk-toggle-group>
    </div>
  `,
};
