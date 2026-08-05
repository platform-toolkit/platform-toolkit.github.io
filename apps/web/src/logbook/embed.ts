// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  type HeightMessage,
} from '@platform-toolkit/configuration';
import { initializeTheme } from '@platform-toolkit/ui';

import { TOOL_ID, createTrainingLogbookView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A forced dark theme wraps a label that fitted on one line, and a frame left at
// its old height is the visible symptom -- on somebody else's page.
initializeTheme({
  onChange: () => {
    publishHeight();
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
//
// The framed copy has one property no other embed in this collection has, and it
// is worth being plain about rather than quiet: the storage a third-party frame
// gets may be partitioned per embedding site, or refused outright. Where it is
// partitioned the database is real, accepts every write, and belongs to that host
// page -- so a session logged here is not the session the lifter sees at
// /logbook/, and where it is refused nothing survives the tab closing at all.
//
// Nothing here tries to detect which of the three happened, because the tool
// already answers the question that matters. It asks the browser for a database,
// says on screen whether it got one, and offers the JSON backup either way; the
// export is the route out of a partition and is deliberately present on this page
// rather than reserved for the standalone one. Guessing at the cause would add a
// sentence about browsers to a screen whose reader wants to know one thing: is
// this being kept.
app.replaceChildren(createTrainingLogbookView());

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload is
 * a layout measurement and nothing else. This is the tool where that distinction
 * carries the most weight -- what a lifter types into it is a training history,
 * the one body of data in the collection that is theirs rather than published --
 * and the protocol has no message that could carry any of it outward. There is no
 * "workout" message and there must never be one. A host wanting the data has the
 * documented route the lifter controls: the backup they download themselves.
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

// This tool changes height on almost every tap -- a set completed, an exercise
// added, a plan row removed, a screen swapped for another -- so the observer
// earns its keep here rather than guarding against an eventual layout change.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    publishHeight();
  }).observe(document.documentElement);
}

publishHeight();
