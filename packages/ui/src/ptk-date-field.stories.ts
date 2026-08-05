// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { PtkDateField } from '@platform-toolkit/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

// Through the package entry rather than the relative path beside this file. The
// two spellings are two modules, and a custom element may only be defined once
// per registry -- the second definition throws while the story still renders
// correctly off the first, so the only symptom is a console error.
import '@platform-toolkit/ui';

/**
 * One calendar day somebody picks.
 *
 * The states worth looking at are not "a date is in it". They are the bounded
 * picker, which is the reason this is a native control rather than three selects;
 * the field a tool is refusing; and whether the box actually fills a 320px column,
 * which it does not do by default on the platform this collection is designed for
 * first.
 */

const meta: Meta<PtkDateField> = {
  title: 'Shared/Date field',
  component: 'ptk-date-field',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text', description: 'The question. Becomes the accessible name.' },
    value: { control: 'text', description: 'The chosen day as YYYY-MM-DD, or empty.' },
    min: { control: 'text', description: 'Earliest day the picker offers. Empty for no floor.' },
    max: { control: 'text', description: 'Latest day the picker offers. Empty for no ceiling.' },
    hint: { control: 'text', description: 'A standing note. Not a validation message.' },
    error: { control: 'text', description: 'What is wrong with the value, or empty.' },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Date of the meet',
    value: '',
    min: '',
    max: '',
    hint: '',
    error: '',
    disabled: false,
  },
  render: (args) => html`
    <ptk-date-field
      .label=${args.label}
      .value=${args.value}
      .min=${args.min}
      .max=${args.max}
      .hint=${args.hint}
      .error=${args.error}
      ?disabled=${args.disabled}
    ></ptk-date-field>
  `,
};

export default meta;

type Story = StoryObj<PtkDateField>;

/** Nothing picked. How every one of these starts. */
export const Empty: Story = {};

/**
 * A day chosen.
 *
 * Invented, like every date in this repository's fixtures: a real qualifying
 * window would date the story and read as a claim about a meet.
 */
export const Picked: Story = {
  args: { value: '2026-03-14' },
};

/**
 * The picker held to a range.
 *
 * The reason this wraps a native control. The platform greys out everything
 * outside the window in its own calendar, on its own locale ordering, with a
 * keyboard path that already works -- none of which three selects would give, and
 * all nine of whose tap targets would be answering one question.
 */
export const WithinAWindow: Story = {
  args: {
    label: 'Result set on',
    min: '2025-01-01',
    max: '2026-04-26',
    hint: 'The meet accepts totals set between 1 January 2025 and 26 April 2026.',
  },
};

/**
 * A tool refusing what was picked.
 *
 * Paired with `aria-invalid` and not announced: this validates on every change,
 * and a live region would read a half-entered date as an error each time.
 */
export const Invalid: Story = {
  args: {
    value: '2026-04-02',
    error: 'A window has to start before it ends.',
  },
};

/** Disabled by the tool once the answer can no longer change. */
export const Disabled: Story = {
  args: { value: '2026-03-14', disabled: true },
};

/**
 * The width a phone actually gives this element.
 *
 * Three declarations are on trial here and all three fail invisibly. Without
 * `width: 100%` the field keeps a date input's intrinsic width -- 172px -- and
 * sits as a short box inside the dashed frame; without the local `box-sizing` its
 * padding lands outside the hundred percent and it sits wider than the frame. The
 * third is `appearance: none`, and this story is the only place it can be seen at
 * all: it changes nothing on a desktop engine and is what stops iOS Safari
 * ignoring the width entirely, so open this one on a phone.
 */
export const Narrow: Story = {
  args: { value: '2026-03-14', hint: 'The day you competed.' },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 1rem;">
      <ptk-date-field
        .label=${args.label}
        .value=${args.value}
        .min=${args.min}
        .max=${args.max}
        .hint=${args.hint}
        .error=${args.error}
        ?disabled=${args.disabled}
      ></ptk-date-field>
    </div>
  `,
};
