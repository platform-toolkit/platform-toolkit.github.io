// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

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
import './ptk-date-field.js';
import './ptk-disclosure.js';
import './ptk-notice.js';
import './ptk-number-field.js';
import './ptk-plate-stack.js';
import './ptk-segmented.js';
import './ptk-select.js';
import './ptk-text-area.js';
import './ptk-text-field.js';
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
  DATE_FIELD_CHANGE_EVENT,
  PtkDateField,
  type DateFieldChangeDetail,
} from './ptk-date-field.js';
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
  SEGMENTED_CHANGE_EVENT,
  PtkSegmented,
  type SegmentedChangeDetail,
} from './ptk-segmented.js';
export {
  SELECT_CHANGE_EVENT,
  PtkSelect,
  type SelectChangeDetail,
  type SelectOption,
} from './ptk-select.js';
export { TEXT_AREA_CHANGE_EVENT, PtkTextArea, type TextAreaChangeDetail } from './ptk-text-area.js';
export {
  TEXT_FIELD_CHANGE_EVENT,
  PtkTextField,
  type TextCapitalization,
  type TextFieldChangeDetail,
} from './ptk-text-field.js';
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
