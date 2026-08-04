// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { TEXT_FIELD_CHANGE_EVENT, type PtkTextField } from './ptk-text-field.js';
import './ptk-text-field.js';
// The layout assertions measure real pixels against tokens. Without the
// stylesheet the custom properties are undefined, the declarations referencing
// them are dropped, and a test written to catch a field that is too small or too
// small-typed instead measures one with no floor at all.
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(properties: Partial<PtkTextField> = {}): Promise<PtkTextField> {
  const element = document.createElement('ptk-text-field');
  element.label = 'Lifter';
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function box(element: PtkTextField): HTMLInputElement {
  const field = element.shadowRoot?.querySelector('input');
  if (!(field instanceof HTMLInputElement)) {
    throw new Error('The element rendered no input.');
  }
  return field;
}

/** Types into the field the way a visitor does, event and all. */
function type(element: PtkTextField, text: string): void {
  const field = box(element);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Repeated from `tokens.css`, so a change to either fails here. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page on focus and the layout jumps. */
const MINIMUM_FONT_SIZE = 16;

describe('ptk-text-field', () => {
  it('names the field with its label', async () => {
    // Through a real `<label for>`, so the accessible name is the browser's
    // rather than an `aria-label` that has to be kept in step with the text.
    const element = await mount();
    const field = box(element);

    expect(element.shadowRoot?.querySelector('label')?.getAttribute('for')).toBe(field.id);
    expect(element.shadowRoot?.querySelector('label')?.textContent.trim()).toBe('Lifter');
  });

  it('re-renders when a property changes', async () => {
    // The one test that still passes with Lit's decorators misconfigured is the
    // one that never changes a property after the first render.
    const element = await mount();

    element.label = 'Who is lifting';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('Who is lifting');
  });

  it('shows the value it was given, including one set after first render', async () => {
    const element = await mount({ value: 'Dana Okafor' });
    expect(box(element).value).toBe('Dana Okafor');

    element.value = 'Sam Whitlock';
    await element.updateComplete;
    expect(box(element).value).toBe('Sam Whitlock');
  });

  it('reports what the visitor typed, verbatim', async () => {
    // Untrimmed, because a tool that wants to know whether anything was written
    // cannot ask that of text this element quietly cleaned up first.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(TEXT_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    type(element, '  Dana Okafor  ');

    expect(heard).toEqual(['  Dana Okafor  ']);
    expect(element.value).toBe('  Dana Okafor  ');
  });

  it('cannot be made to hold a second line', async () => {
    // The whole reason this is not `ptk-text-area` with `rows="1"`. A one-row
    // textarea looks the same and accepts a newline from a paste or an Enter
    // press, so a caller told it had one line gets two -- and finds out when the
    // value reaches something that renders it. An input's value sanitisation
    // strips the newline before anything else sees it.
    const element = await mount();

    type(element, 'Dana\nOkafor');

    expect(element.value).toBe('DanaOkafor');
  });

  it('lets the event out of the shadow root', async () => {
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.body.addEventListener(TEXT_FIELD_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TEXT_FIELD_CHANGE_EVENT, listener);
    });

    type(element, 'Dana Okafor');

    expect(heardOnDocument).toBe(1);
  });

  it('does not report the same text twice', async () => {
    // An input fires `input` for things that do not change the text -- an IME
    // composition committing what was already there is the common one -- and a
    // caller that appended each report would get it twice from one keystroke it
    // never saw.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(TEXT_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    type(element, 'Dana Okafor');
    type(element, 'Dana Okafor');

    expect(heard).toEqual(['Dana Okafor']);
  });

  it('does not announce a programmatic change as something the visitor typed', async () => {
    // A tool that clears the field after using the value would otherwise hear
    // its own write back as input and loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(TEXT_FIELD_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = 'Cleared';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('keeps what the visitor typed when the caller re-renders', async () => {
    // The failure this guards is subtle and total, and this element is headed
    // for a screen that repaints four times a second off a clock: if it did not
    // adopt the typed value before dispatching, the next render would set the
    // stale property back and delete the keystroke.
    const element = await mount();

    type(element, 'Dana Oka');
    element.hint = 'As it appears on the roster.';
    await element.updateComplete;

    expect(box(element).value).toBe('Dana Oka');
  });

  it('capitalises each word when asked to, and only when asked', async () => {
    // A person's name wants every word capitalised; the default sentence case
    // would put "Dana okafor" on the panel that exists to name the right
    // athlete. Asserted as a difference between the two states rather than
    // against one expected string, so pinning the attribute to one value cannot
    // pass it.
    const byDefault = await mount();
    const forAName = await mount({ capitalize: 'words' });

    expect(box(byDefault).getAttribute('autocapitalize')).toBe('sentences');
    expect(box(forAName).getAttribute('autocapitalize')).toBe('words');
  });

  it('offers the browser nothing to fill in unless the caller says otherwise', async () => {
    // Nothing here is a sign-in or an address, so a saved value offered by the
    // browser is nearly always being offered to the wrong box.
    const closed = await mount();
    const opened = await mount({ autocomplete: 'name' });

    expect(box(closed).getAttribute('autocomplete')).toBe('off');
    expect(box(opened).getAttribute('autocomplete')).toBe('name');
  });

  it('references only descriptions it actually rendered', async () => {
    // A dangling `aria-describedby` is dropped by some screen readers and read
    // out as a raw id by others.
    const element = await mount({ hint: '', error: '' });

    expect(box(element).hasAttribute('aria-describedby')).toBe(false);
  });

  it('describes the field with its hint', async () => {
    const element = await mount({ hint: 'Nothing here leaves your device.' });
    const described = (box(element).getAttribute('aria-describedby') ?? '').split(' ');

    expect(described).toContain(element.shadowRoot?.querySelector('.hint')?.id);
  });

  it('marks itself invalid and describes why', async () => {
    const element = await mount({ error: 'A lifter needs a name.' });
    const field = box(element);

    expect(field.getAttribute('aria-invalid')).toBe('true');
    const described = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain(element.shadowRoot?.querySelector('.error')?.id);
    expect(element.shadowRoot?.textContent).toContain('A lifter needs a name.');
  });

  it('is valid again once the error is cleared', async () => {
    const element = await mount({ error: 'A lifter needs a name.' });

    element.error = '';
    await element.updateComplete;

    expect(box(element).getAttribute('aria-invalid')).toBe('false');
    expect(element.shadowRoot?.querySelector('.error')).toBeNull();
  });

  it('does not announce validation as it is typed', async () => {
    // Validation runs on every keystroke, so a live region would announce a
    // half-written name as an error on each one.
    const element = await mount({ error: 'A lifter needs a name.' });

    expect(element.shadowRoot?.querySelector('[role="alert"], [aria-live]')).toBeNull();
  });

  it('refuses input while disabled', async () => {
    const element = await mount({ disabled: true });

    expect(box(element).matches(':disabled')).toBe(true);
  });

  it('escapes text rather than rendering it as markup', async () => {
    const element = await mount({ hint: '<img src=x onerror="throw new Error()">' });

    expect(element.shadowRoot?.querySelector('img')).toBeNull();
    expect(element.shadowRoot?.textContent).toContain('<img src=x');
  });

  it('has no detectable accessibility violations', async () => {
    const element = await mount({ hint: 'As it appears on the roster.', value: 'Dana Okafor' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has none while showing an error either', async () => {
    const element = await mount({ error: 'A lifter needs a name.' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    async function mountAtWidth(
      width: number,
      properties: Partial<PtkTextField> = {},
    ): Promise<{
      element: PtkTextField;
      frame: HTMLDivElement;
    }> {
      const frame = document.createElement('div');
      frame.style.width = `${String(width)}px`;
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = document.createElement('ptk-text-field');
      element.label = 'Lifter';
      Object.assign(element, properties);
      frame.append(element);
      await element.updateComplete;
      return { element, frame };
    }

    it('gives the field a target a thumb can hit', async () => {
      const { element } = await mountAtWidth(320);

      expect(box(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(TAP_TARGET_MIN);
    });

    it('sets type large enough that focusing it does not zoom the page', async () => {
      // Under 16px, iOS Safari zooms on focus and the layout jumps under the
      // thumb that just tapped. Measured rather than read off the stylesheet,
      // because the value is a rem and a host page may have shrunk the root.
      const { element } = await mountAtWidth(320);

      const size = Number.parseFloat(getComputedStyle(box(element)).fontSize);
      expect(size).toBeGreaterThanOrEqual(MINIMUM_FONT_SIZE);
    });

    it('does not push its column sideways', async () => {
      // The box-sizing test in disguise, and the reason the declaration is
      // repeated inside the shadow root: tokens.css sets it on a universal
      // selector, which does not cross a shadow boundary, so a hundred-percent
      // width plus padding is wider than the column it was told to fill.
      const { frame } = await mountAtWidth(320);

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });

    it('does not widen its column when the value is one long unbroken word', async () => {
      const { element, frame } = await mountAtWidth(320);

      element.value = 'x'.repeat(400);
      await element.updateComplete;

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
