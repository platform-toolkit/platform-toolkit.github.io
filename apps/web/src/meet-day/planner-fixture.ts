// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Sessions, and the plan each one produces, for this tool's stories and tests.
 *
 * Every element in this directory takes a `PlannerSession` and most of them also
 * take the `PlannerView` built from it, so a fixture has two halves that must
 * agree. Hand-writing the second half is the failure this file exists to
 * prevent: a `LiftPlanView` names a maximum, three attempts, a risk band, a
 * confidence grade and a list of problems, and a literal whose grade does not
 * follow from its answers is a picture of a state the tool cannot reach. It also
 * keeps rendering unchanged after a rule moves, so the story that exists to show
 * the new behaviour is the one place it never appears.
 *
 * So every view here comes out of `buildPlan`, and every session is built with
 * the tool's own transitions rather than spread together. `withSetup` clears the
 * confirmations when the method changes and `withFigures` clears them when a
 * figure the maximum depends on moves -- a spread fixture would sail past both
 * and show a plan the lifter never underwrote, which is the one state §7 gates.
 *
 * Nothing that ships may import this file.
 */
import type { ConversionChartData, MeetRuleProfile } from '@platform-toolkit/data-contracts';
import { ConversionChart } from '@platform-toolkit/domain';

import { MEET_PROFILE_FIXTURE, rulesFor } from './meet-rules.fixture.js';
import { buildPlan, type PlanContext, type PlannerView } from './plan.js';
import {
  EMPTY_SESSION,
  confirmMaximum,
  sessionLifts,
  withFigures,
  withSetup,
  type GuidedSet,
  type LiftFigures,
  type PlannerSession,
  type PlannerSetup,
} from './session.js';

/** What a finished read of the published rule books hands the setup element. */
export const PROFILE_FIXTURES: readonly MeetRuleProfile[] = [MEET_PROFILE_FIXTURE];

/**
 * The words §10.2 forbids, kept in one place because every screen is checked.
 *
 * Every element in this tool says something about how a meet might go, so every
 * one of them carries the same assertion, and three copies of a list like this
 * drift -- the copy that gains a word is the copy in the file somebody happened
 * to be editing, and the other two go on passing.
 *
 * "Percent" is deliberately absent, and the Custom goal is why: an attempt *is* a
 * percentage of a planning maximum, that is exactly what §9's table is, and a
 * lifter supplying their own supplies percentages. Banning the word would ban the
 * arithmetic along with the claim. What §10.2 forbids is a statement about
 * whether a lift will be made, so this is the vocabulary of outcomes rather than
 * the vocabulary of proportions.
 */
export const PROBABILITY_WORDS: readonly string[] = [
  'chance',
  'likely',
  'likelihood',
  'probability',
  'probable',
  'odds',
  'success rate',
  'should make',
  'guaranteed',
];

/**
 * No conversion chart, which is the state every screen paints in first.
 *
 * §16 gives the pound figure to the federation's published chart and nowhere
 * else, and `attemptWeightFor` answers `no-chart` rather than computing one. A
 * fixture chart here would hide the case the site actually starts in.
 */
export const PLAN_CONTEXT: PlanContext = { rules: rulesFor(), chart: null };

/**
 * An invented conversion chart, in the range this tool's attempts land in.
 *
 * A second chart rather than tool 4's, and for the reason `meet-rules.fixture.ts`
 * gives for its second profile: a tool's fixtures belong to the tool. Tool 4's
 * runs 50 to 150 kg in five-kilogram steps because that is where a conversion
 * question is asked; every attempt this planner produces from its own sessions is
 * heavier than the top row of it, so borrowing it would make every lookup
 * `not-on-the-chart` and leave the published branch untested while looking
 * covered.
 *
 * §5.1 forbids real federation numbers in source, so these belong to a federation
 * that does not exist. Five-kilogram steps against a half-kilogram bar multiple
 * are the point rather than a shortcut: a real chart is coarser than the bar, so
 * an ordinary plan lands some attempts on a row and some between rows, which is
 * the mixed state `poundsAbsenceSentence` is written for and the state a chart
 * fine enough to name every attempt would hide.
 *
 * The pound column is the federation's own printing, not a conversion of the
 * kilogram column -- 180 kg is published here as 396.9 lb where the arithmetic
 * gives 396.83. That gap is deliberate and load-bearing: it is what lets a test
 * prove the screen read the chart rather than converting, which is the whole of
 * §16 and is unprovable against a column that agrees with the arithmetic.
 */
export const CHART_FIXTURE_DATA: ConversionChartData = {
  id: 'example',
  label: 'Example Federation',
  source: {
    label: 'Example Federation Conversion Chart',
    url: 'https://example.test/conversion-chart/',
    revision: '2026v1',
    verifiedOn: '2026-08-01',
  },
  rows: [
    { kilograms: 150, pounds: 330.7 },
    { kilograms: 155, pounds: 341.7 },
    { kilograms: 160, pounds: 352.7 },
    { kilograms: 165, pounds: 363.8 },
    { kilograms: 170, pounds: 374.8 },
    { kilograms: 175, pounds: 385.8 },
    { kilograms: 180, pounds: 396.9 },
    { kilograms: 185, pounds: 407.9 },
    { kilograms: 190, pounds: 418.9 },
    { kilograms: 195, pounds: 429.9 },
    { kilograms: 200, pounds: 440.9 },
    { kilograms: 205, pounds: 451.9 },
    { kilograms: 210, pounds: 463 },
    { kilograms: 215, pounds: 474 },
    { kilograms: 220, pounds: 485 },
    { kilograms: 225, pounds: 496 },
    { kilograms: 230, pounds: 507.1 },
    { kilograms: 235, pounds: 518.1 },
    { kilograms: 240, pounds: 529.1 },
    { kilograms: 245, pounds: 540.1 },
    { kilograms: 250, pounds: 551.2 },
  ],
};

/**
 * The same context with that chart loaded, built through the smart constructor.
 *
 * Through `ConversionChart.from` rather than assembled directly, so a fixture that
 * stopped being a legal chart -- a row edited out of order, a duplicate -- fails
 * here with the reason rather than downstream as a lookup that quietly returns the
 * wrong neighbours.
 */
export const CHARTED_CONTEXT: PlanContext = { rules: rulesFor(), chart: chartFixture() };

function chartFixture(): ConversionChart {
  const result = ConversionChart.from(CHART_FIXTURE_DATA);
  if (!result.ok) {
    throw new Error(
      `fixture chart was refused: ${result.problems.map((problem) => problem.code).join(', ')}`,
    );
  }
  return result.chart;
}

/**
 * A session whose §6 questions have been answered.
 *
 * Routed through `withSetup` rather than spread over `EMPTY_SESSION.setup`,
 * because `goalChosen` is not a field a caller should be setting: passing a goal
 * has to mark it chosen, and passing `firstMeet` alone has to move an unchosen
 * goal to First Meet. A spread fixture answering `{ firstMeet: true }` would sit
 * on Balanced, and the story showing §6.3's default would show its absence.
 */
export function plannerSession(
  patch: Partial<Omit<PlannerSetup, 'goalChosen'>> = {},
): PlannerSession {
  return withSetup(EMPTY_SESSION, { federationId: MEET_PROFILE_FIXTURE.id, ...patch });
}

/** The same figures typed against every lift the format contests. */
export function acrossLifts(
  session: PlannerSession,
  patch: Partial<Omit<LiftFigures, 'confirmed'>>,
): PlannerSession {
  return sessionLifts(session).reduce((carry, lift) => withFigures(carry, lift, patch), session);
}

/**
 * §7.2's six answers, filled in, so a caller names only the one it is about.
 *
 * 170 kg for three with one in reserve is unremarkable on purpose: mid-range for
 * the equations, loadable on a real bar, and far enough from the twenty-rep
 * ceiling that changing the count in one story does not also change the outcome's
 * kind.
 */
export function guidedSet(patch: Partial<GuidedSet> = {}): GuidedSet {
  return {
    weight: '170',
    reps: '3',
    repsInReserve: 1,
    competitionStandard: 'yes',
    age: 'within-eight-weeks',
    sameEquipment: 'yes',
    ...patch,
  };
}

/** Every contested lift agreed to, which is what §7 gates a plan on. */
export function confirmAll(session: PlannerSession): PlannerSession {
  return sessionLifts(session).reduce((carry, lift) => confirmMaximum(carry, lift, true), session);
}

/**
 * The plan the tool would draw from that session.
 *
 * The context defaults to the chartless one because that is the state the site
 * opens in, and a caller that wants the published pound column passes
 * {@link CHARTED_CONTEXT} explicitly -- so a screen showing chart figures says in
 * its own source that it is the special case.
 */
export function viewFor(session: PlannerSession, context: PlanContext = PLAN_CONTEXT): PlannerView {
  return buildPlan(session, context);
}
