// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The import panel, driven the way somebody looking a lifter up drives it.
 *
 * Two of the things asserted below are privacy properties rather than behaviours, and
 * they are the reason this file is longer than the element deserves. A pasted link must
 * leave the tab as a name and never as an address, and a search must be a search --
 * nothing here may be reached by an event this element did not mean to hear. Both are
 * invisible on screen when they break.
 *
 * WHY A REAL BROWSER
 *
 * Every control on this panel is in its own shadow root and every event that matters is
 * `composed`, so the guard in `#onChoice` reads `composedPath()` and a simulated DOM
 * with its own retargeting rules would answer a different question. The `Enter` key is
 * the same story: a `keydown` inside `ptk-text-field` is retargeted to the host on the
 * way out, which is exactly why the listener sits on a wrapper and not on the field.
 *
 * WHY A 320 PIXEL ASSERTION IS HERE RATHER THAN IN `check:narrow`
 *
 * The panel is not on the deployed page. Root section 9's athlete-mirror gate is shut,
 * so `getAthleteMirror()` answers `null` in production and the whole route renders
 * without it -- and a `check:narrow` step naming a selector that is not there is a
 * failure, never a skip (section 5.7). So the layout claim is made here, against the
 * widest thing the panel can hold, and it moves into `check:narrow` on the day the gate
 * opens.
 *
 * Every lifter, count and archive below is invented (section 5.1), and the host is
 * `.invalid`, which is reserved and cannot resolve.
 */
import {
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type PtkChoiceGroup,
} from '@platform-toolkit/ui/ptk-choice-group';
// Without the stylesheet every declaration reading a custom property is dropped, so the
// tap-target floor and the 320 px column below are measured against a layout that never
// ships -- and both would pass for the wrong reason.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { IMPORT_NOTES, PROFILE_QUERY_PROBLEMS } from './copy.js';
import { defineQualificationCheck } from './index.js';
import {
  ATHLETE_CHOSEN_EVENT,
  ATHLETE_SEARCH_EVENT,
  type AthleteChosenDetail,
  type AthleteSearchDetail,
  type PtkProfileImport,
} from './ptk-profile-import.js';
import { aHistory, aMirror, twoNamesakes } from './story.fixture.js';

/** A reserved host, so that nothing here can name somebody else's archive. */
const AN_ARCHIVE = 'https://archive.invalid';

const teardown: (() => void)[] = [];

beforeAll(() => {
  defineQualificationCheck();
});

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(
  properties: Partial<Pick<PtkProfileImport, 'mirror' | 'lookup' | 'status'>> = {},
): Promise<PtkProfileImport> {
  const element = document.createElement('ptk-profile-import');
  Object.assign(element, { mirror: aMirror(), ...properties });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Everything the panel has rendered, across every shadow root under it. */
function readAll(element: Element): string {
  const parts: string[] = [];
  const visit = (root: DocumentFragment | HTMLElement): void => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot !== null) visit(node.shadowRoot);
    }
    parts.push(root.textContent);
  };
  const shadow = element.shadowRoot;
  if (shadow !== null) visit(shadow);
  return parts.join(' ');
}

/** Anything the panel draws directly, by tag. */
function inPanel<K extends keyof HTMLElementTagNameMap>(
  element: PtkProfileImport,
  tag: K,
): HTMLElementTagNameMap[K] {
  const found = element.shadowRoot?.querySelector(tag);
  if (found === null || found === undefined) {
    throw new Error(`The panel is not showing a <${tag}>.`);
  }
  return found;
}

/**
 * Puts something in the field the way a thumb does.
 *
 * The native input and an `input` event, not the element's `value` property. A property
 * set is how the field is *rendered*; it fires nothing, so a test written that way
 * would search a term the panel had never been told about.
 */
async function type(element: PtkProfileImport, value: string): Promise<void> {
  const native = inPanel(element, 'ptk-text-field').shadowRoot?.querySelector('input');
  if (!(native instanceof HTMLInputElement)) throw new Error('The panel has no field to type in.');
  native.value = value;
  native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await element.updateComplete;
}

/** Presses Search. */
async function press(element: PtkProfileImport): Promise<void> {
  const native = inPanel(element, 'ptk-button').shadowRoot?.querySelector('button');
  if (!(native instanceof HTMLButtonElement)) throw new Error('The panel has no search button.');
  native.click();
  await element.updateComplete;
}

/** Types a term and presses Search, which is the whole of what a reader does. */
async function search(element: PtkProfileImport, value: string): Promise<void> {
  await type(element, value);
  await press(element);
}

/**
 * Every term the panel has asked to have looked up, from before it is mounted.
 *
 * On `document.body` rather than on the element, matching the root's own suite: a
 * listener attached after the first update sees an empty list, and the test then reads
 * as "the panel never asks" -- which is the failure it exists to catch.
 */
function recordSearches(): readonly string[] {
  const asked: string[] = [];
  const listener = (event: CustomEvent<AthleteSearchDetail>): void => {
    asked.push(event.detail.term);
  };
  document.body.addEventListener(ATHLETE_SEARCH_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(ATHLETE_SEARCH_EVENT, listener);
  });
  return asked;
}

/** Every lifter the reader has handed on, in the order they were picked. */
function recordChoices(): readonly AthleteChosenDetail[] {
  const picked: AthleteChosenDetail[] = [];
  const listener = (event: CustomEvent<AthleteChosenDetail>): void => {
    picked.push(event.detail);
  };
  document.body.addEventListener(ATHLETE_CHOSEN_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(ATHLETE_CHOSEN_EVENT, listener);
  });
  return picked;
}

/**
 * The candidate tiles, found the way the panel's own handler finds them.
 *
 * By `data-picker` and not by label, for the reason the root's suite gives: the label is
 * copy and the attribute is what `#onChoice` reads, so only this lookup fails when the
 * wrapper is dropped -- and dropping it is what silently turns every other choice group
 * on the page into a lifter picker. Two steps, because a compound selector types as
 * `Element` and would need the cast section 2.4 forbids.
 */
function candidates(element: PtkProfileImport): PtkChoiceGroup {
  const wrapper = element.shadowRoot?.querySelector('[data-picker="athlete"]');
  const found = wrapper?.querySelector('ptk-choice-group');
  if (found === null || found === undefined) throw new Error('The panel is offering nobody.');
  return found;
}

/** Answers a tile by clicking its radio, which is the only way a reader can answer one. */
async function choose(element: PtkProfileImport, value: string): Promise<void> {
  const radio = [...(candidates(element).shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) throw new Error(`No candidate tile "${value}".`);
  radio.click();
  await element.updateComplete;
}

/** Which tile is lit, or none. */
function litTile(element: PtkProfileImport): string | null {
  const radios = candidates(element).shadowRoot?.querySelectorAll('input') ?? [];
  return [...radios].find((radio) => radio.checked)?.value ?? null;
}

describe('ptk-profile-import', () => {
  it('shows nothing at all when the build published no archive', async () => {
    const element = await mount({ mirror: null });

    // Not an empty panel and not a disabled field: a search control over an archive
    // that is not there can only disappoint, and the manual route above is complete on
    // its own. This is production today, and it is the one state with no story --
    // `smoke-stories.mjs` fails any story that renders no text, for good reason.
    expect(readAll(element).trim()).toBe('');
    expect(element.shadowRoot?.querySelector('ptk-text-field')).toBeNull();
  });

  it('says where the name goes before anybody has typed one', async () => {
    const element = await mount();

    // First on the panel, not behind a disclosure. A search box on a page about a named
    // third party is the moment a meet director should be told where the name goes.
    expect(readAll(element)).toContain(IMPORT_NOTES.privacy);
  });

  it('asks for the name that was typed', async () => {
    const asked = recordSearches();
    const element = await mount();

    await search(element, 'Jane Invented');

    // Unfolded. Which characters survive a fold is a property of how the archive is
    // indexed, and a panel that folded first would break silently the day it changed.
    expect(asked).toEqual(['Jane Invented']);
  });

  it('searches on the Enter key, because a phone keyboard shows one', async () => {
    const asked = recordSearches();
    const element = await mount();
    await type(element, 'Jane Invented');

    const native = inPanel(element, 'ptk-text-field').shadowRoot?.querySelector('input');
    native?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }),
    );
    await element.updateComplete;

    expect(asked).toEqual(['Jane Invented']);
  });

  it('asks for the lifter a pasted link names, and never for the link', async () => {
    const asked = recordSearches();
    const element = await mount();

    await search(element, `${AN_ARCHIVE}/u/janeinvented1`);

    // The load-bearing assertion of the whole route (section 2.3). Nothing fetches the
    // link, and the address must not reach a caller that could: `view.ts` hands whatever
    // arrives here to the seam, and the seam turns it into a bucket number.
    expect(asked).toEqual(['janeinvented1']);
    expect(asked[0]).not.toContain('archive.invalid');
  });

  it('prints what it read out of a link, so a bad link and a bad spelling can be told apart', async () => {
    const element = await mount();
    await search(element, `${AN_ARCHIVE}/u/janeinvented1`);

    element.lookup = { outcome: 'found', matches: [] };
    await element.updateComplete;

    expect(readAll(element)).toContain(`${IMPORT_NOTES.readFromLink} janeinvented1`);
  });

  it('says nothing was read from a link when the name was typed', async () => {
    const element = await mount();
    await search(element, `${AN_ARCHIVE}/u/janeinvented1`);
    element.lookup = { outcome: 'found', matches: [] };
    await element.updateComplete;

    await search(element, 'Jane Invented');
    await element.updateComplete;

    // Left on screen it would caption a typed search with the previous link's slug --
    // two different searches described by one line, and the wrong one.
    expect(readAll(element)).not.toContain(IMPORT_NOTES.readFromLink);
  });

  it('refuses an empty field without asking the archive anything', async () => {
    const asked = recordSearches();
    const element = await mount();

    await press(element);

    expect(asked).toEqual([]);
    expect(readAll(element)).toContain(PROFILE_QUERY_PROBLEMS.blank);
  });

  it('complains about a link that names no lifter', async () => {
    const asked = recordSearches();
    const element = await mount();

    await search(element, `${AN_ARCHIVE}/`);

    expect(asked).toEqual([]);
    expect(readAll(element)).toContain(PROFILE_QUERY_PROBLEMS['link-without-a-lifter']);
  });

  it('drops the complaint on the next keystroke rather than on the next press', async () => {
    const element = await mount();
    await press(element);

    await type(element, 'J');

    // An error that survives the correction it asked for reads as a field refusing input.
    expect(readAll(element)).not.toContain(PROFILE_QUERY_PROBLEMS.blank);
  });

  it('distinguishes an archive that could not be read from an archive with nobody in it', async () => {
    const failed = await mount({ status: 'failed' });
    const nobody = await mount({ lookup: { outcome: 'found', matches: [] } });
    const unusable = await mount({ lookup: { outcome: 'unusable' } });

    // Three different facts and three different repairs. Collapsed into one sentence,
    // "nothing found" tells a lifter they have never competed (section 7).
    expect(readAll(failed)).toContain(IMPORT_NOTES.failed);
    expect(readAll(nobody)).toContain(IMPORT_NOTES.none);
    expect(readAll(unusable)).toContain(IMPORT_NOTES.unusable);
  });

  it('takes the previous answer off screen while a new search runs', async () => {
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });

    element.status = 'searching';
    await element.updateComplete;

    // A list of candidate people under a new name is the one stale thing on this panel
    // that could be acted on by mistake.
    expect(readAll(element)).toContain(IMPORT_NOTES.searching);
    expect(readAll(element)).not.toContain('Jane Invented');
  });

  it('does not pick for the reader when the archive lists exactly one lifter', async () => {
    const picked = recordChoices();
    const element = await mount({
      lookup: { outcome: 'found', matches: [aHistory('Jane Invented')] },
    });

    // The archive holding one person under a spelling is not evidence that it is the
    // right person, and this tool has no way to acquire that evidence. Pre-selecting
    // would put somebody else's total under this lifter's name with no interaction to
    // blame it on.
    expect(litTile(element)).toBeNull();
    expect(picked).toEqual([]);
    expect(readAll(element)).toContain(IMPORT_NOTES.oneMatchNote);
  });

  it('says why two people are listed under one name', async () => {
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });

    // Without it a reader assumes the archive is duplicated and picks either.
    expect(readAll(element)).toContain(IMPORT_NOTES.matchesNote);
    expect(readAll(element)).toContain('Jane Invented #2');
  });

  it('reports which of two namesakes the reader picked', async () => {
    const picked = recordChoices();
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });

    await choose(element, '1');

    expect(picked.map((detail) => detail.athlete.name)).toEqual(['Jane Invented #2']);
    expect(readAll(element)).toContain(`${IMPORT_NOTES.chosen} Jane Invented #2`);
  });

  it('keeps saying whose results are below when a second search arrives', async () => {
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });
    await choose(element, '1');

    // Two again, so that the previous tile's position still exists in the new list --
    // which is the whole hazard. A shorter list would clear the tile by having nothing
    // at that index, and the assertion below would pass with the reset deleted.
    element.lookup = {
      outcome: 'found',
      matches: [aHistory('Casey Invented'), aHistory('Dana Invented')],
    };
    await element.updateComplete;

    // The two facts come apart here and must not be derived from each other. The tile
    // index is meaningless against a new list and has to go; the results underneath are
    // still the first lifter's until another tile is pressed, so the line saying so is
    // the only thing making the reading attributable -- at exactly the moment two people
    // are in play.
    expect(litTile(element)).toBeNull();
    expect(readAll(element)).toContain(`${IMPORT_NOTES.chosen} Jane Invented #2`);
  });

  it('ignores a choice event that did not come from the lifter picker', async () => {
    const picked = recordChoices();
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });

    // Dispatched on the host, so nothing on the path carries `data-picker`. This is the
    // shipped bug the key exists for, seen from the other side: a composed change event
    // from any control in the tree arrives at this handler looking like its own, and the
    // guard is the only thing that tells them apart (see `pickers.ts`).
    element.dispatchEvent(
      new CustomEvent<ChoiceChangeDetail>(CHOICE_CHANGE_EVENT, { detail: { value: '0' } }),
    );
    await element.updateComplete;

    expect(picked).toEqual([]);
    expect(litTile(element)).toBeNull();
  });

  it('gives the archive its credit and its coverage without a fold to open', async () => {
    const mirror = aMirror();
    const element = await mount({ mirror });
    const shown = readAll(element);

    // A licence credit that has to be opened has not been given, and the coverage
    // sentence is the only thing standing between "not found" and a reader concluding
    // they have never competed.
    expect(shown).toContain(mirror.attribution);
    expect(shown).toContain(mirror.scopeNote);
    // Grouped by the reader's own locale, which is the one part of this the tool has no
    // opinion on -- so the expectation asks the same question rather than pinning a
    // separator this suite would then be asserting about its own runner.
    expect(shown).toContain(mirror.entryCount.toLocaleString());
  });

  it('gives the archive link a target a thumb can hit', async () => {
    const element = await mount();
    const link = element.shadowRoot?.querySelector('.source-link');

    // Out of the sentence and on its own line, because vertical padding on an inline box
    // grows the hit area without growing the line -- so a 44 px target inside a
    // paragraph overlaps the prose above it (section 5.7).
    expect(link?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(44);
  });

  it('fits a 320 pixel column with an unbroken name and an unbroken link segment', async () => {
    // Both of these are strings the panel receives rather than writes -- an archive's
    // own spelling of a name, and the tail of somebody else's address -- and neither has
    // a space in it to break at, which is the only way a column this narrow overflows
    // here. A short fixture name measures the padding and nothing else.
    const unbroken = 'janeinventedwhocompetesunderaveryunbrokenspelling';
    const element = await mount();
    await search(element, `${AN_ARCHIVE}/u/${unbroken}`);
    element.lookup = { outcome: 'found', matches: [aHistory(unbroken)] };
    await element.updateComplete;
    await choose(element, '0');

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

  it('has no accessibility violations', async () => {
    const element = await mount({ lookup: { outcome: 'found', matches: twoNamesakes() } });
    const result = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
