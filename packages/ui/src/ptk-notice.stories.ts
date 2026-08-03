// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';
import type { PtkNotice } from '@platform-toolkit/ui';

/**
 * The sentence a tool says instead of showing content.
 *
 * Three of the four things a data-backed screen can say are one of these, and
 * the point of the pair below is that they must not look the same: "loading"
 * and "could not be loaded" were both rendered in the same muted grey before
 * this element existed, which is a real difference to a reader.
 */

interface Args {
  readonly tone: PtkNotice['tone'];
  readonly text: string;
}

const meta: Meta<Args> = {
  title: 'Shared/Notice',
  component: 'ptk-notice',
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['info', 'error'],
      description: 'How much of a problem this is.',
    },
    text: { control: 'text' },
  },
  args: { tone: 'info', text: 'Loading this federation’s categories…' },
  render: (args) => html`<ptk-notice tone=${args.tone}>${args.text}</ptk-notice>`,
};

export default meta;

type Story = StoryObj<Args>;

/** Something is happening. The ordinary case, and the least alarming wording. */
export const Loading: Story = {};

/**
 * Nothing is published for this yet. Deliberately **not** the error tone: the
 * read succeeded, and a reload will not change the answer.
 */
export const NotPublished: Story = {
  args: { text: 'This federation’s categories have not been published yet.' },
};

/**
 * The read failed, and a reload might fix it -- which is the one difference
 * that earns the second tone.
 */
export const Failed: Story = {
  args: {
    tone: 'error',
    text: 'The published categories could not be loaded. Reload the page to try again.',
  },
};

/**
 * The two side by side, which is the only way to check that the distinction
 * survives -- each on its own looks fine.
 */
export const BothTones: Story = {
  render: () => html`
    <div style="display: grid; gap: 1rem;">
      <ptk-notice>Loading the standards for this category…</ptk-notice>
      <ptk-notice tone="error">
        The published standards could not be loaded. Reload the page to try again.
      </ptk-notice>
    </div>
  `,
};

/**
 * A phone-width column. A failure message is the longest thing these elements
 * ever hold, so it is the one that has to wrap rather than push the page
 * sideways.
 */
export const Narrow: Story = {
  args: {
    tone: 'error',
    text: 'The published classification standards could not be loaded. Reload the page to try again.',
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-notice tone=${args.tone}>${args.text}</ptk-notice>
    </div>
  `,
};
