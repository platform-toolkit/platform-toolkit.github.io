// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { PtkPlateStack } from './ptk-plate-stack.js';
import './ptk-plate-stack.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

function mount(plates: readonly number[], parent: HTMLElement = document.body): PtkPlateStack {
  const element = document.createElement('ptk-plate-stack');
  element.plates = plates;
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function faces(element: PtkPlateStack): string[] {
  return [...(element.shadowRoot?.querySelectorAll('.plate') ?? [])].map((plate) =>
    plate.textContent.trim(),
  );
}

function heights(element: PtkPlateStack): number[] {
  return [...(element.shadowRoot?.querySelectorAll('.plate') ?? [])].map(
    (plate) => plate.getBoundingClientRect().height,
  );
}

describe('ptk-plate-stack', () => {
  it('prints the number on every plate', async () => {
    // The colour is decoration. The number is the identification, and it has to
    // be there for a reader who cannot separate the hues, for forced colours,
    // and for the gym whose plates are all black iron.
    const element = mount([25, 10, 2.5]);
    await element.updateComplete;

    expect(faces(element)).toEqual(['25', '10', '2.5']);
  });

  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here.
    const element = mount([25]);
    await element.updateComplete;
    expect(faces(element)).toEqual(['25']);

    element.plates = [20, 5];
    await element.updateComplete;

    expect(faces(element)).toEqual(['20', '5']);
  });

  it('draws a heavier plate larger than a lighter one', async () => {
    // Not to scale -- a 25 and a 20 are the same diameter on a real platform.
    // Drawing them identically would make the diagram unreadable at the one
    // moment it matters, which is telling them apart at arm's length.
    const element = mount([25, 20, 10, 2.5]);
    await element.updateComplete;

    const sizes = heights(element);
    for (const [index, height] of sizes.entries()) {
      if (index === 0) continue;
      expect(height).toBeLessThan(sizes[index - 1] ?? 0);
    }
  });

  it('sizes plates by class, never by an inline style', async () => {
    // The production Content Security Policy has no unsafe-inline in style-src,
    // so a style attribute is dropped in the built site and nowhere else. The
    // symptom would be a diagram correct in every test and a row of identical
    // plates in production.
    const element = mount([25, 20, 15, 10, 5, 2.5]);
    await element.updateComplete;

    for (const plate of element.shadowRoot?.querySelectorAll('.plate') ?? []) {
      expect(plate.hasAttribute('style')).toBe(false);
    }
  });

  it('still draws a denomination it has no entry for', async () => {
    // A plate missing from the picture is the one error this element could make
    // that a lifter would not notice, because a diagram nobody can check
    // against is what they are looking at it for.
    const element = mount([1.75]);
    await element.updateComplete;

    expect(faces(element)).toEqual(['1.75']);
  });

  it('uses the pound table when the unit is pounds', async () => {
    // A 45 is the full plate in pounds and a 25 is not. Reading pound numbers
    // off the kilogram table would draw both at the same middle size.
    const element = mount([45, 25]);
    element.unit = 'lb';
    await element.updateComplete;

    const [full, smaller] = heights(element);
    expect(full).toBeGreaterThan(smaller ?? 0);
  });

  it('says so in words when there are no plates', async () => {
    const element = mount([]);
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('Bar only');
    expect(faces(element)).toEqual([]);
  });

  it('reads out as one sentence rather than a run of bare numbers', async () => {
    // Left to itself a screen reader announces "25 10 2.5" with nothing to say
    // what they are or that they are one end of the bar.
    const element = mount([25, 10, 2.5]);
    await element.updateComplete;

    const stack = element.shadowRoot?.querySelector('.stack');
    expect(stack?.getAttribute('role')).toBe('img');
    expect(stack?.getAttribute('aria-label')).toBe('Per side: 25 kg, 10 kg, 2.5 kg');
  });

  it('names the unit it was given, not a default', async () => {
    const element = mount([45]);
    element.unit = 'lb';
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.stack')?.getAttribute('aria-label')).toBe(
      'Per side: 45 lb',
    );
  });

  it('wraps rather than pushing a long loading off a phone screen', async () => {
    // The narrow-layout rule: a sideways scrollbar on a phone is the failure.
    // A wrapped second row reads oddly; a diagram half off the screen reads as
    // a broken page.
    const frame = document.createElement('div');
    frame.style.width = '288px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount([25, 25, 25, 20, 15, 10, 5, 2.5, 2.5, 1.25], frame);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('has no accessibility violations', async () => {
    const element = mount([25, 10, 2.5]);
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
