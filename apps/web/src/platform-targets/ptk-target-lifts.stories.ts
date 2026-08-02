import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkTargetLifts } from './ptk-target-lifts.js';
import './ptk-target-lifts.js';

/**
 * The optional lift entry, folded out of the way.
 *
 * This element takes no properties, and that is the thing the stories are here
 * to show rather than a gap in them. The four fields and the unit belong to the
 * panel: it owns what is typed and announces every change, so a story -- or a
 * page, or a test -- mounts a panel that works rather than a controlled shell
 * that goes inert without a parent to feed it. The consequence is that its
 * states are reached by typing, so open the fold and use it.
 *
 * What to check while you are in here, because none of it is visible folded:
 *
 * - The summary states the whole of what is true while closed (§5.8). Type a
 *   squat, fold it, and the figure is named in the summary -- a fold that hid
 *   which numbers the report was drawn against would be how somebody reads a
 *   report marked up by a mistyped bench.
 * - Switching the unit converts what is there; it never rereads it. 405 lb
 *   stays the weight that was lifted rather than becoming 405 kg.
 * - Typing three lifts fills the total, in the field, in the chosen unit.
 * - `1o5` is an error on the field it was typed in and is left out of the
 *   summary, because naming a rejected value among what was entered would say
 *   it counted.
 */

const meta: Meta<PtkTargetLifts> = {
  title: 'Platform Targets/Lift entry',
  component: 'ptk-target-lifts',
  tags: ['autodocs'],
  render: () => html`<ptk-target-lifts></ptk-target-lifts>`,
};

export default meta;

type Story = StoryObj<PtkTargetLifts>;

/**
 * How a lifter meets it: closed, with a summary saying nothing is entered.
 *
 * Requirement 11 in the user's own words -- the panel "is currently
 * distracting", so it is put out of the way and the report above is complete
 * without it. Folded is the state that matters most here, because it is the one
 * every visitor sees and the one that has to be honest about what it is hiding.
 */
export const Folded: Story = {};

/**
 * A phone-width column, constrained by a wrapper rather than a viewport setting.
 * The field grid keys off this element's own width, so the wrapper is the
 * constraint it responds to -- and it stands in for a narrow embed column as
 * well as a handset. Open the fold: four fields in one column is the layout the
 * grid collapses to, and the fields must stay tappable and never zoom on focus.
 */
export const Narrow: Story = {
  render: () => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-target-lifts></ptk-target-lifts>
    </div>
  `,
};
