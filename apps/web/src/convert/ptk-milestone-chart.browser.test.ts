// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The landmark rows, and the claim that none of them is manufactured.
 *
 * Everything worth checking here is a sentence rather than a number: whether the
 * bar assumption is printed beside the rows it applies to, whether a landmark that
 * lands between two published rows names both of them, and whether a landmark past
 * the end of the chart says so instead of quoting the arithmetic as if it were a
 * chart weight. So the assertions read rendered text.
 *
 * The invented chart stops at 150 kg, which is deliberate: it puts the heavier
 * landmarks off the end, and "off the end" is the state that is easiest to render
 * wrongly and hardest to notice, because a computed figure there looks entirely
 * plausible.
 */
import { KILOGRAM_MILESTONES, POUND_MILESTONES } from '@platform-toolkit/domain';
// Sizing below is measured, and every rule that sets a size reads a custom
// property. Without the stylesheet those declarations are dropped and the
// measurement is of a layout that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { inventedChart } from './chart-fixture.js';
import type { ChartStatus } from './session.js';
import type { PtkMilestoneChart } from './ptk-milestone-chart.js';
import './ptk-milestone-chart.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

const CHART = inventedChart();

interface Options {
  readonly unit?: 'kg' | 'lb';
  readonly withChart?: boolean;
  readonly chartStatus?: ChartStatus;
}

async function mount(options: Options = {}): Promise<PtkMilestoneChart> {
  const element = document.createElement('ptk-milestone-chart');
  element.unit = options.unit ?? 'lb';
  element.chart = options.withChart === false ? null : CHART;
  element.chartStatus = options.chartStatus ?? 'ready';
  element.chartLabel = CHART.label;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function text(element: PtkMilestoneChart): string {
  return (element.shadowRoot?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

function rows(element: PtkMilestoneChart): HTMLLIElement[] {
  return [...(element.shadowRoot?.querySelectorAll('li') ?? [])];
}

/** One row's text, so a claim can be pinned to the landmark it is about. */
function rowText(element: PtkMilestoneChart, index: number): string {
  const row = rows(element)[index];
  if (row === undefined) throw new Error(`No row at index ${String(index)}.`);
  return row.textContent.replace(/\s+/gu, ' ').trim();
}

describe('ptk-milestone-chart', () => {
  it('re-renders when a property changes after first render', async () => {
    const element = await mount({ unit: 'lb' });
    expect(rows(element)).toHaveLength(POUND_MILESTONES.milestones.length);

    element.unit = 'kg';
    await element.updateComplete;

    expect(rows(element)).toHaveLength(KILOGRAM_MILESTONES.milestones.length);
  });

  it('names the unit its totals are in, in the heading', async () => {
    // Two units are on the screen at once and this section is the one that is not
    // in the unit being typed, so an unlabelled "Common barbell weights" above a
    // column of figures can be read exactly the wrong way round.
    const pounds = await mount({ unit: 'lb' });
    expect(text(pounds)).toContain('Common barbell weights in pounds');
    pounds.remove();

    const kilograms = await mount({ unit: 'kg' });
    expect(text(kilograms)).toContain('Common barbell weights in kilograms');
  });

  it('states the bar it is assuming, and states a different one for kilograms', async () => {
    // The five kilograms of collars is the single most common reason a lifter's
    // own arithmetic is out, so it is printed rather than implied by the totals.
    const pounds = await mount({ unit: 'lb' });
    expect(text(pounds)).toContain('45 lb bar, no collars. Every total below includes the bar.');
    expect(text(pounds)).not.toContain('collars,');
    pounds.remove();

    const kilograms = await mount({ unit: 'kg' });
    expect(text(kilograms)).toContain('20 kg bar with 2.5 kg collars, 25 kg before plates');
    expect(text(kilograms)).toContain('includes the bar and 5 kg of competition collars');
  });

  it('names both published rows around a landmark that is not on the chart', async () => {
    // 315 lb -- three plates a side -- is the case the whole section exists for:
    // it is a round number in pounds and nothing at all in kilograms. The chart's
    // 140 and 145 kg rows are named; 142.88 kg is present but labelled as exact
    // arithmetic and never as something the platform offers.
    const element = await mount({ unit: 'lb' });
    const index = POUND_MILESTONES.milestones.findIndex((milestone) => milestone.total === 315);
    const row = rowText(element, index);

    expect(row).toContain('315 lb');
    expect(row).toContain('140 kg or 145 kg on the chart');
    // Nearest is measured in the column the landmark is stated in -- 315 lb against
    // the published 308.6 and 319.7, not 142.88 against 140 and 145. The two agree
    // here, which is why the row is named rather than the distance: an assertion on
    // "4.7 lb away" would be checking arithmetic the panel deliberately keeps second.
    expect(row).toContain('Closest is 145 kg.');
    expect(row).toContain('Exactly 142.88 kg');
    // The manufactured row this file exists to refuse: 142.88 must never be
    // offered as the chart weight.
    expect(row).not.toContain('142.88 kg on the');
  });

  it('quotes the published row directly when a landmark is one', async () => {
    // On the kilogram sequence the landmarks are round kilograms, so they land on
    // rows -- and then there is one figure to show, not two.
    const element = await mount({ unit: 'kg' });
    const index = KILOGRAM_MILESTONES.milestones.findIndex((milestone) => milestone.total === 75);
    const row = rowText(element, index);

    expect(row).toContain(`165.3 lb on the ${CHART.label} chart`);
    expect(row).not.toContain(' or ');
  });

  it('says a landmark is off the end of the chart rather than computing one for it', async () => {
    const element = await mount({ unit: 'lb' });
    const index = POUND_MILESTONES.milestones.findIndex((milestone) => milestone.total === 765);
    const row = rowText(element, index);

    expect(row).toContain('Outside the published chart.');
    // The nearest published row is named, because "outside" on its own leaves a
    // reader with nothing, and the heaviest row is a real answer.
    expect(row).toContain('Nearest is 150 kg.');
  });

  it('marks the whole-plate landmarks with a word and not only a border', async () => {
    const element = await mount({ unit: 'lb' });
    const marked = rows(element).filter((row) => row.classList.contains('full'));
    const expected = POUND_MILESTONES.milestones.filter((milestone) => milestone.fullPlates);

    expect(marked).toHaveLength(expected.length);
    // A border alone is a colour difference by another name, and forced-colours
    // mode discards it entirely.
    expect(rowText(element, 0)).toContain('Full plates');
  });

  it('shows the arithmetic and no chart weight when there is no chart', async () => {
    const element = await mount({ withChart: false, chartStatus: 'loading' });
    const row = rowText(element, 0);

    expect(row).toContain('No published chart weight available.');
    expect(row).toContain('Exactly');
    expect(text(element)).not.toContain('on the chart');
  });

  it('says a failed read failed, once, above the rows it affected', async () => {
    const failed = await mount({ withChart: false, chartStatus: 'failed' });
    const notices = failed.shadowRoot?.querySelectorAll('ptk-notice') ?? [];
    // One sentence for the whole section rather than one per row: fifteen
    // identical error lines is the same information rendered as a wall.
    expect(notices).toHaveLength(1);
    expect(text(failed)).toContain('could not be loaded');
    failed.remove();

    // A federation that publishes no chart is not an error and gets no notice --
    // the per-row sentence already says the chart weight is unavailable.
    const none = await mount({ withChart: false, chartStatus: 'unavailable' });
    expect(none.shadowRoot?.querySelectorAll('ptk-notice')).toHaveLength(0);
  });

  it('draws the plates for a landmark, per side, with the numbers on them', async () => {
    const element = await mount({ unit: 'lb' });
    const stack = rows(element)[4]?.querySelector('ptk-plate-stack');
    if (stack === null || stack === undefined) throw new Error('No plate stack rendered.');
    await stack.updateComplete;

    // 315 lb is three 45s a side. Colour is never the identification, so the
    // figure has to be in the text.
    expect((stack.shadowRoot?.textContent ?? '').replace(/\s+/gu, ' ')).toContain('45');
  });

  it('has no accessibility violations', async () => {
    const element = await mount({ unit: 'lb' });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('collapses to one column rather than scrolling sideways at phone width', async () => {
    // The grid's track minimum is 18rem, which is wider than a 320 px column --
    // so this measures the `min(100%, ...)` in the template, the one part of the
    // intrinsic-grid pattern whose absence looks like nothing in a wide window.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-milestone-chart');
    element.unit = 'lb';
    element.chart = CHART;
    element.chartStatus = 'ready';
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
