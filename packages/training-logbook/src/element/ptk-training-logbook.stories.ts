// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool, in the states a lifter opens it in.
 *
 * The composite root is the one element here worth *pressing* rather than looking at.
 * Every other tag lives inside its shadow root and the only thing connecting them is
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
import {
  createHandoff,
  type HandoffSource,
  type WarmupHandoff,
} from '@platform-toolkit/training-logbook/handoff';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import type { Instant } from '../types.js';

import { EFFORT_SETTING_NOTES, SAVE_STATES } from './copy.js';
import { EFFORT_SETTING_FIELD } from './dataset.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';
import {
  AT_START,
  A_TRAINING_DAY,
  aBackupFile,
  aBrowserThatKeeps,
  aBrowserThatMayClear,
  aFreshTool,
  aKilogramRack,
  aStartedSession,
  anUnstoredRepository,
} from './story.fixture.js';

// Through the package entry and behind an explicit call, not a side-effecting relative
// import. A relative import here would load the source copy of every element and define
// every one of its tags a second time: the registry throws on the second write, the story still looks
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
 * Answers one of the settings controls, named by the field it sits in.
 *
 * `choose` above takes a tag name, and the settings section holds two segmented controls
 * drawn from the same tag. It would find the unit one, so a story that meant to pick a
 * scale would quietly change the display unit instead and then publish the default screen
 * under a name saying otherwise.
 */
async function chooseSetting(
  element: PtkTrainingLogbook,
  field: string,
  value: string,
): Promise<void> {
  const wrapper = deepAll(shadow(element), `[data-field="${field}"]`)[0];
  if (wrapper === undefined) throw new Error(`This screen has no "${field}" control.`);
  // Two steps rather than one compound selector: a compound `querySelector` types as
  // `Element` and would need the cast section 2.4 forbids.
  const group = wrapper.querySelector('ptk-segmented');
  if (group === null) throw new Error(`The "${field}" wrapper holds no segmented control.`);
  const radio = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === value,
  );
  if (radio === undefined) throw new Error(`No "${value}" to choose for "${field}".`);
  radio.click();
  await settled(element);
}

/**
 * Hands the tool a file the way the picker does.
 *
 * Through a `DataTransfer`, because `files` cannot be assigned any other way, and the
 * `change` goes to the input rather than to the host because that is where the handler is
 * bound. The button beside it is left alone on purpose: an uncancelled click on a file
 * input opens a native window, and a story cannot close one.
 */
async function chooseFile(element: PtkTrainingLogbook, file: File): Promise<void> {
  const input = shadow(element).querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) throw new Error('This screen has no file input.');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(element);
  await until(
    'the confirmation screen',
    () => deepAll(shadow(element), 'section.restore').length > 0,
  );
  await element.updateComplete;
}

/** Every sentence the tool says in its own voice, at any shadow depth. */
function notes(element: PtkTrainingLogbook): string[] {
  return deepAll(shadow(element), 'p.note').map((line) => line.textContent);
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

/**
 * A session set up in the warm-up calculator: two lifts on a kilogram rack.
 *
 * The identifiers are real catalogue ones because the offer is drawn from this
 * build's catalogue and drops anything it does not recognise -- an invented id
 * would produce a card with an empty list, and a card with an empty list is a
 * story that renders nothing for `smoke-stories.mjs` to find. The warm-ups are
 * absent on purpose: a record carries what the lifter chose and the ramp is
 * worked out on landing, which is what the card's second sentence promises.
 *
 * Every weight is the fixture's own invented 100 and 70 (section 5.1).
 */
const A_HANDOFF: WarmupHandoff = createHandoff(
  {
    equipment: aKilogramRack(),
    exercises: [
      {
        exerciseId: 'squat',
        bar: null,
        workingWeight: 100,
        workingSets: 3,
        workingReps: 5,
        adjustments: [],
      },
      {
        exerciseId: 'bench-press',
        bar: null,
        workingWeight: 70,
        workingSets: 3,
        workingReps: 5,
        adjustments: [],
      },
    ],
  },
  AT_START,
);

/**
 * The record held in a variable, and one of these per story.
 *
 * `createHandoffSource` over the real `localStorage` is the obvious thing and it
 * would make what these stories show depend on what the reviewer opened before
 * them: Discard in one empties the next, and a calculator tab open on the same
 * origin writes a third thing into both. The same reason `aFreshTool` builds a
 * store per story, applied to the other place this tool reads from.
 *
 * Nothing here checks the record's age. That is `createHandoffSource`'s job and
 * not this port's, which is what keeps a pinned clock out of these stories.
 */
function aWaitingHandoff(): HandoffSource {
  let record: WarmupHandoff | null = A_HANDOFF;
  return {
    peek: () => record,
    clear: () => {
      record = null;
    },
  };
}

/**
 * The one tool here whose store is written to before the element is mounted.
 *
 * Named at module scope so that the story's `args` and its loader are talking about
 * the same repository -- a second `aFreshTool()` call inside the loader would seed a
 * store nothing renders, and the story would pass while showing the wrong screen.
 */
const HANDOFF_MID_WORKOUT = aFreshTool('handoff-busy');

const meta: Meta<PtkTrainingLogbook> = {
  title: 'Training logbook/The tool',
  component: 'ptk-training-logbook',
  tags: ['autodocs'],
  args: {
    ...aFreshTool('empty'),
    today: A_TRAINING_DAY,
    now: (): Instant => AT_START,
    applicationVersion: '0.0.0-story',
    // Spelled out rather than left off. The property is read the moment it changes
    // and `undefined` is not `null`, so an arg the render binds but the meta never
    // declares would have the tool asking an absent reader what is waiting.
    handoff: null,
    // Spelled out for the same reason, and with a sharper edge: an absent port draws
    // no offer at all, so a story that forgot it would document a home screen missing
    // a section and look exactly like the correct answer for an embed.
    persistence: null,
  },
  render: (args) => html`
    <ptk-training-logbook
      .repository=${args.repository}
      .today=${args.today}
      .now=${args.now}
      .nextId=${args.nextId}
      .applicationVersion=${args.applicationVersion}
      .handoff=${args.handoff}
      .persistence=${args.persistence}
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
 * Effort entry switched to RPE, and the one sentence that explains it. Section 7.10.
 *
 * Three answers to one question and never two scales at once, because an RPE of 8 and an
 * RIR of 8 are near-opposite claims about a set: a screen offering both would collect a
 * column of numbers whose meaning depends on which box somebody reached for that day.
 *
 * Only the chosen scale is explained. Section 17 asks for the terms rather than assuming
 * them, and a lifter who has picked one does not need the other two argued at them -- so
 * the sentence under the control changes with the tap, and the sentence under *that* is
 * the one that never does.
 *
 * Off is the first-use default and is therefore already on every other home story in this
 * file, which is why there are two of these rather than three.
 */
export const RecordingEffortAsRpe: Story = {
  args: aFreshTool('effort-rpe'),
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseSetting(element, EFFORT_SETTING_FIELD, 'rpe');
    await until('the RPE sentence to be drawn', () =>
      notes(element).includes(EFFORT_SETTING_NOTES.rpe),
    );
    // The negative half, and the reason this is not just a screenshot: three sentences
    // stacked under one control is a screen that explains a scale nobody chose, and it
    // is what a template listing all three would look like on a good day.
    if (notes(element).includes(EFFORT_SETTING_NOTES.none)) {
      throw new Error('The Off sentence is still on the screen under an RPE setting.');
    }
  },
};

/**
 * The same control answered the other way, which is worth its own page for the wording.
 *
 * The two sentences are the halves that have to be read against each other. The scales
 * run in opposite directions -- one counts up towards a limit and the other counts down
 * to it -- and they are explained by two sentences that look alike, in the same place,
 * under controls that are identical. Reviewing either alone is how the pair comes to say
 * the same thing.
 *
 * The last sentence is the same on both, and it is the one that has to survive being read
 * by somebody with a year of RPE behind them: turning this off hides the box and leaves
 * every effort already recorded on its set, in the scale it was recorded on.
 */
export const RecordingEffortAsRir: Story = {
  args: aFreshTool('effort-rir'),
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseSetting(element, EFFORT_SETTING_FIELD, 'rir');
    await until('the RIR sentence to be drawn', () =>
      notes(element).includes(EFFORT_SETTING_NOTES.rir),
    );
    if (notes(element).includes(EFFORT_SETTING_NOTES.rpe)) {
      throw new Error('The RPE sentence is still on the screen under an RIR setting.');
    }
  },
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
        .handoff=${args.handoff}
      ></ptk-training-logbook>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await startASquatSession(canvasElement);
  },
};

/**
 * What a lifter is shown before a backup replaces everything they have.
 *
 * The screen this milestone exists for. Counts on their own describe a great many files,
 * so the span and the newest few sessions are here too: "March to August, ending last
 * Tuesday" is the thing a person can tell apart from the backup they took a year ago and
 * forgot about. What it costs is stated in the tool's own voice above the two controls,
 * and neither of them is the one a stray thumb lands on -- the primary is the one that
 * replaces, and it is named for what it does rather than agreeing.
 *
 * Offered as well is a download of what is here now, which is the only undo this screen
 * has.
 */
export const ConfirmingARestore: Story = {
  args: aFreshTool('restore'),
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
  },
};

/**
 * The other press that cannot be taken back, and the one with no undo at all.
 *
 * Restore replaces a logbook with another one; this removes it. So the screen borrows
 * the restore confirmation's layout deliberately -- a lifter arriving at either is
 * answering the same question about the same device -- and differs in the one place it
 * has to: there is no list of sessions. Restore lists what is in the *file*, because
 * recognising the file is the decision. Here the sessions are the lifter's own, and
 * printing them under a heading asking whether to destroy them is not a description, it
 * is a goodbye. The counts and the span say what is here.
 *
 * Reached through a restore so there is something to count. A device with nothing on it
 * says so in a sentence instead, which is the one arrangement of this screen with
 * nothing at stake.
 */
export const ConfirmingADelete: Story = {
  args: aFreshTool('delete'),
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
    await press(element, 'restore-confirm');
    await press(element, 'delete-pick');
    await until(
      'the delete confirmation',
      () => deepAll(shadow(element), 'section.erase').length > 0,
    );
  },
};

/**
 * The offer to keep this on the device, which is section 10.3's whole visible surface.
 *
 * Reached through a restore because the offer is drawn only where there is something to
 * lose -- on a bare logbook it is correctly absent, which is the state `NothingLoggedYet`
 * already documents. Two sentences and a button: what the browser is allowed to do, the
 * ask, and the line that stays true either way.
 *
 * The press is not made here. It belongs to a lifter, and it may raise a permission
 * prompt; a play function that made it would be asking the reviewer's browser for
 * storage.
 */
export const AskedToKeepThisOnTheDevice: Story = {
  args: { ...aFreshTool('keep'), persistence: aBrowserThatMayClear() },
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
    await press(element, 'restore-confirm');
    await until(
      'the offer to keep this',
      () => deepAll(shadow(element), 'section.keep').length > 0,
    );
  },
};

/**
 * The same section once the browser has agreed, which is the version with no control.
 *
 * Worth its own story because section 0.4 forbids a dead control standing in for a
 * feature, and the obvious mistake here is a button that stays on screen asking for
 * something already granted. What is left is a statement and the backup line under it.
 */
export const AlreadyKeptOnThisDevice: Story = {
  args: { ...aFreshTool('kept'), persistence: aBrowserThatKeeps() },
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
    await press(element, 'restore-confirm');
    await until(
      'the offer to keep this',
      () => deepAll(shadow(element), 'section.keep').length > 0,
    );
  },
};

/**
 * The same confirmation at the narrowest phone still in use (section 5.7).
 *
 * Its own story because the counts are a grid, and a grid is the one layout on this
 * screen that can only be judged at the width where it stops having room for two columns.
 * Constrained by a wrapper for the same reason `Narrow` is: a viewport parameter would
 * document a width the element never sees.
 */
export const NarrowConfirmingARestore: Story = {
  args: aFreshTool('restore-narrow'),
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-training-logbook
        .repository=${args.repository}
        .today=${args.today}
        .now=${args.now}
        .nextId=${args.nextId}
        .applicationVersion=${args.applicationVersion}
        .handoff=${args.handoff}
      ></ptk-training-logbook>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
  },
};

/**
 * The delete confirmation at 320px, for the reason the restore one has a narrow story.
 *
 * The grid of counts is the layout that runs out of room first, and the warning above it
 * is the longest sentence the tool says anywhere.
 */
export const NarrowConfirmingADelete: Story = {
  args: aFreshTool('delete-narrow'),
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-training-logbook
        .repository=${args.repository}
        .today=${args.today}
        .now=${args.now}
        .nextId=${args.nextId}
        .applicationVersion=${args.applicationVersion}
        .handoff=${args.handoff}
      ></ptk-training-logbook>
    </div>
  `,
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    await chooseFile(element, await aBackupFile());
    await press(element, 'restore-confirm');
    await press(element, 'delete-pick');
    await until(
      'the delete confirmation',
      () => deepAll(shadow(element), 'section.erase').length > 0,
    );
  },
};

/**
 * A session handed over by the warm-up calculator, waiting at the top of the home
 * screen.
 *
 * The list is what would be logged and not what the record says, which is a
 * difference only visible when the two disagree: a record can name a lift added to
 * the catalogue after this page was built, and a card counting the record's own
 * entries would offer two lifts and log one -- found at the rack, with the bar
 * loaded. The sets and reps are here and the warm-ups are not, because the ramp is
 * this build's answer rather than the calculator's.
 */
export const HandedOverFromTheCalculator: Story = {
  args: { ...aFreshTool('handoff'), handoff: aWaitingHandoff() },
};

/**
 * The same offer with a workout already open, where Start is gone and a sentence
 * says why.
 *
 * The one screen in this file that is seeded rather than pressed, and the exception
 * is the rule's own reasoning rather than a hole in it: the home screen only shows
 * an open workout to somebody who has *come back* to it, so no sequence of taps
 * inside one visit reaches this. A store that already holds a session, booted from,
 * is what coming back is. The session itself still comes from the core through
 * `aStartedSession` and is not typed out.
 *
 * Landing over an open workout would replace training a lifter has done with
 * training they have not, so there is nothing for a Start control to do and it is
 * absent rather than disabled. Discard stays: the record expiring quietly in an hour
 * is not an answer to somebody looking at the card now.
 */
export const HandedOverMidWorkout: Story = {
  args: { ...HANDOFF_MID_WORKOUT, handoff: aWaitingHandoff() },
  loaders: [
    async () => {
      await HANDOFF_MID_WORKOUT.repository.saveActiveWorkout(
        aStartedSession({ prefix: 'handoff-open' }),
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const element = await logbook(canvasElement);
    // The positive control the other stories get from pressing something. A seed
    // that silently did nothing would publish the story above under a name saying a
    // workout is open, and the two pages differ by one sentence.
    if (deepAll(shadow(element), '[data-action="start-handoff"]').length > 0) {
      throw new Error('No workout is open: the offer still has a Start on it.');
    }
  },
};

/**
 * The offer at the narrowest phone still in use (section 5.7), wrapped rather than
 * scrolled.
 *
 * Its own story because the offer list is the one place on the home screen where a
 * name and a set of numbers compete for a line, and 320 px is where they stop
 * fitting on one. Constrained by a wrapper for the same reason `Narrow` is: a
 * viewport parameter would document a width the element never sees.
 */
export const NarrowWithAHandoff: Story = {
  args: { ...aFreshTool('handoff-narrow'), handoff: aWaitingHandoff() },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-training-logbook
        .repository=${args.repository}
        .today=${args.today}
        .now=${args.now}
        .nextId=${args.nextId}
        .applicationVersion=${args.applicationVersion}
        .handoff=${args.handoff}
      ></ptk-training-logbook>
    </div>
  `,
};
