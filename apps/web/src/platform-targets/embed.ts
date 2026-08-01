import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  type HeightMessage,
} from '@platform-toolkit/configuration';
import { initializeTheme } from '@platform-toolkit/ui';

import { TOOL_ID, createPlatformTargetsView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A theme change resizes nothing on its own today, but it can once there is a
// real view -- a different type scale or a wrapped label changes the height, and
// a frame left at its old size is the visible symptom.
initializeTheme({
  onChange: () => {
    publishHeight();
  },
});

app.replaceChildren(createPlatformTargetsView());

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. No athlete information, no imported
 * profile data, and no application state is ever sent to a parent page. The
 * shape is declared in the configuration package alongside the one message that
 * comes the other way, so the whole framing surface reads in one place.
 */
function publishHeight(): void {
  if (window.parent === window) {
    return;
  }

  const message: HeightMessage = {
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    tool: TOOL_ID,
    type: 'height',
    height: document.documentElement.scrollHeight,
  };

  window.parent.postMessage(message, '*');
}

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    publishHeight();
  }).observe(document.documentElement);
}

publishHeight();
