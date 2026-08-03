// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { ALLOWED_SOURCE_HOSTS, assertAllowedSourceUrl } from './fetch-policy.js';

describe('assertAllowedSourceUrl', () => {
  it.each(ALLOWED_SOURCE_HOSTS)('permits the allowlisted host %s', (host) => {
    expect(assertAllowedSourceUrl(`https://${host}/some/path`).hostname).toBe(host);
  });

  it.each([
    // Suffix-matching bypasses: each of these *ends with* an allowlisted host.
    'https://uspa.net.example.test/data.json',
    'https://evil-uspa.net/data.json',
    'https://notuspa.net/data.json',
    // Subdomain that was never allowlisted.
    'https://staging.uspa.net/data.json',
    // Entirely unrelated hosts.
    'https://example.test/data.json',
    'https://localhost/data.json',
    'https://127.0.0.1/data.json',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/data.json',
  ])('rejects %s', (candidate) => {
    expect(() => assertAllowedSourceUrl(candidate)).toThrow(/allowlist|https|URL/i);
  });

  it.each([
    'http://uspa.net/data.json',
    'ftp://uspa.net/data.json',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'javascript:alert(1)',
  ])('rejects the non-https scheme in %s', (candidate) => {
    expect(() => assertAllowedSourceUrl(candidate)).toThrow();
  });

  it('rejects embedded credentials even on an allowlisted host', () => {
    expect(() => assertAllowedSourceUrl('https://user:pass@uspa.net/data.json')).toThrow(
      /credentials/i,
    );
  });

  it.each(['', 'not a url', '//uspa.net/data.json', '/relative/path'])(
    'rejects the malformed input %p',
    (candidate) => {
      expect(() => assertAllowedSourceUrl(candidate)).toThrow();
    },
  );
});
