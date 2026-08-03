// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

// The retry is a `ptk-button`, and every dimension it has comes from a custom
// property. Without the stylesheet the tap-target assertion at the bottom of this
// file measures a button with no minimum height and passes against a layout
// nobody ships.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { REFRESH_REQUEST_EVENT, type Connection, type DataMetaStatus } from './freshness.js';
import type { PtkTargetFreshness } from './ptk-target-freshness.js';
import './ptk-target-freshness.js';
import { DATA_META } from './records-fixture.js';

import type { DataMeta } from '@platform-toolkit/data-contracts';

/**
 * Real browser, real Shadow DOM.
 *
 * `freshness.test.ts` already pins which sentence wins; what can only be claimed
 * here is that the sentence reaches the page as a sentence -- with a machine-
 * readable date beside it, with an action only where an action would help, and
 * with the request crossing the shadow boundary to a transport that is not this
 * element's parent. An emulated DOM that got `composed` wrong would leave a green
 * suite and a Try again button that does nothing.
 *
 * The index is invented (§5.1). Nothing that ships imports it.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface MountOptions {
  readonly connection?: Connection;
  readonly meta?: DataMeta | null;
  readonly metaStatus?: DataMetaStatus;
  readonly showingData?: boolean;
  readonly federationLabel?: string | null;
}

async function mount(options: MountOptions = {}): Promise<PtkTargetFreshness> {
  const element = document.createElement('ptk-target-freshness');
  element.connection = options.connection ?? 'online';
  element.meta = options.meta === undefined ? DATA_META : options.meta;
  element.metaStatus = options.metaStatus ?? 'ready';
  element.showingData = options.showingData ?? true;
  element.federationLabel = options.federationLabel ?? 'Example Federation';
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * Everything the element says, as one string.
 *
 * Not generic and not a `querySelector<T>`: the point of most assertions below is
 * the whole line, and reaching for one node inside it would let a sentence that
 * lost half its words still pass.
 */
function text(element: PtkTargetFreshness): string {
  return element.shadowRoot?.textContent.replaceAll(/\s+/gu, ' ').trim() ?? '';
}

function retry(element: PtkTargetFreshness): Element | null {
  return element.shadowRoot?.querySelector('.retry') ?? null;
}

/** The retry, or a failure saying it is missing rather than a cast. */
function pressRetry(element: PtkTargetFreshness): void {
  const found = retry(element);
  if (!(found instanceof HTMLElement)) {
    throw new Error('No retry was rendered.');
  }
  found.click();
}

/** Records what the element asks for, from outside its shadow root. */
function watch(): Event[] {
  const seen: Event[] = [];
  const listener = (event: Event): void => {
    seen.push(event);
  };
  // On the body, because the transport listens on the tool's host element rather
  // than on this element's parent. A listener on the element itself would hold
  // even for an event that never left the shadow root.
  document.body.addEventListener(REFRESH_REQUEST_EVENT, listener);
  teardown.push(() => {
    document.body.removeEventListener(REFRESH_REQUEST_EVENT, listener);
  });
  return seen;
}

describe('ptk-target-freshness', () => {
  it('says when the data was last verified, and offers nothing to press', async () => {
    const element = await mount();
    expect(text(element)).toBe('Last verified July 28, 2026.');
    expect(retry(element)).toBeNull();
  });

  /**
   * The date is in the sentence for a reader and in the attribute for anything
   * parsing the page. A `<time>` with no `datetime` is a span with extra steps.
   */
  it('carries the ISO date on a time element', async () => {
    const element = await mount();
    expect(element.shadowRoot?.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-28');
  });

  it('labels a cached copy as offline', async () => {
    const element = await mount({ connection: 'offline' });
    expect(text(element)).toBe('Offline · Showing data last verified July 28, 2026.');
  });

  /**
   * The canary for Lit's decorator configuration (§5.8). Everything else in this
   * file passes when `experimentalDecorators` and `useDefineForClassFields`
   * disagree; the symptom in the product is a line frozen at "Last verified"
   * while the phone is in a basement.
   */
  it('re-renders when the connection changes after the first render', async () => {
    const element = await mount();
    element.connection = 'offline';
    await element.updateComplete;
    expect(text(element)).toContain('Offline');
  });

  /**
   * The only state with nothing usable above it, so the only one with an action.
   * Attaching a retry to "the data is a week old" would be a button that cannot
   * change what it sits under.
   */
  it('offers a retry only when nothing is saved on the device', async () => {
    const element = await mount({
      connection: 'offline',
      meta: null,
      metaStatus: 'failed',
      showingData: false,
    });
    expect(text(element)).toContain('Targets have not been saved on this device yet.');
    expect(text(element)).toContain('this Example Federation category');
    expect(retry(element)).not.toBeNull();
  });

  it('asks for a refresh outside its own shadow root', async () => {
    const element = await mount({
      connection: 'offline',
      meta: null,
      metaStatus: 'failed',
      showingData: false,
    });
    const seen = watch();
    pressRetry(element);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.composed).toBe(true);
  });

  it('says nothing on its own', async () => {
    // Mounting and re-rendering are silent. Only a press asks for a refresh; an
    // element that requested one on render would retry in a loop with no network.
    const seen = watch();
    const element = await mount({ connection: 'offline', metaStatus: 'failed', meta: null });
    element.connection = 'online';
    await element.updateComplete;
    expect(seen).toEqual([]);
  });

  /**
   * Storybook cannot show this one -- `smoke-stories.mjs` rejects a story with no
   * rendered text -- so the claim lives here: before the first read there is no
   * line, not an empty bordered strip that reads as a section that failed.
   */
  it('draws nothing at all before the first read settles', async () => {
    const element = await mount({ meta: null, metaStatus: 'loading', showingData: false });
    expect(element.shadowRoot?.textContent.trim()).toBe('');
    expect(element.shadowRoot?.querySelector('.line')).toBeNull();
  });

  /**
   * Tone is drawn as weight and wording, never as colour alone -- a hue is
   * discarded under forced colours and by a reader who cannot separate two of
   * them. The attribute is what the stylesheet keys on, so it is the thing to pin.
   */
  it('marks a caution differently from the ordinary case', async () => {
    const quiet = await mount();
    const caution = await mount({ connection: 'offline' });
    expect(quiet.shadowRoot?.querySelector('.line')?.getAttribute('data-tone')).toBe('quiet');
    expect(caution.shadowRoot?.querySelector('.line')?.getAttribute('data-tone')).toBe('caution');
  });

  it('is a comfortable target to press', async () => {
    const element = await mount({
      connection: 'offline',
      meta: null,
      metaStatus: 'failed',
      showingData: false,
    });
    const button = element.shadowRoot?.querySelector('.retry')?.shadowRoot?.querySelector('button');
    expect(button?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(44);
  });

  it('fits a 320 pixel column', async () => {
    const element = await mount({
      connection: 'offline',
      meta: null,
      metaStatus: 'failed',
      showingData: false,
    });
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
    const element = await mount({ connection: 'offline' });
    const result = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
