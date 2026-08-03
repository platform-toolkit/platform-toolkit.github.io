// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import type { PtkPlannerSetup } from './ptk-planner-setup.js';
import './ptk-planner-setup.js';

/**
 * §6.2's four questions, and the three states the federation list arrives in.
 *
 * Half the stories below are about the *read* rather than about the questions,
 * and that is the point of taking its status in as a property (§5.8): loading
 * and failed are the two states nobody sees while developing, because a local
 * build serves the artifact before the first paint. They are also the two a
 * lifter on gym signal sees most (§5.7), so they get a story each rather than a
 * comment saying they exist.
 *
 * The other thing to look at is the note under the federation. It is read off
 * the chosen profile, never written down (§5.1), so it is the one place on this
 * screen where picking the wrong rule book is visible before three attempts have
 * been drawn and every one of them ends in an unexpected decimal.
 */

const meta: Meta<PtkPlannerSetup> = {
  title: 'Meet day/Planner setup',
  component: 'ptk-planner-setup',
  tags: ['autodocs'],
  argTypes: {
    session: {
      control: false,
      description: 'The whole session. This element renders it and owns none of it.',
    },
    profiles: { control: false, description: 'The published rule books, once they have loaded.' },
    status: {
      control: { type: 'inline-radio' },
      options: ['loading', 'ready', 'failed'],
      description: 'Where the read of the published rule books has got to.',
    },
  },
  args: {
    session: plannerSession(),
    profiles: PROFILE_FIXTURES,
    status: 'ready',
  },
  render: (args) => html`
    <ptk-planner-setup
      .session=${args.session}
      .profiles=${args.profiles}
      status=${args.status}
    ></ptk-planner-setup>
  `,
};

export default meta;

type Story = StoryObj<PtkPlannerSetup>;

/**
 * A federation chosen, everything else on its opening answer.
 *
 * The note under the list is the interesting part: half-kilogram bar multiples
 * and a one-kilogram minimum progression are this fixture federation's, and they
 * are printed from the profile rather than from a constant.
 */
export const Ready: Story = {};

/**
 * Before anything has been chosen.
 *
 * No note, because there is no profile to read one off -- and nothing stands in
 * for it. A guess at the most common rule book would be a screen quietly
 * planning against a federation nobody picked.
 */
export const NoFederationChosen: Story = {
  args: { session: plannerSession({ federationId: '' }) },
};

/** The read has not finished. On gym signal this is most of the first minute. */
export const Loading: Story = {
  args: { status: 'loading', profiles: [] },
};

/**
 * The read failed.
 *
 * An error tone, and it says what is lost rather than only that something broke:
 * without a rule book the attempts cannot be checked against a federation's
 * increments, which is most of what this tool does.
 */
export const ReadFailed: Story = {
  args: { status: 'failed', profiles: [] },
};

/**
 * The read succeeded and there is nothing in it.
 *
 * Deliberately not an error. Nothing went wrong, and a reload will not change
 * it, so offering one would send a lifter round a loop that cannot end.
 */
export const NothingPublished: Story = {
  args: { status: 'ready', profiles: [] },
};

/**
 * A first meet, which is §6.3's one default.
 *
 * Answering the question moves an untouched goal to First Meet. A goal the
 * lifter picked themselves is left where it is -- that is `goalChosen`, and it
 * is why this story goes through `plannerSession` rather than setting the goal.
 */
export const FirstMeet: Story = {
  args: { session: plannerSession({ firstMeet: true }) },
};

/**
 * Pounds, and a push/pull meet.
 *
 * The unit choice changes how every field below is read; it does not change what
 * an attempt card is written in. Kilograms is first in the list for that reason.
 */
export const PoundsPushPull: Story = {
  args: { session: plannerSession({ unit: 'lb', format: 'push-pull' }) },
};

/**
 * More than one rule book to choose between.
 *
 * The second profile is the first with a coarser bar and a larger minimum
 * progression, which is what makes the note under the list worth reading.
 */
export const SeveralFederations: Story = {
  args: {
    profiles: [
      MEET_PROFILE_FIXTURE,
      {
        ...MEET_PROFILE_FIXTURE,
        id: 'other',
        label: 'Other Example Federation',
        source: { ...MEET_PROFILE_FIXTURE.source, label: 'Other Example Technical Rules' },
        barMultipleKilograms: 2.5,
        minimumProgressionKilograms: 5,
      },
    ],
  },
};

/**
 * A phone-width column.
 *
 * Eight goal tiles, most of them carrying a description line, which is the
 * widest thing on this screen. Constrained by a wrapper rather than by a
 * viewport setting, because the wrapper is what the element responds to (§5.7).
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-planner-setup
        .session=${args.session}
        .profiles=${args.profiles}
        status=${args.status}
      ></ptk-planner-setup>
    </div>
  `,
};
