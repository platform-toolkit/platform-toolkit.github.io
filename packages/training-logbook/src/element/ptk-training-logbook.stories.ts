// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, in the states a lifter opens it in.
 *
 * The composite root is the one element here worth *pressing* rather than looking at.
 * Three of the four tags live inside its shadow root and the only thing connecting them is
 * composed events, so a screenshot proves the markup exists; planning a squat session and
 * watching it appear on a logging screen two shadow roots down proves the tool works, and
 * that distinction is what section 21 is about.
 *
 * WHY THE STORIES BELOW PRESS RATHER THAN SEED
 *
 * Every screen after the first is reached through the controls and never by setting a
 * property, for the same reason the browser suite does it that way: the path between the
 * builder's shadow root and the logging screen's is the tool, and a story that assembled a
 * session itself would document a screen that no sequence of taps can reach. It also means
 * a story that stops working is a tool that stopped working.
 *
 * WHY THE CLOCK, THE DAY AND THE IDENTIFIERS ARE ALL LITERALS
 *
 * A story that read the clock would document a different page every time it was opened,
 * and the duration on the finished screen would grow by a minute a minute. The identifiers
 * count up so that a reviewer reading the DOM can trace `new-4` to the fourth thing the
 * page created; `crypto.randomUUID()` is right in production and unreadable here.
 *
 * Every weight is invented (section 5.1).
 */
import { defineTrainingLogbook } from '@platform-toolkit/training-logbook/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { Instant } from '../types.js';

import { SAVE_STATES } from './copy.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';
import { AT_START, A_TRAINING_DAY, aFreshTool, anUnstoredRepository } from './story.fixture.js';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// four tags a second time: the registry throws on the second write, the story still looks
// right because the first definition already won, and the only symptom is a console error
// -- which `smoke-stories.mjs` fails on, for exactly this reason.
defineTrainingLogbook();

/** How long a play function waits for the tool to answer before giving up. */
const PATIENCE_MILLIS = 2000;

function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (root === null) throw new Error(`<${element.localName}> has not rendered.`);
  return root;
}

/** Everything matching a selector, at any shadow depth below a root. */
function deepAll(root: DocumentFragment | HTMLElement, selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: DocumentFragment | HTMLElement): void => {
    for (const child of node.querySelectorAll('*')) {
      if (child instanceof HTMLElement && child.matches(selector)) found.push(child);
      if (child.shadowRoot !== null) visit(child.shadowRoot);
    }
  };
  visit(root);
  return found;
}

/** Polls until a condition holds, or fails naming what never happened. */
async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = performance.now() + PATIENCE_MILLIS;
  while (!holds()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Waits for the tool to stop saying it is mid-save.
 *
 * Every write is started from an event handler and awaited nowhere a caller can see, so
 * `updateComplete` resolves on the render *before* the store answers. The storage line is
 * the tool's own report of that write, which makes waiting for it to leave "Saving" the
 * honest wait rather than a sleep.
 */
async function settled(element: PtkTrainingLogbook): Promise<void> {
  await element.updateComplete;
  await until('the tool to finish saving', () => {
    const line = (shadow(element).querySelector('.save')?.textContent ?? '').trim();
    return line !== '' && line !== SAVE_STATES.unsaved;
  });
  await element.updateComplete;
}

/** The rendered tool, once its first read of the store has come back. */
async function logbook(canvasElement: HTMLElement): Promise<PtkTrainingLogbook> {
  const element = canvasElement.querySelector('ptk-training-logbook');
  if (element === null) throw new Error('No logbook rendered.');
  await settled(element);
  return element;
}

/**
 * Presses a control and waits for the screen to settle.
 *
 * The inner `<button>` and not the host: a click dispatched at the host is dispatched by
 * the script rather than by the platform, so it sails straight past a `disabled` control
 * and publishes a screen a lifter could not have produced.
 */
async function press(element: PtkTrainingLogbook, action: string): Promise<void> {
  const host = deepAll(shadow(element), `[data-action="${action}"]`)[0];
  if (host === undefined) throw new Error(`Nothing on this screen does "${action}".`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  button.click();
  await settled(element);
}

/** Types into the number field inside the wrapper carrying a field name. */
async function type(element: PtkTrainingLogbook, name: string, value: string): Promise<void> {
  const wrapper = deepAll(shadow(element), `[data-field="${name}"]`)[0];
  if (wrapper === undefined) throw new Error(`This screen has no "${name}" field.`);
  // Two steps rather than one compound selector: a compound `querySelector` types as
  // `Element` and would need the cast section 2.4 forbids.
  const host = wrapper.querySelector('ptk-number-field');
  if (host === null) throw new Error(`The "${name}" wrapper holds no number field.`);
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error(`The "${name}" field has no box to type in.`);
  input.value = value;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`, so a
  // script dispatching only `change` moves nothing and then publishes the screen it
  // started with.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settled(element);
}

/** Answers a radio-backed control by clicking a tile, which is how a lifter answers. */
async function choose(element: PtkTrainingLogbook, tag: string, value: string): Promise<void> {
  const group = deepAll(shadow(element), tag)[0];
  if (group === undefined) throw new Error(`No <${tag}> on this screen.`);
  const radio = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === value,
  );
  if (radio === undefined) throw new Error(`No "${value}" to choose in <${tag}>.`);
  radio.click();
  await settled(element);
}

/**
 * Plans a squat session at an invented 100 and starts it, through the controls.
 *
 * Returns the element rather than just running, which is the positive control: a play
 * function that silently did nothing would publish the home screen under a name saying a
 * workout is in progress.
 */
async function startASquatSession(canvasElement: HTMLElement): Promise<PtkTrainingLogbook> {
  const element = await logbook(canvasElement);
  await press(element, 'start-workout');
  await press(element, 'add-primary'); // The first of section 6.1's four is the squat.
  await type(element, 'weight', '100');
  await press(element, 'start');
  if (deepAll(shadow(element), 'li[data-set]').length === 0) {
    throw new Error('The workout did not start.');
  }
  return element;
}

const meta: Meta<PtkTrainingLogbook> = {
  title: 'Training logbook/The tool',
  component: 'ptk-training-logbook',
  tags: ['autodocs'],
  args: {
    ...aFreshTool('empty'),
    today: A_TRAINING_DAY,
    now: (): Instant => AT_START,
    applicationVersion: '0.0.0-story',
  },
  render: (args) => html`
    <ptk-training-logbook
      .repository=${args.repository}
      .today=${args.today}
      .now=${args.now}
      .nextId=${args.nextId}
      .applicationVersion=${args.applicationVersion}
    ></ptk-training-logbook>
  `,
};

export default meta;

type Story = StoryObj<PtkTrainingLogbook>;

/**
 * A logbook with nothing in it, which is where every lifter starts.
 *
 * The state most likely to read as broken, and the one to review first. Section 10.1's
 * sentence is on the page *here* -- before there is a year of training to lose, rather
 * than in a support article somebody reads afterwards -- and the storage line already says
 * "Saved on this device", which is section 18.9's phrase and the thing the whole
 * persistence layer exists to be able to say honestly.
 */
export const NothingLoggedYet: Story = {};

/**
 * The builder, reached by pressing Start a workout.
 *
 * One press from the home screen, and everything needed to start is on it: the four
 * competition lifts as tiles, a picker for the rest, a date defaulted to today and a name
 * that is optional. Nothing is required except an exercise.
 */
export const PlanningASession: Story = {
  args: aFreshTool('planning'),
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await press(element, 'start-workout');
  },
};

/**
 * The logging screen, reached the way a lifter reaches it.
 *
 * Three squat sets at an invented 100, planned through the builder and now waiting to be
 * ticked. This is the screen section 21 is about: the Done button is the tool, and
 * everything else on the page is arranged so that it is the largest thing a thumb can find
 * without reading.
 */
export const LoggingAWorkout: Story = {
  args: aFreshTool('logging'),
  play: async ({ canvasElement }) => {
    await startASquatSession(canvasElement);
  },
};

/**
 * The same session with its first set ticked off.
 *
 * Worth its own story because it is the moment the tool's promise is tested: the row shows
 * Undo where Done was, the progress line has moved, and the storage line still reads
 * "Saved on this device" -- which section 18.9 turns into an acceptance test rather than a
 * reassurance.
 */
export const OneSetDone: Story = {
  args: aFreshTool('one-set'),
  play: async ({ canvasElement }) => {
    const element = await startASquatSession(canvasElement);
    await press(element, 'complete');
  },
};

/**
 * Finishing with sets still outstanding, which is a question and not a default.
 *
 * Section 7.12. Two answers are offered and neither is preselected, because they record
 * different things and the tool cannot know which happened: work the lifter decided not to
 * do, and work they wrote down and did not get to. Defaulting to either writes a decision
 * into somebody's history that they did not make, and the Finish button stays disabled
 * until one is chosen.
 */
export const FinishingWithSetsLeft: Story = {
  args: aFreshTool('finishing'),
  play: async ({ canvasElement }) => {
    const element = await startASquatSession(canvasElement);
    await press(element, 'complete');
    await press(element, 'finish');
  },
};

/**
 * The screen after a workout is finished, and the flattest copy in the tool.
 *
 * "It is saved with the rest of your training", and no praise. Section 15.3: a logbook that
 * congratulates a session it did not watch is one a lifter learns to disbelieve, and the
 * moment that temptation is strongest is exactly here.
 */
export const AfterFinishing: Story = {
  args: aFreshTool('finished'),
  play: async ({ canvasElement }) => {
    const element = await startASquatSession(canvasElement);
    await press(element, 'complete');
    await press(element, 'finish');
    await choose(element, 'ptk-choice-group', 'skip');
    await press(element, 'finish-confirm');
  },
};

/**
 * A browser giving the page no storage at all -- private browsing, or a partitioned frame.
 *
 * The tool works and keeps nothing, and it says both in one breath. The thing to do about
 * it is to download a backup before closing the tab, which is why the sentence names that
 * and not the cause: the remedy stops being possible the moment the tab closes. Not a
 * fault state and not an error page.
 */
export const NoStorageOnThisDevice: Story = {
  args: { ...aFreshTool('no-storage'), repository: anUnstoredRepository() },
};

/**
 * The narrowest phone still in use (section 5.7), constrained by a wrapper rather than by a
 * viewport parameter -- the wrapper is what the element responds to, and a viewport setting
 * would document a screen the component never sees.
 *
 * Shown mid-workout because that is this tool's hardest layout and the one it is actually
 * used at: a set kind, a weight and rep count, and two controls per row that each have to
 * keep a comfortable tap target with no horizontal scroll anywhere on the page.
 */
export const Narrow: Story = {
  args: aFreshTool('narrow'),
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-training-logbook
        .repository=${args.repository}
        .today=${args.today}
        .now=${args.now}
        .nextId=${args.nextId}
        .applicationVersion=${args.applicationVersion}
      ></ptk-training-logbook>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await startASquatSession(canvasElement);
  },
};
