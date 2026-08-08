// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The pure core of the one-rep max estimator.
 *
 * No Lit, no DOM, no storage, no network, and no clock -- section 15's first
 * requirement for a tool package. The `PreferenceStore` named below is a *port*,
 * handed in by the caller: this module defines what may be remembered and reads
 * and writes it through whatever the host supplies, so a run in bare Node covers
 * the same code the browser runs. Nothing here reaches for `localStorage`.
 *
 * The equations are not here either. The twenty-two published formulas, the
 * evidence-weighted ensemble, the disagreement figures and the four-level grade
 * all live in `@platform-toolkit/domain`, and deliberately: a later meet-day
 * plan has to build on the same result object this tool renders rather than on
 * a second copy of the arithmetic. What is here is the set being described --
 * what a keystroke means, what a unit flick does to a typed weight, what
 * survives a lock screen and what must not -- and `requestFor`, the one
 * crossing into the domain.
 */

export {
  DISPLAY_PREFERENCES,
  EMPTY_ENTRY,
  LIFTS,
  QUICK_REPS,
  RESERVE_CHOICES,
  SET_PREFERENCES,
  STORED_TECHNIQUE_IDS,
  chooseReps,
  experienceFrom,
  experienceValueOf,
  formQualityFrom,
  freshnessFrom,
  liftFromValue,
  loadEntry,
  openingTechniqueFor,
  readReps,
  repsProblem,
  requestFor,
  reserveChoiceOf,
  reserveFrom,
  reserveFromValue,
  saveEntry,
  setLift,
  setTechnique,
  setUnit,
  sexFrom,
  sexValueOf,
  typeReps,
  typeWeight,
  unitFromValue,
  weightProblem,
} from './session.js';
