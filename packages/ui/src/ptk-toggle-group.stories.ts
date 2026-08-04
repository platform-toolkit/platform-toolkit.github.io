// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';
import type { Choice } from './ptk-choice-group.js';
import type { ToggleGroupLayout } from './ptk-toggle-group.js';

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
  readonly layout: ToggleGroupLayout;
}

const meta: Meta<Args> = {
  title: 'Shared/Toggle group',
  component: 'ptk-toggle-group',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    emptyMessage: { control: 'text' },
    disabled: { control: 'boolean' },
    layout: { control: 'inline-radio', options: ['tiles', 'list'] },
  },
  args: {
    label: 'Plates on the rack',
    choices: PLATES,
    values: ['25', '20', '10', '5', '2.5', '1.25'],
    emptyMessage: 'No options available.',
    disabled: false,
    layout: 'tiles',
  },
  render: (args) => html`
    <ptk-toggle-group
      label=${args.label}
      .choices=${args.choices}
      .values=${args.values}
      empty-message=${args.emptyMessage}
      ?disabled=${args.disabled}
      layout=${args.layout}
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
 * Sentence-length answers, which is what the list layout exists for.
 *
 * Tool 5's meet-day checklist. In the tile grid each of these is four wrapped
 * lines in a 5.5rem track beside a checkbox, and a grid of those is unreadable
 * however tall the cells are — so the rows run full width, and a description on
 * one of them does not widen the track the way it would on a tile.
 */
export const AsAList: Story = {
  args: {
    label: 'Bring',
    layout: 'list',
    choices: [
      { value: 'membership', label: 'Membership card and photo identification' },
      { value: 'singlet', label: 'Singlet' },
      { value: 'shirt', label: 'Approved shirt' },
      { value: 'belt', label: 'Belt' },
      { value: 'attempts', label: 'Attempt plan written in kilograms' },
    ],
    values: ['singlet', 'belt'],
  },
};

/**
 * The same rows on a phone.
 *
 * Nothing about the list layout changes with width — that is the point of it —
 * so what this documents is the wrap: a label two lines long keeps the checkbox
 * centred on the row rather than pinned to its first line.
 */
export const NarrowList: Story = {
  render: () => html`
    <div style="width: 288px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-toggle-group
        label="Bring"
        layout="list"
        .choices=${
          [
            { value: 'membership', label: 'Membership card and photo identification' },
            { value: 'sleeves', label: 'Knee sleeves or knee wraps' },
            { value: 'attempts', label: 'Attempt plan written in kilograms' },
          ] satisfies Choice[]
        }
        .values=${['sleeves']}
      ></ptk-toggle-group>
    </div>
  `,
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
