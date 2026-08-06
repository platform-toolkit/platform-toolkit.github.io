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
 * WHY THE NOTE STORIES PRESS
 *
 * Section 7.9's notes are half property and half internal state. What is stored arrives
 * on the session and every one of those pages is set below by argument; which box is
 * *open* is `noting`, reachable only by pressing the Note button, and the finish panel's
 * box is behind `finishing` in the same way. So those stories drive the controls, and the
 * harness is the one in `ptk-workout-builder.stories.ts` function for function -- a second
 * shape for the same job is how two files in one directory come to disagree about what a
 * press is.
 *
 * Every weight and every session here is invented (section 5.1). So are the notes: they
 * are written the way a lifter writes one, about a bar and a knee sleeve, because a note
 * reading "test note" documents the box and not the screen.
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { setExerciseNote, setWorkoutNote, type SessionContext } from '../core/session.js';
import type { LogbookId, WorkoutSession } from '../types.js';

import { exerciseNoteKey } from './dataset.js';
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

/** How long a play function waits for the screen to answer before giving up. */
const PATIENCE_MILLIS = 2000;

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** The rendered screen, once its first paint is done. */
async function loggingScreen(canvasElement: HTMLElement): Promise<PtkActiveWorkout> {
  const element = canvasElement.querySelector('ptk-active-workout');
  if (element === null) throw new Error('No logging screen rendered.');
  await element.updateComplete;
  return element;
}

/**
 * Presses a control and waits for the screen to settle.
 *
 * The inner `<button>` and not the host, for the reason the other two story files in this
 * directory give: a click dispatched at the host is dispatched by the script rather than
 * by the platform, so it sails straight past a `disabled` control and publishes a screen a
 * lifter could not have produced.
 */
async function press(element: PtkActiveWorkout, selector: string): Promise<void> {
  const host = shadow(element).querySelector(selector);
  if (host === null) throw new Error(`Nothing on this screen matches ${selector}.`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  button.click();
  await element.updateComplete;
}

/**
 * Polls until a condition holds, or fails naming what never happened.
 *
 * A box opened during a play function is a child that did not exist when the host's
 * promise was created, so `updateComplete` can resolve on the render that introduces it
 * rather than the one that fills it.
 */
async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = performance.now() + PATIENCE_MILLIS;
  while (!holds()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** How many note boxes are on the screen. Never two: see the finish stories. */
function noteBoxes(element: PtkActiveWorkout): number {
  return shadow(element).querySelectorAll('ptk-text-area').length;
}

/**
 * What the note box inside one part of the screen holds.
 *
 * Read off the inner `<textarea>` rather than off the host's `value`, because the
 * property is what the template asked for and the box is what a lifter is looking at --
 * and the claim these stories make is that those two agree.
 */
function noteBoxText(element: PtkActiveWorkout, within: string): string {
  const part = shadow(element).querySelector(within);
  if (part === null) throw new Error(`This screen has no ${within}.`);
  // Two steps rather than one compound selector: a compound `querySelector` types as
  // `Element` and would need the cast section 2.4 forbids.
  const host = part.querySelector('ptk-text-area');
  if (host === null) throw new Error(`Nothing inside ${within} is a note box.`);
  const box = shadow(host).querySelector('textarea');
  if (box === null) throw new Error('The note box has nothing to type in.');
  return box.value;
}

/** Every stored note read back to the lifter, as the muted lines they are drawn as. */
function written(element: PtkActiveWorkout): string[] {
  return [...shadow(element).querySelectorAll('p.written')].map((line) => line.textContent);
}

/**
 * The context the two core note setters need, and nothing more.
 *
 * `nextId` throws for the same reason the element's own does: writing a note creates no
 * object, so a generator that answered would be answering a question nobody asked. `at`
 * is a literal, like every other instant in these stories.
 */
function noteContext(): SessionContext {
  return {
    nextId: (): LogbookId => {
      throw new Error('Writing a note creates nothing.');
    },
    at: AT_LATER,
  };
}

/**
 * A session with a note on it, put there by the core rather than typed out.
 *
 * `story.fixture.ts` has no note builder and cannot grow one usefully -- what varies
 * between the pages below is the *text*, and a fixture parameterised on a string is the
 * string with two more layers around it. Going through `setWorkoutNote` is what matters,
 * and it is what keeps these sessions honest: the setter trims, and a hand-written
 * `note: '  '` would render a line the tool would never have stored.
 */
function withWorkoutNote(session: WorkoutSession, text: string): WorkoutSession {
  return setWorkoutNote(session, text, noteContext());
}

/**
 * The same for one lift, named by position.
 *
 * By position because the fixture mints its identifiers and a story that spelled one out
 * would be a story that stops finding its exercise the day a prefix changes.
 */
function withLiftNote(session: WorkoutSession, index: number, text: string): WorkoutSession {
  return setExerciseNote(session, liftAt(session, index).id, text, noteContext());
}

/** The `data-note` key naming one lift's note, read off the session rather than guessed. */
function liftNoteKey(session: WorkoutSession, index: number): string {
  return exerciseNoteKey(liftAt(session, index).id);
}

function liftAt(session: WorkoutSession, index: number): WorkoutSession['exercises'][number] {
  const exercise = session.exercises[index];
  if (exercise === undefined) throw new Error(`the fixture has no exercise ${String(index)}`);
  return exercise;
}

/** What a lifter actually writes: the room, the kit, the thing to remember. */
const A_WORKOUT_NOTE = 'Warm room, belt on from the third set. Left knee sleeve keeps slipping.';

const A_SQUAT_NOTE = 'Depth fine. Bar drifting forward on the last rep of every set.';

/**
 * The filename, which is the unbroken token the long note is here to break.
 *
 * Sixty-three characters and no hyphen anywhere in it, deliberately: a hyphen is a break
 * opportunity, so a hyphenated run would wrap on its own and prove nothing about
 * `overflow-wrap`. This is the shape a real one takes -- something pasted in from a phone
 * that names a file rather than a word.
 */
const A_VIDEO_FILENAME = 'squatsetthreefromthesidecameraangleuploadedtothecoachfolder2026';

/** Three thoughts, written as three, with the filename at the end of the last. */
const A_LONG_NOTE = [
  'Bad night, four hours, and it showed on the second set. Took the third down',
  'to a single at the same weight rather than grind out three.',
  '',
  'Right hip pinched coming out of the hole on the last two reps. Same as the',
  'week before last, same side, so it is worth writing down twice.',
  '',
  `Video is ${A_VIDEO_FILENAME}`,
].join('\n');

/**
 * The session the closed-box and open-box lift stories share.
 *
 * One value for both so that the pair is the same page twice, differing only by whether
 * the box is open -- and so the `data-note` key the play function presses is read off the
 * very session being rendered.
 */
const A_SESSION_WITH_A_LIFT_NOTE = withLiftNote(
  aStartedSession({ prefix: 'lift-note' }),
  0,
  A_SQUAT_NOTE,
);

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
 * A note on the session and none on either lift. Section 7.9.
 *
 * At the foot, under the last set and beside Finish, because that is when it is written:
 * a workout note is what a lifter types with the bar back on the rack, and one kept at the
 * top would push the first lift off a phone every time the screen was opened.
 *
 * It is drawn as the lifter's own sentence and not as a mark saying a note exists. A badge
 * would ask somebody to open a fold to find out whether it was worth opening, which for
 * two lines of their own words it never is.
 */
export const WithAWorkoutNote: Story = {
  args: {
    session: withWorkoutNote(aStartedSession({ prefix: 'workout-note' }), A_WORKOUT_NOTE),
  },
};

/**
 * The squat carries a note and the bench press carries nothing at all.
 *
 * The bench press is the point. A lift with no note draws no element -- not an empty
 * paragraph, not a placeholder inviting one -- and that is indistinguishable from a
 * working screen on a page where every lift has been written about, which is why both
 * halves are here at once.
 *
 * The play function counts the lines for the same reason: a `<p class="written">` holding
 * an empty string is a blank few pixels nobody would query in a screenshot.
 */
export const NotesOnSomeLifts: Story = {
  args: { session: A_SESSION_WITH_A_LIFT_NOTE },
  play: async ({ canvasElement }) => {
    const element = await loggingScreen(canvasElement);
    await until('the squat note to be read back', () => written(element).length > 0);
    const lines = written(element);
    if (lines.length !== 1) {
      throw new Error(`One lift has a note, but ${String(lines.length)} lines were drawn.`);
    }
  },
};

/**
 * Three paragraphs and one unbroken sixty-three-character word, at 320 px.
 *
 * Two claims, and neither is visible at a comfortable width. `white-space: pre-wrap` keeps
 * the blank lines, because a note typed as three thoughts was meant as three and a note
 * reflowed into one block is a different note. `overflow-wrap: anywhere` breaks the video
 * filename mid-word rather than letting one token decide the width of the card and take
 * the whole page sideways with it -- the failure section 5.7 is about, and the one that
 * cannot happen at a width where the token fits anyway.
 *
 * On the lift rather than on the session, so it sits between a heading and a list of sets
 * instead of at the foot: that is the tighter place for it, and it is on screen without
 * scrolling. Constrained by a wrapper rather than by a viewport parameter, like `Narrow`
 * below -- the wrapper is what the element responds to.
 */
export const ALongNote: Story = {
  args: {
    session: withLiftNote(aStartedSession({ prefix: 'long-note' }), 0, A_LONG_NOTE),
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

/**
 * The squat's note box open, which is the only way to see one.
 *
 * `noting` is internal state and the Note button is the only thing that sets it, so this
 * presses it. Worth reading against `NotesOnSomeLifts`, which is the same session with the
 * box shut: the box replaces the written line rather than sitting under it, because two
 * copies of one note on a screen is how the wrong one gets typed into.
 *
 * It opens holding what is already stored, so a first keystroke appends rather than
 * discards, and nothing is pressed to keep it -- the text is written half a second after
 * the last keystroke and immediately on leaving the box (section 10.2).
 */
export const WritingALiftNote: Story = {
  args: { session: A_SESSION_WITH_A_LIFT_NOTE },
  play: async ({ canvasElement }) => {
    const element = await loggingScreen(canvasElement);
    const key = liftNoteKey(A_SESSION_WITH_A_LIFT_NOTE, 0);
    await press(element, `[data-action="note"][data-note="${key}"]`);
    await until('the note box to open', () => noteBoxes(element) === 1);
    if (noteBoxText(element, '.exercise') !== A_SQUAT_NOTE) {
      throw new Error('The box opened without the note that is already stored.');
    }
    if (written(element).length !== 0) {
      throw new Error('The note is both open in a box and read back beneath it.');
    }
  },
};

/**
 * The finish panel over a session that already carries a note. Section 7.12.4.
 *
 * The panel draws its box open, always, and it picks up whatever is stored. A last chance
 * at a note that hid the one already written would be worth less than nothing: the lifter
 * types, and the panel is the thing that dispatches the finished session.
 *
 * The foot surface is withdrawn while the panel is up, which is what the box count checks.
 * Two boxes for one note is one of them silently losing.
 */
export const FinishingWithANoteAlready: Story = {
  args: {
    session: withWorkoutNote(aStartedSession({ prefix: 'finish-note' }), A_WORKOUT_NOTE),
  },
  play: async ({ canvasElement }) => {
    const element = await loggingScreen(canvasElement);
    await press(element, '[data-action="finish"]');
    await until('the finish panel to draw its note box', () => noteBoxes(element) === 1);
    if (noteBoxText(element, '.finish') !== A_WORKOUT_NOTE) {
      throw new Error('The finish panel did not pick up the note already written.');
    }
  },
};

/**
 * The same panel with nothing written, where the box is drawn anyway.
 *
 * The half most likely to be got wrong, because a box that only appeared over a note that
 * already existed would be a control visible only to somebody who had already found it.
 * Empty, labelled, and no more insistent than that: the panel asks about the outstanding
 * sets and mentions the note without asking anything about it.
 */
export const FinishingWithNoNote: Story = {
  args: { session: aStartedSession({ prefix: 'finish-blank' }) },
  play: async ({ canvasElement }) => {
    const element = await loggingScreen(canvasElement);
    await press(element, '[data-action="finish"]');
    await until('the finish panel to draw its note box', () => noteBoxes(element) === 1);
    if (noteBoxText(element, '.finish') !== '') {
      throw new Error('Nothing was written, but the box opened holding something.');
    }
  },
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
