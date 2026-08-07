// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  readHeightMessage,
  readHostThemeMessage,
} from './embedding.js';

/** A payload that should be accepted, so each case below can spoil one field. */
function themeMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    type: 'set-theme',
    mode: 'dark',
    ...overrides,
  };
}

describe('readHostThemeMessage', () => {
  it.each(['system', 'light', 'dark'])('accepts a well-formed request for %p', (mode) => {
    expect(readHostThemeMessage(themeMessage({ mode }))).toBe(mode);
  });

  it.each([
    ['a foreign source', themeMessage({ source: 'analytics-widget' })],
    ['a future version', themeMessage({ version: 2 })],
    ['a different message type', themeMessage({ type: 'set-athlete' })],
    ['an unknown mode', themeMessage({ mode: 'sepia' })],
    ['a mode carrying a declaration', themeMessage({ mode: 'dark;--ptk-color-surface:red' })],
    ['a missing mode', { source: MESSAGE_SOURCE, version: MESSAGE_VERSION, type: 'set-theme' }],
    ['a string payload', 'set-theme'],
    ['null', null],
    ['an array', [MESSAGE_SOURCE, 'set-theme', 'dark']],
  ])('ignores %s', (_label, payload) => {
    expect(readHostThemeMessage(payload)).toBeNull();
  });

  it('ignores the chatter a framed document actually receives', () => {
    // A `message` listener inside an iframe hears everything the parent page
    // broadcasts. Consent banners and analytics scripts are the normal traffic
    // here, not an attack, and dropping them must stay uneventful.
    expect(readHostThemeMessage({ type: 'consent-updated', categories: ['analytics'] })).toBeNull();
    expect(readHostThemeMessage('webpackHotUpdate')).toBeNull();
  });

  it('does not let extra fields reach the caller', () => {
    // The return value is a mode and nothing else, so a payload that smuggles
    // additional keys has nowhere to put them.
    expect(readHostThemeMessage(themeMessage({ html: '<img onerror=alert(1)>' }))).toBe('dark');
  });
});

/** The outbound counterpart, spoiled one field at a time the same way. */
function heightMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    tool: 'platform-targets',
    type: 'height',
    height: 640,
    ...overrides,
  };
}

describe('readHeightMessage', () => {
  it('reads the one message this application sends', () => {
    expect(readHeightMessage(heightMessage())).toEqual({ tool: 'platform-targets', height: 640 });
  });

  it('accepts a height of zero', () => {
    // A tool that has rendered nothing yet is a real state, and an embedder
    // told nothing keeps whatever height it guessed in its own markup.
    expect(readHeightMessage(heightMessage({ height: 0 }))?.height).toBe(0);
  });

  it('hands back the pair and nothing else', () => {
    // The envelope has been checked by the time this returns; giving it back
    // would invite a caller to check it again, differently.
    const reading = readHeightMessage(heightMessage({ html: '<img onerror=alert(1)>' }));
    expect(reading).not.toBeNull();
    expect(Object.keys(reading ?? {}).sort()).toEqual(['height', 'tool']);
  });

  it.each([
    ['an empty tool', heightMessage({ tool: '' })],
    ['a tool that is not kebab case', heightMessage({ tool: 'Platform Targets' })],
    ['a tool leading with a separator', heightMessage({ tool: '-convert' })],
  ])('ignores %s, so an embedder cannot size the wrong frame', (_label, payload) => {
    // A page framing two tools receives from both. Without a name to match on
    // it would size one frame to the other's height, which looks like a layout
    // bug and is nearly impossible to attribute.
    expect(readHeightMessage(payload)).toBeNull();
  });

  it.each([-1, Number.NaN, '640', null])('ignores a height of %p', (value) => {
    expect(readHeightMessage(heightMessage({ height: value }))).toBeNull();
  });

  it.each([1.5, 100.4, 639.9999])(
    'ignores a fractional height of %p rather than rounding',
    (value) => {
      // The publisher measures a sub-pixel box and rounds up, so a fraction here
      // came from something else. Rounding it would size a frame from a payload
      // nothing vouched for.
      expect(readHeightMessage(heightMessage({ height: value }))).toBeNull();
    },
  );

  it.each([
    ['a foreign source', heightMessage({ source: 'analytics-widget' })],
    ['a future version', heightMessage({ version: 2 })],
    ['a different message type', heightMessage({ type: 'set-theme' })],
    ['a missing tool', { source: MESSAGE_SOURCE, version: MESSAGE_VERSION, type: 'height' }],
    ['a string payload', 'height'],
    ['null', null],
    ['an array', [MESSAGE_SOURCE, 'height', 640]],
    ['the chatter a page actually receives', { type: 'consent-updated', height: 640 }],
  ])('ignores %s', (_label, payload) => {
    expect(readHeightMessage(payload)).toBeNull();
  });
});
