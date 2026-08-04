// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { PtkTextField } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry rather than the relative path beside this file. The
// two spellings are two modules, and a custom element may only be defined once
// per registry -- the second definition throws while the story still renders
// correctly off the first, so the only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * One line somebody writes in their own words.
 *
 * A filled-in field tells a reader nothing they could not guess. What these
 * states are for is the rest: the empty field a tool is waiting on, the one a
 * tool is refusing, and whether the whole thing still sits inside a 320px column
 * once its padding is counted.
 *
 * The keyboard axes -- what gets capitalised and what the browser may fill in --
 * are here as stories rather than as controls only, because neither is visible in
 * a screenshot and both are wrong by default for the field beside them.
 */

const meta: Meta<PtkTextField> = {
  title: 'Shared/Text field',
  component: 'ptk-text-field',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the accessible name.' },
    value: { control: 'text', description: 'What is in the field. Never trimmed here.' },
    placeholder: { control: 'text' },
    hint: { control: 'text', description: 'A standing note. Not a validation message.' },
    error: { control: 'text', description: 'What is wrong with the value, or empty.' },
    capitalize: {
      control: 'inline-radio',
      options: ['none', 'sentences', 'words'],
      description: 'How a soft keyboard capitalises what is typed.',
    },
    autocomplete: {
      control: 'text',
      description: 'An HTML autocomplete token. Off unless the caller opts in.',
    },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Lifter',
    value: '',
    placeholder: '',
    hint: '',
    error: '',
    capitalize: 'sentences',
    autocomplete: 'off',
    disabled: false,
  },
  render: (args) => html`
    <ptk-text-field
      .label=${args.label}
      .value=${args.value}
      .placeholder=${args.placeholder}
      .hint=${args.hint}
      .error=${args.error}
      .capitalize=${args.capitalize}
      .autocomplete=${args.autocomplete}
      ?disabled=${args.disabled}
    ></ptk-text-field>
  `,
};

export default meta;

type Story = StoryObj<PtkTextField>;

export const Empty: Story = {};

export const Written: Story = {
  args: { value: 'Dana Okafor' },
};

/**
 * A note about what belongs in the field, standing regardless of its contents.
 *
 * Rendered differently from an error, because a hint that looked like a problem
 * would read as one every time the field is empty -- which is how it starts.
 */
export const WithHint: Story = {
  args: { hint: 'Shown on the submission panel, so the right weight reaches the right athlete.' },
};

/**
 * The field set up for a person's name, which is the first thing that needed it.
 *
 * Two attributes neither a screenshot nor a text assertion can see: each word
 * capitalised rather than just the first, and the browser allowed to offer the
 * name it already knows. Sentence case would put "Dana okafor" on the one panel
 * that exists to name the right athlete.
 */
export const ForAPersonsName: Story = {
  args: {
    label: 'Who is lifting',
    capitalize: 'words',
    autocomplete: 'name',
    placeholder: 'Dana Okafor',
  },
};

/**
 * A tool refusing what was typed -- here, nothing at all.
 *
 * Paired with `aria-invalid` and not announced: this validates on every
 * keystroke, and a live region would read a half-typed name as an error on each
 * one.
 */
export const Invalid: Story = {
  args: {
    value: '',
    error: 'A lifter needs a name, so the submission panel can show it.',
  },
};

/** Disabled by the tool once the answer can no longer change. */
export const Disabled: Story = {
  args: { value: 'Dana Okafor', disabled: true },
};

/**
 * The width a phone actually gives this element.
 *
 * Constrained by a wrapper rather than a viewport setting, because the wrapper
 * is the constraint the element responds to. This is the story that fails if the
 * local `box-sizing` declaration is ever removed: a universal selector in the
 * page stylesheet does not cross a shadow boundary, so the padding would land
 * outside the hundred percent and the field would sit wider than its dashed
 * frame.
 */
export const Narrow: Story = {
  args: { hint: 'As it appears on the roster.', value: 'Dana Okafor' },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-text-field
        .label=${args.label}
        .value=${args.value}
        .placeholder=${args.placeholder}
        .hint=${args.hint}
        .error=${args.error}
        .capitalize=${args.capitalize}
        .autocomplete=${args.autocomplete}
        ?disabled=${args.disabled}
      ></ptk-text-field>
    </div>
  `,
};
