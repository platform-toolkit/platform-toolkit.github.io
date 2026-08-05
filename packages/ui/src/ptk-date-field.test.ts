// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DATE_FIELD_CHANGE_EVENT, type PtkDateField } from './ptk-date-field.js';
import './ptk-date-field.js';
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

async function mount(properties: Partial<PtkDateField> = {}): Promise<PtkDateField> {
  const element = document.createElement('ptk-date-field');
  element.label = 'Date of the meet';
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function box(element: PtkDateField): HTMLInputElement {
  const field = element.shadowRoot?.querySelector('input');
  if (!(field instanceof HTMLInputElement)) {
    throw new Error('The element rendered no input.');
  }
  return field;
}

/** Picks a day the way a visitor does, event and all. */
function pick(element: PtkDateField, day: string): void {
  const field = box(element);
  field.value = day;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Repeated from `tokens.css`, so a change to either fails here. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page on focus and the layout jumps. */
const MINIMUM_FONT_SIZE = 16;

describe('ptk-date-field', () => {
  it('names the field with its label', async () => {
    // Through a real `<label for>`, so the accessible name is the browser's
    // rather than an `aria-label` that has to be kept in step with the text.
    const element = await mount();
    const field = box(element);

    expect(element.shadowRoot?.querySelector('label')?.getAttribute('for')).toBe(field.id);
    expect(element.shadowRoot?.querySelector('label')?.textContent.trim()).toBe('Date of the meet');
  });

  it('re-renders when a property changes', async () => {
    // The one test that still passes with Lit's decorators misconfigured is the
    // one that never changes a property after the first render.
    const element = await mount();

    element.label = 'Day it was lifted';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('Day it was lifted');
  });

  it('asks the platform for a date, not for text', async () => {
    // The whole reason this is not `ptk-text-field`. A text box would have every
    // tool writing its own YYYY-MM-DD parser and its own error message, and would
    // never get a phone's date wheel.
    expect(box(await mount()).type).toBe('date');
  });

  it('shows the day it was given, including one set after first render', async () => {
    // Invented days throughout. A real meet date would make a federation moving
    // its calendar look like a regression in this element.
    const element = await mount({ value: '2026-03-14' });
    expect(box(element).value).toBe('2026-03-14');

    element.value = '2026-04-02';
    await element.updateComplete;
    expect(box(element).value).toBe('2026-04-02');
  });

  it('reports the day the visitor picked', async () => {
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(DATE_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    pick(element, '2026-03-14');

    expect(heard).toEqual(['2026-03-14']);
    expect(element.value).toBe('2026-03-14');
  });

  it('reports a cleared field rather than swallowing it', async () => {
    // The browser reports an empty string for a partly-filled control -- a month
    // typed with no year yet -- and a tool watching for the field to be emptied
    // has no other way to hear it.
    const element = await mount({ value: '2026-03-14' });
    const heard: string[] = [];
    element.addEventListener(DATE_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    pick(element, '');

    expect(heard).toEqual(['']);
    expect(element.value).toBe('');
  });

  it('lets the event out of the shadow root', async () => {
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.body.addEventListener(DATE_FIELD_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(DATE_FIELD_CHANGE_EVENT, listener);
    });

    pick(element, '2026-03-14');

    expect(heardOnDocument).toBe(1);
  });

  it('does not report the same day twice', async () => {
    // A date input fires `input` for things that do not change the day, and a
    // caller that appended each report would record two results from one pick.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(DATE_FIELD_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    pick(element, '2026-03-14');
    pick(element, '2026-03-14');

    expect(heard).toEqual(['2026-03-14']);
  });

  it('does not announce a programmatic change as something the visitor picked', async () => {
    // A tool that clears the field after using the value would otherwise hear its
    // own write back as a pick and loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(DATE_FIELD_CHANGE_EVENT, () => {
      heard += 1;
    });

    element.value = '2026-03-14';
    await element.updateComplete;

    expect(heard).toBe(0);
  });

  it('keeps the day the visitor picked when the caller re-renders', async () => {
    // Harder here than on a text field: a date control's own value setter refuses
    // anything that is not a full YYYY-MM-DD, so without the adopt-before-dispatch
    // the stale write does not merely rewind the field, it empties it.
    const element = await mount();

    pick(element, '2026-03-14');
    element.hint = 'The day you competed.';
    await element.updateComplete;

    expect(box(element).value).toBe('2026-03-14');
  });

  it('offers the picker only the days the caller allows', async () => {
    // Handed to the native control so its own calendar greys the rest out, which
    // is worth more than an error message after the fact.
    const element = await mount({ min: '2025-01-01', max: '2026-04-26' });
    const field = box(element);

    expect(field.min).toBe('2025-01-01');
    expect(field.max).toBe('2026-04-26');
  });

  it('sets no bound the caller did not give', async () => {
    // An empty string in `min` is a real attribute value the browser reads as an
    // unparseable floor, which is not the same as no floor.
    const field = box(await mount());

    expect(field.hasAttribute('min')).toBe(false);
    expect(field.hasAttribute('max')).toBe(false);
  });

  it('does not enforce its own bounds against the value it is given', async () => {
    // Deliberate: a rule about which days are acceptable belongs to the tool, and
    // an element that quietly refused a value would leave the caller's state and
    // the screen disagreeing with nothing on screen to say so.
    const element = await mount({ min: '2025-01-01', value: '2024-06-01' });

    expect(box(element).value).toBe('2024-06-01');
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
    const element = await mount({ error: 'A window has to start before it ends.' });
    const field = box(element);

    expect(field.getAttribute('aria-invalid')).toBe('true');
    const described = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain(element.shadowRoot?.querySelector('.error')?.id);
    expect(element.shadowRoot?.textContent).toContain('A window has to start before it ends.');
  });

  it('is valid again once the error is cleared', async () => {
    const element = await mount({ error: 'A window has to start before it ends.' });

    element.error = '';
    await element.updateComplete;

    expect(box(element).getAttribute('aria-invalid')).toBe('false');
    expect(element.shadowRoot?.querySelector('.error')).toBeNull();
  });

  it('does not announce validation as it is picked', async () => {
    // Validation runs on every change, so a live region would announce a
    // half-entered date as an error on each one.
    const element = await mount({ error: 'A window has to start before it ends.' });

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
    const element = await mount({ hint: 'The day you competed.', value: '2026-03-14' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has none while showing an error either', async () => {
    const element = await mount({ error: 'A window has to start before it ends.' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    async function mountAtWidth(
      width: number,
      properties: Partial<PtkDateField> = {},
    ): Promise<{ element: PtkDateField; frame: HTMLDivElement }> {
      const frame = document.createElement('div');
      frame.style.width = `${String(width)}px`;
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = document.createElement('ptk-date-field');
      element.label = 'Date of the meet';
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

    it('fills the column it is given rather than sitting at its intrinsic width', async () => {
      // A date input's intrinsic width is 172px in this browser, which is a short
      // box floating in a phone-width column, so `width: 100%` is what this holds
      // up. It does *not* reach the `appearance: none` beside it: Chromium honours
      // the width without that declaration and iOS Safari does not, and iOS Safari
      // is not what runs here. See the note on those two lines in the component.
      const { element, frame } = await mountAtWidth(320);

      const width = box(element).getBoundingClientRect().width;
      expect(width).toBeGreaterThan(frame.clientWidth * 0.9);
    });

    it('does not push its column sideways', async () => {
      // The box-sizing test in disguise, and the reason the declaration is
      // repeated inside the shadow root: tokens.css sets it on a universal
      // selector, which does not cross a shadow boundary, so a hundred-percent
      // width plus padding is wider than the column it was told to fill.
      const { frame } = await mountAtWidth(320, { value: '2026-03-14' });

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
