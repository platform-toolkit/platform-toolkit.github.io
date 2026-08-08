// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { PRIMARY_LIFTS } from '@platform-toolkit/domain';
import type { PtkButton } from '@platform-toolkit/ui/ptk-button';
import type { PtkChoiceGroup } from '@platform-toolkit/ui/ptk-choice-group';
// Without the stylesheet every declaration reading a custom property is
// dropped, so the column measured below has no padding and no gaps -- a layout
// that never ships, and one that both passes and fails for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ADD_CUSTOM_LIFT_EVENT,
  ADD_LIFT_EVENT,
  type AddCustomLiftDetail,
  type AddLiftDetail,
  type PtkLiftPicker,
} from './ptk-lift-picker.js';
import './ptk-lift-picker.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * A disabled `ptk-button` is the case that makes this worth a browser: the
 * element renders a real `<button>` inside its own shadow root, and whether a
 * click on it reaches the handler is a platform behaviour rather than a
 * property. A simulation that dispatched the click anyway would report a
 * duplicate lift as prevented while the shipped page added it twice.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(chosen: readonly string[] = []): Promise<PtkLiftPicker> {
  const element = document.createElement('ptk-lift-picker');
  element.chosen = chosen;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function watchAdds(): AddLiftDetail[] {
  const seen: AddLiftDetail[] = [];
  const listener = (event: CustomEvent<AddLiftDetail>): void => {
    seen.push(event.detail);
  };
  // On the body, outside the element: the assertion worth making is that the
  // event crossed the shadow boundary at all.
  document.body.addEventListener(ADD_LIFT_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(ADD_LIFT_EVENT, listener);
  });
  return seen;
}

/** The button whose accessible name matches, wherever in the picker it sits. */
function button(element: PtkLiftPicker, accessibleName: string): PtkButton {
  const found = element.shadowRoot?.querySelector<PtkButton>(
    `ptk-button[accessible-name="${accessibleName}"]`,
  );
  if (found === null || found === undefined) {
    throw new Error(`No button named "${accessibleName}".`);
  }
  return found;
}

/** Clicks the native button inside, the way a lifter's thumb would. */
async function press(element: PtkLiftPicker, host: PtkButton): Promise<void> {
  const inner = host.shadowRoot?.querySelector('button');
  if (!(inner instanceof HTMLButtonElement)) throw new Error('No button rendered.');
  inner.click();
  await element.updateComplete;
}

async function typeSearch(element: PtkLiftPicker, text: string): Promise<void> {
  const input = element.shadowRoot?.querySelector('#lift-search');
  if (!(input instanceof HTMLInputElement)) throw new Error('No search box rendered.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

async function typeName(element: PtkLiftPicker, text: string): Promise<void> {
  const input = element.shadowRoot?.querySelector('#custom-name');
  if (!(input instanceof HTMLInputElement)) throw new Error('No name box rendered.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await element.updateComplete;
}

describe('ptk-lift-picker', () => {
  it('puts the pinned lifts in the open, from the catalogue flag and not a list here', async () => {
    const element = await mount();
    const open = element.shadowRoot?.querySelectorAll('.primary ptk-button') ?? [];
    expect(open).toHaveLength(PRIMARY_LIFTS.length);
    for (const lift of PRIMARY_LIFTS) {
      expect(button(element, `Add ${lift.name}`)).toBeTruthy();
    }
  });

  it('reports the lift that was chosen, outside the shadow root', async () => {
    const element = await mount();
    const seen = watchAdds();
    const first = PRIMARY_LIFTS[0];
    if (first === undefined) throw new Error('The catalogue pins no lifts.');

    await press(element, button(element, `Add ${first.name}`));
    expect(seen).toEqual([{ liftId: first.id }]);
  });

  it('re-renders a lift as added when the chosen list changes after first render', async () => {
    // The canary for Lit's decorator configuration, and a real behaviour: the
    // tool owns the list, so "already on the list" arrives here as a property
    // change rather than as something the picker worked out for itself.
    const element = await mount();
    const first = PRIMARY_LIFTS[0];
    if (first === undefined) throw new Error('The catalogue pins no lifts.');

    element.chosen = [first.id];
    await element.updateComplete;

    expect(button(element, `${first.name}, already on the list`).disabled).toBe(true);
  });

  it('will not add the same lift twice', async () => {
    const element = await mount();
    const first = PRIMARY_LIFTS[0];
    if (first === undefined) throw new Error('The catalogue pins no lifts.');
    element.chosen = [first.id];
    await element.updateComplete;

    const seen = watchAdds();
    await press(element, button(element, `${first.name}, already on the list`));
    expect(seen).toEqual([]);
  });

  it('narrows the catalogue on a substring and says so when nothing matches', async () => {
    // Deliberately not fuzzy: a fuzzy match over thirty-two short names offers
    // the deficit deadlift for "press", and a lifter who has to check whether
    // the tool understood them is slower than one who scrolls.
    const element = await mount();
    await typeSearch(element, 'squat');
    const names = [...(element.shadowRoot?.querySelectorAll('.group ptk-button') ?? [])].map(
      (node) => node.textContent.trim(),
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.toLowerCase().includes('squat'))).toBe(true);

    await typeSearch(element, 'zzzz');
    expect(element.shadowRoot?.textContent).toContain('No lift in the catalogue matches that');
  });

  it('refuses a custom lift with no name and clears the box once one is added', async () => {
    // A name left in the box reads as a lift about to be added a second time.
    const element = await mount();
    const seen: AddCustomLiftDetail[] = [];
    const listener = (event: CustomEvent<AddCustomLiftDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ADD_CUSTOM_LIFT_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ADD_CUSTOM_LIFT_EVENT, listener);
    });

    const add = (): PtkButton => {
      const found = element.shadowRoot?.querySelector<PtkButton>('.named ptk-button');
      if (found === null || found === undefined) throw new Error('No add button rendered.');
      return found;
    };

    expect(add().disabled).toBe(true);
    await press(element, add());
    expect(seen).toEqual([]);

    await typeName(element, 'Zercher squat');
    await press(element, add());
    expect(seen).toEqual([{ name: 'Zercher squat', family: 'squat-press' }]);

    const input = element.shadowRoot?.querySelector('#custom-name');
    expect(input instanceof HTMLInputElement ? input.value : 'not an input').toBe('');
  });

  it('asks how a custom lift warms up rather than guessing from its name', async () => {
    const element = await mount();
    const family = element.shadowRoot?.querySelector<PtkChoiceGroup>(
      'ptk-choice-group[data-field="family"]',
    );
    const radio = [...(family?.shadowRoot?.querySelectorAll('input') ?? [])].find(
      (input) => input.value === 'deadlift',
    );
    if (radio === undefined) throw new Error('No deadlift family option.');
    radio.click();
    await element.updateComplete;

    const seen: AddCustomLiftDetail[] = [];
    const listener = (event: CustomEvent<AddCustomLiftDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ADD_CUSTOM_LIFT_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ADD_CUSTOM_LIFT_EVENT, listener);
    });

    await typeName(element, 'Block pull');
    const add = element.shadowRoot?.querySelector<PtkButton>('.named ptk-button');
    if (add === null || add === undefined) throw new Error('No add button rendered.');
    await press(element, add);

    expect(seen.at(-1)?.family).toBe('deadlift');
  });

  it('has no accessibility violations with the catalogue open', async () => {
    const element = await mount();
    await typeSearch(element, '');
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('fits a phone-width column with the whole catalogue on screen', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-lift-picker');
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
