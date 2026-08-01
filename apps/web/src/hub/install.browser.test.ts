import { describe, expect, it, vi } from 'vitest';

import { createInstallPrompt } from './install.js';

/**
 * A stand-in for the event Chromium fires.
 *
 * Constructed rather than mocked because the whole interaction is with a real
 * event: `preventDefault` has to reach the browser's own bar, and the object has
 * to survive being stored and used later. A mock would prove neither.
 */
function beforeInstallPrompt(prompt: () => Promise<void>): Event {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
}

function button(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector('button');
  if (found === null) throw new Error('The install prompt has no button.');
  return found;
}

describe('createInstallPrompt', () => {
  it('stays hidden until a browser offers installation', () => {
    // Safari never fires the event, so this is the state iOS visitors see for
    // the life of the page. A button that cannot install anything would be worse
    // than no button.
    expect(createInstallPrompt().hidden).toBe(true);
  });

  it('appears when the browser offers, and suppresses the browser’s own bar', () => {
    const container = createInstallPrompt();
    const event = beforeInstallPrompt(() => Promise.resolve());

    window.dispatchEvent(event);

    expect(container.hidden).toBe(false);
    // Two offers on screen at once is the failure this prevents -- and calling
    // preventDefault is also what makes the event reusable from the button.
    expect(event.defaultPrevented).toBe(true);
  });

  it('prompts once, then takes itself away', async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const container = createInstallPrompt();
    window.dispatchEvent(beforeInstallPrompt(prompt));

    button(container).click();
    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });
    expect(container.hidden).toBe(true);

    // The event is spent. A second call rejects in a real browser, so the guard
    // is what stops a double tap from logging an error about it.
    button(container).click();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('says nothing about whether the visitor accepted', async () => {
    // Deliberate: whether somebody installed the site is not this project's
    // business, and `userChoice` is the one place that could leak into a log.
    const userChoice = vi.fn();
    const container = createInstallPrompt();
    const event = beforeInstallPrompt(() => Promise.resolve());
    Object.defineProperty(event, 'userChoice', {
      get: () => {
        userChoice();
        return Promise.resolve({ outcome: 'accepted' });
      },
    });
    window.dispatchEvent(event);

    button(container).click();
    await vi.waitFor(() => {
      expect(container.hidden).toBe(true);
    });
    expect(userChoice).not.toHaveBeenCalled();
  });

  it('goes away once the site is installed', () => {
    const container = createInstallPrompt();
    window.dispatchEvent(beforeInstallPrompt(() => Promise.resolve()));
    expect(container.hidden).toBe(false);

    window.dispatchEvent(new Event('appinstalled'));

    expect(container.hidden).toBe(true);
  });
});
