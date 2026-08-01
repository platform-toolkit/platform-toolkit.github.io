import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import '@platform-toolkit/ui';

/**
 * Copying a number without retyping it.
 *
 * Every tool here ends in a figure somebody has to move somewhere else -- an
 * attempt card, a message to a coach, a registration form -- and retyping is where
 * a transposed digit comes from.
 *
 * The state worth looking at is the last one. The clipboard is the one API in this
 * collection that routinely refuses: it is absent outside a secure context and
 * gated by a permission the *embedding* page controls, so a widget that copies
 * perfectly on its own site can be dropped into somebody's article and never copy
 * again. That refusal is shown rather than swallowed, because a button that
 * silently does nothing is indistinguishable from one that worked.
 */

const meta: Meta = {
  title: 'Shared/Copy button',
  component: 'ptk-copy-button',
  tags: ['autodocs'],
  render: () => html`<ptk-copy-button text="183.7 kg"></ptk-copy-button>`,
};

export default meta;

type Story = StoryObj;

/** Before anything has been copied. The live region is present and empty. */
export const Idle: Story = {};

/** Named for its row, because a chart screen holds one of these per line. */
export const Named: Story = {
  render: () => html`
    <ptk-copy-button
      text="183.7 kg"
      label="Copy"
      accessible-name="Copy 183.7 kilograms"
    ></ptk-copy-button>
  `,
};

/**
 * A quiet copy control beside a value, which is how the chart rows use it.
 *
 * Note the label is a word and not a glyph. An icon-only copy button is the
 * standard pattern and it is the wrong one here: chalk, a phone at arm's length,
 * and a row of identical small squares.
 */
export const BesideAValue: Story = {
  render: () => html`
    <div style="display: flex; align-items: center; gap: 0.75rem;">
      <strong>183.7 kg</strong>
      <ptk-copy-button
        variant="quiet"
        text="183.7 kg"
        accessible-name="Copy 183.7 kilograms"
      ></ptk-copy-button>
    </div>
  `,
};

/** Nothing to copy yet -- an empty field above, or a chart that did not load. */
export const Disabled: Story = {
  render: () => html`<ptk-copy-button text="" disabled></ptk-copy-button>`,
};

/**
 * A phone-width column with a long label.
 *
 * The confirmation wraps under the button rather than pushing the column sideways,
 * which is what an inline row would do at 320 pixels.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 320px; outline: 1px dashed currentColor; padding: 0.5rem;">
      <ptk-copy-button
        text="183.7 kg"
        label="Copy the chart value"
        error-label="Copying is blocked here. Select the value to copy it."
      ></ptk-copy-button>
    </div>
  `,
};
