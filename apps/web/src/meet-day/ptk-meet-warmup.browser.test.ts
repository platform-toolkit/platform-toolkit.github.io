// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20 on the screen: the ramp counted backwards from a platform nobody controls.
 *
 * `warmup.ts` produced every figure and has its own suite, so nothing below
 * re-asserts an estimate, a spread or a rung. What is this element's own is the
 * set of decisions it makes about what a lifter is looking at, and each of them
 * is a way the screen can be complete and wrong:
 *
 * - **Which pair of position fields is on screen.** Two pairs at once was the
 *   first version; one pair is the shipped one, and the values under the hidden
 *   pair must survive a flip. A test that only checked what was *shown* would
 *   pass against an element that cleared them.
 * - **What the timeline says when there is no ramp.** Three states -- no opener
 *   chosen, an opener the domain refuses, and a ramp -- and the middle one is
 *   the one that was wrong first time round (see `warmupProblemSentence`).
 * - **The unit the ramp is printed in.** The room's plate unit, never the
 *   opener's. Both fixtures declare the opener in kilograms, so a screen reading
 *   the wrong one is right about five of the six figures on it.
 * - **That an event leaves carrying the whole state.** The element owns nothing;
 *   a handler that computed the right patch and never dispatched it looks
 *   identical on screen, because the control it was typed into keeps what was
 *   typed (§13.14).
 *
 * WHY SO FEW ASSERTIONS NAME A FUNCTION FROM `copy.ts`
 *
 * §13.8's rule, arriving for the eighth time in this directory: an assertion
 * whose expected value is computed by the module under test moves with the code
 * and goes on passing under exactly the mutation it was written to catch. So the
 * tests below read two states through one selector, assert they differ, and pin
 * one literal fragment of the one they are about.
 *
 * WHY THE STATE IS READ OFF THE EVENT AND NOT OFF THE SCREEN
 *
 * `state` is a property the caller owns and this element never writes, so
 * nothing on screen changes until a root hands a new one back. Every write test
 * therefore watches `MEET_WARMUP_CHANGE_EVENT` on `document.body` -- on the body
 * rather than on the element, because what is being proved is that the event
 * crossed the shadow boundary carrying a state a root can store.
 */
import { EQUIPMENT_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-equipment-setup';
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import {
  FORMAT,
  NO_OPENER,
  NOW,
  SQUAT,
  aPoundRoom,
  anEarlierFlight,
  longPreparation,
  nothingAnswered,
  ownFlightRunning,
  runningLate,
  sharingARack,
  withAdjustedSets,
  withKneeWraps,
} from './warmup-fixture.js';
import { DEFAULT_WARM_UP_ROOM, type MeetWarmupState, type WarmupSubject } from './warmup.js';
import {
  MEET_WARMUP_CHANGE_EVENT,
  type MeetWarmupChangeDetail,
  type PtkMeetWarmup,
} from './ptk-meet-warmup.js';
import './ptk-meet-warmup.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  state: MeetWarmupState = anEarlierFlight(),
  subject: WarmupSubject | null = SQUAT,
): Promise<PtkMeetWarmup> {
  const element = document.createElement('ptk-meet-warmup');
  element.state = state;
  element.subject = subject;
  element.format = FORMAT;
  element.now = NOW;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkMeetWarmup, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textsOf(element: PtkMeetWarmup, selector: string): string[] {
  return query(element, selector).map((found) => found.textContent.trim());
}

function textOf(element: PtkMeetWarmup, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The screen has no ${selector}.`);
  return found.textContent.trim();
}

/** The controls this element rendered, by the `data-field` it tagged them with. */
function fields(element: PtkMeetWarmup): string[] {
  return query(element, '[data-field]').flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

function fieldNamed(element: PtkMeetWarmup, field: string): HTMLElement {
  const [found] = query(element, `[data-field="${field}"]`);
  if (found === undefined) throw new Error(`The screen has no "${field}" control.`);
  return found;
}

/** Types into one of the number fields, keystroke and all. */
async function type(element: PtkMeetWarmup, selector: string, text: string): Promise<void> {
  const input = element.shadowRoot?.querySelector(selector)?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No field matching "${selector}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Presses one segment of a `ptk-segmented`, by the label a lifter reads. */
async function choose(element: PtkMeetWarmup, field: string, label: string): Promise<void> {
  const segments = [
    ...(fieldNamed(element, field).shadowRoot?.querySelectorAll('label.segment') ?? []),
  ];
  const chosen = segments.find((segment) => segment.textContent.trim() === label);
  const input = chosen?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No "${label}" segment on "${field}".`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/**
 * Every state that left the element, in order.
 *
 * On `document.body` for the reason `ptk-plan-method.browser.test.ts` gives: a
 * listener on the element itself passes whether or not the event was composed,
 * and a root two shadow roots up is what actually has to receive it.
 */
function watch(): MeetWarmupState[] {
  const seen: MeetWarmupState[] = [];
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) {
      seen.push((event.detail as MeetWarmupChangeDetail).state);
    }
  };
  document.body.addEventListener(MEET_WARMUP_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(MEET_WARMUP_CHANGE_EVENT, listener);
  });
  return seen;
}

/** The last state reported, or a failure naming what was reported instead. */
function reported(seen: readonly MeetWarmupState[]): MeetWarmupState {
  const last = seen.at(-1);
  if (last === undefined) throw new Error('Nothing was reported.');
  return last;
}

describe('ptk-meet-warmup', () => {
  it('re-renders when the state is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating.
    const element = await mount();
    expect(fields(element)).toContain('attemptsLeftInTheRunningFlight');

    element.state = ownFlightRunning();
    await element.updateComplete;

    expect(fields(element)).not.toContain('attemptsLeftInTheRunningFlight');
  });

  /*
   * The estimate. §20.1's headline, and the reason the screen is opened.
   */

  it('shows an estimate before anything has been answered', async () => {
    // Not a nicety: a handler opening this next to the platform with nothing
    // typed is the common case, and `warmup.ts`'s fallbacks make the answer
    // meaningful from the first field. An element that waited for input would
    // look finished and be useless in the one minute it is wanted.
    const element = await mount(nothingAnswered());
    expect(textOf(element, '.estimate .figure')).not.toBe('');
  });

  it('says who actually decides, on the estimate itself', async () => {
    // §29: the sentence is on the panel rather than in a fold, because the
    // estimate is what gets read aloud and the caveat has to travel with it.
    const element = await mount();
    // "meet staff" and not "official": `MEET_STAFF_ARE_AUTHORITATIVE` names the
    // people who make the announcement, and the word "official" appears nowhere
    // in it. Pinned as a fragment rather than against the constant, per §13.8.
    expect(deepText(element)).toContain('meet staff');
  });

  it('does not repeat the authority sentence as an advisory', async () => {
    // `meet-staff-are-authoritative` rides on every answer the domain gives
    // (§13.3), so an element that rendered the advisory list unfiltered would
    // print it twice -- which is how a rule that matters starts reading as
    // boilerplate. The positive control is that the other advisories are there.
    //
    // Mounted on the unanswered screen deliberately: that is the state whose
    // advisory list was actually measured (four, three of them surviving the
    // filter), so the control rests on a count rather than on an assumption
    // that some advisory or other happens to be raised.
    const element = await mount(nothingAnswered());
    const advisories = textsOf(element, '.estimate .advisories ptk-notice');
    expect(advisories.length).toBeGreaterThan(0);
    expect(advisories.filter((text) => text.includes('meet staff'))).toEqual([]);
  });

  it('renders no estimate at all until a lift is chosen', async () => {
    // The one thing that is not a fallback. Without a lift there is no
    // attempts-per-lift figure and nothing to count, so the panel is absent
    // rather than showing a zero. Paired with the timeline's own sentence
    // below, which is what stands in its place.
    const element = await mount(anEarlierFlight(), null);
    expect(query(element, '.estimate')).toEqual([]);
  });

  /*
   * The timeline, in each of its three states.
   */

  it('asks for an opener when no lift has been chosen', async () => {
    const element = await mount(anEarlierFlight(), null);
    expect(textOf(element, 'section:has(> h4) p')).toContain('opener');
    expect(query(element, 'ol.timeline')).toEqual([]);
  });

  it('blames the opener, not the warm-up room, when the ramp is refused', async () => {
    // The regression this test exists for is a copy defect rather than a code
    // one, and it is the reason `warmupProblemSentence` is total over the
    // domain's codes. `collectProblems` refuses on the opener or on a bar or
    // collar with no weight, and the room control cannot produce the second --
    // an unrecognised bar id falls back to the custom bar rather than to NaN.
    // So the only refusal a lifter can reach is the opener, and a sentence
    // sending them to "the room below" sends them to the part of the screen
    // that is fine, at the point in the day where they have the least time to
    // work out that it is.
    //
    // Scoped to the timeline section rather than to the element, because
    // `render()` reads `result?.estimate ?? null` and the estimate therefore
    // still draws on a refused ramp -- carrying its own advisories, any one of
    // which can be `caution` and render at the same tone. An element-wide
    // selector would count those and the assertion would measure the estimate.
    const element = await mount(anEarlierFlight(), NO_OPENER);
    const said = textsOf(element, 'section:has(> h4) ptk-notice[tone="error"]');
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('opener');
    expect(said[0]).not.toContain('room');
  });

  it('draws one row per scheduled item, and the platform last', async () => {
    const element = await mount();
    const rows = query(element, 'ol.timeline > li');
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.at(-1)?.className).toContain('platform');
    expect(query(element, 'ol.timeline > li.platform')).toHaveLength(1);
  });

  it('numbers the warm-up sets the way tool 2 does, skipping the empty bar', async () => {
    // The first rung is the implement with nothing on it and is numbered in
    // neither tool, so an ordinal counted off the array index would call the
    // first real warm-up "the second". Read as a whole list rather than one
    // row: an off-by-one is only visible against its neighbours.
    //
    // Split on the middot before asserting: `#renderItem` prints the label and
    // then `· 25 kg × 5`, so a bare `toContain('1')` on the row text is reading
    // the weight as often as the ordinal -- and the first row's own weight is
    // 25 kg at 5 reps, which is exactly the kind of digit that makes an
    // off-by-one assertion pass for the wrong reason.
    const element = await mount();
    const labels = textsOf(element, 'ol.timeline > li:not(.platform) .what').map(
      (row) => row.split('·')[0] ?? '',
    );
    const [first, second] = labels;
    // The first rung is named, not numbered, and that half needs its own
    // assertion: dropping `#ordinalOf`'s adjustable guard gives it the ordinal
    // 0, and "Warm-up 0" satisfies "does not contain a 1" exactly as "Empty
    // bar" does. Pinned as the word "bar" plus the two labels differing, per
    // §13.8 -- against `warmupItemLabel` itself the expected value would move
    // with the code.
    expect(first).toContain('bar');
    expect(first).not.toContain('1');
    expect(second).toContain('1');
    expect(first).not.toBe(second);
  });

  it('prints the ramp in the room’s plate unit and not the opener’s', async () => {
    // Both fixtures declare the opener in kilograms; only the room differs. A
    // lifter can plan in one unit and warm up on a bar loaded in the other, and
    // a ramp printed in the document's unit sends them hunting for a plate
    // nobody painted.
    const kilograms = await mount();
    const pounds = await mount(aPoundRoom());
    expect(textOf(kilograms, 'ol.timeline > li .what')).toContain('kg');
    expect(textOf(pounds, 'ol.timeline > li .what')).toContain('lb');
    // The adjust fold is the second reading of that unit and needs its own
    // assertion: pinning `#renderSetRow`'s own `unit` to 'kg' leaves the
    // timeline printing pounds and the field the lifter types into labelled
    // kilograms -- one screen, two units, and the one that is wrong is the one
    // being typed into. Both the field's unit and the placeholder come off it.
    const unitOf = (element: PtkMeetWarmup): string | null =>
      query(element, '[data-field="set-weight"]').at(0)?.getAttribute('unit') ?? null;
    expect(unitOf(pounds)).toBe('lb');
    expect(unitOf(kilograms)).not.toBe(unitOf(pounds));
  });

  it('says the meet is behind when a delay has been reported', async () => {
    // The delay notice is the schedule's own, not the estimate's, so it is
    // asserted inside the timeline section. The control is the same screen
    // without the delay, which carries no error notice at all.
    const element = await mount(runningLate());
    const onTime = await mount();
    expect(textsOf(element, 'ol.timeline ~ ptk-notice[tone="error"]')).toHaveLength(1);
    expect(textsOf(onTime, 'ol.timeline ~ ptk-notice[tone="error"]')).toEqual([]);
  });

  it('puts a shared rack on the timeline as an advisory rather than in silence', async () => {
    // §20's rule: each other lifter costs a set's time in every gap, and the
    // difference between that being announced and being folded silently into
    // the rest intervals is a handler who can see why the ramp got longer.
    //
    // The pinned fragment is "shared bar" and not "rack": the domain's
    // `sharing-a-rack` message reads "The timeline assumes the shared bar comes
    // free in turn." -- the code says rack, the sentence a lifter reads does
    // not. Asserting the code's own word would pass only by accident.
    const alone = await mount();
    const shared = await mount(sharingARack());
    const said = (element: PtkMeetWarmup): string =>
      textsOf(element, 'section:has(> h4) .advisories ptk-notice').join(' ');
    expect(said(shared)).toContain('shared bar');
    expect(said(alone)).not.toContain('shared bar');
  });

  it('puts preparation on the timeline on the side of the ramp it was answered for', async () => {
    const after = await mount(withKneeWraps());
    const before = await mount(longPreparation());
    const rowsAfter = textsOf(after, 'ol.timeline > li .what');
    const rowsBefore = textsOf(before, 'ol.timeline > li .what');
    expect(rowsAfter.at(-2)).toContain('wrap');
    expect(rowsBefore.at(0)).toContain('suit');
  });

  /*
   * §20.1's position questions.
   */

  it('shows only the pair of position fields the current answer needs', async () => {
    const earlier = await mount();
    const own = await mount(ownFlightRunning());
    expect(fields(earlier)).toContain('wholeFlightsBetween');
    expect(fields(earlier)).not.toContain('currentRound');
    expect(fields(own)).toContain('currentRound');
    expect(fields(own)).not.toContain('wholeFlightsBetween');
  });

  it('keeps what was typed under the pair it is not showing', async () => {
    // `warmup.ts` stores the discriminant rather than the union precisely so
    // that a flight being called -- which is somebody flipping this control --
    // does not throw away the figures typed a minute ago. Asserted through a
    // round trip rather than through the record, because the record is the
    // caller's and this element cannot be asked what it holds.
    const seen = watch();
    const element = await mount(ownFlightRunning());
    await choose(element, 'place', 'One before mine');

    const state = reported(seen);
    expect(state.progress.place).toBe('earlier-flight-running');
    expect(state.progress.currentRound).toBe('2');
    expect(state.progress.attemptsLeftInTheRunningFlight).toBe('12');
  });

  it('reports a typed position without disturbing anything else', async () => {
    const seen = watch();
    const element = await mount();
    await type(element, '[data-field="flightSize"]', '14');

    const state = reported(seen);
    expect(state.progress.flightSize).toBe('14');
    expect(state.progress.attemptsCompleted).toBe('30');
  });

  it('reports a typed preference against the preferences and not the progress', async () => {
    // The two records are written by different writers off one event, keyed on
    // a `data-field` that is a key of one of them. A field routed to the wrong
    // record is dropped by the other writer's spread and the keystroke
    // vanishes, which on screen is indistinguishable from a dead field.
    const seen = watch();
    const element = await mount();
    await type(element, '[data-field="restSeconds"]', '90');

    const state = reported(seen);
    expect(state.preferences.restSeconds).toBe('90');
    expect(state.preferences.leadMinimumMinutes).toBe('10');
  });

  it('ignores an event from something it did not tag', async () => {
    // §13.6's shape, now the fifth time in this directory: the filter over a
    // control the screen draws exactly one of looks unreachable, and the test
    // that bites is a foreign composed event dispatched at the host. Without
    // it a stray number field anywhere inside this element writes whichever
    // record the last branch happens to reach.
    const seen = watch();
    const element = await mount();
    element.dispatchEvent(
      new CustomEvent('ptk-number-change', {
        detail: { value: '99' },
        bubbles: true,
        composed: true,
      }),
    );
    await element.updateComplete;

    expect(seen).toEqual([]);
  });

  /*
   * §20's preparation rows.
   */

  it('asks only for the preparations the format contests', async () => {
    const full = await mount();
    const bench = await mount();
    bench.format = 'bench-only';
    await bench.updateComplete;

    expect(query(full, '.prep-row').length).toBeGreaterThan(query(bench, '.prep-row').length);
    expect(deepText(bench)).not.toContain('Knee wraps');
  });

  it('asks which side of the ramp only once a preparation has a time on it', async () => {
    // A `when` control on an empty row is a question about something that is
    // not happening, on the screen with the most optional fields in the tool.
    const blank = await mount();
    const timed = await mount(withKneeWraps());
    expect(query(blank, '[data-field="prep-when"]')).toEqual([]);
    expect(query(timed, '[data-field="prep-when"]')).toHaveLength(1);
  });

  it('reports a preparation time against the row it was typed on', async () => {
    const seen = watch();
    const element = await mount();
    await type(element, '[data-field="prep-minutes"][data-prep="bench-shirt"]', '7');

    const state = reported(seen);
    expect(state.preferences.prep['bench-shirt'].minutes).toBe('7');
    expect(state.preferences.prep['knee-wraps'].minutes).toBe('');
  });

  it('reports a preparation’s side against the row it was chosen on', async () => {
    const seen = watch();
    const element = await mount(withKneeWraps());
    await choose(element, 'prep-when', 'Before I start');

    const state = reported(seen);
    expect(state.preferences.prep['knee-wraps'].when).toBe('before-the-ramp');
    expect(state.preferences.prep['knee-wraps'].minutes).toBe('9');
  });

  /*
   * §20's per-set customisation.
   */

  it('offers a row per adjustable set and none for the empty bar', async () => {
    const element = await mount();
    const rows = query(element, '.set-row');
    const rungs = query(element, 'ol.timeline > li:not(.platform)');
    expect(rows).toHaveLength(rungs.length - 1);
  });

  it('offers no set rows at all where there is no ramp', async () => {
    const element = await mount(anEarlierFlight(), null);
    expect(query(element, '.set-row')).toEqual([]);
  });

  it('shows the calculated figure as a placeholder and the lifter’s as a value', async () => {
    // Two different claims on one control. A calculated rung written into the
    // value would be indistinguishable from a figure somebody typed, and the
    // reset button below would then have nothing to put back.
    const element = await mount(withAdjustedSets());
    const weights = query(element, '[data-field="set-weight"]');
    const overridden = weights.at(2);
    const untouched = weights.at(0);
    expect(overridden?.getAttribute('value')).toBe('112.5');
    expect(untouched?.getAttribute('value')).toBe('');
    expect(untouched?.getAttribute('placeholder')).not.toBe('');
  });

  it('feeds a per-set answer back into the ramp on the timeline', async () => {
    // The fold and the timeline are two readings of one plan, and the fixture's
    // override is a figure the calculator never produces -- so a screen that
    // held the answer in the fold and drew the calculated ramp above it is
    // visible here and nowhere else.
    const calculated = await mount();
    const adjusted = await mount(withAdjustedSets());
    expect(textsOf(calculated, 'ol.timeline .what').join(' ')).not.toContain('112.5');
    expect(textsOf(adjusted, 'ol.timeline .what').join(' ')).toContain('112.5');
  });

  it('offers the way back to the calculated ramp only once something was changed', async () => {
    const calculated = await mount();
    const adjusted = await mount(withAdjustedSets());
    expect(query(calculated, 'ptk-disclosure ptk-button')).toEqual([]);
    expect(query(adjusted, 'ptk-disclosure ptk-button')).toHaveLength(1);
  });

  it('forgets every per-set answer at once', async () => {
    const seen = watch();
    const element = await mount(withAdjustedSets());
    query(element, 'ptk-disclosure ptk-button').at(0)?.click();
    await element.updateComplete;

    const state = reported(seen);
    expect(state.weights).toEqual([]);
    expect(state.reps).toEqual([]);
  });

  it('says whose figures the ramp is, on the shut fold', async () => {
    // The summary is the only thing on screen while the fold is shut, and the
    // ramp is rebuilt on every keystroke elsewhere -- so a lifter can easily be
    // reading a fresh estimate over their own week-old rungs. Asserted as a
    // difference plus one pinned fragment (§13.8) rather than against
    // `warmupSetsSummary`, which would move with the code.
    const calculated = await mount();
    const adjusted = await mount(withAdjustedSets());
    const summaryOf = (element: PtkMeetWarmup): string =>
      query(element, 'ptk-disclosure').at(0)?.getAttribute('summary') ?? '';
    expect(summaryOf(calculated)).not.toBe(summaryOf(adjusted));
    expect(summaryOf(adjusted)).toContain('2');
  });

  /*
   * The room, which is tool 2's element and not a copy of it.
   */

  it('embeds tool 2’s room rather than asking the questions again', async () => {
    const element = await mount();
    expect(query(element, 'ptk-equipment-setup')).toHaveLength(1);
  });

  it('reports a change to the room against the state it was given', async () => {
    const seen = watch();
    const element = await mount();
    const room = { ...DEFAULT_WARM_UP_ROOM, collarId: 'none' };
    query(element, 'ptk-equipment-setup')
      .at(0)
      ?.dispatchEvent(
        new CustomEvent(EQUIPMENT_CHANGE_EVENT, {
          detail: { equipment: room },
          bubbles: true,
          composed: true,
        }),
      );
    await element.updateComplete;

    const state = reported(seen);
    expect(state.room.collarId).toBe('none');
    expect(state.progress.flightSize).toBe('10');
  });

  /*
   * §5.7 and §5.9.
   */

  it('fits a 320-pixel column', async () => {
    const element = await mount(withAdjustedSets());
    element.style.width = '320px';
    element.style.display = 'block';
    await element.updateComplete;
    expect(element.scrollWidth).toBeLessThanOrEqual(320);
  });

  it('has no accessibility violations', async () => {
    const element = await mount(withAdjustedSets());
    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
