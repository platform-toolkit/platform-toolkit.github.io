// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { PtkChoiceGroup, PtkNumberField, PtkToggleGroup } from '@platform-toolkit/ui';
// Every spacing and sizing declaration in these components reads a custom
// property, and a declaration referencing an undefined one is dropped. Without
// the stylesheet the layout measured below is not the shipped layout: padding
// collapses to zero and the disclosure's rotated chevron lands two pixels past
// the column it is supposed to sit inside.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CUSTOM_BAR_ID, DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import {
  EQUIPMENT_CHANGE_EVENT,
  type EquipmentChangeDetail,
  type PtkEquipmentSetup,
} from './ptk-equipment-setup.js';
import './ptk-equipment-setup.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * Everything this element does travels as a composed event out of a control's
 * own shadow tree and into a delegated listener on this host. An emulated DOM
 * that got the retargeting subtly wrong would leave a green suite and a rack
 * whose controls visibly respond while nothing is recorded -- which is the
 * failure `fieldOf` exists to prevent and the one thing worth spending a real
 * browser on.
 */

/**
 * A rack with two denominations, so a toggle has something to remove.
 *
 * Invented, like every figure in these tests. The plate weights happen to be
 * real denominations because the element checks values against the offered list
 * and would drop anything else -- that check is the point of one of the tests.
 *
 * The unit, the bar and the custom bar's unit are all pinned rather than
 * inherited from `DEFAULT_EQUIPMENT`. The default is pounds on a 45 lb bar, and
 * these tests are about the element's mechanics rather than about the defaults:
 * a fixture that follows the default draws the *pound* plate switches while
 * overriding the kilogram inventory, so the toggle test would tick a plate on a
 * rack nothing here is reading. The defaults have a test of their own below.
 */
const RACK: Equipment = {
  ...DEFAULT_EQUIPMENT,
  plateUnit: 'kg',
  barId: 'olympic-20',
  customBar: { amount: 20, unit: 'kg' },
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    kg: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 10, pairs: 2, fullDiameter: false },
    ],
  },
};

/** The same rack with one of the four fractional plates on it, and no more. */
const PART_MICRO: Equipment = {
  ...RACK,
  inventory: {
    ...RACK.inventory,
    kg: [...RACK.inventory.kg, { weight: 0.5, pairs: null, fullDiameter: false }],
  },
};

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(equipment: Equipment = RACK): Promise<PtkEquipmentSetup> {
  const element = document.createElement('ptk-equipment-setup');
  element.equipment = equipment;
  element.open = true;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Records every change the element reports, from outside its shadow root. */
function watch(): EquipmentChangeDetail[] {
  const seen: EquipmentChangeDetail[] = [];
  const listener = (event: CustomEvent<EquipmentChangeDetail>): void => {
    seen.push(event.detail);
  };
  // On the body rather than on the element: the assertion is that the event
  // left the shadow root, which a listener on the element would not prove.
  document.body.addEventListener(EQUIPMENT_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(EQUIPMENT_CHANGE_EVENT, listener);
  });
  return seen;
}

/**
 * The one element matching, or a failure naming the selector.
 *
 * Deliberately not generic. `querySelector<T>` is a type assertion wearing a
 * function's clothes: it hands back whatever the caller named on the strength of
 * a string, so a selector typo produces a `ptk-choice-group` typed as a number
 * field and the failure arrives three lines later as a missing method. The two
 * callers below narrow with `instanceof` against the real class instead, which
 * is a claim the runtime can actually refuse.
 */
function find(element: PtkEquipmentSetup, selector: string): Element {
  const found = element.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) {
    throw new Error(`Nothing rendered for "${selector}".`);
  }
  return found;
}

function group(element: PtkEquipmentSetup, field: string): PtkChoiceGroup {
  const found = find(element, `ptk-choice-group[data-field="${field}"]`);
  if (!(found instanceof PtkChoiceGroup)) throw new Error(`"${field}" is not a choice group.`);
  return found;
}

/** The denomination switches, which are the one toggle group on this screen. */
function plates(element: PtkEquipmentSetup): PtkToggleGroup {
  const found = find(element, 'ptk-toggle-group');
  if (!(found instanceof PtkToggleGroup)) throw new Error('The plate switches are not a toggle.');
  return found;
}

/**
 * The one switch that stands for the whole bagged set of fractional plates.
 *
 * A plain checkbox rather than a chip in the toggle group above, because it is
 * not a denomination and ticking it does not put a plate on the rack by itself.
 * It is also the only control on this screen with a third state, which is why
 * the tests below read `indeterminate` off it directly.
 */
function microMaster(element: PtkEquipmentSetup): HTMLInputElement {
  const found = find(element, 'input[data-field="micro-all"]');
  if (!(found instanceof HTMLInputElement)) throw new Error('The micro switch is not an input.');
  return found;
}

/** What is on the rack, in the unit the reported equipment is actually in. */
function weights(equipment: Equipment | undefined): number[] {
  if (equipment === undefined) throw new Error('Nothing was reported.');
  return equipment.inventory[equipment.plateUnit].map((plate) => plate.weight);
}

/** Clicks an option the way a lifter would: on the control itself. */
async function click(
  element: PtkEquipmentSetup,
  host: PtkChoiceGroup | PtkToggleGroup,
  value: string,
): Promise<void> {
  const boxes = host.shadowRoot?.querySelectorAll('input') ?? [];
  for (const box of boxes) {
    if (box.value === value) {
      box.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" to click.`);
}

/** Types into a field the way a lifter would, so the element's own listener runs. */
async function type(
  element: PtkEquipmentSetup,
  field: string,
  text: string,
): Promise<PtkNumberField> {
  const host = find(element, `ptk-number-field[data-field="${field}"]`);
  if (!(host instanceof PtkNumberField)) throw new Error(`"${field}" is not a number field.`);
  const input = host.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input inside "${field}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
  return host;
}

describe('ptk-equipment-setup', () => {
  it('keeps the whole of what has to be true on screen while folded', async () => {
    const element = await mount();
    const summary = find(element, 'ptk-disclosure').getAttribute('summary');
    expect(summary).toContain('kg');
    expect(summary).toContain('20 kg');
  });

  it('re-renders when the equipment is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration. This is the only kind of
    // test that fails when `experimentalDecorators` and `useDefineForClassFields`
    // disagree -- everything else passes and the screen never updates.
    const element = await mount();
    expect(group(element, 'bar').value).toBe('olympic-20');

    element.equipment = { ...RACK, barId: CUSTOM_BAR_ID };
    await element.updateComplete;

    expect(group(element, 'bar').value).toBe(CUSTOM_BAR_ID);
  });

  it('reports the previous unit when the plate unit changes, and only then', async () => {
    // The tool cannot offer to reinterpret the weights already typed without
    // knowing what they were typed in, and it must not offer to reinterpret them
    // when nothing changed. Both halves are here because the second is the one
    // that regresses silently -- an unconditional report puts a question on
    // screen every time a lifter re-taps the unit they are already in.
    const element = await mount();
    const seen = watch();

    await click(element, group(element, 'unit'), 'lb');
    expect(seen.at(-1)?.unitWas).toBe('kg');
    expect(seen.at(-1)?.equipment.plateUnit).toBe('lb');

    await click(element, group(element, 'unit'), 'lb');
    expect(seen).toHaveLength(1);
  });

  it('reports no previous unit for a change that was not a unit change', async () => {
    const element = await mount();
    const seen = watch();
    await click(element, group(element, 'bar'), 'womens-15');
    expect(seen.at(-1)?.unitWas).toBeNull();
  });

  it('takes a denomination off the rack', async () => {
    const element = await mount();
    const seen = watch();
    await click(element, plates(element), '10');

    expect(seen.at(-1)?.equipment.inventory.kg.map((plate) => plate.weight)).toEqual([25]);
  });

  it('offers a weight and a unit of its own once the bar is custom', async () => {
    // A custom bar carries its own unit so that switching the plate unit leaves
    // it alone. Converting it would make 20 kg drift to 20.0002 kg over two
    // flicks; re-labelling it would turn a 20 kg bar into a 20 lb one.
    const element = await mount({ ...RACK, barId: CUSTOM_BAR_ID });
    expect(element.shadowRoot?.querySelector('ptk-number-field[data-field="custom-bar"]')).not.toBe(
      null,
    );

    const seen = watch();
    await click(element, group(element, 'custom-bar-unit'), 'lb');
    expect(seen.at(-1)?.equipment.customBar).toEqual({ amount: 20, unit: 'lb' });
    expect(seen.at(-1)?.equipment.plateUnit).toBe('kg');
  });

  it('says what is wrong with a custom bar rather than reporting it', async () => {
    // The bound is restated here on purpose: a bar of 1e308 written through the
    // preferences package throws by design, so an unbounded box would take the
    // screen down instead of showing a sentence.
    const element = await mount({ ...RACK, barId: CUSTOM_BAR_ID });
    const seen = watch();
    const field = await type(element, 'custom-bar', '900');

    expect(field.error).not.toBe('');
    expect(seen).toHaveLength(0);
  });

  it('keeps a half-typed decimal point rather than parsing it away', async () => {
    // Rendering the box from the parsed equipment would turn `20.` back into
    // `20` and delete the keystroke the lifter just made.
    const element = await mount({ ...RACK, barId: CUSTOM_BAR_ID });
    const field = await type(element, 'custom-bar', '22.');
    expect(field.value).toBe('22.');
  });

  it('treats an emptied pair count as "enough of these" rather than a half-typed number', async () => {
    // The one answer a lifter reaches by deleting rather than typing. Ignoring
    // an empty box would leave the old limit in force with an empty field beside
    // it, and the ramp would keep refusing plates that are on the rack.
    const element = await mount();
    const seen = watch();
    await type(element, 'pairs:kg:10', '');

    const changed = seen.at(-1)?.equipment.inventory.kg.find((plate) => plate.weight === 10);
    expect(changed?.pairs).toBeNull();
  });

  it('opens in pounds on a pound bar, with the fractional set already on the rack', async () => {
    // The lifter who has not been into this screen is the one who trains in
    // pounds -- the kilogram racks belong to people who configure things. And
    // the small plates are there until somebody says otherwise, because a ramp
    // that cannot make 47.5 lb is the reason this iteration exists.
    const element = await mount(DEFAULT_EQUIPMENT);
    expect(group(element, 'unit').value).toBe('lb');
    expect(group(element, 'bar').value).toBe('standard-45');

    const master = microMaster(element);
    expect(master.checked).toBe(true);
    expect(master.indeterminate).toBe(false);
  });

  it('offers the 22 lb bar some lifters train on', async () => {
    // A women's bar is 15 kg and a 22 lb training bar is neither that nor 45.
    // Before this the only way to say so was the custom box, which is two more
    // taps and a number to remember.
    const element = await mount(DEFAULT_EQUIPMENT);
    const seen = watch();
    await click(element, group(element, 'bar'), 'training-22');
    expect(seen.at(-1)?.equipment.barId).toBe('training-22');
    expect(find(element, 'ptk-disclosure').getAttribute('summary')).toContain('22 lb');
  });

  it('stocks or clears the whole fractional set with one switch', async () => {
    // Four denominations sold in one bag is one decision, not four. The chips
    // above stay the authority; this is a shortcut past four taps.
    const element = await mount();
    expect(microMaster(element).checked).toBe(false);

    const seen = watch();
    microMaster(element).click();
    await element.updateComplete;

    const stocked = weights(seen.at(-1)?.equipment);
    expect(stocked).toContain(0.5);
    expect(stocked).toContain(0.25);
    // The plates that were already on the rack are still on it.
    expect(stocked).toContain(25);
    expect(stocked).toContain(10);
  });

  it('shows a partly stocked bag as neither on nor off, and clears it in one press', async () => {
    // Somebody who lost the quarter-pounders has a rack the switch cannot
    // describe with a tick or a blank, and drawing it as either is a lie about
    // what is on the rack. Indeterminate is the third state the platform has
    // for exactly this.
    const element = await mount(PART_MICRO);
    const master = microMaster(element);
    expect(master.checked).toBe(true);
    expect(master.indeterminate).toBe(true);

    const seen = watch();
    master.click();
    await element.updateComplete;

    expect(weights(seen.at(-1)?.equipment)).toEqual([25, 10]);
  });

  it('leaves the individual plates operable for a rack that is not a whole bag', async () => {
    // The master is a shortcut and never a mode: a lifter with three of the four
    // has to be able to say so, and the switch above must follow rather than
    // overrule them.
    const element = await mount(PART_MICRO);
    const seen = watch();
    await click(element, plates(element), '0.5');

    expect(weights(seen.at(-1)?.equipment)).toEqual([25, 10]);
    expect(microMaster(element).checked).toBe(false);
  });

  it('says so when the device will not let the page remember anything', async () => {
    // A lifter who sets up a rack in a private window and comes back to defaults
    // deserves to have been told. The store knows before anything is typed.
    const element = await mount();
    element.remembers = false;
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain('not letting the page remember');
  });

  it('has no accessibility violations with a custom bar and a limited rack', async () => {
    // `color-contrast` is off for the same reason as everywhere else: it depends
    // on the page background this element does not control.
    const element = await mount({ ...RACK, barId: CUSTOM_BAR_ID, collarId: 'competition' });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('fits a phone-width column with every control unfolded', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-equipment-setup');
    element.equipment = { ...DEFAULT_EQUIPMENT, barId: CUSTOM_BAR_ID };
    element.open = true;
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
