// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The screen section 4.1 walks through, whose whole job is to be finished quickly.
 *
 * Another one worth pressing. The plan rows are internal state and appear only when an
 * exercise is added, so the first stories below document what the screen offers rather
 * than what a filled-in plan looks like -- tap a primary lift and the row, its counts and
 * its weight box appear, with the counts already seeded from the catalogue and the weight
 * left blank on purpose (section 7.4: a prefilled number is one a lifter has to notice
 * before they overwrite it).
 *
 * The warm-up stories press instead, because there is nothing else they could do: the tick
 * is drawn per row and this screen opens with no rows, so a story that only set
 * `equipment` would publish a page with the tick's whole subject missing from it. They add
 * exercises through the tiles and the picker, which is the same argument the root's
 * stories make at one screen's remove -- what is being documented is a control that
 * appears under some plans and not others, and reaching in to seed the plan would document
 * a row no sequence of taps produces.
 *
 * Every exercise here is a catalogue movement and no figure on this screen is a federation
 * figure (section 5.1); the seeded counts are the catalogue's own defaults.
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { CATALOG_EXERCISES, PRIMARY_EXERCISES } from '../core/catalog.js';

import { BUILDER_NOTES } from './copy.js';
import { WARMUP_FIELD } from './dataset.js';
import type { PtkWorkoutBuilder } from './ptk-workout-builder.js';
import { A_TRAINING_DAY, aKilogramRack } from './story.fixture.js';

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

/** The rendered builder, once its first paint is done. */
async function builder(canvasElement: HTMLElement): Promise<PtkWorkoutBuilder> {
  const element = canvasElement.querySelector('ptk-workout-builder');
  if (element === null) throw new Error('No builder rendered.');
  await element.updateComplete;
  return element;
}

/**
 * Presses a control and waits for the screen to settle.
 *
 * The inner `<button>` and not the host, for the reason the root's stories give: a click
 * dispatched at the host sails straight past a `disabled` control and publishes a screen a
 * lifter could not have produced. Add is disabled until the picker holds something, so
 * that is not hypothetical here.
 */
async function press(element: PtkWorkoutBuilder, selector: string): Promise<void> {
  const host = shadow(element).querySelector(selector);
  if (host === null) throw new Error(`Nothing on this screen matches ${selector}.`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  button.click();
  await element.updateComplete;
}

/** One of the four, in one tap, the way section 6.1 promises. */
async function addPrimary(element: PtkWorkoutBuilder, id: string): Promise<void> {
  await press(element, `[data-action="add-primary"][data-exercise="${id}"]`);
}

/**
 * Everything else: open the disclosure, choose, then press Add.
 *
 * Left open afterwards rather than closed again, because the picker is half of what the
 * mixed-list story is showing -- a reviewer has to see where the second exercise came
 * from to know it was not seeded.
 *
 * The value is read back before pressing. A `<select>` silently keeps the value it has
 * when handed one it has no option for, so an id this build's catalogue does not know
 * would otherwise add whatever the picker happened to be on.
 */
async function addFromPicker(element: PtkWorkoutBuilder, id: string): Promise<void> {
  const disclosure = shadow(element).querySelector('ptk-disclosure');
  if (disclosure === null) throw new Error('This screen has no picker.');
  const details = shadow(disclosure).querySelector('details');
  if (details === null) throw new Error('The picker does not open.');
  const summary = details.querySelector('summary');
  if (summary === null) throw new Error('The picker has nothing to press to open it.');
  if (!details.open) summary.click();
  await element.updateComplete;

  const host = shadow(element).querySelector('ptk-select');
  if (host === null) throw new Error('The picker holds no select.');
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error('The select has nothing to choose from.');
  select.value = id;
  if (select.value !== id) throw new Error(`The picker does not offer "${id}".`);
  // `change` and not `input`: `ptk-select` reports on change, and a script dispatching
  // only the other one moves nothing and then presses a still-disabled Add.
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;

  await press(element, '[data-action="add-picked"]');
}

/** How many rows carry the warm-up tick. The positive control every story below uses. */
function ticks(element: PtkWorkoutBuilder): number {
  return shadow(element).querySelectorAll(`[data-field="${WARMUP_FIELD}"]`).length;
}

/** Every note on the screen as one string, for asserting which explanation is up. */
function notes(element: PtkWorkoutBuilder): string {
  return [...shadow(element).querySelectorAll('p.note')].map((note) => note.textContent).join(' ');
}

/**
 * Polls until a condition holds, or fails naming what never happened.
 *
 * The tick is drawn by this element but rendered by `ptk-toggle-group`, and a row added
 * during a play function is a child that did not exist when the host's promise was
 * created -- so `updateComplete` can resolve on the render that introduces the group
 * rather than the one that fills it.
 */
async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = performance.now() + PATIENCE_MILLIS;
  while (!holds()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const meta: Meta<PtkWorkoutBuilder> = {
  title: 'Training logbook/Workout builder',
  component: 'ptk-workout-builder',
  tags: ['autodocs'],
  args: {
    // A literal, never the clock. A story that defaulted the date field to today would
    // document a different screen every day and could never be reviewed against itself.
    today: A_TRAINING_DAY,
    unit: 'kg',
    exercises: CATALOG_EXERCISES,
    // Spelled out rather than left off. `undefined` is not `null`, and an arg the render
    // binds but the meta never declares would hand the property a third value that the
    // "is there a rack" question has no answer for.
    equipment: null,
  },
  render: (args) => html`
    <ptk-workout-builder
      .today=${args.today}
      .unit=${args.unit}
      .exercises=${args.exercises}
      .equipment=${args.equipment}
    ></ptk-workout-builder>
  `,
};

export default meta;

type Story = StoryObj<PtkWorkoutBuilder>;

/**
 * The screen as it opens: a date, an optional name, four tiles and a picker.
 *
 * The four competition lifts are on the page rather than behind the picker because they
 * are what most sessions start with, and the sentence beside them exists because four
 * tiles with no framing read as the only four the tool knows. The plan below them is empty
 * and says so -- an empty list under a Start button reads as a broken screen.
 */
export const EmptyPlan: Story = {};

/**
 * The display in pounds.
 *
 * Only the weight boxes change. Section 11.4: this setting decides what new entries are
 * typed in and converts nothing that is already recorded, which is a promise the builder
 * keeps by never having anything recorded on it.
 */
export const InPounds: Story = {
  args: { unit: 'lb' },
};

/**
 * A catalogue holding only the four competition lifts.
 *
 * What a consumer supplying its own exercise list gets. The picker still renders, with the
 * primaries already on the page above it, and the screen does not pretend there is more
 * behind it than there is.
 */
export const OnlyTheCompetitionLifts: Story = {
  args: { exercises: PRIMARY_EXERCISES },
};

/**
 * No exercises at all, which is what a consumer that passes an empty list produces.
 *
 * Not a state the shipped tool reaches -- it hands over the built-in catalogue -- and
 * worth documenting for exactly that reason: the picker says nobody has given it anything
 * to choose from rather than rendering an empty control that looks broken.
 */
export const NoCatalogue: Story = {
  args: { exercises: [] },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by
 * a viewport parameter -- the wrapper is what the element responds to, and a viewport
 * setting would document a screen the component never sees.
 *
 * The tight row is Sets, Reps and Weight side by side once an exercise is added; the four
 * primary tiles are the other one, and they are on an intrinsic grid rather than a fixed
 * column count so they reflow instead of overflowing.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-workout-builder
        .today=${args.today}
        .unit=${args.unit}
        .exercises=${args.exercises}
        .equipment=${args.equipment}
      ></ptk-workout-builder>
    </div>
  `,
};

/**
 * A squat on a rack, which is the one arrangement that draws the tick.
 *
 * Both halves of section 8.2's condition are satisfied here and the whole point of the
 * story is that they are: the row is a barbell lift the calculator has a family for, and
 * a bar and plates exist to work up on. Unticked, because a warm-up is work a lifter
 * chooses to do and a plan that quietly added sets to it would be the tool deciding what
 * the session is.
 *
 * No note above Start. Every row on this plan can be ramped and there is a rack, so the
 * tick's own description is the entire explanation -- a sentence saying so as well would
 * be the screen answering a question nobody asked.
 */
export const WithAWarmupTick: Story = {
  args: { equipment: aKilogramRack() },
  play: async ({ canvasElement }) => {
    const element = await builder(canvasElement);
    await addPrimary(element, 'squat');
    await until('the warm-up tick to appear', () => ticks(element) === 1);
  },
};

/**
 * The same squat with no rack set up, where the tick is absent and a sentence says why.
 *
 * The state a lifter reaches first, since a rack is the one input the tool cannot guess.
 * Nothing here is disabled: a ticked-out control is a dead control on a primary journey
 * (root 0.4), so the tick is not drawn at all and the note names the screen that fixes it
 * instead. Worth reviewing beside the story above -- the difference between them is one
 * property, and the screens should not read as one being broken.
 */
export const WithoutARack: Story = {
  play: async ({ canvasElement }) => {
    const element = await builder(canvasElement);
    await addPrimary(element, 'squat');
    await until('the rack note to appear', () =>
      notes(element).includes(BUILDER_NOTES.warmupNeedsRack),
    );
    if (ticks(element) !== 0) throw new Error('There is no rack, but a tick was drawn.');
  },
};

/**
 * A squat and a chin-up on a rack: one row with the tick and one without.
 *
 * The mix is the case the per-row condition exists for, and it is invisible on a plan of
 * one. A chin-up is not missing a feature -- there is no bar to work up on and no ramp to
 * generate -- so the row carries no tick and no apology, and the single note under the
 * rows says once what would otherwise be repeated under every accessory a lifter adds.
 *
 * The chin-up comes through the picker because that is where it is: only the four are on
 * the page without opening one.
 */
export const AMixedPlan: Story = {
  args: { equipment: aKilogramRack() },
  play: async ({ canvasElement }) => {
    const element = await builder(canvasElement);
    await addPrimary(element, 'squat');
    await addFromPicker(element, 'chin-up');
    await until('one row of the two to carry the tick', () => ticks(element) === 1);
    if (!notes(element).includes(BUILDER_NOTES.warmupNotEveryLift)) {
      throw new Error('A row cannot be ramped, but the screen does not say so.');
    }
  },
};

/**
 * The tick at the narrowest phone still in use (section 5.7), wrapped rather than
 * scrolled.
 *
 * Its own story because the tick is a list-layout toggle group and lands directly under
 * the Sets, Reps and Weight row -- the widest thing on the row and the tallest thing under
 * it, competing for the same 320 px. The label and its description each have to wrap
 * beside a tap target that stays a tap target. Constrained by a wrapper for the same
 * reason `Narrow` is: a viewport parameter would document a width the element never sees.
 */
export const NarrowWithAWarmupTick: Story = {
  args: { equipment: aKilogramRack() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-workout-builder
        .today=${args.today}
        .unit=${args.unit}
        .exercises=${args.exercises}
        .equipment=${args.equipment}
      ></ptk-workout-builder>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const element = await builder(canvasElement);
    await addPrimary(element, 'squat');
    await until('the warm-up tick to appear', () => ticks(element) === 1);
  },
};
