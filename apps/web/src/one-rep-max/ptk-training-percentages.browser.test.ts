// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The percentage table: eleven rows, two columns, and no row told what it is for.
 *
 * The claim worth a real browser is the last one. §9.3 forbids labelling a
 * percentage — ninety is not a training max and eighty is not a working set, and
 * a calculator that has never seen the lifter is not the thing to say otherwise.
 * That is a property of the rendered table and of nothing a function returns, so
 * it is checked here by sweeping the text a lifter actually reads.
 *
 * The rest is the pair that has to agree: the headline figure above this section
 * and the hundred percent row inside it. They are computed by different code from
 * the same weight, and a coarser rounding step here puts the first row *below* the
 * number printed above it — two figures on one screen that should be identical
 * and are not, which reads as an arithmetic bug rather than as a rounding choice.
 */
import {
  CHOICE_CHANGE_EVENT,
  PtkChoiceGroup,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
// The row height is `var(--ptk-tap-target-min)`, and a declaration referencing an
// undefined property is dropped -- so without this the rows measured below have
// no floor at all and the test passes by measuring nothing (§5.7).
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import { toolkitFigureFor, weighing } from './estimate-fixture.js';
import { PERCENTAGE_STEP_FIELD } from './fields.js';
import type { PtkTrainingPercentages } from './ptk-training-percentages.js';
import './ptk-training-percentages.js';

/** The headline figure of the default described set, already rounded to 0.5 kg. */
const ESTIMATE = toolkitFigureFor();

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly estimate?: PtkTrainingPercentages['estimate'];
  readonly step?: number;
  readonly roundTo?: number;
  readonly within?: HTMLElement;
  readonly open?: boolean;
}

async function mount(options: Options = {}): Promise<PtkTrainingPercentages> {
  const element = document.createElement('ptk-training-percentages');
  element.estimate = options.estimate === undefined ? ESTIMATE : options.estimate;
  if (options.step !== undefined) element.step = options.step;
  if (options.roundTo !== undefined) element.roundTo = options.roundTo;
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  if (options.open ?? true) {
    const disclosure = element.shadowRoot?.querySelector('ptk-disclosure');
    if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
    disclosure.open = true;
    await element.updateComplete;
  }
  return element;
}

/** Every row as `percent → load`, in the order it is printed. */
function rows(element: PtkTrainingPercentages): string[] {
  return [...(element.shadowRoot?.querySelectorAll('tbody tr') ?? [])].map((row) => {
    const percent = row.querySelector('th')?.textContent.trim() ?? '';
    const load = row.querySelector('td')?.textContent.trim() ?? '';
    return `${percent} ${load}`;
  });
}

describe('ptk-training-percentages', () => {
  it('re-renders when the estimate changes after the first render', async () => {
    const element = await mount();
    expect(rows(element).at(0)).toBe('100% 166 kg');

    element.estimate = toolkitFigureFor(weighing('315 lb'));
    element.roundTo = 1;
    await element.updateComplete;

    expect(rows(element).at(0)).toBe('100% 367 lb');
  });

  it('renders nothing at all without an estimate', async () => {
    // Not an empty table and not a heading over one: there is no figure to take
    // a percentage of, and a section captioned "percentages of the estimate"
    // above nothing reads as a panel that failed to load.
    const element = await mount({ estimate: null, open: false });
    expect(element.shadowRoot?.querySelector('ptk-disclosure')).toBeNull();
    expect(deepText(element).trim()).toBe('');
  });

  it('starts at the headline figure exactly, not below it', async () => {
    // The one row that can contradict something else on screen. It agrees only
    // while this element's `roundTo` is the step the figure above was rounded to,
    // which is why the property exists rather than being assumed.
    const element = await mount();
    expect(rows(element).at(0)).toBe('100% 166 kg');
  });

  it('runs from 100% down to 50% and stops', async () => {
    const element = await mount();
    expect(rows(element)).toEqual([
      '100% 166 kg',
      '95% 157.5 kg',
      '90% 149 kg',
      '85% 141 kg',
      '80% 132.5 kg',
      '75% 124.5 kg',
      '70% 116 kg',
      '65% 107.5 kg',
      '60% 99.5 kg',
      '55% 91 kg',
      '50% 83 kg',
    ]);
  });

  it('halves the table on the ten percent step', async () => {
    // Eleven rows is a scroll on a phone. Ten percent is the same table for a
    // lifter who wants to read it at a rack, and it is a selection of the same
    // rows rather than a different calculation.
    const element = await mount({ step: 10 });
    expect(rows(element)).toEqual([
      '100% 166 kg',
      '90% 149 kg',
      '80% 132.5 kg',
      '70% 116 kg',
      '60% 99.5 kg',
      '50% 83 kg',
    ]);
  });

  it('rounds every load down, never up', async () => {
    // Rounding a load *up* hands a lifter a heavier bar than the percentage they
    // asked for -- the same directional-rounding safety property as everywhere
    // else in the domain (§5.5), arriving where it is easiest to get backwards.
    const element = await mount({ roundTo: 2.5 });
    expect(rows(element).at(0)).toBe('100% 165 kg');
    expect(rows(element).at(2)).toBe('90% 147.5 kg');
    expect(rows(element).at(-1)).toBe('50% 82.5 kg');
  });

  it('says what is inside the fold while it is folded', async () => {
    const element = await mount({ open: false });
    expect(element.shadowRoot?.querySelector('ptk-disclosure')?.getAttribute('summary')).toBe(
      'Loads from 100% down to 50% of 166 kg, each rounded down to 0.5 kg.',
    );
  });

  it('never says what a percentage is for', async () => {
    // §9.3 as a sweep. Each of these is a programme decision belonging to
    // whoever wrote the programme; printed beside a number here, each becomes a
    // prescription. The caption says so out loud, which is also checked.
    const element = await mount();
    const rendered = deepText(element).toLowerCase();

    for (const phrase of [
      'training max',
      'working set',
      'working weight',
      'opener',
      'warm-up',
      'deload',
      'hypertrophy',
      'speed work',
      'you should',
    ]) {
      expect(rendered).not.toContain(phrase);
    }
    expect(deepText(element)).toContain(
      'What any of them is for is a programming decision this tool does not make.',
    );
  });

  it('reports a change of step out of the shadow root, tagged with its field', async () => {
    const element = await mount();
    const seen: { field: string | null; value: string }[] = [];
    const listener = (event: CustomEvent<ChoiceChangeDetail>): void => {
      const path = event.composedPath();
      const tagged = path.find(
        (target) => target instanceof HTMLElement && target.dataset['field'] !== undefined,
      );
      seen.push({
        field: tagged instanceof HTMLElement ? (tagged.dataset['field'] ?? null) : null,
        value: event.detail.value,
      });
    };
    // On the body, because the claim is that it crossed two shadow boundaries.
    document.body.addEventListener(CHOICE_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(CHOICE_CHANGE_EVENT, listener);
    });

    const chooser = element.shadowRoot?.querySelector(
      `ptk-choice-group[data-field="${PERCENTAGE_STEP_FIELD}"]`,
    );
    if (!(chooser instanceof PtkChoiceGroup)) throw new Error('No step chooser rendered.');
    for (const input of chooser.shadowRoot?.querySelectorAll('input') ?? []) {
      if (input.value === '10') input.click();
    }
    await element.updateComplete;

    expect(seen).toEqual([{ field: PERCENTAGE_STEP_FIELD, value: '10' }]);
    // And the element does not act on it by itself: the root owns the step, so
    // an element that quietly re-rendered would be a second copy of the state.
    expect(rows(element)).toHaveLength(11);
  });

  it('gives every row a thumb-sized height', async () => {
    const element = await mount();
    for (const cell of element.shadowRoot?.querySelectorAll('tbody th') ?? []) {
      expect(cell.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });

  it('has no accessibility violations', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with pound loads in it', async () => {
    // Two columns of numbers is the one table shape that survives 320 px, which
    // is why this is a table and the formula comparison is a grid of cards.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount({
      estimate: toolkitFigureFor(weighing('315 lb')),
      roundTo: 1,
      within: frame,
    });

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
