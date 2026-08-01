import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DISCLOSURE_TOGGLE_EVENT, type PtkDisclosure } from './ptk-disclosure.js';
import './ptk-disclosure.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
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
