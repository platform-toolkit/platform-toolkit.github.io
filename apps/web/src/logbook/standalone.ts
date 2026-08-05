// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui';

import { registerServiceWorker } from '../pwa.js';
import { createTrainingLogbookView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// No `data-federation` here, and no `parseFederationId`. This tool reads no
// published artifact and grades nothing against a governing body's numbers: a
// session is what a lifter did, and it means the same thing in every federation.
// It is the only tool in the collection with no federation axis at all, which is
// why its embed route is `/logbook/embed/` rather than a per-federation path.

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

// This is the tool that most needs the worker, and the one whose absence would
// be noticed first. A lifter opens it standing at a rack in a basement gym with
// one bar of signal, between sets, and everything it needs is already on the
// device -- the training is in IndexedDB and the rules are in the bundle. A
// fifteen-second load for a screen that requires no network would be the tool
// failing at exactly the moment it exists for.
registerServiceWorker();

app.replaceChildren(createTrainingLogbookView());
