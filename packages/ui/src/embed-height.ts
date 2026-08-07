// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  type HeightMessage,
} from '@platform-toolkit/configuration';

/**
 * The DOM half of the outbound embed protocol: telling an embedding page how
 * tall the framed content is, so it can size the frame around it.
 *
 * Here rather than in `@platform-toolkit/configuration` for the reason
 * `theme.ts` is here: the protocol is declared there and stays free of the DOM,
 * and the module that measures a document lives beside the components. It was
 * seven copy-pasted functions in `apps/web/src/*` before this, which is how one
 * measurement bug became seven.
 */

export interface EmbedHeightOptions {
  /**
   * Which tool in the collection is speaking. Required, because an embedder
   * framing two of these has to be able to tell which frame a height belongs
   * to; `HeightMessageSchema` holds it to lowercase kebab case.
   */
  readonly tool: string;

  /** Element to measure. Defaults to `document.documentElement`. */
  readonly root?: HTMLElement;

  /**
   * The window to tell. Defaults to the embedding page.
   *
   * Named rather than assumed so that the outbound half can be exercised
   * without a real embedder. It is also what decides whether anything is said
   * at all: a top-level page's parent is itself, and a page nobody framed has
   * nobody to tell.
   */
  readonly host?: Window;
}

/**
 * The height an embedder should give the frame.
 *
 * The border box, and deliberately not `scrollHeight`. On a document element
 * `scrollHeight` is the larger of the content and the viewport, and inside a
 * frame the viewport is the frame -- so every measurement after the first is
 * floored at the height the embedder last applied, the frame can only ever
 * grow, and a tool that folds a long table away leaves the embedder holding the
 * blank space it used to occupy until the visitor reloads. That was live on all
 * seven tools. The border box shrinks because `tokens.css` puts no `height` on
 * `html` and no margin on `body`, so it is the content height and nothing else.
 *
 * Rounded up because the schema takes an integer and a sub-pixel layout is
 * ordinary; rounding down would crop a descender off the last line.
 */
export function measureEmbedHeight(root: HTMLElement = document.documentElement): number {
  return Math.ceil(root.getBoundingClientRect().height);
}

/**
 * Tells the embedding page how tall the content is.
 *
 * A broad target origin is acceptable here, and only here, because the payload
 * is a layout measurement and nothing else. Any site may frame these tools, so
 * there is no origin to pin it to; what makes that safe is that the protocol
 * has no message that could carry anything else outward. That distinction
 * carries the most weight for the logbook, where what a lifter types is a
 * training history -- the one body of data in the collection that is theirs
 * rather than published -- and it holds because there is no "workout" message
 * and there must never be one. A host wanting the data has the documented route
 * the lifter controls: the backup they download themselves. The same argument
 * covers the bodyweights, ages and maximums the other tools hold.
 *
 * Says nothing when nobody is framing the document. A top-level page posting to
 * itself would be received by its own listeners, and the height of an unframed
 * page is not a fact anybody asked for.
 */
export function publishEmbedHeight(options: EmbedHeightOptions): void {
  const host = options.host ?? window.parent;
  if (host === window) {
    return;
  }

  const message: HeightMessage = {
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    tool: options.tool,
    type: 'height',
    height: measureEmbedHeight(options.root),
  };

  host.postMessage(message, '*');
}

/**
 * Publishes the height now and again whenever it changes.
 *
 * The initial publish is not optional and is not the observer's first
 * callback's job: an embedder that framed the tool needs a height before
 * anything has resized, and a browser without `ResizeObserver` would otherwise
 * be told nothing at all rather than told once.
 *
 * @returns a function that stops observing
 */
export function publishEmbedHeightOnResize(options: EmbedHeightOptions): () => void {
  const root = options.root ?? document.documentElement;
  const publish = (): void => {
    publishEmbedHeight({ ...options, root });
  };

  publish();

  if (typeof ResizeObserver !== 'function') {
    return () => {
      // Nothing was observed, so there is nothing to disconnect. The caller
      // still gets a stop function, because a caller that has to ask whether it
      // was given one will eventually forget to.
    };
  }

  const observer = new ResizeObserver(publish);
  observer.observe(root);
  return () => {
    observer.disconnect();
  };
}
