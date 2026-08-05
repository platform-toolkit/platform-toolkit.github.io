// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, in the states a lifter or a meet director opens it in.
 *
 * The composite root is the one element here whose stories are worth *pressing* rather
 * than looking at: five of the six tags are inside its shadow root and the only thing
 * that connects them is six composed events. A screenshot of this element proves that
 * the markup exists; typing a result into it and watching a grade appear two boxes down
 * proves the tool works, and that is a distinction section 13 paid for.
 *
 * WHY EVERY STORY BUILDS ITS DATA FROM THE FIXTURE ARCHIVE
 *
 * `story.fixture.ts` says why at length. The short version: a hand-written report can
 * hold a page the core would never produce, and a reviewer cannot tell that page from a
 * correct one.
 *
 * WHY THERE IS NO STORY WITH A REAL FEDERATION'S NUMBERS
 *
 * Section 5.1. Every figure below belongs to an invented federation with invented
 * classification tables, and the meet is an invented meet. The tool reads published data
 * at runtime and no published data is compiled into it.
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkQualificationCheck } from './ptk-qualification-check.js';
import {
  A_DAY_BEFORE_ENTRY_CLOSES,
  TABLES_FIXTURE,
  VOCABULARY_FIXTURE,
  aGearedMeet,
  entry,
  meetBook,
} from './story.fixture.js';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// six tags a second time: the registry throws on the second write, the story still looks
// right because the first definition already won, and the only symptom is a console
// error -- which `smoke-stories.mjs` fails on, for exactly this reason.
defineQualificationCheck();

const meta: Meta<PtkQualificationCheck> = {
  title: 'Qualification check/The tool',
  component: 'ptk-qualification-check',
  tags: ['autodocs'],
  args: {
    importedEntries: [entry()],
    vocabulary: VOCABULARY_FIXTURE,
    tables: TABLES_FIXTURE,
    book: null,
    today: A_DAY_BEFORE_ENTRY_CLOSES,
  },
  render: (args) => html`
    <ptk-qualification-check
      .importedEntries=${args.importedEntries}
      .vocabulary=${args.vocabulary}
      .tables=${args.tables}
      .book=${args.book}
      .today=${args.today}
    ></ptk-qualification-check>
  `,
};

export default meta;

type Story = StoryObj<PtkQualificationCheck>;

/**
 * One imported result and no meet chosen, which is way one and the common case.
 *
 * The tool opens on the registration questions rather than on a report, and only two of
 * the five are asked: the archive entry carries an age class, a bodyweight and a tested
 * flag, so three axes already have a measured proposal under them. Answer sex and
 * equipment and four grades appear. **That is the whole tool in two taps**, and it is the
 * story to read first.
 */
export const OneResult: Story = {};

/**
 * Nothing imported and nothing typed, which is what a bare page looks like.
 *
 * Worth reviewing because it is the state most likely to read as broken: there is a form,
 * two date fields and a sentence saying no results have been entered, and deliberately no
 * report, no registration questions and no red. An empty tool is where the page opens,
 * not four mistakes to correct.
 */
export const BeforeAnyResults: Story = {
  args: { importedEntries: [] },
};

/**
 * Two results that imply two different registrations, which is a question and not a
 * default.
 *
 * Raw at 94 in March, single-ply at 112 in September. There is no correct way to read one
 * lifter against both at once -- every figure would be graded under one of the two and
 * would not say which -- so nothing below the choice is drawn until the reader picks. The
 * tool does not pick for them, and document order in the archive is not an answer
 * (section 5.5).
 */
export const TwoRegistrations: Story = {
  args: { importedEntries: [entry(), aGearedMeet()] },
};

/**
 * The same lifter with a meet's published criteria beside them, which is way two.
 *
 * The meet's own words are quoted and set apart rather than paraphrased, because a
 * paraphrase is this tool stating an entry requirement in its own voice. Nothing on the
 * page says whether the lifter may enter: section 29 leaves that to the federation, and
 * what the tool does instead is put the criteria and the results side by side and say
 * plainly that the decision is not made here.
 */
export const WithAMeetToRead: Story = {
  args: { book: meetBook() },
};

/**
 * A federation that has published categories but no transcribed meets.
 *
 * Way one still works -- classification per lift and on the total is the answer a lifter
 * needs for an unfamiliar entry form -- and the meet picker is replaced by a sentence
 * saying nobody has read a meet for this federation yet. A tool that could only answer
 * for the meets somebody happened to ingest would be unhelpful exactly when it is needed.
 */
export const NoMeetsTranscribed: Story = {
  args: { book: meetBook({ meets: [] }) },
};

/**
 * A federation whose category catalogue has not been published.
 *
 * One sentence, and nothing else -- no form, no dates, no standings. Four controls that
 * can produce no reading read as the tool being broken; one sentence reads as the data
 * being absent, which is what is true. Honest uncertainty (section 7) is a rendering
 * decision as much as a wording one.
 */
export const NoPublishedCategories: Story = {
  args: { vocabulary: null },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * This is the tool's hardest layout: eight fields on the result form, five registration
 * questions, four grade rows and a meet reading, all of which have to hold a 320-pixel
 * column with no sideways scroll. The two date fields are the tight pair.
 */
export const Narrow: Story = {
  args: { book: meetBook() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-qualification-check
        .importedEntries=${args.importedEntries}
        .vocabulary=${args.vocabulary}
        .tables=${args.tables}
        .book=${args.book}
        .today=${args.today}
      ></ptk-qualification-check>
    </div>
  `,
};
