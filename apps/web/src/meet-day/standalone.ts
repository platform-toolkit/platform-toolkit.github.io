// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui/theme';

import { createInstallPrompt } from '../install.js';
import { registerServiceWorker } from '../pwa.js';
import { browserMeetStore } from './meet-store.js';
import { createPlannerView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// No `data-federation` here, unlike tools 1 and 4. Their pages are about one
// federation; this one is about a lifter's meet, and which federation it is
// under is §6.2's first question. See `view.ts`.

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

// This is the tool most likely to be opened in the warm-up room with the plan
// already made: a lifter checking what they said they would open with, on a
// phone in a basement. Once cached, every answer on this screen is arithmetic
// over figures already typed and needs no network at all.
// `registerServiceWorker` declines when the page is framed, so being embeddable
// costs nothing here.
registerServiceWorker();

// §24's shelf, and the only route that gets one. `browserMeetStore` falls back
// to a page-lifetime shelf where the browser has no storage -- a private window,
// or storage blocked outright -- rather than to nothing, because a lifter in a
// private window still has a meet to run and the screen says plainly which of
// the two they have.
// The install affordance, last and on this route only. A shared link lands on a
// tool page rather than the hub, and a widget must never offer to install
// anything on an embedder's visitor -- so it is absent from `embed.ts`.
app.replaceChildren(createPlannerView({ store: browserMeetStore() }), createInstallPrompt());
