// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui';

import { registerServiceWorker } from '../pwa.js';
import { createWarmUpView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

// This is the page most worth having offline in the collection: it is opened at
// a rack, on a phone, where the signal is one bar and every set is another wait.
// `registerServiceWorker` declines when the page is framed, so being embeddable
// costs nothing here.
registerServiceWorker();

app.replaceChildren(createWarmUpView());
