import { afterEach, describe, expect, it, vi } from 'vitest';

// Both sheets, and the pairing is the point. `tokens.css` carries the `[hidden]`
// reset and `styles.css` carries `.install-prompt`, and the bug these tests were
// rewritten for was the second beating the first. Loading one without the other
// would test a page that does not exist.
import '@platform-toolkit/ui/tokens.css';
import '../styles.css';

import { createInstallPrompt, type InstallHost } from './install.js';

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

/**
 * Attached, because an element outside the document has no computed style.
 *
 * `getComputedStyle` on a detached node returns an empty declaration in every
 * engine, so `display` comes back as the empty string and an assertion that it
 * is not `none` passes for the wrong reason. Every test here measures the real
 * cascade, which means the real document.
 */
function mount(host?: InstallHost): HTMLElement {
  const container = createInstallPrompt(host ?? window);
  document.body.append(container);
  return container;
}

function shown(element: HTMLElement): boolean {
  return getComputedStyle(element).display !== 'none';
}

function button(container: HTMLElement): HTMLElement {
  const found = container.querySelector('ptk-button');
  if (found === null) throw new Error('The install prompt has no button.');
  return found;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createInstallPrompt', () => {
  it('explains the manual route on every browser', () => {
    // Safari never fires the event, and iPhones are most of what these tools are
    // opened on. Before this, iOS visitors were offered nothing at all -- so the
    // fold is not a fallback, it is the only route most of them have.
    const container = mount();

    expect(shown(container)).toBe(true);
    const help = container.querySelector('ptk-disclosure');
    expect(help?.textContent).toContain('Add to Home Screen');
  });

  it('offers no button until a browser says it would install', () => {
    // The defect this whole file exists for: a button on screen with no event
    // behind it, which did nothing when tapped.
    const container = mount();

    expect(shown(button(container))).toBe(false);
  });

  it('really is hidden, and not merely marked hidden', () => {
    // The regression guard. `.install-prompt { display: grid }` used to beat the
    // user agent's `[hidden] { display: none }` -- an author sheet outranks a UA
    // sheet, and a class outranks an attribute selector -- so the old test, which
    // asserted the `hidden` property, passed against a visibly broken page.
    const container = mount();
    const install = button(container);

    expect(install.hidden).toBe(true);
    expect(getComputedStyle(install).display).toBe('none');
  });

  it('shows the button when the browser offers, and suppresses its own bar', () => {
    const container = mount();
    const event = beforeInstallPrompt(() => Promise.resolve());

    window.dispatchEvent(event);

    expect(shown(button(container))).toBe(true);
    // Two offers on screen at once is the failure this prevents -- and calling
    // preventDefault is also what makes the event reusable from the button.
    expect(event.defaultPrevented).toBe(true);
  });

  it('prompts once, then takes the button away and leaves the instructions', async () => {
    const prompt = vi.fn(() => Promise.resolve());
    const container = mount();
    window.dispatchEvent(beforeInstallPrompt(prompt));

    button(container).click();
    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });
    expect(shown(button(container))).toBe(false);
    // Somebody who dismisses the browser's dialog and changes their mind still
    // needs the manual route.
    expect(shown(container)).toBe(true);

    // The event is spent. A second call rejects in a real browser, so the guard
    // is what stops a double tap from logging an error about it.
    button(container).click();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('says nothing about whether the visitor accepted', async () => {
    // Deliberate: whether somebody installed the site is not this project's
    // business, and `userChoice` is the one place that could leak into a log.
    const userChoice = vi.fn();
    const container = mount();
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
      expect(shown(button(container))).toBe(false);
    });
    expect(userChoice).not.toHaveBeenCalled();
  });

  it('goes away entirely once the site is installed', () => {
    const container = mount();
    window.dispatchEvent(beforeInstallPrompt(() => Promise.resolve()));
    expect(shown(button(container))).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    // The section, not just the button. Instructions for doing a thing that has
    // been done are worse than nothing.
    expect(shown(container)).toBe(false);
  });

  it('offers nothing at all when opened as the installed app', () => {
    // Being asked to install an app from inside that app is the kind of detail
    // that makes a tool look abandoned. The throwing listener asserts the second
    // half: an installed page registers nothing and holds no event.
    const container = mount({
      matchMedia: () => ({ matches: true }),
      addEventListener: () => {
        throw new Error('An installed page must not listen for install events.');
      },
    });

    expect(shown(container)).toBe(false);
    expect(container.querySelector('ptk-button')).toBeNull();
  });
});
