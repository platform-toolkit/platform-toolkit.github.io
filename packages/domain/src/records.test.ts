// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { FederationRecord, RecordScope } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import {
  findRecord,
  recordTargets,
  standingAgainstRecord,
  type RecordMarginRules,
} from './records.js';

const SCOPE: RecordScope = {
  levelId: 'state',
  regionId: 'example-region',
  sex: 'female',
  equipmentId: 'raw',
  disciplineId: 'full-power',
  weightClassId: 'f-60',
  divisionId: 'open',
  tested: true,
  lift: 'total',
};

function record(id: string, kilograms: number, scope: Partial<RecordScope> = {}): FederationRecord {
  return {
    id,
    scope: { ...SCOPE, ...scope },
    kilograms,
    unclaimed: false,
    sourceDisagreement: null,
    holderName: null,
    achievedOn: null,
    meetName: null,
  };
}

describe('findRecord', () => {
  it('returns the record for an exactly matching category', () => {
    const target = record('target', 400);
    expect(findRecord(SCOPE, [record('other', 500, { lift: 'squat' }), target])).toEqual({
      ok: true,
      record: target,
    });
  });

  it('does not fall back to a neighbouring category', () => {
    // A record is a fact about one category. Showing a lifter the untested record
    // because the tested one is missing would compare them against a lift nobody
    // in their category has made.
    for (const difference of [
      { tested: false },
      { equipmentId: 'single-ply' },
      { weightClassId: 'f-67.5' },
      { divisionId: 'master-1' },
      { levelId: 'national' },
      { lift: 'bench' as const },
      { sex: 'male' as const },
      { disciplineId: 'bench-only' },
    ]) {
      expect(
        findRecord(SCOPE, [record('near', 400, difference)]),
        JSON.stringify(difference),
      ).toEqual({ ok: false, reason: 'no-match' });
    }
  });

  it('treats a region as part of the identity of a record', () => {
    // Two states keep separate records at the same level.
    expect(findRecord(SCOPE, [record('elsewhere', 400, { regionId: 'other-region' })])).toEqual({
      ok: false,
      reason: 'no-match',
    });
  });

  it('reports no match for an empty book', () => {
    expect(findRecord(SCOPE, [])).toEqual({ ok: false, reason: 'no-match' });
  });

  it('reports two records for one category rather than picking one', () => {
    // They cannot both be current, and choosing the first would hide that.
    expect(findRecord(SCOPE, [record('a', 400), record('b', 410)])).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });
});

/**
 * The margins, invented but shaped like a real rulebook's.
 *
 * A margin smaller than the higher-sanction one, and the two unequal, so that a
 * test cannot pass by reading either figure where the other belongs.
 */
function rules(overrides: Partial<RecordMarginRules> = {}): RecordMarginRules {
  return {
    minimumIncrementKilograms: 0.5,
    higherSanctionIncrementKilograms: 2.5,
    matchTakesUnclaimedLevelIds: [],
    ...overrides,
  };
}

describe('recordTargets', () => {
  const existing = record('existing', 400);
  const seeded: FederationRecord = { ...record('seeded', 400), unclaimed: true };

  it('chips a record somebody holds, at or above the meet level', () => {
    expect(recordTargets(existing, rules()).recordAtOrAboveMeetLevel).toEqual({
      kilograms: 400.5,
      basis: 'chip',
    });
  });

  it('asks the full increment for a record below the meet level', () => {
    expect(recordTargets(existing, rules()).recordBelowMeetLevel).toEqual({
      kilograms: 402.5,
      basis: 'full-increment',
    });
  });

  it('chips from the record as published, not from the next bar multiple', () => {
    // The rule that makes a record attempt exempt from loading in round jumps.
    // A 200.5 kg record is taken at 201; rounding to 202.5 asks for weight the
    // rulebook does not.
    const fractional = record('fractional', 200.5);

    expect(recordTargets(fractional, rules()).recordAtOrAboveMeetLevel.kilograms).toBe(201);
  });

  it('asks a level down for a weight that is both loadable and clear of the record', () => {
    // The exemption is withdrawn by the same sentence that imposes the full
    // increment, so both conditions bind. Against 200.5, the answer 203 clears
    // the margin but cannot be loaded, and 202.5 loads but clears the record by
    // 2 -- either one hands back the record on a technicality.
    const fractional = record('fractional', 200.5);

    expect(recordTargets(fractional, rules()).recordBelowMeetLevel?.kilograms).toBe(205);
  });

  it('does not inflate a record that is already an ordinary multiple', () => {
    // Rounding up after adding the increment would turn 400 into 405 and cost a
    // lifter a 2.5 kg jump they never needed. 402.5 is already loadable.
    expect(recordTargets(record('round', 400), rules()).recordBelowMeetLevel?.kilograms).toBe(
      402.5,
    );
  });

  it('omits the second figure where the book draws no such distinction', () => {
    const targets = recordTargets(existing, rules({ higherSanctionIncrementKilograms: null }));
    expect(targets.recordBelowMeetLevel).toBeNull();
  });

  it('omits the second figure when it would repeat the first', () => {
    // Two identical weights under two conditions reads as a rule the lifter has
    // failed to understand rather than as one that does not bite here.
    const targets = recordTargets(existing, rules({ higherSanctionIncrementKilograms: 0.5 }));
    expect(targets.recordBelowMeetLevel).toBeNull();
  });

  it('lets a seeded standard be matched at a level the book names', () => {
    // The record's own level is `state`, per SCOPE.
    const targets = recordTargets(seeded, rules({ matchTakesUnclaimedLevelIds: ['state'] }));
    expect(targets.recordAtOrAboveMeetLevel).toEqual({ kilograms: 400, basis: 'match' });
  });

  it('still asks for the margin over a seeded standard at a level the book omits', () => {
    // The safe direction. Being asked for more than the rules demand costs an
    // attempt; being asked for less costs the record.
    const targets = recordTargets(seeded, rules({ matchTakesUnclaimedLevelIds: ['national'] }));
    expect(targets.recordAtOrAboveMeetLevel).toEqual({ kilograms: 400.5, basis: 'chip' });
  });

  it('never lets matching apply to a record somebody holds', () => {
    const targets = recordTargets(existing, rules({ matchTakesUnclaimedLevelIds: ['state'] }));
    expect(targets.recordAtOrAboveMeetLevel.basis).toBe('chip');
  });

  it('keeps the stricter figure where matching and sanction level overlap', () => {
    // A seeded record that may be matched where it is kept is still a record
    // below the sanction level of a meet held above it, and a preset carries no
    // exemption from that.
    const targets = recordTargets(seeded, rules({ matchTakesUnclaimedLevelIds: ['state'] }));
    expect(targets.recordBelowMeetLevel).toEqual({ kilograms: 402.5, basis: 'full-increment' });
  });

  it('refuses a margin that could not have come from a rulebook', () => {
    expect(() => recordTargets(existing, rules({ minimumIncrementKilograms: -1 }))).toThrow(
      RangeError,
    );
    expect(() => recordTargets(existing, rules({ higherSanctionIncrementKilograms: -1 }))).toThrow(
      RangeError,
    );
  });
});

describe('standingAgainstRecord', () => {
  const existing = record('existing', 400);

  it('requires the margin the book asks for', () => {
    const standing = standingAgainstRecord(400, existing, rules());
    expect(standing.kilogramsToReplace).toBe(400.5);
    expect(standing.wouldReplace).toBe(false);
    expect(standing.kilogramsRemaining).toBe(0.5);
  });

  it('measures against the chip, not the full increment', () => {
    // The lifter is at a meet the record's level is at or above unless they say
    // otherwise, and this code cannot see which meet that is.
    expect(standingAgainstRecord(401, existing, rules()).wouldReplace).toBe(true);
  });

  it('lets a matching lift replace the record when the book asks for no margin', () => {
    const standing = standingAgainstRecord(400, existing, rules({ minimumIncrementKilograms: 0 }));
    expect(standing.wouldReplace).toBe(true);
    expect(standing.kilogramsRemaining).toBeNull();
  });

  it('reports a lift past the record as replacing it', () => {
    const standing = standingAgainstRecord(450, existing, rules());
    expect(standing.wouldReplace).toBe(true);
    expect(standing.kilogramsRemaining).toBeNull();
  });

  it('rounds the work remaining up, never down', () => {
    // 400.5 - 397.505 is 2.9949999999999903. A lifter told 2.99 who adds exactly
    // that has not replaced the record.
    expect(standingAgainstRecord(397.505, existing, rules()).kilogramsRemaining).toBe(3);
  });

  it('does not leak binary floating point into the target', () => {
    expect(String(standingAgainstRecord(100, record('r', 227.3), rules()).kilogramsToReplace)).toBe(
      '227.8',
    );
  });

  it('refuses a lift or a margin that could not have come from a platform', () => {
    expect(() => standingAgainstRecord(0, existing, rules())).toThrow(RangeError);
    expect(() => standingAgainstRecord(Number.NaN, existing, rules())).toThrow(RangeError);
    expect(() =>
      standingAgainstRecord(400, existing, rules({ minimumIncrementKilograms: -1 })),
    ).toThrow(RangeError);
  });
});
