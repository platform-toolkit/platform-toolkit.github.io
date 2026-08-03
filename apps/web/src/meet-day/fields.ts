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

/**
 * The question a unit change asks about the figures already typed.
 *
 * Not a setup answer -- nothing in `PlannerSetup` holds it. It is asked by the
 * root, answered once, and gone, so it lives here rather than beside the unit it
 * follows: the constant is shared between the root's template and the root's own
 * listener, which is the same two-places-one-string contract as every field
 * above it.
 */
export const CONVERT_FIELD = 'convert';

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

/*
 * §12's result flow. These carry no `data-lift`: the element is handed one
 * attempt at a time and the attempt already names its lift, so a lift attribute
 * here would be a second copy of the same fact and a second thing to get wrong.
 */
export const OUTCOME_FIELD = 'outcome';
export const EFFORT_FIELD = 'effort';
export const MISS_REASON_FIELD = 'miss-reason';
export const RPE_FIELD = 'rpe';
export const NOTE_FIELD = 'note';

/**
 * §12.1's three lights, as a tuple indexed the way `AttemptLights` is.
 *
 * The same reasoning as `ATTEMPT_FIELDS`, arriving at a place where it costs
 * more: these three read left, head, right, and two of the three are
 * interchangeable to a glance. Three loose constants would let a template draw
 * the head referee's bar under the left referee's name, and the recorded lights
 * would be a legal-looking two-to-one in the wrong direction -- which is
 * precisely the detail somebody goes back to the note for.
 */
export const LIGHT_FIELDS = ['light-left', 'light-head', 'light-right'] as const;

/*
 * §13's three choices.
 *
 * The odd one out in this file: every other constant here is the *value* of a
 * `data-field` attribute, and this is the attribute's own name -- the value is
 * the slot, which differs per card. So a choice button carries `data-slot`
 * followed by its slot, and the handler reads `dataset.slot`.
 *
 * The card is identified by its slot and not by its position in the list. The
 * live screen repaints off the clock seam four times a second (§14), so the
 * array behind these cards is rebuilt between a press starting and the handler
 * running; an index would then name whichever card had moved into that
 * position, and the failure is a declared weight nobody chose. A slot names the
 * same offer across a rebuild. `collapseDuplicates` in `live-choices.ts` folds
 * by weight and never emits two cards in one slot, so the key is unique as well
 * as stable.
 */
export const CHOICE_SLOT_FIELD = 'slot';

/** §13's "a different legal weight", which is a field and not a card. */
export const OTHER_WEIGHT_FIELD = 'other-weight';
