import type { Lift } from '@platform-toolkit/data-contracts';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RECORD_SCOPE_CHANGE_EVENT,
  type PtkTargetRecords,
  type RecordScopeChangeDetail,
} from './ptk-target-records.js';
import type { RecordScopeField } from './record-scope.js';
import { ANSWERED, BOOK, CATALOG, bookOf, record } from './records-fixture.js';
import { LIFTS, NO_ENTRIES, setEntryUnit, typeLift, type LiftEntries } from './standards.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * Every sentence and every figure is already tested against `record-scope.ts`
 * and `record-standings.ts` in the node project, where both are plain data.
 * What is left here is the part a simulation gets wrong: three radio groups in
 * their own shadow roots inside this one, an answer that has to cross both
 * boundaries before it is recorded, and a question that appears and disappears
 * depending on the answer above it.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

function entriesOf(typed: Partial<Record<Lift, string>>, unit: 'kg' | 'lb' = 'kg'): LiftEntries {
  let entries = setEntryUnit(NO_ENTRIES, unit);
  for (const lift of LIFTS) {
    const text = typed[lift];
    if (text !== undefined) {
      entries = typeLift(entries, lift, text);
    }
  }
  return entries;
}

async function mount(
  properties: Partial<PtkTargetRecords> = {},
  width?: number,
): Promise<PtkTargetRecords> {
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

  const element = document.createElement('ptk-target-records');
  element.catalog = CATALOG;
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

function group(element: PtkTargetRecords, field: RecordScopeField): Element | null {
  return (
    element.shadowRoot?.querySelector(`ptk-choice-group[data-record-field="${field}"]`) ?? null
  );
}

/**
 * Answers a question the way a thumb does.
 *
 * By the radio's `.value` property rather than by an attribute selector: the
 * group sets the value as a property, so `input[value="state"]` matches nothing
 * and a test written that way throws on the click rather than failing on the
 * assertion it was about.
 */
async function answer(
  element: PtkTargetRecords,
  field: RecordScopeField,
  value: string,
): Promise<void> {
  const question = group(element, field);
  if (question === null) {
    throw new Error(`No "${field}" question is being asked.`);
  }
  const radios = [...(question.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [])];
  const found = radios.find((radio) => radio instanceof HTMLInputElement && radio.value === value);
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`No "${field}" choice offered for "${value}".`);
  }
  found.click();
  await element.updateComplete;
}

/** A whole record card, found by the lift it is about. */
function card(element: PtkTargetRecords, label: string): Element {
  const found = [...(element.shadowRoot?.querySelectorAll('.record') ?? [])].find(
    (candidate) => candidate.querySelector('h3')?.textContent.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`No card rendered for "${label}".`);
  }
  return found;
}

function text(node: Node | null | undefined): string {
  return (node?.textContent ?? '').replaceAll(/\s+/gu, ' ').trim();
}

/** Both questions answered, which is what every card-level assertion needs. */
async function scoped(element: PtkTargetRecords): Promise<void> {
  await answer(element, 'level', 'national');
  await answer(element, 'discipline', 'full-power');
}

describe('ptk-target-records', () => {
  it('records an answer that crossed two shadow boundaries', async () => {
    // The composed-path case. A listener reading `event.target` sees it
    // retargeted to this host, so nothing is recorded and the panel looks inert
    // while the radios visibly respond.
    const element = await mount();
    await answer(element, 'level', 'national');

    const chosen = group(element, 'level')?.shadowRoot?.querySelector<HTMLInputElement>(
      'input:checked',
    );
    expect(chosen?.value).toBe('national');
  });

  it('asks for the region only once a subdivided level is chosen', async () => {
    const element = await mount();
    expect(group(element, 'region')).toBeNull();

    await answer(element, 'level', 'state');
    expect(group(element, 'region')).not.toBeNull();
  });

  it('asks nothing about a region for a level that is not subdivided', async () => {
    // Not an empty "Region" group under "National". There is one national
    // record, and an empty question reads as missing data where this is the
    // complete and correct state.
    const element = await mount();
    await answer(element, 'level', 'national');
    expect(group(element, 'region')).toBeNull();
  });

  it('announces the partition its answers point at', async () => {
    // The event carries the partition rather than the three strings, because the
    // resolver is the only thing that knows an unsubdivided level is settled
    // without a region -- a listener re-deriving that would ask for an artifact
    // nobody published the day a federation subdivides a level it used not to.
    const element = await mount();
    const seen: RecordScopeChangeDetail[] = [];
    element.addEventListener(RECORD_SCOPE_CHANGE_EVENT, (event) => {
      seen.push(event.detail);
    });

    await answer(element, 'level', 'state');
    expect(seen.at(-1)?.partition).toBeNull();

    await answer(element, 'region', 'south-example');
    expect(seen.at(-1)?.partition).toEqual({ levelId: 'state', regionId: 'south-example' });
  });

  it('draws one card per lift the chosen event contests', async () => {
    const element = await mount();
    await answer(element, 'level', 'national');
    await answer(element, 'discipline', 'push-pull');

    const labels = [...(element.shadowRoot?.querySelectorAll('.record h3') ?? [])].map((heading) =>
      heading.textContent.trim(),
    );
    expect(labels).toEqual(['Bench press', 'Deadlift', 'Total']);
  });

  it('draws no cards at all before an event is chosen', async () => {
    // Said once, above the questions, rather than as a row of empty cards: the
    // event decides which lifts even have records here.
    const element = await mount();
    expect(element.shadowRoot?.querySelectorAll('.record')).toHaveLength(0);
    expect(text(element.shadowRoot?.querySelector('ptk-notice'))).toContain(
      'Choose a record level and event',
    );
  });

  it('shows the record and who holds it', async () => {
    const element = await mount();
    await scoped(element);

    expect(text(card(element, 'Squat').querySelector('.figure'))).toBe('145 kg');
    expect(text(card(element, 'Squat').querySelector('.holder'))).toBe(
      'Robin Vance · 2024-05-18 · Example Winter Open',
    );
  });

  it('leaves the date in the form the federation published it', async () => {
    // These tools are read in every region the federation runs meets in, and
    // 03/04/2022 is two different days depending on who is holding the phone.
    const element = await mount();
    await scoped(element);

    const stamp = card(element, 'Squat').querySelector('time');
    expect(stamp?.getAttribute('datetime')).toBe('2024-05-18');
    expect(stamp?.textContent.trim()).toBe('2024-05-18');
  });

  it('says nothing about a holder the source does not name', async () => {
    const element = await mount({
      book: bookOf([
        record('squat', { kilograms: 145, holderName: null, achievedOn: null, meetName: null }),
      ]),
    });
    await scoped(element);

    expect(card(element, 'Squat').querySelector('.holder')).toBeNull();
  });

  it('says a record nobody holds is there to be taken', async () => {
    // Not the same screen as a holder the source failed to publish, which is
    // silence. A federation seeds a new category with a figure to clear, and the
    // name-shaped gap is the most encouraging thing on the card.
    const element = await mount({
      book: bookOf([record('squat', { kilograms: 145, unclaimed: true })]),
    });
    await scoped(element);

    expect(text(card(element, 'Squat').querySelector('.holder'))).toBe(
      'No lifter has claimed this record yet.',
    );
    // Still a record, so still measured. Reading it as an empty category would
    // tell a lifter any qualifying weight sets the first one.
    expect(text(card(element, 'Squat').querySelector('.figure'))).toBe('145 kg');
  });

  it('measures a typed lift against the record', async () => {
    const element = await mount({ entries: entriesOf({ squat: '140' }) });
    await scoped(element);

    expect(text(card(element, 'Squat').querySelector('.summary'))).toBe(
      '5.5 kg more replaces it, at 145.5 kg.',
    );
  });

  it('re-measures when the lifts change after the first render', async () => {
    // The canary for Lit's decorator configuration: with it misconfigured every
    // other test here still passes and the panel never updates -- and this is the
    // property that changes on every keystroke in the panel above.
    const element = await mount();
    await scoped(element);
    expect(text(card(element, 'Squat').querySelector('.summary'))).toBe('145.5 kg replaces it.');

    element.entries = entriesOf({ squat: '150' });
    await element.updateComplete;

    expect(text(card(element, 'Squat').querySelector('.summary'))).toBe(
      'This would replace the record, at 145.5 kg.',
    );
  });

  it('says a category with no record is one to set', async () => {
    const element = await mount();
    await scoped(element);

    const deadlift = card(element, 'Deadlift');
    expect(deadlift.querySelector('.figure')).toBeNull();
    expect(text(deadlift.querySelector('.summary'))).toBe(
      'No record stands in this category. The first qualifying lift sets one.',
    );
  });

  it('does not claim a federation keeps no records while the read is in flight', async () => {
    // Four cards all saying "no record stands here" is a much more interesting
    // statement than "loading", and it is the one a lifter would act on.
    const element = await mount({ book: null, status: 'loading' });
    await scoped(element);
    expect(text(element.shadowRoot?.querySelector('ptk-notice'))).toContain('Loading the records');
  });

  it('says the read failed rather than showing empty cards', async () => {
    const element = await mount({ book: null, status: 'failed' });
    await scoped(element);
    expect(text(element.shadowRoot?.querySelector('ptk-notice'))).toContain('could not be loaded');
  });

  it('waits for the categories rather than asking questions it cannot answer', async () => {
    const element = await mount({ catalog: null });
    expect(text(element.shadowRoot)).toContain('once this federation');
    expect(group(element, 'level')).toBeNull();
  });

  it('asks for the rest of the category before it shows any record', async () => {
    const element = await mount({ selection: { ...ANSWERED, division: null } });
    await scoped(element);

    expect(text(card(element, 'Squat').querySelector('.summary'))).toBe(
      'Answer every question above to see the records for this category.',
    );
  });

  it('keeps an answer the current level cannot offer, for when the lifter comes back', async () => {
    // Two clicks: a lifter looks at their state records, checks the national
    // tables, and returns. Storing the resolved answer instead of the request
    // would have silently dropped their region on the way past.
    const element = await mount();
    await answer(element, 'level', 'state');
    await answer(element, 'region', 'south-example');
    await answer(element, 'level', 'national');
    await answer(element, 'level', 'state');

    const chosen = group(element, 'region')?.shadowRoot?.querySelector<HTMLInputElement>(
      'input:checked',
    );
    expect(chosen?.value).toBe('south-example');
  });

  it.each(['ready', 'loading', 'failed'] as const)(
    'has no accessibility violations while %s',
    async (status) => {
      // `color-contrast` is off for the same reason as everywhere else: it
      // depends on the page background this element does not control.
      const element = await mount({ status, ...(status === 'ready' ? {} : { book: null }) });
      await scoped(element);
      const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    },
  );

  it('fits a phone-width column with every card on screen', async () => {
    // Five things to say about a record and 320 pixels to say them in. A table
    // here is either a sideways scroll or a four-character truncation, which is
    // why these are cards.
    const element = await mount({ entries: entriesOf({ squat: '140', bench: '80' }) }, 320);
    await scoped(element);

    const frame = element.parentElement;
    expect(frame?.scrollWidth).toBeLessThanOrEqual(frame?.clientWidth ?? 0);
  });
});
