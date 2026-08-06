// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen a lifter reads between sets, with a belt on.
 *
 * This is the one worth pressing rather than looking at. Section 21's whole claim is that
 * logging a set is one tap, and a screenshot proves the button exists; tapping Done and
 * watching the row tick, the progress line move and an Undo appear in the same place is
 * the thing the claim is actually about. The finish panel is internal state and only
 * appears after Finish the workout is pressed -- deliberately, because it asks a question
 * (section 7.12) and a question with a preselected answer is not one.
 *
 * Every weight and every session here is invented (section 5.1).
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { PtkActiveWorkout } from './ptk-active-workout.js';
import {
  AT_LATER,
  aBodyweightSession,
  aKilogramRack,
  aSparseRack,
  aStartedSession,
  lastTimeForSquat,
} from './story.fixture.js';

// Through the package entry and behind an explicit call. See the note in the history
// stories: a relative import would define every tag a second time and the only symptom
// would be a console error.
defineTrainingLogbook();

const meta: Meta<PtkActiveWorkout> = {
  title: 'Training logbook/Active workout',
  component: 'ptk-active-workout',
  tags: ['autodocs'],
  args: {
    session: aStartedSession(),
    unit: 'kg',
    // Null by default, and that is the tool's own default rather than a story's
    // convenience: `settings.equipment` stays null until a lifter answers the equipment
    // section, so every story below except the two that say otherwise is the screen as
    // most people first meet it -- no diagram at all, which is the correct answer to a
    // rack nobody has described.
    equipment: null,
    // Empty by default rather than populated, so the stories below document the screen a
    // lifter meets on their first session -- which has no history behind it and therefore
    // no line. `LastTime` is the one that adds it.
    previous: new Map(),
    // Pinned. A story that read the clock would stamp a different instant on every set
    // completed in it, and two reviewers would be looking at different pages.
    now: () => AT_LATER,
  },
  render: (args) => html`
    <ptk-active-workout
      .session=${args.session}
      .unit=${args.unit}
      .equipment=${args.equipment}
      .previous=${args.previous}
      .now=${args.now}
    ></ptk-active-workout>
  `,
};

export default meta;

type Story = StoryObj<PtkActiveWorkout>;

/**
 * Six sets planned and none of them done yet, which is the page as the bar is loaded.
 *
 * Two exercises, because almost every layout question here is invisible with one: how the
 * second heading reads under the first exercise's last row, and where the progress line
 * sits relative to both. Every row offers Done and Change what you did, and nothing on the
 * page says what the lifter ought to do with them.
 */
export const JustStarted: Story = {};

/**
 * One set in, which is where the two states of a row can be compared.
 *
 * The completed row swaps Done for Undo in the same position rather than adding a control
 * beside it. A tap that cannot be taken back is a tap nobody makes confidently, and a tap
 * whose reversal is somewhere else on the page is nearly as bad with a barbell waiting.
 */
export const PartlyDone: Story = {
  args: { session: aStartedSession({ completed: 1 }) },
};

/**
 * Everything ticked, and still a Finish button rather than an automatic finish.
 *
 * The tool never decides a session is over. A workout with every planned set complete is a
 * workout a lifter may still add to, and one that closed itself would have to be reopened
 * -- which this version cannot do, and says so in the finish panel.
 */
export const AllSetsDone: Story = {
  args: { session: aStartedSession({ completed: 3, prefix: 'all' }) },
};

/**
 * Chin-ups, which record a rep count and no weight.
 *
 * The failure this story exists to make visible is silent: a set line that printed "Not
 * set" beside a bodyweight movement would be reporting a missing weight that is not
 * missing, and nothing about the page would look wrong. It reads "8 reps".
 */
export const Bodyweight: Story = {
  args: { session: aBodyweightSession() },
};

/**
 * The display switched to pounds over a session that was typed in kilograms.
 *
 * Section 11.4, and the reason it is a story rather than only a test: every recorded
 * weight still reads in kilograms, because that is what the lifter typed, and only the
 * boxes for new entries are in pounds. A tool that converted the history would round
 * somewhere new every time the setting was touched.
 */
export const ShownInPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * The same session once a rack has been described, which is what section 8.2 is for.
 *
 * The diagram is the answer to the question the row above it just asked, so it is drawn
 * under the head and above the editor -- a diagram below the editor would be off the bottom
 * of a phone on the one row a lifter has open. Under each is what has to *move* since the
 * set before it, and only where something moves: five sets across draws one instruction and
 * not five, because a line under each of the last four confirming that nothing has changed
 * is how a lifter learns to stop reading the one that matters.
 *
 * The plates are in the rack's unit and never in the reading unit. Compare `ShownInPounds`:
 * that story's weights read in pounds and its diagram, were it given a rack, would still
 * say kilograms -- a lifter who trains at a kilogram gym and thinks in pounds is ordinary,
 * and the two settings exist to keep those apart.
 */
export const WithPlates: Story = {
  args: {
    session: aStartedSession({ completed: 1, prefix: 'plates' }),
    equipment: aKilogramRack(),
  },
};

/**
 * A rack that can build one of the two weights and not the other.
 *
 * Both halves on one page, which is the only way to judge either. The squat draws its
 * plates; the bench says the rack cannot make 70 kg and names what it can make either side,
 * because a bare "these plates cannot build that" leaves a lifter working out what to type
 * while standing at the bar. Nothing is blocked and nothing is rounded -- section 8.3 warns,
 * and the weight stays exactly as it was entered.
 *
 * Not coloured as an error for the same reason. A lifter five kilograms off a number their
 * plates make easily has a working session, and red would say otherwise.
 */
export const NotLoadable: Story = {
  args: { session: aStartedSession({ prefix: 'sparse' }), equipment: aSparseRack() },
};

/**
 * What the squat was last done for, above the sets about to be done again. Section 7.8.
 *
 * One line, above the rows rather than below them: it is context for the numbers a lifter
 * is about to type, and on a phone anything after the last set is off the bottom of the
 * screen by the time it would matter.
 *
 * Both halves are on the page at once, which is the point of the story. The squat carries
 * a line and the bench press carries none, because the bench has no completed history and
 * section 7.8 asks for nothing rather than an empty panel -- a state that is impossible to
 * review against a page where every exercise has an answer.
 *
 * Nothing on the line compares the two days. 95 kg for 5, 5, 4 sits above a plan for 100,
 * and the tool says only what happened; the lifter draws the conclusion. Section 15.3.
 */
export const LastTime: Story = {
  args: { previous: lastTimeForSquat() },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * The hardest row in the tool: a set kind, a weight and rep count, two buttons that each
 * have to keep a 44-pixel tap target (48 in this flow, which is the one a lifter uses with
 * cold hands), and a rack, because a row of plate faces is a run of fixed widths in a
 * column that has none to spare. It wraps rather than pushing the page sideways, and this
 * is where that is visible without running the layout check.
 */
export const Narrow: Story = {
  args: {
    session: aStartedSession({ completed: 1, prefix: 'narrow' }),
    equipment: aKilogramRack(),
    // Carried here as well as in `LastTime`, because the last-time line is the longest
    // unbreakable-looking run of text on the screen and 320 pixels is where it either
    // wraps or takes the page sideways with it.
    previous: lastTimeForSquat(),
  },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-active-workout
        .session=${args.session}
        .unit=${args.unit}
        .equipment=${args.equipment}
        .previous=${args.previous}
        .now=${args.now}
      ></ptk-active-workout>
    </div>
  `,
};
