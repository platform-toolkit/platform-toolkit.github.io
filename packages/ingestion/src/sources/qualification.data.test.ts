// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildCategoryCatalog } from './category-catalog.js';
import {
  buildClassificationTables,
  readClassificationSourceReferences,
} from './classification-standards.js';
import { buildQualifyingMeetBook, type PublishedStandardIds } from './qualification.js';

/**
 * A tripwire on the committed qualification transcriptions.
 *
 * Everything else in this package tests with invented figures, and this file is
 * the deliberate exception, kept to the smallest set that does a job the adapter
 * cannot do alone. It pins no meet count and no total. A meet announcement is
 * edited in place and a corpus of them grows and shrinks as meets are held, so a
 * test asserting "two meets" would fail for being right -- unattended, at two in
 * the morning, the way `records.data.test.ts` says.
 *
 * What it pins instead is the seam. This adapter's central refusal is that every
 * route's `standardId` exists in the federation's *published* classification
 * ladder, and the only place that can actually be checked against the real ladder
 * is here: the ladder is built from a 1.4 MB committed dataset, and a standard
 * renamed on that side is a route that silently resolves to nothing and renders
 * as "you have not qualified" for every lifter who reads it.
 *
 * The second thing it pins is the digest parity `sources/qualification.ts`
 * promises out loud. `check:upstream` deliberately does not watch the
 * qualification document's rulebook pin, because it is the same PDF the meet-rule
 * document already pins, and the whole basis of that omission is that the two
 * copies are the same bytes. The day they diverge, one of them is unwatched and
 * nothing says so -- unless this does.
 */

/** A committed source document, read the way `publish-data` reads it. */
function readSource(path: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../../data/sources/${path}`, import.meta.url), 'utf8'),
  ) as unknown;
}

const QUALIFICATION = readSource('qualification/uspa.json');
const MEET_RULES = readSource('meet-rules/uspa.json');

/**
 * The classification ladder, built from the committed corpus rather than listed.
 *
 * A hand-written set of identifiers here would agree with itself forever and
 * would be a second copy of the very thing the check exists to compare against.
 * The digest is taken from the file on disk for the same reason `publish-data`
 * takes it there and not from the parsed value: a digest of the parse output
 * agrees with itself no matter what the bytes said.
 */
const PUBLISHED_STANDARDS: PublishedStandardIds = (() => {
  const catalog = buildCategoryCatalog(readSource('categories/uspa.json')).catalog;
  const document = readSource('classifications/uspa.json');
  const { standardsFile } = readClassificationSourceReferences(document);
  const bytes = readFileSync(
    new URL(`../../../../data/sources/classifications/snapshots/${standardsFile}`, import.meta.url),
  );
  const { tables } = buildClassificationTables(
    document,
    {
      value: JSON.parse(bytes.toString('utf8')) as unknown,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    catalog,
  );

  const ids = new Set<string>();
  for (const table of tables) {
    for (const standard of table.standards) ids.add(standard.id);
  }
  return new Map([[catalog.id, ids]]);
})();

describe('the committed qualification criteria', () => {
  const { book, freshness } = buildQualifyingMeetBook([QUALIFICATION], PUBLISHED_STANDARDS);

  it('builds against the classification ladder that is actually published', () => {
    // Reaching here is most of the assertion -- the adapter throws on every route
    // whose standard the real ladder does not carry. Stated anyway, because a
    // file that only fails at import time reports as a suite that could not load.
    expect(book.federations.length).toBeGreaterThan(0);
    expect(book.meets.length).toBeGreaterThan(0);
  });

  it('pins the rulebook to the same bytes the meet-rule document pins', () => {
    // The compensating control for `check:upstream` not watching this copy. Both
    // documents quote the same PDF; a watch on one covers the other only while
    // that is true, and this is what makes the day it stops true a failed build
    // rather than a rule nobody is watching.
    const digestOf = (document: unknown): unknown =>
      (document as { rulebook: { sha256: unknown } }).rulebook.sha256;
    expect(digestOf(QUALIFICATION)).toBe(digestOf(MEET_RULES));
  });

  it('cites a followable section of the rulebook for every federation', () => {
    // These rules are a handful of sentences out of a hundred-page document, and
    // a citation nobody can follow to a paragraph is not a citation.
    for (const rules of book.federations) {
      expect(rules.source.url.startsWith('https://'), rules.federationId).toBe(true);
      expect(rules.source.revision, rules.federationId).not.toBe('');
      expect(rules.source.sections.length, rules.federationId).toBeGreaterThan(0);
      expect(rules.source.verifiedOn, rules.federationId).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('cites a page and a reading date for every meet', () => {
    // The only defence a meet announcement has. It carries no revision and is
    // edited in place, so this date is all that stands between a screen and a
    // criterion that changed last Tuesday.
    for (const meet of book.meets) {
      expect(meet.source.url.startsWith('https://'), meet.id).toBe(true);
      expect(meet.source.verifiedOn, meet.id).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('quotes the announcement for every criterion it states', () => {
    // §29: the tool never rules on eligibility, it shows what a federation
    // published. A route with no quotation behind it is this project asserting a
    // requirement in its own voice, which is the one thing it must not do.
    for (const meet of book.meets) {
      if (meet.entry.kind === 'open') expect(meet.entry.quotation, meet.id).not.toBe('');
      if (meet.entry.kind === 'unstated') expect(meet.entry.detail, meet.id).not.toBe('');
      if (meet.entry.kind !== 'standard') continue;
      for (const route of meet.entry.routes) {
        expect(route.quotation, `${meet.id}/${route.id}`).not.toBe('');
      }
    }
  });

  it('carries both readings wherever a page contradicts itself', () => {
    // A dispute is the honest outcome §7 asks for, and a warning a lifter cannot
    // act on is worse than no warning -- so where one is recorded, both sides of
    // it have to be quotable on screen.
    for (const meet of book.meets) {
      if (meet.entry.kind !== 'standard') continue;
      for (const route of meet.entry.routes) {
        if (route.dispute === null) continue;
        expect(route.dispute.readings.length, `${meet.id}/${route.id}`).toBeGreaterThanOrEqual(2);
        for (const reading of route.dispute.readings) {
          expect(reading.where, `${meet.id}/${route.id}`).not.toBe('');
        }
      }
    }
  });

  it('reads every meet against a federation the book carries the rules for', () => {
    // Publication refuses this, so it is a floor rather than a discovery. Held
    // anyway because the failure it guards is silent: a meet whose federation is
    // absent draws its qualifying totals with no weight-class or gear rules
    // beside them, and looks complete while showing half the criteria.
    const known = new Set(book.federations.map((rules) => rules.federationId));
    for (const meet of book.meets) {
      expect(known.has(meet.federationId), meet.id).toBe(true);
    }
  });

  it('reports freshness for the transcription without claiming to have re-read it', () => {
    expect(freshness.length).toBeGreaterThan(0);
    for (const entry of freshness) {
      expect(entry.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
  });
});
