// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The movements a lifter invents, driven through the whole tool in a real browser.
 *
 * Through `ptk-training-logbook` for `ptk-equipment-library.browser.test.ts`' reason:
 * everything worth breaking is between elements. The library element has no clock and
 * no id source, the root is the only thing that may mint either, and the picker on the
 * builder screen is a third element that has to see the result. A suite that set
 * `.exercises` on the library and read the event back would assert that a property was
 * assigned.
 *
 * THE TWO TESTS THIS FILE EXISTS FOR
 *
 * "keeps the identifier when an exercise is edited". A save that minted a fresh id
 * would look right on every screen this suite could photograph -- the row updates, the
 * picker updates, the name changes -- and would quietly orphan every session already
 * planned from it. Only reading the row's identifier before and after can see it.
 *
 * "never files a warm-up family the lifter did not choose". Section 6.4 is a rule about
 * something *not* happening, and the way it breaks is a well-meant inference from the
 * name. The case adds a movement called "Squat" -- the one string any such inference
 * would match -- and asserts the stored family is null.
 *
 * Every name and weight here is invented (section 5.1).
 */

// Without the stylesheet every declaration reading a custom property is dropped, so the
// controls render with no tap-target floor and the accessibility pass measures a screen
// that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AT_START, ON_DAY } from '../core/context.fixture.js';
import { indexedDbLogbookStore } from '../storage/indexed-db.js';
import { memoryLogbookStore } from '../storage/memory.js';
import type { LogbookStore } from '../storage/port.js';
import { createRepository } from '../storage/repository.js';
import type { CalendarDay, CustomExercise, Instant, LogbookId } from '../types.js';

import { EXERCISE_NOTES, LOADING_LABELS, SAVE_STATES, WARMUP_FAMILY_LABELS } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import { STORAGE_WAIT } from './storage.fixture.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';

const TODAY: CalendarDay = ON_DAY;
const VERSION = '0.0.0-test';

/** A movement no catalogue entry is called, so nothing can pass by resembling one. */
const A_MOVEMENT = 'Belt squat';

let clock: Instant = AT_START;

const teardown: (() => void | Promise<void>)[] = [];

/** A database per case. Sharing one would make the suite order-dependent. */
let databases = 0;

beforeAll(() => {
  defineTrainingLogbook();
});

beforeEach(() => {
  clock = AT_START;
});

afterEach(async () => {
  for (const dispose of teardown.splice(0).reverse()) {
    await dispose();
  }
});

/** A real IndexedDB store, under a name nothing else in the run uses. */
async function durableStore(): Promise<{ store: LogbookStore; databaseName: string }> {
  databases += 1;
  const databaseName = `ptk-logbook-exercise-test-${String(databases)}`;
  const store = await indexedDbLogbookStore({ databaseName });
  if (store === null) {
    throw new Error('This browser gave the test no IndexedDB, so section 18.9 is untestable.');
  }
  teardown.push(() => {
    store.close();
    indexedDB.deleteDatabase(databaseName);
  });
  return { store, databaseName };
}

/** The same database again, as a page that has just been reloaded would find it. */
async function reopen(databaseName: string): Promise<LogbookStore> {
  const store = await indexedDbLogbookStore({ databaseName });
  if (store === null) throw new Error('The database that existed a moment ago is gone.');
  teardown.push(() => {
    store.close();
  });
  return store;
}

async function mount(store: LogbookStore): Promise<PtkTrainingLogbook> {
  const element = document.createElement('ptk-training-logbook');
  let next = 0;
  element.repository = createRepository(store, {
    now: () => clock,
    applicationVersion: VERSION,
  });
  element.today = TODAY;
  element.now = (): Instant => clock;
  element.nextId = (): LogbookId => {
    next += 1;
    return `id-${String(next)}`;
  };
  element.applicationVersion = VERSION;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });

  // The first read is asynchronous and `updateComplete` says nothing about it. The
  // storage line is what that read sets, so waiting for the line is waiting for the load.
  //
  // It is not waiting for *this* library. `#reloadExercises` runs after the boot read
  // rather than inside it, deliberately, so a mount that has a storage line can still be
  // one round trip short of its custom movements. A case that expects a stored row on a
  // freshly mounted element has to wait for the row itself -- see the reopen case below.
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(shadow(element).querySelector('.save')).not.toBeNull();
  }, STORAGE_WAIT);
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

/**
 * The region this library speaks into -- and not the other library's.
 *
 * Scoped to the host rather than searched for from the root, because both libraries sit
 * on the home screen and both draw a `.unreadable` region. A deep search finds two and
 * takes the first, which is how this case spent a mutation run asserting things about
 * the element it was not testing.
 */
function unreadableRegion(element: PtkTrainingLogbook): HTMLElement {
  const found = shadow(one(shadow(element), 'ptk-exercise-library')).querySelector('.unreadable');
  if (!(found instanceof HTMLElement)) throw new Error('The library drew no region to speak into.');
  return found;
}

function one(root: DocumentFragment | HTMLElement, selector: string): HTMLElement {
  const found = deepAll(root, selector)[0];
  if (found === undefined) throw new Error(`Nothing on this screen matches "${selector}".`);
  return found;
}

/** Everything the tool has drawn, across every shadow root under it. */
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

/** What the storage line says, with the template's own whitespace taken off. */
function saveLine(element: PtkTrainingLogbook): string {
  return (shadow(element).querySelector('.save')?.textContent ?? '').trim();
}

/**
 * Waits for the tool to stop saying it is mid-save.
 *
 * Every write is started from an event handler and awaited nowhere the test can see, so
 * `updateComplete` resolves on the render before the database answers.
 */
async function settle(element: PtkTrainingLogbook): Promise<void> {
  await element.updateComplete;
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(saveLine(element)).not.toBe(SAVE_STATES.unsaved);
  }, STORAGE_WAIT);
}

/** The exercise library, which is one section of the home screen. */
function library(element: PtkTrainingLogbook): HTMLElement {
  return one(shadow(element), 'ptk-exercise-library');
}

/** Types into one of the library's boxes the way a thumb does. */
async function typeInto(element: PtkTrainingLogbook, field: string, text: string): Promise<void> {
  const host = one(shadow(library(element)), `ptk-text-field[data-field="${field}"]`);
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error(`The "${field}" field has no box to type in.`);
  input.value = text;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(element);
}

/** Answers one of the library's selects. */
async function pick(element: PtkTrainingLogbook, field: string, value: string): Promise<void> {
  const host = one(shadow(library(element)), `ptk-select[data-field="${field}"]`);
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error(`The "${field}" field is not a select.`);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(element);
}

/** Which option one of the library's selects is currently showing. */
function picked(element: PtkTrainingLogbook, field: string): string {
  const host = one(shadow(library(element)), `ptk-select[data-field="${field}"]`);
  const select = shadow(host).querySelector('select');
  if (select === null) throw new Error(`The "${field}" field is not a select.`);
  return select.value;
}

/** Whether a select is on the screen at all, which some of them are conditional on. */
function hasField(element: PtkTrainingLogbook, field: string): boolean {
  return deepAll(shadow(library(element)), `[data-field="${field}"]`).length > 0;
}

/** Answers the unit segments. */
async function chooseUnit(element: PtkTrainingLogbook, value: string): Promise<void> {
  const wrapper = one(shadow(library(element)), '[data-field="exercise-unit"]');
  const group = one(wrapper, 'ptk-segmented');
  const radio = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === value,
  );
  if (radio === undefined) throw new Error(`The unit control does not offer "${value}".`);
  radio.click();
  await settle(element);
}

/** Flips the warm-up tick. */
async function tickWarmup(element: PtkTrainingLogbook): Promise<void> {
  const wrapper = one(shadow(library(element)), '[data-field="exercise-warmup"]');
  const group = one(wrapper, 'ptk-toggle-group');
  const box = shadow(group).querySelector('input');
  if (box === null) throw new Error('The warm-up group has no tick.');
  box.click();
  await settle(element);
}

/** Presses a control by its action, inside a given row or across the library. */
async function pressAction(
  element: PtkTrainingLogbook,
  action: string,
  within: DocumentFragment | HTMLElement = shadow(library(element)),
): Promise<void> {
  const host = one(within, `[data-action="${action}"]`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`"${action}" is not a button.`);
  // The inner button and not the host: a click dispatched at the host sails straight
  // past a `disabled` control and asserts against a screen nobody could have produced.
  button.click();
  await settle(element);
}

/** Types a name and presses Add, which is the whole of the commonest press. */
async function addExercise(element: PtkTrainingLogbook, name: string): Promise<void> {
  await typeInto(element, 'exercise-name', name);
  await pressAction(element, 'save-exercise');
}

/** The saved-exercise rows, in the order they are shown. */
function exerciseRows(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(library(element)), 'li[data-exercise]');
}

function exerciseRow(element: PtkTrainingLogbook, name: string): HTMLElement {
  const row = exerciseRows(element).find((candidate) => candidate.textContent.includes(name));
  if (row === undefined) throw new Error(`No saved exercise called "${name}".`);
  return row;
}

/** What is actually in the database, which is the only thing a reload will see. */
async function stored(store: LogbookStore): Promise<readonly CustomExercise[]> {
  const repository = createRepository(store, { now: () => clock, applicationVersion: VERSION });
  return repository.listExercises();
}

async function theOne(store: LogbookStore): Promise<CustomExercise> {
  const all = await stored(store);
  const only = all[0];
  if (only === undefined || all.length !== 1) {
    throw new Error(`Expected one saved exercise, found ${String(all.length)}.`);
  }
  return only;
}

describe('adding a movement', () => {
  it('says the library is empty rather than leaving a heading over nothing', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    expect(readAll(element)).toContain(EXERCISE_NOTES.libraryEmpty);
  });

  it('refuses to save one with no name, and says why', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    await pressAction(element, 'save-exercise');

    expect(readAll(element)).toContain(EXERCISE_NOTES.nameRequired);
    expect(await stored(store)).toEqual([]);
  });

  it('keeps the name, the loading model and the unit the lifter chose', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    await typeInto(element, 'exercise-name', A_MOVEMENT);
    await pick(element, 'exercise-loading', 'machine-or-cable-weight');
    await chooseUnit(element, 'kg');
    await pressAction(element, 'save-exercise');

    const saved = await theOne(store);
    expect(saved.name).toBe(A_MOVEMENT);
    expect(saved.loading).toBe('machine-or-cable-weight');
    expect(saved.defaultUnit).toBe('kg');
    expect(exerciseRows(element)).toHaveLength(1);
    // The model is on the row as well as in the database, because it is the one thing
    // about a movement a lifter cannot work out from its name.
    expect(exerciseRow(element, A_MOVEMENT).textContent).toContain(
      LOADING_LABELS['machine-or-cable-weight'],
    );
  });

  it('leaves the unit following the setting unless the lifter says otherwise', async () => {
    // `null` and not a unit, which is the difference between "always in kilograms" and
    // "whatever the logbook is set to". Storing the current setting here would freeze a
    // choice the lifter never made.
    const { store } = await durableStore();
    const element = await mount(store);

    await addExercise(element, A_MOVEMENT);

    expect((await theOne(store)).defaultUnit).toBeNull();
  });

  it('never files a warm-up family the lifter did not choose', async () => {
    // Section 6.4, and the name is the bait: "Squat" is what any inference from the
    // string would match, and the catalogue's own squat is `squat-press`.
    const { store } = await durableStore();
    const element = await mount(store);

    await addExercise(element, 'Squat');

    expect((await theOne(store)).warmupFamily).toBeNull();
  });

  it('files the family once the lifter ticks the box and picks one', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    await typeInto(element, 'exercise-name', A_MOVEMENT);
    // The select does not exist until the tick is on, which is what makes the family
    // unchoosable by accident.
    expect(hasField(element, 'exercise-family')).toBe(false);
    await tickWarmup(element);
    expect(hasField(element, 'exercise-family')).toBe(true);
    await pick(element, 'exercise-family', 'deadlift');
    await pressAction(element, 'save-exercise');

    expect((await theOne(store)).warmupFamily).toBe('deadlift');
  });

  it('offers no warm-up tick for a movement that is not on a barbell, and says why', async () => {
    // `canGenerateWarmup`'s other half: the engine loads a bar, and there are no plates
    // to put on a cable stack. The sentence goes where the control was.
    const { store } = await durableStore();
    const element = await mount(store);

    await pick(element, 'exercise-loading', 'repetitions-only');

    expect(hasField(element, 'exercise-warmup')).toBe(false);
    expect(readAll(element)).toContain(EXERCISE_NOTES.warmupBarbellOnly);
  });

  it('drops a family the lifter ticked and then made unreachable', async () => {
    // Ticking the box, then changing the model to something no ramp can be built for.
    // The control is gone by then, so a stored family would be one nothing on screen
    // says and nothing in the tool would ever read.
    const { store } = await durableStore();
    const element = await mount(store);

    await typeInto(element, 'exercise-name', A_MOVEMENT);
    await tickWarmup(element);
    await pick(element, 'exercise-family', 'olympic');
    await pick(element, 'exercise-loading', 'assisted-bodyweight');
    await pressAction(element, 'save-exercise');

    expect((await theOne(store)).warmupFamily).toBeNull();
  });

  it('empties the form so the next press is not an accidental second copy', async () => {
    const { store } = await durableStore();
    const element = await mount(store);

    await typeInto(element, 'exercise-name', A_MOVEMENT);
    await pick(element, 'exercise-loading', 'bodyweight');
    await chooseUnit(element, 'lb');
    await pressAction(element, 'save-exercise');

    expect(picked(element, 'exercise-loading')).toBe('barbell-total-weight');
    await pressAction(element, 'save-exercise');
    expect(readAll(element)).toContain(EXERCISE_NOTES.nameRequired);
    expect(await stored(store)).toHaveLength(1);
  });

  it('replaces one added under a name already in the library', async () => {
    // Case-insensitively, as a gym is: two rows called "Belt squat" are
    // indistinguishable in the picker, and the second is how a lifter loses track of
    // which one their history is filed under.
    const { store } = await durableStore();
    const element = await mount(store);

    await addExercise(element, A_MOVEMENT);
    const first = await theOne(store);

    await typeInto(element, 'exercise-name', A_MOVEMENT.toLocaleUpperCase());
    await pick(element, 'exercise-loading', 'bodyweight');
    await pressAction(element, 'save-exercise');

    const second = await theOne(store);
    expect(second.id).toBe(first.id);
    expect(second.loading).toBe('bodyweight');
  });

  it('is still there after the tab is closed and the database opened again', async () => {
    const { store, databaseName } = await durableStore();
    const first = await mount(store);
    await addExercise(first, A_MOVEMENT);

    first.remove();
    store.close();

    const second = await mount(await reopen(databaseName));
    // Waited for rather than asserted outright. The row arrives on the read that runs
    // after the boot one, so a machine slow enough to put a scheduler tick between them
    // renders the library empty first -- which CI did on 2026-08-07, nought rows against
    // a database that had one, on a change that touched none of this.
    await vi.waitFor(async () => {
      await second.updateComplete;
      expect(exerciseRows(second)).toHaveLength(1);
    });
    expect(readAll(second)).toContain(A_MOVEMENT);
  });
});

describe('editing and removing', () => {
  it('keeps the identifier when an exercise is edited', async () => {
    // The regression test named at the top of this file. A fresh id looks right on
    // every screen and orphans every session already planned from the row.
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);
    const before = await theOne(store);

    await pressAction(element, 'edit-exercise', exerciseRow(element, A_MOVEMENT));
    await typeInto(element, 'exercise-name', 'Belt squat, high handle');
    await pressAction(element, 'save-exercise');

    const after = await theOne(store);
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Belt squat, high handle');
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('loads what was saved back into the form, including the warm-up answer', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await typeInto(element, 'exercise-name', A_MOVEMENT);
    await tickWarmup(element);
    await pick(element, 'exercise-family', 'pull');
    await chooseUnit(element, 'kg');
    await pressAction(element, 'save-exercise');

    await pressAction(element, 'edit-exercise', exerciseRow(element, A_MOVEMENT));

    expect(picked(element, 'exercise-family')).toBe('pull');
    expect(readAll(element)).toContain(EXERCISE_NOTES.saveEdit);
  });

  it('puts the form back the way it was when the edit is cancelled', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);

    await pressAction(element, 'edit-exercise', exerciseRow(element, A_MOVEMENT));
    await pressAction(element, 'cancel-exercise');

    expect(readAll(element)).toContain(EXERCISE_NOTES.add);
    expect(await stored(store)).toHaveLength(1);
    expect((await theOne(store)).name).toBe(A_MOVEMENT);
  });

  it('forgets one the lifter removes', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);

    await pressAction(element, 'remove-exercise', exerciseRow(element, A_MOVEMENT));

    expect(exerciseRows(element)).toHaveLength(0);
    expect(await stored(store)).toEqual([]);
  });

  it('says the library could not be read rather than drawing it as empty', async () => {
    // The two look identical and only one of them makes adding under a familiar name
    // safe. The built-in catalogue stays up, which is the point of reading the customs
    // outside the boot `Promise.all`: a bad row must not cost a lifter the squat.
    // Held open rather than rejected outright, because what is being asked here is that
    // the region pre-dates the sentence -- and a read that has already failed by the time
    // the element is mounted cannot tell a region that was always there from one built
    // around its own text. `mount` waits on the storage line, which the boot read sets;
    // this read runs after it.
    let refuse: (cause: Error) => void = () => undefined;
    const refusal = new Promise<never>((_resolve, reject) => {
      refuse = reject;
    });
    const store: LogbookStore = {
      ...memoryLogbookStore(),
      readExercises: () => refusal,
    };
    const element = await mount(store);

    // Captured before the sentence, because the region is what has to pre-date it: one
    // created at the moment it has something in it is announced by roughly half the
    // engines and reliably by none, which `ptk-rest-timer` sets out at length. The
    // identity check below is how that is asked -- the same node, holding the sentence.
    const region = unreadableRegion(element);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent.trim()).toBe('');

    refuse(new Error('unreadable'));

    // Waited for, like the reopen case above and for the same reason: the sentence is
    // written by the read that runs after the boot one, and an element that has a storage
    // line has not necessarily had its answer yet. Unwaited, this passes on a fast machine
    // and reports the empty library as unreadable on a slow one.
    await vi.waitFor(async () => {
      await element.updateComplete;
      expect(readAll(element)).toContain(EXERCISE_NOTES.libraryUnreadable);
    });
    expect(unreadableRegion(element)).toBe(region);
    expect(readAll(element)).not.toContain(EXERCISE_NOTES.libraryEmpty);
    // The rest of the tool is untouched: a session can still be planned.
    await pressAction(element, 'start-workout', shadow(element));
    expect(readAll(element)).toContain('Squat');
  });
});

describe('what the rest of the tool sees', () => {
  it('offers the movement in the picker beside the built-in ones', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);

    await pressAction(element, 'start-workout', shadow(element));

    const picker = one(shadow(element), 'ptk-select');
    const options = [...shadow(picker).querySelectorAll('option')].map((node) => node.textContent);
    expect(options).toContain(A_MOVEMENT);
    expect(options).toContain('Squat');
  });

  it('has no accessibility violations with a movement saved and the form open', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends on the
    // page background this element does not control.
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);
    await pressAction(element, 'edit-exercise', exerciseRow(element, A_MOVEMENT));
    await tickWarmup(element);

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('names the row controls for the movement they act on', async () => {
    // Eight rows of "Edit" would otherwise be eight identical accessible names. The
    // visible word is inside the name, word for word, which is WCAG 2.5.3.
    const { store } = await durableStore();
    const element = await mount(store);
    await addExercise(element, A_MOVEMENT);

    const row = exerciseRow(element, A_MOVEMENT);
    const names = deepAll(row, 'ptk-button').map((button) =>
      shadow(button).querySelector('button')?.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      `${EXERCISE_NOTES.edit} ${A_MOVEMENT}`,
      `${EXERCISE_NOTES.remove} ${A_MOVEMENT}`,
    ]);
  });

  it('reads the family choices as movements rather than as family names', async () => {
    // `pull` is rows and shrugs and not chin-ups; `assistance` is a jump pattern and
    // not a category of exercise. Neither identifier is answerable without section 8.2.
    const { store } = await durableStore();
    const element = await mount(store);
    await tickWarmup(element);

    const host = one(shadow(library(element)), 'ptk-select[data-field="exercise-family"]');
    const options = [...shadow(host).querySelectorAll('option')].map((node) => node.textContent);
    expect(options).toContain(WARMUP_FAMILY_LABELS.pull);
    expect(options).not.toContain('pull');
  });
});
