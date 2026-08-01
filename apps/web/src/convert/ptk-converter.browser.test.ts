/**
 * The tool as a whole: one field, four children, and the wiring between them.
 *
 * What is worth testing here is only what composition adds. The result panel's
 * two-numbers rule, the chart's refusal to generate a row and the landmark
 * sections's neighbours are each checked against their own element; repeating
 * them through the root would make one change break a dozen assertions in four
 * files and say nothing new. So this file is about the seams: a keystroke
 * reaching the domain, a reversal that converts rather than reinterprets, a
 * published figure travelling back up from the result panel into the field, and
 * the state of the chart read reaching every child that has to say something
 * different because of it.
 *
 * A browser, because every one of those seams is a composed event crossing a
 * shadow boundary, and that is a platform behaviour rather than a function call.
 */
import { createPreferenceStore, memoryPreferenceStorage } from '@platform-toolkit/preferences';
import { PtkButton, PtkNumberField } from '@platform-toolkit/ui';
// Sizes are measured below and every rule that sets one reads a custom property.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { INVENTED_CHART_DATA, inventedChart } from './chart-fixture.js';
import type { ChartStatus } from './session.js';
import { PtkConversionResult } from './ptk-conversion-result.js';
import type { PtkConverter } from './ptk-converter.js';
import './ptk-converter.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

const CHART = inventedChart();

interface Options {
  readonly withChart?: boolean;
  readonly chartStatus?: ChartStatus;
  readonly settings?: PtkConverter['settings'];
}

async function mount(options: Options = {}): Promise<PtkConverter> {
  const element = document.createElement('ptk-converter');
  element.chart = options.withChart === false ? null : CHART;
  element.chartStatus = options.chartStatus ?? 'ready';
  if (options.settings !== undefined) element.settings = options.settings;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * The one element matching, or a failure naming the selector.
 *
 * Deliberately not generic, following the convention tool 2 set: `querySelector<T>`
 * is a type assertion wearing a function's clothes -- it hands back whatever the
 * caller named on the strength of a string, so a selector typo produces a
 * disclosure typed as a number field and the failure lands three lines later as a
 * missing method. The helpers below narrow with `instanceof` against the real
 * class, which is a claim the runtime can refuse.
 */
function requireIn(root: ParentNode | null | undefined, selector: string): Element {
  const found = root?.querySelector(selector) ?? null;
  if (found === null) throw new Error(`Nothing rendered for "${selector}".`);
  return found;
}

function weightField(element: PtkConverter): PtkNumberField {
  const found = requireIn(element.shadowRoot, 'ptk-number-field[data-field="weight"]');
  if (!(found instanceof PtkNumberField))
    throw new Error('The weight field is not a number field.');
  return found;
}

function nativeInput(host: Element): HTMLInputElement {
  const found = host.shadowRoot?.querySelector('input');
  if (!(found instanceof HTMLInputElement)) throw new Error('No input rendered.');
  return found;
}

/** Types the way a visitor does, through the real input inside the field. */
async function type(element: PtkConverter, text: string): Promise<void> {
  const field = weightField(element);
  await field.updateComplete;
  const input = nativeInput(field);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Presses a `ptk-button` through the native button inside its shadow root. */
async function press(element: PtkConverter, host: PtkButton): Promise<void> {
  await host.updateComplete;
  const inner = host.shadowRoot?.querySelector('button');
  if (!(inner instanceof HTMLButtonElement)) throw new Error('No button rendered.');
  inner.click();
  await element.updateComplete;
}

function actionNamed(element: PtkConverter, startsWith: string): PtkButton {
  const buttons = [...(element.shadowRoot?.querySelectorAll('.actions ptk-button') ?? [])].filter(
    (button): button is PtkButton => button instanceof PtkButton,
  );
  const found = buttons.find((button) =>
    (button.getAttribute('accessible-name') ?? '').startsWith(startsWith),
  );
  if (found === undefined) throw new Error(`No action named "${startsWith}".`);
  return found;
}

function result(element: PtkConverter): PtkConversionResult {
  const found = requireIn(element.shadowRoot, 'ptk-conversion-result');
  if (!(found instanceof PtkConversionResult)) throw new Error('The answer is not a result panel.');
  return found;
}

/** The first select action inside the answer, which is the row below the entry. */
function firstOption(element: PtkConverter): PtkButton {
  const found = requireIn(result(element).shadowRoot, 'li ptk-button');
  if (!(found instanceof PtkButton)) throw new Error('The option action is not a button.');
  return found;
}

/** What is actually in the field, read off the native input rather than a property. */
function fieldValue(element: PtkConverter): string {
  return nativeInput(weightField(element)).value;
}

describe('ptk-converter', () => {
  it('re-renders when a property changes after first render', async () => {
    const element = await mount();
    expect(deepText(element)).toContain(CHART.label);

    element.chart = null;
    await element.updateComplete;

    expect(deepText(element)).not.toContain(CHART.label);
  });

  it('starts with an empty field and an example rather than an error', async () => {
    const element = await mount();
    expect(fieldValue(element)).toBe('');
    expect(deepText(result(element))).toContain('Enter a weight in pounds');
    // No Clear on an already-empty field: a control that does nothing is a
    // control somebody presses to find out what it does.
    expect(element.shadowRoot?.querySelectorAll('.actions ptk-button')).toHaveLength(1);
  });

  it('carries a keystroke through to the published chart', async () => {
    const element = await mount();
    await type(element, '315');

    const answer = deepText(result(element));
    expect(answer).toContain('falls between two');
    expect(answer).toContain('140 kg');
    expect(answer).toContain('145 kg');
  });

  it('keeps what was typed even when it does not parse, and says what is wrong', async () => {
    const element = await mount();
    await type(element, '1o5');

    // The field must show what was typed -- a visitor cannot correct a character
    // the tool has silently eaten -- and the result goes back to its empty state
    // rather than answering for the last thing that did parse.
    expect(fieldValue(element)).toBe('1o5');
    expect(deepText(weightField(element))).toContain('Enter a weight using digits');
    expect(deepText(result(element))).toContain('Enter a weight in pounds');
  });

  it('converts the value on a reversal instead of rereading the same number', async () => {
    // 315 lb reversed is 142.88 kg. Reading it as 315 kg is a hundred and fifty
    // kilograms of difference with nothing on screen to indicate it.
    const element = await mount();
    await type(element, '315');
    await press(element, actionNamed(element, 'Reverse'));

    expect(fieldValue(element)).toBe('142.88');
    expect(deepText(weightField(element))).toContain('Weight in kilograms');
  });

  it('does not drift when the direction is flicked back and forth', async () => {
    const element = await mount();
    await type(element, '315');
    for (let index = 0; index < 6; index += 1) {
      await press(element, actionNamed(element, 'Reverse'));
    }

    // Six reversals is back where it started, exactly -- not 314.99. Every
    // display is derived from the origin rather than from the previous display,
    // which is the whole reason `EnteredWeight` exists.
    expect(fieldValue(element)).toBe('315');
  });

  it('reads a unit suffix as the visitor telling it which unit they meant', async () => {
    const element = await mount();
    await type(element, '100 kg');

    // Typing `100 kg` while converting pounds is not a request to convert 100
    // pounds. The direction follows what was said.
    expect(deepText(weightField(element))).toContain('Weight in kilograms');
    expect(deepText(result(element))).toContain('220.5 lb');
  });

  it('puts a published figure in the field when one is chosen from the answer', async () => {
    const element = await mount();
    await type(element, '315');

    // The first option is the row below, 140 kg / 308.6 lb. Choosing it is the
    // alternative to retyping a number off the screen, where a transposed digit
    // is a different attempt.
    await press(element, firstOption(element));

    expect(fieldValue(element)).toBe('308.6');
    // And the answer that follows is an exact match, which is the point of
    // handing back the row's own figure in the entered unit.
    expect(deepText(result(element))).toContain('Exact Example Federation chart match');
  });

  it('offers Clear only when there is something to clear', async () => {
    const element = await mount();
    await type(element, '315');
    expect(element.shadowRoot?.querySelectorAll('.actions ptk-button')).toHaveLength(2);

    await press(element, actionNamed(element, 'Clear'));

    expect(fieldValue(element)).toBe('');
    expect(element.shadowRoot?.querySelectorAll('.actions ptk-button')).toHaveLength(1);
  });

  it('names the chart answering, and its revision, whenever there is one', async () => {
    const element = await mount();
    expect(deepText(element)).toContain(
      `Chart weights come from the ${CHART.label} conversion chart, revision ${INVENTED_CHART_DATA.source.revision}.`,
    );
  });

  it('tells every child how the chart read went', async () => {
    // One property, four children, three of which have to say something
    // different because of it. The failure this prevents is a page where the
    // answer says the chart failed and the chart below it silently shows nothing.
    const element = await mount({ withChart: false, chartStatus: 'failed' });
    await type(element, '315');

    expect(deepText(result(element))).toContain('could not be loaded');
    expect(deepText(requireIn(element.shadowRoot, 'ptk-milestone-chart'))).toContain(
      'could not be loaded',
    );
    expect(deepText(requireIn(element.shadowRoot, 'ptk-conversion-table'))).toContain(
      'No published chart is available.',
    );
    // And with no chart to name, no claim about one.
    expect(deepText(element)).not.toContain('Chart weights come from');
  });

  it('remembers the field across a reload, in the unit it is being read in', async () => {
    const settings = createPreferenceStore(memoryPreferenceStorage());
    const first = await mount({ settings });
    await type(first, '315');
    await press(first, actionNamed(first, 'Reverse'));
    first.remove();

    // A second element on the same storage is what a reload is. The stored value
    // keeps the origin *and* the unit it is shown in, so this comes back as the
    // kilogram reading of a pound entry rather than as 315 kg or as a re-rounded
    // 142.88 that has already started drifting.
    const second = await mount({ settings });

    expect(fieldValue(second)).toBe('142.88');
    expect(deepText(weightField(second))).toContain('Weight in kilograms');
    await press(second, actionNamed(second, 'Reverse'));
    expect(fieldValue(second)).toBe('315');
  });

  it('works with no storage at all, which is the configuration it ships into', async () => {
    // An embedder that blocked storage is the common case for these tools, and
    // `localStorage` throws on *property access* there. The default store has no
    // backing for exactly that reason, so this is the no-argument path.
    const element = await mount();
    await type(element, '315');

    expect(fieldValue(element)).toBe('315');
    expect(deepText(result(element))).toContain('falls between two');
  });

  it('has no accessibility violations with an answer on screen', async () => {
    const element = await mount();
    await type(element, '315');
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with the whole tool answering', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-converter');
    element.chart = CHART;
    element.chartStatus = 'ready';
    frame.append(element);
    await element.updateComplete;
    await type(element, '315');

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
