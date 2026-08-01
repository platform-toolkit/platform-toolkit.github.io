// Side-effect import: registers <ptk-theme-control> and augments
// HTMLElementTagNameMap, which is what lets createElement below return the
// concrete class with no type assertion.
import '@platform-toolkit/ui';
import type { ThemeController } from '@platform-toolkit/ui';

/**
 * Creates a theme control bound to a controller, in both directions.
 *
 * Every page on the site needs exactly this wiring, and getting half of it right
 * is a real hazard: a control that dispatches but never re-reads goes out of step
 * the moment anything else changes the theme, and the disagreement is invisible
 * until a user sees two different answers on two pages.
 */
export function mountThemeControl(theme: ThemeController): HTMLElement {
  const control = document.createElement('ptk-theme-control');
  control.mode = theme.state.resolved.mode;
  control.locked = theme.state.resolved.locked;

  control.addEventListener('ptk-theme-mode-change', (event) => {
    theme.setMode(event.detail.mode);
  });

  theme.subscribe((state) => {
    control.mode = state.resolved.mode;
    control.locked = state.resolved.locked;
  });

  return control;
}
