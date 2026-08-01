import type { ClassificationBook, Lift } from '@platform-toolkit/data-contracts';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import './ptk-target-standards.js';
import type { PtkTargetStandards } from './ptk-target-standards.js';
import type { CategorySelection } from './selection.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * The arithmetic and every sentence are tested against `standards.ts` in the
 * node project, where they are plain data. What is left for a browser is the
 * part a simulation gets subtly wrong: four fields in their own shadow roots
 * inside this one, and an input event that has to cross both boundaries before
 * anything is recorded.
 */

/** Invented figures. Real standards belong in published data. */
function table(lift: Lift): ClassificationBook['tables'][number] {
  return {
    id: `example-${lift}`,
    label: `Example ${lift}`,
    scope: {
      sex: 'female',
      lift,
      equipmentId: null,
      weightClassId: null,
      divisionId: null,
      tested: null,
    },
    standards: [
      { id: 'third', label: 'Class III', rank: 0, requiredKilograms: 100 },
      { id: 'second', label: 'Class II', rank: 1, requiredKilograms: 120 },
    ],
  };
}

const BOOK: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [table('squat'), table('bench'), table('deadlift'), table('total')],
};

const ANSWERED: CategorySelection = {
  sex: 'female',
  equipment: 'raw',
  weightClass: 'f-56',
  division: 'open',
  tested: 'tested',
};

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<PtkTargetStandards> = {},
  width?: number,
): Promise<PtkTargetStandards> {
  const parent =
    width === undefined
      ? document.body
      : (() => {
          const frame = document.createElement('div');
          frame.style.width = `${String(width)}px`;
          document.body.append(frame);
          teardown.push(() => {
            frame.remove();
          });
          return frame;
        })();

  const element = document.createElement('ptk-target-standards');
  element.book = BOOK;
  element.status = 'ready';
  element.selection = ANSWERED;
  Object.assign(element, properties);
  parent.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function field(element: PtkTargetStandards, lift: Lift): Element {
  const found = element.shadowRoot?.querySelector(`ptk-number-field[data-lift="${lift}"]`);
  if (found === null || found === undefined) {
    throw new Error(`No field rendered for "${lift}".`);
  }
  return found;
}

function input(element: PtkTargetStandards, lift: Lift): HTMLInputElement {
  // Reached through the field's own root. `closest` from the input would not get
  // back out -- it stops at the shadow boundary -- so a test written that way
  // reads `null` and asserts against `undefined` rather than failing on the
  // attribute it was about.
  const found = field(element, lift).shadowRoot?.querySelector('input');
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`No input rendered for "${lift}".`);
  }
  return found;
}

/** Types into a field the way a visitor does, event and all. */
async function type(element: PtkTargetStandards, lift: Lift, text: string): Promise<void> {
  const field = input(element, lift);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/**
 * Picks a unit the way a thumb does.
 *
 * By `.value` rather than by an attribute selector: the group sets the value as a
 * property, so `input[value="lb"]` matches nothing and a test written that way
 * throws on the click instead of failing on the assertion it was about.
 */
async function chooseUnit(element: PtkTargetStandards, unit: 'kg' | 'lb'): Promise<void> {
  const group = element.shadowRoot?.querySelector('ptk-choice-group.unit');
  const radios = [...(group?.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [])];
  const found = radios.find((radio) => radio instanceof HTMLInputElement && radio.value === unit);
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`No radio offered for "${unit}".`);
  }
  found.click();
  await element.updateComplete;
}

function summary(element: PtkTargetStandards, lift: Lift): string {
  const card = element.shadowRoot?.querySelector(
    `ptk-number-field[data-lift="${lift}"]`,
  )?.parentElement;
  return card?.querySelector('.summary')?.textContent.trim() ?? '';
}

describe('ptk-target-standards', () => {
  it('offers a field for every lift', async () => {
    const element = await mount();
    const lifts = [...(element.shadowRoot?.querySelectorAll('ptk-number-field') ?? [])].map(
      (field) => field.dataset['lift'],
    );
    expect(lifts).toEqual(['squat', 'bench', 'deadlift', 'total']);
  });

  it('records a keystroke that crossed two shadow boundaries', async () => {
    // The composed-path case. A listener reading `event.target` sees the target
    // retargeted to this host, so nothing is recorded and the panel looks inert
    // while the fields visibly accept typing.
    const element = await mount();
    await type(element, 'squat', '130');

    expect(summary(element, 'squat')).toContain('Class II');
  });

  it('re-renders when the book arrives after the first render', async () => {
    // The canary for Lit's decorator configuration: with it misconfigured every
    // other test still passes and the page never updates.
    const element = await mount({ book: null, status: 'loading' });
    expect(element.shadowRoot?.textContent).toContain('Loading');

    element.book = BOOK;
    element.status = 'ready';
    await element.updateComplete;

    expect(summary(element, 'squat')).toContain('Class III at 100 kg');
  });

  it('does not claim a federation publishes nothing while the read is in flight', async () => {
    // Four cards all saying "no standards published" is a different and much
    // more alarming statement than "loading", and it is the one a panel with no
    // notice would make for the first second of every visit.
    const element = await mount({ book: null, status: 'loading' });
    expect(element.shadowRoot?.textContent).toContain('Loading the standards');
  });

  it('says the read failed rather than showing an empty panel', async () => {
    const element = await mount({ book: null, status: 'failed' });
    expect(element.shadowRoot?.textContent).toContain('could not be loaded');
  });

  it('asks for the rest of the category before it says anything about standards', async () => {
    const element = await mount({ selection: { ...ANSWERED, division: null } });
    expect(summary(element, 'squat')).toContain('Answer every question above');
  });

  it('shows the derived total in the field, not only in the sentence', async () => {
    // A blank field under a sentence about 250 kg is the kind of gap that reads
    // as a bug, and it is the number the lifter would try to copy.
    const element = await mount();
    await type(element, 'squat', '100');
    await type(element, 'bench', '60');
    await type(element, 'deadlift', '90');

    expect(input(element, 'total').value).toBe('250');
    expect(summary(element, 'total')).toContain('From your three lifts');
  });

  it('stops deriving the total the moment one is typed', async () => {
    const element = await mount();
    await type(element, 'squat', '100');
    await type(element, 'bench', '60');
    await type(element, 'deadlift', '90');
    await type(element, 'total', '260');

    expect(input(element, 'total').value).toBe('260');
    expect(summary(element, 'total')).not.toContain('From your three lifts');
  });

  it('marks a field the visitor cannot have meant', async () => {
    const element = await mount();
    await type(element, 'squat', '1o5');

    expect(input(element, 'squat').getAttribute('aria-invalid')).toBe('true');
    expect(summary(element, 'squat')).toContain('Enter a weight in kilograms');
  });

  it('keeps what was typed in the field it was typed in', async () => {
    // The failure this guards is total: a panel that re-rendered from stale
    // state would delete each keystroke as it arrived.
    const element = await mount();
    await type(element, 'deadlift', '17');

    expect(input(element, 'deadlift').value).toBe('17');
    expect(input(element, 'squat').value).toBe('');
  });

  it('converts what is already typed when the unit changes', async () => {
    // The failure worth a browser test rather than a unit one: the panel owns the
    // entries and the fields own their own values, so a conversion that never
    // reached the field would leave "130" on screen under a sentence about a
    // number twice the size, and nothing in the pure module would notice.
    const element = await mount();
    await type(element, 'squat', '130');
    await chooseUnit(element, 'lb');

    expect(input(element, 'squat').value).toBe('286.6');
    // Still the same squat. Rereading 130 as pounds would put it at 59 kg --
    // below the first standard -- with nothing on screen to say why it moved.
    expect(summary(element, 'squat')).toContain('Class II');
  });

  it('labels the fields in the unit that was chosen', async () => {
    const element = await mount();
    await chooseUnit(element, 'lb');

    expect(field(element, 'squat').getAttribute('unit')).toBe('lb');
  });

  it('places a weight typed in pounds against the published kilograms', async () => {
    const element = await mount();
    await chooseUnit(element, 'lb');
    await type(element, 'squat', '300');

    // 300 lb is 136.1 kg, which clears the 120 kg standard. Read as 300 kg it
    // would clear it too, which is why the empty-field sentence is asserted below
    // rather than the placement alone.
    expect(summary(element, 'squat')).toContain('Class II');
    expect(summary(element, 'bench')).toBe('Class III at 220.5 lb, up to Class II at 264.6 lb.');
  });

  it('says once that the standards it converted were published in kilograms', async () => {
    const element = await mount();
    await chooseUnit(element, 'lb');

    // Whitespace collapsed: the sentence is wrapped in the template, so the line
    // break lands mid-phrase and a raw `toContain` fails on the formatting.
    const notice = (element.shadowRoot?.querySelector('ptk-notice')?.textContent ?? '')
      .replaceAll(/\s+/gu, ' ')
      .trim();
    expect(notice).toContain('publishes its standards in kilograms');
  });

  it('asks for pounds when correcting a field on a pound panel', async () => {
    // Telling somebody entering pounds to write "142.5" is an instruction to
    // enter a different lift.
    const element = await mount();
    await chooseUnit(element, 'lb');
    await type(element, 'squat', '3o0');

    expect(summary(element, 'squat')).toContain('in pounds');
  });

  it('derives the total in the unit the lifter is working in', async () => {
    const element = await mount();
    await chooseUnit(element, 'lb');
    await type(element, 'squat', '300');
    await type(element, 'bench', '200');
    await type(element, 'deadlift', '400');

    expect(input(element, 'total').value).toBe('900');
    expect(summary(element, 'total')).toContain('From your three lifts');
  });

  it.each(['ready', 'loading', 'failed'] as const)(
    'has no accessibility violations while %s',
    async (status) => {
      // `color-contrast` is off for the same reason as everywhere else: it
      // depends on the page background this element does not control.
      const element = await mount({ status, ...(status === 'ready' ? {} : { book: null }) });
      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );

  it('has none with a field in its error state', async () => {
    const element = await mount();
    await type(element, 'squat', '1o5');

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with every field filled in', async () => {
    // A phone is where this is used -- at a warm-up rack, on a platform floor --
    // so the narrow layout is the one that has to hold, and sideways scroll is
    // how it fails.
    const element = await mount({}, 320);
    await type(element, 'squat', '142.5');
    await type(element, 'bench', '82.5');
    await type(element, 'deadlift', '175');

    const frame = element.parentElement;
    expect(frame?.scrollWidth).toBeLessThanOrEqual(frame?.clientWidth ?? 0);
  });
});
