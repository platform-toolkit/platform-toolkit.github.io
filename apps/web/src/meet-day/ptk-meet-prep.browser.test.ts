// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.1's setup form, and the four things a real browser is needed to prove.
 *
 * 1. **The field name is the state key.** Every other screen in this tool maps a
 *    `data-field` onto state through a switch the compiler checks; here the
 *    attribute *is* the `LifterSetup` key (`SETUP_FIELDS`), so nothing between
 *    the template and the root can catch a misspelling. An emulated-DOM test can
 *    assert the attribute is in the template and still miss that it never
 *    reaches the listener, which is a lifter's bench height recorded under a key
 *    §23 prints from and nothing displays.
 * 2. **Sixteen bound values, read back off the controls.** §13.13's lesson,
 *    twice over: a control bound to a property is only tested by reading the
 *    control, and every other assertion here goes the other way through an
 *    event. An unbound box is a lifter opening the fold on the morning of the
 *    meet to sixteen blanks where their rack heights were.
 * 3. **The refusal lands under the field it is about.** Both times parse through
 *    one function, so a message bound to the wrong field is a screen telling a
 *    lifter their weigh-in time is wrong when it was the lifting start.
 * 4. **The layout at 320px** (§5.7), which no unit test can see.
 *
 * The fixture is a hand-written `LifterSetup`. Nothing on this screen is
 * computed -- sixteen answers go in and the same sixteen come out -- so a
 * literal documents it honestly and a timeline would be scaffolding.
 */
import {
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  TEXT_AREA_CHANGE_EVENT,
  type TextAreaChangeDetail,
} from '@platform-toolkit/ui/ptk-text-area';
import {
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-text-field';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '@platform-toolkit/ui/deep-text';
import { SETUP_LABELS, SETUP_SECTION_HEADINGS } from './copy.js';
import { SETUP_FIELDS } from './fields.js';
import { EMPTY_PREP, type LifterSetup, type MeetPrep } from './prep.js';
import { type PtkMeetPrep } from './ptk-meet-prep.js';
import './ptk-meet-prep.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * A setup with a different string in every box.
 *
 * Different in every box deliberately: the assertion that each control shows its
 * own answer cannot be made against a fixture that answers two fields the same,
 * and eleven of these are one or two characters, which is exactly the shape that
 * collides by accident.
 */
const ANSWERED: LifterSetup = {
  squatRackHeight: '14',
  squatSafetyHeight: '6',
  monoliftSetting: 'out 3',
  squatStart: 'monolift',
  benchRackHeight: '9',
  benchSafetyHeight: '4',
  footBlocks: 'yes',
  handoff: 'own-handler',
  deadliftNotes: 'Stiff bar, deep platform.',
  commands: 'Start, rack. No press command until it settles.',
  flight: 'B',
  lot: '147',
  platform: '2',
  session: 'Afternoon',
  weighInTime: '8:30 am',
  liftingStartTime: '10:30 am',
};

interface Options {
  readonly prep?: MeetPrep;
  readonly within?: HTMLElement;
}

async function mount(options: Options = {}): Promise<PtkMeetPrep> {
  const element = document.createElement('ptk-meet-prep');
  element.prep = options.prep ?? { ...EMPTY_PREP, setup: ANSWERED };
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** The one control answering a field. */
function control(element: PtkMeetPrep, field: string): Element {
  const found = element.shadowRoot?.querySelector(`[data-field="${field}"]`);
  if (found === null || found === undefined) throw new Error(`No control for "${field}".`);
  return found;
}

/** The native box behind a text field or a text area, whichever this field is. */
function box(element: PtkMeetPrep, field: string): HTMLInputElement | HTMLTextAreaElement {
  const inner = control(element, field).shadowRoot?.querySelector('input, textarea');
  if (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement) return inner;
  throw new Error(`No text box for "${field}".`);
}

/** Types into whichever kind of box a field draws, keystroke and all. */
async function enter(element: PtkMeetPrep, field: string, text: string): Promise<void> {
  const inner = box(element, field);
  inner.value = text;
  inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Answers a tile group by clicking the radio, the way a lifter does. */
async function choose(element: PtkMeetPrep, field: string, value: string): Promise<void> {
  const radio = [...(control(element, field).shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No "${value}" option for "${field}".`);
  radio.click();
  await element.updateComplete;
}

/**
 * What the root would see, recorded off `document.body`.
 *
 * On the body and not on the element: what is being proved is that the answer
 * crossed the shadow boundary carrying its field name, and a listener on the
 * element itself would pass with none.
 */
interface Answer {
  readonly field: string | null;
  readonly value: string;
}

function watch(...eventNames: string[]): Answer[] {
  const seen: Answer[] = [];
  const listener = (event: Event): void => {
    const detail = (
      event as CustomEvent<ChoiceChangeDetail | TextAreaChangeDetail | TextFieldChangeDetail>
    ).detail;
    seen.push({ field: fieldOf(event), value: detail.value });
  };
  for (const eventName of eventNames) {
    document.body.addEventListener(eventName, listener);
    teardown.push(() => {
      document.body.removeEventListener(eventName, listener);
    });
  }
  return seen;
}

/** The same walk the root does: the nearest `data-field` on the path. */
function fieldOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset['field'] !== undefined) {
      return node.dataset['field'];
    }
  }
  return null;
}

/** The refusal under one field, or the empty string when it is not refusing. */
function errorText(element: PtkMeetPrep, field: string): string {
  return control(element, field).shadowRoot?.querySelector('.error')?.textContent.trim() ?? '';
}

describe('ptk-meet-prep', () => {
  it('re-renders when the prep is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the form simply stops updating --
    // which here means a lifter types a rack height, the root records it, and
    // the box goes on showing what was there before.
    const element = await mount({ prep: EMPTY_PREP });
    expect(box(element, 'squatRackHeight').value).toBe('');

    element.prep = { ...EMPTY_PREP, setup: ANSWERED };
    await element.updateComplete;

    expect(box(element, 'squatRackHeight').value).toBe('14');
  });

  it('draws a control for every one of the sixteen answers', async () => {
    // `SETUP_FIELDS` is the list §23 prints from and §24 saves, so a key with no
    // control is an answer that can be stored and never seen. Driven off the
    // tuple rather than a count, so adding a seventeenth key without drawing it
    // is a failure rather than a number to update.
    const element = await mount();

    for (const field of SETUP_FIELDS) {
      expect(control(element, field)).toBeInstanceOf(HTMLElement);
    }
  });

  it('draws all five sections whatever the meet contests', async () => {
    // The documented asymmetry with the checklist beside it: a tick is state
    // `prep.ts` keeps when its row goes, and a typed sentence is not. There is
    // deliberately no property on this element that could hide a section, so
    // this is the assertion that stops one being added -- three empty boxes are
    // cheaper than a deadlift note nobody can see or correct.
    const element = await mount();
    const text = deepText(element);

    for (const heading of Object.values(SETUP_SECTION_HEADINGS)) {
      expect(text).toContain(heading);
    }
  });

  it('shows every answer in the control that owns it', async () => {
    // §13.13's mutation, twice over: a control bound to a property is only
    // tested by reading the control, and every other assertion in this file goes
    // the other way through an event. Read per field rather than as one blob so
    // that two boxes bound to one another's answer -- squat and bench heights
    // sit in the same shape of pair -- is a failure and not a pass.
    const element = await mount();

    expect(box(element, 'squatRackHeight').value).toBe('14');
    expect(box(element, 'benchRackHeight').value).toBe('9');
    expect(box(element, 'weighInTime').value).toBe('8:30 am');
    expect(box(element, 'liftingStartTime').value).toBe('10:30 am');
    expect(box(element, 'deadliftNotes').value).toBe('Stiff bar, deep platform.');
  });

  it('shows a chosen tile as chosen, and an unanswered group as not decided', async () => {
    // The other half of the same mutation, on the three tile groups. `unstated`
    // is a real answer on all three (§22.1), so it has to be able to show as the
    // current one -- an empty binding makes "not decided" and "not loaded"
    // the same screen.
    const answered = await mount();
    const chosen = [
      ...(control(answered, 'squatStart').shadowRoot?.querySelectorAll('input') ?? []),
    ].find((input) => input.checked);
    expect(chosen?.value).toBe('monolift');

    const blank = await mount({ prep: EMPTY_PREP });
    const unstated = [
      ...(control(blank, 'squatStart').shadowRoot?.querySelectorAll('input') ?? []),
    ].find((input) => input.checked);
    expect(unstated?.value).toBe('unstated');
  });

  it('reports a typed answer tagged with the state key it writes', async () => {
    // The whole reason this element gets a browser test. The field name is the
    // `LifterSetup` key, so a tag that does not survive the shadow boundary is
    // an answer the root drops on the floor -- silently, because the box still
    // shows what was typed until the next render.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(element, 'lot', '148');

    expect(seen).toEqual([{ field: 'lot', value: '148' }]);
  });

  it('reports a note through the text-area event, tagged the same way', async () => {
    // The two prose answers report a different event entirely, which is worth
    // pinning: the root listens for both on one host, and a handler wired to
    // only the field event loses the commands a lifter wrote out in full.
    const element = await mount();
    const seen = watch(TEXT_AREA_CHANGE_EVENT);

    await enter(element, 'commands', 'Squat, rack.');

    expect(seen).toEqual([{ field: 'commands', value: 'Squat, rack.' }]);
  });

  it('reports a tile the same way, so all sixteen arrive on one path', async () => {
    const element = await mount();
    const seen = watch(CHOICE_CHANGE_EVENT);

    await choose(element, 'handoff', 'meet-spotter');

    expect(seen).toEqual([{ field: 'handoff', value: 'meet-spotter' }]);
  });

  it('reports an answer untrimmed, because it is what the lifter read off the rack', async () => {
    // The same call the roster makes: trimming here would make this element the
    // author of the answer, and a rack height with a trailing space is one the
    // lifter can see in the box and the crew cannot.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(element, 'squatRackHeight', ' 14 ');

    expect(seen[0]?.value).toBe(' 14 ');
  });

  it('leaves a rack height in the case it was typed', async () => {
    // `capitalize="none"`, against the shared field's default of `sentences`.
    // These are labels read off somebody else's equipment -- `a4`, `12.5`, `pm`
    // -- and a phone that helpfully capitalises the first letter changes what
    // the lifter reads back to the crew.
    const element = await mount();

    expect(box(element, 'squatRackHeight').getAttribute('autocapitalize')).toBe('none');
  });

  it('puts a refusal under the time it is about and under no other field', async () => {
    // Both times go through one parser, so the message and the field are two
    // separate facts and the pair is where they can come apart. The control is
    // the *other* time, answered acceptably: an assertion on the refused field
    // alone passes against a form that puts the sentence under all sixteen.
    const element = await mount({
      prep: {
        ...EMPTY_PREP,
        setup: { ...ANSWERED, weighInTime: 'early doors' },
      },
    });

    expect(errorText(element, 'weighInTime')).not.toBe('');
    expect(errorText(element, 'liftingStartTime')).toBe('');
    expect(errorText(element, 'flight')).toBe('');
  });

  it('says nothing at all about an answer nobody has given', async () => {
    // Every answer in §22.1 is optional and the whole premise of the section is
    // that some of it is not known until the morning. A blank form that refused
    // sixteen times would be unreadable on the one visit where it matters.
    const element = await mount({ prep: EMPTY_PREP });

    for (const field of SETUP_FIELDS) {
      expect(errorText(element, field)).toBe('');
    }
  });

  it('prints no hint at all under a field that has none', async () => {
    // `hint` is optional on `SetupFieldCopy` and both hint properties are plain
    // strings, so ten of the eleven one-line boxes are bound `undefined` -- only
    // three of the sixteen answers carry a hint, and two of those are the prose
    // ones.
    //
    // Asserted as the *absence of the paragraph*, and the earlier version of
    // this test asserting the absence of the word "undefined" was vacuous.
    // Measured, twice: lit renders `undefined` as an empty attribute value and
    // as nothing at all in a child part, so the word cannot reach the screen by
    // this route and both mutations passed. What `undefined` does reach is
    // `ptk-text-field`'s own guard, which is `this.hint === ''` -- so a property
    // binding slips past it and renders an empty `<p id="hint">` that the box's
    // `aria-describedby` then points at. A description with nothing in it is
    // what a screen reader is told to read out, and axe does not check that an
    // existing target has content.
    const element = await mount();

    expect(control(element, 'flight').shadowRoot?.querySelector('.hint')).toBeNull();
    // The control, which is also the assertion that the hints are wired at all:
    // an element rendering no hint anywhere passes the line above.
    expect(
      control(element, 'squatRackHeight').shadowRoot?.querySelector('.hint')?.textContent,
    ).toBe(SETUP_LABELS.squatRackHeight.hint);
  });

  it('has no accessibility violations with the form answered', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations while a time is refused', async () => {
    // The refusal renders an `aria-describedby` target and marks the box
    // invalid, and neither exists on the answered form above -- so this is the
    // half of the screen the first pass cannot see.
    const element = await mount({
      prep: { ...EMPTY_PREP, setup: { ...ANSWERED, weighInTime: 'early doors' } },
    });

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column', async () => {
    // Answered rather than blank: the paired fields are the thing that has to
    // fold to one column, and the longest label on the form ("Deadlift bar or
    // platform notes") sits above the widest box.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount({ within: frame });

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
