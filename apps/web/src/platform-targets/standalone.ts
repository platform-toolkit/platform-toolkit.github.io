import { initializeTheme } from '@platform-toolkit/ui';

import { createPlatformTargetsView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// Nothing forbids framing this route either -- there is no frame-ancestors
// policy anywhere -- so it accepts the same theme override the embed route does.
initializeTheme();

app.replaceChildren(createPlatformTargetsView());
