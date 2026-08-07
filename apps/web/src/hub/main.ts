// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { initializeTheme } from '@platform-toolkit/ui';

import { createInstallPrompt } from '../install.js';
import { registerServiceWorker } from '../pwa.js';
import { TOOLS } from '../tools.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

initializeTheme();
registerServiceWorker();

const list = document.createElement('ul');
list.className = 'tool-list';

for (const tool of TOOLS) {
  const item = document.createElement('li');

  const link = document.createElement('a');
  // Relative, so the list keeps working when the site is deployed under a
  // subpath. See the note in tools.ts.
  link.href = `${tool.id}/`;
  link.textContent = tool.name;

  const summary = document.createElement('p');
  summary.textContent = tool.summary;

  item.append(link, summary);
  list.append(item);
}

// Built even where installation cannot be offered in one tap: the fold inside
// explains the manual route, which is all Safari has, and the button appears
// only if a browser hands over an event. Constructed up front rather than on
// demand, because the event fires early and once -- a listener registered after
// it never hears about it.
app.replaceChildren(list, createInstallPrompt());
