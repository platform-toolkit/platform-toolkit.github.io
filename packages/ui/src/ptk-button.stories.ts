import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';
import type { PtkButton } from '@platform-toolkit/ui';

/**
 * The button every tool uses.
 *
 * It exists as an element rather than a class because the site's stylesheet does
 * not cross a shadow boundary, so a `.button` rule reaches the hub and nothing
 * inside any tool. The three variants below are the whole vocabulary: one action
 * a screen exists for, the ordinary ones, and the chrome-level ones on a row.
 */

interface Args {
  readonly variant: PtkButton['variant'];
  readonly disabled: boolean;
  readonly label: string;
}

const meta: Meta<Args> = {
  title: 'Shared/Button',
  component: 'ptk-button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'quiet'],
      description: 'How much attention the action deserves.',
    },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
  args: { variant: 'secondary', disabled: false, label: 'Edit equipment' },
  render: (args) => html`
    <ptk-button variant=${args.variant} ?disabled=${args.disabled}>${args.label}</ptk-button>
  `,
};

export default meta;

type Story = StoryObj<Args>;

/** The ordinary action: edit, add, reset. */
export const Secondary: Story = {};

/** At most one per surface -- the thing the screen exists to do. */
export const Primary: Story = {
  args: { variant: 'primary', label: 'Add this lift' },
};

/**
 * Chrome on a row: remove, reorder, dismiss. Underlined as well as coloured,
 * because colour alone is discarded under forced colours.
 */
export const Quiet: Story = {
  args: { variant: 'quiet', label: 'Remove' },
};

/** Dimmed by opacity rather than a muted colour, so it survives forced colours. */
export const Disabled: Story = {
  args: { disabled: true, label: 'Move earlier' },
};

/**
 * The three together at the size a thumb meets them.
 *
 * Every one of them is at least 44 pixels tall, including the quiet variant that
 * looks like a link -- that is the failure this element was extracted to stop.
 */
export const EveryVariant: Story = {
  render: () => html`
    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
      <ptk-button variant="primary">Add this lift</ptk-button>
      <ptk-button variant="secondary">Edit equipment</ptk-button>
      <ptk-button variant="quiet">Remove</ptk-button>
    </div>
  `,
};

/**
 * A phone-width column, with a label too long for one line.
 *
 * The button grows; it must never clip the second line or push the column
 * sideways, which is what a fixed height would do.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 160px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-button variant="secondary">Reset every remembered setting</ptk-button>
    </div>
  `,
};
