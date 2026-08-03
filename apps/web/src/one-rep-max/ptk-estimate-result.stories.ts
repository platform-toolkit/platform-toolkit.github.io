// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { estimateFor, problemsFor, weighing } from './estimate-fixture.js';
import type { PtkEstimateResult } from './ptk-estimate-result.js';
import './ptk-estimate-result.js';

/**
 * The answer, in the order §9.1 fixes.
 *
 * The states below are the ones the tool actually reaches, and they are worth
 * looking at side by side because the panel says something structurally
 * different in each: four grades that each change the sentence under the figure,
 * a single that was observed rather than estimated, two ways of having no figure
 * at all, and a set the domain refuses to read. The happy path is one of eleven.
 *
 * Every figure here is computed by `estimateOneRepMax` from a described set —
 * nothing is typed in by hand, so a story cannot show a grade that does not
 * follow from the advisories beneath it. Which also means the grades below are
 * discovered rather than chosen: see `NothingAdded`, which is the one most
 * likely to surprise.
 */

const meta: Meta<PtkEstimateResult> = {
  title: 'One-rep max/Estimate result',
  component: 'ptk-estimate-result',
  tags: ['autodocs'],
  argTypes: {
    estimate: {
      control: false,
      description: "The domain's answer, or null before a set has been described.",
    },
    problems: {
      control: false,
      description: 'Everything wrong with the input, all at once. Outranks the estimate.',
    },
  },
  args: {
    estimate: estimateFor(),
    problems: [],
  },
  render: (args) => html`
    <ptk-estimate-result
      .estimate=${args.estimate}
      .problems=${args.problems}
    ></ptk-estimate-result>
  `,
};

export default meta;

type Story = StoryObj<PtkEstimateResult>;

/**
 * 142.5 kg for five, and nothing else said about it.
 *
 * The state the tool is in the moment a set has been typed and no refinement has
 * been opened — which is where most visits stay, so it is the first story rather
 * than a footnote. It grades **rough**, and that is deliberate: the movement
 * standard opens on "not sure" and the reserve on "not stated", so the tool is
 * declining to upgrade its own answer on the lifter's behalf. Two advisories say
 * exactly which unanswered questions cost the grade, which is what makes the
 * grade actionable rather than a verdict.
 */
export const NothingAdded: Story = {};

/**
 * The same set with every refinement answered the way that earns the best grade.
 *
 * Competition depth, taken to failure, fresh, form held, experienced with
 * singles. Note what the panel still says: the figure has not moved a kilogram —
 * the grade is a statement about the input, not a correction to the arithmetic —
 * and the caveat under it is unchanged. A grade is not an absence of caveats.
 */
export const EveryQuestionAnswered: Story = {
  args: {
    estimate: estimateFor({
      techniqueId: 'competition-squat',
      reserve: '0',
      freshness: 'fresh',
      formQuality: 'consistent',
      experience: 'experienced',
    }),
  },
};

/**
 * Competition depth, two reps left in the tank.
 *
 * The middle grade, and the sentence for it is the one worth reading: the true
 * single could sit either side of the figure by more than the numbers suggest.
 * Two reps in reserve is the commonest honest answer a lifter gives, so this is
 * the state a well-filled-in form usually lands in.
 */
export const UsefulEstimate: Story = {
  args: { estimate: estimateFor({ techniqueId: 'competition-squat', reserve: '2' }) },
};

/**
 * The same set at twelve reps.
 *
 * Endurance-dominated, and the equations now disagree by more than five percent
 * — which is stated as disagreement between models and explicitly not as a
 * margin of error. That sentence is the tool's whole position on the spread.
 */
export const EnduranceDominated: Story = {
  args: { estimate: estimateFor({ repsText: '12' }) },
};

/**
 * Four or more reps left in the tank.
 *
 * Also endurance-dominated, by a different route: five reps with four left is
 * nine effective ones, and how far a set stopped from failure is a guess nobody
 * can make from here. Worth showing next to the twelve-rep story because the
 * grade is the same and the advisories explaining it are not.
 */
export const FarFromFailure: Story = {
  args: { estimate: estimateFor({ reserve: 'four-or-more' }) },
};

/**
 * A lift no published study validates these equations for.
 *
 * The advisory **caps** the grade rather than lowering it — a different kind of
 * entry, labelled differently, and the distinction matters: answering every
 * other question cannot lift the grade past the cap, so a lifter who fills the
 * whole form in and sees no movement is being told something true.
 */
export const UnvalidatedLift: Story = {
  args: { estimate: estimateFor({ lift: 'other' }) },
};

/**
 * One repetition.
 *
 * Labelled observed rather than estimated, with no scenarios. Several equations
 * answer more than the load at a single, and a tool that let them through would
 * tell somebody who just missed a second attempt that they lifted more than they
 * lifted.
 */
export const ObservedSingle: Story = {
  args: { estimate: estimateFor({ repsText: '1' }) },
};

/**
 * A spotter touched the bar.
 *
 * No figure at all. Not a lowered estimate, not the entered weight standing in —
 * an em dash and a sentence saying what to do instead.
 */
export const AssistedSet: Story = {
  args: { estimate: estimateFor({ assisted: true }) },
};

/**
 * Eighteen reps with four or more left, which is over twenty effective ones.
 *
 * The second way to have no figure, and it reads differently from the first
 * because the remedy is different.
 */
export const TooManyEffectiveReps: Story = {
  args: { estimate: estimateFor({ repsText: '18', reserve: 'four-or-more' }) },
};

/**
 * Twenty-five repetitions.
 *
 * The domain refuses the set rather than answering, so the panel is an error
 * notice listing every problem at once. Fixing one and rediscovering the next is
 * how a form becomes an argument.
 */
export const RefusedSet: Story = {
  args: { estimate: null, problems: problemsFor({ repsText: '25' }) },
};

/** Nothing described yet. An invitation, not an error — this is where every visit starts. */
export const NothingDescribed: Story = {
  args: { estimate: null },
};

/**
 * A phone-width column with a pound figure in it.
 *
 * The widest state this panel has: a four-digit headline at 2.25rem plus three
 * scenario cards, which is the layout a lifter reads at a rack.
 */
export const Narrow: Story = {
  args: { estimate: estimateFor(weighing('315 lb')) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-estimate-result
        .estimate=${args.estimate}
        .problems=${args.problems}
      ></ptk-estimate-result>
    </div>
  `,
};
