// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The published chart, and the two claims made about it.
 *
 * First, that it is folded *and unrendered* while folded -- a copy button per row
 * is several hundred custom elements, and building them for a section nobody
 * opened is a cost paid on a phone on one bar of signal. That is only checkable
 * from the DOM, which is what makes it worth a browser test rather than a note.
 *
 * Second, that nothing in here manufactures a row. The step filter selects from
 * the rows the federation published; a search that matches nothing published says
 * "nearest" rather than "found". Both of those are one word apart from the bug.
 *
 * The step control and the column-order control are rendered here but handled by
 * `ptk-converter`, which owns the session -- so this file sets those as properties
 * rather than clicking them. Clicking them in isolation would test nothing and
 * would look like it tested something.
 */
import { DISCLOSURE_TOGGLE_EVENT } from '@platform-toolkit/ui/ptk-disclosure';
import { type PtkNumberField } from '@platform-toolkit/ui/ptk-number-field';
// Sizes are measured below, and every rule that sets one reads a custom property.
import '@platform-toolkit/ui/tokens.css';
import { deepText } from '@platform-toolkit/ui/deep-text';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { INVENTED_CHART_DATA, inventedChart } from '../core/chart.fixture.js';
import type { ChartStatus, ColumnOrder } from '../types.js';
import { defineConvert } from './index.js';
import type { PtkConversionTable } from './ptk-conversion-table.js';

beforeAll(() => {
  defineConvert();
});

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

const CHART = inventedChart();
const ROW_COUNT = INVENTED_CHART_DATA.rows.length;

interface Options {
  readonly withChart?: boolean;
  readonly chartStatus?: ChartStatus;
  readonly step?: number;
  readonly order?: ColumnOrder;
}

async function mount(options: Options = {}): Promise<PtkConversionTable> {
  const element = document.createElement('ptk-conversion-table');
  element.chart = options.withChart === false ? null : CHART;
  element.chartStatus = options.chartStatus ?? 'ready';
  element.step = options.step ?? 0;
  element.order = options.order ?? 'kilograms-first';
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * Unfolds the section the way a visitor does.
 *
 * Through the real `<summary>` click rather than by setting a property, because
 * the disclosure's own state and this element's `open` are two different values
 * and the only thing keeping them together is the event. `<details>` fires
 * `toggle` **asynchronously**, so the wait is on the event and the update after
 * it -- awaiting straight after the click reads the previous state.
 */
async function unfold(element: PtkConversionTable): Promise<void> {
  const disclosure = element.shadowRoot?.querySelector('ptk-disclosure');
  if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
  const summary = disclosure.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No summary rendered.');

  const toggled = new Promise<void>((resolve) => {
    element.addEventListener(
      DISCLOSURE_TOGGLE_EVENT,
      () => {
        resolve();
      },
      { once: true },
    );
  });
  summary.click();
  await toggled;
  await element.updateComplete;
}

/** Types into the search field the way a visitor does, through the real input. */
async function search(element: PtkConversionTable, text: string): Promise<void> {
  const field = element.shadowRoot?.querySelector<PtkNumberField>(
    'ptk-number-field[data-field="search"]',
  );
  if (field === null || field === undefined) throw new Error('No search field rendered.');
  await field.updateComplete;
  const input = field.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No input rendered.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

function bodyRows(element: PtkConversionTable): HTMLTableRowElement[] {
  // `querySelectorAll` types a descendant selector as `Element`, so the filter is
  // what makes the row API available rather than an assertion (§2.4).
  return [...(element.shadowRoot?.querySelectorAll('tbody tr') ?? [])].filter(
    (row): row is HTMLTableRowElement => row instanceof HTMLTableRowElement,
  );
}

function cells(row: HTMLTableRowElement): string[] {
  return [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim());
}

describe('ptk-conversion-table', () => {
  it('re-renders when a property changes after first render', async () => {
    const element = await mount();
    expect(deepText(element)).toContain(`${String(ROW_COUNT)} published rows`);

    element.chart = null;
    element.chartStatus = 'unavailable';
    await element.updateComplete;

    expect(deepText(element)).toContain('No published chart is available.');
  });

  it('says the whole of what is true while folded', async () => {
    // Folded is the default and the summary is all a visitor sees, so it has to
    // carry the count and the range -- "Full conversion chart" alone gives no way
    // to know whether the weight being looked for is even in it.
    const element = await mount();
    expect(deepText(element)).toContain(`${String(ROW_COUNT)} published rows, 50 kg to 150 kg.`);
  });

  it('renders nothing at all inside the fold until it is opened', async () => {
    const element = await mount();
    expect(element.shadowRoot?.querySelector('table')).toBeNull();
    expect(element.shadowRoot?.querySelectorAll('ptk-copy-button')).toHaveLength(0);

    await unfold(element);

    expect(element.shadowRoot?.querySelector('table')).not.toBeNull();
    // One per row, which is the several hundred elements the fold exists to
    // avoid building for a section nobody opened.
    expect(element.shadowRoot?.querySelectorAll('ptk-copy-button')).toHaveLength(ROW_COUNT);
  });

  it('reproduces every published row and nothing between them', async () => {
    const element = await mount();
    await unfold(element);

    const rendered = bodyRows(element).map((row) => cells(row).slice(0, 2).join('/'));
    const published = INVENTED_CHART_DATA.rows.map(
      (row) => `${String(row.kilograms)}/${String(row.pounds)}`,
    );

    // Every row, in order, exactly as published -- not a conversion of the
    // kilogram column, which for this chart would disagree on several rows.
    expect(rendered).toEqual(published);
  });

  it('thins the chart by selecting published rows, never by generating them', async () => {
    const element = await mount({ step: 25 });
    await unfold(element);

    const kilograms = bodyRows(element).map((row) => cells(row)[0]);
    expect(kilograms).toEqual(['50', '75', '100', '125', '150']);
    // The caption says which step is showing, because a thinned chart that looked
    // complete would read as a federation that publishes 25 kg increments.
    expect(deepText(element)).toContain(
      `Published rows on every 25 kg, 5 of ${String(ROW_COUNT)}.`,
    );
  });

  it('puts the requested column first, in both the heading and the cells', async () => {
    const element = await mount({ order: 'pounds-first' });
    await unfold(element);

    const headings = [...(element.shadowRoot?.querySelectorAll('thead th') ?? [])].map((cell) =>
      cell.textContent.trim(),
    );
    expect(headings.slice(0, 2)).toEqual(['Pounds', 'Kilograms']);

    const first = bodyRows(element)[0];
    if (first === undefined) throw new Error('No rows rendered.');
    expect(cells(first).slice(0, 2)).toEqual(['110.2', '50']);
  });

  it('tells a weight that is on the chart from one that is merely near a row', async () => {
    const element = await mount();
    await unfold(element);

    await search(element, '100');
    expect(deepText(element)).toContain('Found: 100 kg = 220.5 lb');

    // 137 kg is not published. Saying "found" here is the manufactured row this
    // whole tool refuses, arriving through the search box instead of the field.
    await search(element, '137');
    expect(deepText(element)).toContain('Nearest published row: 135 kg = 297.6 lb');
    expect(deepText(element)).not.toContain('Found:');
  });

  it('reads a bare number as the leading column and a suffix as itself', async () => {
    const element = await mount();
    await unfold(element);

    // Kilograms first, so a bare 315 is a search for 315 *kilograms* -- off the
    // end of this chart, nearest 150.
    await search(element, '315');
    expect(deepText(element)).toContain('Nearest published row: 150 kg = 330.7 lb');

    // The same digits with a unit are a different question, and the answer is a
    // different row.
    await search(element, '315 lb');
    expect(deepText(element)).toContain('Nearest published row: 145 kg = 319.7 lb');
  });

  it('marks the found row for assistive technology, not only by colour', async () => {
    const element = await mount();
    await unfold(element);
    await search(element, '100');

    const current = bodyRows(element).filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    const [marked] = current;
    if (marked === undefined) throw new Error('No row was marked.');
    expect(cells(marked).slice(0, 2)).toEqual(['100', '220.5']);
  });

  it('says nothing about a match when the search does not parse', async () => {
    const element = await mount();
    await unfold(element);

    await search(element, '1o5');

    // No row is pointed at, and the field says what is wrong with what was typed
    // rather than the table quietly picking a row.
    expect(bodyRows(element).filter((row) => row.hasAttribute('aria-current'))).toHaveLength(0);
    expect(deepText(element)).not.toContain('Nearest published row');
  });

  it('cites the chart it reproduced, with its revision and the date it was checked', async () => {
    const element = await mount();
    await unfold(element);
    const rendered = deepText(element);

    expect(rendered).toContain(INVENTED_CHART_DATA.source.label);
    expect(rendered).toContain(`revision ${INVENTED_CHART_DATA.source.revision}`);
    expect(rendered).toContain(INVENTED_CHART_DATA.source.verifiedOn);
    // Attribution without endorsement: the link is present, the claim is not.
    const link = element.shadowRoot?.querySelector('a');
    expect(link?.getAttribute('href')).toBe(INVENTED_CHART_DATA.source.url);
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('tells a failed read apart from a federation that publishes none', async () => {
    const failed = await mount({ withChart: false, chartStatus: 'failed' });
    await unfold(failed);
    expect(deepText(failed)).toContain('Reloading may help');
    failed.remove();

    const none = await mount({ withChart: false, chartStatus: 'unavailable' });
    await unfold(none);
    expect(deepText(none)).toContain('No conversion chart is published for this federation.');
    expect(deepText(none)).not.toContain('Reloading may help');
  });

  it('has no accessibility violations with the chart open', async () => {
    const element = await mount();
    await unfold(element);
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with every row on screen', async () => {
    // A two-column numeric table plus a copy button is the layout with the best
    // claim to needing a sideways scroll, and §5.7 says it may not have one. This
    // is why the cells carry no unit -- the heading does.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-conversion-table');
    element.chart = CHART;
    element.chartStatus = 'ready';
    frame.append(element);
    await element.updateComplete;
    await unfold(element);

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('keeps the copy button inside its column with room for a wider font', async () => {
    // The assertion above is the requirement; this one is the cause, and it is
    // here because the requirement failed by a third of a pixel on macOS and by
    // six pixels on Linux CI. `scrollWidth` is an integer, so the version that
    // matters most -- a copy button one pixel wider than the column it sits in --
    // rounds away on the machine the change is written on and only appears on the
    // machine that deploys. Measuring the button against its own cell reports the
    // real quantity, and the margin says how much a wider default font may cost
    // before the layout is a sideways scroll again.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-conversion-table');
    element.chart = CHART;
    element.chartStatus = 'ready';
    frame.append(element);
    await element.updateComplete;
    await unfold(element);

    const cell = element.shadowRoot?.querySelector('td.action');
    const button = cell?.querySelector('ptk-copy-button');
    if (!(cell instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('No copy button rendered in the action column.');
    }

    const spare = cell.getBoundingClientRect().width - button.getBoundingClientRect().width;
    expect(spare).toBeGreaterThanOrEqual(8);
  });
});
