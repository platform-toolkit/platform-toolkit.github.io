// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §11: what is on the screen, what is not, and which of the two is a bug.
 *
 * Nearly every assertion here is about *absence* or about *exclusivity*, which is
 * unusual and is what §11 turns out to be. A screen that renders one more panel
 * than it should still looks finished and still passes any test written as "the
 * weight is on the screen" -- and the requirement it fails, "remove setup details
 * from the immediate workflow", is the whole reason the screen exists. So the
 * tests that matter most below are the ones that say the choices are *gone* while
 * a referee is judging, that the projected figure is *not* the banked one, and
 * that a single miss produces *no* warning.
 *
 * Every state comes out of `live-fixture.ts` through `applyMeetAction`, so none
 * of them is a document a meet could not produce. The four next actions are four
 * points in one sequence, not four hand-built views.
 *
 * A real browser because the composition is the thing under test: three of these
 * panels are other custom elements, and a jsdom run would assert against tags
 * rather than against text a lifter can read.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import {
  BANKED_HEADING,
  NOTHING_TO_UNDO,
  NO_NEXT_ATTEMPT_NOTE,
  NO_PROJECTION_NOTE,
  PROJECTED_HEADING,
  URGENT_HEADING,
  attemptsBeforeCalledText,
  bombOutSentence,
  jumpText,
  liftsFinishedText,
  nextActionHeadline,
  positionText,
  runningTotalText,
  undoLabel,
} from './copy.js';
import {
  CHART,
  LIFTER,
  OPENER,
  SECOND,
  THIRD,
  choose,
  meetWith,
  nextAttemptIdOn,
  submit,
  take,
  viewOf,
} from './live-fixture.js';
import { EMPTY_LIVE_VIEW, type LiveView, type UrgentNote } from './live.js';
import {
  UNDO_REQUEST_EVENT,
  type PtkLiveScreen,
  type UndoRequestDetail,
} from './ptk-live-screen.js';
import './ptk-live-screen.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** One made opener. The lifter now owes the table a second weight. */
const RECORDED = take(meetWith(), 'squat', OPENER);

/** A lifter in the meet with no attempt started, so no deadline is running. */
function untouched(): LiveView {
  return viewOf(meetWith());
}

/** §11's `choose-the-next-attempt`: a result is in, no weight is picked. */
function choosing(): LiveView {
  return viewOf(RECORDED);
}

/** §11's `submit-to-the-table`: the weight is picked and the table has not been told. */
function atTheTable(): LiveView {
  return viewOf(choose(RECORDED, 'squat', SECOND));
}

/** §11's `record-the-result`: the bar is loaded and three referees are watching. */
function onThePlatform(): LiveView {
  return viewOf(submit(RECORDED, 'squat', SECOND));
}

/** One miss on the squat, which is an ordinary meet and not a warning. */
function oneMiss(): LiveView {
  return viewOf(take(meetWith(), 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' }));
}

/** Two misses and one attempt left: §13.7's prominent case. */
function onTheLastChance(): LiveView {
  const first = take(meetWith(), 'squat', OPENER, { outcome: 'no-lift', reason: 'strength' });
  return viewOf(take(first, 'squat', SECOND, { outcome: 'no-lift', reason: 'strength' }));
}

/** Every contested lift over, on the shortest format that has one. */
function meetOver(): LiveView {
  const first = take(meetWith('bench-only'), 'bench', OPENER);
  const second = take(first, 'bench', SECOND);
  return viewOf(take(second, 'bench', THIRD));
}

/** The same live view with something the caller observed added to it. */
function observing(
  view: LiveView,
  observed: { attemptsBeforeCalled?: number | null; urgent?: readonly UrgentNote[] },
): LiveView {
  return {
    ...view,
    observed: {
      attemptsBeforeCalled: observed.attemptsBeforeCalled ?? null,
      urgent: observed.urgent ?? [],
    },
  };
}

async function mount(view: LiveView = choosing()): Promise<PtkLiveScreen> {
  const element = document.createElement('ptk-live-screen');
  element.view = view;
  // The chart is a separate property from the view because the choices element
  // needs it to read pounds off weights nobody has taken yet; the weights
  // already on the view carry their own published figures. Left null here the
  // screen still renders, and every card would say its pound figure is an
  // approximation -- a true statement about the wrong screen.
  element.chart = CHART;
  element.haptics = () => {
    // §14.1's panel is a child here. The real port reaches the device, which a
    // test cannot observe and which would buzz the machine running the suite.
  };
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Whether a child element of the given tag was rendered at all. */
function has(element: PtkLiveScreen, tag: string): boolean {
  return element.shadowRoot?.querySelector(tag) !== null;
}

function textOf(element: PtkLiveScreen, selector: string): string {
  const found = element.shadowRoot?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`The screen has no ${selector}.`);
  return found.textContent.trim();
}

describe('ptk-live-screen', () => {
  it('re-renders when the view is replaced after the first render', async () => {
    // The positive control for the whole file. The caller repaints off the clock
    // seam four times a second, and a screen that rendered once would freeze at
    // whatever state it mounted in while every other test here still passed,
    // because each mounts its own.
    const element = await mount(choosing());
    expect(deepText(element)).toContain(nextActionHeadline('choose-the-next-attempt'));

    element.view = onThePlatform();
    await element.updateComplete;

    expect(deepText(element)).toContain(nextActionHeadline('record-the-result'));
  });

  it('names the lifter and the round above the headline', async () => {
    // A handler runs two lifters off one phone, and the failure §14 names -- the
    // right weight against the wrong athlete -- starts with a screen that never
    // says whose it is.
    const element = await mount(choosing());
    const who = textOf(element, '.who');
    // Compared against the copy function *and* against the lift the fixture is
    // on. The first alone is vacuous under exactly the mutation it is written to
    // catch -- pin `positionText` to one string and the expected value moves
    // with the code -- which is the lesson §13.8 records.
    const position = positionText(choosing().position);

    expect(who).toContain(LIFTER);
    expect(who).toContain(position);
    expect(position).toContain('Squat');
    // The round, pinned to the fixture rather than to the copy: one opener is
    // recorded, so the lifter is on the second squat.
    expect(position).toContain('2');
  });

  it('says the next action as an instruction, one at a time', async () => {
    // Four codes, four headlines, and no two of them on screen together. A screen
    // listing everything currently possible is the one §11 replaces.
    const states: LiveView[] = [choosing(), atTheTable(), onThePlatform(), meetOver()];
    const headlines = new Set<string>();

    for (const view of states) {
      const element = await mount(view);
      const heading = element.shadowRoot?.querySelector('h2');
      if (!(heading instanceof HTMLElement)) throw new Error('The screen has no headline.');

      expect(heading.textContent.trim()).toBe(nextActionHeadline(view.nextAction));
      headlines.add(heading.textContent.trim());
    }

    // The four states have to *read* differently, which is the assertion that
    // bites. Each line above compares the screen against the copy function the
    // screen called, so a mutation collapsing two headlines into one string
    // moves both expected values with it and the loop goes on passing -- while
    // a lifter at the table reads "choose the next attempt" over a loaded bar.
    expect(headlines.size).toBe(states.length);
  });

  it('offers the choices while the weight can still be changed', async () => {
    // Both before the table is told and after: §13's requirement is that a lifter
    // may change their mind for as long as the rules allow it, and the minute
    // running is not the same fact as the decision being closed.
    const choosingScreen = await mount(choosing());
    const tableScreen = await mount(atTheTable());

    expect(has(choosingScreen, 'ptk-live-choices')).toBe(true);
    expect(has(tableScreen, 'ptk-live-choices')).toBe(true);
  });

  it('takes the choices away while a referee is judging, and shows the result controls', async () => {
    // The exclusivity that matters. Offering a new weight for the attempt on the
    // platform is a suggestion the rules refuse, made at the moment the lifter is
    // least able to check it -- and both panels rendered together is what a
    // "show everything" screen looks like from the inside.
    const element = await mount(onThePlatform());

    expect(has(element, 'ptk-attempt-result')).toBe(true);
    expect(has(element, 'ptk-live-choices')).toBe(false);
  });

  it('does not offer the result controls before the table has it', async () => {
    const element = await mount(atTheTable());
    expect(has(element, 'ptk-attempt-result')).toBe(false);
  });

  it('hands the result controls the attempt that is on the platform', async () => {
    // Assembled from the view rather than re-derived: under `record-the-result`
    // the attempt the domain calls next is the one being judged. A screen that
    // worked out "which attempt is on the platform" for itself would be a second
    // reading of `actionFor`, free to disagree with the headline above it.
    const element = await mount(onThePlatform());
    const result = element.shadowRoot?.querySelector('ptk-attempt-result');
    if (result === null || result === undefined) throw new Error('No result controls.');

    expect(result.subject?.attemptId).toBe(nextAttemptIdOn(RECORDED, 'squat'));
    expect(result.subject?.lifterName).toBe(LIFTER);
    expect(result.subject?.lift).toBe('squat');
  });

  it('shows §14.1s minute whenever one is running, and nothing when none is', async () => {
    const running = await mount(choosing());
    const notStarted = await mount(untouched());

    expect(has(running, 'ptk-submission-countdown')).toBe(true);
    expect(has(notStarted, 'ptk-submission-countdown')).toBe(false);
  });

  it('shows the attempt with its pound reading and the jump from the last one', async () => {
    // §11 asks for all three. The jump is the figure a handler argues about and
    // it appears nowhere else on this screen -- the countdown names the weight
    // only to pin it to a lifter, and the choice cards are about weights not yet
    // taken.
    const view = atTheTable();
    const element = await mount(view);
    const jump = jumpText(view.nextAttempt?.jumpKilograms ?? null);
    if (jump === null) throw new Error('The fixture second attempt has no jump.');

    expect(textOf(element, '.weight')).toContain('190');
    // Read through `.pounds` rather than out of the whole screen. §16's phrase
    // is on the countdown panel too -- it names the weight to pin it to a lifter
    // and resolves the chart the same way -- so `deepText` finds it whatever
    // this card does, and the mutation dropping `attemptPoundsText` from
    // `#poundsLine` survived the whole suite while the card printed "about
    // 418.9 lb": a hedged conversion where the published figure was available,
    // which is the one thing §16 forbids outright.
    expect(textOf(element, '.pounds')).toContain('on the chart');
    expect(textOf(element, '.pounds')).not.toContain('about');
    expect(deepText(element)).toContain(jump);
    // The direction, pinned. The line above compares the screen against the
    // function that wrote it, so swapping "Up" for "Down" inside `jumpText`
    // moves both sides at once -- and a handler reading "Down 10 kg" off a
    // second attempt ten kilograms above the opener argues with the table about
    // a weight the tool has already got backwards.
    expect(jump).toContain('Up');
    expect(jump).toContain('10');
  });

  it('says the weight is not chosen yet rather than leaving the card blank', async () => {
    const element = await mount(choosing());
    expect(deepText(element)).toContain('No weight chosen yet');
  });

  it('keeps the two totals apart, each under its own heading', async () => {
    // §17: banked and projected are two facts and one of them has not happened.
    // A screen showing one figure teaches a lifter two lifts in that the day is
    // already in the bank.
    const view = choosing();
    const element = await mount(view);
    if (view.projected === null) throw new Error('The fixture has no projection to compare.');

    expect(deepText(element)).toContain(BANKED_HEADING);
    expect(deepText(element)).toContain(PROJECTED_HEADING);
    expect(textOf(element, '.figure')).toBe(runningTotalText(view.banked, 'kg'));
    expect(textOf(element, '.projected')).toBe(runningTotalText(view.projected, 'kg'));
    // The two figures have to differ, or the screen is showing one fact twice
    // under two headings -- which passes both lines above whenever the element
    // reads the same field for both, because then the expected values collapse
    // together too. 180 banked against 180 plus the highlighted second attempt.
    expect(textOf(element, '.figure')).not.toBe(textOf(element, '.projected'));
    expect(textOf(element, '.figure')).toContain('180');
  });

  it('says there is nothing to project rather than repeating the banked figure', async () => {
    // The pass case. Printing the banked total under "projected" reads as the
    // pass adding something, when what it does is close the lift -- which is why
    // the view carries null there and why this branch is a sentence.
    const view = choosing();
    const element = await mount({ ...view, projected: null });

    expect(deepText(element)).toContain(NO_PROJECTION_NOTE);
    expect(element.shadowRoot?.querySelector('.projected')).toBe(null);
  });

  it('says how many attempts are ahead, and says loudest that the lifter is up', async () => {
    const ahead = await mount(observing(choosing(), { attemptsBeforeCalled: 3 }));
    const now = await mount(observing(choosing(), { attemptsBeforeCalled: 0 }));

    expect(textOf(ahead, '.called')).toBe(attemptsBeforeCalledText(3));
    expect(textOf(now, '.called')).toBe(attemptsBeforeCalledText(0));
    // Both lines above take their expected value from the same function that
    // wrote them, so a screen that read one count for both states passes them
    // in step. "You are up now" is a different sentence from a smaller number,
    // not a smaller number, and this is the assertion that says so.
    expect(textOf(now, '.called')).not.toBe(textOf(ahead, '.called'));
    expect(textOf(ahead, '.called')).toContain('3');
    expect(now.shadowRoot?.querySelector('.called')?.hasAttribute('data-now')).toBe(true);
    expect(ahead.shadowRoot?.querySelector('.called')?.hasAttribute('data-now')).toBe(false);
  });

  it('says nobody has counted rather than leaving the line off', async () => {
    // A missing line reads as "there is nobody ahead of you", which is the one
    // wrong answer that costs an attempt.
    const element = await mount(observing(choosing(), { attemptsBeforeCalled: null }));
    const uncounted = textOf(element, '.called');
    expect(uncounted).toBe(attemptsBeforeCalledText(null));
    // And it is not the up-now sentence, which is the collapse that costs the
    // attempt -- and the one the line above cannot see, because it would move
    // with the copy.
    expect(uncounted).not.toBe(attemptsBeforeCalledText(0));
    expect(element.shadowRoot?.querySelector('.called')?.hasAttribute('data-now')).toBe(false);
  });

  it('shows urgent warm-up and equipment notes, labelled by which they are', async () => {
    const urgent: UrgentNote[] = [
      { kind: 'warm-up', message: 'Two more singles before the third.' },
      { kind: 'equipment', message: 'Get the knee sleeves on.' },
    ];
    const element = await mount(observing(choosing(), { urgent }));
    const text = deepText(element);

    expect(text).toContain(URGENT_HEADING);
    expect(text).toContain('Warm-up: Two more singles before the third.');
    expect(text).toContain('Equipment: Get the knee sleeves on.');
  });

  it('warns prominently on the last chance, because no child element does', async () => {
    // §13.7. `ptk-live-choices` renders the advisories and the granted extras off
    // the same object and does not render this, so a screen that leaves it out
    // meets the requirement with nothing at all -- and looks complete doing it.
    const view = onTheLastChance();
    const element = await mount(view);
    if (view.bombOut === null) throw new Error('The fixture is not near a bomb-out.');
    const sentence = bombOutSentence(view.bombOut);
    if (sentence === null) throw new Error('The fixture produced no bomb-out sentence.');

    const notice = element.shadowRoot?.querySelector('ptk-notice[tone="error"]');
    if (!(notice instanceof HTMLElement)) throw new Error('The warning is not a notice.');
    expect(notice.textContent.trim()).toBe(sentence);
    // And it says the last-chance sentence rather than the two-miss one, pinned
    // to a literal because the line above cannot tell them apart: both come out
    // of `bombOutSentence`, so collapsing the last-chance branch into the miss
    // count moves the expected value with the code. The two are different
    // warnings -- "two misses, one left" is a fact about the lift, "miss it and
    // there is no total" is what the day costs -- and §13.7 asks for the second.
    expect(notice.textContent.trim()).toContain('Last chance');
    expect(notice.textContent.trim()).toContain('no total');
  });

  it('says nothing about a single miss', async () => {
    // Deliberate silence, by the same argument that keeps the countdown calm at
    // the top of the minute: one miss happens to most lifters in most flights,
    // and a warning on it teaches the reader to skim the one that matters.
    const element = await mount(oneMiss());
    expect(element.shadowRoot?.querySelector('ptk-notice[tone="error"]')).toBe(null);
  });

  it('does not repeat the advisories or the granted extras the choices already render', async () => {
    // The §5.8 fork, caught by counting rather than by reading: both facts come
    // off the same `LiveChoices` object the child was handed, so a screen that
    // rendered them too would show each sentence twice, worded identically on
    // the day it was written.
    const withAdvisory = take(RECORDED, 'squat', SECOND, {
      outcome: 'no-lift',
      reason: 'strength',
    });
    const view = viewOf(withAdvisory);
    if (view.advisories.length === 0) throw new Error('The fixture produced no advisory.');
    const element = await mount(view);
    const [advisory] = view.advisories;
    if (advisory === undefined) throw new Error('The fixture produced no advisory.');

    const text = deepText(element);
    const first = text.indexOf(advisory.message);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(advisory.message, first + 1)).toBe(-1);
  });

  it('names what undo would take back, rather than saying only "Undo"', async () => {
    // The action being undone is usually a mis-tapped result, which the tool
    // knows and the lifter may not. A bare "Undo" asks them to remember, at the
    // one moment they are least able to.
    const view = choosing();
    const element = await mount(view);
    if (view.undoable === null) throw new Error('The fixture has nothing to undo.');

    expect(deepText(element)).toContain(undoLabel(view.undoable));
    // Named against a literal as well. The line above takes its expected value
    // from the function that wrote the label, so collapsing every branch of
    // `undoLabel` onto "Undo the last action" moves both sides together and the
    // assertion goes on passing -- while the button says exactly the thing the
    // test's own title rules out. The fixture's last action is a recorded good
    // lift, so the label has to name it.
    expect(deepText(element)).toContain('Undo recording');
  });

  it('says undo would take back declaring a weight, not handing it to the table', async () => {
    // `advance-attempt` is one action carrying six destinations and the screen
    // sends it to two of them. A single label covering both said the attempt had
    // gone to the table, so pressing undo on a weight still on the phone read as
    // taking back a submission -- the sentence most likely to send a handler to
    // the expeditor to correct something nobody was told.
    const declared = deepText(await mount(atTheTable()));
    const submitted = deepText(await mount(onThePlatform()));

    // The requirement is that the two read differently. Asserted as a difference
    // first, because both sides of a `toContain(undoLabel(...))` move together
    // under exactly the mutation that collapses the branch.
    expect(declared).not.toBe(submitted);
    expect(declared).toContain('Undo declaring');
    expect(submitted).toContain('Undo handing');
  });

  it('reports the action it was labelled with when undo is pressed', async () => {
    // Carried in the event rather than re-read by the caller, because those are
    // two instants: the view repaints four times a second, and between the paint
    // the lifter read and the tap that followed it a result could have landed.
    const view = choosing();
    const seen: UndoRequestDetail[] = [];
    const listener = (event: CustomEvent<UndoRequestDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(UNDO_REQUEST_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(UNDO_REQUEST_EVENT, listener);
    });

    const element = await mount(view);
    const button = element.shadowRoot?.querySelector('ptk-button');
    if (!(button instanceof HTMLElement)) throw new Error('The screen has no undo control.');
    button.click();

    expect(seen).toEqual([{ action: view.undoable }]);
  });

  it('says there is nothing to undo rather than offering a control that does nothing', async () => {
    // The empty view rather than a fixture meet, because this is the only way to
    // reach the branch and that is worth knowing: adding the lifter is itself an
    // undoable action, so every document `buildLiveView` will answer for has
    // something behind it. The state is real all the same -- a route paints
    // before anybody is focused -- and a control that reported an undo of
    // nothing would be a press that silently does not work.
    const element = await mount(EMPTY_LIVE_VIEW);

    expect(deepText(element)).toContain(NOTHING_TO_UNDO);
    expect(element.shadowRoot?.querySelector('ptk-button')).toBe(null);
  });

  it('keeps §29s sentences on the screen and out of the fold', async () => {
    const view = choosing();
    const element = await mount(view);
    const [notice] = view.notices;
    if (notice === undefined) throw new Error('The domain supplied no mandatory sentence.');

    const rendered = element.shadowRoot?.querySelector('.notices ptk-notice');
    if (!(rendered instanceof HTMLElement)) throw new Error('The sentence is not on the screen.');
    expect(rendered.textContent.trim()).toBe(notice);
    expect(rendered.closest('ptk-disclosure')).toBe(null);
  });

  it('puts the meet detail behind a fold instead of on the screen', async () => {
    // §11's "advanced details available without competing with the next action".
    // Which lifts are behind the lifter is real and worth having, and it is also
    // one more line between them and a button they have forty seconds to press.
    // Asserted on a finished lift rather than on the empty sentence, so that a
    // fold rendering nothing at all cannot pass this.
    const element = await mount(meetOver());
    const detail = element.shadowRoot?.querySelector('.detail');
    if (!(detail instanceof HTMLElement)) throw new Error('The screen has no detail.');

    expect(detail.textContent.trim()).toContain(liftsFinishedText(['bench']));
    expect(detail.closest('ptk-disclosure')).not.toBe(null);
    // Pinned to a literal too, because the line above cannot tell the two
    // branches of `liftsFinishedText` apart: collapse the empty-list branch into
    // the list branch and the expected value follows. The fold on a finished
    // meet has to name the lift, not report that nothing is finished.
    expect(detail.textContent.trim()).toContain('Finished:');
    expect(detail.textContent.trim()).not.toContain('No lift is finished');
  });

  it('says nothing is finished yet rather than an empty fold on the first lift', async () => {
    // The other branch, and it needs its own state: every assertion above runs
    // on a finished meet, so a change to the empty-list wording is invisible
    // there. A fold that opens onto nothing reads as the tool having lost the
    // detail it offered, which is worse than the sentence it replaced.
    const element = await mount(choosing());
    const detail = element.shadowRoot?.querySelector('.detail');
    if (!(detail instanceof HTMLElement)) throw new Error('The screen has no detail.');

    expect(detail.textContent.trim()).toContain('No lift is finished');
    expect(detail.textContent.trim()).not.toContain('Finished:');
  });

  it('stops offering an attempt once every contested lift is over', async () => {
    const element = await mount(meetOver());
    const text = deepText(element);

    expect(text).toContain(nextActionHeadline('the-meet-is-over'));
    expect(has(element, 'ptk-live-choices')).toBe(false);
    expect(has(element, 'ptk-attempt-result')).toBe(false);
    expect(element.shadowRoot?.querySelector('.called')).toBe(null);
    expect(text).toContain('Total');
    // Not the empty-card sentence either. A finished lifter has no attempt owed,
    // so the branch below the meet-over guard answers "No attempt is owed right
    // now" perfectly truthfully -- and it reads as a lift still under way that
    // the tool has lost track of, under a headline saying the day is done.
    // Dropping the guard produced exactly that and passed every other assertion
    // here, because it renders no panel and no attempt weight.
    expect(text).not.toContain(NO_NEXT_ATTEMPT_NOTE);
  });

  it('renders a lifter it has no view for without throwing', async () => {
    // `EMPTY_LIVE_VIEW` is the default and it is a real state: a route paints
    // before a lifter is focused. The bug it guards against is the other
    // direction -- a lit-html binding assigns over a class-field default, so a
    // nullable view bound into this property is a first render that throws.
    const element = document.createElement('ptk-live-screen');
    document.body.append(element);
    teardown.push(() => {
      element.remove();
    });
    await element.updateComplete;

    expect(deepText(element)).toContain(nextActionHeadline('the-meet-is-over'));
  });

  it('fits a 320px column and has no axe violations', async () => {
    // §5.7's floor, measured on the busiest state: an attempt at the table has
    // the countdown, the choices, both totals, the undo control and the fold on
    // screen at once, which is the widest this screen ever gets.
    const column = document.createElement('div');
    column.style.width = '320px';
    document.body.append(column);
    teardown.push(() => {
      column.remove();
    });

    const element = document.createElement('ptk-live-screen');
    element.view = observing(atTheTable(), {
      attemptsBeforeCalled: 2,
      urgent: [{ kind: 'equipment', message: 'Get the knee sleeves on.' }],
    });
    element.haptics = () => {
      // Mounted by hand rather than through `mount`, so the silent port is
      // installed by hand too.
    };
    column.append(element);
    await element.updateComplete;

    expect(element.scrollWidth).toBeLessThanOrEqual(320);

    const results = await axe.run(column);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
