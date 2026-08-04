// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §26 on the screen: the whole of a finished meet, and the eight sentences that
 * stand in for the parts of it that are empty.
 *
 * `summary.ts` decided every figure here and has its own suite, so nothing below
 * re-asserts a number. What is this file's own is the one rule the element was
 * written for and which no other screen in this tool follows: **no section is
 * ever dropped.** Everywhere else an empty list renders nothing; on a page a
 * lifter reads once and cannot check against anything, a section that vanishes
 * is indistinguishable from one the tool got wrong -- and the three most likely
 * to be empty (targets, notes, lessons) are the three whose absence flatters.
 *
 * So every section is asserted in *both* of its states, and the empty one is
 * asserted as a **sentence** rather than as a heading over nothing. A test
 * written as "the heading is on the screen" passes against a page of bare
 * headings, which is precisely the failure.
 *
 * WHERE THE STATES COME FROM
 *
 * Out of `summary-fixture.ts`, walked through `applyMeetAction`, so none of them
 * is a meet nobody could have lifted. Lights and notes are the exception worth
 * knowing about: `RecordedResult` has nowhere to put either, so they arrive
 * through a separate `annotate-attempt` action rather than through `take`.
 *
 * The one state with no route through a document is an empty lift list -- every
 * `MeetFormat` contests at least one lift -- so that assertion mounts
 * `EMPTY_SUMMARY`, which is a real state: it is what the property holds before a
 * meet has been summarised at all.
 *
 * WHY SO FEW ASSERTIONS NAME A FUNCTION FROM `copy.ts`
 *
 * §13.8's rule, arriving for the sixth time in this directory: an assertion whose
 * expected value is computed by the module under test moves with the code and
 * goes on passing under exactly the mutation it was written to catch. So each
 * test below reads two states through one selector, asserts they differ, and
 * pins one literal fragment of the one it is about.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { MeetTimeline, RecordedResult, WeightUnit } from '@platform-toolkit/domain';

import { OPENER, act } from './live-fixture.js';
import type { PtkMeetSummary } from './ptk-meet-summary.js';
import './ptk-meet-summary.js';
import {
  TARGETS,
  aFullPage,
  aGoodDay,
  attemptIdAt,
  bombedOnBench,
  followingTheTool,
  plannedView,
  summaryOf,
  toPlan,
  walk,
} from './summary-fixture.js';
import { EMPTY_SUMMARY, type MeetSummary } from './summary.js';

const GOOD: RecordedResult = { outcome: 'good', effort: 'solid' };

const VIEW = plannedView();

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  summary: MeetSummary = summaryOf(aGoodDay()),
  unit: WeightUnit = 'kg',
): Promise<PtkMeetSummary> {
  const element = document.createElement('ptk-meet-summary');
  element.summary = summary;
  element.unit = unit;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkMeetSummary, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textsOf(element: PtkMeetSummary, selector: string): string[] {
  return query(element, selector).map((found) => found.textContent.trim());
}

function textOf(element: PtkMeetSummary, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The summary has no ${selector}.`);
  return found.textContent.trim();
}

/** One attempt block, by lift position and then by position within the lift. */
function attemptAt(element: PtkMeetSummary, liftIndex: number, attemptIndex: number): HTMLElement {
  const lift = query(element, 'section.lift').at(liftIndex);
  if (lift === undefined) throw new Error(`The summary has no lift at ${String(liftIndex)}.`);
  const found = [...lift.querySelectorAll('.attempt')]
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .at(attemptIndex);
  if (found === undefined) throw new Error(`That lift has no attempt at ${String(attemptIndex)}.`);
  return found;
}

/**
 * Every match inside one block, which is how a line is asserted *absent*.
 *
 * `textIn` throws on nothing found, so it cannot express "this row has no such
 * line" -- and a `.textContent` assertion on the block would be satisfied by any
 * sibling saying something similar, which is the failure §13.12 records.
 */
function queryIn(block: HTMLElement, selector: string): HTMLElement[] {
  return [...block.querySelectorAll(selector)].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textIn(block: HTMLElement, selector: string): string {
  const found = block.querySelector(selector);
  if (found === null) throw new Error(`That attempt has no ${selector}.`);
  return found.textContent.trim();
}

/** One squat opener and nothing else: the meet that stopped after one attempt. */
function oneAttemptOnly(): MeetTimeline {
  return walk([{ lift: 'squat', kilograms: OPENER, result: GOOD }]);
}

describe('ptk-meet-summary', () => {
  /*
   * ---------------------------------------------------------------------------
   * The rule the screen exists for. Everything after this is one section of it.
   * ---------------------------------------------------------------------------
   */

  it('keeps every heading on the page for a meet with nothing in it, each over a sentence', async () => {
    const empty = await mount(EMPTY_SUMMARY);
    const full = await mount(aFullPage());

    // `:scope >` because a lift is itself a `section` nested inside the lift list,
    // and a bare `section` count reports the nesting rather than the layout.
    expect(textsOf(empty, '.summary > section > h4')).toHaveLength(8);
    expect(textsOf(full, '.summary > section > h4')).toEqual(
      textsOf(empty, '.summary > section > h4'),
    );

    // Five of the eight can be empty. Each says so; none is a bare heading.
    expect(textsOf(empty, '.empty').every((sentence) => sentence.length > 0)).toBe(true);
    expect(textsOf(empty, '.empty')).toHaveLength(5);
    expect(textsOf(full, '.empty')).toEqual([]);
  });

  /*
   * ---------------------------------------------------------------------------
   * The heading, which is what tells a printed summary from somebody else's.
   * ---------------------------------------------------------------------------
   */

  it('puts the name on the first line and does not invent one for a summary with none', async () => {
    const named = await mount();
    const anonymous = await mount(EMPTY_SUMMARY);

    expect(textOf(named, 'h3')).toContain('Dana Okafor');
    expect(textOf(anonymous, 'h3')).not.toContain('Dana Okafor');
    expect(textOf(anonymous, 'h3')).not.toContain('--');
    expect(textOf(named, 'h3')).not.toBe(textOf(anonymous, 'h3'));

    // The format sits under the name because it decides what the rest of the page
    // means -- "no total" on a full power meet and on a bench-only meet are two
    // different days, and nothing else here says which one this was.
    expect(textOf(named, '.format')).toContain('Full power');
  });

  /*
   * ---------------------------------------------------------------------------
   * The total, and the two ways a finished meet does not have one.
   * ---------------------------------------------------------------------------
   */

  it('separates a total from a bomb-out and a bomb-out from a day with no good lift', async () => {
    const total = await mount();
    const bombed = await mount(summaryOf(bombedOnBench(VIEW)));
    const nothing = await mount(EMPTY_SUMMARY);

    const figures = [total, bombed, nothing].map((element) => textOf(element, '.total .figure'));
    expect(new Set(figures).size).toBe(3);

    expect(figures[0]).toContain('Total');
    // A bomb-out made weight on the lifts that produced a good lift, and saying
    // so is the difference between it and a lifter who made nothing at all.
    expect(figures[1]).toContain('kg');
    expect(figures[2]).not.toContain('kg');
  });

  it('converts every total figure but never an attempt, because an attempt is a kilogram figure (§16)', async () => {
    // `aFullPage` rather than an ordinary day: a target is the other figure on
    // this page that is a total, and a page with none leaves that half untested.
    const kilograms = await mount(aFullPage(), 'kg');
    const pounds = await mount(aFullPage(), 'lb');

    expect(textOf(kilograms, '.total .figure')).not.toBe(textOf(pounds, '.total .figure'));
    expect(textOf(pounds, '.total .figure')).toContain('lb');
    expect(textOf(kilograms, '.total .figure')).not.toContain('lb');

    // The shortfall against a target is a total, so it follows the unit too.
    const short = 1;
    expect(textsOf(pounds, '.targets .target')[short]).not.toBe(
      textsOf(kilograms, '.targets .target')[short],
    );
    expect(textsOf(pounds, '.targets .target')[short]).toContain('lb');

    // The declared weights are what went to the expeditor's table and do not move.
    expect(textsOf(pounds, '.attempt .weight')).toEqual(textsOf(kilograms, '.attempt .weight'));
    expect(textsOf(pounds, '.lift .best')).toEqual(textsOf(kilograms, '.lift .best'));
  });

  /*
   * ---------------------------------------------------------------------------
   * Lift by lift, and the attempt rows under each.
   * ---------------------------------------------------------------------------
   */

  it('lists a section per contested lift and says so where no lift was contested', async () => {
    const day = await mount();
    // The only route to an empty lift list: every `MeetFormat` contests at least
    // one lift, so no document can produce this and `EMPTY_SUMMARY` is the state.
    const none = await mount(EMPTY_SUMMARY);

    expect(query(day, 'section.lift')).toHaveLength(3);
    expect(query(day, '.lifts .empty')).toEqual([]);

    expect(query(none, 'section.lift')).toEqual([]);
    expect(textOf(none, '.lifts .empty')).toContain('No lift was contested');
  });

  it('names the best lift on each lift and counts what was made against what was taken', async () => {
    // The bomb-out is the one meet carrying both branches of each line on one
    // page: two lifts made everything and the third made nothing.
    const element = await mount(summaryOf(bombedOnBench(VIEW)));

    const [squat, bench] = textsOf(element, 'section.lift .best');
    expect(squat).not.toBe(bench);
    expect(squat).toContain('kg');
    expect(bench).toContain('Nothing made on this lift');

    const [squatMade, benchMade] = textsOf(element, 'section.lift .made');
    expect(squatMade).not.toBe(benchMade);
    expect(squatMade).toContain('3 of 3');
    // Three attempts taken and none made: the count is what tells that apart
    // from a lift the meet never reached, which takes none.
    expect(benchMade).toContain('0 of 3');
  });

  it('prints the declared weight in kilograms and the published pound figure beside it', async () => {
    const element = await mount(summaryOf(oneAttemptOnly()));
    const opener = attemptAt(element, 0, 0);

    // Scoped to the two spans rather than read off the row, for the reason §13.9
    // gave `.pounds` its own class: three other sections here print a pound
    // figure, so a row-wide assertion is satisfied by any of them.
    expect(textIn(opener, '.weight')).toContain('kg');
    expect(textIn(opener, '.weight')).not.toContain('lb');
    expect(textIn(opener, '.pounds')).toContain('lb');
    expect(textIn(opener, '.pounds')).toContain('on the chart');
  });

  it('says an attempt was never given a weight rather than leaving the row blank', async () => {
    const element = await mount(summaryOf(oneAttemptOnly()));

    // The squat opener was taken; the bench was never reached.
    expect(queryIn(attemptAt(element, 0, 0), '.weight.none')).toEqual([]);
    expect(textIn(attemptAt(element, 1, 0), '.weight.none')).toContain('No weight was set');
  });

  it('distinguishes a lift that was missed from one the meet never reached', async () => {
    const element = await mount(summaryOf(oneAttemptOnly()));

    const taken = textIn(attemptAt(element, 0, 0), '.outcome');
    const untaken = textIn(attemptAt(element, 1, 0), '.outcome');

    expect(taken).not.toBe(untaken);
    expect(taken).toContain('Good lift');
    // Never "Passed": a pass is a decision somebody made.
    expect(untaken).toContain('Not taken');
  });

  /*
   * ---------------------------------------------------------------------------
   * What the tool had suggested, which must never be silently absent.
   * ---------------------------------------------------------------------------
   */

  it('reads back whether the weight the tool pointed at was the weight taken', async () => {
    const followed = await mount(summaryOf(followingTheTool(VIEW)));
    const departed = await mount(summaryOf(walk(toPlan(VIEW))));

    const second = 1;
    const onFollowed = textIn(attemptAt(followed, 0, second), '.followed');
    const onDeparted = textIn(attemptAt(departed, 0, second), '.followed');

    expect(onFollowed).not.toBe(onDeparted);
    expect(onFollowed).toContain('took that weight');
    expect(textIn(attemptAt(followed, 0, second), '.suggested')).toContain('The tool pointed at');
  });

  it('says why there is nothing to compare against rather than printing no line at all', async () => {
    const partial = await mount(summaryOf(oneAttemptOnly()));
    const complete = await mount();

    // An attempt with neither line reads exactly like one where the lifter took
    // the tool's advice, which is the flattering reading.
    //
    // Scoped to `.attempt` because the timing section spells an interval with a
    // `.gap` span of its own -- an unscoped absence assertion is satisfied by
    // nine of them and passes against an element that dropped this line
    // entirely. §13.12 records the same collision on `.weight`.
    expect(textIn(attemptAt(partial, 1, 0), '.gap')).toContain('never offered a choice');
    expect(query(complete, '.attempt .gap')).toEqual([]);
  });

  /*
   * ---------------------------------------------------------------------------
   * Referee lights, and how much of the meet the count is counting.
   * ---------------------------------------------------------------------------
   */

  it('counts the lights by seat and says how many attempts had none', async () => {
    const timeline = oneAttemptOnly();
    const lit = await mount(
      summaryOf(
        act(timeline, {
          kind: 'annotate-attempt',
          attemptId: attemptIdAt(timeline, 0),
          lights: ['white', 'white', 'red'],
        }),
      ),
    );
    const unlit = await mount();

    expect(textOf(lit, '.lights .counts')).toContain('2 white');
    // Every resolved attempt on that meet carries lights, so the caveat is off.
    expect(query(lit, '.lights .missing')).toEqual([]);

    expect(textOf(unlit, '.lights .missing')).toContain('9');
    expect(textOf(unlit, '.lights .counts')).not.toBe(textOf(lit, '.lights .counts'));

    // By seat rather than as a tally: which referee dissented is the part
    // somebody goes back to the note for.
    const line = textIn(attemptAt(lit, 0, 0), '.lights');
    expect(line).toContain('Left white');
    expect(line).toContain('Right red');
  });

  /*
   * ---------------------------------------------------------------------------
   * Targets, timing, notes and lessons: the four that are usually empty.
   * ---------------------------------------------------------------------------
   */

  it('says where each target was left, and names the reason where none was set', async () => {
    const withTargets = await mount(summaryOf(aGoodDay(), { targets: TARGETS }));
    const without = await mount();

    const [reached, short] = textsOf(withTargets, '.targets .target');
    expect(reached).toContain('the total you came for');
    expect(short).toContain('the total you hoped for');
    // The shortfall is the difference between the two lines; a reached target
    // carries no figure at all.
    expect(reached).not.toContain('kg');
    expect(short).toContain('kg');

    expect(query(without, '.targets .target')).toEqual([]);
    expect(textOf(without, '.targets .empty')).toContain('No targets were set');
  });

  it('times the gaps between results, marks the first, and keeps the caveat on both states', async () => {
    const timed = await mount();
    const untimed = await mount(summaryOf(walk([])));

    const gaps = textsOf(timed, '.timing .interval .gap');
    expect(gaps).toHaveLength(9);
    expect(gaps[0]).toContain('First result');
    // `BETWEEN_ATTEMPTS_MS` is a minute, so every later gap is the same figure.
    expect(gaps[1]).toContain('1:00');
    expect(textOf(timed, '.timing .interval .name')).toContain('Squat');

    expect(query(untimed, '.timing .interval')).toEqual([]);
    expect(textOf(untimed, '.timing .empty')).toContain('nothing to time');

    // §29: the figures are this phone's, and the sentence stays up either way.
    for (const element of [timed, untimed]) {
      expect(textOf(element, '.timing .caveat')).toContain('not the official clock');
    }
  });

  it('keeps a note under the attempt it was written on, and says so where none was written', async () => {
    const timeline = aGoodDay();
    const noted = await mount(
      summaryOf(
        act(
          act(timeline, {
            kind: 'annotate-attempt',
            attemptId: attemptIdAt(timeline, 0),
            note: 'Belt was loose.',
          }),
          {
            kind: 'annotate-attempt',
            attemptId: attemptIdAt(timeline, 1),
            note: 'Waited too long in the chalk queue.',
          },
        ),
      ),
    );
    const silent = await mount();

    expect(textsOf(noted, '.notes .note .text')).toEqual([
      'Belt was loose.',
      'Waited too long in the chalk queue.',
    ]);
    const [first, second] = textsOf(noted, '.notes .note h5');
    expect(first).toContain('Squat');
    // Two notes on one lift: the heading has to name the attempt as well.
    expect(first).not.toBe(second);

    expect(query(silent, '.notes .note')).toEqual([]);
    expect(textOf(silent, '.notes .empty')).toContain('You wrote no notes');
  });

  it('prints each lesson with its working, and calls an ordinary day an ordinary day', async () => {
    const bombed = await mount(summaryOf(bombedOnBench(VIEW)));
    const ordinary = await mount();

    const what = textsOf(bombed, '.lessons .lesson .what');
    expect(what.some((sentence) => sentence.includes('No total on the day'))).toBe(true);
    expect(new Set(what).size).toBe(what.length);

    // Two shapes of evidence off one meet: the bomb-out is drawn from the lift
    // that ended the total, the strength misses from the attempts as well.
    const evidence = textsOf(bombed, '.lessons .lesson .evidence');
    expect(evidence).toHaveLength(what.length);
    expect(evidence.every((line) => line.startsWith('From'))).toBe(true);
    expect(evidence.filter((line) => line.includes('3 attempts'))).toHaveLength(1);

    expect(query(ordinary, '.lessons .lesson')).toEqual([]);
    expect(textOf(ordinary, '.lessons .empty')).toContain('ordinary day');

    // §9.4's floor is two meets and this is one, on both states.
    for (const element of [bombed, ordinary]) {
      expect(textOf(element, '.lessons .caveat')).toContain('One meet is one meet');
    }
  });

  /*
   * ---------------------------------------------------------------------------
   * The two sections that are the same whatever the meet did.
   * ---------------------------------------------------------------------------
   */

  it('names both things §26 asks for that this tool has no source for', async () => {
    const element = await mount();

    const sentences = textsOf(element, '.omissions li');
    expect(sentences).toHaveLength(2);
    expect(sentences.some((sentence) => sentence.includes('personal records'))).toBe(true);
    expect(sentences.some((sentence) => sentence.includes('qualifying standards'))).toBe(true);
  });

  it('says once at the foot of the page when the undo history did not reach the start', async () => {
    let timeline = aGoodDay();
    const last = attemptIdAt(timeline, 8);
    // Push every weight-setting step off the end of the undo window by annotating
    // one attempt repeatedly. Nothing about the meet changes; only the record of
    // how it was reached. A spread-patched `historyTruncated` would be a summary
    // the builder cannot produce, with attempts that still carry their advice.
    for (let step = 0; step < 220; step += 1) {
      timeline = act(timeline, {
        kind: 'annotate-attempt',
        attemptId: last,
        note: `step ${String(step)}`,
      });
    }

    const truncated = await mount(summaryOf(timeline));
    const intact = await mount();

    expect(textOf(truncated, '.truncated')).toContain('undo history');
    expect(query(intact, '.truncated')).toEqual([]);
  });

  /*
   * ---------------------------------------------------------------------------
   * Accessibility, on both the fullest page and the emptiest.
   * ---------------------------------------------------------------------------
   */

  it('has no accessibility violations with every section filled', async () => {
    const element = await mount(aFullPage());

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations with every section empty', async () => {
    const element = await mount(EMPTY_SUMMARY);

    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
