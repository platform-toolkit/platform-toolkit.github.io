import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { inventedChart } from './chart-fixture.js';
import type { PtkConverter } from './ptk-converter.js';
import './ptk-converter.js';

/**
 * The whole tool: one field, and everything the federation has published about the
 * number in it.
 *
 * The tool owns the session and the four elements below it own nothing, which is
 * what makes every state on this page reachable with no network and no storage —
 * a chart still loading, a chart that failed, a federation that publishes none.
 * Those are the states worth looking at, because the filled-in happy path is the
 * one anybody would have guessed.
 *
 * The chart here is invented and belongs to a federation that does not exist
 * (§5.1). The published rows are deliberately coarser than a real chart's so that
 * the interesting lookups land on round numbers a reader can check by eye.
 */

const CHART = inventedChart();

const meta: Meta<PtkConverter> = {
  title: 'Convert/Converter',
  component: 'ptk-converter',
  tags: ['autodocs'],
  argTypes: {
    chart: { control: false, description: 'The published chart, or null when there is none.' },
    chartStatus: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
      description: 'How the read went. Every child says something different because of it.',
    },
    settings: {
      control: false,
      description:
        'Where the direction, precision and chart controls are remembered. In memory here, so one story cannot alter another.',
    },
  },
  args: {
    chart: CHART,
    chartStatus: 'ready',
  },
  render: (args) => html`
    <ptk-converter
      .chart=${args.chart}
      chart-status=${args.chartStatus}
      .settings=${createPreferenceStore(memoryPreferenceStorage())}
    ></ptk-converter>
  `,
};

export default meta;

type Story = StoryObj<PtkConverter>;

/**
 * How it opens: an empty field, an example rather than an error, and the landmarks
 * and full chart below already answering against the published rows. There is no
 * Clear control, because a control that does nothing is a control somebody presses
 * to find out what it does.
 */
export const Empty: Story = {};

/**
 * Three plates a side, typed in.
 *
 * The answer names both surrounding published rows and marks the nearer one; the
 * arithmetic sits underneath, labelled as arithmetic. Choosing a row puts the
 * federation's own figure back in the field, which is the alternative to retyping
 * a number off the screen where a transposed digit is a different attempt.
 */
export const WeightTyped: Story = {
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector('ptk-converter');
    if (element === null) throw new Error('No converter rendered.');
    await element.updateComplete;

    const input = element.shadowRoot
      ?.querySelector('ptk-number-field[data-field="weight"]')
      ?.shadowRoot?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('No weight field rendered.');
    input.value = '315';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await element.updateComplete;
  },
};

/**
 * The chart has not arrived yet.
 *
 * Every surface says so in its own words and none of them shows an empty space —
 * an empty panel reads as a working page with nothing to say, which is how a
 * lifter concludes their weight is simply not on the chart.
 */
export const ChartLoading: Story = {
  args: { chart: null, chartStatus: 'loading' },
};

/**
 * The read failed. Worth a reload, and every child says so rather than the answer
 * claiming a failure while the chart below it silently shows nothing.
 */
export const ChartFailed: Story = {
  args: { chart: null, chartStatus: 'failed' },
};

/**
 * A federation that publishes no conversion chart.
 *
 * Not an error: the read succeeded and a reload changes nothing. The tool still
 * converts — it just has no published rows to offer, and it never fills the gap
 * with arithmetic dressed up as a chart value.
 */
export const NoChartPublished: Story = {
  args: { chart: null, chartStatus: 'unavailable' },
};

/**
 * A phone-width column, which is where this tool is actually used: at a rack, or
 * at an expeditor's table working out what to write on a card.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-converter
        .chart=${args.chart}
        chart-status=${args.chartStatus}
        .settings=${createPreferenceStore(memoryPreferenceStorage())}
      ></ptk-converter>
    </div>
  `,
};
