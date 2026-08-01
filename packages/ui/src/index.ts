/**
 * Everything shared across the tools in this collection.
 *
 * Tools own their own domain logic and their own presentation. What they share
 * is the chrome: the theme, the tokens that theme is expressed in, and the small
 * number of elements that must look and behave identically wherever they appear.
 * Anything specific to one tool belongs in that tool, not here.
 *
 * Design tokens are not exported from this module because they are CSS, not
 * JavaScript. Import them at `@platform-toolkit/ui/tokens.css`.
 */

// Side-effect import: defining a custom element is the point of the module, and
// a consumer that only wants the type should import the type explicitly.
import './ptk-theme-control.js';

export { PtkThemeControl, type ThemeModeChangeDetail } from './ptk-theme-control.js';
export { ThemeController, type ThemeChangeListener, type ThemeState } from './theme-controller.js';
