// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The history list and its two controls, in a real browser.
 *
 * Mounted on its own rather than through `ptk-training-logbook`, unlike the equipment
 * suite next door. Nothing here is a conversation between elements: the list takes
 * summaries the repository has already sorted, draws them, and hands one identifier
 * back. What the root then does with that identifier is the root's suite to own, and a
 * case that went through the whole tool to press one button would be asserting against
 * the storage layer's sort order rather than against this element.
 *
 * THE ONE TEST THIS FILE EXISTS FOR
 *
 * "asks for the row that was pressed, and not the first one". Every row on this screen
 * renders from the same template with the same classes and the same action, so the two
 * wrong implementations -- reading the outermost `data-workout` on the path, or reading
 * `event.target`, which a composed event retargets to the host -- both produce a screen
 * that visibly responds to every press and starts the same workout every time. A suite
 * that pressed row one could not tell any of the three apart, so nothing here presses
 * row one.
 *
 * Every date, duration and set count in this file is invented (section 5.1). None of
 * them is a real session and none of them is today, so nothing can pass by coincidence.
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// controls render with no tap-target floor and the accessibility pass measures a screen
// that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AT_START, ON_DAY } from '../core/context.fixture.js';
import type { WorkoutSummary } from '../core/summary.js';
import type { CalendarDay, LogbookId, WorkoutStatus } from '../types.js';

import { HISTORY_NOTES, HOME_NOTES, WORKOUT_STATUSES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import {
  WORKOUT_OPEN_EVENT,
  WORKOUT_REPEAT_EVENT,
  type PtkWorkoutHistory,
  type WorkoutOpenDetail,
  type WorkoutRepeatDetail,
} from './ptk-workout-history.js';

/** Three invented days, newest first. */
const LATEST: CalendarDay = ON_DAY;
const MIDDLE: CalendarDay = '2026-03-08';
const EARLIEST: CalendarDay = '2026-03-05';

/** 75 invented minutes, which `formatDuration` prints in hours. */
const A_LONG_SESSION = 4_500_000;
const A_LONG_SESSION_READS = '1 h 15 min';

/** 55 invented minutes -- the other branch, under an hour and printed in minutes. */
const A_SHORT_SESSION = 3_300_000;
const A_SHORT_SESSION_READS = '55 min';

/**
 * A shadow root to hang the list inside.
 *
 * The repeat event is `composed` as well as `bubbling`, and only a boundary can tell
 * the two apart: appended straight to `document.body` a merely-bubbling event arrives
 * at every assertion in this file, so `composed: true` could be deleted and the suite
 * would stay green while the real consumer -- a root element that renders this one
 * inside its own shadow root -- heard nothing at all.
 */
const HOST_TAG = 'ptk-workout-history-test-host';

class HistoryTestHost extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }
}

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineTrainingLogbook();
  if (customElements.get(HOST_TAG) === undefined) customElements.define(HOST_TAG, HistoryTestHost);
});

afterEach(() => {
  for (const dispose of teardown.splice(0).reverse()) dispose();
});

interface WorkoutOptions {
  readonly title?: string | null;
  readonly localDate?: CalendarDay;
  readonly status?: WorkoutStatus;
  readonly exerciseNames?: readonly string[];
  readonly durationMillis?: number | null;
  readonly completedWorkingSets?: number;
  readonly hasNotes?: boolean;
}

/**
 * One row's worth of summary, built by hand rather than `summarize`d from a session.
 *
 * A session that produced exactly these figures would put every assertion below at the
 * mercy of the counting rules `core/summary.test.ts` already owns -- and the three
 * shapes this file cares most about (no title, no exercises, no duration) would each
 * need a differently broken session to arrive at. What is being tested here is what a
 * row draws from a summary, so the summary is the input.
 *
 * `progress` is fixed and deliberately not kept in step with `completedWorkingSets`:
 * the row does not read it, and a fixture that maintained it would imply it did.
 */
function aWorkout(id: LogbookId, options: WorkoutOptions = {}): WorkoutSummary {
  return {
    id,
    localDate: options.localDate ?? LATEST,
    status: options.status ?? 'completed',
    // Not `??`: a title of `null` is one of the cases, and the nullish default would
    // quietly replace it with the very fallback the element is supposed to supply.
    title: options.title === undefined ? 'Squat day' : options.title,
    exerciseNames: options.exerciseNames ?? ['Squat', 'Bench press'],
    durationMillis: options.durationMillis === undefined ? A_LONG_SESSION : options.durationMillis,
    completedWorkingSets: options.completedWorkingSets ?? 9,
    progress: { completed: 9, incomplete: 0, skipped: 0, remaining: 0, total: 9 },
    hasNotes: options.hasNotes ?? false,
    updatedAt: AT_START,
  };
}

/** Three finished sessions in the order the repository hands them over. */
function threeWorkouts(): readonly WorkoutSummary[] {
  return [
    aWorkout('past-a', { title: 'Squat day', localDate: LATEST }),
    aWorkout('past-b', { title: 'Bench day', localDate: MIDDLE }),
    aWorkout('past-c', { title: 'Deadlift day', localDate: EARLIEST }),
  ];
}

async function mount(workouts: readonly WorkoutSummary[]): Promise<PtkWorkoutHistory> {
  const element = document.createElement('ptk-workout-history');
  element.workouts = workouts;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** The same list, one shadow boundary further in. */
async function mountInsideAShadowRoot(
  workouts: readonly WorkoutSummary[],
): Promise<PtkWorkoutHistory> {
  const host = document.createElement(HOST_TAG);
  const element = document.createElement('ptk-workout-history');
  element.workouts = workouts;
  shadow(host).append(element);
  document.body.append(host);
  teardown.push(() => {
    host.remove();
  });
  await element.updateComplete;
  return element;
}

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

function one(root: DocumentFragment | HTMLElement, selector: string): HTMLElement {
  const found = deepAll(root, selector)[0];
  if (found === undefined) throw new Error(`Nothing on this screen matches "${selector}".`);
  return found;
}

/** Everything the element has drawn, across every shadow root under it. */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  visit(shadow(element));
  return parts.join(' ');
}

/** Every sentence the element is saying in its own voice, exactly as it says it. */
function notes(element: PtkWorkoutHistory): string[] {
  return [...shadow(element).querySelectorAll('p.note')].map((note) => note.textContent.trim());
}

/** The rows, in the order they are drawn. */
function rows(element: PtkWorkoutHistory): HTMLElement[] {
  return deepAll(shadow(element), 'li[data-workout]');
}

function row(element: PtkWorkoutHistory, index: number): HTMLElement {
  const found = rows(element)[index];
  if (found === undefined) throw new Error(`There is no row ${String(index + 1)} on this screen.`);
  return found;
}

/** Every Repeat control on the screen, whichever row it is on. */
function repeatButtons(element: PtkWorkoutHistory): HTMLElement[] {
  return deepAll(shadow(element), '[data-action="repeat-workout"]');
}

/** Every Open control on the screen. Unlike the Repeats, these are never withdrawn. */
function openButtons(element: PtkWorkoutHistory): HTMLElement[] {
  return deepAll(shadow(element), '[data-action="open-workout"]');
}

/**
 * The `<button>` inside a `ptk-button`.
 *
 * The inner one and never the host: a click dispatched at the host is dispatched by
 * the test rather than by the platform, so it sails straight past a `disabled` control
 * and asserts against a screen a lifter could not have produced. It is also the only
 * node carrying the accessible name, which is what makes the `accessible-name=` /
 * `accessiblename=` trap visible from a test at all.
 */
function innerButton(host: HTMLElement): HTMLButtonElement {
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`<${host.localName}> is not a button.`);
  return button;
}

/** Presses the Repeat on one row, by position, the way a thumb does. */
async function pressRepeat(element: PtkWorkoutHistory, index: number): Promise<void> {
  innerButton(one(row(element, index), '[data-action="repeat-workout"]')).click();
  await element.updateComplete;
}

/** Presses the Open on one row, by position. */
async function pressOpen(element: PtkWorkoutHistory, index: number): Promise<void> {
  innerButton(one(row(element, index), '[data-action="open-workout"]')).click();
  await element.updateComplete;
}

/**
 * Every repeat asked for, in the order it was asked for, heard where a listener is put.
 *
 * The array is returned before anything is pressed and filled in afterwards, so a case
 * asserting `toHaveLength(1)` is asserting about the whole press and not about the
 * first event to arrive.
 */
function repeatsHeardOn(target: EventTarget): WorkoutRepeatDetail[] {
  const seen: WorkoutRepeatDetail[] = [];
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) seen.push(event.detail as WorkoutRepeatDetail);
  };
  target.addEventListener(WORKOUT_REPEAT_EVENT, listener);
  teardown.push(() => {
    target.removeEventListener(WORKOUT_REPEAT_EVENT, listener);
  });
  return seen;
}

/** The same, for the other event. Two rows now dispatch and they must not be swapped. */
function opensHeardOn(target: EventTarget): WorkoutOpenDetail[] {
  const seen: WorkoutOpenDetail[] = [];
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) seen.push(event.detail as WorkoutOpenDetail);
  };
  target.addEventListener(WORKOUT_OPEN_EVENT, listener);
  teardown.push(() => {
    target.removeEventListener(WORKOUT_OPEN_EVENT, listener);
  });
  return seen;
}

describe('a history with nothing in it', () => {
  it('says nothing is logged yet rather than leaving a heading over an empty box', async () => {
    // The state most likely to read as a failed read. A heading over nothing is
    // indistinguishable from a list that could not be loaded, and the difference
    // between those two is the whole of `HOME_NOTES.historyEmpty`.
    const element = await mount([]);

    expect(readAll(element)).toContain(HOME_NOTES.historyEmpty);
    expect(rows(element)).toHaveLength(0);
    // Nothing to repeat, so nothing offers to. A screen reader landing on a Repeat
    // with no row under it has been sent somewhere that does not exist.
    expect(repeatButtons(element)).toHaveLength(0);
    expect(openButtons(element)).toHaveLength(0);
  });
});

describe('the rows', () => {
  it('draws them in the order it was handed, and never sorts them itself', async () => {
    // The order is the repository's -- `byMostRecent` sorts it at the storage layer,
    // where the whole list is in hand. An element that sorted its own property would
    // be sorting one page of a list it cannot see the rest of, which is the bug that
    // arrives the day this is paginated. So the fixture is deliberately handed over
    // out of date order: what is asserted is that the element renders what it is
    // given, not that it happens to agree with a sort.
    const element = await mount([
      aWorkout('past-b', { title: 'Bench day', localDate: MIDDLE }),
      aWorkout('past-a', { title: 'Squat day', localDate: LATEST }),
      aWorkout('past-c', { title: 'Deadlift day', localDate: EARLIEST }),
    ]);

    expect(rows(element).map((li) => li.dataset['workout'])).toEqual([
      'past-b',
      'past-a',
      'past-c',
    ]);
  });

  it('draws the whole of a row: what, when, how it went and how long it took', async () => {
    const element = await mount([
      aWorkout('past-a', {
        title: 'Squat day',
        localDate: MIDDLE,
        status: 'completed',
        exerciseNames: ['Squat', 'Bench press'],
        durationMillis: A_LONG_SESSION,
        completedWorkingSets: 9,
        hasNotes: true,
      }),
    ]);

    const only = row(element, 0).textContent;
    expect(only).toContain('Squat day');
    // The stored string, printed as stored. Anything that handed it to `Date` for a
    // prettier rendering would print the day before to every lifter west of
    // Greenwich, which is the failure the string representation exists to prevent.
    expect(only).toContain(MIDDLE);
    expect(only).toContain('Squat, Bench press');
    expect(only).toContain(WORKOUT_STATUSES.completed);
    expect(only).toContain(`9 ${HISTORY_NOTES.setsLabel}`);
    expect(only).toContain(A_LONG_SESSION_READS);
    expect(only).toContain(HISTORY_NOTES.hasNotes);
  });

  it('leaves the notes mark off a session that carries no note', async () => {
    // Paired with the case above, because a row that always drew the mark would pass
    // that one and tell a lifter every session has a note in it.
    const element = await mount([aWorkout('past-a', { hasNotes: false })]);

    expect(row(element, 0).textContent).not.toContain(HISTORY_NOTES.hasNotes);
  });

  it('shows an unfinished session as unfinished rather than as one more finished one', async () => {
    const element = await mount([
      aWorkout('past-a', { status: 'active', durationMillis: A_SHORT_SESSION }),
    ]);

    const only = row(element, 0).textContent;
    expect(only).toContain(WORKOUT_STATUSES.active);
    expect(only).toContain(A_SHORT_SESSION_READS);
    expect(only).not.toContain(WORKOUT_STATUSES.completed);
  });

  it('calls a session with no title a workout instead of drawing an empty line', async () => {
    // A title is optional everywhere it is asked for, so an untitled session is
    // ordinary rather than broken. A blank where the name goes leaves the date
    // floating against nothing and reads as a row that failed to load.
    const element = await mount([aWorkout('past-a', { title: null })]);

    expect(row(element, 0).textContent).toContain(HISTORY_NOTES.unnamed);
  });

  it('says a session had no exercises rather than drawing an empty sentence', async () => {
    const element = await mount([aWorkout('past-a', { exerciseNames: [] })]);

    expect(row(element, 0).textContent).toContain(HISTORY_NOTES.noExercises);
  });

  it('draws no duration at all where there is none to know', async () => {
    // `null` is "cannot be known" and not "zero". A row that fell back to a figure
    // would report a length for a session that was never finished, and `0 min` is a
    // claim about how long somebody trained.
    const element = await mount([aWorkout('past-a', { durationMillis: null })]);

    const only = row(element, 0).textContent;
    expect(only).not.toContain('min');
    expect(only).not.toContain(' h');
  });
});

describe('asking to do one of them again', () => {
  it('asks for the row that was pressed, and not the first one', async () => {
    // The case this file exists for. Row three and never row one: reading the
    // outermost `data-workout` on the path, or reading `event.target` -- which a
    // composed event retargets to the host, whose dataset is empty -- both produce a
    // screen where every Repeat visibly responds and starts the same workout. Pressing
    // the first row cannot separate a correct implementation from either of them.
    const element = await mount(threeWorkouts());
    const asked = repeatsHeardOn(element);

    await pressRepeat(element, 2);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.id).toBe('past-c');
    expect(asked[0]?.id).not.toBe('past-a');
  });

  it('asks once for one press, not once per row and not twice for one button', async () => {
    // One delegated listener serves every row, so the two ways this goes wrong are a
    // handler bound per row as well as on the host, and a press that walks up through
    // more than one node the listener answers. Both look identical on screen and both
    // start the workout twice.
    const element = await mount(threeWorkouts());
    const asked = repeatsHeardOn(element);

    await pressRepeat(element, 1);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.id).toBe('past-b');
  });

  it('is heard outside the shadow root it was dispatched in', async () => {
    // `composed: true`, and it is not decoration: the only consumer renders this list
    // inside its own shadow root, so an event that stopped at that boundary would
    // leave a tool whose Repeat buttons all visibly respond and whose root never hears
    // one. Listening on `document.body` with a boundary in between is the only
    // arrangement that can fail when the flag is dropped.
    const element = await mountInsideAShadowRoot(threeWorkouts());
    const asked = repeatsHeardOn(document.body);

    await pressRepeat(element, 1);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.id).toBe('past-b');
  });

  it('names the row it belongs to, so eight Repeats are not eight identical buttons', async () => {
    // Read off the inner `<button>`'s `aria-label` rather than the host's attribute,
    // because that is the one place the `accessible-name=` / `accessiblename=` trap is
    // visible: the misspelling compiles, lints, formats and renders, and the only
    // symptom is a button with no name.
    const element = await mount([
      aWorkout('past-a', { title: 'Squat day', localDate: MIDDLE }),
      aWorkout('past-b', { title: null, localDate: EARLIEST }),
    ]);

    const [first, second] = repeatButtons(element);
    if (first === undefined || second === undefined) throw new Error('Both rows want a Repeat.');
    expect(innerButton(first).getAttribute('aria-label')).toBe(
      `${HISTORY_NOTES.repeat}: Squat day, ${MIDDLE}`,
    );
    expect(innerButton(second).getAttribute('aria-label')).toBe(
      `${HISTORY_NOTES.repeat}: ${HISTORY_NOTES.unnamed}, ${EARLIEST}`,
    );
  });

  it('ignores a press on anything in a row that is not one of the two controls', async () => {
    // A row is a title, a date, a list of lifts and four facts, and all of it is
    // inside the node carrying `data-workout`. Without the action check every one of
    // those would start a workout -- silently, from a tap that looks like scrolling.
    const element = await mount(threeWorkouts());
    const repeats = repeatsHeardOn(element);
    const opens = opensHeardOn(element);

    one(row(element, 1), '.name').click();
    row(element, 1).click();
    await element.updateComplete;

    expect(repeats).toEqual([]);
    expect(opens).toEqual([]);
  });
});

describe('opening a workout', () => {
  it('asks for the row that was pressed, and never repeats it by mistake', async () => {
    // Two controls on every row, drawn from the same template, one row apart in the
    // markup. Reading the action off the wrong node -- or falling through the switch
    // to the second case -- starts a session from a press that meant to read one, and
    // a lifter mid-workout would find out by being told they already have one open.
    const element = await mount(threeWorkouts());
    const opens = opensHeardOn(element);
    const repeats = repeatsHeardOn(element);

    await pressOpen(element, 1);

    expect(opens).toHaveLength(1);
    expect(opens[0]?.id).toBe('past-b');
    expect(repeats).toEqual([]);
  });

  it('is heard outside the shadow root it was dispatched in', async () => {
    const element = await mountInsideAShadowRoot(threeWorkouts());
    const opens = opensHeardOn(document.body);

    await pressOpen(element, 2);

    expect(opens).toHaveLength(1);
    expect(opens[0]?.id).toBe('past-c');
  });

  it('names the row it belongs to, the same way the Repeat does', async () => {
    const element = await mount([
      aWorkout('past-a', { title: 'Squat day', localDate: MIDDLE }),
      aWorkout('past-b', { title: null, localDate: EARLIEST }),
    ]);

    const [first, second] = openButtons(element);
    if (first === undefined || second === undefined) throw new Error('Both rows want an Open.');
    expect(innerButton(first).getAttribute('aria-label')).toBe(
      `${HISTORY_NOTES.open}: Squat day, ${MIDDLE}`,
    );
    expect(innerButton(second).getAttribute('aria-label')).toBe(
      `${HISTORY_NOTES.open}: ${HISTORY_NOTES.unnamed}, ${EARLIEST}`,
    );
  });
});

describe('a session already in progress', () => {
  it('withdraws every Repeat and says once why, however many rows there are', async () => {
    // `busy` is set after the first render rather than before it, which is the one
    // test shape that fails when the decorator configuration is wrong -- and this is
    // also how it actually arrives, from a root that has just read a live session out
    // of storage.
    const element = await mount(threeWorkouts());
    expect(repeatButtons(element)).toHaveLength(3);

    element.busy = true;
    await element.updateComplete;

    expect(repeatButtons(element)).toHaveLength(0);
    // Still three rows: the history is readable while a session is open, it just
    // cannot be started from.
    expect(rows(element)).toHaveLength(3);
    // One sentence for the whole list. The reason is never about the row, and three
    // copies of it -- eight, for a real logbook -- is how a note stops being read.
    expect(notes(element).filter((note) => note === HISTORY_NOTES.repeatBusy)).toHaveLength(1);
  });

  it('keeps every Open, because reading last week cannot disturb this week', async () => {
    // The reason the Repeats go is that only one session can be open at a time, and
    // that reason says nothing about reading. Withdrawing both is the easy mistake --
    // one `busy` guard around the whole action block -- and it takes the logbook away
    // at the one moment it is most likely to be wanted, standing at the rack between
    // sets wondering what the last set of five went at.
    const element = await mount(threeWorkouts());
    element.busy = true;
    await element.updateComplete;

    expect(openButtons(element)).toHaveLength(3);

    const opens = opensHeardOn(element);
    await pressOpen(element, 1);

    expect(opens).toHaveLength(1);
    expect(opens[0]?.id).toBe('past-b');
  });

  it('offers them again once the session is over', async () => {
    // Paired with the case above for the same reason the notes mark is: a screen that
    // never drew the buttons would pass that one.
    const element = await mount(threeWorkouts());
    element.busy = true;
    await element.updateComplete;

    element.busy = false;
    await element.updateComplete;

    expect(repeatButtons(element)).toHaveLength(3);
    expect(notes(element)).not.toContain(HISTORY_NOTES.repeatBusy);
  });

  it('starts nothing while it is busy, whatever is pressed', async () => {
    // Withdrawing the button is a rendering decision and the guard in the handler is
    // the one that holds: a press can still arrive from a control the render has not
    // caught up with, or from anything else in the row.
    const element = await mount(threeWorkouts());
    element.busy = true;
    await element.updateComplete;
    const asked = repeatsHeardOn(element);

    row(element, 2).click();
    one(row(element, 2), '.name').click();
    await element.updateComplete;

    expect(asked).toEqual([]);
  });
});

describe('accessibility', () => {
  it('has no violations with a list of sessions on screen', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends on
    // the page background this element does not control.
    const element = await mount(threeWorkouts());

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('has no violations with the Repeats withdrawn', async () => {
    const element = await mount(threeWorkouts());
    element.busy = true;
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
