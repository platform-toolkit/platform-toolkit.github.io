// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  type HeightMessage,
} from '@platform-toolkit/configuration';
import { initializeTheme } from '@platform-toolkit/ui';

import { TOOL_ID, createWarmUpView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A theme change alters the type scale on nothing today, but a forced dark theme
// can wrap a label that fitted on one line -- and a frame left at its old height
// is the visible symptom, on somebody else's page.
initializeTheme({
  onChange: () => {
    publishHeight();
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
app.replaceChildren(createWarmUpView());

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. Nothing a lifter types -- a working
 * weight, a lift they named, a rack they described -- is ever sent to a parent
 * page, and there is no message that could carry it.
 */
function publishHeight(): void {
  if (window.parent === window) {
    return;
  }

  const message: HeightMessage = {
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    tool: TOOL_ID,
    type: 'height',
    height: document.documentElement.scrollHeight,
  };

  window.parent.postMessage(message, '*');
}

// This tool changes height constantly -- every lift added, every fold opened,
// every ramp recalculated -- so the observer is doing real work here rather than
// guarding against an eventual layout change.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    publishHeight();
  }).observe(document.documentElement);
}

publishHeight();
