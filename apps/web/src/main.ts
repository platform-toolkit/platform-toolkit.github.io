import './components/pt-theme-control.js';
import { ThemeController } from './theme/theme-controller.js';

const theme = new ThemeController();

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

const heading = document.createElement('h1');
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
});

app.replaceChildren(heading, control);
