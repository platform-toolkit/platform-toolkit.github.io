// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The `data-field` names, in one place because two files have to agree on them.
 *
 * Tool 3's `fields.ts` and its reasoning: the root reads answers by walking
 * `event.composedPath()` for a `data-field` (§5.8), so the string on the control
 * and the string in the switch are one contract written twice. Spelled as
 * literals in both, a typo compiles, renders, and produces a control that
 * visibly responds while nothing is recorded.
 *
 * WHAT THIS TOOL ADDS: A SECOND AXIS
 *
 * Almost every field here exists three times over, once per contested lift, so
 * the field name alone cannot say what to write. Controls therefore also carry
 * `data-lift`, and the root reads both off the same path. The alternative --
 * `squat-expected-maximum`, `bench-expected-maximum` and so on -- is the same
 * contract multiplied by three, and it puts a lift identifier into a string the
 * compiler cannot check against `PlatformLift`.
 */

/*
 * §6.2's one-minute setup, and §7's method chooser.
 */
export const FEDERATION_FIELD = 'federation';
export const FORMAT_FIELD = 'format';
export const UNIT_FIELD = 'unit';
export const FIRST_MEET_FIELD = 'first-meet';
export const GOAL_FIELD = 'goal';
export const METHOD_FIELD = 'method';

/*
 * §7's per-lift figures. Each of these needs a `data-lift` beside it.
 */
export const EXPECTED_MAXIMUM_FIELD = 'expected-maximum';
export const GUIDED_WEIGHT_FIELD = 'guided-weight';
export const GUIDED_REPS_FIELD = 'guided-reps';
export const GUIDED_RESERVE_FIELD = 'guided-reserve';
export const GUIDED_STANDARD_FIELD = 'guided-standard';
export const GUIDED_AGE_FIELD = 'guided-age';
export const GUIDED_EQUIPMENT_FIELD = 'guided-equipment';
export const OPENER_FIELD = 'opener';
export const CEILING_FIELD = 'ceiling';
export const OPENER_TESTED_FIELD = 'opener-tested';
export const PERSONAL_RECORD_FIELD = 'personal-record';
export const CONFIRM_FIELD = 'confirm';

/**
 * §7.4's three attempts, as a tuple indexed the way `LiftFigures.attempts` is.
 *
 * A tuple rather than three loose constants so the template can map over it and
 * the listener can find the index with `indexOf`, which keeps the order of the
 * attempts in one place. Three separate names would let a template render the
 * second field with the third field's name, and the symptom is a lifter's second
 * attempt landing in the third slot -- a legal-looking plan, in the wrong order.
 */
export const ATTEMPT_FIELDS = ['attempt-1', 'attempt-2', 'attempt-3'] as const;

/** §7.5's one figure for the whole session. Carries no `data-lift`. */
export const TARGET_TOTAL_FIELD = 'target-total';

/*
 * §8.1's lifter information and §8.2's comparison group. Session-wide.
 */
export const BODYWEIGHT_FIELD = 'bodyweight';
export const AGE_FIELD = 'age';
export const PRIOR_MEETS_FIELD = 'prior-meets';
export const EQUIPMENT_FIELD = 'equipment';
export const READINESS_FIELD = 'readiness';
export const HARD_CUT_FIELD = 'hard-cut';
export const MINIMUM_JUMP_FIELD = 'minimum-jump';
export const MAXIMUM_JUMP_FIELD = 'maximum-jump';
export const COMPARISON_FIELD = 'comparison';
export const MAXIMUM_SOURCE_FIELD = 'maximum-source';
export const EVIDENCE_AGE_FIELD = 'evidence-age';

/*
 * §8.3's totals.
 */
export const PERSONAL_RECORD_TOTAL_FIELD = 'personal-record-total';
export const QUALIFYING_TOTAL_FIELD = 'qualifying-total';
export const MINIMUM_TOTAL_FIELD = 'minimum-total';
export const STRETCH_TOTAL_FIELD = 'stretch-total';
