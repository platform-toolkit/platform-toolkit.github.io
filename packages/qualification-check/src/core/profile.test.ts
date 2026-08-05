// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { athleteLookupKey } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { readProfileQuery, type ProfileQueryProblem, type ProfileQuerySource } from './profile.js';

/**
 * The archive that a pasted link is invented against.
 *
 * Not a real one. Section 2.1 aside, a test written against a live host would be a
 * test of that host's current routing, and the function under test deliberately
 * encodes no site's routing at all -- so pinning it to one in a test would document
 * a rule the code does not have.
 */
const AN_ARCHIVE = 'https://archive.invalid';

function term(input: string): string {
  const reading = readProfileQuery(input);
  if (!reading.ok) throw new Error(`Expected a term, got ${reading.problem}`);
  return reading.term;
}

function source(input: string): ProfileQuerySource {
  const reading = readProfileQuery(input);
  if (!reading.ok) throw new Error(`Expected a term, got ${reading.problem}`);
  return reading.source;
}

function problem(input: string): ProfileQueryProblem {
  const reading = readProfileQuery(input);
  if (reading.ok) throw new Error(`Expected a problem, got "${reading.term}"`);
  return reading.problem;
}

describe('readProfileQuery', () => {
  it('takes a typed name as it was written', () => {
    expect(term('Jane Invented')).toBe('Jane Invented');
    expect(source('Jane Invented')).toBe('typed');
  });

  it('drops the space around a paste without touching the middle of it', () => {
    // Copying a name off a results sheet brings a trailing newline with it more
    // often than not. The middle is left alone because the fold on the other side
    // owns every other normalisation, and doing half of it here is how the two
    // sides stop agreeing.
    expect(term('  Jane   Invented \n')).toBe('Jane   Invented');
  });

  it('reads the last path segment of a profile link', () => {
    expect(term(`${AN_ARCHIVE}/u/janeinvented`)).toBe('janeinvented');
    expect(source(`${AN_ARCHIVE}/u/janeinvented`)).toBe('link');
  });

  it('reads a link that lost its scheme on the way out of the address bar', () => {
    // Every current browser drops `https://` when the omnibox is copied, so this
    // is the common paste rather than the exotic one.
    expect(term('archive.invalid/u/janeinvented')).toBe('janeinvented');
    expect(source('archive.invalid/u/janeinvented')).toBe('link');
  });

  it('ignores a trailing slash, a query and a fragment', () => {
    expect(term(`${AN_ARCHIVE}/u/janeinvented/`)).toBe('janeinvented');
    expect(term(`${AN_ARCHIVE}/u/janeinvented?sort=date`)).toBe('janeinvented');
    expect(term(`${AN_ARCHIVE}/u/janeinvented#total`)).toBe('janeinvented');
  });

  it('decodes an escaped segment', () => {
    expect(term(`${AN_ARCHIVE}/u/jane%20invented`)).toBe('jane invented');
  });

  it('keeps a segment whose escaping is malformed rather than refusing the link', () => {
    // `URL` normalises a path without validating its escapes, so `%zz` reaches the
    // decoder and it throws. What the reader can see in the field is the better
    // answer than none, and the fold discards the punctuation anyway.
    expect(term(`${AN_ARCHIVE}/u/jane%zz`)).toBe('jane%zz');
  });

  it('reports a blank field as blank', () => {
    expect(problem('')).toBe('blank');
    expect(problem('   \n ')).toBe('blank');
  });

  it('reports a link whose path names nothing', () => {
    expect(problem(`${AN_ARCHIVE}/`)).toBe('link-without-a-lifter');
    expect(problem(AN_ARCHIVE)).toBe('link-without-a-lifter');
  });

  it('refuses to read a path out of a scheme that is not the web', () => {
    // `javascript:` and `data:` both parse as URLs. Nothing here executes a
    // string, so the worst case was ever only that the tail of one got echoed
    // back as "searching for" -- which is the screen doing an attacker's
    // formatting, and this is the cheapest place to stop it. Taken as a typed
    // name instead, it folds to nonsense and finds nobody.
    expect(source('javascript:alert(1)')).toBe('typed');
    expect(source('data:text/plain,jane')).toBe('typed');
  });

  it('does not mistake a name with a space in it for a link', () => {
    // Without the whitespace guard, the scheme-less branch would prefix this,
    // parse `Jean` as a host, and search the archive for `luc`.
    expect(term('Jean Luc / Invented')).toBe('Jean Luc / Invented');
    expect(source('Jean Luc / Invented')).toBe('typed');
  });

  it('takes a bare hostname as a name, because it is not distinguishable from one', () => {
    // No slash, so no path to read. Reported as typed rather than as a broken
    // link: `archive.invalid` and a surname are the same shape, and the honest
    // answer is the search that finds nobody.
    expect(source('archive.invalid')).toBe('typed');
  });

  it('hands a link segment to the fold as the same key the full name folds to', () => {
    // The property the whole feature rests on. `athleteLookupKey` is idempotent
    // over case, punctuation and spacing, so a profile slug and the name printed
    // on the profile reach the archive's index at the same address. If this ever
    // stops holding, pasting a link silently finds nobody while typing the name
    // works, and nothing else in the tool can see the difference.
    expect(athleteLookupKey(term(`${AN_ARCHIVE}/u/janeinvented1`))).toBe(
      athleteLookupKey('Jane Invented #1'),
    );
  });
});
