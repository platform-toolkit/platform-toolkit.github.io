import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { NUMBER_FIELD_CHANGE_EVENT, type PtkNumberField } from './ptk-number-field.js';
import './ptk-number-field.js';
// The layout assertions measure real pixels against tokens. Without the
// stylesheet the custom properties are undefined, the declarations referencing
// them are dropped, and a test written to catch a field that is too small or
// too small-typed instead measures one with no floor at all.
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(properties: Partial<PtkNumberField> = {}): Promise<PtkNumberField> {
  const element = document.createElement('ptk-number-field');
  element.label = 'Squat';
  element.unit = 'kg';
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function field(element: PtkNumberField): HTMLInputElement {
  const input = element.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('The field rendered no input.');
  }
  return input;
}

/** Types into the field the way a visitor does, event and all. */
function type(element: PtkNumberField, text: string): void {
  const input = field(element);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Repeated from `tokens.css`, so a change to either fails here. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page on focus and the layout jumps. */
const MINIMUM_FONT_SIZE = 16;

describe('ptk-number-field', () => {
  it('names the field with its label', async () => {
    // Through a real `<label for>`, so the accessible name is the browser's
    // rather than an `aria-label` that has to be kept in step with the text.
    const element = await mount();
    const input = field(element);

    expect(element.shadowRoot?.querySelector('label')?.getAttribute('for')).toBe(input.id);
    expect(element.shadowRoot?.querySelector('label')?.textContent.trim()).toBe('Squat');
  });

  it('asks for the numeric keypad without using a number input', async () => {
    // `type="number"` would take the value away the moment it disagreed with the
    // browser about what a number is, leaving nothing to show the visitor and
    // nothing to say what was wrong with it.
    const input = field(await mount());

    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
  });

  it('re-renders when a property changes', async () => {
    // The one test that still passes with Lit's decorators misconfigured is the
    // one that never changes a property after the first render.
    const element = await mount();

    element.label = 'Bench press';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('Bench press');
  });

  it('shows the value it was given, including one set after first render', async () => {
    const element = await mount({ value: '142.5' });
    expect(field(element).value).toBe('142.5');

    element.value = '150';
    await element.updateComplete;
    expect(field(element).value).toBe('150');
  });

  it('reports what the visitor typed, verbatim', async () => {
    // Verbatim matters: the tool decides what is valid, and it cannot say "that
    // is not a number" about text this element quietly cleaned up first.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(NUMBER_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    type(element, ' 1o5 ');

    expect(heard).toEqual([' 1o5 ']);
    expect(element.value).toBe(' 1o5 ');
  });

  it('lets the event out of the shadow root', async () => {
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.body.addEventListener(NUMBER_FIELD_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, listener);
    });

    type(element, '100');

    expect(heardOnDocument).toBe(1);
  });

  it('does not announce a programmatic change as something the visitor typed', async () => {
    // A tool that clears or restores the field would otherwise hear its own
    // write back as input and loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(NUMBER_FIELD_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = '200';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('keeps what the visitor typed when the caller re-renders', async () => {
    // The failure this guards is subtle and total: if the element did not adopt
    // the typed value before dispatching, the next render would set the stale
    // property back into the field and delete the keystroke.
    const element = await mount();

    type(element, '17');
    element.hint = 'Best competition squat';
    await element.updateComplete;

    expect(field(element).value).toBe('17');
  });

  it('describes the field with its unit rather than renaming it', async () => {
    // "Squat, edit text, kg" and not "Squat kg, edit text". The unit is a fact
    // about the value, not part of the question.
    const element = await mount();
    const input = field(element);
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');

    expect(described).toContain(element.shadowRoot?.querySelector('.unit')?.id);
  });

  it('references only descriptions it actually rendered', async () => {
    // A dangling `aria-describedby` is dropped by some screen readers and read
    // out as a raw id by others.
    const element = await mount({ unit: '', hint: '', error: '' });

    expect(field(element).hasAttribute('aria-describedby')).toBe(false);
  });

  it('marks itself invalid and describes why', async () => {
    const element = await mount({ error: 'Enter a weight in kilograms.' });
    const input = field(element);

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain(element.shadowRoot?.querySelector('.error')?.id);
    expect(element.shadowRoot?.textContent).toContain('Enter a weight in kilograms.');
  });

  it('is valid again once the error is cleared', async () => {
    const element = await mount({ error: 'Enter a weight in kilograms.' });

    element.error = '';
    await element.updateComplete;

    expect(field(element).getAttribute('aria-invalid')).toBe('false');
    expect(element.shadowRoot?.querySelector('.error')).toBeNull();
  });

  it('does not announce validation as it is typed', async () => {
    // Validation runs on every keystroke, so a live region would announce a
    // half-typed number as an error five times while it is being entered.
    // `aria-invalid` plus a description is the quieter, correct pairing.
    const element = await mount({ error: 'Enter a weight above zero.' });

    const live = element.shadowRoot?.querySelector('[role="alert"], [aria-live]');
    expect(live).toBeNull();
  });

  it('refuses input while disabled', async () => {
    const element = await mount({ disabled: true });

    expect(field(element).matches(':disabled')).toBe(true);
  });

  it('escapes text rather than rendering it as markup', async () => {
    const element = await mount({ hint: '<img src=x onerror="throw new Error()">' });

    expect(element.shadowRoot?.querySelector('img')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('<img src=x');
  });

  it('has no detectable accessibility violations', async () => {
    const element = await mount({ hint: 'Best competition squat', value: '142.5' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has none while showing an error either', async () => {
    const element = await mount({ error: 'Enter a weight in kilograms.' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    async function mountAtWidth(width: number): Promise<{
      element: PtkNumberField;
      frame: HTMLDivElement;
    }> {
      const frame = document.createElement('div');
      frame.style.width = `${String(width)}px`;
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = document.createElement('ptk-number-field');
      element.label = 'Total';
      element.unit = 'kg';
      frame.append(element);
      await element.updateComplete;
      return { element, frame };
    }

    it('gives the field a target a thumb can hit', async () => {
      const { element } = await mountAtWidth(320);

      expect(field(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(TAP_TARGET_MIN);
    });

    it('sets type large enough that focusing it does not zoom the page', async () => {
      // Under 16px, iOS Safari zooms on focus and the layout jumps under the
      // thumb that just tapped. Measured rather than read off the stylesheet,
      // because the value is a rem and a host page may have shrunk the root.
      const { element } = await mountAtWidth(320);

      const size = Number.parseFloat(getComputedStyle(field(element)).fontSize);
      expect(size).toBeGreaterThanOrEqual(MINIMUM_FONT_SIZE);
    });

    it('does not push its column sideways', async () => {
      const { frame } = await mountAtWidth(320);

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
