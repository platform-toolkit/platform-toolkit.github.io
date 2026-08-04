// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's roster, and the four things a real browser is needed to prove.
 *
 * 1. **Two axes on one path.** Every other element in this tool tags an answer
 *    with `data-field` alone; a row here also carries `data-lifter`, and the
 *    root reads both off the same `composedPath()`. A test in an emulated DOM
 *    can assert the attribute is in the template and still miss that it never
 *    reaches the listener, which is the failure that puts one lifter's lot
 *    number on another lifter's row.
 * 2. **The event carries the name.** `ROSTER_ADD_EVENT` reports the name the
 *    element was showing rather than leaving the root to read its own state
 *    back -- the two are different instants, and the second one is after a Lit
 *    update nothing can await.
 * 3. **The summary line is inside a second shadow root.** It is handed to
 *    `ptk-disclosure` as a property and rendered in *its* tree, so a host-only
 *    `textContent` read comes back empty and a `not.toContain` written that way
 *    measures nothing. `deepText` is what makes the fold assertions real.
 * 4. **The layout at 320px** (§5.7), which no unit test can see.
 *
 * The fixtures are hand-written `RosterLifter` lists, unlike the board's next
 * door. Nothing on this screen is ranked or computed: a row is a name and two
 * answers about it, in the order they were added, so a literal documents the
 * screen honestly and a timeline would be scaffolding.
 */
import {
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui';
// Padding, gaps and the 44px tap-target floor all read custom properties, and a
// declaration referencing an undefined one is dropped -- so without this the
// layout measured at 320px below is not the layout that ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  COLOUR_CHOICES,
  NO_COLOUR,
  ROSTER_EMPTY,
  ROSTER_NEEDS_A_FEDERATION,
  ROSTER_STARTS_THE_MEET,
} from './copy.js';
import { ROSTER_COLOUR_FIELD, ROSTER_IDENTIFIER_FIELD, ROSTER_NAME_FIELD } from './fields.js';
import {
  ROSTER_ADD_EVENT,
  type PtkCoachRoster,
  type RosterAddDetail,
  type RosterLifter,
} from './ptk-coach-roster.js';
import './ptk-coach-roster.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly lifters?: readonly RosterLifter[];
  readonly name?: string;
  readonly ready?: boolean;
  readonly within?: HTMLElement;
}

/** A colour off the published list rather than a hex literal written here. */
function colour(position: number): string {
  const choice = COLOUR_CHOICES[position];
  if (choice === undefined) throw new Error(`No colour at position ${String(position)}.`);
  return choice.value;
}

const THREE: readonly RosterLifter[] = [
  { lifterId: 'lifter-1', name: 'Quintero', identifier: '14', colour: colour(1) },
  { lifterId: 'lifter-2', name: 'Okonkwo', identifier: '15', colour: colour(2) },
  { lifterId: 'lifter-3', name: 'Beaulieu', identifier: '', colour: null },
];

async function mount(options: Options = {}): Promise<PtkCoachRoster> {
  const element = document.createElement('ptk-coach-roster');
  element.lifters = options.lifters ?? THREE;
  element.name = options.name ?? '';
  element.ready = options.ready ?? true;
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** The one control answering a field, optionally for one lifter. */
function control(element: PtkCoachRoster, field: string, lifterId?: string): Element {
  const selector =
    lifterId === undefined
      ? `[data-field="${field}"]`
      : `[data-field="${field}"][data-lifter="${lifterId}"]`;
  const found = element.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) throw new Error(`No control for "${field}".`);
  return found;
}

/** Types into a text field, keystroke and all. */
async function enter(element: PtkCoachRoster, host: Element, text: string): Promise<void> {
  const input = host.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input inside ${host.localName}.`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Answers a colour by clicking the radio, the way a coach does. */
async function choose(element: PtkCoachRoster, lifterId: string, value: string): Promise<void> {
  const host = control(element, ROSTER_COLOUR_FIELD, lifterId);
  const radio = [...(host.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No colour "${value}" for "${lifterId}".`);
  radio.click();
  await element.updateComplete;
}

/** Presses the native control inside the add button. */
async function add(element: PtkCoachRoster): Promise<void> {
  const host = element.shadowRoot?.querySelector('.add ptk-button');
  const button = host?.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('No way to add a lifter.');
  button.click();
  await element.updateComplete;
}

/**
 * What the root would see, recorded off `document.body`.
 *
 * On the body and not on the element: what is being proved is that the answer
 * crossed the shadow boundary carrying both tags, and a listener on the element
 * itself would pass with neither.
 */
interface Answer {
  readonly field: string | null;
  readonly lifterId: string | null;
  readonly value: string;
}

function watch(eventName: string): Answer[] {
  const seen: Answer[] = [];
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<ChoiceChangeDetail | TextFieldChangeDetail>).detail;
    seen.push({
      field: tagOf(event, 'field'),
      lifterId: tagOf(event, 'lifter'),
      value: detail.value,
    });
  };
  document.body.addEventListener(eventName, listener);
  teardown.push(() => {
    document.body.removeEventListener(eventName, listener);
  });
  return seen;
}

/** The same walk the root does: the nearest tag of that name on the path. */
function tagOf(event: Event, name: string): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset[name] !== undefined) {
      return node.dataset[name];
    }
  }
  return null;
}

/** The native input behind the add box. */
function nameBox(element: PtkCoachRoster): HTMLInputElement {
  const input = control(element, ROSTER_NAME_FIELD).shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No name box on the roster.');
  return input;
}

/** Which colour tile is showing as chosen for one lifter, if any. */
function checkedColour(element: PtkCoachRoster, lifterId: string): string | null {
  const host = control(element, ROSTER_COLOUR_FIELD, lifterId);
  const radio = [...(host.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.checked,
  );
  return radio?.value ?? null;
}

/**
 * Every row, in document order.
 *
 * `ul > li` rather than a bare `li`: a row holds a fold holding a choice group,
 * and the day one of those renders a list in the light DOM a bare selector
 * would count its items as rows. The board next door hit exactly that and came
 * back with six rows where there were two.
 */
function rows(element: PtkCoachRoster): Element[] {
  return [...(element.shadowRoot?.querySelectorAll('ul > li') ?? [])];
}

describe('ptk-coach-roster', () => {
  it('re-renders when the lifters are replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the screen simply stops updating --
    // which on this screen means a coach adds a lifter and the board fills in
    // while the roster below it goes on showing the flight they arrived with.
    const element = await mount({ lifters: [] });
    expect(deepText(element)).toContain(ROSTER_EMPTY);

    element.lifters = THREE;
    await element.updateComplete;

    expect(rows(element)).toHaveLength(3);
    expect(deepText(element)).toContain('Quintero');
  });

  it('offers nowhere to type a name before there is a rule book', async () => {
    // Absent rather than present and refusing: a meet document is created
    // against a federation, so a name typed here would have nothing to be added
    // to, and a control that cannot do anything is never on screen (§5.11).
    const element = await mount({ lifters: [], ready: false });

    expect(element.shadowRoot?.querySelector(`[data-field="${ROSTER_NAME_FIELD}"]`)).toBeNull();
    expect(deepText(element)).toContain(ROSTER_NEEDS_A_FEDERATION);
  });

  it('says what adding the first lifter costs, and only while it is still true', async () => {
    // The same promise `MEET_IS_RUNNING_NOTE` makes on the solo path, and the
    // same reason it is said beforehand: afterwards it is a sentence about
    // something already done, on a screen with no room for one.
    const empty = await mount({ lifters: [] });
    expect(deepText(empty)).toContain(ROSTER_STARTS_THE_MEET);

    const running = await mount();
    expect(deepText(running)).not.toContain(ROSTER_STARTS_THE_MEET);
  });

  it('reports a press carrying the name it was showing', async () => {
    // The name travels in the event rather than being read back off this
    // element: a root reading the property would be reading it after a Lit
    // update it cannot await, and the row it added could carry a keystroke the
    // coach typed after the press landed.
    const element = await mount({ name: 'Quintero' });
    const seen: RosterAddDetail[] = [];
    const listener = (event: CustomEvent<RosterAddDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ROSTER_ADD_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ROSTER_ADD_EVENT, listener);
    });

    await add(element);

    expect(seen).toEqual([{ name: 'Quintero' }]);
  });

  it('reports a blank name rather than swallowing the press', async () => {
    // Deliberately not disabled. `add-lifter` refuses an empty name with
    // `lifter-name-required` and the root already knows how to say that; a
    // second check here would be a copy of a domain rule in an element,
    // answering differently the day the rule changes. The press also has to
    // survive landing on the `ptk-button` host's own padding, which runs the
    // listener whatever the inner control's state.
    const element = await mount({ lifters: [], name: '' });
    const seen: RosterAddDetail[] = [];
    const listener = (event: CustomEvent<RosterAddDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ROSTER_ADD_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ROSTER_ADD_EVENT, listener);
    });

    await add(element);

    expect(seen).toEqual([{ name: '' }]);
  });

  it('tags an identifier with the lifter it is about, not with a row number', async () => {
    // Both tags on one path, which is the whole reason this element gets a
    // browser test. A `data-field` alone would send every row's lot number to
    // whichever lifter the root last handled.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(element, control(element, ROSTER_IDENTIFIER_FIELD, 'lifter-2'), '99');

    expect(seen).toEqual([{ field: ROSTER_IDENTIFIER_FIELD, lifterId: 'lifter-2', value: '99' }]);
  });

  it('reports an identifier untrimmed, because it is what the coach typed', async () => {
    // `rosterSummary` trims only to decide whether there is one. Trimming on
    // the way out would make this element the author of the answer, and the one
    // case where that matters is a lot number with a trailing space that the
    // coach can see in the box and the board cannot.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(element, control(element, ROSTER_IDENTIFIER_FIELD, 'lifter-1'), ' 7 ');

    expect(seen[0]?.value).toBe(' 7 ');
  });

  it('reports taking a colour off as an answer, not as silence', async () => {
    // `NO_COLOUR` is a real option and the root maps it to `null`. An empty
    // string here would read as noise on a listener that has to tell "the coach
    // cleared it" from "nothing was said", and the board would go on drawing a
    // swatch nobody asked for.
    const element = await mount();
    const seen = watch(CHOICE_CHANGE_EVENT);

    await choose(element, 'lifter-1', NO_COLOUR);

    expect(seen).toEqual([{ field: ROSTER_COLOUR_FIELD, lifterId: 'lifter-1', value: NO_COLOUR }]);
  });

  it('shows an answered colour as answered, and an unanswered one as none', async () => {
    // Found by mutation: nothing read the tiles back, so binding the group to
    // the empty string passed the whole suite. The cost is paid on the second
    // visit to a row -- the summary line says orange, the fold opens with seven
    // blank tiles, and a coach re-picks a colour they already gave. The row with
    // no colour is the control, and it is the reason the fallback is `NO_COLOUR`
    // rather than nothing: that option is a real answer (§21) and has to be able
    // to show as the current one.
    const element = await mount();

    expect(checkedColour(element, 'lifter-1')).toBe(colour(1));
    expect(checkedColour(element, 'lifter-3')).toBe(NO_COLOUR);
  });

  it('shows the name the root is holding, so the box and the press agree', async () => {
    // The other mutation survivor. `ROSTER_ADD_EVENT` reports `this.name`, so a
    // box that is not bound to the same property is a screen where the press
    // adds a lifter other than the one on display -- and after an add the root
    // clears the name, which is what puts the box back to empty for the next
    // lifter. Both states, because a box that ignored the property entirely
    // would satisfy either assertion on its own.
    const named = await mount({ name: 'Quintero' });
    expect(nameBox(named).value).toBe('Quintero');

    const blank = await mount({ name: '' });
    expect(nameBox(blank).value).toBe('');
  });

  it('names every colour in words', async () => {
    // §21: colour is never the sole identity cue, and that rule reaches the
    // control where the colour is chosen as well as the board where it is
    // drawn. Seven tiles distinguished only by their fill is a red-green reader
    // choosing between identical boxes.
    const element = await mount();
    const tiles = deepText(control(element, ROSTER_COLOUR_FIELD, 'lifter-1'));

    for (const choice of COLOUR_CHOICES) {
      expect(tiles).toContain(choice.label);
    }
  });

  it('keeps both per-lifter answers readable with every row shut', async () => {
    // The fold's whole justification: eight lifters' text fields and colour
    // tiles would be eight screenfuls of controls above the board on a phone
    // (§5.7), and that is only acceptable if the answers survive the fold. The
    // summary is rendered inside `ptk-disclosure`'s own root, so this needs
    // `deepText` -- a host-only read comes back empty and passes.
    const element = await mount();
    const text = deepText(element);

    expect(text).toContain('14, orange');
    expect(text).toContain('15, blue');
    // The row with neither answer still says something. An empty summary reads
    // as a row that failed to load rather than as one nobody has filled in.
    expect(text).toContain('No identifier, no colour');
  });

  it('gives every lifter their own row, in the order they were added', async () => {
    // The roster does not re-sort and the board beside it does, four times a
    // second. That difference is the reason both screens key on `data-lifter`
    // rather than on a position, so the order here is a property worth pinning:
    // a coach reads the two side by side and a roster that reordered itself to
    // match the ladder would move a row under a thumb aiming at it.
    const element = await mount();

    expect(rows(element)).toHaveLength(3);
    expect(rows(element).map((row) => deepText(row).split(' ')[0])).toEqual([
      'Quintero',
      'Okonkwo',
      'Beaulieu',
    ]);
  });

  it('has no accessibility violations with a flight on screen', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations with a row open', async () => {
    // The controls are the half of this screen axe cannot see while it is
    // folded: `<details>` hides its contents from the accessibility tree, so
    // the labelled text field and the seven radios below it are only reachable
    // here. Opened by setting `open` rather than by pressing the summary --
    // `toggle` fires asynchronously (§13.6).
    const element = await mount();
    const fold = element.shadowRoot?.querySelector('ptk-disclosure');
    if (fold === null || fold === undefined) throw new Error('No lifter row to open.');
    fold.open = true;
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with a row open', async () => {
    // Open, because shut is the easy case: the seven colour tiles and the
    // identifier field are what has to fit, and §27 forbids sideways scrolling
    // on any urgent workflow outright.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mount({ within: frame });
    const fold = element.shadowRoot?.querySelector('ptk-disclosure');
    if (fold === null || fold === undefined) throw new Error('No lifter row to open.');
    fold.open = true;
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
