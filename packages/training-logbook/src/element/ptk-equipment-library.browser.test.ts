// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rack and the library, driven through the whole tool in a real browser.
 *
 * Through `ptk-training-logbook` rather than by mounting the library on its own,
 * because everything worth breaking here is between elements: the rack editor lives in
 * `packages/ui` and knows nothing about this tool, the library element holds a draft it
 * must not let the round trip overwrite, and the root is the only thing that may mint an
 * identifier or touch storage. A suite that set `.equipment` on the library and read the
 * event back would assert that a property was assigned.
 *
 * THE ONE TEST THIS FILE EXISTS FOR
 *
 * "keeps the bar the lifter picked while the rack is being written". The obvious
 * implementation of this screen -- render the editor from `equipmentFrom(snapshot)` --
 * type-checks, passes every unit test in the package, prints identical text on every
 * screen, and destroys a lifter's rack one keystroke at a time. `core/equipment.test.ts`
 * cannot see it: it pins the lossy half of that reconstruction as *intentional*, which
 * it is, for the one call it was written for. Only a test that edits the rack twice and
 * looks at the control afterwards can tell the difference.
 *
 * Every weight, plate and gym name here is invented (section 5.1).
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
import type { CalendarDay, Instant, LogbookId } from '../types.js';

import { EQUIPMENT_NOTES, SAVE_STATES } from './copy.js';
import { defineTrainingLogbook } from './index.js';
import type { PtkTrainingLogbook } from './ptk-training-logbook.js';

const TODAY: CalendarDay = ON_DAY;
const VERSION = '0.0.0-test';

/** A bar nobody's defaults pick, so nothing can pass by resembling the default. */
const A_BAR = 'womens-15';

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
  const databaseName = `ptk-logbook-equipment-test-${String(databases)}`;
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
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(shadow(element).querySelector('.save')).not.toBeNull();
  });
  await openTheRack(element);
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
  });
}

/** Unfolds the rack editor by pressing its summary, which is how a lifter opens it. */
async function openTheRack(element: PtkTrainingLogbook): Promise<void> {
  one(shadow(element), 'ptk-equipment-setup');
  const fold = one(shadow(element), 'ptk-disclosure');
  const summary = shadow(fold).querySelector('summary');
  if (summary === null) throw new Error('The rack editor has no fold to open.');
  summary.click();
  await settle(element);
}

/** Answers one of the rack editor's radio groups the way a thumb does. */
async function chooseRack(
  element: PtkTrainingLogbook,
  field: string,
  value: string,
): Promise<void> {
  const group = one(shadow(element), `ptk-choice-group[data-field="${field}"]`);
  const radio = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === value,
  );
  if (radio === undefined) throw new Error(`No "${value}" to choose in "${field}".`);
  radio.click();
  await settle(element);
}

/** Which option a rack radio group is currently showing as answered. */
function chosenRack(element: PtkTrainingLogbook, field: string): string | null {
  const group = one(shadow(element), `ptk-choice-group[data-field="${field}"]`);
  const checked = [...shadow(group).querySelectorAll('input')].find((input) => input.checked);
  return checked?.value ?? null;
}

/** Flips one plate denomination on or off. The switches are the one toggle group here. */
async function togglePlate(element: PtkTrainingLogbook, weight: string): Promise<void> {
  const group = one(shadow(element), 'ptk-toggle-group');
  const box = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === weight,
  );
  if (box === undefined) throw new Error(`The rack has no "${weight}" switch.`);
  box.click();
  await settle(element);
}

/** Whether a plate denomination is currently on the rack. */
function hasPlate(element: PtkTrainingLogbook, weight: string): boolean {
  const group = one(shadow(element), 'ptk-toggle-group');
  const box = [...shadow(group).querySelectorAll('input')].find(
    (candidate) => candidate.value === weight,
  );
  return box?.checked ?? false;
}

/** Types a gym's name and presses Save, the way a lifter does. */
async function saveGym(element: PtkTrainingLogbook, name: string): Promise<void> {
  const host = one(shadow(element), 'ptk-text-field[data-field="gym-name"]');
  const input = shadow(host).querySelector('input');
  if (input === null) throw new Error('The gym name field has no box to type in.');
  input.value = name;
  // `input` and not `change`: every field in `packages/ui` reports on `@input`.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(element);
  await pressAction(element, 'save-rack');
}

/** Presses a control by its action, inside a given row or across the screen. */
async function pressAction(
  element: PtkTrainingLogbook,
  action: string,
  within: DocumentFragment | HTMLElement = shadow(element),
): Promise<void> {
  const host = one(within, `[data-action="${action}"]`);
  const button = shadow(host).querySelector('button');
  if (button === null) throw new Error(`"${action}" is not a button.`);
  // The inner button and not the host: a click dispatched at the host sails straight
  // past a `disabled` control and asserts against a screen nobody could have produced.
  button.click();
  await settle(element);
}

/** The saved-gym rows, in the order they are shown. */
function gymRows(element: PtkTrainingLogbook): HTMLElement[] {
  return deepAll(shadow(element), 'li[data-profile]');
}

function gymRow(element: PtkTrainingLogbook, name: string): HTMLElement {
  const row = gymRows(element).find((candidate) => candidate.textContent.includes(name));
  if (row === undefined) throw new Error(`No saved gym called "${name}".`);
  return row;
}

describe('the rack in force', () => {
  it('opens on a rack it has not saved, so nothing has chosen one for the lifter', async () => {
    // `settings.equipment` staying null is what lets the plate-loading card draw
    // nothing rather than draw a default gym's plates under somebody's session. Merely
    // opening the home screen must not spend that.
    const { store } = await durableStore();
    const element = await mount(store);
    expect(readAll(element)).toContain(EQUIPMENT_NOTES.editorSummary);

    const repository = createRepository(store, { now: () => clock, applicationVersion: VERSION });
    expect((await repository.loadSettings()).equipment).toBeNull();
  });

  it('keeps the bar the lifter picked while the rack is being written', async () => {
    // The regression test named at the top of this file. Two edits, not one: the first
    // makes the tool store a snapshot, and the damage lands when that snapshot comes
    // back down the property and is rebuilt into an `Equipment`. One edit passes under
    // the broken implementation as well as the correct one.
    const { store } = await durableStore();
    const element = await mount(store);

    await chooseRack(element, 'bar', A_BAR);
    expect(chosenRack(element, 'bar')).toBe(A_BAR);

    await togglePlate(element, '25');
    expect(chosenRack(element, 'bar')).toBe(A_BAR);
  });

  it('leaves the plates of the unit the lifter is not in alone', async () => {
    // The invisible half of the same bug, and the expensive one: a reconstruction
    // refills the inactive unit from the catalogue default, so a rack the lifter set up
    // in kilograms is quietly restocked every time they touch anything in pounds. Found
    // weeks later, at a rack, with a warm-up calling for a plate that is not there.
    const { store } = await durableStore();
    const element = await mount(store);

    await chooseRack(element, 'unit', 'kg');
    await togglePlate(element, '20');
    expect(hasPlate(element, '20')).toBe(false);

    await chooseRack(element, 'unit', 'lb');
    await togglePlate(element, '35');

    await chooseRack(element, 'unit', 'kg');
    expect(hasPlate(element, '20')).toBe(false);
  });

  it('is still the same rack after the tab is closed and the database opened again', async () => {
    // Section 18.9 applied to equipment. The in-memory store would prove nothing here:
    // it reports `durable: false`, and the tool honestly declines to promise anything.
    const { store, databaseName } = await durableStore();
    const first = await mount(store);
    await chooseRack(first, 'bar', A_BAR);
    expect(saveLine(first)).toBe(SAVE_STATES.saved);

    first.remove();
    store.close();

    const second = await mount(await reopen(databaseName));
    expect(chosenRack(second, 'bar')).not.toBeNull();
    const repository = createRepository(await reopen(databaseName), {
      now: () => clock,
      applicationVersion: VERSION,
    });
    expect((await repository.loadSettings()).equipment).not.toBeNull();
  });

  it('does not change what weights are shown in when the plate unit changes', async () => {
    // Two independent facts. `plateUnit` is what is on the bar; `displayUnit` is what a
    // lifter types and reads. A lifter who trains at a kilogram gym and thinks in pounds
    // is ordinary, and coupling these would rewrite their whole logbook's vocabulary
    // because they walked into a different room.
    const { store } = await durableStore();
    const element = await mount(store);
    const repository = createRepository(store, { now: () => clock, applicationVersion: VERSION });
    const before = (await repository.loadSettings()).displayUnit;

    await chooseRack(element, 'unit', 'kg');

    expect((await repository.loadSettings()).displayUnit).toBe(before);
  });
});

describe('the library of saved gyms', () => {
  it('says the library is empty rather than leaving a heading over nothing', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    expect(readAll(element)).toContain(EQUIPMENT_NOTES.libraryEmpty);
    expect(gymRows(element)).toHaveLength(0);
  });

  it('refuses to save a gym with no name, and says why', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await pressAction(element, 'save-rack');

    expect(readAll(element)).toContain(EQUIPMENT_NOTES.nameRequired);
    expect(gymRows(element)).toHaveLength(0);
  });

  it('keeps the rack under a name and marks it as the one in use', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await chooseRack(element, 'bar', A_BAR);
    await saveGym(element, 'The garage');

    expect(gymRow(element, 'The garage').textContent).toContain(EQUIPMENT_NOTES.inUse);
  });

  it('replaces a gym saved under a name already in the library', async () => {
    // The ordinary case rather than an error, which is what `saveOverwrites` promises.
    // A second row under the same word is a library a lifter cannot use.
    const { store } = await durableStore();
    const element = await mount(store);
    await saveGym(element, 'The garage');
    await chooseRack(element, 'bar', A_BAR);
    await saveGym(element, 'the garage');

    expect(gymRows(element)).toHaveLength(1);
    expect(gymRow(element, 'The garage').textContent).toContain(EQUIPMENT_NOTES.inUse);
  });

  it('stands the lifter in a gym they saved earlier', async () => {
    const { store } = await durableStore();
    const element = await mount(store);
    await saveGym(element, 'The garage');
    await chooseRack(element, 'bar', A_BAR);
    await saveGym(element, 'The club');

    // Back to the first, which is no longer the rack in force.
    await pressAction(element, 'use-rack', gymRow(element, 'The garage'));

    expect(gymRow(element, 'The garage').textContent).toContain(EQUIPMENT_NOTES.inUse);
    expect(gymRow(element, 'The club').textContent).not.toContain(EQUIPMENT_NOTES.inUse);
  });

  it('leaves the rack in force alone when the gym it came from is removed', async () => {
    // Section 8.4 in miniature. Forgetting where a gym's name was written down is not
    // walking out of it, and every finished workout done there is untouched either way.
    const { store } = await durableStore();
    const element = await mount(store);
    await chooseRack(element, 'bar', A_BAR);
    await saveGym(element, 'The garage');

    await pressAction(element, 'remove-rack', gymRow(element, 'The garage'));

    expect(gymRows(element)).toHaveLength(0);
    expect(chosenRack(element, 'bar')).toBe(A_BAR);
    const repository = createRepository(store, { now: () => clock, applicationVersion: VERSION });
    expect((await repository.loadSettings()).equipment).not.toBeNull();
  });

  it('says the library could not be read rather than drawing it as empty', async () => {
    // The two look identical and only one of them makes saving under a familiar name
    // safe. The rest of the tool stays up, which is the point of reading the profiles
    // outside the boot `Promise.all`: a bad row must not cost a lifter their history.
    const store: LogbookStore = {
      ...memoryLogbookStore(),
      readProfiles: () => Promise.reject(new Error('unreadable')),
    };
    const element = await mount(store);

    // Waited for rather than asserted outright. `#reloadProfiles` runs after the boot read
    // and not inside it, so an element that already has a storage line can still be one
    // round trip short of this sentence -- and unwaited, the case reports an empty library
    // as unreadable on any machine slow enough to put a tick between the two.
    await vi.waitFor(async () => {
      await element.updateComplete;
      expect(readAll(element)).toContain(EQUIPMENT_NOTES.libraryUnreadable);
    });
    expect(readAll(element)).not.toContain(EQUIPMENT_NOTES.libraryEmpty);
    // The rack above still works, and so does everything else on the screen.
    await chooseRack(element, 'bar', A_BAR);
    expect(chosenRack(element, 'bar')).toBe(A_BAR);
  });

  it('has no accessibility violations with the rack open and a gym saved', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends on the
    // page background this element does not control.
    const { store } = await durableStore();
    const element = await mount(store);
    await saveGym(element, 'The garage');

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
