// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19 as a value: what a typed record becomes, and what this file decides on the
 * lifter's behalf on the way.
 *
 * `records.ts` and `meet-records.ts` in the domain have their own tests and the
 * arithmetic is not re-tested here. What is tested is every place this seam
 * *chooses* something, because each of those choices ends up as a weight on a bar
 * that nobody typed:
 *
 * - **Where the margins come from.** Two of the three come out of the rule
 *   profile and the third is an answer rather than a gap. Each is asserted for
 *   its value and for the direction it errs in when the profile is silent.
 * - **What is deliberately not carried across.** The typed level label must not
 *   reach `RecordScope.levelId`, because the one thing that field is read for is
 *   permission to load the record itself. That is asserted by making the label
 *   collide with a level and showing the margin is still charged.
 * - **What a blank means.** No figure typed is a plan that refuses both routes
 *   and still carries the mandatory sentence, not an absent plan.
 * - **Which lift a total record is taken on**, which is arithmetic about when a
 *   total exists rather than a convention.
 */
import { describe, expect, it } from 'vitest';

import { MEET_PROFILE_FIXTURE, rulesFor } from './meet-rules.fixture.js';
import {
  EMPTY_RECORD_STATE,
  EMPTY_RECORD_STATES,
  RECORD_SUBJECTS,
  buildMeetRecord,
  isBlankRecord,
  liftForSubject,
  marginRulesFrom,
  recordLevelRelationFromValue,
  recordSubjectFromValue,
  recordSubjectIn,
  recordSubjectsIn,
  recordUnderAttemptFrom,
  recordsFor,
  withRecord,
  withRecordFor,
  withRecordForLifter,
  type MeetRecordState,
  type RecordAttemptSubject,
} from './records.js';
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import type { TakenAttempt } from '@platform-toolkit/domain';

/**
 * A fourth-attempt block whose record margin is finer than the bar multiple.
 *
 * The fixture profile has no fourth attempt at all, which is a real published
 * case and is the fallback path. This is the other one, and the quarter-kilogram
 * excess against a half-kilogram bar is what makes the two conditions in
 * `recordTargets` name different weights -- without that they coincide and every
 * assertion about which figure was chosen would pass either way.
 */
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

function stateWith(patch: Partial<MeetRecordState>): MeetRecordState {
  return withRecord(EMPTY_RECORD_STATE, patch);
}

function attemptOn(patch: Partial<RecordAttemptSubject> = {}): RecordAttemptSubject {
  return {
    lift: 'squat',
    rules: rulesFor({ fourthAttempt: FOURTH_ATTEMPT }),
    taken: [],
    ...patch,
  };
}

/**
 * Three attempts with the third at 197.5, which is the state in which the
 * fourth-attempt route opens.
 *
 * The weights climb by more than the profile's minimum progression so the rules
 * accept the sequence, and the third sits under the record so the lifter is
 * chasing something rather than having already taken it.
 */
function takenThird(outcome: TakenAttempt['outcome']): readonly TakenAttempt[] {
  return [
    { attemptNumber: 1, kilograms: 180, outcome: 'good' },
    { attemptNumber: 2, kilograms: 190, outcome: 'good' },
    { attemptNumber: 3, kilograms: 197.5, outcome },
  ];
}

describe('marginRulesFrom', () => {
  it('takes the record margin from the profile fourth attempt', () => {
    const rules = marginRulesFrom({ ...MEET_PROFILE_FIXTURE, fourthAttempt: FOURTH_ATTEMPT });

    expect(rules.minimumIncrementKilograms).toBe(0.25);
  });

  it('falls back to the loading increment where the profile has no fourth attempt', () => {
    const rules = marginRulesFrom(MEET_PROFILE_FIXTURE);

    // The fallback errs upward on purpose: larger than any published record
    // margin, so a lifter is asked for more than the rules demand rather than
    // less. Asserted against the bar multiple rather than the literal so that
    // moving the fixture's grid cannot make this pass by coincidence.
    expect(rules.minimumIncrementKilograms).toBe(MEET_PROFILE_FIXTURE.barMultipleKilograms);
  });

  it('charges the full loading increment below the meet level', () => {
    const rules = marginRulesFrom(MEET_PROFILE_FIXTURE);

    expect(rules.higherSanctionIncrementKilograms).toBe(MEET_PROFILE_FIXTURE.barMultipleKilograms);
  });

  it('lets no level be matched into, because no record book has been read', () => {
    expect(marginRulesFrom(MEET_PROFILE_FIXTURE).matchTakesUnclaimedLevelIds).toEqual([]);
  });
});

describe('recordUnderAttemptFrom', () => {
  it('reads the typed figure as kilograms', () => {
    const record = recordUnderAttemptFrom(stateWith({ kilograms: '200.5' }), 'squat');

    expect(record?.kilograms).toBe(200.5);
    expect(record?.scope.lift).toBe('squat');
  });

  it('is null while the field will not read', () => {
    expect(recordUnderAttemptFrom(EMPTY_RECORD_STATE, 'squat')).toBeNull();
    expect(recordUnderAttemptFrom(stateWith({ kilograms: 'about 200' }), 'squat')).toBeNull();
  });

  it('records no source disagreement, because one typed figure has nothing to disagree with', () => {
    expect(
      recordUnderAttemptFrom(stateWith({ kilograms: '200' }), 'total')?.sourceDisagreement,
    ).toBeNull();
  });

  /**
   * The label is shown back and never matched on, and this is the assertion that
   * holds it there. A level id is read in exactly one place -- against
   * `matchTakesUnclaimedLevelIds`, to decide whether an unclaimed record may be
   * taken by putting the record itself on the bar -- so a free-text label that
   * reached it would turn a lifter's own note into permission to load less than
   * the record needs.
   */
  it('does not use the typed level label as a level id', () => {
    const record = recordUnderAttemptFrom(
      stateWith({ kilograms: '200', levelLabel: 'state' }),
      'squat',
    );

    expect(record?.scope.levelId).toBe('');
  });
});

describe('buildMeetRecord', () => {
  it('plans the competition route off the typed record', () => {
    const view = buildMeetRecord(stateWith({ kilograms: '200' }), 'squat', attemptOn());

    expect(view.plan.record?.kilograms).toBe(200);
    expect(view.plan.inCompetition.available).toBe(true);
  });

  it('refuses both routes with the mandatory sentence when nothing is typed', () => {
    const view = buildMeetRecord(EMPTY_RECORD_STATE, 'squat', attemptOn());

    expect(view.plan.inCompetition.available).toBe(false);
    expect(view.plan.asFourthAttempt.available).toBe(false);
    expect(view.plan.verifyWithOfficials).not.toBe('');
  });

  it('reports the sentence for a record figure that will not read', () => {
    const view = buildMeetRecord(stateWith({ kilograms: 'heavy' }), 'squat', attemptOn());

    expect(view.kilogramsReading.ok).toBe(false);
    expect(view.kilogramsReading.ok ? null : view.kilogramsReading.message).not.toBeNull();
  });

  it('says nothing under an empty field, which is where every plan starts', () => {
    const view = buildMeetRecord(EMPTY_RECORD_STATE, 'squat', attemptOn());

    expect(view.kilogramsReading.ok ? null : view.kilogramsReading.message).toBeNull();
  });

  it('charges the full loading increment when the record is below the meet level', () => {
    const below = buildMeetRecord(
      stateWith({ kilograms: '200', levelRelation: 'below-the-meet' }),
      'squat',
      attemptOn(),
    );
    const atOrAbove = buildMeetRecord(
      stateWith({ kilograms: '200', levelRelation: 'at-or-above-the-meet' }),
      'squat',
      attemptOn(),
    );

    expect(below.plan.targetKilograms).toBe(200.5);
    expect(atOrAbove.plan.targetKilograms).toBe(200.25);
  });

  /**
   * "Not sure" takes the domain's own default rather than the heavier rule. The
   * heavier one would tell the great majority of lifters -- who are at a meet of
   * their record's level or below it -- to load more than the record needs, on
   * every panel nobody has answered. What stops that being silent is
   * `relationAlternative`, and both figures stay on the plan either way.
   *
   * After a good third, because that is the state in which the answer moves a
   * weight: the fourth attempt carries the fractional exemption and can name
   * 200.25, and the competition attempt -- rounded onto the bar multiple that
   * *is* the full increment -- cannot. See the test below.
   */
  it('takes the lighter figure when the relation is unanswered, and says so', () => {
    const view = buildMeetRecord(
      stateWith({ kilograms: '200' }),
      'squat',
      attemptOn({ taken: takenThird('good') }),
    );

    expect(view.plan.targetKilograms).toBe(200.25);
    expect(view.relationAlternative).toBe(200.5);
  });

  /**
   * The finding that changed this field from a comparison of targets into a
   * comparison of routes, made by rendering it.
   *
   * On the planning screen the only open route is the competition attempt, whose
   * weight is rounded onto the ordinary bar multiple -- and the rule that charges
   * the full increment *is* that multiple, by `recordTargets`' own construction.
   * So the two conditions name two targets and one weight, and a caveat drawn off
   * the targets printed "it takes 200.5 kg instead" directly above a heading
   * already reading 200.5 kg, about a figure the answer could not move.
   */
  it('says nothing where the answer cannot move a weight the routes name', () => {
    const view = buildMeetRecord(stateWith({ kilograms: '200' }), 'squat', attemptOn());

    expect(view.plan.targets?.recordBelowMeetLevel?.kilograms).toBe(200.5);
    expect(view.relationAlternative).toBeNull();
  });

  /**
   * The other side of the test above, and the only one that reaches the caveat
   * through the *competition* route rather than through the fourth attempt.
   *
   * It takes a record off the bar multiple. On the grid the two conditions round
   * onto the same weight, which is what the test above pins; at 200.1 they do
   * not -- 200.35 ceils to 200.5 and 200.6 ceils to 201 -- so the answer moves a
   * weight on the one route a lifter has open before they have lifted anything.
   *
   * That matters beyond the arithmetic: the plan screen is where this fold is
   * read, and until this case existed every test of the caveat went through a
   * route that only opens after a good third. A caveat that worked only on the
   * platform would be missing from the Thursday-night screen it was written for.
   *
   * 200.1 is invented (§5.1) and off the grid on purpose. A published record
   * would sit on its own federation's multiple; a lifter reading one book at a
   * meet run under another is exactly how a record lands between the increments.
   */
  it('names the weight the answer moves on the competition route', () => {
    const view = buildMeetRecord(stateWith({ kilograms: '200.1' }), 'squat', attemptOn());

    expect(view.plan.inCompetition.available ? view.plan.inCompetition.route.kilograms : null).toBe(
      200.5,
    );
    expect(view.relationAlternative).toBe(201);
  });

  it('says nothing about the relation once it has been answered', () => {
    const view = buildMeetRecord(
      stateWith({ kilograms: '200', levelRelation: 'at-or-above-the-meet' }),
      'squat',
      attemptOn({ taken: takenThird('good') }),
    );

    expect(view.relationAlternative).toBeNull();
  });

  it('says nothing about the relation where the two conditions are the same weight', () => {
    const view = buildMeetRecord(stateWith({ kilograms: '200' }), 'squat', {
      ...attemptOn({ taken: takenThird('good') }),
      rules: rulesFor(),
    });

    expect(view.plan.targets?.recordBelowMeetLevel).toBeNull();
    expect(view.relationAlternative).toBeNull();
  });

  it('charges the margin over an unclaimed record, because no book grants a match', () => {
    const view = buildMeetRecord(
      stateWith({ kilograms: '200', unclaimed: true, levelLabel: 'state' }),
      'squat',
      attemptOn(),
    );

    expect(view.plan.targets?.recordAtOrAboveMeetLevel.basis).toBe('chip');
  });

  it('passes the banked total through for a total record', () => {
    const view = buildMeetRecord(
      stateWith({ kilograms: '500', totalFromOtherLifts: '340' }),
      'total',
      attemptOn({ lift: 'deadlift' }),
    );

    expect(view.isTotalRecord).toBe(true);
    expect(view.totalSoFarReading).toEqual({ ok: true, value: 340 });
  });

  /**
   * A total of zero is a lifter who has bombed every other lift, and offering
   * them a record attempt would be arithmetic dressed as advice. The blank field
   * has to reach the domain as `null` for it to refuse, and an empty string
   * coerced through `Number` would arrive as the zero it refuses to assume.
   */
  it('does not treat an untyped banked total as zero', () => {
    const supplied = buildMeetRecord(
      stateWith({ kilograms: '500', totalFromOtherLifts: '340' }),
      'total',
      attemptOn({ lift: 'deadlift' }),
    );
    const blank = buildMeetRecord(
      stateWith({ kilograms: '500' }),
      'total',
      attemptOn({ lift: 'deadlift' }),
    );

    expect(supplied.plan.inCompetition.available).toBe(true);
    expect(blank.plan.inCompetition.available).toBe(false);
    expect(blank.plan.inCompetition.available ? [] : blank.plan.inCompetition.reasons).toContain(
      'total-so-far-not-supplied',
    );
  });

  it('is not a total record for a lift', () => {
    expect(buildMeetRecord(EMPTY_RECORD_STATE, 'bench', attemptOn()).isTotalRecord).toBe(false);
  });
});

describe('subjects', () => {
  it('offers the meet lifts and the total', () => {
    expect(recordSubjectsIn('full-power')).toEqual(['squat', 'bench', 'deadlift', 'total']);
    expect(recordSubjectsIn('bench-only')).toEqual(['bench', 'total']);
  });

  it('clamps a picked subject the meet does not contest', () => {
    expect(recordSubjectIn(recordSubjectsIn('bench-only'), 'squat')).toBe('bench');
    expect(recordSubjectIn(recordSubjectsIn('bench-only'), 'total')).toBe('total');
  });

  it('has nothing to show for a meet contesting nothing', () => {
    expect(recordSubjectIn([], 'squat')).toBeNull();
  });

  /**
   * A total is not a total until every lift is over, so the attempt that raises
   * it past a record can only be the last one. Asserted on two formats because
   * "the last lift" and "the deadlift" are the same answer in a full-power meet
   * and a constant would pass that case.
   */
  it('takes a total record on the last lift of the meet', () => {
    expect(liftForSubject('total', 'full-power')).toBe('deadlift');
    expect(liftForSubject('total', 'bench-only')).toBe('bench');
    expect(liftForSubject('total', 'push-pull')).toBe('deadlift');
  });

  it('takes a lift record on that lift', () => {
    expect(liftForSubject('squat', 'full-power')).toBe('squat');
  });

  it('has no lift for a subject the meet does not contest', () => {
    expect(liftForSubject('squat', 'bench-only')).toBeNull();
  });
});

describe('holding the answers', () => {
  it('writes one subject and leaves the others alone', () => {
    const typed = stateWith({ kilograms: '200' });
    const states = withRecordFor(EMPTY_RECORD_STATES, 'bench', typed);

    expect(states.bench).toEqual(typed);
    for (const subject of RECORD_SUBJECTS.filter((candidate) => candidate !== 'bench')) {
      expect(states[subject]).toEqual(EMPTY_RECORD_STATE);
    }
  });

  it('keeps one lifter answers off another', () => {
    const all = withRecordForLifter(
      new Map(),
      'lifter-1',
      'squat',
      stateWith({ kilograms: '200' }),
    );

    expect(recordsFor(all, 'lifter-1').squat.kilograms).toBe('200');
    expect(recordsFor(all, 'lifter-2')).toEqual(EMPTY_RECORD_STATES);
  });

  /**
   * A lifter whose id is `constructor` reads back a function from a plain object,
   * and an id can arrive from an imported meet file. The `Map` simply does not
   * have the hole, and this pins it there.
   */
  it('reads back nothing for a lifter named after a prototype member', () => {
    expect(recordsFor(new Map(), 'constructor')).toEqual(EMPTY_RECORD_STATES);
  });
});

describe('reading a control value', () => {
  it('takes a subject the picker offers', () => {
    expect(recordSubjectFromValue('total')).toBe('total');
  });

  it('lands an unrecognised subject on one a control can show back', () => {
    expect(recordSubjectFromValue('clean-and-jerk')).toBe('squat');
  });

  it('takes a relation the control offers', () => {
    expect(recordLevelRelationFromValue('below-the-meet')).toBe('below-the-meet');
  });

  /**
   * The fallback is "not sure" and not either of the answers. An unrecognised
   * value is a control this file does not understand, and filing it under a
   * stated relation would put a rule on the bar that nobody chose.
   */
  it('lands an unrecognised relation on not sure', () => {
    expect(recordLevelRelationFromValue('above')).toBe('not-sure');
  });
});

/**
 * Whether a fold has anything in it, which decides whether §24's restore flags
 * it.
 *
 * The one caller is the planner's `#markRestored`, and what it does with the
 * answer is put `RECORD_RESTORED` over the figure. So a field left out of the
 * check reads a meet whose only answer was that field as never answered, and the
 * caveat goes missing on the one fold that has something to be stale about; a
 * check that answered `false` for an untouched state would put the caveat over
 * four empty boxes on the first meet anybody reopens. Both directions cost the
 * sentence its meaning, so both are pinned.
 */
describe('whether a record has been answered', () => {
  it('reads an untouched state as blank', () => {
    expect(isBlankRecord(EMPTY_RECORD_STATE)).toBe(true);
  });

  it('reads each field on its own as an answer', () => {
    // Invented figures (§5.1): no list this repository ships contains either.
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, kilograms: '182.5' })).toBe(false);
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, levelLabel: 'Masters 2' })).toBe(false);
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, unclaimed: true })).toBe(false);
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, totalFromOtherLifts: '410' })).toBe(false);
  });

  it('reads either stated relation as an answer', () => {
    // The one field with a non-empty default, so it is the one a check could
    // plausibly have skipped. A lifter who answered only where the record sits
    // relative to the meet has told the fold something worth flagging.
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, levelRelation: 'below-the-meet' })).toBe(false);
    expect(isBlankRecord({ ...EMPTY_RECORD_STATE, levelRelation: 'at-or-above-the-meet' })).toBe(
      false,
    );
  });

  it('reads a state rebuilt through JSON as blank', () => {
    // Why this is structural rather than `state === EMPTY_RECORD_STATE`. Every
    // state the caller sees came off a file through `JSON.parse`, so an identity
    // check would answer `false` for all four subjects of every restored meet.
    const parsed: unknown = JSON.parse(JSON.stringify(EMPTY_RECORD_STATE));
    expect(parsed).not.toBe(EMPTY_RECORD_STATE);
    expect(isBlankRecord(parsed as MeetRecordState)).toBe(true);
  });
});
