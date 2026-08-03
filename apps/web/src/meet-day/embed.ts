// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  type HeightMessage,
} from '@platform-toolkit/configuration';
import { initializeTheme } from '@platform-toolkit/ui';

import { TOOL_ID, createPlannerView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A forced dark theme can wrap a label that fitted on one line, and a frame left
// at its old height is the visible symptom -- on somebody else's page.
initializeTheme({
  onChange: () => {
    publishHeight();
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
app.replaceChildren(createPlannerView());

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. Nothing a lifter typed into this
 * planner is ever sent to a parent page, and there is no message that could
 * carry it -- which matters more here than in the other tools, because what is
 * typed into this one is a bodyweight, an age and three maximums.
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

// This tool's height moves on nearly every answer: choosing a method swaps a
// whole block of fields, unfolding §8 adds a dozen more, and the plan itself
// appears only once every lift has been agreed to. An embedder left at the
// height of the setup questions would show the plan through a scrollbar, or not
// at all.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    publishHeight();
  }).observe(document.documentElement);
}

publishHeight();
