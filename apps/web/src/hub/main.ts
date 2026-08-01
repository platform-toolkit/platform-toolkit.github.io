import { initializeTheme } from '@platform-toolkit/ui';

import { TOOLS } from '../tools.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

initializeTheme();

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

app.replaceChildren(list);
