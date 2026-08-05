# 2. Shard published data, and cap one artifact at two megabytes

**Status:** accepted — 2026-07-31; shard key amended 2026-08-01, see
[Amendment](#amendment-2026-08-01-the-record-shard-key-is-four-axes-not-two); extended to a corpus
with no readable axis 2026-08-05, see
[Amendment](#amendment-2026-08-05-a-corpus-with-no-readable-axis-is-split-on-a-hash)

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

## Amendment 2026-08-05: a corpus with no readable axis is split on a hash

Both shard keys above name axes a lifter would recognise, and both were chosen by asking what a
single screen needs at once. The athlete mirror cannot be keyed that way, and saying why is the
whole of this amendment.

A lookup against the mirror supplies one thing: a name. Every other property of a lifter — their
federation, their weight class, their division, the years they competed — is something the mirror is
being asked _for_, so none of them is available to choose an artifact with. The only input is the
input.

The obvious split on that input is the first letter of the name, and it is the wrong one. Human
names are not uniformly distributed across the alphabet, so the budget would be set by whichever
letter is largest while most requests fetched a nearly empty file. **A hash is uniform by
construction**, which is the entire reason to give up a partition name anybody can read.

Measured on the real corpus — 593,144 mirrored entries across 94,236 distinct lookup keys, which is
the subset in scope, not the whole upstream archive:

| buckets | median shard | largest shard | against the 2 MB budget |
| ------- | ------------ | ------------- | ----------------------- |
| 512     | 410 KB       | 592 KB        | largest is 29 %         |

The spread between smallest and largest is a factor of about two. A first-letter split of the same
data spans two orders of magnitude, which is the comparison worth keeping: uniformity is not a
tidiness argument here, it is what makes one budget hold for every partition.

**The bucket count is a constant in `data-contracts`, not a field in `meta.json`.** Both the build
and the browser compute a bucket and they have to agree. A published count lets them disagree for
exactly one deploy — a browser on an old bundle reading a new count, or the reverse — and the
symptom is not an error. It is a lookup that resolves to no artifact, which renders as "no results
for that name", which is a real and unremarkable answer nobody investigates. A constant both sides
import cannot drift, and changing it is a deliberate republication of every shard, which is what
changing it actually is.

**One artifact of the mirror keeps a fixed name.** With hundreds of hashed shards and no way to
enumerate them, there is otherwise no way to ask the prior question — did this build publish an
archive at all — except by fetching a bucket and reading "no" into a missing file. That conflates
two sentences a screen has to keep apart: _this build published no results archive_, which means
stop offering to search it, and _nobody in the archive is called that_, which means try another
spelling. So `athlete-mirror` is published under a constant id and carries the count, the scope
sentence and the upstream credit; the shards carry the lifters.

### What this costs, stated rather than buried

At 512 buckets the mirror is roughly 217 MB of published JSON, against about 81 MB for everything
else in the set combined. That is a real cost to a repository served from GitHub Pages, and it is
why the mirror is **not published by default**: `publish-data` emits it only when
`PTK_ATHLETE_CORPUS` names an extracted CSV, and prints one line saying so when it does not. CI is
unchanged. Turning it on is one environment variable and is a decision about what to put in public,
not a build detail.

The 168 MB source archive is downloaded to a gitignored `.cache/` and is never committed.
