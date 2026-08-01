import { initializeTheme } from '@platform-toolkit/ui';

import { FEDERATION_ATTRIBUTE, parseFederationId } from '../federation.js';
import { registerServiceWorker } from '../pwa.js';
import { createPlatformTargetsView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// The page says which federation it is for; this is the only place that reads
// it. A second federation is then a second page, not a change here.
const federationId = parseFederationId(app.getAttribute(FEDERATION_ATTRIBUTE));

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

// Registered from here as well as the hub, because this is a page a lifter
// bookmarks and opens directly -- and the one they open at a meet, where the
// signal is worst. `registerServiceWorker` declines when the page is framed, so
// the standalone route being embeddable costs nothing here.
registerServiceWorker();

app.replaceChildren(createPlatformTargetsView({ federationId }));
