// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.2's checklist, and the five things a real browser is needed to prove.
 *
 * 1. **Three controls, three reports, one `data-group` each.**
 *    `ptk-toggle-group` reports its *whole* selection on every press, so a
 *    report that reaches the root untagged is applied over every tick in the
 *    prep -- ticking "Belt" under Bring clears everything under Do at the venue.
 *    The tag has to survive two shadow boundaries to be read off
 *    `composedPath()`, and an emulated-DOM test that finds the attribute in the
 *    template proves nothing about that.
 * 2. **The report's `values` are that group's rows and no others**, which is
 *    what makes `withCheckedRows`'s `within` argument answerable.
 * 3. **Two guards on one delegated removal listener** (§13.6, §13.11, §13.13 --
 *    the fourth occurrence in this directory). The test that bites a
 *    `data-field` filter is a foreign composed event, not a second control --
 *    but here it has to be dispatched *inside the container the listener is on*,
 *    which is the `.removals` div and not the fold around it. Dispatched at the
 *    host, as the other three do it, the event bubbles past the listener and
 *    both guards can be deleted with the suite still green.
 * 4. **A bound property is only tested by reading the control** (§13.13). Two
 *    here: the add box and the notes area, both of which the root clears.
 * 5. **The layout at 320px** (§5.7), which no unit test can see.
 *
 * Every fixture is built through `prep.ts`'s own transitions rather than as a
 * `MeetPrep` literal, for the reason §13.5 gives about meet documents: a literal
 * can hold a state the transitions cannot produce -- a tick on a row that was
 * removed, a custom id that collides with a default one -- and a screen proved
 * to cope with one is proved to cope with something that will never arrive.
 */
import { TEXT_AREA_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-text-area';
import { TEXT_FIELD_CHANGE_EVENT } from '@platform-toolkit/ui/ptk-text-field';
import {
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
import { CHECKLIST_HEADING, PREP_SCOPE_NOTE, checklistGroupHeading } from './copy.js';
import { CUSTOM_ITEM_FIELD, PREP_NOTES_FIELD, REMOVE_CUSTOM_ITEM_FIELD } from './fields.js';
import {
  CUSTOM_ITEM_MAX,
  EMPTY_PREP,
  PREP_NOTES_MAX,
  addCustomItem,
  withChecklistItem,
  withPrepNotes,
  type ChecklistContext,
  type MeetPrep,
} from './prep.js';
import { PREP_ADD_ITEM_EVENT, PREP_REMOVE_ITEM_EVENT } from './ptk-meet-checklist.js';
import type {
  PrepAddItemDetail,
  PrepRemoveItemDetail,
  PtkMeetChecklist,
} from './ptk-meet-checklist.js';
import './ptk-meet-checklist.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/** A full-power raw meet with no record ambitions: the ordinary case. */
const ORDINARY: ChecklistContext = {
  format: 'full-power',
  equipment: 'raw',
  goal: 'balanced',
};

/** Two rows of somebody's own, added the way the root adds them. */
function withTwoOfTheirOwn(): MeetPrep {
  const first = addCustomItem(EMPTY_PREP, 'Mouthguard');
  if (!first.ok) throw new Error('The fixture failed to add its first row.');
  const second = addCustomItem(first.prep, 'Spare singlet');
  if (!second.ok) throw new Error('The fixture failed to add its second row.');
  return second.prep;
}

interface Options {
  readonly prep?: MeetPrep;
  readonly context?: ChecklistContext;
  readonly customItemText?: string;
  readonly within?: HTMLElement;
}

async function mount(options: Options = {}): Promise<PtkMeetChecklist> {
  const element = document.createElement('ptk-meet-checklist');
  element.prep = options.prep ?? EMPTY_PREP;
  element.context = options.context ?? ORDINARY;
  element.customItemText = options.customItemText ?? '';
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** One of the three groups, or `null` when this meet reaches none of its rows. */
function group(element: PtkMeetChecklist, name: string): Element | null {
  return element.shadowRoot?.querySelector(`[data-group="${name}"]`) ?? null;
}

function requireGroup(element: PtkMeetChecklist, name: string): Element {
  const found = group(element, name);
  if (found === null) throw new Error(`No "${name}" group on the checklist.`);
  return found;
}

/** Ticks one row by clicking its checkbox, the way a lifter does. */
async function tick(element: PtkMeetChecklist, name: string, itemId: string): Promise<void> {
  const checkbox = [
    ...(requireGroup(element, name).shadowRoot?.querySelectorAll('input') ?? []),
  ].find((input) => input.value === itemId);
  if (checkbox === undefined) throw new Error(`No "${itemId}" row under "${name}".`);
  checkbox.click();
  await element.updateComplete;
}

/** The native box behind the add field or the notes area. */
function boxFor(element: PtkMeetChecklist, field: string): HTMLInputElement | HTMLTextAreaElement {
  const host = element.shadowRoot?.querySelector(`[data-field="${field}"]`);
  const inner = host?.shadowRoot?.querySelector('input, textarea');
  if (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement) return inner;
  throw new Error(`No box for "${field}".`);
}

/** Presses the native control inside the add button. */
async function add(element: PtkMeetChecklist): Promise<void> {
  const button = element.shadowRoot
    ?.querySelector('.add ptk-button')
    ?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('No way to add a row.');
  button.click();
  await element.updateComplete;
}

/** The removal fold, opened by setting `open` -- `toggle` fires late (§13.6). */
async function openRemovals(element: PtkMeetChecklist): Promise<Element> {
  const fold = element.shadowRoot?.querySelector('ptk-disclosure');
  if (fold === null || fold === undefined) throw new Error('No removal fold on the checklist.');
  fold.open = true;
  await element.updateComplete;
  return fold;
}

/**
 * The container the removal presses are delegated to, with the fold open.
 *
 * Deliberately not the `ptk-disclosure`, and that distinction is the whole
 * reason the two guard tests below spent a while measuring nothing. The
 * `@click` listener is on the `.removals` div *inside* the fold, so a click
 * dispatched at the fold host bubbles straight past it, and an element appended
 * to the fold host is a sibling of the container rather than a child of it.
 * Both guard mutations therefore survived a test that looked exactly right: the
 * handler was never entered at all, and "nothing was reported" is satisfied by
 * a handler that did not run.
 */
async function removalsList(element: PtkMeetChecklist): Promise<Element> {
  await openRemovals(element);
  const list = element.shadowRoot?.querySelector('.removals');
  if (list === null || list === undefined) throw new Error('No removal list on the checklist.');
  return list;
}

/** Presses one removal button by the id it carries. */
async function remove(element: PtkMeetChecklist, itemId: string): Promise<void> {
  await openRemovals(element);
  const host = element.shadowRoot?.querySelector(
    `[data-field="${REMOVE_CUSTOM_ITEM_FIELD}"][data-item="${itemId}"]`,
  );
  const button = host?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No way to remove "${itemId}".`);
  button.click();
  await element.updateComplete;
}

/** What the root would see for one of this element's own events. */
function watch<T>(eventName: string): T[] {
  const seen: T[] = [];
  const listener = (event: Event): void => {
    seen.push((event as CustomEvent<T>).detail);
  };
  document.body.addEventListener(eventName, listener);
  teardown.push(() => {
    document.body.removeEventListener(eventName, listener);
  });
  return seen;
}

/** A toggle report as the root reads it: the group off the path, plus the selection. */
interface Report {
  readonly group: string | null;
  readonly values: readonly string[];
}

function watchToggles(): Report[] {
  const seen: Report[] = [];
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<ToggleGroupChangeDetail>).detail;
    seen.push({ group: groupOf(event), values: detail.values });
  };
  document.body.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
  });
  return seen;
}

/** The same walk the root does: the nearest `data-group` on the composed path. */
function groupOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset['group'] !== undefined) {
      return node.dataset['group'];
    }
  }
  return null;
}

/** The refusal under one field, or the empty string when it is not refusing. */
function errorUnder(element: PtkMeetChecklist, field: string): string {
  const host = element.shadowRoot?.querySelector(`[data-field="${field}"]`);
  return host?.shadowRoot?.querySelector('.error')?.textContent.trim() ?? '';
}

/** The progress line, read off its own class rather than out of the whole screen. */
function progressText(element: PtkMeetChecklist): string {
  return element.shadowRoot?.querySelector('.progress')?.textContent.trim() ?? '';
}

describe('ptk-meet-checklist', () => {
  it('re-renders when the prep is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the list simply stops updating --
    // which here means a lifter adds a row, the root records it, and the screen
    // goes on showing the list they had before.
    const element = await mount();
    expect(deepText(element)).not.toContain('Mouthguard');

    element.prep = withTwoOfTheirOwn();
    await element.updateComplete;

    expect(deepText(element)).toContain('Mouthguard');
  });

  it('draws the two default groups and withholds the empty third', async () => {
    // "Yours" exists only once somebody adds a row. A permanent empty heading
    // over no list reads as a feature that is broken rather than one nobody has
    // used, which is why `nothing` beats `ptk-toggle-group`'s own empty message.
    const element = await mount();

    expect(group(element, 'bring')).not.toBeNull();
    expect(group(element, 'do')).not.toBeNull();
    expect(group(element, 'own')).toBeNull();

    element.prep = withTwoOfTheirOwn();
    await element.updateComplete;

    expect(group(element, 'own')).not.toBeNull();
    expect(deepText(element)).toContain(checklistGroupHeading('own'));
  });

  it('asks a bench-only meet about nothing it will not reach', async () => {
    // The asymmetry with the setup form beside it: a tick is state `prep.ts`
    // keeps when its row goes, so a row can be withdrawn and restored without
    // losing anything. The control is a row every meet reaches -- an assertion
    // on the absence alone passes against a list that renders no rows at all.
    const element = await mount({ context: { ...ORDINARY, format: 'bench-only' } });
    const text = deepText(element);

    expect(text).not.toContain('Deadlift socks');
    expect(text).toContain('Weigh-in');
  });

  it('reports a tick tagged with the group it was made in', async () => {
    // The whole reason this element gets a browser test. The report carries the
    // entire selection, so a tag that does not survive both shadow boundaries is
    // one group's answer written over all three -- a lifter ticks their belt and
    // watches the venue list clear.
    const element = await mount();
    const seen = watchToggles();

    await tick(element, 'bring', 'belt');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.group).toBe('bring');
    expect(seen[0]?.values).toEqual(['belt']);
  });

  it('reports only the rows the pressed group offered', async () => {
    // What makes `withCheckedRows`'s `within` argument answerable. A tick under
    // "Do at the venue" must not mention a row under "Bring", or the root cannot
    // tell an unticked row from one that was never on this control.
    const ticked = withChecklistItem(EMPTY_PREP, 'belt', true);
    const element = await mount({ prep: ticked });
    const seen = watchToggles();

    await tick(element, 'do', 'weigh-in');

    expect(seen[0]?.group).toBe('do');
    expect(seen[0]?.values).toEqual(['weigh-in']);
    expect(seen[0]?.values).not.toContain('belt');
  });

  it('shows a ticked row as ticked, in the group that holds it', async () => {
    // §13.13's mutation: a control bound to a property is only tested by reading
    // the control, and every other assertion about the ticks here goes the other
    // way through an event. An unbound group opens with everything blank under a
    // count saying six are done.
    const element = await mount({ prep: withChecklistItem(EMPTY_PREP, 'belt', true) });
    const checked = [
      ...(requireGroup(element, 'bring').shadowRoot?.querySelectorAll('input') ?? []),
    ]
      .filter((input) => input.checked)
      .map((input) => input.value);

    expect(checked).toEqual(['belt']);
  });

  it('counts the whole list rather than one group, and the two states read differently', async () => {
    // §13.8's lesson: an assertion whose expected value is computed by the
    // module under test is vacuous under exactly the mutation it was written to
    // catch. So the two counts are compared with each other and one literal
    // fragment is pinned, rather than either being compared with
    // `checklistProgressText`.
    const none = await mount();
    const one = await mount({ prep: withChecklistItem(EMPTY_PREP, 'belt', true) });

    expect(progressText(none)).not.toBe(progressText(one));
    expect(progressText(one)).toContain('1 of');
  });

  it('reports a press of Add carrying the text it was showing', async () => {
    // The reasoning `ROSTER_ADD_EVENT` records: the root owns the box, so
    // reading it back in the handler is a second instant, and the row that gets
    // added is one keystroke behind the row on screen.
    const element = await mount({ customItemText: 'Mouthguard' });
    const seen = watch<PrepAddItemDetail>(PREP_ADD_ITEM_EVENT);

    await add(element);

    expect(seen).toEqual([{ text: 'Mouthguard' }]);
  });

  it('reports a blank press rather than swallowing it', async () => {
    // Deliberately not disabled. `addCustomItem` refuses an empty row with
    // `empty` and the root already knows how to say that; a second check here
    // would be a copy of a domain rule in an element, answering differently the
    // day the rule changes.
    const element = await mount({ customItemText: '' });
    const seen = watch<PrepAddItemDetail>(PREP_ADD_ITEM_EVENT);

    await add(element);

    expect(seen).toEqual([{ text: '' }]);
  });

  it('shows the text the root is holding, so the box and the press agree', async () => {
    // The other half of §13.13's mutation. Both states, because a box ignoring
    // the property entirely would satisfy either assertion on its own -- and the
    // empty one is the state after an accepted add, which is what puts the box
    // back for the next row.
    const typed = await mount({ customItemText: 'Mouthguard' });
    expect(boxFor(typed, CUSTOM_ITEM_FIELD).value).toBe('Mouthguard');

    const cleared = await mount({ customItemText: '' });
    expect(boxFor(cleared, CUSTOM_ITEM_FIELD).value).toBe('');
  });

  it('reports what was typed into the add box as it is typed', async () => {
    const element = await mount();
    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push(fieldOf(event));
    };
    document.body.addEventListener(TEXT_FIELD_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TEXT_FIELD_CHANGE_EVENT, listener);
    });

    const box = boxFor(element, CUSTOM_ITEM_FIELD);
    box.value = 'Mouthguard';
    box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await element.updateComplete;

    expect(seen).toEqual([CUSTOM_ITEM_FIELD]);
  });

  it('puts a refusal under the add box and nowhere else', async () => {
    // Two facts that can come apart. The element refuses nothing itself -- the
    // root decides and hands the code down -- so an over-long box with no
    // `refusal` set says nothing, which is the first assertion. And the notes
    // area below has a cap of its own with a refusal of its own, so a message
    // bound one control too low tells a lifter their notes are too long when
    // what was rejected was the row they were adding.
    const element = await mount({ customItemText: 'n'.repeat(CUSTOM_ITEM_MAX + 1) });
    expect(errorUnder(element, CUSTOM_ITEM_FIELD)).toBe('');

    element.refusal = 'too-long';
    await element.updateComplete;

    expect(errorUnder(element, CUSTOM_ITEM_FIELD)).toContain(String(CUSTOM_ITEM_MAX));
    expect(errorUnder(element, PREP_NOTES_FIELD)).toBe('');
  });

  it('withholds the removal fold until there is a row to remove', async () => {
    // Absent rather than empty: it is the one destructive control on a screen
    // tapped forty times in a warm-up room, and a fold offering nothing is one
    // more thing to open on the morning of the meet.
    const empty = await mount();
    expect(empty.shadowRoot?.querySelector('ptk-disclosure')).toBeNull();

    const withRows = await mount({ prep: withTwoOfTheirOwn() });
    expect(withRows.shadowRoot?.querySelector('ptk-disclosure')).not.toBeNull();
  });

  it('names the row each removal button takes away', async () => {
    // A list of buttons all reading "Remove" is unusable to anybody reading one
    // control at a time, and the text is the only thing that says which row a
    // press deletes.
    const element = await mount({ prep: withTwoOfTheirOwn() });
    const fold = await openRemovals(element);

    expect(deepText(fold)).toContain('Remove: Mouthguard');
    expect(deepText(fold)).toContain('Remove: Spare singlet');
  });

  it('reports a removal by id, not by the position of the button', async () => {
    // The list is rebuilt on every change, so an index names whichever row moved
    // into that place -- and the failure is a row deleted that nobody asked to
    // delete. The second row is pressed rather than the first, so a handler
    // reading a position would report the wrong id rather than no id.
    const prep = withTwoOfTheirOwn();
    const second = prep.custom[1];
    if (second === undefined) throw new Error('The fixture lost its second row.');
    const element = await mount({ prep });
    const seen = watch<PrepRemoveItemDetail>(PREP_REMOVE_ITEM_EVENT);

    await remove(element, second.itemId);

    expect(seen).toEqual([{ itemId: second.itemId }]);
  });

  it('ignores a removal press that names no row', async () => {
    // The id guard, which the foreign-field press below cannot reach: that one
    // is turned away by the field filter before the id is ever looked for. What
    // gets here is a press tagged as a removal with no row beside it -- the gap
    // between two buttons, or anything added to this fold later that is a
    // removal control without being one of the rows. Without the guard the root
    // is handed an item id of `undefined`, and `prep.ts` answers a row it does
    // not hold by removing nothing, so the screen is unchanged and the meet
    // document has recorded a removal the lifter never asked for.
    //
    // Dispatched inside `.removals` rather than at the fold -- see
    // `removalsList` for why the difference is the whole test.
    const prep = withTwoOfTheirOwn();
    const first = prep.custom[0];
    if (first === undefined) throw new Error('The fixture lost its first row.');
    const element = await mount({ prep });
    const list = await removalsList(element);
    const seen = watch<PrepRemoveItemDetail>(PREP_REMOVE_ITEM_EVENT);

    const intruder = document.createElement('span');
    intruder.dataset['field'] = REMOVE_CUSTOM_ITEM_FIELD;
    list.append(intruder);
    intruder.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await element.updateComplete;

    expect(seen).toEqual([]);
    // The control, and it is not optional here: the listener being unreachable
    // is exactly how the earlier version of this test passed against a checklist
    // with no guard at all.
    await remove(element, first.itemId);
    expect(seen).toEqual([{ itemId: first.itemId }]);
  });

  it('ignores a press tagged as something other than a removal', async () => {
    // The field guard. A control inside the fold carrying some other
    // `data-field` -- an edit box, a colour swatch, anything a later version
    // puts beside a row -- would otherwise delete whichever row's id sat with it
    // on the path, because the listener is on the container and reads the id off
    // the path rather than off the target. So the intruder carries a real id:
    // the field filter is the only thing standing between it and a removal.
    const prep = withTwoOfTheirOwn();
    const first = prep.custom[0];
    if (first === undefined) throw new Error('The fixture lost its first row.');
    const element = await mount({ prep });
    const list = await removalsList(element);
    const seen = watch<PrepRemoveItemDetail>(PREP_REMOVE_ITEM_EVENT);

    const intruder = document.createElement('span');
    intruder.dataset['field'] = 'something-else';
    intruder.dataset['item'] = first.itemId;
    list.append(intruder);
    intruder.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await element.updateComplete;

    expect(seen).toEqual([]);
    await remove(element, first.itemId);
    expect(seen).toEqual([{ itemId: first.itemId }]);
  });

  it('shows the notes the root is holding and reports what is typed into them', async () => {
    const element = await mount({ prep: withPrepNotes(EMPTY_PREP, 'Ask about the bar.') });
    expect(boxFor(element, PREP_NOTES_FIELD).value).toBe('Ask about the bar.');

    const seen: string[] = [];
    const listener = (event: Event): void => {
      seen.push(fieldOf(event));
    };
    document.body.addEventListener(TEXT_AREA_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(TEXT_AREA_CHANGE_EVENT, listener);
    });

    const box = boxFor(element, PREP_NOTES_FIELD);
    box.value = 'Ask about the bar for the third.';
    box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await element.updateComplete;

    expect(seen).toEqual([PREP_NOTES_FIELD]);
  });

  it('refuses a note over the cap the hint announces, and says nothing under it', async () => {
    // The cap was announced by `PREP_NOTES_HINT` and applied by nothing until
    // `prepNotesProblem` existed. Both sides of the boundary, because a screen
    // that refused every note would satisfy the over-cap assertion on its own.
    const under = await mount({ prep: withPrepNotes(EMPTY_PREP, 'n'.repeat(PREP_NOTES_MAX)) });
    expect(errorUnder(under, PREP_NOTES_FIELD)).toBe('');

    const over = await mount({ prep: withPrepNotes(EMPTY_PREP, 'n'.repeat(PREP_NOTES_MAX + 1)) });

    expect(errorUnder(over, PREP_NOTES_FIELD)).toContain(String(PREP_NOTES_MAX));
  });

  it('says what the list is for, under the rows most likely to invite the question', async () => {
    // §22.2's one prohibition earns one sentence. It sits under the checklist,
    // where a lifter is looking at "Food" and "Fluids" and is most likely to
    // expect the tool to go on and tell them what to do with them.
    const element = await mount();
    const text = deepText(element);

    expect(text).toContain(CHECKLIST_HEADING);
    expect(text).toContain(PREP_SCOPE_NOTE);
  });

  it('has no accessibility violations with a list on screen', async () => {
    const element = await mount({ prep: withTwoOfTheirOwn() });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations with the removal fold open', async () => {
    // `<details>` hides its contents from the accessibility tree, so the
    // self-naming buttons inside the fold are only reachable here.
    const element = await mount({ prep: withTwoOfTheirOwn() });
    await openRemovals(element);

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with the removal fold open', async () => {
    // Open, because shut is the easy case: the removal buttons are labelled with
    // the rows themselves, so they are the widest thing on the screen and the
    // one place a long row somebody typed can push the page sideways.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mount({ prep: withTwoOfTheirOwn(), within: frame });
    await openRemovals(element);

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});

/** The nearest `data-field` on the composed path, or the empty string. */
function fieldOf(event: Event): string {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset['field'] !== undefined) {
      return node.dataset['field'];
    }
  }
  return '';
}
