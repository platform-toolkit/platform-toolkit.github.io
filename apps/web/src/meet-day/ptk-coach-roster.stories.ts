// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's roster, in the four states a coach's phone passes through.
 *
 * Hand-written `RosterLifter` lists here, deliberately unlike the board's
 * stories next door, which play a real flight through `applyMeetAction` because
 * the board's rows are *ranked* by the domain and a literal could document an
 * order the ladder would never produce. Nothing on this screen is ranked,
 * computed or graded: a row is a name the coach typed and two answers about it,
 * in the order they were added. A literal is therefore the honest fixture, and
 * a timeline here would be scaffolding standing between a reviewer and the four
 * facts the screen is made of.
 *
 * The identifiers are lot numbers rather than names-as-numbers, and the colours
 * come from `COLOUR_CHOICES` rather than being written out, so a change to the
 * palette moves these rows with it instead of leaving a story documenting a
 * swatch the control can no longer produce.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { COLOUR_CHOICES } from './copy.js';
import type { PtkCoachRoster, RosterLifter } from './ptk-coach-roster.js';
import './ptk-coach-roster.js';

/**
 * A colour from the published list, by position.
 *
 * Index 0 is `NO_COLOUR`, so a real colour starts at 1 -- the same offset
 * `check-narrow-layout.mjs` documents for its pickers, and for the same reason:
 * naming a hex value here would pin a story to one palette entry and quietly
 * document a swatch the control no longer offers the day the list is revised.
 */
function colour(position: number): string {
  const choice = COLOUR_CHOICES[position];
  if (choice === undefined) throw new Error(`No colour at position ${String(position)}.`);
  return choice.value;
}

/** Three lifters, set up the way a coach who has done this before sets up. */
const THREE: readonly RosterLifter[] = [
  { lifterId: 'lifter-1', name: 'Quintero', identifier: '14', colour: colour(1) },
  { lifterId: 'lifter-2', name: 'Okonkwo', identifier: '15', colour: colour(2) },
  { lifterId: 'lifter-3', name: 'Beaulieu', identifier: '16', colour: colour(3) },
];

const meta: Meta<PtkCoachRoster> = {
  title: 'Meet day/Coach roster',
  component: 'ptk-coach-roster',
  tags: ['autodocs'],
  args: { lifters: THREE, name: '', ready: true },
  render: (args) => html`
    <ptk-coach-roster
      .lifters=${args.lifters}
      name=${args.name}
      ?ready=${args.ready}
    ></ptk-coach-roster>
  `,
};

export default meta;

type Story = StoryObj<PtkCoachRoster>;

/** The board a coach arrives at the venue with. */
export const AFlight: Story = {};

/**
 * No federation chosen, so there is nowhere to put a name.
 *
 * The add box is absent rather than present and refusing. A meet document is
 * created against a rule book, so a name typed here before one is chosen has
 * nothing to be added to -- and a control that cannot do anything is never on
 * screen (§5.11). The sentence says which question to answer instead.
 */
export const BeforeAFederation: Story = {
  args: { lifters: [], ready: false },
};

/**
 * A federation chosen and nobody added, which is the one screen that warns.
 *
 * What the next press costs is said before it is pressed, for the reason
 * `START_MEET_NOTE` is on the solo path: adding the first lifter fixes the
 * federation and the meet type for the rest of the day. Said afterwards it is a
 * sentence about something already done, which is why the note is gone in every
 * other story here.
 */
export const TheFirstLifter: Story = {
  args: { lifters: [], name: 'Quintero' },
};

/**
 * Three lifters and nothing typed about any of them.
 *
 * Both per-lifter answers are optional and this is what declining both looks
 * like. The summary line still says something -- "No identifier, no colour" --
 * rather than collapsing to a bare name, because a fold with an empty summary
 * reads as a row that failed to load rather than as one nobody has filled in.
 */
export const NobodySetUp: Story = {
  args: {
    lifters: THREE.map((lifter) => ({ ...lifter, identifier: '', colour: null })),
  },
};

/**
 * One row open, which is where the two per-lifter answers actually live.
 *
 * Opened by setting `open` on the fold rather than by pressing its summary:
 * `<details>` fires `toggle` asynchronously, so a press leaves the story racing
 * the browser for the screenshot (§13.6). The throw names the cause on the
 * first line of the log rather than publishing a shut roster under a title
 * saying a row is open -- `smoke-stories.mjs` fails any story whose page logs,
 * so a thrown error is already the reporting channel.
 */
export const OneRowOpen: Story = {
  play: async ({ canvasElement }) => {
    const roster = canvasElement.querySelector('ptk-coach-roster');
    if (roster === null) throw new Error('The roster did not render.');
    await roster.updateComplete;
    const fold = roster.shadowRoot?.querySelector('ptk-disclosure');
    if (fold === null || fold === undefined) throw new Error('No lifter row to open.');
    fold.open = true;
    await roster.updateComplete;
  },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to, and a viewport parameter would document a screen the component
 * never sees. The add box and its button both stretch here for the reason the
 * styles record: a control sized to its own label lands in the middle of a row
 * a thumb is aiming at.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-coach-roster
        .lifters=${args.lifters}
        name=${args.name}
        ?ready=${args.ready}
      ></ptk-coach-roster>
    </div>
  `,
};
