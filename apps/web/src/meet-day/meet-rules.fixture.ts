// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One invented federation, for this tool's tests and stories.
 *
 * A second literal rather than the domain's own `meet-profile.fixture.ts`, which
 * is not reachable from here and should not be made reachable: the domain package
 * excludes `*.fixture.ts` from its build so `dist` holds only what the site loads,
 * and opening a subpath export to it would ship test scaffolding to every consumer
 * to save one file. Tool 3's `estimate-fixture.ts` is the same shape for the same
 * reason -- a tool's fixtures belong to the tool.
 *
 * Drift between the two is a compile error, not a silent divergence, because both
 * are annotated `MeetRuleProfile`: the day the contract grows a required field,
 * this file stops building rather than quietly describing a federation that could
 * not exist.
 *
 * §5.1 forbids real federation numbers in source, and a fixture is source. These
 * are chosen to be *unlike* anything published -- a half-kilogram bar multiple, a
 * ninety-second window -- so a test that passed against a hard-coded real figure
 * fails here.
 *
 * The grid is deliberately fine. §9.1 belongs to `attempt-plan.test.ts` and is
 * covered there on a coarse grid on purpose; a plan whose weights have all moved
 * to the nearest five is a test of the rounding rather than of this module, and
 * every assertion below about a percentage would be measuring the bar increment.
 * `rulesFor({ barMultipleKilograms: 5, minimumProgressionKilograms: 5 })` when the
 * interaction is the point.
 */
import { MeetRules } from '@platform-toolkit/domain';
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';

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
  barMultipleKilograms: 0.5,
  minimumProgressionKilograms: 1,
  recordProgressionKilograms: 0.25,
  submissionSeconds: 90,
  automaticAfterGoodLift: 'increase-by-increment',
  automaticAfterMiss: 'repeat',
  forbidsAttemptBelowFailedWeight: true,
  risingBar: true,
  // False, like most real profiles: §9.3's ranges were gathered under one
  // federation's rules and this invented one is not it. A fixture that said
  // otherwise would make `population-matched` the default every test ran
  // under, which is the grade the fewest lifters actually get. Reach the other
  // branch with `rulesFor({ attemptResearchPopulation: true })`.
  attemptResearchPopulation: false,
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
  formatOverrides: [],
  fourthAttempt: null,
  tieBreak: ['lighter-bodyweight', 'reweigh', 'declared-tie'],
  notes: [],
};

/**
 * The fixture profile, patched, as a checked `MeetRules`.
 *
 * Throws rather than returning a result: a fixture the smart constructor refuses
 * is a broken test, not a case under test, and a `MeetRulesResult` here would make
 * every call site unwrap one before it could assert anything. The refusal carries
 * its problems so the patch that caused it is obvious.
 */
export function rulesFor(patch: Partial<MeetRuleProfile> = {}): MeetRules {
  const result = MeetRules.from({ ...MEET_PROFILE_FIXTURE, ...patch });
  if (!result.ok) {
    throw new Error(`fixture profile was refused: ${JSON.stringify(result.problems)}`);
  }
  return result.rules;
}
