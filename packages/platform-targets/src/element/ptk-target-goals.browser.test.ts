// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { PtkSelect } from '@platform-toolkit/ui/ptk-select';
// Every spacing and tap-target declaration in the tray reads a custom property,
// and a declaration referencing an undefined one is dropped -- so without the
// stylesheet the 320 px check measures a layout with no gutters and the remove
// button is measured with no floor under it.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import { goalKey, type Goal } from '../core/goals.js';
import {
  CURRENT_LIFTS_EVENT,
  GOAL_REMOVE_EVENT,
  GOAL_TAG_EVENT,
  type PtkTargetGoals,
} from './ptk-target-goals.js';
import { CATALOG, CLASSIFICATIONS } from '../core/records.fixture.js';
import { NO_ENTRIES, typeLift, type LiftEntries } from '../core/standards.js';
import { definePlatformTargets } from './index.js';

beforeAll(() => {
  definePlatformTargets();
});

/**
 * The tray, in a real browser, mounted on its own.
 *
 * What only a browser answers here is the wiring: a horizon is chosen inside a
 * `ptk-select`'s own shadow tree and read back out of `composedPath()`, and a
 * removal has to leave this element's root as a composed event before the
 * composition root -- the only thing that owns the list -- ever hears it. An
 * emulated DOM that got retargeting subtly wrong would leave a green suite and a
 * tray whose controls visibly respond while nothing is ever saved.
 *
 * The arithmetic itself is `goals.ts` and `report.ts`, both tested in Node. What
 * is asserted below is that the three figures reach the screen in the order a
 * lifter reads them, and that nothing invents a gap out of a best nobody entered.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * A classification goal, as `report.ts` builds one.
 *
 * Three axes empty rather than absent, the case the storage shape turns on: a
 * classification has no level, region or event.
 */
const CLASS_GOAL: Goal = {
  lift: 'squat',
  kind: 'classification',
  kilograms: 150,
  standardId: 'first',
  weightClassId: 'f-56',
  divisionId: 'masters-1',
  levelId: '',
  regionId: '',
  disciplineId: '',
  attempt: 'none',
  tag: 'none',
};

/** A record goal on the subdivided level, so the region reaches the title. */
const RECORD_GOAL: Goal = {
  lift: 'bench',
  kind: 'record',
  kilograms: 130.5,
  standardId: '',
  weightClassId: 'f-56',
  divisionId: 'open',
  levelId: 'state',
  regionId: 'north-example',
  disciplineId: 'full-power',
  attempt: 'chip',
  tag: 'none',
};

interface MountOptions {
  readonly goals?: readonly Goal[];
  readonly entries?: LiftEntries;
  readonly catalog?: PtkTargetGoals['catalog'];
  readonly classifications?: PtkTargetGoals['classifications'];
}

async function mount(options: MountOptions = {}): Promise<PtkTargetGoals> {
  const element = document.createElement('ptk-target-goals');
  element.goals = options.goals ?? [CLASS_GOAL];
  element.entries = options.entries ?? NO_ENTRIES;
  element.catalog = options.catalog === undefined ? CATALOG : options.catalog;
  element.classifications =
    options.classifications === undefined ? CLASSIFICATIONS : options.classifications;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Everything on screen, across shadow boundaries. */
function text(element: PtkTargetGoals): string {
  return deepText(element);
}

function root(element: PtkTargetGoals): ShadowRoot {
  const { shadowRoot } = element;
  if (shadowRoot === null) {
    throw new Error('The tray has no shadow root.');
  }
  return shadowRoot;
}

function all(element: PtkTargetGoals, selector: string): Element[] {
  return [...root(element).querySelectorAll(selector)];
}

function find(element: PtkTargetGoals, selector: string): Element {
  const found = root(element).querySelector(selector);
  if (found === null) {
    throw new Error(`Nothing rendered for "${selector}".`);
  }
  return found;
}

function button(element: PtkTargetGoals, selector: string): HTMLButtonElement {
  const found = find(element, selector);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`"${selector}" is not a button.`);
  }
  return found;
}

/**
 * The horizon picker on the nth row.
 *
 * By position rather than by `[data-goal="…"]`, which is the obvious spelling and
 * is a trap: a goal key is newline-separated (`goals.ts` says why), and a raw
 * newline inside a selector throws a `SyntaxError` naming the selector rather
 * than failing the assertion that was meant. That the attribute holds the right
 * key is asserted through the event it produces, which is where it matters.
 */
function picker(element: PtkTargetGoals, index: number): PtkSelect {
  const found = all(element, 'ptk-select')[index];
  if (!(found instanceof PtkSelect)) {
    throw new Error(`No horizon control on row ${String(index)}.`);
  }
  return found;
}

/**
 * Records what the tray reports, from outside its shadow root.
 *
 * On `document.body` rather than on the element: the claim being made is that the
 * event *left* the shadow root composed, and a listener on the element itself
 * would hold either way.
 */
function watch<K extends TrayEvent>(name: K): HTMLElementEventMap[K]['detail'][] {
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

type TrayEvent = typeof GOAL_REMOVE_EVENT | typeof GOAL_TAG_EVENT | typeof CURRENT_LIFTS_EVENT;

/** Chooses a horizon the way a lifter does, inside the select's own root. */
async function chooseTag(element: PtkTargetGoals, index: number, value: string): Promise<void> {
  const control = picker(element, index).shadowRoot?.querySelector('select');
  if (!(control instanceof HTMLSelectElement)) {
    throw new Error('The horizon control rendered no select.');
  }
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** What the lifter has entered, built through the tool's own typing path. */
function entered(lift: Goal['lift'], typed: string): LiftEntries {
  return typeLift(NO_ENTRIES, lift, typed);
}

describe('ptk-target-goals', () => {
  /**
   * An empty "My goals" heading above an empty list is a promise the tool has
   * not kept yet, occupying the space under a report somebody is reading. The
   * separator lives on the section rather than on the host for the same reason:
   * a margin on an element that is always in the document is a gap nothing is
   * in, which reads as a section that failed to render.
   */
  it('renders nothing at all until something is saved', async () => {
    const element = await mount({ goals: [] });
    expect(text(element)).toBe('');
    expect(root(element).querySelector('section')).toBeNull();
  });

  it('names a classification goal the way the panel it was saved from did', async () => {
    const element = await mount();
    const shown = text(element);
    expect(shown).toContain('Class I');
    expect(shown).toContain('Squat · 56 kg · Masters 1');
  });

  /**
   * A record goal carries which attempt it is for, because the record itself is
   * not a goal -- equalling it takes nothing, and the two figures under it are
   * different commitments at different meets.
   */
  it('names a record goal with the attempt it was set for', async () => {
    const element = await mount({ goals: [RECORD_GOAL] });
    const shown = text(element);
    expect(shown).toContain('North Example State record');
    expect(shown).toContain('Chip target');
    expect(shown).toContain('Bench press · Full power · 56 kg · Open');
  });

  /**
   * The gap needs a current best, and a current best is optional. Without one
   * the row prints the goal and stops: inventing a gap from a blank field is the
   * one thing a tray of commitments must not do.
   */
  it('prints the goal alone when no current best has been entered', async () => {
    const element = await mount();
    const shown = text(element);
    expect(shown).toContain('Goal 150 kg');
    expect(shown).not.toContain('Gap');
    expect(shown).not.toContain('Current best');
  });

  /**
   * Three figures and a subtraction. No bar, no percentage, no encouragement --
   * a percentage in particular reads as progress towards something and is wrong
   * the moment two goals are in different lifts.
   */
  it('shows the goal, the current best and the exact gap', async () => {
    const element = await mount({ entries: entered('squat', '140') });
    const shown = text(element);
    expect(shown).toContain('Goal 150 kg');
    expect(shown).toContain('Current best 140 kg');
    expect(shown).toContain('Gap 10 kg');
    expect(shown).not.toContain('%');
  });

  /**
   * "Reached" only once there is a best to compare against, which is the review's
   * condition for marking anything reached at all -- and it is a word rather than
   * a colour, since a colour alone is discarded under forced colours.
   */
  it('says reached rather than judging it, once the best is there', async () => {
    const element = await mount({ entries: entered('squat', '150') });
    expect(text(element)).toContain('Reached');
    expect(text(element)).not.toContain('Gap');
  });

  /**
   * The subtraction is done in kilograms and only then converted. A gap worked
   * out in pounds and converted back lands between two legal loadings.
   */
  it('shows the pound equivalent without calculating in it', async () => {
    const element = await mount({ goals: [RECORD_GOAL] });
    expect(text(element)).toContain('130.5 kg');
    expect(text(element)).toContain('lb');
  });

  it('reports a removal outside its own shadow root, with the key and no tag', async () => {
    const element = await mount();
    const seen = watch(GOAL_REMOVE_EVENT);
    button(element, '.remove').click();
    expect(seen).toEqual([{ key: goalKey(CLASS_GOAL), tag: null }]);
  });

  /**
   * The tray owns no list, so removing draws nothing until the root hands back a
   * shorter one. Asserting that here is what stops somebody "fixing" the visible
   * lag by filtering locally -- two owners is two lists that agree right up until
   * the report marks a figure the tray has already dropped.
   */
  it('keeps showing a goal it has asked to remove', async () => {
    const element = await mount();
    button(element, '.remove').click();
    await element.updateComplete;
    expect(all(element, 'li')).toHaveLength(1);
  });

  it('reports a chosen horizon, and reports clearing it as none', async () => {
    const element = await mount();
    const seen = watch(GOAL_TAG_EVENT);
    await chooseTag(element, 0, 'next-meet');
    await chooseTag(element, 0, '');
    expect(seen).toEqual([
      { key: goalKey(CLASS_GOAL), tag: 'next-meet' },
      { key: goalKey(CLASS_GOAL), tag: 'none' },
    ]);
  });

  /**
   * P1's repeated-name finding, arriving on a form control. Every row carries a
   * picker labelled "Label", so a reader moving control by control hears the same
   * three announcements however many goals are saved. The accessible name has to
   * begin with the visible one (WCAG 2.5.3) or voice control loses the control it
   * can see.
   */
  it('names each horizon control for the goal it belongs to', async () => {
    const element = await mount({ goals: [CLASS_GOAL, RECORD_GOAL] });
    expect(
      all(element, 'ptk-select').map((select) => select.getAttribute('accessible-name')),
    ).toEqual([
      'Label for Class I, Squat · 56 kg · Masters 1',
      'Label for North Example State record, Bench press · Full power · 56 kg · Open',
    ]);
  });

  it('names each remove button for the goal it removes', async () => {
    const element = await mount({ goals: [CLASS_GOAL, RECORD_GOAL] });
    expect(all(element, '.remove').map((control) => control.getAttribute('aria-label'))).toEqual([
      'Remove goal: Class I, Squat · 56 kg · Masters 1',
      'Remove goal: North Example State record, Bench press · Full power · 56 kg · Open',
    ]);
  });

  /**
   * The secondary entry point the review asks for: current-best entry offered
   * *from a saved goal*, because a lifter who has committed to a weight is the
   * one lifter with a reason to say what they are lifting now. The tray does not
   * open the panel itself -- the panel is a sibling under the composition root.
   */
  it('offers current-best entry while a goal has no figure to compare', async () => {
    const element = await mount();
    const seen = watch(CURRENT_LIFTS_EVENT);
    button(element, '.add-lifts').click();
    expect(seen).toHaveLength(1);
  });

  it('stops offering it once every saved goal has a figure', async () => {
    const element = await mount({ entries: entered('squat', '140') });
    expect(root(element).querySelector('.add-lifts')).toBeNull();
  });

  it('keeps offering it while one of two lifts is still blank', async () => {
    const element = await mount({
      goals: [CLASS_GOAL, RECORD_GOAL],
      entries: entered('squat', '140'),
    });
    expect(root(element).querySelector('.add-lifts')).not.toBeNull();
  });

  /**
   * Resolved at render time, never stored as a sentence: a stored caption asserts
   * last month's number under this month's heading. What will not resolve is left
   * out rather than printed as a slug -- a tray reading "f-56" has shown a lifter
   * an internal identifier.
   */
  it('shows what it can when the vocabulary has not arrived', async () => {
    const element = await mount({ catalog: null, classifications: null });
    const shown = text(element);
    expect(shown).toContain('Classification standard');
    expect(shown).toContain('Squat');
    expect(shown).not.toContain('f-56');
    expect(shown).not.toContain('masters-1');
  });

  /**
   * The canary for Lit's decorator configuration. Everything else in this file
   * passes when `experimentalDecorators` and `useDefineForClassFields` disagree;
   * only a property change after the first render fails, and the symptom in the
   * product is a tray that never notices a goal was added.
   */
  it('re-renders when the list changes after the first render', async () => {
    const element = await mount({ goals: [] });
    element.goals = [CLASS_GOAL];
    await element.updateComplete;
    expect(all(element, 'li')).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const element = await mount({ goals: [CLASS_GOAL, RECORD_GOAL] });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('keeps every control at the comfortable tap floor', async () => {
    const element = await mount();
    for (const control of [button(element, '.remove'), button(element, '.add-lifts')]) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
  });

  it('fits a 320 pixel column', async () => {
    const element = await mount({ goals: [CLASS_GOAL, RECORD_GOAL] });
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
