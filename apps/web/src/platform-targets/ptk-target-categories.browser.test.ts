import type { CategoryCatalog, WeightClassLadderData } from '@platform-toolkit/data-contracts';
import type { PtkChoiceGroup } from '@platform-toolkit/ui';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SELECTION_CHANGE_EVENT,
  type PtkTargetCategories,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import './ptk-target-categories.js';
import type { SelectionField } from './selection.js';

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * This is the first test of a *composed* interface rather than a single
 * component, and composition is where the emulated-DOM shortcuts stop being
 * survivable: the choice groups live in their own shadow roots inside this one,
 * and the whole selection mechanism depends on an event crossing both
 * boundaries. A simulation that got that subtly wrong would leave a green suite
 * and an inert page.
 */

/** Invented figures. Real boundaries belong in published data. */
const FEMALE_LADDER: WeightClassLadderData = {
  id: 'example-female',
  label: 'Female classes',
  sex: 'female',
  classes: [
    { id: 'f-56', label: '56 kg', maximumKilograms: 56 },
    { id: 'f-plus', label: '56+ kg', maximumKilograms: null },
  ],
};

const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [{ id: 'raw', label: 'Raw' }],
  weightClassLadders: [
    FEMALE_LADDER,
    {
      id: 'example-male',
      label: 'Male classes',
      sex: 'male',
      classes: [{ id: 'm-75', label: '75 kg', maximumKilograms: 75 }],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
    ],
  },
};

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(properties: Partial<PtkTargetCategories> = {}): Promise<PtkTargetCategories> {
  const element = document.createElement('ptk-target-categories');
  element.catalog = CATALOG;
  element.status = 'ready';
  Object.assign(element, properties);
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

function group(element: PtkTargetCategories, field: SelectionField): PtkChoiceGroup {
  const found = element.shadowRoot?.querySelector<PtkChoiceGroup>(
    `ptk-choice-group[data-field="${field}"]`,
  );
  if (found === null || found === undefined) {
    throw new Error(`No choice group rendered for "${field}".`);
  }
  return found;
}

/** Clicks an option the way a visitor would: on the radio itself. */
async function choose(
  element: PtkTargetCategories,
  field: SelectionField,
  value: string,
): Promise<void> {
  const radios = group(element, field).shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" in the "${field}" group.`);
}

function labels(element: PtkTargetCategories, field: SelectionField): string[] {
  const options = group(element, field).shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  return [...options]
    .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    .map((radio) => radio.value);
}

describe('ptk-target-categories', () => {
  it('asks every question the catalogue supports', async () => {
    const element = await mount();
    const fields = [...(element.shadowRoot?.querySelectorAll('ptk-choice-group') ?? [])].map(
      (node) => node.dataset['field'],
    );
    expect(fields).toEqual(['sex', 'equipment', 'weightClass', 'division']);
  });

  it('says it is loading before the catalogue arrives', async () => {
    // The embed route reports its height to the parent page as soon as it can.
    // Rendering nothing here would report a height of zero and then jump.
    const element = await mount({ status: 'loading', catalog: null });
    expect(element.shadowRoot?.textContent).toContain('Loading');
    expect(element.shadowRoot?.querySelector('ptk-choice-group')).toBeNull();
  });

  it.each([
    ['unavailable', 'have not been published'],
    ['failed', 'could not be loaded'],
  ] as const)('distinguishes %s from an empty set of questions', async (status, text) => {
    // Three different situations, three different sentences. Rendering an empty
    // question list for all of them looks like a working page asking nothing.
    const element = await mount({ status, catalog: null });
    expect(element.shadowRoot?.textContent).toContain(text);
  });

  it('renders the notice, not the questions, when ready arrives with no catalogue', async () => {
    const element = await mount({ status: 'ready', catalog: null });
    expect(element.shadowRoot?.querySelector('ptk-choice-group')).toBeNull();
  });

  it('re-renders when the catalogue is set after the first render', async () => {
    // The canary for Lit's decorator configuration. This is the only kind of
    // test that fails when `experimentalDecorators` and `useDefineForClassFields`
    // are set inconsistently -- everything else passes and the page never updates.
    const element = await mount({ status: 'loading', catalog: null });
    element.catalog = CATALOG;
    element.status = 'ready';
    await element.updateComplete;

    expect(element.shadowRoot?.querySelectorAll('ptk-choice-group')).toHaveLength(4);
  });

  it('offers no weight classes until a sex category is chosen', async () => {
    const element = await mount();
    expect(labels(element, 'weightClass')).toEqual([]);
    expect(group(element, 'weightClass').shadowRoot?.textContent).toContain(
      'Choose a sex category',
    );
  });

  it('fills the weight classes in from the ladder once a sex category is chosen', async () => {
    const element = await mount();
    await choose(element, 'sex', 'female');
    expect(labels(element, 'weightClass')).toEqual(['f-56', 'f-plus']);
  });

  it('clears a weight class that belongs to the other ladder', async () => {
    // The reason the event crossing two shadow boundaries matters: without it
    // the class stays selected, and every record shown afterwards is for a
    // category the lifter is not in.
    const element = await mount();
    await choose(element, 'sex', 'female');
    await choose(element, 'weightClass', 'f-56');
    expect(group(element, 'weightClass').value).toBe('f-56');

    await choose(element, 'sex', 'male');
    expect(group(element, 'weightClass').value).toBeNull();
  });

  it('keeps the answers that did not depend on the one that changed', async () => {
    const element = await mount();
    await choose(element, 'equipment', 'raw');
    await choose(element, 'sex', 'female');
    await choose(element, 'sex', 'male');

    expect(group(element, 'equipment').value).toBe('raw');
  });

  it('restores a class that was only hidden by a detour through the other ladder', async () => {
    // The request is kept, not the resolved answer. A lifter who looks at the
    // other ladder and comes back has not changed their mind about their class.
    const element = await mount();
    await choose(element, 'sex', 'female');
    await choose(element, 'weightClass', 'f-56');
    await choose(element, 'sex', 'male');
    await choose(element, 'sex', 'female');

    expect(group(element, 'weightClass').value).toBe('f-56');
  });

  it('reports the category, and whether it is complete, outside the shadow root', async () => {
    const element = await mount();
    const seen: SelectionChangeDetail[] = [];
    const listener = (event: CustomEvent<SelectionChangeDetail>): void => {
      seen.push(event.detail);
    };
    // On the body, outside the element entirely: the point of the assertion is
    // that the event left the shadow root, which a listener on the element
    // itself would not prove.
    document.body.addEventListener(SELECTION_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(SELECTION_CHANGE_EVENT, listener);
    });

    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await choose(element, 'weightClass', 'f-56');
    expect(seen.at(-1)).toEqual({
      selection: { sex: 'female', equipment: 'raw', weightClass: 'f-56', division: null },
      complete: false,
    });

    await choose(element, 'division', 'open');
    expect(seen.at(-1)?.complete).toBe(true);
  });

  it('names what is still missing in a live region', async () => {
    const element = await mount();
    const status = element.shadowRoot?.querySelector('[role="status"]');
    expect(status?.textContent).toContain('sex category');

    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await choose(element, 'weightClass', 'f-56');
    await choose(element, 'division', 'open');

    expect(element.shadowRoot?.querySelector('[role="status"]')?.textContent).toContain(
      'Category complete',
    );
  });

  it('shows the age band the catalogue published alongside the division', async () => {
    const element = await mount();
    expect(group(element, 'division').shadowRoot?.textContent).toContain('40 to 49');
  });

  it.each(['ready', 'loading', 'unavailable'] as const)(
    'has no accessibility violations while %s',
    async (status) => {
      // `color-contrast` is off here for the same reason it is off in the shared
      // component tests: it depends on the page background this element does not
      // control, and belongs in the end-to-end pass over the built site.
      const element = await mount({ status, ...(status === 'ready' ? {} : { catalog: null }) });
      const results = await axe.run(element, {
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(results.violations).toEqual([]);
    },
  );

  it('fits a phone-width column with every question answered', async () => {
    // The composed case, which the shared component's own tests cannot cover:
    // four groups stacked, the longest labels the catalogue produces, and the
    // outstanding-status line underneath. A phone is where this tool is used --
    // at a warm-up rack, on a platform floor -- so the narrow layout is the one
    // that has to hold, and horizontal scroll is the failure it fails with.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = document.createElement('ptk-target-categories');
    element.catalog = CATALOG;
    element.status = 'ready';
    frame.append(element);
    await element.updateComplete;
    await choose(element, 'sex', 'female');

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
