// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The whole tool composed: five elements, five shadow trees, one piece of state.
 *
 * Nothing here re-checks arithmetic. Every figure on the screen has already been
 * asserted in the suite belonging to the element that draws it, and repeating one
 * of them here would only mean two files to edit the day a coefficient moves.
 * What this file is about is the wiring, and every claim in it fails silently in
 * a way that looks like something else:
 *
 *   - An answer given three shadow roots down reaches the state, because the
 *     listener walks `event.composedPath()`. Read `event.target` instead and
 *     every control still visibly responds while nothing is recorded (§5.8) —
 *     which reads as a rendering fault, not a wiring one.
 *   - The set lands in the store that dies with the tab and the settings land in
 *     the one that does not. Get that backwards and the tool works perfectly all
 *     week and hands somebody a sex marker and a training record next Tuesday.
 *   - Clearing the set leaves the lifter's own preferences alone. Get that wrong
 *     and the button that removes one set also undoes every choice they made.
 *
 * The observation point for state is the `entry` the refinements child is handed.
 * It is the same object the root holds, it is reachable without exporting private
 * state for a test's benefit, and reading it proves the value reached a child
 * rather than merely being stored.
 */
import {
  PREFERENCE_KEY_PREFIX,
  createPreferenceStore,
  memoryPreferenceStorage,
} from '@platform-toolkit/preferences';
import { PtkChoiceGroup } from '@platform-toolkit/ui';
// Every gap, every column track and the 44px tap-target floor is a custom
// property, and a declaration reading an undefined one is dropped -- so without
// the stylesheet the 320px measurement below is of a layout that never ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { describedSet } from './estimate-fixture.js';
import {
  LIFT_FIELD,
  REPS_FIELD,
  RESERVE_FIELD,
  TECHNIQUE_FIELD,
  UNIT_FIELD,
  WEIGHT_FIELD,
} from './fields.js';
import type { PtkOneRepMaxCalculator } from './ptk-one-rep-max-calculator.js';
import './ptk-one-rep-max-calculator.js';
import type { PtkSetRefinements } from './ptk-set-refinements.js';
import { DISPLAY_PREFERENCES, SET_PREFERENCES, saveEntry, type EstimateEntry } from './session.js';

/**
 * Three storage keys, built the way the store builds them.
 *
 * Spelled as literals they would keep matching after a definition was renamed,
 * and the assertions below -- that no set key ever appears in the long-lived
 * store -- would then hold trivially over names nothing writes.
 */
const UNIT_KEY = PREFERENCE_KEY_PREFIX + DISPLAY_PREFERENCES.unit.name;
const WEIGHT_KEY = PREFERENCE_KEY_PREFIX + SET_PREFERENCES.weight.name;
const SEX_KEY = PREFERENCE_KEY_PREFIX + SET_PREFERENCES.sex.name;

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<Pick<PtkOneRepMaxCalculator, 'settings' | 'session'>> = {},
  within?: HTMLElement,
): Promise<PtkOneRepMaxCalculator> {
  const element = document.createElement('ptk-one-rep-max-calculator');
  Object.assign(element, properties);
  (within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** A store with a backing that no other test can see and no origin keeps. */
function remembering(): ReturnType<typeof memoryPreferenceStorage> {
  return memoryPreferenceStorage();
}

/** The refinements child, which is handed the whole entry on every render. */
function refinements(element: PtkOneRepMaxCalculator): PtkSetRefinements {
  const found = element.shadowRoot?.querySelector('ptk-set-refinements');
  if (found === null || found === undefined) throw new Error('No refinements section rendered.');
  return found;
}

/** The state the tool is currently in, read from what it handed a child. */
function entryOf(element: PtkOneRepMaxCalculator): EstimateEntry {
  return refinements(element).entry;
}

/**
 * The one choice group answering a field, wherever in the tool it lives.
 *
 * The lift, unit and reserve questions are the root's own; the movement standard
 * is two shadow roots down inside the folded section. A test should not have to
 * know which, because the root does not: it routes on `data-field` off the
 * composed path and a question could move between the two without it noticing.
 */
function group(element: PtkOneRepMaxCalculator, field: string): PtkChoiceGroup {
  const selector = `ptk-choice-group[data-field="${field}"]`;
  const roots = [
    element.shadowRoot,
    ...[...(element.shadowRoot?.querySelectorAll('*') ?? [])].map((child) => child.shadowRoot),
  ];
  for (const root of roots) {
    const found = root?.querySelector(selector);
    if (found instanceof PtkChoiceGroup) return found;
  }
  throw new Error(`No choice group for "${field}" anywhere in the tool.`);
}

/** Answers a question by clicking the radio, the way a lifter does. */
async function choose(
  element: PtkOneRepMaxCalculator,
  field: string,
  value: string,
): Promise<void> {
  const radio = [...(group(element, field).shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No option "${value}" for "${field}".`);
  radio.click();
  await element.updateComplete;
}

/** Types into one of the root's two number fields, keystroke and all. */
async function type(element: PtkOneRepMaxCalculator, field: string, text: string): Promise<void> {
  const input = element.shadowRoot
    ?.querySelector(`ptk-number-field[data-field="${field}"]`)
    ?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No "${field}" field.`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** A button in the root's own tree, found by the name a screen reader reads. */
function button(element: PtkOneRepMaxCalculator, accessibleName: string): HTMLButtonElement | null {
  const host = element.shadowRoot?.querySelector(`ptk-button[accessible-name="${accessibleName}"]`);
  const inner = host?.shadowRoot?.querySelector('button');
  return inner instanceof HTMLButtonElement ? inner : null;
}

async function press(element: PtkOneRepMaxCalculator, accessibleName: string): Promise<void> {
  const found = button(element, accessibleName);
  if (found === null) throw new Error(`No button named "${accessibleName}".`);
  found.click();
  await element.updateComplete;
}

/** Unfolds the optional questions, which is how a lifter reaches them. */
async function unfold(element: PtkOneRepMaxCalculator): Promise<void> {
  const section = refinements(element);
  const disclosure = section.shadowRoot?.querySelector('ptk-disclosure');
  if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
  disclosure.open = true;
  await disclosure.updateComplete;
  await element.updateComplete;
}

/** A set worth estimating from. Invented, like every figure in these tests. */
async function describeASet(element: PtkOneRepMaxCalculator): Promise<void> {
  await type(element, WEIGHT_FIELD, '142.5');
  await type(element, REPS_FIELD, '5');
}

describe('ptk-one-rep-max-calculator', () => {
  it('re-renders a child when a store is handed in after the first render', async () => {
    // Two things at once. It is the canary for Lit's decorator configuration
    // (§5.8) -- everything else here passes when that is wrong and the tool
    // simply stops updating -- and it is why the restore lives in `willUpdate`
    // rather than `connectedCallback`: `view.ts` sets both stores as properties
    // after construction, and a restore that only ran on connect would show
    // defaults over a device that remembers a set.
    const element = await mount();
    expect(entryOf(element).weightText).toBe('');

    const settings = createPreferenceStore(remembering());
    const session = createPreferenceStore(remembering());
    saveEntry(settings, session, describedSet());
    Object.assign(element, { settings, session });
    await element.updateComplete;

    expect(entryOf(element).weightText).toBe('142.5');
    expect(deepText(element)).toContain('166 kg');
  });

  it('stands up with no storage at all', async () => {
    // The configuration this collection actually ships into: a third-party
    // iframe whose embedder blocked storage, where `localStorage` throws on
    // property access before a method is ever called. Both stores default to a
    // store with no backing, so there is no branch here to get wrong.
    const element = await mount();
    const rendered = deepText(element);

    expect(rendered).toContain('Enter a weight and a repetition count.');
    for (const tag of [
      'ptk-set-refinements',
      'ptk-estimate-result',
      'ptk-training-percentages',
      'ptk-formula-comparison',
    ]) {
      expect(element.shadowRoot?.querySelector(tag)).not.toBe(null);
    }
  });

  it('estimates from a weight and a repetition count and nothing else', async () => {
    // End to end, and the only place the whole chain is exercised: two
    // keystrokes into two fields, through `requestFor`, the domain, and back out
    // to four elements. Nothing optional has been answered, which is the state
    // most visitors will read.
    const element = await mount();
    await describeASet(element);

    const rendered = deepText(element);
    expect(rendered).toContain('Estimated max');
    expect(rendered).toContain('166 kg');
    expect(rendered).toContain(
      'Based on a squat of 142.5 kg for 5 reps, with the reserve not stated.',
    );
    // The percentage table and the equation list are fed from the same answer,
    // so a headline that agreed with neither would be two figures on one screen.
    expect(rendered).toContain('Loads from 100% down to 50% of 166 kg');
    expect(rendered).toContain('published equations');
  });

  it('writes a common repetition count on one tap', async () => {
    // §12 asks for the counts a lifter actually tests to be one tap. The chip
    // that matches what is typed is the primary one, so the tool shows back
    // which of them is currently true rather than offering six identical
    // buttons over a field that already says five.
    const element = await mount();
    await type(element, WEIGHT_FIELD, '142.5');
    await press(element, '5 repetitions');

    expect(entryOf(element).repsText).toBe('5');
    expect(deepText(element)).toContain('166 kg');
    const chip = element.shadowRoot?.querySelector('ptk-button[accessible-name="5 repetitions"]');
    expect(chip?.getAttribute('variant')).toBe('primary');
  });

  it('names a single repetition in the singular', async () => {
    // "1 repetitions" is the kind of thing nobody sees, because it is only ever
    // heard -- the visible label on the chip is the digit.
    const element = await mount();
    expect(button(element, '1 repetition')).not.toBe(null);
    expect(button(element, '1 repetitions')).toBe(null);
  });

  it('offers no way to clear a set nobody has described', async () => {
    // A destructive control over an empty form is a control whose only possible
    // effect is confusing somebody.
    const element = await mount();
    expect(button(element, 'Clear the set and start again')).toBe(null);

    await type(element, REPS_FIELD, '5');
    expect(button(element, 'Clear the set and start again')).not.toBe(null);
  });

  it('clears the set and keeps every preference the lifter chose', async () => {
    // The failure this exists to stop: one button that removes a set and also
    // silently undoes the unit, the lift and the rounding step -- so the next
    // set is entered in the wrong unit, against a lift the lifter did not pick.
    const element = await mount();
    await choose(element, UNIT_FIELD, 'lb');
    await choose(element, LIFT_FIELD, 'deadlift');
    await type(element, WEIGHT_FIELD, '315');
    await type(element, REPS_FIELD, '5');

    await press(element, 'Clear the set and start again');

    const entry = entryOf(element);
    expect(entry.weightText).toBe('');
    expect(entry.repsText).toBe('');
    expect(entry.weight).toBe(null);
    expect(entry.unit).toBe('lb');
    expect(entry.lift).toBe('deadlift');
    expect(entry.techniqueId).toBe('deadlift-unstated');
    // The pound list's finest step, which the unit switch moved it to by
    // position rather than by conversion. A clear that reset it to half a
    // kilogram would round a pound figure to a step no bar has.
    expect(entry.roundTo).toBe(1);
    expect(entry.percentageStep).toBe(5);
    expect(deepText(element)).toContain('Enter a weight and a repetition count.');
  });

  it('routes an answer given three shadow roots down', async () => {
    // The composed-path claim (§5.8), at the furthest point in the tool: a radio
    // inside `ptk-choice-group`'s root, inside `ptk-set-refinements`' root,
    // inside the disclosure's slot. `event.target` is retargeted to this host,
    // whose dataset is empty, and the answer is dropped with the radio visibly
    // ticked.
    const element = await mount();
    await describeASet(element);
    await unfold(element);
    expect(deepText(element)).toContain('Rough estimate');

    await choose(element, TECHNIQUE_FIELD, 'competition-squat');

    expect(entryOf(element).techniqueId).toBe('competition-squat');
    expect(deepText(element)).toContain('Strong input');
  });

  it('drops a movement standard that belongs to the lift underneath it', async () => {
    // Technique identifiers are unique within a lift and not across lifts, so a
    // squat standard carried onto a deadlift is a request the domain refuses --
    // the tool would answer nothing at all, over controls that all look answered.
    const element = await mount();
    await describeASet(element);
    await unfold(element);
    await choose(element, TECHNIQUE_FIELD, 'competition-squat');

    await choose(element, LIFT_FIELD, 'deadlift');

    expect(entryOf(element).techniqueId).toBe('deadlift-unstated');
    expect(deepText(element)).toContain('Estimated max');
  });

  it('converts a typed weight when the unit changes, rather than relabelling it', async () => {
    // §10 in one line: "Changing units SHALL convert values, not reinterpret
    // them." 100 kg is a little over 220 lb, never 100 lb. The exact figure is
    // `showEntryIn`'s business and is asserted where that lives; here it only
    // has to have moved.
    const element = await mount();
    await type(element, WEIGHT_FIELD, '100');
    await type(element, REPS_FIELD, '5');

    await choose(element, UNIT_FIELD, 'lb');

    expect(entryOf(element).weightText.startsWith('220')).toBe(true);
    expect(deepText(element)).toContain('lb');
    // And the placeholder follows the unit, because 130 is a squat in kilograms
    // and a warm-up in pounds.
    expect(
      element.shadowRoot
        ?.querySelector(`ptk-number-field[data-field="${WEIGHT_FIELD}"]`)
        ?.getAttribute('placeholder'),
    ).toBe('285');
  });

  it('reads the reserve answer back into the sentence under the figure', async () => {
    // The read-back is the only place a lifter can see that the tool understood
    // the set the way they described it, and the reserve is the answer that
    // moves the figure most while being invisible in the figure itself.
    const element = await mount();
    await describeASet(element);
    await choose(element, RESERVE_FIELD, '2');

    expect(entryOf(element).reserve).toBe('2');
    expect(deepText(element)).toContain('for 5 reps, with two reps left.');
  });

  it('says what is wrong with the set without shouting at a half-typed field', async () => {
    // Three different situations that all look like "no estimate": nothing typed
    // yet, something typed that cannot be read, and a set the domain refuses.
    // Only the last two are mistakes, and only one of them is the panel's to
    // report -- the field says what is wrong with the field.
    const element = await mount();
    await type(element, WEIGHT_FIELD, '1o5');

    const field = element.shadowRoot?.querySelector(
      `ptk-number-field[data-field="${WEIGHT_FIELD}"]`,
    );
    expect(field?.getAttribute('error')).toBe('Enter a weight using digits, for example 130.');
    expect(deepText(element)).toContain('Enter a weight and a repetition count.');

    await type(element, WEIGHT_FIELD, '142.5');
    await type(element, REPS_FIELD, '25');

    const rendered = deepText(element);
    expect(rendered).toContain('That set cannot be read as described.');
    expect(rendered).toContain('Use a heavier weight for fewer reps');
  });

  it('keeps the set out of the store that outlives the tab', async () => {
    // Two stores with two lifetimes, structurally rather than by convention. A
    // weight and a repetition count reopened next week is a training record the
    // lifter never chose to write -- and the sex marker is worse, which is why
    // it is checked by name.
    const settings = remembering();
    const session = remembering();
    const element = await mount({
      settings: createPreferenceStore(settings),
      session: createPreferenceStore(session),
    });

    await describeASet(element);
    await unfold(element);
    await choose(element, 'sex', 'woman');

    expect(settings.keys()).toContain(UNIT_KEY);
    expect(session.read(WEIGHT_KEY)).not.toBeNull();
    expect(session.read(SEX_KEY)).not.toBeNull();
    expect(settings.keys()).not.toContain(WEIGHT_KEY);
    expect(settings.keys()).not.toContain(SEX_KEY);
    expect(session.keys()).not.toContain(UNIT_KEY);
  });

  it('tags each of its own controls with the field it routes on', async () => {
    const element = await mount();
    const fields = [...(element.shadowRoot?.querySelectorAll('[data-field]') ?? [])].map(
      (control) => control.getAttribute('data-field'),
    );

    // Order included: it is the order the questions are asked in, and moving one
    // is a product change rather than a refactor.
    expect(fields).toEqual([LIFT_FIELD, WEIGHT_FIELD, REPS_FIELD, UNIT_FIELD, RESERVE_FIELD]);
  });

  it('has no accessibility violations with a set described', async () => {
    const element = await mount();
    await describeASet(element);
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with the whole tool on screen', async () => {
    // The primary target, not a degraded case: this is read one-handed at a rack
    // (§5.7). Pounds because the figures are three digits wide there, and the
    // optional questions open because that is the widest the tool ever gets.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mount({}, frame);
    await type(element, WEIGHT_FIELD, '315 lb');
    await type(element, REPS_FIELD, '5');
    await unfold(element);

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
