// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The embed protocol: everything an embedding page may say to a framed tool,
 * and everything it hears back.
 *
 * Any site may frame these tools, so there is no origin allowlist and there
 * cannot be one. Safety comes from the protocol being small enough to describe
 * completely. The only thing a parent may ask for is one of three theme words;
 * the only thing it is told is how tall the content is. No URL, no CSS, no
 * markup, and no script crosses in either direction, and nothing about an
 * imported athlete ever goes out.
 *
 * Both directions are declared here, together, because the interesting property
 * is the pair: a reader checking whether framing leaks anything should be able
 * to see the whole surface in one file rather than infer it from the absence of
 * code elsewhere.
 *
 * The schemas are the enforcement, not the documentation. An inbound payload is
 * whatever an arbitrary page decided to post, and the `message` listener on a
 * framed document receives all of it.
 */
import * as v from 'valibot';

import { THEME_MODES, type ThemeMode } from './theme.js';

/**
 * Names this collection in every message.
 *
 * A page framing two of these tools receives messages from both, and a page
 * running unrelated widgets receives messages from those too. Without a name to
 * match on, an embedder's handler would size one frame to the other frame's
 * height, which looks like a layout bug and is nearly impossible to attribute.
 */
export const MESSAGE_SOURCE = 'platform-toolkit';

/**
 * Protocol version.
 *
 * Carried in both directions and matched exactly, so a future incompatible
 * shape is ignored by an old embedder rather than half-understood by it.
 */
export const MESSAGE_VERSION = 1;

/**
 * A theme instruction from the embedding page.
 *
 * The query parameter covers the ordinary case, where the embedder knows its
 * own design at the time it writes the URL. This exists for the case it does
 * not: a host page with its own light/dark switch has to be able to bring the
 * frame along, and reloading the iframe to do it would discard whatever the
 * visitor had entered.
 */
export const HostThemeMessageSchema = v.object({
  source: v.literal(MESSAGE_SOURCE),
  version: v.literal(MESSAGE_VERSION),
  type: v.literal('set-theme'),
  mode: v.picklist(THEME_MODES),
});
export type HostThemeMessage = v.InferOutput<typeof HostThemeMessageSchema>;

/**
 * The content height, sent outward so an embedder can size the frame.
 *
 * The one message this application sends, and it is a layout measurement. That
 * is why it may go to a broad target origin: there is nothing in it to protect.
 */
export const HeightMessageSchema = v.object({
  source: v.literal(MESSAGE_SOURCE),
  version: v.literal(MESSAGE_VERSION),
  /** Which tool in the collection is speaking. */
  tool: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]*$/, 'a lowercase kebab-case tool id')),
  type: v.literal('height'),
  height: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type HeightMessage = v.InferOutput<typeof HeightMessageSchema>;

/**
 * Reads a theme instruction out of an arbitrary postMessage payload.
 *
 * Returns `null` for anything that is not one, which is overwhelmingly the
 * common case: a `message` listener on a framed document receives everything
 * the parent page broadcasts, and most of that is consent banners and analytics
 * talking to themselves. A non-matching payload is ordinary traffic rather than
 * an error, so it is dropped without comment.
 *
 * A payload that matches the envelope but carries an unknown mode is dropped
 * too. There is no partial acceptance, because the single field this protocol
 * carries is the one that reaches the DOM.
 *
 * Exported as a function rather than leaving callers to parse the schema so
 * that the browser package doing the wiring needs no validation library of its
 * own, and so this boundary is testable without a DOM.
 */
export function readHostThemeMessage(payload: unknown): ThemeMode | null {
  const parsed = v.safeParse(HostThemeMessageSchema, payload);
  return parsed.success ? parsed.output.mode : null;
}

/**
 * What an embedder acts on: which frame is speaking, and how tall it is.
 *
 * Not the whole `HeightMessage`, because `source`, `version` and `type` are
 * envelope this function has already checked. Handing them back invites a
 * caller to check them a second time, differently.
 */
export type HeightReading = Pick<HeightMessage, 'tool' | 'height'>;

/**
 * Reads a content height out of an arbitrary postMessage payload.
 *
 * Returns `null` for anything that is not one, for the reason
 * `readHostThemeMessage` does: a page hears everything posted to it, and a
 * widget it did not frame talking to itself is ordinary traffic rather than an
 * error.
 *
 * A fractional height is dropped rather than rounded. The publisher is the side
 * that decided which way to round -- it measures a sub-pixel box and rounds up,
 * so a fraction arriving here says the sender is not the thing this protocol
 * describes, and rounding on its behalf would size a frame from a payload
 * nothing vouched for.
 *
 * Nothing in this collection calls it, because the party that reads a height is
 * the embedding page and that page is not ours. It exists so that page needs no
 * validation library of its own -- a schema published without a reader hands
 * every consumer the job of holding one, which is what a shared protocol module
 * exists to prevent.
 */
export function readHeightMessage(payload: unknown): HeightReading | null {
  const parsed = v.safeParse(HeightMessageSchema, payload);
  return parsed.success ? { tool: parsed.output.tool, height: parsed.output.height } : null;
}
