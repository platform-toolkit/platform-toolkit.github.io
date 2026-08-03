// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { SELECT_CHANGE_EVENT, type PtkSelect, type SelectOption } from './ptk-select.js';
import './ptk-select.js';
// The layout assertions below measure real pixels, and both the tap-target
// minimum and the input font floor are tokens. Without the stylesheet the custom
// property is undefined, the declaration referencing it is dropped, and a test
// written to catch a control that is too small instead measures one with no
// floor at all and passes.
import './tokens.css';

/**
 * Real browser, real custom element, real Shadow DOM.
 *
 * More load-bearing here than for most elements in this package, because the
 * two things most worth knowing about this one are things an emulated DOM does
 * not implement: that a `<select>` refuses a value it has no option for, and
 * that its rendered height clears a thumb.
 */

/**
 * Two states. Invented, because §5.1 keeps federation data out of source -- and
 * short, because the interesting cases below are about the control rather than
 * about what a region is.
 */
const REGIONS: readonly SelectOption[] = [
  { value: 'north', label: 'North' },
  { value: 'south', label: 'South' },
];

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** Mounts a select, waits for its first render, and removes it after the test. */
async function mount(properties: Partial<PtkSelect> = {}): Promise<PtkSelect> {
  const element = document.createElement('ptk-select');
  element.label = 'State';
  element.options = REGIONS;
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function control(element: PtkSelect): HTMLSelectElement {
  const select = element.shadowRoot?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('the element rendered no select');
  }
  return select;
}

function optionValues(element: PtkSelect): string[] {
  return [...control(element).options].map((option) => option.value);
}

/**
 * Picks an option the way a visitor does, then waits for the element to settle.
 *
 * A visitor's choice arrives as a `change` event, which is not fired by writing
 * to `value`. Dispatching it by hand is the only way to reproduce one from a
 * test -- and it has to be `bubbles: true`, because that is what a real one is.
 */
async function choose(element: PtkSelect, value: string): Promise<void> {
  const select = control(element);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

/** The narrowest phone still in production use. Also a narrow embed column. */
const NARROW_WIDTH = 320;

/** The floor from `tokens.css`, repeated so a change to it fails a test here. */
const TAP_TARGET_MIN = 44;

/**
 * Below this, iOS Safari zooms the page when the control takes focus and the
 * layout jumps under the thumb that tapped it.
 */
const MINIMUM_INPUT_FONT_SIZE = 16;

/** Mounts a select inside a fixed-width column, the way a phone presents one. */
async function mountAtWidth(
  width: number,
  properties: Partial<PtkSelect> = {},
): Promise<{ element: PtkSelect; frame: HTMLDivElement }> {
  const frame = document.createElement('div');
  frame.style.width = `${String(width)}px`;
  document.body.append(frame);
  teardown.push(() => {
    frame.remove();
  });

  const element = document.createElement('ptk-select');
  element.label = 'State';
  element.options = REGIONS;
  Object.assign(element, properties);
  frame.append(element);
  await element.updateComplete;
  return { element, frame };
}

describe('ptk-select', () => {
  it('renders one option per entry, plus the placeholder', async () => {
    const element = await mount();

    expect(optionValues(element)).toEqual(['', 'north', 'south']);
    expect(element.shadowRoot?.textContent).toContain('North');
  });

  it('names the control with the question', async () => {
    // Without the label association a screen reader announces "combo box, North"
    // with no indication of what is being asked -- and this screen asks several
    // questions of the same shape, so the announcements would be
    // indistinguishable from one another.
    const element = await mount();
    const label = element.shadowRoot?.querySelector('label');

    expect(label?.textContent).toBe('State');
    expect(label?.getAttribute('for')).toBe(control(element).id);
  });

  it('re-renders when a property changes', async () => {
    // The one test that would still fail if Lit's decorators were misconfigured.
    // `useDefineForClassFields: true` would emit real class fields over the
    // accessors `@property` installs, and the element would render its initial
    // state forever.
    const element = await mount();

    element.options = [...REGIONS, { value: 'east', label: 'East' }];
    await element.updateComplete;

    expect(optionValues(element)).toHaveLength(4);
  });

  it('selects the option matching the value', async () => {
    const element = await mount({ value: 'south' });

    expect(control(element).value).toBe('south');
  });

  it('follows a value set after the first render', async () => {
    const element = await mount();
    element.value = 'north';
    await element.updateComplete;

    expect(control(element).value).toBe('north');
  });

  it('selects the value even when the options arrive in the same render', async () => {
    // The gotcha this element's `updated()` hook exists for. lit-html commits an
    // element's own bindings before creating its children, so a `.value` binding
    // is assigned to a select that holds only the placeholder -- and a select
    // silently keeps its current value rather than accepting one it has no
    // option for. It then self-corrects on the next render, which is why the bug
    // survives manual testing: the symptom is a restored selection that is
    // briefly, or on a screen that never re-renders permanently, not there.
    const element = document.createElement('ptk-select');
    element.label = 'State';
    element.options = REGIONS;
    element.value = 'south';
    document.body.append(element);
    teardown.push(() => {
      element.remove();
    });
    await element.updateComplete;

    expect(control(element).value).toBe('south');
  });

  it('selects nothing when the value is not among the options', async () => {
    // A lifter who changes federation may hold a division the new one does not
    // have. Falling through to the engine's default would select the first
    // option -- an answer they never gave and would then plan against.
    const element = await mount({ value: 'not-an-option' });

    expect(control(element).value).toBe('');
  });

  it('reports a choice the visitor makes', async () => {
    const element = await mount();
    const heard: (string | null)[] = [];
    element.addEventListener(SELECT_CHANGE_EVENT, (event) => {
      // Typed without a cast: the element declares its event in
      // `HTMLElementEventMap`, so `detail` is known here.
      heard.push(event.detail.value);
    });

    await choose(element, 'south');

    expect(heard).toEqual(['south']);
    expect(element.value).toBe('south');
  });

  it('lets the visitor clear an answer by choosing the placeholder', async () => {
    // Requirement 2's "way to clear it": age division is optional, and a lifter
    // who picked one by accident has to be able to get back to no answer. A
    // native select has no empty state of its own, so the placeholder staying
    // selectable is the whole mechanism.
    const element = await mount({ value: 'north' });
    const heard: (string | null)[] = [];
    element.addEventListener(SELECT_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    await choose(element, '');

    expect(heard).toEqual([null]);
    expect(element.value).toBeNull();
  });

  it('never reports the placeholder as an answer of its own', async () => {
    // The empty string is what the DOM gives the placeholder option, and it is
    // not an identifier. A caller that stored it would be holding a region id
    // nothing matches, which reads downstream as a category with no records
    // rather than as no category chosen.
    const element = await mount();
    const heard: unknown[] = [];
    element.addEventListener(SELECT_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    await choose(element, 'north');
    await choose(element, '');

    expect(heard).toEqual(['north', null]);
  });

  it('lets the event out of the shadow root', async () => {
    // Without `composed` the event stops at the boundary, the page never hears
    // it, and the tool looks inert while the control visibly responds.
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.addEventListener(SELECT_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.removeEventListener(SELECT_CHANGE_EVENT, listener);
    });

    await choose(element, 'north');

    expect(heardOnDocument).toBe(1);
  });

  it('does not announce a programmatic change as a visitor choice', async () => {
    // The tool sets `value` itself when restoring or clearing a selection. If
    // that echoed back as a choice event, a caller that updates state on the
    // event would loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(SELECT_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = 'south';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('files grouped options under their heading', async () => {
    const element = await mount({
      label: 'Age division',
      options: [
        { value: 'j-1', label: 'Juniors 20-23', group: 'Juniors' },
        { value: 'm-1', label: 'Masters 40-44', group: 'Masters' },
        { value: 'm-2', label: 'Masters 45-49', group: 'Masters' },
      ],
    });

    const groups = [...control(element).querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['Juniors', 'Masters']);
    expect(groups[1]?.querySelectorAll('option')).toHaveLength(2);
  });

  it('keeps the order it was given rather than sorting the groups', async () => {
    // The caller hands these over already ordered -- Juniors before Masters
    // because that is the order of the divisions, not because of how the strings
    // compare. Sorting here would silently reorder a list somebody arranged.
    const element = await mount({
      options: [
        { value: 'm-1', label: 'Masters 40-44', group: 'Masters' },
        { value: 'j-1', label: 'Juniors 20-23', group: 'Juniors' },
      ],
    });

    expect([...control(element).querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Masters',
      'Juniors',
    ]);
  });

  it('leaves an ungrouped option outside every heading', async () => {
    // Mixing is real: a division list may carry a handful of headed groups and
    // one or two that belong to neither. Filing a stray under the group above it
    // would put it under a heading that is wrong about it.
    const element = await mount({
      options: [
        { value: 'sub', label: 'Submasters' },
        { value: 'm-1', label: 'Masters 40-44', group: 'Masters' },
      ],
    });

    const select = control(element);
    expect(select.querySelector('optgroup')?.querySelectorAll('option')).toHaveLength(1);
    expect([...select.children].map((child) => child.tagName)).toEqual([
      'OPTION',
      'OPTION',
      'OPTGROUP',
    ]);
  });

  it('says so when there is nothing to choose from', async () => {
    // An empty control looks like a rendering failure. Published data that has
    // not arrived yet is a real state and should read as one.
    const element = await mount({ options: [], emptyMessage: 'No states published.' });

    expect(element.shadowRoot?.querySelector('select')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('No states published.');
  });

  it('disables the control without hiding the answer', async () => {
    const element = await mount({ value: 'north', disabled: true });

    expect(control(element).matches(':disabled')).toBe(true);
    expect(control(element).value).toBe('north');
  });

  it('describes the control with the hint rather than renaming it', async () => {
    // "State, combo box, adds state records to the report", not "State adds
    // state records to the report, combo box". A hint folded into the name makes
    // every announcement of the control a sentence long.
    const element = await mount({ hint: 'Adds state records to the report.' });
    const select = control(element);

    const described = select.getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(element.shadowRoot?.getElementById(described ?? '')?.textContent).toBe(
      'Adds state records to the report.',
    );
    expect(element.shadowRoot?.querySelector('label')?.textContent).toBe('State');
  });

  it('points aria-describedby at nothing when there is no hint', async () => {
    // An `aria-describedby` naming an element that does not exist is announced
    // as nothing by some engines and as the literal identifier by others.
    const element = await mount();

    expect(control(element).hasAttribute('aria-describedby')).toBe(false);
  });

  it('escapes text rather than rendering it as markup', async () => {
    // Option labels come from published data. Nothing in the pipeline promises
    // they are free of angle brackets, and the project forbids rendering source
    // content as HTML.
    const element = await mount({
      options: [{ value: 'x', label: '<img src=x onerror="throw new Error()">' }],
    });

    expect(element.shadowRoot?.querySelector('img')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('<img src=x');
  });

  it('has no detectable accessibility violations', async () => {
    const element = await mount({ value: 'north', hint: 'Adds state records to the report.' });

    const results = await axe.run(element, {
      // Contrast is a property of the tokens against the page background, which
      // this element does not control. It belongs in the end-to-end pass.
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no violations when it is empty either', async () => {
    const element = await mount({ options: [] });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    it('gives the control a target a thumb can hit', async () => {
      const { element } = await mountAtWidth(NARROW_WIDTH);

      expect(control(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(
        TAP_TARGET_MIN,
      );
    });

    it('never sets a font small enough to make iOS zoom the page', async () => {
      const { element } = await mountAtWidth(NARROW_WIDTH);

      const size = Number.parseFloat(getComputedStyle(control(element)).fontSize);
      expect(size).toBeGreaterThanOrEqual(MINIMUM_INPUT_FONT_SIZE);
    });

    it('holds a long option inside its column instead of widening it', async () => {
      // The case this element was built for. Fifty states as tiles is a wall to
      // scroll past; the same fifty in a select is one control -- but only if a
      // long label cannot push the control past its container, which is what a
      // select does by default at its intrinsic width.
      const { frame } = await mountAtWidth(NARROW_WIDTH, {
        options: [
          {
            value: 'long',
            label: 'Submaster and Master combined, drug tested, single ply, national',
          },
        ],
      });

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    it('holds a long placeholder inside its column too', async () => {
      // Separately, because the placeholder is the option showing before anybody
      // has answered -- so it is the one that decides the control's width on the
      // screen a lifter actually opens.
      const { frame } = await mountAtWidth(NARROW_WIDTH, {
        placeholder: 'No division selected, showing Open only',
      });

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
