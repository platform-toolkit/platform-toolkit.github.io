// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { PtkNotice } from './ptk-notice.js';
import './ptk-notice.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

function mount(tone: PtkNotice['tone'] | undefined, text: string): PtkNotice {
  const element = document.createElement('ptk-notice');
  if (tone !== undefined) {
    element.tone = tone;
  }
  element.textContent = text;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function paragraph(element: PtkNotice): HTMLParagraphElement {
  const found = element.shadowRoot?.querySelector('p');
  if (!(found instanceof HTMLParagraphElement)) {
    throw new Error('The notice rendered no paragraph.');
  }
  return found;
}

describe('ptk-notice', () => {
  it('shows what it was given', async () => {
    const element = mount(undefined, 'Loading this federation’s categories…');
    await element.updateComplete;

    expect(element.textContent).toBe('Loading this federation’s categories…');
  });

  it('re-renders when the tone changes after first render', async () => {
    // The canary for Lit's decorator configuration. With it misconfigured the
    // element renders once and then ignores every property set, which every
    // other test in this file would still pass.
    const element = mount(undefined, 'Still loading…');
    await element.updateComplete;
    // The default reflects too. With `useDefineForClassFields: false` the class
    // field assignment runs through the generated accessor, so Lit sees it as a
    // change like any other -- which is worth pinning, because the same code
    // under the other setting would leave the attribute absent.
    expect(element.getAttribute('tone')).toBe('info');

    element.tone = 'error';
    await element.updateComplete;

    expect(element.getAttribute('tone')).toBe('error');
  });

  it('reflects the tone, because the styling selects on the attribute', async () => {
    // Not a restatement of the test above: this is the reason `reflect` is on,
    // and dropping it would leave the error styling silently never applied --
    // with the property still reading back `error`, so nothing else would fail.
    const element = mount('error', 'The published categories could not be loaded.');
    await element.updateComplete;

    expect(element.matches('[tone="error"]')).toBe(true);
  });

  it('marks an error with more than a colour', async () => {
    // Colour alone fails a reader who cannot separate the two hues and fails
    // again under forced colours, where the author's colours are discarded
    // entirely. The border is what survives both.
    const error = mount('error', 'The published categories could not be loaded.');
    const info = mount(undefined, 'Loading…');
    await Promise.all([error.updateComplete, info.updateComplete]);

    const errorStyle = getComputedStyle(paragraph(error));
    const infoStyle = getComputedStyle(paragraph(info));

    expect(errorStyle.color).not.toBe(infoStyle.color);
    expect(parseFloat(errorStyle.borderInlineStartWidth)).toBeGreaterThan(0);
    expect(parseFloat(infoStyle.borderInlineStartWidth)).toBe(0);
  });

  it('is not a live region', async () => {
    // Deliberate. Whether an announcement is right depends on what the notice
    // replaced and whether this element survived the swap, and only the tool
    // knows either. A role baked in here would announce in some tools and not
    // others with nothing to indicate which.
    const element = mount('error', 'The published categories could not be loaded.');
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('[role]')).toBe(null);
    expect(element.shadowRoot?.querySelector('[aria-live]')).toBe(null);
  });

  it('renders text, not markup', async () => {
    // A notice is the one thing on screen when a read fails, and a failure
    // message is the likeliest place for text that came from somewhere else.
    const element = mount(undefined, '<img src=x onerror="alert(1)">');
    await element.updateComplete;

    expect(element.querySelector('img')).toBe(null);
    expect(element.textContent).toContain('<img');
  });

  it.each(['info', 'error'] as const)('has no accessibility violations as %s', async (tone) => {
    // `color-contrast` is off for the same reason as everywhere else: it depends
    // on the page background this element does not control.
    const element = mount(tone, 'The published categories could not be loaded.');
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('wraps rather than scrolling sideways in a phone-width column', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-notice');
    element.tone = 'error';
    element.textContent =
      'The published classification standards could not be loaded. Reload the page to try again.';
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
