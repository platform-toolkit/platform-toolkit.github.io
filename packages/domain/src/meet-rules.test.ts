import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { MeetRules } from './meet-rules.js';

/**
 * The fixture's fourth-attempt block, named so no test needs a `!` to reach it.
 *
 * `MeetRuleProfile['fourthAttempt']` is nullable because one published federation
 * has none, so `PROFILE.fourthAttempt!` is the obvious spelling -- and it keeps
 * compiling the day somebody sets the fixture's block to `null`, at which point
 * the spread below it produces a profile missing every field and the test that
 * was checking one rule starts checking whether valibot noticed.
 */
const FOURTH_ATTEMPT: NonNullable<MeetRuleProfile['fourthAttempt']> = {
  requiresSuccessfulThird: true,
  withinKilogramsOfRecord: 16,
  minimumExcessKilograms: 0.25,
  requiresPermission: true,
  submissionSeconds: 45,
  excludedFrom: ['total', 'placing', 'classification', 'team-points', 'best-lifter'],
  requiresPostLiftEquipmentCheck: true,
  summary: 'Only after a good third, and only against a record already standing.',
};

/**
 * An invented federation, deliberately not either published profile.
 *
 * §5.1: a fixture holding a real federation's numbers is a second copy of those
 * numbers, it reads as authoritative to whoever finds it, and it keeps asserting
 * the old rule for years after the rulebook moved. The figures below are chosen
 * to be *unlike* the real ones on purpose -- a 2 kg bar multiple rather than
 * 2.5, a ninety-second window rather than sixty -- so that a test passing
 * against a hard-coded real number would fail here.
 */
const PROFILE: MeetRuleProfile = {
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
      lift: 'squat',
      allowed: 0,
      lapsesOnceCalledToLoadedBar: false,
      notBelowPrecedingLifter: false,
    },
    {
      lift: 'bench',
      allowed: 0,
      lapsesOnceCalledToLoadedBar: false,
      notBelowPrecedingLifter: false,
    },
    {
      lift: 'deadlift',
      allowed: 2,
      lapsesOnceCalledToLoadedBar: true,
      notBelowPrecedingLifter: true,
    },
  ],
  formatOverrides: [
    {
      format: 'bench-only',
      lift: 'bench',
      allowed: 2,
      summary: 'In a single-lift bench press, two changes in the third round.',
    },
  ],
  fourthAttempt: FOURTH_ATTEMPT,
  tieBreak: ['lighter-bodyweight', 'reweigh', 'declared-tie'],
  notes: [],
};

function rulesFor(patch: Partial<MeetRuleProfile> = {}): MeetRules {
  const result = MeetRules.from({ ...PROFILE, ...patch });
  if (!result.ok)
    throw new Error(`fixture profile was refused: ${JSON.stringify(result.problems)}`);
  return result.rules;
}

function problemCodesFor(patch: Partial<MeetRuleProfile>): readonly string[] {
  const result = MeetRules.from({ ...PROFILE, ...patch });
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe('MeetRules.from', () => {
  it('accepts the fixture profile', () => {
    expect(MeetRules.from(PROFILE).ok).toBe(true);
  });

  it('refuses a profile that names one lift twice in the change rules', () => {
    // Two answers to one question. Resolving it by document order would be a coin
    // toss over whether a lifter may change their third deadlift, decided by
    // whichever entry a transcriber happened to type second.
    expect(
      problemCodesFor({
        thirdAttemptChanges: [
          ...PROFILE.thirdAttemptChanges,
          {
            lift: 'deadlift',
            allowed: 0,
            lapsesOnceCalledToLoadedBar: false,
            notBelowPrecedingLifter: false,
          },
        ],
      }),
    ).toContain('duplicate-third-attempt-lift');
  });

  it('refuses two overrides for the same format and lift', () => {
    expect(
      problemCodesFor({
        formatOverrides: [...PROFILE.formatOverrides, ...PROFILE.formatOverrides],
      }),
    ).toContain('duplicate-format-override');
  });

  it('refuses a record increment that permits nothing the ordinary one does not', () => {
    // The only way this gets written down is a transcription that copied the
    // ordinary figure into both fields, and left alone it silently forbids the
    // sub-increment weight that is the entire reason record rules exist.
    expect(problemCodesFor({ recordProgressionKilograms: 2 })).toContain(
      'record-increment-not-a-relaxation',
    );
  });

  it('refuses a fourth-attempt window narrower than the margin it demands', () => {
    expect(
      problemCodesFor({
        fourthAttempt: {
          ...FOURTH_ATTEMPT,
          withinKilogramsOfRecord: 0.1,
          minimumExcessKilograms: 0.5,
        },
      }),
    ).toContain('fourth-attempt-window-narrower-than-its-margin');
  });

  it('refuses a tie-break sequence that repeats a step', () => {
    expect(problemCodesFor({ tieBreak: ['lighter-bodyweight', 'lighter-bodyweight'] })).toContain(
      'tie-break-repeats-a-step',
    );
  });

  it('refuses a tie-break step after a declared tie', () => {
    expect(problemCodesFor({ tieBreak: ['declared-tie', 'lighter-bodyweight'] })).toContain(
      'tie-break-continues-past-a-declared-tie',
    );
  });

  it('reports every problem at once rather than the first', () => {
    // §5.5. A caller told about one problem fixes it, re-publishes, and is refused
    // again -- which for a data pipeline is a second full round trip through CI.
    const codes = problemCodesFor({
      recordProgressionKilograms: 2,
      tieBreak: ['reweigh', 'reweigh'],
    });
    expect(codes).toEqual(
      expect.arrayContaining(['record-increment-not-a-relaxation', 'tie-break-repeats-a-step']),
    );
  });
});

describe('legal bar weights', () => {
  it('accepts a multiple of the profile increment and refuses anything between', () => {
    const rules = rulesFor();
    expect(rules.isLegalBarWeight(100)).toBe(true);
    expect(rules.isLegalBarWeight(101)).toBe(false);
  });

  it('refuses zero and anything that is not a finite number', () => {
    const rules = rulesFor();
    expect(rules.isLegalBarWeight(0)).toBe(false);
    expect(rules.isLegalBarWeight(-2)).toBe(false);
    expect(rules.isLegalBarWeight(Number.NaN)).toBe(false);
  });

  it('rounds an opener down and a target up', () => {
    // The §9.1 safety property. Rounding an opener the other way turns a
    // conservative attempt into an aggressive one, on the lift where a miss costs
    // the whole meet.
    const rules = rulesFor();
    expect(rules.floorToLegal(101)).toBe(100);
    expect(rules.ceilToLegal(101)).toBe(102);
  });

  it('gives both neighbours and never resolves a midpoint upward', () => {
    // §16, for a lifter who typed a pound figure. 101 kg is exactly between 100
    // and 102 on this profile's ladder, and the one chosen for them must not be
    // the one that is harder to lift.
    const rules = rulesFor();
    expect(rules.legalWeightsAround(101)).toEqual({ below: 100, above: 102, nearest: 100 });
    expect(rules.legalWeightsAround(101.5).nearest).toBe(102);
  });

  it('reports no lower neighbour for a weight below the lightest legal bar', () => {
    const rules = rulesFor();
    expect(rules.legalWeightsAround(1)).toEqual({ below: null, above: 2, nearest: 2 });
  });

  it('returns a weight that is already legal as all three answers', () => {
    const rules = rulesFor();
    expect(rules.legalWeightsAround(100)).toEqual({ below: 100, above: 100, nearest: 100 });
  });
});

describe('the next attempt after a good lift', () => {
  it('must rise by at least one progression', () => {
    const rules = rulesFor();
    const bounds = rules.nextAttemptBounds([{ attemptNumber: 1, kilograms: 100, outcome: 'good' }]);
    expect(bounds.minimumKilograms).toBe(102);
    expect(bounds.repeatAllowed).toBe(false);
    expect(bounds.reasons).toContain('progression-after-a-good-lift');
  });

  it('cannot be taken again at the same weight', () => {
    const rules = rulesFor();
    const taken = [{ attemptNumber: 1, kilograms: 100, outcome: 'good' as const }];
    expect(rules.isLegalNextAttempt(taken, 100)).toEqual({
      legal: false,
      reasons: ['below-the-minimum-progression'],
    });
  });
});

describe('the next attempt after a miss', () => {
  it('may repeat the missed weight', () => {
    // The rule a planner gets wrong by modelling the legal set as an interval:
    // the same weight is legal and anything between it and one full progression
    // above it is not.
    const rules = rulesFor();
    const taken = [{ attemptNumber: 1, kilograms: 100, outcome: 'no-lift' as const }];
    const bounds = rules.nextAttemptBounds(taken);
    expect(bounds).toMatchObject({
      minimumKilograms: 102,
      repeatAllowed: true,
      repeatKilograms: 100,
    });
    expect(rules.isLegalNextAttempt(taken, 100).legal).toBe(true);
  });

  it('may not go below the missed weight', () => {
    const rules = rulesFor();
    const taken = [{ attemptNumber: 1, kilograms: 100, outcome: 'no-lift' as const }];
    expect(rules.isLegalNextAttempt(taken, 98)).toEqual({
      legal: false,
      reasons: ['below-a-failed-attempt'],
    });
  });

  it('may not go below a weight missed two rounds ago', () => {
    // A lifter who missed a heavy second and made nothing since is still floored
    // by that miss, not by the lighter attempt that came after it. §13 says to
    // reduce after a miss and this is the rule that says how far down is legal.
    const rules = rulesFor();
    const taken = [
      { attemptNumber: 1, kilograms: 100, outcome: 'good' as const },
      { attemptNumber: 2, kilograms: 110, outcome: 'no-lift' as const },
    ];
    const bounds = rules.nextAttemptBounds(taken);
    expect(bounds.minimumKilograms).toBe(112);
    expect(rules.isLegalNextAttempt(taken, 108).legal).toBe(false);
  });

  it('honours a profile that does not forbid dropping below a failed weight', () => {
    const rules = rulesFor({ forbidsAttemptBelowFailedWeight: false });
    const taken = [
      { attemptNumber: 1, kilograms: 100, outcome: 'no-lift' as const },
      { attemptNumber: 2, kilograms: 90, outcome: 'good' as const },
    ];
    expect(rules.nextAttemptBounds(taken).minimumKilograms).toBe(92);
  });

  it('reports both an illegal weight and an illegal increment at once', () => {
    const rules = rulesFor();
    const taken = [{ attemptNumber: 1, kilograms: 100, outcome: 'no-lift' as const }];
    expect(rules.isLegalNextAttempt(taken, 99)).toEqual({
      legal: false,
      reasons: ['not-a-legal-bar-weight', 'below-a-failed-attempt'],
    });
  });
});

describe('the first attempt', () => {
  it('is floored at the lightest legal bar and has nothing to repeat', () => {
    const rules = rulesFor();
    expect(rules.nextAttemptBounds([])).toEqual({
      minimumKilograms: 2,
      repeatAllowed: false,
      repeatKilograms: null,
      failedFloorKilograms: null,
      reasons: ['no-attempts-yet'],
    });
  });

  it('ignores a passed attempt entirely', () => {
    const rules = rulesFor();
    expect(
      rules.nextAttemptBounds([{ attemptNumber: 1, kilograms: 100, outcome: 'passed' }]).reasons,
    ).toEqual(['no-attempts-yet']);
  });
});

describe('the legal ladder', () => {
  it('steps upward from the floor by the profile increment', () => {
    const rules = rulesFor();
    const ladder = rules.legalLadder([{ attemptNumber: 1, kilograms: 100, outcome: 'good' }], 4);
    expect(ladder).toEqual([102, 104, 106, 108]);
  });

  it('is empty for a nonsensical count rather than throwing at a render', () => {
    const rules = rulesFor();
    expect(rules.legalLadder([], 0)).toEqual([]);
    expect(rules.legalLadder([], 1.5)).toEqual([]);
  });
});

describe('the automatic attempt when nobody submits', () => {
  it('goes up by the increment after a good lift', () => {
    // The single most useful thing this tool can say, because it is the rule that
    // applies when nobody is looking at the screen: a made opener and a coach who
    // looked away is a second attempt the lifter did not choose.
    const rules = rulesFor();
    expect(
      rules.automaticAttemptAfter({ attemptNumber: 1, kilograms: 100, outcome: 'good' }),
    ).toEqual({ kilograms: 102, behaviour: 'increase-by-increment', seconds: 90 });
  });

  it('stays where it is after a miss', () => {
    const rules = rulesFor();
    expect(
      rules.automaticAttemptAfter({ attemptNumber: 1, kilograms: 100, outcome: 'no-lift' }),
    ).toEqual({ kilograms: 100, behaviour: 'repeat', seconds: 90 });
  });

  it('has no answer before the first attempt or after a pass', () => {
    const rules = rulesFor();
    expect(rules.automaticAttemptAfter(null)).toBeNull();
    expect(
      rules.automaticAttemptAfter({ attemptNumber: 1, kilograms: 100, outcome: 'passed' }),
    ).toBeNull();
  });

  it('follows a profile that repeats after a good lift instead of rising', () => {
    const rules = rulesFor({ automaticAfterGoodLift: 'repeat' });
    expect(
      rules.automaticAttemptAfter({ attemptNumber: 1, kilograms: 100, outcome: 'good' })?.kilograms,
    ).toBe(100);
  });
});

describe('changing an attempt already submitted', () => {
  it('quotes the opener rule in the words the rulebook used', () => {
    const rules = rulesFor();
    const allowance = rules.changeAllowance({
      lift: 'squat',
      attemptNumber: 1,
      format: 'full-power',
      used: 0,
    });
    expect(allowance).toMatchObject({ allowed: 1, remaining: 1 });
    expect(allowance.summary).toBe(PROFILE.openerChange.summary);
  });

  it('reports no changes left once the opener change is used', () => {
    const rules = rulesFor();
    expect(
      rules.changeAllowance({ lift: 'squat', attemptNumber: 1, format: 'full-power', used: 1 })
        .remaining,
    ).toBe(0);
  });

  it('locks a second attempt', () => {
    const rules = rulesFor();
    expect(
      rules.changeAllowance({ lift: 'deadlift', attemptNumber: 2, format: 'full-power', used: 0 })
        .allowed,
    ).toBe(0);
  });

  it('locks a third squat and opens a third deadlift', () => {
    // The asymmetry §32.9 exists for. Getting it wrong in the lenient direction
    // has the planner offering a change the expeditor will refuse, in the round
    // where there is no time left to recover.
    const rules = rulesFor();
    const squat = rules.changeAllowance({
      lift: 'squat',
      attemptNumber: 3,
      format: 'full-power',
      used: 0,
    });
    const deadlift = rules.changeAllowance({
      lift: 'deadlift',
      attemptNumber: 3,
      format: 'full-power',
      used: 0,
    });
    expect(squat.allowed).toBe(0);
    expect(deadlift.allowed).toBe(2);
  });

  it('states the conditions it cannot check, whether or not changes remain', () => {
    // Carried in order to be said, not in order to be enforced: the application
    // cannot see the platform and does not know when the speaker called a name.
    const rules = rulesFor();
    const spent = rules.changeAllowance({
      lift: 'deadlift',
      attemptNumber: 3,
      format: 'full-power',
      used: 2,
    });
    expect(spent.remaining).toBe(0);
    expect(spent.conditions).toEqual([
      'lapses-once-called-to-a-loaded-bar',
      'not-below-the-preceding-lifter',
    ]);
  });

  it('gives a single-lift bench press the allowance a full-power bench does not have', () => {
    const rules = rulesFor();
    expect(
      rules.changeAllowance({ lift: 'bench', attemptNumber: 3, format: 'full-power', used: 0 })
        .allowed,
    ).toBe(0);
    expect(
      rules.changeAllowance({ lift: 'bench', attemptNumber: 3, format: 'bench-only', used: 0 })
        .allowed,
    ).toBe(2);
  });

  it('treats a fourth attempt under the third-round rules rather than silently allowing changes', () => {
    const rules = rulesFor();
    expect(
      rules.changeAllowance({ lift: 'squat', attemptNumber: 4, format: 'full-power', used: 0 })
        .allowed,
    ).toBe(0);
  });
});

describe('fourth attempts', () => {
  const good = { attemptNumber: 3, kilograms: 200, outcome: 'good' as const };

  it('gives the lightest weight that would take the record, off the ordinary ladder', () => {
    // 210.25 is not a multiple of this profile's 2 kg bar, and that is the point:
    // a record attempt is the one time a federation lets a lifter off the ladder,
    // and rounding here would add nearly a full increment to the weight.
    const rules = rulesFor();
    const eligibility = rules.fourthAttemptEligibility({
      thirdAttempt: good,
      recordKilograms: 210,
    });
    expect(eligibility).toMatchObject({
      eligible: true,
      minimumKilograms: 210.25,
      requiresPermission: true,
      submissionSeconds: 45,
    });
  });

  it('refuses when the third attempt was missed', () => {
    const rules = rulesFor();
    expect(
      rules.fourthAttemptEligibility({
        thirdAttempt: { ...good, outcome: 'no-lift' },
        recordKilograms: 210,
      }),
    ).toEqual({ eligible: false, reasons: ['third-attempt-not-successful'] });
  });

  it('distinguishes not knowing the record from being too far from it', () => {
    // Two different sentences on screen. "You are 30 kg away" and "tell me what
    // the record is" are not the same answer, and collapsing them would have the
    // tool assert a distance it has not been given the figure to measure.
    const rules = rulesFor();
    expect(
      rules.fourthAttemptEligibility({ thirdAttempt: good, recordKilograms: null }).eligible,
    ).toBe(false);
    expect(rules.fourthAttemptEligibility({ thirdAttempt: good, recordKilograms: null })).toEqual({
      eligible: false,
      reasons: ['no-record-supplied'],
    });
    expect(rules.fourthAttemptEligibility({ thirdAttempt: good, recordKilograms: 230 })).toEqual({
      eligible: false,
      reasons: ['outside-the-record-window'],
    });
  });

  it('allows a lifter who is already past the record', () => {
    // A third attempt above the standing record is inside any window, and the
    // fourth is then simply the smallest legal increase over the record.
    const rules = rulesFor();
    expect(
      rules.fourthAttemptEligibility({ thirdAttempt: good, recordKilograms: 195 }),
    ).toMatchObject({ eligible: true, minimumKilograms: 195.25 });
  });

  it('says the federation does not have them rather than inventing a rule', () => {
    // One of the two published federations has no fourth attempts at all, and a
    // zeroed rule block would render as a fourth attempt nobody may take.
    const rules = rulesFor({ fourthAttempt: null });
    expect(rules.fourthAttemptEligibility({ thirdAttempt: good, recordKilograms: 210 })).toEqual({
      eligible: false,
      reasons: ['not-offered'],
    });
  });

  it('carries what the attempt does not count toward', () => {
    // Read off the profile rather than assumed, because "does a fourth attempt
    // count" is a question the two published federations answer differently by
    // not both having the attempt at all.
    const rules = rulesFor();
    const eligibility = rules.fourthAttemptEligibility({
      thirdAttempt: good,
      recordKilograms: 210,
    });
    if (!eligibility.eligible) throw new Error('expected an eligible fourth attempt');
    expect(eligibility.excludedFrom).toContain('total');
  });
});

describe('tie-breaking', () => {
  it('answers with the first step that separates the two lifters', () => {
    const rules = rulesFor();
    expect(
      rules.firstSeparatingTieBreak({ bodyweightsDiffer: true, reachedTotalFirstIsKnown: false }),
    ).toBe('lighter-bodyweight');
  });

  it('falls through a step that cannot separate them', () => {
    const rules = rulesFor();
    expect(
      rules.firstSeparatingTieBreak({ bodyweightsDiffer: false, reachedTotalFirstIsKnown: false }),
    ).toBe('reweigh');
  });

  it('follows a profile that decides on who reached the total first', () => {
    // The two published federations genuinely differ here, and the tactical mode
    // needs the difference: whether a tie is worth taking is a different decision
    // under a reweigh than under first-to-total.
    const rules = rulesFor({ tieBreak: ['lighter-bodyweight', 'first-to-total'] });
    expect(
      rules.firstSeparatingTieBreak({ bodyweightsDiffer: false, reachedTotalFirstIsKnown: true }),
    ).toBe('first-to-total');
    expect(
      rules.firstSeparatingTieBreak({ bodyweightsDiffer: false, reachedTotalFirstIsKnown: false }),
    ).toBeNull();
  });
});
