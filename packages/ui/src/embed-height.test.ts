// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs in a real browser, because every claim here is about layout: what a
 * document element measures when its content is shorter than the frame around
 * it, and when a `ResizeObserver` fires. A simulated DOM invents both, and the
 * bug this file exists to hold shut is precisely one an invented layout would
 * report as fixed.
 *
 * The outbound half of the embed protocol had no test at all before this --
 * nothing in the repository asserted what a framed tool posts to the page
 * around it.
 */
import { HeightMessageSchema, type HeightMessage } from '@platform-toolkit/configuration';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  measureEmbedHeight,
  publishEmbedHeight,
  publishEmbedHeightOnResize,
} from './embed-height.js';

/** Torn down after every test so a leaked frame or observer cannot influence the next one. */
const teardowns: (() => void)[] = [];

afterEach(() => {
  while (teardowns.length > 0) {
    teardowns.pop()?.();
  }
});

function track(stop: () => void): void {
  teardowns.push(stop);
}

/**
 * Reads a payload back through the protocol schema.
 *
 * Through the schema's standard interface rather than through `safeParse`,
 * because this package deliberately depends on no validation library -- the
 * configuration package owns that, which is the whole reason the schema is
 * declared there and the DOM half is here. Hand-asserting the shape instead
 * would leave the one thing worth checking untested: that what a tool posts is
 * what an embedder is documented to receive, integer height and all.
 */
async function asHeightMessage(payload: unknown): Promise<HeightMessage> {
  const result = await HeightMessageSchema['~standard'].validate(payload);
  if (result.issues !== undefined) {
    throw new Error(`Not a height message: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

/** A window that is not this one, standing in for the embedding page. */
function embedderWindow(): Window {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  track(() => {
    frame.remove();
  });

  const host = frame.contentWindow;
  if (host === null) {
    throw new Error('The iframe standing in for the embedder has no content window.');
  }
  return host;
}

/** Every payload posted to a window, in the order it arrived. */
function messagesTo(host: Window): unknown[] {
  const received: unknown[] = [];
  const listener = (event: MessageEvent<unknown>): void => {
    received.push(event.data);
  };
  host.addEventListener('message', listener);
  track(() => {
    host.removeEventListener('message', listener);
  });
  return received;
}

/**
 * Waits until a window has been posted to and nothing is still in flight.
 *
 * A sentinel behind the thing under test rather than a timer: delivery is
 * ordered, so the sentinel arriving is proof that anything posted before it has
 * already been delivered. A timer would be a race that passes on this laptop
 * and fails on a loaded machine.
 */
const SENTINEL = 'embed-height-test-sentinel';

function afterDelivery(host: Window): Promise<void> {
  return new Promise<void>((resolve) => {
    host.addEventListener('message', function settle(event: MessageEvent<unknown>) {
      if (event.data === SENTINEL) {
        host.removeEventListener('message', settle);
        resolve();
      }
    });
    host.postMessage(SENTINEL, '*');
  });
}

/** An element of a known height in this document, appended so it has a box at all. */
function sizedElement(pixels: number): HTMLElement {
  const element = document.createElement('div');
  element.style.height = `${pixels}px`;
  document.body.append(element);
  track(() => {
    element.remove();
  });
  return element;
}

interface FramedContent {
  /** The framed document's own root -- what a tool inside the frame would measure. */
  readonly root: HTMLElement;
  readonly setContentHeight: (pixels: number) => void;
}

/**
 * A real frame of a fixed size holding a document of a different size.
 *
 * The two have to be able to disagree, because the defect is the case where the
 * content is shorter than the frame the embedder already sized.
 */
async function framedContent(framePixels: number, contentPixels: number): Promise<FramedContent> {
  const frame = document.createElement('iframe');
  frame.setAttribute('width', '300');
  frame.setAttribute('height', String(framePixels));
  frame.srcdoc = `<!doctype html><html><head><style>html,body{margin:0}#content{height:${String(contentPixels)}px}</style></head><body><div id="content"></div></body></html>`;

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => {
      resolve();
    });
  });
  document.body.append(frame);
  track(() => {
    frame.remove();
  });
  await loaded;

  const framedDocument = frame.contentDocument;
  if (framedDocument === null) {
    throw new Error('The frame under test has no document.');
  }
  const content = framedDocument.getElementById('content');
  if (content === null) {
    throw new Error('The framed document did not render its content block.');
  }

  return {
    root: framedDocument.documentElement,
    setContentHeight: (pixels) => {
      content.style.height = `${String(pixels)}px`;
    },
  };
}

describe('measureEmbedHeight', () => {
  it('reports the content height of a framed document', async () => {
    const { root } = await framedContent(400, 800);
    expect(measureEmbedHeight(root)).toBe(800);
  });

  it('shrinks when the content shrinks, below the height of the frame around it', async () => {
    // The whole reason this module exists. `scrollHeight` on a document element
    // is the larger of the content and the viewport, and in a frame the viewport
    // is the frame -- so an embedder that once sized this frame to 400 would
    // never be told anything smaller again, and a tool that folds a long table
    // away would leave the blank space behind.
    const { root, setContentHeight } = await framedContent(400, 800);
    setContentHeight(120);
    expect(measureEmbedHeight(root)).toBe(120);
  });

  it('rounds a fractional height up', () => {
    // The schema takes an integer and a sub-pixel layout is ordinary. Rounding
    // down would crop the last line by a fraction of a pixel on every tool.
    expect(measureEmbedHeight(sizedElement(100.4))).toBe(101);
  });
});

describe('publishEmbedHeight', () => {
  it('posts a message the protocol accepts', async () => {
    const host = embedderWindow();
    const received = messagesTo(host);

    publishEmbedHeight({ tool: 'convert', host, root: sizedElement(100.4) });
    await afterDelivery(host);

    expect(received).toHaveLength(2);
    const message = await asHeightMessage(received[0]);
    expect(message.tool).toBe('convert');
    expect(message.height).toBe(101);
  });

  it('says nothing when nothing is framing the document', async () => {
    // A top-level page's parent is itself. Posting there would be received by
    // the page's own listeners, and the height of an unframed page is not a fact
    // anybody asked for.
    const received = messagesTo(window);

    publishEmbedHeight({ tool: 'convert', host: window, root: sizedElement(200) });
    await afterDelivery(window);

    expect(received).toEqual([SENTINEL]);
  });
});

describe('publishEmbedHeightOnResize', () => {
  it('publishes once immediately and again when the content changes size', async () => {
    const host = embedderWindow();
    const received = messagesTo(host);
    const root = sizedElement(200);

    track(publishEmbedHeightOnResize({ tool: 'convert', host, root }));
    await vi.waitFor(async () => {
      expect(await lastHeight(received)).toBe(200);
    });

    root.style.height = '300px';
    await vi.waitFor(async () => {
      expect(await lastHeight(received)).toBe(300);
    });
  });

  it('stops when told to', async () => {
    const host = embedderWindow();
    const received = messagesTo(host);
    const root = sizedElement(200);

    const stop = publishEmbedHeightOnResize({ tool: 'convert', host, root });
    await vi.waitFor(async () => {
      expect(await lastHeight(received)).toBe(200);
    });
    stop();

    root.style.height = '300px';
    await afterDelivery(host);

    expect(await lastHeight(received)).toBe(200);
  });
});

/** The most recent height posted, ignoring the sentinel used to settle a wait. */
async function lastHeight(received: readonly unknown[]): Promise<number | null> {
  const heights = received.filter((payload) => payload !== SENTINEL);
  const latest = heights.at(-1);
  return latest === undefined ? null : (await asHeightMessage(latest)).height;
}
