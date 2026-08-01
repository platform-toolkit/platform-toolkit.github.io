import { initializeTheme } from '@platform-toolkit/ui';

import { registerServiceWorker } from '../pwa.js';
import { TOOLS } from '../tools.js';

import { createInstallPrompt } from './install.js';

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

// Built even where installation is not offered: it stays hidden until a browser
// says it is willing, and constructing it up front is what lets the listener
// inside be registered before the event fires.
app.replaceChildren(list, createInstallPrompt());
