// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21's roster, and the four things a real browser is needed to prove.
 *
 * 1. **Two axes on one path, and on a handler row three.** Every other element
 *    in this tool tags an answer with `data-field` alone; a row here also
 *    carries `data-lifter`, and a control on one of §21.3's handlers carries
 *    `data-handler` on top of that. The root reads all of them off the same
 *    `composedPath()`. A test in an emulated DOM can assert the attributes are
 *    in the template and still miss that they never reach the listener, which
 *    is the failure that puts one lifter's lot number on another lifter's row,
 *    or one handler's duties onto the person standing next to them.
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
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-text-field';
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
import {
  COLOUR_CHOICES,
  HANDLER_RESPONSIBILITY_CHOICES,
  NO_COLOUR,
  ROSTER_EMPTY,
  ROSTER_HANDLERS_EMPTY,
  ROSTER_NEEDS_A_FEDERATION,
  ROSTER_STARTS_THE_MEET,
} from './copy.js';
import {
  ROSTER_COLOUR_FIELD,
  ROSTER_HANDLER_ADD_FIELD,
  ROSTER_HANDLER_DUTIES_FIELD,
  ROSTER_HANDLER_NAME_FIELD,
  ROSTER_HANDLER_REMOVE_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  ROSTER_RACK_FIELD,
} from './fields.js';
import {
  ROSTER_ADD_EVENT,
  ROSTER_HANDLER_ADD_EVENT,
  ROSTER_HANDLER_REMOVE_EVENT,
  type PtkCoachRoster,
  type RosterAddDetail,
  type RosterHandlerAddDetail,
  type RosterHandlerRemoveDetail,
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

/**
 * Three lifters, and the three shapes §21.3 and §21.4 have to render.
 *
 * The first is a lifter with two handlers on a shared bar, the second has one
 * handler and no bar, the third has neither. That spread is what the assertions
 * below are built on: a fixture where every row carried a handler could not tell
 * a summary that always says "1 handler" from one that counts, and a fixture
 * where none did would leave every binding on the handler row untested.
 *
 * The first handler's responsibilities are deliberately two of the seven and
 * deliberately not the default a new row is created with -- a group bound to
 * `['general']` and a group ignoring the property entirely look identical
 * against a row that was never edited.
 */
const THREE: readonly RosterLifter[] = [
  {
    lifterId: 'lifter-1',
    name: 'Quintero',
    identifier: '14',
    colour: colour(1),
    handlers: [
      { name: 'Rae', responsibilities: ['attempt-submission', 'platform-escort'] },
      { name: 'Devi', responsibilities: ['warm-up-loading'] },
    ],
    rackId: '1',
  },
  {
    lifterId: 'lifter-2',
    name: 'Okonkwo',
    identifier: '15',
    colour: colour(2),
    handlers: [{ name: 'Rae', responsibilities: ['general'] }],
    rackId: '',
  },
  {
    lifterId: 'lifter-3',
    name: 'Beaulieu',
    identifier: '',
    colour: null,
    handlers: [],
    rackId: '',
  },
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
  /**
   * The third axis, `null` on the answers that are about the lifter themselves.
   *
   * Recorded on every answer rather than only on the handler ones, so that the
   * identifier and the bar assert they are *not* tagged with a position: a
   * `data-handler` that leaked onto a row-level control would be read by the
   * root as an answer about whichever handler happened to be first.
   */
  readonly handler: string | null;
  readonly value: string;
}

function watch(eventName: string): Answer[] {
  const seen: Answer[] = [];
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<ChoiceChangeDetail | TextFieldChangeDetail>).detail;
    seen.push({
      field: tagOf(event, 'field'),
      lifterId: tagOf(event, 'lifter'),
      handler: tagOf(event, 'handler'),
      value: detail.value,
    });
  };
  document.body.addEventListener(eventName, listener);
  teardown.push(() => {
    document.body.removeEventListener(eventName, listener);
  });
  return seen;
}

/**
 * The same thing for `ptk-toggle-group`, which reports a whole selection.
 *
 * A separate shape rather than a `values` field on `Answer`: the toggle group
 * deliberately reports the set and not the one box that moved, because a
 * report of one tick applied over a stored list is how a coach loses the other
 * six (`CHECKLIST_GROUP_FIELD` in `fields.ts` records the same failure). A
 * watcher recording only `detail.value` here would pass against a group that
 * had forgotten every other answer.
 */
interface Selection {
  readonly field: string | null;
  readonly lifterId: string | null;
  readonly handler: string | null;
  readonly values: readonly string[];
}

function watchSelections(): Selection[] {
  const seen: Selection[] = [];
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<ToggleGroupChangeDetail>).detail;
    seen.push({
      field: tagOf(event, 'field'),
      lifterId: tagOf(event, 'lifter'),
      handler: tagOf(event, 'handler'),
      values: detail.values,
    });
  };
  document.body.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, listener);
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

/** The one control answering a field for one handler on one lifter. */
function handlerControl(
  element: PtkCoachRoster,
  field: string,
  lifterId: string,
  index: number,
): Element {
  const selector = `[data-field="${field}"][data-lifter="${lifterId}"][data-handler="${String(index)}"]`;
  const found = element.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) {
    throw new Error(`No "${field}" for handler ${String(index)} of "${lifterId}".`);
  }
  return found;
}

/** Presses the native control inside any of this element's buttons. */
async function press(element: PtkCoachRoster, host: Element): Promise<void> {
  const button = host.shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement))
    throw new Error(`No button inside ${host.localName}.`);
  button.click();
  await element.updateComplete;
}

/**
 * Which responsibilities are showing as ticked for one handler.
 *
 * Read off the boxes rather than off the property that was bound to them, for
 * the reason §13.13 records against the colour tiles: a group that ignored
 * `.values` entirely satisfies every assertion written through an event, and
 * the cost is paid on the second visit to a fold -- seven blank tiles under a
 * summary line saying two handlers, and a coach re-ticking answers they gave.
 */
function ticked(element: PtkCoachRoster, lifterId: string, index: number): string[] {
  const host = handlerControl(element, ROSTER_HANDLER_DUTIES_FIELD, lifterId, index);
  return [...(host.shadowRoot?.querySelectorAll('input') ?? [])]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

/** The native input behind one handler's name box. */
function handlerNameBox(
  element: PtkCoachRoster,
  lifterId: string,
  index: number,
): HTMLInputElement {
  const host = handlerControl(element, ROSTER_HANDLER_NAME_FIELD, lifterId, index);
  const input = host.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No name box on the handler.');
  return input;
}

/** Ticks one responsibility by clicking its box, the way a coach does. */
async function tick(
  element: PtkCoachRoster,
  lifterId: string,
  index: number,
  value: string,
): Promise<void> {
  const host = handlerControl(element, ROSTER_HANDLER_DUTIES_FIELD, lifterId, index);
  const box = [...(host.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (box === undefined) throw new Error(`No responsibility "${value}" to tick.`);
  box.click();
  await element.updateComplete;
}

/** One row's summary line, as the fold was handed it. */
function summaryOf(element: PtkCoachRoster, position: number): string | null {
  const fold = rows(element)[position]?.querySelector('ptk-disclosure');
  if (fold === null || fold === undefined) throw new Error(`No fold on row ${String(position)}.`);
  return fold.getAttribute('summary');
}

/** The handler section of one lifter's row, which is what the presses land in. */
function handlersOf(element: PtkCoachRoster, position: number): Element {
  const row = rows(element)[position];
  const section = row?.querySelector('.handlers');
  if (section === null || section === undefined) {
    throw new Error(`No handler section on row ${String(position)}.`);
  }
  return section;
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

    expect(seen).toEqual([
      { field: ROSTER_IDENTIFIER_FIELD, lifterId: 'lifter-2', handler: null, value: '99' },
    ]);
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

    expect(seen).toEqual([
      { field: ROSTER_COLOUR_FIELD, lifterId: 'lifter-1', handler: null, value: NO_COLOUR },
    ]);
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

  it('shows what each handler was already asked to cover', async () => {
    // The binding `#renderHandler`'s doc names as the one this directory's
    // tests are weakest against, and §13.13 records the same failure against
    // the colour tiles: a group that ignored `.values` passes every assertion
    // written through an event. What it costs is the second visit to a fold --
    // seven blank tiles under a summary line saying two handlers, and a coach
    // re-ticking answers they already gave. Two handlers with different
    // answers, because a group hard-wired to the first handler's set would
    // satisfy either row on its own.
    const element = await mount();

    expect(ticked(element, 'lifter-1', 0)).toEqual(['attempt-submission', 'platform-escort']);
    expect(ticked(element, 'lifter-1', 1)).toEqual(['warm-up-loading']);
  });

  it('shows each handler under the name the coach gave them', async () => {
    // The other bound property on a handler row, and the same argument. A name
    // box that dropped its binding would empty itself every time the row was
    // re-rendered, which on this screen is every keystroke anywhere in it.
    const element = await mount();

    expect(handlerNameBox(element, 'lifter-1', 0).value).toBe('Rae');
    expect(handlerNameBox(element, 'lifter-1', 1).value).toBe('Devi');
  });

  it('names every responsibility in words', async () => {
    // §21.3's seven, written to be read after a name. Seven unlabelled boxes
    // is the colour rule (§21) arriving at a different control: a tile a coach
    // cannot read is one they tick by position and get wrong under pressure.
    const element = await mount();
    const tiles = deepText(handlerControl(element, ROSTER_HANDLER_DUTIES_FIELD, 'lifter-1', 0));

    for (const choice of HANDLER_RESPONSIBILITY_CHOICES) {
      expect(tiles).toContain(choice.label);
    }
  });

  it('tags a handler name with the lifter and the position, not one or the other', async () => {
    // Three axes on one path. Either tag missing is an answer the root cannot
    // place: without the lifter it lands on whoever was handled last, and
    // without the position it overwrites the first handler on the row.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(
      element,
      handlerControl(element, ROSTER_HANDLER_NAME_FIELD, 'lifter-1', 1),
      'Devinder',
    );

    expect(seen).toEqual([
      {
        field: ROSTER_HANDLER_NAME_FIELD,
        lifterId: 'lifter-1',
        handler: '1',
        value: 'Devinder',
      },
    ]);
  });

  it('reports the whole selection when one responsibility is ticked', async () => {
    // `ptk-toggle-group` reports the set rather than the box that moved, and
    // the root writes the set back -- so a watcher reading `detail.value`
    // alone would pass against a group that had forgotten the other six.
    // Ticked in choices order and not tap order, which is the assertion: video
    // sits above general in `HANDLER_RESPONSIBILITIES`, so a group appending
    // the new tick would come back the other way round.
    const element = await mount();
    const seen = watchSelections();

    await tick(element, 'lifter-2', 0, 'video');

    expect(seen).toEqual([
      {
        field: ROSTER_HANDLER_DUTIES_FIELD,
        lifterId: 'lifter-2',
        handler: '0',
        values: ['video', 'general'],
      },
    ]);
  });

  it('asks to add a handler to the lifter whose button was pressed', async () => {
    // Pressed on the row with nobody on it, which is the row a coach actually
    // presses: the add button has to be reachable from the empty state, not
    // only from underneath a list that already exists.
    const element = await mount();
    const seen: RosterHandlerAddDetail[] = [];
    const listener = (event: CustomEvent<RosterHandlerAddDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ROSTER_HANDLER_ADD_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ROSTER_HANDLER_ADD_EVENT, listener);
    });

    await press(element, control(element, ROSTER_HANDLER_ADD_FIELD, 'lifter-3'));

    expect(seen).toEqual([{ lifterId: 'lifter-3' }]);
  });

  it('asks to remove the handler whose button was pressed, by position', async () => {
    // The second handler, deliberately. Removing the first is what a handler
    // that reported a constant zero also does, and the two rows are otherwise
    // indistinguishable from outside -- which is the whole hazard of keying a
    // list by position, and why `fields.ts` argues the case at length.
    const element = await mount();
    const seen: RosterHandlerRemoveDetail[] = [];
    const listener = (event: CustomEvent<RosterHandlerRemoveDetail>): void => {
      seen.push(event.detail);
    };
    document.body.addEventListener(ROSTER_HANDLER_REMOVE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(ROSTER_HANDLER_REMOVE_EVENT, listener);
    });

    await press(element, handlerControl(element, ROSTER_HANDLER_REMOVE_FIELD, 'lifter-1', 1));

    expect(seen).toEqual([{ lifterId: 'lifter-1', index: 1 }]);
  });

  it('names a remove button after the person it removes, and by position until then', async () => {
    // Two named handlers would give a row two buttons reading "Remove", which
    // on a fold holding three people is a coach removing the wrong one. The
    // unnamed row is the state Add creates and cannot be skipped: a blank name
    // has nothing to name the button after, so it falls back to the position
    // the button is keyed on anyway.
    const element = await mount({
      lifters: [
        {
          lifterId: 'lifter-1',
          name: 'Quintero',
          identifier: '14',
          colour: colour(1),
          handlers: [
            { name: 'Rae', responsibilities: ['general'] },
            { name: '', responsibilities: ['general'] },
          ],
          rackId: '',
        },
      ],
    });
    const text = deepText(rows(element)[0] ?? element);

    expect(text).toContain('Remove Rae');
    expect(text).toContain('Remove handler 2');
  });

  it('says so on a row where nobody is helping yet', async () => {
    // Scoped to the row, because the sentence is on screen somewhere as long
    // as any lifter has nobody on them -- an element-wide assertion passes
    // against a version that printed it on every row, including the two with
    // handlers listed above it.
    const element = await mount();

    expect(deepText(handlersOf(element, 2))).toContain(ROSTER_HANDLERS_EMPTY);
    expect(deepText(handlersOf(element, 0))).not.toContain(ROSTER_HANDLERS_EMPTY);
  });

  it('shows the bar each lifter is on, and an empty box where there is none', async () => {
    // §21.4. Both states, because a field that ignored the property entirely
    // satisfies the second assertion on its own -- and the empty one is what
    // most rows look like, so it is the one a mutation hides behind.
    const element = await mount();
    const onABar = control(element, ROSTER_RACK_FIELD, 'lifter-1').shadowRoot?.querySelector(
      'input',
    );
    const onNone = control(element, ROSTER_RACK_FIELD, 'lifter-3').shadowRoot?.querySelector(
      'input',
    );

    expect(onABar?.value).toBe('1');
    expect(onNone?.value).toBe('');
  });

  it('tags the bar with the lifter and with no handler', async () => {
    // A bar belongs to the lifter, not to whoever is loading it. A stray
    // `data-handler` here would be read by the root as an answer about the
    // first handler on the row, and the bar would never be recorded at all.
    const element = await mount();
    const seen = watch(TEXT_FIELD_CHANGE_EVENT);

    await enter(element, control(element, ROSTER_RACK_FIELD, 'lifter-2'), '2');

    expect(seen).toEqual([
      { field: ROSTER_RACK_FIELD, lifterId: 'lifter-2', handler: null, value: '2' },
    ]);
  });

  it('ignores a press inside the handlers that answers no field', async () => {
    // The delegated listener's two guards, exercised from inside the container
    // it is attached to -- §13.14 records both tests passing with both guards
    // deleted when the event was fired at the fold instead, because the
    // handler was never entered and "nothing was reported" is what a listener
    // that did not run also produces. The real press afterwards is the control
    // that catches exactly that.
    const element = await mount();
    const added: RosterHandlerAddDetail[] = [];
    const removed: RosterHandlerRemoveDetail[] = [];
    const onAdd = (event: CustomEvent<RosterHandlerAddDetail>): void => {
      added.push(event.detail);
    };
    const onRemove = (event: CustomEvent<RosterHandlerRemoveDetail>): void => {
      removed.push(event.detail);
    };
    document.body.addEventListener(ROSTER_HANDLER_ADD_EVENT, onAdd);
    document.body.addEventListener(ROSTER_HANDLER_REMOVE_EVENT, onRemove);
    teardown.push(() => {
      document.body.removeEventListener(ROSTER_HANDLER_ADD_EVENT, onAdd);
      document.body.removeEventListener(ROSTER_HANDLER_REMOVE_EVENT, onRemove);
    });

    const section = handlersOf(element, 0);
    // No field on the path at all, which is the gap between two buttons.
    const bare = document.createElement('div');
    section.append(bare);
    bare.click();
    // A field the handler section does not answer, which is the second guard.
    const foreign = document.createElement('div');
    foreign.dataset['field'] = ROSTER_IDENTIFIER_FIELD;
    foreign.dataset['lifter'] = 'lifter-1';
    section.append(foreign);
    foreign.click();

    expect(added).toEqual([]);
    expect(removed).toEqual([]);

    await press(element, control(element, ROSTER_HANDLER_ADD_FIELD, 'lifter-1'));

    expect(added).toEqual([{ lifterId: 'lifter-1' }]);
  });

  it('counts the handlers and names the bar on the summary line', async () => {
    // The fold's justification again (§5.7): four answers per lifter now, and
    // the whole roster still has to be readable shut. Both of the new parts
    // are omitted rather than reported absent -- an identifier and a colour
    // are asked of every lifter, a bar and a handler only of a room that has
    // them, and "no bar, no handlers" on every row of a solo coach's roster is
    // three quarters of the line saying nothing.
    // Read off the fold's own `summary` rather than through `deepText`: the
    // row below it holds a "Handlers" heading and an "Add a handler" button,
    // so an omission assertion written over the whole row is satisfied by the
    // controls and can never fail. The test above already proves the summary
    // reaches the screen.
    const element = await mount();

    expect(summaryOf(element, 0)).toBe('14, orange, bar 1, 2 handlers');
    expect(summaryOf(element, 1)).toBe('15, blue, 1 handler');
    expect(summaryOf(element, 2)).toBe('No identifier, no colour');
  });

  it('has no accessibility violations with a flight on screen', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no accessibility violations with a row open', async () => {
    // The controls are the half of this screen axe cannot see while it is
    // folded: `<details>` hides its contents from the accessibility tree, so
    // the two text fields, the seven radios and -- since §21.3 -- two handlers'
    // name boxes, tile groups and remove buttons are only reachable here. The
    // first row is opened deliberately: it is the only one with a handler on
    // it, and an empty row would leave that whole fieldset unaudited. Opened
    // by setting `open` rather than by pressing the summary -- `toggle` fires
    // asynchronously (§13.6).
    const element = await mount();
    const fold = element.shadowRoot?.querySelector('ptk-disclosure');
    if (fold === null || fold === undefined) throw new Error('No lifter row to open.');
    fold.open = true;
    await element.updateComplete;

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with a row open', async () => {
    // Open, because shut is the easy case: the seven colour tiles, the two
    // text fields and two handlers' worth of seven-tile groups and full-width
    // buttons are what has to fit, and §27 forbids sideways scrolling on any
    // urgent workflow outright. The first row again, for the same reason the
    // audit above opens it -- the handler rows are three levels of box deep
    // and are the narrowest thing on the screen.
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
