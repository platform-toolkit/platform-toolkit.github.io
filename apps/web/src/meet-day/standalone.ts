// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui';

import { registerServiceWorker } from '../pwa.js';
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

app.replaceChildren(createPlannerView());
