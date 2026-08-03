// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §16, which is two authorities and a rule that neither may answer for the other.
 *
 * The bar says what can be loaded. The chart says what the federation prints beside
 * it. Almost every test below is a way of asking whether one of them has quietly
 * started answering the other's question -- a chart row offered as an attempt, an
 * attempt given a pound figure nobody published, a figure rounded up because the
 * arithmetic was easier that way.
 *
 * Two fixture choices carry most of the weight.
 *
 * The chart is invented (§5.1) and has two bands: 2 kg steps at the bottom, 5 kg
 * steps at the top. That is realistic -- {@link ConversionChartGap} exists because
 * federations do it -- and it is also the only way to get all four combinations out
 * of one chart against a 2 kg bar: a weight that is loadable and published, one
 * published but not loadable, one loadable but not published, and one that is
 * neither.
 *
 * One row disagrees with the arithmetic on purpose. The chart prints 220.4 lb for
 * 100 kg where the conversion gives 220.5, and nothing in the data contract
 * cross-checks the two columns, because when a federation's own chart disagrees with
 * a calculator it is the chart the meet runs on. A test that only used rows agreeing
 * to the decimal place could not tell a read from a computation.
 */
import type { ConversionChartData } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  attemptWeightFor,
  enterAttemptWeight,
  type AttemptEntry,
  type AttemptWeight,
} from './attempt-pounds.js';
import { ConversionChart } from './conversion-chart.js';
import { rulesFor } from './meet-profile.fixture.js';
import { convertWeight, type Weight } from './weight.js';

const RULES = rulesFor();

/** The fixture's own increment, read rather than assumed. */
const STEP = RULES.profile.barMultipleKilograms;

/**
 * An invented chart, coarser at the top than at the bottom.
 *
 * Every pound figure is the conversion rounded to a tenth except the 100 kg row,
 * which is a tenth light on purpose. The rows are written out rather than generated
 * for the reason the converter's fixture gives: a generated table cannot fail a test
 * about the difference between a published figure and a computed one.
 */
const INVENTED_CHART_DATA: ConversionChartData = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Conversion Chart',
    url: 'https://example.org/conversion-chart',
    revision: '2026-01-01',
    verifiedOn: '2026-01-02',
  },
  rows: [
    { kilograms: 40, pounds: 88.2 },
    { kilograms: 42, pounds: 92.6 },
    { kilograms: 44, pounds: 97 },
    { kilograms: 46, pounds: 101.4 },
    { kilograms: 48, pounds: 105.8 },
    { kilograms: 50, pounds: 110.2 },
    { kilograms: 52, pounds: 114.6 },
    { kilograms: 54, pounds: 119 },
    { kilograms: 56, pounds: 123.5 },
    { kilograms: 58, pounds: 127.9 },
    { kilograms: 60, pounds: 132.3 },
    { kilograms: 65, pounds: 143.3 },
    { kilograms: 70, pounds: 154.3 },
    { kilograms: 75, pounds: 165.3 },
    { kilograms: 80, pounds: 176.4 },
    { kilograms: 85, pounds: 187.4 },
    { kilograms: 90, pounds: 198.4 },
    { kilograms: 95, pounds: 209.4 },
    // The conversion gives 220.5. The federation prints 220.4. The federation wins.
    { kilograms: 100, pounds: 220.4 },
    { kilograms: 105, pounds: 231.5 },
    { kilograms: 110, pounds: 242.5 },
    { kilograms: 115, pounds: 253.5 },
    { kilograms: 120, pounds: 264.6 },
  ],
};

const CHART = buildChart();

function buildChart(): ConversionChart {
  const result = ConversionChart.from(INVENTED_CHART_DATA);
  if (!result.ok) {
    const problems = result.problems.map((problem) => problem.code).join(', ');
    throw new Error(`the invented chart is not a legal chart: ${problems}`);
  }
  return result.chart;
}

/**
 * The four kinds of weight this suite reasons about.
 *
 * Which properties each one has is asserted below rather than assumed, so an edit to
 * the chart that made one of them ordinary fails as a fixture problem instead of as
 * four unrelated tests going quietly green.
 */
const PUBLISHED_AND_LOADABLE = 50;
const PUBLISHED_NOT_LOADABLE = 65;
const LOADABLE_NOT_PUBLISHED = 68;
/** Midway between two rows in the fine band, so both neighbours are published. */
const BETWEEN_TWO_PUBLISHED = 45;
/** The row where the chart and the arithmetic disagree. */
const WHERE_THE_CHART_DISAGREES = 100;

function rowFor(kilograms: number): { readonly kilograms: number; readonly pounds: number } {
  const row = INVENTED_CHART_DATA.rows.find((candidate) => candidate.kilograms === kilograms);
  if (row === undefined) throw new Error(`the invented chart has no ${String(kilograms)} kg row`);
  return row;
}

function enter(kilograms: number, chart: ConversionChart | null = CHART): AttemptEntry {
  return enterAttemptWeight(RULES, { amount: kilograms, unit: 'kg' }, chart);
}

function codes(entry: AttemptEntry): readonly string[] {
  return entry.advisories.map((advisory) => advisory.code);
}

function messageFor(entry: AttemptEntry, code: string): string {
  const advisory = entry.advisories.find((candidate) => candidate.code === code);
  if (advisory === undefined) throw new Error(`no ${code} advisory was emitted`);
  return advisory.message;
}

function toTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

describe('the fixture is the situation these tests describe', () => {
  it('holds a weight of each kind', () => {
    expect(RULES.isLegalBarWeight(PUBLISHED_AND_LOADABLE)).toBe(true);
    expect(CHART.lookup(PUBLISHED_AND_LOADABLE, 'kilograms').kind).toBe('exact');

    expect(RULES.isLegalBarWeight(PUBLISHED_NOT_LOADABLE)).toBe(false);
    expect(CHART.lookup(PUBLISHED_NOT_LOADABLE, 'kilograms').kind).toBe('exact');

    expect(RULES.isLegalBarWeight(LOADABLE_NOT_PUBLISHED)).toBe(true);
    expect(CHART.lookup(LOADABLE_NOT_PUBLISHED, 'kilograms').kind).not.toBe('exact');

    expect(RULES.isLegalBarWeight(BETWEEN_TWO_PUBLISHED)).toBe(false);
    expect(CHART.lookup(BETWEEN_TWO_PUBLISHED - STEP / 2, 'kilograms').kind).toBe('exact');
    expect(CHART.lookup(BETWEEN_TWO_PUBLISHED + STEP / 2, 'kilograms').kind).toBe('exact');
  });

  it('prints one figure the arithmetic disagrees with', () => {
    const published = rowFor(WHERE_THE_CHART_DISAGREES).pounds;
    const computed = convertWeight({ amount: WHERE_THE_CHART_DISAGREES, unit: 'kg' }, 'lb').amount;

    expect(toTenth(computed)).not.toBe(published);
  });
});

describe('§16 the pound figure is read, never computed', () => {
  it('gives the chart its own figure for a weight the chart names', () => {
    const weight = attemptWeightFor(PUBLISHED_AND_LOADABLE, CHART);

    expect(weight.publishedPoundsReason).toBe('published');
    expect(weight.publishedPounds).toBe(rowFor(PUBLISHED_AND_LOADABLE).pounds);
  });

  it('prefers the published figure to the arithmetic where they disagree', () => {
    const weight = attemptWeightFor(WHERE_THE_CHART_DISAGREES, CHART);

    expect(weight.publishedPounds).toBe(rowFor(WHERE_THE_CHART_DISAGREES).pounds);
    expect(toTenth(weight.exactPounds)).not.toBe(weight.publishedPounds);
  });

  it('withholds a figure rather than inventing one for a weight the chart omits', () => {
    const weight = attemptWeightFor(LOADABLE_NOT_PUBLISHED, CHART);

    expect(weight.publishedPounds).toBeNull();
    expect(weight.publishedPoundsReason).toBe('not-on-the-chart');
  });

  it('distinguishes a missing row from a missing chart', () => {
    expect(attemptWeightFor(LOADABLE_NOT_PUBLISHED, null).publishedPoundsReason).toBe('no-chart');
    expect(attemptWeightFor(PUBLISHED_AND_LOADABLE, null).publishedPoundsReason).toBe('no-chart');
  });

  it('carries the exact conversion whether or not a figure was published', () => {
    for (const kilograms of [PUBLISHED_AND_LOADABLE, LOADABLE_NOT_PUBLISHED]) {
      const exact = convertWeight({ amount: kilograms, unit: 'kg' }, 'lb').amount;

      expect(attemptWeightFor(kilograms, CHART).exactPounds, String(kilograms)).toBe(exact);
      expect(attemptWeightFor(kilograms, null).exactPounds, String(kilograms)).toBe(exact);
    }
  });

  it('is not the closest attempt unless somebody says so', () => {
    expect(attemptWeightFor(PUBLISHED_AND_LOADABLE, CHART).closest).toBe(false);
    expect(attemptWeightFor(PUBLISHED_AND_LOADABLE, CHART, true).closest).toBe(true);
  });
});

describe('§16 the heavier attempt is never chosen for you', () => {
  it('names the legal attempt either side, from the bar own increment', () => {
    const entry = enter(BETWEEN_TWO_PUBLISHED);

    expect(entry.alreadyLegal).toBe(false);
    expect(entry.nextLower?.kilograms).toBe(BETWEEN_TWO_PUBLISHED - STEP / 2);
    expect(entry.nextHigher.kilograms).toBe(BETWEEN_TWO_PUBLISHED + STEP / 2);
  });

  it('sends an exact midpoint down rather than up', () => {
    const entry = enter(BETWEEN_TWO_PUBLISHED);

    expect(entry.closest).toBe(entry.nextLower);
    expect(entry.nextLower?.closest).toBe(true);
    expect(entry.nextHigher.closest).toBe(false);
  });

  it('goes up only when the figure is genuinely nearer the heavier attempt', () => {
    const above = enter(BETWEEN_TWO_PUBLISHED + 0.1);
    const below = enter(BETWEEN_TWO_PUBLISHED - 0.1);

    expect(above.closest).toBe(above.nextHigher);
    expect(below.closest).toBe(below.nextLower);
  });

  it('never invents a third weight to fill the closest slot', () => {
    for (const offset of [0, 0.1, 0.4, 0.5, 0.9, 1, 1.5, 1.9]) {
      const entry = enter(BETWEEN_TWO_PUBLISHED + offset);

      expect([entry.nextLower, entry.nextHigher], String(offset)).toContain(entry.closest);
    }
  });

  it('says both that a choice exists and that it was not made', () => {
    const entry = enter(BETWEEN_TWO_PUBLISHED);

    expect(codes(entry).slice(0, 2)).toEqual([
      'between-legal-attempts',
      'the-heavier-attempt-was-not-chosen-for-you',
    ]);
    expect(messageFor(entry, 'the-heavier-attempt-was-not-chosen-for-you')).toContain(
      'Nothing has been rounded up',
    );
  });

  it('says nothing about a choice when there is nothing to choose', () => {
    const entry = enter(PUBLISHED_AND_LOADABLE);

    expect(entry.alreadyLegal).toBe(true);
    expect(codes(entry)).not.toContain('between-legal-attempts');
    expect(codes(entry)).not.toContain('the-heavier-attempt-was-not-chosen-for-you');
    expect(entry.choices).toHaveLength(1);
    expect(entry.choices[0]?.kilograms).toBe(PUBLISHED_AND_LOADABLE);
  });

  it('marks exactly one of the offered attempts as the closest one', () => {
    for (const kilograms of [PUBLISHED_AND_LOADABLE, BETWEEN_TWO_PUBLISHED, STEP / 2]) {
      const entry = enter(kilograms);
      const marked = entry.choices.filter((choice) => choice.closest);

      expect(marked, String(kilograms)).toHaveLength(1);
      expect(entry.choices, String(kilograms)).toContain(entry.closest);
    }
  });
});

describe('§16 nothing legal below', () => {
  it('offers only the lightest attempt when the figure is under one increment', () => {
    const entry = enter(STEP / 2);

    expect(entry.nextLower).toBeNull();
    expect(entry.nextHigher.kilograms).toBe(STEP);
    expect(entry.choices.map((choice) => choice.kilograms)).toEqual([STEP]);
  });

  it('explains itself after saying a choice exists, not instead of it', () => {
    expect(codes(enter(STEP / 2))).toEqual([
      'between-legal-attempts',
      'the-heavier-attempt-was-not-chosen-for-you',
      'nothing-legal-below',
      'no-published-pound-figure',
    ]);
    expect(messageFor(enter(STEP / 2), 'nothing-legal-below')).toContain('one bar increment');
  });

  it('treats one whole increment as a legal attempt with nothing missing below it', () => {
    const entry = enter(STEP);

    expect(entry.alreadyLegal).toBe(true);
    expect(entry.nextLower?.kilograms).toBe(STEP);
    expect(codes(entry)).not.toContain('nothing-legal-below');
  });
});

describe('§16 a pound entry ends at the bar', () => {
  const inPounds: Weight = { amount: 225, unit: 'lb' };

  it('keeps what was typed, in the unit it was typed in', () => {
    expect(enterAttemptWeight(RULES, inPounds, CHART).entered).toEqual(inPounds);
  });

  it('converts exactly before rounding, rather than rounding the pounds first', () => {
    const entry = enterAttemptWeight(RULES, inPounds, CHART);

    expect(entry.exactKilograms).toBe(convertWeight(inPounds, 'kg').amount);
  });

  it('offers only weights the bar can be loaded to', () => {
    const entry = enterAttemptWeight(RULES, inPounds, CHART);

    for (const choice of entry.choices) {
      expect(RULES.isLegalBarWeight(choice.kilograms), String(choice.kilograms)).toBe(true);
    }
  });

  it('answers the same for one weight typed in either unit', () => {
    const fromPounds = enterAttemptWeight(RULES, inPounds, CHART);
    const fromKilograms = enter(fromPounds.exactKilograms);

    expect(fromKilograms.choices.map((choice) => choice.kilograms)).toEqual(
      fromPounds.choices.map((choice) => choice.kilograms),
    );
    expect(fromKilograms.closest.kilograms).toBe(fromPounds.closest.kilograms);
  });

  it('needs no choice from a pound figure that converts onto a legal attempt', () => {
    const asPounds = convertWeight({ amount: PUBLISHED_AND_LOADABLE, unit: 'kg' }, 'lb');
    const entry = enterAttemptWeight(RULES, asPounds, CHART);

    expect(entry.alreadyLegal).toBe(true);
    expect(entry.choices).toHaveLength(1);
  });
});

describe('§16 the chart and the bar are separate authorities', () => {
  it('never offers a chart row the bar cannot be loaded to', () => {
    const entry = enter(PUBLISHED_NOT_LOADABLE);

    expect(entry.alreadyLegal).toBe(false);
    expect(entry.choices.map((choice) => choice.kilograms)).toEqual([
      PUBLISHED_NOT_LOADABLE - STEP / 2,
      PUBLISHED_NOT_LOADABLE + STEP / 2,
    ]);
  });

  it('still offers a legal attempt the chart does not print', () => {
    const entry = enter(LOADABLE_NOT_PUBLISHED);

    expect(entry.alreadyLegal).toBe(true);
    expect(entry.choices[0]?.publishedPounds).toBeNull();
    expect(entry.choices[0]?.publishedPoundsReason).toBe('not-on-the-chart');
  });

  it('does not let a coarse chart narrow the bar anywhere in its range', () => {
    for (let kilograms = CHART.lightest.kilograms; kilograms <= CHART.heaviest.kilograms;) {
      expect(enter(kilograms).alreadyLegal, String(kilograms)).toBe(true);
      kilograms += STEP;
    }
  });

  it('keeps answering past both ends of the chart', () => {
    const below = enter(CHART.lightest.kilograms - STEP * 10);
    const above = enter(CHART.heaviest.kilograms + STEP * 10);

    for (const entry of [below, above]) {
      expect(entry.alreadyLegal).toBe(true);
      expect(entry.closest.publishedPounds).toBeNull();
      expect(entry.closest.publishedPoundsReason).toBe('not-on-the-chart');
    }
  });
});

describe('§16 the two chart advisories are mutually exclusive', () => {
  it('blames the missing chart rather than the missing rows', () => {
    const entry = enter(BETWEEN_TWO_PUBLISHED, null);

    expect(entry.choices.every((choice) => choice.publishedPounds === null)).toBe(true);
    expect(codes(entry)).toContain('no-chart-in-hand');
    expect(codes(entry)).not.toContain('no-published-pound-figure');
  });

  it('blames the missing row when a chart is in hand', () => {
    const entry = enter(LOADABLE_NOT_PUBLISHED + STEP / 2);

    expect(codes(entry)).toContain('no-published-pound-figure');
    expect(codes(entry)).not.toContain('no-chart-in-hand');
  });

  it('says neither when the chart names both attempts', () => {
    const entry = enter(BETWEEN_TWO_PUBLISHED);

    expect(codes(entry)).not.toContain('no-published-pound-figure');
    expect(codes(entry)).not.toContain('no-chart-in-hand');
  });

  it('puts the chart advisory last, after the choice has been explained', () => {
    expect(codes(enter(BETWEEN_TWO_PUBLISHED, null)).at(-1)).toBe('no-chart-in-hand');
    expect(codes(enter(LOADABLE_NOT_PUBLISHED)).at(-1)).toBe('no-published-pound-figure');
  });
});

describe('every state of an entry', () => {
  interface Situation {
    readonly name: string;
    readonly entered: Weight;
    readonly chart: ConversionChart | null;
  }

  /**
   * Every arrangement of the two authorities, plus both ends of the chart.
   *
   * Held as inputs rather than as entries so the determinism test can ask the
   * question a second time instead of comparing an answer with itself.
   */
  function everySituation(): readonly Situation[] {
    const kg = (amount: number): Weight => ({ amount, unit: 'kg' });
    return [
      { name: 'legal and published', entered: kg(PUBLISHED_AND_LOADABLE), chart: CHART },
      { name: 'legal and unpublished', entered: kg(LOADABLE_NOT_PUBLISHED), chart: CHART },
      { name: 'between two published', entered: kg(BETWEEN_TWO_PUBLISHED), chart: CHART },
      {
        name: 'between two unpublished',
        entered: kg(LOADABLE_NOT_PUBLISHED - STEP / 2),
        chart: CHART,
      },
      { name: 'on an unloadable chart row', entered: kg(PUBLISHED_NOT_LOADABLE), chart: CHART },
      { name: 'under one increment', entered: kg(STEP / 2), chart: CHART },
      {
        name: 'below the chart',
        entered: kg(CHART.lightest.kilograms - STEP * 10),
        chart: CHART,
      },
      {
        name: 'above the chart',
        entered: kg(CHART.heaviest.kilograms + STEP * 10),
        chart: CHART,
      },
      { name: 'no chart at all', entered: kg(BETWEEN_TWO_PUBLISHED), chart: null },
      { name: 'typed in pounds', entered: { amount: 225, unit: 'lb' }, chart: CHART },
    ];
  }

  function everyEntry(): readonly { readonly name: string; readonly entry: AttemptEntry }[] {
    return everySituation().map(({ name, entered, chart }) => ({
      name,
      entry: enterAttemptWeight(RULES, entered, chart),
    }));
  }

  /** Every weight the entry reports, in one list, however it was reached. */
  function reported(entry: AttemptEntry): readonly AttemptWeight[] {
    const weights = [entry.closest, entry.nextHigher, ...entry.choices];
    return entry.nextLower === null ? weights : [...weights, entry.nextLower];
  }

  it('never names a weight the bar cannot be loaded to', () => {
    for (const { name, entry } of everyEntry()) {
      for (const weight of reported(entry)) {
        expect(RULES.isLegalBarWeight(weight.kilograms), `${name}/${weight.kilograms}`).toBe(true);
      }
    }
  });

  it('never names a pound figure the chart does not print', () => {
    for (const { name, entry } of everyEntry()) {
      for (const weight of reported(entry)) {
        if (weight.publishedPounds === null) continue;
        const printed = INVENTED_CHART_DATA.rows.some(
          (row) => row.pounds === weight.publishedPounds,
        );
        expect(printed, `${name}/${weight.publishedPounds}`).toBe(true);
      }
    }
  });

  it('gives a published figure a reason that admits it and a null one that explains it', () => {
    for (const { name, entry } of everyEntry()) {
      for (const weight of reported(entry)) {
        const label = `${name}/${weight.kilograms}`;
        if (weight.publishedPounds === null) {
          expect(weight.publishedPoundsReason, label).not.toBe('published');
        } else {
          expect(weight.publishedPoundsReason, label).toBe('published');
        }
      }
    }
  });

  it('always carries the unrounded conversion alongside', () => {
    for (const { name, entry } of everyEntry()) {
      for (const weight of reported(entry)) {
        const exact = convertWeight({ amount: weight.kilograms, unit: 'kg' }, 'lb').amount;
        expect(weight.exactPounds, `${name}/${weight.kilograms}`).toBe(exact);
      }
    }
  });

  it('brackets the entry between the two attempts it offers', () => {
    for (const { name, entry } of everyEntry()) {
      expect(entry.nextHigher.kilograms, name).toBeGreaterThanOrEqual(
        entry.exactKilograms - 0.000_5,
      );
      if (entry.nextLower !== null) {
        expect(entry.nextLower.kilograms, name).toBeLessThanOrEqual(entry.exactKilograms + 0.000_5);
      }
    }
  });

  it('offers a distinct, ascending list with the closest attempt in it', () => {
    for (const { name, entry } of everyEntry()) {
      const kilograms = entry.choices.map((choice) => choice.kilograms);

      expect(kilograms.length, name).toBeGreaterThan(0);
      expect(new Set(kilograms).size, name).toBe(kilograms.length);
      expect(
        [...kilograms].sort((left, right) => left - right),
        name,
      ).toEqual(kilograms);
      expect(
        entry.choices.filter((choice) => choice.closest),
        name,
      ).toHaveLength(1);
      expect(entry.choices, name).toContain(entry.closest);
    }
  });

  it('never tells the lifter which attempt to take', () => {
    const forbidden = /\b(?:we recommend|you should|must take|take the heavier|go with)\b/i;
    for (const { name, entry } of everyEntry()) {
      for (const advisory of entry.advisories) {
        expect(advisory.message, `${name}/${advisory.code}`).not.toMatch(forbidden);
      }
    }
  });

  it('answers the same thing twice', () => {
    for (const { name, entry } of everyEntry()) {
      expect(
        enterAttemptWeight(
          RULES,
          entry.entered,
          entry.nextHigher.publishedPoundsReason === 'no-chart' ? null : CHART,
        ),
        name,
      ).toEqual(entry);
    }
  });
});
