// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import { DISCLOSURE_TOGGLE_EVENT, type PtkDisclosure } from './ptk-disclosure.js';
import './ptk-disclosure.js';
import './tokens.css';

/**
 * What `cdp()` actually hands back.
 *
 * The provider ships the method and the published type is an empty interface, so the
 * shape is declared here rather than asserted at the call site -- an assertion would go
 * on compiling the day the signature changes underneath it. Only the one command this
 * file sends is named.
 */
declare module 'vitest/internal/browser' {
  interface CDPSession {
    send: (
      method: 'Emulation.setEmulatedMedia',
      parameters: { features: { name: string; value: string }[] },
    ) => Promise<unknown>;
  }
}

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * Tells the browser this page is being read by somebody who asked for less motion.
 *
 * Through the debugger protocol because there is no other way in: the preference is
 * the operating system's, `matchMedia` is read-only, and a stylesheet the test reads
 * for itself proves the text is present rather than that the engine applies it inside
 * a shadow root -- which is the half that was wrong, and the half a document rule in
 * `tokens.css` cannot fix.
 */
async function preferMotion(value: 'reduce' | 'no-preference'): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
}

// Page-wide and outlives the test that set it, so every case after a reduced-motion
// one would otherwise measure a preference it never asked for.
afterEach(async () => {
  await preferMotion('no-preference');
});

function mount(parent: HTMLElement = document.body): PtkDisclosure {
  const element = document.createElement('ptk-disclosure');
  element.label = 'Equipment';
  element.summary = 'kg plates • 20 kg bar • no collar weight';
  const content = document.createElement('p');
  content.textContent = 'Plate settings live here.';
  element.append(content);
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function details(element: PtkDisclosure): HTMLDetailsElement {
  const found = element.shadowRoot?.querySelector('details');
  if (!(found instanceof HTMLDetailsElement)) {
    throw new Error('The disclosure rendered no details element.');
  }
  return found;
}

function chevron(element: PtkDisclosure): HTMLElement {
  const found = element.shadowRoot?.querySelector('.chevron');
  if (!(found instanceof HTMLElement)) {
    throw new Error('The disclosure rendered no chevron.');
  }
  return found;
}

function summaryRow(element: PtkDisclosure): HTMLElement {
  const found = element.shadowRoot?.querySelector('summary');
  if (!(found instanceof HTMLElement)) {
    throw new Error('The disclosure rendered no summary element.');
  }
  return found;
}

/**
 * A turn of the event loop.
 *
 * The native `toggle` event is dispatched asynchronously, so a test that only
 * awaits `updateComplete` after a click concludes the element is silent when it
 * is merely not finished. That failure looks exactly like the bug -- an element
 * that never reports -- so the wait is spelled out rather than inlined.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('ptk-disclosure', () => {
  it('wraps native details, so the platform supplies the behaviour', async () => {
    // Expanded state, the announcement, keyboard operation, and find-in-page
    // opening a collapsed section all come free and correct here. Every
    // hand-rolled version of them misses one.
    const element = mount();
    await element.updateComplete;

    expect(details(element).open).toBe(false);
  });

  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here.
    const element = mount();
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain('20 kg bar');

    element.summary = 'lb plates • 45 lb bar • no collar weight';
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('45 lb bar');
  });

  it('keeps the summary on screen while the controls are folded away', async () => {
    // The whole reason the section may fold at all: what a lifter has to check
    // before trusting the numbers below stays visible when the settings do not.
    const element = mount();
    await element.updateComplete;

    expect(summaryRow(element).textContent).toContain('kg plates');
    expect(summaryRow(element).getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it('reports being opened, so a tool can remember it', async () => {
    const element = mount();
    await element.updateComplete;

    const seen: boolean[] = [];
    element.addEventListener(DISCLOSURE_TOGGLE_EVENT, (event) => {
      seen.push(event.detail.open);
    });

    summaryRow(element).click();
    await nextTurn();
    await element.updateComplete;

    expect(seen).toEqual([true]);
    expect(element.open).toBe(true);
  });

  it('says nothing when the tool opens it programmatically', async () => {
    // A caller that re-opened the section on the event would loop, and the
    // event means "the visitor did this" everywhere else in this collection.
    const element = mount();
    await element.updateComplete;

    let fired = 0;
    element.addEventListener(DISCLOSURE_TOGGLE_EVENT, () => {
      fired += 1;
    });

    element.open = true;
    await element.updateComplete;
    await nextTurn();

    expect(fired).toBe(0);
    expect(details(element).open).toBe(true);
  });

  it('offers a tap target a thumb can hit', async () => {
    const element = mount();
    await element.updateComplete;

    expect(summaryRow(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('wraps a long summary instead of widening a phone screen', async () => {
    const frame = document.createElement('div');
    frame.style.width = '288px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    element.summary = 'lb plates • 65 lb safety squat bar • 5 lb collars • nine denominations';
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('stops rotating the chevron for somebody who asked for less motion', async () => {
    // The only animated declaration in either package, and the one thing the
    // reduced-motion block in `tokens.css` cannot reach: a document rule does not
    // cross a shadow boundary, and `transition` is not an inherited property, so
    // nothing carries the preference in here except the query repeated beside the
    // declaration it cancels.
    const element = mount();
    await element.updateComplete;
    expect(getComputedStyle(chevron(element)).transitionDuration).toBe('0.12s');

    await preferMotion('reduce');

    expect(getComputedStyle(chevron(element)).transitionDuration).toBe('0s');
  });

  it('has no accessibility violations, open or closed', async () => {
    const element = mount();
    await element.updateComplete;

    const closed = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(closed.violations.map((violation) => violation.id)).toEqual([]);

    element.open = true;
    await element.updateComplete;

    const opened = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(opened.violations.map((violation) => violation.id)).toEqual([]);
  });
});
