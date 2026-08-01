import { describe, expect, it } from 'vitest';

import {
  HeightMessageSchema,
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  readHostThemeMessage,
} from './embedding.js';
import * as v from 'valibot';

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

describe('HeightMessageSchema', () => {
  const height = (overrides: Record<string, unknown> = {}): unknown => ({
    source: MESSAGE_SOURCE,
    version: MESSAGE_VERSION,
    tool: 'platform-targets',
    type: 'height',
    height: 640,
    ...overrides,
  });

  it('describes the one message this application sends', () => {
    expect(v.safeParse(HeightMessageSchema, height()).success).toBe(true);
  });

  it('requires a tool name so an embedder can size the right frame', () => {
    // A page framing two tools receives from both. Without a name to match on
    // it would size one frame to the other's height, which looks like a layout
    // bug and is nearly impossible to attribute.
    expect(v.safeParse(HeightMessageSchema, height({ tool: '' })).success).toBe(false);
    expect(v.safeParse(HeightMessageSchema, height({ tool: 'Platform Targets' })).success).toBe(
      false,
    );
  });

  it.each([-1, 1.5, Number.NaN, '640'])('rejects a height of %p', (value) => {
    expect(v.safeParse(HeightMessageSchema, height({ height: value })).success).toBe(false);
  });
});
