import { ThemeController } from '@platform-toolkit/ui';
import { mountThemeControl } from '../theme-control.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

const theme = new ThemeController();

app.replaceChildren(mountThemeControl(theme));
