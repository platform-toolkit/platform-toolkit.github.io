// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The record states `ptk-meet-record`'s stories and its browser test share.
 *
 * `warmup-fixture.ts`'s three rules, and they apply here for the same reasons:
 *
 * - **Every state is built by the writers, never as a literal.** `withRecord`
 *   is the only thing that produces a `MeetRecordState`, so a field added to the
 *   type reaches every state below without anybody remembering to add it, and a
 *   state here cannot be one `records.ts` would refuse to make.
 * - **They are functions, not constants.** A story and a test that shared one
 *   frozen object would share whatever either of them did to it, and the failure
 *   arrives in the other file.
 * - **The figures are picked so that no two can be confused.** 200 is the squat
 *   record, 500 is the total record, 340 is what the other lifts banked, and the
 *   two margins over the squat record land on 200.25 and 200.5. Every figure on
 *   a rendered screen therefore names exactly one of those, and an assertion
 *   that reads the wrong one cannot accidentally pass.
 *
 * WHY THIS FIXTURE CARRIES A FOURTH-ATTEMPT BLOCK AND `meet-rules.fixture.ts` DOES NOT
 *
 * `MEET_PROFILE_FIXTURE` publishes no fourth attempt at all, which is a real
 * published case and is the one `marginRulesFrom` falls back on. It is the wrong
 * base for this element: with no fourth-attempt block there is no second route
 * to render, no submission clock, no permission line and no exclusion list, so
 * every story would show the same half of the screen. The block below adds those
 * back, and its quarter-kilogram excess against the fixture's half-kilogram bar
 * is what makes the two level conditions name different weights -- without that
 * they coincide and the relation control has nothing to change.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import type { TakenAttempt } from '@platform-toolkit/domain';

import { rulesFor } from './meet-rules.fixture.js';
import {
  EMPTY_RECORD_STATE,
  withRecord,
  type MeetRecordState,
  type RecordAttemptSubject,
} from './records.js';

/** §5.1: invented figures. A federation's own margins are published data, never source. */
const FOURTH_ATTEMPT: NonNullable<MeetRuleProfile['fourthAttempt']> = {
  requiresSuccessfulThird: true,
  withinKilogramsOfRecord: null,
  minimumExcessKilograms: 0.25,
  requiresPermission: true,
  submissionSeconds: 60,
  excludedFrom: ['total', 'placing'],
  requiresPostLiftEquipmentCheck: true,
  summary: 'A fourth attempt at a record, granted on request after a good third.',
};

/** The record on the squat, in kilograms. Every squat figure on screen derives from it. */
export const SQUAT_RECORD = '200';

/** The record on the total. Deliberately nowhere near the squat figure or its margins. */
export const TOTAL_RECORD = '500';

/** What the other lifts have banked, for the total record. Leaves 160 for the bar. */
export const BANKED_TOTAL = '340';

function stateWith(patch: Partial<MeetRecordState>): MeetRecordState {
  return withRecord(EMPTY_RECORD_STATE, patch);
}

/** The fold as a lifter first opens it: nothing typed, both routes refused. */
export function nothingTyped(): MeetRecordState {
  return stateWith({});
}

/**
 * A record at the level of the meet, fully answered.
 *
 * The state every other one below is a variation on. The relation is answered,
 * so the screen names one figure per route and says nothing about a condition.
 */
export function aRecordAtThisLevel(): MeetRecordState {
  return stateWith({
    kilograms: SQUAT_RECORD,
    levelLabel: 'State',
    levelRelation: 'at-or-above-the-meet',
  });
}

/**
 * The same record with the level question left alone, which is where every
 * lifter starts and where most of them stay.
 *
 * The lighter margin is applied and the screen says so. This is the state the
 * `relationUnstated` sentence exists for, and it is a story because a caveat
 * that only ever appears in a test is a caveat nobody has read at 320 pixels.
 */
export function aRelationNobodyAnswered(): MeetRecordState {
  return stateWith({ kilograms: SQUAT_RECORD, levelLabel: 'State' });
}

/** A state record at a national championship: the full loading increment. */
export function aRecordFromASmallerMeet(): MeetRecordState {
  return stateWith({
    kilograms: SQUAT_RECORD,
    levelLabel: 'State',
    levelRelation: 'below-the-meet',
  });
}

/**
 * A record nobody holds yet, which is a seeded standard rather than a lift.
 *
 * Still charged the ordinary margin, because no record book has been read and so
 * no level is one this tool may match into. The advisory says whose figure it is.
 */
export function anUnclaimedRecord(): MeetRecordState {
  return stateWith({
    kilograms: SQUAT_RECORD,
    levelLabel: 'State',
    unclaimed: true,
    levelRelation: 'at-or-above-the-meet',
  });
}

/**
 * A figure that will not read, which is not the same as an empty field.
 *
 * "about 200" rather than a stray letter, because that is what a lifter actually
 * types into a box next to a record they half remember.
 */
export function aFigureThatWillNotRead(): MeetRecordState {
  return stateWith({ kilograms: 'about 200', levelLabel: 'State' });
}

/** A total record with the other lifts in the bag. */
export function aTotalRecord(): MeetRecordState {
  return stateWith({
    kilograms: TOTAL_RECORD,
    levelLabel: 'National',
    levelRelation: 'at-or-above-the-meet',
    totalFromOtherLifts: BANKED_TOTAL,
  });
}

/**
 * A total record with nothing banked, which the domain refuses to plan.
 *
 * The refusal is the point: a blank field is not a total of zero, and the
 * sentence under the closed route is the one that tells the lifter which box to
 * fill in.
 */
export function aTotalRecordWithNothingBanked(): MeetRecordState {
  return stateWith({
    kilograms: TOTAL_RECORD,
    levelLabel: 'National',
    levelRelation: 'at-or-above-the-meet',
  });
}

/**
 * The Thursday before the meet: nothing lifted, so the competition route is open
 * and the fourth attempt has nothing to follow.
 *
 * This is the honest state of a record attempt on the planning screen, not a
 * stub standing in for one.
 */
export function onTheSquat(patch: Partial<RecordAttemptSubject> = {}): RecordAttemptSubject {
  return { lift: 'squat', rules: rulesFor({ fourthAttempt: FOURTH_ATTEMPT }), taken: [], ...patch };
}

/** The deadlift, which is where a total record is taken in a full-power meet. */
export function onTheDeadlift(patch: Partial<RecordAttemptSubject> = {}): RecordAttemptSubject {
  return onTheSquat({ lift: 'deadlift', ...patch });
}

/**
 * Three attempts in, the third good: the fourth-attempt route is open and the
 * competition route has run out.
 *
 * The weights climb by more than the fixture's minimum progression so that the
 * rules accept the sequence, and the third sits under the record so the lifter
 * is chasing something rather than having already taken it.
 */
export function afterAGoodThird(): RecordAttemptSubject {
  return onTheSquat({ taken: taken('good') });
}

/** The same three attempts with the third missed, which is the other refusal. */
export function afterAMissedThird(): RecordAttemptSubject {
  return onTheSquat({ taken: taken('no-lift') });
}

function taken(third: TakenAttempt['outcome']): readonly TakenAttempt[] {
  return [
    { attemptNumber: 1, kilograms: 180, outcome: 'good' },
    { attemptNumber: 2, kilograms: 190, outcome: 'good' },
    { attemptNumber: 3, kilograms: 197.5, outcome: third },
  ];
}
