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

// Side-effect import: defining a custom element is what makes the tag usable in
// a template, and a consumer that imported only the type would get markup that
// silently never upgrades.
import './ptk-button.js';
import './ptk-choice-group.js';
import './ptk-copy-button.js';
import './ptk-disclosure.js';
import './ptk-notice.js';
import './ptk-number-field.js';
import './ptk-plate-stack.js';
import './ptk-toggle-group.js';

export { PtkButton, type ButtonVariant } from './ptk-button.js';
export {
  CHOICE_CHANGE_EVENT,
  PtkChoiceGroup,
  type Choice,
  type ChoiceChangeDetail,
} from './ptk-choice-group.js';
export { COPY_EVENT, PtkCopyButton, type CopyDetail } from './ptk-copy-button.js';
export {
  DISCLOSURE_TOGGLE_EVENT,
  PtkDisclosure,
  type DisclosureToggleDetail,
} from './ptk-disclosure.js';
export { PtkNotice, type NoticeTone } from './ptk-notice.js';
export { PtkPlateStack } from './ptk-plate-stack.js';
export {
  NUMBER_FIELD_CHANGE_EVENT,
  PtkNumberField,
  type NumberFieldChangeDetail,
} from './ptk-number-field.js';
export {
  TOGGLE_GROUP_CHANGE_EVENT,
  PtkToggleGroup,
  type ToggleGroupChangeDetail,
} from './ptk-toggle-group.js';
export {
  applyThemeMode,
  currentThemeMode,
  effectiveTheme,
  initializeTheme,
  listenForHostTheme,
  type ThemeOptions,
} from './theme.js';
