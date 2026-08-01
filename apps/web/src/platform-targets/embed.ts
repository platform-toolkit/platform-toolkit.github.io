import { ThemeController } from '@platform-toolkit/ui';
import { mountThemeControl } from '../theme-control.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

const theme = new ThemeController();

app.replaceChildren(mountThemeControl(theme));

theme.subscribe(() => {
  publishHeight();
});

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. No athlete information, no imported
 * profile data, and no application state is ever sent to a parent page.
 *
 * `source` names the collection and `tool` names the view within it, so a page
 * embedding two tools can tell the messages apart rather than sizing both frames
 * to whichever spoke last.
 */
function publishHeight(): void {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage(
    {
      source: 'platform-toolkit',
      tool: 'platform-targets',
      version: 1,
      type: 'height',
      height: document.documentElement.scrollHeight,
    },
    '*',
  );
}

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    publishHeight();
  }).observe(document.documentElement);
}

publishHeight();
