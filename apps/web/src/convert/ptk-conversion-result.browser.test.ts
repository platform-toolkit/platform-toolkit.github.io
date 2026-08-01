/**
 * The rule this element exists for, checked in a real browser.
 *
 * The two-numbers rule is a claim about what is on the screen, and every way of
 * breaking it leaves code that reads correctly: an exact figure promoted into the
 * chart's place when no chart loaded, a neighbour described as the one to take, a
 * midpoint quietly resolved. So the assertions here are about rendered text and
 * about which element carries which class, not about the shape of a return value.
 *
 * A browser rather than a simulation because the copy buttons and the select
 * buttons are custom elements inside this element's shadow root, and whether a
 * click on the native button inside one of them reaches this element's handler is
 * a platform behaviour. Every weight here comes from the invented chart.
 */
import {
  convertAgainstChart,
  enterWeight,
  entryWeight,
  type ConversionAnswer,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { PtkButton } from '@platform-toolkit/ui';
// Without the stylesheet every declaration reading a custom property is dropped,
// so the panel measured below has no padding and the option cards no track
// minimum -- a layout that never ships, passing and failing for the wrong reasons.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { inventedChart } from './chart-fixture.js';
import {
  SELECT_WEIGHT_EVENT,
  type PtkConversionResult,
  type SelectWeightDetail,
} from './ptk-conversion-result.js';
import './ptk-conversion-result.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

const CHART = inventedChart();

/**
 * The answer the tool would compute for a figure typed in one unit.
 *
 * Through `enterWeight`/`entryWeight` rather than an object literal, because that
 * is the path `ptk-converter` takes and a fixture that skipped it could pass on a
 * shape the tool never actually produces.
 */
function answerFor(amount: number, unit: WeightUnit, withChart = true): ConversionAnswer {
  return convertAgainstChart(entryWeight(enterWeight(amount, unit)), withChart ? CHART : null);
}

async function mount(
  answer: ConversionAnswer | null,
  overrides: Partial<PtkConversionResult> = {},
): Promise<PtkConversionResult> {
  const element = document.createElement('ptk-conversion-result');
  element.answer = answer;
  element.chartStatus = 'ready';
  element.chartLabel = CHART.label;
  Object.assign(element, overrides);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Everything the panel says, whitespace collapsed, so an assertion can read it. */
function text(element: PtkConversionResult): string {
  return (element.shadowRoot?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

function options(element: PtkConversionResult): HTMLLIElement[] {
  return [...(element.shadowRoot?.querySelectorAll('li') ?? [])];
}

async function press(element: PtkConversionResult, host: PtkButton): Promise<void> {
  const inner = host.shadowRoot?.querySelector('button');
  if (!(inner instanceof HTMLButtonElement)) throw new Error('No button rendered.');
  inner.click();
  await element.updateComplete;
}

describe('ptk-conversion-result', () => {
  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here,
    // and a real behaviour: the panel is driven entirely by properties the tool
    // resets on every keystroke.
    const element = await mount(null);
    expect(text(element)).toContain('Enter a weight in pounds');

    element.direction = 'kg-to-lb';
    await element.updateComplete;

    expect(text(element)).toContain('Enter a weight in kilograms');
  });

  it('leads with the chart value and keeps the arithmetic secondary', async () => {
    // 100 kg is a published row on the invented chart, so the federation's own
    // 220.5 lb is the answer and the arithmetic's 220.46 lb is a footnote. A
    // panel that led with 220.46 lb would be answering a question about scales.
    const element = await mount(answerFor(100, 'kg'));
    const rendered = text(element);

    expect(rendered).toContain('220.5 lb');
    expect(rendered).toContain(`Official ${CHART.label} chart value`);
    expect(rendered).toContain('Exact mathematical equivalent: 220.46 lb');
    // The order matters as much as the presence: the chart figure has to come
    // first, because a reader takes the first number they see to the platform.
    expect(rendered.indexOf('220.5 lb')).toBeLessThan(rendered.indexOf('Exact mathematical'));
  });

  it('offers both neighbours when a weight falls between two rows, and recommends neither', async () => {
    // 315 lb is three plates a side and sits between the 140 kg and 145 kg rows.
    // Both are shown; the closer one is marked closer and nothing else.
    const element = await mount(answerFor(315, 'lb'));
    const cards = options(element);
    expect(cards).toHaveLength(2);

    const rendered = text(element);
    expect(rendered).toContain('falls between two');
    expect(rendered).toContain('Next weight down');
    expect(rendered).toContain('Next weight up');
    // The words the requirements forbid, checked as words rather than trusted to
    // review: a heavier attempt described as safe is a coaching claim this tool
    // is in no position to make.
    for (const forbidden of ['recommended', 'safe', 'achievable', 'should take']) {
      expect(rendered.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('marks the nearer row and marks neither when the weight is exactly between', async () => {
    const nearer = await mount(answerFor(142, 'kg'));
    // 142 kg is nearer the 140 row than the 145 one, so exactly one card is.
    expect(options(nearer).filter((card) => card.classList.contains('closest'))).toHaveLength(1);
    nearer.remove();

    // 102.5 kg is the exact midpoint of the 100 and 105 rows. Picking one would
    // be choosing somebody's next attempt for them on a rounding rule.
    const tied = await mount(answerFor(102.5, 'kg'));
    expect(options(tied).filter((card) => card.classList.contains('closest'))).toHaveLength(2);
    expect(text(tied)).toContain('Both are exactly the same distance away');
  });

  it('says a weight is off the end of the chart rather than inventing a row for it', async () => {
    const heavy = await mount(answerFor(400, 'kg'));
    expect(text(heavy)).toContain('above the heaviest weight');
    expect(text(heavy)).toContain('Heaviest on the chart');
    expect(options(heavy)).toHaveLength(1);
    heavy.remove();

    const light = await mount(answerFor(20, 'kg'));
    expect(text(light)).toContain('below the lightest weight');
    expect(options(light)).toHaveLength(1);
  });

  it('never promotes the arithmetic into the chart’s place when no chart loaded', async () => {
    // The failure this guards: a read that did not come back leaves the exact
    // figure as the only number on screen, and a lifter reads it as an attempt.
    // Every one of these states shows the arithmetic *and* a sentence saying the
    // chart figure is missing.
    for (const [status, expected] of [
      ['loading', 'Loading the conversion chart'],
      ['unavailable', 'No official conversion chart is published'],
      ['failed', 'could not be loaded'],
      ['ready', 'No official conversion chart is available'],
    ] as const) {
      const element = await mount(answerFor(315, 'lb', false), { chartStatus: status });
      const rendered = text(element);
      expect(rendered).toContain(expected);
      expect(rendered).toContain('Exact mathematical equivalent');
      expect(options(element)).toHaveLength(0);
      element.remove();
    }
  });

  it('tells a failed read apart from a federation that publishes none', async () => {
    // Only one of the two is worth reloading for, and rendering both as an empty
    // space is how somebody reloads a page that will never load.
    const failed = await mount(answerFor(315, 'lb', false), { chartStatus: 'failed' });
    expect(text(failed)).toContain('Reloading may help');
    expect(failed.shadowRoot?.querySelector('ptk-notice')?.getAttribute('tone')).toBe('error');
    failed.remove();

    const none = await mount(answerFor(315, 'lb', false), { chartStatus: 'unavailable' });
    expect(text(none)).not.toContain('Reloading may help');
    // Not an error tone: the read succeeded and there is nothing to retry.
    expect(none.shadowRoot?.querySelector('ptk-notice')?.getAttribute('tone')).toBe('info');
  });

  it('asks the tool to convert a published figure rather than leaving it to be retyped', async () => {
    const element = await mount(answerFor(315, 'lb'));
    const seen: SelectWeightDetail[] = [];
    const listener = (event: CustomEvent<SelectWeightDetail>): void => {
      seen.push(event.detail);
    };
    // On the body, outside the element: the assertion worth making is that the
    // event crossed the shadow boundary at all.
    document.body.addEventListener(SELECT_WEIGHT_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(SELECT_WEIGHT_EVENT, listener);
    });

    const use = element.shadowRoot?.querySelector<PtkButton>('li ptk-button');
    if (use === null || use === undefined) throw new Error('No select button rendered.');
    await press(element, use);

    // The row's *pound* figure, because pounds is what is being typed in. Handing
    // back the kilogram figure would silently reverse the direction.
    expect(seen).toEqual([{ amount: 308.6 }]);
  });

  it('names the federation from the label rather than from a template', async () => {
    // §5.1 applies to wording as well as numbers: a chart label written into the
    // template is still correct the day a second federation ships, and still wrong.
    const element = await mount(answerFor(100, 'kg'), { chartLabel: 'Another Federation' });
    expect(text(element)).toContain('Official Another Federation chart value');
    expect(text(element)).not.toContain(CHART.label);
  });

  it('honours the precision setting on the exact figure only', async () => {
    const element = await mount(answerFor(100, 'kg'), { precision: 4 });
    const rendered = text(element);
    expect(rendered).toContain('Exact mathematical equivalent: 220.4623 lb');
    // The chart figure is a published number and has no precision to choose.
    expect(rendered).toContain('220.5 lb');
  });

  it('has no accessibility violations with both neighbours on screen', async () => {
    const element = await mount(answerFor(315, 'lb'));
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column in its widest state', async () => {
    // Two option cards, each with a heading, a figure, the pair, a select button
    // and a copy button. This is the layout with a real chance of scrolling
    // sideways, and it is the one a lifter reads at a rack.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-conversion-result');
    element.answer = answerFor(315, 'lb');
    element.chartStatus = 'ready';
    element.chartLabel = CHART.label;
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
