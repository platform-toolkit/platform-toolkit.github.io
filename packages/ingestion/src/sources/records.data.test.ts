// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { shardRecordBook } from '../shard-records.js';
import { buildCategoryCatalog } from './category-catalog.js';
import { buildRecordBook, readRecordSourceReferences } from './records.js';

/**
 * A tripwire on the committed record mapping and the crawl beside it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It does not pin a count. The crawl refreshes unattended after meet weekends, so
 * a test asserting 129,509 records would fail the first automatic refresh --
 * failing for being right, and failing in a job with nobody watching, which is
 * the worst combination available. The conversion chart's data test *can* pin its
 * row count because a federation revises a chart by hand and a person is there to
 * update the test in the same commit. This corpus has no such moment.
 *
 * What it pins instead is everything that must be true of *any* refresh: the
 * mapping and the crawl still agree, every scope a record carries is one the
 * catalogue can produce, no two records claim one category, the sharder accepts
 * the result, and no holder's name has leaked into a diagnostic. A parser
 * regression is caught by a floor rather than an equality -- a build that drops
 * most of the corpus fails, and one that gains a state does not.
 */

const CATEGORIES = new URL('../../../../data/sources/categories/uspa.json', import.meta.url);
const MAPPING = new URL('../../../../data/sources/records/uspa.json', import.meta.url);
const SNAPSHOTS = new URL('../../../../data/sources/records/snapshots/', import.meta.url);

function readJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/**
 * A floor a healthy corpus clears by an order of magnitude.
 *
 * Chosen to be smaller than any single state's contribution is large, so that it
 * cannot be met by a crawl that reached one location and gave up, and far below
 * the real figure so that a federation retiring a division does not fail a build.
 */
const MINIMUM_RECORDS = 10_000;

const mapping = readJson(MAPPING);
const references = readRecordSourceReferences(mapping);
const snapshot = readJson(new URL(references.snapshotFile, SNAPSHOTS));
const { catalog } = buildCategoryCatalog(readJson(CATEGORIES));

describe('the committed USPA record mapping', () => {
  const { book, freshness, withheld } = buildRecordBook(mapping, snapshot, catalog);

  it('builds, which is itself the assertion', () => {
    // Every vocabulary check, both absence checks, the heading cross-check and
    // the exclusion budget throw rather than report, so reaching this line means
    // all of them passed. Stated as a test anyway: a file that only fails at
    // import time reports as a suite that could not load, which reads like an
    // infrastructure problem rather than a data one.
    expect(book.records.length).toBeGreaterThan(MINIMUM_RECORDS);
  });

  it('is the federation the catalogue describes', () => {
    expect(book.id).toBe(catalog.id);
    expect(references.federationId).toBe(catalog.id);
    expect(book.minimumIncrementKilograms).toBeGreaterThan(0);
  });

  it('gives every record a scope the catalogue can produce', () => {
    const levels = new Map(catalog.levels.map((level) => [level.id, level]));
    const equipment = new Set(catalog.equipment.map((entry) => entry.id));
    const disciplines = new Map(catalog.disciplines.map((entry) => [entry.id, entry]));
    const divisions = new Set(catalog.ageDivisions.divisions.map((entry) => entry.id));
    const classesBySex = new Map(
      catalog.weightClassLadders.map((ladder) => [
        ladder.sex,
        new Set(ladder.classes.map((weightClass) => weightClass.id)),
      ]),
    );

    // A scope the catalogue cannot produce is a record the browser can never ask
    // for, and the interface renders that as "no records in this category" -- a
    // real answer nobody would think to investigate.
    const unreachable = book.records.filter((record) => {
      const { scope } = record;
      const level = levels.get(scope.levelId);
      const discipline = disciplines.get(scope.disciplineId);
      if (level === undefined || discipline === undefined) {
        return true;
      }
      const regionKnown =
        scope.regionId === null
          ? level.regions.length === 0
          : level.regions.some((region) => region.id === scope.regionId);
      return (
        !regionKnown ||
        !equipment.has(scope.equipmentId) ||
        !divisions.has(scope.divisionId) ||
        !discipline.lifts.includes(scope.lift) ||
        classesBySex.get(scope.sex)?.has(scope.weightClassId) !== true
      );
    });

    expect(unreachable).toStrictEqual([]);
  });

  it('publishes at most one record per category', () => {
    const scopes = new Set(book.records.map((record) => record.id));

    // The identifier is built from every scope axis, so this is the duplicate
    // check stated at the level a reader can see. `shardRecordBook` enforces it
    // again below; here it names the situation rather than the mechanism.
    expect(scopes.size).toBe(book.records.length);
  });

  it('carries a usable figure and a well-formed date on every record', () => {
    const malformed = book.records.filter(
      (record) =>
        !Number.isFinite(record.kilograms) ||
        record.kilograms <= 0 ||
        (record.achievedOn !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(record.achievedOn)),
    );

    expect(malformed).toStrictEqual([]);
  });

  it('recognises the federation’s seeded figures and gives none of them a holder', () => {
    const unclaimed = book.records.filter((record) => record.unclaimed);
    const contradictory = unclaimed.filter(
      (record) => record.holderName !== null || record.achievedOn !== null,
    );

    // No count and no ratio, for the reason in the header -- but *some*, because
    // a mapping whose placeholder wording stopped matching would publish the
    // federation's own placeholder text as a prolific record holder, and every
    // other assertion in this file would still pass.
    expect(unclaimed.length).toBeGreaterThan(0);
    expect(contradictory).toStrictEqual([]);
  });

  it('does not treat every row as a seeded figure', () => {
    // The other direction, which the check above cannot see: a predicate that
    // answered `true` for everything would satisfy it while erasing the name of
    // every lifter who actually holds a record.
    expect(book.records.some((record) => !record.unclaimed && record.holderName !== null)).toBe(
      true,
    );
  });

  it('is sorted by identifier, so an unchanged corpus produces unchanged filenames', () => {
    const ids = book.records.map((record) => record.id);

    expect(ids).toStrictEqual([...ids].sort());
  });

  it('withholds only rows the mapping gives a rule for, and stays inside the budget', () => {
    // Three rules and nothing else. A fourth reason appearing here means the
    // corpus changed shape, which is worth a look before the next refresh.
    const reasons = new Set(withheld.map((row) => row.reason));
    const recognised = [...reasons].every(
      (reason) =>
        reason.startsWith('discipline "') ||
        reason.startsWith('figure is below ') ||
        reason.startsWith('figure is above ') ||
        // The curated sentence for a published column the rulebook ladder for
        // that sex has never contained.
        reason.includes('ladder'),
    );

    expect(recognised).toBe(true);
    // Small against the corpus. The adapter enforces the mapping's own budget;
    // this states the order of magnitude a reader should expect to see.
    expect(withheld.length).toBeLessThan(book.records.length / 100);
  });

  it('names a position and never a person in a withheld row', () => {
    const holders = new Set(
      book.records
        .map((record) => record.holderName)
        .filter((name): name is string => name !== null),
    );
    const leaked = withheld.filter((row) =>
      row.row.split(' / ').some((segment) => holders.has(segment)),
    );

    // Section 2.3. A withheld row is the value most likely to be logged, and the
    // row key is assembled from the axes precisely so there is nowhere for a name
    // to be. This checks the assembly rather than trusting it.
    expect(leaked).toStrictEqual([]);
  });

  it('shards without a duplicate or a filename collision', () => {
    // The end of the pipeline this adapter feeds. `shardRecordBook` throws on a
    // repeated identifier and on two partitions that slug to one filename, both
    // of which would otherwise publish one partition's records over another's.
    const shards = shardRecordBook(book, 1);

    expect(shards.length).toBeGreaterThan(0);
    const total = shards.reduce((sum, shard) => sum + shard.recordCount, 0);
    expect(total).toBe(book.records.length);
  });

  it('says where the records came from and when', () => {
    expect(freshness.status).toBe('ok');
    expect(freshness.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(freshness.label).not.toBe('');
  });
});
