// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

// Every spacing and colour declaration in this control reads a custom property,
// and a declaration referencing an undefined one is dropped -- so without the
// stylesheet the button measured at the bottom of this file has no padding and
// no minimum height, and the tap-target assertion passes against a layout that
// is not the shipped one.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { CONTEXT_EDIT_EVENT, type PtkTargetContext } from './ptk-target-context.js';
import './ptk-target-context.js';
import { ANSWERED, CATALOG, FULLY_ANSWERED } from './records-fixture.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';

/**
 * Real browser, real Shadow DOM.
 *
 * Two of the claims here cannot be made anywhere else. The edit request has to
 * cross this element's shadow boundary to reach the tool that opens the editor,
 * and an emulated DOM that got `composed` wrong would leave a green suite and a
 * summary that is not a button. And the control's whole reason for existing is
 * that it fits where a seven-control form did not, which is a measurement.
 *
 * The catalogue is invented (§5.1). Nothing that ships imports it.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

async function mount(selection: CategorySelection = ANSWERED): Promise<PtkTargetContext> {
  const element = document.createElement('ptk-target-context');
  element.catalog = CATALOG;
  element.selection = selection;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * The one element matching, or a failure naming the selector.
 *
 * Not generic, for the reason the lifts suite gives: `querySelector<T>` is an
 * assertion wearing a function's clothes, and a selector typo hands back the
 * wrong element typed as the right one.
 */
function find(element: PtkTargetContext, selector: string): Element {
  const found = element.shadowRoot?.querySelector(selector);
  if (found === null || found === undefined) {
    throw new Error(`Nothing rendered for "${selector}".`);
  }
  return found;
}

function control(element: PtkTargetContext): HTMLButtonElement {
  const found = find(element, 'button');
  if (!(found instanceof HTMLButtonElement)) throw new Error('The summary is not a button.');
  return found;
}

function line(element: PtkTargetContext, part: 'competition' | 'scope'): string {
  return find(element, `.${part}`).textContent;
}

/** Records what the control asks for, from outside its shadow root. */
function watch(): Event[] {
  const seen: Event[] = [];
  const listener = (event: Event): void => {
    seen.push(event);
  };
  // On the body rather than on the element: the claim is that the request left
  // the shadow root, and a listener on the element would hold either way.
  document.body.addEventListener(CONTEXT_EDIT_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(CONTEXT_EDIT_EVENT, listener);
  });
  return seen;
}

describe('ptk-target-context', () => {
  /**
   * The split the review asked for: who is competing on the first line, what
   * the report is drawn across on the second. Pinned as whole strings rather
   * than by `toContain`, because the failure worth catching is an answer
   * quietly dropping out of a line that still reads plausibly without it.
   */
  it('shows the required answers as two lines', async () => {
    const element = await mount();
    expect(line(element, 'competition')).toBe('Female · Raw · Tested');
    expect(line(element, 'scope')).toBe('56 kg · Open only');
  });

  it('adds every optional answer to the second line only', async () => {
    const element = await mount(FULLY_ANSWERED);
    expect(line(element, 'competition')).toBe('Female · Raw · Tested');
    expect(line(element, 'scope')).toBe('52 kg and 56 kg · Masters 1 and Open · North Example');
  });

  it('re-renders when the selection changes after the first render', async () => {
    // The canary for Lit's decorator configuration. Everything else in this
    // file passes when `experimentalDecorators` and `useDefineForClassFields`
    // disagree; the symptom in the product is a summary frozen at whatever the
    // first-run screen applied, which reads as an editor that saves nothing.
    const element = await mount();
    element.selection = FULLY_ANSWERED;
    await element.updateComplete;
    expect(line(element, 'scope')).toContain('Masters 1');
  });

  /**
   * The verb first. Announced in rendered order the control reads as three
   * fragments with what it *does* buried at the end, so a reader arriving on it
   * has to hear the whole context before learning whether it is the thing they
   * were looking for.
   */
  it('is called "Edit context" before it is called anything else', async () => {
    const element = await mount(FULLY_ANSWERED);
    const name = control(element).getAttribute('aria-label') ?? '';
    expect(name.startsWith('Edit context:')).toBe(true);
    expect(name).toContain('Female · Raw · Tested');
    expect(name).toContain('North Example');
  });

  it('still names itself when nothing has been answered', async () => {
    // A summary of nothing is not a name. The control is still a control.
    const element = await mount(NO_SELECTION);
    expect(control(element).getAttribute('aria-label')).toBe('Edit context: Open only');
  });

  it('does not announce the visible "Edit" a second time', async () => {
    // It is already in the accessible name, and the whole control is one target.
    const element = await mount();
    expect(find(element, '.edit').getAttribute('aria-hidden')).toBe('true');
  });

  it('asks for the editor outside its own shadow root', async () => {
    const element = await mount();
    const seen = watch();
    control(element).click();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.composed).toBe(true);
  });

  it('says nothing on its own', async () => {
    // Mounting and re-rendering are silent: only a press asks for the editor.
    // A listener that reopened the editor on render would trap a lifter in it.
    const seen = watch();
    const element = await mount();
    element.selection = FULLY_ANSWERED;
    await element.updateComplete;
    expect(seen).toEqual([]);
  });

  /**
   * With no catalogue there is nothing to summarise and nothing an editor could
   * offer. Rendering an empty control would be a button that opens a screen of
   * questions with no answers on it -- which is what the tool shows while the
   * catalogue is still loading, so this is the first frame of every visit.
   */
  it('draws nothing at all before the catalogue arrives', async () => {
    const element = await mount();
    element.catalog = null;
    await element.updateComplete;
    expect(element.shadowRoot?.querySelector('button')).toBeNull();
    expect(element.shadowRoot?.textContent.trim()).toBe('');
  });

  /**
   * §5.7's floor, at the comfortable size rather than the minimum: this is the
   * control a lifter presses between attempts, on a platform, holding a phone
   * in one hand.
   */
  it('is a comfortable target to press', async () => {
    const element = await mount();
    expect(control(element).getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
  });

  it('fits a 320 pixel column with every answer given', async () => {
    const element = await mount(FULLY_ANSWERED);
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
    const element = await mount(FULLY_ANSWERED);
    const result = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
