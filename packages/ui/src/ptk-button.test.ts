// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { PtkButton } from './ptk-button.js';
import './ptk-button.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

function mount(text: string, parent: HTMLElement = document.body): PtkButton {
  const element = document.createElement('ptk-button');
  element.textContent = text;
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function inner(element: PtkButton): HTMLButtonElement {
  const found = element.shadowRoot?.querySelector('button');
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error('The button rendered no button element.');
  }
  return found;
}

describe('ptk-button', () => {
  it('renders a real button, so the platform supplies the behaviour', async () => {
    const element = mount('Add another lift');
    await element.updateComplete;

    // `type="button"` and not the default `submit`. These tools have no forms
    // today, and the day one of them does, a default-typed button inside it
    // submits the page instead of doing what its label says.
    expect(inner(element).type).toBe('button');
  });

  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here.
    const element = mount('Edit');
    await element.updateComplete;
    expect(element.getAttribute('variant')).toBe('secondary');

    element.variant = 'primary';
    await element.updateComplete;

    expect(element.matches('[variant="primary"]')).toBe(true);
  });

  it('lets a click through to a listener on the host', async () => {
    // The event has to cross the shadow boundary or every caller is wiring a
    // listener to something that never fires -- and a click on a native button
    // composes by default, which is exactly why this is worth pinning rather
    // than assuming.
    const element = mount('Reset');
    await element.updateComplete;

    let clicks = 0;
    element.addEventListener('click', () => {
      clicks += 1;
    });
    inner(element).click();

    expect(clicks).toBe(1);
  });

  it('does not fire when disabled', async () => {
    const element = mount('Remove');
    element.disabled = true;
    await element.updateComplete;

    let clicks = 0;
    element.addEventListener('click', () => {
      clicks += 1;
    });
    inner(element).click();

    expect(clicks).toBe(0);
    expect(inner(element).disabled).toBe(true);
  });

  it('takes its accessible name from the slotted text', async () => {
    const element = mount('Add another lift');
    await element.updateComplete;

    expect(inner(element).getAttribute('aria-label')).toBe(null);
    expect(element.textContent).toBe('Add another lift');
  });

  it('can name itself for a control whose visible label is a symbol', async () => {
    const element = mount('↑');
    element.accessibleName = 'Move Squat earlier';
    await element.updateComplete;

    expect(inner(element).getAttribute('aria-label')).toBe('Move Squat earlier');
  });

  it('says nothing about expansion unless it expands something', async () => {
    // `aria-expanded="false"` on a button that expands nothing announces a
    // collapsed section that is not there, which is worse than silence.
    const element = mount('Reset');
    await element.updateComplete;
    expect(inner(element).hasAttribute('aria-expanded')).toBe(false);

    element.expanded = false;
    await element.updateComplete;
    expect(inner(element).getAttribute('aria-expanded')).toBe('false');

    element.expanded = true;
    await element.updateComplete;
    expect(inner(element).getAttribute('aria-expanded')).toBe('true');
  });

  it.each(['primary', 'secondary', 'quiet'] as const)(
    'is at least the tap-target floor tall as %s',
    async (variant) => {
      // The floor is the whole reason this element exists rather than a class
      // per tool. A button under it is a miss at the rack, and a miss lands on
      // whatever is underneath -- on a lift card, the remove control.
      const element = mount('Edit');
      element.variant = variant;
      await element.updateComplete;

      expect(inner(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    },
  );

  it('grows rather than clipping when a label wraps at phone width', async () => {
    const frame = document.createElement('div');
    frame.style.width = '160px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount('Reset every remembered setting', frame);
    await element.updateComplete;

    const button = inner(element);
    expect(button.getBoundingClientRect().height).toBeGreaterThan(44);
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it.each(['primary', 'secondary', 'quiet'] as const)(
    'has no accessibility violations as %s',
    async (variant) => {
      const element = mount('Add another lift');
      element.variant = variant;
      await element.updateComplete;

      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );
});
