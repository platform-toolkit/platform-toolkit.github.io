// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CHOICE_CHANGE_EVENT, type Choice, type PtkChoiceGroup } from './ptk-choice-group.js';
import './ptk-choice-group.js';
// The layout assertions below measure real pixels, and the tap-target minimum
// is a token. Without the stylesheet the custom property is undefined, the
// declaration referencing it is dropped, and a test written to catch a tile
// that is too small would instead measure a tile with no floor at all.
import './tokens.css';

/**
 * Real browser, real custom element, real Shadow DOM.
 *
 * A simulated DOM would pass most of what is below while proving much less. The
 * two things most worth knowing here -- that Lit's decorators are configured
 * such that setting a property actually re-renders, and that native radios give
 * the group its accessibility for free -- are exactly the things an emulation
 * approximates rather than implements.
 */

const SEXES: readonly Choice[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** Mounts a group, waits for its first render, and removes it after the test. */
async function mount(properties: Partial<PtkChoiceGroup> = {}): Promise<PtkChoiceGroup> {
  const element = document.createElement('ptk-choice-group');
  element.label = 'Sex';
  element.choices = SEXES;
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function radios(element: PtkChoiceGroup): HTMLInputElement[] {
  return [...(element.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [])].filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement,
  );
}

/**
 * The narrowest phone still in production use.
 *
 * Also narrower than most third-party embed columns, which is the same
 * constraint arriving twice: a widget that works here works framed in a
 * sidebar, and one that only works at desktop width fails in both places.
 */
const NARROW_WIDTH = 320;

/** The floor from `tokens.css`, repeated so a change to it fails a test here. */
const TAP_TARGET_MIN = 44;

/** Mounts a group inside a fixed-width column, the way a phone presents one. */
async function mountAtWidth(
  width: number,
  properties: Partial<PtkChoiceGroup> = {},
): Promise<{ element: PtkChoiceGroup; frame: HTMLDivElement }> {
  const frame = document.createElement('div');
  frame.style.width = `${String(width)}px`;
  document.body.append(frame);
  teardown.push(() => {
    frame.remove();
  });

  const element = document.createElement('ptk-choice-group');
  element.label = 'Weight class';
  element.choices = SEXES;
  Object.assign(element, properties);
  frame.append(element);
  await element.updateComplete;
  return { element, frame };
}

function tiles(element: PtkChoiceGroup): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll('.option') ?? [])].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

/** How many columns the option grid settled on, read from where the tiles sit. */
function columnCount(element: PtkChoiceGroup): number {
  return new Set(tiles(element).map((tile) => Math.round(tile.getBoundingClientRect().left))).size;
}

/** Twelve options with a second line: the widest thing this element renders. */
const DESCRIBED: readonly Choice[] = Array.from({ length: 12 }, (_, index) => ({
  // Invented figures, and deliberately long enough to be awkward -- a division
  // name is the label that actually threatens a narrow column.
  value: `division-${String(index)}`,
  label: `Submaster ${String(index)}`,
  description: `${String(30 + index)} to ${String(34 + index)}`,
}));

describe('ptk-choice-group', () => {
  it('renders one radio per choice, with its label', async () => {
    const element = await mount();

    expect(radios(element)).toHaveLength(2);
    expect(element.shadowRoot?.textContent).toContain('Female');
    expect(element.shadowRoot?.textContent).toContain('Male');
  });

  it('names the group with the question, using a legend', async () => {
    // The group's accessible name comes from the legend. Without it a screen
    // reader announces "Female, radio button, 1 of 2" with no indication that
    // the question was about sex, and the same is true of every other group on
    // the screen.
    const element = await mount();

    expect(element.shadowRoot?.querySelector('legend')?.textContent.trim()).toBe('Sex');
  });

  it('re-renders when a property changes', async () => {
    // The one test that would still pass if Lit's decorators were misconfigured
    // is the one that never changes a property. `useDefineForClassFields` set to
    // true would emit real class fields over the accessors @property installs,
    // and the element would render its initial state forever.
    const element = await mount();

    element.choices = [...SEXES, { value: 'mx', label: 'Mx' }];
    await element.updateComplete;

    expect(radios(element)).toHaveLength(3);
  });

  it('checks the radio matching the value', async () => {
    const element = await mount({ value: 'male' });

    expect(radios(element).map((radio) => radio.checked)).toEqual([false, true]);
  });

  it('follows a value set after the first render', async () => {
    const element = await mount();
    element.value = 'female';
    await element.updateComplete;

    expect(radios(element)[0]?.checked).toBe(true);
  });

  it('checks nothing when the value is not one of the choices', async () => {
    // A lifter who switches federation may hold a weight class that the new one
    // does not have. Snapping to the nearest would put a number on screen they
    // never chose and would then plan a cut around.
    const element = await mount({ value: 'not-an-option' });

    expect(radios(element).some((radio) => radio.checked)).toBe(false);
  });

  it('reports a choice the visitor makes', async () => {
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(CHOICE_CHANGE_EVENT, (event) => {
      // Typed without a cast: the element declares its event in
      // `HTMLElementEventMap`, so `detail` is known here.
      heard.push(event.detail.value);
    });

    radios(element)[1]?.click();

    expect(heard).toEqual(['male']);
    expect(element.value).toBe('male');
  });

  it('lets the event out of the shadow root', async () => {
    // Without `composed` the event stops at the boundary, the page never hears
    // it, and the tool looks inert while the radios visibly respond.
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.addEventListener(CHOICE_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.removeEventListener(CHOICE_CHANGE_EVENT, listener);
    });

    radios(element)[0]?.click();

    expect(heardOnDocument).toBe(1);
  });

  it('does not announce a programmatic change as a visitor choice', async () => {
    // The tool sets `value` itself when restoring or clearing a selection. If
    // that echoed back as a choice event, a caller that updates state on the
    // event would loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(CHOICE_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = 'female';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('says so when there is nothing to choose from', async () => {
    // An empty row of options looks like a rendering failure. Published data
    // that has not arrived yet is a real state and should read as one.
    const element = await mount({ choices: [], emptyMessage: 'No weight classes published.' });

    expect(radios(element)).toHaveLength(0);
    expect(element.shadowRoot?.textContent).toContain('No weight classes published.');
  });

  it('disables every option at once, through the fieldset', async () => {
    // Matched with `:disabled`, not read from `input.disabled`. The IDL property
    // reflects only the input's own attribute, so it stays false while a
    // disabled ancestor fieldset makes the control genuinely unusable. Asserting
    // the property would fail against a correct implementation and invite
    // someone to "fix" it by setting the attribute on every radio.
    const element = await mount({ disabled: true });

    const inputs = radios(element);
    expect(inputs).toHaveLength(2);
    expect(inputs.every((radio) => radio.matches(':disabled'))).toBe(true);
  });

  it('ignores a click while disabled', async () => {
    const element = await mount({ disabled: true });
    let heard = 0;
    element.addEventListener(CHOICE_CHANGE_EVENT, () => {
      heard += 1;
    });

    radios(element)[0]?.click();

    expect(heard).toBe(0);
    expect(element.value).toBeNull();
  });

  it('shows a description alongside the label when one is given', async () => {
    const element = await mount({
      label: 'Weight class',
      // Invented figures. Real federation numbers live in published data.
      choices: [{ value: 'wc-60', label: '60 kg', description: 'Over 56 kg, up to 60 kg' }],
    });

    expect(element.shadowRoot?.textContent).toContain('Over 56 kg, up to 60 kg');
  });

  it('escapes text rather than rendering it as markup', async () => {
    // Option labels come from published data. Nothing in the pipeline promises
    // they are free of angle brackets, and the project forbids rendering source
    // content as HTML.
    const element = await mount({
      choices: [{ value: 'x', label: '<img src=x onerror="throw new Error()">' }],
    });

    expect(element.shadowRoot?.querySelector('img')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('<img src=x');
  });

  it('has no detectable accessibility violations', async () => {
    const element = await mount({ value: 'female' });

    const results = await axe.run(element, {
      // Contrast is a property of the tokens against the page background, which
      // this element does not control and a detached-ish fixture cannot show
      // honestly. It belongs in the end-to-end pass over the built site.
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no violations when it is empty either', async () => {
    const element = await mount({ choices: [] });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    it('gives every option a target a thumb can hit', async () => {
      // Measured, not asserted from the stylesheet, because the failure is a
      // pixel count: the tiles were 42 pixels tall before this, which reads as
      // fine in a screenshot and mis-taps at a warm-up rack.
      const { element } = await mountAtWidth(NARROW_WIDTH, { choices: DESCRIBED });

      const heights = tiles(element).map((tile) => tile.getBoundingClientRect().height);
      expect(heights).toHaveLength(DESCRIBED.length);
      for (const height of heights) {
        expect(height).toBeGreaterThanOrEqual(TAP_TARGET_MIN);
      }
    });

    it('gives plain options a target a thumb can hit too', async () => {
      // Separately, because these are the short tiles: a description is what
      // was pushing the described ones over the line by accident.
      const { element } = await mountAtWidth(NARROW_WIDTH);

      for (const tile of tiles(element)) {
        expect(tile.getBoundingClientRect().height).toBeGreaterThanOrEqual(TAP_TARGET_MIN);
      }
    });

    it('stacks described options into one column rather than overflowing', async () => {
      const { element, frame } = await mountAtWidth(NARROW_WIDTH, { choices: DESCRIBED });

      expect(columnCount(element)).toBe(1);
      // The whole point. A wrapping row put each option at its own intrinsic
      // width; a grid track wider than its container would push the page
      // sideways instead, which is the failure this guards.
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    it('counts columns against its own width, not the window', async () => {
      // The same element, the same options, in a wider column. If this ever
      // matched the narrow case, the layout has been re-pinned to the viewport
      // -- which looks right on a phone and wrong in an embedded sidebar on a
      // desktop page, the case nobody opens.
      const { element } = await mountAtWidth(900, { choices: DESCRIBED });

      expect(columnCount(element)).toBeGreaterThan(1);
    });

    it('wraps a label too long for its column instead of widening it', async () => {
      const { frame } = await mountAtWidth(NARROW_WIDTH, {
        choices: [
          { value: 'long', label: 'Submaster and Master combined, drug tested, single ply' },
        ],
      });

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
