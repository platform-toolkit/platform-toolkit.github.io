import type { FederationRecord, RecordScope } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { findRecord, standingAgainstRecord } from './records.js';

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

describe('standingAgainstRecord', () => {
  const existing = record('existing', 400);

  it('requires the margin the book asks for', () => {
    const standing = standingAgainstRecord(400, existing, 0.5);
    expect(standing.kilogramsToReplace).toBe(400.5);
    expect(standing.wouldReplace).toBe(false);
    expect(standing.kilogramsRemaining).toBe(0.5);
  });

  it('lets a matching lift replace the record when the book asks for no margin', () => {
    const standing = standingAgainstRecord(400, existing, 0);
    expect(standing.wouldReplace).toBe(true);
    expect(standing.kilogramsRemaining).toBeNull();
  });

  it('reports a lift past the record as replacing it', () => {
    const standing = standingAgainstRecord(450, existing, 0.5);
    expect(standing.wouldReplace).toBe(true);
    expect(standing.kilogramsRemaining).toBeNull();
  });

  it('rounds the work remaining up, never down', () => {
    // 400.5 - 397.505 is 2.9949999999999903. A lifter told 2.99 who adds exactly
    // that has not replaced the record.
    expect(standingAgainstRecord(397.505, existing, 0.5).kilogramsRemaining).toBe(3);
  });

  it('does not leak binary floating point into the target', () => {
    expect(String(standingAgainstRecord(100, record('r', 227.3), 0.5).kilogramsToReplace)).toBe(
      '227.8',
    );
  });

  it('refuses a lift or a margin that could not have come from a platform', () => {
    expect(() => standingAgainstRecord(0, existing, 0.5)).toThrow(RangeError);
    expect(() => standingAgainstRecord(Number.NaN, existing, 0.5)).toThrow(RangeError);
    expect(() => standingAgainstRecord(400, existing, -1)).toThrow(RangeError);
  });
});
