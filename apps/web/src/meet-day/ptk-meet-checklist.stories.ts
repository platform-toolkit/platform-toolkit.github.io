// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.2's checklist, in the six states it passes through between entry and the
 * warm-up room.
 *
 * Every fixture is built through `prep.ts`'s own transitions rather than as a
 * `MeetPrep` literal, which is the opposite call from the setup form's stories
 * next door and for the reason §13.5 gives: a literal here can hold a state the
 * transitions cannot produce -- a tick on a row that was removed, a custom id
 * colliding with a default one -- and a screen documented coping with one is
 * documented coping with something that will never arrive. The setup form has
 * no such states, which is why it gets literals and this does not.
 *
 * `context` is a story argument rather than a fixture constant because it is
 * the one input that changes which rows exist at all: a bench-only meet asks
 * nothing about deadlift socks, and that is a screen worth being able to see
 * beside the full-power one.
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  EMPTY_PREP,
  addCustomItem,
  withChecklistItem,
  withPrepNotes,
  type ChecklistContext,
  type MeetPrep,
} from './prep.js';
import type { PtkMeetChecklist } from './ptk-meet-checklist.js';
import './ptk-meet-checklist.js';

/** A full-power raw meet with no record ambitions: the ordinary case. */
const ORDINARY: ChecklistContext = {
  format: 'full-power',
  equipment: 'raw',
  goal: 'balanced',
};

/** Two rows of somebody's own, added the way the root adds them. */
function withTwoOfTheirOwn(prep: MeetPrep): MeetPrep {
  const first = addCustomItem(prep, 'Mouthguard');
  if (!first.ok) throw new Error('The fixture failed to add its first row.');
  const second = addCustomItem(first.prep, 'Spare singlet for the second session');
  if (!second.ok) throw new Error('The fixture failed to add its second row.');
  return second.prep;
}

/** The bag half packed, which is how this screen is normally found. */
function partlyPacked(): MeetPrep {
  const ticks = ['membership-and-identification', 'singlet', 'belt', 'chalk-and-powder'];
  return ticks.reduce((prep, itemId) => withChecklistItem(prep, itemId, true), EMPTY_PREP);
}

const meta: Meta<PtkMeetChecklist> = {
  title: 'Meet day/Meet checklist',
  component: 'ptk-meet-checklist',
  tags: ['autodocs'],
  args: {
    prep: partlyPacked(),
    context: ORDINARY,
    customItemText: '',
    refusal: null,
  },
  render: (args) => html`
    <ptk-meet-checklist
      .prep=${args.prep}
      .context=${args.context}
      custom-item-text=${args.customItemText}
      .refusal=${args.refusal}
    ></ptk-meet-checklist>
  `,
};

export default meta;

type Story = StoryObj<PtkMeetChecklist>;

/**
 * Four rows ticked, and no third group.
 *
 * "Yours" is absent rather than empty until somebody adds a row -- a permanent
 * heading over no list reads as a feature that is broken rather than one nobody
 * has used. The count above the list is the whole list and not one group's, so
 * it does not jump when a group appears.
 */
export const PartlyPacked: Story = {};

/**
 * Nothing ticked, which is the state the fold opens to the first time.
 *
 * Worth its own story rather than being read off the one above: this is where
 * the count reads zero, and a screen with every row blank is the one most
 * likely to be mistaken for a list that failed to load.
 */
export const NothingTicked: Story = {
  args: { prep: EMPTY_PREP },
};

/**
 * Two rows somebody added, which is the only thing that draws the third group.
 *
 * The second row is deliberately long. Its text becomes a removal button's
 * label, and those buttons are the widest thing on the screen -- so this is the
 * story that shows whether a row somebody typed can push the page sideways.
 */
export const RowsOfTheirOwn: Story = {
  args: { prep: withTwoOfTheirOwn(partlyPacked()) },
};

/**
 * A bench-only meet, which asks about rather less.
 *
 * `prep.ts` decides which rows this meet reaches and this element draws them;
 * nothing here filters. The ticks are kept when a row goes -- a format
 * corrected twice does not lose what was already packed -- which is why the
 * fixture is the same one as the full-power story above.
 */
export const BenchOnly: Story = {
  args: {
    prep: partlyPacked(),
    context: { ...ORDINARY, format: 'bench-only' },
  },
};

/**
 * A row refused for being too long, with the text still in the box.
 *
 * The element refuses nothing itself: the root decides and hands the code down,
 * and the text stays where the lifter typed it so it can be shortened rather
 * than retyped. The refusal sentence points at the notes below, which is why
 * the notes sit under the add box and not above the list.
 */
export const ARefusedRow: Story = {
  args: {
    customItemText:
      'Spare wrist wraps, the stiff pair, plus the backup belt in case the buckle goes again',
    refusal: 'too-long',
  },
};

/**
 * Notes written out, which is the box the refusal above points at.
 *
 * §22's one free-text field on this screen, and the one place a lifter puts the
 * detail that will not fit on a checklist row.
 */
export const WithNotes: Story = {
  args: {
    prep: withPrepNotes(
      partlyPacked(),
      'Ask the expeditor about the bar for the third. Warm-up room is upstairs -- allow ten minutes.',
    ),
  },
};

/**
 * The removal fold open, which is where the destructive controls live.
 *
 * Opened by setting `open` rather than by pressing the summary: `<details>`
 * fires `toggle` asynchronously, so a press leaves the story racing the browser
 * for the screenshot (§13.6). The throw names the cause on the first line of
 * the log rather than publishing a shut fold under a title saying it is open --
 * `smoke-stories.mjs` fails any story whose page logs, so a thrown error is
 * already the reporting channel.
 */
export const RemovingARow: Story = {
  args: { prep: withTwoOfTheirOwn(partlyPacked()) },
  play: async ({ canvasElement }) => {
    const checklist = canvasElement.querySelector('ptk-meet-checklist');
    if (checklist === null) throw new Error('The checklist did not render.');
    await checklist.updateComplete;
    const fold = checklist.shadowRoot?.querySelector('ptk-disclosure');
    if (fold === null || fold === undefined) throw new Error('No removal fold to open.');
    fold.open = true;
    await checklist.updateComplete;
  },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to, and a viewport parameter would document a screen the component
 * never sees. Rows of their own, because those are the widest labels the screen
 * can hold, and every row is full width for the reason the styles record: a
 * lifter taps this between sets with chalk on their hands.
 */
export const Narrow: Story = {
  args: { prep: withTwoOfTheirOwn(partlyPacked()) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-checklist
        .prep=${args.prep}
        .context=${args.context}
        custom-item-text=${args.customItemText}
        .refusal=${args.refusal}
      ></ptk-meet-checklist>
    </div>
  `,
};
