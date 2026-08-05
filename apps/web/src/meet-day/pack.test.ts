// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23's pack, as a value. The printed element is `ptk-meet-pack.browser.test.ts`.
 *
 * Most of this module is projection, and projection is tested here only where
 * something is *decided* -- which setup answers survive a blank, what a target
 * turns into, what is declared missing. The weights are not re-asserted: they
 * come out of `buildPlan` and `liveChoicesFor`, both of which have their own
 * suites, and a copy of those assertions here could not fail independently.
 *
 * What is genuinely this module's own is the contingency table, so that is where
 * the tests are. Three properties matter and each has a way of being quietly
 * false:
 *
 * - The branches are §13's, not a second opinion. Asserted by comparing a row
 *   against `liveChoicesFor` run on a document walked the same way by hand -- if
 *   this file ever grew arithmetic of its own, that comparison is what breaks.
 * - Six outcomes produce six *distinct* reported triggers. A trigger table that
 *   collapsed -- two outcomes mapping to one branch of §13 -- would print six
 *   rows with duplicate advice and nothing would say so.
 * - The rows for the third attempt assume the second was made. Asserted by the
 *   flag, and by the second attempt's rows *not* carrying it, because a flag that
 *   is always true is a flag that says nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  applyMeetAction,
  attemptsOn,
  createMeetDocument,
  findLifter,
  liveChoicesFor,
  startTimeline,
  type MeetAction,
  type MeetDocument,
  type MeetTimeline,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { buildBoardView } from './board.js';
import {
  BOARD_LIFTERS,
  boardMeet,
  contextAt as boardContextAt,
  lifterIdAt,
  takeFor,
  threeLifters,
} from './board-fixture.js';
import { liveTargetsFrom } from './live-session.js';
import { rulesFor } from './meet-rules.fixture.js';
import { PACK_AT as AT, handlerPackOf, packOf, planned } from './pack-fixture.js';
import {
  EMPTY_HANDLER_PACK,
  EMPTY_PACK,
  PACK_TRIGGERS,
  buildHandlerPack,
  type MeetPack,
  type PackContingency,
} from './pack.js';
import { CHARTED_CONTEXT, PLAN_CONTEXT } from './planner-fixture.js';
import { buildPlan } from './plan.js';
import { EMPTY_PREP, withLifterSetup, withPrepNotes } from './prep.js';
import { EMPTY_SESSION, confirmMaximum, withFigures, withTargets } from './session.js';

function liftIn(pack: MeetPack, lift: PlatformLift) {
  const found = pack.lifts.find((candidate) => candidate.lift === lift);
  if (found === undefined) throw new Error(`the pack has no ${lift}`);
  return found;
}

function rowFor(
  pack: MeetPack,
  lift: PlatformLift,
  attemptNumber: number,
  trigger: string,
): PackContingency {
  const found = liftIn(pack, lift).contingencies.find(
    (row) => row.attemptNumber === attemptNumber && row.trigger === trigger,
  );
  if (found === undefined) throw new Error(`no ${trigger} row for attempt ${attemptNumber}`);
  return found;
}

describe('buildMeetPack', () => {
  /*
   * ---------------------------------------------------------------------------
   * The heading, and the state the site opens in.
   * ---------------------------------------------------------------------------
   */

  it('cites the rulebook the profile names rather than a federation written in source', () => {
    const rules = rulesFor();

    const pack = packOf(planned());

    expect(pack.heading.rulesLabel).toBe(rules.profile.label);
    expect(pack.heading.rulebookLabel).toBe(rules.profile.source.label);
    expect(pack.heading.rulebookRevision).toBe(rules.profile.source.revision);
    expect(pack.heading.rulesVerifiedOn).toBe(rules.profile.source.verifiedOn);
  });

  it('prints the name as given and invents nothing for a lifter who typed none', () => {
    expect(packOf(planned(), { lifterName: '' }).heading.lifterName).toBe('');
    expect(packOf(planned()).heading.lifterName).toBe('Dana Okafor');
  });

  it('builds a sheet for a session nobody has answered anything in', () => {
    const pack = packOf(EMPTY_SESSION);

    expect(pack.plannedTotalKilograms).toBeNull();
    expect(pack.checklist.length).toBeGreaterThan(0);
    expect(pack.platformSetup.length).toBeGreaterThan(0);
    // Nothing to branch from, and no exception on the way there.
    expect(pack.lifts.every((lift) => lift.contingencies.length === 0)).toBe(true);
  });

  it('carries the plan the plan screen drew rather than a second copy of it', () => {
    const session = planned();
    const view = buildPlan(session, PLAN_CONTEXT);

    const pack = packOf(session, { view });

    // Identity against the view that was handed in, not equality: the sheet in a
    // gym bag and the screen beside it disagreeing by a kilogram is the failure
    // this whole module is arranged to make impossible, and an equal-but-rebuilt
    // list satisfies a deep compare while being exactly that second opinion.
    expect(liftIn(pack, 'squat').attempts).toBe(
      view.lifts.find((lift) => lift.lift === 'squat')?.attempts,
    );
    expect(pack.plannedTotalKilograms).toBe(view.plannedTotalKilograms);
  });

  /*
   * ---------------------------------------------------------------------------
   * §22.1, and what a blank answer is worth.
   * ---------------------------------------------------------------------------
   */

  it('keeps every rack and safety height, blank ones included, as a line to write on', () => {
    const pack = packOf(planned());

    expect(pack.platformSetup.map((fact) => fact.field)).toEqual([
      'squatRackHeight',
      'squatSafetyHeight',
      'monoliftSetting',
      'squatStart',
      'benchRackHeight',
      'benchSafetyHeight',
      'footBlocks',
      'handoff',
    ]);
    expect(pack.platformSetup.every((fact) => fact.answered)).toBe(false);
    expect(pack.platformSetup.every((fact) => fact.value === '')).toBe(true);
  });

  it('drops an unanswered scheduling detail rather than printing an empty row for it', () => {
    const pack = packOf(planned());

    expect(pack.otherSetup).toEqual([]);
  });

  it('prints a scheduling detail once it has been given', () => {
    const prep = withLifterSetup(EMPTY_PREP, { flight: 'B', platform: '2' });

    const pack = packOf(planned(), { prep });

    expect(pack.otherSetup).toEqual([
      { field: 'flight', value: 'B', answered: true },
      { field: 'platform', value: '2', answered: true },
    ]);
  });

  it('treats an enum left at unstated as unanswered, not as a setting the lifter chose', () => {
    // `squatStart` and `handoff` say `'unstated'` rather than `''`, so a check
    // written as `!== ''` prints "unstated" on the sheet as though it were an
    // answer. Both are platform fields, so both are kept -- but blank.
    const pack = packOf(planned());
    const squatStart = pack.platformSetup.find((fact) => fact.field === 'squatStart');

    expect(squatStart).toEqual({ field: 'squatStart', value: '', answered: false });
  });

  it('carries the reminders the lifter wrote, in their own words', () => {
    const prep = withPrepNotes(EMPTY_PREP, 'Ask the handler about the second rack height.');

    expect(packOf(planned(), { prep }).notes).toBe('Ask the handler about the second rack height.');
  });

  /*
   * ---------------------------------------------------------------------------
   * §13's branches, printed.
   * ---------------------------------------------------------------------------
   */

  it('prints one row per outcome for each attempt after the opener', () => {
    const squat = liftIn(packOf(planned()), 'squat');

    expect(squat.contingencies).toHaveLength(PACK_TRIGGERS.length * 2);
    expect(new Set(squat.contingencies.map((row) => row.attemptNumber))).toEqual(new Set([2, 3]));
  });

  it('reports six distinct triggers for the six outcomes, so no two rows repeat advice', () => {
    const squat = liftIn(packOf(planned()), 'squat');
    const second = squat.contingencies.filter((row) => row.attemptNumber === 2);

    expect(new Set(second.map((row) => row.trigger)).size).toBe(PACK_TRIGGERS.length);
  });

  it('says the third attempt rows assume the second was made, and the second rows do not', () => {
    const squat = liftIn(packOf(planned()), 'squat');

    expect(
      squat.contingencies
        .filter((row) => row.attemptNumber === 2)
        .every((row) => row.assumesEarlierAttemptsMade),
    ).toBe(false);
    expect(
      squat.contingencies
        .filter((row) => row.attemptNumber === 3)
        .every((row) => row.assumesEarlierAttemptsMade),
    ).toBe(true);
  });

  it('offers §13s own weights and not an arithmetic of its own', () => {
    const session = planned();
    const view = buildPlan(session, PLAN_CONTEXT);
    const rules = rulesFor();
    const plan = view.lifts.find((lift) => lift.lift === 'squat');
    if (plan === undefined) throw new Error('the session does not contest the squat');

    // The same walk `hypothetical` makes, spelled out: a scratch meet, the opener
    // ground out, and §13 asked what to do next. Written here rather than reusing
    // the module's own helper on purpose -- a test that called the code under test
    // to compute its expectation would pass against any weights at all.
    let timeline = act(startTimeline(createMeetDocument(rules, 'full-power')), {
      kind: 'add-lifter',
      name: 'Lifter',
    });
    const lifterId = timeline.present.lifters[0]?.id ?? '';
    for (const [index, attempt] of plan.attempts.entries()) {
      timeline = act(timeline, {
        kind: 'set-attempt-weight',
        attemptId: attemptIdAt(timeline.present, lifterId, 'squat', index),
        kilograms: attempt.weight.kilograms,
      });
    }
    timeline = act(timeline, {
      kind: 'record-result',
      attemptId: attemptIdAt(timeline.present, lifterId, 'squat', 0),
      result: { outcome: 'good', effort: 'grind' },
    });
    const lifter = findLifter(timeline.present, lifterId);
    if (lifter === null) throw new Error('the scratch meet lost its lifter');
    const expected = liveChoicesFor(rules, {
      document: timeline.present,
      lifter,
      lift: 'squat',
      meetDayMaximumKilograms: plan.maximumKilograms,
      plan: plan.plan,
      ceilingKilograms: plan.ceilingKilograms,
      targets: liveTargetsFrom(session),
    });

    const row = rowFor(packOf(session), 'squat', 2, expected.trigger);

    expect(row.branches.map((branch) => branch.weight?.kilograms ?? null)).toEqual(
      expected.choices.map((choice) => choice.kilograms),
    );
    expect(row.branches.map((branch) => branch.slot)).toEqual(
      expected.choices.map((choice) => choice.slot),
    );
    expect(row.branches.map((branch) => branch.reason)).toEqual(
      expected.choices.map((choice) => choice.reason),
    );
  });

  it('marks at most one branch in a row as the one §13 puts forward', () => {
    const squat = liftIn(packOf(planned()), 'squat');

    for (const row of squat.contingencies) {
      expect(row.branches.filter((branch) => branch.highlighted).length).toBeLessThanOrEqual(1);
    }
  });

  it('reads a branch weight off the chart rather than computing pounds', () => {
    const session = planned();
    const chart = CHARTED_CONTEXT.chart;

    const charted = packOf(session, { chart, view: buildPlan(session, CHARTED_CONTEXT) });
    const chartless = packOf(session);

    const withChart = rowFor(charted, 'squat', 2, 'solid').branches.at(0)?.weight;
    const without = rowFor(chartless, 'squat', 2, 'solid').branches.at(0)?.weight;

    expect(without?.publishedPoundsReason).toBe('no-chart');
    expect(without?.publishedPounds).toBeNull();
    // The fixture chart does not cover every weight, so what is asserted is that
    // the chart was consulted at all -- not that it had an answer.
    expect(withChart?.publishedPoundsReason).not.toBe('no-chart');
  });

  it('leaves a lift with no plan out of the table entirely', () => {
    // Only the squat is answered, so the bench and the deadlift have no attempts
    // and therefore nothing to branch from.
    const session = confirmMaximum(
      withFigures(EMPTY_SESSION, 'squat', { expectedMaximum: '200' }),
      'squat',
      true,
    );

    const pack = packOf(session);

    expect(liftIn(pack, 'squat').contingencies.length).toBeGreaterThan(0);
    expect(liftIn(pack, 'bench').contingencies).toEqual([]);
  });

  it('never puts the lifter name into the hypothetical documents it walks', () => {
    // The scratch lifter is a constant, and the only place the real name appears
    // is the heading. Asserted through the rendered shape rather than by reading
    // a private: a pack built for two different names must differ in exactly one
    // field.
    const session = planned();

    const dana = packOf(session, { lifterName: 'Dana Okafor' });
    const bo = packOf(session, { lifterName: 'Bo Adeyemi' });

    expect({ ...dana, heading: null }).toEqual({ ...bo, heading: null });
  });

  it('builds a table for a lifter who has not typed a name yet', () => {
    // `add-lifter` refuses an empty name, so seeding with the real one would
    // produce an empty table for exactly the lifter printing the night before.
    const squat = liftIn(packOf(planned(), { lifterName: '' }), 'squat');

    expect(squat.contingencies.length).toBe(PACK_TRIGGERS.length * 2);
  });

  /*
   * ---------------------------------------------------------------------------
   * §8.3's figures, and what §23 asks for that is not here.
   * ---------------------------------------------------------------------------
   */

  it('prints the targets the lifter set, in both units', () => {
    const session = withTargets(planned(), { qualifyingTotal: '600' });

    const pack = packOf(session);

    expect(pack.targets.length).toBeGreaterThan(0);
    const total = pack.targets.find((target) => target.measure === 'total');
    expect(total?.kind).toBe('qualification');
    expect(total?.weight.kilograms).toBe(600);
    expect(total?.weight.exactPounds).toBeGreaterThan(1300);
    expect(total?.label).not.toBe('');
  });

  it('declares the warm-up ramp and the record sections missing rather than omitting them silently', () => {
    expect(packOf(planned()).omissions).toEqual([
      'warm-up-ramp',
      'records',
      'qualifying-standards',
    ]);
  });

  it('counts the checklist so a sheet can say how much is left', () => {
    const pack = packOf(planned());

    expect(pack.checklistProgress.total).toBe(pack.checklist.length);
    expect(pack.checklistProgress.done).toBe(0);
    expect(pack.checklistProgress.remaining).toBe(pack.checklist.length);
  });
});

describe('EMPTY_PACK', () => {
  it('is a real pack, so a template never needs a there-is-no-pack branch', () => {
    expect(EMPTY_PACK.lifts).toEqual([]);
    expect(EMPTY_PACK.checklistProgress).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(EMPTY_HANDLER_PACK.lifters).toEqual([]);
  });
});

describe('buildHandlerPack', () => {
  it('gives every lifter on the board a row, with the identifier the board prints', () => {
    const { timeline, context } = threeLifters();
    const board = buildBoardView(timeline.present, context);

    const pack = buildHandlerPack(timeline.present, board, null, rulesFor());

    expect(pack.lifters).toHaveLength(3);
    expect(pack.lifters.map((lifter) => lifter.identifier).sort()).toEqual(['12', '31', '48']);
    expect(pack.lifters.every((lifter) => lifter.name !== '')).toBe(true);
  });

  it('prints every declared weight, not just the one the board is working towards', () => {
    const { timeline, context } = threeLifters();
    const board = buildBoardView(timeline.present, context);

    const pack = buildHandlerPack(timeline.present, board, null, rulesFor());
    const squat = pack.lifters.at(0)?.lifts.find((lift) => lift.lift === 'squat');

    // Three cells per lift whatever is on them: a handler needs a row of the same
    // width for every lifter, and an undeclared attempt is a blank to write in.
    expect(squat?.attempts).toHaveLength(3);
  });

  it('leaves the lifts of the format and no others', () => {
    const timeline = boardMeet(BOARD_LIFTERS, 'bench-only');
    const board = buildBoardView(timeline.present, boardContextAt(AT));

    const pack = buildHandlerPack(timeline.present, board, null, rulesFor());

    expect(pack.format).toBe('bench-only');
    for (const lifter of pack.lifters) {
      expect(lifter.lifts.map((lift) => lift.lift)).toEqual(['bench']);
    }
  });

  it('names the conflicts as codes and leaves the wording to the board', () => {
    // Two lifters whose declaration clocks are ten seconds apart, which is §21.2's
    // warning that a handler cannot be in two places at once.
    const { timeline, context } = threeLifters();
    const sooner = lifterIdAt(timeline.present, 0);
    const later = lifterIdAt(timeline.present, 1);
    const run = takeFor(
      takeFor(timeline, sooner, 'squat', 180, AT),
      later,
      'squat',
      180,
      AT + 10_000,
    );
    const board = buildBoardView(run.present, context);

    const pack = buildHandlerPack(run.present, board, null, rulesFor());
    const codes = pack.lifters.flatMap((lifter) => lifter.conflicts);

    expect(codes).toContain('submission-deadlines-overlap');
  });

  /**
   * §23.2's warm-up start ranges. The pack carries the board's figures and does
   * not recompute them, so what is worth asserting is that each row kept its own
   * -- which needs the roster fixture, since `threeLifters` alone hands every
   * lifter the one shared schedule and three identical leads (§13.17).
   */
  it('carries each lifter’s own warm-up lead through from the board', () => {
    const pack = handlerPackOf();

    const leads = pack.lifters.map((lifter) => lifter.warmupLead);

    expect(leads.every((lead) => lead?.lift === 'squat')).toBe(true);
    expect(new Set(leads.map((lead) => lead?.minimumSeconds)).size).toBe(pack.lifters.length);
  });

  /**
   * The contrast, and the state three of the four roster fixtures are in: no
   * warm-up screen has been filled in for anybody, so there is no lead to print
   * and the sheet says nothing rather than a zero.
   */
  it('leaves the lead off a roster where no ramp was planned', () => {
    const { timeline, context } = threeLifters();
    const board = buildBoardView(timeline.present, context);

    const pack = buildHandlerPack(timeline.present, board, null, rulesFor());

    expect(pack.lifters.every((lifter) => lifter.warmupLead === null)).toBe(true);
  });

  it('declares what a handler has to write in, because nothing holds it per lifter', () => {
    const { timeline, context } = threeLifters();
    const board = buildBoardView(timeline.present, context);

    expect(buildHandlerPack(timeline.present, board, null, rulesFor()).writeIn).toEqual([
      'flight',
      'platform',
      'rack-settings',
      'results',
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Helpers for the one test that walks a document by hand.
 * ---------------------------------------------------------------------------
 */

function act(timeline: MeetTimeline, action: MeetAction): MeetTimeline {
  const applied = applyMeetAction(rulesFor(), timeline, action, AT);
  if (!applied.ok) throw new Error(`refused: ${applied.problems[0]?.code ?? 'none'}`);
  return applied.timeline;
}

function attemptIdAt(
  document: MeetDocument,
  lifterId: string,
  lift: PlatformLift,
  index: number,
): string {
  const lifter = findLifter(document, lifterId);
  if (lifter === null) throw new Error('the scratch meet lost its lifter');
  const attempt = attemptsOn(lifter, lift).at(index);
  if (attempt === undefined) throw new Error(`no attempt ${String(index + 1)} on the ${lift}`);
  return attempt.id;
}
