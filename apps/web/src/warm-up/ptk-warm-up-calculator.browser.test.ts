// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  createPreferenceStore,
  memoryPreferenceStorage,
  PREFERENCE_KEY_PREFIX,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
import type { PtkButton } from '@platform-toolkit/ui/ptk-button';
import type { PtkChoiceGroup } from '@platform-toolkit/ui/ptk-choice-group';
// Without the stylesheet every declaration reading a custom property is
// dropped, so the column measured below has no padding and no gaps -- a layout
// that never ships, and one that both passes and fails for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_EQUIPMENT, saveEquipment, type Equipment } from './equipment.js';
import type { LogbookHandoff } from './handoff.js';
import type { PtkLiftCard } from './ptk-lift-card.js';
import type { PtkWarmUpCalculator } from './ptk-warm-up-calculator.js';
import './ptk-warm-up-calculator.js';
import { addLift, saveEntries, SESSION_PREFERENCES, type LiftEntry } from './session.js';

/**
 * The two storage keys, built the way the store builds them.
 *
 * Spelled out as literals they would keep matching after a definition was
 * renamed, and the assertion below -- that neither key appears in the other
 * store -- would then hold trivially over two names nothing writes.
 */
const ENTRIES_KEY = PREFERENCE_KEY_PREFIX + SESSION_PREFERENCES.entries.name;
const MARKS_KEY = PREFERENCE_KEY_PREFIX + SESSION_PREFERENCES.marks.name;

/**
 * A remembered rack in kilograms, which is what a unit-change test needs.
 *
 * The tool defaults to pounds on a pound bar, so a test that starts from the
 * default and then picks pounds has changed nothing -- and every assertion
 * about what a unit change does then holds over a tap that did not happen.
 * These three tests are the only ones in the file that care which unit the
 * session opens in, so the fixture is theirs rather than the mount helper's.
 */
const KG_RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  plateUnit: 'kg',
  barId: 'olympic-20',
  customBar: { amount: 20, unit: 'kg' },
};

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * This is the whole tool composed: three elements, each in its own tree, wired
 * together by eight composed events. Everything asserted here is a fact about
 * the wiring rather than about any one component -- which of the two stores a
 * tick lands in, whether a unit switch asks before reinterpreting a weight, and
 * whether the screen survives having no storage at all.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<Pick<PtkWarmUpCalculator, 'settings' | 'marks' | 'logbook'>> = {},
): Promise<PtkWarmUpCalculator> {
  const element = document.createElement('ptk-warm-up-calculator');
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function cards(element: PtkWarmUpCalculator): PtkLiftCard[] {
  return [...(element.shadowRoot?.querySelectorAll('ptk-lift-card') ?? [])];
}

/** Presses a button anywhere in the tool by its accessible name. */
async function press(element: PtkWarmUpCalculator, accessibleName: string): Promise<void> {
  for (const host of element.shadowRoot?.querySelectorAll('*') ?? []) {
    const found = host.shadowRoot?.querySelector<PtkButton>(
      `ptk-button[accessible-name="${accessibleName}"]`,
    );
    const inner = found?.shadowRoot?.querySelector('button');
    if (inner instanceof HTMLButtonElement) {
      inner.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No button named "${accessibleName}" anywhere in the tool.`);
}

/** Answers a `ptk-choice-group` by clicking one of its radios. */
async function choose(
  element: PtkWarmUpCalculator,
  group: PtkChoiceGroup,
  value: string,
): Promise<void> {
  const radio = [...(group.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}".`);
  radio.click();
  await element.updateComplete;
}

/** Types a working weight into a card, three shadow roots down. */
async function typeWeight(element: PtkWarmUpCalculator, text: string, card = 0): Promise<void> {
  const field = cards(element)[card]?.shadowRoot?.querySelector(
    'ptk-number-field[data-field="weight"]',
  );
  const input = field?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No weight field on card ${card}.`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** The plate-unit question, which lives inside the equipment element's tree. */
function unitGroup(element: PtkWarmUpCalculator): PtkChoiceGroup {
  const setup = element.shadowRoot?.querySelector('ptk-equipment-setup');
  const found = setup?.shadowRoot?.querySelector<PtkChoiceGroup>(
    'ptk-choice-group[data-field="unit"]',
  );
  if (found === null || found === undefined) throw new Error('No plate unit question.');
  return found;
}

function conversionPrompt(element: PtkWarmUpCalculator): PtkChoiceGroup | null {
  return element.shadowRoot?.querySelector<PtkChoiceGroup>('.convert ptk-choice-group') ?? null;
}

/** A handoff that records what it was offered and answers the same way every time. */
interface RecordedHandoff extends LogbookHandoff {
  readonly calls: readonly (readonly LiftEntry[])[];
}

/**
 * Somewhere to hand a session to, built by hand rather than imported.
 *
 * The element takes the port as a property so that a story, an embed and this
 * file never pull the logbook's package into their module graph -- `handoff.ts`
 * is the one file in the tool that does. Reaching for the real thing to build a
 * fixture would spend exactly what that arrangement buys.
 */
function handoffAnswering(answer: 'offered' | 'unavailable'): RecordedHandoff {
  const calls: (readonly LiftEntry[])[] = [];
  return {
    // A fragment, because an anchor runs its activation behaviour on a
    // dispatched click as readily as on a real one, and a path here would
    // navigate the runner's own page out from under the suite. What is asserted
    // is that the element used the href it was handed, which a fragment carries
    // as well as anything else.
    href: '#logbook',
    calls,
    offer: (entries) => {
      calls.push(entries);
      return answer;
    },
  };
}

function logAction(element: PtkWarmUpCalculator): HTMLAnchorElement | null {
  return (
    element.shadowRoot?.querySelector<HTMLAnchorElement>('a[data-action="log-workout"]') ?? null
  );
}

function refusalNote(element: PtkWarmUpCalculator): Element | null {
  return element.shadowRoot?.querySelector('[role="alert"]') ?? null;
}

/**
 * Presses the handoff link with one mouse button and answers the event.
 *
 * Dispatched rather than really clicked, because the question every one of
 * these asks is whether the element stopped a navigation -- and a real press
 * that was not stopped would take the test page with it. `auxclick` for
 * anything but the primary button, which is both what a browser fires and what
 * the element listens for.
 */
async function pressLog(element: PtkWarmUpCalculator, button = 0): Promise<MouseEvent> {
  const action = logAction(element);
  if (action === null) throw new Error('No handoff action on screen.');
  const event = new MouseEvent(button === 0 ? 'click' : 'auxclick', {
    bubbles: true,
    cancelable: true,
    button,
  });
  action.dispatchEvent(event);
  await element.updateComplete;
  return event;
}

/**
 * A session with one lift finished enough to log.
 *
 * `addLift` leaves the weight empty, so a fixture without this line draws no
 * action at all and every assertion under it holds over a screen with nothing
 * on it. An invented figure; nothing reads it back.
 */
function finishedSquat(): readonly LiftEntry[] {
  return addLift([], 'squat').map((entry) => ({ ...entry, weight: '135' }));
}

/**
 * Adds a lift the lifter named themselves, through the picker's own form.
 *
 * Driven rather than seeded, and that is forced rather than stylistic: a custom
 * lift is deliberately never written to the store -- its name is free text and
 * there is nowhere to put it -- so a fixture handed to `saveEntries` comes back
 * from the reload with the row gone and the sentence this proves has nothing
 * left to name.
 */
async function nameOwnLift(element: PtkWarmUpCalculator, name: string): Promise<void> {
  const picker = element.shadowRoot?.querySelector('ptk-lift-picker');
  const field = picker?.shadowRoot?.querySelector('#custom-name');
  if (!(field instanceof HTMLInputElement)) throw new Error('No custom-lift name field.');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;

  // The one button in that form, and the only `ptk-button` in the tool with no
  // accessible name of its own, so `press` cannot reach it.
  const add = picker?.shadowRoot?.querySelector<PtkButton>('.named ptk-button');
  const inner = add?.shadowRoot?.querySelector('button');
  if (!(inner instanceof HTMLButtonElement)) throw new Error('No button to add a custom lift.');
  inner.click();
  await element.updateComplete;
}

/**
 * Every preference key the browser is holding, across both real storages.
 *
 * Read as a difference rather than as an absolute, because these suites share a
 * page origin with the shells' own tests and those wire real browser-backed
 * stores. An assertion that the storages are empty would pass or fail on file
 * ordering; an assertion that nothing was *added* is about this element.
 */
function preferenceKeys(): readonly string[] {
  return [window.localStorage, window.sessionStorage].flatMap((storage) =>
    Object.keys(storage).filter((key) => key.startsWith(PREFERENCE_KEY_PREFIX)),
  );
}

function storeWith(entries: readonly LiftEntry[]): PreferenceStore {
  const settings = createPreferenceStore(memoryPreferenceStorage());
  saveEntries(settings, entries, DEFAULT_EQUIPMENT.plateUnit);
  return settings;
}

describe('ptk-warm-up-calculator', () => {
  it('runs the whole tool with neither store wired', async () => {
    // Plain HTML, and the configuration this collection actually ships into: a
    // third-party iframe whose embedder blocked storage. Both properties default
    // to the *absence* of a store rather than to an inert one built here, so
    // every path has to work through nothing -- including the ones that write.
    // Adding a lift saves the entries, typing a weight saves them again and
    // re-prunes the ticks, and ticking a set saves the marks.
    const before = preferenceKeys();
    const element = await mount();
    expect(element.settings).toBeNull();
    expect(element.marks).toBeNull();

    await press(element, 'Add Squat');
    await typeWeight(element, '100');

    const card = cards(element)[0];
    const box = card?.shadowRoot?.querySelector('li label.row input');
    if (!(box instanceof HTMLInputElement)) throw new Error('No checklist row to tick.');
    box.click();
    await element.updateComplete;

    expect(element.settings).toBeNull();
    expect(element.marks).toBeNull();
    expect(cards(element)).toHaveLength(1);
    expect(box.checked).toBe(true);
    expect(preferenceKeys()).toEqual(before);
  });

  it('reads both stores when one is handed in after the first render', async () => {
    // `willUpdate` rather than `connectedCallback`: `view.ts` sets the stores as
    // properties, and a restore that only ran on connect would show the defaults
    // over a device that remembers something else. The symptom is a rack that
    // resets on some visits and not others.
    const element = await mount();
    expect(cards(element)).toHaveLength(0);

    const settings = createPreferenceStore(memoryPreferenceStorage());
    saveEntries(settings, addLift([], 'squat'), 'kg');
    element.settings = settings;
    await element.updateComplete;

    expect(cards(element)).toHaveLength(1);
  });

  it('remembers the rack and the weights, and keeps the ticks out of that store', async () => {
    // Two stores with two lifetimes, structurally. "What I squat" outlives the
    // tab; "which sets I have done today" must not, or next Tuesday opens with
    // last Tuesday's ramp half ticked off.
    const settingsStorage = memoryPreferenceStorage();
    const marksStorage = memoryPreferenceStorage();
    const element = await mount({
      settings: createPreferenceStore(settingsStorage),
      marks: createPreferenceStore(marksStorage),
    });

    await press(element, 'Add Squat');
    expect(cards(element)).toHaveLength(1);
    expect(settingsStorage.keys()).toContain(ENTRIES_KEY);

    // A lift arrives with no weight on it, so there is no ramp and nothing to
    // tick until one is typed. An invented figure; nothing here checks it.
    await typeWeight(element, '100');

    const card = cards(element)[0];
    const box = card?.shadowRoot?.querySelector('li label.row input');
    if (!(box instanceof HTMLInputElement)) throw new Error('No checklist row to tick.');
    box.click();
    await element.updateComplete;

    // Keyed by name rather than by counting writes: the ticks are re-pruned
    // against the entries on every change, so the marks store is written to
    // (with nothing in it) before a single set is ticked. What must never
    // happen is a tick reaching the store that outlives the tab -- and a count
    // cannot tell the difference between the two.
    expect(marksStorage.read(MARKS_KEY)).not.toBeNull();
    expect(settingsStorage.keys()).not.toContain(MARKS_KEY);
    expect(marksStorage.keys()).not.toContain(ENTRIES_KEY);
  });

  it('asks what to do with weights already typed when the unit changes', async () => {
    // The two readings of "I switched to pounds" are both common and tens of
    // kilograms apart. Guessing here produces a warm-up for a weight nobody
    // chose, so the prompt is the one question this tool asks that it could have
    // answered for itself.
    const settings = createPreferenceStore(memoryPreferenceStorage());
    saveEquipment(settings, KG_RACK);
    saveEntries(
      settings,
      addLift([], 'squat').map((entry) => ({ ...entry, weight: '100' })),
      'kg',
    );
    const element = await mount({ settings });

    await choose(element, unitGroup(element), 'lb');
    const prompt = conversionPrompt(element);
    expect(prompt).not.toBe(null);
    if (prompt === null) return;

    await choose(element, prompt, 'convert');
    expect(conversionPrompt(element)).toBe(null);
    // 100 kg is a little over 220 lb. The figure is not asserted exactly here --
    // that is `convertEntryWeights`'s job -- only that it moved.
    expect(cards(element)[0]?.entry.weight.startsWith('220')).toBe(true);
  });

  it('leaves the numbers alone when the lifter says they meant the new unit', async () => {
    const settings = createPreferenceStore(memoryPreferenceStorage());
    saveEquipment(settings, KG_RACK);
    saveEntries(
      settings,
      addLift([], 'squat').map((entry) => ({ ...entry, weight: '225' })),
      'kg',
    );
    const element = await mount({ settings });

    await choose(element, unitGroup(element), 'lb');
    const prompt = conversionPrompt(element);
    if (prompt === null) throw new Error('No conversion prompt.');
    await choose(element, prompt, 'keep');

    expect(conversionPrompt(element)).toBe(null);
    expect(cards(element)[0]?.entry.weight).toBe('225');
  });

  it('asks nothing when there is no weight to reinterpret', async () => {
    // A lifter who sets the unit before typing anything gets no question. An
    // unconditional prompt is a box that appears on the first tap of every
    // session and means nothing.
    // Kilograms, because the session opens in pounds: picking the unit it is
    // already in is not a unit change, and a test that made one would assert
    // silence about a tap that did nothing.
    const element = await mount({ settings: createPreferenceStore(memoryPreferenceStorage()) });
    await press(element, 'Add Squat');
    await choose(element, unitGroup(element), 'kg');
    expect(conversionPrompt(element)).toBe(null);
  });

  it('re-orders and removes lifts on the card controls', async () => {
    const element = await mount({ settings: createPreferenceStore(memoryPreferenceStorage()) });
    await press(element, 'Add Squat');
    await press(element, 'Add Bench Press');
    expect(cards(element).map((card) => card.entry.liftId)).toEqual(['squat', 'bench-press']);

    await press(element, 'Move Bench Press earlier');
    expect(cards(element).map((card) => card.entry.liftId)).toEqual(['bench-press', 'squat']);

    await press(element, 'Remove Squat');
    expect(cards(element).map((card) => card.entry.liftId)).toEqual(['bench-press']);
  });

  it('has no accessibility violations with a lift on the list', async () => {
    const element = await mount({ settings: createPreferenceStore(memoryPreferenceStorage()) });
    await press(element, 'Add Squat');
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('draws no logbook action on a page that supplied nowhere to hand a session', async () => {
    // A finished lift is on the list, so the absence is attributable to the
    // missing port and not to there being nothing to log. This is the embed: a
    // calculator in somebody else's frame has no business replacing their
    // frame's contents with a different tool.
    const element = await mount({ settings: storeWith(finishedSquat()) });
    expect(logAction(element)).toBe(null);
  });

  it('withholds the logbook action until a lift is finished enough to log', async () => {
    // Absent rather than drawn and disabled: a control that can do nothing is a
    // dead control, and this one would be dead for the whole of the time before
    // a weight is typed -- which is the state the tool opens in.
    const logbook = handoffAnswering('offered');
    const element = await mount({
      settings: createPreferenceStore(memoryPreferenceStorage()),
      logbook,
    });
    expect(logAction(element)).toBe(null);

    await press(element, 'Add Squat');
    expect(logAction(element)).toBe(null);

    await typeWeight(element, '135');
    expect(logAction(element)?.getAttribute('href')).toBe(logbook.href);
  });

  it('names the custom lift that will not travel to the logbook', async () => {
    // The logbook logs against its own catalogue, so a lift the lifter named
    // themselves has nowhere to land. Naming it is the point of the sentence:
    // it is read before the press, not discovered after arriving.
    const element = await mount({
      settings: storeWith(finishedSquat()),
      logbook: handoffAnswering('offered'),
    });
    await nameOwnLift(element, 'Zercher carry');
    await typeWeight(element, '95', 1);

    // The catalogue lift still travels, so the action stays: one lift the
    // logbook cannot take is not a reason to refuse the session.
    expect(logAction(element)).not.toBe(null);
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('Zercher carry');
  });

  it('leaves the link to do the navigating once the record is written', async () => {
    const logbook = handoffAnswering('offered');
    const element = await mount({ settings: storeWith(finishedSquat()), logbook });

    const event = await pressLog(element);
    expect(logbook.calls).toHaveLength(1);
    // Unprevented, so an ordinary link follows itself. A script navigation
    // instead would give up everything the anchor was chosen for, on the one
    // screen somebody uses with chalk on their hands.
    expect(event.defaultPrevented).toBe(false);
    expect(refusalNote(element)).toBe(null);
  });

  it('writes the record on a middle click and leaves none on a right click', async () => {
    // Without the `auxclick` binding a middle click opens the logbook in a new
    // tab with nothing waiting in it, and that tab looks exactly like an
    // ordinary visit. A context menu is not a press, so the right button is
    // left alone.
    const logbook = handoffAnswering('offered');
    const element = await mount({ settings: storeWith(finishedSquat()), logbook });

    await pressLog(element, 1);
    expect(logbook.calls).toHaveLength(1);

    await pressLog(element, 2);
    expect(logbook.calls).toHaveLength(1);
  });

  it('stops the press and says so when nothing could be handed over', async () => {
    const logbook = handoffAnswering('unavailable');
    const element = await mount({ settings: storeWith(finishedSquat()), logbook });

    const event = await pressLog(element);
    // Following the link would put the lifter in front of an empty logbook with
    // nothing on screen saying why, which is worse than the action never having
    // been there.
    expect(event.defaultPrevented).toBe(true);
    expect(refusalNote(element)?.textContent).toContain('nothing was handed over');
  });

  it('clears the refusal as soon as the plan is edited again', async () => {
    const element = await mount({
      settings: storeWith(finishedSquat()),
      logbook: handoffAnswering('unavailable'),
    });
    await pressLog(element);
    expect(refusalNote(element)).not.toBe(null);

    // The sentence reported one press. Standing while the lifter goes on
    // editing, it turns into a claim about what the tool can do.
    await typeWeight(element, '145');
    expect(refusalNote(element)).toBe(null);
  });

  it('fits a phone-width column with the whole tool on screen', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-warm-up-calculator');
    element.settings = createPreferenceStore(memoryPreferenceStorage());
    frame.append(element);
    await element.updateComplete;
    await press(element, 'Add Squat');

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
