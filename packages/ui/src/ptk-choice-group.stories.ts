// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Choice, PtkChoiceGroup } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry, not the relative path beside this file, even though
// the file is right there. A custom element may be defined once per registry and
// the two spellings are two modules: anything reaching this element as
// `@platform-toolkit/ui` -- the preview's theme import does -- loads the built
// copy, so a relative import here would load the source copy and define the tag a
// second time. The registry throws, and the story still looks correct, because
// the first definition already won. The only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * The states worth documenting are the ones a working page never shows.
 *
 * A screenshot of a filled-in question tells a reader nothing they could not
 * guess. What they cannot guess is what happens when the list is empty, when the
 * current value is not among the options, or when the group is disabled --
 * and each of those is a real state a tool puts this element into.
 */

/** Invented figures. Real boundaries belong in published data. */
const WEIGHT_CLASSES: readonly Choice[] = [
  { value: 'f-52', label: '52 kg', description: 'Up to 52.0 kg' },
  { value: 'f-56', label: '56 kg', description: 'Over 52.0 to 56.0 kg' },
  { value: 'f-60', label: '60 kg', description: 'Over 56.0 to 60.0 kg' },
  { value: 'f-plus', label: '60+ kg', description: 'Over 60.0 kg' },
];

const meta: Meta<PtkChoiceGroup> = {
  title: 'Shared/Choice group',
  component: 'ptk-choice-group',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the group’s accessible name.' },
    value: { control: 'text', description: 'The chosen value, or null.' },
    emptyMessage: { control: 'text', description: 'Shown in place of the options when empty.' },
    disabled: { control: 'boolean' },
    choices: { control: 'object' },
  },
  args: {
    label: 'Weight class',
    choices: WEIGHT_CLASSES,
    value: null,
    emptyMessage: 'No options available.',
    disabled: false,
  },
  render: (args) => html`
    <ptk-choice-group
      .label=${args.label}
      .choices=${args.choices}
      .value=${args.value}
      empty-message=${args.emptyMessage}
      ?disabled=${args.disabled}
    ></ptk-choice-group>
  `,
};

export default meta;

type Story = StoryObj<PtkChoiceGroup>;

export const Unanswered: Story = {};

export const Answered: Story = {
  args: { value: 'f-56' },
};

/**
 * Options with no second line. The element must not reserve space for a
 * description that is not there, or a group of plain options sits unevenly
 * beside one that has them.
 */
export const WithoutDescriptions: Story = {
  args: {
    label: 'Equipment',
    choices: [
      { value: 'raw', label: 'Raw' },
      { value: 'single-ply', label: 'Single-ply' },
    ],
    value: 'raw',
  },
};

/**
 * A question that cannot be answered yet, because it depends on one that has
 * not been. The message is the caller's, since only the caller knows why.
 */
export const NothingToChooseFrom: Story = {
  args: {
    choices: [],
    emptyMessage: 'Choose a sex category to see its weight classes.',
  },
};

/**
 * The value is not among the choices, so nothing is selected.
 *
 * This is the case that makes the element safe to reuse across federations.
 * Snapping to the nearest class would put a number on screen that the lifter
 * never chose and would then plan against.
 */
export const ValueNotOffered: Story = {
  args: { value: 'a-class-this-federation-does-not-publish' },
};

/**
 * Disabled by the tool while something it depends on is loading.
 *
 * Note that a disabled `<fieldset>` does not set `disabled` on its inputs; the
 * browser applies `:disabled` to them anyway. Anything asserting on this state
 * has to match the pseudo-class, not the property.
 */
export const Disabled: Story = {
  args: { value: 'f-56', disabled: true },
};

/**
 * The width a phone actually gives this element.
 *
 * Constrained by the wrapper rather than by a viewport setting, because that is
 * the constraint the element responds to: the option grid counts columns
 * against its own width, so a widget in a narrow sidebar on a wide page is in
 * the same situation as one on a phone. Reviewing at desktop width is how a
 * layout that only works there gets shipped.
 *
 * Twelve options because two is not a test of a wrapping grid.
 */
export const Narrow: Story = {
  args: {
    choices: [
      ...WEIGHT_CLASSES,
      { value: 'x-1', label: '67.5 kg', description: 'Over 60.0 to 67.5 kg' },
      { value: 'x-2', label: '75 kg', description: 'Over 67.5 to 75.0 kg' },
    ],
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-choice-group
        .label=${args.label}
        .choices=${args.choices}
        .value=${args.value}
        empty-message=${args.emptyMessage}
        ?disabled=${args.disabled}
      ></ptk-choice-group>
    </div>
  `,
};

/**
 * The same width with plain options, which take a narrower track.
 *
 * Worth its own story: the two grids have different column counts on purpose,
 * and a change that collapsed them to one would look right in whichever of the
 * two was reviewed.
 */
export const NarrowWithoutDescriptions: Story = {
  args: {
    label: 'Weight class',
    choices: WEIGHT_CLASSES.map(({ value, label }) => ({ value, label })),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-choice-group
        .label=${args.label}
        .choices=${args.choices}
        .value=${args.value}
        empty-message=${args.emptyMessage}
        ?disabled=${args.disabled}
      ></ptk-choice-group>
    </div>
  `,
};
