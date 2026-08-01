/**
 * The training-percentage table.
 *
 * Two claims are worth more than the arithmetic. The first is that the hundred
 * percent row equals the headline estimate *exactly* -- half a kilogram of
 * disagreement between two numbers on the same panel is impossible to explain to
 * a lifter at a rack, and it is what happens the moment the table is computed
 * from the unrounded figure. The second is that every row rounds down, because a
 * percentage of an estimate is an estimate twice over and rounding it up puts
 * weight on a bar on the strength of a number nobody measured.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERCENTAGE_STEP,
  PERCENTAGE_STEPS,
  trainingPercentages,
  type TrainingPercentage,
} from './one-rep-max-percentages.js';
import type { Weight } from './weight.js';

const ESTIMATE: Weight = { amount: 142.5, unit: 'kg' };

function rows(overrides: { step?: number; roundTo?: number } = {}): readonly TrainingPercentage[] {
  return trainingPercentages(ESTIMATE, {
    step: overrides.step ?? DEFAULT_PERCENTAGE_STEP,
    roundTo: overrides.roundTo ?? 0.5,
  });
}

describe('the table', () => {
  it('runs from a hundred percent down to fifty, heaviest first', () => {
    const percents = rows().map((row) => row.percent);
    expect(percents[0]).toBe(100);
    expect(percents[percents.length - 1]).toBe(50);
    expect(percents).toEqual([...percents].sort((left, right) => right - left));
  });

  it('starts on the headline figure exactly', () => {
    // §11's "all displayed numbers agree exactly", made true by construction
    // rather than by testing every combination: the estimate is the input, so
    // the hundred percent row is the estimate.
    //
    // The caller passes the *rounded* headline figure and the step it was
    // rounded to, which is why both steps here divide 142.5. Handing in a
    // figure that is not on the step -- the unrounded one, say -- puts a
    // hundred percent row a fraction below the estimate beside it, which is the
    // exact mismatch this section exists to prevent.
    const [first] = rows();
    expect(first?.load).toEqual(ESTIMATE);

    for (const step of [0.5, 2.5]) {
      const [top] = rows({ roundTo: step });
      expect(top?.load.amount, String(step)).toBe(ESTIMATE.amount);
    }
  });

  it('rounds every row down to the loading step', () => {
    // Ninety percent of 142.5 is 128.25, which is not loadable on any bar this
    // project knows about. Down to 128 on a half-kilogram step, down to 127.5 on
    // a 2.5 kg one -- never up, and never to a weight between plates.
    const at = (percent: number, roundTo: number): number | undefined =>
      rows({ roundTo }).find((row) => row.percent === percent)?.load.amount;

    expect(at(90, 0.5)).toBe(128);
    expect(at(90, 2.5)).toBe(127.5);
    expect(at(80, 0.5)).toBe(114);
    expect(at(50, 0.5)).toBe(71);
  });

  it('never rounds a row above its exact fraction', () => {
    for (const step of [0.5, 1, 2.5, 5]) {
      for (const row of rows({ roundTo: step })) {
        const exact = (ESTIMATE.amount * row.percent) / 100;
        expect(row.load.amount, `${String(row.percent)}%/${String(step)}`).toBeLessThanOrEqual(
          exact,
        );
        expect(row.load.amount / step).toBe(Math.round(row.load.amount / step));
      }
    }
  });

  it('descends without repeating a load, at the step a phone wants', () => {
    // Ten percent exists for a narrow screen. Six rows rather than eleven, and
    // still landing on the round percentages a programme is written in.
    const coarse = rows({ step: 10 });
    expect(coarse.map((row) => row.percent)).toEqual([100, 90, 80, 70, 60, 50]);
    for (let index = 1; index < coarse.length; index += 1) {
      const previous = coarse[index - 1];
      const current = coarse[index];
      expect(current?.load.amount).toBeLessThan(previous?.load.amount ?? 0);
    }
  });

  it('offers only steps that divide the range into whole percentages', () => {
    // A step of 7 would end the table at 51 and never show fifty, which reads as
    // a missing row rather than as a choice. The offered list is the guard.
    for (const step of PERCENTAGE_STEPS) {
      expect((100 - 50) % step, String(step)).toBe(0);
      const last = rows({ step });
      expect(last[last.length - 1]?.percent, String(step)).toBe(50);
    }
    expect(PERCENTAGE_STEPS).toContain(DEFAULT_PERCENTAGE_STEP);
  });

  it('keeps the estimate unit and never converts', () => {
    const pounds = trainingPercentages({ amount: 315, unit: 'lb' }, { step: 5, roundTo: 5 });
    for (const row of pounds) expect(row.load.unit).toBe('lb');
    expect(pounds[0]?.load.amount).toBe(315);
  });

  it('refuses a step that cannot build a table', () => {
    // Zero would loop forever rather than fail, which is the worst of the
    // available outcomes: a tab that hangs with nothing logged.
    for (const step of [0, -5, Number.NaN]) {
      expect(() => trainingPercentages(ESTIMATE, { step, roundTo: 0.5 }), String(step)).toThrow(
        RangeError,
      );
    }
  });

  it('labels nothing', () => {
    // Ninety percent is not a "training max" and eighty is not a "working set".
    // Those are programme decisions this tool does not make, and a label would
    // turn a reference table into a prescription.
    for (const row of rows()) {
      expect(Object.keys(row).sort()).toEqual(['load', 'percent']);
    }
  });
});
