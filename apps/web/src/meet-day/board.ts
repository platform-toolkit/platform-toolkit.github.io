// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's coach board, as one value: who needs the coach next, and what for.
 *
 * The third pure builder in this directory, and the same kind of thing as
 * `plan.ts` and `live.ts` -- state plus a rule book in, something renderable
 * out, no DOM, no clock, nothing kept between calls. The transport stays in
 * `view.ts`.
 *
 * WHY THE MERGE IS HERE AND NOT IN THE DOMAIN
 *
 * Three domain modules answer §21 and none of them knows about the others.
 * `coachBoard` ranks the lifters, `coachBoardConflicts` warns about pairs, and
 * `rackSequences` plans the shared bar. `coach-board.ts` says outright that
 * conflicts are not its business -- "a view merges the two" -- and the reason
 * is worth restating where the merge finally happens: taking the board as an
 * *input* to the warnings would let a caller hand over one built at a different
 * instant and get warned about a collision that has already resolved.
 *
 * So this is the merge, and the single thing it contributes is that all three
 * projections are called with **one** `now`. A caller wiring the three elements
 * separately would sooner or later read the clock twice in one paint, and the
 * symptom is a row marked as clashing with a lifter whose window closed between
 * the two reads -- on screen for one frame, four times a second, on a board a
 * coach is trying to read in three seconds.
 *
 * WHY THE NAMES ARE RESOLVED HERE
 *
 * A conflict names lifters by id, because the domain has no business holding a
 * person's name (§2.3) and no way to know what a board chooses to call them.
 * A warning rendered as "clashes with lifter-3" is a warning nobody can act on,
 * so the ids are turned into what the board itself already prints -- the name
 * *and* §21's distinctive identifier, together, because two lifters called Sam
 * is exactly the flight where this warning matters most.
 *
 * WHAT IS DELIBERATELY NOT DECIDED HERE
 *
 * Which rows are on screen. §21.1 asks for a pin and a one-tap switch, and a
 * pinned row does not move: `CoachBoardRow.pinned` is carried through and the
 * element filters on it. Sorting or hoisting a pinned lifter here would mean the
 * rank a coach learns to scan changes meaning the moment somebody is pinned,
 * which is the one property a triage list cannot afford to lose.
 */
import {
  attemptWeightFor,
  coachBoard,
  coachBoardConflicts,
  rackSequences,
  warmupLeadRange,
  type AttemptWeight,
  type CoachBoardConflictCode,
  type CoachBoardEntry,
  type CoachBoardRow,
  type ConflictPriorityReason,
  type ConversionChart,
  type MeetDocument,
  type MeetRules,
  type RackSequence,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

/*
 * ---------------------------------------------------------------------------
 * What the caller supplies.
 * ---------------------------------------------------------------------------
 */

export interface BoardContext {
  readonly rules: MeetRules;
  /**
   * §16's published chart, or `null`.
   *
   * A pound figure beside an attempt is read off the chart and never computed,
   * the same rule the live screen follows. `null` is a supported state and is
   * what a federation with no published chart looks like.
   */
  readonly chart: ConversionChart | null;
  /**
   * The per-device context the meet document deliberately does not carry.
   *
   * Bib number, colour, handlers, which bar, whether the lifter has been called,
   * and the pin. None of it is a fact about the meet -- it is what one coach's
   * phone knows about the lifters that coach is running.
   */
  readonly entries: readonly CoachBoardEntry[];
  /** From `apps/web/src/clock.ts`. Never read here. */
  readonly now: number;
  /** How far ahead the rack panel plans, in seconds. The whole ramp when absent. */
  readonly rackHorizonSeconds?: number | undefined;
  /**
   * Which lift the schedules on {@link entries} are ramps for.
   *
   * Supplied rather than derived, because it cannot be derived: `meet-warmup.ts`
   * maps squat and bench onto one warm-up *family*, so a `MeetWarmupSchedule`
   * knows it is a squat-or-bench ramp and not which. The caller picked the lift
   * to build the schedules with and is the only thing that still knows it.
   *
   * Absent means the board was built without one, and {@link BoardRowView.warmupLead}
   * is then `null` on every row -- the honest answer, since an unlabelled lead on
   * a sheet listing three lifts per lifter is an invitation to apply a squat ramp
   * to a deadlift.
   */
  readonly warmupLift?: PlatformLift | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * What it produces.
 * ---------------------------------------------------------------------------
 */

/** A lifter, as this board names them. */
export interface BoardLifterRef {
  readonly lifterId: string;
  readonly name: string;
  /** §21's distinctive identifier. Never blank -- `coachBoard` guarantees it. */
  readonly identifier: string;
}

/**
 * One §21.2 warning, told from one row's point of view.
 *
 * `servedFirst` rather than the priority lifter's name, because the same
 * conflict is rendered on both rows and each of them wants the opposite
 * sentence. A name here would put "Bo first" on Bo's own row, which reads as a
 * third lifter nobody can find.
 */
export interface BoardRowConflict {
  readonly code: CoachBoardConflictCode;
  /** Everybody else the warning names, in the order the domain gave them. */
  readonly others: readonly BoardLifterRef[];
  /** Whether this row is the one the domain suggests serving first. */
  readonly servedFirst: boolean;
  readonly reason: ConflictPriorityReason;
  /** Seconds between the two things. Never negative; `null` when there is no gap to state. */
  readonly separationSeconds: number | null;
  /** The handler both lifters are asking for, on the one warning that is about a person. */
  readonly handlerName: string | null;
}

export interface BoardRowView {
  readonly row: CoachBoardRow;
  /**
   * §21's "proposed next attempt", with §16's two figures.
   *
   * `null` covers both no attempt and an attempt with no weight on it; the row's
   * own `current` says which, and the two are different sentences.
   */
  readonly proposed: AttemptWeight | null;
  readonly conflicts: readonly BoardRowConflict[];
  /**
   * How long before the bar this lifter's ramp starts. `null` where no schedule
   * was handed in for them, or where the board was built with no lift.
   */
  readonly warmupLead: WarmupLead | null;
}

/**
 * The one figure off a warm-up schedule that survives being printed.
 *
 * `warmupLeadRange` cancels the platform estimate out of both ends, so what is
 * left does not move when the flight does -- which is exactly what §23.2's sheet
 * needs, since paper is read hours after it is printed and on the day the meet
 * is running late. Everything else on a schedule is seconds from the instant it
 * was built, and a minutes-from-now figure on paper sends a handler to the rack
 * an hour early and cold.
 *
 * The lift travels *with* the two figures rather than beside them on the board,
 * so the printed line labels itself and no board-level field has to be kept in
 * step with the schedules the rows were built from.
 */
export interface WarmupLead {
  readonly lift: PlatformLift;
  /** The shorter lead, behind the late end of the platform estimate. */
  readonly minimumSeconds: number;
  /** The longer lead, behind the early end. */
  readonly maximumSeconds: number;
}

export interface BoardView {
  /** Already sorted by the domain's urgency ladder. `rank` is 1-based and matches. */
  readonly rows: readonly BoardRowView[];
  readonly focusLifterId: string | null;
  /** Every warning once, for a summary that must not count a pair twice. */
  readonly conflictCount: number;
  /** §21.4, one plan per shared bar. Empty for a room nobody has described. */
  readonly racks: readonly RackSequence[];
}

/**
 * A board with nobody on it.
 *
 * Exported for the lit-html hazard this directory keeps rediscovering: a
 * property binding *assigns* the bound value over the child's class-field
 * default, so binding a nullable view into an element that declares a non-null
 * one puts the null on the property and the first render throws. Nothing
 * type-checks a lit-html binding. Bind `.view=${board ?? EMPTY_BOARD_VIEW}`.
 */
export const EMPTY_BOARD_VIEW: BoardView = {
  rows: [],
  focusLifterId: null,
  conflictCount: 0,
  racks: [],
};

/*
 * ---------------------------------------------------------------------------
 * Building it.
 * ---------------------------------------------------------------------------
 */

/**
 * §21, from a meet document and an instant.
 *
 * Total: a meet with no lifters produces an empty board rather than an error,
 * which is what the screen looks like before anybody has been added.
 */
export function buildBoardView(document: MeetDocument, context: BoardContext): BoardView {
  const request = {
    rules: context.rules,
    document,
    entries: context.entries,
    now: context.now,
  };

  const board = coachBoard(request);
  const conflicts = coachBoardConflicts(request);
  const racks = rackSequences({
    entries: context.entries,
    now: context.now,
    horizonSeconds: context.rackHorizonSeconds,
  });

  const leads = warmupLeadsIn(context.entries, context.warmupLift ?? null);

  const refs = new Map<string, BoardLifterRef>(
    board.rows.map((row) => [
      row.lifterId,
      { lifterId: row.lifterId, name: row.name, identifier: row.identifier },
    ]),
  );

  return {
    rows: board.rows.map((row) => ({
      row,
      proposed: proposedWeightFor(row, context.chart),
      conflicts: (conflicts.byLifter.get(row.lifterId) ?? []).map((conflict) => ({
        code: conflict.code,
        others: conflict.lifterIds
          .filter((lifterId) => lifterId !== row.lifterId)
          .map((lifterId) => refs.get(lifterId))
          .filter((ref): ref is BoardLifterRef => ref !== undefined),
        servedFirst: conflict.priority.lifterId === row.lifterId,
        reason: conflict.priority.reason,
        separationSeconds: conflict.separationSeconds,
        handlerName: conflict.handlerName,
      })),
      warmupLead: leads.get(row.lifterId) ?? null,
    })),
    focusLifterId: board.focusLifterId,
    // Off the flat list, not off the sum of the per-row lists. A pair appears on
    // two rows, so summing would report every clash in the room twice and a
    // heading reading "4 warnings" over two of them is the tool looking broken
    // in the direction that costs attention.
    conflictCount: conflicts.conflicts.length,
    racks,
  };
}

/**
 * Every lifter's durable lead, keyed by lifter id.
 *
 * Built off the entries rather than off the rows because that is where the
 * schedules are, and a lifter with no schedule is simply absent from the map --
 * which the row lookup turns back into `null`. A `0` would read on paper as a
 * ramp that starts when the bar is called.
 */
function warmupLeadsIn(
  entries: readonly CoachBoardEntry[],
  lift: PlatformLift | null,
): Map<string, WarmupLead> {
  const leads = new Map<string, WarmupLead>();
  if (lift === null) return leads;
  for (const entry of entries) {
    const timeline = entry.warmup ?? null;
    if (timeline === null) continue;
    const range = warmupLeadRange(timeline.schedule);
    leads.set(entry.lifterId, {
      lift,
      minimumSeconds: range.minimumSeconds,
      maximumSeconds: range.maximumSeconds,
    });
  }
  return leads;
}

/**
 * §16's reading of the weight the lifter is proposing.
 *
 * Resolved here rather than in the element for the reason §13.7 records about
 * the choices cards: a second array kept alongside the rows is a second thing to
 * keep in step, and the failure when it slips is a pound figure printed beside
 * the wrong lifter's kilograms -- read off a phone and called across a warm-up
 * room.
 */
function proposedWeightFor(
  row: CoachBoardRow,
  chart: ConversionChart | null,
): AttemptWeight | null {
  const kilograms = row.current?.proposedKilograms ?? null;
  if (kilograms === null) return null;
  return attemptWeightFor(kilograms, chart);
}
