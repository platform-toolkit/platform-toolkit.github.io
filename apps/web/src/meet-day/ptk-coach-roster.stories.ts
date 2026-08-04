// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's roster, in the states a coach's phone passes through.
 *
 * Hand-written `RosterLifter` lists here, deliberately unlike the board's
 * stories next door, which play a real flight through `applyMeetAction` because
 * the board's rows are *ranked* by the domain and a literal could document an
 * order the ladder would never produce. Nothing on this screen is ranked,
 * computed or graded: a row is a name the coach typed and four answers about it,
 * in the order they were added. A literal is therefore the honest fixture, and
 * a timeline here would be scaffolding standing between a reviewer and the facts
 * the screen is made of.
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

/**
 * Opens the first lifter's fold, which is where every per-lifter answer lives.
 *
 * By setting `open` on the fold rather than by pressing its summary:
 * `<details>` fires `toggle` asynchronously, so a press leaves the story racing
 * the browser for the screenshot (§13.6). The throw names the cause on the first
 * line of the log rather than publishing a shut roster under a title saying a row
 * is open -- `smoke-stories.mjs` fails any story whose page logs, so a thrown
 * error is already the reporting channel.
 */
async function openTheFirstRow({ canvasElement }: { canvasElement: HTMLElement }): Promise<void> {
  const roster = canvasElement.querySelector('ptk-coach-roster');
  if (roster === null) throw new Error('The roster did not render.');
  await roster.updateComplete;
  const fold = roster.shadowRoot?.querySelector('ptk-disclosure');
  if (fold === null || fold === undefined) throw new Error('No lifter row to open.');
  fold.open = true;
  await roster.updateComplete;
}

/**
 * Three lifters, set up the way a coach who has done this before sets up.
 *
 * Two of them share bar 1 and the third is on their own, which is §21.4's
 * arrangement rather than a decoration: a room where everybody is on one bar and
 * a room where nobody is are both rooms the sequencing has nothing to say about.
 * Rae is on two of the three, spelled the same way both times, because that is
 * the fact §21.2's handler warning is looking for -- and a story where every
 * handler appears once would document the screen without documenting the reason
 * the screen exists.
 */
const THREE: readonly RosterLifter[] = [
  {
    lifterId: 'lifter-1',
    name: 'Quintero',
    identifier: '14',
    colour: colour(1),
    handlers: [
      { name: 'Rae', responsibilities: ['attempt-submission', 'platform-escort'] },
      { name: 'Devi', responsibilities: ['warm-up-loading'] },
    ],
    rackId: '1',
  },
  {
    lifterId: 'lifter-2',
    name: 'Okonkwo',
    identifier: '15',
    colour: colour(2),
    handlers: [{ name: 'Rae', responsibilities: ['general'] }],
    rackId: '1',
  },
  {
    lifterId: 'lifter-3',
    name: 'Beaulieu',
    identifier: '16',
    colour: colour(3),
    handlers: [],
    rackId: '',
  },
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
 * All four per-lifter answers are optional and this is what declining every one
 * of them looks like. The summary line still says something -- "No identifier,
 * no colour" -- rather than collapsing to a bare name, because a fold with an
 * empty summary reads as a row that failed to load rather than as one nobody has
 * filled in. The bar and the handler count are *omitted* rather than answered
 * with a "none", which is the other half of the same rule: a room with no shared
 * bars in it should not read as a room where somebody declined to say.
 */
export const NobodySetUp: Story = {
  args: {
    lifters: THREE.map((lifter) => ({
      ...lifter,
      identifier: '',
      colour: null,
      handlers: [],
      rackId: '',
    })),
  },
};

/**
 * A handler added and not yet named, which is a normal state and not a broken one.
 *
 * §21.3's Add appends a blank assignment and the name is typed into it
 * afterwards, so this is every handler for the second or two before somebody
 * finishes typing -- and for as long as it takes a coach to go and ask a person
 * their surname, which is the case the design is actually for. The row is fully
 * usable here: the responsibilities can be ticked before the name is known.
 *
 * What the summary line says is the part worth documenting. It counts this
 * handler, because the coach added them; the board and §23's printed pack both
 * drop them, because `namedHandlers` will not print an empty bullet. Two
 * readings of one list, and this screen is the one that has to keep it.
 */
export const AHandlerBeingTyped: Story = {
  args: {
    lifters: THREE.map((lifter, index) =>
      index === 0 ? { ...lifter, handlers: [{ name: '', responsibilities: ['general'] }] } : lifter,
    ),
  },
  play: openTheFirstRow,
};

/**
 * One row open, which is where all four per-lifter answers actually live.
 *
 * The widest state this element has: two named handlers, seven responsibility
 * tiles apiece and a remove button carrying each name. `check-narrow-layout.mjs`
 * presses Add on the coach route for exactly this reason -- a roster with nobody
 * helping anybody renders none of it, and measures the empty sentence instead.
 */
export const OneRowOpen: Story = {
  play: openTheFirstRow,
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
