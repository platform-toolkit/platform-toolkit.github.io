// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §14.1's panel: the minute, the attempt that is owed, and one press.
 *
 * Every band comes out of one recorded opener read at four instants. The fixture
 * profile allows ninety seconds rather than the sixty §14.1 describes, which is
 * §5.1 doing its job here rather than an oversight: the two thresholds are
 * absolute seconds, so an assertion written as "fifteen seconds before the
 * deadline" would pass against a fixture and fail against a rule set, and the
 * failure would be a panel that stayed calm into the last ten seconds.
 *
 * Nothing in this file waits. There is no timer in the element -- the seconds on
 * the view are `deadline - now` and the screen above repaints -- so every test is
 * an assertion about one instant, and a test that used real time would be
 * measuring the runner.
 *
 * A real browser because the press has to land on the `ptk-button` host the way a
 * thumb does, and because the 320px measurement below is a layout.
 */
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  MARK_SUBMITTED_LABEL,
  NO_DEADLINE_NOTE,
  NO_SUBMISSION_NOTE,
  OFFICIAL_CLOCK_NOTE,
  countdownText,
  submissionStatusText,
  urgencySentence,
} from './copy.js';
import {
  LIFTER,
  OPENER,
  SECOND,
  START,
  choose,
  contextAt,
  meetWith,
  submissionOf,
  submit,
  take,
} from './live-fixture.js';
import type { SubmissionClock, SubmissionView } from './live.js';
import {
  SUBMISSION_MARKED_EVENT,
  type PtkSubmissionCountdown,
  type SubmissionMarkedDetail,
} from './ptk-submission-countdown.js';
import './ptk-submission-countdown.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** One made opener, which is what starts the clock. */
const RECORDED = take(meetWith(), 'squat', OPENER);

/** The panel that many seconds into the minute. */
function at(seconds: number): SubmissionView {
  return submissionOf(RECORDED, contextAt(START + seconds * 1_000));
}

/** The same opener with the next weight already at the table. */
function handedIn(): SubmissionView {
  return submissionOf(submit(RECORDED, 'squat', SECOND, START + 5_000), contextAt(START + 10_000));
}

/**
 * A declared opener, which is the panel with no clock on it.
 *
 * Nothing has been judged on this lift yet, so the domain has no result to start
 * a countdown from -- and this is the state the tool spends three of its nine
 * attempts in, not an edge case.
 */
const OPENER_OWED: SubmissionView = submissionOf(choose(meetWith(), 'squat', OPENER));

/**
 * The same panel with its clock patched.
 *
 * The three fields only mean anything together, so they arrive as one object and
 * a spread over the view cannot reach them. It throws rather than inventing a
 * clock: a test that meant to patch one and silently attached a fresh one to an
 * openerless panel would be asserting against a state the builder never makes.
 */
function withClock(view: SubmissionView, patch: Partial<SubmissionClock>): SubmissionView {
  if (view.clock === null) throw new Error('That panel has no clock to patch.');
  return { ...view, clock: { ...view.clock, ...patch } };
}

async function mount(
  submission: SubmissionView | null = at(0),
  patch: Partial<Pick<PtkSubmissionCountdown, 'haptics'>> = {},
): Promise<PtkSubmissionCountdown> {
  const element = document.createElement('ptk-submission-countdown');
  element.submission = submission;
  element.haptics = () => {
    // Silent by default. The real port reaches the device, which a test cannot
    // observe and a laptop cannot show.
  };
  Object.assign(element, patch);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** The panel itself, which is what carries the urgency attribute. */
function panelOf(element: PtkSubmissionCountdown): HTMLElement {
  const panel = element.shadowRoot?.querySelector('.panel');
  if (!(panel instanceof HTMLElement)) throw new Error('The panel did not render.');
  return panel;
}

/** The one control on the panel. */
function markButton(element: PtkSubmissionCountdown): HTMLElement {
  const host = element.shadowRoot?.querySelector('ptk-button');
  if (!(host instanceof HTMLElement)) throw new Error('The panel rendered no control.');
  return host;
}

function nativeButton(host: Element): HTMLButtonElement {
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('The control did not render.');
  return button;
}

/** Every press this panel reported, in order. */
function watch(): SubmissionMarkedDetail[] {
  const seen: SubmissionMarkedDetail[] = [];
  const listener = (event: CustomEvent<SubmissionMarkedDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(SUBMISSION_MARKED_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(SUBMISSION_MARKED_EVENT, listener);
  });
  return seen;
}

/** The weight is with the table and the lifter has not said so yet. */
function handedInWithNoMark(): SubmissionView {
  return { ...handedIn(), submitted: false };
}

/** The line that says whether the lifter has marked it. */
function statusLine(element: PtkSubmissionCountdown): string {
  const status = element.shadowRoot?.querySelector('.status');
  if (!(status instanceof HTMLElement)) throw new Error('The panel has no status line.');
  return status.textContent.trim();
}

/** A recorder for the haptics port, and the patch that installs it. */
function recordBuzzes(): {
  felt: (number | number[])[];
  patch: Pick<PtkSubmissionCountdown, 'haptics'>;
} {
  const felt: (number | number[])[] = [];
  return {
    felt,
    patch: {
      haptics: (pattern) => {
        felt.push(pattern);
      },
    },
  };
}

describe('ptk-submission-countdown', () => {
  it('re-renders when the view is replaced after the first render', async () => {
    // The positive control for every other test in this file. The screen above
    // hands in a fresh view four times a second, so a panel that rendered once
    // and stopped would freeze the clock at whatever second it mounted -- and
    // every assertion below would still pass, because each mounts its own.
    const element = await mount(at(0));
    expect(deepText(element)).toContain(countdownText(90));

    element.submission = at(65);
    await element.updateComplete;

    expect(deepText(element)).toContain(countdownText(25));
  });

  it('says nothing is owed rather than rendering an empty panel', async () => {
    const element = await mount(null);
    expect(deepText(element)).toContain(NO_SUBMISSION_NOTE);
    expect(element.shadowRoot?.querySelector('ptk-button')).toBe(null);
  });

  it('keeps the panel and its control on an attempt with no deadline', async () => {
    // The opener of a lift: the tool's minute runs off a recorded result and
    // looks for the next attempt on the same lift, so nothing is counting before
    // squat one. Withdrawing the panel for that reason takes the mark control
    // off the screen for three of the nine attempts, and it is the only route to
    // `submitted` in the tool -- which is how the meet came to be unrunnable.
    const element = await mount(OPENER_OWED);

    expect(nativeButton(markButton(element)).disabled).toBe(false);
    expect(deepText(element)).toContain(NO_DEADLINE_NOTE);
    // No digits, and none of the colour-only signal that stands in for them.
    expect(element.shadowRoot?.querySelector('.clock')).toBe(null);
    expect(panelOf(element).dataset['urgency']).toBeUndefined();
    expect(deepText(element)).not.toContain(urgencySentence('calm'));
  });

  it('reports the press on an attempt that has no deadline', async () => {
    // The press is the whole reason the panel stays. A control that renders and
    // reports nothing looks identical to a lifter, and the meet stops there.
    const seen = watch();
    const element = await mount(OPENER_OWED);

    nativeButton(markButton(element)).click();

    expect(seen).toEqual([{ attemptId: OPENER_OWED.attemptId }]);
  });

  it('shows the lifter and the weight together, which is what §14 asks for', async () => {
    // The named failure is the correct weight handed in for the wrong athlete,
    // which is a handler with two lifters and one phone. Both facts on one line
    // is the check; on separate lines the name scrolls away from the figure.
    const element = await mount(handedIn());
    const subject = element.shadowRoot?.querySelector('.subject');
    if (!(subject instanceof HTMLElement)) throw new Error('The panel has no subject line.');

    expect(subject.textContent).toContain(LIFTER);
    expect(subject.textContent).toContain('190');
  });

  it('says the weight is not chosen yet rather than showing the name alone', async () => {
    const element = await mount(at(0));
    const subject = element.shadowRoot?.querySelector('.subject');
    if (!(subject instanceof HTMLElement)) throw new Error('The panel has no subject line.');

    expect(subject.textContent).toContain(LIFTER);
    expect(subject.textContent).toContain('no weight chosen yet');
  });

  it('counts the minute in minutes and seconds', async () => {
    const element = await mount(at(35));
    // 55 seconds left of the fixture's ninety.
    expect(deepText(element)).toContain('0:55');
  });

  it('labels the ticking figure in words', async () => {
    // "zero colon five five" is what a screen reader makes of the digits. The
    // label is not a live region and is not announced; it is there for a reader
    // who asks the panel what it says.
    const element = await mount(at(35));
    const clock = element.shadowRoot?.querySelector('.clock');
    if (!(clock instanceof HTMLElement)) throw new Error('The panel has no clock.');

    expect(clock.getAttribute('aria-label')).toBe('55 seconds left');
  });

  it('keeps the ticking figure out of a live region and puts the band in one', async () => {
    // The digits change four times a second. Announced, they would talk over
    // everything else on the screen for the whole minute -- including the
    // choices the lifter is trying to read. The band changes three times.
    const element = await mount(at(65));
    const clock = element.shadowRoot?.querySelector('.clock');
    const band = element.shadowRoot?.querySelector('[role="status"]');
    if (!(clock instanceof HTMLElement) || !(band instanceof HTMLElement)) {
      throw new Error('The panel is missing the clock or the band.');
    }

    expect(clock.closest('[role="status"], [aria-live]')).toBe(null);
    expect(band.textContent.trim()).toBe(urgencySentence('hurry'));
  });

  it('says the urgency in words as well as in colour', async () => {
    // §5.8: colour is never the sole carrier. The attribute the border is keyed
    // on is asserted here beside the sentence, so a change that drops one of the
    // two is a failure rather than a quieter panel.
    const element = await mount(at(85));

    expect(panelOf(element).dataset['urgency']).toBe('critical');
    expect(deepText(element)).toContain(urgencySentence('critical'));
  });

  it('reads the band off the view rather than working it out again', async () => {
    // Two readings of the same thing on one panel is how a border ends up red
    // while the sentence beside it still says there is time. The view is the one
    // source; this fixture is deliberately inconsistent to prove the element is
    // not quietly recomputing from the seconds.
    const element = await mount(withClock(at(85), { urgency: 'calm' }));

    expect(deepText(element)).toContain(urgencySentence('calm'));
    expect(deepText(element)).not.toContain(urgencySentence('critical'));
  });

  it('shows no time left rather than counting past the deadline', async () => {
    // The domain clamps, so this view is patched to what a clock skew would
    // produce. "-0:03 left" reads as three seconds of credit.
    const element = await mount(withClock(at(95), { secondsRemaining: -3 }));

    expect(deepText(element)).toContain('0:00');
    expect(deepText(element)).not.toContain('-0');
  });

  it('names the weight the table takes if nothing is handed in', async () => {
    // §14.1's automatic fallback. The fixture's minimum progression is one
    // kilogram, so a made opener of 180 has 181 waiting behind it.
    const element = await mount(at(95));
    expect(deepText(element)).toContain('181');
    expect(deepText(element)).toContain('If nothing is handed in');
  });

  it('says no automatic weight applies rather than leaving the line off', async () => {
    // A missing line reads as "there is no penalty". This is the branch where
    // the rules have nothing to apply, and it is a different sentence.
    const element = await mount({ ...at(30), automatic: null });
    expect(deepText(element)).toContain('no automatic weight');
  });

  it('says the official clock is the one that counts', async () => {
    // On the panel, not in a fold. The tool's minute starts when the result is
    // recorded here, which is already late by however long it took to reach the
    // phone, so a countdown with no such line on it is read as the deadline.
    const element = await mount(at(0));
    expect(deepText(element)).toContain(OFFICIAL_CLOCK_NOTE);
  });

  it('reports the attempt when the lifter marks it handed in', async () => {
    const seen = watch();
    const element = await mount(handedInWithNoMark());

    nativeButton(markButton(element)).click();

    expect(seen).toEqual([{ attemptId: 'lifter-1-squat-2' }]);
  });

  it('will not report an attempt that has already been marked', async () => {
    // The listener is on the `ptk-button` host, so a press landing on the host's
    // own box runs it whatever the inner button's disabled state -- a real thumb
    // near the padding. Reporting twice marks an attempt the lifter pressed once.
    const seen = watch();
    const element = await mount(handedIn());

    markButton(element).click();

    expect(seen).toEqual([]);
  });

  it('will not report an attempt with no weight on it', async () => {
    const seen = watch();
    const element = await mount(at(0));

    markButton(element).click();

    expect(seen).toEqual([]);
  });

  it('says it has been marked in words, not only by disabling the button', async () => {
    // The two states have to read differently, which is the assertion that bites:
    // comparing the line against `submissionStatusText(true)` alone measures
    // nothing, because pinning that function to one string moves the expected
    // value with the code and the test goes on passing. A spent button and a
    // greyed one look the same to a lifter and identical to a screen reader.
    const marked = await mount(handedIn());
    const unmarked = await mount(handedInWithNoMark());

    expect(statusLine(marked)).toBe(submissionStatusText(true));
    expect(statusLine(unmarked)).toBe(submissionStatusText(false));
    expect(statusLine(marked)).not.toBe(statusLine(unmarked));
    expect(nativeButton(markButton(marked)).disabled).toBe(true);
  });

  it('labels the control as marking rather than as submitting', async () => {
    // §14: the application does not submit attempts to meet officials. A button
    // reading "Submit" names an action the tool cannot take, on the one screen
    // where being believed costs an attempt.
    const element = await mount(handedInWithNoMark());
    const label = deepText(markButton(element));

    expect(label).toContain(MARK_SUBMITTED_LABEL);
    expect(label.toLowerCase()).not.toContain('submit to');
  });

  it('buzzes once when the band escalates, not once per repaint', async () => {
    // The view arrives four times a second. A phone that buzzed on every one of
    // them would be a continuous buzz for a whole minute rather than a signal.
    const { felt, patch } = recordBuzzes();
    const element = await mount(at(0), patch);

    element.submission = at(65);
    await element.updateComplete;
    element.submission = at(66);
    await element.updateComplete;
    element.submission = at(67);
    await element.updateComplete;

    expect(felt).toHaveLength(1);
  });

  it('does not buzz on a panel with no deadline on it', async () => {
    // There is no escalation to announce. A buzz here is the pocket saying the
    // deadline moved when no deadline is running -- the one signal on this screen
    // a lifter acts on without looking at it.
    const { felt, patch } = recordBuzzes();
    const element = await mount(OPENER_OWED, patch);

    element.submission = { ...OPENER_OWED };
    await element.updateComplete;

    expect(felt).toEqual([]);

    // The control: the same element does buzz once a clock arrives, so the
    // silence above is the missing clock and not a port wired to nothing.
    element.submission = at(65);
    await element.updateComplete;
    expect(felt).toHaveLength(1);
  });

  it('buzzes again at each further escalation', async () => {
    const { felt, patch } = recordBuzzes();
    const element = await mount(at(0), patch);

    for (const seconds of [65, 85, 95]) {
      element.submission = at(seconds);
      await element.updateComplete;
    }

    expect(felt).toHaveLength(3);
  });

  it('does not buzz at the top of the minute', async () => {
    // A buzz on the calm band fires on every attempt of the meet and teaches the
    // lifter to ignore the two that mean something.
    const { felt, patch } = recordBuzzes();
    await mount(at(0), patch);

    expect(felt).toEqual([]);
  });

  it('does not buzz once the weight is with the table', async () => {
    // Nothing left to do about the clock. Buzzing a lifter who has already
    // walked the weight up is telling them to hurry at something finished.
    const { felt, patch } = recordBuzzes();
    const element = await mount(handedIn(), patch);

    element.submission = withClock(handedIn(), { secondsRemaining: 5, urgency: 'critical' });
    await element.updateComplete;

    expect(felt).toEqual([]);
  });

  it('buzzes for the next attempt after having buzzed for this one', async () => {
    // The guard is per attempt, not per element. Without the reset a lifter gets
    // one warning for the whole meet -- and it is the first attempt that gets it.
    const { felt, patch } = recordBuzzes();
    const element = await mount(at(65), patch);
    expect(felt).toHaveLength(1);

    element.submission = { ...at(65), attemptId: 'lifter-1-squat-3' };
    await element.updateComplete;

    expect(felt).toHaveLength(2);
  });

  it('marks a pound figure as coming off the chart', async () => {
    // §16. 190 is a chart row in the fixture, and the reading beside an attempt
    // is the federation's published figure or is labelled approximate -- never a
    // silent conversion.
    const element = await mount(handedIn());
    expect(deepText(element)).toContain('on the chart');
  });

  it('fits a 320px column and has no axe violations', async () => {
    // §5.7's floor, measured on the lapsed panel because it is the widest: the
    // automatic sentence names a weight and the band sentence is on screen at
    // the same time.
    const column = document.createElement('div');
    column.style.width = '320px';
    document.body.append(column);
    teardown.push(() => {
      column.remove();
    });

    const element = document.createElement('ptk-submission-countdown');
    element.submission = at(95);
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
