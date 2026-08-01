/**
 * One invented federation, for every test that needs a rulebook.
 *
 * §5.1 keeps federation numbers out of source, and a test fixture is source: a
 * fixture holding a real federation's figures is a second copy of them, it reads
 * as authoritative to whoever finds it, and it keeps asserting the old rule for
 * years after the rulebook moved. So the numbers below are chosen to be *unlike*
 * either published profile -- a 2 kg bar multiple rather than 2.5, a ninety-second
 * window rather than sixty -- and a test that passed against a hard-coded real
 * figure fails here.
 *
 * Shared rather than copied because the meet-day planner is five modules deep and
 * every one of them takes a `MeetRules`. Three separate eighty-line literals would
 * disagree the first time the contract grows a field, and the disagreement would
 * surface as one suite failing to compile while the others kept passing against
 * the shape nobody updated.
 *
 * **Patch it, do not fork it.** `rulesFor` takes a partial profile, so a test that
 * needs a coarse grid or no fourth attempt says exactly that at the point it
 * matters -- which is also the only place a reader has to look to know how that
 * test's federation differs from the default.
 *
 * Not shipped: the package tsconfig excludes `*.fixture.ts` alongside `*.test.ts`
 * so `dist` holds only what the site loads.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';

import { MeetRules } from './meet-rules.js';

/**
 * The fourth-attempt block, named so no test needs a `!` to reach it.
 *
 * `MeetRuleProfile['fourthAttempt']` is nullable because one published federation
 * has none, so `MEET_PROFILE_FIXTURE.fourthAttempt!` is the obvious spelling --
 * and it keeps compiling the day somebody patches that block to `null`, at which
 * point a spread of it produces a profile missing every field and the test that
 * was checking one rule starts checking whether valibot noticed.
 */
export const FOURTH_ATTEMPT_FIXTURE: NonNullable<MeetRuleProfile['fourthAttempt']> = {
  requiresSuccessfulThird: true,
  withinKilogramsOfRecord: 16,
  minimumExcessKilograms: 0.25,
  requiresPermission: true,
  submissionSeconds: 45,
  excludedFrom: ['total', 'placing', 'classification', 'team-points', 'best-lifter'],
  requiresPostLiftEquipmentCheck: true,
  summary: 'Only after a good third, and only against a record already standing.',
};

export const MEET_PROFILE_FIXTURE: MeetRuleProfile = {
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
  fourthAttempt: FOURTH_ATTEMPT_FIXTURE,
  tieBreak: ['lighter-bodyweight', 'reweigh', 'declared-tie'],
  notes: [],
};

/**
 * The fixture profile, patched, as a checked `MeetRules`.
 *
 * Throws rather than returning a result, because a fixture the smart constructor
 * refuses is a broken test rather than a case under test -- and a `MeetRulesResult`
 * here would make every call site unwrap one before it could assert anything. The
 * refusal is reported with its problems so the patch that caused it is obvious.
 */
export function rulesFor(patch: Partial<MeetRuleProfile> = {}): MeetRules {
  const result = MeetRules.from({ ...MEET_PROFILE_FIXTURE, ...patch });
  if (!result.ok) {
    throw new Error(`fixture profile was refused: ${JSON.stringify(result.problems)}`);
  }
  return result.rules;
}
