import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { Choice } from './ptk-choice-group.js';
import { SEGMENTED_CHANGE_EVENT, type PtkSegmented } from './ptk-segmented.js';
import './ptk-segmented.js';
// The layout assertions below measure real pixels against a token. Without the
// stylesheet the custom property is undefined, the declaration referencing it is
// dropped, and a test written to catch a segment that is too small would instead
// measure a segment with no floor at all.
import './tokens.css';

/**
 * The four lifts, which is the case this element was built for.
 *
 * Real labels rather than invented ones because the widths are the point: this
 * bar has to hold "Deadlift" beside three shorter words inside a 320px column
 * without scrolling sideways, and a fixture of one-letter labels would prove
 * nothing about that.
 */
const LIFTS: readonly Choice[] = [
  { value: 'squat', label: 'Squat' },
  { value: 'bench', label: 'Bench' },
  { value: 'deadlift', label: 'Deadlift' },
  { value: 'total', label: 'Total' },
];

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(properties: Partial<PtkSegmented> = {}): Promise<PtkSegmented> {
  const element = document.createElement('ptk-segmented');
  element.label = 'Lift';
  element.choices = LIFTS;
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Mounts the bar inside a fixed-width column, the way a phone presents one. */
async function mountAtWidth(
  width: number,
  properties: Partial<PtkSegmented> = {},
): Promise<{ element: PtkSegmented; frame: HTMLDivElement }> {
  const frame = document.createElement('div');
  frame.style.width = `${String(width)}px`;
  document.body.append(frame);
  teardown.push(() => {
    frame.remove();
  });

  const element = document.createElement('ptk-segmented');
  element.label = 'Lift';
  element.choices = LIFTS;
  Object.assign(element, properties);
  frame.append(element);
  await element.updateComplete;
  return { element, frame };
}

function radios(element: PtkSegmented): HTMLInputElement[] {
  return [...(element.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [])].filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement,
  );
}

function segments(element: PtkSegmented): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll('.segment') ?? [])].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

/** The narrowest phone still in production use, and narrower than most embeds. */
const NARROW_WIDTH = 320;

/**
 * The floor the report asks for in the gym flow, which is above the 44px token.
 *
 * Repeated here rather than read from the stylesheet: the number is a decision,
 * and a test that read the same declaration the component sets would pass
 * whatever that declaration said.
 */
const GYM_TAP_TARGET_MIN = 48;

describe('ptk-segmented', () => {
  it('renders one radio per choice, with its label', async () => {
    const element = await mount();

    expect(radios(element)).toHaveLength(4);
    expect(element.shadowRoot?.textContent).toContain('Deadlift');
  });

  it('names the group with the question, using a legend', async () => {
    const element = await mount();

    expect(element.shadowRoot?.querySelector('legend')?.textContent.trim()).toBe('Lift');
  });

  it('keeps the legend in the accessibility tree when it is hidden from sight', async () => {
    // `hide-label` is for the case where a heading beside the bar already says
    // it. Dropping the legend instead would leave a screen reader announcing
    // "Squat, radio button, 1 of 4" with nothing saying what the four are.
    const element = await mount({ hideLabel: true });

    const legend = element.shadowRoot?.querySelector('legend');
    expect(legend?.textContent.trim()).toBe('Lift');
    expect(legend?.classList.contains('hidden')).toBe(true);
    // Clipped, not removed from the layout: a zero-size or display-none legend
    // is dropped by some engines' accessibility trees along with the name.
    expect(legend?.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it('checks the radio matching the value', async () => {
    const element = await mount({ value: 'deadlift' });

    expect(radios(element).map((radio) => radio.checked)).toEqual([false, false, true, false]);
  });

  it('checks nothing when the value is not one of the choices', async () => {
    const element = await mount({ value: 'clean-and-jerk' });

    expect(radios(element).some((radio) => radio.checked)).toBe(false);
  });

  it('re-renders when a property changes', async () => {
    const element = await mount();

    element.value = 'bench';
    await element.updateComplete;

    expect(radios(element)[1]?.checked).toBe(true);
  });

  it('reports a choice the visitor makes', async () => {
    const element = await mount({ value: 'squat' });
    const heard: string[] = [];
    element.addEventListener(SEGMENTED_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    radios(element)[2]?.click();

    expect(heard).toEqual(['deadlift']);
    expect(element.value).toBe('deadlift');
  });

  it('lets the event out of the shadow root', async () => {
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.addEventListener(SEGMENTED_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.removeEventListener(SEGMENTED_CHANGE_EVENT, listener);
    });

    radios(element)[0]?.click();

    expect(heardOnDocument).toBe(1);
  });

  it('does not announce a programmatic change as a visitor choice', async () => {
    const element = await mount();
    let heard = 0;
    element.addEventListener(SEGMENTED_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = 'total';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('says so when there is nothing to choose from', async () => {
    const element = await mount({ choices: [], emptyMessage: 'No lifts are published.' });

    expect(radios(element)).toHaveLength(0);
    expect(element.shadowRoot?.textContent).toContain('No lifts are published.');
  });

  it('disables every segment at once, through the fieldset', async () => {
    const element = await mount({ disabled: true });

    const inputs = radios(element);
    expect(inputs).toHaveLength(4);
    expect(inputs.every((radio) => radio.matches(':disabled'))).toBe(true);
  });

  it('escapes text rather than rendering it as markup', async () => {
    const element = await mount({
      choices: [{ value: 'x', label: '<img src=x onerror="throw new Error()">' }],
    });

    expect(element.shadowRoot?.querySelector('img')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('<img src=x');
  });

  it('marks the chosen segment by weight as well as by fill', async () => {
    // Fill alone is discarded under forced colours and invisible to a reader who
    // cannot separate the hues, and which lift is on screen is the most
    // consequential thing this bar says.
    const element = await mount({ value: 'bench' });

    const weights = segments(element).map((segment) => getComputedStyle(segment).fontWeight);
    expect(weights[1]).toBe('700');
    expect(weights[0]).not.toBe('700');
  });

  it('has no detectable accessibility violations', async () => {
    const element = await mount({ value: 'squat' });

    const results = await axe.run(element, {
      // Contrast is a property of the tokens against the page background, which
      // this element does not control. It belongs in the pass over the built site.
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    it('gives every segment a target a thumb can hit', async () => {
      const { element } = await mountAtWidth(NARROW_WIDTH);

      const heights = segments(element).map((segment) => segment.getBoundingClientRect().height);
      expect(heights).toHaveLength(4);
      for (const height of heights) {
        expect(height).toBeGreaterThanOrEqual(GYM_TAP_TARGET_MIN);
      }
    });

    it('wraps rather than scrolling sideways', async () => {
      // The failure this guards is the standard one for a tab strip: the last
      // option is off the right edge, and at a rack the option a lifter wants is
      // as often the last as the first.
      const { element, frame } = await mountAtWidth(NARROW_WIDTH);

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
      const rows = new Set(
        segments(element).map((segment) => Math.round(segment.getBoundingClientRect().top)),
      );
      expect(rows.size).toBeGreaterThan(1);
    });

    it('puts them all on one row when there is room', async () => {
      // The same element and the same options in a wider column. If this ever
      // matched the narrow case the layout has been pinned to something other
      // than this element's own width.
      const { element } = await mountAtWidth(720);

      const rows = new Set(
        segments(element).map((segment) => Math.round(segment.getBoundingClientRect().top)),
      );
      expect(rows.size).toBe(1);
    });

    it('wraps a label too long for its column instead of widening it', async () => {
      const { frame } = await mountAtWidth(NARROW_WIDTH, {
        choices: [{ value: 'long', label: 'Classification standards and qualifying totals' }],
      });

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
