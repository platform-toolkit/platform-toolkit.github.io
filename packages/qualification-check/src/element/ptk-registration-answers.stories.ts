// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The five questions a results archive cannot answer on its own.
 *
 * This is the element the tool turns on, and the states worth reviewing are the ones a
 * working page never shows: an axis with no proposal under it, an axis where two
 * divisions are equally defensible, and the moment the last question is answered. A
 * screenshot of the settled screen shows five controls; it does not show which of them
 * the tool guessed at and which the reader had to decide, and that difference is the
 * whole design.
 *
 * WHY A PROPOSAL IS NOT AN ANSWER
 *
 * Every default here is a *reading* of what the lifter's results say -- a bodyweight
 * implies a class, an age class implies a division -- and each one is labelled with what
 * it was read from. A lifter may enter a class they have never weighed into and a
 * division they are merely eligible for, so a proposal the reader cannot see and change
 * is the tool making an entry decision on their behalf, which is section 29's line.
 *
 * Every figure is invented (section 5.1).
 */
import { defineQualificationCheck } from '@platform-toolkit/qualification-check/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { ResolvedRegistration } from '@platform-toolkit/qualification-check';

import type { PtkRegistrationAnswers } from './ptk-registration-answers.js';
import { VOCABULARY_FIXTURE, aProposal, aStanding, entry } from './story.fixture.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineQualificationCheck();

const meta: Meta<PtkRegistrationAnswers> = {
  title: 'Qualification check/Registration answers',
  component: 'ptk-registration-answers',
  tags: ['autodocs'],
  args: {
    proposal: aProposal(),
    vocabulary: VOCABULARY_FIXTURE,
    answers: {},
  },
  render: (args) => html`
    <ptk-registration-answers
      .proposal=${args.proposal}
      .vocabulary=${args.vocabulary}
      .answers=${args.answers}
    ></ptk-registration-answers>
  `,
};

export default meta;

type Story = StoryObj<PtkRegistrationAnswers>;

/** The two spelled axes, answered. Enough to open the weight-class ladder. */
const MALE_RAW: Partial<ResolvedRegistration> = { sex: 'male', equipmentId: 'raw' };

/** All five, for the story about a form with nothing left on it. */
const EVERY_ANSWER: Partial<ResolvedRegistration> = {
  ...MALE_RAW,
  weightClassId: 'to-94',
  divisionId: 'open',
  tested: true,
};

/**
 * An ordinary archive entry, opened, where two of the five already have a reading.
 *
 * The age class names a division and the tested flag is recorded, so those two arrive
 * filled in with a sentence saying where each came from. Three are put to the reader and
 * the screen marks them.
 *
 * The weight class is the interesting one and this is the state it exists to show. The
 * archive recorded both an entered class and a bodyweight, so there is plenty to read it
 * from -- and it is still open, because a ladder of weight classes is published per sex
 * and the sex has not been answered. The control says so rather than offering a list, and
 * the alternative is the failure the whole vocabulary shape prevents: a class measured off
 * whichever ladder happened to contain a matching boundary, preselected, looking exactly
 * like an answer. Compare {@link SexUnlocksTheWeightClass}.
 */
export const TwoAlreadyRead: Story = {};

/**
 * The same entry, one answer later, and a third question has answered itself.
 *
 * Answering sex chooses the ladder, the entered class is measured against it, and the
 * weight class fills in with its where-from sentence. One answer, two questions gone.
 * Worth its own story because the transition is the argument for the whole design: the
 * class is proposed exactly as confidently as before, only now against a ladder somebody
 * has confirmed applies.
 */
export const SexUnlocksTheWeightClass: Story = {
  args: { answers: { sex: 'male' }, proposal: aProposal(aStanding(), { sex: 'male' }) },
};

/**
 * An entry with no bodyweight, no age and no tested flag, so nothing can be proposed.
 *
 * Five open questions and five marked blocks. This is what a sparse archive row looks
 * like, and the page has to be usable rather than apologetic about it -- the tool is not
 * broken, the source simply did not record those columns. Compare with
 * {@link TwoAlreadyRead}: the controls are identical and only the marks and the
 * where-from sentences differ.
 */
export const NothingToReadFrom: Story = {
  args: {
    proposal: aProposal(
      aStanding([
        entry({ ageClass: null, age: null, bodyweightKg: null, weightClassKg: null, tested: null }),
      ]),
    ),
  },
};

/**
 * A lifter whose age puts them in two divisions at once.
 *
 * Forty-one years old is a Master 40-49 and equally an Open lifter, and the fixture
 * publishes both. Ambiguity is a first-class outcome here (section 5.5) rather than
 * something resolved by document order: the tool offers both, proposes neither as
 * settled, and says that being eligible for a division is not the same as entering it.
 * Which standards a lifter is read against follows a choice that is theirs.
 */
export const TwoDivisionsOpen: Story = {
  args: {
    answers: MALE_RAW,
    // Built with the same answers it is rendered with, which every story below does too.
    // The proposal and the answers are separate properties because the element is not
    // the thing that merges them -- but a proposal made under one set of answers and
    // shown beside another is a screen the tool cannot produce, and a story showing one
    // is a reviewer checking a page that does not exist.
    proposal: aProposal(aStanding(), MALE_RAW),
  },
};

/**
 * Every axis answered, which is the state that makes the report appear below.
 *
 * Nothing is marked and the "still to answer" line is gone. Worth having as a story
 * because the absence of a sentence is the only signal that the screen is complete, and
 * an absence is exactly what a reviewer skims past.
 */
export const AllAnswered: Story = {
  args: {
    answers: EVERY_ANSWER,
    proposal: aProposal(aStanding(), EVERY_ANSWER),
  },
};

/**
 * No results to read, which is what the property holds before an archive arrives.
 *
 * A consumer wiring this element directly holds `null` first. The honest render is a
 * sentence rather than five empty pickers over categories nobody has published.
 */
export const BeforeThereAreResults: Story = {
  args: { proposal: null },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter.
 *
 * Five questions, two of them long lists. The weight-class and division pickers are
 * `ptk-select` rather than tiles precisely because seventeen divisions as a tile grid is
 * the ragged column section 5.7 forbids -- this story is where that decision is checked.
 *
 * Answered as far as the sex, which is what makes it check anything. A ladder is published
 * per sex, so the default arguments would render this story's weight-class picker empty --
 * and a narrow-width story whose long list is not on screen passes for the same reason a
 * blank page would.
 */
export const Narrow: Story = {
  args: { answers: MALE_RAW, proposal: aProposal(aStanding(), MALE_RAW) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-registration-answers
        .proposal=${args.proposal}
        .vocabulary=${args.vocabulary}
        .answers=${args.answers}
      ></ptk-registration-answers>
    </div>
  `,
};
