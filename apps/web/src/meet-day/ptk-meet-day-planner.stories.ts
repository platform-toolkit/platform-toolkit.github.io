// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { manualClock } from '../clock.js';
import {
  CONFIRM_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  LIFTER_NAME_FIELD,
} from './fields.js';
import { MEET_PROFILE_FIXTURE } from './meet-rules.fixture.js';
import { PROFILE_FIXTURES, plannerSession } from './planner-fixture.js';
import type { PtkMeetDayPlanner } from './ptk-meet-day-planner.js';
import './ptk-meet-day-planner.js';
import { saveSession, type PlannerSession } from './session.js';

/**
 * The whole tool, composed: four elements in four shadow trees over one session.
 *
 * WHY MOST OF THESE STORIES ARE ABOUT THE READ
 *
 * Two of this element's inputs are published data, and every state they can be
 * in is a state a lifter on gym signal actually sees (§5.7) -- while a developer
 * with a warm local build sees none of them, because the artifact is served
 * before the first paint. So `RuleBooksLoading`, `RuleBooksFailed` and
 * `NothingPublished` get a story each rather than a comment saying they exist,
 * and the three sentences under them are deliberately different: only one of the
 * three is a fault, and a screen that greeted the other two with a warning would
 * open by reporting a problem that resolves itself in a hundred milliseconds.
 *
 * WHY THE FEDERATION IS DRIVEN RATHER THAN SEEDED
 *
 * The remembered settings are the unit, the format, the goal and §8.2's two
 * comparison answers -- and deliberately not the federation. A federation is a
 * fact about one meet rather than a preference, and a device that remembered it
 * would open a lifter's *next* meet planning against their last one's rule book,
 * which is the failure that is invisible until three attempts come out on the
 * wrong increment. So a story that needs a federation chosen presses the tile,
 * the way a lifter does; `saveSession` is the seam for everything else.
 *
 * WHERE THE PLAN ITSELF IS DOCUMENTED
 *
 * On `ptk-plan-screen`, whose stories hand in a session and the plan it produces
 * directly and can therefore reach states this root can only be driven into.
 * These stories are for what only the root can be wrong about: which of the five
 * "no plan yet" answers is on screen, and whether the four children agree about
 * one session.
 *
 * WHY THE FIFTH ANSWER -- A REFUSED RULE BOOK -- HAS NO STORY
 *
 * It is the one of the five that is a fault, and reaching it means the element
 * writes the refusal codes to the console, which is the behaviour rather than a
 * side effect: they name a defect in somebody else's published feed, they are
 * the only part of a refusal that is safe to keep (§2.3), and no lifter can act
 * on them. `smoke-stories.mjs` fails any story whose page logs, with no
 * allowlist, on the argument that a blunt bar is what catches the story that
 * renders through a thrown error -- and it was right to: the null-view crash on
 * this element's first paint is exactly that shape. A story here could only
 * survive by silencing the diagnostic, which would make it a document of a
 * behaviour the tool does not have. So the state lives in the browser test
 * beside this file, in two cases that can say what they mean: that the screen
 * points at another federation rather than at the codes, and that the refusal is
 * reported once rather than on every keystroke.
 */

/** A device that remembers, seeded through the tool's own writer. */
function deviceRemembering(session: PlannerSession): PreferenceStore {
  const store = createPreferenceStore(memoryPreferenceStorage());
  saveSession(store, session);
  return store;
}

/**
 * One store per story, built once at module load.
 *
 * Building them inside `render` would look tidier and would throw away whatever
 * the reader had typed on every control change, which is the opposite of what an
 * interactive document is for.
 */
const FRESH = createPreferenceStore(memoryPreferenceStorage());
const POUNDS_PUSH_PULL = deviceRemembering(plannerSession({ unit: 'lb', format: 'push-pull' }));
const FIRST_MEET = deviceRemembering(plannerSession({ firstMeet: true }));
const CHOSEN = createPreferenceStore(memoryPreferenceStorage());
const NARROW = createPreferenceStore(memoryPreferenceStorage());
const RUNNING = createPreferenceStore(memoryPreferenceStorage());
const RUNNING_BEHIND = createPreferenceStore(memoryPreferenceStorage());
const NARROW_RUNNING = createPreferenceStore(memoryPreferenceStorage());

/**
 * One fixed instant for every story, and deliberately a fake one.
 *
 * `src/clock.ts` puts it plainly: a countdown story on the real clock documents
 * a different screen every time it is opened. It matters here even for the
 * stories with no countdown on them -- live mode watches the seam and repaints
 * four times a second, so a story left on the system clock would re-render
 * under the smoke check and under whoever is reading it, for no visible reason.
 * A manual clock nobody advances simply never ticks.
 */
const STORY_CLOCK = manualClock(1_000_000_000_000);

/** A private window, or an embedder that blocked storage. */
const NO_STORAGE = createPreferenceStore(null);

/**
 * Presses the federation tile, which is the only way into a plan from here.
 *
 * Three shadow roots deep, and each hop is a real boundary rather than
 * ceremony: the root owns the session, the setup element owns §6's questions,
 * and the choice group owns the radio. A story that reached past them by
 * setting a property would be testing a path no lifter takes -- and the whole
 * point of driving it is that the federation arrives as an event.
 */
async function chooseFederation(canvasElement: HTMLElement, federationId: string): Promise<void> {
  const element = canvasElement.querySelector('ptk-meet-day-planner');
  if (element === null) throw new Error('No planner rendered.');
  await element.updateComplete;

  const group = element.shadowRoot
    ?.querySelector('ptk-planner-setup')
    ?.shadowRoot?.querySelector(`[data-field="${FEDERATION_FIELD}"]`);
  const radio = [...(group?.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === federationId,
  );
  if (radio === undefined) throw new Error(`No federation option "${federationId}".`);
  radio.click();
  await element.updateComplete;
}

/**
 * Twice, because a child created during this commit settles on the next one.
 *
 * The same reasoning as the browser test's `settled`: the root awaits its own
 * shadow children (§5.8) and each of those awaits theirs, so one await covers a
 * tree that already exists -- but starting the meet *creates* `ptk-live-screen`,
 * whose own children are created inside its first commit. A story that pressed
 * Start and settled once would be screenshotted mid-paint.
 */
async function settled(element: PtkMeetDayPlanner): Promise<void> {
  await element.updateComplete;
  await element.updateComplete;
}

/** The one control answering a field, across the root's own children. */
function control(element: PtkMeetDayPlanner, field: string, lift?: string): Element {
  const selector =
    lift === undefined ? `[data-field="${field}"]` : `[data-field="${field}"][data-lift="${lift}"]`;
  const roots = [
    element.shadowRoot,
    ...[...(element.shadowRoot?.querySelectorAll('*') ?? [])].map((child) => child.shadowRoot),
  ];
  const found = roots.flatMap((root) => [...(root?.querySelectorAll(selector) ?? [])]);
  const first = found[0];
  if (first === undefined) throw new Error(`No control for "${field}".`);
  return first;
}

/** Types into a field, keystroke and all, the way a lifter does. */
async function typeInto(
  element: PtkMeetDayPlanner,
  field: string,
  text: string,
  lift?: string,
): Promise<void> {
  const input = control(element, field, lift).shadowRoot?.querySelector('input');
  if (input === null || input === undefined) throw new Error(`No input for "${field}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settled(element);
}

/** Presses the native control inside a `ptk-button`, the way a thumb does. */
async function pressButton(element: PtkMeetDayPlanner, selector: string): Promise<void> {
  const button = element.shadowRoot?.querySelector(selector)?.shadowRoot?.querySelector('button');
  if (button === null || button === undefined) throw new Error(`No button at "${selector}".`);
  button.click();
  await settled(element);
}

/**
 * A plan, a name and a press: the whole way from an empty form to a platform.
 *
 * Every step is driven rather than seeded, because none of them can be seeded.
 * The federation is not a remembered preference (above), the plan is gated on a
 * confirmation the lifter gives by hand (§7), and the meet document is built
 * inside the element by `seedLiveMeet` -- there is no property on this element
 * that holds a running meet. So the play function is not a convenience here; it
 * is the only route to the states below, and that is itself worth documenting:
 * anything a story cannot reach is a state the shipped tool cannot reach either.
 */
async function startAMeet(canvasElement: HTMLElement): Promise<PtkMeetDayPlanner> {
  await chooseFederation(canvasElement, MEET_PROFILE_FIXTURE.id);
  const element = canvasElement.querySelector('ptk-meet-day-planner');
  if (element === null) throw new Error('No planner rendered.');

  for (const lift of ['squat', 'bench', 'deadlift']) {
    await typeInto(element, EXPECTED_MAXIMUM_FIELD, '200', lift);
    const box = control(element, CONFIRM_FIELD, lift).shadowRoot?.querySelector('input');
    if (box === null || box === undefined) throw new Error(`No confirmation for "${lift}".`);
    box.click();
    await settled(element);
  }

  await typeInto(element, LIFTER_NAME_FIELD, 'Quintero');
  await pressButton(element, '.start ptk-button');
  // A positive control for every story below, and the reason the helper returns
  // rather than just running: a play function that silently did nothing would
  // publish the planning screen under a name saying the meet is up.
  const live = element.shadowRoot?.querySelector('ptk-live-screen') ?? null;
  if (live === null) throw new Error('The meet did not start.');
  return element;
}

const meta: Meta<PtkMeetDayPlanner> = {
  title: 'Meet day/Planner',
  component: 'ptk-meet-day-planner',
  tags: ['autodocs'],
  argTypes: {
    settings: {
      control: false,
      description: 'The unit, format, goal and comparison answers. Outlives the tab.',
    },
    profiles: {
      control: false,
      description: 'The published rule books, once the read has finished.',
    },
    status: {
      control: { type: 'inline-radio' },
      options: ['loading', 'ready', 'failed'],
      description: 'Where the read of the published rule books has got to.',
    },
    chart: {
      control: false,
      description: "The chosen federation's published pound column, or null for none (§16).",
    },
    clock: {
      control: false,
      description: 'The time seam. A manual clock here, so no story moves while it is read.',
    },
  },
  args: {
    settings: FRESH,
    profiles: PROFILE_FIXTURES,
    status: 'ready',
    chart: null,
    clock: STORY_CLOCK,
  },
  render: (args) => html`
    <ptk-meet-day-planner
      .settings=${args.settings}
      .profiles=${args.profiles}
      status=${args.status}
      .chart=${args.chart}
      .clock=${args.clock}
    ></ptk-meet-day-planner>
  `,
};

export default meta;

type Story = StoryObj<PtkMeetDayPlanner>;

/**
 * A first visit, with the rule books loaded and nothing answered.
 *
 * The plan slot says where the plan will appear rather than sitting blank, and
 * it names the one thing standing between the lifter and it. Nothing here is an
 * error: an empty form is not a mistake, and a screen that opens by telling the
 * lifter off is a screen they leave.
 */
export const AwaitingAFederation: Story = {};

/** The read has not finished. On gym signal this is most of the first minute. */
export const RuleBooksLoading: Story = {
  args: { status: 'loading', profiles: [] },
};

/**
 * The read failed.
 *
 * The sentence says what is lost rather than only that something broke: without
 * a rule book there is nothing to check an attempt against, which is most of
 * what this tool does.
 */
export const RuleBooksFailed: Story = {
  args: { status: 'failed', profiles: [] },
};

/**
 * The read succeeded and there is nothing in it.
 *
 * Deliberately not an error and deliberately not offered a retry. Nothing went
 * wrong and a reload will not change it, so a retry would send a lifter round a
 * loop that cannot end.
 */
export const NothingPublished: Story = {
  args: { status: 'ready', profiles: [] },
};

/**
 * A federation chosen, and the method questions it unlocks.
 *
 * The plan slot is still a sentence rather than a plan, because §7 gates one on
 * a maximum the lifter has agreed to -- the tool will not draw nine attempts off
 * a figure nobody underwrote. Type a maximum into the three fields and tick the
 * agreement to see the plan appear.
 */
export const AFederationChosen: Story = {
  args: { settings: CHOSEN },
  play: async ({ canvasElement }) => {
    await chooseFederation(canvasElement, MEET_PROFILE_FIXTURE.id);
  },
};

/**
 * A device that remembers pounds and a push/pull meet.
 *
 * Two lifts on screen instead of three, and every weight field read in pounds.
 * What the unit does *not* change is the attempt card, which stays in kilograms
 * under every federation this planner has a profile for (§16) -- a lifter
 * reading pounds there would be reading a figure they have to convert again
 * before declaring it.
 */
export const RememberedPoundsPushPull: Story = {
  args: { settings: POUNDS_PUSH_PULL },
};

/**
 * A first meet, which is §6.3's one default.
 *
 * Answering the question moves an untouched goal to First Meet; a goal the
 * lifter picked is left alone. That distinction is `goalChosen`, and it is
 * stored beside the goal precisely so a restored device does not quietly
 * overwrite a choice the lifter made last time.
 */
export const RememberedFirstMeet: Story = {
  args: { settings: FIRST_MEET },
};

/**
 * A private window, or an embedder that blocked storage.
 *
 * `localStorage` throws on *property access* when access is denied, so a tool
 * that reaches for it at start-up dies at start-up -- in exactly the
 * configuration these tools are designed to ship into. Here the whole screen
 * works; the only difference is that nothing answered survives a reload.
 */
export const NoStorageAvailable: Story = {
  args: { settings: NO_STORAGE },
};

/**
 * A phone-width column with the whole tool in it.
 *
 * The primary target, not a degraded case (§5.7). Eight goal tiles, three
 * per-lift field sets and the plan slot, in 320 pixels. Constrained by a wrapper
 * rather than by a viewport setting, because the wrapper is what the element's
 * container queries respond to.
 */
export const Narrow: Story = {
  args: { settings: NARROW },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-day-planner
        .settings=${args.settings}
        .profiles=${args.profiles}
        status=${args.status}
        .chart=${args.chart}
        .clock=${args.clock}
      ></ptk-meet-day-planner>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await chooseFederation(canvasElement, MEET_PROFILE_FIXTURE.id);
  },
};

/**
 * The plan on a board: planning gone, platform up (§13.10).
 *
 * One screen or the other, never both. The planning questions are still
 * answerable while a meet runs -- a format corrected mid-flight has to go
 * somewhere -- but not underneath the weight the lifter is about to declare, so
 * pressing Start swaps the screen rather than appending to it.
 *
 * What is worth looking at here is that the openers are the same figures the
 * plan screen printed a moment ago. `live-session.ts` reads them off the
 * `PlannerView` rather than re-planning from the session, because a second plan
 * from the same inputs is free to disagree with the first -- and nothing on
 * either screen would say which one the day is being run on.
 */
export const AMeetRunning: Story = {
  args: { settings: RUNNING },
  play: async ({ canvasElement }) => {
    await startAMeet(canvasElement);
  },
};

/**
 * The plan screens, with a meet running behind them.
 *
 * Back to plan is not "end the meet" and must not read as it: the document is
 * untouched, the way back is one press, and the note says so above the control.
 * The start panel is gone -- a second Start over a running meet would seed a
 * second document off the same plan and silently strand the first.
 *
 * The clock is dropped for the duration, which is not visible here and is the
 * point: nothing on these screens moves, so a repaint four times a second would
 * be work done for a countdown nobody can see.
 */
export const AMeetRunningBehindThePlan: Story = {
  args: { settings: RUNNING_BEHIND },
  play: async ({ canvasElement }) => {
    const element = await startAMeet(canvasElement);
    await pressButton(element, 'ptk-button.back');
  },
};

/**
 * A phone-width column with the platform on screen.
 *
 * The primary target, and the hardest case in the tool (§5.7): three choice
 * cards, each carrying a weight, a pound reading, a risk band, a jump, a share
 * of the maximum and a projection, plus the two totals and §29's sentences --
 * in 320 pixels, read one-handed between attempts.
 */
export const NarrowRunning: Story = {
  args: { settings: NARROW_RUNNING },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-meet-day-planner
        .settings=${args.settings}
        .profiles=${args.profiles}
        status=${args.status}
        .chart=${args.chart}
        .clock=${args.clock}
      ></ptk-meet-day-planner>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await startAMeet(canvasElement);
  },
};
