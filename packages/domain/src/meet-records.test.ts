// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type {
  FederationRecord,
  MeetRuleProfile,
  RecordScope,
} from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { FOURTH_ATTEMPT_FIXTURE, rulesFor } from './meet-profile.fixture.js';
import {
  VERIFY_WITH_OFFICIALS,
  recordPlan,
  type RecordPlanRequest,
  type RecordRouteAnswer,
} from './meet-records.js';
import type { TakenAttempt } from './meet-rules.js';
import type { RecordMarginRules } from './records.js';

/**
 * Nothing in this suite writes a weight out that the fixtures could have derived.
 *
 * The fixture federation loads in multiples of 2 kg and chips records by 0.25, and
 * both figures are unlike either published profile on purpose (see
 * `meet-profile.fixture.ts`). An expected weight typed in as `202` would pass here
 * and would pass just as well against a hard-coded 2.5 somewhere in the module, so
 * every figure below is computed from the record and the profile.
 */
const SCOPE: RecordScope = {
  levelId: 'state',
  regionId: 'example-region',
  sex: 'female',
  equipmentId: 'raw',
  disciplineId: 'full-power',
  weightClassId: 'f-60',
  divisionId: 'open',
  tested: true,
  lift: 'deadlift',
};

/** A record on a figure deliberately off the bar multiple, which is where records sit. */
const RECORD_KILOGRAMS = 200.5;

function record(patch: Partial<FederationRecord> = {}): FederationRecord {
  return {
    id: 'example-record',
    scope: SCOPE,
    kilograms: RECORD_KILOGRAMS,
    unclaimed: false,
    sourceDisagreement: null,
    holderName: 'A Lifter',
    achievedOn: '2025-06-01',
    meetName: 'Example Open',
    ...patch,
  };
}

/**
 * Margins unlike the rulebook fixture's, so a module reading the wrong one shows.
 *
 * `minimumIncrementKilograms` is 0.5 against the profile's 0.25 fourth-attempt
 * excess: the two published sources disagree by construction, because they do
 * disagree in the world and the interesting behaviour is what happens then.
 */
const MARGINS: RecordMarginRules = {
  minimumIncrementKilograms: 0.5,
  higherSanctionIncrementKilograms: 5,
  matchTakesUnclaimedLevelIds: [],
};

/**
 * The fixture's record window, narrowed once rather than at every use.
 *
 * The field is nullable because a federation may offer a fourth attempt with no
 * window at all, and a suite that reached for `!` here would go on compiling after
 * the fixture stopped having one -- against a `NaN` weight that fails every
 * comparison quietly.
 */
const RECORD_WINDOW_KILOGRAMS = FOURTH_ATTEMPT_FIXTURE.withinKilogramsOfRecord;
if (RECORD_WINDOW_KILOGRAMS === null) {
  throw new Error('The fixture is expected to publish a record window.');
}

/** The two published margins made to agree, for the tests that are not about that. */
const AGREEING_MARGINS: RecordMarginRules = {
  ...MARGINS,
  minimumIncrementKilograms: FOURTH_ATTEMPT_FIXTURE.minimumExcessKilograms,
};

function taken(...attempts: readonly (readonly [number, number, TakenAttempt['outcome']])[]) {
  return attempts.map(([attemptNumber, kilograms, outcome]) => ({
    attemptNumber,
    kilograms,
    outcome,
  }));
}

/** Three attempts ending in a good third close enough to the record to qualify. */
function goodThirdNearTheRecord(): readonly TakenAttempt[] {
  const third = RECORD_KILOGRAMS - 4;
  return taken([1, third - 10, 'good'], [2, third - 5, 'good'], [3, third, 'good']);
}

/**
 * Two good attempts with the third still to come.
 *
 * The competition route and the fourth-attempt route are never open to the same
 * lifter at the same moment -- one needs an attempt left and the other needs the
 * lift to be over -- so the tests that compare them compare two plans.
 */
function thirdStillToCome(): readonly TakenAttempt[] {
  return taken([1, RECORD_KILOGRAMS - 14, 'good'], [2, RECORD_KILOGRAMS - 9, 'good']);
}

function planFor(patch: Partial<RecordPlanRequest> = {}) {
  return recordPlan({
    record: record(),
    marginRules: AGREEING_MARGINS,
    rules: rulesFor(),
    lift: 'deadlift',
    taken: [],
    ...patch,
  });
}

function routeWeight(answer: RecordRouteAnswer): number | null {
  return answer.available ? answer.route.kilograms : null;
}

function blockedBy(answer: RecordRouteAnswer): readonly string[] {
  return answer.available ? [] : answer.reasons;
}

describe('recordPlan', () => {
  it('carries the mandatory sentence on every plan, including the refusals', () => {
    // A screen with no record on it is still a screen somebody acts on.
    for (const plan of [planFor(), planFor({ record: null })]) {
      expect(plan.verifyWithOfficials).toBe(VERIFY_WITH_OFFICIALS);
    }
  });

  it('answers with a reason rather than a weight when no record was supplied', () => {
    const plan = planFor({ record: null });
    expect(plan.targets).toBeNull();
    expect(plan.targetKilograms).toBeNull();
    expect(blockedBy(plan.inCompetition)).toEqual(['no-record-supplied']);
    expect(blockedBy(plan.asFourthAttempt)).toEqual(['no-record-supplied']);
  });

  describe('the two routes are not the same weight', () => {
    it('rounds the competition attempt onto the bar multiple and leaves the fourth off it', () => {
      const rules = rulesFor();
      const before = planFor({ rules, taken: thirdStillToCome() });
      const after = planFor({ rules, taken: goodThirdNearTheRecord() });
      const chipped = after.targetKilograms;
      expect(chipped).not.toBeNull();
      expect(before.targetKilograms).toBe(chipped);

      // The fourth attempt is the record exemption: it sits where the chip lands.
      expect(routeWeight(after.asFourthAttempt)).toBe(chipped);
      // The competition attempt has no exemption, so it is the first legal bar
      // weight at or above the same figure -- strictly heavier here, because a
      // chipped record does not land on the multiple.
      expect(routeWeight(before.inCompetition)).toBe(rules.ceilToLegal(chipped ?? 0));
      expect(routeWeight(before.inCompetition)).toBeGreaterThan(chipped ?? 0);
    });

    it('reports what each route is worth, not only what it weighs', () => {
      const before = planFor({ taken: thirdStillToCome() });
      const after = planFor({ taken: goodThirdNearTheRecord() });
      expect(before.inCompetition.available && before.inCompetition.route.countsTowardTotal).toBe(
        true,
      );
      expect(before.inCompetition.available && before.inCompetition.route.excludedFrom).toEqual([]);
      expect(after.asFourthAttempt.available && after.asFourthAttempt.route.countsTowardTotal).toBe(
        false,
      );
      expect(after.asFourthAttempt.available && after.asFourthAttempt.route.excludedFrom).toEqual(
        FOURTH_ATTEMPT_FIXTURE.excludedFrom,
      );
    });

    it('passes the profile through for permission, the equipment check and the deadline', () => {
      const after = planFor({ taken: goodThirdNearTheRecord() });
      expect(after.asFourthAttempt.available && after.asFourthAttempt.route).toMatchObject({
        requiresPermission: FOURTH_ATTEMPT_FIXTURE.requiresPermission,
        requiresPostLiftEquipmentCheck: FOURTH_ATTEMPT_FIXTURE.requiresPostLiftEquipmentCheck,
        submissionSeconds: FOURTH_ATTEMPT_FIXTURE.submissionSeconds,
      });
      // The competition attempt runs on the ordinary window, not the record one,
      // and asks nobody's permission.
      const before = planFor({ taken: thirdStillToCome() });
      expect(before.inCompetition.available && before.inCompetition.route).toMatchObject({
        requiresPermission: false,
        requiresPostLiftEquipmentCheck: false,
        submissionSeconds: rulesFor().profile.submissionSeconds,
      });
    });
  });

  describe('the competition route', () => {
    it('clears the floors the rules already impose', () => {
      // A third attempt heavier than the record target: the record is behind the
      // lifter and the next legal attempt is the progression, not the chip.
      const rules = rulesFor();
      const heavy = rules.ceilToLegal(RECORD_KILOGRAMS + 20);
      const plan = planFor({
        rules,
        taken: taken([1, heavy - 10, 'good'], [2, heavy - 4, 'good']),
      });
      const bounds = rules.nextAttemptBounds(
        taken([1, heavy - 10, 'good'], [2, heavy - 4, 'good']),
      );
      expect(routeWeight(plan.inCompetition)).toBe(rules.ceilToLegal(bounds.minimumKilograms));
    });

    it('closes once every competition attempt has been taken', () => {
      const plan = planFor({ taken: goodThirdNearTheRecord() });
      const attemptsPerLift = rulesFor().profile.attemptsPerLift;
      expect(goodThirdNearTheRecord()).toHaveLength(attemptsPerLift);
      expect(blockedBy(plan.inCompetition)).toEqual(['no-competition-attempts-left']);
    });
  });

  describe('the fourth-attempt route', () => {
    it('refuses before the third attempt has happened', () => {
      const plan = planFor({ taken: thirdStillToCome() });
      expect(blockedBy(plan.asFourthAttempt)).toEqual(['no-third-attempt-yet']);
      // And the competition route is open at the same moment, which is the point:
      // the two are never available together.
      expect(plan.inCompetition.available).toBe(true);
    });

    it('passes every eligibility refusal through at once', () => {
      // A missed third, far below the record: two reasons, and fixing one of them
      // changes nothing.
      const plan = planFor({
        taken: taken(
          [1, 100, 'good'],
          [2, 110, 'good'],
          [3, RECORD_KILOGRAMS - RECORD_WINDOW_KILOGRAMS - 5, 'no-lift'],
        ),
      });
      expect(blockedBy(plan.asFourthAttempt)).toEqual([
        'third-attempt-not-successful',
        'outside-the-record-window',
      ]);
    });

    it('refuses when the federation has no fourth attempt at all', () => {
      const plan = planFor({
        rules: rulesFor({ fourthAttempt: null }),
        taken: goodThirdNearTheRecord(),
      });
      expect(blockedBy(plan.asFourthAttempt)).toEqual(['not-offered']);
      // The competition route is a different question and is closed for a
      // different reason: this lifter has taken all three.
      expect(blockedBy(plan.inCompetition)).toEqual(['no-competition-attempts-left']);
    });
  });

  describe('a total record', () => {
    /**
     * A total figure rather than a lift figure, and that is what the tests turn on.
     *
     * A total record set at a deadlift's weight would let a module comparing the
     * record against a single third attempt pass every check by accident.
     */
    const TOTAL_RECORD_KILOGRAMS = 500.5;
    const totalRecord = record({
      kilograms: TOTAL_RECORD_KILOGRAMS,
      scope: { ...SCOPE, lift: 'total' },
    });

    it('cannot be taken on a fourth attempt the profile excludes from the total', () => {
      const plan = planFor({
        record: totalRecord,
        taken: goodThirdNearTheRecord(),
        totalFromOtherLiftsKilograms: 300,
      });
      expect(FOURTH_ATTEMPT_FIXTURE.excludedFrom).toContain('total');
      expect(blockedBy(plan.asFourthAttempt)).toEqual(['fourth-attempt-excluded-from-the-total']);
    });

    it('is available on a fourth attempt where the profile does count it', () => {
      // The control for the test above: the refusal has to come from the profile
      // field and not from the record being a total record.
      const counted: MeetRuleProfile['fourthAttempt'] = {
        ...FOURTH_ATTEMPT_FIXTURE,
        excludedFrom: ['placing'],
        withinKilogramsOfRecord: null,
      };
      const plan = planFor({
        record: totalRecord,
        rules: rulesFor({ fourthAttempt: counted }),
        taken: goodThirdNearTheRecord(),
        totalFromOtherLiftsKilograms: 300,
      });
      expect(plan.asFourthAttempt.available).toBe(true);
      expect(plan.asFourthAttempt.available && plan.asFourthAttempt.route.countsTowardTotal).toBe(
        true,
      );
    });

    it('asks for the weight on the bar and reports the total it reaches', () => {
      const plan = planFor({
        record: totalRecord,
        taken: taken([1, 150, 'good']),
        totalFromOtherLiftsKilograms: 300,
      });
      const target = plan.targetKilograms ?? 0;
      const route = plan.inCompetition.available ? plan.inCompetition.route : null;
      expect(route).not.toBeNull();
      // The bar holds the shortfall, not the record.
      expect(route?.kilograms).toBeLessThan(target);
      expect(route?.reachesTotalKilograms ?? 0).toBeGreaterThanOrEqual(target);
    });

    it('refuses rather than assuming the rest of the total is zero', () => {
      // Zero would be arithmetic dressed as advice: it is a lifter who bombed.
      const plan = planFor({ record: totalRecord, taken: taken([1, 150, 'good']) });
      expect(blockedBy(plan.inCompetition)).toEqual(['total-so-far-not-supplied']);
    });

    it('measures the eligibility window against the total, not against the third attempt', () => {
      // Handed the raw third attempt, the window compares a 500.5 kg total record
      // against a 196.5 kg deadlift and refuses every lifter alive as three
      // hundred kilograms short -- a unit mismatch reported as a fact about the
      // lifter. `inside` is the case that fails under that bug.
      const counted: MeetRuleProfile['fourthAttempt'] = {
        ...FOURTH_ATTEMPT_FIXTURE,
        excludedFrom: ['placing'],
      };
      const rules = rulesFor({ fourthAttempt: counted });
      const third = goodThirdNearTheRecord();
      const best = Math.max(...third.map((attempt) => attempt.kilograms));
      const inside = planFor({
        record: totalRecord,
        rules,
        taken: third,
        totalFromOtherLiftsKilograms: TOTAL_RECORD_KILOGRAMS - best - 1,
      });
      // The control, so the assertion above cannot pass by the window being
      // switched off: the same lifter with nothing banked really is out of range.
      const outside = planFor({
        record: totalRecord,
        rules,
        taken: third,
        totalFromOtherLiftsKilograms: 0,
      });
      expect(inside.asFourthAttempt.available).toBe(true);
      expect(blockedBy(outside.asFourthAttempt)).toEqual(['outside-the-record-window']);
    });
  });

  describe('the two published margins', () => {
    it('takes the heavier and names which source it came from', () => {
      const heavierBook = planFor({ marginRules: MARGINS, taken: goodThirdNearTheRecord() });
      expect(MARGINS.minimumIncrementKilograms).toBeGreaterThan(
        FOURTH_ATTEMPT_FIXTURE.minimumExcessKilograms,
      );
      expect(
        heavierBook.asFourthAttempt.available && heavierBook.asFourthAttempt.route,
      ).toMatchObject({ marginSource: 'record-book' });

      const heavierRulebook = planFor({
        marginRules: { ...MARGINS, minimumIncrementKilograms: 0 },
        taken: goodThirdNearTheRecord(),
      });
      expect(
        heavierRulebook.asFourthAttempt.available && heavierRulebook.asFourthAttempt.route,
      ).toMatchObject({ marginSource: 'rulebook' });
    });

    it('says nothing when they agree', () => {
      const plan = planFor({ taken: goodThirdNearTheRecord() });
      expect(plan.asFourthAttempt.available && plan.asFourthAttempt.route.marginSource).toBe(
        'they-agree',
      );
      expect(plan.advisories.map((advisory) => advisory.code)).not.toContain(
        'published-margins-disagree',
      );
    });

    it('keeps the heavier figure loadable on the record progression grid', () => {
      // A book margin that lands between two record steps: taking the maximum
      // without rounding names a weight the bar cannot make.
      const rules = rulesFor();
      const step = rules.profile.recordProgressionKilograms ?? rules.profile.barMultipleKilograms;
      const plan = planFor({
        marginRules: { ...MARGINS, minimumIncrementKilograms: step * 1.5 },
        taken: goodThirdNearTheRecord(),
      });
      const kilograms = routeWeight(plan.asFourthAttempt) ?? 0;
      expect(Math.round((kilograms / step) * 1000) % 1000).toBe(0);
    });
  });

  describe('what it says out loud', () => {
    it('flags a record measured on another lift', () => {
      const plan = planFor({ lift: 'squat' });
      expect(plan.advisories.map((advisory) => advisory.code)).toContain(
        'record-is-for-another-lift',
      );
      // The control: the same record against its own lift says nothing.
      expect(planFor().advisories.map((advisory) => advisory.code)).not.toContain(
        'record-is-for-another-lift',
      );
    });

    it('flags a source that contradicts itself', () => {
      const plan = planFor({
        record: record({ sourceDisagreement: { pounds: 147.7, impliedKilograms: 67 } }),
      });
      expect(plan.advisories.map((advisory) => advisory.code)).toContain(
        'source-contradicts-itself',
      );
    });

    it('says when nothing on screen can cite the source, and stops once it can', () => {
      expect(planFor().advisories.map((advisory) => advisory.code)).toContain('source-unknown');
      const cited = planFor({
        provenance: {
          sourceUrl: 'https://example.test/records/',
          retrievedAt: '2026-08-01T00:00:00Z',
        },
      });
      expect(cited.advisories.map((advisory) => advisory.code)).not.toContain('source-unknown');
    });

    it('says when there is no route left today', () => {
      const plan = planFor({
        rules: rulesFor({ fourthAttempt: null }),
        taken: goodThirdNearTheRecord(),
      });
      expect(plan.advisories.map((advisory) => advisory.code)).toContain('no-route-to-the-record');
    });
  });

  describe('the qualifying attempt', () => {
    it('is reported whatever the route decided', () => {
      const qualified = planFor({ taken: goodThirdNearTheRecord() }).qualifyingAttempt;
      expect(qualified.qualified).toBe(true);
      expect(qualified.attempt?.attemptNumber).toBe(rulesFor().profile.attemptsPerLift);

      const missed = planFor({
        taken: taken([1, 100, 'good'], [2, 110, 'good'], [3, RECORD_KILOGRAMS - 4, 'no-lift']),
      }).qualifyingAttempt;
      expect(missed.qualified).toBe(false);
      expect(missed.reasons).toEqual(['third-attempt-not-successful']);
    });

    it('distinguishes a lifter who lost the chance from one who never had it', () => {
      // Both are ineligible and they want opposite advice.
      const lostIt = planFor({
        taken: taken([1, 100, 'good'], [2, 110, 'good'], [3, RECORD_KILOGRAMS - 4, 'no-lift']),
      }).qualifyingAttempt;
      const neverHadIt = planFor({ taken: taken([1, 100, 'good']) }).qualifyingAttempt;
      expect(lostIt.attempt).not.toBeNull();
      expect(neverHadIt.attempt).toBeNull();
      expect(neverHadIt.reasons).toEqual([]);
    });
  });

  describe('the condition the record sits under', () => {
    it('defaults to the record at or above the meet level, and takes the other on request', () => {
      const atOrAbove = planFor();
      const below = planFor({ marginRules: MARGINS, recordIsBelowMeetLevel: true });
      expect(atOrAbove.targetKilograms).toBe(
        atOrAbove.targets?.recordAtOrAboveMeetLevel.kilograms ?? null,
      );
      expect(below.targetKilograms).toBe(below.targets?.recordBelowMeetLevel?.kilograms ?? null);
      expect(below.targetKilograms ?? 0).toBeGreaterThan(atOrAbove.targetKilograms ?? 0);
    });

    it('falls back rather than answering null when the book draws no such distinction', () => {
      const plan = planFor({
        marginRules: { ...MARGINS, higherSanctionIncrementKilograms: null },
        recordIsBelowMeetLevel: true,
      });
      expect(plan.targets?.recordBelowMeetLevel).toBeNull();
      expect(plan.targetKilograms).toBe(plan.targets?.recordAtOrAboveMeetLevel.kilograms ?? null);
    });
  });
});
