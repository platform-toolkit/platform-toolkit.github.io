// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { Choice } from './ptk-choice-group.js';
import { TOGGLE_GROUP_CHANGE_EVENT, type PtkToggleGroup } from './ptk-toggle-group.js';
import './ptk-toggle-group.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** Kilogram denominations, which is the first real use and a realistic length. */
const PLATES: readonly Choice[] = [
  { value: '25', label: '25 kg' },
  { value: '20', label: '20 kg' },
  { value: '15', label: '15 kg' },
  { value: '10', label: '10 kg' },
  { value: '5', label: '5 kg' },
  { value: '2.5', label: '2.5 kg' },
  { value: '1.25', label: '1.25 kg' },
];

function mount(parent: HTMLElement = document.body): PtkToggleGroup {
  const element = document.createElement('ptk-toggle-group');
  element.label = 'Plates on the rack';
  element.choices = PLATES;
  element.values = ['25', '10'];
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function boxes(element: PtkToggleGroup): HTMLInputElement[] {
  return [...(element.shadowRoot?.querySelectorAll('input') ?? [])];
}

function box(element: PtkToggleGroup, value: string): HTMLInputElement {
  const found = boxes(element).find((input) => input.value === value);
  if (found === undefined) {
    throw new Error(`The group rendered no option for ${value}.`);
  }
  return found;
}

describe('ptk-toggle-group', () => {
  it('renders native checkboxes inside a fieldset', async () => {
    // The same refusal as the single-choice group: a checkbox is announced as a
    // checkbox, is not arrow-key navigable as a group, and has no "3 of 7"
    // position. A role="group" reimplementation has to be told all three.
    const element = mount();
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('fieldset')).not.toBeNull();
    expect(boxes(element)).toHaveLength(PLATES.length);
    expect(boxes(element).every((input) => input.type === 'checkbox')).toBe(true);
  });

  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here.
    const element = mount();
    await element.updateComplete;
    expect(box(element, '20').checked).toBe(false);

    element.values = ['20'];
    await element.updateComplete;

    expect(box(element, '20').checked).toBe(true);
    expect(box(element, '25').checked).toBe(false);
  });

  it('names the group, so the options are not announced loose', async () => {
    const element = mount();
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('legend')?.textContent).toContain(
      'Plates on the rack',
    );
  });

  it('reports the option that changed together with the whole selection', async () => {
    // A caller that only received the one value would have to track the set
    // itself, and two callers tracking the same set is how they drift apart.
    const element = mount();
    await element.updateComplete;

    const seen: { value: string; selected: boolean; values: readonly string[] }[] = [];
    element.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, (event) => {
      seen.push(event.detail);
    });

    box(element, '20').click();
    await element.updateComplete;

    expect(seen).toEqual([{ value: '20', selected: true, values: ['25', '20', '10'] }]);
  });

  it('reports a selection in the order of the choices, not the order they were tapped', async () => {
    // A caller comparing this against a stored list -- to decide whether
    // anything changed, or to write it back -- would otherwise see a different
    // list every time the same set was reached by a different route.
    const element = mount();
    element.values = [];
    await element.updateComplete;

    const seen: (readonly string[])[] = [];
    element.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, (event) => {
      seen.push(event.detail.values);
    });

    box(element, '2.5').click();
    await element.updateComplete;
    box(element, '25').click();
    await element.updateComplete;
    box(element, '10').click();
    await element.updateComplete;

    expect(seen.at(-1)).toEqual(['25', '10', '2.5']);
  });

  it('reports an option being cleared', async () => {
    const element = mount();
    await element.updateComplete;

    const seen: { value: string; selected: boolean; values: readonly string[] }[] = [];
    element.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, (event) => {
      seen.push(event.detail);
    });

    box(element, '25').click();
    await element.updateComplete;

    expect(seen).toEqual([{ value: '25', selected: false, values: ['10'] }]);
  });

  it('says nothing when the tool sets the selection', async () => {
    // A caller that wrote state back on the event would loop, and the event
    // means "the visitor did this" everywhere else in this collection.
    const element = mount();
    await element.updateComplete;

    let fired = 0;
    element.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, () => {
      fired += 1;
    });

    element.values = ['5', '2.5'];
    await element.updateComplete;

    expect(fired).toBe(0);
    expect(box(element, '5').checked).toBe(true);
  });

  it('keeps a selected value the choices no longer offer', async () => {
    // The caller may be holding answers for options it has not rendered yet --
    // a pound inventory while the unit is kg, say. Dropping them here would
    // erase a lifter's settings on a control they never touched.
    const element = mount();
    element.values = ['25', '45'];
    await element.updateComplete;

    const seen: (readonly string[])[] = [];
    element.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, (event) => {
      seen.push(event.detail.values);
    });

    expect(boxes(element).filter((input) => input.checked)).toHaveLength(1);

    box(element, '20').click();
    await element.updateComplete;

    // The unknown value is not in the reported set either, because the set is
    // rebuilt from the choices -- but it was not silently dropped behind the
    // caller's back on render, which is the failure this guards.
    expect(seen).toEqual([['25', '20']]);
  });

  it('says so plainly when there is nothing to choose from', async () => {
    const element = mount();
    element.choices = [];
    element.emptyMessage = 'No plate denominations for this unit.';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('No plate denominations for this unit.');
    expect(boxes(element)).toHaveLength(0);
  });

  it('disables every option when the group is disabled', async () => {
    // A disabled fieldset does not set input.disabled, so the assertion has to
    // be the match -- otherwise the test fails against a correct element.
    const element = mount();
    element.disabled = true;
    await element.updateComplete;

    expect(boxes(element).every((input) => input.matches(':disabled'))).toBe(true);
  });

  it('offers tap targets a thumb can hit', async () => {
    const element = mount();
    await element.updateComplete;

    for (const option of element.shadowRoot?.querySelectorAll('.option') ?? []) {
      expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  it('collapses to a single column instead of overflowing a phone', async () => {
    const frame = document.createElement('div');
    frame.style.width = '288px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('stacks one option per row when it is asked for a list', async () => {
    // Measured rather than asserted on the class, because the class is not the
    // promise -- the promise is that two options never share a line. Wide
    // enough for several tiles, so a grid that ignored the layout would put
    // three across and fail here.
    const frame = document.createElement('div');
    frame.style.width = '600px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    element.layout = 'list';
    await element.updateComplete;

    const tops = [...(element.shadowRoot?.querySelectorAll('.option') ?? [])].map(
      (option) => option.getBoundingClientRect().top,
    );

    expect(new Set(tops).size).toBe(PLATES.length);
  });

  it('clears the comfortable tap target, because it is tapped with chalk on', async () => {
    // A requirement floor rather than a proof of the declaration that states
    // it: a row is 66px today and the padding alone is what gets it there, so
    // deleting the `min-height` changes nothing measurable. Kept for the same
    // reason `.option`'s 44px floor is -- it is the assertion that fails the
    // day somebody tightens the space tokens, which is a change nobody would
    // otherwise connect to a checklist being harder to hit.
    const element = mount();
    element.layout = 'list';
    await element.updateComplete;

    for (const option of element.shadowRoot?.querySelectorAll('.option') ?? []) {
      expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
  });

  it('centres the box on a row whose label wraps', async () => {
    // The declaration that is load-bearing in the list layout, as against the
    // tap-target floor above which is not. A tile's label is one line and a
    // baseline-aligned box sits on it correctly; a row's label is a sentence,
    // and a box pinned to the first line of three sits near the top of a target
    // the whole height of which is tappable -- which reads as the tick belonging
    // to the line beside it rather than to the row.
    const frame = document.createElement('div');
    frame.style.width = '180px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    element.choices = [{ value: 'membership', label: 'Membership card and photo identification' }];
    element.layout = 'list';
    await element.updateComplete;

    const option = element.shadowRoot?.querySelector('.option');
    const input = element.shadowRoot?.querySelector('input');
    if (option === null || option === undefined || input === null || input === undefined) {
      throw new Error('The group rendered no row.');
    }

    const row = option.getBoundingClientRect();
    const box = input.getBoundingClientRect();
    // Three lines at this width, so a top-aligned box is most of a line away
    // from the middle; anything under a quarter of the row is centred.
    expect(row.height).toBeGreaterThan(60);
    expect(Math.abs(box.top + box.height / 2 - (row.top + row.height / 2))).toBeLessThan(
      row.height / 4,
    );
  });

  it('does not widen the track for a list of described options', async () => {
    // `described` exists to give a tile room for a second line, and a row is
    // already as wide as the group -- so the two are exclusive rather than
    // additive. Applying both puts a 13rem track minimum back on the one layout
    // that exists to have none, and on a 320px phone that overflows.
    const frame = document.createElement('div');
    frame.style.width = '288px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    element.choices = [
      { value: 'weigh-in', label: 'Weigh in', description: 'Two hours before the session' },
      { value: 'rack', label: 'Confirm rack heights', description: 'At the equipment check' },
    ];
    element.layout = 'list';
    await element.updateComplete;

    const options = element.shadowRoot?.querySelector('.options');
    expect(options?.classList.contains('described')).toBe(false);
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('still puts short answers in a grid by default', async () => {
    // The other half of the claim. Without this, a layout property that quietly
    // stacked everything would pass the test above and silently make every
    // existing caller's form three screens long.
    const frame = document.createElement('div');
    frame.style.width = '600px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    await element.updateComplete;

    const tops = [...(element.shadowRoot?.querySelectorAll('.option') ?? [])].map(
      (option) => option.getBoundingClientRect().top,
    );

    expect(new Set(tops).size).toBeLessThan(PLATES.length);
  });

  it('has no accessibility violations', async () => {
    const element = mount();
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
