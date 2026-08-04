// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's board, as a value. The element is `ptk-coach-board.browser.test.ts`.
 *
 * Everything here is about the merge, because the merge is the only thing this
 * module does: three domain projections read at one instant, ids turned into the
 * names the board itself prints, and a count that must not report a pair twice.
 * The ranking, the warnings and the rack plan are already covered where they are
 * decided, and asserting them again here would be a second copy of a suite that
 * cannot fail independently.
 */
import { describe, expect, it } from 'vitest';

import { createMeetDocument, startTimeline } from '@platform-toolkit/domain';

import { EMPTY_BOARD_VIEW, buildBoardView, type BoardRowView } from './board.js';
import {
  BOARD_LIFTERS,
  RACK,
  boardAt,
  chooseFor,
  contextAt,
  lifterIdAt,
  minutes,
  sharedRack,
  takeFor,
  threeLifters,
} from './board-fixture.js';
import { OPENER, RULES, SECOND, START } from './live-fixture.js';

function rowFor(rows: readonly BoardRowView[], lifterId: string): BoardRowView {
  const found = rows.find((candidate) => candidate.row.lifterId === lifterId);
  if (found === undefined) throw new Error('the board has no row for that lifter');
  return found;
}

describe('buildBoardView', () => {
  it('answers a meet with nobody in it with an empty board rather than an error', () => {
    const empty = startTimeline(createMeetDocument(RULES, 'full-power'));

    expect(buildBoardView(empty.present, contextAt(START))).toEqual(EMPTY_BOARD_VIEW);
  });

  it('gives every lifter a row, carrying the name and the identifier the board prints', () => {
    const { timeline, context } = threeLifters();

    const view = boardAt(timeline, context);

    expect(view.rows.map((row) => row.row.name).sort()).toEqual([...BOARD_LIFTERS].sort());
    expect(view.rows.map((row) => row.row.identifier).sort()).toEqual(['12', '31', '48']);
  });

  it('reports the top row as the lifter to go to', () => {
    const { timeline, context } = threeLifters();

    const view = boardAt(timeline, context);

    expect(view.focusLifterId).toBe(view.rows[0]?.row.lifterId);
  });

  /*
   * ---------------------------------------------------------------------------
   * §16, resolved per row.
   * ---------------------------------------------------------------------------
   */

  it('reads the proposed weight off the chart and leaves an undeclared attempt null', () => {
    const { timeline, context } = threeLifters();
    const chooser = lifterIdAt(timeline.present, 0);
    const waiting = lifterIdAt(timeline.present, 1);

    const view = boardAt(chooseFor(timeline, chooser, 'squat', OPENER), context);

    const proposed = rowFor(view.rows, chooser).proposed;
    expect(proposed?.kilograms).toBe(OPENER);
    // Read, never computed. The fixture chart is 5 kg apart from 150, so the
    // opener is on a row and carries a published figure rather than a hedge --
    // asserted as a number, because `not.toBeNull` also passes for `undefined`
    // and would have gone on passing against a renamed field.
    expect(typeof proposed?.publishedPounds).toBe('number');
    expect(proposed?.publishedPoundsReason).toBe('published');
    expect(rowFor(view.rows, waiting).proposed).toBeNull();
  });

  /**
   * The §13.7 failure, one screen along: two lifters, two weights, and a pound
   * figure printed beside the wrong kilogram figure. A per-row resolution cannot
   * produce it and a second array kept alongside the rows eventually does, so
   * this asserts both rows at once rather than one of them.
   */
  it('keeps each lifter’s pound figure on that lifter’s row', () => {
    const { timeline, context } = threeLifters();
    const first = lifterIdAt(timeline.present, 0);
    const second = lifterIdAt(timeline.present, 1);

    const view = boardAt(
      chooseFor(chooseFor(timeline, first, 'squat', OPENER), second, 'squat', SECOND),
      context,
    );

    expect(rowFor(view.rows, first).proposed?.kilograms).toBe(OPENER);
    expect(rowFor(view.rows, second).proposed?.kilograms).toBe(SECOND);
    const lighter = rowFor(view.rows, first).proposed?.publishedPounds;
    const heavier = rowFor(view.rows, second).proposed?.publishedPounds;
    expect(typeof lighter).toBe('number');
    expect(heavier).not.toBe(lighter);
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.2, told from each row's point of view.
   * ---------------------------------------------------------------------------
   */

  /** Two recorded results ten seconds apart, which is inside one errand. */
  function overlappingDeadlines(): {
    view: ReturnType<typeof boardAt>;
    sooner: string;
    later: string;
  } {
    const { timeline, context } = threeLifters(START + 20_000);
    const sooner = lifterIdAt(timeline.present, 0);
    const later = lifterIdAt(timeline.present, 1);
    const run = takeFor(
      takeFor(timeline, sooner, 'squat', OPENER, START),
      later,
      'squat',
      OPENER,
      START + 10_000,
    );
    return { view: boardAt(run, context), sooner, later };
  }

  it('puts one warning on both rows and names the other lifter on each', () => {
    const { view, sooner, later } = overlappingDeadlines();

    const onSooner = rowFor(view.rows, sooner).conflicts;
    const onLater = rowFor(view.rows, later).conflicts;

    expect(onSooner).toHaveLength(1);
    expect(onLater).toHaveLength(1);
    expect(onSooner[0]?.code).toBe('submission-deadlines-overlap');
    expect(onSooner[0]?.others.map((ref) => ref.lifterId)).toEqual([later]);
    expect(onLater[0]?.others.map((ref) => ref.lifterId)).toEqual([sooner]);
  });

  /**
   * The reason the projection exists. The domain names one lifter as the one to
   * serve first, and rendering that name on both rows puts "Bo first" on Bo's own
   * row -- which reads as a third lifter nobody in the room can find.
   */
  it('answers "you first" on exactly one of the two rows', () => {
    const { view, sooner, later } = overlappingDeadlines();

    expect(rowFor(view.rows, sooner).conflicts[0]?.servedFirst).toBe(true);
    expect(rowFor(view.rows, later).conflicts[0]?.servedFirst).toBe(false);
    expect(rowFor(view.rows, sooner).conflicts[0]?.reason).toBe('sooner-deadline');
  });

  it('resolves the other lifter to the name and identifier the board itself prints', () => {
    const { view, sooner, later } = overlappingDeadlines();

    const named = rowFor(view.rows, sooner).conflicts[0]?.others[0];

    expect(named?.name).toBe(rowFor(view.rows, later).row.name);
    expect(named?.identifier).toBe(rowFor(view.rows, later).row.identifier);
  });

  /**
   * A pair appears on two rows. Summing the per-row lists would head two warnings
   * "4 clashes", which is the tool looking broken in the direction that costs
   * attention on the one screen that exists to ration it.
   */
  it('counts a clash once, not once per lifter caught in it', () => {
    const { view } = overlappingDeadlines();

    const perRow = view.rows.reduce((total, row) => total + row.conflicts.length, 0);

    expect(perRow).toBe(2);
    expect(view.conflictCount).toBe(1);
  });

  it('leaves a lifter with nothing running out of the warning', () => {
    const { view } = overlappingDeadlines();
    const uninvolved = view.rows.filter((row) => row.conflicts.length === 0);

    expect(uninvolved).toHaveLength(1);
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.4.
   * ---------------------------------------------------------------------------
   */

  it('plans the shared bar and leaves a room nobody has described without one', () => {
    const shared = sharedRack();
    const separate = threeLifters();

    const planned = boardAt(shared.timeline, shared.context).racks;

    expect(planned.map((rack) => rack.rackId)).toEqual([RACK]);
    expect(planned[0]?.loads.length).toBeGreaterThan(1);
    expect(boardAt(separate.timeline, separate.context).racks).toEqual([]);
  });

  it('plans only as far ahead as the caller asked', () => {
    const { timeline, context } = sharedRack();

    const whole = boardAt(timeline, context).racks[0]?.loads.length ?? 0;
    const soon =
      boardAt(timeline, { ...context, rackHorizonSeconds: minutes(7) }).racks[0]?.loads.length ?? 0;

    expect(whole).toBeGreaterThan(soon);
    expect(soon).toBeGreaterThan(0);
  });

  /*
   * ---------------------------------------------------------------------------
   * One instant, three projections.
   * ---------------------------------------------------------------------------
   */

  it('is a pure function of the document and the instant', () => {
    const { timeline, context } = threeLifters();

    expect(boardAt(timeline, context)).toEqual(boardAt(timeline, context));
  });

  /**
   * The whole reason the merge is one function. Read at two instants the board
   * says two different things, so a caller wiring the three projections
   * separately would sooner or later read the clock twice in one paint and warn
   * about a clash that had already resolved.
   */
  it('moves with the clock, so a lapsed clock stops being a clash', () => {
    const { timeline, context } = threeLifters(START + 20_000);
    const sooner = lifterIdAt(timeline.present, 0);
    const later = lifterIdAt(timeline.present, 1);
    const run = takeFor(
      takeFor(timeline, sooner, 'squat', OPENER, START),
      later,
      'squat',
      OPENER,
      START + 10_000,
    );

    const during = boardAt(run, context);
    const afterwards = boardAt(run, { ...context, now: START + minutes(30) * 1000 });

    expect(during.conflictCount).toBe(1);
    expect(afterwards.conflictCount).toBe(0);
  });
});
