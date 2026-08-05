// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import {
  ATHLETE_SHARD_COUNT,
  athleteArtifactId,
  athleteLookupKey,
  athleteShardBucket,
} from './athlete-shards.js';
import { ArtifactIndexSchema } from './artifacts.js';

/** Asserts an identifier is one the artifact index will actually accept as a key. */
function isUsableIndexKey(id: string): boolean {
  return v.safeParse(ArtifactIndexSchema, {
    [id]: {
      path: `artifacts/${id}.0123456789abcdef.json`,
      sha256: 'a'.repeat(64),
      byteLength: 1,
      schemaVersion: 1,
    },
  }).success;
}

describe('athleteLookupKey', () => {
  it('folds a written name and a typed username to one key', () => {
    // The whole mechanism. The archive publishes a name and a visitor types
    // something shorter; the fold only ever removes, so both land in one place
    // and neither side has to know what the other did.
    expect(athleteLookupKey('John Doe')).toBe('johndoe');
    expect(athleteLookupKey('johndoe')).toBe('johndoe');
    expect(athleteLookupKey('  JOHN   DOE  ')).toBe('johndoe');
  });

  it('is idempotent, so a fold of a fold lands where a fold of the name does', () => {
    // Load-bearing rather than tidy: the upstream corpus is itself full of names
    // that have already been reduced once, and a fold that moved a second time
    // would put those rows in a bucket nothing looks in.
    for (const name of ['John Doe #2', 'Jose Alvarez', 'O’Brien-Smith', 'Ali 3']) {
      const once = athleteLookupKey(name);
      expect(once).not.toBeNull();
      expect(athleteLookupKey(once ?? '')).toBe(once);
    }
  });

  it('keeps the digits that tell two lifters of one name apart', () => {
    // The archive appends `#2` to the second person it sees with a name. Dropping
    // the digit would merge them, which is the one outcome this whole contract is
    // shaped to prevent.
    expect(athleteLookupKey('John Doe #2')).toBe('johndoe2');
    expect(athleteLookupKey('John Doe #2')).not.toBe(athleteLookupKey('John Doe'));
  });

  it('strips a combining mark rather than dropping the letter under it', () => {
    // NFD separates the accent from the letter; the mark class then removes only
    // the accent. Dropping the whole grapheme would spell a different name.
    expect(athleteLookupKey('Jos\u00e9 \u00c1lvarez')).toBe('josealvarez');
    expect(athleteLookupKey('Jose Alvarez')).toBe('josealvarez');
    // Precomposed and decomposed spellings of one letter are one key. The corpus
    // holds both, and a comparison taken before normalising makes them two
    // people.
    expect(athleteLookupKey('R\u00e9my')).toBe(athleteLookupKey('Re\u0301my'));
  });

  it.each([
    ['\u00dfaa', 'ssaa'], // sharp s
    ['\u00e6on', 'aeon'], // ae ligature
    ['\u00f0ea', 'dea'], // eth
    ['\u00f8re', 'ore'], // o with stroke
    ['\u00feor', 'thor'], // thorn
    ['\u0111an', 'dan'], // d with stroke
    ['\u0127el', 'hel'], // h with stroke
    ['\u0131an', 'ian'], // dotless i
    ['\u0142uk', 'luk'], // l with stroke
    ['\u0153uf', 'oeuf'], // oe ligature
    ['\u0167an', 'tan'], // t with stroke
  ])('folds %p to %p, which NFD alone cannot do', (name, expected) => {
    // Each of these carries its mark inside the glyph, so there is no base letter
    // for `normalize('NFD')` to leave behind. Without the table every one of them
    // is deleted by the final filter, and the name it sits in lands in the wrong
    // bucket -- or, for a short name, in no bucket at all.
    //
    // Spelled as escapes with the letter named beside it, the same way the table
    // itself is and for the same reason: a dotless i and an i are a pixel apart
    // in most monospace fonts, and a reviewer cannot check a fold they cannot
    // read.
    expect(athleteLookupKey(name)).toBe(expected);
  });

  it.each([
    '', // nothing at all
    '   ', // only spaces
    '---', // only punctuation
    '\u4e2d\u6587', // Han characters
    '\u0410\u043d\u043d\u0430', // Cyrillic
  ])('returns null rather than a key for %p', (name) => {
    // `null`, not an empty string. An empty key would hash, name an artifact, and
    // match every other name that reduced to nothing -- so a lifter written in
    // one script would be offered as a match for a lifter written in another.
    expect(athleteLookupKey(name)).toBeNull();
  });

  it('keeps a key made only of digits, because the corpus writes some', () => {
    // Not a curiosity: the disambiguating suffix is a digit, so a fold that
    // dropped digit-only keys would be a fold with a special case in it, and the
    // special case would fire on the names it was added to protect.
    expect(athleteLookupKey('#2')).toBe('2');
  });
});

describe('athleteShardBucket', () => {
  it('lands every key inside the published set', () => {
    for (let index = 0; index < 2000; index += 1) {
      const bucket = athleteShardBucket(`lifter${String(index)}`);
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(ATHLETE_SHARD_COUNT);
    }
  });

  it('is a fixed function of the key and not of the machine', () => {
    // Pinned figures, and they are the reason this hash is written out rather
    // than imported. The build computes a bucket and the browser computes it
    // again months later from another bundle; if the two ever disagree the
    // symptom is a lookup that quietly finds nobody.
    expect(athleteShardBucket('johndoe')).toBe(416);
    expect(athleteShardBucket('a')).toBe(300);
    // The offset basis, unmixed. Written as the constant rather than as 453 so
    // that a mutation of the seed fails here saying which constant moved.
    expect(athleteShardBucket('')).toBe(0x811c9dc5 % ATHLETE_SHARD_COUNT);
  });

  it('does not collapse two keys that differ only in their tail', () => {
    // A hash that ignored anything past a prefix would put a lifter and their
    // `#2` namesake in one bucket and look perfectly healthy doing it.
    expect(athleteShardBucket('johndoe')).not.toBe(athleteShardBucket('johndoe2'));
  });

  it('spreads keys far more evenly than their first letter does', () => {
    // The measured claim in the module header, checked at a scale a test can
    // afford. Uniformity is the entire reason a reader-hostile hash is worth it:
    // the budget is set by the largest bucket, so a skewed split spends it on a
    // letter nobody can do anything about.
    const names = Array.from({ length: 20_000 }, (_unused, index) => {
      // Deliberately skewed input, the way real names are: a quarter of these
      // start with `s`. A first-letter split of this list has one bucket holding
      // 5,000 and most holding none.
      const first = index % 4 === 0 ? 's' : String.fromCharCode(97 + (index % 26));
      return `${first}lifter${String(index)}`;
    });

    const counts = new Map<number, number>();
    for (const name of names) {
      const key = athleteLookupKey(name) ?? '';
      const bucket = athleteShardBucket(key);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }

    expect(counts.size).toBe(ATHLETE_SHARD_COUNT);
    const largest = Math.max(...counts.values());
    const mean = names.length / ATHLETE_SHARD_COUNT;
    // Under three times the mean. A first-letter split of the same list is over
    // a hundred times it.
    expect(largest).toBeLessThan(mean * 3);
  });
});

describe('athleteArtifactId', () => {
  it('names a bucket, zero-padded so the index reads in order', () => {
    expect(athleteArtifactId(0)).toBe('athletes-000');
    expect(athleteArtifactId(9)).toBe('athletes-009');
    expect(athleteArtifactId(511)).toBe('athletes-511');
  });

  it('sorts every bucket into numeric order as plain strings', () => {
    // What the padding is for. Unpadded, `athletes-9` sorts after
    // `athletes-500`, and every listing of the published set becomes unscannable
    // at exactly the size where scanning it matters.
    const names = Array.from({ length: ATHLETE_SHARD_COUNT }, (_unused, bucket) =>
      athleteArtifactId(bucket),
    );
    expect([...names].sort()).toEqual(names);
  });

  it('produces something the artifact index will accept as a key', () => {
    const id = athleteArtifactId(7);
    expect(id).not.toBeNull();
    expect(isUsableIndexKey(id ?? '')).toBe(true);
  });

  it('gives every bucket its own name', () => {
    const names = new Set(
      Array.from({ length: ATHLETE_SHARD_COUNT }, (_unused, bucket) => athleteArtifactId(bucket)),
    );
    expect(names.size).toBe(ATHLETE_SHARD_COUNT);
    expect(names.has(null)).toBe(false);
  });

  it.each([-1, ATHLETE_SHARD_COUNT, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns null for %p rather than naming a file',
    (bucket) => {
      // Total rather than throwing: the browser calls this on its way to deciding
      // whether an artifact exists, and "there is no such file" is an answer it
      // already renders. `null` reaching the index as a filename is what the
      // sharder's own check is there to stop.
      expect(athleteArtifactId(bucket)).toBeNull();
    },
  );

  it('names the bucket every key hashes into', () => {
    // The two functions are only useful composed, and this is the composition the
    // browser performs. A key that hashed outside the set would name no file and
    // read as "nobody by that name".
    for (const name of ['John Doe', 'Zelda Q', 'lifter with a very long name indeed']) {
      const key = athleteLookupKey(name) ?? '';
      expect(athleteArtifactId(athleteShardBucket(key))).not.toBeNull();
    }
  });
});
