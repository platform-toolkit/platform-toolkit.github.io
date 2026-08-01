import type { PtkButton, PtkNumberField } from '@platform-toolkit/ui';
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

    expect(element.shadowRoot?.textContent).toContain('180 kg');
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
    const coarse: Equipment = {
      ...DEFAULT_EQUIPMENT,
      inventory: {
        ...DEFAULT_EQUIPMENT.inventory,
        kg: [{ weight: 25, pairs: null, fullDiameter: true }],
      },
    };
    const element = await mount({ entry: { ...SQUAT, weight: '103' }, equipment: coarse });
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

  it('has no accessibility violations with a full ramp on screen', async () => {
    const element = await mount();
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
