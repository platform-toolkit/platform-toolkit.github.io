// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';

/**
 * A section that folds away, with a summary line that stays visible.
 *
 * The summary is the point. Folding the setup away is only safe because what a
 * lifter has to check before trusting the numbers below stays on screen when the
 * controls do not.
 */

interface Args {
  readonly label: string;
  readonly summary: string;
  readonly open: boolean;
}

const meta: Meta<Args> = {
  title: 'Shared/Disclosure',
  component: 'ptk-disclosure',
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    summary: { control: 'text' },
    open: { control: 'boolean' },
  },
  args: {
    label: 'Equipment',
    summary: 'kg plates • 20 kg bar • no collar weight',
    open: false,
  },
  render: (args) => html`
    <ptk-disclosure label=${args.label} summary=${args.summary} ?open=${args.open}>
      <p>The unit, the bar, the collars, and which plates are on the rack.</p>
    </ptk-disclosure>
  `,
};

export default meta;

type Story = StoryObj<Args>;

/** How a lifter finds it on the second visit: folded, summarised, out of the way. */
export const Closed: Story = {};

export const Open: Story = {
  args: { open: true },
};

/** A section with nothing to summarise yet. The row keeps its full tap height. */
export const NoSummary: Story = {
  args: { label: 'Add a lift', summary: '' },
};

/**
 * A phone-width column with a summary too long for one line.
 *
 * It wraps inside the row; it must never push the chevron off the end or widen
 * the column.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 288px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-disclosure label="Equipment" summary="lb plates • 65 lb safety squat bar • 5 lb collars">
        <p>The unit, the bar, the collars, and which plates are on the rack.</p>
      </ptk-disclosure>
    </div>
  `,
};
