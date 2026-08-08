// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { defineConvert } from '@platform-toolkit/convert/element';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { inventedChart } from '../core/chart.fixture.js';
import type { PtkConversionTable } from './ptk-conversion-table.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineConvert();

/**
 * The published chart, reproduced and nothing else.
 *
 * It is folded by default, and while folded it is genuinely unrendered — a copy
 * button per row is several hundred custom elements, and building them for a
 * section nobody opened is a cost paid on a phone on one bar of signal. That is
 * also why the stories that show the table open it the way a visitor does, by
 * pressing the summary: whether the section is open is this element's own state
 * and there is deliberately no property to force it.
 *
 * The other claim on show here is that nothing in this element manufactures a row.
 * The row-thinning control *selects* published rows, never interpolates between
 * them, and a search for a weight that is not published says "nearest" rather than
 * "found". Both of those are one word away from being a lie.
 */

const CHART = inventedChart();

/**
 * Presses the summary, which is the only way the table opens.
 *
 * Two shadow roots down — the summary belongs to `ptk-disclosure`, inside this
 * element — and `<details>` fires `toggle` asynchronously, so the wait is on the
 * element's own update rather than on the click returning.
 */
async function unfold(canvasElement: HTMLElement): Promise<void> {
  const table = canvasElement.querySelector('ptk-conversion-table');
  if (table === null) throw new Error('No chart rendered.');
  await table.updateComplete;

  const summary = table.shadowRoot
    ?.querySelector('ptk-disclosure')
    ?.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No summary rendered.');
  summary.click();
  await table.updateComplete;
}

const meta: Meta<PtkConversionTable> = {
  title: 'Convert/Full chart',
  component: 'ptk-conversion-table',
  tags: ['autodocs'],
  argTypes: {
    chart: { control: false, description: 'The published chart, or null when there is none.' },
    chartStatus: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
    },
    step: {
      control: 'inline-radio',
      options: [0, 5, 10, 25],
      description: 'Published kilograms per shown row. 0 shows every published row.',
    },
    order: {
      control: 'inline-radio',
      options: ['kilograms-first', 'pounds-first'],
      description: 'Which column leads. A bare search term is read as the leading unit.',
    },
  },
  args: {
    chart: CHART,
    chartStatus: 'ready',
    step: 0,
    order: 'kilograms-first',
  },
  render: (args) => html`
    <ptk-conversion-table
      .chart=${args.chart}
      chart-status=${args.chartStatus}
      .step=${args.step}
      .order=${args.order}
    ></ptk-conversion-table>
  `,
};

export default meta;

type Story = StoryObj<PtkConversionTable>;

/**
 * How it arrives: folded, with the summary carrying the whole of what is true
 * while folded. "Full conversion chart" on its own gives a reader no way to know
 * whether the weight they are looking for is even in it, so the count and the
 * range are in the summary line.
 */
export const Folded: Story = {};

/** Every published row, in the order the federation prints them. */
export const EveryRow: Story = {
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * Thinned to every 25 kg.
 *
 * These are five of the published rows and not a resampling of the chart — the
 * caption says which step is showing, because a thinned chart that looked complete
 * would read as a federation that publishes 25 kg increments.
 */
export const EveryTwentyFiveKilograms: Story = {
  args: { step: 25 },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/** Pounds leading, which also changes what a search term with no unit means. */
export const PoundsFirst: Story = {
  args: { order: 'pounds-first' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/** The read failed. Worth a reload, and it says so. */
export const ChartFailed: Story = {
  args: { chart: null, chartStatus: 'failed' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * The federation publishes no chart. The read succeeded, a reload changes nothing,
 * and the tone says so.
 */
export const NoChartPublished: Story = {
  args: { chart: null, chartStatus: 'unavailable' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

/**
 * A phone-width column with the table open.
 *
 * A two-column numeric table plus a copy button is the layout with the best claim
 * to needing a sideways scroll, and it may not have one. That is why the cells
 * carry no unit — the heading does.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-conversion-table
        .chart=${args.chart}
        chart-status=${args.chartStatus}
        .step=${args.step}
        .order=${args.order}
      ></ptk-conversion-table>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};
