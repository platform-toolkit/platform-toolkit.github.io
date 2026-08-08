// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { CategoryCatalog, WeightClassLadderData } from '@platform-toolkit/data-contracts';
import type { PtkChoiceGroup } from '@platform-toolkit/ui/ptk-choice-group';
import type { PtkSelect } from '@platform-toolkit/ui/ptk-select';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  SELECTION_APPLIED_EVENT,
  SELECTION_CANCEL_EVENT,
  SELECTION_CHANGE_EVENT,
  type PtkTargetCategories,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import type { SelectionField } from '../types.js';
import { definePlatformTargets } from './index.js';

beforeAll(() => {
  definePlatformTargets();
});

/**
 * Real browser, real custom elements, real Shadow DOM.
 *
 * This is the first test of a *composed* interface rather than a single
 * component, and composition is where the emulated-DOM shortcuts stop being
 * survivable: the controls live in their own shadow roots inside this one, and
 * the whole selection mechanism depends on an event crossing both boundaries. A
 * simulation that got that subtly wrong would leave a green suite and an inert
 * page.
 *
 * TWO KINDS OF CONTROL, AND THE TESTS HAVE TO KNOW WHICH
 *
 * Three questions are tiles and the rest are selects, decided by how much room
 * the *answers* need rather than by what the question is about. So there are two
 * sets of helpers here, and using the wrong one does not fail with "no such
 * option" -- `querySelector('ptk-choice-group[data-field="division"]')` simply
 * returns nothing and the helper throws, which is the only reason that mistake
 * is survivable. Keep them throwing.
 */

/** Invented figures. Real boundaries belong in published data. */
const FEMALE_LADDER: WeightClassLadderData = {
  id: 'example-female',
  label: 'Female classes',
  sex: 'female',
  classes: [
    { id: 'f-52', label: '52 kg', maximumKilograms: 52 },
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
      // Both ages null, so this one reaches every other division and is
      // identified as Open structurally. The published USPA set writes Open as
      // 13 and over instead, which the resolver's own tests cover -- what
      // matters here is that the picker never offers whichever one it is.
      { id: 'open', label: 'Open', minimumAge: null, maximumAge: null },
      { id: 'masters-1', label: 'Masters 1', minimumAge: 40, maximumAge: 49 },
    ],
  },

  // One level, not subdivided, so no region picker is drawn at all. The
  // subdivided case belongs in `selection.test.ts`, which can reach it without a
  // browser.
  levels: [{ id: 'national', label: 'National', regions: [] }],
  disciplines: [
    { id: 'full-power', label: 'Full power', lifts: ['squat', 'bench', 'deadlift', 'total'] },
  ],
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

function picker(element: PtkTargetCategories, field: SelectionField): PtkSelect {
  const found = element.shadowRoot?.querySelector<PtkSelect>(`ptk-select[data-field="${field}"]`);
  if (found === null || found === undefined) {
    throw new Error(`No select rendered for "${field}".`);
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

/**
 * The native control inside a picker.
 *
 * Absent when the picker has no options -- it renders its empty message instead
 * of a control the visitor could open onto nothing -- so this throws rather than
 * returning null, and a test that meant to assert emptiness reads the empty
 * message directly.
 */
function control(element: PtkTargetCategories, field: SelectionField): HTMLSelectElement {
  const found = picker(element, field).shadowRoot?.querySelector('select');
  if (found === null || found === undefined) {
    throw new Error(`The "${field}" select has no options to open.`);
  }
  return found;
}

/**
 * Answers a picker, or clears it by passing `null`.
 *
 * A select cannot be "clicked" into a value: the visitor's interaction opens a
 * platform picker this test has no access to, so the value is set and `change`
 * is fired, which is exactly what that picker does on the way out. Firing
 * `input` instead would pass here and miss nothing on Chromium and everything on
 * an engine that only emits one of the two.
 */
async function pick(
  element: PtkTargetCategories,
  field: SelectionField,
  value: string | null,
): Promise<void> {
  const select = control(element, field);
  const wanted = value ?? '';
  if (![...select.options].some((option) => option.value === wanted)) {
    throw new Error(`No option "${wanted}" in the "${field}" select.`);
  }
  select.value = wanted;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await element.updateComplete;
}

function choiceValues(element: PtkTargetCategories, field: SelectionField): string[] {
  const options = group(element, field).shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  return [...options]
    .filter((node): node is HTMLInputElement => node instanceof HTMLInputElement)
    .map((radio) => radio.value);
}

/** Every answer a picker offers, with the placeholder dropped. */
function optionValues(element: PtkTargetCategories, field: SelectionField): string[] {
  const found = picker(element, field).shadowRoot?.querySelector('select');
  if (found === null || found === undefined) {
    return [];
  }
  return [...found.options].map((option) => option.value).filter((value) => value !== '');
}

function fieldsOf(element: PtkTargetCategories, selector: string): (string | undefined)[] {
  return [...(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])].map(
    (node) => node.dataset['field'],
  );
}

function statusText(element: PtkTargetCategories): string {
  return element.shadowRoot?.querySelector('[role="status"]')?.textContent ?? '';
}

/**
 * The native button inside one of the two actions.
 *
 * Not the `ptk-button` host: a click on the host is not the click a visitor
 * makes, and the delegated listener reads the composed path of the press that
 * originates on the real control inside the shared element's shadow root. It
 * also means a disabled action is genuinely unclickable here, the same way it is
 * on the page, rather than being a property this test agrees to respect.
 */
function action(element: PtkTargetCategories, name: 'apply' | 'cancel'): HTMLButtonElement {
  const host = element.shadowRoot?.querySelector(`ptk-button[data-action="${name}"]`);
  if (host === null || host === undefined) {
    throw new Error(`No "${name}" action rendered.`);
  }
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`The "${name}" action rendered no button.`);
  }
  return button;
}

async function press(element: PtkTargetCategories, name: 'apply' | 'cancel'): Promise<void> {
  action(element, name).click();
  await element.updateComplete;
}

/**
 * Records every committed category.
 *
 * On the body, like the draft watcher above and for the same reason: the event
 * has to cross this element's shadow boundary to reach the tool that swaps the
 * screen, and a listener on the element itself would hold either way. Typed
 * through the augmented `HTMLElementEventMap` rather than by casting the detail
 * -- a cast keeps compiling the day the detail changes shape.
 */
function watchApplied(): SelectionChangeDetail[] {
  const seen: SelectionChangeDetail[] = [];
  const listener = (event: CustomEvent<SelectionChangeDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(SELECTION_APPLIED_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(SELECTION_APPLIED_EVENT, listener);
  });
  return seen;
}

/** Records every abandoned edit, as whole events: the claim is that they carry nothing. */
function watchCancelled(): CustomEvent<void>[] {
  const seen: CustomEvent<void>[] = [];
  const listener = (event: CustomEvent<void>): void => {
    seen.push(event);
  };
  document.body.addEventListener(SELECTION_CANCEL_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(SELECTION_CANCEL_EVENT, listener);
  });
  return seen;
}

/** The four answers that make the action pressable, and nothing optional. */
async function answerRequired(element: PtkTargetCategories): Promise<void> {
  await choose(element, 'sex', 'female');
  await choose(element, 'equipment', 'raw');
  await choose(element, 'tested', 'tested');
  await pick(element, 'weightClass', 'f-56');
}

describe('ptk-target-categories', () => {
  /**
   * Requirement 1, as an assertion rather than a screenshot. The two questions
   * that ruined the screen were the age divisions (seventeen bands) and the
   * states (fifty), and both of them are now selects -- so what this pins is
   * *which control each question got*, which is the decision, and not how any of
   * them looks.
   */
  it('asks the short questions as tiles', async () => {
    const element = await mount();
    expect(fieldsOf(element, 'ptk-choice-group')).toEqual(['sex', 'equipment', 'tested']);
  });

  it('asks the long questions as selects', async () => {
    const element = await mount();
    expect(fieldsOf(element, 'ptk-select')).toEqual([
      'weightClass',
      'comparisonWeightClass',
      'division',
    ]);
  });

  /**
   * Requirement 3's other half. This catalogue subdivides no level, so there is
   * no region to ask about and the question is omitted entirely rather than
   * rendered as a control with nothing in it -- an empty control reads as a
   * federation with no states rather than as a question that does not apply.
   */
  it('omits the region question when no level is subdivided', async () => {
    const element = await mount();
    expect(element.shadowRoot?.querySelector('ptk-select[data-field="region"]')).toBeNull();
  });

  it('says it is loading before the catalogue arrives', async () => {
    // The embed route reports its height to the parent page as soon as it can.
    // Rendering nothing here would report a height of zero and then jump.
    const element = await mount({ status: 'loading', catalog: null });
    expect(element.shadowRoot?.textContent).toContain('Loading');
    expect(element.shadowRoot?.querySelector('ptk-choice-group')).toBeNull();
    expect(element.shadowRoot?.querySelector('ptk-select')).toBeNull();
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

    expect(element.shadowRoot?.querySelectorAll('ptk-choice-group')).toHaveLength(3);
    expect(element.shadowRoot?.querySelectorAll('ptk-select')).toHaveLength(3);
  });

  it('offers no weight classes until a sex category is chosen', async () => {
    const element = await mount();
    expect(optionValues(element, 'weightClass')).toEqual([]);
    expect(picker(element, 'weightClass').shadowRoot?.textContent).toContain(
      'Choose a sex category',
    );
  });

  it('fills the weight classes in from the ladder once a sex category is chosen', async () => {
    const element = await mount();
    await choose(element, 'sex', 'female');
    expect(optionValues(element, 'weightClass')).toEqual(['f-52', 'f-56', 'f-plus']);
  });

  /**
   * Requirement 8. The comparison picker is offered the same ladder as the
   * first, because the lifter comparing two classes is usually comparing the one
   * they are in with the one they are cutting to -- both of which are theirs.
   */
  it('offers the same ladder for the class to compare with', async () => {
    const element = await mount();
    await choose(element, 'sex', 'female');
    expect(optionValues(element, 'comparisonWeightClass')).toEqual(
      optionValues(element, 'weightClass'),
    );
  });

  it('clears a weight class that belongs to the other ladder', async () => {
    // The reason the event crossing two shadow boundaries matters: without it
    // the class stays selected, and every record shown afterwards is for a
    // category the lifter is not in.
    const element = await mount();
    await choose(element, 'sex', 'female');
    await pick(element, 'weightClass', 'f-56');
    expect(picker(element, 'weightClass').value).toBe('f-56');

    await choose(element, 'sex', 'male');
    expect(picker(element, 'weightClass').value).toBeNull();
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
    await pick(element, 'weightClass', 'f-56');
    await choose(element, 'sex', 'male');
    await choose(element, 'sex', 'female');

    expect(picker(element, 'weightClass').value).toBe('f-56');
  });

  /**
   * Requirement 2's "a way to clear the age division if selected on accident".
   *
   * The placeholder is that way, and it has to be a real answer rather than a
   * disabled first row: a lifter who taps Masters 1 by mistake and finds the
   * control has no way back is looking at a report for somebody else's division
   * with no idea how to leave it. No separate clear button, because it would be a
   * second tap target beside every optional control and it would be missing from
   * the native picker a phone actually shows.
   */
  it('clears an optional answer through the placeholder', async () => {
    const element = await mount();
    await pick(element, 'division', 'masters-1');
    expect(picker(element, 'division').value).toBe('masters-1');

    await pick(element, 'division', null);
    expect(picker(element, 'division').value).toBeNull();
  });

  /**
   * Requirement 2 again, and the part most easily got wrong. Open is not
   * something a lifter picks -- it is the column the report always draws -- so
   * offering it would let somebody "choose" the thing they already have and then
   * wonder why clearing it changes nothing.
   */
  it('never offers Open as a division to choose', async () => {
    const element = await mount();
    expect(optionValues(element, 'division')).toEqual(['masters-1']);
  });

  /**
   * The federation's own word for these, and the word the report's row headings
   * use. The placeholder is what says the question is skippable -- "Open only"
   * is both the default answer and the route back to it -- so the label does not
   * have to carry that job by naming the families it offers.
   *
   * Both strings are pinned exactly, because a reworded label is invisible in
   * review and this pair is the whole of requirement 2's interface.
   */
  it('names the division question the way the published divisions are named', async () => {
    const element = await mount();
    expect(picker(element, 'division').label).toBe('Age division');
    expect(picker(element, 'division').placeholder).toBe('Open only');
  });

  it('shows the age band the catalogue published alongside the division', async () => {
    const element = await mount();
    expect(control(element, 'division').textContent).toContain('40 to 49');
  });

  it('reports the category, and whether it is ready, outside the shadow root', async () => {
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
    await pick(element, 'weightClass', 'f-56');
    expect(seen.at(-1)).toEqual({
      selection: {
        sex: 'female',
        equipment: 'raw',
        weightClass: 'f-56',
        comparisonWeightClass: null,
        division: null,
        tested: null,
        region: null,
      },
      ready: false,
      partitions: [{ levelId: 'national', regionId: null, label: 'National' }],
    });

    await choose(element, 'tested', 'tested');
    expect(seen.at(-1)?.ready).toBe(true);
  });

  /**
   * Requirement 9, which is the whole reason the report is worth building: the
   * optional answers add columns, and none of them can be missing in a way that
   * makes the rest wrong. Gating the report on them hides it behind answers that
   * do not change what it says.
   */
  it('is ready with none of the optional answers given', async () => {
    const element = await mount();
    const seen: SelectionChangeDetail[] = [];
    const listener = (event: CustomEvent<SelectionChangeDetail>): void => {
      seen.push(event.detail);
    };
    element.addEventListener(SELECTION_CHANGE_EVENT, listener);
    teardown.push(() => {
      element.removeEventListener(SELECTION_CHANGE_EVENT, listener);
    });

    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await choose(element, 'tested', 'untested');
    await pick(element, 'weightClass', 'f-56');

    const last = seen.at(-1);
    expect(last?.ready).toBe(true);
    expect(last?.selection.comparisonWeightClass).toBeNull();
    expect(last?.selection.division).toBeNull();
    expect(last?.selection.region).toBeNull();
  });

  /**
   * The live region names only what is *required*, which is requirement 9
   * arriving in the copy as well as in the logic. A line listing the optional
   * pickers would tell a lifter the screen is incomplete while the report below
   * it is already showing them everything they came for.
   */
  it('names what is still missing in a live region', async () => {
    const element = await mount();
    expect(statusText(element)).toContain('sex category');

    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await pick(element, 'weightClass', 'f-56');
    await choose(element, 'tested', 'untested');

    expect(statusText(element)).toContain('Ready. Choose Show targets.');
  });

  it('says nothing is missing while an optional answer is still unanswered', async () => {
    const element = await mount();
    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await pick(element, 'weightClass', 'f-56');
    await choose(element, 'tested', 'tested');

    expect(statusText(element)).not.toContain('division');
    expect(statusText(element)).not.toContain('Compare');
  });

  it('still offers every equipment category the catalogue publishes', async () => {
    const element = await mount();
    expect(choiceValues(element, 'equipment')).toEqual(['raw']);
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

  /**
   * THE BATCH, WHICH IS THE WHOLE OF WHAT STAGE 2 ADDED
   *
   * Answering is a draft and pressing is a commitment, and everything below is
   * about keeping those two apart. The review's finding was that a long report
   * must not reflow after every tap in the context editor; the implementation of
   * that is a second event, and the failure it prevents -- a report redrawn from
   * a category the lifter is half way through changing -- looks exactly like a
   * working screen while it is happening.
   */
  it('keeps the action out of reach until every required answer is given', async () => {
    const element = await mount();
    expect(action(element, 'apply').disabled).toBe(true);

    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await pick(element, 'weightClass', 'f-56');
    // Three of four. The optional pickers are deliberately not answered, because
    // requirement 9 is that they cannot hold the report back.
    expect(action(element, 'apply').disabled).toBe(true);

    await choose(element, 'tested', 'tested');
    expect(action(element, 'apply').disabled).toBe(false);
  });

  it('commits nothing while the answers are being given', async () => {
    const applied = watchApplied();
    const element = await mount();
    await answerRequired(element);
    await pick(element, 'division', 'masters-1');

    expect(applied).toEqual([]);
  });

  it('reports the applied category outside its shadow root, once', async () => {
    const applied = watchApplied();
    const element = await mount();
    await answerRequired(element);
    await press(element, 'apply');

    expect(applied).toHaveLength(1);
    // The same shape the draft event carries, so a listener that wants the
    // committed context reads one thing rather than reconciling two.
    expect(applied[0]?.ready).toBe(true);
    expect(applied[0]?.selection.weightClass).toBe('f-56');
    expect(applied[0]?.selection.division).toBeNull();
    expect(applied[0]?.partitions).toEqual([
      { levelId: 'national', regionId: null, label: 'National' },
    ]);
  });

  it('offers no way out of a first run', async () => {
    // There is nothing behind the setup screen to go back to, and a Cancel that
    // returns to nothing is a button whose only effect is to make a lifter press
    // it and find out.
    const element = await mount();
    expect(element.shadowRoot?.querySelector('ptk-button[data-action="cancel"]')).toBeNull();
    expect(() => action(element, 'cancel')).toThrow();
  });

  it('offers a way out once there is something to go back to', async () => {
    const cancelled = watchCancelled();
    const element = await mount({ allowCancel: true });
    await press(element, 'cancel');

    expect(cancelled).toHaveLength(1);
    // No detail on purpose: the draft is abandoned, and handing it out would
    // invite a caller to keep it and reopen the editor on it.
    expect(cancelled[0]?.detail).toBeNull();
  });

  it('does not commit a draft it was asked to abandon', async () => {
    const applied = watchApplied();
    const element = await mount({ allowCancel: true });
    await answerRequired(element);
    await press(element, 'cancel');

    expect(applied).toEqual([]);
  });

  /**
   * The seed a returning visit arrives on. Read once in `willUpdate`, so the
   * first paint is already filled in -- assigning after the first render draws
   * an empty form and then replaces it, which on a slow phone is a visible flash
   * of a screen the lifter already completed.
   */
  it('opens on the answers it was handed, ready to apply', async () => {
    const element = await mount({
      initialSelection: {
        sex: 'female',
        equipment: 'raw',
        tested: 'tested',
        weightClass: 'f-56',
        comparisonWeightClass: null,
        division: 'masters-1',
        region: null,
      },
    });

    expect(group(element, 'sex').value).toBe('female');
    expect(picker(element, 'division').value).toBe('masters-1');
    expect(action(element, 'apply').disabled).toBe(false);
  });

  it('has no accessibility violations with every question answered', async () => {
    // The state the a11y pass above cannot reach: three selects carrying options
    // and a status line saying the report is showing. A select with no accessible
    // name is the failure, and it only exists once there is a control to name.
    const element = await mount();
    await choose(element, 'sex', 'female');
    await choose(element, 'equipment', 'raw');
    await choose(element, 'tested', 'tested');
    await pick(element, 'weightClass', 'f-56');
    await pick(element, 'comparisonWeightClass', 'f-52');
    await pick(element, 'division', 'masters-1');

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('fits a phone-width column with every question answered', async () => {
    // The composed case, which the shared components' own tests cannot cover:
    // three tile groups and three selects stacked, the longest labels the
    // catalogue produces, and the outstanding-status line underneath. A phone is
    // where this tool is used -- at a warm-up rack, on a platform floor -- so the
    // narrow layout is the one that has to hold, and horizontal scroll is the
    // failure it fails with.
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
    await pick(element, 'division', 'masters-1');

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
