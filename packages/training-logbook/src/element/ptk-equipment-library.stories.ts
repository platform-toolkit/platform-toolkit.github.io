// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rack a lifter is on, and the gyms they have saved.
 *
 * Worth pressing rather than reading. Two things sit on this screen and they behave
 * differently: the editor writes as it is touched, and the library writes only when the
 * save button is pressed. The stories below exist mostly to let a reviewer check that the
 * copy keeps those apart -- a screen where "save" plausibly refers to both is one where a
 * lifter loses a rack and cannot say when.
 *
 * The element reports and stores nothing on its own, so these are static screens. What
 * happens after a press is the root element's decision (section 12.3) and is covered by
 * `ptk-equipment-library.browser.test.ts`, which drives the whole tool.
 *
 * Every bar, plate and gym name here is invented (section 5.1).
 */
import { DEFAULT_EQUIPMENT } from '@platform-toolkit/domain';
import { snapshotFrom } from '@platform-toolkit/training-logbook';
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { EquipmentProfile } from '../types.js';

import type { PtkEquipmentLibrary } from './ptk-equipment-library.js';
import { AT_START } from './story.fixture.js';

// Through the package entry and behind an explicit call, like every other story file
// here. A relative import would define every tag a second time and the only symptom
// would be a console error.
defineTrainingLogbook();

/** The rack the pickers open on, which is also what a lifter who changes nothing keeps. */
const A_RACK = snapshotFrom(DEFAULT_EQUIPMENT);

/**
 * A second gym, told apart by its bar rather than by its name.
 *
 * A library whose two rows differ only in wording would let a "use this gym" that did
 * nothing look correct in a screenshot.
 */
const ANOTHER_RACK = snapshotFrom({ ...DEFAULT_EQUIPMENT, plateUnit: 'kg' });

function aGym(id: string, name: string, equipment = A_RACK): EquipmentProfile {
  // Both timestamps are the same literal. They are not rendered, and a clock read here
  // would make the story a different one every time it was opened.
  return { id, name, equipment, createdAt: AT_START, updatedAt: AT_START };
}

const A_LIBRARY: readonly EquipmentProfile[] = [
  aGym('gym-1', 'The garage', A_RACK),
  aGym('gym-2', 'The club', ANOTHER_RACK),
];

const meta: Meta<PtkEquipmentLibrary> = {
  title: 'Training logbook/Equipment library',
  component: 'ptk-equipment-library',
  tags: ['autodocs'],
  args: {
    equipment: A_RACK,
    profiles: A_LIBRARY,
    unreadable: false,
    remembers: true,
  },
  render: (args) => html`
    <ptk-equipment-library
      .equipment=${args.equipment}
      .profiles=${args.profiles}
      ?unreadable=${args.unreadable}
      ?remembers=${args.remembers}
    ></ptk-equipment-library>
  `,
};

export default meta;

type Story = StoryObj<PtkEquipmentLibrary>;

/**
 * Two gyms saved, standing in the first of them.
 *
 * The row for the gym in use offers no "use this gym" and says so instead, because a
 * control that would do nothing reads as one that is broken. Which row is marked is
 * decided by comparing the racks and not by storing an identifier: `settings.equipment`
 * holds a rack, so an edit to the rack detaches the mark, which is the truth worth
 * showing.
 */
export const TwoGyms: Story = {};

/**
 * The first time anybody opens it.
 *
 * The sentence under the heading is the whole point of this story. An empty list with a
 * heading over it reads as a read that failed, and a lifter who believes their gyms are
 * gone does not save the one in front of them.
 */
export const NothingSavedYet: Story = {
  args: { profiles: [], equipment: null },
};

/**
 * The library could not be read, which is not the same screen as an empty one.
 *
 * They look identical and only one of them makes saving under a familiar name safe: the
 * gym is still in the database, so a save will replace something the lifter cannot see.
 * Nothing else is disabled -- the rack above still works, and a lifter with a failed read
 * still has a bar to load.
 */
export const LibraryUnreadable: Story = {
  args: { unreadable: true, profiles: [] },
};

/**
 * A browser giving the page no storage at all.
 *
 * The rack editor says so itself, in the same words every other screen in the collection
 * uses. Nothing here pretends a private-browsing window will remember a gym.
 */
export const NothingIsKept: Story = {
  args: { remembers: false },
};

/** At 320 px, which is where the row of controls under each gym has to survive wrapping. */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-equipment-library
        .equipment=${args.equipment}
        .profiles=${args.profiles}
        ?unreadable=${args.unreadable}
        ?remembers=${args.remembers}
      ></ptk-equipment-library>
    </div>
  `,
};
