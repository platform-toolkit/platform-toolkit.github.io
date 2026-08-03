// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { acrossLifts, guidedSet, plannerSession } from './planner-fixture.js';
import { withExtras, withTargets } from './session.js';
import type { PtkPlanExtras } from './ptk-plan-extras.js';
import './ptk-plan-extras.js';

/**
 * §8: Improve My Plan, and the summary line that has to hold it all.
 *
 * The stories below open folded, which is how a lifter meets this element, and
 * that makes the *summary* the thing to review rather than the twenty controls
 * behind it -- press the row to see those. §5.8's rule for `ptk-disclosure` is
 * that the summary states the whole of what is true while folded, and here that
 * rule has teeth: several of these answers move the data-confidence grade the
 * plan screen prints, so an answer left out of the summary is a grade resting on
 * something the lifter cannot see.
 *
 * Two of the stories are about fields that are *absent*, which is the part of
 * this element a screenshot of the open fold would not explain. Guided Estimate
 * has already asked where the figure came from, and §7.3 and §7.5 have already
 * asked for the ceiling -- asking twice invites two answers that disagree, and in
 * both cases the derived one wins, so the second field would be a control that
 * visibly responds and changes nothing.
 */

const meta: Meta<PtkPlanExtras> = {
  title: 'Meet day/Plan extras',
  component: 'ptk-plan-extras',
  tags: ['autodocs'],
  argTypes: {
    session: {
      control: false,
      description: 'The whole session. This element renders it and owns none of it.',
    },
  },
  args: { session: plannerSession() },
  render: (args) => html`<ptk-plan-extras .session=${args.session}></ptk-plan-extras>`,
};

export default meta;

type Story = StoryObj<PtkPlanExtras>;

/**
 * Nothing added, which is how every session starts.
 *
 * The summary names the four things that are unstated rather than saying only
 * "optional". A fold labelled "improve my plan" with no summary reads as a
 * refinement nobody needs; naming readiness and evidence says what the plan below
 * is currently assuming.
 */
export const NothingAdded: Story = {};

/**
 * A few answers given.
 *
 * Only the answers that move something are listed, and every one of those is.
 * Naming the ones still on their opening value would make the sentence longest
 * exactly when the least had been said.
 */
export const SomeAnswers: Story = {
  args: {
    session: withExtras(plannerSession(), {
      bodyweight: '92.5',
      equipment: 'raw',
      readiness: 'reduced',
      evidenceAge: 'within-eight-weeks',
    }),
  },
};

/**
 * Everything answered, which is the longest this line ever gets.
 *
 * Worth a story of its own because the summary is one sentence in a row with a
 * chevron, and this is the state that tests whether it wraps inside the row
 * rather than pushing the chevron off the end of a phone.
 */
export const EverythingAnswered: Story = {
  args: {
    session: withTargets(
      acrossLifts(
        withExtras(plannerSession(), {
          bodyweight: '92.5',
          age: '34',
          priorMeets: '6',
          equipment: 'single-ply',
          readiness: 'uncertain',
          hardCut: 'yes',
          minimumJump: '2.5',
          maximumJump: '15',
          comparison: 'female',
          maximumSource: 'competition-single',
          evidenceAge: 'within-six-months',
        }),
        { personalRecord: '195', ceiling: '215', openerTested: 'yes' },
      ),
      {
        personalRecordTotal: '540',
        qualifyingTotal: '520',
        minimumAcceptableTotal: '480',
        stretchTotal: '560',
      },
    ),
  },
};

/**
 * Guided Estimate, where "where the figure came from" is not asked.
 *
 * The lifter has already described the set, and the answer is read off it. The
 * summary still names the evidence, though: it is still true, it still moves the
 * grade, and a summary that went quiet when the fields disappeared would tell the
 * lifter the question had stopped mattering.
 */
export const GuidedEstimate: Story = {
  args: {
    session: withExtras(
      acrossLifts(plannerSession({ method: 'guided-estimate' }), { guided: guidedSet() }),
      { evidenceAge: 'within-eight-weeks', readiness: 'normal' },
    ),
  },
};

/**
 * Known Opener, where the ceiling is asked for above rather than here.
 *
 * There is one ceiling per lift. Two fields for it would let a lifter answer one
 * and watch the other contradict it, and neither field would say which won.
 */
export const KnownOpener: Story = {
  args: { session: plannerSession({ method: 'known-opener' }) },
};

/** Pounds, and a push/pull meet -- two lifts, and every unit label follows. */
export const PoundsPushPull: Story = {
  args: { session: plannerSession({ unit: 'lb', format: 'push-pull' }) },
};

/**
 * A phone-width column, with answers long enough to wrap the summary.
 *
 * Constrained by a wrapper rather than by a viewport setting, because the wrapper
 * is what the element responds to (§5.7).
 */
export const Narrow: Story = {
  args: {
    session: withExtras(plannerSession(), {
      bodyweight: '92.5',
      equipment: 'single-ply',
      readiness: 'uncertain',
      comparison: 'female',
      evidenceAge: 'within-six-months',
    }),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-plan-extras .session=${args.session}></ptk-plan-extras>
    </div>
  `,
};
