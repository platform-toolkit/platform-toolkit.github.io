// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { TEXT_AREA_CHANGE_EVENT, type PtkTextArea } from './ptk-text-area.js';
import './ptk-text-area.js';
// The layout assertions measure real pixels against tokens. Without the
// stylesheet the custom properties are undefined, the declarations referencing
// them are dropped, and a test written to catch a box that is too small or too
// small-typed instead measures one with no floor at all.
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(properties: Partial<PtkTextArea> = {}): Promise<PtkTextArea> {
  const element = document.createElement('ptk-text-area');
  element.label = 'Notes';
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function box(element: PtkTextArea): HTMLTextAreaElement {
  const field = element.shadowRoot?.querySelector('textarea');
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('The element rendered no textarea.');
  }
  return field;
}

/** Types into the box the way a visitor does, event and all. */
function type(element: PtkTextArea, text: string): void {
  const field = box(element);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Repeated from `tokens.css`, so a change to either fails here. */
const TAP_TARGET_MIN = 44;

/** Below this, iOS Safari zooms the page on focus and the layout jumps. */
const MINIMUM_FONT_SIZE = 16;

describe('ptk-text-area', () => {
  it('names the box with its label', async () => {
    // Through a real `<label for>`, so the accessible name is the browser's
    // rather than an `aria-label` that has to be kept in step with the text.
    const element = await mount();
    const field = box(element);

    expect(element.shadowRoot?.querySelector('label')?.getAttribute('for')).toBe(field.id);
    expect(element.shadowRoot?.querySelector('label')?.textContent.trim()).toBe('Notes');
  });

  it('adds no aria-label when it was given no fuller name', async () => {
    // The default has to be nothing at all rather than the empty string: an
    // `aria-label=""` is ignored by some screen readers and read as an unnamed
    // control by others, and either way the `<label for>` above stops being
    // what names the box.
    expect(box(await mount()).hasAttribute('aria-label')).toBe(false);
  });

  it('announces the fuller name while still showing the short one', async () => {
    // The point of the property: eight of these on a page can read "Note" to
    // the eye and name their own lift to the ear. Both halves are asserted,
    // because a fix that replaced the visible label would pass on the first.
    const element = await mount({ accessibleName: 'Note, Back squat' });

    expect(box(element).getAttribute('aria-label')).toBe('Note, Back squat');
    expect(element.shadowRoot?.querySelector('label')?.textContent.trim()).toBe('Notes');
  });

  it('re-renders when a property changes', async () => {
    // The one test that still passes with Lit's decorators misconfigured is the
    // one that never changes a property after the first render.
    const element = await mount();

    element.label = 'What the referees said';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('What the referees said');
  });

  it('shows the value it was given, including one set after first render', async () => {
    const element = await mount({ value: 'Depth.' });
    expect(box(element).value).toBe('Depth.');

    element.value = 'Press command came early.';
    await element.updateComplete;
    expect(box(element).value).toBe('Press command came early.');
  });

  it('reports what the visitor typed, verbatim', async () => {
    // Untrimmed, because a tool that wants to know whether anything was written
    // cannot ask that of text this element quietly cleaned up first.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(TEXT_AREA_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    type(element, '  bar drifted forward  ');

    expect(heard).toEqual(['  bar drifted forward  ']);
    expect(element.value).toBe('  bar drifted forward  ');
  });

  it('keeps the newlines a visitor typed', async () => {
    // The whole reason this is not a one-line input. A box that collapsed them
    // would look right until somebody read the note back.
    const element = await mount();

    type(element, 'Left: red\nHead: white\nRight: white');

    expect(element.value).toBe('Left: red\nHead: white\nRight: white');
  });

  it('lets the event out of the shadow root', async () => {
    const element = await mount();
    let heardOnDocument = 0;
    const listener = (): void => {
      heardOnDocument += 1;
    };
    document.body.addEventListener(TEXT_AREA_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TEXT_AREA_CHANGE_EVENT, listener);
    });

    type(element, 'Depth.');

    expect(heardOnDocument).toBe(1);
  });

  it('does not report the same text twice', async () => {
    // A textarea fires `input` for things that do not change the text -- an IME
    // composition committing what was already there is the common one -- and a
    // caller that appends each report to a note would get it twice from one
    // keystroke it never saw.
    const element = await mount();
    const heard: string[] = [];
    element.addEventListener(TEXT_AREA_CHANGE_EVENT, (event) => {
      heard.push(event.detail.value);
    });

    type(element, 'Depth.');
    type(element, 'Depth.');

    expect(heard).toEqual(['Depth.']);
  });

  it('does not announce a programmatic change as something the visitor typed', async () => {
    // A tool that clears the box after recording would otherwise hear its own
    // write back as input and loop.
    const element = await mount();
    let heard = 0;
    element.addEventListener(TEXT_AREA_CHANGE_EVENT, () => {
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

    type(element, 'Slow off the chest');
    element.hint = 'Optional.';
    await element.updateComplete;

    expect(box(element).value).toBe('Slow off the chest');
  });

  it('starts at the height it was asked for', async () => {
    const element = await mount({ rows: 5 });

    expect(box(element).rows).toBe(5);
  });

  it('references only descriptions it actually rendered', async () => {
    // A dangling `aria-describedby` is dropped by some screen readers and read
    // out as a raw id by others.
    const element = await mount({ hint: '', error: '' });

    expect(box(element).hasAttribute('aria-describedby')).toBe(false);
  });

  it('describes the box with its hint', async () => {
    const element = await mount({ hint: 'Optional. Nothing here leaves your device.' });
    const described = (box(element).getAttribute('aria-describedby') ?? '').split(' ');

    expect(described).toContain(element.shadowRoot?.querySelector('.hint')?.id);
  });

  it('marks itself invalid and describes why', async () => {
    const element = await mount({ error: 'Shorten it.' });
    const field = box(element);

    expect(field.getAttribute('aria-invalid')).toBe('true');
    const described = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain(element.shadowRoot?.querySelector('.error')?.id);
    expect(element.shadowRoot?.textContent).toContain('Shorten it.');
  });

  it('is valid again once the error is cleared', async () => {
    const element = await mount({ error: 'Shorten it.' });

    element.error = '';
    await element.updateComplete;

    expect(box(element).getAttribute('aria-invalid')).toBe('false');
    expect(element.shadowRoot?.querySelector('.error')).toBeNull();
  });

  it('does not announce validation as it is typed', async () => {
    // Validation runs on every keystroke, so a live region would announce a
    // half-written sentence as an error on each one.
    const element = await mount({ error: 'Shorten it.' });

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
    const element = await mount({ hint: 'Optional.', value: 'Depth.' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has none while showing an error either', async () => {
    const element = await mount({ error: 'Shorten it.' });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  describe('on a phone-width column', () => {
    async function mountAtWidth(
      width: number,
      properties: Partial<PtkTextArea> = {},
    ): Promise<{
      element: PtkTextArea;
      frame: HTMLDivElement;
    }> {
      const frame = document.createElement('div');
      frame.style.width = `${String(width)}px`;
      document.body.append(frame);
      teardown.push(() => {
        frame.remove();
      });

      const element = document.createElement('ptk-text-area');
      element.label = 'Notes';
      Object.assign(element, properties);
      frame.append(element);
      await element.updateComplete;
      return { element, frame };
    }

    it('gives the shortest box a target a thumb can hit', async () => {
      // At one row, and deliberately: three rows of line-height clear 44px on
      // their own, so a default-height box would pass this whatever the
      // stylesheet said. The `rows: 1` case is the only one the min-height holds
      // up, and it is a case the tool actually uses -- a one-line box for what
      // the referees said sits beside the same button as the paragraph one.
      const { element } = await mountAtWidth(320, { rows: 1 });

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

    it('does not widen its column when the text is one long unbroken word', async () => {
      const { element, frame } = await mountAtWidth(320);

      element.value = 'x'.repeat(400);
      await element.updateComplete;

      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    });
  });
});
