// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  THEME_PARAMETER,
  asThemeMode,
  resolveEffectiveTheme,
  themeModeFromSearch,
  type ThemeMode,
} from './theme.js';

describe('asThemeMode', () => {
  it.each(['system', 'light', 'dark'])('accepts %p', (value) => {
    expect(asThemeMode(value)).toBe(value);
  });

  it.each([
    'System',
    'DARK',
    '',
    'auto',
    'light dark',
    'light;--injected:1',
    '<script>',
    null,
    undefined,
    0,
    {},
    ['dark'],
  ])('rejects %p rather than passing it through', (value) => {
    expect(asThemeMode(value)).toBeUndefined();
  });
});

describe('themeModeFromSearch', () => {
  it.each(['light', 'dark', 'system'])('reads %p from the documented parameter', (mode) => {
    expect(themeModeFromSearch(`?${THEME_PARAMETER}=${mode}`)).toBe(mode);
  });

  it('tolerates a search string without its leading question mark', () => {
    // `location.search` includes it; a hand-assembled string often does not.
    expect(themeModeFromSearch(`${THEME_PARAMETER}=dark`)).toBe('dark');
  });

  it('follows the system when the embedder asks for nothing', () => {
    expect(themeModeFromSearch('')).toBe('system');
    expect(themeModeFromSearch('?federation=example')).toBe('system');
  });

  it.each([
    '?theme=Dark',
    '?theme=',
    '?theme=auto',
    '?theme=dark;--ptk-color-surface:red',
    '?theme=%3Cscript%3E',
  ])('falls back to system for %p rather than passing it on', (search) => {
    // Every one of these is a string an arbitrary embedding site could put in
    // the URL, and the fallback is what keeps it out of an attribute value.
    expect(themeModeFromSearch(search)).toBe('system');
  });

  it('takes the first value when the parameter is repeated', () => {
    // A second copy must not be able to override a value that was already
    // checked, and the first must not be ignored in favour of the last.
    expect(themeModeFromSearch('?theme=light&theme=dark')).toBe('light');
  });

  it('reads only the theme parameter', () => {
    // The visitor-facing toggle and its stored preference were removed on
    // purpose, and so was the separate lock parameter they made necessary. A
    // page still looks correct in manual testing if one of them creeps back.
    expect(themeModeFromSearch('?themeLock=dark')).toBe('system');
  });
});

describe('resolveEffectiveTheme', () => {
  it.each([
    { mode: 'light', systemPrefersDark: false, expected: 'light' },
    { mode: 'light', systemPrefersDark: true, expected: 'light' },
    { mode: 'dark', systemPrefersDark: false, expected: 'dark' },
    { mode: 'dark', systemPrefersDark: true, expected: 'dark' },
    { mode: 'system', systemPrefersDark: false, expected: 'light' },
    { mode: 'system', systemPrefersDark: true, expected: 'dark' },
  ] satisfies { mode: ThemeMode; systemPrefersDark: boolean; expected: string }[])(
    'mode=$mode systemPrefersDark=$systemPrefersDark -> $expected',
    ({ mode, systemPrefersDark, expected }) => {
      expect(resolveEffectiveTheme(mode, systemPrefersDark)).toBe(expected);
    },
  );

  it('keeps a forced theme stable when the system preference flips', () => {
    // The regression this guards: storing the effective theme instead of the
    // mode makes an embedder's explicit "light" silently start following the OS.
    expect(resolveEffectiveTheme('light', false)).toBe(resolveEffectiveTheme('light', true));
  });

  it('follows the system preference when the mode is system', () => {
    expect(resolveEffectiveTheme('system', false)).not.toBe(resolveEffectiveTheme('system', true));
  });
});
