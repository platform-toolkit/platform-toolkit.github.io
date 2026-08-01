/**
 * An invented conversion chart, for tests and stories only.
 *
 * **Nothing that ships may import this file.** It is here rather than copied into
 * eight test and story files because a conversion chart is twenty-one rows and a
 * provenance block, and eight copies of it is eight places for a row to drift --
 * at which point two suites disagree about what "between two rows" means and each
 * one is internally consistent.
 *
 * WHY THE NUMBERS ARE MADE UP
 *
 * §5.1: federation figures live in published artifacts and never in source, so a
 * test that asserted against real USPA rows would be a second copy of the data
 * with no provenance and no verification date, and it would start failing the day
 * the federation revised its chart -- reporting a data refresh as a code defect.
 * These rows belong to a federation that does not exist.
 *
 * WHY IT IS COARSER THAN A REAL CHART
 *
 * Five-kilogram steps rather than the two-and-a-half a real federation prints.
 * That is not laziness about typing: it is what makes the interesting lookups
 * reachable with round numbers a reader can check by eye. 102.5 kg is exactly
 * between two rows, so it is the tie case; 315 lb lands between two rows in the
 * pound column; the heavier barbell landmarks run off the end of the chart, which
 * is the `above-range` state. On a 2.5 kg chart every one of those needs a number
 * with a decimal in it and the reader has to do arithmetic to see why the test is
 * right.
 *
 * The rows are written out rather than generated, for the same reason the real
 * chart is transcribed: a generator produces a plausible table with a typo in it
 * and no way to see the typo, and a fixture whose rows were computed cannot fail
 * a test about the difference between a computed figure and a published one --
 * which is the whole subject of this tool.
 */
import type { ConversionChartData } from '@platform-toolkit/data-contracts';
import { ConversionChart } from '@platform-toolkit/domain';

/**
 * The published table, as this fictional federation prints it.
 *
 * The pound column is the federation's own figure at one decimal place, not a
 * conversion of the kilogram column, which is why a few rows are a hundredth away
 * from what the arithmetic gives. That difference is the tool's subject matter, so
 * a fixture that erased it would make every test pass for the wrong reason.
 */
export const INVENTED_CHART_DATA: ConversionChartData = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Conversion Chart',
    url: 'https://example.org/conversion-chart',
    revision: '2026-01-01',
    verifiedOn: '2026-01-02',
  },
  rows: [
    { kilograms: 50, pounds: 110.2 },
    { kilograms: 55, pounds: 121.3 },
    { kilograms: 60, pounds: 132.3 },
    { kilograms: 65, pounds: 143.3 },
    { kilograms: 70, pounds: 154.3 },
    { kilograms: 75, pounds: 165.3 },
    { kilograms: 80, pounds: 176.4 },
    { kilograms: 85, pounds: 187.4 },
    { kilograms: 90, pounds: 198.4 },
    { kilograms: 95, pounds: 209.4 },
    { kilograms: 100, pounds: 220.5 },
    { kilograms: 105, pounds: 231.5 },
    { kilograms: 110, pounds: 242.5 },
    { kilograms: 115, pounds: 253.5 },
    { kilograms: 120, pounds: 264.6 },
    { kilograms: 125, pounds: 275.6 },
    { kilograms: 130, pounds: 286.6 },
    { kilograms: 135, pounds: 297.6 },
    { kilograms: 140, pounds: 308.6 },
    { kilograms: 145, pounds: 319.7 },
    { kilograms: 150, pounds: 330.7 },
  ],
};

/**
 * The same table as a built chart.
 *
 * Built through the smart constructor rather than assembled directly, so a fixture
 * that stopped being a legal chart -- a row edited out of order, a duplicated
 * value -- fails here with the reason rather than somewhere downstream as a lookup
 * that quietly returns the wrong neighbours.
 */
export function inventedChart(): ConversionChart {
  const result = ConversionChart.from(INVENTED_CHART_DATA);
  if (!result.ok) {
    throw new Error(
      `The invented chart is not a legal chart: ${result.problems.map((p) => p.code).join(', ')}.`,
    );
  }
  return result.chart;
}
