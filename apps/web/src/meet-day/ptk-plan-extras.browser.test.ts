// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §8's fold, and the sentence that has to be true while it is shut.
 *
 * Most of this file is about the summary, because the summary is the only part of
 * this element a lifter is guaranteed to read. Several of the answers behind the
 * fold move the data-confidence grade the plan screen prints, so one left out of
 * the summary is a grade resting on something the lifter cannot see -- and that
 * failure is invisible in every other test, since the field, the session and the
 * grade are all correct. Only the sentence is wrong.
 *
 * The other half is about fields that are *absent*. Guided Estimate has already
 * asked where the figure came from and §7.3 and §7.5 have already asked for the
 * ceiling; asking again invites two answers that disagree, and the derived one
 * wins either way, so the second control would visibly respond and change
 * nothing. Both are asserted here rather than in `plan.test.ts` because both are
 * decisions about what is rendered.
 *
 * A real browser for the usual reason (§5.8): every answer leaves a control's own
 * shadow tree as a composed event, and a root reading `event.target` rather than
 * `composedPath()` would see the host with an empty dataset.
 */
import { CHOICE_CHANGE_EVENT, PtkDisclosure, type ChoiceChangeDetail } from '@platform-toolkit/ui';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  BODYWEIGHT_FIELD,
  CEILING_FIELD,
  COMPARISON_FIELD,
  EVIDENCE_AGE_FIELD,
  MAXIMUM_SOURCE_FIELD,
  OPENER_TESTED_FIELD,
  PERSONAL_RECORD_FIELD,
  READINESS_FIELD,
} from './fields.js';
import { PROBABILITY_WORDS, acrossLifts, guidedSet, plannerSession } from './planner-fixture.js';
import { withExtras, withFigures, withTargets, type PlannerSession } from './session.js';
import type { PtkPlanExtras } from './ptk-plan-extras.js';
import './ptk-plan-extras.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  session: PlannerSession = plannerSession(),
  within?: HTMLElement,
): Promise<PtkPlanExtras> {
  const element = document.createElement('ptk-plan-extras');
  element.session = session;
  (within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * The fold's own element, narrowed rather than asserted.
 *
 * `querySelector<T>` would hand back `null` typed as a disclosure and fail three
 * lines later as a missing property, which is a worse error than this one.
 */
function fold(element: PtkPlanExtras): PtkDisclosure {
  const found = element.shadowRoot?.querySelector('ptk-disclosure');
  if (!(found instanceof PtkDisclosure)) throw new Error('The fold did not render.');
  return found;
}

/** What the lifter reads without opening anything. */
function summaryOf(element: PtkPlanExtras): string {
  return fold(element).summary;
}

/**
 * Unfolds the section, for the tests that measure or examine what is inside.
 *
 * Set on the disclosure rather than pressed, deliberately: `<details>` fires
 * `toggle` asynchronously (§5.8), so a press followed by an assertion on the same
 * tick reads the previous state. Nothing here is testing `ptk-disclosure`.
 */
async function open(element: PtkPlanExtras): Promise<PtkPlanExtras> {
  fold(element).open = true;
  await element.updateComplete;
  return element;
}

/** Every `data-field` on screen, in document order. */
function fieldsOn(element: PtkPlanExtras): string[] {
  return [...(element.shadowRoot?.querySelectorAll('[data-field]') ?? [])].flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

/** The fields asked against one lift, which is the second axis these carry. */
function fieldsFor(element: PtkPlanExtras, lift: string): string[] {
  return [
    ...(element.shadowRoot?.querySelectorAll(`[data-field][data-lift="${lift}"]`) ?? []),
  ].flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

/** Answers a choice question by clicking the radio, the way a lifter does. */
async function choose(element: PtkPlanExtras, selector: string, value: string): Promise<void> {
  const host = element.shadowRoot?.querySelector(selector);
  const radio = [...(host?.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}" matching "${selector}".`);
  radio.click();
  await element.updateComplete;
}

/**
 * Records answers from outside the element, with both tags the root routes on.
 *
 * On `document.body`, not on the element: what is being proved is that the event
 * crossed the shadow boundary carrying tags a root can read, and a listener on
 * the element itself would pass without either.
 */
function watch(): { field: string | null; lift: string | null; value: string }[] {
  const seen: { field: string | null; lift: string | null; value: string }[] = [];
  const listener = (event: CustomEvent<ChoiceChangeDetail>): void => {
    seen.push({
      field: tagOf(event, 'field'),
      lift: tagOf(event, 'lift'),
      value: event.detail.value,
    });
  };
  document.body.addEventListener(CHOICE_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(CHOICE_CHANGE_EVENT, listener);
  });
  return seen;
}

/** The same walk the root does: the nearest tag of that name on the composed path. */
function tagOf(event: Event, name: string): string | null {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset[name] !== undefined) {
      return target.dataset[name] ?? null;
    }
  }
  return null;
}

describe('ptk-plan-extras', () => {
  it('re-renders when the session is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating.
    const element = await mount();
    expect(summaryOf(element)).toContain('Nothing added');

    element.session = withExtras(element.session, { readiness: 'reduced' });
    await element.updateComplete;

    expect(summaryOf(element)).toBe('Added: reduced readiness.');
  });

  it('names what is unstated when nothing has been added', async () => {
    // Not just "optional". A fold labelled "improve my plan" with an empty
    // summary reads as a refinement nobody needs; naming readiness and evidence
    // says what the plan below is currently assuming.
    expect(summaryOf(await mount())).toBe(
      'Nothing added. Readiness, equipment, jump limits and how well evidenced your maximum is are all unstated.',
    );
  });

  it('names every answer that moves something, and nothing that does not', async () => {
    const element = await mount(
      withExtras(plannerSession(), {
        bodyweight: '92.5',
        equipment: 'raw',
        readiness: 'reduced',
        evidenceAge: 'within-eight-weeks',
      }),
    );

    // The age, the meet count, the jump limits and the comparison are all still
    // on their opening values, and naming those would make the sentence longest
    // exactly when the least had been said.
    expect(summaryOf(element)).toBe(
      'Added: bodyweight, raw, reduced readiness, evidence from the last eight weeks.',
    );
  });

  it('counts a per-lift figure and a total, without listing every one of them', async () => {
    // Twelve fields between them, and the summary has one line. What a lifter
    // needs to know while it is shut is that figures were given, not which.
    const element = await mount(
      withTargets(acrossLifts(plannerSession(), { personalRecord: '195' }), {
        qualifyingTotal: '520',
      }),
    );

    expect(summaryOf(element)).toBe('Added: totals to measure against, lift-by-lift figures.');
  });

  it('does not count a figure typed against a lift this meet does not contest', async () => {
    // `figures` is keyed by every platform lift so a format correction cannot
    // delete a squat somebody typed. A summary reading the whole record would
    // announce a squat figure at a push/pull meet, where there is no squat --
    // and the lifter would open the fold to find nothing that says it.
    const kept = withFigures(plannerSession({ format: 'push-pull' }), 'squat', {
      personalRecord: '195',
    });
    expect(summaryOf(await mount(kept))).toContain('Nothing added');

    const contested = withFigures(kept, 'bench', { personalRecord: '140' });
    expect(summaryOf(await mount(contested))).toContain('lift-by-lift figures');
  });

  it('still names the evidence under Guided Estimate, where it is not asked', async () => {
    // The fields are gone because the set already answered them. The answers are
    // still true and still move the grade, and a summary that went quiet when the
    // fields disappeared would say the question had stopped mattering.
    const element = await mount(
      withExtras(
        acrossLifts(plannerSession({ method: 'guided-estimate' }), { guided: guidedSet() }),
        { evidenceAge: 'within-eight-weeks' },
      ),
    );

    expect(fieldsOn(element)).not.toContain(EVIDENCE_AGE_FIELD);
    expect(fieldsOn(element)).not.toContain(MAXIMUM_SOURCE_FIELD);
    expect(summaryOf(element)).toContain('evidence from the last eight weeks');
  });

  it('asks where the figure came from under every method that does not derive it', async () => {
    for (const method of ['expected-max', 'known-opener', 'manual', 'target-total'] as const) {
      const fields = fieldsOn(await mount(plannerSession({ method })));
      expect(fields).toContain(MAXIMUM_SOURCE_FIELD);
      expect(fields).toContain(EVIDENCE_AGE_FIELD);
    }
  });

  it('leaves the ceiling to §7 under the two methods that take it as input', async () => {
    // One ceiling per lift. Two fields would let a lifter answer one and watch
    // the other contradict it, with neither saying which won.
    for (const method of ['known-opener', 'target-total'] as const) {
      expect(fieldsFor(await mount(plannerSession({ method })), 'squat')).not.toContain(
        CEILING_FIELD,
      );
    }
  });

  it('asks for the ceiling here under the methods that do not', async () => {
    for (const method of ['expected-max', 'guided-estimate', 'manual'] as const) {
      expect(fieldsFor(await mount(plannerSession({ method })), 'squat')).toContain(CEILING_FIELD);
    }
  });

  it('asks the per-lift questions only about the lifts the meet contests', async () => {
    const element = await mount(plannerSession({ format: 'push-pull' }));

    expect(fieldsFor(element, 'squat')).toEqual([]);
    expect(fieldsFor(element, 'bench')).toEqual([
      PERSONAL_RECORD_FIELD,
      CEILING_FIELD,
      OPENER_TESTED_FIELD,
    ]);
  });

  it('reports a session-wide answer out of the shadow root, tagged with its field', async () => {
    const element = await open(await mount());
    const seen = watch();

    await choose(element, `ptk-choice-group[data-field="${READINESS_FIELD}"]`, 'reduced');

    // No lift: readiness is a fact about the day, not about a lift, and a root
    // that found one would write it three times.
    expect(seen).toEqual([{ field: READINESS_FIELD, lift: null, value: 'reduced' }]);
  });

  it('reports a per-lift answer tagged with the lift as well as the field', async () => {
    const element = await open(await mount());
    const seen = watch();

    await choose(
      element,
      `ptk-choice-group[data-field="${OPENER_TESTED_FIELD}"][data-lift="deadlift"]`,
      'yes',
    );

    expect(seen).toEqual([{ field: OPENER_TESTED_FIELD, lift: 'deadlift', value: 'yes' }]);
  });

  it('keeps an unreadable figure on screen and says what is wrong with it', async () => {
    // A lifter cannot correct a value the tool has thrown away.
    const element = await open(await mount(withExtras(plannerSession(), { bodyweight: '92,5' })));
    const input = element.shadowRoot
      ?.querySelector(`ptk-number-field[data-field="${BODYWEIGHT_FIELD}"]`)
      ?.shadowRoot?.querySelector('input');

    expect(input?.value).toBe('92,5');
    expect(deepText(element)).toContain('Enter a weight using digits');
  });

  it('says the federation minimum still applies under a custom jump limit', async () => {
    // The one thing a lifter could reasonably expect these fields to do and they
    // must not: a smallest jump below the rule book cannot make an illegal
    // attempt legal, and a field that looked like it could would be read as one.
    expect(deepText(await open(await mount()))).toContain(
      'A smallest jump below it cannot make an illegal attempt legal.',
    );
  });

  it('offers the comparison as a choice about the research, not about the lifter', async () => {
    // §8.2. It is optional, it has nothing to do with the category anybody
    // competes in, and declining is a real answer that costs precision.
    const element = await open(await mount());
    const text = deepText(element);

    expect(fieldsOn(element)).toContain(COMPARISON_FIELD);
    expect(text).toContain('Draw the jump warnings from');
    expect(text).toContain('it is nothing to do with the category you compete in');
  });

  it('says nothing about how likely an attempt is', async () => {
    // §10.2. This fold is where a lifter says the day is going badly, which is
    // the most tempting place in the tool to answer with a number.
    const text = deepText(await open(await mount())).toLowerCase();

    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('has no accessibility violations with the fold open', async () => {
    const element = await open(await mount());
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column while folded, with the longest summary', async () => {
    // The summary is one sentence in a row with a chevron, and this is the state
    // that says whether it wraps inside the row or pushes the chevron off the end.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount(
      withExtras(plannerSession(), {
        bodyweight: '92.5',
        age: '34',
        priorMeets: '6',
        equipment: 'single-ply',
        readiness: 'uncertain',
        hardCut: 'yes',
        minimumJump: '2.5',
        maximumJump: '15',
        comparison: 'female',
        maximumSource: 'competition-single',
        evidenceAge: 'within-six-months',
      }),
      frame,
    );

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('fits a phone-width column with the fold open', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await open(await mount(plannerSession(), frame));

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
