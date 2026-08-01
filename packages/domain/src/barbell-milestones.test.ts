import { describe, expect, it } from 'vitest';

import {
  KILOGRAM_MILESTONES,
  POUND_MILESTONES,
  milestonesFor,
  standingAmongMilestones,
  type MilestoneChart,
} from './barbell-milestones.js';

/**
 * These tests check the transcribed sequences for internal consistency; they do
 * not derive them. A test that computed the list and compared would be the
 * generator this module refuses to have, wearing a different hat.
 */

const CHARTS: readonly [string, MilestoneChart][] = [
  ['pounds', POUND_MILESTONES],
  ['kilograms', KILOGRAM_MILESTONES],
];

describe.each(CHARTS)('%s milestones', (_name, chart) => {
  it('has plates that add up to every total', () => {
    // The check that catches a typo. Bar plus twice one side is the total, or the
    // diagram beside the number is a lie.
    for (const milestone of chart.milestones) {
      const perSide = milestone.perSide.reduce((sum, plate) => sum + plate, 0);
      expect(chart.emptyBar + perSide * 2).toBe(milestone.total);
    }
  });

  it('ascends', () => {
    const totals = chart.milestones.map((milestone) => milestone.total);
    expect(totals).toStrictEqual([...totals].sort((left, right) => left - right));
    expect(new Set(totals).size).toBe(totals.length);
  });

  it('loads heaviest plate first', () => {
    for (const milestone of chart.milestones) {
      expect(milestone.perSide).toStrictEqual(
        [...milestone.perSide].sort((left, right) => right - left),
      );
    }
  });

  it('marks a row as full plates exactly when every plate is the big one', () => {
    for (const milestone of chart.milestones) {
      const heaviest = milestone.perSide[0];
      const allSame = milestone.perSide.every((plate) => plate === heaviest);
      expect(milestone.fullPlates).toBe(allSame);
    }
  });
});

describe('the two charts', () => {
  it('do not share a bar weight', () => {
    // The 25 kg starting point is the number lifters miss. If these ever agree,
    // something has quietly copied one chart's bar into the other.
    expect(POUND_MILESTONES.emptyBar).toBe(45);
    expect(KILOGRAM_MILESTONES.emptyBar).toBe(25);
  });

  it('start where the published sequences start', () => {
    expect(POUND_MILESTONES.milestones[0]?.total).toBe(135);
    expect(KILOGRAM_MILESTONES.milestones[0]?.total).toBe(75);
  });

  it('end where the published sequences end', () => {
    expect(POUND_MILESTONES.milestones.at(-1)?.total).toBe(765);
    expect(KILOGRAM_MILESTONES.milestones.at(-1)?.total).toBe(325);
  });
});

describe('milestonesFor', () => {
  it('picks the chart for the unit', () => {
    expect(milestonesFor('lb')).toBe(POUND_MILESTONES);
    expect(milestonesFor('kg')).toBe(KILOGRAM_MILESTONES);
  });
});

describe('standingAmongMilestones', () => {
  it('counts a landmark as reached when the weight equals it', () => {
    const standing = standingAmongMilestones(315, POUND_MILESTONES);
    expect(standing.reached?.total).toBe(315);
    expect(standing.next?.total).toBe(365);
    expect(standing.remaining).toBe(50);
  });

  it('reports nothing reached below the lightest landmark', () => {
    const standing = standingAmongMilestones(95, POUND_MILESTONES);
    expect(standing.reached).toBeNull();
    expect(standing.next?.total).toBe(135);
    expect(standing.remaining).toBe(40);
  });

  it('reports nothing ahead past the heaviest landmark', () => {
    const standing = standingAmongMilestones(800, POUND_MILESTONES);
    expect(standing.reached?.total).toBe(765);
    expect(standing.next).toBeNull();
    expect(standing.remaining).toBeNull();
  });

  it('does not leave float noise in the remaining weight', () => {
    expect(standingAmongMilestones(102.1, KILOGRAM_MILESTONES).remaining).toBe(2.9);
  });

  it('refuses a weight that is not a number', () => {
    expect(() => standingAmongMilestones(Number.NaN, POUND_MILESTONES)).toThrow(RangeError);
  });
});
