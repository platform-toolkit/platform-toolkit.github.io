// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21: three lifters on one phone, and which of them the coach goes to.
 *
 * The assertions that matter here are about *order* and about *identity*, which
 * is what a triage list turns out to be. A board that renders every fact for
 * every lifter still looks finished while sorting the rows into an order the
 * domain did not choose, or while sending a pin to the athlete above the one the
 * thumb landed on -- and neither shows up in a test written as "the name is on
 * the screen", because on this screen every name is.
 *
 * So: the rendered order is compared against the view's order rather than
 * against a list of names; the pinned filter is checked for *not* reordering as
 * well as for hiding; and both outbound events are pressed on the second row,
 * never the first, because a handler that ignored its `data-lifter` entirely
 * would pass every test that pressed the top one.
 *
 * Every state comes out of `board-fixture.ts` through `applyMeetAction`, so none
 * is a document a meet could not produce. A real browser because the composition
 * is the thing under test -- the buttons, the notices and the filter are other
 * custom elements, and a jsdom run would assert against tags rather than against
 * text a coach can read.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { BOARD_EMPTY_NOTE, NO_PINNED_LIFTERS, RACK_NONE_NOTE, boardLifterText } from './copy.js';
import { EMPTY_BOARD_VIEW, type BoardView } from './board.js';
import {
  RACK,
  boardAt,
  chooseFor,
  contextAt,
  type entryFor,
  lifterIdAt,
  sharedRack,
  takeFor,
  threeLifters,
} from './board-fixture.js';
import { OPENER, START } from './live-fixture.js';
import {
  BOARD_OPEN_EVENT,
  BOARD_PIN_EVENT,
  type BoardOpenDetail,
  type BoardPinDetail,
  type PtkCoachBoard,
} from './ptk-coach-board.js';
import './ptk-coach-board.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/*
 * ---------------------------------------------------------------------------
 * The states.
 * ---------------------------------------------------------------------------
 */

/**
 * The default flight: Dana warming up, Bo and Ines still waiting.
 *
 * Two urgency levels over three rows, and the runs are 1 and 2 rather than 1 and
 * 1 -- a fixture where every row had its own heading could not tell a grouping
 * apart from a heading printed above each row.
 */
function flight(): BoardView {
  const { timeline, context } = threeLifters();
  return boardAt(timeline, context);
}

/** The same flight with a pin on the lifters named by position. */
function pinning(...positions: readonly number[]): BoardView {
  const { timeline, context } = threeLifters();
  const ids = positions.map((position) => lifterIdAt(timeline.present, position));
  return boardAt(timeline, {
    ...context,
    entries: context.entries.map((entry) =>
      ids.includes(entry.lifterId) ? { ...entry, pinned: true } : entry,
    ),
  });
}

/** The same flight with one entry patched, for the cases that are about one row. */
function patching(position: number, patch: Parameters<typeof entryFor>[1]): BoardView {
  const { timeline, context } = threeLifters();
  const lifterId = lifterIdAt(timeline.present, position);
  return boardAt(timeline, {
    ...context,
    entries: context.entries.map((entry) =>
      entry.lifterId === lifterId ? { ...entry, ...patch } : entry,
    ),
  });
}

/**
 * A declared opener, which is the only row with a weight on it.
 *
 * `chooseFor` and not `takeFor`: taking the attempt *records a result*, which
 * completes it and moves the row on to an attempt nobody has chosen a weight
 * for -- so a fixture built that way has no weight anywhere on the board and
 * the two assertions below measure an empty board rather than a declared one.
 */
function declared(): BoardView {
  const { timeline, context } = threeLifters();
  const first = lifterIdAt(timeline.present, 0);
  return boardAt(chooseFor(timeline, first, 'squat', OPENER, START), {
    ...context,
    now: START + 1000,
  });
}

/** §21.2: two recorded results ten seconds apart, which is inside one errand. */
function clashing(): BoardView {
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
  return boardAt(run, context);
}

/** §21.4: two lifters queueing for one bar, with a pin on only one of them. */
function shared(): BoardView {
  const { timeline, context } = sharedRack();
  const [first, ...rest] = context.entries;
  if (first === undefined) throw new Error('the shared-rack fixture has no entries');
  return boardAt(timeline, { ...context, entries: [{ ...first, pinned: true }, ...rest] });
}

/** A meet with lifters in it but nobody set up -- no warm-up, no bar, no clock. */
function unscheduled(): BoardView {
  const { timeline } = threeLifters();
  return boardAt(timeline, contextAt(START, { entries: [] }));
}

/*
 * ---------------------------------------------------------------------------
 * Mounting and reading.
 * ---------------------------------------------------------------------------
 */

async function mount(view: BoardView = flight()): Promise<PtkCoachBoard> {
  const element = document.createElement('ptk-coach-board');
  element.view = view;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkCoachBoard, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textOf(element: PtkCoachBoard, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The board has no ${selector}.`);
  return found.textContent.trim();
}

/** Each row's `.who` line, in the order the board drew them. */
function order(element: PtkCoachBoard): string[] {
  return query(element, '.row .who').map((who) => who.textContent.trim());
}

/** What the view says the order is, in the same words the rows carry. */
function expectedOrder(view: BoardView, onlyPinned = false): string[] {
  return view.rows
    .filter((entry) => !onlyPinned || entry.row.pinned)
    .map((entry) =>
      boardLifterText({
        lifterId: entry.row.lifterId,
        name: entry.row.name,
        identifier: entry.row.identifier,
      }),
    );
}

/**
 * Press "Pinned only", through the real control rather than through the state.
 *
 * A press and not a set, because the box is a toggle and the second press is
 * the half of it a board that latched on would fail.
 */
async function pressPinnedOnly(element: PtkCoachBoard): Promise<void> {
  const [group] = query(element, 'ptk-toggle-group');
  const box = group?.shadowRoot?.querySelector('input[type="checkbox"]');
  if (!(box instanceof HTMLInputElement)) throw new Error('The board has no pinned-only filter.');
  box.click();
  await element.updateComplete;
}

function pressIn(element: PtkCoachBoard, rowIndex: number, selector: string): void {
  const row = query(element, '.row')[rowIndex];
  const control = row?.querySelector(selector);
  if (!(control instanceof HTMLElement)) {
    throw new Error(`Row ${String(rowIndex)} has no ${selector}.`);
  }
  control.click();
}

function listen<T>(element: PtkCoachBoard, name: string): T[] {
  const seen: T[] = [];
  const handler = (event: Event): void => {
    seen.push((event as CustomEvent<T>).detail);
  };
  element.addEventListener(name, handler);
  teardown.push(() => {
    element.removeEventListener(name, handler);
  });
  return seen;
}

describe('ptk-coach-board', () => {
  it('re-renders when the view is replaced after the first render', async () => {
    // The positive control for the whole file. The caller repaints off the clock
    // seam four times a second, and a board that rendered once would freeze at
    // whatever it mounted with while every other test here still passed, because
    // each mounts its own.
    const element = await mount(flight());
    expect(deepText(element)).toContain('Start the warm-up.');

    element.view = clashing();
    await element.updateComplete;

    expect(deepText(element)).toContain('Choose the next weight.');
  });

  /*
   * ---------------------------------------------------------------------------
   * The ordering, which is the whole of a triage list.
   * ---------------------------------------------------------------------------
   */

  it('draws the rows in the order the domain ranked them', async () => {
    const view = flight();
    const element = await mount(view);

    expect(order(element)).toEqual(expectedOrder(view));
    // Three, so the assertion above is about an order rather than about a name.
    expect(order(element)).toHaveLength(3);
  });

  /**
   * The grouping, and the reason it is built from runs rather than from a map.
   * The fixture's three rows fall into two levels as 1 then 2, so a heading drawn
   * per row and a heading drawn per level are two different numbers.
   */
  it('heads each run of one urgency once, and never once per lifter', async () => {
    const element = await mount(flight());

    const bands = query(element, '.band').map((band) => band.textContent.trim());

    expect(bands).toEqual(['Warming up', 'Coming up']);
    // The run lengths, which is the part a per-row heading would get wrong: three
    // headings over three lists of one. Counting the headings alone cannot say
    // that, because two of the three rows share a level and a broken grouping
    // would still head the level -- twice.
    // `:scope >` because a row carries lists of its own -- its facts and its
    // clashes are `li` too, and counting descendants reports 3 and 6.
    expect(
      query(element, '.rows').map((rows) => rows.querySelectorAll(':scope > li').length),
    ).toEqual([1, 2]);
  });

  /**
   * The clock, which is half of what a row is for -- §21 asks for "time *or*
   * attempts remaining" and the domain keeps them as two fields precisely
   * because neither describes a lifter alone. A board that dropped the seconds
   * still prints "2 left on this lift" and still looks finished.
   */
  it('prints a row’s clock where it has one, and nothing where it has not', async () => {
    const timed = await mount(flight());
    const untimed = await mount(unscheduled());

    expect(textOf(timed, '.clock')).toContain('to go');
    expect(query(untimed, '.clock')).toHaveLength(0);
    // Still three rows in both, so the second assertion is about the clock
    // rather than about a board that rendered nothing.
    expect(query(untimed, '.row')).toHaveLength(3);
  });

  it('says what to do about each lifter as an imperative, once per row', async () => {
    const element = await mount(flight());

    const actions = query(element, '.action').map((line) => line.textContent.trim());

    expect(actions).toEqual(['Start the warm-up.', 'Nothing due yet.', 'Nothing due yet.']);
  });

  /*
   * ---------------------------------------------------------------------------
   * §21: colour is an addition and never the cue.
   * ---------------------------------------------------------------------------
   */

  it('says who a row is in characters, with the swatch hidden from a reader', async () => {
    const element = await mount(flight());

    const [swatch] = query(element, '.swatch');
    const who = textOf(element, '.who');

    expect(swatch?.getAttribute('aria-hidden')).toBe('true');
    // The identifier, not only the name -- two lifters called Sam is the flight
    // this screen exists for, and a name alone would not separate them.
    expect(who).toContain('Dana Okafor');
    expect(who).toContain('(12)');
  });

  it('still names a lifter who has no colour', async () => {
    const element = await mount(patching(0, { colour: null }));

    expect(query(element, '.row')[0]?.querySelector('.swatch')).toBeNull();
    expect(order(element)[0]).toContain('(12)');
  });

  /**
   * The swatch is the one place a published string reaches a style, and the
   * obvious reading of `styleMap` -- that it compiles to `setProperty`, which
   * parses a value and drops it whole rather than taking the part before the
   * semicolon -- **is wrong on the first render**, which is the only render a
   * fresh board does. This assertion failed before `swatchColour` existed: the
   * injected `background-image` was really set. Kept as written, because the
   * argument is about a browser API and the fix if it changed is not in this
   * file.
   */
  it('draws no swatch at all from a colour carrying a second declaration', async () => {
    const element = await mount(patching(0, { colour: 'red; background-image: url(/x.png)' }));

    // Scoped to the row, because the rows below it have colours of their own and
    // a bare `.swatch` finds the next one along -- which is how a version of this
    // that passed while measuring somebody else's swatch would read.
    const swatch = query(element, '.row')[0]?.querySelector('.swatch');

    expect(swatch).toBeNull();
    expect(query(element, '.swatch')).toHaveLength(2);
    expect(order(element)[0]).toContain('(12)');
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.1: the pin filters and does not sort.
   * ---------------------------------------------------------------------------
   */

  it('hides the unpinned rows when the filter is ticked', async () => {
    const view = pinning(2);
    const element = await mount(view);
    expect(order(element)).toHaveLength(3);

    await pressPinnedOnly(element);

    expect(order(element)).toEqual(expectedOrder(view, true));
    expect(order(element)).toHaveLength(1);
  });

  /**
   * The other half of the toggle, and it was a live gap: an element that set
   * `pinnedOnly = true` on every change rather than reading the values passed
   * every test above this one. A coach who ticks the box to find one lifter and
   * cannot untick it has lost the other two off a screen with no other way back.
   */
  it('brings the hidden rows back when the filter is un-ticked', async () => {
    const view = pinning(2);
    const element = await mount(view);

    await pressPinnedOnly(element);
    const hidden = order(element);
    await pressPinnedOnly(element);

    expect(hidden).toHaveLength(1);
    expect(order(element)).toEqual(expectedOrder(view));
  });

  /**
   * The one property a triage list cannot lose. A pin that hoisted its row would
   * change what the rank means the moment somebody used it, and the coach who
   * learned to read the top of the board would be reading something else.
   */
  it('leaves the order alone when a bottom row is pinned', async () => {
    const unpinned = await mount(flight());
    const before = order(unpinned);

    const element = await mount(pinning(2));

    expect(order(element)).toEqual(before);
  });

  it('keeps the two pinned rows in board order rather than in pinning order', async () => {
    const view = pinning(2, 0);
    const element = await mount(view);

    await pressPinnedOnly(element);

    expect(order(element)).toEqual(expectedOrder(view, true));
    expect(order(element)[0]).toContain('Dana Okafor');
  });

  /**
   * Two empty states, and they are deliberately not one sentence. An empty board
   * is a meet nobody has been added to; an empty filter is a coach who has hidden
   * everybody, and telling them there are no lifters is a lie they would have to
   * un-tick the box to disprove.
   */
  it('tells an empty board and an emptied filter apart', async () => {
    const emptyBoard = await mount(EMPTY_BOARD_VIEW);
    const nobodyPinned = await mount(flight());

    await pressPinnedOnly(nobodyPinned);

    expect(order(nobodyPinned)).toEqual([]);
    expect(deepText(emptyBoard)).toContain(BOARD_EMPTY_NOTE);
    expect(deepText(nobodyPinned)).toContain(NO_PINNED_LIFTERS);
    expect(BOARD_EMPTY_NOTE).not.toBe(NO_PINNED_LIFTERS);
  });

  /*
   * ---------------------------------------------------------------------------
   * The two outbound events, both pressed on a row that is not the first.
   * ---------------------------------------------------------------------------
   */

  it('reports which lifter to open, resolved from the row that was pressed', async () => {
    const view = flight();
    const element = await mount(view);
    const opened = listen<BoardOpenDetail>(element, BOARD_OPEN_EVENT);

    pressIn(element, 1, '.open');

    expect(opened).toEqual([{ lifterId: view.rows[1]?.row.lifterId }]);
  });

  it('asks for the pin state the press wants, not the one the row has', async () => {
    const view = pinning(1);
    const element = await mount(view);
    const pins = listen<BoardPinDetail>(element, BOARD_PIN_EVENT);

    pressIn(element, 1, '.pin');
    pressIn(element, 2, '.pin');

    // Row 1 is pinned and row 2 is not, so one press asks for false and the
    // other for true -- an element reporting a constant passes either alone.
    expect(pins).toEqual([
      { lifterId: view.rows[1]?.row.lifterId, pinned: false },
      { lifterId: view.rows[2]?.row.lifterId, pinned: true },
    ]);
  });

  it('names the lifter in each control, so twenty rows are not twenty "Open"s', async () => {
    const element = await mount(flight());

    const names = query(element, '.open').map((button) => button.getAttribute('accessible-name'));

    expect(new Set(names).size).toBe(3);
    expect(names[0]).toContain('Dana Okafor');
  });

  it('reads Pin and Unpin off the row rather than off the filter', async () => {
    const element = await mount(pinning(1));

    const labels = query(element, '.pin').map((button) => button.textContent.trim());

    expect(labels).toEqual(['Pin', 'Unpin', 'Pin']);
  });

  /**
   * The §13.6 shape, seen for the third time in this directory: a click landing
   * on the `ptk-button` host, or any caller doing `host.click()`, runs the
   * handler whatever the inner button's state. Without the check against the
   * board, a `data-lifter` naming somebody who is not in the meet is reported --
   * and the caller switches a coach to a live screen for an athlete who is not
   * on it.
   */
  it('reports nothing for a press carrying no lifter, or one the board has not got', async () => {
    const element = await mount(flight());
    const opened = listen<BoardOpenDetail>(element, BOARD_OPEN_EVENT);
    const pins = listen<BoardPinDetail>(element, BOARD_PIN_EVENT);

    const stranger = document.createElement('div');
    stranger.dataset['lifter'] = 'lifter-not-in-this-meet';
    element.shadowRoot?.append(stranger);
    stranger.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    // The positive control: the same handlers do fire from a real row.
    pressIn(element, 0, '.open');

    expect(opened).toHaveLength(1);
    expect(pins).toEqual([]);
  });

  /**
   * The id is checked against the board and not merely read off the button, and
   * the mutation dropping that check survived the test above -- because a
   * stranger dispatching at the host reaches no handler at all. The path that
   * does reach one is a button that has outlived its row: the board is rebuilt
   * off the clock seam four times a second, and a press queued against a row the
   * rebuild removed still runs the listener lit bound to that button. Reported
   * unchecked, the caller opens a live screen for an athlete who has left.
   */
  it('reports nothing from a control the board has already rebuilt away', async () => {
    const element = await mount(flight());
    const opened = listen<BoardOpenDetail>(element, BOARD_OPEN_EVENT);
    const [stale] = query(element, '.open');

    element.view = EMPTY_BOARD_VIEW;
    await element.updateComplete;
    stale?.click();

    expect(stale?.dataset['lifter']).toBeDefined();
    expect(query(element, '.open')).toHaveLength(0);
    expect(opened).toEqual([]);
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.2, and the count that must not double.
   * ---------------------------------------------------------------------------
   */

  it('counts a clash once while putting it on both rows', async () => {
    const view = clashing();
    const element = await mount(view);

    const notices = query(element, '.clashes ptk-notice');

    expect(view.conflictCount).toBe(1);
    expect(notices).toHaveLength(2);
    expect(textOf(element, '.section:has(> h3) p')).toContain('1 clash');
  });

  /**
   * The reason the projection exists. The same clash is on both rows and each of
   * them wants the opposite sentence -- "Bo first" printed on Bo's own row reads
   * as a third lifter nobody in the room can find. Asserted as a difference plus
   * one pinned fragment, per §13.8.
   */
  it('answers "you first" on one of the two rows and not on the other', async () => {
    const element = await mount(clashing());

    const [first, second] = query(element, '.clashes').map((list) => list.textContent.trim());

    expect(first).not.toBe(second);
    expect(`${first ?? ''}${second ?? ''}`).toContain('Go here first');
  });

  /**
   * The third line of a clash, and the one that decides whether it is a clash at
   * all. Ten seconds apart is one errand; two minutes apart is a coach walking
   * twice, and both render the same warning without this. The fixture's gap is
   * ten seconds, pinned rather than computed here.
   */
  it('says how far apart the two clocks are', async () => {
    const element = await mount(clashing());

    expect(textOf(element, '.clashes')).toContain('0:10');
  });

  it('leaves the uninvolved lifter out of the warning', async () => {
    const element = await mount(clashing());

    expect(query(element, '.row:has(.clashes)')).toHaveLength(2);
    expect(query(element, '.row')).toHaveLength(3);
  });

  /*
   * ---------------------------------------------------------------------------
   * §16 and §21's per-row facts.
   * ---------------------------------------------------------------------------
   */

  it('prints the published pound figure beside the kilograms, on that row only', async () => {
    const element = await mount(declared());

    // Scoped to the rows: `.weight` is also the rack panel's load line, so an
    // unscoped count is one number for two questions and passes or fails on
    // whether the fixture happens to have a shared bar in it.
    const weights = query(element, '.row .weight');
    const pounds = query(element, '.pounds').map((line) => line.textContent.trim());

    // One weight on the board, because one lifter has declared. A row printing a
    // neighbour's figure is the §13.7 failure arriving on a screen with three
    // lifters on it rather than three cards.
    expect(weights).toHaveLength(1);
    expect(weights[0]?.textContent).toContain('180');
    expect(pounds[0]).toContain('lb');
    expect(pounds[0]).not.toContain('about');
  });

  it('tells "no attempt owed" apart from "no weight chosen"', async () => {
    const owed = await mount(flight());
    const chosen = await mount(declared());

    const waiting = query(owed, '.row')[0]?.textContent ?? '';
    const declaring = query(chosen, '.row')[0]?.textContent ?? '';

    expect(waiting).toContain('No weight chosen.');
    expect(declaring).not.toContain('No weight chosen.');
    expect(declaring).not.toContain('No attempt owed.');
  });

  it('says where the lifter is standing when the room has announced it', async () => {
    const element = await mount(patching(0, { platformCall: 'on-deck' }));

    expect(order(element)[0]).toContain('On deck');
    expect(order(element)[1]).not.toContain('On deck');
  });

  /**
   * The `unit` property, which nothing else on this screen reads -- §16 keeps the
   * attempt in kilograms whatever the coach prefers, so the banked total is the
   * only figure the preference reaches, and a board that ignored the property
   * entirely passed every other assertion in this file.
   */
  it('reads the banked total in the unit the board was given', async () => {
    const kilograms = await mount(clashing());
    const pounds = await mount(clashing());
    pounds.unit = 'lb';
    await pounds.updateComplete;

    const banked = textOf(kilograms, '.facts');
    const converted = textOf(pounds, '.facts');

    expect(banked).not.toBe(converted);
    expect(banked).toContain('kg');
    expect(converted).toContain('lb');
    // The attempt itself does not move (§16): a declared weight is a kilogram
    // figure whichever unit the coach reads their running total in. A separate
    // board, because a lifter whose opener is recorded has no weight owed.
    const declaring = await mount(declared());
    declaring.unit = 'lb';
    await declaring.updateComplete;
    expect(textOf(declaring, '.row .weight')).toContain('kg');
  });

  it('lists §21.3 handlers under a heading, because a bare name reads as a lifter', async () => {
    const element = await mount(
      patching(0, { handlers: [{ name: 'Ola Ferrer', responsibilities: ['warm-up-loading'] }] }),
    );

    const [row] = query(element, '.row');

    expect(row?.textContent).toContain('Handlers');
    expect(row?.textContent).toContain('Ola Ferrer');
    expect(query(element, '.row')[1]?.textContent).not.toContain('Handlers');
  });

  /*
   * ---------------------------------------------------------------------------
   * §21.4: the bar belongs to the room, not to the filter.
   * ---------------------------------------------------------------------------
   */

  it('plans the shared bar and names the takers as the board names them', async () => {
    const element = await mount(shared());

    const [panel] = query(element, 'section:has(> h4)');

    expect(query(element, '.load').length).toBeGreaterThan(1);
    expect(panel?.textContent).toContain('Dana Okafor');
    expect(panel?.textContent).toContain('Bo Adeyemi');
  });

  /**
   * A bar is a fact about the room. A coach who has filtered down to one pinned
   * lifter still has to know who else is queueing for the weight they are about
   * to change, so the taker list is built from every row and not from the visible
   * ones.
   */
  it('keeps the whole rack panel when the rows are filtered down to one', async () => {
    const element = await mount(shared());
    const before = query(element, '.load').length;

    await pressPinnedOnly(element);

    expect(order(element)).toHaveLength(1);
    expect(query(element, '.load')).toHaveLength(before);
    expect(query(element, 'section:has(> h4)')[0]?.textContent).toContain('Bo Adeyemi');
  });

  /**
   * What sharing costs, which is the whole argument of §21.4 -- the sequence is
   * kept in *timing* order and the plate moves are charged for rather than
   * optimised away, so a panel that listed the loads without the price would be
   * asking a coach to move plates without saying how many.
   */
  it('prices the shared bar in plate moves', async () => {
    const element = await mount(shared());

    // Each scoped to its own line. The advisories sit inside the same panel, so
    // an assertion against the panel's whole text is satisfied by them and says
    // nothing about the two lines it was written for.
    const saving = textOf(element, 'section:has(> h4) > .muted');
    const [load] = query(element, '.load .weight');
    const advisories = query(element, 'section:has(> h4) ptk-notice').map((notice) =>
      notice.textContent.trim(),
    );

    expect(saving).toContain('plate');
    expect(load?.textContent).toContain('kg');
    expect(advisories.join(' ')).toContain('plate');
  });

  it('says a room nobody has described has no shared bar', async () => {
    const element = await mount(unscheduled());

    expect(deepText(element)).toContain(RACK_NONE_NOTE);
    expect(query(element, '.load')).toHaveLength(0);
    // Still three rows: a meet nobody has set up is not an empty board.
    expect(query(element, '.row')).toHaveLength(3);
  });

  it('names the bar when the room has one', async () => {
    const element = await mount(shared());

    expect(deepText(element)).not.toContain(RACK_NONE_NOTE);
    // The id itself, because a warm-up room has more than one bar in it and a
    // heading that named the wrong one would send the coach across the room.
    expect(query(element, 'h4')[0]?.textContent).toContain(RACK);
  });

  /*
   * ---------------------------------------------------------------------------
   * §5.7 and §5.8.
   * ---------------------------------------------------------------------------
   */

  it('fits a phone-width column with a clash and a rack on the board', async () => {
    const element = await mount(clashing());
    element.style.width = '320px';
    element.style.display = 'block';
    await element.updateComplete;

    expect(element.scrollWidth).toBeLessThanOrEqual(320);
  });

  it('has no axe violations with every panel on screen', async () => {
    const element = await mount(clashing());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no axe violations on the rack panel either', async () => {
    const element = await mount(shared());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
