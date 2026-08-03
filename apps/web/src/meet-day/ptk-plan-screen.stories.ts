// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import {
  CHARTED_CONTEXT,
  acrossLifts,
  confirmAll,
  guidedSet,
  plannerSession,
  viewFor,
} from './planner-fixture.js';
import { withExtras, withTargetTotal, type PlannerSession } from './session.js';
import type { PtkPlanScreen } from './ptk-plan-screen.js';
import './ptk-plan-screen.js';

/**
 * The plan, and every state a lifter can find it in.
 *
 * The stories below are chosen so that the two things §10 keeps apart are visible
 * apart. `EveryRiskWord` moves the risk axis with the confidence grade held at its
 * opening value, and `WellDescribed` moves the grade with three Recommended
 * attempts underneath it -- so a reviewer can see that neither one drags the
 * other, which is the property a screenshot can show and a sentence cannot.
 *
 * The rest are the states that are easy to get wrong because they are rare:
 * nothing typed, a figure not yet agreed to, a rounding note, a jump the research
 * calls wide, a target nothing can reach, and the two halves of §16's pound
 * column.
 *
 * Every view here comes out of `buildPlan`, so no story can show a plan the rules
 * would refuse.
 */

/** The session and the plan drawn from it, which must always be the same pair. */
function shown(
  session: PlannerSession,
  context?: Parameters<typeof viewFor>[1],
): { session: PlannerSession; view: ReturnType<typeof viewFor> } {
  return { session, view: viewFor(session, context) };
}

/** Expected Max, agreed to: the shape almost every story below is a variation on. */
function planned(): PlannerSession {
  return confirmAll(acrossLifts(plannerSession(), { expectedMaximum: '200' }));
}

const meta: Meta<PtkPlanScreen> = {
  title: 'Meet day/Plan screen',
  component: 'ptk-plan-screen',
  tags: ['autodocs'],
  argTypes: {
    session: {
      control: false,
      description: 'The answers. Read for the display unit and for nothing else.',
    },
    view: {
      control: false,
      description: 'The plan. Everything on screen is a label for something in here.',
    },
  },
  args: shown(planned()),
  render: (args) => html`
    <ptk-plan-screen .session=${args.session} .view=${args.view}></ptk-plan-screen>
  `,
};

export default meta;

type Story = StoryObj<PtkPlanScreen>;

/**
 * Three attempts a lift, from a maximum the lifter has agreed to.
 *
 * The ordinary case, and the one worth reading the two explanations at the top
 * against: three Recommended attempts under a Low grade is a coherent plan, and
 * the whole job of that panel is to say so before a reader averages the two.
 */
export const Planned: Story = {};

/**
 * Nothing typed, which is what the screen paints on first load.
 *
 * The sentence under each lift says the plan fills in as the form does. A warning
 * here would open by telling the lifter off for not having answered a form they
 * have just been shown.
 */
export const Awaiting: Story = {
  args: shown(plannerSession()),
};

/**
 * A figure on screen and the tick still open.
 *
 * §7 will not plan from a maximum nobody underwrote, so there are no attempts --
 * and the line says the figure it is waiting on rather than going blank, because a
 * lift that renders nothing reads as a lift the tool has forgotten.
 */
export const AwaitingConfirmation: Story = {
  args: shown(acrossLifts(plannerSession(), { expectedMaximum: '200' })),
};

/**
 * All four of §10.2's words on one screen, with the grade held still.
 *
 * Typed attempts of 180, 195 and 215 against a volunteered 200 kg maximum, so the
 * three rows are Recommended, Push and Long shot while every confidence reason
 * below them is the same as in `Planned`. The risk axis moved and the other one
 * did not, which is the point.
 */
export const EveryRiskWord: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'manual' }), {
      attempts: ['180', '195', '215'],
      expectedMaximum: '200',
    }),
  ),
};

/**
 * The other end of the risk axis: a first meet, planned to be made.
 *
 * §6.3's First Meet preset opens at the bottom of the table, so all three attempts
 * come back Secure. Worth keeping beside `EveryRiskWord` because Secure is the one
 * word of the four that never appears in an ordinary plan.
 */
export const SecureThroughout: Story = {
  args: shown(
    confirmAll(acrossLifts(plannerSession({ goal: 'first-meet' }), { expectedMaximum: '200' })),
  ),
};

/**
 * Typed attempts with no maximum behind them, one of them illegal.
 *
 * Manual entry without a volunteered maximum has nothing to grade against, so
 * there is no risk word at all rather than a fabricated one -- and this is the
 * story that shows a row with the chip missing. The half-kilogram second attempt
 * is under the fixture federation's one-kilogram minimum progression, so the
 * refusal states the rule rather than moving the weight.
 */
export const RefusedAttempt: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'manual' }), { attempts: ['180', '180.5', '190'] }),
  ),
};

/**
 * §9.1's rounding, in both directions on one lift.
 *
 * A target total lands the attempts between two legal bar weights, and the notes
 * carry the domain's own sentences: the opener rounds down so it stays the attempt
 * it was meant to be, the second rounds to the nearest. §5.5 makes the direction a
 * safety property, so the note has to name it.
 */
export const RoundingNotes: Story = {
  args: shown(
    confirmAll(
      withTargetTotal(
        acrossLifts(plannerSession({ method: 'target-total' }), {
          expectedMaximum: '200',
          ceiling: '225',
        }),
        '540',
      ),
    ),
  ),
};

/**
 * §9.3's jump warnings, each with what the research was measured on.
 *
 * A 250 kg squat planned on the female dataset takes jumps of 12.5 and 10 kg,
 * both above the ranges reported for that group. The evidence note rides with each
 * advisory rather than being said once for the lift, and it says the figures may
 * not fit this lifter -- which §9.3 requires whether or not the lifter is in the
 * measured population.
 */
export const ResearchWarning: Story = {
  args: shown(
    confirmAll(
      withExtras(acrossLifts(plannerSession(), { expectedMaximum: '250' }), {
        comparison: 'female',
      }),
    ),
  ),
};

/**
 * §7.5's split, against a total the ceilings cannot hold.
 *
 * Two of the advisories are strong and say plainly that wanting a total is not
 * evidence the lifts are there. The shortfall is stated as a figure rather than
 * implied by three subtotals a lifter would have to add up.
 */
export const TargetOutOfReach: Story = {
  args: shown(
    confirmAll(
      withTargetTotal(
        acrossLifts(plannerSession({ method: 'target-total' }), {
          expectedMaximum: '200',
          ceiling: '205',
        }),
        '700',
      ),
    ),
  ),
};

/**
 * The confidence axis at the top of its range, with the risk axis unmoved.
 *
 * A competition-standard single from the last eight weeks, in the meet's
 * equipment, with a tested opener and meet history behind it. Every attempt is
 * still Recommended: being well described is not the same as being ambitious, and
 * this is the pair of screenshots that shows it.
 */
export const WellDescribed: Story = {
  args: shown(
    confirmAll(
      withExtras(
        acrossLifts(plannerSession({ method: 'guided-estimate' }), {
          guided: guidedSet({ reps: '1', repsInReserve: 0 }),
          openerTested: 'yes',
        }),
        { readiness: 'normal', priorMeets: '4' },
      ),
    ),
  ),
};

/**
 * §16's pound column, read off the federation's chart.
 *
 * Attempts of 180, 195 and 215 kg all name rows in the fixture chart, so each one
 * carries the figure the federation prints. 180 kg is published as 396.9 lb where
 * the arithmetic gives 396.83 -- the gap is the reason the rule exists, because
 * the number on the expeditor's table is the chart's and not the tool's.
 */
export const PublishedPounds: Story = {
  args: shown(
    acrossLifts(plannerSession({ method: 'manual' }), {
      attempts: ['180', '195', '215'],
      expectedMaximum: '200',
    }),
    CHARTED_CONTEXT,
  ),
};

/**
 * The same chart, and a plan that lands between its rows.
 *
 * A published chart is coarser than the bar, so an ordinary plan has some attempts
 * on a row and some between two. The third attempt quotes the chart; the opener
 * and the second are labelled approximate, with one sentence for the lift saying
 * why rather than the same sentence under each of them.
 */
export const BetweenChartRows: Story = {
  args: shown(planned(), CHARTED_CONTEXT),
};

/**
 * A phone-width column, on the plan that says the most.
 *
 * Constrained by a wrapper rather than by a viewport setting, because the wrapper
 * is what the element responds to (§5.7). The attempt line is where this bites: a
 * name, a weight and a risk word have to wrap inside the row rather than push the
 * card sideways.
 */
export const Narrow: Story = {
  args: shown(
    confirmAll(
      withExtras(acrossLifts(plannerSession(), { expectedMaximum: '250' }), {
        comparison: 'female',
      }),
    ),
  ),
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-plan-screen .session=${args.session} .view=${args.view}></ptk-plan-screen>
    </div>
  `,
};
