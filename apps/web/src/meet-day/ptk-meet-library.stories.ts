// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24.2's shelf, in the seven states a lifter's phone actually reaches.
 *
 * Three of them are the warning rather than the list, which is the proportion
 * §24.3 asks for: where a meet is kept is the thing a person has to know before
 * they trust the shelf with one, and it is different in kind depending on
 * whether the browser will keep anything at all. So `NothingIsBeingSaved` and
 * `MeetsThisBuildCannotOpen` are not edge cases padded onto the end -- they are
 * the two screens most likely to be read carelessly and shipped wrong.
 *
 * The shelf comes from `library-fixture.ts`, which walks the real transitions.
 * A `SavedMeet` literal here could document an archived meet that is also the
 * open one, or a shelf whose counter is behind its own ids, and the reviewer
 * would have no way to tell that the screen in front of them is impossible.
 *
 * Two states are reached by a play function because they are element-local
 * drafts with no property behind them -- renaming and the armed delete both live
 * in `@state`, deliberately, so that a rename half-typed on one phone is not a
 * thing the root has to carry. Anything a story cannot reach is a state the
 * shipped tool cannot reach either (§13.11).
 */
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { libraryRefusalSentence } from './copy.js';
import { aShelf, oneMeet } from './library-fixture.js';
import type { PtkMeetLibrary } from './ptk-meet-library.js';
import './ptk-meet-library.js';
import { EMPTY_LIBRARY, type MeetLibrary } from './saved-meet.js';

const SHELF: MeetLibrary = aShelf();

/**
 * Presses one of a meet's controls, or throws naming what was on screen.
 *
 * The press lands on the native `<button>` inside `ptk-button` rather than on
 * the host: a story that pressed the host would document a screen a thumb
 * cannot produce, and the host listener is exactly the path the element's own
 * tests cover instead.
 */
async function press(element: PtkMeetLibrary, meetId: string, command: string): Promise<void> {
  await element.updateComplete;
  const host = element.shadowRoot?.querySelector(
    `ptk-button[data-meet="${meetId}"][data-command="${command}"]`,
  );
  const button = host?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No "${command}" control for "${meetId}" on the shelf.`);
  }
  button.click();
  await element.updateComplete;
}

function shelf(canvasElement: HTMLElement): PtkMeetLibrary {
  const element = canvasElement.querySelector('ptk-meet-library');
  if (element === null) throw new Error('The shelf did not render.');
  return element;
}

const meta: Meta<PtkMeetLibrary> = {
  title: 'Meet day/Meet library',
  component: 'ptk-meet-library',
  tags: ['autodocs'],
  args: { library: SHELF, unreadable: 0, durable: true, message: '', messageTone: 'error' },
  render: (args) => html`
    <ptk-meet-library
      .library=${args.library}
      unreadable=${args.unreadable}
      ?durable=${args.durable}
      message=${args.message}
      messageTone=${args.messageTone}
    ></ptk-meet-library>
  `,
};

export default meta;

type Story = StoryObj<PtkMeetLibrary>;

/** Two meets to come back to and two already run, on a browser that keeps them. */
export const AShelf: Story = {};

/**
 * The first visit, which is the screen the warning matters most on.
 *
 * There is no list and the warning is still there, unfolded. A lifter reads
 * §24.3's sentence before they have anything to lose, which is the only moment
 * at which exporting a copy is a decision rather than a regret.
 */
export const NothingSaved: Story = {
  args: { library: EMPTY_LIBRARY },
};

/**
 * A private window, or a browser refusing storage to a framed page.
 *
 * A different fact and therefore a different sentence: not "this is only on
 * this device" but "this is gone when the tab closes". Showing the first one
 * here would be a promise the tool cannot keep, which is the whole reason
 * `MeetStore.persistence` is read by the screen at all.
 *
 * This is that field's `page`, and it is the only one of its three values that
 * reaches this element as `durable: false`. `none` never gets here: the screen
 * withdraws §24 rather than render a shelf whose every control refuses.
 */
export const NothingIsBeingSaved: Story = {
  args: { library: oneMeet(), durable: false },
};

/**
 * Meets on the device that this build cannot open.
 *
 * Almost always a newer build wrote them, so the notice says they were left
 * alone. The instinct on reading the first half is to clear the browser and
 * start again, and that is the one action that would actually destroy them.
 */
export const MeetsThisBuildCannotOpen: Story = {
  args: { unreadable: 2 },
};

/**
 * The two sentences the planner can put on the shelf, which are not one state.
 *
 * `message` carries both a refusal and a report -- "there is no room left to
 * save" and "imported two meets" arrive on the same property -- so the tone is
 * the planner's to supply. Documented as the refusal because that is the one
 * that costs something to miss, and because it is the tone with a border on it.
 */
export const SomethingWasRefused: Story = {
  args: { message: libraryRefusalSentence('library-full'), messageTone: 'error' },
};

/**
 * Renaming, which is a text field appearing inside the row rather than a dialog.
 *
 * In the row because the name it is about is two lines above it: a modal would
 * put the meet being renamed off screen on a phone, which is how the wrong meet
 * gets renamed.
 */
export const RenamingAMeet: Story = {
  play: async ({ canvasElement }) => {
    await press(shelf(canvasElement), 'meet-4', 'start-rename');
  },
};

/**
 * Delete, armed.
 *
 * The armed control names the meet it will destroy, and the way out is a button
 * saying "Keep it" rather than a dismissal. Nothing here uses `confirm()`: it is
 * blocked inside a cross-origin frame, which is exactly where this tool runs.
 */
export const ArmedToDelete: Story = {
  play: async ({ canvasElement }) => {
    await press(shelf(canvasElement), 'meet-3', 'arm-delete');
  },
};

/**
 * The narrowest phone still in use (§5.7), constrained by a wrapper rather than
 * by a viewport setting -- the wrapper is what the element's container queries
 * respond to. Five controls per row is what has to collapse here, and it does it
 * with no media query: the `auto-fit` grid keys its column count to the
 * element's own width.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-library
        .library=${args.library}
        unreadable=${args.unreadable}
        ?durable=${args.durable}
        message=${args.message}
        messageTone=${args.messageTone}
      ></ptk-meet-library>
    </div>
  `,
};
