# 2. Shard published data, and cap one artifact at two megabytes

**Status:** accepted — 2026-07-31

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
level, so that is the shard key. Sharding by row count instead would be simpler to implement and
would mean a lookup could not know which shard to fetch without an index of every row, which is the
thing that does not fit.

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
