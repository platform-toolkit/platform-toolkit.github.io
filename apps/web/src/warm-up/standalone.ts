// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui';

import { createInstallPrompt } from '../install.js';
import { registerServiceWorker } from '../pwa.js';
import { browserLogbookHandoff } from './handoff.js';
import { createWarmUpView } from './view.js';

/**
 * Where "Log this workout" goes, relative to this page.
 *
 * Relative and resolved by the browser, so it survives the site moving under a
 * base path -- which it does: the production deployment and a local preview do
 * not agree about the prefix, and an absolute `/logbook/` would be right in one
 * and a 404 in the other. Section 5.7's rule holds either way, because nothing
 * reads `window.location` to work it out; the anchor does the resolving.
 */
const LOGBOOK_HREF = '../logbook/';

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

// The handoff is supplied here and deliberately not in `embed.ts`. This route is
// the toolkit's own page, where the logbook is one of its siblings; the embed is
// somebody else's page, and replacing the contents of their frame with a
// different tool is not a thing they agreed to when they embedded a warm-up
// calculator. The storage would also be partitioned there, so the record would
// be left where the logbook's own page could never read it.

// The install affordance, last and on this route only. A link shared between
// training partners lands on a tool page rather than the hub, so hub-only
// placement meant seven of the eight installable pages offered nothing. It is
// absent from `embed.ts` for the same reason the handoff above is: a widget must
// never offer to install anything on an embedder's visitor.
app.replaceChildren(
  createWarmUpView({ logbook: browserLogbookHandoff(LOGBOOK_HREF) }),
  createInstallPrompt(),
);
