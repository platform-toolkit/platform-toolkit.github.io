// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §12's three taps, and the four ways the card can be half-answered.
 *
 * Most of this file is about what the card refuses to emit. The event this
 * element dispatches is handed more or less straight to `applyMeetAction`, so a
 * draft that escapes half-filled becomes a recorded attempt with a reading nobody
 * gave -- and §12.3 is explicit that the miss reasons "materially affect the next
 * recommendation", which means a missing one is not a cosmetic gap but a wrong
 * recommendation on the next screen. There are therefore two tests per gap: one
 * that the button is dead, and one that the detail is right when it is not.
 *
 * The other half is the draft reset. It is keyed to `subject.attemptId` and not
 * to object identity, because the live view is rebuilt off the clock seam four
 * times a second (§13.5) -- so "the same attempt, a new object" is the common
 * case and clearing on it would wipe a note mid-sentence. Both directions are
 * asserted, and the identity case is the one that looks like a bug in review.
 *
 * A real browser for the usual reason (§5.8): every answer leaves a control's own
 * shadow tree as a composed event, and a root reading `event.target` rather than
 * `composedPath()` would see the host with an empty dataset.
 */
import { attemptWeightFor, type AttemptWeight } from '@platform-toolkit/domain';
import { PtkDisclosure } from '@platform-toolkit/ui/ptk-disclosure';
import { NUMBER_FIELD_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-number-field';
import { SEGMENTED_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-segmented';
import { TEXT_AREA_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-text-area';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  EFFORT_FIELD,
  LIGHT_FIELDS,
  MISS_REASON_FIELD,
  NOTE_FIELD,
  OUTCOME_FIELD,
  RPE_FIELD,
} from './fields.js';
import { CHARTED_CONTEXT, PROBABILITY_WORDS } from './planner-fixture.js';
import {
  ATTEMPT_RESULT_EVENT,
  type AttemptResultDetail,
  type PtkAttemptResult,
  type ResultSubject,
} from './ptk-attempt-result.js';
import './ptk-attempt-result.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * 180 kg, which is a row on the fixture chart on purpose.
 *
 * The chart publishes it as 396.9 lb where the arithmetic gives 396.83, which is
 * what lets the assertion below prove the card read the chart rather than
 * converting -- the whole of §16, and unprovable against a figure that agrees.
 */
const CHARTED_KILOGRAMS = 180;

function weightFixture(kilograms = CHARTED_KILOGRAMS): AttemptWeight {
  return attemptWeightFor(kilograms, CHARTED_CONTEXT.chart);
}

function subjectFixture(patch: Partial<ResultSubject> = {}): ResultSubject {
  return {
    attemptId: 'attempt-squat-2',
    lifterName: 'Sam Okafor',
    lift: 'squat',
    attemptNumber: 2,
    weight: weightFixture(),
    ...patch,
  };
}

async function mount(
  subject: ResultSubject | null = subjectFixture(),
  within?: HTMLElement,
): Promise<PtkAttemptResult> {
  const element = document.createElement('ptk-attempt-result');
  element.subject = subject;
  (within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Answers a tile group by clicking the radio inside it, the way a thumb does. */
async function press(
  element: PtkAttemptResult,
  selector: string,
  value: string,
): Promise<PtkAttemptResult> {
  const host = element.shadowRoot?.querySelector(selector);
  const radio = [...(host?.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}" matching "${selector}".`);
  radio.click();
  await element.updateComplete;
  return element;
}

/** One of the outcome, effort or miss-reason groups, by its `data-field`. */
function field(name: string): string {
  return `[data-field="${name}"]`;
}

/** One of the three light bars, by its `data-control`. */
function light(index: number): string {
  const name = LIGHT_FIELDS[index];
  if (name === undefined) throw new Error(`There is no light at index ${String(index)}.`);
  return `[data-control="${name}"]`;
}

/** Types into a field, which for a shared control means driving its own input. */
async function typeInto(
  element: PtkAttemptResult,
  selector: string,
  text: string,
): Promise<PtkAttemptResult> {
  const host = element.shadowRoot?.querySelector(selector);
  const input = host?.shadowRoot?.querySelector('input, textarea');
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
    throw new Error(`No text control matching "${selector}".`);
  }
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
  return element;
}

/**
 * The native button inside the Record control.
 *
 * Reached through both shadow roots rather than clicked on the host, because a
 * disabled `<button>` fires no click at all -- which is the guard being asserted,
 * and a host-level click would fire whatever the button's state.
 */
function recordButton(element: PtkAttemptResult): HTMLButtonElement {
  const host = element.shadowRoot?.querySelector('ptk-button');
  const button = host?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('The Record button did not render.');
  return button;
}

/** Unfolds the optional half, for the tests that reach the lights, RPE or note. */
async function openDetails(element: PtkAttemptResult): Promise<PtkAttemptResult> {
  const found = element.shadowRoot?.querySelector('ptk-disclosure');
  if (!(found instanceof PtkDisclosure)) throw new Error('The details fold did not render.');
  // Set rather than pressed: `<details>` fires `toggle` asynchronously (§5.8),
  // so a press followed by an assertion on the same tick reads the old state.
  found.open = true;
  await element.updateComplete;
  return element;
}

/**
 * Records what escapes the element, listening on `document.body`.
 *
 * Not on the element: what is being proved is that the event crossed the shadow
 * boundary composed, and a listener on the element itself would pass without it.
 */
function watch(): AttemptResultDetail[] {
  const seen: AttemptResultDetail[] = [];
  const listener = (event: CustomEvent<AttemptResultDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(ATTEMPT_RESULT_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(ATTEMPT_RESULT_EVENT, listener);
  });
  return seen;
}

/** The three taps every good-lift assertion starts from. */
async function goodLift(element: PtkAttemptResult): Promise<PtkAttemptResult> {
  await press(element, field(OUTCOME_FIELD), 'good');
  return press(element, field(EFFORT_FIELD), 'solid');
}

describe('ptk-attempt-result', () => {
  it('re-renders when the subject is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating --
    // which on this element means the card keeps naming the previous lifter
    // while a thumb records a result against them.
    const element = await mount();
    expect(deepText(element)).toContain('Sam Okafor');

    element.subject = subjectFixture({ attemptId: 'attempt-bench-1', lifterName: 'Rae Lindqvist' });
    await element.updateComplete;

    expect(deepText(element)).toContain('Rae Lindqvist');
  });

  it('says there is nothing to record rather than rendering an empty card', async () => {
    // The state the live screen sits in between attempts. A blank card with a
    // dead button reads as the tool having failed to load.
    const text = deepText(await mount(null));

    expect(text).toContain('Nothing on the platform');
    expect(text).not.toContain('What happened?');
  });

  it('names the lifter, the lift and the attempt number', async () => {
    // §14's named failure is the right weight against the wrong athlete, and
    // this card is the one that writes a reading down against a name.
    const text = deepText(await mount());

    expect(text).toContain('Sam Okafor');
    expect(text).toContain('Squat');
    expect(text).toContain('attempt 2');
  });

  it('reads the pound figure off the chart instead of converting it', async () => {
    // §16. The fixture chart publishes 180 kg as 396.9 lb where the arithmetic
    // gives 396.83, so a card that converted would show 396.8 and this is the
    // only assertion in the file that could tell the two apart.
    const text = deepText(await mount());

    expect(text).toContain('180 kg');
    expect(text).toContain('396.9 lb');
    expect(text).not.toContain('396.8 lb');
  });

  it('says no weight was declared rather than leaving the figure blank', async () => {
    const text = deepText(await mount(subjectFixture({ weight: null })));

    expect(text).toContain('No weight declared');
  });

  it('records a good lift in three taps', async () => {
    const seen = watch();
    const element = await goodLift(await mount());

    recordButton(element).click();

    expect(seen).toEqual([
      {
        attemptId: 'attempt-squat-2',
        result: { outcome: 'good', effort: 'solid' },
        lights: null,
        note: null,
      },
    ]);
  });

  it('records a miss with the reason, which the next recommendation branches on', async () => {
    // §12.3 says outright that these reasons must not be hidden in a notes
    // field, and `live-choices.ts` reads the reason and nothing else.
    const seen = watch();
    const element = await mount();
    await press(element, field(OUTCOME_FIELD), 'no-lift');
    await press(element, field(MISS_REASON_FIELD), 'command');

    recordButton(element).click();

    expect(seen.map((detail) => detail.result)).toEqual([
      { outcome: 'no-lift', reason: 'command' },
    ]);
  });

  it('records a pass in two taps, asking nothing further', async () => {
    // There is no reading to take from a lift that did not happen, so a follow
    // up question here would be a tap spent on an answer nothing consumes.
    const seen = watch();
    const element = await press(await mount(), field(OUTCOME_FIELD), 'passed');

    expect(element.shadowRoot?.querySelector(field(EFFORT_FIELD))).toBeNull();
    expect(element.shadowRoot?.querySelector(field(MISS_REASON_FIELD))).toBeNull();

    recordButton(element).click();

    expect(seen.map((detail) => detail.result)).toEqual([{ outcome: 'passed' }]);
  });

  it('records a granted extra attempt in two taps', async () => {
    const seen = watch();
    const element = await press(await mount(), field(OUTCOME_FIELD), 'extra-attempt-granted');

    recordButton(element).click();

    expect(seen.map((detail) => detail.result)).toEqual([{ outcome: 'extra-attempt-granted' }]);
  });

  it('asks only the question the chosen outcome asks', async () => {
    // What keeps §12 at three taps: two lists, never both on screen. A card
    // showing both would ask a lifter why they missed a lift they made.
    const element = await mount();
    expect(element.shadowRoot?.querySelector(field(EFFORT_FIELD))).toBeNull();

    await press(element, field(OUTCOME_FIELD), 'good');
    expect(element.shadowRoot?.querySelector(field(EFFORT_FIELD))).not.toBeNull();
    expect(element.shadowRoot?.querySelector(field(MISS_REASON_FIELD))).toBeNull();

    await press(element, field(OUTCOME_FIELD), 'no-lift');
    expect(element.shadowRoot?.querySelector(field(EFFORT_FIELD))).toBeNull();
    expect(element.shadowRoot?.querySelector(field(MISS_REASON_FIELD))).not.toBeNull();
  });

  it('will not record before an outcome is chosen', async () => {
    const seen = watch();
    const element = await mount();

    expect(recordButton(element).disabled).toBe(true);
    expect(deepText(element)).toContain('Choose what happened');

    recordButton(element).click();

    expect(seen).toEqual([]);
  });

  it('will not record a good lift with no reading of how it felt', async () => {
    // The reading is what §13 branches on, so a good lift recorded without one
    // reaches the next screen with nothing to act on -- and the screen would
    // still show three plausible choices, computed from the branch for a lifter
    // who reported nothing.
    const seen = watch();
    const element = await press(await mount(), field(OUTCOME_FIELD), 'good');

    expect(recordButton(element).disabled).toBe(true);
    expect(deepText(element)).toContain('This changes what comes next');

    recordButton(element).click();

    expect(seen).toEqual([]);

    // The control: the same card, one tap later, does record.
    await press(element, field(EFFORT_FIELD), 'flew');
    expect(recordButton(element).disabled).toBe(false);
  });

  it('will not record a miss with no reason', async () => {
    const seen = watch();
    const element = await press(await mount(), field(OUTCOME_FIELD), 'no-lift');

    expect(recordButton(element).disabled).toBe(true);
    recordButton(element).click();
    expect(seen).toEqual([]);

    await press(element, field(MISS_REASON_FIELD), 'strength');
    expect(recordButton(element).disabled).toBe(false);
  });

  it('records nothing from a click that misses the disabled button', async () => {
    // The disabled `<button>` is the only guard the tests above exercise, and it
    // is not the only way a click reaches the handler: the listener sits on the
    // `ptk-button` host, so a click landing on the host's own box -- or any
    // caller doing `host.click()` -- runs it whatever the inner button's state.
    // Without the second check in `#onRecord` that dispatches a result of
    // `null`, which `applyMeetAction` would take as a recorded attempt with no
    // outcome.
    const seen = watch();
    const element = await press(await mount(), field(OUTCOME_FIELD), 'good');
    const host = element.shadowRoot?.querySelector('ptk-button');
    if (host === null || host === undefined) throw new Error('The Record button did not render.');

    host.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(seen).toEqual([]);

    // The control: the same dispatch, once the card is answerable, does record.
    await press(element, field(EFFORT_FIELD), 'solid');
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

    expect(seen).toHaveLength(1);
  });

  it('refuses an RPE outside the scale the document records on', async () => {
    // Refused here rather than by `recordResult`, and against the domain's own
    // bounds: a field that let a lifter type 12 and then reported a refusal from
    // the document layer would be a form that validates by being submitted.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(RPE_FIELD), '12');

    expect(recordButton(element).disabled).toBe(true);
    expect(deepText(element)).toContain('6 to 10');

    recordButton(element).click();
    expect(seen).toEqual([]);
  });

  it('refuses an RPE that is not a number', async () => {
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(RPE_FIELD), 'hard');

    expect(recordButton(element).disabled).toBe(true);
    expect(deepText(element)).toContain('for example 8.5');
  });

  it('carries a half-point RPE alongside the reading, not instead of it', async () => {
    // A deliberate deviation from §12.2's "instead": `live-choices.ts` branches
    // on the effort reading and on nothing else, so an RPE on its own would
    // reach the next recommendation with nothing to act on, and mapping 8 onto
    // "solid" would invent a correspondence nobody published.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(RPE_FIELD), '8.5');

    recordButton(element).click();

    expect(seen.map((detail) => detail.result)).toEqual([
      { outcome: 'good', effort: 'solid', rpe: 8.5 },
    ]);
  });

  it('omits the RPE key rather than sending it undefined', async () => {
    // `exactOptionalPropertyTypes` is on, so a present `rpe: undefined` is not
    // the same shape as an absent key -- and the document's refusal reads
    // `Number.isFinite`, which `undefined` fails. The result would be a good
    // lift refused for an RPE nobody typed.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(RPE_FIELD), '   ');

    recordButton(element).click();

    const [detail] = seen;
    if (detail === undefined) throw new Error('Nothing was recorded.');
    expect(Object.hasOwn(detail.result, 'rpe')).toBe(false);
  });

  it('does not ask for an RPE on a missed lift', async () => {
    // There is no exertion to grade on a lift that did not go up, and the
    // document has nowhere to put one.
    const element = await mount();
    await press(element, field(OUTCOME_FIELD), 'no-lift');
    await press(element, field(MISS_REASON_FIELD), 'pain');
    await openDetails(element);

    expect(element.shadowRoot?.querySelector(field(RPE_FIELD))).toBeNull();
  });

  it('reports the three lights only once all three are set', async () => {
    // Two lights and a blank is not a judgement, and a two-to-nothing recorded
    // as a decision is precisely the detail somebody goes back to the note for.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await press(element, light(0), 'white');
    await press(element, light(1), 'red');

    recordButton(element).click();
    expect(seen.map((detail) => detail.lights)).toEqual([null]);

    await press(element, light(2), 'white');
    recordButton(element).click();

    expect(seen.map((detail) => detail.lights)).toEqual([null, ['white', 'red', 'white']]);
  });

  it('keeps the three lights in referee order', async () => {
    // Left, head, right, and two of the three are interchangeable to a glance.
    // A tuple written in the wrong order records a legal-looking two-to-one in
    // the wrong direction, which reads as correct on every screen.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await press(element, light(2), 'red');
    await press(element, light(0), 'white');
    await press(element, light(1), 'white');

    recordButton(element).click();

    expect(seen.map((detail) => detail.lights)).toEqual([['white', 'white', 'red']]);
  });

  it('reports a blank note as nothing rather than as an empty note', async () => {
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(NOTE_FIELD), '   \n  ');

    recordButton(element).click();

    expect(seen.map((detail) => detail.note)).toEqual([null]);
  });

  it('reports a note exactly as it was typed', async () => {
    // Trimmed to decide whether there is a note, reported untrimmed: the note is
    // what the referees said, and a tool that reformats it is editing evidence.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(NOTE_FIELD), '  Depth called. Chief said hips high.  ');

    recordButton(element).click();

    expect(seen.map((detail) => detail.note)).toEqual(['  Depth called. Chief said hips high.  ']);
  });

  it('clears the draft when the attempt changes', async () => {
    // §13.9's undo swaps the attempt underneath a half-filled draft. A draft
    // that survived it would let a lifter record the previous attempt's reading
    // against this one, with the card showing the new attempt's weight.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(NOTE_FIELD), 'Depth.');

    element.subject = subjectFixture({ attemptId: 'attempt-squat-3', attemptNumber: 3 });
    await element.updateComplete;

    expect(recordButton(element).disabled).toBe(true);

    await goodLift(element);
    recordButton(element).click();

    expect(seen).toEqual([
      {
        attemptId: 'attempt-squat-3',
        result: { outcome: 'good', effort: 'solid' },
        lights: null,
        note: null,
      },
    ]);
  });

  it('keeps the draft when the same attempt arrives as a fresh object', async () => {
    // The live view is rebuilt on every clock tick (§13.5), so a fresh subject
    // object for the same attempt arrives four times a second. Keying the reset
    // on object identity would clear a half-typed note mid-sentence, and it
    // would look like the keyboard dropping characters rather than like this.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));
    await typeInto(element, field(NOTE_FIELD), 'Depth.');

    element.subject = subjectFixture();
    await element.updateComplete;

    expect(recordButton(element).disabled).toBe(false);

    recordButton(element).click();

    expect(seen.map((detail) => detail.note)).toEqual(['Depth.']);
  });

  it('ignores a control change that carries no field tag', async () => {
    // Every one of these events is `composed` and bubbling, so the listeners on
    // this host hear anything of the same name raised anywhere beneath it -- not
    // only the four controls this card drew. Today it draws one text area, one
    // number field and exactly three light bars, so each filter looks like a
    // branch nothing can reach; the moment this card gains a second box of any
    // kind, the untagged fallback is a keystroke in one field landing in
    // another's draft, with both controls visibly responding.
    const seen = watch();
    const element = await openDetails(await goodLift(await mount()));

    element.dispatchEvent(
      new CustomEvent(TEXT_AREA_CHANGE_EVENT, { detail: { value: 'not the note' } }),
    );
    element.dispatchEvent(new CustomEvent(NUMBER_FIELD_CHANGE_EVENT, { detail: { value: '99' } }));
    element.dispatchEvent(new CustomEvent(SEGMENTED_CHANGE_EVENT, { detail: { value: 'red' } }));
    await element.updateComplete;

    recordButton(element).click();

    expect(seen).toEqual([
      {
        attemptId: 'attempt-squat-2',
        result: { outcome: 'good', effort: 'solid' },
        lights: null,
        note: null,
      },
    ]);
  });

  it('says nothing about how likely the next attempt is', async () => {
    // §10.2. This card is read by somebody who has just lifted, which is the
    // most tempting place in the tool to answer with a number.
    const element = await openDetails(await goodLift(await mount()));
    const text = deepText(element).toLowerCase();

    for (const banned of PROBABILITY_WORDS) {
      expect(text).not.toContain(banned);
    }
  });

  it('says whose record of the day this is', async () => {
    // §29 is a list of sentences that must appear, not a tone note. The tool
    // never submits an attempt and this is the screen that most looks like it
    // does -- a form, with a button reading Record.
    expect(deepText(await mount())).toContain("scoring table's sheet is the one that counts");
  });

  it('has no accessibility violations with the fold open', async () => {
    const element = await openDetails(await goodLift(await mount()));
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with every question on screen', async () => {
    // The widest state: an outcome, six effort tiles, three light bars, the RPE
    // field and the note box. Anything that overflows here overflows the page,
    // because this card sits in the page gutter with nothing beside it.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await openDetails(await goodLift(await mount(subjectFixture(), frame)));

    expect(element.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
