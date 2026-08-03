// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { MeetRuleBookSchema, MeetRuleProfileSchema } from './meet-rules.js';

/**
 * An invented federation, deliberately not either published profile.
 *
 * Every figure here is made up, for the reason §5.1 gives: a fixture holding a
 * real federation's numbers is a second copy of those numbers, it reads as
 * authoritative to whoever finds it, and it keeps asserting the old rule for
 * years after the rulebook moved. The shape is what these tests are about.
 */
const PROFILE = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Technical Rules',
    url: 'https://example.test/rulebook/',
    revision: '2026v1',
    verifiedOn: '2026-08-01',
  },
  attemptsPerLift: 3,
  barMultipleKilograms: 2,
  minimumProgressionKilograms: 2,
  recordProgressionKilograms: 0.25,
  submissionSeconds: 90,
  automaticAfterGoodLift: 'increase-by-increment',
  automaticAfterMiss: 'repeat',
  forbidsAttemptBelowFailedWeight: true,
  risingBar: true,
  openerChange: {
    allowed: 1,
    firstGroupMinutesBefore: 4,
    laterGroupAttemptsBefore: 6,
    summary: 'One change, up to four minutes before the first round of that lift.',
  },
  secondAttemptChangesAllowed: 0,
  thirdAttemptChanges: [
    {
      lift: 'deadlift',
      allowed: 2,
      lapsesOnceCalledToLoadedBar: true,
      notBelowPrecedingLifter: true,
    },
  ],
  formatOverrides: [],
  fourthAttempt: null,
  tieBreak: ['lighter-bodyweight'],
  notes: [],
};

function parsesProfile(candidate: unknown): boolean {
  return v.safeParse(MeetRuleProfileSchema, candidate).success;
}

describe('MeetRuleProfileSchema', () => {
  it('accepts a profile with its source and no fourth attempt', () => {
    // The no-fourth-attempt case is the acceptance test rather than an edge case:
    // one of the two federations published from this repository does not have
    // them, and a contract that required the block would have forced a fabricated
    // one -- which renders as a fourth attempt nobody may take.
    expect(parsesProfile(PROFILE)).toBe(true);
  });

  it.each([
    ['a missing rulebook revision', { revision: undefined }],
    ['an empty rulebook revision', { revision: '' }],
    ['a missing verification date', { verifiedOn: undefined }],
    ['a verification date that is not a date', { verifiedOn: 'last spring' }],
  ])('refuses a profile with %s', (_case, patch) => {
    // Provenance is the difference between an aid and a claim. A profile that
    // cannot say which rulebook it is or when somebody last read it is a set of
    // numbers presented as a federation's rules.
    expect(parsesProfile({ ...PROFILE, source: { ...PROFILE.source, ...patch } })).toBe(false);
  });

  it.each([
    ['http', 'http://example.test/rulebook/'],
    ['a script URL', 'javascript:alert(1)'],
    ['a protocol-relative URL', '//example.test/rulebook/'],
  ])('refuses a citation link using %s', (_case, url) => {
    // The link lands in an `href` under a rule a lifter is reading at a meet.
    // `v.url()` alone accepts the second of these.
    expect(parsesProfile({ ...PROFILE, source: { ...PROFILE.source, url } })).toBe(false);
  });

  it.each([
    ['a zero bar multiple', { barMultipleKilograms: 0 }],
    ['a zero progression', { minimumProgressionKilograms: 0 }],
    ['a negative progression', { minimumProgressionKilograms: -2.5 }],
    ['a zero record progression', { recordProgressionKilograms: 0 }],
  ])('refuses %s', (_case, patch) => {
    // Every one of these is an increment something downstream steps by. A zero
    // makes the ladder of legal weights either infinite or empty, and neither
    // failure looks like a bad number when it happens.
    expect(parsesProfile({ ...PROFILE, ...patch })).toBe(false);
  });

  it('refuses a submission window of no time at all', () => {
    expect(parsesProfile({ ...PROFILE, submissionSeconds: 0 })).toBe(false);
  });

  it('refuses a profile that says nothing about third-attempt changes', () => {
    // Silence here would be read by the domain as "no lift may be changed", which
    // is a rule no federation has and would hide the third deadlift change that
    // §32.9 exists for.
    expect(parsesProfile({ ...PROFILE, thirdAttemptChanges: [] })).toBe(false);
  });

  it('refuses a profile with no tie-break sequence', () => {
    expect(parsesProfile({ ...PROFILE, tieBreak: [] })).toBe(false);
  });

  it('refuses an automatic behaviour it has not been taught', () => {
    // Not a free-text field on purpose. A new behaviour has to be added to the
    // picklist, which makes the arithmetic in the domain fail to compile until it
    // has been taught the case -- rather than rendering a sentence over the old
    // rule.
    expect(parsesProfile({ ...PROFILE, automaticAfterMiss: 'lifter-choice' })).toBe(false);
  });

  it('refuses a third-attempt rule about the total', () => {
    // `total` is in the record contract's lift list and must not be in this one.
    // "How many times may a third total be changed" is not a question.
    expect(
      parsesProfile({
        ...PROFILE,
        thirdAttemptChanges: [{ ...PROFILE.thirdAttemptChanges[0], lift: 'total' }],
      }),
    ).toBe(false);
  });

  it('accepts a fourth attempt that counts toward nothing', () => {
    const withFourth = {
      ...PROFILE,
      fourthAttempt: {
        requiresSuccessfulThird: true,
        withinKilogramsOfRecord: 15,
        minimumExcessKilograms: 0.25,
        requiresPermission: true,
        submissionSeconds: 90,
        excludedFrom: ['total', 'placing', 'classification', 'team-points', 'best-lifter'],
        requiresPostLiftEquipmentCheck: true,
        summary: 'Only after a good third, and only against a record already standing.',
      },
    };
    expect(parsesProfile(withFourth)).toBe(true);
  });
});

describe('MeetRuleBookSchema', () => {
  it('accepts a book of one profile', () => {
    expect(v.safeParse(MeetRuleBookSchema, { profiles: [PROFILE] }).success).toBe(true);
  });

  it('refuses an empty book', () => {
    // An empty book would leave the planner's first question -- which federation
    // is this meet under -- with no answers, and the screen it draws would be a
    // form nobody can submit rather than a load failure anybody would report.
    expect(v.safeParse(MeetRuleBookSchema, { profiles: [] }).success).toBe(false);
  });
});
