// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkTargetFreshness } from './ptk-target-freshness.js';
import { DATA_META } from '../core/records.fixture.js';
import { definePlatformTargets } from '@platform-toolkit/platform-targets/element';

// The registry is written once, explicitly. See the note in the composite root's stories.
definePlatformTargets();

/**
 * How old the numbers are, said four ways.
 *
 * These stories exist because three of the four states only happen where nobody
 * is watching -- a phone with no signal, a publisher whose upstream table went
 * away -- and the one thing none of them may do is look like the ordinary case.
 * So they are graded here by how much trouble they are in, and what to look at
 * is whether the trouble is legible without reading the sentence: the caution and
 * error states are full-strength text against the quiet one's muted footnote,
 * which is the part a colour alone would not carry.
 *
 * The index is invented (§5.1). Nothing that ships imports it.
 */

const meta: Meta<PtkTargetFreshness> = {
  title: 'Platform Targets/Freshness',
  component: 'ptk-target-freshness',
  tags: ['autodocs'],
  argTypes: {
    connection: { control: 'inline-radio', options: ['online', 'offline'] },
    metaStatus: { control: 'inline-radio', options: ['loading', 'ready', 'failed'] },
    showingData: { control: 'boolean' },
    federationLabel: { control: 'text' },
  },
  args: {
    connection: 'online',
    meta: DATA_META,
    metaStatus: 'ready',
    showingData: true,
    federationLabel: 'Example Federation',
  },
  render: (args) => html`
    <ptk-target-freshness
      .connection=${args.connection}
      .meta=${args.meta}
      .metaStatus=${args.metaStatus}
      .showingData=${args.showingData}
      .federationLabel=${args.federationLabel}
    ></ptk-target-freshness>
  `,
};

export default meta;

type Story = StoryObj<PtkTargetFreshness>;

/**
 * The ordinary visit.
 *
 * One muted line, and the date is the *older* of the fixture's two sources --
 * 28 July rather than 30 July. The line can only ever understate how fresh the
 * publication is, which is the safe direction for a number somebody may open a
 * rulebook over.
 */
export const LastVerified: Story = {};

/**
 * Offline, with a copy of this category already on the device.
 *
 * The service worker has done its job and there are real targets above this line;
 * what the line adds is that they may have moved. This is the sentence that
 * distinguishes a record set on Saturday from a phone still holding Friday's
 * copy, which otherwise look identical.
 */
export const OfflineWithCache: Story = {
  args: { connection: 'offline' },
};

/**
 * Offline, with nothing saved for this category yet.
 *
 * The only state with nothing true on screen above it, so it is the only one that
 * offers an action. Everything else here is a statement; a retry attached to a
 * line that merely says the data is a week old would be a button that cannot
 * change what it sits under.
 */
export const OfflineWithNothingSaved: Story = {
  args: { connection: 'offline', meta: null, metaStatus: 'failed', showingData: false },
};

/**
 * The publisher could not refresh one of its sources.
 *
 * Deliberately not the offline wording. This is about the source rather than the
 * device, reconnecting will not fix it, and the figures are as current as
 * anybody's -- so a lifter who reads "Offline" here would go looking for signal
 * they already have.
 */
export const UpdateUnavailable: Story = {
  args: {
    meta: {
      ...DATA_META,
      sources: DATA_META.sources.map((source, index) =>
        index === 0 ? { ...source, status: 'unavailable' as const } : source,
      ),
    },
  },
};

/**
 * Before the first read settles.
 *
 * The element renders nothing -- not an empty bordered line, which at the foot of
 * a page reads as a section that failed. Storied because "renders nothing" is a
 * decision and this is the only place it can be seen; `smoke-stories.mjs` rejects
 * a story with no rendered text, so the sentence below is the wrapper that makes
 * it loadable and says why it is there.
 */
export const NothingKnownYet: Story = {
  render: () => html`
    <p>The element below has read nothing yet and deliberately draws no line at all.</p>
    <ptk-target-freshness
      .meta=${null}
      .metaStatus=${'loading'}
      .showingData=${false}
    ></ptk-target-freshness>
  `,
};
