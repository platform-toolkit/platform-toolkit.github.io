import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtkButton } from './ptk-button.js';
import { COPY_EVENT, type PtkCopyButton } from './ptk-copy-button.js';
import './ptk-copy-button.js';
import './tokens.css';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
  vi.useRealTimers();
});

function mount(parent: HTMLElement = document.body): PtkCopyButton {
  const element = document.createElement('ptk-copy-button');
  element.text = '183.7 kg';
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function button(element: PtkCopyButton): PtkButton {
  const found = element.shadowRoot?.querySelector('ptk-button');
  if (found === null || found === undefined) {
    throw new Error('The copy button rendered no button.');
  }
  return found;
}

function inner(element: PtkCopyButton): HTMLButtonElement {
  const found = button(element).shadowRoot?.querySelector('button');
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error('The button rendered no button element.');
  }
  return found;
}

function status(element: PtkCopyButton): HTMLElement {
  const found = element.shadowRoot?.querySelector('[role="status"]');
  if (!(found instanceof HTMLElement)) {
    throw new Error('The copy button rendered no status region.');
  }
  return found;
}

/**
 * Replaces the clipboard for one test.
 *
 * The real one cannot be exercised here in either direction: Chromium refuses a
 * write without a permission the test runner does not grant, and the refusal path
 * -- an insecure context, or an iframe whose embedder withheld the permission --
 * cannot be produced inside a test page at all. Both are the states this element
 * exists for, so both are injected.
 */
function withClipboard(clipboard: Partial<Clipboard> | undefined): void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
  teardown.push(() => {
    if (original === undefined) {
      // Deleting the own property uncovers the prototype getter again, which is
      // where the real implementation lives.
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', original);
    }
  });
}

async function press(element: PtkCopyButton): Promise<void> {
  inner(element).click();
  // The write is a promise, so the outcome lands a microtask later; awaiting the
  // element's update alone would read the state before the copy resolved.
  await Promise.resolve();
  await element.updateComplete;
}

describe('ptk-copy-button', () => {
  it('puts exactly the text it was given on the clipboard', async () => {
    // Exactly: not the rendered text of anything. What a lifter pastes is "183.7 kg",
    // never "Chart value 183.7 kg Exact 183.71 kg", and deriving it from the DOM
    // would let a layout change silently change what gets copied.
    const written: string[] = [];
    withClipboard({
      writeText: async (value: string) => {
        written.push(value);
        return Promise.resolve();
      },
    });
    const element = mount();
    await element.updateComplete;

    await press(element);

    expect(written).toStrictEqual(['183.7 kg']);
  });

  it('re-renders when a property changes after first render', async () => {
    // The canary for Lit's decorator configuration, as in every component here.
    const element = mount();
    await element.updateComplete;
    // The label is slotted, so it lives in the button's light DOM rather than in
    // the native button the slot renders into.
    expect(button(element).textContent.trim()).toBe('Copy');

    element.label = 'Copy in kilograms';
    await element.updateComplete;

    expect(button(element).textContent.trim()).toBe('Copy in kilograms');
  });

  it('confirms in a polite live region rather than replacing anything', async () => {
    withClipboard({ writeText: async () => Promise.resolve() });
    const element = mount();
    await element.updateComplete;

    await press(element);

    expect(status(element).textContent.trim()).toBe('Copied');
    expect(status(element).getAttribute('role')).toBe('status');
  });

  it('renders the live region before it has anything to say', async () => {
    // A region added to the document at the same moment its text appears is not
    // reliably announced, and the failure surfaces on one screen reader months
    // later rather than in this suite.
    const element = mount();
    await element.updateComplete;

    expect(status(element).textContent.trim()).toBe('');
  });

  it('says so when the clipboard refuses, instead of doing nothing visible', async () => {
    // The realistic case: an iframe whose embedding page did not grant the
    // clipboard permission. Swallowed, this is a button that visibly does nothing,
    // repeatedly, with no way to tell whether it worked.
    withClipboard({
      writeText: async () => Promise.reject(new Error('NotAllowedError')),
    });
    const element = mount();
    await element.updateComplete;

    await press(element);

    expect(status(element).textContent).toContain('Select the value');
  });

  it('says the same thing when there is no clipboard API at all', async () => {
    // An insecure context. Two different causes, one sentence, because the advice
    // to the visitor is identical.
    withClipboard(undefined);
    const element = mount();
    await element.updateComplete;

    await press(element);

    expect(status(element).textContent).toContain('Select the value');
  });

  it('reports both outcomes to a listener outside the shadow boundary', async () => {
    const outcomes: boolean[] = [];
    // On `document.body`, not `document`: `DocumentEventMap` is not augmented, so
    // the detail would arrive untyped and every caller would reach for a cast.
    const listen = (event: CustomEvent<{ copied: boolean }>): void => {
      outcomes.push(event.detail.copied);
    };
    document.body.addEventListener(COPY_EVENT, listen);
    teardown.push(() => {
      document.body.removeEventListener(COPY_EVENT, listen);
    });

    withClipboard({ writeText: async () => Promise.resolve() });
    const element = mount();
    await element.updateComplete;
    await press(element);

    withClipboard({ writeText: async () => Promise.reject(new Error('NotAllowedError')) });
    await press(element);

    expect(outcomes).toStrictEqual([true, false]);
  });

  it('clears the confirmation, so a second press is visible', async () => {
    // Left on screen, the second copy changes nothing at all and reads as a button
    // that has stopped working.
    vi.useFakeTimers();
    withClipboard({ writeText: async () => Promise.resolve() });
    const element = mount();
    await element.updateComplete;

    await press(element);
    expect(status(element).textContent.trim()).toBe('Copied');

    await vi.advanceTimersByTimeAsync(5000);
    await element.updateComplete;

    expect(status(element).textContent.trim()).toBe('');
  });

  it('drops its timer when it leaves the document', async () => {
    // Tool 4 renders one of these per chart row and rebuilds the table whenever the
    // step filter changes, so a pending timer per removed row is a real leak.
    vi.useFakeTimers();
    withClipboard({ writeText: async () => Promise.resolve() });
    const element = mount();
    await element.updateComplete;
    await press(element);

    element.remove();
    await vi.advanceTimersByTimeAsync(5000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing when disabled', async () => {
    const written: string[] = [];
    withClipboard({
      writeText: async (value: string) => {
        written.push(value);
        return Promise.resolve();
      },
    });
    const element = mount();
    element.disabled = true;
    await element.updateComplete;

    await press(element);

    expect(written).toStrictEqual([]);
  });

  it('can name itself, because a screen holds one of these per row', async () => {
    // Four controls all called "Copy" are four identical entries in a list of
    // controls, which is a list nobody can navigate.
    const element = mount();
    element.accessibleName = 'Copy 183.7 kg';
    await element.updateComplete;

    expect(inner(element).getAttribute('aria-label')).toBe('Copy 183.7 kg');
  });

  it('leaves the button unnamed when nothing named it', async () => {
    const element = mount();
    await element.updateComplete;

    expect(inner(element).hasAttribute('aria-label')).toBe(false);
  });

  it('meets the tap-target floor', async () => {
    const element = mount();
    await element.updateComplete;

    expect(inner(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('stays inside a phone-width column', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = mount(frame);
    element.label = 'Copy the chart value';
    await element.updateComplete;
    await press(element);

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('has no accessibility violations', async () => {
    withClipboard({ writeText: async () => Promise.resolve() });
    const element = mount();
    await element.updateComplete;
    await press(element);

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
