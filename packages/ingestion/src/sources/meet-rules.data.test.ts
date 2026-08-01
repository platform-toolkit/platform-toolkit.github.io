import { readFileSync } from 'node:fs';

import { MeetRules } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import { buildMeetRuleBook } from './meet-rules.js';

/**
 * A tripwire on the committed transcriptions themselves.
 *
 * Every other test in this package uses invented figures, and for good reason: a
 * test restating a federation's numbers is a second copy of them, and the day the
 * federation revises one, the test fails for being right. This file is the
 * deliberate exception, and it is kept to the smallest set that does a job the
 * adapter cannot do on its own.
 *
 * What it pins is not the figures. It is three properties that hold no matter what
 * either federation revises, and that an accidental edit breaks:
 *
 *   1. Both documents still build, and the profiles they build are ones the domain
 *      will answer questions from.
 *   2. Every profile carries a citation a reader can follow and a verification date
 *      -- because a rule shown without a source is a claim, and the whole design of
 *      §15 rests on it not being one.
 *   3. The two profiles still *differ*. That is the load-bearing one: the reason
 *      there is no universal profile is that federations do not share these rules,
 *      and a merge or a copy-paste that quietly made one profile a duplicate of the
 *      other would leave every test above passing and every screen wrong for one
 *      federation.
 *
 * If a federation publishes a revision, this file is not expected to fail -- that
 * is `check:upstream`'s job, and it has the digest to do it with. If it *does*
 * fail, something structural was lost.
 */

const DOCUMENTS = ['uspa', 'ipf'].map((id) => {
  const path = new URL(`../../../../data/sources/meet-rules/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
});

describe('the committed meet rule profiles', () => {
  const { book, freshness } = buildMeetRuleBook(DOCUMENTS);

  it('builds every committed document', () => {
    // The adapter throws on anything it will not publish, so reaching here is
    // most of the assertion. Stated anyway, because a file that only fails at
    // import time reports as a suite that could not load.
    expect(book.profiles).toHaveLength(DOCUMENTS.length);
  });

  it('publishes profiles the domain will answer questions from', () => {
    for (const profile of book.profiles) {
      const built = MeetRules.from(profile);
      expect(built.ok, `${profile.id} should build`).toBe(true);
    }
  });

  it('cites a document and a date for every profile', () => {
    for (const profile of book.profiles) {
      expect(profile.source.url.startsWith('https://'), profile.id).toBe(true);
      expect(profile.source.revision, profile.id).not.toBe('');
      expect(profile.source.verifiedOn, profile.id).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('names each federation without claiming to be its product', () => {
    for (const profile of book.profiles) {
      expect(profile.label.length, profile.id).toBeGreaterThan(0);
      expect(profile.source.label.toLowerCase(), profile.id).not.toContain('platform toolkit');
    }
  });

  it('keeps the profiles distinct, which is why there is no universal one', () => {
    // Compared as whole profiles minus their identity, so this catches a merge
    // that made one an exact copy of the other however it happened. It does not
    // assert *which* rules differ -- that would be a second transcription -- only
    // that the difference the design rests on is still there.
    const shapes = book.profiles.map((profile) => {
      const { id, label, source, ...rules } = profile;
      void id;
      void label;
      void source;
      return JSON.stringify(rules);
    });
    expect(new Set(shapes).size).toBe(book.profiles.length);
  });

  it('reports freshness for every profile', () => {
    expect(freshness).toHaveLength(DOCUMENTS.length);
    for (const entry of freshness) {
      expect(entry.status).toBe('ok');
      expect(entry.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
  });
});
