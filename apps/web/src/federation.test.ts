import { describe, expect, it } from 'vitest';

import { FEDERATION_ATTRIBUTE, parseFederationId } from './federation.js';

describe('parseFederationId', () => {
  it('accepts an identifier a published artifact could be named for', () => {
    expect(parseFederationId('uspa')).toBe('uspa');
    expect(parseFederationId('ipf-usa')).toBe('ipf-usa');
    expect(parseFederationId('100-raw')).toBe('100-raw');
  });

  it('ignores whitespace an attribute picked up from the markup', () => {
    // Wrapping a long attribute across lines is a formatting choice, and a page
    // that failed to load because of one would be a puzzle rather than a fault.
    expect(parseFederationId('\n      uspa\n    ')).toBe('uspa');
  });

  it('names the attribute when a page forgot to declare one', () => {
    expect(() => parseFederationId(null)).toThrow(FEDERATION_ATTRIBUTE);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'only whitespace'],
    ['USPA', 'uppercase'],
    ['-uspa', 'a leading hyphen'],
    ['us pa', 'a space'],
    ['uspa/2025', 'a path separator'],
    ['../meta', 'a parent segment'],
  ])('refuses %o, which is %s', (declared) => {
    // Refused here rather than passed through, because every one of these would
    // fail as a lookup instead: the artifact name it produced would match
    // nothing, and the screen would say the federation has not been published --
    // a true sentence about a different situation, which nobody would go and
    // check.
    expect(() => parseFederationId(declared)).toThrow(/not a federation identifier/);
  });

  it('quotes what the page declared, so the fix is findable', () => {
    expect(() => parseFederationId('USPA')).toThrow('data-federation="USPA"');
  });
});
