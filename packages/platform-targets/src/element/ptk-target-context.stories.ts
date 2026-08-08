// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkTargetContext } from './ptk-target-context.js';
import { ANSWERED, CATALOG, FULLY_ANSWERED } from '../core/records.fixture.js';
import { definePlatformTargets } from '@platform-toolkit/platform-targets/element';

// The registry is written once, explicitly. See the note in the composite root's stories.
definePlatformTargets();

/**
 * The answered context, collapsed to the two lines that replaced the form.
 *
 * These stories are here to be *looked at* rather than to prove behaviour: the
 * element does one thing and its browser test covers it. What cannot be asserted
 * in a test is whether two lines still read as a summary once they carry
 * everything a lifter may have answered, and that is exactly what the review
 * measured the old screen for. So the set below is graded by how much is in it --
 * the minimum required answers, then every optional one as well, then a
 * federation whose labels are long enough to wrap.
 *
 * Both fixtures are invented (§5.1). Nothing that ships imports them.
 */

const meta: Meta<PtkTargetContext> = {
  title: 'Platform Targets/Context summary',
  component: 'ptk-target-context',
  tags: ['autodocs'],
  argTypes: {
    catalog: { control: 'object' },
    selection: { control: 'object' },
  },
  args: { catalog: CATALOG, selection: ANSWERED },
  render: (args) => html`
    <ptk-target-context .catalog=${args.catalog} .selection=${args.selection}></ptk-target-context>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetContext>;

/**
 * The four required answers and nothing else.
 *
 * The second line still says "Open only" rather than falling silent. An
 * unanswered division picker is a real state with a real consequence -- the
 * report draws one row -- and a summary that omitted it would leave the lifter
 * to infer it from the absence.
 */
export const RequiredAnswersOnly: Story = {};

/**
 * Every optional answer given: a comparison class, an age division and a state.
 *
 * This is the widest the second line gets, and the reason the classes are joined
 * with "and" instead of the middle dot -- they are one answer about a comparison,
 * not two answers in a list.
 */
export const EverythingAnswered: Story = {
  args: { selection: FULLY_ANSWERED },
};

/**
 * A federation whose labels do not fit.
 *
 * The line wraps within itself and the "Edit" affordance stays on the row, which
 * is what the grid column in the styles is for; the failure it prevents is the
 * action sliding off the end of a 320 px screen where nothing may scroll
 * sideways (§5.7).
 */
export const LongLabels: Story = {
  args: {
    catalog: {
      ...CATALOG,
      equipment: [{ id: 'raw', label: 'Raw with wraps permitted (classic)' }],
      ageDivisions: {
        ...CATALOG.ageDivisions,
        divisions: CATALOG.ageDivisions.divisions.map((division) =>
          division.id === 'masters-1'
            ? { ...division, label: 'Masters 1 (forty to forty-nine years)' }
            : division,
        ),
      },
    },
    selection: FULLY_ANSWERED,
  },
};

/**
 * No catalogue.
 *
 * The element renders nothing at all -- not an empty summary, and not a button
 * that would open a screen of questions with no answers to offer. Storied
 * because "renders nothing" is a decision and this is the only place it is
 * visible; `smoke-stories.mjs` would reject a story whose whole output is empty,
 * so the wrapper below gives it a sentence and says why it is there.
 */
export const NoCatalogue: Story = {
  render: () => html`
    <p>The element below is mounted with no catalogue and deliberately draws nothing.</p>
    <ptk-target-context .catalog=${null} .selection=${ANSWERED}></ptk-target-context>
  `,
};
