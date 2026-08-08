// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { PtkButton } from '@platform-toolkit/ui/ptk-button';
import type { PtkDisclosure } from '@platform-toolkit/ui/ptk-disclosure';
import type { PtkNumberField } from '@platform-toolkit/ui/ptk-number-field';
// Without the stylesheet `--ptk-tap-target-min` is undefined, the declaration
// referencing it is dropped, and the row-height assertion below measures a row
// with no floor at all and passes.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import {
  LIFT_CHANGE_EVENT,
  LIFT_MOVE_EVENT,
  LIFT_REMOVE_EVENT,
  SET_TOGGLE_EVENT,
  type PtkLiftCard,
} from './ptk-lift-card.js';
import './ptk-lift-card.js';
import { markKey, type LiftEntry } from './session.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * The card is where a lifter's thumb lands between sets, and almost everything
 * it does crosses a shadow boundary: three number fields in their own trees, a
 * bar picker inside a fold, and a checklist whose tap target is the row rather
 * than the box. None of that is worth asserting against a simulation.
 */

/** Invented, and deliberately plain: the ramp rules are tested in the domain. */
const SQUAT: LiftEntry = {
  key: 'squat',
  liftId: 'squat',
  name: 'Squat',
  family: 'squat-press',
  barId: '',
  weight: '100',
  sets: '3',
  reps: '5',
  adjustments: [],
};

/** A rack with nothing on it but full plates, so one step is a long way. */
const COARSE: Equipment = {
  ...DEFAULT_EQUIPMENT,
  inventory: {
    ...DEFAULT_EQUIPMENT.inventory,
    lb: [{ weight: 45, pairs: null, fullDiameter: true }],
  },
};

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<
    Pick<PtkLiftCard, 'entry' | 'equipment' | 'completion' | 'first' | 'last'>
  > = {},
): Promise<PtkLiftCard> {
  const element = document.createElement('ptk-lift-card');
  element.entry = SQUAT;
  element.equipment = DEFAULT_EQUIPMENT;
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * The event names whose payload the augmented map says is a `CustomEvent`.
 *
 * Narrowing to these is what lets the collector below read `.detail` without an
 * assertion. An `as CustomEvent<…>` in its place would keep compiling after a
 * detail changed shape, which is the whole reason the map is augmented at all.
 */
type CustomEventName = {
  [K in keyof HTMLElementEventMap]: HTMLElementEventMap[K] extends CustomEvent ? K : never;
}[keyof HTMLElementEventMap];

/** Collects one event kind from outside the card, which is where the tool sits. */
function watch<K extends CustomEventName>(name: K): HTMLElementEventMap[K]['detail'][] {
  const seen: HTMLElementEventMap[K]['detail'][] = [];
  const listener = (event: HTMLElementEventMap[K]): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(name, listener);
  teardown.push(() => {
    document.body.removeEventListener(name, listener);
  });
  return seen;
}

function rows(element: PtkLiftCard): HTMLLabelElement[] {
  return [...(element.shadowRoot?.querySelectorAll('li label.row') ?? [])].filter(
    (node): node is HTMLLabelElement => node instanceof HTMLLabelElement,
  );
}

function press(host: PtkButton): void {
  const inner = host.shadowRoot?.querySelector('button');
  if (!(inner instanceof HTMLButtonElement)) throw new Error('No button rendered.');
  inner.click();
}

function control(element: PtkLiftCard, accessibleName: string): PtkButton {
  const found = element.shadowRoot?.querySelector<PtkButton>(
    `ptk-button[accessible-name="${accessibleName}"]`,
  );
  if (found === null || found === undefined) {
    throw new Error(`No control named "${accessibleName}".`);
  }
  return found;
}

/**
 * Opens the adjustment fold the way the card cannot be tested without.
 *
 * By property rather than by pressing the summary because `<details>` fires
 * `toggle` asynchronously, so a click and an assertion on the same tick read the
 * previous state. Idempotent: the fold is the same DOM node across the card's
 * re-renders, so a test that feeds an adjustment back does not have to reopen it
 * -- calling this again after one is cheap insurance rather than a requirement.
 */
async function openAdjust(element: PtkLiftCard): Promise<PtkDisclosure> {
  const fold = element.shadowRoot?.querySelector<PtkDisclosure>('.adjust ptk-disclosure');
  if (fold === null || fold === undefined) throw new Error('No adjustment fold rendered.');
  fold.open = true;
  await element.updateComplete;
  return fold;
}

/**
 * One stepper, found by the ordinal a lifter reads rather than by position.
 *
 * The name is a prefix match because the rest of it is the weight the press
 * lands on, which is the thing under test in one of these and must not have to
 * be spelled out in the others.
 */
function stepper(element: PtkLiftCard, verb: 'Lower' | 'Raise', ordinal: number): PtkButton {
  const found = element.shadowRoot?.querySelector<PtkButton>(
    `ptk-button[accessible-name^="${verb} warm-up ${String(ordinal)} for "]`,
  );
  if (found === null || found === undefined) {
    throw new Error(`No ${verb} stepper for warm-up ${String(ordinal)}.`);
  }
  return found;
}

/**
 * The one control in the fold that carries its label as text rather than a name.
 *
 * `control()` cannot find it: an `accessible-name` on a button whose own words
 * already say what it does would be a second, competing label.
 */
function reset(element: PtkLiftCard): PtkButton {
  const found = element.shadowRoot?.querySelector<PtkButton>(
    '.adjust ptk-button:not([accessible-name])',
  );
  if (found === null || found === undefined) throw new Error('No reset control in the fold.');
  return found;
}

/** The text of a set of nodes, with the template's line breaks squeezed out. */
function texts(element: PtkLiftCard, selector: string): string[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].map((node) =>
    node.textContent.replace(/\s+/gu, ' ').trim(),
  );
}

async function type(element: PtkLiftCard, field: string, text: string): Promise<void> {
  const host = element.shadowRoot?.querySelector<PtkNumberField>(
    `ptk-number-field[data-field="${field}"]`,
  );
  const input = host?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input for "${field}".`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

describe('ptk-lift-card', () => {
  it('shows a ramp that ends on the working sets', async () => {
    const element = await mount();
    const listed = rows(element);
    expect(listed.length).toBeGreaterThan(1);
    expect(listed.at(-1)?.classList.contains('working')).toBe(true);
    expect(listed.at(-1)?.textContent).toContain('Working set');
  });

  it('re-renders the ramp when the entry is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration. It is also the tool's only
    // route for a weight change: the card reports a keystroke and is handed a
    // new entry back, so a card that ignored the second half would show a ramp
    // for the previous weight with the new one in the box above it.
    const element = await mount();
    const before = rows(element).length;

    element.entry = { ...SQUAT, weight: '180' };
    await element.updateComplete;

    expect(element.shadowRoot?.textContent).toContain('180 lb');
    expect(rows(element).length).toBeGreaterThanOrEqual(before);
  });

  it('reports a keystroke as text rather than a parsed number', async () => {
    // Parsing in the card would mean deciding what `12.` means mid-keystroke,
    // and every answer either fights the caret or discards what was typed.
    const element = await mount();
    const seen = watch(LIFT_CHANGE_EVENT);
    await type(element, 'weight', '142.');
    expect(seen.at(-1)).toEqual({ key: 'squat', patch: { weight: '142.' } });
  });

  it('says what is wrong under the field and stays quiet about it in the plan', async () => {
    // `WarmupProblemCode` is input-only by design. Repeating the message beside
    // the ramp would read as two separate faults on one card.
    const element = await mount({ entry: { ...SQUAT, weight: 'abc' } });
    const field = element.shadowRoot?.querySelector<PtkNumberField>(
      'ptk-number-field[data-field="weight"]',
    );
    expect(field?.error).not.toBe('');
    expect(element.shadowRoot?.querySelector('.plan')?.textContent).toContain(
      'Check the numbers above',
    );
    expect(rows(element)).toHaveLength(0);
  });

  it('asks for a weight before showing anything, rather than showing an error', async () => {
    // Nothing typed is not a mistake. An empty card that scolded a lifter for
    // not having started would be wrong on every visit.
    const element = await mount({ entry: { ...SQUAT, weight: '' } });
    expect(element.shadowRoot?.querySelector('.plan')?.textContent).toContain(
      'Enter a working weight',
    );
  });

  it('warns about an unloadable working weight and names both neighbours', async () => {
    // Shown, flagged, and offered with what surrounds it -- never silently moved
    // to a weight the lifter did not choose.
    const element = await mount({ entry: { ...SQUAT, weight: '103' }, equipment: COARSE });
    const advisories = element.shadowRoot?.querySelector('.advisories')?.textContent ?? '';
    expect(advisories).toContain('cannot be built from these plates');
    expect(advisories).toContain('The nearest are');
  });

  it('renders no empty notice when there is nothing to advise', async () => {
    // An advisory whose sentence comes back empty is a coloured box saying
    // nothing, which reads as a warning a lifter cannot act on.
    const element = await mount();
    for (const notice of element.shadowRoot?.querySelectorAll('ptk-notice') ?? []) {
      expect(notice.textContent.trim()).not.toBe('');
    }
  });

  it('reports a tick by index and leaves the row on the list', async () => {
    // Struck through, never hidden: a list that shortens under a thumb moves the
    // next row under the finger that is still moving.
    const element = await mount();
    const seen = watch(SET_TOGGLE_EVENT);
    const box = rows(element)[0]?.querySelector('input');
    if (!(box instanceof HTMLInputElement)) throw new Error('No checkbox in the first row.');
    box.click();

    expect(seen).toEqual([{ key: 'squat', index: 0 }]);

    element.completion = new Set([markKey('squat', 0)]);
    await element.updateComplete;
    expect(rows(element)[0]?.classList.contains('done')).toBe(true);
    expect(rows(element).length).toBeGreaterThan(1);
  });

  it('reports moving and removing, and disables the moves at the ends', async () => {
    const element = await mount({ first: true, last: true });
    expect(control(element, 'Move Squat earlier').disabled).toBe(true);
    expect(control(element, 'Move Squat later').disabled).toBe(true);

    const moves = watch(LIFT_MOVE_EVENT);
    press(control(element, 'Move Squat earlier'));
    expect(moves).toEqual([]);

    element.first = false;
    await element.updateComplete;
    press(control(element, 'Move Squat earlier'));
    expect(moves).toEqual([{ key: 'squat', direction: -1 }]);

    const removals = watch(LIFT_REMOVE_EVENT);
    press(control(element, 'Remove Squat'));
    expect(removals).toEqual([{ key: 'squat' }]);
  });

  it('offers a bar of its own and says which one the setup would give it', async () => {
    // A lifter squats with one bar and benches with another, so the override is
    // per lift -- and the folded summary has to say what the card is using now,
    // not what it could use.
    const element = await mount();
    const fold = element.shadowRoot?.querySelector('.bar ptk-disclosure');
    expect(fold?.getAttribute('summary')).toContain('Same as the setup');

    const seen = watch(LIFT_CHANGE_EVENT);
    const radios = element.shadowRoot
      ?.querySelector('ptk-choice-group[data-field="bar"]')
      ?.shadowRoot?.querySelectorAll('input');
    const womens = [...(radios ?? [])].find((input) => input.value === 'womens-15');
    if (womens === undefined) throw new Error('No bar option for the 15 kg bar.');
    womens.click();

    expect(seen.at(-1)).toEqual({ key: 'squat', patch: { barId: 'womens-15' } });
  });

  it('keeps the calculated weights folded away and says so while they are', async () => {
    // The fold hides whether the numbers above are the calculator's or the
    // lifter's, so the summary has to answer that without being opened.
    const element = await mount();
    const fold = element.shadowRoot?.querySelector('.adjust ptk-disclosure');
    expect(fold?.getAttribute('summary')).toBe('Calculated weights');
  });

  it('numbers the movable warm-ups from one, past the bar-only sets', async () => {
    // The squat ramp opens on the empty bar. Numbering the fold from the plan
    // would offer "warm-up 3" for a row the checklist calls the first warm-up.
    const element = await mount();
    await openAdjust(element);

    expect(rows(element)[0]?.textContent).toContain('Empty bar');
    const names = texts(element, '.tweak-name');
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(names.map((_, at) => `Warm-up ${String(at + 1)}`));
  });

  it('moves one warm-up to the next weight the plates can build', async () => {
    const element = await mount();
    await openAdjust(element);
    const before = texts(element, '.tweak-total');
    const seen = watch(LIFT_CHANGE_EVENT);

    press(stepper(element, 'Raise', 1));

    const adjustments = seen.at(-1)?.patch.adjustments;
    if (adjustments === undefined) throw new Error('A press should report the whole list.');
    expect(adjustments).toHaveLength(1);

    // The card holds nothing, so the move only happens once the session hands
    // the entry back -- which is the half a test of the event alone would miss.
    element.entry = { ...SQUAT, adjustments };
    await element.updateComplete;
    await openAdjust(element);

    const after = texts(element, '.tweak-total');
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));

    const fold = element.shadowRoot?.querySelector('.adjust ptk-disclosure');
    expect(fold?.getAttribute('summary')).toBe(`1 of ${String(after.length)} set by you`);

    // The checklist has to say it too. A lifter reading the ramp between sets is
    // not going to open the fold to find out whose number they are looking at.
    const marked = rows(element).filter((row) => row.textContent.includes('Your weight'));
    expect(marked).toHaveLength(1);
  });

  it('will not step a warm-up below the empty bar', async () => {
    // The bar is a real answer and there is nothing under it, so the control has
    // to be disabled rather than offering a press that does nothing.
    const element = await mount({ entry: { ...SQUAT, weight: '225' }, equipment: COARSE });
    await openAdjust(element);
    const seen = watch(LIFT_CHANGE_EVENT);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const lower = stepper(element, 'Lower', 1);
      if (lower.disabled) break;
      press(lower);
      const adjustments = seen.at(-1)?.patch.adjustments;
      if (adjustments === undefined) throw new Error('A press should report the whole list.');
      element.entry = { ...SQUAT, weight: '225', adjustments };
      await element.updateComplete;
      await openAdjust(element);
    }

    const lower = stepper(element, 'Lower', 1);
    expect(lower.disabled).toBe(true);
    expect(texts(element, '.tweak-total')[0]).toBe('45 lb');
    // No destination to name, so the clause naming one is dropped rather than
    // left dangling on a control that cannot go anywhere.
    expect(lower.getAttribute('accessible-name')).toBe('Lower warm-up 1 for Squat');
  });

  it('offers the calculated weights back only once something has been changed', async () => {
    const element = await mount();
    await openAdjust(element);
    expect(reset(element).textContent).toContain('Use the calculated weights');
    expect(reset(element).disabled).toBe(true);

    const seen = watch(LIFT_CHANGE_EVENT);
    press(stepper(element, 'Raise', 1));
    const adjustments = seen.at(-1)?.patch.adjustments;
    if (adjustments === undefined) throw new Error('A press should report the whole list.');
    element.entry = { ...SQUAT, adjustments };
    await element.updateComplete;
    await openAdjust(element);

    expect(reset(element).disabled).toBe(false);
    press(reset(element));
    expect(seen.at(-1)).toEqual({ key: 'squat', patch: { adjustments: [] } });
  });

  it('keeps the steppers out of the rows a thumb ticks', async () => {
    // A stepper inside a checklist row would be a press that also marks the set
    // as done, on the one screen where a mis-tap costs a lifter their place.
    const element = await mount();
    await openAdjust(element);
    expect(element.shadowRoot?.querySelector('.adjust')?.closest('label')).toBe(null);

    const ticks = watch(SET_TOGGLE_EVENT);
    press(stepper(element, 'Raise', 1));
    expect(ticks).toEqual([]);
  });

  it('names the weight each stepper lands on, and names the lift as well', async () => {
    // Without the destination in the name a screen-reader user has to hunt for
    // the new figure after every press, and a live region announcing it would
    // talk over a checklist being read between sets. The lift is in the name
    // because a session holds several cards and every one of them has a warm-up 1.
    const element = await mount();
    await openAdjust(element);
    expect(stepper(element, 'Raise', 1).getAttribute('accessible-name')).toMatch(
      /^Raise warm-up 1 for Squat to [\d.]+ lb$/u,
    );
    expect(stepper(element, 'Lower', 1).getAttribute('accessible-name')).toMatch(
      /^Lower warm-up 1 for Squat to [\d.]+ lb$/u,
    );
  });

  it('has no accessibility violations with a full ramp on screen', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('has no accessibility violations with the adjustment fold open', async () => {
    const element = await mount();
    await openAdjust(element);
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('keeps every checklist row at the tap-target minimum in a phone-width column', async () => {
    // The row is the target, not the box inside it. A lifter taps this between
    // sets with chalk on their hands.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-lift-card');
    element.entry = SQUAT;
    element.equipment = DEFAULT_EQUIPMENT;
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    for (const row of rows(element)) {
      expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
