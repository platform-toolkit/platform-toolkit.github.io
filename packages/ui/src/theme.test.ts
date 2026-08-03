// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs in a real browser, because every claim here is about browser behaviour:
 * attribute and inline-style writes, `prefers-color-scheme`, and the identity of
 * the window a `message` event came from. A simulated DOM would let all four
 * pass while the shipped behaviour was wrong.
 */
import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  resolveEffectiveTheme,
  themeModeFromSearch,
  type ThemeMode,
} from '@platform-toolkit/configuration';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyThemeMode,
  currentThemeMode,
  effectiveTheme,
  initializeTheme,
  listenForHostTheme,
} from './theme.js';

/** Torn down after every test so a leaked listener cannot influence the next one. */
const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) {
    teardowns.pop()?.();
  }
});

function track(stop: () => void): void {
  teardowns.push(stop);
}

/** A root of its own, so no test can observe another test's document. */
function detachedRoot(): HTMLElement {
  return document.createElement('div');
}

function themeMessage(mode: string): unknown {
  return { source: MESSAGE_SOURCE, version: MESSAGE_VERSION, type: 'set-theme', mode };
}

/**
 * Posts a message and resolves once it has been delivered.
 *
 * The listener registered here runs after the one under test, because same-type
 * listeners fire in registration order and `listenForHostTheme` is always called
 * first. Waiting on a timer instead would be a race that passes locally and
 * fails on a loaded CI machine.
 */
function afterDelivery(post: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    window.addEventListener('message', () => {
      resolve();
    });
    post();
  });
}

describe('applyThemeMode', () => {
  it.each(['light', 'dark'] satisfies ThemeMode[])('pins the document to %p', (mode) => {
    const root = detachedRoot();
    applyThemeMode(mode, root);

    expect(root.getAttribute('data-theme-mode')).toBe(mode);
    expect(root.getAttribute('data-theme')).toBe(mode);
    // Tells the browser which way to render its own widgets -- scrollbars, form
    // controls, the canvas behind the page. Without it a forced dark theme
    // renders dark content inside light chrome.
    expect(root.style.colorScheme).toBe(mode);
  });

  it('sets no theme attribute for system, leaving CSS in charge', () => {
    // Pinning the attribute to whatever the system said at load would freeze the
    // theme there, and the page would stop following the system with nothing to
    // show for it.
    const root = detachedRoot();
    applyThemeMode('dark', root);
    applyThemeMode('system', root);

    expect(root.getAttribute('data-theme-mode')).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.style.colorScheme).toBe('');
  });
});

describe('currentThemeMode', () => {
  it('reads back what was applied', () => {
    const root = detachedRoot();
    applyThemeMode('light', root);
    expect(currentThemeMode(root)).toBe('light');
  });

  it('answers system for a root nothing has touched', () => {
    expect(currentThemeMode(detachedRoot())).toBe('system');
  });

  it('answers system for an attribute someone else wrote', () => {
    // The attribute is in the DOM, so a host page's own script or an extension
    // can set it to anything. It is read back through the same narrowing every
    // other untrusted theme value goes through.
    const root = detachedRoot();
    root.setAttribute('data-theme-mode', 'sepia');
    expect(currentThemeMode(root)).toBe('system');
  });
});

describe('effectiveTheme', () => {
  it.each(['light', 'dark'] satisfies ThemeMode[])('resolves a forced %p to itself', (mode) => {
    const root = detachedRoot();
    applyThemeMode(mode, root);
    expect(effectiveTheme(root)).toBe(mode);
  });

  it('follows the browser for system mode', () => {
    // Asserted against the live media query rather than a hard-coded value: the
    // claim is that it follows the browser, and a headless run that changed its
    // default should not fail this test.
    const root = detachedRoot();
    applyThemeMode('system', root);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    expect(effectiveTheme(root)).toBe(resolveEffectiveTheme('system', prefersDark));
  });
});

describe('listenForHostTheme', () => {
  it('applies a theme the embedding page asks for', async () => {
    const root = detachedRoot();
    const changes: ThemeMode[] = [];
    track(
      listenForHostTheme({
        root,
        host: window,
        onChange: (mode) => changes.push(mode),
      }),
    );

    await afterDelivery(() => {
      window.postMessage(themeMessage('dark'), '*');
    });

    expect(currentThemeMode(root)).toBe('dark');
    expect(changes).toEqual(['dark']);
  });

  it('ignores a message from a window that is not the embedder', async () => {
    // A host page can contain other frames and can open popups, and any of them
    // can post here. Only the page that framed this document may retheme it.
    const frame = document.createElement('iframe');
    document.body.append(frame);
    track(() => {
      frame.remove();
    });

    const other = frame.contentWindow;
    expect(other, 'the iframe should have a content window').not.toBeNull();

    const root = detachedRoot();
    track(listenForHostTheme({ root, ...(other === null ? {} : { host: other }) }));

    await afterDelivery(() => {
      window.postMessage(themeMessage('dark'), '*');
    });

    expect(currentThemeMode(root)).toBe('system');
  });

  it.each([
    ['an unknown mode', themeMessage('sepia')],
    ['a mode carrying a declaration', themeMessage('dark;--ptk-color-surface:red')],
    ['a foreign source', { source: 'other-widget', version: 1, type: 'set-theme', mode: 'dark' }],
    ['unrelated host chatter', { type: 'consent-updated' }],
    ['a bare string', 'dark'],
  ])('ignores %s', async (_label, payload) => {
    const root = detachedRoot();
    const changes: ThemeMode[] = [];
    track(listenForHostTheme({ root, host: window, onChange: (mode) => changes.push(mode) }));

    await afterDelivery(() => {
      window.postMessage(payload, '*');
    });

    expect(currentThemeMode(root)).toBe('system');
    expect(changes).toEqual([]);
  });

  it('does not announce a change that changes nothing', async () => {
    // A host page with its own theme switch will re-send on every toggle,
    // including back to what is already showing. Announcing that would make
    // every subscriber -- the embed route's height reporter among them --
    // recompute for no reason.
    const root = detachedRoot();
    applyThemeMode('dark', root);
    const changes: ThemeMode[] = [];
    track(listenForHostTheme({ root, host: window, onChange: (mode) => changes.push(mode) }));

    await afterDelivery(() => {
      window.postMessage(themeMessage('dark'), '*');
    });

    expect(changes).toEqual([]);
  });

  it('stops listening once torn down', async () => {
    const root = detachedRoot();
    const stop = listenForHostTheme({ root, host: window });
    stop();

    await afterDelivery(() => {
      window.postMessage(themeMessage('dark'), '*');
    });

    expect(currentThemeMode(root)).toBe('system');
  });
});

describe('initializeTheme', () => {
  it('applies the mode the URL asks for', () => {
    // Deliberately compared against the shared resolver rather than a literal.
    // Rewriting the test page's URL to force a value would be mutating global
    // state the browser runner also depends on; what needs proving here is the
    // wiring, and the resolver itself is covered exhaustively without a browser.
    const root = detachedRoot();
    track(initializeTheme({ root, host: window }));
    expect(currentThemeMode(root)).toBe(themeModeFromSearch(window.location.search));
  });

  it('leaves a host listener running', async () => {
    const root = detachedRoot();
    track(initializeTheme({ root, host: window }));

    await afterDelivery(() => {
      window.postMessage(themeMessage('light'), '*');
    });

    expect(currentThemeMode(root)).toBe('light');
  });
});
