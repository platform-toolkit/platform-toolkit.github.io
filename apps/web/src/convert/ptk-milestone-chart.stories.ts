import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { inventedChart } from './chart-fixture.js';
import type { PtkMilestoneChart } from './ptk-milestone-chart.js';
import './ptk-milestone-chart.js';

/**
 * The barbell landmarks, and what each is on the platform.
 *
 * A lifter who trains in pounds knows 315 as three plates a side and does not know
 * it as anything in kilograms; this section is the translation, done once against
 * the published chart rather than re-derived at a rack. The bar assumption is
 * printed rather than implied, because collars are the single most common reason a
 * lifter's own arithmetic is out — the pound sequence excludes them and the
 * kilogram sequence includes five kilograms of them.
 *
 * `unit` picks the list, and it is the unit being converted *to* rather than the
 * one being typed in: somebody entering pounds is headed for a kilogram platform,
 * so the loadings worth recognising are the kilogram ones. The heading names the
 * unit, because two units are on screen at once and an unlabelled column of
 * weights can be read the wrong way round.
 *
 * The invented chart stops at 150 kg on purpose: it puts the heavier landmarks off
 * the end, and "off the end" is the state that is easiest to render wrongly and
 * hardest to notice, because a computed figure there looks entirely plausible.
 */

const CHART = inventedChart();

const meta: Meta<PtkMilestoneChart> = {
  title: 'Convert/Barbell landmarks',
  component: 'ptk-milestone-chart',
  tags: ['autodocs'],
  argTypes: {
    unit: {
      control: 'inline-radio',
      options: ['lb', 'kg'],
      description:
        'Which landmark sequence to show, and the unit its totals are in. The two are different lists off two different bars, not a conversion of one another. The converter sets this to the unit being converted to.',
    },
    chart: { control: false, description: 'The published chart, or null when there is none.' },
    chartStatus: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
    },
    chartLabel: { control: 'text', description: 'The federation name, quoted in the wording.' },
  },
  args: {
    unit: 'lb',
    chart: CHART,
    chartStatus: 'ready',
    chartLabel: CHART.label,
  },
  render: (args) => html`
    <ptk-milestone-chart
      .unit=${args.unit}
      .chart=${args.chart}
      chart-status=${args.chartStatus}
      chart-label=${args.chartLabel}
    ></ptk-milestone-chart>
  `,
};

export default meta;

type Story = StoryObj<PtkMilestoneChart>;

/**
 * The pound sequence: a 45 lb bar with no collars, every landmark a plate change.
 * Most of them land between two published rows, and both rows are named. This is
 * what the converter shows on "kilograms to pounds".
 */
export const PoundLandmarks: Story = {};

/**
 * The kilogram sequence, which starts at 25 kg because the bar comes with collars
 * on it. These land on published rows, so each row has one figure rather than two
 * — which is what the two-figure rows above are being compared against. This is
 * what the converter shows on "pounds to kilograms", and it is the default
 * direction.
 */
export const KilogramLandmarks: Story = {
  args: { unit: 'kg' },
};

/**
 * The chart is still on its way.
 *
 * Every row shows its arithmetic and says plainly that no published figure is in
 * hand. The failure this prevents is the arithmetic quietly taking the chart's
 * place, where 142.88 kg reads as something a platform would accept.
 */
export const ChartLoading: Story = {
  args: { chart: null, chartStatus: 'loading' },
};

/**
 * The read failed: one sentence for the whole section, above the rows it affected.
 * Fifteen identical error lines is the same information rendered as a wall.
 */
export const ChartFailed: Story = {
  args: { chart: null, chartStatus: 'failed' },
};

/**
 * The federation publishes no chart. No notice at all — the per-row sentence
 * already says there is no published figure, and this is not an error.
 */
export const NoChartPublished: Story = {
  args: { chart: null, chartStatus: 'unavailable' },
};

/**
 * A phone-width column. The grid's track minimum is wider than 320 px, so this is
 * the story that shows the collapse to one column working — the part of the
 * intrinsic-grid pattern whose absence looks like nothing in a wide window.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-milestone-chart
        .unit=${args.unit}
        .chart=${args.chart}
        chart-status=${args.chartStatus}
        chart-label=${args.chartLabel}
      ></ptk-milestone-chart>
    </div>
  `,
};
