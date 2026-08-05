// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One meet's published criteria, read route by route against what a lifter has done.
 *
 * This is the element section 29 is about. Every other screen in the tool describes a
 * lifter; this one describes a *meet's requirements*, and the temptation at every line is
 * to finish the sentence -- "so you may enter". It never does. The federation decides, the
 * page says so in as many words, and what it offers instead is the meet's own quotation
 * beside the lifter's own results.
 *
 * WHY THE QUOTATIONS ARE QUOTED
 *
 * A paraphrase is this tool stating an entry requirement in its own voice, and a
 * paraphrase that drifts is indistinguishable from a rule. The transcribed wording is
 * carried through the published artifact and printed verbatim, set apart, with the
 * document it came from named beside it.
 *
 * Every figure and every meet here is invented (section 5.1).
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkMeetReading } from './ptk-meet-reading.js';
import { VOCABULARY_FIXTURE, aMeetReading } from './story.fixture.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkMeetReading> = {
  title: 'Qualification check/Meet reading',
  component: 'ptk-meet-reading',
  tags: ['autodocs'],
  args: {
    reading: aMeetReading(),
    timing: 'entry-open',
    vocabulary: VOCABULARY_FIXTURE,
  },
  render: (args) => html`
    <ptk-meet-reading
      .reading=${args.reading}
      .timing=${args.timing}
      .vocabulary=${args.vocabulary}
    ></ptk-meet-reading>
  `,
};

export default meta;

type Story = StoryObj<PtkMeetReading>;

/**
 * Entry is open, and the lifter's total is read against the route the meet publishes.
 *
 * The ordinary page, and the one to read first. A classification route names a standard
 * by reference rather than by figure, so the tool resolves it against the same published
 * ladder the standing report uses -- which is why the two screens can never disagree
 * about what First Class means.
 */
export const EntryOpen: Story = {};

/**
 * The same meet read in a Masters division.
 *
 * The route is unchanged and the reading moves, because the standard it names resolves
 * against a different table. Worth having beside {@link EntryOpen} for the same reason
 * the standing report has its Masters twin: the reader needs to see that the meet's
 * requirement is one thing and the ladder it is measured on is another.
 */
export const InAMastersDivision: Story = {
  args: { reading: aMeetReading({ divisionId: 'master-1' }) },
};

/**
 * The entry deadline has passed.
 *
 * The criteria are still worth reading -- a lifter plans next year off them, and a meet
 * director checks a late entry against them -- so nothing is hidden or greyed out. The
 * timing is a fact stated once at the top rather than a state that disables the page.
 */
export const EntryClosed: Story = {
  args: { timing: 'entry-closed' },
};

/**
 * The meet has already been held.
 *
 * The same argument as {@link EntryClosed}, one step further along, and the state a
 * reader most often arrives in when they follow a link from an old results page. Nothing
 * about the criteria becomes false because the meet happened.
 */
export const AlreadyHeld: Story = {
  args: { timing: 'held' },
};

/**
 * No meet chosen, which is what the property holds until the reader picks one.
 *
 * Way one -- classification against the published ladder -- is the common case and needs
 * no meet at all, so this element is absent rather than empty on most visits. A consumer
 * binding it directly gets a sentence, not a blank panel with a heading.
 */
export const BeforeAMeetIsChosen: Story = {
  args: { reading: null, timing: null },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * The quotations are the tight part: transcribed rulebook prose is long, unhyphenated and
 * occasionally holds a word wider than the column, which is why `overflow-wrap: anywhere`
 * is set at the root rather than `break-word` -- only `anywhere` counts as a break
 * opportunity when a grid item's minimum size is computed.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-reading
        .reading=${args.reading}
        .timing=${args.timing}
        .vocabulary=${args.vocabulary}
      ></ptk-meet-reading>
    </div>
  `,
};
