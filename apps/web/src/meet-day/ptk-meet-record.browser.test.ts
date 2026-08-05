// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19 on the screen: one record, two attempts that take it, two weights.
 *
 * `records.ts` and `meet-records.ts` produced every figure and both have their
 * own suites, so nothing below re-asserts a margin, a rounding or an
 * eligibility rule. What is this element's own is the set of decisions it makes
 * about what a lifter is looking at, and each of them is a way the screen can be
 * complete and wrong:
 *
 * - **That both routes are always drawn, including the shut one.** The two
 *   figures are different weights and a lifter handed the wrong one loses either
 *   the record or the card, so a route without its heading is worse than no
 *   route. A test that only asserted the open one passes against an element that
 *   hides the other.
 * - **Which questions are on screen.** The banked total is asked for a total
 *   record and for nothing else, and the answer under it must survive a subject
 *   change -- the state is the caller's and this element never edits it.
 * - **That the mandatory sentence is on every state.** §29 is a list of
 *   sentences that must appear, and the states most likely to drop it are the
 *   two refusals, which are also the two a lifter reaches first.
 * - **That an event leaves carrying the whole state.** The element owns nothing;
 *   a handler that computed the right patch and never dispatched it looks
 *   identical on screen, because the control it was typed into keeps what was
 *   typed (§13.14).
 *
 * WHY SO FEW ASSERTIONS NAME A FUNCTION FROM `copy.ts`
 *
 * §13.8's rule, arriving for the ninth time in this directory: an assertion
 * whose expected value is computed by the module under test moves with the code
 * and goes on passing under exactly the mutation it was written to catch. So the
 * tests below read two states through one selector, assert they differ, and pin
 * one literal fragment of the one they are about.
 *
 * WHY THE FIGURES ARE PINNED AS LITERALS AND THE FIXTURE SAYS SO
 *
 * 200.25 and 200.5 are written out below rather than derived. They are the whole
 * subject of this element -- the same record under two conditions -- and the
 * fixture's header explains which invented numbers produce them. A test that
 * asked the domain for them again would agree with a domain that had stopped
 * distinguishing the two conditions at all.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  BANKED_TOTAL,
  SQUAT_RECORD,
  aFigureThatWillNotRead,
  aRecordAtThisLevel,
  aRecordFromASmallerMeet,
  aRelationNobodyAnswered,
  aTotalRecord,
  aTotalRecordWithNothingBanked,
  afterAGoodThird,
  afterAMissedThird,
  anUnclaimedRecord,
  nothingTyped,
  onTheDeadlift,
  onTheSquat,
} from './records-fixture.js';
import type { MeetRecordState, RecordAttemptSubject, RecordSubject } from './records.js';
import {
  MEET_RECORD_CHANGE_EVENT,
  type MeetRecordChangeDetail,
  type PtkMeetRecord,
} from './ptk-meet-record.js';
import './ptk-meet-record.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  state: MeetRecordState = aRecordAtThisLevel(),
  subject: RecordSubject = 'squat',
  attempt: RecordAttemptSubject | null = onTheSquat(),
): Promise<PtkMeetRecord> {
  const element = document.createElement('ptk-meet-record');
  element.state = state;
  element.subject = subject;
  element.attempt = attempt;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function query(element: PtkMeetRecord, selector: string): HTMLElement[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].filter(
    (found): found is HTMLElement => found instanceof HTMLElement,
  );
}

function textsOf(element: PtkMeetRecord, selector: string): string[] {
  return query(element, selector).map((found) => found.textContent.trim());
}

/**
 * Everything the element renders, across shadow boundaries, as one run of text.
 *
 * Used only where the assertion is about a sentence appearing *somewhere* -- a
 * caveat, a refusal, an advisory. Anything about *which block* a figure is in
 * goes through `routes()` instead, because the whole point of this screen is
 * that the same record is two different weights depending on which heading the
 * figure sits under.
 */
function deepTextOf(element: PtkMeetRecord): string {
  return deepText(element).replaceAll(/\s+/gu, ' ');
}

function textOf(element: PtkMeetRecord, selector: string): string {
  const [found] = query(element, selector);
  if (found === undefined) throw new Error(`The screen has no ${selector}.`);
  return found.textContent.trim();
}

/**
 * The two route blocks, in document order, each as one run of text.
 *
 * By position rather than by heading, so that a test naming "the fourth attempt
 * block" is asserting where it is as well as what it says. The order is the
 * order a lifter meets the two attempts in, and swapping them would put the
 * figure a fourth attempt needs under the heading of the one that is happening
 * next.
 */
function routes(element: PtkMeetRecord): string[] {
  return textsOf(element, '.record-route').map((text) => text.replaceAll(/\s+/gu, ' '));
}

/** The controls this element rendered, by the `data-field` it tagged them with. */
function fields(element: PtkMeetRecord): string[] {
  return query(element, '[data-field]').flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

function fieldNamed(element: PtkMeetRecord, field: string): HTMLElement {
  const [found] = query(element, `[data-field="${field}"]`);
  if (found === undefined) throw new Error(`The screen has no "${field}" control.`);
  return found;
}

/** Types into one of the number or text fields, keystroke and all. */
async function type(element: PtkMeetRecord, field: string, text: string): Promise<void> {
  const input = fieldNamed(element, field).shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input inside "${field}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Presses one segment of a `ptk-segmented`, by the label a lifter reads. */
async function choose(element: PtkMeetRecord, field: string, label: string): Promise<void> {
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
 * On `document.body` for the reason `ptk-meet-warmup.browser.test.ts` gives: a
 * listener on the element itself passes whether or not the event was composed,
 * and a root two shadow roots up is what actually has to receive it.
 */
function watch(): MeetRecordState[] {
  const seen: MeetRecordState[] = [];
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) {
      seen.push((event.detail as MeetRecordChangeDetail).state);
    }
  };
  document.body.addEventListener(MEET_RECORD_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(MEET_RECORD_CHANGE_EVENT, listener);
  });
  return seen;
}

/** The last state reported, or a failure naming what was reported instead. */
function reported(seen: readonly MeetRecordState[]): MeetRecordState {
  const last = seen.at(-1);
  if (last === undefined) throw new Error('Nothing was reported.');
  return last;
}

describe('ptk-meet-record', () => {
  it('re-renders when the state is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating.
    const element = await mount(nothingTyped());
    expect(routes(element).join(' ')).not.toContain('200.5');

    element.state = aRecordAtThisLevel();
    await element.updateComplete;

    expect(routes(element).join(' ')).toContain('200.5');
  });

  /*
   * The two routes. This element's whole argument, and the thing it exists for.
   */

  it('draws both routes under headings that name the attempt', async () => {
    const element = await mount();
    const [competition, fourth] = routes(element);
    expect(competition).toContain('On a competition attempt');
    expect(fourth).toContain('On a fourth attempt');
  });

  it('keeps the heading and the block of a route that is shut', async () => {
    // The failure this is written against is the tidy one: hide the route that
    // cannot be taken, leaving a single unlabelled figure on screen. Before a
    // third attempt the fourth-attempt route is shut, and it has to stay drawn.
    const element = await mount();
    expect(routes(element)).toHaveLength(2);
    const [, fourth] = routes(element);
    expect(fourth).toContain('the third attempt has not happened');
    expect(fourth).not.toContain('200');
  });

  /**
   * The accent border on the open route, which is the one thing on this element
   * that is drawn in colour alone.
   *
   * Asserted as the class rather than as a computed border colour, because what
   * is being pinned is which block gets it and not what it looks like. The rule
   * it drives lives in `static styles` and nothing else reads the class, so
   * without this the whole conditional collapses to the empty string and the
   * screen looks deliberate: two identically bordered blocks, one of which is a
   * refusal. Found by mutation -- `'record-open' : ''` to `'' : ''` passed every
   * other test in this file.
   *
   * Both halves are asserted, and the second is the reason for the first. §21's
   * rule is that colour is never an identity cue, so the border may only ever
   * *confirm* what the sentence under the heading already says. A class on both
   * blocks would satisfy a test that only looked at the open one, and would tell
   * a lifter reading colour that a shut route is open.
   */
  it('marks only the open route with the class its accent border hangs on', async () => {
    const element = await mount();
    const [competition, fourth] = query(element, '.record-route');

    expect(competition?.classList.contains('record-open')).toBe(true);
    expect(fourth?.classList.contains('record-open')).toBe(false);
  });

  it('gives the two routes different weights off one record', async () => {
    // The reason the routes are two blocks rather than one figure, and the whole
    // of what this element exists to show. One 200 kg record, one profile: the
    // competition attempt is rounded onto the ordinary half-kilogram bar multiple
    // and needs 200.5, and the fourth attempt carries the fractional exemption
    // and needs 200.25. A quarter of a kilogram, and the tool that shows only one
    // of them costs a lifter either the record or the card.
    const planning = await mount(aRecordAtThisLevel());
    const [beforeAnyLifting] = routes(planning);
    expect(beforeAnyLifting).toContain('200.5 kg');

    const platform = await mount(aRecordAtThisLevel(), 'squat', afterAGoodThird());
    const [competition, fourth] = routes(platform);
    expect(competition).toContain('Every competition attempt');
    expect(fourth).toContain('200.25 kg');
  });

  it('names every condition the federation attaches to a fourth attempt', async () => {
    // Four separate facts, and a lifter granted a fourth attempt has about a
    // minute to satisfy all of them. Each is rendered only where the route sets
    // it, which is why they are asserted together on the route that sets all four
    // rather than one at a time on whichever route is convenient.
    const element = await mount(aRecordAtThisLevel(), 'squat', afterAGoodThird());
    const [, fourth] = routes(element);
    expect(fourth).toContain('60 seconds');
    expect(fourth).toContain('granted');
    expect(fourth).toContain('checked after the lift');
    expect(fourth).toContain('Does not count toward your total');
  });

  it('does not print a permission line on a route that needs none', async () => {
    // The competition route sets none of the three conditions above, and a block
    // that printed them anyway -- "no permission needed" on every attempt -- is
    // three lines of noise on the route a lifter reads most.
    const element = await mount();
    const [competition] = routes(element);
    expect(competition).toContain('200.5 kg');
    expect(competition).not.toContain('granted');
    expect(competition).not.toContain('checked after the lift');
  });

  it('gives two shut routes two different reasons', async () => {
    // A missed third closes both, on facts that are not the same fact. A lifter
    // who reads one as the other argues with an expeditor about the wrong rule.
    const element = await mount(aRecordAtThisLevel(), 'squat', afterAMissedThird());
    const [competition, fourth] = routes(element);
    expect(competition).toContain('Every competition attempt');
    expect(fourth).toContain('not good');
    expect(competition).not.toBe(fourth);
  });

  /*
   * The level condition, which is the one thing on this screen nothing can guess.
   */

  it('names the heavier figure while the level question is unanswered', async () => {
    // The domain takes the lighter condition by default and this is what stops
    // that being silent. Both figures have to be legible at once: the one shown
    // and the one that applies if the record is from a smaller meet.
    const element = await mount(aRelationNobodyAnswered(), 'squat', afterAGoodThird());
    const [, fourth] = routes(element);
    expect(fourth).toContain('200.25 kg');
    expect(deepTextOf(element)).toContain('it takes 200.5 kg instead');
  });

  it('drops the caveat once the level question is answered', async () => {
    const element = await mount(aRecordAtThisLevel(), 'squat', afterAGoodThird());
    expect(deepTextOf(element)).not.toContain('instead');
  });

  it('says nothing where the answer cannot move a figure on screen', async () => {
    // The planning screen: the only open route is the competition attempt, and
    // its weight is rounded onto the same bar multiple the full increment *is*.
    // A caveat here would print "it takes 200.5 kg instead" directly above a
    // heading already reading 200.5 kg. Found by rendering it -- see the note of
    // the same name in `records.test.ts`.
    const element = await mount(aRelationNobodyAnswered());
    expect(routes(element).join(' ')).toContain('200.5 kg');
    expect(deepTextOf(element)).not.toContain('instead');
  });

  it('charges the full increment for a record below the meet', async () => {
    const element = await mount(aRecordFromASmallerMeet(), 'squat', afterAGoodThird());
    const [, fourth] = routes(element);
    expect(fourth).toContain('200.5 kg');
    expect(fourth).not.toContain('200.25');
  });

  /*
   * The states with no plan in them, both of which keep §29's sentence.
   */

  it('asks for a figure rather than planning against an empty box', async () => {
    const element = await mount(nothingTyped());
    expect(routes(element)).toHaveLength(0);
    expect(deepTextOf(element)).toContain('No record typed in yet');
  });

  it('refuses a figure that will not read in the same words as an empty box', async () => {
    // The two are the same situation -- there is no number to measure from -- and
    // the field itself carries the reading error, so the answer block does not
    // repeat it.
    const element = await mount(aFigureThatWillNotRead());
    expect(routes(element)).toHaveLength(0);
    expect(deepTextOf(element)).toContain('No record typed in yet');
  });

  it('says the rule book is missing rather than the record', async () => {
    // A different screen from the one above, naming a control that is somewhere
    // else. Collapsing the two would send a lifter to fill in a box that is full.
    const element = await mount(aRecordAtThisLevel(), 'squat', null);
    expect(routes(element)).toHaveLength(0);
    expect(deepTextOf(element)).toContain('Choose a federation');
    expect(deepTextOf(element)).not.toContain('No record typed in yet');
  });

  it('prints the verify-with-officials sentence on every state', async () => {
    // §29. The states most likely to drop it are the two refusals, which are also
    // the two a lifter reaches first.
    for (const state of [nothingTyped(), aRecordAtThisLevel(), aFigureThatWillNotRead()]) {
      const element = await mount(state);
      expect(textOf(element, '.record-verify')).toContain('Verify this record');
      element.remove();
    }
  });

  it('says an unclaimed record is a seeded standard', async () => {
    const element = await mount(anUnclaimedRecord());
    expect(deepTextOf(element)).toContain('Nobody holds this record yet');
  });

  /*
   * The total record, the one subject that changes the shape of the screen.
   */

  it('asks for the banked total only for a total record', async () => {
    const element = await mount(aRecordAtThisLevel());
    expect(fields(element)).not.toContain('record-total-so-far');

    element.state = aTotalRecord();
    element.subject = 'total';
    element.attempt = onTheDeadlift();
    await element.updateComplete;

    expect(fields(element)).toContain('record-total-so-far');
  });

  it('keeps the banked figure when the subject moves off the total', async () => {
    // The state is the caller's and this element never edits it, so a figure
    // typed against the total has to survive a lifter looking at the squat and
    // coming back. An element that cleared it looks identical until they do.
    const element = await mount(aTotalRecord(), 'total', onTheDeadlift());
    element.subject = 'squat';
    element.attempt = onTheSquat();
    await element.updateComplete;
    element.subject = 'total';
    element.attempt = onTheDeadlift();
    await element.updateComplete;

    const input = fieldNamed(element, 'record-total-so-far').shadowRoot?.querySelector('input');
    expect(input?.value).toBe(BANKED_TOTAL);
  });

  it('names the bar and the total it reaches on a total record', async () => {
    // A lifter shown only the total loads the total; a lifter shown only the bar
    // has no way to check the arithmetic that matters. A 500 kg record needs
    // 500.5 on the ordinary bar multiple, and 340 already banked leaves 160.5.
    const element = await mount(aTotalRecord(), 'total', onTheDeadlift());
    const [competition] = routes(element);
    expect(competition).toContain('160.5 kg');
    expect(competition).toContain('500.5 kg');
  });

  it('does not treat an unfilled banked total as zero', async () => {
    // A blank field is not a total of zero. An element that assumed one would
    // print the whole record as a deadlift.
    const element = await mount(aTotalRecordWithNothingBanked(), 'total', onTheDeadlift());
    const [competition] = routes(element);
    expect(competition).toContain('Fill in the total banked so far');
    expect(competition).not.toContain('500.5');
  });

  /*
   * The answers leaving. Every one of these is invisible on screen until a root
   * hands a new state back, which is why they are read off the event.
   */

  it('reports the record as it is typed', async () => {
    const seen = watch();
    const element = await mount(nothingTyped());
    await type(element, 'record-kilograms', SQUAT_RECORD);
    expect(reported(seen).kilograms).toBe(SQUAT_RECORD);
  });

  it('reports the level label without touching the rest of the state', async () => {
    const seen = watch();
    const element = await mount(aRecordAtThisLevel());
    await type(element, 'record-level', 'National');
    const state = reported(seen);
    expect(state.levelLabel).toBe('National');
    expect(state.kilograms).toBe(SQUAT_RECORD);
  });

  it('reports the banked total against the field it was typed into', async () => {
    // The two number fields on this screen report through one handler, and the
    // failure is the quiet one: a banked total landing in the record box replaces
    // the record with a figure nobody typed as one.
    const seen = watch();
    const element = await mount(aTotalRecordWithNothingBanked(), 'total', onTheDeadlift());
    await type(element, 'record-total-so-far', BANKED_TOTAL);
    const state = reported(seen);
    expect(state.totalFromOtherLifts).toBe(BANKED_TOTAL);
    expect(state.kilograms).toBe('500');
  });

  it('reports an unclaimed record as unclaimed', async () => {
    const seen = watch();
    const element = await mount(aRecordAtThisLevel());
    await choose(element, 'record-holder', 'Nobody yet');
    expect(reported(seen).unclaimed).toBe(true);
  });

  it('reports a record put back into the hands of a holder', async () => {
    // The other direction, and the one that matters: the held answer is what
    // charges the ordinary margin, so an element that could only ever set the
    // flag would leave a mis-tap permanently telling a lifter they may match.
    const seen = watch();
    const element = await mount(anUnclaimedRecord());
    await choose(element, 'record-holder', 'Somebody holds it');
    expect(reported(seen).unclaimed).toBe(false);
  });

  it('reports the level relation', async () => {
    const seen = watch();
    const element = await mount(aRelationNobodyAnswered());
    await choose(element, 'record-relation', 'Lower');
    expect(reported(seen).levelRelation).toBe('below-the-meet');
  });

  /*
   * The caveat §24 owes a lifter for saving these answers at all.
   */

  it('says nothing about where the answers came from by default', async () => {
    // The default matters more than it looks. Every fold a lifter types into
    // fresh renders through this path, so a flag defaulting the other way would
    // caveat a figure read off a list thirty seconds ago.
    expect(deepTextOf(await mount(aRecordAtThisLevel()))).not.toContain(
      'saved with this meet earlier',
    );
  });

  it('names a restored answer as one that was saved earlier', async () => {
    const element = await mount(aRecordAtThisLevel());
    element.restored = true;
    await element.updateComplete;
    expect(deepTextOf(element)).toContain('saved with this meet earlier');
  });

  it('keeps the mandatory sentence alongside it rather than in place of it', async () => {
    // The two are different claims -- one about whether the attempt qualifies
    // under the rules, one about whether the number was ever right -- and the
    // tempting simplification is to treat the restored caveat as covering both.
    // §29's sentence has to be on every state, including this one.
    const element = await mount(aRecordAtThisLevel());
    element.restored = true;
    await element.updateComplete;
    expect(textOf(element, '.record-verify')).not.toBe('');
    expect(deepTextOf(element)).toContain('saved with this meet earlier');
  });

  it('caveats a restored answer the rules cannot yet be read against', async () => {
    // No federation chosen, so there are no routes and the whole answer block is
    // one refusal. A caveat rendered inside that block would vanish here, which
    // is exactly the screen a lifter reopens a meet onto before the rule book has
    // loaded -- with the figure they typed on Thursday sitting in the box.
    const element = await mount(aRecordAtThisLevel(), 'squat', null);
    element.restored = true;
    await element.updateComplete;
    expect(deepTextOf(element)).toContain('saved with this meet earlier');
  });

  /*
   * §5.7 and §5.9.
   */

  it('fits a 320-pixel column', async () => {
    const element = await mount(aRecordAtThisLevel(), 'squat', afterAGoodThird());
    element.style.width = '320px';
    element.style.display = 'block';
    await element.updateComplete;
    expect(element.scrollWidth).toBeLessThanOrEqual(320);
  });

  it('has no accessibility violations', async () => {
    const element = await mount(aTotalRecord(), 'total', onTheDeadlift());
    const results = await axe.run(element, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
