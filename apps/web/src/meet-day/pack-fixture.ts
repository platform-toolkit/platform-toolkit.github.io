// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23's two sheets, in the states worth printing, for this tool's tests and
 * stories.
 *
 * Extracted from `pack.test.ts` for the reason `live-fixture.ts` was extracted
 * from `live.test.ts` (§13.7): a `MeetPack` is a projection of a session, a
 * plan, a preparation record and a rule book, and a story that assembled its own
 * four would drift away from the suite that was supposed to cover it -- silently,
 * because both would keep rendering something sheet-shaped. There is one pack
 * builder here and every caller in the directory goes through it.
 *
 * Nothing is a literal. The session is built with the tool's own transitions, the
 * preparation record with `withLifterSetup` and `addCustomItem`, the plan with
 * `buildPlan`, and the handler roster with `applyMeetAction` through
 * `board-fixture.ts`. A hand-written pack can hold a sheet the builder would
 * never produce -- an attempt with no subtotal under it, a checklist whose
 * progress line disagrees with its rows -- and those are exactly the sheets a
 * reviewer would study.
 *
 * Nothing that ships may import this file.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { buildBoardView } from './board.js';
import {
  boardMeet,
  contextAt,
  entryFor,
  lifterIdAt,
  takeFor,
  threeLifters,
} from './board-fixture.js';
import { rulesFor } from './meet-rules.fixture.js';
import {
  buildHandlerPack,
  buildMeetPack,
  type HandlerPack,
  type MeetPack,
  type PackRequest,
} from './pack.js';
import { CHARTED_CONTEXT, PLAN_CONTEXT } from './planner-fixture.js';
import { buildPlan, type PlanContext } from './plan.js';
import {
  EMPTY_PREP,
  addCustomItem,
  withChecklistItem,
  withLifterSetup,
  withPrepNotes,
  type ChecklistContext,
  type MeetPrep,
} from './prep.js';
import { EMPTY_SESSION, confirmMaximum, withFigures, type PlannerSession } from './session.js';

const LIFTS: readonly PlatformLift[] = ['squat', 'bench', 'deadlift'];

/**
 * The instant the scratch contingency documents are stamped with.
 *
 * Fixed rather than read from a clock, for the reason `board-fixture.ts` fixes
 * `START`: nothing on either sheet is a time, but the scratch actions carry one,
 * and a fixture on the system clock makes two runs of the same suite two
 * different documents.
 */
export const PACK_AT = 1_700_000_000_000;

/** A full-power raw meet with no record ambitions: the ordinary case. */
export const ORDINARY: ChecklistContext = {
  format: 'full-power',
  equipment: 'raw',
  goal: 'balanced',
};

/** A whole session with one maximum on every lift, agreed to. */
export function planned(kilograms = '200'): PlannerSession {
  const typed = LIFTS.reduce(
    (carry, lift) => withFigures(carry, lift, { expectedMaximum: kilograms }),
    EMPTY_SESSION,
  );
  return LIFTS.reduce((carry, lift) => confirmMaximum(carry, lift, true), typed);
}

/**
 * The sheet §23.1 describes, from a session that answered everything.
 *
 * The context defaults to the chartless one, the way `viewFor` does, so a caller
 * that wants the published pound column says so in its own source.
 */
export function packOf(session: PlannerSession, patch: Partial<PackRequest> = {}): MeetPack {
  const context: PlanContext = PLAN_CONTEXT;
  return buildMeetPack({
    rules: context.rules,
    chart: context.chart,
    session,
    view: buildPlan(session, context),
    prep: EMPTY_PREP,
    checklistContext: ORDINARY,
    lifterName: 'Dana Okafor',
    at: PACK_AT,
    ...patch,
  });
}

/**
 * §22 answered the night before: rack heights, times, ticks and a note.
 *
 * Deliberately not every answer. Two of the sixteen are left blank -- the
 * monolift setting on a walkout, and the bench safety height -- because the
 * ruled line a blank draws is the part of the setup section most likely to
 * regress into an empty gap, and a fixture that answered everything would leave
 * it with no coverage at all.
 */
export function filledPrep(): MeetPrep {
  const answered = withLifterSetup(EMPTY_PREP, {
    squatRackHeight: '12',
    squatSafetyHeight: '4',
    squatStart: 'monolift',
    benchRackHeight: '7',
    footBlocks: 'yes',
    handoff: 'own-handler',
    deadliftNotes: 'Deadlift bar on platform two -- thinner knurl.',
    commands: 'Start, press, rack. No squat command on the walkout.',
    flight: 'B',
    lot: '42',
    platform: '2',
    session: 'Afternoon',
    weighInTime: '8:00 am',
    liftingStartTime: '10:30 am',
  });
  const noted = withPrepNotes(
    answered,
    'Ask the expeditor about the second rack height before the flight is called.',
  );
  const added = addCustomItem(noted, 'Second singlet in the car');
  if (!added.ok) throw new Error(`the fixture custom item was refused: ${added.refusal}`);
  const own = added.prep.custom.at(-1);
  if (own === undefined) throw new Error('the fixture custom item did not land');
  return ['singlet', 'belt', 'chalk-and-powder', own.itemId].reduce(
    (carry, itemId) => withChecklistItem(carry, itemId, true),
    added.prep,
  );
}

/**
 * The sheet as a lifter who used the whole tool would print it.
 *
 * Charted, so the pound column is the federation's own printing rather than
 * absent (§16), and prepared, so the setup facts, the checklist and the notes are
 * all populated. This is the story a reviewer should be able to read end to end.
 */
export function fullPack(session: PlannerSession = planned()): MeetPack {
  return packOf(session, {
    chart: CHARTED_CONTEXT.chart,
    view: buildPlan(session, CHARTED_CONTEXT),
    prep: filledPrep(),
  });
}

/**
 * The sheet before anything was answered, which is a real thing to print.
 *
 * §23 calls the printed pack a battery and connectivity fallback, so it is
 * reached by a lifter whose phone died -- possibly before they typed anything.
 * Every section that has nothing to say either draws a ruled line or is dropped,
 * and which of the two is right differs per section; this is the state that shows
 * it.
 */
export function blankPack(): MeetPack {
  return packOf(EMPTY_SESSION, { lifterName: '' });
}

/*
 * ---------------------------------------------------------------------------
 * §23.2, the roster.
 * ---------------------------------------------------------------------------
 */

/** The default flight of three, with a handler on the first of them. */
export function handlerPackOf(): HandlerPack {
  const { timeline, context } = threeLifters();
  const first = lifterIdAt(timeline.present, 0);
  const withHandlers = {
    ...context,
    entries: context.entries.map((entry) =>
      entry.lifterId === first
        ? {
            ...entry,
            // Invented (§5.1), and deliberately not one of `BOARD_LIFTERS`: a
            // handler sharing a lifter's name makes the roster unreadable in
            // exactly the column that says who to shout at.
            handlers: [{ name: 'Kit Marlowe', responsibilities: ['attempt-submission'] as const }],
          }
        : entry,
    ),
  };
  const run = takeFor(timeline, first, 'squat', 180, PACK_AT);
  return buildHandlerPack(
    run.present,
    buildBoardView(run.present, withHandlers),
    CHARTED_CONTEXT.chart,
    rulesFor(),
  );
}

/**
 * §21.2's clash, on paper: two minutes expiring inside one errand.
 *
 * Printed as codes under one lifter rather than as the board's own sentence
 * naming the other -- the roster carries every lifter, so the sheet says who is
 * clashing by having them both on it.
 */
export function clashingHandlerPack(): HandlerPack {
  const { timeline, context } = threeLifters(PACK_AT + 20_000);
  const sooner = lifterIdAt(timeline.present, 0);
  const later = lifterIdAt(timeline.present, 1);
  const run = takeFor(
    takeFor(timeline, sooner, 'squat', 180, PACK_AT),
    later,
    'squat',
    180,
    PACK_AT + 10_000,
  );
  return buildHandlerPack(run.present, buildBoardView(run.present, context), null, rulesFor());
}

/**
 * A bench-only meet with nobody set up on this phone.
 *
 * One lift rather than three, so a sheet that drew a fixed squat/bench/deadlift
 * block whatever the format would print two rows of blanks nobody is lifting; and
 * no per-device entry, so every identifier is the position the board filled in and
 * no lifter has a handler.
 */
export function benchOnlyHandlerPack(): HandlerPack {
  const timeline = boardMeet(undefined, 'bench-only');
  const board = buildBoardView(timeline.present, contextAt(PACK_AT));
  return buildHandlerPack(timeline.present, board, null, rulesFor());
}

/** One lifter, set up, with nothing declared: the roster a handler prints first. */
export function undeclaredHandlerPack(): HandlerPack {
  const timeline = boardMeet(['Dana Okafor']);
  const lifterId = lifterIdAt(timeline.present, 0);
  const board = buildBoardView(
    timeline.present,
    contextAt(PACK_AT, { entries: [entryFor(lifterId, { identifier: '12' })] }),
  );
  return buildHandlerPack(timeline.present, board, null, rulesFor());
}
