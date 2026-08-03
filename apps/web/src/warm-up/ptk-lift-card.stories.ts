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
  adjustments: [],
};

/**
 * A rack holding one denomination, which is what makes a weight unbuildable.
 *
 * Pinned to the *pound* inventory, like every rack below. The tool defaults to
 * pounds on a 45 lb bar, so a fixture that overrides the kilogram list is a
 * fixture the element never reads: the card would draw the unlimited pound
 * defaults under a name promising a rack with one plate on it, and the story
 * would be reviewed as evidence of a state it does not show.
 */
const COARSE_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    lb: [{ weight: 45, pairs: null, fullDiameter: true }],
  },
};

/**
 * A rack that runs out rather than one that is coarse: one pair of each.
 *
 * The distinction matters for exactly one control. A coarse rack steps in
 * ninetys and can always find another step, because the search is sized from
 * the heaviest plate on it; a rack with no second pair genuinely cannot go up,
 * which is the only honest way to reach a disabled `Raise`.
 */
const SPARSE_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    lb: [
      { weight: 45, pairs: 1, fullDiameter: true },
      { weight: 25, pairs: 1, fullDiameter: true },
    ],
  },
};

/** Nothing selected at all. Every set is the bar on its own, and it says so. */
const BARE_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: { ...DEFAULT_EQUIPMENT.inventory, lb: [] },
};

/**
 * Presses the summary of the adjust fold, which is the only way it opens.
 *
 * Two shadow roots down, and pinned to `.adjust` because the card draws a second
 * disclosure above the ramp for the bar -- a bare `ptk-disclosure` selector opens
 * whichever comes first in the template, which is the wrong one and looks right.
 * `<details>` fires `toggle` asynchronously, so the wait is on the card's own
 * update rather than on the click returning.
 */
async function openAdjust(canvasElement: HTMLElement): Promise<void> {
  const card = canvasElement.querySelector('ptk-lift-card');
  if (card === null) throw new Error('No card rendered.');
  await card.updateComplete;

  const summary = card.shadowRoot
    ?.querySelector('.adjust ptk-disclosure')
    ?.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No adjust fold on this ramp.');
  summary.click();
  await card.updateComplete;
}

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

/**
 * A full ramp, nothing done yet -- and the adjust fold as it arrives, shut.
 *
 * Editing a calculated warm-up is a real thing lifters want and a rare thing they
 * do, so the whole of it is one line of summary until somebody asks. The summary
 * is not decoration: a fold reading only "Adjust the warm-up weights" would hide
 * whether the ramp above it is still the calculated one, which is the single fact
 * a lifter reading somebody else's phone needs. Here it says "Calculated
 * weights", and the stories below open it.
 */
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

/**
 * A working weight at or under the bar, which leaves nothing to warm up to.
 *
 * Also the state where the adjust fold is absent rather than empty: every set
 * is the bar itself, no set can be moved, and a fold offering to adjust nothing
 * is a control that can only disappoint whoever opens it.
 */
export const LighterThanTheBar: Story = {
  args: { entry: { ...SQUAT, name: 'Overhead press', weight: '15' } },
};

/**
 * The fold opened: a stepper pair per movable set, and nothing else.
 *
 * Steppers rather than fields, because this is used between sets on a phone. A
 * stepper cannot be mistyped, cannot name a weight the rack cannot build, and
 * does not summon a keyboard over the checklist being read -- and what counts as
 * one step is the rack's own answer, so a gym with quarter-pound plates moves in
 * quarters and one with nothing under forty-five moves in ninetys.
 *
 * The bar-only set has no row here at all. Its weight is the implement, so a
 * control for it could only refuse to move.
 */
export const AdjustFoldOpen: Story = {
  play: async ({ canvasElement }) => {
    await openAdjust(canvasElement);
  },
};

/**
 * One warm-up moved by hand, with the fold still shut.
 *
 * The count in the summary is what makes the fold safe to leave closed, and the
 * row above carries `Your weight` so the changed set is findable without
 * opening anything. Both are needed: the summary says *that* something was
 * changed, the mark says *which*, and neither answers the other's question.
 *
 * The plate change under the following set is recomputed rather than patched --
 * that is the whole reason an adjustment is arithmetic in the domain instead of
 * a number substituted into the row.
 */
export const OneWarmupAdjusted: Story = {
  args: {
    entry: { ...SQUAT, adjustments: [{ index: 2, total: 102.5 }] },
  },
};

/**
 * The same adjusted ramp with the fold open, where the way back is.
 *
 * "Use the calculated weights" is enabled only once something has been changed,
 * which is why it needs this story and not the one above it: a reset that is
 * always pressable invites a lifter to press it and watch nothing happen. One
 * button for the lot rather than a revert beside each row -- undoing one set of
 * three is a thing nobody has ever wanted, and it would be a third tap target on
 * a row that already has two.
 */
export const AdjustedFoldOpen: Story = {
  args: {
    entry: { ...SQUAT, adjustments: [{ index: 2, total: 102.5 }] },
  },
  play: async ({ canvasElement }) => {
    await openAdjust(canvasElement);
  },
};

/**
 * A rack that has run out, so the top set cannot be raised.
 *
 * `Raise` is drawn disabled rather than absent: a missing control reads as a
 * layout that shifted, and a lifter pressing it twice deserves to be told the
 * rack is the reason. This state is only reachable when the rack genuinely has
 * no further pair -- the step search reaches a full step past the heaviest
 * plate -- and it therefore always co-occurs with a working weight the plates
 * cannot build, which the card says above the ramp. Showing both together is
 * honest about the cause; a story that showed a disabled stepper on a rack that
 * could plainly take another plate would be documenting a bug.
 *
 * Opened by the `play` function, because a disabled control inside a shut fold
 * is a story that renders and shows nothing of what it is named for.
 */
export const TopSetCannotGoHigher: Story = {
  args: { entry: { ...SQUAT, weight: '200' }, equipment: SPARSE_RACK },
  play: async ({ canvasElement }) => {
    await openAdjust(canvasElement);
  },
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
