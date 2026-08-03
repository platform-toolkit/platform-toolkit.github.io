// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { describedSet, weighing } from './estimate-fixture.js';
import type { PtkSetRefinements } from './ptk-set-refinements.js';
import './ptk-set-refinements.js';

/**
 * The seven optional questions, and the sentence that stands in for them folded.
 *
 * Most of what matters here is visible while the section is *closed*, which is
 * why half the stories below are shown that way. The summary is the whole of
 * what is true about an estimate a lifter is reading further down the page, and a
 * fold that hides an answer the numbers depend on is how somebody trusts a figure
 * built on assumptions they never saw (§5.8). So the interesting states are: the
 * opening one, which has to name the unanswered questions rather than reading as
 * empty; a fully answered one; and the spotter, which is the single answer that
 * stops the estimate rather than adjusting it and can therefore never be true and
 * unmentioned.
 *
 * Open, the thing to look at is that the standards belong to the *lift* — the
 * question is the same question for a deadlift and the answers are not.
 *
 * Reported sex is the fourth thing the unanswered summary names, and it was left
 * out of that sentence for a while. The result panel says sex-specific weighting
 * is off; if the only other place sex appears is behind a fold whose summary
 * lists three other questions and not this one, a lifter has been told about a
 * setting and then told it does not exist. Reported as "mentions sex, but
 * doesn't ask for it", which is what a hidden question looks like from outside.
 */

/** Presses the summary, which is how a visitor opens it. */
async function unfold(canvasElement: HTMLElement): Promise<void> {
  const refinements = canvasElement.querySelector('ptk-set-refinements');
  if (refinements === null) throw new Error('Nothing rendered.');
  await refinements.updateComplete;

  const summary = refinements.shadowRoot
    ?.querySelector('ptk-disclosure')
    ?.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No summary rendered.');
  summary.click();
  await refinements.updateComplete;
}

const meta: Meta<PtkSetRefinements> = {
  title: 'One-rep max/Set refinements',
  component: 'ptk-set-refinements',
  tags: ['autodocs'],
  argTypes: {
    entry: {
      control: false,
      description: 'The whole described set. This element renders it and owns none of it.',
    },
  },
  args: { entry: describedSet() },
  render: (args) => html`<ptk-set-refinements .entry=${args.entry}></ptk-set-refinements>`,
};

export default meta;

type Story = StoryObj<PtkSetRefinements>;

/**
 * Folded, with nothing answered.
 *
 * The summary names the four questions that are unstated instead of saying
 * nothing — a fold that reads as empty is a fold nobody opens, and three of
 * those four are what cost the estimate its grade. The fourth, reported sex,
 * costs nothing and is named because the panel above mentions it.
 */
export const Folded: Story = {};

/** The same state, open: seven questions, none of them required. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * Every question answered, folded.
 *
 * The summary lists only the answers that move something, in the order they were
 * asked. Nothing on their opening value appears — otherwise the sentence would be
 * longest exactly when the least had been said.
 */
export const EveryQuestionAnswered: Story = {
  args: {
    entry: describedSet({
      techniqueId: 'competition-squat',
      freshness: 'fresh',
      formQuality: 'consistent',
      experience: 'experienced',
      sex: 'woman',
    }),
  },
};

/**
 * A spotter touched the bar, and nothing else was said.
 *
 * Last in the summary and always in it. This answer withholds the estimate
 * outright, so it may never be set and out of sight at the same time — which is
 * the reason it is folded in with the optional questions rather than sitting as a
 * checkbox beside the weight field.
 */
export const SpotterAssisted: Story = {
  args: { entry: describedSet({ assisted: true }) },
};

/**
 * A deadlift, open.
 *
 * Same question, different answers: sumo and straps are deadlift standards and
 * squat depth is not. A fixed list here would not merely mislabel the choice — a
 * squat identifier on a deadlift is a request the domain refuses, so the tool
 * would produce no estimate at all.
 */
export const DeadliftStandards: Story = {
  args: { entry: describedSet({ lift: 'deadlift' }) },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * Pounds, open.
 *
 * The rounding steps follow the unit on the entry — a lifter working in pounds is
 * offered 1, 2.5 and 5 lb, not a kilogram jump relabelled.
 */
export const PoundRounding: Story = {
  args: { entry: describedSet(weighing('315 lb')) },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * A phone-width column, open.
 *
 * Seven groups of tiles, several carrying a description line. This is the widest
 * thing in the tool that is not a table, and it is the layout a lifter actually
 * sees when they tap the fold at a rack.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-set-refinements .entry=${args.entry}></ptk-set-refinements>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};
