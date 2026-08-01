# 2. Shard published data, and cap one artifact at two megabytes

**Status:** accepted — 2026-07-31; shard key amended 2026-08-01, see
[Amendment](#amendment-2026-08-01-the-record-shard-key-is-four-axes-not-two)

## Context

ADR 1 left the question of whether static hosting can hold this project's data open, on the grounds
that nothing read data yet. Something does now, so the question is answerable.

A complete set of records is the product of level, region, sex, equipment category, weight class,
age division and lift. Fifty states across three levels, with the categories a federation actually
publishes, puts the row count in the high hundreds of thousands and plausibly past a million once
world records and historical entries are included. The OpenPowerlifting mirror is larger again.

`scripts/data-scale-spike.mjs` measures the cost of a row through the real publishing pipeline. The
data is synthetic — no published federation figure appears in this repository — which is sufficient
because the cost of a row depends on the shape of a row, not on what the numbers are.

Measured on Node 24, canonical JSON, a record book of the shape in `data-contracts/records.ts`:

| rows    | on disk  | gzip   | bytes/row | gzip/row |
| ------- | -------- | ------ | --------- | -------- |
| 1,000   | 0.4 MB   | 0.0 MB | 436       | 25       |
| 10,000  | 4.2 MB   | 0.2 MB | 437       | 24       |
| 100,000 | 41.7 MB  | 2.3 MB | 438       | 24       |
| 400,000 | 167.0 MB | 9.2 MB | 438       | 24       |

Cost per row is flat, so extrapolation is safe: **1,000,000 rows is roughly 418 MB on disk**, and
2,500,000 rows is roughly 1,044 MB.

Two ceilings bound this.

**GitHub Pages publishes at most 1 GB.** A million rows of records fits at 0.41x. Two and a half
million does not fit at all, and that is before the OpenPowerlifting mirror, before any other tool
in the collection, and before the site itself.

**A single artifact cannot exceed 512 MiB, and should not approach it.** `canonicalJson` returns a
string, and V8 caps a string at 536,870,888 characters — about 1.22 million rows at the measured
width. That is a hard failure, not a slow one: the build throws rather than publishing something
degraded. Long before that, the browser-side limit binds. A phone on a conference-centre network
should not download tens of megabytes to answer one question about one weight class.

The gzip column deserves a caveat. Synthetic rows are generated from cyclic index arithmetic, which
compresses far better than real data will. Treat 24 bytes per row over the wire as an optimistic
floor, not an estimate.

## Decision

**Published data is sharded, and one artifact is budgeted at 2 MB uncompressed.** At the measured
width that is about 4,800 rows, so a million-row corpus is roughly 210 artifacts. The number is a
judgement about what is reasonable to hand a browser, not a platform limit; it is recorded here so
that raising it is a decision someone makes rather than a threshold something drifts past.

**Shards are chosen so that one question needs one artifact.** A lifter asks about one region at one
level, so that is the shard key. (Amended: it is now level, region, sex and equipment — see below.
The principle is unchanged; the axis list was wrong.) Sharding by row count instead would be simpler
to implement and would mean a lookup could not know which shard to fetch without an index of every
row, which is the thing that does not fit.

**Sharding stays inside the static adapter.** ADR 1 already requires it: callers name a book, and
`packages/data-access/src/static-data-source.ts` resolves that name through the published index.
Nothing above the seam learns that a shard exists, so changing the shard key later — or moving to an
API that does not shard — does not reach any call site.

**The 1 GB ceiling is accepted for now, not designed around.** A million rows of records fits with
room to spare, and the collection is one tool. The OpenPowerlifting mirror is the thing that will
break it, and the seam from ADR 1 is what makes that a hosting change rather than a rewrite. There
is no benefit to paying for an API today.

## Consequences

- The publishing pipeline needs a sharder: something that partitions a corpus by scope and emits one
  artifact per partition. `planPublication` already accepts a list of artifacts, so this is a
  function that produces that list, not a change to publishing.
- The build must fail, loudly, when an artifact exceeds the budget. A silently 40 MB artifact is the
  failure this ADR exists to prevent, and it will not be noticed by anyone reading a diff.
- Content addressing pays for itself here. Two hundred immutable, permanently cacheable files with
  one small mutable index in front of them is a better shape for a CDN than one large file that
  changes whenever any row does.
- `meta.json` grows with the shard count. Two hundred entries at roughly 150 bytes is about 30 kB,
  which is acceptable; ten thousand would not be, and would mean the index itself needs sharding.
  That threshold is worth remembering, not solving now.
- The spike script stays in the repository. When the shard key or the row shape changes, the
  measurement should be rerun rather than reasoned about.

## Amendment 2026-08-01: the record shard key is four axes, not two

The decision above says a lifter asks about one region at one level, so that is the shard key. That
principle survives. The axis list did not: it was reasoned from how a lifter reads a screen, never
measured against a real corpus, because no corpus existed yet.

One does now. Counting rows across a representative sample of the published record tables:

| partition | rows   | at 438 bytes/row |
| --------- | ------ | ---------------- |
| one state | 1,502  | 0.66 MB          |
| one state | 4,669  | 2.05 MB          |
| one state | 6,878  | 3.01 MB          |
| national  | 15,593 | 6.83 MB          |
| world     | 12,275 | 5.38 MB          |

Four of the five clear the 2 MB budget, two of them by more than three times. Under the original key
those four partitions throw `ArtifactTooLargeError` and the build does not complete — which is the
budget working, and also a corpus that cannot be published.

**Sex and equipment join the shard key.** They are the same pair classifications already split on
(`shardClassificationBook`), for the same reason: a lifter is one sex in one equipment category for
the whole session, while everything else on the screen moves. That divides each partition by eight
and puts the national one at roughly 1,950 rows, about 0.86 MB.

What makes that a fix rather than a reprieve is that the result is **bounded, not extrapolated**. A
record exists per distinct scope, so a partition holds at most weight classes x divisions x lifts x
tested rows — for this corpus 14 x 25 x 4 x 2, about 2,800 rows or 1.2 MB — however many meets are
held, because records replace each other rather than accumulating. The earlier figures grow with
history; these do not. Reaching the budget again takes a federation deliberately adding weight
classes or divisions, which is a change somebody makes on purpose.

Weight class, division, tested status and lift stay out of the key, and that is the part worth
holding: a lifter reads all four lifts at once, in the class they are in and the class they are
cutting to, across every division they are eligible for. Splitting on any of those turns one screen
into a dozen requests, which is the failure sharding exists to prevent.

The change reaches `RecordShardKey`, `recordShardKey`, `sameRecordShard` and `recordArtifactId` in
`data-contracts`, `shardRecordBook` in `ingestion`, and `RecordSetQuery` in `data-access`. It was
cheap because nothing was published yet — the amendment is filed now, before a corpus lands, rather
than after somebody's cached artifacts have to be invalidated for it. The consequence noted above,
that the spike should be rerun when the shard key changes, is what this amendment is.
