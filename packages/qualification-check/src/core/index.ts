// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The pure core of Qualification Check.
 *
 * No Lit, no DOM, no storage, no network, and no clock -- section 15's first
 * requirement for a tool package, and the one that decides whether anything else
 * in it can be tested. Every function here is a total function of its arguments,
 * so a consumer that never renders a thing can still ask the question.
 */

export {
  STRUCK_PLACE_CODES,
  collectStandings,
  performanceSourceOf,
  registrationOf,
  standingKey,
} from './history.js';

export {
  findQualifyingMeet,
  meetTiming,
  readMeetCriteria,
  readRoute,
  type CriteriaContext,
} from './criteria.js';

export {
  divisionsForAge,
  mayPreselect,
  proposeDivisionFromAgeClass,
  proposeEquipment,
  proposeSex,
  proposeWeightClassFromBodyweight,
  proposeWeightClassFromEntry,
} from './category-match.js';

export {
  proposeRegistration,
  resolveRegistration,
  type AgeDivisionCandidates,
  type RegistrationAxis,
  type RegistrationProposal,
  type RegistrationResolution,
  type TestedProposal,
} from './registration.js';

export {
  readProfileQuery,
  type ProfileQueryProblem,
  type ProfileQueryReading,
  type ProfileQuerySource,
} from './profile.js';

export { gradeLift, gradeStanding, reportedLifts } from './standing.js';

export {
  emptyTypedResult,
  readTypedResult,
  type TypedResultField,
  type TypedResultForm,
  type TypedResultProblem,
  type TypedResultProblemCode,
  type TypedResultReading,
  type TypedTestedAnswer,
} from './typed-result.js';

export {
  performanceWindow,
  windowContains,
  windowOverlap,
  windowWithin,
  type PerformanceWindow,
  type PerformanceWindowResult,
  type WindowProblemCode,
} from './window.js';
