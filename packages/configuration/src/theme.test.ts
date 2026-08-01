import { describe, expect, it } from 'vitest';
import { asThemeMode, resolveEffectiveTheme, resolveThemeMode, type ThemeMode } from './theme.js';

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

describe('resolveThemeMode precedence', () => {
  it('falls back to system when nothing is configured', () => {
    expect(resolveThemeMode({})).toEqual({ mode: 'system', source: 'fallback', locked: false });
  });

  it('uses a host default when the user has expressed no preference', () => {
    expect(resolveThemeMode({ hostDefault: 'dark' })).toEqual({
      mode: 'dark',
      source: 'host-default',
      locked: false,
    });
  });

  it('lets an explicit user choice beat a host default', () => {
    expect(resolveThemeMode({ hostDefault: 'dark', userPreference: 'light' })).toEqual({
      mode: 'light',
      source: 'user-preference',
      locked: false,
    });
  });

  it('lets a host lock beat everything, including a stored user choice', () => {
    expect(
      resolveThemeMode({ hostLock: 'dark', userPreference: 'light', hostDefault: 'light' }),
    ).toEqual({ mode: 'dark', source: 'host-lock', locked: true });
  });

  it('reports locked only for a host lock', () => {
    expect(resolveThemeMode({ hostLock: 'light' }).locked).toBe(true);
    expect(resolveThemeMode({ userPreference: 'light' }).locked).toBe(false);
    expect(resolveThemeMode({ hostDefault: 'light' }).locked).toBe(false);
    expect(resolveThemeMode({}).locked).toBe(false);
  });

  it('treats a host lock of "system" as a real lock, not an absence', () => {
    // A host that locks to `system` is asking to follow the OS and forbidding
    // the user from overriding. That is different from setting nothing at all.
    const resolved = resolveThemeMode({ hostLock: 'system', userPreference: 'dark' });
    expect(resolved.mode).toBe('system');
    expect(resolved.locked).toBe(true);
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

  it('keeps an explicit choice stable when the system preference flips', () => {
    // The regression this guards: storing the effective theme instead of the mode
    // makes an explicit "light" silently start following the OS.
    expect(resolveEffectiveTheme('light', false)).toBe(resolveEffectiveTheme('light', true));
  });

  it('follows the system preference when the mode is system', () => {
    expect(resolveEffectiveTheme('system', false)).not.toBe(resolveEffectiveTheme('system', true));
  });
});
