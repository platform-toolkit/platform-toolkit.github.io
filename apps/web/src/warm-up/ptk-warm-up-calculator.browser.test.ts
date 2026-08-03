// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  createPreferenceStore,
  memoryPreferenceStorage,
  PREFERENCE_KEY_PREFIX,
} from '@platform-toolkit/preferences';
import type { PtkButton, PtkChoiceGroup } from '@platform-toolkit/ui';
// Without the stylesheet every declaration reading a custom property is
// dropped, so the column measured below has no padding and no gaps -- a layout
// that never ships, and one that both passes and fails for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_EQUIPMENT, saveEquipment, type Equipment } from './equipment.js';
import type { PtkLiftCard } from './ptk-lift-card.js';
import type { PtkWarmUpCalculator } from './ptk-warm-up-calculator.js';
import './ptk-warm-up-calculator.js';
import { addLift, saveEntries, SESSION_PREFERENCES } from './session.js';

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
  properties: Partial<Pick<PtkWarmUpCalculator, 'settings' | 'marks'>> = {},
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

/** Types a working weight into the first card, three shadow roots down. */
async function typeWeight(element: PtkWarmUpCalculator, text: string): Promise<void> {
  const field = cards(element)[0]?.shadowRoot?.querySelector(
    'ptk-number-field[data-field="weight"]',
  );
  const input = field?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No weight field on the first card.');
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

describe('ptk-warm-up-calculator', () => {
  it('renders with no storage at all', async () => {
    // The configuration this collection actually ships into: a third-party
    // iframe whose embedder blocked storage, where `localStorage` throws on
    // property access before a method is ever called. The element mounts with a
    // store that has no backing, so there is no branch to get wrong.
    const element = await mount();
    expect(element.shadowRoot?.querySelector('ptk-equipment-setup')).not.toBe(null);
    expect(element.shadowRoot?.textContent).toContain('Pick a lift above');
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
