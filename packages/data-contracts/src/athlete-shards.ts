// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * How the athlete mirror is partitioned, and what each partition is called.
 *
 * Every other corpus here is split along an axis a lifter would recognise: a
 * level and a region, a sex and an equipment category. This one cannot be. A
 * lookup names a person, and there is no property of a person that both narrows
 * the corpus and is known before the lookup -- their federation, their class and
 * their division are all things the mirror is being asked *for*. Their name is
 * the only input, so their name is what the corpus is split on.
 *
 * Splitting on a name's first letter would be the obvious way to do that and is
 * the wrong one: the letter distribution of human names is not uniform, so `s`
 * would be an order of magnitude larger than `q` and the budget would be set by
 * the worst bucket while most of them wasted a request on a nearly empty file. A
 * hash is uniform by construction, which is the whole reason to give up a name
 * anybody can read.
 *
 * MEASURED, NOT GUESSED
 *
 * On the corpus this was built against -- 593,144 mirrored entries across 94,236
 * distinct lookup keys -- 512 buckets give a median of 410 KB and a largest of
 * 592 KB against the 2 MiB artifact budget (ADR 2). The spread between smallest
 * and largest is a factor of two, which is what uniformity buys: a first-letter
 * split of the same data spans two orders of magnitude.
 *
 * WHY THE COUNT IS A CONSTANT AND NOT A FIELD IN THE INDEX
 *
 * Both the build and the browser compute a bucket, and they have to agree. A
 * count published in `meta.json` would let them disagree for one deploy -- the
 * browser reading a new count with an old artifact still cached, or an old bundle
 * reading a new one -- and the symptom is not an error. It is a lookup that finds
 * nothing, which renders as "no results for that name", which is a real and
 * unremarkable answer nobody investigates. A constant in the package both sides
 * import cannot drift. Changing it is a deliberate republication of every shard,
 * which is what changing it actually is.
 *
 * Nothing above the data-access seam sees any of this. A caller supplies a name.
 */

/** Prefix every athlete artifact identifier carries, so the index reads sorted. */
const ATHLETE_ARTIFACT_PREFIX = 'athletes';

/**
 * How many buckets the mirror is split into.
 *
 * See the header for the measurements. Raising it is cheap and lowering it is
 * not: every shard is renamed either way, but lowering it is what walks into the
 * budget.
 */
export const ATHLETE_SHARD_COUNT = 512;

/**
 * Letters with no canonical decomposition, and what they fold to.
 *
 * `normalize('NFD')` strips an accent off a letter that carries one, which
 * handles most of a Latin-script name. It does nothing for a letter whose mark is
 * part of the glyph -- a stroke through an o, a ligature -- because there is no
 * base letter underneath to keep. Those are listed here.
 *
 * Spelled as escapes with the letter named beside it, which is not the usual
 * house preference for readable source and is deliberate for this one table.
 * Several of these are the confusables the invisible-character check exists to
 * keep out of identifiers: a dotless i and an i, a d with a stroke and a d, are
 * a pixel apart in most monospace fonts and identical in some. A reviewer cannot
 * check a fold table they cannot read, and a code point is legible everywhere.
 *
 * The list is not exhaustive and is not meant to be. Anything left over is
 * dropped by the final filter, and a name that drops to nothing is a lifter this
 * mirror reports as not found -- see {@link athleteLookupKey}.
 */
const FOLDED_LETTERS: readonly (readonly [string, string])[] = [
  ['\u00df', 'ss'], // sharp s
  ['\u00e6', 'ae'], // ae ligature
  ['\u00f0', 'd'], // eth
  ['\u00f8', 'o'], // o with stroke
  ['\u00fe', 'th'], // thorn
  ['\u0111', 'd'], // d with stroke
  ['\u0127', 'h'], // h with stroke
  ['\u0131', 'i'], // dotless i
  ['\u0142', 'l'], // l with stroke
  ['\u0153', 'oe'], // oe ligature
  ['\u0167', 't'], // t with stroke
];

/**
 * The key a name and a username both reduce to, or `null` if nothing survives.
 *
 * WHY THIS PROJECT DERIVES ITS OWN KEY
 *
 * The upstream corpus publishes a lifter's *name*, not the identifier its own
 * site uses in a profile URL. That identifier is itself a fold of the name, and
 * reproducing somebody else's fold exactly would mean copying their code, which
 * this project does not do (section 2.3) -- and a fold reimplemented from
 * observation would be wrong in exactly the cases nobody thought to look at.
 *
 * So the key is ours, and what makes it work is that it is applied to *both*
 * sides of the lookup. A visitor typing `johndoe1` and a corpus row reading
 * `John Doe #1` fold to the same thing, because the fold only ever removes: case,
 * marks, and everything that is not a letter or a digit. Anything already reduced
 * passes through unchanged, so a fold of somebody else's fold lands where a fold
 * of the original name does -- for every name whose letters we handle.
 *
 * WHAT THAT COSTS, SAID PLAINLY
 *
 * A name whose letters this fold and the upstream one disagree about will not be
 * found. On the real corpus 4,914 entries carry a name written in a script with
 * no Latin letters at all, and those reduce to nothing and are dropped at
 * ingestion. Both cases end in "no results for that name", which is the honest
 * outcome: the alternative is guessing at which lifter was meant, and this data
 * feeds a screen whose entire job is to be checkable.
 *
 * `null`, not an empty string. An empty key would be a key -- it would hash, name
 * an artifact, and match every other name that reduced to nothing.
 */
export function athleteLookupKey(value: string): string | null {
  let folded = value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  for (const [letter, replacement] of FOLDED_LETTERS) {
    folded = folded.replaceAll(letter, replacement);
  }
  // Removed rather than replaced with a separator. A separator would have to be
  // written the same way by a visitor typing a username, and it is exactly the
  // character they will not type.
  //
  // This allowlist also happens to remove every combining mark, which is why no
  // test can tell the `\p{M}` strip above from its absence -- the strip stays
  // anyway, because it is the step that is *about* marks. Widening this filter
  // one day to keep, say, every `\p{L}`, would otherwise silently start
  // publishing accented and unaccented spellings of one name as two lifters, and
  // the only symptom is half a competition history.
  folded = folded.replace(/[^a-z0-9]+/gu, '');
  return folded === '' ? null : folded;
}

/**
 * Which bucket a key's lifter is published in.
 *
 * FNV-1a, 32-bit, spelled out rather than taken from a dependency. It is eight
 * lines, it has to produce the same number in Node and in a browser for as long
 * as this data is published, and a hash whose definition can be changed by a
 * version bump is a hash that can silently rename every artifact in the set.
 * `Math.imul` is what keeps the multiply in 32 bits; a plain `*` overflows into
 * a double at the third character and the result stops being FNV.
 *
 * Not a cryptographic hash and does not need to be. Nothing here is a secret and
 * a collision costs a slightly larger file.
 */
export function athleteShardBucket(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    // The key is `[a-z0-9]` by construction, so a code unit is a byte and the
    // mask is documentation rather than defence. It stays because the function
    // would otherwise depend on that invariant holding in a caller.
    hash ^= key.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % ATHLETE_SHARD_COUNT;
}

/**
 * Names the artifact holding one bucket.
 *
 * Returns `null` for anything that is not a bucket of the current set. Total
 * rather than throwing because the browser calls this on its way to deciding
 * whether an artifact exists, and "there is no such file" is an answer it already
 * knows how to render.
 *
 * Zero-padded to the width of the largest bucket, so the index reads in order and
 * `athletes-9` does not sort after `athletes-500`. The width comes from the count
 * rather than being written as a number, because the two going out of step is
 * precisely the mistake that produces a listing nobody can scan.
 */
export function athleteArtifactId(bucket: number): string | null {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= ATHLETE_SHARD_COUNT) {
    return null;
  }
  const width = String(ATHLETE_SHARD_COUNT - 1).length;
  return `${ATHLETE_ARTIFACT_PREFIX}-${String(bucket).padStart(width, '0')}`;
}
