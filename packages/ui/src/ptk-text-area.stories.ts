// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { PtkTextArea } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry rather than the relative path beside this file. The
// two spellings are two modules, and a custom element may only be defined once
// per registry -- the second definition throws while the story still renders
// correctly off the first, so the only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * Several lines somebody writes in their own words.
 *
 * The filled-in box tells a reader nothing they could not guess. What these
 * states are for is the rest: how tall it starts, what it does with more text
 * than fits, and whether it still sits inside a 320px column once its padding is
 * counted -- which is the one thing a textarea gets wrong by default.
 */

const meta: Meta<PtkTextArea> = {
  title: 'Shared/Text area',
  component: 'ptk-text-area',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the accessible name.' },
    value: { control: 'text', description: 'What is in the box. A string, never trimmed here.' },
    placeholder: { control: 'text' },
    hint: { control: 'text', description: 'A standing note. Not a validation message.' },
    error: { control: 'text', description: 'What is wrong with the value, or empty.' },
    rows: { control: 'number', description: 'How tall it starts. It does not grow.' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Notes',
    value: '',
    placeholder: '',
    hint: '',
    error: '',
    rows: 3,
    disabled: false,
  },
  render: (args) => html`
    <ptk-text-area
      .label=${args.label}
      .value=${args.value}
      .placeholder=${args.placeholder}
      .hint=${args.hint}
      .error=${args.error}
      .rows=${args.rows}
      ?disabled=${args.disabled}
    ></ptk-text-area>
  `,
};

export default meta;

type Story = StoryObj<PtkTextArea>;

export const Empty: Story = {};

export const Written: Story = {
  args: { value: 'Head referee called the press before the bar had settled.' },
};

/**
 * A note about what belongs in the box, standing regardless of its contents.
 *
 * Rendered differently from an error, because a hint that looked like a problem
 * would read as one every time the box is empty -- and this box is optional
 * wherever it appears, so empty is its normal state.
 */
export const WithHint: Story = {
  args: { hint: 'Optional. Nothing here leaves your device.' },
};

/**
 * More text than the box is tall.
 *
 * The state that proves it scrolls rather than growing: an auto-sizing box would
 * move everything below it on the keystroke that wrapped the line, and on the
 * screen this was built for the thing below is the button that records a result.
 */
export const Overflowing: Story = {
  args: {
    value:
      'Left light red, other two white. The head referee said the press command came ' +
      'while the bar was still moving, and to wait for it next time. Bar felt light off ' +
      'the chest. Second attempt is going up regardless of what the sheet says.',
  },
};

/** A tool refusing what was typed. Paired with `aria-invalid`, not announced. */
export const Invalid: Story = {
  args: {
    value: 'x'.repeat(40),
    error: 'That is longer than the meet sheet will carry. Shorten it.',
  },
};

/** One line, for a box that holds a sentence rather than a paragraph. */
export const SingleRow: Story = {
  args: { label: 'What the referees said', rows: 1, value: 'Depth.' },
};

/** Disabled by the tool while the thing the note is about is still settling. */
export const Disabled: Story = {
  args: { value: 'Recorded already.', disabled: true },
};

/**
 * The width a phone actually gives this element.
 *
 * Constrained by a wrapper rather than a viewport setting, because the wrapper
 * is the constraint the element responds to. This is the story that fails if the
 * local `box-sizing` declaration is ever removed: a universal selector in the
 * page stylesheet does not cross a shadow boundary, so the padding would land
 * outside the hundred percent and the box would sit wider than its dashed frame.
 */
export const Narrow: Story = {
  args: { hint: 'Optional.', value: 'Bar drifted forward out of the hole.' },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-text-area
        .label=${args.label}
        .value=${args.value}
        .placeholder=${args.placeholder}
        .hint=${args.hint}
        .error=${args.error}
        .rows=${args.rows}
        ?disabled=${args.disabled}
      ></ptk-text-area>
    </div>
  `,
};
