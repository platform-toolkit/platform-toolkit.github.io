// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

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
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
app.replaceChildren(createWarmUpView());

// This tool changes height constantly -- every lift added, every fold opened,
// every ramp recalculated -- so the observer is doing real work here rather than
// guarding against an eventual layout change. Nothing a lifter types -- a working
// weight, a lift they named, a rack they described -- leaves with the height, and
// there is no message that could carry it.
publishEmbedHeightOnResize({ tool: TOOL_ID });
