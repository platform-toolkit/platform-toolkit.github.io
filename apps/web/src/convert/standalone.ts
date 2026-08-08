// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui/theme';

import { FEDERATION_ATTRIBUTE, parseFederationId } from '../federation.js';
import { createInstallPrompt } from '../install.js';
import { registerServiceWorker } from '../pwa.js';
import { createConverterView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// The page says whose chart this is; this is the only place that reads it. A
// second federation's chart is then a second page, not a change here.
const federationId = parseFederationId(app.getAttribute(FEDERATION_ATTRIBUTE));

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

// The chart is a few kilobytes and the answer is needed at a scale, at a rack,
// or at the front table with a phone on one bar of signal. Once cached, the whole
// tool works with no network at all -- which is the situation it is for.
// `registerServiceWorker` declines when the page is framed, so being embeddable
// costs nothing here.
registerServiceWorker();

// The install affordance, last and on this route only. A shared link lands on a
// tool page rather than the hub, and a widget must never offer to install
// anything on an embedder's visitor -- so it is absent from `embed.ts`.
app.replaceChildren(createConverterView({ federationId }), createInstallPrompt());
