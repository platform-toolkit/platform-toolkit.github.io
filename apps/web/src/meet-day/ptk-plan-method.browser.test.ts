// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §7's five field sets, and the gate three of them end at.
 *
 * A real browser for two reasons. Every answer here leaves a control's own
 * shadow tree as a composed event carrying two tags -- the field and, because
 * these questions are asked once per lift, the lift -- and a root reading
 * `event.target` rather than `composedPath()` would see the host with an empty
 * dataset: controls that visibly respond while nothing is recorded (§5.8). And
 * the confirmation row's label is interpolated from a figure the domain computed,
 * so it is the one sentence on this screen that is wrong if the view and the
 * session disagree.
 *
 * Every session below is built with the tool's own transitions and every view
 * comes out of `buildPlan`, so no test here can assert against a state the tool
 * cannot reach -- which matters most for the confirmation, because a hand-written
 * view could show a ticked box beside a figure the rules would have refused.
 */
import { CHOICE_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-choice-group';
import { NUMBER_FIELD_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-number-field';
import {
  PtkToggleGroup,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui/ptk-toggle-group';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  ATTEMPT_FIELDS,
  CEILING_FIELD,
  CONFIRM_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  GUIDED_AGE_FIELD,
  GUIDED_EQUIPMENT_FIELD,
  GUIDED_REPS_FIELD,
  GUIDED_RESERVE_FIELD,
  GUIDED_STANDARD_FIELD,
  GUIDED_WEIGHT_FIELD,
  METHOD_FIELD,
  OPENER_FIELD,
  TARGET_TOTAL_FIELD,
} from './fields.js';
import {
  PROBABILITY_WORDS,
  acrossLifts,
  confirmAll,
  guidedSet,
  plannerSession,
  viewFor,
} from './planner-fixture.js';
import { withTargetTotal, type PlannerSession } from './session.js';
import { CONFIRM_VALUE, type PtkPlanMethod } from './ptk-plan-method.js';
import './ptk-plan-method.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * Mounts the element on a session, with the plan that session actually produces.
 *
 * The view is derived rather than taken as an argument so that no test can hand
 * the element a pair that disagrees. The one thing this element renders from the
 * view is the figure the lifter is asked to underwrite, and a mismatched pair is
 * exactly the bug that would put the wrong number in it.
 */
async function mount(
  session: PlannerSession = plannerSession(),
  within?: HTMLElement,
): Promise<PtkPlanMethod> {
  const element = document.createElement('ptk-plan-method');
  element.session = session;
  element.view = viewFor(session);
  (within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Every `data-field` on screen, in document order. */
function fieldsOn(element: PtkPlanMethod): string[] {
  return [...(element.shadowRoot?.querySelectorAll('[data-field]') ?? [])].flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

/** The fields asked against one lift, which is the second axis these carry. */
function fieldsFor(element: PtkPlanMethod, lift: string): string[] {
  return [
    ...(element.shadowRoot?.querySelectorAll(`[data-field][data-lift="${lift}"]`) ?? []),
  ].flatMap((control) => {
    const field = control.getAttribute('data-field');
    return field === null ? [] : [field];
  });
}

function confirmationFor(element: PtkPlanMethod, lift: string): PtkToggleGroup | null {
  const found = element.shadowRoot?.querySelector(
    `ptk-toggle-group[data-field="${CONFIRM_FIELD}"][data-lift="${lift}"]`,
  );
  return found instanceof PtkToggleGroup ? found : null;
}

/** Types into one of the number fields, keystroke and all. */
async function type(element: PtkPlanMethod, selector: string, text: string): Promise<void> {
  const input = element.shadowRoot?.querySelector(selector)?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No field matching "${selector}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/**
 * Records what left the element, with both tags the root routes on.
 *
 * On `document.body`, not on the element: what is being proved is that the event
 * crossed the shadow boundary carrying tags a root can read, and a listener on
 * the element itself would pass without either.
 */
function watch(eventName: string): { field: string | null; lift: string | null }[] {
  const seen: { field: string | null; lift: string | null }[] = [];
  const listener = (event: Event): void => {
    seen.push({ field: tagOf(event, 'field'), lift: tagOf(event, 'lift') });
  };
  document.body.addEventListener(eventName, listener);
  teardown.push(() => {
    document.body.removeEventListener(eventName, listener);
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

describe('ptk-plan-method', () => {
  it('re-renders when the session is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating.
    const element = await mount();
    expect(fieldsFor(element, 'squat')).toContain(EXPECTED_MAXIMUM_FIELD);

    element.session = plannerSession({ method: 'manual' });
    element.view = viewFor(element.session);
    await element.updateComplete;

    expect(fieldsFor(element, 'squat')).not.toContain(EXPECTED_MAXIMUM_FIELD);
  });

  it('asks for one figure per lift under Expected Max', async () => {
    const element = await mount();
    expect(fieldsFor(element, 'squat')).toEqual([EXPECTED_MAXIMUM_FIELD]);
    expect(fieldsFor(element, 'deadlift')).toEqual([EXPECTED_MAXIMUM_FIELD]);
  });

  it('carries §7.1’s warning about what the figure is not', async () => {
    // The default method, and its one input is the number a lifter is most
    // likely to overstate -- an old lifetime best, a touch-and-go bench for a
    // paused meet, or a figure they are hoping for.
    expect(deepText(await mount())).toContain('not a number you are hoping for');
  });

  it('asks §7.2’s six questions about the set, per lift', async () => {
    const element = await mount(plannerSession({ method: 'guided-estimate' }));

    // Order included: the set is described in the order somebody remembers it --
    // what was on the bar, how many went up, what was left, and then the three
    // questions about how much the set is worth as evidence.
    expect(fieldsFor(element, 'bench')).toEqual([
      GUIDED_WEIGHT_FIELD,
      GUIDED_REPS_FIELD,
      GUIDED_RESERVE_FIELD,
      GUIDED_STANDARD_FIELD,
      GUIDED_AGE_FIELD,
      GUIDED_EQUIPMENT_FIELD,
    ]);
  });

  it('asks for an opener and a ceiling under Known Opener', async () => {
    const element = await mount(plannerSession({ method: 'known-opener' }));
    expect(fieldsFor(element, 'squat')).toEqual([OPENER_FIELD, CEILING_FIELD]);
  });

  it('shows the arithmetic when the opener implies more than the ceiling', async () => {
    // §7.3's working, and the reason the method reports an implied maximum at
    // all: a lifter whose ceiling sits under what their opener implies would
    // otherwise get a plan that quietly ignored one of the two numbers they gave.
    // The figures are chosen so the note fires rather than assumed to: a 180 kg
    // opener is the Balanced band's 91%, so it implies just under 198 kg, and a
    // 195 kg ceiling sits below that while still leaving room for three legal
    // attempts. A tighter ceiling refuses the plan outright and renders a problem
    // instead, which would pass a looser assertion for the wrong reason.
    const element = await mount(
      acrossLifts(plannerSession({ method: 'known-opener' }), {
        opener: '180',
        ceiling: '195',
      }),
    );

    expect(deepText(element)).toContain('implies a meet-day maximum of');
  });

  it('asks for all three attempts under Manual', async () => {
    const element = await mount(plannerSession({ method: 'manual' }));
    expect(fieldsFor(element, 'deadlift')).toEqual([...ATTEMPT_FIELDS]);
  });

  it('asks for the target once for the meet, not once per lift', async () => {
    // §7.5's figure is a total, so it belongs above the lifts it divides between.
    // One per lift would be three fields for one answer.
    const element = await mount(plannerSession({ method: 'target-total' }));

    expect(fieldsOn(element).filter((field) => field === TARGET_TOTAL_FIELD)).toHaveLength(1);
    expect(fieldsFor(element, 'squat')).toEqual([EXPECTED_MAXIMUM_FIELD, CEILING_FIELD]);
  });

  it('asks for the ceiling here only where the method needs it as input', async () => {
    // There is one ceiling per lift and §8's fold asks for it everywhere else.
    // Two fields would let a lifter answer one and watch the other contradict it.
    for (const method of ['expected-max', 'guided-estimate', 'manual'] as const) {
      const element = await mount(plannerSession({ method }));
      expect(fieldsFor(element, 'squat')).not.toContain(CEILING_FIELD);
    }
  });

  it('offers no confirmation before there is a figure to agree to', async () => {
    // A tick beside an empty field asks the lifter to confirm nothing, and it
    // would stay ticked while they typed -- the one state this gate exists to
    // make impossible.
    expect(confirmationFor(await mount(), 'squat')).toBeNull();
  });

  it('names the figure the lifter is being asked to underwrite', async () => {
    const element = await mount(acrossLifts(plannerSession(), { expectedMaximum: '200' }));

    expect(deepText(element)).toContain('Plan the squat from 200 kg');
    expect(deepText(element)).toContain('Nothing is planned for this lift until this is ticked.');
  });

  it('writes that figure in the unit the lifter chose', async () => {
    // Not an attempt, so a conversion is the right answer here -- §16 gives an
    // attempt's pound reading to the federation's published chart instead, and
    // this row is a planning maximum rather than a weight anybody loads.
    const element = await mount(
      acrossLifts(plannerSession({ unit: 'lb' }), { expectedMaximum: '440' }),
    );

    expect(deepText(element)).toContain('Plan the squat from 440 lb');
  });

  it('offers no confirmation under the methods that estimate nothing', async () => {
    // Manual and Known Opener both start from weights the lifter chose, so there
    // is no figure of the tool's to underwrite.
    for (const method of ['manual', 'known-opener'] as const) {
      const element = await mount(
        acrossLifts(plannerSession({ method }), {
          attempts: ['180', '195', '205'],
          opener: '180',
          ceiling: '215',
        }),
      );
      expect(confirmationFor(element, 'squat')).toBeNull();
    }
  });

  it('reflects an agreed figure back into the tick', async () => {
    const element = await mount(
      confirmAll(acrossLifts(plannerSession(), { expectedMaximum: '200' })),
    );
    const box = confirmationFor(element, 'squat')?.shadowRoot?.querySelector('input');

    expect(box?.checked).toBe(true);
  });

  it('reports a typed figure out of the shadow root, tagged with field and lift', async () => {
    const element = await mount();
    const seen = watch(NUMBER_FIELD_CHANGE_EVENT);

    await type(
      element,
      `ptk-number-field[data-field="${EXPECTED_MAXIMUM_FIELD}"][data-lift="bench"]`,
      '140',
    );

    // The lift matters as much as the field: without it the root has three
    // identical questions and no way to tell which one was answered.
    expect(seen).toEqual([{ field: EXPECTED_MAXIMUM_FIELD, lift: 'bench' }]);
  });

  it('reports the method change itself, which is not tagged with a lift', async () => {
    const element = await mount();
    const seen = watch(CHOICE_CHANGE_EVENT);

    const radio = [
      ...(element.shadowRoot
        ?.querySelector(`ptk-choice-group[data-field="${METHOD_FIELD}"]`)
        ?.shadowRoot?.querySelectorAll('input') ?? []),
    ].find((input) => input.value === 'manual');
    radio?.click();
    await element.updateComplete;

    expect(seen).toEqual([{ field: METHOD_FIELD, lift: null }]);
  });

  it('reports the whole confirmation selection rather than the box that moved', async () => {
    const element = await mount(acrossLifts(plannerSession(), { expectedMaximum: '200' }));
    const seen: ToggleGroupChangeDetail[] = [];
    const listener = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
    });

    confirmationFor(element, 'squat')?.shadowRoot?.querySelector('input')?.click();
    await element.updateComplete;

    expect(seen.at(-1)?.values).toEqual([CONFIRM_VALUE]);
  });

  it('states a refusal under the lift and keeps what was typed', async () => {
    // A lifter cannot correct a value the tool has thrown away, so the field
    // holds `19o` and the sentence explains it rather than replacing the form.
    const element = await mount(acrossLifts(plannerSession(), { expectedMaximum: '19o' }));
    const input = element.shadowRoot
      ?.querySelector(`ptk-number-field[data-field="${EXPECTED_MAXIMUM_FIELD}"][data-lift="squat"]`)
      ?.shadowRoot?.querySelector('input');

    expect(input?.value).toBe('19o');
    expect(deepText(element)).toContain('Enter a weight using digits');
    expect(element.shadowRoot?.querySelector('ptk-notice')?.getAttribute('tone')).toBe('error');
  });

  it('asks only about the lifts the meet contests', async () => {
    const element = await mount(plannerSession({ format: 'push-pull' }));

    expect(fieldsFor(element, 'squat')).toEqual([]);
    expect(fieldsFor(element, 'bench')).not.toEqual([]);
    expect(fieldsFor(element, 'deadlift')).not.toEqual([]);
  });

  it('says nothing about how likely an attempt is', async () => {
    // §10.2 bans probability vocabulary outright, and the method explanations
    // are where it is most tempting: every one of them is a claim about how a
    // day might go.
    const text = deepText(
      await mount(acrossLifts(plannerSession(), { expectedMaximum: '200' })),
    ).toLowerCase();

    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('has no accessibility violations with a figure awaiting confirmation', async () => {
    const element = await mount(acrossLifts(plannerSession(), { expectedMaximum: '200' }));
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column on the method that asks the most', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount(
      acrossLifts(plannerSession({ method: 'guided-estimate' }), { guided: guidedSet() }),
      frame,
    );

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });

  it('fits a phone-width column with a target total on screen', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount(
      withTargetTotal(
        acrossLifts(plannerSession({ method: 'target-total' }), {
          expectedMaximum: '200',
          ceiling: '225',
        }),
        '540',
      ),
      frame,
    );

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
