// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import type { PtkLiftCard } from './ptk-lift-card.js';
import './ptk-lift-card.js';
import { markKey, type Completion, type LiftEntry } from './session.js';

/**
 * One lift, and the ramp to get to it.
 *
 * This is the screen a lifter looks at between sets, and the card owns nothing:
 * the entry, the rack and the set of ticks all arrive as properties, which is
 * exactly what makes every state below reachable with no session, no storage and
 * no network. The states that matter are the awkward ones -- a weight the plates
 * cannot build, a rack with nothing on it, a half-typed number -- because those
 * are what a real gym produces and none of them are reachable by filling the
 * form in correctly.
 *
 * Every weight here is invented.
 */

/** A squat, planned but not yet loaded. */
const SQUAT: LiftEntry = {
  key: 'squat',
  liftId: 'squat',
  name: 'Squat',
  family: 'squat-press',
  barId: '',
  weight: '140',
  sets: '3',
  reps: '5',
};

/** A rack holding one denomination, which is what makes a weight unbuildable. */
const COARSE_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    kg: [{ weight: 25, pairs: null, fullDiameter: true }],
  },
};

/** Nothing selected at all. Every set is the bar on its own, and it says so. */
const BARE_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: { ...DEFAULT_EQUIPMENT.inventory, kg: [] },
};

const meta: Meta<PtkLiftCard> = {
  title: 'Warm-up/Lift card',
  component: 'ptk-lift-card',
  tags: ['autodocs'],
  argTypes: {
    entry: { control: 'object' },
    equipment: { control: 'object' },
    completion: { control: false, description: 'Which sets have been ticked off.' },
    first: { control: 'boolean', description: 'Disables the "move earlier" control.' },
    last: { control: 'boolean', description: 'Disables the "move later" control.' },
  },
  args: {
    entry: SQUAT,
    equipment: DEFAULT_EQUIPMENT,
    completion: new Set<string>(),
    first: false,
    last: false,
  },
  render: (args) => html`
    <ptk-lift-card
      .entry=${args.entry}
      .equipment=${args.equipment}
      .completion=${args.completion}
      ?first=${args.first}
      ?last=${args.last}
    ></ptk-lift-card>
  `,
};

export default meta;

type Story = StoryObj<PtkLiftCard>;

/** A full ramp, nothing done yet. */
export const FullRamp: Story = {};

/**
 * Part-way through the ramp.
 *
 * A done row is dimmed and struck through and stays exactly where it was. A list
 * that shortens as it is ticked moves the next row up under a thumb that is
 * still travelling, and a lifter who ticked the wrong one has to be able to find
 * it again.
 */
export const PartlyTicked: Story = {
  args: {
    completion: new Set([markKey(SQUAT.key, 0), markKey(SQUAT.key, 1)]) satisfies Completion,
  },
};

/**
 * How a card arrives: named, with the programme's default sets and reps, and no
 * weight. This is not an error, so it does not read like one -- the sentence
 * asks for a weight rather than complaining about its absence.
 */
export const NothingTyped: Story = {
  args: { entry: { ...SQUAT, weight: '' } },
};

/**
 * A weight that is not a number.
 *
 * The field says what is wrong with it and the plan area says to look up there.
 * Getting this pair wrong is easy and invisible: the planner cannot tell an
 * empty field from `1o5`, so a card that leans on the planner alone tells a
 * lifter who has plainly typed something to enter a weight.
 */
export const UnreadableWeight: Story = {
  args: { entry: { ...SQUAT, weight: '1o5' } },
};

/**
 * A working weight the plates cannot build.
 *
 * Warned about and offered with both neighbours, never silently moved. Rounding
 * a lifter's stated weight without telling them is how a session drifts.
 */
export const WorkingWeightNotLoadable: Story = {
  args: { entry: { ...SQUAT, weight: '100' }, equipment: COARSE_RACK },
};

/** No plates selected, so the whole ramp is the empty bar and the card says why. */
export const NoPlatesAtAll: Story = {
  args: { equipment: BARE_RACK },
};

/** A working weight at or under the bar, which leaves nothing to warm up to. */
export const LighterThanTheBar: Story = {
  args: { entry: { ...SQUAT, name: 'Overhead press', weight: '15' } },
};

/** The only lift on the list: both move controls unavailable rather than absent. */
export const OnlyLiftOnTheList: Story = {
  args: { first: true, last: true },
};

/**
 * A phone-width column, which is where this card is actually read. The tick
 * targets stay a full row wide and a thumb tall at this size; that is the
 * requirement the whole layout is built around.
 */
export const Narrow: Story = {
  args: {
    completion: new Set([markKey(SQUAT.key, 0)]) satisfies Completion,
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-lift-card
        .entry=${args.entry}
        .equipment=${args.equipment}
        .completion=${args.completion}
        ?first=${args.first}
        ?last=${args.last}
      ></ptk-lift-card>
    </div>
  `,
};
