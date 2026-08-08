// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

import { FEDERATION_ATTRIBUTE, parseFederationId } from '../federation.js';
import { TOOL_ID, createConverterView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// Read from the page, not from the path. The route happens to end in the
// federation, but a parser here would be one more thing to keep in step with the
// directory layout. See `../federation.ts`.
const federationId = parseFederationId(app.getAttribute(FEDERATION_ATTRIBUTE));

// A forced dark theme can wrap a label that fitted on one line, and a frame left
// at its old height is the visible symptom -- on somebody else's page.
initializeTheme({
  onChange: () => {
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
app.replaceChildren(createConverterView({ federationId }));

// This tool's height moves a long way: unfolding a 180-row chart is the largest
// single height change anything in the collection makes, and an embedder left at
// the folded height would show it through a scrollbar or not at all. The height
// is the only thing that goes out -- the weight somebody typed is never sent to a
// parent page, and there is no message that could carry it.
publishEmbedHeightOnResize({ tool: TOOL_ID });
