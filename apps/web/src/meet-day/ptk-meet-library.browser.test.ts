// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24.2's shelf, and the five things only a real browser settles.
 *
 * 1. **Three tone bindings the compiler cannot see.** `tone` on `ptk-notice`
 *    accepts `info | error` and nothing type-checks a lit-html binding, so the
 *    first draft of this element wrote `warning` five times and compiled. The
 *    assertions below read the attribute off the notice rather than reading the
 *    sentence inside it -- a wrong tone renders the right words, which is
 *    exactly why every test written the other way passed.
 * 2. **A press against a shelf that has moved on.** `#pressed` looks the id up
 *    in `this.library` instead of trusting `dataset`, and the event that proves
 *    it is dispatched from the *element*, not the button -- so a detached row's
 *    control still reaches a listener on the body when the guard is missing.
 *    This is the §13.6 shape for the fifth time in this directory.
 * 3. **The file input is clipped, not `display: none`.** A display-none input
 *    cannot be opened by script in Safari, and the whole of Import is a button
 *    that opens it. That is a computed style, so it needs a browser.
 * 4. **The value is cleared on every change**, which is what lets the same file
 *    be picked twice after a refusal. Nothing but the live input can show it.
 * 5. **The layout at 320px** (§5.7), with five controls to a row.
 *
 * The shelf comes from `library-fixture.ts` for the reason the stories use it:
 * a `SavedMeet` literal can hold a shelf the transitions cannot produce, and a
 * screen proved to cope with one of those is proved to cope with nothing.
 */
import { type NoticeTone } from '@platform-toolkit/ui';
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import {
  MEET_DELETE_ALL_WARNING,
  MEET_LIBRARY_EMPTY,
  STORAGE_EXPORT_ADVICE,
  STORAGE_WARNING,
  STORAGE_WARNING_NOT_DURABLE,
  duplicateMeetName,
  importOutcomeSentence,
  libraryRefusalSentence,
  unreadableMeetsSentence,
} from './copy.js';
import { aShelf, meetOn, oneMeet } from './library-fixture.js';
import {
  MEET_COMMAND_EVENT,
  MEET_DELETE_ALL_EVENT,
  MEET_EXPORT_EVENT,
  MEET_IMPORT_EVENT,
  type MeetCommandDetail,
  type MeetImportDetail,
  type PtkMeetLibrary,
} from './ptk-meet-library.js';
import './ptk-meet-library.js';
import { EMPTY_LIBRARY, type MeetLibrary } from './saved-meet.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly library?: MeetLibrary;
  readonly unreadable?: number;
  readonly durable?: boolean;
  readonly message?: string;
  readonly messageTone?: NoticeTone;
  readonly within?: HTMLElement;
}

async function mount(options: Options = {}): Promise<PtkMeetLibrary> {
  const element = document.createElement('ptk-meet-library');
  element.library = options.library ?? aShelf();
  element.unreadable = options.unreadable ?? 0;
  element.durable = options.durable ?? true;
  element.message = options.message ?? '';
  if (options.messageTone !== undefined) element.messageTone = options.messageTone;
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * The one control carrying that command, for that meet where a meet is named.
 *
 * Every control on the shelf carries a unique `data-command` so this can throw
 * on an ambiguous answer rather than silently returning whichever one the
 * template happened to draw first. It returns the `ptk-button` host, because
 * that is where the listener is and where a forged press has to land.
 */
function control(element: PtkMeetLibrary, command: string, meetId?: string): Element {
  const selector =
    meetId === undefined
      ? `ptk-button[data-command="${command}"]`
      : `ptk-button[data-command="${command}"][data-meet="${meetId}"]`;
  const found = [...(element.shadowRoot?.querySelectorAll(selector) ?? [])];
  const [first, ...rest] = found;
  if (first === undefined) throw new Error(`No "${command}" control on the shelf.`);
  if (rest.length > 0)
    throw new Error(`${String(found.length)} "${command}" controls on the shelf.`);
  return first;
}

/** Presses the native button inside a control, the way a thumb does. */
async function press(element: PtkMeetLibrary, command: string, meetId?: string): Promise<void> {
  const button = control(element, command, meetId).shadowRoot?.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No button inside "${command}".`);
  button.click();
  await element.updateComplete;
}

/** Types a new name into the rename panel's field. */
async function rename(element: PtkMeetLibrary, text: string): Promise<void> {
  const field = element.shadowRoot?.querySelector('.rename ptk-text-field');
  const input = field?.shadowRoot?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('No rename field on the shelf.');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

function watchCommands(): MeetCommandDetail[] {
  const seen: MeetCommandDetail[] = [];
  const listener = (event: CustomEvent<MeetCommandDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(MEET_COMMAND_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(MEET_COMMAND_EVENT, listener);
  });
  return seen;
}

function watchImports(): MeetImportDetail[] {
  const seen: MeetImportDetail[] = [];
  const listener = (event: CustomEvent<MeetImportDetail>): void => {
    seen.push(event.detail);
  };
  document.body.addEventListener(MEET_IMPORT_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(MEET_IMPORT_EVENT, listener);
  });
  return seen;
}

/** Counts a bare notification, which carries no detail worth reading. */
function counter(eventName: string): () => number {
  let seen = 0;
  const listener = (): void => {
    seen += 1;
  };
  document.body.addEventListener(eventName, listener);
  teardown.push(() => {
    document.body.removeEventListener(eventName, listener);
  });
  return () => seen;
}

/**
 * Every notice on the shelf, in document order.
 *
 * The storage sentence is always first; the unreadable count and the planner's
 * message follow it when there is one. Read as a list rather than by index, so
 * that a test naming the second notice says which second notice it means.
 */
function notices(element: PtkMeetLibrary): Element[] {
  return [...(element.shadowRoot?.querySelectorAll('ptk-notice') ?? [])];
}

function noticeSaying(element: PtkMeetLibrary, sentence: string): Element {
  const found = notices(element).find((notice) => deepText(notice).includes(sentence));
  if (found === undefined) {
    throw new Error(`No notice saying that. On screen: ${deepText(element)}`);
  }
  return found;
}

/**
 * Every row, in document order.
 *
 * `ul > li` rather than a bare `li`, for the reason the roster next door gives:
 * a row draws lists of its own and a bare selector counts their items as rows.
 */
function rows(element: PtkMeetLibrary): Element[] {
  return [...(element.shadowRoot?.querySelectorAll('ul > li') ?? [])];
}

function fileInput(element: PtkMeetLibrary): HTMLInputElement {
  const input = element.shadowRoot?.querySelector('input[type=file]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No file input on the shelf.');
  return input;
}

/** One meet export, as a `File` the picker would have handed over. */
function chosen(input: HTMLInputElement, name: string): File {
  const file = new File(['{}'], name, { type: 'application/json' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return file;
}

describe('ptk-meet-library', () => {
  it('re-renders when the shelf is replaced after the first render', async () => {
    // The canary for Lit's decorator configuration (§5.8). Everything else in
    // this file passes when it is wrong, and the shelf simply stops updating --
    // a lifter names their meet, the planner saves it, and the list below goes
    // on saying nothing has been saved yet.
    const element = await mount({ library: EMPTY_LIBRARY });
    expect(deepText(element)).toContain(MEET_LIBRARY_EMPTY);

    element.library = aShelf();
    await element.updateComplete;

    expect(rows(element)).toHaveLength(4);
    expect(deepText(element)).not.toContain(MEET_LIBRARY_EMPTY);
  });

  it('separates the meets to come back to from the ones already run', async () => {
    const element = await mount();
    const names = rows(element).map((row) => row.querySelector('h4')?.textContent);
    // Two open, then the two archived under their own heading, each pair in the
    // shelf's own newest-first order. `aShelf` finished the two oldest, so this
    // also proves the split is by the archive flag and that neither section
    // resorted what `createMeet` had already ordered.
    expect(names).toEqual([
      'Autumn Qualifier',
      'Summer Nationals',
      'Spring Classic',
      'Winter Open',
    ]);
  });
});

describe('the storage warning', () => {
  it('is a quiet note when the browser is keeping the meets', async () => {
    const element = await mount({ durable: true });
    const notice = noticeSaying(element, STORAGE_WARNING);
    expect(notice.getAttribute('tone')).toBe('info');
    expect(deepText(notice)).toContain(STORAGE_EXPORT_ADVICE);
  });

  it('is an error when the browser is keeping nothing, and drops the export advice', async () => {
    // Not because anything failed, but because the screen cannot do the thing it
    // is about -- and `error` is the one tone carrying a border as well as a
    // colour, so it survives forced colours and a reader who cannot separate the
    // hues. The advice goes because it is written for the durable case: telling
    // somebody to export "before the meet" reads as optional, and here it is the
    // only way the meet outlives the tab.
    const element = await mount({ durable: false });
    const notice = noticeSaying(element, STORAGE_WARNING_NOT_DURABLE);
    expect(notice.getAttribute('tone')).toBe('error');
    expect(deepText(element)).not.toContain(STORAGE_EXPORT_ADVICE);
  });

  it('is on screen with an empty shelf, which is when it is worth reading', async () => {
    // §24.3 unfolded and above the list, on the first visit -- the one moment at
    // which exporting a copy is a decision rather than a regret.
    const element = await mount({ library: EMPTY_LIBRARY });
    expect(deepText(element)).toContain(STORAGE_WARNING);
  });
});

describe('meets this build cannot open', () => {
  it('are reported as an error, because a read genuinely failed', async () => {
    const element = await mount({ unreadable: 2 });
    const notice = noticeSaying(element, unreadableMeetsSentence(2));
    expect(notice.getAttribute('tone')).toBe('error');
  });

  it('say nothing at all when there are none', async () => {
    const element = await mount({ unreadable: 0 });
    expect(notices(element)).toHaveLength(1);
  });
});

describe("the planner's sentence", () => {
  it('takes the tone the planner supplied, in both directions', async () => {
    // `message` carries a refusal and a report on the same property, so a fixed
    // tone here would be wrong for half of what the planner says. The two
    // assertions are one test because what matters is that they differ: a tone
    // pinned to either value passes one of them on its own.
    const refused = libraryRefusalSentence('library-full');
    const element = await mount({ message: refused, messageTone: 'error' });
    expect(noticeSaying(element, refused).getAttribute('tone')).toBe('error');

    const reported = importOutcomeSentence({
      library: EMPTY_LIBRARY,
      added: 2,
      renumbered: 0,
      skipped: 0,
    });
    element.message = reported;
    element.messageTone = 'info';
    await element.updateComplete;
    expect(noticeSaying(element, reported).getAttribute('tone')).toBe('info');
  });

  it('is announced, so a refusal reaches somebody not looking at it', async () => {
    const refused = libraryRefusalSentence('name-required');
    const element = await mount({ message: refused });
    expect(noticeSaying(element, refused).getAttribute('role')).toBe('status');
  });

  it('is nothing at all when the planner has said nothing', async () => {
    const element = await mount({ message: '' });
    expect(element.shadowRoot?.querySelector('ptk-notice[role="status"]')).toBeNull();
  });
});

describe('what a press reports', () => {
  it('names the meet it was about', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'resume', 'meet-3');
    expect(seen).toEqual([{ kind: 'resume', meetId: 'meet-3' }]);
  });

  it('carries the copy name a duplicate would be saved under', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'duplicate', 'meet-4');
    expect(seen).toEqual([
      {
        kind: 'duplicate',
        meetId: 'meet-4',
        name: duplicateMeetName(meetOn(aShelf(), 'meet-4').name),
      },
    ]);
  });

  it('asks the archive flag to flip, in whichever direction the meet is', async () => {
    // Both directions, because one control does both jobs and a handler that
    // always asked for `true` would look correct on every open meet -- which is
    // most of the shelf, and all of it on a first meet.
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'archive', 'meet-4');
    await press(element, 'archive', 'meet-1');
    expect(seen).toEqual([
      { kind: 'archive', meetId: 'meet-4', archived: true },
      { kind: 'archive', meetId: 'meet-1', archived: false },
    ]);
  });

  it('labels the archive control for the meet it sits on', async () => {
    const element = await mount();
    expect(control(element, 'archive', 'meet-4').textContent.trim()).toBe('Mark finished');
    expect(control(element, 'archive', 'meet-1').textContent.trim()).toBe('Reopen');
  });

  it('says nothing for a meet the shelf no longer holds', async () => {
    // The §13.6 shape. The listener is on the `ptk-button` host, so a press
    // landing on the host's own box -- or any caller doing `host.click()` --
    // runs the handler whatever the row's state; and the event would be
    // dispatched from the library element, which is still attached, so a
    // listener on the body sees it. Without the lookup that is a resume for a
    // meet that is not there.
    const element = await mount();
    const stale = control(element, 'resume', 'meet-3');
    element.library = oneMeet();
    await element.updateComplete;

    const seen = watchCommands();
    stale.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await element.updateComplete;
    expect(seen).toEqual([]);

    // The control, so that a handler which reported nothing at all would fail.
    await press(element, 'resume', 'meet-1');
    expect(seen).toEqual([{ kind: 'resume', meetId: 'meet-1' }]);
  });
});

describe('renaming', () => {
  it('reports the name that was typed, not the one it started from', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'start-rename', 'meet-4');
    await rename(element, 'Autumn Qualifier -- 74kg');
    await press(element, 'rename', 'meet-4');
    expect(seen).toEqual([{ kind: 'rename', meetId: 'meet-4', name: 'Autumn Qualifier -- 74kg' }]);
  });

  it('opens the field with the meet name already in it', async () => {
    const element = await mount();
    await press(element, 'start-rename', 'meet-4');
    const input = element.shadowRoot
      ?.querySelector('.rename ptk-text-field')
      ?.shadowRoot?.querySelector('input');
    expect(input?.value).toBe('Autumn Qualifier');
  });

  it('carries no length cap on the field, because the refusal is in words', async () => {
    // `readMeetName` applies `MEET_NAME_MAX` and reports `name-too-long` for the
    // shelf to render. A `maxlength` here would be a second copy of that rule in
    // a layer that cannot explain itself -- a pasted name is silently truncated
    // and the lifter is left to work out that the tool has an opinion.
    const element = await mount();
    await press(element, 'start-rename', 'meet-4');
    const input = element.shadowRoot
      ?.querySelector('.rename ptk-text-field')
      ?.shadowRoot?.querySelector('input');
    expect(input?.hasAttribute('maxlength')).toBe(false);
  });

  it('closes without reporting anything when it is cancelled', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'start-rename', 'meet-4');
    await press(element, 'cancel-rename');
    expect(seen).toEqual([]);
    expect(element.shadowRoot?.querySelector('.rename')).toBeNull();
  });
});

describe('deleting one meet', () => {
  it('takes two presses, and names the meet in between', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'arm-delete', 'meet-3');
    expect(seen).toEqual([]);
    expect(deepText(element)).toContain('Summer Nationals');
    expect(deepText(element)).toContain('cannot be undone');

    await press(element, 'delete', 'meet-3');
    expect(seen).toEqual([{ kind: 'delete', meetId: 'meet-3' }]);
    expect(element.shadowRoot?.querySelector('.armed')).toBeNull();
  });

  it('offers a way out that keeps the meet', async () => {
    const element = await mount();
    const seen = watchCommands();
    await press(element, 'arm-delete', 'meet-3');
    await press(element, 'keep');
    expect(seen).toEqual([]);
    expect(element.shadowRoot?.querySelector('.armed')).toBeNull();
  });

  it('arms one meet at a time, and puts a rename away while it is armed', async () => {
    // Two panels open at once is two meets' worth of controls under one thumb,
    // on the one screen where the wrong press is not recoverable.
    const element = await mount();
    await press(element, 'start-rename', 'meet-4');
    await press(element, 'arm-delete', 'meet-3');
    expect(element.shadowRoot?.querySelector('.rename')).toBeNull();

    await press(element, 'arm-delete', 'meet-4');
    expect(element.shadowRoot?.querySelectorAll('.armed')).toHaveLength(1);
  });
});

describe('deleting everything', () => {
  it('takes two presses, with the warning in between', async () => {
    const element = await mount();
    const fired = counter(MEET_DELETE_ALL_EVENT);
    await press(element, 'arm-all');
    expect(fired()).toBe(0);
    expect(deepText(element)).toContain(MEET_DELETE_ALL_WARNING);

    await press(element, 'delete-all');
    expect(fired()).toBe(1);
    expect(deepText(element)).not.toContain(MEET_DELETE_ALL_WARNING);
  });

  it('can be called off', async () => {
    const element = await mount();
    const fired = counter(MEET_DELETE_ALL_EVENT);
    await press(element, 'arm-all');
    await press(element, 'cancel-all');
    expect(fired()).toBe(0);
    expect(deepText(element)).not.toContain(MEET_DELETE_ALL_WARNING);
  });
});

describe('export and import', () => {
  it('asks the planner to write the file, and writes nothing itself', async () => {
    const element = await mount();
    const fired = counter(MEET_EXPORT_EVENT);
    await press(element, 'export');
    expect(fired()).toBe(1);
  });

  it('keeps the file input reachable by script rather than hiding it', async () => {
    // `display: none` is the obvious way to hide it and is the one way that
    // breaks Import: a display-none input cannot be opened by a script in
    // Safari, which §5.7 names as the primary device.
    const element = await mount();
    const style = getComputedStyle(fileInput(element));
    expect(style.display).not.toBe('none');
    expect(style.visibility).not.toBe('hidden');
  });

  it('opens the picker from the button', async () => {
    const element = await mount();
    let reached = 0;
    fileInput(element).addEventListener('click', () => {
      reached += 1;
    });
    await press(element, 'import');
    expect(reached).toBe(1);
  });

  it('hands the chosen file over without reading it', async () => {
    const element = await mount();
    const seen = watchImports();
    const file = chosen(fileInput(element), 'meet-day-2026-08-04.json');
    await element.updateComplete;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.file).toBe(file);
  });

  it('clears the input, so the same file can be picked again after a refusal', async () => {
    // Without this a lifter whose import was refused has to choose something
    // else and come back, because a second pick of the same file fires no
    // change event at all.
    const element = await mount();
    const input = fileInput(element);
    const seen = watchImports();
    chosen(input, 'meet-day-2026-08-04.json');
    await element.updateComplete;
    expect(input.value).toBe('');

    chosen(input, 'meet-day-2026-08-04.json');
    await element.updateComplete;
    expect(seen).toHaveLength(2);
  });

  it('reports nothing when the picker was dismissed', async () => {
    const element = await mount();
    const seen = watchImports();
    fileInput(element).dispatchEvent(new Event('change', { bubbles: true }));
    await element.updateComplete;
    expect(seen).toEqual([]);
  });
});

describe('the shelf on a phone', () => {
  it('has no axe violations', async () => {
    const element = await mount({ unreadable: 1, message: libraryRefusalSentence('library-full') });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a 320px column with every row expanded', async () => {
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    const element = await mount({ within: frame, unreadable: 2 });
    await press(element, 'start-rename', 'meet-4');
    await press(element, 'arm-delete', 'meet-3');
    await press(element, 'arm-all');

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
