// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { acrossLifts, confirmAll, guidedSet, plannerSession, viewFor } from './planner-fixture.js';
import { withTargetTotal, type PlannerSession } from './session.js';
import type { PtkPlanMethod } from './ptk-plan-method.js';
import './ptk-plan-method.js';

/**
 * §7's five ways in, and the gate at the end of three of them.
 *
 * There is one story per method because the whole of what changes between them
 * is which fields are on screen -- and the thing worth reviewing is that each
 * set asks for information the lifter already has, rather than for the tool's
 * internal vocabulary. "I know my openers", not "opener inversion".
 *
 * The confirmation row is the other reason for the stories below. §7.1 and §7.5
 * will not plan from a figure the lifter has not underwritten, so the interesting
 * states are the three in sequence: nothing typed, a figure on screen with the
 * tick still open, and the same figure agreed to. A story that jumped from the
 * first to the third would leave the state the gate exists for unreviewed.
 *
 * Every view here comes out of `buildPlan`, never from a literal, so a story
 * cannot show a plan the rules would refuse.
 */

/** The session and the plan drawn from it, which must always be the same pair. */
function shown(session: PlannerSession): {
  session: PlannerSession;
  view: ReturnType<typeof viewFor>;
} {
  return { session, view: viewFor(session) };
}

const meta: Meta<PtkPlanMethod> = {
  title: 'Meet day/Plan method',
  component: 'ptk-plan-method',
  tags: ['autodocs'],
  argTypes: {
    session: {
      control: false,
      description: 'The whole session. This element renders it and owns none of it.',
    },
    view: {
      control: false,
      description: 'The plan as far as the answers reach, so a confirmation row can name a figure.',
    },
  },
  args: shown(plannerSession()),
  render: (args) => html`
    <ptk-plan-method .session=${args.session} .view=${args.view}></ptk-plan-method>
  `,
};

export default meta;

type Story = StoryObj<PtkPlanMethod>;

/**
 * Expected Max with nothing typed, which is where the tool opens.
 *
 * §7.1's four warnings are carried in full because this is the default method
 * and its one input is the number a lifter is most likely to overstate. No
 * confirmation row: a tick beside an empty field asks the lifter to agree to
 * nothing, and it would stay ticked while they typed.
 */
export const ExpectedMax: Story = {};

/**
 * A figure typed, and the gate open.
 *
 * The row names the weight rather than saying "confirm this", because what is
 * being agreed to is a claim about the day -- and it says plainly that nothing
 * is planned for the lift until it is ticked.
 */
export const AwaitingConfirmation: Story = {
  args: shown(acrossLifts(plannerSession(), { expectedMaximum: '200' })),
};

/** The same figures, agreed to. The plan itself is drawn further down the screen. */
export const Confirmed: Story = {
  args: shown(confirmAll(acrossLifts(plannerSession(), { expectedMaximum: '200' }))),
};

/**
 * §7.2's six questions about one recent set.
 *
 * The estimate is the tool's, so the confirmation row here is doing the most
 * work of anywhere in the method: the lifter is underwriting a figure they did
 * not choose.
 */
export const GuidedEstimate: Story = {
  args: shown(acrossLifts(plannerSession({ method: 'guided-estimate' }), { guided: guidedSet() })),
};

/**
 * §7.3: the opener is already decided, and the tool works backwards.
 *
 * A 180 kg opener is the Balanced band's 91%, so it implies just under 198 kg,
 * and a 215 kg ceiling is well clear of that -- the note says so, because a
 * ceiling the plan never approaches is a lifter who has either aimed low or typed
 * the wrong number, and the tool cannot tell which.
 */
export const KnownOpener: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'known-opener' }), { opener: '180', ceiling: '215' }),
  ),
};

/**
 * The same opener, under a ceiling below what it implies.
 *
 * The notes are the arithmetic, and this is the disagreement they exist for. The
 * opener wins -- planning from the ceiling would put 91% of the *ceiling* on the
 * bar, which is lighter than the opener the lifter typed -- so the ceiling clamps
 * what comes after it and the note says plainly that it did.
 */
export const OpenerAboveTheCeiling: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'known-opener' }), { opener: '180', ceiling: '195' }),
  ),
};

/**
 * §7.4: all three typed.
 *
 * No confirmation row, because there is no estimate to underwrite -- nothing
 * here moves a weight the lifter chose. What the tool does instead is check them
 * against the rule book, which happens on the plan screen.
 */
export const Manual: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'manual' }), { attempts: ['180', '195', '205'] }),
  ),
};

/**
 * §7.5: one total for the meet, divided between the lifts.
 *
 * The target sits above the lifts because it belongs to the meet rather than to
 * any one of them, and the ceiling is asked for here rather than in §8's fold:
 * under this method it pins the split rather than merely capping a third.
 */
export const TargetTotal: Story = {
  args: shown(
    withTargetTotal(
      acrossLifts(plannerSession({ method: 'target-total' }), {
        expectedMaximum: '200',
        ceiling: '225',
      }),
      '540',
    ),
  ),
};

/**
 * A figure that is not a number.
 *
 * The field keeps what was typed -- a lifter cannot correct a value the tool has
 * thrown away -- and the refusal is stated under the lift rather than replacing
 * the form.
 */
export const UnreadableFigure: Story = {
  args: shown(acrossLifts(plannerSession(), { expectedMaximum: '19o' })),
};

/**
 * A phone-width column, on the method that asks the most questions.
 *
 * Constrained by a wrapper rather than by a viewport setting, because the
 * wrapper is what the element responds to (§5.7).
 */
export const Narrow: Story = {
  args: shown(acrossLifts(plannerSession({ method: 'guided-estimate' }), { guided: guidedSet() })),
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-plan-method .session=${args.session} .view=${args.view}></ptk-plan-method>
    </div>
  `,
};
