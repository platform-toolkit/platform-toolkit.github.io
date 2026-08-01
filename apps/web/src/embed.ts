import './components/pt-theme-control.js';
import { ThemeController } from './theme/theme-controller.js';

const theme = new ThemeController();

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

const heading = document.createElement('h2');
heading.textContent = 'Platform Targets';

// Typed as PtThemeControl without an assertion: the component module augments
// HTMLElementTagNameMap, so createElement resolves the concrete class.
const control = document.createElement('pt-theme-control');
control.mode = theme.state.resolved.mode;
control.locked = theme.state.resolved.locked;

control.addEventListener('pt-theme-mode-change', (event) => {
  theme.setMode(event.detail.mode);
});

theme.subscribe((state) => {
  control.mode = state.resolved.mode;
  control.locked = state.resolved.locked;
  publishHeight();
});

app.replaceChildren(heading, control);

/**
 * Tells the embedding page how tall this view is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. No athlete information, no imported
 * profile data, and no application state is ever sent to a parent page.
 */
function publishHeight(): void {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage(
    {
      source: 'platform-targets',
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
