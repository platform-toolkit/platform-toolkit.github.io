// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The custom elements, and the one call that puts them in the registry.
 *
 * Section 15 asks every tool package for an explicit `define…()` rather than a
 * side-effecting import, and the reason is that the registry is a global which
 * throws on a second write. A package that registered its tags on import would hand
 * a consumer a `NotSupportedError` at module-evaluation time -- before a line of its
 * own code ran, from a file it did not write, naming a tag it has never heard of --
 * the first time a bundler failed to dedupe this package or a second copy arrived
 * through a transitive dependency. So no file here carries a `@customElement`
 * decorator, and this is the only module that touches `customElements`.
 *
 * All seven tags are defined together, and that is not a convenience. Six of them are
 * inside the seventh's shadow root; defining only the root would leave a page of
 * unupgraded elements that render nothing and report no error, which is the worst
 * failure mode available -- a blank tool with a clean console.
 */
import type { LitElement } from 'lit';

import { MEET_READING_TAG, PtkMeetReading } from './ptk-meet-reading.js';
import { PROFILE_IMPORT_TAG, PtkProfileImport } from './ptk-profile-import.js';
import { PtkQualificationCheck, QUALIFICATION_CHECK_TAG } from './ptk-qualification-check.js';
import { PtkRegistrationAnswers, REGISTRATION_ANSWERS_TAG } from './ptk-registration-answers.js';
import { PtkResultForm, RESULT_FORM_TAG } from './ptk-result-form.js';
import { PtkResultLog, RESULT_LOG_TAG } from './ptk-result-log.js';
import { PtkStandingReport, STANDING_REPORT_TAG } from './ptk-standing-report.js';

export {
  MEET_READING_TAG,
  PROFILE_IMPORT_TAG,
  PtkMeetReading,
  PtkProfileImport,
  PtkQualificationCheck,
  PtkRegistrationAnswers,
  PtkResultForm,
  PtkResultLog,
  PtkStandingReport,
  QUALIFICATION_CHECK_TAG,
  REGISTRATION_ANSWERS_TAG,
  RESULT_FORM_TAG,
  RESULT_LOG_TAG,
  STANDING_REPORT_TAG,
};

export {
  ATHLETE_CHOSEN_EVENT,
  ATHLETE_SEARCH_EVENT,
  type AthleteChosenDetail,
  type AthleteMatches,
  type AthleteSearchDetail,
  type LookupStatus,
} from './ptk-profile-import.js';
export { STANDARDS_NEEDED_EVENT, type StandardsNeededDetail } from './ptk-qualification-check.js';
export {
  REGISTRATION_ANSWERS_EVENT,
  type RegistrationAnswersDetail,
} from './ptk-registration-answers.js';
export { RESULT_ENTERED_EVENT, type ResultEnteredDetail } from './ptk-result-form.js';
export { RESULT_REMOVED_EVENT, type ResultRemovedDetail } from './ptk-result-log.js';
export type { StandardsStatus } from './ptk-standing-report.js';

/** Every tag this package owns, paired with what to register under it. */
const ELEMENTS: readonly (readonly [string, typeof LitElement])[] = [
  [MEET_READING_TAG, PtkMeetReading],
  [PROFILE_IMPORT_TAG, PtkProfileImport],
  [REGISTRATION_ANSWERS_TAG, PtkRegistrationAnswers],
  [RESULT_FORM_TAG, PtkResultForm],
  [RESULT_LOG_TAG, PtkResultLog],
  [STANDING_REPORT_TAG, PtkStandingReport],
  [QUALIFICATION_CHECK_TAG, PtkQualificationCheck],
];

/**
 * Registers the tool's elements, once.
 *
 * Safe to call any number of times, from any number of modules, in any order.
 * Returns the root constructor so a consumer can reach the property types without a
 * second import.
 *
 * A tag already held by *something else* is left alone rather than reported. There
 * is nothing useful to do about it here -- the page that defined it did so first and
 * this package cannot take it back -- and throwing would turn somebody else's naming
 * collision into this tool refusing to load at all.
 */
export function defineQualificationCheck(): typeof PtkQualificationCheck {
  for (const [tag, constructor] of ELEMENTS) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
  return PtkQualificationCheck;
}
