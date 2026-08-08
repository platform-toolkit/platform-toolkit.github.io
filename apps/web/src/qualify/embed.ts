// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

import { FEDERATION_ATTRIBUTE, parseFederationId } from '../federation.js';
import { TOOL_ID, createQualificationCheckView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// Read from the page, not from the path -- the route happens to end in the
// federation, but a parser here would be one more thing to keep in step with the
// directory layout. See `../federation.ts`.
const federationId = parseFederationId(app.getAttribute(FEDERATION_ATTRIBUTE));

// A theme change can resize this view: the report is a definition list whose
// rows wrap, so a different type scale changes the height, and a frame left at
// its old size is the visible symptom.
initializeTheme({
  onChange: () => {
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

app.replaceChildren(createQualificationCheckView({ federationId }));

// Sending only the height is load-bearing here rather than tidy: the screen holds
// somebody's competition results, their bodyweight, their age and the categories
// they enter in, and none of it is ever sent to a parent page. Framing this view
// grants an embedder a height and no other fact. The shape is declared in the
// configuration package alongside the one message that comes the other way, so
// the whole framing surface reads in one place.
publishEmbedHeightOnResize({ tool: TOOL_ID });
