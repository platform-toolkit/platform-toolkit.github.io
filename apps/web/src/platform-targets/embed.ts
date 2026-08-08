// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

import { FEDERATION_ATTRIBUTE, parseFederationId } from '../federation.js';
import { TOOL_ID, createPlatformTargetsView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// Read from the page, not from the path -- the route happens to end in the
// federation, but a parser here would be one more thing to keep in step with the
// directory layout. See `../federation.ts`.
const federationId = parseFederationId(app.getAttribute(FEDERATION_ATTRIBUTE));

// A theme change resizes nothing on its own today, but it can once there is a
// real view -- a different type scale or a wrapped label changes the height, and
// a frame left at its old size is the visible symptom.
initializeTheme({
  onChange: () => {
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

app.replaceChildren(createPlatformTargetsView({ federationId }));

// The height is the only thing that leaves: no athlete information, no imported
// profile data and no application state is ever sent to a parent page. The shape
// is declared in the configuration package alongside the one message that comes
// the other way, so the whole framing surface reads in one place.
publishEmbedHeightOnResize({ tool: TOOL_ID });
