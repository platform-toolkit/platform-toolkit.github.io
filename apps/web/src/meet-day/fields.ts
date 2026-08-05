// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { LifterSetup } from './prep.js';

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

/**
 * §6.1's opening choice: one lifter, or a room full of them.
 *
 * Above the setup rather than inside `ptk-planner-setup`, because it decides
 * which of that element's questions are even asked -- the first-meet answer and
 * the goal are about the person holding the phone, and a coach running other
 * people's meets has no answer to either.
 */
export const MODE_FIELD = 'mode';

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

/**
 * §21's board and §21's roster, which is the second attribute *name* here.
 *
 * Same shape as `CHOICE_SLOT_FIELD` and the same reason, arriving on a screen
 * with several lifters on it rather than several cards: a row's controls carry
 * `data-lifter` followed by the lifter id, and the handler reads
 * `dataset.lifter`. A lifter id is the one key on this screen that survives a
 * rebuild -- the board repaints off the clock seam four times a second and its
 * rows are re-sorted by urgency as clocks run down, so a row index would name
 * whichever lifter had moved into that position between the press starting and
 * the handler running. The failure is a pin, or a switch to a live screen,
 * landing on the wrong athlete.
 *
 * The roster shares the attribute rather than declaring one of its own. Its
 * rows are in document order and do not re-sort, so an index would work there
 * today -- and one attribute meaning one thing on both screens is what stops
 * the two handlers in the root drifting into reading different keys off the
 * same path.
 */
export const BOARD_LIFTER_FIELD = 'lifter';

/*
 * §21's per-device setup: what this phone calls each lifter it is running.
 *
 * `ROSTER_NAME_FIELD` is the box a new lifter is typed into and is deliberately
 * not `LIFTER_NAME_FIELD`. Both are a name in a text field and they go to
 * different places -- one starts a solo meet, the other adds a row to a board
 * already running -- and the root listens for both on the same host, so one
 * name for the two would put a coach's roster entry into the solo start panel.
 *
 * The other two carry `data-lifter`: they are answers about a lifter who is
 * already in the meet, and there is one of each per row.
 */
export const ROSTER_NAME_FIELD = 'roster-name';
export const ROSTER_IDENTIFIER_FIELD = 'roster-identifier';
export const ROSTER_COLOUR_FIELD = 'roster-colour';

/**
 * §21.4's bar, which is a fifth text field the root listens for on one host.
 *
 * Carries `data-lifter` like the two above it. Deliberately not folded into the
 * identifier: they read alike -- both are a short string somebody types on a row
 * -- and they mean opposite things. An identifier distinguishes this lifter from
 * every other, and a bar is the one value several lifters are meant to share, so
 * one field name covering both would have `rackSequences` grouping the room by
 * lot number and finding that nobody shares anything.
 */
export const ROSTER_RACK_FIELD = 'roster-rack';

/*
 * §21.3's handlers, which are the first *list* a row holds.
 *
 * Three fields and a fourth attribute name, because a lifter can have more than
 * one handler and the three controls on a handler have to say which one they
 * belong to. So a handler control carries `data-lifter` and `data-handler`, and
 * the root reads both off the same path -- the same two-axis walk `data-lift`
 * needs on §7's figures, arriving on a second screen.
 *
 * `data-handler` is a *position* in the entry's list, and it is the one place in
 * this file that uses one. Every other list here is keyed by something stable
 * because it is rebuilt while somebody is pointing at it -- a board re-sorting
 * by urgency, a choice list rebuilt off the clock seam. A handler list is not:
 * nothing reorders it, and the only two things that change its length are the
 * add and remove presses below, both of which are the coach's own. There is also
 * nothing else to key on -- a handler is a name and a set, the name is blank for
 * as long as it takes to type one, and two blank rows are indistinguishable by
 * value. An id would have to be invented, stored in the exported file, and
 * validated on the way back in, to identify a row whose position cannot move.
 */
export const ROSTER_HANDLER_NAME_FIELD = 'roster-handler-name';
export const ROSTER_HANDLER_DUTIES_FIELD = 'roster-handler-duties';
export const ROSTER_HANDLER_ADD_FIELD = 'roster-handler-add';
export const ROSTER_HANDLER_REMOVE_FIELD = 'roster-handler-remove';
export const ROSTER_HANDLER_INDEX_FIELD = 'handler';

/**
 * §14's guard against the correct weight going in for the wrong athlete.
 *
 * The one field in this tool whose answer is never written to the session and
 * never reaches the preference store. §13.4's rule is that the setup answers are
 * settings on a device and the lifter's own facts are not, and a name is the
 * plainest instance of the second: it goes into the meet document the moment the
 * meet starts and lives nowhere else.
 */
export const LIFTER_NAME_FIELD = 'lifter-name';

/*
 * §22.1's sixteen setup answers.
 *
 * The field name is the `LifterSetup` key, deliberately, and this is the one
 * place in the file where that is true. Every other group here names a control
 * and the root's switch maps it onto state; a setup answer has no mapping to
 * make -- thirteen text boxes and three tile groups all write one string into
 * one key, so the handler is `withLifterSetup(prep, { [key]: value })` and a
 * separate vocabulary would be sixteen rows of `case 'squat-rack': return
 * 'squatRackHeight'` with nothing to check them against.
 *
 * It is a tuple over the keys rather than sixteen constants, so `keyof
 * LifterSetup` is what the compiler checks the list against -- a renamed key
 * that nothing here follows is a type error rather than a control that visibly
 * responds while nothing is recorded. The order is the order of the form.
 */
export const SETUP_FIELDS = [
  'squatRackHeight',
  'squatSafetyHeight',
  'monoliftSetting',
  'squatStart',
  'benchRackHeight',
  'benchSafetyHeight',
  'footBlocks',
  'handoff',
  'deadliftNotes',
  'commands',
  'flight',
  'lot',
  'platform',
  'session',
  'weighInTime',
  'liftingStartTime',
] as const satisfies readonly (keyof LifterSetup)[];

/**
 * Narrows a `data-field` string read off the DOM onto a `LifterSetup` key.
 *
 * The one place in this file that needs a runtime check, and it is a
 * consequence of the decision above: because the field name *is* the key, the
 * root's handler has a `string` where it needs a key and no switch to narrow it
 * through. Checked against the list rather than cast -- a cast would write an
 * arbitrary attribute straight into the setup, so a stray `data-field` anywhere
 * inside this element's subtree would add a property to a document §23 prints
 * and §24 saves, and nothing would ever say so.
 *
 * Total by construction: `SETUP_FIELDS` is `satisfies`-checked against the
 * keys, so a key it does not list is caught at compile time and cannot reach
 * here as a silent `false`.
 */
export function isSetupField(value: string): value is keyof LifterSetup {
  return (SETUP_FIELDS as readonly string[]).includes(value);
}

/*
 * §22.2's checklist.
 *
 * `CHECKLIST_GROUP_FIELD` is the third attribute *name* in this file, after
 * `CHOICE_SLOT_FIELD` and `BOARD_LIFTER_FIELD`, and it is here for a reason
 * particular to `ptk-toggle-group`: the element reports its *whole* selection,
 * and the checklist is three of them. A report with no group on it would be
 * applied over every tick in the prep, so ticking one row under "Bring" would
 * clear everything under "Do at the venue". The handler reads `dataset.group`
 * and writes back only the rows that group offered -- which is exactly what
 * `withCheckedRows` in `prep.ts` takes its `within` argument for.
 */
export const CHECKLIST_GROUP_FIELD = 'group';

/** §22.2's "allow reminders and user-authored notes". */
export const CUSTOM_ITEM_FIELD = 'custom-item';
export const PREP_NOTES_FIELD = 'prep-notes';

/**
 * The remove control on a row somebody added.
 *
 * Carries the item id rather than the row's position, for the reason
 * `BOARD_LIFTER_FIELD` does: the list is rebuilt on every change, and an index
 * would name whichever row had moved into that position. Less urgent here than
 * on a board that re-sorts itself four times a second -- but the failure is the
 * same one, and it is a row deleted that nobody asked to delete.
 */
export const REMOVE_CUSTOM_ITEM_FIELD = 'remove-custom-item';
export const CUSTOM_ITEM_ID_FIELD = 'item';

/**
 * §24's name, which is what turns a screen into a saved meet.
 *
 * The fourth text field the root listens for, and the third that is deliberately
 * not one of the others: `LIFTER_NAME_FIELD` starts a solo meet, `ROSTER_NAME_FIELD`
 * adds a row to a running board, and this one names the *document* the other two
 * end up inside. All three are a name in a box on the same host, so one constant
 * covering two of them would file a meet under an athlete or start a meet by
 * naming it.
 *
 * The shelf's own rename box does not use this. It reports through the element's
 * own `@state` draft and arrives as a `MeetCommandDetail`, because a rename is
 * about a meet that is not the open one and the root has no field to write it to.
 */
export const MEET_NAME_FIELD = 'meet-name';

/**
 * §20's "which lift are you warming up for", asked above the warm-up fold.
 *
 * Not a session answer -- nothing in `PlannerSession` holds it, and nothing
 * should: it is which of the contested lifts the fold is currently showing, and
 * a lifter who squats and then walks to the bench has not changed anything about
 * their plan. Same reasoning as `CONVERT_FIELD` above, and the same two-places
 * contract: the constant is shared between the root's template and the root's
 * own listener.
 *
 * **It deliberately carries no `data-lift`, and neither does the fold below
 * it.** `ptk-meet-warmup` dispatches `NUMBER_FIELD_CHANGE_EVENT` from its own
 * children and does not stop it, so every figure typed into the warm-up bubbles
 * to the root's `#onNumber`. None of its field names is one of this file's
 * constants, so those events fall through `#applyNumber` to `#applyLiftNumber`,
 * whose opening `if (lift === null) return;` is the only thing that stops them.
 * A `data-lift` anywhere above the fold defeats that guard and a lifter counting
 * their flight starts overwriting the attempt weights on the plan.
 */
export const WARMUP_LIFT_FIELD = 'warmup-lift';

/**
 * Which lift the warm-up fold was showing when it reported a change.
 *
 * The fourth attribute *name* in this file, after `CHOICE_SLOT_FIELD`,
 * `BOARD_LIFTER_FIELD` and `CHECKLIST_GROUP_FIELD`, and it exists because the
 * lift on screen is derived rather than stored: `warmupLift` is clamped to the
 * lifts the format actually contests, so the two disagree for exactly as long as
 * it takes a format change to reach the picker. Reading the lift off the DOM the
 * event came out of is what makes the answers land on the lift the lifter was
 * looking at; reading the state would file a squat ramp under a bench press.
 *
 * `data-warmup-subject` rather than `data-lift` for the reason above.
 */
export const WARMUP_SUBJECT_FIELD = 'warmupSubject';

/**
 * §19's "which record are you going for", asked above the record fold.
 *
 * `WARMUP_LIFT_FIELD`'s twin, with one difference that matters: the answer is a
 * `RecordSubject` and not a `PlatformLift`, because a total is a record a lifter
 * chases and is not a lift they walk onto a platform to attempt. So the value
 * arriving here can be `total`, which `sessionLifts` will never contain, and the
 * root narrows it against `recordSubjectsIn` rather than against the lifts.
 *
 * **It carries no `data-lift` either, and neither does the fold below it**, for
 * the whole of the reason written against `WARMUP_LIFT_FIELD`: the record fold
 * holds two `ptk-number-field`s whose reports bubble to the root's `#onNumber`,
 * and the only thing standing between them and the attempt weights on the plan
 * is `#applyLiftNumber`'s opening `if (lift === null) return;`.
 */
export const RECORD_SUBJECT_FIELD = 'record-subject';

/**
 * Which record the fold was showing when it reported a change.
 *
 * The fifth attribute *name* in this file, and it exists for exactly the reason
 * `WARMUP_SUBJECT_FIELD` does: the subject on screen is clamped to the ones this
 * meet contests, so the picker and the stored answer disagree for as long as it
 * takes a format change to reach the screen, and reading the state instead of
 * the DOM would file a bench record under a squat.
 *
 * `data-record-subject`, which is a different attribute from
 * `data-warmup-subject` and must stay one: the two folds sit on the same screen,
 * one carries a lift and the other can carry a total, and a shared attribute
 * would have the warm-up walk find `total` and the record walk find a lift.
 */
export const RECORD_SUBJECT_ATTRIBUTE = 'recordSubject';
