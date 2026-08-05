// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The second way into the tool: find a lifter in a public archive instead of typing.
 *
 * Root section 1 calls this the path that "assists, never locks the user in", and every
 * state below is that sentence tested from a different angle. Nothing it finds is
 * committed to: the results land in the same editable list a typed result lands in, and
 * the reader can strike any of them out.
 *
 * WHAT THESE STORIES ARE FOR
 *
 * The panel has seven visible states and six of them are answers the reader did not want
 * -- searching, failed, unusable, nobody, one candidate, several candidates. Those are the
 * pages that decide whether the tool is trusted, and they are the pages nobody sees while
 * building the happy one. Each has a story here.
 *
 * WHAT IS NOT HERE
 *
 * There is no story for the archive being absent, because that state renders literally
 * nothing and a blank story is a story that fails the smoke check for good reason. It is
 * covered by an assertion instead. That state is also production today: root section 9's
 * mirror gate is shut, so `mirror` is `null` on the deployed site and this whole panel is
 * off the page.
 *
 * Every lifter, count and archive here is invented (section 5.1). The host is `.invalid`,
 * which is reserved and cannot resolve.
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkProfileImport } from './ptk-profile-import.js';
import { aHistory, aMirror, twoNamesakes } from './story.fixture.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkProfileImport> = {
  title: 'Qualification check/Profile import',
  component: 'ptk-profile-import',
  tags: ['autodocs'],
  args: {
    mirror: aMirror(),
    lookup: null,
    status: 'idle',
  },
  render: (args) => html`
    <ptk-profile-import
      .mirror=${args.mirror}
      .lookup=${args.lookup}
      .status=${args.status}
    ></ptk-profile-import>
  `,
};

export default meta;

type Story = StoryObj<PtkProfileImport>;

/**
 * Before anybody has searched.
 *
 * The first thing on the page is what the search does with the name, and that is
 * deliberate. A search box on a page about a named third party is the moment a meet
 * director should be told where the name goes, not a paragraph they can open afterwards.
 * The answer happens to be a good one -- the fold and the bucket arithmetic run in the
 * tab, and only a bucket number is fetched -- but it would need saying either way.
 */
export const BeforeASearch: Story = {};

/**
 * The read is in flight.
 *
 * A shard is a real download on a phone at a meet, so this is not a state that flickers
 * past. The previous answer is hidden while it runs rather than left on screen greyed
 * out: a list of candidate people under a new name is the one stale thing on this panel
 * that could be acted on by mistake.
 */
export const Searching: Story = {
  args: { status: 'searching' },
};

/**
 * The archive could not be reached.
 *
 * Said plainly and without a reason code. The reader can do nothing about a shard that
 * failed to download, and the useful thing on the page is the manual path below, which is
 * unaffected -- so this is a notice rather than an error state that disables anything.
 */
export const TheSearchFailed: Story = {
  args: { status: 'failed' },
};

/**
 * Nobody in the archive under that spelling.
 *
 * The coverage sentence at the foot of the panel is what makes this page honest, and it is
 * why the archive block is always rendered rather than shown on demand. Without it "no
 * results" reads as "you have never competed", when what it means is "this mirror had not
 * transcribed that meet when the site was built" (section 7).
 */
export const NobodyFound: Story = {
  args: { lookup: { outcome: 'found', matches: [] } },
};

/**
 * What the reader typed cannot be turned into a search key at all.
 *
 * A name folds to letters and digits, so a field holding only punctuation folds to
 * nothing and there is no bucket to fetch. Its own sentence rather than "nobody by that
 * name", because those are different facts and only one of them is worth retyping.
 */
export const NotSearchable: Story = {
  args: { lookup: { outcome: 'unusable' } },
};

/**
 * Exactly one candidate -- and still a choice.
 *
 * The tile is not pre-selected and must never be. The archive holding one person under a
 * spelling is not evidence that it is the right person, and this tool has no way to
 * acquire that evidence; a meet director looking up a registration has the paperwork and
 * the tool does not. Pre-selecting would put somebody else's total under this lifter's
 * name with no interaction to blame it on.
 */
export const OneCandidate: Story = {
  args: { lookup: { outcome: 'found', matches: [aHistory('Jane Invented')] } },
};

/**
 * Two people the fold cannot tell apart.
 *
 * The case the whole panel is shaped around. Folding a name to a lookup key is lossy, so
 * genuine collisions happen -- about two and a half thousand of ninety-seven thousand
 * names on the real corpus -- and the two candidates are by construction the hardest pair
 * on the page to tell apart. That is why they are tiles and not a dropdown, and why each
 * one carries a count and a span of years: the label is the only thing a reader can
 * decide on.
 */
export const TwoCandidates: Story = {
  args: { lookup: { outcome: 'found', matches: twoNamesakes() } },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * Three things are tight here and none of them are the form. The candidate labels run to a
 * name plus a count plus a span; the attribution is somebody else's sentence and cannot be
 * shortened; and the source link is on its own line because a link inside a sentence
 * cannot be given a 44 px target without overlapping the prose above it.
 */
export const Narrow: Story = {
  args: { lookup: { outcome: 'found', matches: twoNamesakes() } },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-profile-import
        .mirror=${args.mirror}
        .lookup=${args.lookup}
        .status=${args.status}
      ></ptk-profile-import>
    </div>
  `,
};
