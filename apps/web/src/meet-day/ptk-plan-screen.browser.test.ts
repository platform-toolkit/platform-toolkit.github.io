// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The plan, and the four rules about it that are rules about wording.
 *
 * Most of this file is prose assertions, which is unusual for a component test
 * and is the point: this element decides almost nothing, so the way it fails is
 * by *saying* something. §10 forbids fusing the two axes, §10.2 forbids a
 * probability, §16 forbids computing a pound figure beside an attempt, and §9
 * forbids presenting a planned third as a commitment. Every one of those is a
 * screen that renders correctly and reads wrongly, so a test that only checked
 * structure would pass through all four.
 *
 * A real browser rather than a DOM shim for the usual reason (§5.8): every
 * sentence worth asserting on is inside a `ptk-notice`'s own shadow root, so a
 * host-level `textContent` reads back empty -- which fails a `toContain` for the
 * wrong reason and, far worse, passes a `not.toContain` while measuring nothing.
 * `deepText` crosses the boundaries; the probability sweep below is exactly the
 * assertion that would otherwise be vacuous.
 *
 * Every view here comes out of `buildPlan`, so no test can assert against a plan
 * the rules would refuse -- which matters more here than anywhere else in this
 * tool, because a hand-written view could pair a Secure label with a weight above
 * the lifter's maximum and nothing on screen would look wrong.
 */
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import {
  CHARTED_CONTEXT,
  PROBABILITY_WORDS,
  acrossLifts,
  confirmAll,
  guidedSet,
  plannerSession,
  viewFor,
} from './planner-fixture.js';
import type { PlanContext } from './plan.js';
import { withExtras, withTargetTotal, type PlannerSession } from './session.js';
import type { PtkPlanScreen } from './ptk-plan-screen.js';
import './ptk-plan-screen.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * Mounts the element on a session, with the plan that session actually produces.
 *
 * The view is derived rather than taken as an argument, so no test can hand the
 * element a pair that disagrees. Every figure on this screen comes from the view
 * and every unit from the session, and a mismatched pair is the one bug that
 * would put a plausible wrong number in front of a lifter.
 */
async function mount(
  session: PlannerSession = plannerSession(),
  options: { readonly within?: HTMLElement; readonly context?: PlanContext } = {},
): Promise<PtkPlanScreen> {
  const element = document.createElement('ptk-plan-screen');
  element.session = session;
  element.view = viewFor(session, options.context);
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Expected Max, agreed to: the plan almost every test below is a variation on. */
function planned(): PlannerSession {
  return confirmAll(acrossLifts(plannerSession(), { expectedMaximum: '200' }));
}

/** Typed attempts against a volunteered maximum, which is what puts risk on them. */
function typedAttempts(attempts: readonly [string, string, string]): PlannerSession {
  return acrossLifts(plannerSession({ method: 'manual' }), {
    attempts: [...attempts],
    expectedMaximum: '200',
  });
}

/** One lift's section, so an assertion about the squat cannot be met by the bench. */
function liftSection(element: PtkPlanScreen, lift: string): HTMLElement {
  const found = element.shadowRoot?.querySelector(`[data-lift="${lift}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No section for the ${lift}.`);
  return found;
}

/** One attempt's row within a lift, which is the only place a risk word may appear. */
function attemptRow(element: PtkPlanScreen, lift: string, attemptNumber: number): HTMLElement {
  const found = liftSection(element, lift).querySelector(`[data-attempt="${attemptNumber}"]`);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`No attempt ${attemptNumber} for the ${lift}.`);
  }
  return found;
}

/** The risk word rendered on one attempt, or `null` when the chip is absent. */
function riskOn(element: PtkPlanScreen, lift: string, attemptNumber: number): string | null {
  const chip = attemptRow(element, lift, attemptNumber).querySelector('.risk');
  return chip === null ? null : chip.textContent.trim();
}

/** How many times a sentence appears, so "said once" can be told from "said at all". */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('ptk-plan-screen', () => {
  it('re-renders when either input is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating --
    // which on this element means a lifter reading yesterday's attempts.
    //
    // The two are replaced in separate steps on purpose. Assigning both at once
    // is what a caller does and is exactly what makes this vacuous: either
    // property being reactive re-renders the element, and the render reads the
    // other one whether or not Lit is watching it. So a decorator dropped from
    // `view` survived that version of this test, which is the half that matters
    // most -- `view` is where every figure on the screen comes from.
    const element = await mount();
    expect(deepText(element)).toContain('Nothing planned yet');

    element.view = viewFor(planned());
    await element.updateComplete;

    expect(deepText(element)).not.toContain('Nothing planned yet');
    expect(deepText(element)).toContain('Opener 182 kg');

    // The unit alone, which is a real move rather than a contrivance: the session
    // is read for the display unit and for nothing else, so the same plan in
    // pounds is the same plan. The attempt stays in kilograms (§16) and the
    // subtotal follows the lifter.
    element.session = plannerSession({ unit: 'lb' });
    await element.updateComplete;

    expect(deepText(element)).toContain('Opener 182 kg');
    expect(deepText(element)).toContain('All three: 1265.45 lb.');
  });

  it('names the three attempts and the weights the domain planned', async () => {
    const element = await mount(planned());
    const squat = deepText(liftSection(element, 'squat'));

    expect(squat).toContain('Opener 182 kg');
    expect(squat).toContain('Second attempt 192 kg');
    expect(squat).toContain('Third attempt 200 kg');
  });

  it('writes an attempt in kilograms even when the lifter is typing in pounds', async () => {
    // §16: kilograms are the attempt and pounds are a reading. The session below
    // is answered entirely in pounds -- 440 lb -- and the card still has to say
    // what goes on the bar.
    const element = await mount(
      confirmAll(acrossLifts(plannerSession({ unit: 'lb' }), { expectedMaximum: '440' })),
    );
    const squat = deepText(liftSection(element, 'squat'));

    // The positive control: the unit *is* being honoured everywhere it applies,
    // because the maximum above the attempts and the subtotal below them are both
    // in pounds. Without it the kilogram assertion would pass just as well on an
    // element that ignored the session entirely and wrote kilograms throughout.
    expect(squat).toContain('Opener 181.5 kg');
    expect(squat).toContain('Planned from 440 lb.');
    expect(squat).toContain('All three: 1262.15 lb.');
  });

  it('reads an attempt’s pound figure off the chart rather than converting it', async () => {
    // The whole of §16 in one assertion. The fixture chart publishes 180 kg as
    // 396.9 lb; the arithmetic gives 396.83. An element that converted would
    // print the second figure and look entirely correct doing it.
    const element = await mount(typedAttempts(['180', '195', '215']), {
      context: CHARTED_CONTEXT,
    });
    const squat = deepText(liftSection(element, 'squat'));

    expect(squat).toContain('396.9 lb on the chart');
    expect(squat).not.toContain('396.83');
  });

  it('says once per lift why the pound figures are approximate', async () => {
    // No chart loaded, which is the state the site opens in. The sentence is one
    // fact about the read rather than about an attempt, so three copies under one
    // lift -- nine on a full-power screen -- would bury the plan in its own
    // caveat.
    const element = await mount(planned());
    const squat = deepText(liftSection(element, 'squat'));

    expect(occurrences(squat, 'No published pound chart is loaded')).toBe(1);
    // The positive control: three attempts really are on screen, each with its
    // own approximate reading, so the count above is a deduplication rather than
    // an element that rendered one attempt.
    expect(occurrences(squat, 'about ')).toBe(3);
  });

  it('quotes the chart where it has a row and hedges where it does not', async () => {
    // A published chart is coarser than the bar, so an ordinary plan straddles
    // it: 182 and 192 kg are between rows, 200 kg is on one. Reading the reason
    // off the first attempt and calling it the lift's would explain the wrong
    // absence.
    const element = await mount(planned(), { context: CHARTED_CONTEXT });
    const squat = deepText(liftSection(element, 'squat'));

    expect(squat).toContain('440.9 lb on the chart');
    expect(squat).toContain('The federation chart has no row for this weight.');
    expect(occurrences(squat, 'The federation chart has no row for this weight.')).toBe(1);
    expect(squat).not.toContain('No published pound chart is loaded');
  });

  it('labels each attempt with one of §10.2’s four words', async () => {
    const element = await mount(typedAttempts(['180', '195', '215']));

    expect(riskOn(element, 'squat', 1)).toBe('Recommended');
    expect(riskOn(element, 'squat', 2)).toBe('Push');
    expect(riskOn(element, 'squat', 3)).toBe('Long shot');
  });

  it('leaves the risk chip off when there is nothing to grade against', async () => {
    // Manual entry with no volunteered maximum. `classifyAttemptRisk` is total
    // and grades a missing maximum as a Long Shot, which is right for the domain
    // and a fabricated warning on a screen.
    const element = await mount(
      acrossLifts(plannerSession({ method: 'manual' }), { attempts: ['180', '195', '215'] }),
    );

    expect(riskOn(element, 'squat', 1)).toBeNull();
    expect(riskOn(element, 'squat', 3)).toBeNull();
    // The positive control: the attempts rendered, so the nulls above are a
    // missing chip rather than a missing plan.
    expect(deepText(liftSection(element, 'squat'))).toContain('Third attempt 215 kg');
  });

  it('states a refusal under the attempt that broke the rule', async () => {
    // Half a kilogram over the opener, against the fixture federation's
    // one-kilogram minimum progression. The weight stays where the lifter put it
    // and the rule is stated -- §15.1: this tool checks an attempt and never
    // submits one, so it has no business moving it.
    const element = await mount(
      acrossLifts(plannerSession({ method: 'manual' }), { attempts: ['180', '180.5', '190'] }),
    );

    expect(deepText(attemptRow(element, 'squat', 2))).toContain(
      'This is not far enough above the attempt before it.',
    );
    expect(deepText(attemptRow(element, 'squat', 1))).not.toContain('not far enough above');
  });

  it('names the direction rounding moved a weight', async () => {
    // §5.5 makes the direction a safety property, so the note has to carry it:
    // "down" beside a weight that went up is worse than no note at all.
    const element = await mount(
      confirmAll(
        withTargetTotal(
          acrossLifts(plannerSession({ method: 'target-total' }), {
            expectedMaximum: '200',
            ceiling: '225',
          }),
          '540',
        ),
      ),
    );

    expect(deepText(attemptRow(element, 'squat', 1))).toContain(
      'Rounded down from 163.8 kg to 163.5 kg',
    );
    expect(deepText(attemptRow(element, 'squat', 2))).toContain(
      'Rounded up from 172.8 kg to 173 kg',
    );
  });

  it('carries what a jump warning was measured on, with every warning', async () => {
    // §9.3 requires the caveat whether or not the lifter is in the dataset, and
    // this lift raises two warnings -- so a footnote said once for the lift would
    // apply one grade of evidence to two claims that need not share it.
    const element = await mount(
      confirmAll(
        withExtras(acrossLifts(plannerSession(), { expectedMaximum: '250' }), {
          comparison: 'female',
        }),
      ),
    );
    const squat = deepText(liftSection(element, 'squat'));

    expect(squat).toContain('A 12.5 kg first to second jump is above the 10 kg');
    expect(squat).toContain('A 10 kg second to third jump is above the 8 kg');
    expect(occurrences(squat, 'Treat it as general guidance')).toBe(2);
  });

  it('grades data confidence under its own heading, with every reason', async () => {
    // Not only the binding one: the list doubles as the answer to "what would I
    // have to do to improve this?", and a lifter shown one ceiling fixes it and
    // is graded the same way again.
    const element = await mount(planned());
    const squat = deepText(liftSection(element, 'squat'));

    expect(squat).toContain('Data confidence Low');
    expect(squat).toContain('Where the maximum came from was not recorded.');
    expect(squat).toContain('Readiness for meet day was not recorded.');
  });

  it('moves the confidence grade without moving a risk word', async () => {
    // §10's two axes, proven apart rather than asserted apart. The two sessions
    // differ only in how well described the lifter is; the three risk words are
    // identical and the grade is not.
    const thin = await mount(planned());
    const described = await mount(
      confirmAll(
        withExtras(
          acrossLifts(plannerSession({ method: 'guided-estimate' }), {
            guided: guidedSet({ reps: '1', repsInReserve: 0 }),
            openerTested: 'yes',
          }),
          { readiness: 'normal', priorMeets: '4' },
        ),
      ),
    );

    expect(deepText(liftSection(thin, 'squat'))).toContain('Data confidence Low');
    expect(deepText(liftSection(described, 'squat'))).toContain('Data confidence High');
    for (const attemptNumber of [1, 2, 3]) {
      expect(riskOn(thin, 'squat', attemptNumber)).toBe('Recommended');
      expect(riskOn(described, 'squat', attemptNumber)).toBe('Recommended');
    }
  });

  it('keeps a grade out of the attempt rows and a risk word out of the grade', async () => {
    // The structural half of §10. The rule is broken on a screen not by writing a
    // formula but by putting the two words next to each other and letting a
    // reader average them, so no attempt row may carry a grade and the confidence
    // block may carry no risk word.
    const element = await mount(typedAttempts(['180', '195', '215']));
    const confidence = liftSection(element, 'squat').querySelector('section');
    const confidenceText = confidence === null ? '' : deepText(confidence);

    for (const attemptNumber of [1, 2, 3]) {
      expect(deepText(attemptRow(element, 'squat', attemptNumber))).not.toContain(
        'Data confidence',
      );
    }
    // The positive control on both halves: the grade is on screen somewhere, and
    // the words the block must not contain are words this plan really produced.
    expect(confidenceText).toContain('Data confidence');
    expect(confidenceText).not.toContain('Long shot');
    expect(riskOn(element, 'squat', 3)).toBe('Long shot');
  });

  it('explains both axes without asking the reader to open anything', async () => {
    // The misreading these two paragraphs prevent is committed by a lifter who
    // scans the plan and never opens anything, so a fold would hide the text from
    // exactly its audience.
    const element = await mount(planned());

    expect(element.shadowRoot?.querySelector('ptk-disclosure')).toBeNull();
    expect(deepText(element)).toContain('It is not a statement about whether the lift will be');
    expect(deepText(element)).toContain('grades how well described you are, not how good the plan');
  });

  it('says nothing about how likely an attempt is', async () => {
    // §10.2. This screen is where a probability would be most welcome and most
    // wrong: four risk words, three grades, and a lifter who wants one number.
    const element = await mount(typedAttempts(['180', '195', '215']));
    const text = deepText(element).toLowerCase();

    // The positive control: the sweep is reading real content, so a banned word
    // that appeared really would be found.
    expect(text).toContain('long shot');
    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('presents the planned third as a scenario rather than a commitment', async () => {
    const element = await mount(planned());

    expect(deepText(attemptRow(element, 'squat', 3))).toContain('A scenario, not a commitment.');
    expect(deepText(attemptRow(element, 'squat', 1))).not.toContain('A scenario');
    expect(deepText(element)).toContain('treat this as the top of the range rather than the plan');
  });

  it('says a lift is waiting rather than warning about an unanswered form', async () => {
    const element = await mount();

    expect(deepText(liftSection(element, 'squat'))).toContain(
      'Nothing planned yet. Fill in the figures above and this fills in with you.',
    );
    expect(element.shadowRoot?.querySelectorAll('[data-attempt]')).toHaveLength(0);
  });

  it('names the figure it is waiting to be agreed to', async () => {
    // §7's gate. A lift that rendered nothing here would read as a lift the tool
    // had forgotten, which is the reading that gets the tick left unticked.
    const element = await mount(acrossLifts(plannerSession(), { expectedMaximum: '200' }));

    expect(deepText(liftSection(element, 'squat'))).toContain(
      'Planned from 200 kg once you agree to it above. Nothing below is settled until then.',
    );
    expect(element.shadowRoot?.querySelectorAll('[data-attempt]')).toHaveLength(0);
  });

  it('states a target the ceilings cannot reach as a figure, not as an implication', async () => {
    // §7.5. Three subtotals a lifter has to add up is not a statement that the
    // target is out of reach, and the strong advisories say why wanting a total
    // is not evidence the lifts are there.
    const element = await mount(
      confirmAll(
        withTargetTotal(
          acrossLifts(plannerSession({ method: 'target-total' }), {
            expectedMaximum: '200',
            ceiling: '205',
          }),
          '700',
        ),
      ),
    );
    const text = deepText(element);

    expect(text).toContain('Target total: 700 kg');
    expect(text).toContain('The ceilings leave the plan 85 kg short of the target.');
    expect(text).toContain('Wanting a total is not evidence that the lifts behind it are there');
    expect(
      [...(element.shadowRoot?.querySelectorAll('ptk-notice[tone="error"]') ?? [])].length,
    ).toBeGreaterThan(0);
  });

  it('asks only about the lifts the meet contests', async () => {
    const element = await mount(
      confirmAll(acrossLifts(plannerSession({ format: 'push-pull' }), { expectedMaximum: '200' })),
    );

    expect(element.shadowRoot?.querySelector('[data-lift="squat"]')).toBeNull();
    expect(element.shadowRoot?.querySelector('[data-lift="bench"]')).not.toBeNull();
  });

  it('has no accessibility violations with a full plan on screen', async () => {
    const element = await mount(typedAttempts(['180', '195', '215']));
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with a full plan and its warnings', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount(
      confirmAll(
        withExtras(acrossLifts(plannerSession(), { expectedMaximum: '250' }), {
          comparison: 'female',
        }),
      ),
      { within: frame },
    );

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('fits a phone-width column with a target-total split on screen', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount(
      confirmAll(
        withTargetTotal(
          acrossLifts(plannerSession({ method: 'target-total' }), {
            expectedMaximum: '200',
            ceiling: '205',
          }),
          '700',
        ),
      ),
      { within: frame },
    );

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
