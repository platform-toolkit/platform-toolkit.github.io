// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

import { TOOL_ID, createOneRepMaxView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A forced dark theme can wrap a label that fitted on one line, and a frame left
// at its old height is the visible symptom -- on somebody else's page.
initializeTheme({
  onChange: () => {
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
app.replaceChildren(createOneRepMaxView());

// Three folds and a percentage table that appears the moment a set parses: this
// view changes height on almost every interaction, so the observer is doing real
// work rather than guarding against an eventual layout change. Nothing the lifter
// enters -- the weight, the repetitions, how close to failure the set was, and
// least of all the reported sex -- goes out with the height, and there is no
// message shape that could carry any of it.
publishEmbedHeightOnResize({ tool: TOOL_ID });
