// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { defineConvert } from '@platform-toolkit/convert/element';
import {
  convertAgainstChart,
  enterWeight,
  entryWeight,
  type ConversionAnswer,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { inventedChart } from '../core/chart.fixture.js';
import type { PtkConversionResult } from './ptk-conversion-result.js';

// The registry is written once, explicitly. See the note in the composite root's stories.
defineConvert();

/**
 * The answer, and the rule the whole tool exists to keep.
 *
 * Two numbers, never merged: the weight the federation published, and the exact
 * arithmetic. The published one leads because it is the one that can be attempted
 * on a platform; the arithmetic is a footnote because it is the one that cannot.
 * Every state below is one of the ways that pairing can go — a row landed on, a
 * weight between two rows, a tie nobody may break for the lifter, a chart that
 * never arrived — and each is reachable here with no session and no network,
 * which is the point of the panel taking everything as a property.
 *
 * Every figure comes from an invented chart belonging to a federation that does
 * not exist (§5.1).
 */

const CHART = inventedChart();

/** The answer the tool would compute for a figure typed in one unit. */
function answerFor(amount: number, unit: WeightUnit, withChart = true): ConversionAnswer {
  return convertAgainstChart(entryWeight(enterWeight(amount, unit)), withChart ? CHART : null);
}

const meta: Meta<PtkConversionResult> = {
  title: 'Convert/Conversion result',
  component: 'ptk-conversion-result',
  tags: ['autodocs'],
  argTypes: {
    answer: { control: false, description: 'The computed answer, or null before anything typed.' },
    chartStatus: {
      control: 'inline-radio',
      options: ['loading', 'ready', 'unavailable', 'failed'],
      description: 'How the read of the published chart went.',
    },
    chartLabel: { control: 'text', description: 'The federation name, quoted in the wording.' },
    precision: {
      control: { type: 'number', min: 0, max: 6 },
      description: 'Decimal places on the exact figure only. The chart value has none to choose.',
    },
    direction: {
      control: 'inline-radio',
      options: ['lb-to-kg', 'kg-to-lb'],
      description: 'Only words the empty state, so the example is in the unit being typed.',
    },
  },
  args: {
    answer: answerFor(315, 'lb'),
    chartStatus: 'ready',
    chartLabel: CHART.label,
    precision: 2,
    direction: 'lb-to-kg',
  },
  render: (args) => html`
    <ptk-conversion-result
      .answer=${args.answer}
      chart-status=${args.chartStatus}
      chart-label=${args.chartLabel}
      .precision=${args.precision}
      .direction=${args.direction}
    ></ptk-conversion-result>
  `,
};

export default meta;

type Story = StoryObj<PtkConversionResult>;

/**
 * Three plates a side, which is a round number in pounds and nothing at all in
 * kilograms. Both surrounding rows are offered, the nearer one is marked nearer,
 * and neither is recommended — which attempt to take is a coaching decision this
 * tool is in no position to make.
 */
export const BetweenTwoRows: Story = {};

/**
 * A weight that is on the chart.
 *
 * The federation's own 220.5 lb leads; the arithmetic's 220.46 lb sits under it
 * labelled as arithmetic. Leading with 220.46 would be answering a question about
 * scales rather than about platforms.
 */
export const ExactChartRow: Story = {
  args: { answer: answerFor(100, 'kg'), direction: 'kg-to-lb' },
};

/**
 * Exactly halfway between two rows.
 *
 * Both are marked equally close and nothing resolves it. A rounding rule here
 * would be the tool choosing somebody's next attempt for them, invisibly.
 */
export const ExactlyBetween: Story = {
  args: { answer: answerFor(102.5, 'kg'), direction: 'kg-to-lb' },
};

/**
 * Heavier than the heaviest published row. The chart ends, and saying so is the
 * whole answer — a computed figure here would look exactly like a chart value.
 */
export const AboveTheChart: Story = {
  args: { answer: answerFor(400, 'kg'), direction: 'kg-to-lb' },
};

/** Lighter than the lightest published row, the same situation from below. */
export const BelowTheChart: Story = {
  args: { answer: answerFor(20, 'kg'), direction: 'kg-to-lb' },
};

/** Nothing typed yet. An example rather than an error, in the unit being typed. */
export const NothingTyped: Story = {
  args: { answer: null },
};

/** The chart is still on its way. The arithmetic shows; nothing pretends to be a row. */
export const ChartLoading: Story = {
  args: { answer: answerFor(315, 'lb', false), chartStatus: 'loading' },
};

/**
 * The read failed.
 *
 * An error tone and a sentence saying a reload may help — because it may. This is
 * the state the two-numbers rule is easiest to break in: with no chart value, the
 * exact figure is the only number on screen and reads like an attempt.
 */
export const ChartFailed: Story = {
  args: { answer: answerFor(315, 'lb', false), chartStatus: 'failed' },
};

/**
 * The federation publishes no chart at all.
 *
 * Not an error and not an error tone: the read succeeded and a reload changes
 * nothing. Rendering this the same as a failure is how somebody reloads a page
 * that will never load.
 */
export const NoChartPublished: Story = {
  args: { answer: answerFor(315, 'lb', false), chartStatus: 'unavailable' },
};

/** Four decimal places, on the arithmetic only. */
export const MorePrecision: Story = {
  args: { answer: answerFor(100, 'kg'), precision: 4, direction: 'kg-to-lb' },
};

/**
 * A phone-width column with both option cards on screen — the widest state this
 * panel has, and the one a lifter reads at a rack.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-conversion-result
        .answer=${args.answer}
        chart-status=${args.chartStatus}
        chart-label=${args.chartLabel}
        .precision=${args.precision}
        .direction=${args.direction}
      ></ptk-conversion-result>
    </div>
  `,
};
